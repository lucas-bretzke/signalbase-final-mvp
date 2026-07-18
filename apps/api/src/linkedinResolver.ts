import { env } from './env.js';
import { CompanyInput } from './types.js';
import { decodeHtml, domainFromEmail, domainFromUrl, normalizeKey, onlyDigits } from './utils.js';

export interface ResolveResult {
  linkedinUrl?: string;
  confidence: number;
  provider: string;
  reason: string;
}

const demoByCnpj: Record<string, string> = {
  '00000000000191': 'https://www.linkedin.com/company/banco-do-brasil',
  '11222333000181': 'https://www.linkedin.com/company/tech-azul-solutions',
  '22333444000172': 'https://www.linkedin.com/company/vertice-cloud',
  '33444555000110': 'https://www.linkedin.com/company/orbital-pay',
  '33444555000163': 'https://www.linkedin.com/company/orbital-pay',
};

const demoByName: Array<[string, string]> = [
  ['tech azul', 'https://www.linkedin.com/company/tech-azul-solutions'],
  ['banco do brasil', 'https://www.linkedin.com/company/banco-do-brasil'],
  ['vertice cloud', 'https://www.linkedin.com/company/vertice-cloud'],
  ['vértice cloud', 'https://www.linkedin.com/company/vertice-cloud'],
  ['orbital pay', 'https://www.linkedin.com/company/orbital-pay'],
];

export async function resolveLinkedInUrl(input: CompanyInput): Promise<ResolveResult> {
  if (input.linkedinUrl?.includes('linkedin.com/company/')) {
    return { linkedinUrl: cleanLinkedinCompanyUrl(input.linkedinUrl), confidence: 99, provider: 'input', reason: 'URL do LinkedIn informada no CSV.' };
  }

  const provider = env.searchProvider;
  if (provider === 'demo') return resolveDemo(input);
  if (provider === 'google_cse') return resolveGoogleCse(input);
  if (provider === 'duckduckgo') return resolveDuckDuckGo(input);
  return resolveDemo(input);
}

function resolveDemo(input: CompanyInput): ResolveResult {
  const cnpj = onlyDigits(input.cnpj);
  const byCnpj = demoByCnpj[cnpj];
  if (byCnpj) return { linkedinUrl: byCnpj, confidence: 98, provider: 'demo', reason: 'CNPJ encontrado no dataset demo.' };

  const name = normalizeKey(`${input.razaoSocial ?? ''} ${input.nomeFantasia ?? ''}`);
  for (const [term, url] of demoByName) {
    if (name.includes(normalizeKey(term))) {
      return { linkedinUrl: url, confidence: 92, provider: 'demo', reason: 'Nome semelhante encontrado no dataset demo.' };
    }
  }

  const generatedName = (input.nomeFantasia || input.razaoSocial || '').trim();
  if (generatedName) {
    const slug = normalizeKey(generatedName)
      .replace(/\b(ltda|eireli|sa|me|epp|mei)\b/g, ' ')
      .trim()
      .replace(/\s+/g, '-');
    if (slug) {
      return {
        linkedinUrl: `https://www.linkedin.com/company/${slug}`,
        confidence: 85,
        provider: 'demo_generated',
        reason: 'Company Page demonstrativa gerada de forma deterministica a partir do nome local.',
      };
    }
  }

  return { confidence: 0, provider: 'demo', reason: 'Não encontrado no dataset demo.' };
}

function companySearchTerms(input: CompanyInput): string[] {
  const domain = domainFromUrl(input.site) ?? domainFromEmail(input.email);
  const names = [input.nomeFantasia, input.razaoSocial].filter(Boolean).map((v) => String(v));
  const terms = new Set<string>();
  for (const name of names) {
    const cleanName = name.replace(/\b(ltda|eireli|s\/a|sa|me|epp|mei|holding|participacoes|participações)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (cleanName) terms.add(`site:linkedin.com/company ${cleanName}`);
    if (domain) terms.add(`site:linkedin.com/company ${cleanName} ${domain}`);
  }
  if (domain) terms.add(`site:linkedin.com/company ${domain}`);
  return [...terms].slice(0, 4);
}

async function resolveGoogleCse(input: CompanyInput): Promise<ResolveResult> {
  if (!env.googleCseApiKey || !env.googleCseId) {
    return { confidence: 0, provider: 'google_cse', reason: 'GOOGLE_CSE_API_KEY/GOOGLE_CSE_ID não configurados.' };
  }
  const terms = companySearchTerms(input);
  for (const q of terms) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', env.googleCseApiKey);
    url.searchParams.set('cx', env.googleCseId);
    url.searchParams.set('q', q);
    url.searchParams.set('num', '5');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json() as { items?: Array<{ link?: string; title?: string; snippet?: string }> };
      const best = chooseBestCandidate(input, data.items?.map((item) => item.link ?? '') ?? []);
      if (best.linkedinUrl) return { ...best, provider: 'google_cse', reason: `Match por busca: ${q}` };
    } catch {
      continue;
    }
  }
  return { confidence: 0, provider: 'google_cse', reason: 'Nenhuma company page encontrada.' };
}

async function resolveDuckDuckGo(input: CompanyInput): Promise<ResolveResult> {
  const terms = companySearchTerms(input);
  for (const q of terms) {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'user-agent': 'Mozilla/5.0 SignalBaseLeadResearch/1.0',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const candidates = extractLinkedInCompanyUrls(html);
      const best = chooseBestCandidate(input, candidates);
      if (best.linkedinUrl) return { ...best, provider: 'duckduckgo', reason: `Match por busca pública: ${q}` };
    } catch {
      continue;
    }
  }
  return { confidence: 0, provider: 'duckduckgo', reason: 'Nenhuma company page encontrada.' };
}

export function extractLinkedInCompanyUrls(html: string): string[] {
  const decoded = decodeHtml(html);
  const urls = new Set<string>();
  const regex = /https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s"'<>?&/]+/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(decoded))) {
    urls.add(cleanLinkedinCompanyUrl(match[0]));
  }
  return [...urls];
}

function chooseBestCandidate(input: CompanyInput, candidates: string[]): ResolveResult {
  const inputName = normalizeKey(`${input.nomeFantasia ?? ''} ${input.razaoSocial ?? ''}`);
  const domain = domainFromUrl(input.site) ?? domainFromEmail(input.email) ?? '';
  let best: ResolveResult = { confidence: 0, provider: env.searchProvider, reason: 'Sem candidato forte.' };
  for (const candidate of candidates) {
    const slug = normalizeKey(candidate.split('/company/')[1] ?? '');
    let score = 50;
    if (slug && inputName.includes(slug)) score += 35;
    if (slug && slug.split(' ').some((part) => part.length > 3 && inputName.includes(part))) score += 15;
    if (domain && candidate.toLowerCase().includes(domain.toLowerCase().replace(/^www\./, ''))) score += 10;
    if (score > best.confidence) {
      best = { linkedinUrl: cleanLinkedinCompanyUrl(candidate), confidence: Math.min(score, 95), provider: env.searchProvider, reason: 'Candidato mais forte encontrado.' };
    }
  }
  return best.confidence >= 55 ? best : { confidence: 0, provider: env.searchProvider, reason: 'Candidatos fracos ou ambíguos.' };
}

export function cleanLinkedinCompanyUrl(value: string): string {
  const match = value.match(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/company\/([^\s"'<>?&#/]+)/i);
  if (!match) return value.trim();
  return `https://www.linkedin.com/company/${match[1].replace(/\/$/, '')}`;
}
