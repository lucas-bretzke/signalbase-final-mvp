import { env } from './env.js';
import { CompanyProfile, DecisionMaker, WorkerErrorCode } from './types.js';

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
const EXPECTED_WORKER_VERSION = '3.1.0';

export class LinkedinBlockingError extends Error {
  constructor(readonly code: WorkerErrorCode, message: string) {
    super(message);
    this.name = 'LinkedinBlockingError';
  }
}

export function isLinkedinBlockingError(error: unknown): error is LinkedinBlockingError {
  return error instanceof LinkedinBlockingError;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.requestTimeoutMs);
  try {
    const response = await fetch(`${env.workerUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = (await response.json()) as T & { errorCode?: WorkerErrorCode; error?: string };
    if (!response.ok) throw workerError(result.errorCode, result.error ?? `Worker HTTP ${response.status}`);
    return result;
  } catch (error) {
    if (isLinkedinBlockingError(error)) throw error;
    throw new LinkedinBlockingError('worker_unavailable', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export async function workerHealth(): Promise<Record<string, unknown>> {
  if (!env.linkedinEnabled) {
    return { ok: true, enabled: false, mode: env.workerMode, implementation: 'puppeteer', skipped: true };
  }
  try {
    const response = await fetch(`${env.workerUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await response.json()) as Record<string, unknown>;
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
        error: `Worker inesperado em ${env.workerUrl}; esperado Puppeteer no modo ${env.workerMode}.`,
        received: body,
      };
    }
    return body;
  } catch (error) {
    return { ok: false, ready: false, errorCode: 'worker_unavailable', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function testLinkedinSession(): Promise<Record<string, unknown>> {
  const health = await workerHealth();
  if (health.ok !== true) return health;
  if (env.workerMode === 'demo') return { ...health, ready: false, sessionState: 'demo', checkedAt: new Date().toISOString() };
  try {
    const result = await postJson<Record<string, unknown> & { errorCode?: WorkerErrorCode; error?: string }>('/session/check', {});
    return { ...health, ...result, ready: result.authenticated === true };
  } catch (error) {
    return {
      ...health,
      ok: false,
      ready: false,
      errorCode: isLinkedinBlockingError(error) ? error.code : 'worker_unavailable',
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
}): Promise<WorkerResolveResult> {
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
    });
    assertNotBlocking(result);
    return result;
  } catch (error) {
    if (isLinkedinBlockingError(error)) throw error;
    return {
      success: false,
      confidence: 0,
      provider: 'puppeteer_worker_error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function extractCompany(
  linkedinUrl: string,
  cnpj: string,
  companyName: string,
  context: { domain?: string; city?: string; uf?: string; cnae?: string } = {},
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
    });
    assertNotBlocking(result);
    return result;
  } catch (error) {
    if (isLinkedinBlockingError(error)) throw error;
    return {
      success: false,
      linkedin_url: linkedinUrl,
      error: error instanceof Error ? error.message : String(error),
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
}): Promise<{ success: boolean; source: string; decision_makers: DecisionMaker[]; warnings: string[]; errorCode?: WorkerErrorCode }> {
  try {
    const result = await postJson<{ success: boolean; source: string; decision_makers: DecisionMaker[]; warnings: string[]; errorCode?: WorkerErrorCode }>('/decision-makers/search', {
      company_name: params.companyName,
      linkedin_url: params.linkedinUrl,
      domain: params.domain,
      cnpj: params.cnpj,
      keywords: params.keywords,
      partner_names: params.partnerNames,
      max_results: params.maxResults,
    });
    assertNotBlocking(result);
    return result;
  } catch (error) {
    if (isLinkedinBlockingError(error)) throw error;
    return {
      success: false,
      source: 'worker_error',
      decision_makers: [],
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function assertNotBlocking(value: { errorCode?: WorkerErrorCode; error?: string; warnings?: string[] }): void {
  if (value.errorCode && BLOCKING_CODES.has(value.errorCode)) {
    throw new LinkedinBlockingError(value.errorCode, value.error ?? value.warnings?.[0] ?? 'Worker do LinkedIn indisponivel.');
  }
}

function workerError(code: WorkerErrorCode | undefined, message: string): Error {
  return code && BLOCKING_CODES.has(code) ? new LinkedinBlockingError(code, message) : new Error(message);
}
