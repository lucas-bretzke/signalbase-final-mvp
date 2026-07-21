import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonLeadSearchRepository } from '../src/leadSearch/jsonRepository.js';
import { LeadSearchService } from '../src/leadSearch/service.js';
import { WorkerClientError } from '../src/workerClient.js';
import type {
  CandidateQuery,
  LeadProcessingContext,
  LeadProcessingOutcome,
  LeadProcessor,
  LeadSearch,
  LeadSearchFilters,
  ReceitaCompany,
  ReceitaCompanySource,
} from '../src/leadSearch/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('LeadSearchService cancellation', () => {
  it('aborts an in-flight candidate on pause and processes it after resume', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-cancel-test-'));
    temporaryDirectories.push(directory);
    const processor = new AbortOnceProcessor();
    const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
    const service = new LeadSearchService(repository, new OneCompanySource(), processor, { batchSize: 1 });

    const created = await service.create(filters());
    await processor.firstStarted.promise;

    const paused = await service.pause(created.id);
    expect(paused?.status).toBe('paused');
    await processor.firstCancelled.promise;

    const resumed = await service.resume(created.id);
    expect(resumed?.status).toBe('queued');
    processor.releaseCancellation.resolve();
    await service.waitForIdle();
    await processor.secondCompleted.promise;

    const finished = await service.get(created.id);
    expect(finished).toMatchObject({
      status: 'completed',
      completionReason: 'target_reached',
      totalProcessed: 1,
      totalValidLeads: 1,
    });
    expect(processor.calls).toBe(2);
    await service.stop();
  });

  it('keeps a search paused when the candidate source finishes after cancellation', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-find-cancel-test-'));
    temporaryDirectories.push(directory);
    const source = new BlockingEmptySource();
    const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
    const processor = new AlwaysValidProcessor();
    const service = new LeadSearchService(repository, source, processor, { batchSize: 1 });

    const created = await service.create(filters());
    await source.started.promise;
    const paused = await service.pause(created.id);
    expect(paused?.status).toBe('paused');
    source.release.resolve();
    await service.waitForIdle();

    expect(await service.get(created.id)).toMatchObject({
      status: 'paused',
      totalProcessed: 0,
      totalValidLeads: 0,
    });
    expect(processor.calls).toBe(0);
    await service.stop();
  });

  it('deduplicates concurrent reprocess requests in the current API process', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-reprocess-test-'));
    temporaryDirectories.push(directory);
    const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
    const service = new LeadSearchService(repository, new OneCompanySource(), new AlwaysValidProcessor(), { batchSize: 1 });

    const created = await service.create(filters());
    await service.waitForIdle();
    const replacements = await Promise.all([
      service.reprocess(created.id),
      service.reprocess(created.id),
      service.reprocess(created.id),
    ]);
    await service.waitForIdle();

    expect(new Set(replacements.map((item) => item?.id)).size).toBe(1);
    expect((await service.list({ page: 1, pageSize: 10 })).total).toBe(2);
    await service.stop();
  });

  it('does not persist a processed result unless the search is atomically processing', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-state-guard-test-'));
    temporaryDirectories.push(directory);
    const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
    const now = new Date().toISOString();
    const search: LeadSearch = {
      id: 'state-guard',
      ...filters(),
      status: 'queued',
      totalCandidatesFound: 1,
      totalProcessed: 0,
      totalValidLeads: 0,
      createdAt: now,
      updatedAt: now,
    };
    const candidate = (await new OneCompanySource().find({
      uf: 'SC', cnaes: ['7311400'], offset: 0, limit: 1,
    }))[0];
    const outcome = await new AlwaysValidProcessor().process(search, candidate);
    await repository.initialize();
    await repository.createSearch(search);

    const onlyWhileProcessing = { expectedStatus: 'processing' as const };
    const queued = await repository.recordProcessed(search.id, outcome.result, outcome.crossMatch, onlyWhileProcessing);
    expect(queued.totalProcessed).toBe(0);
    expect((await repository.listResults(search.id, { offset: 0, limit: 10 })).total).toBe(0);

    await repository.updateSearch(search.id, { status: 'processing' });
    const processing = await repository.recordProcessed(search.id, outcome.result, outcome.crossMatch, onlyWhileProcessing);
    expect(processing.totalProcessed).toBe(1);
    expect((await repository.listResults(search.id, { offset: 0, limit: 10 })).total).toBe(1);
  });

  it('blocks without consuming the candidate when its operation deadline expires', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signalbase-deadline-test-'));
    temporaryDirectories.push(directory);
    const repository = new JsonLeadSearchRepository(path.join(directory, 'db.json'));
    const processor: LeadProcessor = {
      process: async () => {
        throw new WorkerClientError('deadline_exceeded', 'deadline fixture');
      },
    };
    const service = new LeadSearchService(repository, new OneCompanySource(), processor, { batchSize: 1 });

    const created = await service.create(filters());
    await service.waitForIdle();

    const blocked = await service.get(created.id);
    expect(blocked).toMatchObject({
      status: 'blocked',
      blockReason: 'deadline_exceeded',
      totalProcessed: 0,
      totalValidLeads: 0,
    });
    await service.stop();
  });
});

