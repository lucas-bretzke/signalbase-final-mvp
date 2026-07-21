import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotatePartnerMatches,
  companyUrlsFromSearchRows,
  parseCompanySnapshot,
  parsePeopleRows,
  scoreCompanyCandidate,
  verifyCurrentCompanyAssociation,
} from '../src/extractors.mjs';

test('extracts a real company profile from semantic LinkedIn content', () => {
  const profile = parseCompanySnapshot({
    url: 'https://www.linkedin.com/company/ventura-web-solutions/about/',
    title: 'VENTURA Web Solutions | LinkedIn',
    headings: ['VENTURA Web Solutions', 'Visao geral'],
    bodyText: 'VENTURA Web Solutions\nVisao geral\nCriamos sites responsivos e personalizados.\nSite\nfabricioventura.com\nSetor\nPublicidade e propaganda',
    metaDescription: 'Criamos sites responsivos e personalizados para empresas que buscam alta performance.',
    links: [{ text: 'Site', href: 'http://fabricioventura.com' }],
    pairs: [
      { label: 'Site', value: 'http://fabricioventura.com' },
      { label: 'Setor', value: 'Publicidade e propaganda' },
    ],
    authenticated: true,
  }, 'https://www.linkedin.com/company/ventura-web-solutions');

  assert.equal(profile.success, true);
  assert.equal(profile.name, 'VENTURA Web Solutions');
  assert.equal(profile.website, 'https://fabricioventura.com');
  assert.equal(profile.industry, 'Publicidade e propaganda');
  assert.equal(profile.method_used, 'puppeteer_linkedin');
});

test('does not treat an auth wall as extracted company evidence', () => {
  const profile = parseCompanySnapshot({
    url: 'https://www.linkedin.com/authwall',
    title: 'LinkedIn Login',
    bodyText: 'Entre para ver esta pagina',
    headings: [], links: [], pairs: [], authenticated: false,
  }, 'https://www.linkedin.com/company/acme');
  assert.equal(profile.success, false);
  assert.equal(profile.method_used, 'puppeteer_blocked');
  assert.match(profile.error, /Sessao/);
});

test('collects, validates and scores company search candidates', () => {
  const candidates = companyUrlsFromSearchRows([{ href: 'https://www.linkedin.com/company/acme-tech/about/?trk=x', context: 'Acme Tech | LinkedIn' }]);
  assert.deepEqual(candidates.map((candidate) => candidate.url), ['https://www.linkedin.com/company/acme-tech']);
  const score = scoreCompanyCandidate(
    { company_name: 'ACME TECH LTDA', domain: 'acme.com.br', city: 'Blumenau', uf: 'SC' },
    candidates[0],
    { success: true, name: 'Acme Tech', website: 'https://acme.com.br', headquarters: 'Blumenau, SC' },
  );
  assert.ok(score >= 90);
});

test('extracts decision makers and matches them to Receita partners', () => {
  const people = parsePeopleRows([{
    href: 'https://www.linkedin.com/in/fabricio-ventura/',
    name: 'Fabricio Ventura',
    context: 'Fabricio Ventura\nSocio fundador e CEO\nBlumenau, SC, Brasil',
  }], 'CEO', 'VENTURA Web Solutions');
  const matched = annotatePartnerMatches(people, ['FABRICIO VENTURA']);
  assert.equal(matched[0].partner_match, true);
  assert.equal(matched[0].partner_match_confidence, 100);
  assert.equal(matched[0].source, 'puppeteer_linkedin');
});

test('does not copy followers or people from recommendation sidebars', () => {
  const profile = parseCompanySnapshot({
    url: 'https://www.linkedin.com/company/ventura-web-solutions/about/',
    title: 'VENTURA Web Solutions | LinkedIn',
    headings: ['VENTURA Web Solutions', 'Visao geral'],
    headerText: 'VENTURA Web Solutions Publicidade e propaganda Blumenau',
    bodyText: 'VENTURA Web Solutions\nVisao geral\nSite\nfabricioventura.com\nSerasa\n75.610 seguidores',
    links: [{ text: 'Site', href: 'https://fabricioventura.com' }],
    pairs: [{ label: 'Site', value: 'https://fabricioventura.com' }],
    authenticated: true,
  }, 'https://www.linkedin.com/company/ventura-web-solutions');
  const people = parsePeopleRows([
    { href: 'https://www.linkedin.com/in/luiza', name: 'Luiza segue esta pagina', context: 'Luiza segue esta pagina' },
    { href: 'https://www.linkedin.com/in/sarah', name: 'Sarah trabalha aqui', context: 'Pessoas tambem viram Sarah trabalha aqui' },
  ], 'CEO', 'VENTURA Web Solutions');
  assert.equal(profile.followers, undefined);
  assert.deepEqual(people, []);
});

test('accepts only current company experience', () => {
  const expected = { companyName: 'VENTURA Web Solutions', linkedinUrl: 'https://www.linkedin.com/company/ventura-web-solutions' };
  const current = verifyCurrentCompanyAssociation([{
    text: 'Socio fundador VENTURA Web Solutions jan 2020 - o momento',
    companyName: 'VENTURA Web Solutions',
    companyLinks: ['https://www.linkedin.com/company/ventura-web-solutions/about/'],
    current: true,
  }], expected);
  const former = verifyCurrentCompanyAssociation([{
    text: 'Diretor VENTURA Web Solutions jan 2018 - dez 2020',
    companyName: 'VENTURA Web Solutions',
    companyLinks: ['https://www.linkedin.com/company/ventura-web-solutions'],
    current: false,
  }], expected);
  assert.equal(current.verified, true);
  assert.equal(former.verified, false);
});
