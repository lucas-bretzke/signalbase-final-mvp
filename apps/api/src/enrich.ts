import { enrichFromBrasilApi } from './brasilApi.js';
import { env } from './env.js';
import { ResolveResult, resolveLinkedInUrl } from './linkedinResolver.js';
import { chooseBestDecisionMaker, classifyLead, passesQualityFilter } from './scoring.js';
import { BatchRequest, CompanyInput, CompanyProfile, DecisionMaker, EnrichedLead, EnrichResponse } from './types.js';
import { domainFromEmail, domainFromUrl, leadId, nonEmpty, normalizeCnpj, onlyDigits, safeArray, uniq } from './utils.js';
import { extractCompany, searchDecisionMakers } from './workerClient.js';

const DEFAULT_KEYWORDS = [
  'CEO',
  'Founder',
  'Co-Founder',
  'Socio',
  'Diretor',
  'CTO',
  'Head of Technology',
  'Head of Sales',
  'Head of Growth',
];

type DecisionSearchResult = Awaited<ReturnType<typeof searchDecisionMakers>>;

interface BatchContext {
  brasilApiCache: Map<string, Promise<CompanyInput>>;
  linkedinCache: Map<string, Promise<ResolveResult>>;
  companyCache: Map<string, Promise<CompanyProfile>>;
  decisionCache: Map<string, Promise<DecisionSearchResult>>;
  workerLimit: <T>(task: () => Promise<T>) => Promise<T>;
}

export interface LeadResult {
  lead?: EnrichedLead;
  rejected?: EnrichResponse['rejected'][number];
  foundLinkedin: boolean;
  filteredOut: boolean;
  notFound: boolean;
}

export async function enrichBatch(request: BatchRequest): Promise<EnrichResponse> {
  const limitedRows = request.rows.slice(0, env.maxBatchSize);
  const warnings: string[] = [];
  if (request.rows.length > limitedRows.length) warnings.push(`Lote limitado a ${env.maxBatchSize} linhas neste MVP.`);

  const context = createBatchContext();
  const results = await mapLimit(limitedRows, env.enrichConcurrency, (rawInput) => enrichOne(rawInput, request, context));
  const leads = results.flatMap((result) => result.lead ? [result.lead] : []);
  const rejected = results.flatMap((result) => result.rejected ? [result.rejected] : []);

  return {
    totalInput: limitedRows.length,
    foundLinkedin: results.filter((result) => result.foundLinkedin).length,
    returned: leads.length,
    filteredOut: results.filter((result) => result.filteredOut).length,
    notFound: results.filter((result) => result.notFound).length,
    quality: request.quality,
    provider: env.searchProvider,
    mode: env.workerMode,
    leads,
    rejected,
    warnings,
  };
}

export async function enrichCompany(
  input: CompanyInput,
  options: Pick<BatchRequest, 'maxDecisionMakers' | 'keywords'> = {},
): Promise<LeadResult> {
  return enrichOne(input, {
    rows: [input],
    quality: 'muito_alta',
    maxDecisionMakers: options.maxDecisionMakers ?? 8,
    keywords: options.keywords,
  }, createBatchContext(), true);
}

