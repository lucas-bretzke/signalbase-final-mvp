import { CandidateQuery, ReceitaCompany, ReceitaSourceMetadata } from './types.js';

export interface SqliteWorkerOptions {
  filePath: string;
  busyTimeoutMs: number;
}

export type SqliteWorkerRequest =
  | { id: number; operation: 'initialize' }
  | { id: number; operation: 'metadata' }
  | { id: number; operation: 'count'; query: Omit<CandidateQuery, 'offset' | 'limit'> }
  | { id: number; operation: 'find'; query: CandidateQuery }
  | { id: number; operation: 'close' };

export type SqliteWorkerResult = void | number | ReceitaCompany[] | ReceitaSourceMetadata;

export type SqliteWorkerResponse =
  | { id: number; ok: true; result: SqliteWorkerResult }
  | { id: number; ok: false; error: string };
