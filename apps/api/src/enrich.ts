import { enrichFromBrasilApi } from './brasilApi.js';
import { env } from './env.js';
import { ResolveResult, resolveLinkedInUrl } from './linkedinResolver.js';
import { chooseBestDecisionMaker, classifyLead, passesQualityFilter } from './scoring.js';
import { BatchRequest, CompanyInput, CompanyProfile, DecisionMaker, EnrichedLead, EnrichResponse, LeadQualityLevel, QualityFilter, WorkerErrorCode, WorkerRequestOptions } from './types.js';
import { domainFromEmail, domainFromUrl, leadId, nonEmpty, normalizeCnpj, normalizeKey, onlyDigits, safeArray, uniq } from './utils.js';
import { isCorporateEmail, isGenericEmail, isMobilePhone, isValidEmail, isValidPhone, splitContactValues } from './leadSearch/contactValidation.js';
import { extractCompany, LinkedinBlockingError, searchDecisionMakers, WorkerClientError } from './workerClient.js';

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

export interface DecisionMakerSearchInput {
  minQuality: LeadQualityLevel;
  requireEmail?: boolean;
  requirePhone?: boolean;
  onlyMobilePhone?: boolean;
  emailType?: 'any' | 'corporate' | 'non_corporate';
  excludeGenericContacts?: boolean;
  requireNamedEmail?: boolean;
  requireDecisionMakerMatch?: boolean;
  requireRealDecisionMaker?: boolean;
  requireDecisionMakerProfile?: boolean;
  requireDecisionMakerContact?: boolean;
  requireDecisionMakerPhone?: boolean;
}

export interface DecisionMakerSearchEvidence {
  hasValidContact?: boolean;
  hasValidEmail?: boolean;
  hasValidPhone?: boolean;
  hasMobilePhone?: boolean;
  hasCorporateEmail?: boolean;
  hasNonCorporateEmail?: boolean;
  hasNonGenericEmail?: boolean;
  hasGenericEmail?: boolean;
  hasVerifiedCompanyData?: boolean;
  hasNamedPartnerEmail?: boolean;
}

export interface EnrichCompanyOptions extends Pick<BatchRequest, 'maxDecisionMakers' | 'keywords'>,
  Partial<Omit<DecisionMakerSearchInput, 'minQuality'>>, WorkerRequestOptions {
  minQuality?: LeadQualityLevel;
}

interface EnrichmentRequest extends BatchRequest {
  decisionMakerSearch?: DecisionMakerSearchInput;
  workerOptions?: WorkerRequestOptions;
}

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
  options: EnrichCompanyOptions = {},
): Promise<LeadResult> {
  const minQuality = options.minQuality ?? 'muito_alto';
  return enrichOne(input, {
    rows: [input],
    quality: qualityFilterFromMinQuality(minQuality),
    maxDecisionMakers: options.maxDecisionMakers ?? 8,
    keywords: options.keywords,
    decisionMakerSearch: {
      minQuality,
      requireEmail: options.requireEmail,
      requirePhone: options.requirePhone,
      onlyMobilePhone: options.onlyMobilePhone,
      emailType: options.emailType,
      excludeGenericContacts: options.excludeGenericContacts,
      requireNamedEmail: options.requireNamedEmail,
      requireDecisionMakerMatch: options.requireDecisionMakerMatch,
      requireRealDecisionMaker: options.requireRealDecisionMaker,
      requireDecisionMakerProfile: options.requireDecisionMakerProfile,
      requireDecisionMakerContact: options.requireDecisionMakerContact,
      requireDecisionMakerPhone: options.requireDecisionMakerPhone,
    },
    workerOptions: {
      signal: options.signal,
      requestId: options.requestId,
      deadline: options.deadline,
    },
  }, createBatchContext(), true);
}

