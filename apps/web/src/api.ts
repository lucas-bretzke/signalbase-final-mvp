import {
  CreateLeadSearchInput,
  ExportDownload,
  LeadResultListParams,
  LeadSearch,
  LeadSearchListParams,
  LeadSearchResult,
  PaginatedResponse,
} from './types';

const basePath = '/api/lead-searches';

type JsonRecord = Record<string, unknown>;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw || `A solicitação falhou (HTTP ${response.status}).`;
    try {
      const parsed = JSON.parse(raw) as JsonRecord;
      message = String(parsed.message ?? parsed.error ?? message);
    } catch {
      // The fallback already contains the most useful response available.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === 'ALL') continue;
    query.set(key, String(value));
  }
  const result = query.toString();
  return result ? `?${result}` : '';
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' ? value as JsonRecord : {};
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return fallback;
}

function asEmailType(value: unknown, onlyCorporateEmail: boolean): LeadSearch['emailType'] {
  if (value === 'corporate' || value === 'non_corporate' || value === 'any') return value;
  return onlyCorporateEmail ? 'corporate' : 'any';
}

function asTargetMode(value: unknown, targetQuantity: number): LeadSearch['targetMode'] {
  if (value === 'max' || value === 'fixed') return value;
  return targetQuantity > 0 ? 'fixed' : 'max';
}

function asCompletionReason(value: unknown, status: unknown): LeadSearch['completionReason'] {
  if (value === 'target_reached' || value === 'candidate_pool_exhausted') return value;
  return String(status ?? '').toLowerCase() === 'exhausted' ? 'candidate_pool_exhausted' : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Comma-separated CNAEs are accepted for compatibility with early data.
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeSearch(value: unknown): LeadSearch {
  const data = asRecord(value);
  const targetQuantity = asNumber(data.targetQuantity);
  const totalProcessed = asNumber(data.totalProcessed);
  const totalValidLeads = asNumber(data.totalValidLeads);
  const totalCandidatesFound = asNumber(data.totalCandidatesFound);
  const calculatedYield = totalProcessed > 0 ? (totalValidLeads / totalProcessed) * 100 : 0;
  const targetMode = asTargetMode(data.targetMode, targetQuantity);
  const calculatedCandidateProgress = totalCandidatesFound > 0 ? Math.min((totalProcessed / totalCandidatesFound) * 100, 100) : 0;
  const calculatedProgress = targetMode === 'max'
    ? calculatedCandidateProgress
    : targetQuantity > 0 ? (totalValidLeads / targetQuantity) * 100 : 0;

  const onlyCorporateEmail = asBoolean(data.onlyCorporateEmail);
  const emailType = asEmailType(data.emailType, onlyCorporateEmail);
  const status = String(data.status ?? 'PENDING');

  return {
    id: String(data.id ?? ''),
    uf: String(data.uf ?? ''),
    city: data.city ? String(data.city) : undefined,
    cnaes: asStringArray(data.cnaes),
    targetQuantity,
    targetMode,
    minScore: data.minScore === null || data.minScore === undefined ? undefined : asNumber(data.minScore),
    requirePhone: asBoolean(data.requirePhone),
    requireEmail: asBoolean(data.requireEmail),
    requireDecisionMakerMatch: asBoolean(data.requireDecisionMakerMatch),
    onlyMobilePhone: asBoolean(data.onlyMobilePhone),
    emailType,
    onlyCorporateEmail: emailType === 'corporate',
    excludeGenericContacts: asBoolean(data.excludeGenericContacts),
    status,
    completionReason: asCompletionReason(data.completionReason, status),
    totalCandidatesFound,
    candidateCountStatus: data.candidateCountStatus === 'lower_bound' ? 'lower_bound' : 'exact',
    totalProcessed,
    totalValidLeads,
    remainingQuantity: data.remainingQuantity === undefined
      ? targetMode === 'max' ? 0 : Math.max(targetQuantity - totalValidLeads, 0)
      : asNumber(data.remainingQuantity),
    yieldRate: data.yieldRate === undefined ? calculatedYield : asNumber(data.yieldRate),
    progressPercent: data.progressPercent === undefined
      ? Math.min(calculatedProgress, 100)
      : asNumber(data.progressPercent),
    candidateProgressPercent: data.candidateProgressPercent === undefined
      ? calculatedCandidateProgress
      : asNumber(data.candidateProgressPercent),
    currentStage: data.currentStage ? String(data.currentStage) : undefined,
    errorMessage: data.errorMessage
      ? String(data.errorMessage)
      : data.lastError
        ? String(data.lastError)
        : undefined,
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? data.createdAt ?? new Date().toISOString()),
  };
}

