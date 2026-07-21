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

function installedBrowserPath() {
  const candidates = isWindows
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((candidate) => candidate && existsSync(candidate));
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
  const browserPath = installedBrowserPath();
  run('npm', ['--prefix', 'services/linkedin-worker', ...npmInstallArgs], {
    env: browserPath ? { PUPPETEER_SKIP_DOWNLOAD: 'true', PUPPETEER_EXECUTABLE_PATH: browserPath } : {},
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
