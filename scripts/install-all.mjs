import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const isWindows = process.platform === 'win32';

function run(command, args, options = {}) {
  const executable = isWindows && command === 'npm' ? 'npm.cmd' : command;
  const useShell = isWindows && command === 'npm';
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: useShell,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    const rendered = [command, ...args].join(' ');
    throw new Error(`Command failed: ${rendered}`);
  }
}

function findPython() {
  const candidates = isWindows
    ? [
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

  for (const [command, prefixArgs] of candidates) {
    const result = spawnSync(command, [...prefixArgs, '--version'], {
      stdio: 'ignore',
      shell: false,
    });
    if (result.status === 0) return { command, prefixArgs };
  }
  throw new Error('Python 3 was not found. Install Python 3 and run npm run install:all again.');
}

async function main() {
  if (!existsSync(join(root, '.env'))) {
    await mkdir(root, { recursive: true });
    run('node', ['-e', "require('fs').copyFileSync('.env.example', '.env')"]);
  }

  const npmInstallArgs = [
    'install',
    '--registry=https://registry.npmjs.org/',
    '--strict-ssl=false',
    '--no-audit',
    '--no-fund',
  ];
  run('npm', npmInstallArgs);
  run('npm', ['--prefix', 'apps/api', ...npmInstallArgs]);
  run('npm', ['--prefix', 'apps/web', ...npmInstallArgs]);

  const python = findPython();
  const venvDir = join(root, '.venv');
  if (!existsSync(venvDir)) {
    run(python.command, [...python.prefixArgs, '-m', 'venv', '.venv']);
  }

  const venvPython = isWindows
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');

  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-r', 'services/linkedin-worker/requirements.txt']);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