function normalizeResult(value: unknown): LeadSearchResult {
  const data = asRecord(value);
  const rawLead = asRecord(data.lead ?? data.leadCrossMatch);
  const rawCandidate = asRecord(data.candidate);
  return {
    id: String(data.id ?? ''),
    leadSearchId: String(data.leadSearchId ?? ''),
    cnpj: String(data.cnpj ?? ''),
    leadCrossMatchId: data.leadCrossMatchId ? String(data.leadCrossMatchId) : undefined,
    finalScore: data.finalScore === null || data.finalScore === undefined ? undefined : asNumber(data.finalScore),
    status: String(data.status ?? 'PENDING'),
    selected: asBoolean(data.selected),
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    lead: rawLead as LeadSearchResult['lead'],
    leadCrossMatch: rawLead as LeadSearchResult['leadCrossMatch'],
    candidate: rawCandidate as LeadSearchResult['candidate'],
    companyName: data.companyName ? String(data.companyName) : undefined,
    tradingName: data.tradingName ? String(data.tradingName) : undefined,
    city: data.city ? String(data.city) : undefined,
    uf: data.uf ? String(data.uf) : undefined,
    cnae: data.cnae ? String(data.cnae) : undefined,
    partner: data.partner ? String(data.partner) : undefined,
    finalEmail: data.finalEmail ? String(data.finalEmail) : (rawLead.finalEmail ? String(rawLead.finalEmail) : undefined),
    finalPhone: data.finalPhone ? String(data.finalPhone) : (rawLead.finalPhone ? String(rawLead.finalPhone) : undefined),
    decisionMakerMatched: asBoolean(data.decisionMakerMatched ?? rawLead.decisionMakerMatched),
    rejectionReasons: Array.isArray(data.rejectionReasons) ? data.rejectionReasons.map(String) : [],
  };
}

function unwrap(value: unknown, key: string): unknown {
  const record = asRecord(value);
  return record[key] ?? record.data ?? value;
}

function normalizePage<T>(value: unknown, normalize: (item: unknown) => T): PaginatedResponse<T> {
  const record = asRecord(value);
  const nested = asRecord(record.data);
  const rawItems = record.items ?? record.results ?? record.searches ?? nested.items ?? nested.results ?? nested.searches ?? [];
  const items = Array.isArray(rawItems) ? rawItems.map(normalize) : [];
  return {
    items,
    total: asNumber(record.total ?? nested.total, items.length),
    page: Math.max(1, asNumber(record.page ?? nested.page, 1)),
    pageSize: Math.max(1, asNumber(record.pageSize ?? nested.pageSize, items.length || 20)),
  };
}

export async function createLeadSearch(input: CreateLeadSearchInput): Promise<LeadSearch> {
  const payload = {
    ...input,
    city: input.city?.trim() || undefined,
    minScore: input.minScore === undefined ? undefined : input.minScore,
  };
  const response = await requestJson<unknown>(basePath, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeSearch(unwrap(response, 'search'));
}

export async function listLeadSearches(params: LeadSearchListParams = {}): Promise<PaginatedResponse<LeadSearch>> {
  const response = await requestJson<unknown>(`${basePath}${queryString({
    page: params.page,
    pageSize: params.pageSize,
    status: params.status,
  })}`);
  return normalizePage(response, normalizeSearch);
}

export async function getLeadSearch(id: string): Promise<LeadSearch> {
  const response = await requestJson<unknown>(`${basePath}/${encodeURIComponent(id)}`);
  return normalizeSearch(unwrap(response, 'search'));
}

export async function listLeadSearchResults(
  leadSearchId: string,
  params: LeadResultListParams = {},
): Promise<PaginatedResponse<LeadSearchResult>> {
  const response = await requestJson<unknown>(
    `${basePath}/${encodeURIComponent(leadSearchId)}/results${queryString({
      page: params.page,
      pageSize: params.pageSize,
      status: params.status,
      selected: params.selected,
    })}`,
  );
  return normalizePage(response, normalizeResult);
}

export async function getLeadSearchResult(leadSearchId: string, resultId: string): Promise<LeadSearchResult> {
  const response = await requestJson<unknown>(
    `${basePath}/${encodeURIComponent(leadSearchId)}/results/${encodeURIComponent(resultId)}`,
  );
  return normalizeResult(unwrap(response, 'result'));
}

export async function updateLeadSearchResultSelection(
  leadSearchId: string,
  resultId: string,
  selected: boolean,
): Promise<LeadSearchResult> {
  const response = await requestJson<unknown>(
    `${basePath}/${encodeURIComponent(leadSearchId)}/results/${encodeURIComponent(resultId)}`,
    { method: 'PATCH', body: JSON.stringify({ selected }) },
  );
  return normalizeResult(unwrap(response, 'result'));
}

export async function exportLeadSearch(leadSearchId: string, selectedOnly: boolean): Promise<ExportDownload> {
  const response = await fetch(
    `${basePath}/${encodeURIComponent(leadSearchId)}/export.csv${queryString({ selectedOnly })}`,
    { headers: { accept: 'text/csv' } },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Não foi possível gerar a exportação.');
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  const filename = match?.[1] ? decodeURIComponent(match[1].replace(/\"/g, '').trim()) : `econosense-leads-${leadSearchId}.csv`;
  return { blob: await response.blob(), filename };
}
