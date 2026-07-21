import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadSearch, ReceitaCompany } from '../src/leadSearch/types.js';

const workerMocks = vi.hoisted(() => {
  class MockWorkerClientError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
      this.name = 'WorkerClientError';
    }
  }
  class MockLinkedinBlockingError extends MockWorkerClientError {}

  return {
    extractCompany: vi.fn(),
    resolveCompanyPage: vi.fn(),
    searchDecisionMakers: vi.fn(),
    LinkedinBlockingError: MockLinkedinBlockingError,
    WorkerClientError: MockWorkerClientError,
  };
});

vi.mock('../src/workerClient.js', () => workerMocks);

import { enrichBatch, enrichCompany, shouldSearchDecisionMakers } from '../src/enrich.js';
import { env } from '../src/env.js';
import { EnrichmentLeadProcessor } from '../src/leadSearch/leadProcessor.js';

const originalEnv = {
  brasilApiEnabled: env.brasilApiEnabled,
  linkedinEnabled: env.linkedinEnabled,
  workerMode: env.workerMode,
};

describe('decision-maker search policy', () => {
  beforeEach(() => {
    env.brasilApiEnabled = false;
    env.linkedinEnabled = true;
    env.workerMode = 'real';
    workerMocks.extractCompany.mockReset().mockResolvedValue(verifiedCompanyProfile());
    workerMocks.resolveCompanyPage.mockReset();
    workerMocks.searchDecisionMakers.mockReset().mockResolvedValue({
      success: true,
      source: 'puppeteer_linkedin',
      decision_makers: [],
      warnings: [],
    });
  });

  afterAll(() => {
    env.brasilApiEnabled = originalEnv.brasilApiEnabled;
    env.linkedinEnabled = originalEnv.linkedinEnabled;
    env.workerMode = originalEnv.workerMode;
  });

  it.each(['baixo', 'medio'] as const)('does not search at %s quality without an explicit requirement', (minQuality) => {
    expect(shouldSearchDecisionMakers({ minQuality })).toBe(false);
  });

  it.each([
    'requireDecisionMakerMatch',
    'requireRealDecisionMaker',
    'requireDecisionMakerProfile',
    'requireDecisionMakerContact',
    'requireDecisionMakerPhone',
  ] as const)('searches when %s is required regardless of quality', (filter) => {
    expect(shouldSearchDecisionMakers({ minQuality: 'baixo', [filter]: true })).toBe(true);
  });

  it('searches at medium quality when an explicit contact filter is not yet satisfied', () => {
    expect(shouldSearchDecisionMakers({ minQuality: 'medio', requireEmail: true }, {
      hasValidEmail: false,
    })).toBe(true);
    expect(shouldSearchDecisionMakers({ minQuality: 'medio', requirePhone: true }, {
      hasValidPhone: true,
    })).toBe(false);
    expect(shouldSearchDecisionMakers({ minQuality: 'baixo', requireNamedEmail: true }, {
      hasNamedPartnerEmail: false,
    })).toBe(true);
  });

  it('always searches at very high quality', () => {
    expect(shouldSearchDecisionMakers({ minQuality: 'muito_alto' }, {
      hasValidContact: true,
      hasVerifiedCompanyData: true,
      hasNamedPartnerEmail: true,
    })).toBe(true);
  });

  it('searches at high quality only while current evidence is insufficient', () => {
    expect(shouldSearchDecisionMakers({ minQuality: 'alto' }, {
      hasValidContact: true,
      hasVerifiedCompanyData: true,
    })).toBe(false);
    expect(shouldSearchDecisionMakers({ minQuality: 'alto' }, {
      hasValidContact: true,
      hasNamedPartnerEmail: true,
    })).toBe(false);
    expect(shouldSearchDecisionMakers({ minQuality: 'alto' }, {
      hasValidContact: false,
      hasVerifiedCompanyData: true,
    })).toBe(true);
    expect(shouldSearchDecisionMakers({ minQuality: 'alto' }, {
      hasValidContact: true,
    })).toBe(true);
  });

  it('does not call the remote decision-maker search for a medium lead search', async () => {
    await new EnrichmentLeadProcessor().process(search({ minQuality: 'medio', minScore: 50 }), candidate());

    expect(workerMocks.searchDecisionMakers).not.toHaveBeenCalled();
  });

  it('calls the remote decision-maker search when partner matching is mandatory', async () => {
    await new EnrichmentLeadProcessor().process(search({
      minQuality: 'medio',
      minScore: 50,
      requireDecisionMakerMatch: true,
    }), candidate());

    expect(workerMocks.searchDecisionMakers).toHaveBeenCalledTimes(1);
  });

  it('calls the remote decision-maker search when a required email is missing locally', async () => {
    await new EnrichmentLeadProcessor().process(
      search({ minQuality: 'medio', minScore: 50, requireEmail: true }),
      candidate({ email: undefined }),
    );

    expect(workerMocks.searchDecisionMakers).toHaveBeenCalledTimes(1);
  });

  it('calls the remote decision-maker search for very high quality', async () => {
    await new EnrichmentLeadProcessor().process(search({ minQuality: 'muito_alto', minScore: 85 }), candidate());

    expect(workerMocks.searchDecisionMakers).toHaveBeenCalledTimes(1);
  });

  it('avoids the remote decision-maker search when high-quality evidence is already sufficient', async () => {
    await new EnrichmentLeadProcessor().process(search({ minQuality: 'alto', minScore: 70 }), candidate());

    expect(workerMocks.extractCompany).toHaveBeenCalledTimes(1);
    expect(workerMocks.searchDecisionMakers).not.toHaveBeenCalled();
  });

  it('accepts a valid phone as sufficient contact even when the available email is generic', async () => {
    await new EnrichmentLeadProcessor().process(
      search({ minQuality: 'alto', minScore: 70, excludeGenericContacts: true }),
      candidate({ email: 'contato@acme.com.br' }),
    );

    expect(workerMocks.searchDecisionMakers).not.toHaveBeenCalled();
  });

  it('calls the remote decision-maker search when high-quality evidence is still insufficient', async () => {
    workerMocks.extractCompany.mockResolvedValue({
      success: true,
      linkedin_url: 'https://www.linkedin.com/company/acme',
      method_used: 'puppeteer_linkedin',
    });

    await new EnrichmentLeadProcessor().process(search({ minQuality: 'alto', minScore: 70 }), candidate());

    expect(workerMocks.searchDecisionMakers).toHaveBeenCalledTimes(1);
  });

  it('keeps CNPJ and partner names isolated in the decision-maker cache key', async () => {
    await enrichBatch({
      quality: 'muito_alta',
      rows: [
        companyInput({ cnpj: '11.111.111/0001-11', socios: 'Ana Silva' }),
        companyInput({ cnpj: '22.222.222/0001-22', socios: 'Ana Silva' }),
        companyInput({ cnpj: '11.111.111/0001-11', socios: 'Bruno Souza' }),
      ],
    });

    expect(workerMocks.searchDecisionMakers).toHaveBeenCalledTimes(3);
    expect(workerMocks.searchDecisionMakers.mock.calls.map(([payload]) => payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ cnpj: '11111111000111', partnerNames: ['Ana Silva'] }),
      expect.objectContaining({ cnpj: '22222222000122', partnerNames: ['Ana Silva'] }),
      expect.objectContaining({ cnpj: '11111111000111', partnerNames: ['Bruno Souza'] }),
    ]));
  });

  it('propagates an infrastructure failure instead of treating it as an empty functional result', async () => {
    workerMocks.searchDecisionMakers.mockResolvedValue({
      success: false,
      source: 'worker_error',
      decision_makers: [],
      warnings: ['Falha de rede controlada.'],
    });

    await expect(enrichCompany(companyInput(), { minQuality: 'muito_alto' }))
      .rejects.toThrow('Falha de rede controlada.');
  });

  it('keeps no_verified_match as a functional empty result', async () => {
    workerMocks.searchDecisionMakers.mockResolvedValue({
      success: false,
      source: 'puppeteer_linkedin',
      decision_makers: [],
      warnings: ['Nenhum decisor verificavel encontrado.'],
      errorCode: 'no_verified_match',
    });

    await expect(enrichCompany(companyInput(), { minQuality: 'muito_alto' })).resolves.toMatchObject({
      lead: { decisionMakers: [] },
    });
  });

  it('keeps rejected_by_filters as a functional business result', async () => {
    workerMocks.searchDecisionMakers.mockResolvedValue({
      success: false,
      source: 'puppeteer_linkedin',
      decision_makers: [],
      warnings: ['Resultado rejeitado pelos filtros informados.'],
      errorCode: 'rejected_by_filters',
    });

    await expect(enrichCompany(companyInput(), { minQuality: 'muito_alto' })).resolves.toMatchObject({
      lead: { decisionMakers: [] },
    });
  });
});

