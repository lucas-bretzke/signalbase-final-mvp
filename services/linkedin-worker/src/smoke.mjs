import { config } from './config.mjs';
import { LinkedinBrowserWorker } from './linkedin-browser.mjs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const input = parseArguments(process.argv.slice(2));
const companyName = input.company ?? 'VENTURA Web Solutions';
const linkedinUrl = input['linkedin-url'] ?? 'https://www.linkedin.com/company/ventura-web-solutions';
const partnerNames = String(input.partner ?? 'FABRICIO VENTURA').split(';').map((value) => value.trim()).filter(Boolean);
const smokeCachePath = path.join(os.tmpdir(), `signalbase-linkedin-smoke-${process.pid}.json`);
const worker = new LinkedinBrowserWorker({ ...config, mode: 'real', headless: false, cachePath: smokeCachePath });

await worker.initialize();
try {
  await stage('session', () => worker.checkSession());
  await stage('company', () => worker.extractCompany(linkedinUrl));
  await stage('decision_makers', () => worker.searchDecisionMakers({
    linkedin_url: linkedinUrl,
    company_name: companyName,
    partner_names: partnerNames,
    keywords: ['CEO', 'Founder', 'Socio', 'Diretor'],
    max_results: 8,
  }));
} finally {
  await worker.close();
  await rm(smokeCachePath, { force: true });
}

async function stage(name, action) {
  const startedAt = Date.now();
  const result = await action();
  console.log(JSON.stringify({
    stage: name,
    durationMs: Date.now() - startedAt,
    result: summarizeResult(name, result),
  }, null, 2));
  if (name === 'session' && !result.ok) throw new Error(result.error ?? 'Sessao do LinkedIn indisponivel.');
  return result;
}

function summarizeResult(name, result) {
  const common = {
    success: result.success ?? result.ok ?? false,
    errorCode: result.errorCode,
  };
  if (name === 'session') {
    return { ...common, authenticated: result.authenticated === true, sessionState: result.sessionState };
  }
  if (name === 'company') {
    return {
      ...common,
      hasCompanyData: Boolean(result.name || result.industry || result.description || result.company_size),
      method: result.method_used,
    };
  }
  return {
    ...common,
    decisionMakerCount: Array.isArray(result.decision_makers) ? result.decision_makers.length : 0,
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
  };
}

function parseArguments(values) {
  return Object.fromEntries(values.map((value) => {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }).filter(([key, value]) => key && value));
}
