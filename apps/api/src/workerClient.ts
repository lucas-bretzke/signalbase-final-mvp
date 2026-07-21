import { env } from './env.js';
import { createTimeBudget, TimeBudget } from './timeBudget.js';
import { CompanyProfile, DecisionMaker, WorkerErrorCode, WorkerRequestOptions } from './types.js';

export interface WorkerResolveResult {
  success: boolean;
  linkedin_url?: string;
  confidence: number;
  provider: string;
  reason: string;
  warnings?: string[];
  verificationLevel?: 'url_only' | 'company_verified';
  errorCode?: WorkerErrorCode;
}

const BLOCKING_CODES = new Set<WorkerErrorCode>(['auth_required', 'challenge', 'wrong_worker', 'worker_unavailable']);
const INTERRUPTING_CODES = new Set<WorkerErrorCode>([
  'navigation_error',
  'network_error',
  'deadline_exceeded',
  'request_cancelled',
  'queue_timeout',
  'queue_full',
  'worker_unauthorized',
]);
const WORKER_ERROR_CODES = new Set<WorkerErrorCode>([
  'auth_required',
  'challenge',
  'wrong_worker',
  'worker_unavailable',
  'navigation_error',
  'network_error',
  'deadline_exceeded',
  'request_cancelled',
  'queue_timeout',
  'queue_full',
  'worker_unauthorized',
  'invalid_request',
  'no_verified_match',
  'no_company_candidate',
  'company_not_verified',
  'no_verified_decision_maker',
  'contact_not_available',
  'rejected_by_filters',
]);
const EXPECTED_WORKER_VERSION = '3.2.0';

interface WorkerClientErrorOptions {
  cause?: unknown;
  requestId?: string;
}

export class WorkerClientError extends Error {
  readonly requestId?: string;

  constructor(readonly code: WorkerErrorCode, message: string, options: WorkerClientErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'WorkerClientError';
    this.requestId = options.requestId;
  }
}

export class LinkedinBlockingError extends WorkerClientError {
  constructor(code: WorkerErrorCode, message: string, options: WorkerClientErrorOptions = {}) {
    super(code, message, options);
    this.name = 'LinkedinBlockingError';
  }
}

export function isLinkedinBlockingError(error: unknown): error is LinkedinBlockingError {
  return error instanceof LinkedinBlockingError;
}

export function isWorkerClientError(error: unknown): error is WorkerClientError {
  return error instanceof WorkerClientError;
}

async function postJson<T>(path: string, body: unknown, options: WorkerRequestOptions = {}): Promise<T> {
  const budget = createTimeBudget(options, env.requestTimeoutMs);
  try {
    throwIfBudgetAborted(budget);
    const response = await fetch(`${env.workerUrl}${path}`, {
      method: 'POST',
      headers: requestHeaders(budget),
      body: JSON.stringify(withRequestMetadata(body, budget)),
      signal: budget.signal,
    });
    const result = await readJson<T>(response, budget);
    if (!response.ok) {
      const code = workerErrorCode(result.errorCode) ?? statusErrorCode(response.status);
      throw workerError(code, result.error ?? `Worker HTTP ${response.status}`, { requestId: budget.requestId });
    }
    return result;
  } catch (error) {
    if (isWorkerClientError(error)) throw error;
    const abortCode = budget.abortCode();
    if (abortCode) {
      throw workerError(
        abortCode,
        abortCode === 'deadline_exceeded' ? 'Deadline da chamada ao worker excedido.' : 'Chamada ao worker cancelada.',
        { cause: budget.abortCause() ?? error, requestId: budget.requestId },
      );
    }
    const code = transportErrorCode(error);
    throw workerError(
      code,
      code === 'worker_unavailable' ? 'Worker do LinkedIn indisponivel.' : 'Falha de rede ao chamar o worker do LinkedIn.',
      { cause: error, requestId: budget.requestId },
    );
  } finally {
    budget.dispose();
  }
}

