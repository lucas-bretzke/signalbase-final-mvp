import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const projectDirectory = path.resolve(serviceDirectory, '../..');

loadEnvironment(path.join(projectDirectory, '.env'));

export const config = {
  enabled: booleanValue('LINKEDIN_ENABLED', true),
  mode: stringValue('LINKEDIN_WORKER_MODE', 'demo').toLowerCase(),
  host: stringValue('WORKER_HOST', '127.0.0.1'),
  port: integerValue('WORKER_PORT', 8010, 1),
  headless: booleanValue('PUPPETEER_HEADLESS', true),
  executablePath: optionalString('PUPPETEER_EXECUTABLE_PATH') ?? installedBrowserPath(),
  profileDirectory: projectPath('LINKEDIN_BROWSER_PROFILE_DIR', 'data/linkedin-browser-profile'),
  cachePath: projectPath('LINKEDIN_CACHE_PATH', 'data/linkedin-browser-cache.json'),
  navigationTimeoutMs: integerValue('PUPPETEER_NAVIGATION_TIMEOUT_MS', 45_000, 5_000),
  minDelayMs: integerValue('PUPPETEER_MIN_DELAY_MS', 1_500, 0),
  cacheTtlMs: integerValue('PUPPETEER_CACHE_TTL_HOURS', 168, 1) * 60 * 60 * 1_000,
  maxCompanyCandidates: integerValue('PUPPETEER_MAX_COMPANY_CANDIDATES', 3, 1),
  maxPeopleSearches: integerValue('PUPPETEER_MAX_PEOPLE_SEARCHES', 8, 1),
  maxContactProfiles: integerValue('PUPPETEER_MAX_CONTACT_PROFILES', 3, 0),
  extractProfileContacts: booleanValue('PUPPETEER_EXTRACT_PROFILE_CONTACTS', true),
};

function loadEnvironment(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function projectPath(name, fallback) {
  const value = optionalString(name) ?? fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectDirectory, value);
}

function optionalString(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function stringValue(name, fallback) {
  return optionalString(name) ?? fallback;
}

function booleanValue(name, fallback) {
  const value = optionalString(name)?.toLowerCase();
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function integerValue(name, fallback, minimum) {
  const parsed = Number(optionalString(name) ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.trunc(parsed)) : fallback;
}

function installedBrowserPath() {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        localAppData ? path.join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}
