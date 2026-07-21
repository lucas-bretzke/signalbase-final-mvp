import http from 'node:http';
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

  it('allows configured local browser origins and does not reflect arbitrary origins', async () => {
    const allowed = await server.inject({
      method: 'OPTIONS',
      url: '/api/enrich',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
      },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await server.inject({
      method: 'OPTIONS',
      url: '/api/enrich',
      headers: {
        origin: 'https://untrusted.invalid',
        'access-control-request-method': 'POST',
      },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preserves typed worker deadline errors at the public API boundary', async () => {
    const worker = http.createServer((_request, response) => {
      response.statusCode = 504;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        success: false,
        errorCode: 'deadline_exceeded',
        error: 'internal-sensitive-worker-detail',
      }));
    });
    await new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.listen(0, '127.0.0.1', () => resolve());
    });
    const address = worker.address();
    if (!address || typeof address === 'string') throw new Error('Worker fixture sem porta TCP.');
    const previousWorkerUrl = env.workerUrl;
    env.workerUrl = `http://127.0.0.1:${address.port}`;
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/enrich',
        payload: {
          quality: 'alta',
          rows: [{
            cnpj: '11.111.111/0001-11',
            razaoSocial: 'Acme Ltda',
            linkedinUrl: 'https://www.linkedin.com/company/acme',
          }],
        },
      });
      expect(response.statusCode).toBe(504);
      expect(response.json()).toMatchObject({ ok: false, errorCode: 'deadline_exceeded' });
      expect(response.body).not.toContain('internal-sensitive-worker-detail');
    } finally {
      env.workerUrl = previousWorkerUrl;
      await new Promise<void>((resolve) => worker.close(() => resolve()));
    }
  });

  it('resumes a blocked demo job from passive worker readiness', async () => {
    const worker = http.createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        worker: 'signalbase-final-mvp-linkedin-worker',
        implementation: 'puppeteer',
        version: '3.2.0',
        enabled: true,
        mode: 'demo',
        ready: true,
        session_state: 'demo',
      }));
    });
    await new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.listen(0, '127.0.0.1', () => resolve());
    });
    const address = worker.address();
    if (!address || typeof address === 'string') throw new Error('Worker fixture sem porta TCP.');
    const previous = { workerUrl: env.workerUrl, workerMode: env.workerMode, linkedinEnabled: env.linkedinEnabled };
    env.workerUrl = `http://127.0.0.1:${address.port}`;
    env.workerMode = 'demo';
    env.linkedinEnabled = true;
    const blockedSearch = { id: 'blocked-demo', status: 'blocked' };
    const leadSearchService = {
      initialize: async () => undefined,
      stop: async () => undefined,
      sourceMetadata: async () => undefined,
      get: async () => blockedSearch,
      resume: async () => ({ ...blockedSearch, status: 'queued' }),
    } as unknown as LeadSearchService;
    const demoServer = buildServer({ leadSearchService });
    try {
      await demoServer.ready();
      const response = await demoServer.inject({
        method: 'POST',
        url: '/api/lead-searches/blocked-demo/resume',
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ search: { id: 'blocked-demo', status: 'queued' } });
    } finally {
      await demoServer.close();
      env.workerUrl = previous.workerUrl;
      env.workerMode = previous.workerMode;
      env.linkedinEnabled = previous.linkedinEnabled;
      await new Promise<void>((resolve) => worker.close(() => resolve()));
    }
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

      const confidenceCreate = await server.inject({
        method: 'POST',
        url: '/api/lead-searches',
        payload: {
          uf: 'SC',
          cnaes: ['7311400'],
          targetQuantity: 10,
          minQuality: 'medio',
          matchConfidenceLevel: 'alta',
        },
      });
      expect(confidenceCreate.statusCode).toBe(400);
    } finally {
      env.linkedinEnabled = previous;
    }
  });
});