function verifiedCompanyProfile() {
  return {
    success: true,
    linkedin_url: 'https://www.linkedin.com/company/acme',
    name: 'Acme Tecnologia',
    industry: 'Tecnologia da informacao',
    description: 'Empresa de software B2B.',
    method_used: 'puppeteer_linkedin',
  };
}

function candidate(overrides: Partial<ReceitaCompany> = {}): ReceitaCompany {
  return {
    cnpj: '11.111.111/0001-11',
    legalName: 'Acme Tecnologia LTDA',
    tradingName: 'Acme Tecnologia',
    city: 'Florianopolis',
    uf: 'SC',
    cnae: '6201501',
    partners: ['Ana Silva'],
    email: 'operacoes@acme.com.br',
    phone: '+55 48 3333-1234',
    website: 'https://acme.com.br',
    linkedinUrl: 'https://www.linkedin.com/company/acme',
    ...overrides,
  };
}

function companyInput(overrides: Record<string, string | undefined> = {}) {
  const value = candidate();
  return {
    cnpj: value.cnpj,
    razaoSocial: value.legalName,
    nomeFantasia: value.tradingName,
    site: value.website,
    email: value.email,
    telefone: value.phone,
    socios: value.partners.join('; '),
    linkedinUrl: value.linkedinUrl,
    cidade: value.city,
    uf: value.uf,
    cnae: value.cnae,
    ...overrides,
  };
}

function search(overrides: Partial<LeadSearch> = {}): LeadSearch {
  return {
    id: 'search-policy-test',
    status: 'processing',
    uf: 'SC',
    city: 'Florianopolis',
    cnaes: ['6201501'],
    targetQuantity: 1,
    targetMode: 'fixed',
    minScore: 50,
    minQuality: 'medio',
    requirePhone: false,
    requireEmail: false,
    requireDecisionMakerMatch: false,
    onlyMobilePhone: false,
    emailType: 'any',
    onlyCorporateEmail: false,
    excludeGenericContacts: false,
    totalCandidatesFound: 1,
    totalProcessed: 0,
    totalValidLeads: 0,
    createdAt: '2026-07-21T12:00:00.000Z',
    updatedAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  };
}
