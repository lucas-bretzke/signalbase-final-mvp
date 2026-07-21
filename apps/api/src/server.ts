import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, findWebDist } from './env.js';
import { enrichBatch } from './enrich.js';
import { batchRequestSchema } from './validation.js';
import { isWorkerClientError, testLinkedinSession, workerHealth } from './workerClient.js';
import { JsonLeadSearchRepository } from './leadSearch/jsonRepository.js';
import { EnrichmentLeadProcessor } from './leadSearch/leadProcessor.js';
import { createReceitaCompanySource } from './leadSearch/receitaSourceFactory.js';
import { registerLeadSearchRoutes } from './leadSearch/routes.js';
import { LeadSearchService } from './leadSearch/service.js';
import { WorkerErrorCode } from './types.js';

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

  const allowedOrigins = new Set(env.apiCorsOrigins);
  app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  });

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
        headless: typeof worker.headless === 'boolean' ? worker.headless : undefined,
        lastCheckedAt: worker.last_checked_at ?? worker.lastCheckedAt,
        lastError: worker.last_error ?? worker.lastError ?? worker.error,
        errorCode: worker.errorCode,
      },
      quality: {
        muito_alto: env.linkedinEnabled
          && worker.ok === true
          && worker.ready === true
          && worker.mode === env.workerMode,
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
    try {
      return await enrichBatch(parsed.data);
    } catch (error) {
      if (!isWorkerClientError(error)) throw error;
      return reply.status(workerErrorHttpStatus(error.code)).send({
        ok: false,
        errorCode: error.code,
        error: publicWorkerErrorMessage(error.code),
        requestId: error.requestId,
      });
    }
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

function workerErrorHttpStatus(code: WorkerErrorCode): number {
  if (code === 'invalid_request') return 400;
  if (code === 'auth_required') return 401;
  if (code === 'challenge') return 409;
  if (code === 'queue_full') return 429;
  if (code === 'request_cancelled') return 499;
  if (code === 'navigation_error' || code === 'network_error') return 502;
  if (code === 'deadline_exceeded') return 504;
  return 503;
}

function publicWorkerErrorMessage(code: WorkerErrorCode): string {
  if (code === 'auth_required') return 'A sessao autorizada do LinkedIn precisa de login.';
  if (code === 'challenge') return 'O LinkedIn solicitou verificacao manual.';
  if (code === 'deadline_exceeded') return 'O prazo da operacao foi excedido.';
  if (code === 'request_cancelled') return 'A operacao foi cancelada.';
  if (code === 'queue_timeout') return 'O tempo maximo de espera na fila foi excedido.';
  if (code === 'queue_full') return 'A fila do worker esta cheia.';
  if (code === 'navigation_error') return 'A pagina nao pode ser carregada.';
  if (code === 'network_error') return 'Falha transitoria de rede durante a operacao.';
  if (code === 'invalid_request') return 'A requisicao enviada ao worker e invalida.';
  if (code === 'wrong_worker') return 'O servico configurado nao e o worker esperado.';
  return 'O worker do LinkedIn esta indisponivel.';
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
