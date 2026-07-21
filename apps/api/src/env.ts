import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReceitaSourceKind } from './leadSearch/receitaSourceFactory.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const apiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDirectory = path.resolve(apiDirectory, '../..');

function projectPath(configured: string | undefined, fallback: string): string {
  const value = configured?.trim() || fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectDirectory, value);
}

function receitaSourceKind(value: string | undefined): ReceitaSourceKind {
  const normalized = (value?.trim() || 'csv').toLowerCase();
  if (normalized === 'csv' || normalized === 'sqlite') return normalized;
  throw new Error(`RECEITA_SOURCE invalido: ${normalized}. Use "sqlite" ou "csv".`);
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Valor booleano invalido: ${value}. Use true ou false.`);
}

function integerValue(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  const parsed = Number(raw || fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} invalido: use um inteiro entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

function workerModeValue(value: string | undefined): 'demo' | 'real' {
  const normalized = (value?.trim() || 'demo').toLowerCase();
  if (normalized === 'demo' || normalized === 'real') return normalized;
  throw new Error(`LINKEDIN_WORKER_MODE invalido: ${normalized}. Use "demo" ou "real".`);
}

function originList(value: string | undefined): string[] {
  const configured = value ?? 'http://localhost:5173,http://127.0.0.1:5173';
  return configured.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const url = new URL(item);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== item.replace(/\/$/, '')) {
      throw new Error(`API_CORS_ORIGINS invalido: use origens HTTP(S) sem caminho, como ${url.origin}.`);
    }
    return url.origin;
  });
}

const workerMode = workerModeValue(process.env.LINKEDIN_WORKER_MODE);
const linkedinEnabled = booleanValue(process.env.LINKEDIN_ENABLED, true);
const requestTimeoutMs = integerValue('REQUEST_TIMEOUT_MS', 120_000, 1_000, 900_000);

export const env = {
  port: integerValue('PORT', 7001, 1, 65_535),
  host: process.env.HOST ?? '0.0.0.0',
  apiCorsOrigins: originList(process.env.API_CORS_ORIGINS),
  workerUrl: process.env.WORKER_URL ?? 'http://127.0.0.1:8010',
  linkedinEnabled,
  searchProvider: linkedinEnabled ? (workerMode === 'demo' ? 'demo' : 'puppeteer') : 'disabled',
  brasilApiEnabled: booleanValue(process.env.BRASILAPI_ENABLED, false),
  brasilApiTimeoutMs: integerValue('BRASILAPI_TIMEOUT_MS', 9_000, 100, 60_000),
  maxBatchSize: integerValue('MAX_BATCH_SIZE', 200, 1, 10_000),
  requestTimeoutMs,
  leadOperationTimeoutMs: integerValue('LEAD_OPERATION_TIMEOUT_MS', requestTimeoutMs, 1_000, 1_800_000),
  workerMode,
  enrichConcurrency: integerValue('ENRICH_CONCURRENCY', 5, 1, 50),
  workerConcurrency: integerValue('WORKER_CONCURRENCY', 1, 1, 10),
  receitaSource: receitaSourceKind(process.env.RECEITA_SOURCE),
  receitaCsvPath: projectPath(process.env.RECEITA_CSV_PATH, 'apps/api/data/receita-demo.csv'),
  receitaSqlitePath: projectPath(process.env.RECEITA_SQLITE_PATH, 'D:/cnpj_ativo_final.db'),
  receitaSqliteBusyTimeoutMs: integerValue('RECEITA_SQLITE_BUSY_TIMEOUT_MS', 5_000, 0, 60_000),
  leadSearchDbPath: projectPath(process.env.LEAD_SEARCH_DB_PATH, 'apps/api/data/lead-search-db.json'),
  leadSearchBatchSize: integerValue('LEAD_SEARCH_BATCH_SIZE', 25, 1, 1_000),
};

export function findWebDist(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? null;
}
