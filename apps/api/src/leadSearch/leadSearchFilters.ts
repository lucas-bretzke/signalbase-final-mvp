import { onlyDigits, uniq } from '../utils.js';
import { LeadSearchFilters } from './types.js';

export function normalizeCnae(value: string): string {
  return onlyDigits(value).slice(0, 7);
}

/** Normalization shared by every Receita source adapter. */
export function normalizeLeadSearchFilters(filters: LeadSearchFilters): LeadSearchFilters {
  const emailType = filters.emailType && !(filters.emailType === 'any' && filters.onlyCorporateEmail)
    ? filters.emailType
    : filters.onlyCorporateEmail ? 'corporate' : 'any';
  const targetMode = filters.targetMode ?? 'fixed';
  const minQuality = filters.minQuality ?? minQualityFromScore(filters.minScore ?? 0);
  return {
    ...filters,
    uf: filters.uf.trim().toUpperCase(),
    city: filters.city?.trim() || undefined,
    cnaes: uniq(filters.cnaes.map(normalizeCnae)).filter((cnae) => cnae.length === 7),
    targetQuantity: targetMode === 'max' ? 0 : filters.targetQuantity,
    targetMode,
    minScore: filters.minQuality ? scoreFromMinQuality(minQuality) : filters.minScore ?? scoreFromMinQuality(minQuality),
    minQuality,
    emailType,
    onlyCorporateEmail: emailType === 'corporate',
    requireRealLinkedin: filters.requireRealLinkedin ?? false,
    requireLinkedinCompanyData: filters.requireLinkedinCompanyData ?? false,
    requireRealDecisionMaker: filters.requireRealDecisionMaker ?? false,
    requireDecisionMakerProfile: filters.requireDecisionMakerProfile ?? false,
    requireDecisionMakerContact: filters.requireDecisionMakerContact ?? false,
    requireNamedEmail: filters.requireNamedEmail ?? false,
    requireDecisionMakerPhone: filters.requireDecisionMakerPhone ?? false,
    matchConfidenceLevel: filters.matchConfidenceLevel ?? 'normal',
  };
}

export function minQualityFromScore(score: number): NonNullable<LeadSearchFilters['minQuality']> {
  if (score >= 85) return 'muito_alto';
  if (score >= 70) return 'alto';
  if (score >= 50) return 'medio';
  return 'baixo';
}

export function scoreFromMinQuality(value: NonNullable<LeadSearchFilters['minQuality']>): number {
  if (value === 'muito_alto') return 85;
  if (value === 'alto') return 70;
  if (value === 'medio') return 50;
  return 0;
}
