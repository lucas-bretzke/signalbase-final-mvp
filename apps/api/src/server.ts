import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, findWebDist } from './env.js';
import { enrichBatch } from './enrich.js';
import { batchRequestSchema } from './validation.js';
import { testLinkedinSession, workerHealth } from './workerClient.js';
import { JsonLeadSearchRepository } from './leadSearch/jsonRepository.js';
import { EnrichmentLeadProcessor } from './leadSearch/leadProcessor.js';
import { createReceitaCompanySource } from './leadSearch/receitaSourceFactory.js';
import { registerLeadSearchRoutes } from './leadSearch/routes.js';
import { LeadSearchService } from './leadSearch/service.js';

export interface BuildServerOptions {
  leadSearchService?: LeadSearchService;
}

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
    },
  });

  app.register(cors, { origin: true });

  const leadSearchService = options.leadSearchService ?? new LeadSearchService(
    new JsonLeadSearchRepository(env.leadSearchDbPath),
    createReceitaCompanySource({
      kind: env.receitaSource,
      csvPath: env.receitaCsvPath,
      sqlitePath: env.receitaSqlitePath,
      sqliteBusyTimeoutMs: env.receitaSqliteBusyTimeoutMs,
    }),
    new EnrichmentLeadProcessor(),
    { batchSize: env.leadSearchBatchSize },
  );
  app.addHook('onReady', () => leadSearchService.initialize());
  app.addHook('onClose', () => leadSearchService.stop());
  registerLeadSearchRoutes(app, leadSearchService);

  app.get('/api/health', async () => {
    const [source, worker] = await Promise.all([
      leadSearchService.sourceMetadata(),
      workerHealth(),
    ]);
    return {
      ok: true,
      api: 'signalbase-final-mvp-api',
      version: '2.1.0',
      provider: env.searchProvider,
      mode: env.workerMode,
      leadSearch: {
        source: source ? {
          kind: source.kind,
          readOnly: source.readOnly,
          referenceDate: source.referenceDate,
          declaredCnpjCount: source.declaredCnpjCount,
          sqliteVersion: source.sqliteVersion,
          optimizedSearchIndex: source.optimizedSearchIndex,
          warning: source.warning,
        } : undefined,
        persistence: {
          kind: 'atomic-json',
        },
      },
      worker,
    };
  });

  app.get('/api/capabilities', async () => {
    const worker = await workerHealth();
    return {
      linkedin: {
        enabled: env.linkedinEnabled,
        mode: env.workerMode,
        provider: env.searchProvider,
        ready: worker.ready === true,
        implementation: String(worker.implementation ?? ''),
        runtimeMode: String(worker.runtimeMode ?? worker.mode ?? env.workerMode),
        sessionState: String(worker.session_state ?? worker.sessionState ?? 'not_checked'),
        headless: worker.headless === true,
        lastCheckedAt: worker.last_checked_at ?? worker.lastCheckedAt,
        lastError: worker.last_error ?? worker.lastError ?? worker.error,
        errorCode: worker.errorCode,
      },
      quality: {
        muito_alto: env.linkedinEnabled && worker.ok === true && worker.mode === env.workerMode,
      },
    };
  });

  app.post('/api/linkedin/test', async (_request, reply) => {
    const result = await testLinkedinSession();
    return reply.status(result.ready === true || env.workerMode === 'demo' ? 200 : 503).send(result);
  });

  app.get('/api/demo-input', async () => ({
    csv: [
      'cnpj,razao_social,nome_fantasia,site,email,telefone,socios,linkedin_url',
      '00.000.000/0001-91,Banco do Brasil SA,Banco do Brasil,https://bb.com.br,atendimento.empresas@bb.com.br,,Carolina Mendes - Diretora,',
      '11.222.333/0001-81,Tech Azul Solutions LTDA,Tech Azul,https://techazul.com.br,contato@techazul.com.br,+55 11 4002-1100,Marina Costa - Socia Administradora,',
      '22.333.444/0001-72,Vertice Cloud Consultoria LTDA,Vertice Cloud,https://verticecloud.com.br,comercial@verticecloud.com.br,,Andre Valente - Socio,',
      '33.444.555/0001-10,Orbital Pay Instituicao de Pagamento SA,Orbital Pay,https://orbitalpay.com.br,parcerias@orbitalpay.com.br,+55 31 3555-4500,Bianca Rocha - Diretora,',
      '99.999.999/0001-00,Empresa Sem LinkedIn LTDA,Empresa Sem LinkedIn,,,,,',
    ].join('\n'),
  }));

  app.post('/api/enrich', async (request, reply) => {
    const parsed = batchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Payload invalido', details: parsed.error.flatten() });
    }
    const result = await enrichBatch(parsed.data);
    return result;
  });

  const webDist = findWebDist();
  if (webDist) {
    app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/')) {
        return reply.status(404).send({ ok: false, error: 'API route not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = buildServer();
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Encerrando a API com seguranca.');
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error(error, 'Falha ao encerrar a API.');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  app.listen({ port: env.port, host: env.host }).catch(async (error) => {
    app.log.error(error);
    await app.close().catch((closeError) => app.log.error(closeError, 'Falha ao liberar recursos da API.'));
    process.exitCode = 1;
  });
}
