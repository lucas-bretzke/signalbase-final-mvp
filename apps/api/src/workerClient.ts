import { env } from './env.js';
import { CompanyProfile, DecisionMaker } from './types.js';

export interface WorkerResolveResult {
  success: boolean;
  linkedin_url?: string;
  confidence: number;
  provider: string;
  reason: string;
  warnings?: string[];
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
    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
    return (await response.json()) as T;
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
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
    return await postJson<WorkerResolveResult>('/company/resolve', {
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
  } catch (error) {
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
    return await postJson<CompanyProfile>('/company/extract', {
      linkedin_url: linkedinUrl,
      cnpj,
      company_name: companyName,
      domain: context.domain,
      city: context.city,
      uf: context.uf,
      cnae: context.cnae,
    });
  } catch (error) {
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
}): Promise<{ success: boolean; source: string; decision_makers: DecisionMaker[]; warnings: string[] }> {
  try {
    return await postJson('/decision-makers/search', {
      company_name: params.companyName,
      linkedin_url: params.linkedinUrl,
      domain: params.domain,
      cnpj: params.cnpj,
      keywords: params.keywords,
      partner_names: params.partnerNames,
      max_results: params.maxResults,
    });
  } catch (error) {
    return {
      success: false,
      source: 'worker_error',
      decision_makers: [],
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}
