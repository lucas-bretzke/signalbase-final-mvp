import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const venvDir = join(root, '.venv');
const python = isWindows
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python');

if (!existsSync(python)) {
  console.error('Python worker environment not found. Run: npm run install:all');
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

async function isWorkerHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = await response.json();
    return response.ok && body?.worker === 'signalbase-final-mvp-linkedin-worker';
  } catch {
    return false;
  }
}

if (await isWorkerHealthy(workerPort)) {
  console.log(`LinkedIn worker already running at http://127.0.0.1:${workerPort}. Reusing it.`);
  const keepAlive = setInterval(() => {}, 2 ** 31 - 1);
  const shutdown = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else {
  const child = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', workerPort],
    {
      cwd: join(root, 'services/linkedin-worker'),
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        ...rootEnv,
        PYTHONUNBUFFERED: '1',
      },
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}
