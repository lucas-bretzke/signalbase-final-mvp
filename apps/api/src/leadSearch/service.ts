import crypto from 'node:crypto';
import { env } from '../env.js';
import { normalizeCnpj } from '../utils.js';
import { isLinkedinBlockingError, isWorkerClientError } from '../workerClient.js';
import { minQualityFromScore, normalizeLeadSearchFilters } from './leadSearchFilters.js';
import { stableEntityId } from './leadProcessor.js';
import {
  LeadProcessingOutcome,
  LeadProcessingContext,
  LeadProcessor,
  LeadSearch,
  LeadSearchFilters,
  LeadSearchProgress,
  LeadSearchRepository,
  LeadSearchResult,
  LeadSearchResultStatus,
  LeadSearchResultView,
  LeadSearchStatus,
  Pagination,
  ReceitaCompany,
  ReceitaCompanySource,
  ReceitaSourceMetadata,
} from './types.js';

export interface LeadSearchServiceOptions {
  batchSize?: number;
}

const REPOSITORY_BATCH_SIZE = 500;

export class LeadSearchService {
  private readonly runningJobs = new Map<string, Promise<void>>();
  private readonly jobControllers = new Map<string, AbortController>();
  private readonly reprocessJobs = new Map<string, Promise<LeadSearchProgress | undefined>>();
  private readonly deletingSearchIds = new Set<string>();
  private initialized = false;
  private stopping = false;
  private readonly batchSize: number;

