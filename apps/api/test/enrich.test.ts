import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { env } from '../src/env.js';
import { LeadSearchService } from '../src/leadSearch/service.js';

let server: ReturnType<typeof buildServer>;

beforeAll(async () => {
  process.env.LINKEDIN_ENABLED = 'true';
  process.env.LINKEDIN_WORKER_MODE = 'demo';
  const leadSearchService = {
    initialize: async () => undefined,
    stop: async () => undefined,
    sourceMetadata: async () => ({
      kind: 'sqlite',
      readOnly: true,
      location: 'D:/segredo/cnpj.db',
      referenceDate: '13/06/2026',
      optimizedSearchIndex: false,
    }),
  } as unknown as LeadSearchService;
  server = buildServer({ leadSearchService });
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

describe('API MVP', () => {
  it('health returns ok even if worker is offline', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.leadSearch.source).toMatchObject({
      kind: 'sqlite',
      readOnly: true,
      referenceDate: '13/06/2026',
      optimizedSearchIndex: false,
    });
    expect(body.leadSearch.source).not.toHaveProperty('location');
    expect(JSON.stringify(body)).not.toContain('segredo');
  });

  it('validates empty payload', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/enrich', payload: { rows: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('exposes LinkedIn availability and blocks very high quality when disabled', async () => {
    const previous = env.linkedinEnabled;
    env.linkedinEnabled = false;
    try {
      const capabilities = await server.inject({ method: 'GET', url: '/api/capabilities' });
      expect(capabilities.json()).toMatchObject({
        linkedin: { enabled: false },
        quality: { muito_alto: false },
      });

      const create = await server.inject({
        method: 'POST',
        url: '/api/lead-searches',
        payload: { uf: 'SC', cnaes: ['7311400'], targetQuantity: 10, minQuality: 'muito_alto' },
      });
      expect(create.statusCode).toBe(400);
      expect(create.json().error).toContain('LINKEDIN_ENABLED=true');
    } finally {
      env.linkedinEnabled = previous;
    }
  });
});
