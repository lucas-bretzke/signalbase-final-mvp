import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { config } from './config.mjs';
import { JsonCache } from './cache.mjs';
import {
  OperationContext,
  SerialOperationQueue,
  WorkerOperationError,
  asOperationError,
  createOperationContext,
  errorFromAbortSignal,
} from './operation.mjs';
import {
  annotatePartnerMatches,
  cacheKey,
  companySearchQueries,
  companyUrlsFromSearchRows,
  contactValues,
  dedupePeople,
  normalizeCompanyUrl,
  normalizeProfileUrl,
  pageState,
  parseCompanySnapshot,
  parsePeopleRows,
  scoreCompanyCandidate,
  verifyCurrentCompanyAssociation,
} from './extractors.mjs';

export class LinkedinBrowserWorker {
  constructor(options = config, dependencies = {}) {
    this.options = options;
    this.now = dependencies.now ?? Date.now;
    this.launchBrowser = dependencies.launchBrowser ?? ((launchOptions) => puppeteer.launch(launchOptions));
    this.log = loggerFunction(dependencies.logger ?? console);
    this.cache = dependencies.cache ?? new JsonCache(options.cachePath, {
      ttlMs: options.cacheTtlMs,
      negativeTtlMs: options.negativeCacheTtlMs,
      emptyTtlMs: options.emptyCacheTtlMs,
      schemaVersion: options.cacheSchemaVersion,
      extractorVersion: options.extractorVersion,
      mode: options.mode,
      now: this.now,
    });
    this.browser = undefined;
    this.queue = dependencies.queue ?? new SerialOperationQueue({
      maxDepth: options.maxQueueDepth,
      waitTimeoutMs: options.queueWaitTimeoutMs,
      now: this.now,
    });
    this.lastNavigationAt = 0;
    this.sessionState = 'not_checked';
    this.lastError = undefined;
    this.lastCheckedAt = undefined;
    this.lastOperation = undefined;
    this.lastSuccessAt = undefined;
  }

  async initialize() {
    await this.cache.initialize();
  }

  health() {
    const queue = this.queue.health();
    const acceptingWork = queue.queueDepth < queue.maxQueueDepth;
    const browserAvailable = this.options.mode === 'demo' || Boolean(this.options.executablePath) || Boolean(this.browser?.connected);
    const freshSession = this.sessionState === 'authenticated'
      && isFreshTimestamp(this.lastCheckedAt, this.options.sessionFreshnessMs, this.now);
    const ready = Boolean(this.options.enabled)
      && browserAvailable
      && (this.options.mode === 'demo' || (freshSession && acceptingWork));
    return {
      browser_available: browserAvailable,
      browser_connected: Boolean(this.browser?.connected),
      session_state: this.sessionState,
      last_error: this.lastError,
      last_checked_at: this.lastCheckedAt,
      last_operation: this.lastOperation,
      last_success_at: this.lastSuccessAt,
      ready,
      readiness_reason: ready
        ? undefined
        : !this.options.enabled
          ? 'disabled'
          : !browserAvailable
            ? 'worker_unavailable'
            : !acceptingWork
              ? 'queue_full'
              : this.sessionState === 'challenge'
                ? 'challenge'
                : this.sessionState === 'authenticated'
                  ? 'session_stale'
                  : 'auth_required',
      headless: this.options.headless,
      queue: 'serial',
      queueDepth: queue.queueDepth,
      maxQueueDepth: queue.maxQueueDepth,
      queueWaitTimeoutMs: queue.queueWaitTimeoutMs,
      activeOperation: queue.activeOperation,
      queueMetrics: {
        accepted: queue.accepted,
        completed: queue.completed,
        rejected: queue.rejected,
        cancelled: queue.cancelled,
        maxObservedDepth: queue.maxObservedDepth,
        lastQueueWaitMs: queue.lastQueueWaitMs,
      },
      passive: true,
    };
  }

  async resolveCompany(input, operation) {
    return this.executeOperation('resolve_company', operation, async (context) => {
      const key = cacheKey('resolve', input);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, cached: true };

      if (input.linkedin_url) {
        const direct = normalizeCompanyUrl(input.linkedin_url);
        if (direct) {
          const result = {
            success: true,
            linkedin_url: direct,
            confidence: 99,
            provider: 'input',
            reason: 'URL do LinkedIn informada na entrada.',
            verificationLevel: 'url_only',
          };
          await this.cache.setResult(key, result);
          return result;
        }
      }

      const queries = companySearchQueries(input);
      const candidates = new Map();
      const warnings = [];

      for (const query of queries) {
        context.throwIfUnavailable(this.options.minNavigationBudgetMs);
        const rows = await this.searchBing(query, context);
        for (const candidate of companyUrlsFromSearchRows(rows)) {
          if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, provider: 'puppeteer_bing', query });
        }
        if (candidates.size >= this.options.maxCompanyCandidates) break;
      }

