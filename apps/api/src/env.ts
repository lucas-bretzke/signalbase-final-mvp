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

export const env = {
  port: Number(process.env.PORT ?? 7001),
  host: process.env.HOST ?? '0.0.0.0',
  workerUrl: process.env.WORKER_URL ?? 'http://127.0.0.1:8010',
  searchProvider: (process.env.SEARCH_PROVIDER ?? 'demo').toLowerCase(),
  googleCseApiKey: process.env.GOOGLE_CSE_API_KEY ?? '',
  googleCseId: process.env.GOOGLE_CSE_ID ?? '',
  brasilApiEnabled: (process.env.BRASILAPI_ENABLED ?? 'false').toLowerCase() === 'true',
  brasilApiTimeoutMs: Number(process.env.BRASILAPI_TIMEOUT_MS ?? 9000),
  maxBatchSize: Number(process.env.MAX_BATCH_SIZE ?? 200),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 120000),
  workerMode: (process.env.LINKEDIN_WORKER_MODE ?? 'demo').toLowerCase(),
  enrichConcurrency: Math.max(1, Number(process.env.ENRICH_CONCURRENCY ?? 5)),
  workerConcurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2)),
  receitaSource: receitaSourceKind(process.env.RECEITA_SOURCE),
  receitaCsvPath: projectPath(process.env.RECEITA_CSV_PATH, 'apps/api/data/receita-demo.csv'),
  receitaSqlitePath: projectPath(process.env.RECEITA_SQLITE_PATH, 'D:/cnpj_ativo_final.db'),
  receitaSqliteBusyTimeoutMs: Math.max(0, Number(process.env.RECEITA_SQLITE_BUSY_TIMEOUT_MS ?? 5000)),
  leadSearchDbPath: projectPath(process.env.LEAD_SEARCH_DB_PATH, 'apps/api/data/lead-search-db.json'),
  leadSearchBatchSize: Math.max(1, Number(process.env.LEAD_SEARCH_BATCH_SIZE ?? 25)),
};

export function findWebDist(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? null;
}
