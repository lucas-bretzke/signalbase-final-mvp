import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { describePortOwner } from './port-owner.mjs';

const root = process.cwd();
const apiPackage = join(root, 'apps', 'api', 'package.json');

if (!existsSync(apiPackage)) {
  console.error('API app not found. Run this command from the project root.');
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
const apiPort = rootEnv.PORT ?? '7001';
const expectedVersion = '2.1.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isApiHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    const body = await response.json();
    return response.ok && body?.api === 'signalbase-final-mvp-api' && body?.version === expectedVersion;
  } catch {
    return false;
  }
}

async function waitForApiHealthy(port) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await isApiHealthy(port)) return true;
    await sleep(500);
  }
  return false;
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

if (await waitForApiHealthy(apiPort)) {
  console.log(`API already running at http://127.0.0.1:${apiPort}. Reusing it.`);
  keepCurrentProcessAlive();
} else if (await isPortOpen(apiPort)) {
  const owner = describePortOwner(apiPort);
  console.error(`Port ${apiPort} is occupied by ${owner}, but it is not the SignalBase API.`);
  console.error(`Stop that process or change PORT, then run npm run dev again.`);
  process.exit(1);
} else {
  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['--prefix', 'apps/api', 'run', 'dev'],
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