async function enrichOne(
  rawInput: CompanyInput,
  request: BatchRequest,
  context: BatchContext,
  includeBelowQuality = false,
): Promise<LeadResult> {
  const cleaned = cleanInput(rawInput);
  const input = await enrichInput(cleaned, context);
  const displayName = nonEmpty(input.nomeFantasia, input.razaoSocial, input.cnpj) ?? input.cnpj;
  const resolved = await cached(context.linkedinCache, linkedinCacheKey(input), () => resolveLinkedInUrl(input));

  if (!resolved.linkedinUrl) {
    return {
      foundLinkedin: false,
      filteredOut: false,
      notFound: true,
      rejected: { cnpj: normalizeCnpj(input.cnpj), companyName: displayName, reason: resolved.reason },
    };
  }

  const linkedinUrl = resolved.linkedinUrl;
  const domain = domainFromUrl(input.site) ?? domainFromEmail(input.email);
  const shouldExtractCompany = request.quality !== 'baixa';
  const shouldSearchDecisionMakers = request.quality === 'alta' || request.quality === 'muito_alta';
  const companyProfile = shouldExtractCompany
    ? await cached(context.companyCache, linkedinUrl, () => context.workerLimit(() => extractCompany(
      linkedinUrl,
      onlyDigits(input.cnpj),
      displayName,
      { domain, city: input.cidade, uf: input.uf, cnae: input.cnae },
    )))
    : skippedCompanyProfile(linkedinUrl);
  const companyName = nonEmpty(companyProfile.name, input.nomeFantasia, input.razaoSocial, displayName) ?? displayName;
  const workerDomain = domain ?? domainFromUrl(companyProfile.website);
  const decisionResponse = shouldSearchDecisionMakers
    ? await cached(
      context.decisionCache,
      decisionCacheKey(companyName, linkedinUrl, workerDomain, request),
      () => context.workerLimit(() => searchDecisionMakers({
        companyName,
        linkedinUrl,
        domain: workerDomain,
        cnpj: onlyDigits(input.cnpj),
        keywords: request.keywords?.length ? request.keywords : DEFAULT_KEYWORDS,
        partnerNames: splitPartners(input.socios),
        maxResults: request.maxDecisionMakers ?? 8,
      })),
    )
    : skippedDecisionSearch();

  const decisionMakers = normalizeDecisionMakers(decisionResponse.decision_makers);
  const bestDecisionMaker = chooseBestDecisionMaker(decisionMakers);
  const baseLead = buildLeadBase({
    input,
    displayName,
    resolved: { ...resolved, linkedinUrl },
    companyProfile,
    decisionResponse,
    decisionMakers,
    bestDecisionMaker,
  });
  const classification = classifyLead(baseLead);
  const lead: EnrichedLead = { ...baseLead, ...classification };

  if (!includeBelowQuality && env.workerMode !== 'demo' && hasDemoEvidence(resolved, companyProfile.method_used, decisionMakers)) {
    return {
      foundLinkedin: Boolean(resolved.linkedinUrl),
      filteredOut: false,
      notFound: false,
      rejected: {
        cnpj: lead.cnpj,
        companyName: lead.companyName,
        reason: 'Evidencia demonstrativa nao e aceita quando o worker esta em modo real.',
      },
    };
  }

  if (includeBelowQuality || passesQualityFilter(lead.quality, request.quality)) {
    return { lead, foundLinkedin: true, filteredOut: false, notFound: false };
  }

  return {
    foundLinkedin: true,
    filteredOut: true,
    notFound: false,
    rejected: { cnpj: lead.cnpj, companyName: lead.companyName, reason: `Encontrado, mas qualidade ${lead.quality} abaixo de ${request.quality}.` },
  };
}

function enrichInput(input: CompanyInput, context: BatchContext): Promise<CompanyInput> {
  if (!shouldCallBrasilApi(input)) return Promise.resolve(input);
  return cached(context.brasilApiCache, companyInputCacheKey(input), () => enrichFromBrasilApi(input));
}

function shouldCallBrasilApi(input: CompanyInput): boolean {
  if (!env.brasilApiEnabled) return false;
  if (input.linkedinUrl) return false;

  const hasName = Boolean(nonEmpty(input.nomeFantasia, input.razaoSocial));
  const hasResolverContext = Boolean(nonEmpty(input.site, input.email));
  return !(hasName && hasResolverContext);
}

function createBatchContext(): BatchContext {
  return {
    brasilApiCache: new Map(),
    linkedinCache: new Map(),
    companyCache: new Map(),
    decisionCache: new Map(),
    workerLimit: createLimiter(env.workerConcurrency),
  };
}

function buildLeadBase(params: {
  input: CompanyInput;
  displayName: string;
  resolved: ResolveResult & { linkedinUrl: string };
  companyProfile: CompanyProfile;
  decisionResponse: DecisionSearchResult;
  decisionMakers: DecisionMaker[];
  bestDecisionMaker?: DecisionMaker;
}): Omit<EnrichedLead, 'quality' | 'score'> {
  const { input, displayName, resolved, companyProfile, decisionResponse, decisionMakers, bestDecisionMaker } = params;
  const companyName = nonEmpty(companyProfile.name, input.nomeFantasia, input.razaoSocial, displayName) ?? displayName;

  return {
    id: leadId(`${input.cnpj}-${resolved.linkedinUrl}`),
    cnpj: normalizeCnpj(input.cnpj),
    inputName: displayName,
    companyName,
    tradingName: input.nomeFantasia,
    linkedinUrl: resolved.linkedinUrl,
    linkedinProvider: resolved.provider,
    linkedinConfidence: resolved.confidence,
    linkedinReason: resolved.reason,
    website: nonEmpty(companyProfile.website, input.site),
    industry: companyProfile.industry,
    companySize: companyProfile.company_size,
    employeesMin: companyProfile.employees_min,
    employeesMax: companyProfile.employees_max,
    headquarters: companyProfile.headquarters,
    companyExtractionSuccess: companyProfile.success,
    companyExtractionMethod: companyProfile.method_used,
    city: input.cidade,
    state: input.uf,
    founded: companyProfile.founded,
    followers: companyProfile.followers,
    description: companyProfile.description,
    companyPhone: input.telefone,
    companyEmail: input.email,
    bestDecisionMaker,
    decisionMakers,
    evidence: [
      `LinkedIn resolvido por ${resolved.provider} (${resolved.confidence}%)`,
      ...(companyProfile.method_used && companyProfile.method_used !== 'skipped_by_quality' ? [`Company info via ${companyProfile.method_used}`] : []),
      ...(companyProfile.success === false && companyProfile.error ? [`Falha company extractor: ${companyProfile.error}`] : []),
      ...safeArray(decisionResponse.warnings),
    ],
    warnings: [
      ...(resolved.confidence < 80 ? ['Match da Company Page precisa de revisao manual.'] : []),
      ...(companyProfile.success === false && companyProfile.error ? [companyProfile.error] : []),
      ...safeArray(decisionResponse.warnings),
    ],
  };
}

