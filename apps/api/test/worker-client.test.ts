import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/env.js';
import {
  isWorkerClientError,
  resolveCompanyPage,
  workerHealth,
  WorkerClientError,
} from '../src/workerClient.js';

const COMPANY_INPUT = { cnpj: '00000000000191', companyName: 'Empresa Teste' };
const NOW = 1_800_000_000_000;

describe('worker client deadlines and cancellation', () => {
  let linkedinEnabled: boolean;

  beforeEach(() => {
    linkedinEnabled = env.linkedinEnabled;
    env.linkedinEnabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    env.linkedinEnabled = linkedinEnabled;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('classifies its absolute deadline as deadline_exceeded and clears the timer', async () => {
    vi.stubGlobal('fetch', abortAwareFetch());

    const pending = resolveCompanyPage(COMPANY_INPUT, {
      requestId: 'deadline-test',
      deadline: NOW + 50,
    });
    const rejection = rejectedError(pending);
    await vi.advanceTimersByTimeAsync(50);

    const error = await rejection;
    expect(error).toBeInstanceOf(WorkerClientError);
    expect(error).toMatchObject({ code: 'deadline_exceeded', requestId: 'deadline-test' });
    expect((error as Error).cause).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('classifies an external abort as request_cancelled, preserves cause, and removes listeners', async () => {
    const external = new AbortController();
    const reason = new Error('caller stopped');
    const add = vi.spyOn(external.signal, 'addEventListener');
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    vi.stubGlobal('fetch', abortAwareFetch());

    const pending = resolveCompanyPage(COMPANY_INPUT, {
      requestId: 'cancel-test',
      deadline: NOW + 5_000,
      signal: external.signal,
    });
    external.abort(reason);

    const error = await rejectedError(pending);
    expect(error).toMatchObject({ code: 'request_cancelled', requestId: 'cancel-test', cause: reason });
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'navigation_error',
    'network_error',
    'queue_timeout',
    'queue_full',
  ] as const)('preserves worker HTTP errorCode %s as an interrupting error', async (errorCode) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ errorCode, error: `typed ${errorCode}` }, 503)));

    const error = await rejectedError(resolveCompanyPage(COMPANY_INPUT, {
      requestId: `http-${errorCode}`,
      deadline: NOW + 1_000,
    }));

    expect(isWorkerClientError(error)).toBe(true);
    expect(error).toMatchObject({ code: errorCode, message: `typed ${errorCode}` });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('maps an untyped HTTP 429 response to queue_full', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'fila cheia' }, 429)));

    const error = await rejectedError(resolveCompanyPage(COMPANY_INPUT, {
      deadline: NOW + 1_000,
    }));

    expect(error).toMatchObject({ code: 'queue_full' });
  });

  it('sends non-sensitive request metadata and cleans up on success', async () => {
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      linkedin_url: 'https://www.linkedin.com/company/empresa-teste',
      confidence: 95,
      provider: 'test',
      reason: 'verified',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await resolveCompanyPage(COMPANY_INPUT, {
      requestId: 'metadata-test',
      deadline: NOW + 5_000,
      signal: external.signal,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      'x-request-id': 'metadata-test',
      'x-request-deadline': String(NOW + 5_000),
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      request_id: 'metadata-test',
      deadline: NOW + 5_000,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an invalid absolute deadline before calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveCompanyPage(COMPANY_INPUT, { deadline: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes a transport reset from an unavailable worker', async () => {
    const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reset));

    const error = await rejectedError(resolveCompanyPage(COMPANY_INPUT, { deadline: NOW + 1_000 }));

    expect(error).toMatchObject({ code: 'network_error', cause: reset });
  });

  it('does not reflect an unexpected service payload or internal URL in health diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      worker: 'unexpected-service',
      secret: 'must-not-be-reflected',
    })));

    const result = await workerHealth({ deadline: NOW + 1_000 });

    expect(result).toMatchObject({ ok: false, ready: false, errorCode: 'wrong_worker' });
    expect(result).not.toHaveProperty('received');
    expect(JSON.stringify(result)).not.toContain('must-not-be-reflected');
    expect(JSON.stringify(result)).not.toContain(env.workerUrl);
  });
});

function abortAwareFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) throw new Error('Expected fetch signal.');
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function rejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject.');
}
