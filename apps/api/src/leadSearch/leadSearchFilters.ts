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
  return {
    ...filters,
    uf: filters.uf.trim().toUpperCase(),
    city: filters.city?.trim() || undefined,
    cnaes: uniq(filters.cnaes.map(normalizeCnae)).filter((cnae) => cnae.length === 7),
    targetQuantity: targetMode === 'max' ? 0 : filters.targetQuantity,
    targetMode,
    emailType,
    onlyCorporateEmail: emailType === 'corporate',
  };
}
