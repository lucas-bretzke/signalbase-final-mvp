import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('enrich fast path', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SEARCH_PROVIDER = 'demo';
    process.env.LINKEDIN_WORKER_MODE = 'real';
    process.env.BRASILAPI_ENABLED = 'false';
    process.env.ENRICH_CONCURRENCY = '5';
    process.env.WORKER_CONCURRENCY = '2';
  });

  it('skips worker-only data when baixa only needs a company page', async () => {
    const { enrichBatch } = await import('../src/enrich.js');
    const result = await enrichBatch({
      quality: 'baixa',
      maxDecisionMakers: 8,
      rows: [
        {
          cnpj: '00.000.000/0001-91',
          razaoSocial: 'Banco do Brasil SA',
          nomeFantasia: 'Banco do Brasil',
        },
      ],
    });

    expect(result.returned).toBe(1);
    expect(result.leads[0].quality).toBe('baixa');
    expect(result.leads[0].linkedinUrl).toBe('https://www.linkedin.com/company/banco-do-brasil');
    expect(result.leads[0].decisionMakers).toEqual([]);
    expect(result.leads[0].evidence).not.toContain('Company info via demo');
  });
});
