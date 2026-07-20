import fs from 'node:fs/promises';
import { normalizeKey, onlyDigits, uniq } from '../utils.js';
import { isCorporateEmail, isGenericEmail, isMobilePhone, isValidEmail, isValidPhone } from './contactValidation.js';
import { normalizeCnae } from './leadSearchFilters.js';
import { CandidateQuery, ReceitaCompany, ReceitaCompanySource, ReceitaSourceMetadata } from './types.js';

type CsvRecord = Record<string, string>;

export class CsvReceitaCompanySource implements ReceitaCompanySource {
  private cached?: { modifiedAt: number; rows: ReceitaCompany[] };

  constructor(private readonly csvPath: string) {}

  async metadata(): Promise<ReceitaSourceMetadata> {
    return {
      kind: 'csv',
      readOnly: true,
      location: this.csvPath,
      warning: 'Fonte CSV indicada para demonstracao e testes; a base nacional deve usar SQLite ou PostgreSQL.',
    };
  }

  async count(query: Omit<CandidateQuery, 'offset' | 'limit'>): Promise<number> {
    return (await this.matching(query)).length;
  }

  async find(query: CandidateQuery): Promise<ReceitaCompany[]> {
    const matches = await this.matching(query);
    return matches.slice(query.offset, query.offset + query.limit).map(clone);
  }

  private async matching(query: Omit<CandidateQuery, 'offset' | 'limit'>): Promise<ReceitaCompany[]> {
    const rows = await this.load();
    const uf = query.uf.trim().toUpperCase();
    const city = query.city ? normalizeKey(query.city) : undefined;
    const cnaes = new Set(query.cnaes.map(normalizeCnae));
    return rows
      .filter((row) => row.uf === uf && (!city || normalizeKey(row.city) === city) && cnaes.has(row.cnae))
      .sort((left, right) => candidatePriority(right, query.preferences) - candidatePriority(left, query.preferences)
        || left.cnpj.localeCompare(right.cnpj));
  }

  private async load(): Promise<ReceitaCompany[]> {
    const stat = await fs.stat(this.csvPath);
    if (this.cached?.modifiedAt === stat.mtimeMs) return this.cached.rows;

    const content = await fs.readFile(this.csvPath, 'utf8');
    const records = parseCsv(content);
    const byCnpj = new Map<string, ReceitaCompany>();
    for (const record of records) {
      if (!isActiveCompany(record)) continue;
      const company = recordToCompany(record);
      if (!company) continue;
      byCnpj.set(company.cnpj, company);
    }
    const rows = [...byCnpj.values()];
    this.cached = { modifiedAt: stat.mtimeMs, rows };
    return rows;
  }
}

export function parseCsv(content: string): CsvRecord[] {
  const clean = content.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = delimiterCount(firstLine, ';') > delimiterCount(firstLine, ',') ? ';' : ',';
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '"') {
      if (quoted && clean[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) matrix.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) matrix.push(row);
  if (matrix.length < 2) return [];

  const headers = matrix[0].map(normalizeHeader);
  return matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()])));
}

function recordToCompany(record: CsvRecord): ReceitaCompany | undefined {
  const cnpj = onlyDigits(pick(record, 'cnpj', 'cnpj completo', 'cnpj completo estabelecimento'));
  const uf = pick(record, 'uf', 'estado').toUpperCase();
  const city = pick(record, 'cidade', 'municipio', 'nome municipio');
  const cnae = normalizeCnae(pick(record, 'cnae', 'cnae principal', 'cnae fiscal', 'cnae fiscal principal'));
  const legalName = pick(record, 'razao social', 'nome empresarial', 'empresa', 'legal name');
  if (cnpj.length !== 14 || uf.length !== 2 || !city || cnae.length !== 7 || !legalName) return undefined;

  const phone = buildPhone(record);
  return {
    cnpj,
    legalName,
    tradingName: optional(pick(record, 'nome fantasia', 'fantasia', 'trading name')),
    city,
    uf,
    cnae,
    partners: splitPartners(pick(record, 'socios', 'socio', 'qsa', 'quadro societario')),
    email: optional(pick(record, 'email', 'correio eletronico', 'email empresa')),
    phone: optional(phone),
    website: optional(pick(record, 'site', 'website', 'url site')),
    linkedinUrl: optional(pick(record, 'linkedin url', 'linkedin', 'linkedin company page')),
  };
}

function isActiveCompany(record: CsvRecord): boolean {
  const status = normalizeKey(pick(record, 'situacao cadastral', 'situacao', 'status'));
  return !status || status === '2' || status === '02' || status.includes('ativa');
}

function buildPhone(record: CsvRecord): string {
  const direct = pick(record, 'telefone', 'telefone 1', 'ddd telefone 1', 'phone');
  if (direct) return direct;
  const ddd = onlyDigits(pick(record, 'ddd', 'ddd 1'));
  const number = onlyDigits(pick(record, 'numero telefone', 'telefone sem ddd'));
  return `${ddd}${number}`;
}

function splitPartners(value: string): string[] {
  return uniq(value.split(/[;|\n]+/).map((item) => item.replace(/\s+-\s+.+$/, '').trim()).filter(Boolean));
}

function candidatePriority(company: ReceitaCompany, preferences?: CandidateQuery['preferences']): number {
  let score = 0;
  if (company.linkedinUrl) score += 50;
  if (company.website) score += 8;
  if (company.tradingName) score += 4;
  if (company.partners.length) score += 12;
  if (isValidPhone(company.phone)) score += 16;
  if (isMobilePhone(company.phone)) score += 5;
  if (isValidEmail(company.email)) score += 12;
  if (isCorporateEmail(company.email)) score += 8;
  if (preferences?.requirePhone && isValidPhone(company.phone)) score += 25;
  if (preferences?.requireEmail && isValidEmail(company.email)) score += 25;
  if (preferences?.onlyMobilePhone && isMobilePhone(company.phone)) score += 25;
  if (preferences?.onlyCorporateEmail && isCorporateEmail(company.email)) score += 25;
  if (preferences?.emailType === 'non_corporate' && isValidEmail(company.email) && !isCorporateEmail(company.email)) score += 25;
  if (preferences?.excludeGenericContacts && company.email && !isGenericEmail(company.email)) score += 10;
  return score;
}

function normalizeHeader(value: string): string {
  return normalizeKey(value.replace(/^\uFEFF/, ''));
}

function pick(record: CsvRecord, ...aliases: string[]): string {
  for (const alias of aliases) {
    const value = record[normalizeHeader(alias)];
    if (value?.trim()) return value.trim();
  }
  return '';
}

function optional(value: string): string | undefined {
  return value || undefined;
}

function delimiterCount(line: string, delimiter: string): number {
  return [...line].filter((char) => char === delimiter).length;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