export async function workerHealth(options: WorkerRequestOptions = {}): Promise<Record<string, unknown>> {
  if (!env.linkedinEnabled) {
    return { ok: true, enabled: false, mode: env.workerMode, implementation: 'puppeteer', skipped: true };
  }
  const budget = createTimeBudget(options, 3_000);
  try {
    throwIfBudgetAborted(budget);
    const response = await fetch(`${env.workerUrl}/health`, {
      headers: requestHeaders(budget),
      signal: budget.signal,
    });
    const body = await readJson<Record<string, unknown>>(response, budget);
    if (!response.ok) {
      const code = workerErrorCode(body.errorCode) ?? statusErrorCode(response.status);
      throw workerError(code, typeof body.error === 'string' ? body.error : `Worker HTTP ${response.status}`, {
        requestId: budget.requestId,
      });
    }
    const identityMatches = response.ok
      && body.worker === 'signalbase-final-mvp-linkedin-worker'
      && body.implementation === 'puppeteer'
      && body.version === EXPECTED_WORKER_VERSION
      && body.mode === env.workerMode;
    if (!identityMatches) {
      return {
        ok: false,
        ready: false,
        errorCode: 'wrong_worker',
        error: `Worker inesperado; esperado Puppeteer no modo ${env.workerMode}.`,
      };
    }
    return body;
  } catch (error) {
    const normalized = normalizeRequestError(error, budget);
    return { ok: false, ready: false, errorCode: normalized.code, error: normalized.message };
  } finally {
    budget.dispose();
  }
}

export async function testLinkedinSession(options: WorkerRequestOptions = {}): Promise<Record<string, unknown>> {
  const health = await workerHealth(options);
  if (health.ok !== true) return health;
  if (env.workerMode === 'demo') return { ...health, ready: false, sessionState: 'demo', checkedAt: new Date().toISOString() };
  try {
    const result = await postJson<Record<string, unknown> & { errorCode?: WorkerErrorCode; error?: string }>('/session/check', {}, options);
    return { ...health, ...result, ready: result.authenticated === true };
  } catch (error) {
    return {
      ...health,
      ok: false,
      ready: false,
      errorCode: errorCodeOf(error) ?? 'worker_unavailable',
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function resolveCompanyPage(input: {
  cnpj: string;
  companyName?: string;
  tradingName?: string;
  legalName?: string;
  domain?: string;
  website?: string;
  email?: string;
  city?: string;
  uf?: string;
  linkedinUrl?: string;
}, options: WorkerRequestOptions = {}): Promise<WorkerResolveResult> {
  if (!env.linkedinEnabled) {
    return {
      success: false,
      confidence: 0,
      provider: 'linkedin_disabled',
      reason: 'Cruzamento com LinkedIn desativado por LINKEDIN_ENABLED=false.',
    };
  }
  try {
    const result = await postJson<WorkerResolveResult>('/company/resolve', {
      cnpj: input.cnpj,
      company_name: input.companyName,
      trading_name: input.tradingName,
      legal_name: input.legalName,
      domain: input.domain,
      website: input.website,
      email: input.email,
      city: input.city,
      uf: input.uf,
      linkedin_url: input.linkedinUrl,
    }, options);
    assertNotBlocking(result);
    return result;
  } catch (error) {
    if (mustInterrupt(error)) throw error;
    return {
      success: false,
      confidence: 0,
      provider: 'puppeteer_worker_error',
      reason: error instanceof Error ? error.message : String(error),
      errorCode: errorCodeOf(error),
    };
  }
}

export async function extractCompany(
  linkedinUrl: string,
  cnpj: string,
  companyName: string,
  context: { domain?: string; city?: string; uf?: string; cnae?: string } = {},
  options: WorkerRequestOptions = {},
): Promise<CompanyProfile> {
  try {
    const result = await postJson<CompanyProfile>('/company/extract', {
      linkedin_url: linkedinUrl,
      cnpj,
      company_name: companyName,
      domain: context.domain,
      city: context.city,
      uf: context.uf,
      cnae: context.cnae,
    }, options);
    assertNotBlocking(result);
    return result;
  } catch (error) {
    if (mustInterrupt(error)) throw error;
    return {
      success: false,
      linkedin_url: linkedinUrl,
      error: error instanceof Error ? error.message : String(error),
      errorCode: errorCodeOf(error),
      method_used: 'worker_error',
    };
  }
}

export async function searchDecisionMakers(params: {
  companyName: string;
  linkedinUrl: string;
  domain?: string;
  cnpj?: string;
  keywords?: string[];
  partnerNames?: string[];
  maxResults: number;
}, options: WorkerRequestOptions = {}): Promise<{ success: boolean; source: string; decision_makers: DecisionMaker[]; warnings: string[]; errorCode?: WorkerErrorCode }> {
  try {
    const result = await postJson<{ success: boolean; source: string; decision_makers: DecisionMaker[]; warnings: string[]; errorCode?: WorkerErrorCode }>('/decision-makers/search', {
      company_name: params.companyName,
      linkedin_url: params.linkedinUrl,
      domain: params.domain,
      cnpj: params.cnpj,
      keywords: params.keywords,
      partner_names: params.partnerNames,
      max_results: params.maxResults,
    }, options);
    assertNotBlocking(result);
    return result;
  } catch (error) {
    if (mustInterrupt(error)) throw error;
    return {
      success: false,
      source: 'worker_error',
      decision_makers: [],
      warnings: [error instanceof Error ? error.message : String(error)],
      errorCode: errorCodeOf(error),
    };
  }
}

function assertNotBlocking(value: { errorCode?: WorkerErrorCode; error?: string; warnings?: string[] }): void {
  if (value.errorCode && (BLOCKING_CODES.has(value.errorCode) || INTERRUPTING_CODES.has(value.errorCode))) {
    throw workerError(
      value.errorCode,
      value.error ?? value.warnings?.[0] ?? 'Worker do LinkedIn indisponivel.',
    );
  }
}

function workerError(
  code: WorkerErrorCode,
  message: string,
  options: WorkerClientErrorOptions = {},
): WorkerClientError {
  return BLOCKING_CODES.has(code)
    ? new LinkedinBlockingError(code, message, options)
    : new WorkerClientError(code, message, options);
}

function mustInterrupt(error: unknown): boolean {
  return isLinkedinBlockingError(error)
    || (isWorkerClientError(error) && INTERRUPTING_CODES.has(error.code))
    || error instanceof TypeError
    || error instanceof RangeError;
}

function errorCodeOf(error: unknown): WorkerErrorCode | undefined {
  if (isWorkerClientError(error)) return error.code;
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return workerErrorCode((error as { code?: unknown }).code);
}

function requestHeaders(budget: TimeBudget): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': budget.requestId,
    'x-request-deadline': String(budget.deadline),
  };
  if (env.workerAuthToken) headers.authorization = `Bearer ${env.workerAuthToken}`;
  return headers;
}

function withRequestMetadata(body: unknown, budget: TimeBudget): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  return {
    ...body,
    request_id: budget.requestId,
    deadline: budget.deadline,
  };
}

