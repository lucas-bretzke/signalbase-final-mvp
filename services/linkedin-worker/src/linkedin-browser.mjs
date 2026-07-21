import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { config } from './config.mjs';
import { JsonCache } from './cache.mjs';
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
} from './extractors.mjs';

export class LinkedinBrowserWorker {
  constructor(options = config) {
    this.options = options;
    this.cache = new JsonCache(options.cachePath, options.cacheTtlMs);
    this.browser = undefined;
    this.queueTail = Promise.resolve();
    this.lastNavigationAt = 0;
    this.sessionState = 'not_checked';
    this.lastError = undefined;
  }

  async initialize() {
    await this.cache.initialize();
  }

  health() {
    return {
      browser_available: true,
      browser_connected: Boolean(this.browser?.connected),
      session_state: this.sessionState,
      last_error: this.lastError,
      profile_directory: this.options.profileDirectory,
      headless: this.options.headless,
      queue: 'serial',
    };
  }

  async resolveCompany(input) {
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
        };
        await this.cache.set(key, result);
        return result;
      }
    }

    const queries = companySearchQueries(input);
    const candidates = new Map();
    const warnings = [];

    for (const query of queries) {
      const rows = await this.searchBing(query).catch((error) => {
        warnings.push(`Busca Bing falhou: ${errorMessage(error)}`);
        return [];
      });
      for (const candidate of companyUrlsFromSearchRows(rows)) {
        if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, provider: 'puppeteer_bing', query });
      }
      if (candidates.size >= this.options.maxCompanyCandidates) break;
    }

    if (candidates.size < this.options.maxCompanyCandidates) {
      for (const query of queries.slice(0, 2)) {
        const rows = await this.searchLinkedinCompanies(query).catch((error) => {
          warnings.push(`Busca interna do LinkedIn falhou: ${errorMessage(error)}`);
          return [];
        });
        for (const candidate of companyUrlsFromSearchRows(rows)) {
          if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, provider: 'puppeteer_linkedin_search', query });
        }
      }
    }

    let best;
    for (const candidate of [...candidates.values()].slice(0, this.options.maxCompanyCandidates)) {
      const profile = await this.extractCompany(candidate.url);
      const confidence = scoreCompanyCandidate(input, candidate, profile);
      if (!best || confidence > best.confidence) best = { candidate, profile, confidence };
    }

    const result = best && best.confidence >= 55
      ? {
          success: true,
          linkedin_url: best.candidate.url,
          confidence: best.confidence,
          provider: best.candidate.provider,
          reason: `Pagina localizada e comparada com nome, dominio e localidade. Consulta: ${best.candidate.query}`,
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
        };
    await this.cache.set(key, result);
    return result;
  }

  async extractCompany(linkedinUrl) {
    const url = normalizeCompanyUrl(linkedinUrl);
    if (!url) return { success: false, linkedin_url: linkedinUrl, method_used: 'puppeteer_invalid_url', error: 'URL de empresa invalida.' };
    const key = cacheKey('company', url);
    const cached = this.cache.get(key);
    if (cached) return { ...cached, cached: true };

    const result = await this.withPage(async (page) => {
      await this.navigate(page, `${url}/about/`);
      const snapshot = await pageSnapshot(page);
      const profile = parseCompanySnapshot(snapshot, url);
      this.observeSession(profile.authenticated, profile.error);
      return profile;
    });
    await this.cache.set(key, result);
    return result;
  }

  async searchDecisionMakers(payload) {
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
      const rows = await this.withPage(async (page) => {
        const peopleUrl = `${companyUrl}/people/?keywords=${encodeURIComponent(keyword)}`;
        await this.navigate(page, peopleUrl);
        await autoScroll(page);
        const snapshot = await pageSnapshot(page);
        const state = pageState(snapshot);
        this.observeSession(state.authenticated, state.reason);
        if (state.blocked) {
          warnings.push(state.reason);
          return [];
        }
        return peopleRows(page);
      }).catch((error) => {
        warnings.push(`Falha ao pesquisar "${keyword}": ${errorMessage(error)}`);
        return [];
      });
      people = dedupePeople([...people, ...parsePeopleRows(rows, keyword, payload.company_name)]);
    }

    people = annotatePartnerMatches(people, partnerNames).slice(0, maxResults);
    if (this.options.extractProfileContacts && people.length) {
      const contactLimit = Math.min(this.options.maxContactProfiles, people.length);
      for (let index = 0; index < contactLimit; index += 1) {
        const contacts = await this.extractProfileContacts(people[index].linkedin_url).catch((error) => {
          warnings.push(`Contato de ${people[index].name} indisponivel: ${errorMessage(error)}`);
          return { emails: [], phones: [] };
        });
        people[index] = { ...people[index], ...contacts };
      }
    }

    const result = {
      success: people.length > 0,
      source: 'puppeteer_linkedin',
      decision_makers: people,
      warnings: unique(warnings.filter(Boolean)),
    };
    await this.cache.set(key, result);
    return result;
  }

  async extractProfileContacts(profileUrl) {
    const url = normalizeProfileUrl(profileUrl);
    if (!url) return { emails: [], phones: [] };
    const key = cacheKey('contacts', url);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const contacts = await this.withPage(async (page) => {
      await this.navigate(page, `${url}/overlay/contact-info/`);
      const snapshot = await pageSnapshot(page);
      const state = pageState(snapshot);
      this.observeSession(state.authenticated, state.reason);
      return state.blocked ? { emails: [], phones: [] } : contactValues(snapshot);
    });
    await this.cache.set(key, contacts);
    return contacts;
  }

  async searchBing(query) {
    return this.withPage(async (page) => {
      await this.navigate(page, `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`);
      return searchRows(page);
    });
  }

  async searchLinkedinCompanies(query) {
    return this.withPage(async (page) => {
      const keywords = query.replace(/^site:linkedin\.com\/company\s*/i, '').replace(/["']/g, '');
      await this.navigate(page, `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(keywords)}`);
      const snapshot = await pageSnapshot(page);
      const state = pageState(snapshot);
      this.observeSession(state.authenticated, state.reason);
      return state.blocked ? [] : searchRows(page);
    });
  }

  async withPage(task) {
    return this.enqueue(async () => {
      const browser = await this.ensureBrowser();
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
      page.setDefaultTimeout(this.options.navigationTimeoutMs);
      await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' });
      try {
        return await task(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }

  async ensureBrowser() {
    if (this.browser?.connected) return this.browser;
    await mkdir(this.options.profileDirectory, { recursive: true });
    this.browser = await puppeteer.launch({
      headless: this.options.headless,
      userDataDir: this.options.profileDirectory,
      executablePath: this.options.executablePath,
      defaultViewport: { width: 1365, height: 900 },
      args: ['--lang=pt-BR', '--disable-dev-shm-usage'],
    });
    this.browser.on('disconnected', () => {
      this.browser = undefined;
      this.sessionState = 'disconnected';
    });
    return this.browser;
  }

  async navigate(page, url) {
    const waitMs = this.options.minDelayMs - (Date.now() - this.lastNavigationAt);
    if (waitMs > 0) await delay(waitMs);
    this.lastNavigationAt = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.options.navigationTimeoutMs });
    await delay(900);
  }

  enqueue(task) {
    const result = this.queueTail.then(task, task);
    this.queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  observeSession(authenticated, error) {
    if (authenticated) this.sessionState = 'authenticated';
    else if (/Sessao do LinkedIn ausente|login/i.test(String(error ?? ''))) this.sessionState = 'login_required';
    else if (/verificacao manual|desafio/i.test(String(error ?? ''))) this.sessionState = 'challenge';
    this.lastError = error || undefined;
  }

  async close() {
    await this.queueTail;
    await this.browser?.close().catch(() => undefined);
    await this.cache.close();
  }
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main') ?? document.body;
    const links = [...main.querySelectorAll('a[href]')].map((anchor) => ({
      href: anchor.href,
      text: compact(anchor.textContent),
    }));
    const pairs = [...main.querySelectorAll('dt')].map((term) => ({
      label: compact(term.textContent),
      value: compact(term.nextElementSibling?.textContent),
    })).filter((pair) => pair.label && pair.value);
    for (const row of main.querySelectorAll('li')) {
      const children = [...row.children].map((child) => compact(child.textContent)).filter(Boolean);
      if (children.length === 2 && children[0].length < 80 && children[1].length < 300) {
        pairs.push({ label: children[0], value: children[1] });
      }
    }
    return {
      url: location.href,
      title: document.title,
      bodyText: compact(document.body?.innerText),
      headings: [...main.querySelectorAll('h1,h2')].map((heading) => compact(heading.textContent)).filter(Boolean),
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
  return page.evaluate(() => [...document.querySelectorAll('a[href*="linkedin.com/in/"], a[href^="/in/"]')].map((anchor) => {
    const container = anchor.closest('li, article, [data-view-name], [data-chameleon-result-urn]') ?? anchor.parentElement?.parentElement;
    const name = String(anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').replace(/^View\s+/i, '').trim();
    return {
      href: anchor.href,
      name,
      text: String(anchor.textContent ?? '').trim(),
      context: String(container?.innerText ?? container?.textContent ?? '').trim(),
    };
  }));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    for (let index = 0; index < 3; index += 1) {
      window.scrollBy(0, Math.max(500, window.innerHeight * 0.8));
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
