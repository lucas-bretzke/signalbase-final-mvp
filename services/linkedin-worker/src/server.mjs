import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { demoCompany, demoDecisionMakers, demoResolve } from './demo.mjs';
import { LinkedinBrowserWorker } from './linkedin-browser.mjs';
import {
  WorkerOperationError,
  asOperationError,
  createOperationContext,
  errorFromAbortSignal,
  sanitizeRequestId,
  statusForError,
} from './operation.mjs';

export const WORKER_VERSION = '3.2.0';

export function createWorkerServer({
  worker = new LinkedinBrowserWorker(config),
  options = config,
  logger = console,
  demo = { resolve: demoResolve, company: demoCompany, decisionMakers: demoDecisionMakers },
} = {}) {
  const log = loggerFunction(logger);
  return http.createServer(async (request, response) => {
    setJsonHeaders(response);
    if (request.method === 'OPTIONS') {
      send(response, 204);
      return;
    }

    const cancellation = new AbortController();
    const detachCancellation = bindRequestCancellation(request, response, cancellation);
    let context;
    let requestId = sanitizeRequestId(request.headers['x-request-id']);
    const startedAt = Date.now();
    let status = 200;
    let errorCode;

    try {
      response.setHeader('x-request-id', requestId);
      if (!isAuthorized(request, options)) {
        throw new WorkerOperationError('worker_unauthorized');
      }

      if (request.method === 'GET' && request.url === '/health') {
        return send(response, 200, {
          ok: true,
          worker: 'signalbase-final-mvp-linkedin-worker',
          implementation: 'puppeteer',
          version: WORKER_VERSION,
          enabled: options.enabled,
          mode: options.mode,
          runtimeMode: options.mode,
          ...worker.health(),
          time: Math.floor(Date.now() / 1_000),
        });
      }

      context = createOperationContext({
        requestId,
        deadline: request.headers['x-request-deadline'],
        signal: cancellation.signal,
        defaultTimeoutMs: options.operationTimeoutMs,
        maxTimeoutMs: options.maxOperationTimeoutMs,
      });

      if (!options.enabled) {
        status = 503;
        return send(response, status, {
          success: false,
          source: 'linkedin_disabled',
          error: 'Cruzamento com LinkedIn desativado por LINKEDIN_ENABLED=false.',
        });
      }

      const body = await readJson(request, context);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new WorkerOperationError('invalid_request', 'O payload JSON deve ser um objeto.');
      }
      if (!request.headers['x-request-id'] && (body.request_id ?? body.requestId)) {
        context.setRequestId(body.request_id ?? body.requestId);
        requestId = context.requestId;
      }
      if (!request.headers['x-request-deadline'] && body.deadline !== undefined) {
        context.setDeadline(body.deadline);
      }
      response.setHeader('x-request-id', requestId);
      context.throwIfUnavailable();
      const payload = withoutOperationMetadata(body);

      let result;
      if (request.method === 'POST' && request.url === '/company/resolve') {
        result = options.mode === 'demo' ? demo.resolve(payload) : await worker.resolveCompany(payload, context);
      } else if (request.method === 'POST' && request.url === '/company/extract') {
        result = options.mode === 'demo' ? demo.company(payload) : await worker.extractCompany(payload.linkedin_url, context);
      } else if (request.method === 'POST' && request.url === '/decision-makers/search') {
        result = options.mode === 'demo' ? demo.decisionMakers(payload) : await worker.searchDecisionMakers(payload, context);
      } else if (request.method === 'POST' && request.url === '/session/check') {
        result = options.mode === 'demo'
          ? { ok: true, authenticated: false, sessionState: 'demo', runtimeMode: 'demo', checkedAt: new Date().toISOString() }
          : await worker.checkSession(context);
      } else {
        status = 404;
        return send(response, status, withOperationMetadata({ success: false, error: 'Rota do worker nao encontrada.' }, context));
      }

      context.throwIfUnavailable();
      status = 200;
      return send(response, status, withOperationMetadata(result, context));
    } catch (error) {
      const fallbackCode = error?.name === 'SyntaxError' || /Payload maior/i.test(String(error?.message ?? ''))
        ? 'invalid_request'
        : 'navigation_error';
      const typed = asOperationError(error, context ?? { signal: cancellation.signal }, fallbackCode);
      status = statusForError(typed);
      errorCode = typed.code;
      return send(response, status, withOperationMetadata({
        success: false,
        source: 'puppeteer_worker_error',
        errorCode: typed.code,
        error: typed.message,
      }, context, requestId));
    } finally {
      context?.dispose();
      detachCancellation();
      log({
        event: 'linkedin_worker_http',
        requestId,
        method: request.method,
        route: String(request.url ?? '').split('?')[0].slice(0, 120),
        status,
        errorCode,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    }
  });
}

export async function startWorkerServer({ options = config, logger = console } = {}) {
  const worker = new LinkedinBrowserWorker(options, { logger });
  await worker.initialize();
  const server = createWorkerServer({ worker, options, logger });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  logger.info?.(`SignalBase LinkedIn worker (Puppeteer) em http://${options.host}:${options.port}`);
  logger.info?.(`LinkedIn: ${options.enabled ? options.mode : 'disabled'}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info?.(`Encerrando worker (${signal})...`);
    await new Promise((resolve) => server.close(resolve));
    await worker.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  return { server, worker, shutdown };
}

function bindRequestCancellation(request, response, controller) {
  const cancel = () => {
    if (!controller.signal.aborted) controller.abort(new WorkerOperationError('request_cancelled'));
  };
  const onRequestClose = () => {
    if (request.aborted || (!request.complete && !response.writableEnded)) cancel();
  };
  const onResponseClose = () => {
    if (!response.writableEnded) cancel();
  };
  request.once('aborted', cancel);
  request.once('close', onRequestClose);
  response.once('close', onResponseClose);
  return () => {
    request.off('aborted', cancel);
    request.off('close', onRequestClose);
    response.off('close', onResponseClose);
  };
}

function setJsonHeaders(response) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
}

function send(response, status, body) {
  if (!canWrite(response)) return false;
  response.writeHead(status);
  response.end(body === undefined ? undefined : JSON.stringify(body));
  return true;
}

function canWrite(response) {
  return !response.destroyed && !response.writableEnded && response.writable !== false;
}

async function readJson(request, context) {
  if (request.method === 'GET') return {};
  context?.throwIfUnavailable();
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      context?.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      finish(errorFromAbortSignal(context.signal));
      request.resume();
    };
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      try {
        context?.throwIfUnavailable();
        size += chunk.length;
        if (size > 1_000_000) {
          finish(new WorkerOperationError('invalid_request', 'Payload maior que 1 MB.'));
          request.resume();
          return;
        }
        chunks.push(chunk);
      } catch (error) {
        finish(error);
        request.resume();
      }
    };
    const onEnd = () => {
      try {
        context?.throwIfUnavailable();
        finish(undefined, chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        finish(error);
      }
    };

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    context?.signal?.addEventListener('abort', onAbort, { once: true });
    if (context?.signal?.aborted) onAbort();
  });
}

function withOperationMetadata(body, context, requestId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return {
    ...body,
    requestId: context?.requestId ?? requestId,
    deadline: context?.deadline,
    timing: context ? {
      elapsedMs: context.elapsedMs(),
      queueWaitMs: context.queueWaitMs,
      remainingMs: context.remainingMs(),
    } : undefined,
  };
}

function withoutOperationMetadata(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { request_id: _requestId, requestId: _camelRequestId, deadline: _deadline, ...payload } = body;
  return payload;
}

function loggerFunction(logger) {
  if (typeof logger === 'function') return logger;
  if (typeof logger?.info === 'function') return (event) => logger.info(JSON.stringify(event));
  return () => undefined;
}

function isAuthorized(request, options) {
  const expected = String(options.authToken ?? '').trim();
  if (!expected) return true;
  const header = request.headers.authorization;
  const received = typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

const mainFile = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (mainFile && mainFile.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  await startWorkerServer();
}
