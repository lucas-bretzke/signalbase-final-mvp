import { domainFromEmail, normalizeKey, onlyDigits, uniq } from '../utils.js';

const GENERIC_EMAIL_LOCALS = new Set([
  'admin', 'administrativo', 'atendimento', 'comercial', 'contato', 'contact', 'financeiro',
  'geral', 'hello', 'info', 'marketing', 'office', 'recepcao', 'sac', 'sales', 'suporte', 'vendas',
]);

export function splitContactValues(value: string | undefined): string[] {
  return uniq(String(value ?? '').split(/[;|\n]+/).map((item) => item.trim()).filter(Boolean));
}

export function isValidEmail(value: string | undefined): boolean {
  const clean = String(value ?? '').trim().toLowerCase();
  return clean.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(clean);
}

export function isCorporateEmail(value: string | undefined): boolean {
  return isValidEmail(value) && Boolean(domainFromEmail(value));
}

export function isGenericEmail(value: string | undefined): boolean {
  if (!isValidEmail(value)) return false;
  const local = normalizeKey(String(value).split('@')[0]).replace(/\s+/g, '');
  return GENERIC_EMAIL_LOCALS.has(local) || [...GENERIC_EMAIL_LOCALS].some((term) => local.startsWith(`${term}.`) || local.startsWith(`${term}-`));
}

export function brazilianNationalPhone(value: string | undefined): string {
  const digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits.slice(2);
  return digits;
}

export function isValidPhone(value: string | undefined): boolean {
  const digits = brazilianNationalPhone(value);
  if (digits.length !== 10 && digits.length !== 11) return false;
  const areaCode = Number(digits.slice(0, 2));
  if (areaCode < 11 || areaCode > 99) return false;
  return !/^(\d)\1+$/.test(digits);
}

export function isMobilePhone(value: string | undefined): boolean {
  const digits = brazilianNationalPhone(value);
  return isValidPhone(value) && digits.length === 11 && digits[2] === '9';
}

export function nameSimilarity(left: string, right: string): number {
  const a = significantNameTokens(left);
  const b = significantNameTokens(right);
  if (!a.length || !b.length) return 0;
  const intersection = a.filter((token) => b.includes(token));
  const union = new Set([...a, ...b]);
  const jaccard = intersection.length / union.size;
  const coverage = intersection.length / Math.min(a.length, b.length);
  return Math.round(Math.max(jaccard, coverage * 0.9) * 100);
}

function significantNameTokens(value: string): string[] {
  const ignored = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'filho', 'junior', 'neto']);
  return normalizeKey(value).split(' ').filter((token) => token.length > 1 && !ignored.has(token));
}