function hasDemoEvidence(resolved: ResolveResult, method: string | undefined, decisionMakers: DecisionMaker[]): boolean {
  return isDemoValue(resolved.provider)
    || isDemoValue(resolved.reason)
    || isDemoValue(resolved.linkedinUrl)
    || isDemoValue(method)
    || decisionMakers.some((person) => isDemoValue(person.source) || isDemoValue(person.linkedin_url));
}

function isDemoValue(value: string | undefined): boolean {
  return /\bdemo\b/i.test(String(value ?? ''));
}

function normalizeDecisionMakers(decisionMakers: DecisionMaker[] | undefined): DecisionMaker[] {
  return safeArray(decisionMakers).map((person) => ({
    ...person,
    emails: uniq(person.emails ?? []),
    phones: uniq(person.phones ?? []),
  }));
}

function skippedCompanyProfile(linkedinUrl: string): CompanyProfile {
  return {
    success: true,
    linkedin_url: linkedinUrl,
    method_used: 'skipped_by_quality',
  };
}

function skippedDecisionSearch(): DecisionSearchResult {
  return {
    success: true,
    source: 'skipped_by_quality',
    decision_makers: [],
    warnings: [],
  };
}

function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

async function mapLimit<T, R>(items: T[], maxConcurrent: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, factory: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;

  const created = factory().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, created);
  return created;
}

function companyInputCacheKey(input: CompanyInput): string {
  return [
    onlyDigits(input.cnpj),
    input.razaoSocial,
    input.nomeFantasia,
    input.site,
    input.email,
    input.telefone,
    input.socios,
    input.linkedinUrl,
    input.cidade,
    input.uf,
    input.cnae,
  ].map((value) => String(value ?? '').trim().toLowerCase()).join('|');
}

function linkedinCacheKey(input: CompanyInput): string {
  if (input.linkedinUrl) return `url:${input.linkedinUrl.toLowerCase()}`;
  return [
    onlyDigits(input.cnpj),
    input.razaoSocial,
    input.nomeFantasia,
    input.site,
    input.email,
  ].map((value) => String(value ?? '').trim().toLowerCase()).join('|');
}

function decisionCacheKey(companyName: string, linkedinUrl: string, domain: string | undefined, request: BatchRequest): string {
  return [
    companyName,
    linkedinUrl,
    domain ?? '',
    request.maxDecisionMakers ?? 8,
    ...(request.keywords?.length ? request.keywords : DEFAULT_KEYWORDS),
  ].map((value) => String(value).trim().toLowerCase()).join('|');
}

function cleanInput(input: CompanyInput): CompanyInput {
  return {
    cnpj: onlyDigits(input.cnpj),
    razaoSocial: input.razaoSocial?.trim(),
    nomeFantasia: input.nomeFantasia?.trim(),
    site: input.site?.trim(),
    email: input.email?.trim(),
    telefone: input.telefone?.trim(),
    socios: input.socios?.trim(),
    linkedinUrl: input.linkedinUrl?.trim(),
    cidade: input.cidade?.trim(),
    uf: input.uf?.trim(),
    cnae: input.cnae?.trim(),
  };
}

function splitPartners(value: string | undefined): string[] {
  return String(value ?? '').split(/[;|\n]+/).map((item) => item.replace(/\s+-\s+.+$/, '').trim()).filter(Boolean);
}
