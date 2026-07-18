import crypto from 'node:crypto';
import he from 'he';

export function onlyDigits(value: string | undefined | null): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeCnpj(value: string | undefined | null): string {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return digits;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const clean = String(value ?? '').trim();
    if (clean) return clean;
  }
  return undefined;
}

export function domainFromUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return undefined;
  }
}

export function domainFromEmail(value: string | undefined | null): string | undefined {
  const email = String(value ?? '').trim().toLowerCase();
  const match = email.match(/@([^\s>]+)$/);
  if (!match) return undefined;
  const domain = match[1].replace(/[),.;]+$/, '');
  if (['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'uol.com.br', 'bol.com.br'].includes(domain)) return undefined;
  return domain;
}

export function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

export function leadId(seed: string): string {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

export function decodeHtml(value: string): string {
  return he.decode(value).replace(/\s+/g, ' ').trim();
}

export function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