async function readJson<T>(
  response: Response,
  budget: TimeBudget,
): Promise<T & { errorCode?: unknown; error?: string }> {
  try {
    return await response.json() as T & { errorCode?: unknown; error?: string };
  } catch (error) {
    if (budget.abortCode()) throw error;
    throw workerError('worker_unavailable', 'Worker retornou uma resposta JSON invalida.', {
      cause: error,
      requestId: budget.requestId,
    });
  }
}

function throwIfBudgetAborted(budget: TimeBudget): void {
  const code = budget.abortCode();
  if (!code) return;
  throw workerError(
    code,
    code === 'deadline_exceeded' ? 'Deadline da chamada ao worker excedido.' : 'Chamada ao worker cancelada.',
    { cause: budget.abortCause(), requestId: budget.requestId },
  );
}

function normalizeRequestError(error: unknown, budget: TimeBudget): WorkerClientError {
  if (isWorkerClientError(error)) return error;
  const abortCode = budget.abortCode();
  if (abortCode) {
    return workerError(
      abortCode,
      abortCode === 'deadline_exceeded' ? 'Deadline da chamada ao worker excedido.' : 'Chamada ao worker cancelada.',
      { cause: budget.abortCause() ?? error, requestId: budget.requestId },
    );
  }
  const code = transportErrorCode(error);
  return workerError(
    code,
    code === 'worker_unavailable' ? 'Worker do LinkedIn indisponivel.' : 'Falha de rede ao chamar o worker do LinkedIn.',
    { cause: error, requestId: budget.requestId },
  );
}

function workerErrorCode(value: unknown): WorkerErrorCode | undefined {
  return typeof value === 'string' && WORKER_ERROR_CODES.has(value as WorkerErrorCode)
    ? value as WorkerErrorCode
    : undefined;
}

function statusErrorCode(status: number): WorkerErrorCode {
  if (status === 408 || status === 504) return 'deadline_exceeded';
  if (status === 499) return 'request_cancelled';
  if (status === 401) return 'worker_unauthorized';
  if (status === 429) return 'queue_full';
  return 'worker_unavailable';
}

function transportErrorCode(error: unknown): WorkerErrorCode {
  const code = nestedErrorCode(error);
  return code && new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
  ]).has(code)
    ? 'worker_unavailable'
    : 'network_error';
}

function nestedErrorCode(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  return nestedErrorCode(candidate.cause, depth + 1);
}
