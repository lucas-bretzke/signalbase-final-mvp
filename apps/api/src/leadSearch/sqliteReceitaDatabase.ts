import fs from 'node:fs';
import { normalizeKey, onlyDigits, uniq } from '../utils.js';
import { DatabaseSync, SqliteDatabaseConnection } from './sqliteDriver.js';
import { CandidateQuery, ReceitaCompany, ReceitaSourceMetadata } from './types.js';

const REQUIRED_COLUMNS: Record<string, string[]> = {
  estabelecimento: [
    'cnpj', 'cnpj_basico', 'nome_fantasia', 'situacao_cadastral', 'cnae_fiscal',
    'uf', 'municipio', 'ddd1', 'telefone1', 'ddd2', 'telefone2', 'correio_eletronico',
  ],
  empresas: ['cnpj_basico', 'razao_social'],
  socios: ['cnpj_basico', 'nome_socio'],
  municipio: ['codigo', 'descricao'],
};

const MAX_CACHED_FILTERS = 100;
const MAX_CACHED_CURSORS_PER_FILTER = 256;

interface SqliteReceitaDatabaseOptions {
  filePath: string;
  busyTimeoutMs?: number;
}

interface FilterSql {
  key: string;
  where: string;
  parameters: Array<string | number>;
  impossible: boolean;
}

interface RawCompanyRow extends Record<string, unknown> {
  sourceRowId: number;
  cnpj: string;
  cnpjBasico: string;
  legalName: string | null;
  tradingName: string | null;
  city: string | null;
  municipalityCode: string;
  uf: string;
  cnae: string;
  ddd1: string | null;
  phone1: string | null;
  ddd2: string | null;
  phone2: string | null;
  email: string | null;
}

interface RowIdCursor {
  kind: 'rowid';
  sourceRowId: number;
}

interface IndexedCursor {
  kind: 'indexed';
  sourceRowId: number;
  uf: string;
  cnae: string;
  municipalityCode: string;
  cnpjBasico: string;
  cnpj: string;
}

type PaginationCursor = RowIdCursor | IndexedCursor;

/**
 * Synchronous SQLite engine. It is hosted in a Worker by SqliteReceitaCompanySource,
 * so a scan on the national database never blocks Fastify's event loop.
 */
export class SqliteReceitaDatabase {
  private readonly database: SqliteDatabaseConnection;
  private readonly countCache = new Map<string, number>();
  private readonly cursors = new Map<string, Map<number, PaginationCursor>>();
  private municipalityCodes?: Map<string, string[]>;
  private optimizedSearchIndex = false;
  private closed = false;

