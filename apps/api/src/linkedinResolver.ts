import { env } from './env.js';
import { CompanyInput, WorkerRequestOptions } from './types.js';
import { domainFromEmail, domainFromUrl, normalizeKey, onlyDigits } from './utils.js';
import { resolveCompanyPage } from './workerClient.js';

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
  ['orbital pay', 'https://www.linkedin.com/company/orbital-pay'],
];

export async function resolveLinkedInUrl(
  input: CompanyInput,
  options: WorkerRequestOptions = {},
): Promise<ResolveResult> {
  if (!env.linkedinEnabled) {
    return {
      confidence: 0,
      provider: 'linkedin_disabled',
      reason: 'Cruzamento com LinkedIn desativado por LINKEDIN_ENABLED=false.',
    };
  }

  if (env.workerMode === 'demo') return resolveDemo(input);

  if (input.linkedinUrl?.includes('linkedin.com/company/')) {
    return {
      linkedinUrl: cleanLinkedinCompanyUrl(input.linkedinUrl),
      confidence: 99,
      provider: 'input',
      reason: 'URL do LinkedIn informada na entrada; a extracao ainda validara o conteudo real.',
    };
  }

  const domain = domainFromUrl(input.site) ?? domainFromEmail(input.email);
  const result = await resolveCompanyPage({
    cnpj: onlyDigits(input.cnpj),
    companyName: input.nomeFantasia ?? input.razaoSocial,
    tradingName: input.nomeFantasia,
    legalName: input.razaoSocial,
    domain,
    website: input.site,
    email: input.email,
    city: input.cidade,
    uf: input.uf,
    linkedinUrl: input.linkedinUrl,
  }, options);
  return {
    linkedinUrl: result.linkedin_url ? cleanLinkedinCompanyUrl(result.linkedin_url) : undefined,
    confidence: result.confidence ?? 0,
    provider: result.provider || 'puppeteer',
    reason: result.reason || 'Worker Puppeteer nao retornou uma Company Page.',
  };
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
  return { confidence: 0, provider: 'demo', reason: 'Nao encontrado no dataset demo.' };
}

export function cleanLinkedinCompanyUrl(value: string): string {
  const match = value.match(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/company\/([^\s"'<>?&#/]+)/i);
  if (!match) return value.trim();
  return `https://www.linkedin.com/company/${match[1].replace(/\/$/, '')}`;
}
