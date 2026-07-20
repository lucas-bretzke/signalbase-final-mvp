export type LeadSearchStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED'
  | string;

export type LeadResultStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'VALID'
  | 'REJECTED'
  | 'FAILED'
  | string;

export type EmailTypeFilter = 'any' | 'corporate' | 'non_corporate';
export type LeadSearchTargetMode = 'fixed' | 'max';
export type LeadSearchCompletionReason = 'target_reached' | 'candidate_pool_exhausted';

export interface CreateLeadSearchInput {
  uf: string;
  city?: string;
  cnaes: string[];
  targetQuantity: number | 'max';
  targetMode?: LeadSearchTargetMode;
  minScore?: number;
  requirePhone: boolean;
  requireEmail: boolean;
  requireDecisionMakerMatch: boolean;
  onlyMobilePhone: boolean;
  emailType: EmailTypeFilter;
  onlyCorporateEmail: boolean;
  excludeGenericContacts: boolean;
}

export interface LeadSearch extends Omit<CreateLeadSearchInput, 'targetQuantity' | 'targetMode'> {
  id: string;
  targetQuantity: number;
  targetMode: LeadSearchTargetMode;
  completionReason?: LeadSearchCompletionReason;
  status: LeadSearchStatus;
  totalCandidatesFound: number;
  candidateCountStatus?: 'exact' | 'lower_bound';
  totalProcessed: number;
  totalValidLeads: number;
  remainingQuantity?: number;
  yieldRate?: number;
  progressPercent?: number;
  candidateProgressPercent?: number;
  currentStage?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySnapshot {
  cnpj?: string;
  legalName?: string;
  razaoSocial?: string;
  tradeName?: string;
  nomeFantasia?: string;
  city?: string;
  cidade?: string;
  uf?: string;
  cnae?: string;
  primaryCnae?: string;
  partner?: string;
  socio?: string;
  linkedinUrl?: string;
  linkedinCompanyUrl?: string;
  website?: string;
  industry?: string;
}

export interface DecisionMakerSnapshot {
  name?: string;
  title?: string;
  role?: string;
  linkedinUrl?: string;
  linkedin_url?: string;
  matchedPartner?: boolean;
  matchScore?: number;
}

export interface LeadCrossMatchSnapshot {
  id?: string;
  company?: CompanySnapshot;
  companyName?: string;
  tradingName?: string;
  city?: string;
  uf?: string;
  cnae?: string;
  partnerName?: string;
  socio?: string;
  decisionMaker?: DecisionMakerSnapshot;
  bestDecisionMaker?: DecisionMakerSnapshot;
  finalEmail?: string;
  finalPhone?: string;
  validatedEmail?: string;
  validatedPhone?: string;
  linkedinCompanyUrl?: string;
  companyLinkedinUrl?: string;
  linkedinUrl?: string;
  companyWebsite?: string;
  partners?: string[];
  decisionMakerMatch?: {
    matched?: boolean;
    confidence?: number;
    partnerName?: string;
    decisionMakerName?: string;
    explanation?: string;
  };
  decisionMakerMatched?: boolean;
  emailValidated?: boolean;
  phoneValidated?: boolean;
  emailCorporate?: boolean;
  emailGeneric?: boolean;
  phoneMobile?: boolean;
  emailSource?: string;
  phoneSource?: string;
  evidence?: Array<string | EvidenceItem>;
  explanations?: string[];
  warnings?: string[];
  score?: number;
  finalScore?: number;
  confidenceScore?: number;
}

export interface EvidenceItem {
  label?: string;
  source?: string;
  value?: string;
  detail?: string;
  url?: string;
  confidence?: number;
}

export interface LeadSearchResult {
  id: string;
  leadSearchId: string;
  cnpj: string;
  leadCrossMatchId?: string;
  finalScore?: number;
  status: LeadResultStatus;
  selected: boolean;
  createdAt: string;
  updatedAt?: string;
  lead?: LeadCrossMatchSnapshot;
  leadCrossMatch?: LeadCrossMatchSnapshot;
  candidate?: {
    cnpj?: string;
    legalName?: string;
    tradingName?: string;
    city?: string;
    uf?: string;
    cnae?: string;
    partners?: string[];
    email?: string;
    phone?: string;
    website?: string;
    linkedinUrl?: string;
  };
  companyName?: string;
  tradingName?: string;
  city?: string;
  uf?: string;
  cnae?: string;
  partner?: string;
  finalEmail?: string;
  finalPhone?: string;
  decisionMakerMatched?: boolean;
  rejectionReasons?: string[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LeadSearchListParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export interface LeadResultListParams extends LeadSearchListParams {
  selected?: boolean;
}

export interface ExportDownload {
  blob: Blob;
  filename: string;
}
