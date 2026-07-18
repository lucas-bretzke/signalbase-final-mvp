import { onlyDigits, uniq } from '../utils.js';
import { LeadSearchFilters } from './types.js';

export function normalizeCnae(value: string): string {
  return onlyDigits(value).slice(0, 7);
}

/** Normalization shared by every Receita source adapter. */
export function normalizeLeadSearchFilters(filters: LeadSearchFilters): LeadSearchFilters {
  return {
    ...filters,
    uf: filters.uf.trim().toUpperCase(),
    city: filters.city?.trim() || undefined,
    cnaes: uniq(filters.cnaes.map(normalizeCnae)).filter((cnae) => cnae.length === 7),
  };
}
