import crypto from 'node:crypto';
import { cleanCompanyName, cleanDomain, normalizeCompanyUrl, normalizeKey } from './extractors.mjs';

export function demoResolve(payload) {
  const name = payload.trading_name || payload.company_name || payload.legal_name || 'empresa-demo';
  const slug = cleanCompanyName(name).replace(/\s+/g, '-') || 'empresa-demo';
  return {
    success: true,
    linkedin_url: `https://www.linkedin.com/company/${slug}`,
    confidence: 85,
    provider: 'demo_generated',
    reason: 'Company Page demonstrativa gerada a partir do nome local.',
  };
}

export function demoCompany(payload) {
  const name = payload.company_name || payload.trading_name || payload.legal_name || 'Empresa Demo';
  const linkedinUrl = normalizeCompanyUrl(payload.linkedin_url) || demoResolve(payload).linkedin_url;
  const domain = cleanDomain(payload.domain);
  return {
    success: true,
    linkedin_url: linkedinUrl,
    name,
    description: 'Perfil demonstrativo deterministico. Nenhum dado desta resposta e real.',
    website: domain ? `https://${domain}` : undefined,
    industry: 'Empresa local (demo)',
    company_size: '11-50 employees',
    employees_min: 11,
    employees_max: 50,
    headquarters: [payload.city, payload.uf].filter(Boolean).join(', '),
    method_used: 'demo_generated',
  };
}

export function demoDecisionMakers(payload) {
  const partner = String(payload.partner_names?.[0] ?? '').split(/\s+-\s+/)[0].trim();
  const name = partner || 'Pessoa Demonstrativa';
  const domain = cleanDomain(payload.domain);
  const emailLocal = normalizeKey(name).replace(/\s+/g, '.');
  const digest = crypto.createHash('sha256').update(`${payload.cnpj}|${name}`).digest('hex').slice(0, 6);
  return {
    success: true,
    source: partner ? 'demo_partner_match' : 'demo_generated',
    decision_makers: [{
      name,
      title: partner ? 'Socio(a) administrador(a)' : 'CEO',
      location: '',
      linkedin_url: `https://www.linkedin.com/in/${emailLocal || 'pessoa'}-${digest}-demo`,
      emails: domain && emailLocal ? [`${emailLocal}@${domain}`] : [],
      phones: [],
      confidence: partner ? 97 : 80,
      source: partner ? 'demo_partner_match' : 'demo_generated',
      partner_match: Boolean(partner),
      matched_partner_name: partner || undefined,
      partner_match_confidence: partner ? 100 : 0,
    }].slice(0, Math.max(0, Number(payload.max_results ?? 8))),
    warnings: ['Dados demonstrativos: nao utilizar comercialmente.'],
  };
}
