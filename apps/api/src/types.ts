export type QualityFilter = 'baixa' | 'normal' | 'alta' | 'muito_alta';
export type LeadQualityLevel = 'baixo' | 'medio' | 'alto' | 'muito_alto';

export interface CompanyInput {
  cnpj: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  site?: string;
  email?: string;
  telefone?: string;
  socios?: string;
  linkedinUrl?: string;
  cidade?: string;
  uf?: string;
  cnae?: string;
}

export interface BatchRequest {
  rows: CompanyInput[];
  quality: QualityFilter;
  maxDecisionMakers?: number;
  keywords?: string[];
}

export interface CompanyProfile {
  success: boolean;
  linkedin_url?: string;
  name?: string;
  description?: string;
  website?: string;
  industry?: string;
  company_size?: string;
  employees_min?: number;
  employees_max?: number;
  headquarters?: string;
  founded?: string;
  followers?: string;
  method_used?: string;
  error?: string;
}

export interface DecisionMaker {
  name: string;
  title: string;
  location?: string;
  linkedin_url?: string;
  emails: string[];
  phones: string[];
  confidence: number;
  source: string;
  matched_keyword?: string;
  partner_match?: boolean;
  matched_partner_name?: string;
  partner_match_confidence?: number;
}

export interface EnrichedLead {
  id: string;
  cnpj: string;
  inputName: string;
  companyName: string;
  tradingName?: string;
  linkedinUrl: string;
  linkedinProvider?: string;
  linkedinConfidence?: number;
  linkedinReason?: string;
  website?: string;
  industry?: string;
  companySize?: string;
  employeesMin?: number;
  employeesMax?: number;
  headquarters?: string;
  companyExtractionSuccess?: boolean;
  companyExtractionMethod?: string;
  city?: string;
  state?: string;
  founded?: string;
  followers?: string;
  description?: string;
  companyPhone?: string;
  companyEmail?: string;
  bestDecisionMaker?: DecisionMaker;
  decisionMakers: DecisionMaker[];
  quality: QualityFilter;
  score: number;
  evidence: string[];
  warnings: string[];
}

export interface EnrichResponse {
  totalInput: number;
  foundLinkedin: number;
  returned: number;
  filteredOut: number;
  notFound: number;
  quality: QualityFilter;
  provider: string;
  mode: string;
  leads: EnrichedLead[];
  rejected: Array<{ cnpj: string; companyName: string; reason: string }>;
  warnings: string[];
}