  constructor(private readonly options: SqliteReceitaDatabaseOptions) {
    const stat = fs.statSync(options.filePath);
    if (!stat.isFile()) throw new Error(`O caminho SQLite nao aponta para um arquivo: ${options.filePath}`);

    this.database = new DatabaseSync(options.filePath, { readOnly: true });
    try {
      const busyTimeoutMs = Math.max(0, Math.min(60_000, Math.trunc(options.busyTimeoutMs ?? 5_000)));
      this.database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      this.database.exec('PRAGMA query_only = ON');
      this.database.exec('PRAGMA trusted_schema = OFF');
      this.validateSchema();
      this.optimizedSearchIndex = this.hasOptimizedSearchIndex();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  count(query: Omit<CandidateQuery, 'offset' | 'limit'>): number {
    this.ensureOpen();
    const filter = this.filterSql(query);
    if (filter.impossible) return 0;
    const cached = this.countCache.get(filter.key);
    if (cached !== undefined) return cached;

    const row = this.database.prepare(`
      SELECT COUNT(*) AS total
      FROM estabelecimento AS e
      WHERE ${filter.where}
    `).get(...filter.parameters) as Record<string, unknown> | undefined;
    const total = Number(row?.total ?? 0);
    this.remember(this.countCache, filter.key, total);
    return total;
  }

  find(query: CandidateQuery): ReceitaCompany[] {
    this.ensureOpen();
    const limit = Math.max(0, Math.trunc(query.limit));
    const offset = Math.max(0, Math.trunc(query.offset));
    if (!limit) return [];

    const filter = this.filterSql(query);
    if (filter.impossible) return [];

    const offsets = this.cursorCache(filter.key);
    const cursor = offsets.get(offset);
    if (cursor) this.remember(offsets, offset, cursor, MAX_CACHED_CURSORS_PER_FILTER);

    const indexedCursor = cursor?.kind === 'indexed' ? cursor : undefined;
    const rowIdCursor = cursor?.kind === 'rowid' ? cursor : undefined;
    const cursorClause = this.optimizedSearchIndex
      ? indexedCursor
        ? ` AND (e.uf, e.cnae_fiscal, e.municipio, e.cnpj_basico, e.cnpj, e.rowid)
                  > (?, ?, ?, ?, ?, ?)`
        : ''
      : rowIdCursor
        ? ' AND e.rowid > ?'
        : '';
    const paginationClause = cursor === undefined ? 'LIMIT ? OFFSET ?' : 'LIMIT ?';
    const parameters: Array<string | number> = [...filter.parameters];
    if (indexedCursor) {
      parameters.push(
        indexedCursor.uf,
        indexedCursor.cnae,
        indexedCursor.municipalityCode,
        indexedCursor.cnpjBasico,
        indexedCursor.cnpj,
        indexedCursor.sourceRowId,
      );
    } else if (rowIdCursor) {
      parameters.push(rowIdCursor.sourceRowId);
    }
    parameters.push(limit);
    if (cursor === undefined) parameters.push(offset);

    const orderBy = this.optimizedSearchIndex
      ? 'e.uf, e.cnae_fiscal, e.municipio, e.cnpj_basico, e.cnpj, e.rowid'
      : 'e.rowid';

    // Without the compound index, rowid avoids a full sort. With it, the
    // index's own column order enables stable keyset pagination; rowid is the
    // final tie-breaker because SQLite appends it to non-unique indexes.
    const rows = this.database.prepare(`
      SELECT
        e.rowid AS sourceRowId,
        e.cnpj AS cnpj,
        e.cnpj_basico AS cnpjBasico,
        (SELECT emp.razao_social
           FROM empresas AS emp
          WHERE emp.cnpj_basico = e.cnpj_basico
          LIMIT 1) AS legalName,
        e.nome_fantasia AS tradingName,
        (SELECT m.descricao
           FROM municipio AS m
          WHERE m.codigo = e.municipio
          LIMIT 1) AS city,
        e.municipio AS municipalityCode,
        e.uf AS uf,
        e.cnae_fiscal AS cnae,
        e.ddd1 AS ddd1,
        e.telefone1 AS phone1,
        e.ddd2 AS ddd2,
        e.telefone2 AS phone2,
        e.correio_eletronico AS email
      FROM estabelecimento AS e
      WHERE ${filter.where}${cursorClause}
      ORDER BY ${orderBy}
      ${paginationClause}
    `).all(...parameters) as unknown as RawCompanyRow[];

    const last = rows.at(-1);
    if (last) {
      const nextCursor: PaginationCursor = this.optimizedSearchIndex
        ? {
            kind: 'indexed',
            sourceRowId: Number(last.sourceRowId),
            uf: clean(last.uf),
            cnae: clean(last.cnae),
            municipalityCode: clean(last.municipalityCode),
            cnpjBasico: clean(last.cnpjBasico),
            cnpj: clean(last.cnpj),
          }
        : { kind: 'rowid', sourceRowId: Number(last.sourceRowId) };
      this.remember(offsets, offset + rows.length, nextCursor, MAX_CACHED_CURSORS_PER_FILTER);
    }
    const partners = this.loadPartners(rows.map((row) => clean(row.cnpjBasico)).filter(Boolean));

    return rows.map((row) => {
      const cnpj = onlyDigits(clean(row.cnpj));
      const cnpjBasico = clean(row.cnpjBasico);
      const tradingName = optional(row.tradingName);
      const databaseCity = optional(row.city);
      const phone = buildPhone(row.ddd1, row.phone1) ?? buildPhone(row.ddd2, row.phone2);
      return {
        cnpj,
        legalName: optional(row.legalName) ?? tradingName ?? `CNPJ ${cnpj}`,
        tradingName,
        city: query.city?.trim() || titleCase(databaseCity ?? clean(row.municipalityCode)),
        uf: clean(row.uf).toUpperCase(),
        cnae: onlyDigits(clean(row.cnae)).slice(0, 7),
        partners: partners.get(cnpjBasico) ?? [],
        email: optional(row.email)?.toLowerCase(),
        phone,
      };
    });
  }

  metadata(): ReceitaSourceMetadata {
    this.ensureOpen();
    const references = new Map<string, string>();
    if (this.tableExists('_referencia')) {
      const rows = this.database.prepare('SELECT referencia, valor FROM _referencia').all() as Array<Record<string, unknown>>;
      for (const row of rows) references.set(clean(row.referencia), clean(row.valor));
    }
    const version = this.database.prepare('SELECT sqlite_version() AS version').get() as Record<string, unknown>;
    const declared = Number(references.get('cnpj_qtde'));
    return {
      kind: 'sqlite',
      readOnly: true,
      location: this.options.filePath,
      referenceDate: references.get('CNPJ') || undefined,
      declaredCnpjCount: Number.isFinite(declared) ? declared : undefined,
      sqliteVersion: clean(version.version),
      optimizedSearchIndex: this.optimizedSearchIndex,
      warning: this.optimizedSearchIndex
        ? undefined
        : 'Indice de busca ausente: candidatas serao descobertas por lotes e totalCandidatesFound sera uma contagem incremental ate o esgotamento.',
    };
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private filterSql(query: Pick<CandidateQuery, 'uf' | 'city' | 'cnaes'>): FilterSql {
    const uf = clean(query.uf).toUpperCase();
    const cnaes = uniq(query.cnaes.map((value) => onlyDigits(value).slice(0, 7)).filter((value) => value.length === 7)).sort();
    const cityKey = query.city ? normalizeKey(query.city) : '';
    const municipalityCodes = cityKey ? [...(this.getMunicipalityCodes().get(cityKey) ?? [])].sort() : [];
    const key = JSON.stringify({ uf, cnaes, municipalityCodes });
    if (uf.length !== 2 || !cnaes.length || (cityKey && !municipalityCodes.length)) {
      return { key, where: '0 = 1', parameters: [], impossible: true };
    }

    // Keeping '02' as a literal is required for SQLite to prove that a query
    // satisfies the recommended partial-index predicate.
    const parameters: Array<string | number> = this.optimizedSearchIndex ? [uf, ...cnaes] : ['02', uf, ...cnaes];
    const parts = [
      this.optimizedSearchIndex ? "e.situacao_cadastral = '02'" : 'e.situacao_cadastral = ?',
      'e.uf = ?',
      `e.cnae_fiscal IN (${placeholders(cnaes.length)})`,
    ];
    if (cityKey) {
      parts.push(`e.municipio IN (${placeholders(municipalityCodes.length)})`);
      parameters.push(...municipalityCodes);
    }
    return { key, where: parts.join(' AND '), parameters, impossible: false };
  }

  private getMunicipalityCodes(): Map<string, string[]> {
    if (this.municipalityCodes) return this.municipalityCodes;
    const mapping = new Map<string, string[]>();
    const rows = this.database.prepare('SELECT codigo, descricao FROM municipio').all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const key = normalizeKey(clean(row.descricao));
      const code = clean(row.codigo);
      if (!key || !code) continue;
      const codes = mapping.get(key) ?? [];
      if (!codes.includes(code)) codes.push(code);
      mapping.set(key, codes);
    }
    this.municipalityCodes = mapping;
    return mapping;
  }

  private loadPartners(cnpjBasicos: string[]): Map<string, string[]> {
    const unique = uniq(cnpjBasicos);
    const mapping = new Map<string, string[]>();
    if (!unique.length) return mapping;
    const rows = this.database.prepare(`
      SELECT cnpj_basico AS cnpjBasico, nome_socio AS partnerName
      FROM socios
      WHERE cnpj_basico IN (${placeholders(unique.length)})
        AND nome_socio IS NOT NULL
        AND TRIM(nome_socio) <> ''
      ORDER BY cnpj_basico, rowid
    `).all(...unique) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const cnpjBasico = clean(row.cnpjBasico);
      const partnerName = clean(row.partnerName);
      const names = mapping.get(cnpjBasico) ?? [];
      if (partnerName && !names.some((name) => normalizeKey(name) === normalizeKey(partnerName))) names.push(partnerName);
      mapping.set(cnpjBasico, names);
    }
    return mapping;
  }

  private validateSchema(): void {
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      if (!this.tableExists(table)) throw new Error(`Banco SQLite incompativel: tabela obrigatoria ausente (${table}).`);
      const rows = this.database.prepare(`PRAGMA table_info("${table}")`).all() as Array<Record<string, unknown>>;
      const columns = new Set(rows.map((row) => clean(row.name).toLowerCase()));
      const missing = required.filter((column) => !columns.has(column));
      if (missing.length) throw new Error(`Banco SQLite incompativel: ${table} sem coluna(s) ${missing.join(', ')}.`);
    }
  }