class AbortOnceProcessor implements LeadProcessor {
  calls = 0;
  readonly firstStarted = deferred<void>();
  readonly firstCancelled = deferred<void>();
  readonly releaseCancellation = deferred<void>();
  readonly secondCompleted = deferred<void>();

  async process(
    search: LeadSearch,
    candidate: ReceitaCompany,
    context?: LeadProcessingContext,
  ): Promise<LeadProcessingOutcome> {
    this.calls += 1;
    if (this.calls === 1) {
      this.firstStarted.resolve();
      await new Promise<never>((_resolve, reject) => {
        const signal = context?.signal;
        const onAbort = () => {
          this.firstCancelled.resolve();
          void this.releaseCancellation.promise.then(() => reject(signal?.reason ?? new Error('cancelled')));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    const now = new Date().toISOString();
    const outcome: LeadProcessingOutcome = {
      result: {
        id: `result-${search.id}-${candidate.cnpj}`,
        leadSearchId: search.id,
        cnpj: candidate.cnpj,
        finalScore: 90,
        status: 'valid',
        selected: true,
        candidate,
        rejectionReasons: [],
        createdAt: now,
        updatedAt: now,
      },
    };
    this.secondCompleted.resolve();
    return outcome;
  }
}

class AlwaysValidProcessor implements LeadProcessor {
  calls = 0;

  async process(search: LeadSearch, candidate: ReceitaCompany): Promise<LeadProcessingOutcome> {
    this.calls += 1;
    const now = new Date().toISOString();
    return {
      result: {
        id: `result-${search.id}-${candidate.cnpj}`,
        leadSearchId: search.id,
        cnpj: candidate.cnpj,
        finalScore: 90,
        status: 'valid',
        selected: true,
        candidate,
        rejectionReasons: [],
        createdAt: now,
        updatedAt: now,
      },
    };
  }
}

class BlockingEmptySource implements ReceitaCompanySource {
  readonly started = deferred<void>();
  readonly release = deferred<void>();

  async count(): Promise<number> {
    return 1;
  }

  async find(): Promise<ReceitaCompany[]> {
    this.started.resolve();
    await this.release.promise;
    return [];
  }
}

class OneCompanySource implements ReceitaCompanySource {
  async count(): Promise<number> {
    return 1;
  }

  async find(query: CandidateQuery): Promise<ReceitaCompany[]> {
    if (query.offset > 0) return [];
    return [{
      cnpj: '10000000000001',
      legalName: 'Fixture Ltda',
      tradingName: 'Fixture',
      city: 'Florianopolis',
      uf: 'SC',
      cnae: '7311400',
      partners: [],
    }];
  }
}

function filters(): LeadSearchFilters {
  return {
    uf: 'SC',
    city: 'Florianopolis',
    cnaes: ['7311400'],
    targetQuantity: 1,
    targetMode: 'fixed',
    minScore: 0,
    minQuality: 'baixo',
    requirePhone: false,
    requireEmail: false,
    requireDecisionMakerMatch: false,
    onlyMobilePhone: false,
    emailType: 'any',
    onlyCorporateEmail: false,
    excludeGenericContacts: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
