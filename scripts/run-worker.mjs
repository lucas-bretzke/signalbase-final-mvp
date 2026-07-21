import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { describePortOwner } from './port-owner.mjs';

const root = process.cwd();
const workerEntry = join(root, 'services', 'linkedin-worker', 'src', 'server.mjs');

if (!existsSync(workerEntry)) {
  console.error('Puppeteer worker not found. Run: npm run install:all');
  process.exit(1);
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      }),
  );
}

const rootEnv = readEnvFile(join(root, '.env'));
const workerPort = rootEnv.WORKER_PORT ?? '8010';
const expectedMode = String(rootEnv.LINKEDIN_WORKER_MODE ?? 'demo').toLowerCase();
const expectedVersion = '3.1.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerProbe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = await response.json();
    return {
      healthy: response.ok
        && body?.worker === 'signalbase-final-mvp-linkedin-worker'
        && body?.implementation === 'puppeteer'
        && body?.version === expectedVersion
        && body?.mode === expectedMode,
      body,
    };
  } catch {
    return { healthy: false };
  }
}

async function waitForWorkerHealthy(port) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const probe = await workerProbe(port);
    if (probe.healthy) return probe;
    await sleep(500);
  }
  return undefined;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(true));
  });
}

function keepCurrentProcessAlive() {
  const keepAlive = setInterval(() => {}, 2 ** 31 - 1);
  const shutdown = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const existingWorker = await waitForWorkerHealthy(workerPort);
if (existingWorker) {
  console.log(`LinkedIn worker already running at http://127.0.0.1:${workerPort}. Reusing it.`);
  keepCurrentProcessAlive();
} else if (await isPortOpen(workerPort)) {
  const owner = describePortOwner(workerPort);
  console.error(`Port ${workerPort} is occupied by ${owner}, but it is not the expected Puppeteer worker in mode ${expectedMode}.`);
  console.error(`Stop that process or change WORKER_PORT, then run npm run dev again.`);
  process.exit(1);
} else {
  const child = spawn(
    process.execPath,
    [workerEntry],
    {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        ...rootEnv,
      },
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}