      if (candidates.size < this.options.maxCompanyCandidates) {
        for (const query of queries.slice(0, 2)) {
          context.throwIfUnavailable(this.options.minNavigationBudgetMs);
          const rows = await this.searchLinkedinCompanies(query, context);
          for (const candidate of companyUrlsFromSearchRows(rows)) {
            if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, provider: 'puppeteer_linkedin_search', query });
          }
        }
      }

      let best;
      for (const candidate of [...candidates.values()].slice(0, this.options.maxCompanyCandidates)) {
        context.throwIfUnavailable(this.options.minNavigationBudgetMs);
        const profile = await this.extractCompany(candidate.url, context);
        const confidence = scoreCompanyCandidate(input, candidate, profile);
        if (!best || confidence > best.confidence) best = { candidate, profile, confidence };
        if (confidence >= 95 && profile?.success) break;
      }

      const result = best && best.confidence >= 55
        ? {
            success: true,
            linkedin_url: best.candidate.url,
            confidence: best.confidence,
            provider: best.candidate.provider,
            reason: `Pagina localizada e comparada com nome, dominio e localidade. Consulta: ${best.candidate.query}`,
            verificationLevel: best.profile?.success ? 'company_verified' : 'url_only',
            company_profile: best.profile,
            warnings,
          }
        : {
            success: false,
            confidence: 0,
            provider: 'puppeteer',
            reason: candidates.size
              ? 'Foram encontradas paginas, mas nenhuma atingiu confianca minima para representar a empresa.'
              : 'Nenhuma Company Page foi encontrada pelo navegador.',
            warnings,
            errorCode: candidates.size ? 'company_not_verified' : 'no_company_candidate',
          };
      await this.cache.setResult(key, result);
      return result;
    });
  }

  async extractCompany(linkedinUrl, operation) {
    return this.executeOperation('extract_company', operation, async (context) => {
      const url = normalizeCompanyUrl(linkedinUrl);
      if (!url) return { success: false, linkedin_url: linkedinUrl, method_used: 'puppeteer_invalid_url', error: 'URL de empresa invalida.' };
      const key = cacheKey('company', url);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, cached: true };

      const result = await this.withPage(async (page) => {
        await this.navigate(page, `${url}/about/`, context);
        const snapshot = await pageSnapshot(page);
        const profile = parseCompanySnapshot(snapshot, url);
        this.observeSession(profile.authenticated, profile.error, profile.errorCode);
        throwForBlockedCode(profile.errorCode);
        return profile;
      }, context, 'extract_company_page');
      await this.cache.setResult(key, result);
      return result;
    });
  }

  async searchDecisionMakers(payload, operation) {
    return this.executeOperation('search_decision_makers', operation, async (context) => {
      const companyUrl = normalizeCompanyUrl(payload.linkedin_url);
      if (!companyUrl) {
        return { success: false, source: 'puppeteer_linkedin', decision_makers: [], warnings: ['URL da empresa no LinkedIn invalida.'] };
      }
      const key = cacheKey('people', payload);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, cached: true };

      const maxResults = Math.max(0, Number(payload.max_results ?? 8));
      const partnerNames = (payload.partner_names ?? []).map((value) => String(value).split(/\s+-\s+/)[0].trim()).filter(Boolean);
      const searches = unique([...partnerNames.slice(0, 3), ...(payload.keywords ?? [])]).slice(0, this.options.maxPeopleSearches);
      const warnings = [];
      let people = [];

      for (const keyword of searches) {
        if (people.length >= maxResults) break;
        context.throwIfUnavailable(this.options.minNavigationBudgetMs);
        const rows = await this.withPage(async (page) => {
          const peopleUrl = `${companyUrl}/people/?keywords=${encodeURIComponent(keyword)}`;
          await this.navigate(page, peopleUrl, context);
          await autoScroll(page, context);
          const snapshot = await pageSnapshot(page);
          const state = pageState(snapshot);
          this.observeSession(state.authenticated, state.reason, state.code);
          throwForBlockedState(state);
          return peopleRows(page);
        }, context, 'company_people_search');
        const verifiedRows = rows.map((row) => ({
          ...row,
          associationVerified: true,
          associationMethod: 'company_people',
          currentCompanyName: payload.company_name,
          currentCompanyLinkedinUrl: companyUrl,
        }));
        people = dedupePeople([...people, ...parsePeopleRows(verifiedRows, keyword, payload.company_name)]);
      }

      people = annotatePartnerMatches(people.filter((person) => person.associationVerified), partnerNames);
      const matchedPartners = new Set(people.filter((person) => person.partner_match).map((person) => person.matched_partner_name));
      for (const partnerName of partnerNames.filter((name) => !matchedPartners.has(name))) {
        if (people.length >= maxResults) break;
        context.throwIfUnavailable(this.options.minNavigationBudgetMs);
        const candidates = await this.searchGlobalPeople(`${partnerName} ${payload.company_name ?? ''}`, context);
        for (const candidate of parsePeopleRows(candidates, partnerName, payload.company_name).slice(0, 3)) {
          context.throwIfUnavailable(this.options.minNavigationBudgetMs);
          const verified = await this.verifyProfileAssociation(candidate, payload, companyUrl, context);
          if (verified) people = dedupePeople([...people, verified]);
          if (people.length >= maxResults) break;
        }
      }

      people = annotatePartnerMatches(people.filter((person) => person.associationVerified), partnerNames).slice(0, maxResults);
      if (this.options.extractProfileContacts && people.length) {
        const contactLimit = Math.min(this.options.maxContactProfiles, people.length);
        for (let index = 0; index < contactLimit; index += 1) {
          context.throwIfUnavailable(this.options.minNavigationBudgetMs);
          const contacts = await this.extractProfileContacts(people[index].linkedin_url, context);
          people[index] = { ...people[index], ...contacts };
        }
      }

      const result = {
        success: people.length > 0,
        source: 'puppeteer_linkedin',
        decision_makers: people,
        warnings: unique([
          ...warnings.filter(Boolean),
          ...(people.length ? [] : ['Nenhum decisor com vinculo atual comprovado foi encontrado.']),
        ]),
        errorCode: people.length ? undefined : 'no_verified_match',
      };
      await this.cache.setResult(key, result);
      return result;
    });
  }

  async searchGlobalPeople(keywords, operation) {
    return this.withPage(async (page, context) => {
      await this.navigate(page, `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`, context);
      await autoScroll(page, context);
      const snapshot = await pageSnapshot(page);
      const state = pageState(snapshot);
      this.observeSession(state.authenticated, state.reason, state.code);
      throwForBlockedState(state);
      return peopleRows(page);
    }, operation, 'global_people_search');
  }

  async verifyProfileAssociation(person, payload, companyUrl, operation) {
    return this.withPage(async (page, context) => {
      await this.navigate(page, `${person.linkedin_url}/details/experience/`, context);
      const snapshot = await pageSnapshot(page);
      const state = pageState(snapshot);
      this.observeSession(state.authenticated, state.reason, state.code);
      throwForBlockedState(state);
      const association = verifyCurrentCompanyAssociation(await experienceRows(page), {
        companyName: payload.company_name,
        linkedinUrl: companyUrl,
      });
      if (!association.verified) return undefined;
      return {
        ...person,
        associationVerified: true,
        associationMethod: 'current_experience',
        currentCompanyName: association.companyName ?? payload.company_name,
        currentCompanyLinkedinUrl: association.companyLinkedinUrl ?? companyUrl,
        confidence: Math.min(99, Math.max(person.confidence, association.confidence)),
      };
    }, operation, 'profile_association');
  }

  async checkSession(operation) {
    return this.executeOperation('session_check', operation, async (context) => {
      const result = await this.withPage(async (page) => {
        await this.navigate(page, 'https://www.linkedin.com/feed/', context);
        const snapshot = await pageSnapshot(page);
        const state = pageState(snapshot);
        this.observeSession(state.authenticated, state.reason, state.code);
        return {
          ok: state.authenticated && !state.blocked,
          authenticated: state.authenticated && !state.blocked,
          sessionState: this.sessionState,
          errorCode: state.code,
          error: state.reason,
          checkedAt: new Date().toISOString(),
        };
      }, context, 'session_check_page');
      return result;
    });
  }

  async extractProfileContacts(profileUrl, operation) {
    const url = normalizeProfileUrl(profileUrl);
    if (!url) return { emails: [], phones: [] };
    const key = cacheKey('contacts', url);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const contacts = await this.withPage(async (page, context) => {
      await this.navigate(page, `${url}/overlay/contact-info/`, context);
      const snapshot = await pageSnapshot(page);
      const state = pageState(snapshot);
      this.observeSession(state.authenticated, state.reason, state.code);
      throwForBlockedState(state);
      return contactValues(snapshot);
    }, operation, 'profile_contacts');
    await this.cache.setResult(key, contacts);
    return contacts;
  }

  async searchBing(query, operation) {
    return this.withPage(async (page, context) => {
      await this.navigate(page, `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`, context);
      return searchRows(page);
    }, operation, 'company_external_search');
  }

  async searchLinkedinCompanies(query, operation) {
    return this.withPage(async (page, context) => {
      const keywords = query.replace(/^site:linkedin\.com\/company\s*/i, '').replace(/["']/g, '');
      await this.navigate(page, `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(keywords)}`, context);
      const snapshot = await pageSnapshot(page);
      const state = pageState(snapshot);
      this.observeSession(state.authenticated, state.reason, state.code);
      throwForBlockedState(state);
      return searchRows(page);
    }, operation, 'company_internal_search');
  }

  async withPage(task, operation, stage = 'browser_page') {
    const { context, owned } = this.operationContext(operation);
    try {
      return await this.queue.enqueue(async () => {
        context.throwIfUnavailable();
        const browser = await this.ensureBrowser(context);
        context.throwIfUnavailable();
        const page = await waitForAbortableResource(
          () => browser.newPage(),
          context,
          closeResource,
        );
        const closeOnAbort = () => disposeResource(page, closeResource);
        context.signal.addEventListener('abort', closeOnAbort, { once: true });
        try {
          context.throwIfUnavailable();
          page.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
          page.setDefaultTimeout(this.options.navigationTimeoutMs);
          await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' });
          return await context.stage(stage, () => task(page, context));
        } catch (error) {
          throw asOperationError(error, context);
        } finally {
          context.signal.removeEventListener('abort', closeOnAbort);
          await closeWithTimeout(page, this.options.resourceCloseTimeoutMs);
        }
      }, { context, operation: stage });
    } finally {
      if (owned) context.dispose();
    }
  }

  async ensureBrowser(context) {
    if (this.browser?.connected) return this.browser;
    context?.throwIfUnavailable();
    let browser;
    try {
      await mkdir(this.options.profileDirectory, { recursive: true, mode: 0o700 });
      browser = await waitForAbortableResource(
        () => this.launchBrowser({
          headless: this.options.headless,
          userDataDir: this.options.profileDirectory,
          executablePath: this.options.executablePath,
          defaultViewport: { width: 1365, height: 900 },
          args: ['--lang=pt-BR', '--disable-dev-shm-usage'],
        }),
        context,
        closeResource,
      );
      context?.throwIfUnavailable();
    } catch (error) {
      if (browser) disposeResource(browser, closeResource);
      if (!context?.signal?.aborted && isTimeoutFailure(error)) {
        throw new WorkerOperationError('worker_unavailable', undefined, { cause: error });
      }
      throw asOperationError(error, context, 'worker_unavailable');
    }
    this.browser = browser;
    browser.on('disconnected', () => {
      if (this.browser === browser) this.browser = undefined;
      this.sessionState = 'disconnected';
    });
    return browser;
  }

  async navigate(page, url, operation) {
    const context = operation instanceof OperationContext ? operation : this.operationContext(operation).context;
    const waitMs = Math.max(0, this.options.minDelayMs - (this.now() - this.lastNavigationAt));
    context.throwIfUnavailable(waitMs + this.options.minNavigationBudgetMs);
    if (waitMs > 0) await context.wait(waitMs);
    context.throwIfUnavailable(this.options.minNavigationBudgetMs);
    this.lastNavigationAt = this.now();
    const timeout = Math.max(1, Math.min(this.options.navigationTimeoutMs, context.remainingMs()));
    await context.stage('navigation', () => page.goto(url, { waitUntil: 'domcontentloaded', timeout }));
    context.throwIfUnavailable();
    if (this.options.postNavigationDelayMs > 0) await context.wait(this.options.postNavigationDelayMs);
  }

  observeSession(authenticated, error, code) {
    this.lastCheckedAt = new Date().toISOString();
    if (authenticated) this.sessionState = 'authenticated';
    else if (code === 'auth_required' || /Sessao do LinkedIn ausente|login/i.test(String(error ?? ''))) this.sessionState = 'login_required';
    else if (code === 'challenge' || /verificacao manual|desafio/i.test(String(error ?? ''))) this.sessionState = 'challenge';
    this.lastError = error || undefined;
  }

  recordOperation(operation, success, error) {
    this.lastOperation = operation;
    this.lastCheckedAt = new Date().toISOString();
    if (success) this.lastSuccessAt = this.lastCheckedAt;
    this.lastError = success ? undefined : sanitizeError(error) || this.lastError;
  }

  async close() {
    this.queue.cancelAll(new WorkerOperationError('request_cancelled', 'Worker encerrando operacoes ativas.'));
    await this.queue.onIdle({ timeoutMs: this.options.shutdownTimeoutMs });
    await closeWithTimeout(this.browser, this.options.resourceCloseTimeoutMs);
    await this.cache.close();
  }

  operationContext(operation) {
    if (operation instanceof OperationContext) return { context: operation, owned: false };
    return {
      context: createOperationContext({
        ...operation,
        defaultTimeoutMs: this.options.operationTimeoutMs,
        maxTimeoutMs: this.options.maxOperationTimeoutMs,
        now: this.now,
      }),
      owned: true,
    };
  }

  async executeOperation(name, operation, action) {
    const { context, owned } = this.operationContext(operation);
    try {
      context.throwIfUnavailable();
      const result = await context.stage(name, () => action(context));
      const success = result?.success ?? result?.ok ?? true;
      this.recordOperation(name, success, result?.error ?? result?.reason);
      this.emitOperationLog(name, context, success, result?.errorCode);
      return result;
    } catch (error) {
      const typed = asOperationError(error, context);
      this.recordOperation(name, false, typed.message);
      this.emitOperationLog(name, context, false, typed.code);
      throw typed;
    } finally {
      if (owned) context.dispose();
    }
  }

  emitOperationLog(operation, context, success, errorCode) {
    this.log({
      event: 'linkedin_worker_operation',
      requestId: context.requestId,
      operation,
      success: Boolean(success),
      errorCode: errorCode || undefined,
      durationMs: context.elapsedMs(),
      queueWaitMs: context.queueWaitMs,
      remainingMs: context.remainingMs(),
      stages: Object.fromEntries(context.stageDurations),
      mode: this.options.mode,
      extractorVersion: this.options.extractorVersion,
    });
  }
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('main') ?? document.body;
    const heading = root.querySelector('h1');
    let headerRoot = heading?.parentElement;
    while (headerRoot?.parentElement && headerRoot.innerText.length < 120) headerRoot = headerRoot.parentElement;
    const links = [...root.querySelectorAll('a[href]')].map((anchor) => ({
      href: anchor.href,
      text: compact(anchor.textContent),
    }));
    const pairs = [...root.querySelectorAll('dt')].map((term) => ({
      label: compact(term.textContent),
      value: compact(term.nextElementSibling?.textContent),
    })).filter((pair) => pair.label && pair.value);
    for (const row of root.querySelectorAll('li')) {
      const children = [...row.children].map((child) => compact(child.textContent)).filter(Boolean);
      if (children.length === 2 && children[0].length < 80 && children[1].length < 300) {
        pairs.push({ label: children[0], value: children[1] });
      }
    }
    return {
      url: location.href,
      title: document.title,
      bodyText: String(root.innerText ?? '').trim(),
      headerText: compact(headerRoot?.innerText),
      headings: [...root.querySelectorAll('h1,h2')].map((item) => compact(item.textContent)).filter(Boolean),
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      links,
      pairs,
      authenticated: Boolean(document.querySelector('a[href*="/feed/"], a[href*="/mynetwork/"], nav[aria-label*="Primary" i]')),
    };
  });
}

