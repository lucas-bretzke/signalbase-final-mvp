import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const projectDirectory = path.resolve(serviceDirectory, '../..');

loadEnvironment(path.join(projectDirectory, '.env'));

export const config = {
  enabled: booleanValue('LINKEDIN_ENABLED', true),
  mode: workerModeValue('LINKEDIN_WORKER_MODE', 'demo'),
  host: stringValue('WORKER_HOST', '127.0.0.1'),
  port: integerValue('WORKER_PORT', 8010, 1, 65_535),
  headless: booleanValue('PUPPETEER_HEADLESS', true),
  executablePath: optionalString('PUPPETEER_EXECUTABLE_PATH') ?? installedBrowserPath(),
  profileDirectory: projectPath('LINKEDIN_BROWSER_PROFILE_DIR', 'data/linkedin-browser-profile'),
  cachePath: projectPath('LINKEDIN_CACHE_PATH', 'data/linkedin-browser-cache.json'),
  navigationTimeoutMs: integerValue('PUPPETEER_NAVIGATION_TIMEOUT_MS', 45_000, 5_000, 120_000),
  minDelayMs: integerValue('PUPPETEER_MIN_DELAY_MS', 1_500, 0, 60_000),
  postNavigationDelayMs: integerValue('PUPPETEER_POST_NAVIGATION_DELAY_MS', 900, 0, 10_000),
  operationTimeoutMs: integerValue('WORKER_OPERATION_TIMEOUT_MS', 110_000, 1_000, 300_000),
  maxOperationTimeoutMs: integerValue('WORKER_MAX_OPERATION_TIMEOUT_MS', 300_000, 1_000, 900_000),
  minNavigationBudgetMs: integerValue('WORKER_MIN_NAVIGATION_BUDGET_MS', 5_000, 100, 60_000),
  queueWaitTimeoutMs: integerValue('WORKER_QUEUE_WAIT_TIMEOUT_MS', 30_000, 100, 300_000),
  maxQueueDepth: integerValue('WORKER_MAX_QUEUE_DEPTH', 8, 1, 100),
  cacheTtlMs: integerValue('PUPPETEER_CACHE_TTL_HOURS', 168, 1, 720) * 60 * 60 * 1_000,
  negativeCacheTtlMs: integerValue('PUPPETEER_NEGATIVE_CACHE_TTL_MINUTES', 15, 1, 1_440) * 60 * 1_000,
  emptyCacheTtlMs: integerValue('PUPPETEER_EMPTY_CACHE_TTL_MINUTES', 15, 1, 1_440) * 60 * 1_000,
  cacheSchemaVersion: 2,
  extractorVersion: 'linkedin-extractors-v2',
  maxCompanyCandidates: integerValue('PUPPETEER_MAX_COMPANY_CANDIDATES', 3, 1, 10),
  maxPeopleSearches: integerValue('PUPPETEER_MAX_PEOPLE_SEARCHES', 8, 1, 30),
  maxContactProfiles: integerValue('PUPPETEER_MAX_CONTACT_PROFILES', 3, 0, 20),
  extractProfileContacts: booleanValue('PUPPETEER_EXTRACT_PROFILE_CONTACTS', true),
};

if (config.maxOperationTimeoutMs < config.operationTimeoutMs) {
  throw new Error('WORKER_MAX_OPERATION_TIMEOUT_MS deve ser maior ou igual a WORKER_OPERATION_TIMEOUT_MS.');
}

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
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} invalido: use true ou false.`);
}

function workerModeValue(name, fallback) {
  const value = stringValue(name, fallback).toLowerCase();
  if (value === 'demo' || value === 'real') return value;
  throw new Error(`${name} invalido: use "demo" ou "real".`);
}

function integerValue(name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const configured = optionalString(name);
  const parsed = Number(configured ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} invalido: informe um inteiro entre ${minimum} e ${maximum}.`);
  }
  return parsed;
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
