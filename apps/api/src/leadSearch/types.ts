import { DecisionMaker, EnrichedLead } from '../types.js';

export type LeadSearchStatus = 'queued' | 'processing' | 'completed' | 'exhausted' | 'failed';
export type LeadSearchResultStatus = 'valid' | 'rejected' | 'error';
export type CandidateCountStatus = 'exact' | 'lower_bound';

export interface LeadSearchFilters {
  uf: string;
  city?: string;
  cnaes: string[];
  targetQuantity: number;
  minScore: number;
  requirePhone: boolean;
  requireEmail: boolean;
  requireDecisionMakerMatch: boolean;
  onlyMobilePhone: boolean;
  onlyCorporateEmail: boolean;
  excludeGenericContacts: boolean;
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
  lastError?: string;
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
    'requirePhone' | 'requireEmail' | 'onlyMobilePhone' | 'onlyCorporateEmail' | 'excludeGenericContacts'>;
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

export interface LeadProcessor {
  process(search: LeadSearch, candidate: ReceitaCompany): Promise<LeadProcessingOutcome>;
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
  updateSearch(id: string, update: Partial<LeadSearch>): Promise<LeadSearch>;
  recordProcessed(searchId: string, result: LeadSearchResult, crossMatch?: LeadCrossMatch): Promise<LeadSearch>;
  getResult(searchId: string, resultId: string): Promise<LeadSearchResult | undefined>;
  listResults(searchId: string, options: LeadSearchResultRepositoryListOptions): Promise<RepositoryPage<LeadSearchResult>>;
  setResultSelected(searchId: string, resultId: string, selected: boolean): Promise<LeadSearchResult | undefined>;
  getCrossMatch(id: string | undefined): Promise<LeadCrossMatch | undefined>;
  getCrossMatches(ids: string[]): Promise<LeadCrossMatch[]>;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