async function searchRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href]')].map((anchor) => ({
    href: anchor.href,
    text: String(anchor.textContent ?? '').trim(),
    context: String(anchor.closest('li, article, [data-scope], .b_algo, div')?.textContent ?? '').trim(),
  })).filter((row) => row.href.includes('linkedin.com/company') || row.context.includes('linkedin.com/company')));
}

async function peopleRows(page) {
  return page.evaluate(() => {
    const root = document.querySelector('main');
    if (!root) return [];
    const suspicious = /segue esta p[aá]gina|follows this page|trabalha aqui|works here|people also viewed|pessoas tamb[eé]m/i;
    return [...root.querySelectorAll('a[href*="linkedin.com/in/"], a[href^="/in/"]')].map((anchor) => {
      const container = anchor.closest('li, article, [data-view-name], [data-chameleon-result-urn]') ?? anchor.parentElement?.parentElement;
      const name = String(anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').replace(/^View\s+/i, '').trim();
      const context = String(container?.innerText ?? container?.textContent ?? '').trim();
      return {
        href: anchor.href,
        name,
        text: String(anchor.textContent ?? '').trim(),
        context,
        rejected: suspicious.test(`${name} ${context}`),
      };
    }).filter((row) => !row.rejected);
  });
}

async function experienceRows(page) {
  return page.evaluate(() => {
    const root = document.querySelector('main');
    if (!root) return [];
    const sections = [...root.querySelectorAll('section')];
    const experience = sections.find((section) => /^(experi[eê]ncia|experience)$/i.test(String(section.querySelector('h2,h1')?.textContent ?? '').trim()))
      ?? root;
    return [...experience.querySelectorAll('li')].map((item) => {
      const text = String(item.innerText ?? item.textContent ?? '').trim();
      const companyLinks = [...item.querySelectorAll('a[href*="/company/"]')].map((anchor) => anchor.href);
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return {
        text,
        companyName: lines.find((line) => !/^(tempo integral|full-time|part-time|meio periodo)$/i.test(line)),
        companyLinks,
        current: /\b(o momento|atualmente|present|current)\b/i.test(text),
      };
    }).filter((row) => row.text && row.current);
  });
}

async function autoScroll(page, context) {
  context?.throwIfUnavailable();
  await page.evaluate(async () => {
    for (let index = 0; index < 3; index += 1) {
      window.scrollBy(0, Math.max(500, window.innerHeight * 0.8));
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  });
  context?.throwIfUnavailable();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function throwForBlockedState(state) {
  if (!state?.blocked) return;
  throw new WorkerOperationError(state.code || 'navigation_error');
}

function throwForBlockedCode(code) {
  if (['auth_required', 'challenge', 'navigation_error'].includes(code)) {
    throw new WorkerOperationError(code);
  }
}

function loggerFunction(logger) {
  if (typeof logger === 'function') return logger;
  if (typeof logger?.info === 'function') return (event) => logger.info(JSON.stringify(event));
  return () => undefined;
}

function sanitizeError(error) {
  const value = error instanceof Error ? error.message : String(error ?? '');
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\+?\d[\d ().-]{8,}\d\b/g, '[phone]')
    .replace(/([?&](?:token|code|session|auth)[^=]*=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 240) || undefined;
}

function waitForAbortableResource(createResource, context, dispose) {
  context?.throwIfUnavailable();
  const signal = context?.signal;
  const resourcePromise = Promise.resolve().then(createResource);
  if (!signal) return resourcePromise;

  return new Promise((resolve, reject) => {
    let completed = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (action) => {
      if (completed) return false;
      completed = true;
      cleanup();
      action();
      return true;
    };
    const onAbort = () => finish(() => reject(errorFromAbortSignal(signal)));

    signal.addEventListener('abort', onAbort, { once: true });
    resourcePromise.then(
      (resource) => {
        if (!finish(() => resolve(resource))) disposeResource(resource, dispose);
      },
      (error) => {
        finish(() => reject(error));
      },
    );
    if (signal.aborted) onAbort();
  });
}

function disposeResource(resource, dispose) {
  void Promise.resolve()
    .then(() => dispose(resource))
    .catch(() => undefined);
}

function closeResource(resource) {
  return resource?.close?.();
}

async function closeWithTimeout(resource, timeoutMs = 5_000) {
  if (!resource?.close) return;
  const waitMs = Math.max(1, Math.trunc(Number(timeoutMs) || 5_000));
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => resource.close()),
      new Promise((resolve) => {
        timer = setTimeout(resolve, waitMs);
        timer?.unref?.();
      }),
    ]);
  } catch {
    // Best effort: operation deadlines define the externally visible failure.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTimeoutFailure(error) {
  return error?.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(String(error?.message ?? ''));
}

function isFreshTimestamp(value, ttlMs, now = Date.now) {
  const timestamp = Date.parse(String(value ?? ''));
  if (!Number.isFinite(timestamp)) return false;
  return Math.max(0, now() - timestamp) <= Math.max(1, Number(ttlMs) || 1);
}
