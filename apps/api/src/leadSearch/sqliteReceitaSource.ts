import { Worker } from 'node:worker_threads';
import {
  CandidateQuery,
  ReceitaCompany,
  ReceitaCompanySource,
  ReceitaSourceMetadata,
} from './types.js';
import {
  SqliteWorkerOptions,
  SqliteWorkerRequest,
  SqliteWorkerResponse,
  SqliteWorkerResult,
} from './sqliteReceitaProtocol.js';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type SqliteWorkerCommand = WithoutId<SqliteWorkerRequest>;

interface PendingRequest {
  resolve: (value: SqliteWorkerResult) => void;
  reject: (error: Error) => void;
}

export interface SqliteReceitaCompanySourceOptions {
  busyTimeoutMs?: number;
}

/**
 * Read-only Receita source backed by a dedicated Worker thread. The public port
 * stays database-agnostic so PostgreSQL can replace this adapter later.
 */
export class SqliteReceitaCompanySource implements ReceitaCompanySource {
  candidateCountStrategy: 'eager' | 'streaming' = 'streaming';
  private worker?: Worker;
  private initialization?: Promise<void>;
  private initialized = false;
  private metadataCache?: ReceitaSourceMetadata;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(
    readonly filePath: string,
    private readonly options: SqliteReceitaCompanySourceOptions = {},
  ) {}

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.request<void>({ operation: 'initialize' }).then(async () => {
        this.initialized = true;
        this.metadataCache = await this.request<ReceitaSourceMetadata>({ operation: 'metadata' });
        this.candidateCountStrategy = this.metadataCache.optimizedSearchIndex ? 'eager' : 'streaming';
      });
    }
    return this.initialization;
  }

  async count(query: Omit<CandidateQuery, 'offset' | 'limit'>): Promise<number> {
    await this.initialize();
    return this.request<number>({ operation: 'count', query });
  }

  async find(query: CandidateQuery): Promise<ReceitaCompany[]> {
    await this.initialize();
    return this.request<ReceitaCompany[]>({ operation: 'find', query });
  }

  async metadata(): Promise<ReceitaSourceMetadata> {
    await this.initialize();
    this.metadataCache ??= await this.request<ReceitaSourceMetadata>({ operation: 'metadata' });
    return structuredClone(this.metadataCache);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const worker = this.worker;
    if (!worker) return;
    try {
      if (this.initialized) await this.request<void>({ operation: 'close' }, true);
    } finally {
      await worker.terminate();
      this.worker = undefined;
      this.failPending(new Error('A conexao SQLite da Receita foi encerrada.'));
    }
  }

  private request<T extends SqliteWorkerResult>(command: SqliteWorkerCommand, allowClosed = false): Promise<T> {
    if (this.closed && !allowClosed) return Promise.reject(new Error('A fonte SQLite da Receita foi encerrada.'));
    const worker = this.getWorker();
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      try {
        worker.postMessage({ ...command, id } satisfies SqliteWorkerRequest);
      } catch (error) {
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const workerFile = import.meta.url.endsWith('.ts') ? './sqliteReceitaWorkerLoader.mjs' : './sqliteReceitaWorker.js';
    const workerOptions: SqliteWorkerOptions = {
      filePath: this.filePath,
      busyTimeoutMs: Math.max(0, Math.trunc(this.options.busyTimeoutMs ?? 5_000)),
    };
    const worker = new Worker(new URL(workerFile, import.meta.url), {
      workerData: workerOptions,
      execArgv: workerExecArgv(),
    });
    worker.on('message', (response: SqliteWorkerResponse) => this.handleResponse(response));
    worker.on('error', (error) => this.failPending(error));
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = undefined;
      if (this.closed) {
        for (const pending of this.pending.values()) pending.resolve(undefined);
        this.pending.clear();
      } else if (this.pending.size || code !== 0) {
        this.failPending(new Error(`Worker SQLite encerrado inesperadamente (codigo ${code}).`));
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleResponse(response: SqliteWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function workerExecArgv(): string[] {
  const result: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const argument = process.execArgv[index];
    if (argument === '--watch' || argument === '--watch-preserve-output') continue;
    if (argument === '--watch-path') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--watch-path=')) continue;
    if (argument === '--input-type') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--input-type=')) continue;
    result.push(argument);
  }
  return result;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
