import { DecisionMaker, EnrichedLead, LeadQualityLevel } from '../types.js';

export type LeadSearchStatus = 'queued' | 'processing' | 'paused' | 'blocked' | 'completed' | 'exhausted' | 'failed';
export type LeadSearchResultStatus = 'valid' | 'rejected' | 'error';
export type CandidateCountStatus = 'exact' | 'lower_bound';
export type EmailTypeFilter = 'any' | 'corporate' | 'non_corporate';
export type LeadSearchTargetMode = 'fixed' | 'max';
export type LeadSearchCompletionReason = 'target_reached' | 'candidate_pool_exhausted';
export type MatchConfidenceLevel = 'normal' | 'alta' | 'muito_alta';
export type LinkedinEvidenceLevel = 'none' | 'demo' | 'url_only' | 'company_data' | 'real_company_data';
export type ContactEvidenceLevel = 'none' | 'demo' | 'company_contact' | 'decision_maker_contact' | 'named_decision_maker_contact';

export interface LeadSearchFilters {
  uf: string;
  city?: string;
  cnaes: string[];
  targetQuantity: number;
  targetMode: LeadSearchTargetMode;
  minScore: number;
  minQuality?: LeadQualityLevel;
  requirePhone: boolean;
  requireEmail: boolean;
  requireDecisionMakerMatch: boolean;
  onlyMobilePhone: boolean;
  emailType: EmailTypeFilter;
  onlyCorporateEmail: boolean;
  excludeGenericContacts: boolean;
  requireRealLinkedin?: boolean;
  requireLinkedinCompanyData?: boolean;
  requireRealDecisionMaker?: boolean;
  requireDecisionMakerProfile?: boolean;
  requireDecisionMakerContact?: boolean;
  requireNamedEmail?: boolean;
  requireDecisionMakerPhone?: boolean;
  matchConfidenceLevel?: MatchConfidenceLevel;
}

export interface LeadSearch extends LeadSearchFilters {
  id: string;
  status: LeadSearchStatus;
  totalCandidatesFound: number;
  candidateCountStatus?: CandidateCountStatus;
  totalProcessed: number;
  totalValidLeads: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  completionReason?: LeadSearchCompletionReason;
  lastError?: string;
  blockReason?: string;
  sourceSearchId?: string;
  reprocessedBySearchId?: string;
}

export interface ReceitaCompany {
  cnpj: string;
  legalName: string;
  tradingName?: string;
  city: string;
  uf: string;
  cnae: string;
  partners: string[];
  email?: string;
  phone?: string;
  website?: string;
  linkedinUrl?: string;
}

export interface DecisionMakerMatch {
  matched: boolean;
  confidence: number;
  partnerName?: string;
  decisionMakerName?: string;
  explanation: string;
}

export interface LeadCrossMatch {
  id: string;
  cnpj: string;
  companyName: string;
  tradingName?: string;
  city: string;
  uf: string;
  cnae: string;
  partners: string[];
  companyLinkedinUrl: string;
  companyWebsite?: string;
  company: {
    cnpj: string;
    legalName: string;
    tradeName?: string;
    city: string;
    uf: string;
    primaryCnae: string;
    partners: string[];
    linkedinUrl: string;
    website?: string;
  };
  decisionMaker?: DecisionMaker;
  decisionMakerMatch: DecisionMakerMatch;
  decisionMakerMatched: boolean;
  finalEmail?: string;
  finalPhone?: string;
  emailValidated: boolean;
  phoneValidated: boolean;
  emailCorporate: boolean;
  emailGeneric: boolean;
  phoneMobile: boolean;
  emailSource?: 'decision_maker' | 'receita';
  phoneSource?: 'decision_maker' | 'receita';
  linkedinEvidenceLevel: LinkedinEvidenceLevel;
  contactEvidenceLevel: ContactEvidenceLevel;
  isDemoEvidence: boolean;
  emailNameMatched: boolean;
  finalScore: number;
  evidence: string[];
  warnings: string[];
  enrichedLead: EnrichedLead;
  createdAt: string;
  updatedAt: string;
}

