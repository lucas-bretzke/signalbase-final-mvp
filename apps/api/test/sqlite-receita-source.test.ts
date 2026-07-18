import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from '../src/leadSearch/sqliteDriver.js';
import { SqliteReceitaDatabase } from '../src/leadSearch/sqliteReceitaDatabase.js';

const temporaryDirectories: string[] = [];
const openDatabases: SqliteReceitaDatabase[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('SqliteReceitaDatabase', () => {
  it('filters active companies by UF, homonymous normalized city and multiple CNAEs', async () => {
    const database = await openFixture();

    const query = {
      uf: 'sc',
      city: 'Sao Jose',
      cnaes: ['73.11-4-00', '6201501', '6201501'],
    };

    expect(database.count(query)).toBe(2);

    const companies = database.find({ ...query, offset: 0, limit: 10 });
    expect(companies.map((company) => company.cnpj)).toEqual([
      '11111111000101',
      '22222222000102',
    ]);
    expect(companies.every((company) => company.uf === 'SC' && company.city === 'Sao Jose')).toBe(true);
    expect(companies.some((company) => company.legalName.includes('Inativa'))).toBe(false);
    expect(companies.some((company) => company.legalName.includes('Paulista'))).toBe(false);
  });

  it('normalizes an accented city against an unaccented municipality and returns company data with batched partners', async () => {
    const database = await openFixture();

    const companies = database.find({
      uf: 'SC',
      city: 'São José',
      cnaes: ['7311400', '6201501'],
      offset: 0,
      limit: 10,
    });

    expect(companies).toEqual([
      {
        cnpj: '11111111000101',
        legalName: 'ALFA SERVICOS LTDA',
        tradingName: 'Alfa',
        city: 'São José',
        uf: 'SC',
        cnae: '7311400',
        partners: ['ANA SILVA', 'BRUNO LIMA'],
        email: 'comercial@alfa.example',
        phone: '48999991111',
      },
      {
        cnpj: '22222222000102',
        legalName: 'BETA TECNOLOGIA SA',
        tradingName: 'Beta',
        city: 'São José',
        uf: 'SC',
        cnae: '6201501',
        partners: ['CARLOS SOUZA'],
        email: 'contato@beta.example',
        phone: '4833334444',
      },
    ]);

  });

  it('counts statewide matches and supports offset pagination from both uncached and cached cursors', async () => {
    const database = await openFixture();
    const query = { uf: 'SC', city: 'Sao Jose', cnaes: ['7311400', '6201501'] };

    expect(database.count({ uf: 'SC', cnaes: ['7311400', '6201501'] })).toBe(3);

    const uncachedSecondPage = database.find({ ...query, offset: 1, limit: 1 });
    const firstPage = database.find({ ...query, offset: 0, limit: 1 });
    const cachedSecondPage = database.find({ ...query, offset: 1, limit: 1 });

    expect(firstPage.map((company) => company.cnpj)).toEqual(['11111111000101']);
    expect(uncachedSecondPage.map((company) => company.cnpj)).toEqual(['22222222000102']);
    expect(cachedSecondPage).toEqual(uncachedSecondPage);
  });

  it('returns no candidates for an unknown city', async () => {
    const database = await openFixture();
    const query = { uf: 'SC', city: 'Cidade Inexistente', cnaes: ['7311400'] };

    expect(database.count(query)).toBe(0);
    expect(database.find({ ...query, offset: 0, limit: 10 })).toEqual([]);
  });

  it('detects the recommended partial search index', async () => {
    const database = await openFixture(true);

    expect(database.metadata()).toMatchObject({
      kind: 'sqlite',
      readOnly: true,
      referenceDate: '13/06/2026',
      declaredCnpjCount: 5,
      optimizedSearchIndex: true,
    });
  });

  it('paginates in recommended-index order with both uncached offset and cached keyset cursors', async () => {
    const database = await openFixture(true);
    const query = { uf: 'SC', city: 'Sao Jose', cnaes: ['7311400', '6201501'] };

    // The insertion/rowid order is Alfa (731...) then Beta (620...), while
    // the recommended index orders Beta before Alfa by cnae_fiscal.
    expect(database.count(query)).toBe(2);
    const uncachedSecondPage = database.find({ ...query, offset: 1, limit: 1 });
    const firstPage = database.find({ ...query, offset: 0, limit: 1 });
    const cachedSecondPage = database.find({ ...query, offset: 1, limit: 1 });

    expect(firstPage.map((company) => company.cnpj)).toEqual(['22222222000102']);
    expect(uncachedSecondPage.map((company) => company.cnpj)).toEqual(['11111111000101']);
    expect(cachedSecondPage).toEqual(uncachedSecondPage);
  });

  it('rejects a missing SQLite path', async () => {
    const directory = await temporaryDirectory();
    const missingPath = path.join(directory, 'missing.db');

    expect(() => new SqliteReceitaDatabase({ filePath: missingPath })).toThrow(/ENOENT/);
  });

  it('rejects an incompatible SQLite schema', async () => {
    const directory = await temporaryDirectory();
    const databasePath = path.join(directory, 'invalid.db');
    const writer = new DatabaseSync(databasePath);
    try {
      writer.exec('CREATE TABLE estabelecimento (cnpj TEXT)');
    } finally {
      writer.close();
    }

    expect(() => new SqliteReceitaDatabase({ filePath: databasePath }))
      .toThrow(/Banco SQLite incompativel: estabelecimento sem coluna/);
  });
});

async function openFixture(optimizedSearchIndex = false): Promise<SqliteReceitaDatabase> {
  const directory = await temporaryDirectory();
  const databasePath = path.join(directory, 'receita.db');
  createFixture(databasePath, optimizedSearchIndex);
  const database = new SqliteReceitaDatabase({ filePath: databasePath, busyTimeoutMs: 100 });
  openDatabases.push(database);
  return database;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-sqlite-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createFixture(databasePath: string, optimizedSearchIndex = false): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE estabelecimento (
        cnpj TEXT,
        cnpj_basico TEXT,
        nome_fantasia TEXT,
        situacao_cadastral TEXT,
        cnae_fiscal TEXT,
        uf TEXT,
        municipio TEXT,
        ddd1 TEXT,
        telefone1 TEXT,
        ddd2 TEXT,
        telefone2 TEXT,
        correio_eletronico TEXT
      );
      CREATE TABLE empresas (
        cnpj_basico TEXT,
        razao_social TEXT
      );
      CREATE TABLE socios (
        cnpj_basico TEXT,
        nome_socio TEXT
      );
      CREATE TABLE municipio (
        codigo TEXT,
        descricao TEXT
      );
      CREATE TABLE _referencia (
        referencia TEXT,
        valor TEXT
      );

      CREATE INDEX idx_estabelecimento_cnpj ON estabelecimento(cnpj);
      CREATE INDEX idx_estabelecimento_cnpj_basico ON estabelecimento(cnpj_basico);
      CREATE INDEX idx_empresas_cnpj_basico ON empresas(cnpj_basico);
      CREATE INDEX idx_socios_cnpj_basico ON socios(cnpj_basico);
      CREATE INDEX idx_municipio ON municipio(codigo);
    `);

    if (optimizedSearchIndex) {
      database.exec(`
        CREATE INDEX idx_estabelecimento_busca_ativas
        ON estabelecimento (uf, cnae_fiscal, municipio, cnpj_basico, cnpj)
        WHERE situacao_cadastral = '02';
      `);
    }

    const municipality = database.prepare('INSERT INTO municipio (codigo, descricao) VALUES (?, ?)');
    municipality.run('0001', 'SAO JOSE');
    municipality.run('0002', 'SAO JOSE');
    municipality.run('0003', 'FLORIANOPOLIS');

    const company = database.prepare('INSERT INTO empresas (cnpj_basico, razao_social) VALUES (?, ?)');
    company.run('11111111', 'ALFA SERVICOS LTDA');
    company.run('22222222', 'BETA TECNOLOGIA SA');
    company.run('33333333', 'GAMA INATIVA LTDA');
    company.run('44444444', 'DELTA PAULISTA LTDA');
    company.run('55555555', 'EPSILON FLORIPA LTDA');

    const establishment = database.prepare(`
      INSERT INTO estabelecimento (
        cnpj, cnpj_basico, nome_fantasia, situacao_cadastral, cnae_fiscal,
        uf, municipio, ddd1, telefone1, ddd2, telefone2, correio_eletronico
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    establishment.run('11111111000101', '11111111', 'Alfa', '02', '7311400', 'SC', '0001', '48', '999991111', '', '', 'COMERCIAL@ALFA.EXAMPLE');
    establishment.run('22222222000102', '22222222', 'Beta', '02', '6201501', 'SC', '0001', '', '', '48', '33334444', 'CONTATO@BETA.EXAMPLE');
    establishment.run('33333333000103', '33333333', 'Gama', '08', '7311400', 'SC', '0001', '48', '999993333', '', '', 'gama@example');
    establishment.run('44444444000104', '44444444', 'Delta', '02', '7311400', 'SP', '0002', '11', '999994444', '', '', 'delta@example');
    establishment.run('55555555000105', '55555555', 'Epsilon', '02', '6201501', 'SC', '0003', '48', '999995555', '', '', 'epsilon@example');

    const partner = database.prepare('INSERT INTO socios (cnpj_basico, nome_socio) VALUES (?, ?)');
    partner.run('11111111', 'ANA SILVA');
    partner.run('11111111', 'Ana Silva');
    partner.run('11111111', 'BRUNO LIMA');
    partner.run('22222222', 'CARLOS SOUZA');
    partner.run('55555555', 'DANIELA COSTA');

    const reference = database.prepare('INSERT INTO _referencia (referencia, valor) VALUES (?, ?)');
    reference.run('CNPJ', '13/06/2026');
    reference.run('cnpj_qtde', '5');
  } finally {
    database.close();
  }
}
