import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createWorkerServer } from '../src/server.mjs';

const options = {
  enabled: true,
  mode: 'real',
  operationTimeoutMs: 2_000,
  maxOperationTimeoutMs: 5_000,
};

function fakeWorker(overrides = {}) {
  return {
    health: () => ({ ready: true }),
    resolveCompany: async () => ({ success: true, confidence: 99, provider: 'test', reason: 'ok' }),
    extractCompany: async () => ({ success: true }),
    searchDecisionMakers: async () => ({ success: true, source: 'test', decision_makers: [], warnings: [] }),
    checkSession: async () => ({ ok: true, authenticated: true }),
    ...overrides,
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function post(port, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

test('accepts request metadata without passing it into cache-affecting worker payloads', async (t) => {
  let received;
  const worker = fakeWorker({
    resolveCompany: async (payload, context) => {
      received = { payload, requestId: context.requestId, deadline: context.deadline };
      return { success: true, confidence: 99, provider: 'test', reason: 'ok' };
    },
  });
  const server = createWorkerServer({ worker, options, logger: () => undefined });
  const port = await listen(server);
  t.after(() => close(server));
  const deadline = Date.now() + 1_000;
  const response = await post(port, '/company/resolve', {
    company_name: 'Acme',
    request_id: 'body-id',
    deadline,
  }, { 'x-request-id': 'header-id' });

  assert.equal(response.status, 200);
  assert.deepEqual(received.payload, { company_name: 'Acme' });
  assert.equal(received.requestId, 'header-id');
  assert.equal(received.deadline, deadline);
  assert.equal(response.headers['x-request-id'], 'header-id');
  assert.equal(response.body.requestId, 'header-id');
  assert.equal(response.body.deadline, deadline);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('rejects an invalid deadline with a stable typed response', async (t) => {
  const server = createWorkerServer({ worker: fakeWorker(), options, logger: () => undefined });
  const port = await listen(server);
  t.after(() => close(server));
  const response = await post(port, '/company/resolve', { company_name: 'Acme', deadline: 'tomorrow' });
  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'invalid_request');
});

test('rejects a JSON payload that is not an object', async (t) => {
  const server = createWorkerServer({ worker: fakeWorker(), options, logger: () => undefined });
  const port = await listen(server);
  t.after(() => close(server));
  const response = await post(port, '/company/resolve', null);
  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'invalid_request');
});

test('a disconnected HTTP client cancels the in-flight worker context', async (t) => {
  let markStarted;
  let markCancelled;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const cancelled = new Promise((resolve) => { markCancelled = resolve; });
  const worker = fakeWorker({
    extractCompany: async (_url, context) => new Promise((_resolve, reject) => {
      markStarted();
      context.signal.addEventListener('abort', () => {
        markCancelled(context.signal.reason?.code);
        reject(context.signal.reason);
      }, { once: true });
    }),
  });
  const server = createWorkerServer({ worker, options, logger: () => undefined });
  const port = await listen(server);
  t.after(() => close(server));

  const request = http.request({
    host: '127.0.0.1',
    port,
    path: '/company/extract',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  request.on('error', () => undefined);
  request.end(JSON.stringify({ linkedin_url: 'https://www.linkedin.com/company/acme' }));
  await started;
  request.destroy();
  assert.equal(await cancelled, 'request_cancelled');
});
