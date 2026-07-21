import http from 'node:http';
import { config } from './config.mjs';
import { demoCompany, demoDecisionMakers, demoResolve } from './demo.mjs';
import { LinkedinBrowserWorker } from './linkedin-browser.mjs';

const worker = new LinkedinBrowserWorker(config);
await worker.initialize();

const server = http.createServer(async (request, response) => {
  setJsonHeaders(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      return send(response, 200, {
        ok: true,
        worker: 'signalbase-final-mvp-linkedin-worker',
        implementation: 'puppeteer',
        enabled: config.enabled,
        mode: config.mode,
        ...worker.health(),
        time: Math.floor(Date.now() / 1_000),
      });
    }

    if (!config.enabled) {
      return send(response, 503, {
        success: false,
        source: 'linkedin_disabled',
        error: 'Cruzamento com LinkedIn desativado por LINKEDIN_ENABLED=false.',
      });
    }

    const body = await readJson(request);
    if (request.method === 'POST' && request.url === '/company/resolve') {
      return send(response, 200, config.mode === 'demo' ? demoResolve(body) : await worker.resolveCompany(body));
    }
    if (request.method === 'POST' && request.url === '/company/extract') {
      return send(response, 200, config.mode === 'demo' ? demoCompany(body) : await worker.extractCompany(body.linkedin_url));
    }
    if (request.method === 'POST' && request.url === '/decision-makers/search') {
      return send(response, 200, config.mode === 'demo' ? demoDecisionMakers(body) : await worker.searchDecisionMakers(body));
    }
    return send(response, 404, { success: false, error: 'Rota do worker nao encontrada.' });
  } catch (error) {
    return send(response, 500, {
      success: false,
      source: 'puppeteer_worker_error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`SignalBase LinkedIn worker (Puppeteer) em http://${config.host}:${config.port}`);
  console.log(`LinkedIn: ${config.enabled ? config.mode : 'disabled'}; perfil: ${config.profileDirectory}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Encerrando worker (${signal})...`);
  server.close();
  await worker.close();
  process.exitCode = 0;
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function setJsonHeaders(response) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
}

function send(response, status, body) {
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.method === 'GET') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Payload maior que 1 MB.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
