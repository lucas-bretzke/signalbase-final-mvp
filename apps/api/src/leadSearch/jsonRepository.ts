import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  LeadCrossMatch,
  LeadSearch,
  LeadSearchDatabase,
  LeadSearchRepository,
  LeadSearchRepositoryListOptions,
  LeadSearchResult,
  LeadSearchResultRepositoryListOptions,
  RecordProcessedOptions,
  RepositoryPage,
} from './types.js';

const EMPTY_DATABASE: LeadSearchDatabase = {
  schemaVersion: 1,
  searches: [],
  results: [],
  crossMatches: [],
};

export class JsonLeadSearchRepository implements LeadSearchRepository {
  private database: LeadSearchDatabase = structuredClone(EMPTY_DATABASE);
  private initialization?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string) {}

  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.load();
    return this.initialization;
  }

  async createSearch(search: LeadSearch): Promise<LeadSearch> {
    return this.transaction((database) => {
      if (database.searches.some((item) => item.id === search.id)) throw new Error(`LeadSearch ${search.id} ja existe.`);
      database.searches.push(clone(search));
      return search;
    });
  }

  async getSearch(id: string): Promise<LeadSearch | undefined> {
    const database = await this.snapshot();
    return database.searches.find((item) => item.id === id);
  }

  async listSearches(options: LeadSearchRepositoryListOptions): Promise<RepositoryPage<LeadSearch>> {
    const database = await this.snapshot();
    const statuses = options.statuses ? new Set(options.statuses) : undefined;
    const filtered = database.searches
      .filter((item) => !statuses || statuses.has(item.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return page(filtered, options);
  }

  async updateSearch(id: string, update: Partial<LeadSearch> | ((search: LeadSearch) => void)): Promise<LeadSearch> {
    return this.transaction((database) => {
      const search = requiredSearch(database, id);
      if (typeof update === 'function') update(search);
      else Object.assign(search, clone(update));
      return search;
    });
  }

  async deleteSearch(id: string): Promise<boolean> {
    return this.transaction((database) => {
      const searchIndex = database.searches.findIndex((item) => item.id === id);
      if (searchIndex < 0) return false;
      database.searches.splice(searchIndex, 1);

      const removedCrossMatchIds = new Set(
        database.results
          .filter((item) => item.leadSearchId === id && item.leadCrossMatchId)
          .map((item) => item.leadCrossMatchId as string),
      );
      database.results = database.results.filter((item) => item.leadSearchId !== id);
      database.crossMatches = database.crossMatches.filter((item) => !removedCrossMatchIds.has(item.id));
      return true;
    });
  }

  async recordProcessed(
    searchId: string,
    result: LeadSearchResult,
    crossMatch?: LeadCrossMatch,
    options?: RecordProcessedOptions,
  ): Promise<LeadSearch> {
    return this.transaction((database) => {
      const search = requiredSearch(database, searchId);
      if (options?.signal?.aborted) return search;
      if (options?.expectedStatus && search.status !== options.expectedStatus) return search;
      const existingIndex = database.results.findIndex((item) => item.id === result.id);
      const existing = existingIndex >= 0 ? database.results[existingIndex] : undefined;

      if (crossMatch) upsert(database.crossMatches, crossMatch);
      if (existingIndex >= 0) database.results[existingIndex] = clone(result);
      else database.results.push(clone(result));

      if (!existing) search.totalProcessed += 1;
      if (existing?.status === 'valid' && result.status !== 'valid') search.totalValidLeads -= 1;
      if (existing?.status !== 'valid' && result.status === 'valid') search.totalValidLeads += 1;
      search.updatedAt = result.updatedAt;
      return search;
    });
  }

  async getResult(searchId: string, resultId: string): Promise<LeadSearchResult | undefined> {
    const database = await this.snapshot();
    return database.results.find((item) => item.leadSearchId === searchId && item.id === resultId);
  }

  async listResults(
    searchId: string,
    options: LeadSearchResultRepositoryListOptions,
  ): Promise<RepositoryPage<LeadSearchResult>> {
    const database = await this.snapshot();
    const filtered = database.results
      .filter((item) => item.leadSearchId === searchId)
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => options.selected === undefined || item.selected === options.selected)
      .sort((left, right) => right.finalScore - left.finalScore || left.createdAt.localeCompare(right.createdAt));
    return page(filtered, options);
  }

  async setResultSelected(searchId: string, resultId: string, selected: boolean): Promise<LeadSearchResult | undefined> {
    return this.transaction((database) => {
      const result = database.results.find((item) => item.leadSearchId === searchId && item.id === resultId);
      if (!result) return undefined;
      result.selected = selected;
      result.updatedAt = new Date().toISOString();
      return result;
    });
  }

  async getCrossMatch(id: string | undefined): Promise<LeadCrossMatch | undefined> {
    if (!id) return undefined;
    const database = await this.snapshot();
    return database.crossMatches.find((item) => item.id === id);
  }

  async getCrossMatches(ids: string[]): Promise<LeadCrossMatch[]> {
    const wanted = new Set(ids);
    const database = await this.snapshot();
    return database.crossMatches.filter((item) => wanted.has(item.id));
  }

  async invalidateUntrustedResults(reason: string): Promise<{ invalidated: number; affectedSearchIds: string[] }> {
    return this.transaction((database) => {
      const crossMatches = new Map(database.crossMatches.map((item) => [item.id, item]));
      const affectedSearchIds = new Set<string>();
      let invalidated = 0;
      const now = new Date().toISOString();
      for (const result of database.results) {
        if (result.status !== 'valid' || !result.leadCrossMatchId) continue;
        const crossMatch = crossMatches.get(result.leadCrossMatchId);
        const decisionMaker = crossMatch?.decisionMaker;
        const unverifiedPuppeteer = decisionMaker?.source === 'puppeteer_linkedin'
          && decisionMaker.associationVerified !== true;
        if (!crossMatch?.isDemoEvidence && !unverifiedPuppeteer) continue;
        result.status = 'rejected';
        result.selected = false;
        result.rejectionReasons = [...new Set([...(result.rejectionReasons ?? []), reason])];
        result.updatedAt = now;
        affectedSearchIds.add(result.leadSearchId);
        invalidated += 1;
      }
      for (const search of database.searches) {
        search.totalValidLeads = database.results.filter((item) => item.leadSearchId === search.id && item.status === 'valid').length;
        if (affectedSearchIds.has(search.id)) search.updatedAt = now;
      }
      return { invalidated, affectedSearchIds: [...affectedSearchIds] };
    });
  }

  private async load(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<LeadSearchDatabase>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.searches) || !Array.isArray(parsed.results) || !Array.isArray(parsed.crossMatches)) {
        throw new Error('Formato de banco LeadSearch nao reconhecido.');
      }
      this.database = parsed as LeadSearchDatabase;
    } catch (error) {
      if (!isMissingFile(error)) throw new Error(`Nao foi possivel abrir ${this.filePath}: ${errorMessage(error)}`);
      this.database = structuredClone(EMPTY_DATABASE);
      await atomicWrite(this.filePath, this.database);
    }
  }

  private async snapshot(): Promise<LeadSearchDatabase> {
    await this.initialize();
    await this.writeQueue;
    return clone(this.database);
  }

  private async transaction<T>(mutator: (database: LeadSearchDatabase) => T): Promise<T> {
    await this.initialize();
    let output!: T;
    const operation = this.writeQueue.then(async () => {
      const draft = clone(this.database);
      output = mutator(draft);
      await atomicWrite(this.filePath, draft);
      this.database = draft;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    return clone(output);
  }
}

async function atomicWrite(filePath: string, database: LeadSearchDatabase): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function requiredSearch(database: LeadSearchDatabase, id: string): LeadSearch {
  const search = database.searches.find((item) => item.id === id);
  if (!search) throw new Error(`LeadSearch ${id} nao encontrada.`);
  return search;
}

function upsert<T extends { id: string }>(items: T[], value: T): void {
  const index = items.findIndex((item) => item.id === value.id);
  if (index >= 0) items[index] = clone(value);
  else items.push(clone(value));
}

function page<T>(items: T[], options: { offset: number; limit: number }): RepositoryPage<T> {
  const offset = nonNegativeInteger(options.offset);
  const limit = nonNegativeInteger(options.limit);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
