import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../src/server.js';
import { env } from '../src/env.js';
import { leadSearchCreateSchema } from '../src/validation.js';
import { EnrichmentLeadProcessor, evaluateEnrichedLead } from '../src/leadSearch/leadProcessor.js';
import { JsonLeadSearchRepository } from '../src/leadSearch/jsonRepository.js';
import { CsvReceitaCompanySource } from '../src/leadSearch/receitaCsvSource.js';
import { LeadSearchService } from '../src/leadSearch/service.js';
import {
  CandidateQuery,
  LeadProcessingOutcome,
  LeadProcessor,
  LeadSearch,
  LeadSearchFilters,
  ReceitaCompany,
  ReceitaCompanySource,
} from '../src/leadSearch/types.js';
import { EnrichedLead } from '../src/types.js';

const temporaryDirectories: string[] = [];
const originalWorkerMode = env.workerMode;
const originalLinkedinEnabled = env.linkedinEnabled;

afterEach(async () => {
  env.workerMode = originalWorkerMode;
  env.linkedinEnabled = originalLinkedinEnabled;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('lead search validation', () => {
  it('normalizes UF, CNAEs and advanced aliases', () => {
    const parsed = leadSearchCreateSchema.parse({
      uf: 'sc',
      city: ' Florianópolis ',
      cnaes: ['73.11-4-00', '7311400'],
      targetQuantity: 100,
      minScore: 75,
      requireMobilePhone: true,
      requireCorporateEmail: true,
      requireDecisionMakerMatch: true,
    });

    expect(parsed).toMatchObject({
      uf: 'SC',
      city: 'Florianópolis',
      cnaes: ['7311400'],
      requirePhone: true,
      requireEmail: true,
      onlyMobilePhone: true,
      emailType: 'corporate',
      onlyCorporateEmail: true,
    });
  });

  it('normalizes non-corporate email preference as an email requirement', () => {
    const parsed = leadSearchCreateSchema.parse({
      uf: 'SC',
      cnaes: ['7311400'],
      targetQuantity: 10,
      emailType: 'non_corporate',
    });

    expect(parsed).toMatchObject({
      requireEmail: true,
      emailType: 'non_corporate',
      onlyCorporateEmail: false,
    });
  });

  it('maps legacy minScore to minQuality and lets minQuality take precedence', () => {
    const legacy = leadSearchCreateSchema.parse({
      uf: 'SC',
      cnaes: ['7311400'],
      targetQuantity: 10,
      minScore: 75,
    });
    const explicit = leadSearchCreateSchema.parse({
      uf: 'SC',
      cnaes: ['7311400'],
      targetQuantity: 10,
      minScore: 95,
      minQuality: 'medio',
    });

    expect(legacy).toMatchObject({ minQuality: 'alto', minScore: 75 });
    expect(explicit).toMatchObject({ minQuality: 'medio', minScore: 50 });
  });

  it('accepts max target for city and state searches, but not without a UF', () => {
    const citySearch = leadSearchCreateSchema.parse({
      uf: 'SC',
      city: 'Florianópolis',
      cnaes: ['7311400'],
      targetQuantity: 'max',
    });
    const stateSearch = leadSearchCreateSchema.parse({
      uf: 'SC',
      cnaes: ['7311400'],
      targetQuantity: 'max',
    });

    expect(citySearch).toMatchObject({
      targetQuantity: 0,
      targetMode: 'max',
    });
    expect(stateSearch).toMatchObject({
      uf: 'SC',
      city: undefined,
      targetQuantity: 0,
      targetMode: 'max',
    });
    expect(leadSearchCreateSchema.safeParse({ cnaes: ['7311400'], targetQuantity: 'max' }).success).toBe(false);
  });

  it('rejects unknown UFs and malformed CNAEs', () => {
    expect(leadSearchCreateSchema.safeParse({ uf: 'ZZ', cnaes: ['7311400'], targetQuantity: 1 }).success).toBe(false);
    expect(leadSearchCreateSchema.safeParse({ uf: 'SC', cnaes: ['73114'], targetQuantity: 1 }).success).toBe(false);
  });
});

describe('local Receita CSV source', () => {
  const demoPath = fileURLToPath(new URL('../data/receita-demo.csv', import.meta.url));

  it('filters by state, optional city and multiple CNAEs while excluding inactive rows', async () => {
    const source = new CsvReceitaCompanySource(demoPath);
    const statewide = await source.count({ uf: 'SC', cnaes: ['7311400', '7319002'] });
    const florianopolis = await source.find({ uf: 'sc', city: 'florianopolis', cnaes: ['7311400'], offset: 0, limit: 50 });

    expect(statewide).toBeGreaterThan(florianopolis.length);
    expect(florianopolis).toHaveLength(3);
    expect(florianopolis.every((company) => company.city === 'Florianópolis' && company.uf === 'SC')).toBe(true);
    expect(florianopolis.some((company) => company.legalName.includes('Inativa'))).toBe(false);
  });
});

describe('final lead qualification', () => {
  it('counts a lead only after score, contacts and partner match pass', () => {
    env.workerMode = 'demo';
    env.linkedinEnabled = true;
    const search = searchModel({ targetQuantity: 1, minScore: 75, requirePhone: true, requireEmail: true, requireDecisionMakerMatch: true, onlyMobilePhone: true, onlyCorporateEmail: true, excludeGenericContacts: true });
    const candidate = company(1);
    const lead = enrichedLead();

    const accepted = evaluateEnrichedLead(search, candidate, lead, '2026-07-17T12:00:00.000Z');
    expect(accepted.result.status).toBe('valid');
    expect(accepted.result.selected).toBe(true);
    expect(accepted.crossMatch).toMatchObject({
      decisionMakerMatched: true,
      finalEmail: 'ana.silva@acme.demo',
      finalPhone: '+55 48 99999-0001',
      emailCorporate: true,
      phoneMobile: true,
    });

    const rejected = evaluateEnrichedLead({ ...search, minScore: 99 }, candidate, lead);
    expect(rejected.result.status).toBe('rejected');
    expect(rejected.result.rejectionReasons[0]).toContain('abaixo do minimo');
  });

  it('can require non-corporate emails only', () => {
    env.workerMode = 'demo';
    env.linkedinEnabled = true;
    const candidate = company(1);
    const baseLead = enrichedLead();
    const decisionMaker = baseLead.decisionMakers[0];
    const personalLead = {
      ...baseLead,
      bestDecisionMaker: {
        ...decisionMaker,
        emails: ['ana.silva@gmail.com'],
      },
      decisionMakers: [{
        ...decisionMaker,
        emails: ['ana.silva@gmail.com'],
      }],
      companyEmail: 'contato@acme.demo',
    };
    const search = searchModel({ emailType: 'non_corporate', requireEmail: true });

    const accepted = evaluateEnrichedLead(search, candidate, personalLead, '2026-07-17T12:00:00.000Z');
    expect(accepted.result.status).toBe('valid');
    expect(accepted.crossMatch?.finalEmail).toBe('ana.silva@gmail.com');
    expect(accepted.crossMatch?.emailCorporate).toBe(false);

    const rejected = evaluateEnrichedLead(search, candidate, enrichedLead());
    expect(rejected.result.status).toBe('rejected');
    expect(rejected.result.rejectionReasons).toContain('E-mail nao corporativo valido obrigatorio nao encontrado.');
  });

  it('rejects demo evidence when the worker is in real mode', () => {
    env.workerMode = 'real';
    const accepted = evaluateEnrichedLead(searchModel({ minScore: 0, minQuality: 'baixo' }), company(1), enrichedLead(), '2026-07-17T12:00:00.000Z');

    expect(accepted.result.status).toBe('rejected');
    expect(accepted.result.rejectionReasons).toContain('Evidencia demonstrativa nao e aceita no modo real.');
    expect(accepted.crossMatch).toMatchObject({
      isDemoEvidence: true,
      decisionMakerMatched: false,
    });
  });

  it('does not treat a LinkedIn URL without real extracted data as high quality', () => {
    env.workerMode = 'real';
    const lead = {
      ...enrichedLead(),
      linkedinProvider: 'input',
      companyExtractionSuccess: false,
      companyExtractionMethod: 'worker_error',
      industry: undefined,
      companySize: undefined,
      employeesMin: undefined,
      employeesMax: undefined,
      headquarters: undefined,
      followers: undefined,
      description: undefined,
      bestDecisionMaker: undefined,
      decisionMakers: [],
      score: 60,
      quality: 'normal' as const,
    };
    const outcome = evaluateEnrichedLead(searchModel({ minQuality: 'alto', minScore: 70 }), company(1), lead, '2026-07-17T12:00:00.000Z');

    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejectionReasons.some((reason) => reason.includes('Qualidade'))).toBe(true);
    expect(outcome.crossMatch?.linkedinEvidenceLevel).toBe('url_only');
  });

  it('raises confidence for an email containing the partner name without allowing score 100 by itself', () => {
    env.workerMode = 'real';
    const realPerson = {
      name: 'Ana Silva', title: 'Socia e CEO', linkedin_url: 'https://linkedin.com/in/ana-silva',
      emails: ['ana.silva@gmail.com'], phones: [], confidence: 96, source: 'puppeteer_linkedin',
      partner_match: true, matched_partner_name: 'Ana Silva', partner_match_confidence: 95,
    };
    const lead = {
      ...enrichedLead(),
      linkedinProvider: 'input',
      companyExtractionSuccess: false,
      companyExtractionMethod: 'worker_error',
      bestDecisionMaker: realPerson,
      decisionMakers: [realPerson],
      companyEmail: undefined,
      companyPhone: undefined,
      score: 92,
      quality: 'muito_alta' as const,
    };
    const outcome = evaluateEnrichedLead(searchModel({ minQuality: 'alto', minScore: 70, requireEmail: true }), company(1), lead, '2026-07-17T12:00:00.000Z');

    expect(outcome.result.status).toBe('valid');
    expect(outcome.crossMatch?.emailNameMatched).toBe(true);
    expect(outcome.result.finalScore).toBeLessThan(100);
    expect(outcome.result.finalScore).toBeGreaterThanOrEqual(90);
  });

  it('requires at least one technically valid contact even at low quality', () => {
    env.workerMode = 'real';
    const candidate = { ...company(1), email: undefined, phone: undefined };
    const lead = {
      ...enrichedLead(),
      linkedinProvider: 'input',
      companyEmail: undefined,
      companyPhone: undefined,
      bestDecisionMaker: undefined,
      decisionMakers: [],
      score: 40,
      quality: 'normal' as const,
    };
    const outcome = evaluateEnrichedLead(searchModel({ minQuality: 'baixo', minScore: 0 }), candidate, lead, '2026-07-17T12:00:00.000Z');

    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejectionReasons).toContain('Contato tecnico valido obrigatorio nao encontrado.');
  });

  it('applies automatic high-quality rules without exposing technical toggles', () => {
    env.workerMode = 'real';
    const lead = {
      ...enrichedLead(),
      linkedinProvider: 'input',
      companyExtractionSuccess: true,
      companyExtractionMethod: 'linkedin_worker',
      industry: 'Publicidade',
      description: 'Agencia de marketing.',
      bestDecisionMaker: undefined,
      decisionMakers: [],
      companyEmail: 'contato@acme.com.br',
      score: 82,
      quality: 'alta' as const,
    };
    const outcome = evaluateEnrichedLead(searchModel({ minQuality: 'alto', minScore: 70, requireEmail: true }), company(1), lead, '2026-07-17T12:00:00.000Z');

    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejectionReasons).toContain('Qualidade alta nao aceita e-mail generico como contato final.');
  });

  it('requires extracted company data before allowing very high quality in real mode', () => {
    env.workerMode = 'real';
    const realPerson = {
      name: 'Ana Silva', title: 'Socia e CEO', linkedin_url: 'https://linkedin.com/in/ana-silva',
      emails: ['ana.silva@acme.com.br'], phones: ['+55 48 99999-0001'], confidence: 96, source: 'puppeteer_linkedin',
      partner_match: true, matched_partner_name: 'Ana Silva', partner_match_confidence: 96,
    };
    const lead = {
      ...enrichedLead(),
      linkedinProvider: 'input',
      companyExtractionSuccess: false,
      companyExtractionMethod: 'worker_error',
      bestDecisionMaker: realPerson,
      decisionMakers: [realPerson],
      companyEmail: undefined,
      score: 95,
      quality: 'muito_alta' as const,
    };
    const outcome = evaluateEnrichedLead(searchModel({ minQuality: 'muito_alto', minScore: 85, requireEmail: true }), company(1), lead, '2026-07-17T12:00:00.000Z');

    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejectionReasons).toContain('Dados reais da empresa no LinkedIn obrigatorios nao encontrados.');
  });

  it('uses only local evidence when LinkedIn is disabled and can still reach high quality', async () => {
    env.workerMode = 'real';
    env.linkedinEnabled = false;
    const candidate = {
      ...company(1),
      email: 'ana.silva@acme.com.br',
      website: 'https://acme.com.br',
    };
    const outcome = await new EnrichmentLeadProcessor().process(searchModel({
      minQuality: 'alto',
      minScore: 70,
      requireEmail: true,
      requirePhone: true,
      requireDecisionMakerMatch: false,
      excludeGenericContacts: true,
    }), candidate);

    expect(outcome.result.status).toBe('valid');
    expect(outcome.crossMatch).toMatchObject({
      linkedinEvidenceLevel: 'none',
      emailNameMatched: true,
      isDemoEvidence: false,
    });
    expect(outcome.crossMatch?.warnings).toContain('Sem LinkedIn, nao e possivel confirmar cargo atual, perfil profissional ou vinculo do decisor.');
  });
});

