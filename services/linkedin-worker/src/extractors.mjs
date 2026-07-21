import crypto from 'node:crypto';

const LEGAL_SUFFIXES = new Set([
  'ltda', 'limitada', 'eireli', 'sa', 's', 'a', 'me', 'mei', 'epp', 'holding',
  'participacoes', 'participacao', 'servicos',
]);

const DECISION_TERMS = [
  'ceo', 'chief executive', 'founder', 'co-founder', 'fundador', 'socio', 'owner',
  'diretor', 'diretora', 'director', 'cto', 'head', 'presidente', 'president', 'vp',
];

export function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function cleanCompanyName(value) {
  return normalizeKey(value).split(' ').filter((token) => !LEGAL_SUFFIXES.has(token)).join(' ');
}

export function cleanDomain(value) {
  const candidate = String(value ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split('@').at(-1)
    .replace(/^www\./, '')
    .split(':')[0];
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(candidate)) return undefined;
  if (['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'uol.com.br', 'bol.com.br'].includes(candidate)) return undefined;
  return candidate;
}

export function normalizeCompanyUrl(value) {
  const decoded = safeDecode(String(value ?? ''));
  const match = decoded.match(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/company\/([^\s"'<>?&#/]+)/i);
  return match ? `https://www.linkedin.com/company/${match[1].replace(/\/$/, '')}` : undefined;
}

export function normalizeProfileUrl(value) {
  const decoded = safeDecode(String(value ?? ''));
  const match = decoded.match(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/([^\s"'<>?&#/]+)/i);
  return match ? `https://www.linkedin.com/in/${match[1].replace(/\/$/, '')}` : undefined;
}

export function companySearchQueries(input) {
  const names = unique([input.company_name, input.trading_name, input.legal_name].map(cleanCompanyName).filter(Boolean));
  const domain = cleanDomain(input.domain ?? input.website ?? input.email);
  const location = [input.city, input.uf].filter(Boolean).join(' ');
  const queries = [];
  for (const name of names) {
    queries.push(`site:linkedin.com/company "${name}"`);
    if (domain) queries.push(`site:linkedin.com/company "${name}" "${domain}"`);
    if (location) queries.push(`site:linkedin.com/company "${name}" ${location}`);
  }
  if (domain) queries.push(`site:linkedin.com/company "${domain}"`);
  return unique(queries).slice(0, 5);
}

export function companyUrlsFromSearchRows(rows) {
  const found = new Map();
  for (const row of rows ?? []) {
    const candidates = [row.href, row.text, row.context];
    for (const candidate of candidates) {
      const direct = normalizeCompanyUrl(candidate);
      if (direct && !found.has(direct)) found.set(direct, { url: direct, context: String(row.context ?? row.text ?? '') });
      for (const embedded of String(candidate ?? '').match(/https?%3A%2F%2F(?:www\.)?linkedin\.com%2Fcompany%2F[^&\s]+/gi) ?? []) {
        const url = normalizeCompanyUrl(safeDecode(embedded));
        if (url && !found.has(url)) found.set(url, { url, context: String(row.context ?? row.text ?? '') });
      }
    }
  }
  return [...found.values()];
}

export function parseCompanySnapshot(snapshot, linkedinUrl) {
  const state = pageState(snapshot);
  if (state.blocked) {
    return {
      success: false,
      linkedin_url: normalizeCompanyUrl(linkedinUrl) ?? linkedinUrl,
      method_used: 'puppeteer_blocked',
      error: state.reason,
      authenticated: state.authenticated,
    };
  }

  const pairs = new Map((snapshot.pairs ?? []).map((pair) => [normalizeKey(pair.label), compact(pair.value)]));
  const lines = String(snapshot.bodyText ?? '').split(/\r?\n/).map(compact).filter(Boolean);
  const headings = (snapshot.headings ?? []).map(compact).filter(Boolean);
  const titleName = compact(String(snapshot.title ?? '').replace(/\s*[|\-]\s*LinkedIn.*$/i, ''));
  const name = headings.find((heading) => !/^(sobre|about|visao geral|overview|linkedin)$/i.test(heading)) || titleName || undefined;
  const website = findPair(pairs, ['site', 'website'])
    || externalWebsite(snapshot.links)
    || undefined;
  const industry = findPair(pairs, ['setor', 'industry']);
  const companySize = findPair(pairs, ['tamanho da empresa', 'company size']);
  const headquarters = findPair(pairs, ['sede', 'headquarters']);
  const founded = findPair(pairs, ['fundada em', 'fundado em', 'founded']);
  const followers = findPair(pairs, ['seguidores', 'followers']) || firstMatch(lines.join(' '), /([\d.,]+)\s+(?:seguidores|followers)/i);
  const description = usefulDescription(snapshot.metaDescription, lines, name);
  const [employeesMin, employeesMax] = employeeRange(companySize);
  const hasCompanyEvidence = Boolean(website || industry || companySize || headquarters || founded || followers || description);

  return {
    success: Boolean(name && hasCompanyEvidence),
    linkedin_url: normalizeCompanyUrl(linkedinUrl) ?? linkedinUrl,
    name,
    description,
    website: cleanWebsite(website),
    industry,
    company_size: companySize,
    employees_min: employeesMin,
    employees_max: employeesMax,
    headquarters,
    founded,
    followers,
    method_used: 'puppeteer_linkedin',
    authenticated: state.authenticated,
    error: name && hasCompanyEvidence ? undefined : 'A pagina abriu, mas nao apresentou dados corporativos suficientes.',
  };
}

export function scoreCompanyCandidate(input, candidate, profile) {
  const expectedNames = unique([input.company_name, input.trading_name, input.legal_name].map(cleanCompanyName).filter(Boolean));
  const profileName = cleanCompanyName(profile?.name);
  const slug = cleanCompanyName((normalizeCompanyUrl(candidate.url)?.split('/company/')[1] ?? '').replace(/-/g, ' '));
  const context = cleanCompanyName(candidate.context);
  const expectedDomain = cleanDomain(input.domain ?? input.website ?? input.email);
  const profileDomain = cleanDomain(profile?.website);
  let score = 0;

  for (const expected of expectedNames) {
    score = Math.max(score, tokenSimilarity(expected, profileName) * 70);
    score = Math.max(score, tokenSimilarity(expected, slug) * 58);
    score = Math.max(score, tokenSimilarity(expected, context) * 52);
  }
  if (expectedDomain && profileDomain === expectedDomain) score += 30;
  else if (expectedDomain && normalizeKey(candidate.context).includes(normalizeKey(expectedDomain))) score += 15;
  if (input.city && normalizeKey(profile?.headquarters).includes(normalizeKey(input.city))) score += 8;
  if (input.uf && normalizeKey(profile?.headquarters).split(' ').includes(normalizeKey(input.uf))) score += 4;
  if (profile?.success) score += 8;
  return Math.min(99, Math.round(score));
}

export function parsePeopleRows(rawRows, keyword, companyName) {
  const rows = [];
  for (const raw of rawRows ?? []) {
    const linkedinUrl = normalizeProfileUrl(raw.href);
    const lines = unique(String(raw.context ?? raw.text ?? '').split(/\r?\n/).map(compact).filter(Boolean));
    const name = compact(raw.name) || lines.find((line) => isLikelyPersonName(line));
    if (!linkedinUrl || !name || /linkedin member|usuario do linkedin|usuaria do linkedin/i.test(name)) continue;
    const title = lines.find((line) => line !== name && hasDecisionTerm(line))
      || lines.find((line) => line !== name && !isUiText(line) && line.length <= 180)
      || compact(keyword);
    const location = lines.find((line) => line !== name && line !== title && /\b[A-Z]{2}\b|Brazil|Brasil|Regiao|Region/i.test(line)) || '';
    rows.push({
      name,
      title,
      location,
      linkedin_url: linkedinUrl,
      emails: [],
      phones: [],
      confidence: decisionConfidence(title, keyword, companyName, raw.context),
      source: 'puppeteer_linkedin',
      matched_keyword: keyword,
    });
  }
  return dedupePeople(rows);
}

export function annotatePartnerMatches(people, partnerNames) {
  return (people ?? []).map((person) => {
    let bestName;
    let bestScore = 0;
    for (const partner of partnerNames ?? []) {
      const score = Math.round(tokenSimilarity(person.name, partner) * 100);
      if (score > bestScore) {
        bestName = partner;
        bestScore = score;
      }
    }
    return {
      ...person,
      partner_match: bestScore >= 70,
      matched_partner_name: bestScore >= 70 ? bestName : undefined,
      partner_match_confidence: bestScore,
    };
  }).sort((left, right) => (right.partner_match_confidence ?? 0) - (left.partner_match_confidence ?? 0) || right.confidence - left.confidence);
}

export function contactValues(snapshot) {
  const emails = new Set();
  const phones = new Set();
  for (const link of snapshot.links ?? []) {
    const href = String(link.href ?? '');
    if (/^mailto:/i.test(href)) emails.add(href.replace(/^mailto:/i, '').split('?')[0].trim());
    if (/^tel:/i.test(href)) phones.add(href.replace(/^tel:/i, '').trim());
  }
  for (const email of String(snapshot.bodyText ?? '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) emails.add(email);
  for (const phone of String(snapshot.bodyText ?? '').match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-.\s]?\d{4}/g) ?? []) {
    const digits = phone.replace(/\D/g, '');
    if ([10, 11, 12, 13].includes(digits.length)) phones.add(compact(phone));
  }
  return { emails: [...emails], phones: [...phones] };
}

export function pageState(snapshot) {
  const url = String(snapshot.url ?? '');
  const text = normalizeKey(snapshot.bodyText);
  const challenged = /checkpoint|challenge|captcha/i.test(url)
    || /security verification|verificacao de seguranca|quick security check|confirme que voce e humano/.test(text);
  const authRequired = /\/login|\/authwall|\/uas\/login/i.test(url)
    || /entre para ver|sign in to view|faca login para|join linkedin/.test(text);
  return {
    blocked: challenged || authRequired || !compact(snapshot.bodyText),
    reason: challenged
      ? 'O LinkedIn solicitou verificacao manual; o worker pausou sem tentar contornar o desafio.'
      : authRequired
        ? 'Sessao do LinkedIn ausente ou expirada. Execute npm run linkedin:login.'
        : !compact(snapshot.bodyText) ? 'A pagina retornou sem conteudo visivel.' : undefined,
    authenticated: Boolean(snapshot.authenticated) && !authRequired && !challenged,
  };
}

export function cacheKey(prefix, value) {
  return `${prefix}:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function dedupePeople(people) {
  const byKey = new Map();
  for (const person of people ?? []) {
    const key = normalizeProfileUrl(person.linkedin_url) ?? normalizeKey(person.name);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || person.confidence > current.confidence) byKey.set(key, person);
  }
  return [...byKey.values()];
}

function findPair(pairs, labels) {
  for (const label of labels) {
    const expected = normalizeKey(label);
    for (const [key, value] of pairs) {
      if (key === expected || key.startsWith(`${expected} `)) return value;
    }
  }
  return undefined;
}

function externalWebsite(links = []) {
  const preferred = links.find((link) => /^(site|website|visitar site)$/i.test(compact(link.text)) && cleanDomain(link.href));
  if (preferred) return preferred.href;
  return links.find((link) => cleanDomain(link.href) && !/linkedin\.com|bing\.com/i.test(link.href))?.href;
}

function cleanWebsite(value) {
  const domain = cleanDomain(value);
  return domain ? `https://${domain}` : undefined;
}

function usefulDescription(metaDescription, lines, name) {
  const meta = compact(metaDescription);
  if (meta && !/linkedin.*(?:login|sign in|professional community)/i.test(meta) && meta.length > 35) return meta;
  const headingIndex = lines.findIndex((line) => /^(visao geral|overview|sobre|about)$/i.test(normalizeKey(line)));
  if (headingIndex >= 0) {
    const candidate = lines.slice(headingIndex + 1, headingIndex + 5).find((line) => line.length > 45 && line !== name);
    if (candidate) return candidate;
  }
  return undefined;
}

function employeeRange(value) {
  const numbers = String(value ?? '').match(/[\d.,]+/g)?.map((part) => Number(part.replace(/\D/g, ''))).filter(Number.isFinite) ?? [];
  return [numbers[0], numbers[1] ?? numbers[0]];
}

function tokenSimilarity(left, right) {
  const a = new Set(cleanCompanyName(left).split(' ').filter((token) => token.length > 1));
  const b = new Set(cleanCompanyName(right).split(' ').filter((token) => token.length > 1));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const coverage = intersection / Math.min(a.size, b.size);
  return Math.max(intersection / union, coverage * 0.9);
}

function decisionConfidence(title, keyword, companyName, context) {
  const titleKey = normalizeKey(title);
  let score = 55;
  if (hasDecisionTerm(titleKey)) score += 22;
  if (normalizeKey(keyword) && titleKey.includes(normalizeKey(keyword))) score += 10;
  if (cleanCompanyName(companyName) && cleanCompanyName(context).includes(cleanCompanyName(companyName))) score += 5;
  return Math.min(98, score);
}

function hasDecisionTerm(value) {
  const key = normalizeKey(value);
  return DECISION_TERMS.some((term) => key.includes(normalizeKey(term)));
}

function isLikelyPersonName(value) {
  const words = compact(value).split(/\s+/);
  return words.length >= 2 && words.length <= 6 && !isUiText(value) && !hasDecisionTerm(value);
}

function isUiText(value) {
  return /^(conectar|connect|seguir|follow|ver perfil|view profile|mensagem|message|pessoas|people)$/i.test(compact(value));
}

function firstMatch(value, regex) {
  return value.match(regex)?.[1];
}

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