  constructor(
    readonly repository: LeadSearchRepository,
    private readonly companySource: ReceitaCompanySource,
    private readonly processor: LeadProcessor,
    options: LeadSearchServiceOptions = {},
  ) {
    this.batchSize = Math.max(1, options.batchSize ?? 25);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      this.repository.initialize(),
      this.companySource.initialize?.(),
    ]);
    if (env.workerMode === 'real') {
      await this.repository.invalidateUntrustedResults('Resultado antigo invalidado: evidencia demo ou decisor sem vinculo profissional comprovado.');
    }
    this.initialized = true;
    const resumableIds: string[] = [];
    let offset = 0;
    while (true) {
      const page = await this.repository.listSearches({
        statuses: ['queued', 'processing'],
        offset,
        limit: REPOSITORY_BATCH_SIZE,
      });
      resumableIds.push(...page.items.map((search) => search.id));
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    for (const id of resumableIds) this.schedule(id);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const controller of this.jobControllers.values()) {
      if (!controller.signal.aborted) controller.abort(new Error('API encerrando.'));
    }
    await Promise.allSettled([...this.runningJobs.values()]);
    await this.companySource.close?.();
  }

  async sourceMetadata(): Promise<ReceitaSourceMetadata | undefined> {
    return this.companySource.metadata?.();
  }

  async waitForIdle(): Promise<void> {
    while (this.runningJobs.size) await Promise.allSettled([...this.runningJobs.values()]);
  }

  async create(filters: LeadSearchFilters): Promise<LeadSearchProgress> {
    await this.initialize();
    const normalized = normalizeLeadSearchFilters({
      ...filters,
      requirePhone: filters.requirePhone || filters.onlyMobilePhone,
      requireEmail: filters.requireEmail || filters.onlyCorporateEmail || filters.emailType === 'non_corporate',
    });
    const streamingCandidates = this.companySource.candidateCountStrategy === 'streaming';
    const totalCandidatesFound = streamingCandidates ? 0 : await this.companySource.count({
      uf: normalized.uf,
      city: normalized.city,
      cnaes: normalized.cnaes,
      preferences: normalized,
    });
    const now = new Date().toISOString();
    const search: LeadSearch = {
      id: crypto.randomUUID(),
      ...normalized,
      status: 'queued',
      totalCandidatesFound,
      candidateCountStatus: streamingCandidates ? 'lower_bound' : 'exact',
      totalProcessed: 0,
      totalValidLeads: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createSearch(search);
    this.schedule(search.id);
    return withProgress(search);
  }

  async get(id: string): Promise<LeadSearchProgress | undefined> {
    const search = await this.repository.getSearch(id);
    return search ? withProgress(search) : undefined;
  }

  async resume(id: string): Promise<LeadSearchProgress | undefined> {
    const search = await this.repository.getSearch(id);
    if (!search) return undefined;
    if (search.status !== 'blocked' && search.status !== 'paused') return withProgress(search);
    const resumed = await this.repository.updateSearch(id, (current) => {
      if (current.status !== 'blocked' && current.status !== 'paused') return;
      Object.assign(current, {
        status: 'queued',
        blockReason: undefined,
        lastError: undefined,
        completedAt: undefined,
        updatedAt: new Date().toISOString(),
      });
    });
    if (resumed.status === 'queued') this.schedule(id);
    return withProgress(resumed);
  }

  async pause(id: string): Promise<LeadSearchProgress | undefined> {
    const search = await this.repository.getSearch(id);
    if (!search) return undefined;
    if (!isActiveSearchStatus(search.status)) return withProgress(search);
    const paused = await this.repository.updateSearch(id, (current) => {
      if (!isActiveSearchStatus(current.status)) return;
      Object.assign(current, {
        status: 'paused',
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      });
    });
    if (paused.status === 'paused') this.cancelJob(id, 'Busca pausada pelo operador.');
    return withProgress(paused);
  }

  async delete(id: string): Promise<boolean> {
    const search = await this.repository.getSearch(id);
    if (!search) return false;
    this.deletingSearchIds.add(id);
    this.cancelJob(id, 'Busca excluida pelo operador.');
    try {
      return await this.repository.deleteSearch(id);
    } finally {
      if (!this.runningJobs.has(id)) this.deletingSearchIds.delete(id);
    }
  }

  reprocess(id: string): Promise<LeadSearchProgress | undefined> {
    const existing = this.reprocessJobs.get(id);
    if (existing) return existing;
    const operation = this.reprocessOnce(id).finally(() => {
      if (this.reprocessJobs.get(id) === operation) this.reprocessJobs.delete(id);
    });
    this.reprocessJobs.set(id, operation);
    return operation;
  }

  private async reprocessOnce(id: string): Promise<LeadSearchProgress | undefined> {
    const source = await this.repository.getSearch(id);
    if (!source) return undefined;
    if (source.reprocessedBySearchId) return this.get(source.reprocessedBySearchId);
    const replacement = await this.create({
      uf: source.uf,
      city: source.city,
      cnaes: source.cnaes,
      targetQuantity: source.targetQuantity,
      targetMode: source.targetMode,
      minScore: source.minScore,
      minQuality: source.minQuality,
      requirePhone: source.requirePhone,
      requireEmail: source.requireEmail,
      requireDecisionMakerMatch: source.requireDecisionMakerMatch,
      onlyMobilePhone: source.onlyMobilePhone,
      emailType: source.emailType,
      onlyCorporateEmail: source.onlyCorporateEmail,
      excludeGenericContacts: source.excludeGenericContacts,
      requireRealLinkedin: source.requireRealLinkedin,
      requireLinkedinCompanyData: source.requireLinkedinCompanyData,
      requireRealDecisionMaker: source.requireRealDecisionMaker,
      requireDecisionMakerProfile: source.requireDecisionMakerProfile,
      requireDecisionMakerContact: source.requireDecisionMakerContact,
      requireNamedEmail: source.requireNamedEmail,
      requireDecisionMakerPhone: source.requireDecisionMakerPhone,
      matchConfidenceLevel: source.matchConfidenceLevel,
    });
    await Promise.all([
      this.repository.updateSearch(id, { reprocessedBySearchId: replacement.id, updatedAt: new Date().toISOString() }),
      this.repository.updateSearch(replacement.id, { sourceSearchId: id, updatedAt: new Date().toISOString() }),
    ]);
    return this.get(replacement.id);
  }

  async list(params: { page: number; pageSize: number; status?: LeadSearchStatus }): Promise<Pagination<LeadSearchProgress>> {
    const offset = (params.page - 1) * params.pageSize;
    const result = await this.repository.listSearches({
      statuses: params.status ? [params.status] : undefined,
      offset,
      limit: params.pageSize,
    });
    return {
      items: result.items.map(withProgress),
      total: result.total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async results(params: {
    searchId: string;
    page: number;
    pageSize: number;
    status?: LeadSearchResultStatus;
    selected?: boolean;
  }): Promise<Pagination<LeadSearchResultView> | undefined> {
    if (!await this.repository.getSearch(params.searchId)) return undefined;
    const offset = (params.page - 1) * params.pageSize;
    const result = await this.repository.listResults(params.searchId, {
      status: params.status,
      selected: params.selected,
      offset,
      limit: params.pageSize,
    });
    return {
      items: await this.views(result.items),
      total: result.total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async result(searchId: string, resultId: string): Promise<LeadSearchResultView | undefined> {
    const result = await this.repository.getResult(searchId, resultId);
    if (!result) return undefined;
    return (await this.views([result]))[0];
  }

  async select(searchId: string, resultId: string, selected: boolean): Promise<LeadSearchResultView | undefined> {
    const current = await this.repository.getResult(searchId, resultId);
    if (!current) return undefined;
    const result = await this.repository.setResultSelected(searchId, resultId, current.status === 'valid' ? selected : false);
    if (!result) return undefined;
    return (await this.views([result]))[0];
  }

  async exportResults(searchId: string, selectedOnly: boolean): Promise<LeadSearchResultView[] | undefined> {
    if (!await this.repository.getSearch(searchId)) return undefined;
    const results: LeadSearchResult[] = [];
    let offset = 0;
    while (true) {
      const page = await this.repository.listResults(searchId, {
        status: 'valid',
        selected: selectedOnly ? true : undefined,
        offset,
        limit: REPOSITORY_BATCH_SIZE,
      });
      results.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    return this.views(results);
  }

  private schedule(searchId: string): void {
    if (this.stopping || this.runningJobs.has(searchId)) return;
    const controller = new AbortController();
    this.jobControllers.set(searchId, controller);
    const job = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.runJob(searchId, controller.signal))
      .catch(async (error) => {
        if (this.deletingSearchIds.has(searchId)) return;
        const current = await this.repository.getSearch(searchId).catch(() => undefined);
        if (!current || current.status === 'paused' || controller.signal.aborted) return;
        const blocked = isInterruptingWorkerError(error);
        await this.repository.updateSearch(searchId, (search) => {
          if (controller.signal.aborted || !isActiveSearchStatus(search.status)) return;
          const now = new Date().toISOString();
          Object.assign(search, {
            status: blocked ? 'blocked' : 'failed',
            lastError: errorMessage(error),
            blockReason: blocked && isWorkerClientError(error) ? error.code : undefined,
            completedAt: now,
            updatedAt: now,
          });
        }).catch(() => undefined);
      })
      .finally(async () => {
        this.runningJobs.delete(searchId);
        if (this.jobControllers.get(searchId) === controller) this.jobControllers.delete(searchId);
        this.deletingSearchIds.delete(searchId);
        if (!this.stopping) {
          const search = await this.repository.getSearch(searchId).catch(() => undefined);
          if (search?.status === 'queued') this.schedule(searchId);
        }
      });
    this.runningJobs.set(searchId, job);
  }

  private async runJob(searchId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const current = await this.repository.getSearch(searchId);
    if (!current || isTerminal(current.status)) return;
    const startedAt = current.startedAt ?? new Date().toISOString();
    const processing = await this.repository.updateSearch(searchId, (search) => {
      if (signal.aborted || !isActiveSearchStatus(search.status)) return;
      Object.assign(search, {
        status: 'processing',
        startedAt,
        updatedAt: new Date().toISOString(),
        lastError: undefined,
      });
    });
    if (signal.aborted || processing.status !== 'processing') return;

    while (!this.stopping && !signal.aborted) {
      const search = await this.repository.getSearch(searchId);
      if (!search) return;
      if (isTerminal(search.status)) return;
      if (targetReached(search)) {
        await this.finish(searchId, 'target_reached', signal);
        return;
      }
      const streamingCandidates = search.candidateCountStatus === 'lower_bound';
      if (!streamingCandidates && search.totalProcessed >= search.totalCandidatesFound) {
        await this.finish(searchId, 'candidate_pool_exhausted', signal);
        return;
      }

      const requestedLimit = streamingCandidates
        ? this.batchSize
        : Math.min(this.batchSize, search.totalCandidatesFound - search.totalProcessed);
      const candidates = await this.companySource.find({
        uf: search.uf,
        city: search.city,
        cnaes: search.cnaes,
        offset: search.totalProcessed,
        limit: requestedLimit,
        preferences: search,
      });
      if (this.stopping || signal.aborted) return;
      const afterFind = await this.repository.getSearch(searchId);
      if (!afterFind || isTerminal(afterFind.status)) return;
      if (!candidates.length) {
        if (streamingCandidates) {
          await this.repository.updateSearch(searchId, {
            totalCandidatesFound: search.totalProcessed,
            candidateCountStatus: 'exact',
            updatedAt: new Date().toISOString(),
          });
        }
        await this.finish(searchId, 'candidate_pool_exhausted', signal);
        return;
      }

      if (streamingCandidates) {
        const reachedEnd = candidates.length < requestedLimit;
        await this.repository.updateSearch(searchId, {
          totalCandidatesFound: search.totalProcessed + candidates.length,
          candidateCountStatus: reachedEnd ? 'exact' : 'lower_bound',
          updatedAt: new Date().toISOString(),
        });
      }

      for (const candidate of candidates) {
        if (this.stopping || signal.aborted) return;
        const latest = await this.repository.getSearch(searchId);
        if (!latest) return;
        if (isTerminal(latest.status)) return;
        if (targetReached(latest)) {
          await this.finish(searchId, 'target_reached', signal);
          return;
        }
        const outcome = await this.processSafely(latest, candidate, signal);
        if (signal.aborted) return;
        const beforeRecord = await this.repository.getSearch(searchId);
        if (!beforeRecord || isTerminal(beforeRecord.status)) return;
        const updated = await this.repository.recordProcessed(
          searchId,
          outcome.result,
          outcome.crossMatch,
          { expectedStatus: 'processing', signal },
        );
        if (targetReached(updated)) {
          await this.finish(searchId, 'target_reached', signal);
          return;
        }
        await yieldEventLoop();
      }
    }
  }

  private async processSafely(search: LeadSearch, candidate: ReceitaCompany, signal: AbortSignal): Promise<LeadProcessingOutcome> {
    const context: LeadProcessingContext = {
      signal,
      requestId: crypto.randomUUID(),
      deadline: Date.now() + env.leadOperationTimeoutMs,
    };
    try {
      return await this.processor.process(search, candidate, context);
    } catch (error) {
      if (signal.aborted) throw error;
      if (isInterruptingWorkerError(error)) throw error;
      const now = new Date().toISOString();
      const result: LeadSearchResult = {
        id: stableEntityId('result', `${search.id}:${candidate.cnpj}`),
        leadSearchId: search.id,
        cnpj: normalizeCnpj(candidate.cnpj),
        finalScore: 0,
        status: 'error',
        selected: false,
        candidate,
        rejectionReasons: [`Falha no enriquecimento: ${errorMessage(error)}`],
        createdAt: now,
        updatedAt: now,
      };
      return { result };
    }
  }

  private cancelJob(searchId: string, reason: string): void {
    const controller = this.jobControllers.get(searchId);
    if (controller && !controller.signal.aborted) controller.abort(new Error(reason));
  }

  private async finish(
    searchId: string,
    completionReason: NonNullable<LeadSearch['completionReason']>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;
    const now = new Date().toISOString();
    await this.repository.updateSearch(searchId, (search) => {
      if (signal.aborted || !isActiveSearchStatus(search.status)) return;
      Object.assign(search, {
        status: 'completed',
        completionReason,
        completedAt: now,
        updatedAt: now,
      });
    });
  }

  private async views(results: LeadSearchResult[]): Promise<LeadSearchResultView[]> {
    const matches = await this.repository.getCrossMatches(results.flatMap((result) => result.leadCrossMatchId ? [result.leadCrossMatchId] : []));
    const byId = new Map(matches.map((match) => [match.id, match]));
    return results.map((result) => {
      const lead = result.leadCrossMatchId ? byId.get(result.leadCrossMatchId) : undefined;
      return {
        ...result,
        lead,
        leadCrossMatch: lead,
        companyName: lead?.companyName ?? result.candidate.tradingName ?? result.candidate.legalName,
        tradingName: result.candidate.tradingName,
        city: result.candidate.city,
        uf: result.candidate.uf,
        cnae: result.candidate.cnae,
        partner: lead?.decisionMakerMatch.partnerName ?? result.candidate.partners[0],
        finalEmail: lead?.finalEmail,
        finalPhone: lead?.finalPhone,
        decisionMakerMatched: lead?.decisionMakerMatched ?? false,
      };
    });
  }
}

export function withProgress(search: LeadSearch): LeadSearchProgress {
  const targetMode = targetModeOf(search);
  const fixedTarget = targetMode === 'fixed';
  const completionReason = search.completionReason ?? (search.status === 'exhausted' ? 'candidate_pool_exhausted' : undefined);
  const candidateProgressPercent = search.totalCandidatesFound
    ? round(Math.min(100, (search.totalProcessed / search.totalCandidatesFound) * 100))
    : search.candidateCountStatus === 'lower_bound' ? 0 : 100;
  const remainingQuantity = fixedTarget ? Math.max(0, search.targetQuantity - search.totalValidLeads) : 0;
  return {
    ...search,
    minQuality: search.minQuality ?? minQualityFromScore(search.minScore ?? 0),
    targetMode,
    completionReason,
    remainingQuantity,
    candidatesRemaining: Math.max(0, search.totalCandidatesFound - search.totalProcessed),
    yieldRate: search.totalProcessed ? round((search.totalValidLeads / search.totalProcessed) * 100) : 0,
    progressPercent: fixedTarget && search.targetQuantity
      ? round(Math.min(100, (search.totalValidLeads / search.targetQuantity) * 100))
      : candidateProgressPercent,
    candidateProgressPercent,
  };
}

function isTerminal(status: LeadSearchStatus): boolean {
  return status === 'paused' || status === 'blocked' || status === 'completed' || status === 'exhausted' || status === 'failed';
}

function isInterruptingWorkerError(error: unknown): boolean {
  if (isLinkedinBlockingError(error)) return true;
  if (!isWorkerClientError(error)) return false;
  return [
    'navigation_error',
    'network_error',
    'deadline_exceeded',
    'request_cancelled',
    'queue_timeout',
    'queue_full',
  ].includes(error.code);
}

function isActiveSearchStatus(status: LeadSearchStatus): boolean {
  return status === 'queued' || status === 'processing';
}

function targetModeOf(search: Pick<LeadSearch, 'targetMode'>): LeadSearch['targetMode'] {
  return search.targetMode ?? 'fixed';
}

function targetReached(search: LeadSearch): boolean {
  return targetModeOf(search) === 'fixed' && search.totalValidLeads >= search.targetQuantity;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