export function shouldSearchDecisionMakers(
  input: DecisionMakerSearchInput,
  currentEvidence: DecisionMakerSearchEvidence = {},
): boolean {
  const hasExplicitRequirement = Boolean(
    input.requireDecisionMakerMatch
    || input.requireRealDecisionMaker
    || input.requireDecisionMakerProfile
    || input.requireDecisionMakerContact
    || input.requireDecisionMakerPhone,
  );
  if (hasExplicitRequirement) return true;

  const hasUnmetContactRequirement = Boolean(
    (input.requireEmail && !currentEvidence.hasValidEmail)
    || (input.requirePhone && !currentEvidence.hasValidPhone)
    || (input.onlyMobilePhone && !currentEvidence.hasMobilePhone)
    || (input.emailType === 'corporate' && !currentEvidence.hasCorporateEmail)
    || (input.emailType === 'non_corporate' && !currentEvidence.hasNonCorporateEmail)
    || (input.excludeGenericContacts
      && currentEvidence.hasGenericEmail
      && !currentEvidence.hasNonGenericEmail
      && !currentEvidence.hasValidPhone)
    || (input.requireNamedEmail && !currentEvidence.hasNamedPartnerEmail)
  );
  if (hasUnmetContactRequirement || input.minQuality === 'muito_alto') return true;
  if (input.minQuality === 'baixo' || input.minQuality === 'medio') return false;

  const hasSufficientEvidence = Boolean(currentEvidence.hasValidContact)
    && Boolean(currentEvidence.hasVerifiedCompanyData || currentEvidence.hasNamedPartnerEmail);
  return !hasSufficientEvidence;
}

async function enrichOne(
  rawInput: CompanyInput,
  request: EnrichmentRequest,
  context: BatchContext,
  includeBelowQuality = false,
): Promise<LeadResult> {
  const cleaned = cleanInput(rawInput);
  const input = await enrichInput(cleaned, context);
  const displayName = nonEmpty(input.nomeFantasia, input.razaoSocial, input.cnpj) ?? input.cnpj;
  const resolved = await cached(context.linkedinCache, linkedinCacheKey(input), () => resolveLinkedInUrl(input, request.workerOptions));

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
  const companyProfile = shouldExtractCompany
    ? await cached(context.companyCache, linkedinUrl, () => context.workerLimit(() => extractCompany(
      linkedinUrl,
      onlyDigits(input.cnpj),
      displayName,
      { domain, city: input.cidade, uf: input.uf, cnae: input.cnae },
      request.workerOptions,
    )))
    : skippedCompanyProfile(linkedinUrl);
  assertInfrastructureResult(companyProfile, 'Falha de infraestrutura durante a extracao da empresa.');
  const decisionSearchInput = request.decisionMakerSearch ?? {
    minQuality: minQualityFromQualityFilter(request.quality),
  };
  const needsDecisionMakers = shouldSearchDecisionMakers(
    decisionSearchInput,
    decisionMakerSearchEvidence(input, companyProfile),
  );
  const companyName = nonEmpty(companyProfile.name, input.nomeFantasia, input.razaoSocial, displayName) ?? displayName;
  const workerDomain = domain ?? domainFromUrl(companyProfile.website);
  const decisionResponse = needsDecisionMakers
    ? await cached(
      context.decisionCache,
      decisionCacheKey(companyName, linkedinUrl, workerDomain, input, request),
      () => context.workerLimit(() => searchDecisionMakers({
        companyName,
        linkedinUrl,
        domain: workerDomain,
        cnpj: onlyDigits(input.cnpj),
        keywords: request.keywords?.length ? request.keywords : DEFAULT_KEYWORDS,
        partnerNames: splitPartners(input.socios),
        maxResults: request.maxDecisionMakers ?? 8,
      }, request.workerOptions)),
    )
    : skippedDecisionSearch();

  assertDecisionSearchResult(decisionResponse);

  const decisionMakers = normalizeDecisionMakers(decisionResponse.decision_makers)
    .filter((person) => env.workerMode === 'demo' || person.associationVerified === true);
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

function decisionCacheKey(
  companyName: string,
  linkedinUrl: string,
  domain: string | undefined,
  input: CompanyInput,
  request: BatchRequest,
): string {
  return [
    companyName,
    linkedinUrl,
    domain ?? '',
    onlyDigits(input.cnpj),
    ...splitPartners(input.socios),
    request.maxDecisionMakers ?? 8,
    ...(request.keywords?.length ? request.keywords : DEFAULT_KEYWORDS),
  ].map((value) => String(value).trim().toLowerCase()).join('|');
}

function qualityFilterFromMinQuality(value: LeadQualityLevel): QualityFilter {
  if (value === 'muito_alto') return 'muito_alta';
  if (value === 'alto') return 'alta';
  if (value === 'medio') return 'normal';
  return 'baixa';
}

function minQualityFromQualityFilter(value: QualityFilter): LeadQualityLevel {
  if (value === 'muito_alta') return 'muito_alto';
  if (value === 'alta') return 'alto';
  if (value === 'normal') return 'medio';
  return 'baixo';
}

function decisionMakerSearchEvidence(input: CompanyInput, companyProfile: CompanyProfile): DecisionMakerSearchEvidence {
  const validEmails = splitContactValues(input.email).filter(isValidEmail);
  const validPhones = splitContactValues(input.telefone).filter(isValidPhone);
  const hasNonGenericEmail = validEmails.some((email) => !isGenericEmail(email));
  const hasValidContact = hasNonGenericEmail || validPhones.length > 0;

  return {
    hasValidContact,
    hasValidEmail: validEmails.length > 0,
    hasValidPhone: validPhones.length > 0,
    hasMobilePhone: validPhones.some(isMobilePhone),
    hasCorporateEmail: validEmails.some(isCorporateEmail),
    hasNonCorporateEmail: validEmails.some((email) => !isCorporateEmail(email)),
    hasNonGenericEmail,
    hasGenericEmail: validEmails.some(isGenericEmail),
    hasVerifiedCompanyData: hasVerifiedCompanyData(companyProfile),
    hasNamedPartnerEmail: validEmails.some((email) => !isGenericEmail(email) && emailMatchesPartner(email, splitPartners(input.socios))),
  };
}

function hasVerifiedCompanyData(profile: CompanyProfile): boolean {
  if (!profile.success || !profile.method_used || profile.method_used === 'skipped_by_quality') return false;
  if (['worker_error', 'unavailable', 'real_exception'].includes(profile.method_used)) return false;
  if (env.workerMode !== 'demo' && isDemoValue(profile.method_used)) return false;
  return Boolean(
    profile.industry
    || profile.company_size
    || profile.employees_min
    || profile.employees_max
    || profile.headquarters
    || profile.followers
    || profile.description,
  );
}

function emailMatchesPartner(email: string, partnerNames: string[]): boolean {
  const localPart = normalizeKey(email.split('@')[0] ?? '').replace(/\s+/g, '');
  return partnerNames.some((partnerName) => {
    const tokens = significantNameTokens(partnerName);
    return tokens.length >= 2 && localPart.includes(tokens[0]) && localPart.includes(tokens[tokens.length - 1]);
  });
}

function significantNameTokens(value: string): string[] {
  const ignored = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'filho', 'junior', 'neto']);
  return normalizeKey(value).split(' ').filter((token) => token.length > 1 && !ignored.has(token));
}