  private tableExists(name: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(name));
  }

  private hasOptimizedSearchIndex(): boolean {
    const indexes = this.database.prepare('PRAGMA index_list("estabelecimento")').all() as Array<Record<string, unknown>>;
    for (const index of indexes) {
      const name = clean(index.name);
      if (!name) continue;
      const escaped = name.replace(/"/g, '""');
      const columns = (this.database.prepare(`PRAGMA index_info("${escaped}")`).all() as Array<Record<string, unknown>>)
        .map((row) => clean(row.name).toLowerCase());
      const sqlRow = this.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) as Record<string, unknown> | undefined;
      const definition = clean(sqlRow?.sql).toLowerCase();
      const recommendedColumns = ['uf', 'cnae_fiscal', 'municipio', 'cnpj_basico', 'cnpj'];
      const partialActive = recommendedColumns.every((column, position) => columns[position] === column)
        && /where\s+[\s\S]*situacao_cadastral/.test(definition)
        && /['\"]02['\"]/.test(definition);
      const fullActive = ['situacao_cadastral', ...recommendedColumns]
        .every((column, position) => columns[position] === column);
      if (partialActive || fullActive) return true;
    }
    return false;
  }

  private cursorCache(filterKey: string): Map<number, PaginationCursor> {
    const cached = this.cursors.get(filterKey) ?? new Map<number, PaginationCursor>();
    this.remember(this.cursors, filterKey, cached, MAX_CACHED_FILTERS);
    return cached;
  }

  private remember<K, V>(cache: Map<K, V>, key: K, value: V, maximumSize = MAX_CACHED_FILTERS): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maximumSize) cache.delete(cache.keys().next().value as K);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('A conexao SQLite da Receita ja foi encerrada.');
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function optional(value: unknown): string | undefined {
  return clean(value) || undefined;
}

function buildPhone(dddValue: unknown, phoneValue: unknown): string | undefined {
  const phone = onlyDigits(clean(phoneValue));
  if (!phone) return undefined;
  const ddd = onlyDigits(clean(dddValue));
  return `${ddd}${phone}`;
}

function titleCase(value: string): string {
  return value.toLocaleLowerCase('pt-BR').replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase('pt-BR'));
}