describe('job, progress, routes and export', () => {
  it('streams unindexed candidates without running a blocking count first', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-final-test-'));
    temporaryDirectories.push(directory);
    const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
    const source = new StreamingSource([company(1), company(2), company(3), company(4)]);
    const service = new LeadSearchService(repository, source, new AlternatingProcessor(), { batchSize: 2 });

    const created = await service.create(filters({ targetQuantity: 5 }));
    expect(created).toMatchObject({ totalCandidatesFound: 0, candidateCountStatus: 'lower_bound', candidateProgressPercent: 0 });

    await service.waitForIdle();
    expect(await service.get(created.id)).toMatchObject({
      status: 'completed',
      completionReason: 'candidate_pool_exhausted',
      totalCandidatesFound: 4,
      candidateCountStatus: 'exact',
      totalProcessed: 4,
    });
    expect(source.countCalls).toBe(0);
  });

  it('processes past rejected companies until the valid-contact target is reached', async () => {
    const { service } = await createService();
    const created = await service.create(filters({ targetQuantity: 2 }));
    await service.waitForIdle();
    const finished = await service.get(created.id);

    expect(finished).toMatchObject({ status: 'completed', totalCandidatesFound: 4, totalProcessed: 3, totalValidLeads: 2, remainingQuantity: 0 });
    expect(finished?.yieldRate).toBeCloseTo(66.67, 1);
  });

  it('completes with an exhausted-candidates reason when candidates end before the target', async () => {
    const { service } = await createService();
    const created = await service.create(filters({ targetQuantity: 5 }));
    await service.waitForIdle();
    const finished = await service.get(created.id);

    expect(finished).toMatchObject({ status: 'completed', completionReason: 'candidate_pool_exhausted', totalProcessed: 4, totalValidLeads: 2, remainingQuantity: 3 });
  });

  it('processes the full state candidate pool in max target mode', async () => {
    const { service } = await createService();
    const created = await service.create(filters({ city: undefined, targetMode: 'max', targetQuantity: 0 }));
    await service.waitForIdle();
    const finished = await service.get(created.id);

    expect(finished).toMatchObject({
      status: 'completed',
      completionReason: 'candidate_pool_exhausted',
      targetMode: 'max',
      totalProcessed: 4,
      totalValidLeads: 2,
      remainingQuantity: 0,
      progressPercent: 100,
    });
  });

  it('exposes prefixed and unprefixed routes and exports persisted valid leads', async () => {
    const { service } = await createService();
    const server = buildServer({ leadSearchService: service });
    await server.ready();
    try {
      const invalid = await server.inject({ method: 'POST', url: '/api/lead-searches', payload: { uf: 'ZZ', cnaes: ['7311400'], targetQuantity: 2 } });
      expect(invalid.statusCode).toBe(400);

      const createdResponse = await server.inject({ method: 'POST', url: '/lead-searches', payload: { ...filters({ targetQuantity: 2 }), minScore: 0 } });
      expect(createdResponse.statusCode).toBe(202);
      const id = createdResponse.json().search.id as string;
      await service.waitForIdle();

      const detail = await server.inject({ method: 'GET', url: `/api/lead-searches/${id}` });
      expect(detail.json().search).toMatchObject({ status: 'completed', totalProcessed: 3, totalValidLeads: 2 });

      const resultsResponse = await server.inject({ method: 'GET', url: `/api/lead-searches/${id}/results?status=valid` });
      const results = resultsResponse.json();
      expect(results.total).toBe(2);
      const firstId = results.items[0].id as string;

      const deselected = await server.inject({ method: 'PATCH', url: `/api/lead-searches/${id}/results/${firstId}`, payload: { selected: false } });
      expect(deselected.json().result.selected).toBe(false);

      const exportResponse = await server.inject({ method: 'GET', url: `/api/lead-searches/${id}/export.csv?selectedOnly=true` });
      expect(exportResponse.statusCode).toBe(200);
      expect(exportResponse.headers['content-type']).toContain('text/csv');
      expect(exportResponse.body).toContain('cnpj');
      expect(exportResponse.body.split('\n').filter(Boolean)).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
});

class MemorySource implements ReceitaCompanySource {
  constructor(private readonly companies: ReceitaCompany[]) {}
  async count(): Promise<number> { return this.companies.length; }
  async find(query: CandidateQuery): Promise<ReceitaCompany[]> { return this.companies.slice(query.offset, query.offset + query.limit); }
}

class StreamingSource extends MemorySource {
  candidateCountStrategy = 'streaming' as const;
  countCalls = 0;
  async count(): Promise<number> {
    this.countCalls += 1;
    throw new Error('count() nao deve ser chamado no modo streaming.');
  }
}

class AlternatingProcessor implements LeadProcessor {
  async process(search: LeadSearch, candidate: ReceitaCompany): Promise<LeadProcessingOutcome> {
    const valid = candidate.cnpj.endsWith('01') || candidate.cnpj.endsWith('03');
    const now = new Date().toISOString();
    return {
      result: {
        id: `result-${search.id}-${candidate.cnpj}`,
        leadSearchId: search.id,
        cnpj: candidate.cnpj,
        finalScore: valid ? 90 : 40,
        status: valid ? 'valid' : 'rejected',
        selected: valid,
        candidate,
        rejectionReasons: valid ? [] : ['Contato final insuficiente.'],
        createdAt: now,
        updatedAt: now,
      },
    };
  }
}

async function createService() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-final-test-'));
  temporaryDirectories.push(directory);
  const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
  const service = new LeadSearchService(repository, new MemorySource([company(1), company(2), company(3), company(4)]), new AlternatingProcessor(), { batchSize: 2 });
  await service.initialize();
  return { service, repository };
}

function filters(overrides: Partial<LeadSearchFilters> = {}): LeadSearchFilters {
  return {
    uf: 'SC', city: 'Florianópolis', cnaes: ['7311400'], targetQuantity: 2, targetMode: 'fixed', minScore: 75,
    requirePhone: false, requireEmail: false, requireDecisionMakerMatch: false,
    onlyMobilePhone: false, emailType: 'any', onlyCorporateEmail: false, excludeGenericContacts: false,
    ...overrides,
  };
}

function searchModel(overrides: Partial<LeadSearchFilters> = {}): LeadSearch {
  return {
    id: 'search-test', ...filters(overrides), status: 'processing', totalCandidatesFound: 1,
    totalProcessed: 0, totalValidLeads: 0, createdAt: '2026-07-17T10:00:00.000Z', updatedAt: '2026-07-17T10:00:00.000Z',
  };
}

function company(index: number): ReceitaCompany {
  return {
    cnpj: `1000000000000${index}`,
    legalName: `Empresa ${index} LTDA`, tradingName: `Empresa ${index}`, city: 'Florianópolis', uf: 'SC', cnae: '7311400',
    partners: ['Ana Silva'], email: 'empresa@acme.demo', phone: '+55 48 99999-0001', website: 'https://acme.demo',
  };
}

function enrichedLead(): EnrichedLead {
  const person = {
    name: 'Ana Silva', title: 'Sócia e CEO', linkedin_url: 'https://linkedin.com/in/ana-silva-demo',
    emails: ['ana.silva@acme.demo'], phones: ['+55 48 99999-0001'], confidence: 96, source: 'demo_partner_match',
    partner_match: true, matched_partner_name: 'Ana Silva', partner_match_confidence: 100,
  };
  return {
    id: 'lead-1', cnpj: '10.000.000/0000-01', inputName: 'Acme', companyName: 'Acme',
    linkedinUrl: 'https://linkedin.com/company/acme', website: 'https://acme.demo', city: 'Florianópolis', state: 'SC',
    companyPhone: '+55 48 3333-0000', companyEmail: 'contato@acme.demo', bestDecisionMaker: person,
    decisionMakers: [person], quality: 'muito_alta', score: 80, evidence: ['Company Page encontrada.'], warnings: [],
  };
}