export interface LeadSearchResult {
  id: string;
  leadSearchId: string;
  cnpj: string;
  leadCrossMatchId?: string;
  finalScore: number;
  status: LeadSearchResultStatus;
  selected: boolean;
  candidate: ReceitaCompany;
  rejectionReasons: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadSearchProgress extends LeadSearch {
  remainingQuantity: number;
  candidatesRemaining: number;
  yieldRate: number;
  progressPercent: number;
  candidateProgressPercent: number;
}

export interface LeadSearchResultView extends LeadSearchResult {
  lead?: LeadCrossMatch;
  leadCrossMatch?: LeadCrossMatch;
  companyName: string;
  tradingName?: string;
  city: string;
  uf: string;
  cnae: string;
  partner?: string;
  finalEmail?: string;
  finalPhone?: string;
  decisionMakerMatched: boolean;
}

export interface LeadSearchDatabase {
  schemaVersion: 1;
  searches: LeadSearch[];
  results: LeadSearchResult[];
  crossMatches: LeadCrossMatch[];
}

export interface CandidateQuery {
  uf: string;
  city?: string;
  cnaes: string[];
  offset: number;
  limit: number;
  preferences?: Pick<LeadSearchFilters,
    'requirePhone' | 'requireEmail' | 'onlyMobilePhone' | 'emailType' | 'onlyCorporateEmail' | 'excludeGenericContacts'>;
}

export interface ReceitaCompanySource {
  candidateCountStrategy?: 'eager' | 'streaming';
  initialize?(): Promise<void>;
  count(query: Omit<CandidateQuery, 'offset' | 'limit'>): Promise<number>;
  find(query: CandidateQuery): Promise<ReceitaCompany[]>;
  metadata?(): Promise<ReceitaSourceMetadata>;
  close?(): Promise<void>;
}

export interface ReceitaSourceMetadata {
  kind: 'csv' | 'sqlite' | 'postgres';
  readOnly: boolean;
  location?: string;
  referenceDate?: string;
  declaredCnpjCount?: number;
  sqliteVersion?: string;
  optimizedSearchIndex?: boolean;
  warning?: string;
}

export interface LeadProcessingOutcome {
  result: LeadSearchResult;
  crossMatch?: LeadCrossMatch;
}

export interface LeadProcessingContext {
  signal?: AbortSignal;
  requestId?: string;
  deadline?: number;
}

export interface LeadProcessor {
  process(search: LeadSearch, candidate: ReceitaCompany, context?: LeadProcessingContext): Promise<LeadProcessingOutcome>;
}

export interface RepositoryPage<T> {
  items: T[];
  total: number;
}

export interface LeadSearchRepositoryListOptions {
  offset: number;
  limit: number;
  statuses?: LeadSearchStatus[];
}

export interface RecordProcessedOptions {
  expectedStatus?: LeadSearchStatus;
  signal?: AbortSignal;
}

export interface LeadSearchResultRepositoryListOptions {
  offset: number;
  limit: number;
  status?: LeadSearchResultStatus;
  selected?: boolean;
}

export interface LeadSearchRepository {
  initialize(): Promise<void>;
  createSearch(search: LeadSearch): Promise<LeadSearch>;
  getSearch(id: string): Promise<LeadSearch | undefined>;
  listSearches(options: LeadSearchRepositoryListOptions): Promise<RepositoryPage<LeadSearch>>;
  updateSearch(id: string, update: Partial<LeadSearch> | ((search: LeadSearch) => void)): Promise<LeadSearch>;
  deleteSearch(id: string): Promise<boolean>;
  recordProcessed(
    searchId: string,
    result: LeadSearchResult,
    crossMatch?: LeadCrossMatch,
    options?: RecordProcessedOptions,
  ): Promise<LeadSearch>;
  getResult(searchId: string, resultId: string): Promise<LeadSearchResult | undefined>;
  listResults(searchId: string, options: LeadSearchResultRepositoryListOptions): Promise<RepositoryPage<LeadSearchResult>>;
  setResultSelected(searchId: string, resultId: string, selected: boolean): Promise<LeadSearchResult | undefined>;
  getCrossMatch(id: string | undefined): Promise<LeadCrossMatch | undefined>;
  getCrossMatches(ids: string[]): Promise<LeadCrossMatch[]>;
  invalidateUntrustedResults(reason: string): Promise<{ invalidated: number; affectedSearchIds: string[] }>;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