function assertDecisionSearchResult(result: DecisionSearchResult): void {
  if (result.success || isFunctionalDecisionError(result.errorCode)) return;
  if (!result.errorCode && result.source !== 'worker_error') return;

  const message = result.warnings?.[0] ?? 'Falha de infraestrutura durante a busca de decisores.';
  throwTypedWorkerError(result.errorCode ?? 'network_error', message);
}

function assertInfrastructureResult(
  result: { success: boolean; errorCode?: WorkerErrorCode; error?: string },
  fallbackMessage: string,
): void {
  if (result.success || !result.errorCode || isFunctionalWorkerError(result.errorCode)) return;
  throwTypedWorkerError(result.errorCode, result.error ?? fallbackMessage);
}

function throwTypedWorkerError(code: WorkerErrorCode, message: string): never {
  if (isBlockingWorkerError(code)) throw new LinkedinBlockingError(code, message);
  throw new WorkerClientError(code, message);
}

function isBlockingWorkerError(code: WorkerErrorCode): boolean {
  return code === 'auth_required' || code === 'challenge' || code === 'wrong_worker' || code === 'worker_unavailable';
}

function isFunctionalDecisionError(code: WorkerErrorCode | undefined): boolean {
  return code === 'no_verified_match'
    || code === 'no_verified_decision_maker'
    || code === 'contact_not_available'
    || code === 'rejected_by_filters';
}

function isFunctionalWorkerError(code: WorkerErrorCode): boolean {
  return code === 'no_company_candidate' || code === 'company_not_verified' || isFunctionalDecisionError(code);
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
