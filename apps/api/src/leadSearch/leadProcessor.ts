import crypto from 'node:crypto';
import { enrichCompany } from '../enrich.js';
import { env } from '../env.js';
import { DecisionMaker, EnrichedLead } from '../types.js';
import { normalizeCnpj, normalizeKey } from '../utils.js';
import {
  isCorporateEmail,
  isGenericEmail,
  isMobilePhone,
  isValidEmail,
  isValidPhone,
  nameSimilarity,
  splitContactValues,
} from './contactValidation.js';
import {
  ContactEvidenceLevel,
  DecisionMakerMatch,
  LeadCrossMatch,
  LeadProcessingContext,
  LeadProcessingOutcome,
  LeadProcessor,
  LeadSearch,
  LeadSearchResult,
  LinkedinEvidenceLevel,
  MatchConfidenceLevel,
  ReceitaCompany,
} from './types.js';

interface ContactChoice {
  value: string;
  source: 'decision_maker' | 'receita';
}

interface LeadEvidenceSignals {
  minQuality: NonNullable<LeadSearch['minQuality']>;
  qualityLevel: NonNullable<LeadSearch['minQuality']>;
  linkedinEvidenceLevel: LinkedinEvidenceLevel;
  contactEvidenceLevel: ContactEvidenceLevel;
  isDemoEvidence: boolean;
  emailNameMatched: boolean;
  hasRealLinkedin: boolean;
  hasLinkedinCompanyData: boolean;
  hasRealDecisionMaker: boolean;
  hasDecisionMakerProfile: boolean;
  hasDecisionMakerContact: boolean;
  hasDecisionMakerPhone: boolean;
  hasStrongLocalIdentity: boolean;
  matchConfidenceRequired: number;
}

interface QualityRequirements {
  requireRealLinkedin: boolean;
  requireLinkedinCompanyData: boolean;
  requireRealDecisionMaker: boolean;
  requireDecisionMakerProfile: boolean;
  requireDecisionMakerContact: boolean;
  requireNamedEmail: boolean;
  requireDecisionMakerPhone: boolean;
  requireNonGenericEmail: boolean;
  requireCompanyDataDecisionMakerOrNamedEmail: boolean;
  requireDecisionMakerContactOrNamedEmail: boolean;
  requireStrongLocalIdentity: boolean;
  matchConfidenceRequired?: number;
}

export class EnrichmentLeadProcessor implements LeadProcessor {
  async process(search: LeadSearch, candidate: ReceitaCompany, context?: LeadProcessingContext): Promise<LeadProcessingOutcome> {
    if (!env.linkedinEnabled) return evaluateEnrichedLead(search, candidate, localLeadFromCandidate(candidate));

    const minQuality = search.minQuality ?? minQualityFromScore(search.minScore ?? 0);
    const enriched = await enrichCompany({
      cnpj: candidate.cnpj,
      razaoSocial: candidate.legalName,
      nomeFantasia: candidate.tradingName,
      site: candidate.website,
      email: candidate.email,
      telefone: candidate.phone,
      socios: candidate.partners.join('; '),
      linkedinUrl: candidate.linkedinUrl,
      cidade: candidate.city,
      uf: candidate.uf,
      cnae: candidate.cnae,
    }, {
      minQuality,
      requireEmail: search.requireEmail,
      requirePhone: search.requirePhone,
      onlyMobilePhone: search.onlyMobilePhone,
      emailType: search.emailType,
      excludeGenericContacts: search.excludeGenericContacts,
      requireNamedEmail: search.requireNamedEmail,
      requireDecisionMakerMatch: search.requireDecisionMakerMatch || (search.matchConfidenceLevel ?? 'normal') !== 'normal',
      requireRealDecisionMaker: search.requireRealDecisionMaker,
      requireDecisionMakerProfile: search.requireDecisionMakerProfile,
      requireDecisionMakerContact: search.requireDecisionMakerContact,
      requireDecisionMakerPhone: search.requireDecisionMakerPhone,
      signal: context?.signal,
      requestId: context?.requestId,
      deadline: context?.deadline,
    });

    if (!enriched.lead) {
      return rejectedWithoutMatch(search, candidate, enriched.rejected?.reason ?? 'Empresa nao pode ser enriquecida.');
    }
    return evaluateEnrichedLead(search, candidate, enriched.lead);
  }
}

export function evaluateEnrichedLead(
  search: LeadSearch,
  candidate: ReceitaCompany,
  lead: EnrichedLead,
  timestamp = new Date().toISOString(),
): LeadProcessingOutcome {
  const matched = bestPartnerDecisionMakerMatch(candidate.partners, lead.decisionMakers);
  const decisionMaker = matched.person ?? lead.bestDecisionMaker;
  const email = chooseEmail(decisionMaker, lead, candidate, search);
  const phone = choosePhone(decisionMaker, lead, candidate, search);
  const signals = assessLeadEvidence(search, lead, candidate, decisionMaker, email, phone, matched.match);
  const finalScore = finalScoreFor(lead.score, matched.match, signals);
  const rejectionReasons = validationFailures(search, finalScore, email, phone, matched.match, signals);
  const status = rejectionReasons.length ? 'rejected' : 'valid';
  const crossMatchId = stableEntityId('cross', `${search.id}:${candidate.cnpj}`);
  const evidence = [
    `Receita Federal local: ${candidate.cnpj}, CNAE ${candidate.cnae}, ${candidate.city}/${candidate.uf}.`,
    ...lead.evidence,
    matched.match.explanation,
    `Qualidade calculada: ${qualityLabel(signals.qualityLevel)}; minima solicitada ${qualityLabel(signals.minQuality)}.`,
    `Evidencia LinkedIn: ${signals.linkedinEvidenceLevel}; evidencia de contato: ${signals.contactEvidenceLevel}.`,
    ...(signals.isDemoEvidence ? ['Evidencia demonstrativa detectada; nao use este contato em campanhas reais.'] : []),
    ...(signals.emailNameMatched ? ['E-mail final contem nome do socio/decisor, aumentando a confianca do contato.'] : []),
    ...(email ? [`E-mail final validado (${email.source}): ${email.value}.`] : ['Nenhum e-mail valido selecionado.']),
    ...(phone ? [`Telefone final validado (${phone.source}${isMobilePhone(phone.value) ? ', celular' : ''}): ${phone.value}.`] : ['Nenhum telefone valido selecionado.']),
    `Score tecnico final ${finalScore}/100; corte numerico legado ${search.minScore}/100.`,
  ];

  const crossMatch: LeadCrossMatch = {
    id: crossMatchId,
    cnpj: normalizeCnpj(candidate.cnpj),
    companyName: lead.companyName,
    tradingName: candidate.tradingName,
    city: candidate.city,
    uf: candidate.uf,
    cnae: candidate.cnae,
    partners: candidate.partners,
    companyLinkedinUrl: lead.linkedinUrl,
    companyWebsite: lead.website ?? candidate.website,
    company: {
      cnpj: normalizeCnpj(candidate.cnpj),
      legalName: candidate.legalName,
      tradeName: candidate.tradingName,
      city: candidate.city,
      uf: candidate.uf,
      primaryCnae: candidate.cnae,
      partners: candidate.partners,
      linkedinUrl: lead.linkedinUrl,
      website: lead.website ?? candidate.website,
    },
    decisionMaker,
    decisionMakerMatch: matched.match,
    decisionMakerMatched: matched.match.matched,
    finalEmail: email?.value,
    finalPhone: phone?.value,
    emailValidated: Boolean(email),
    phoneValidated: Boolean(phone),
    emailCorporate: Boolean(email && isCorporateEmail(email.value)),
    emailGeneric: Boolean(email && isGenericEmail(email.value)),
    phoneMobile: Boolean(phone && isMobilePhone(phone.value)),
    emailSource: email?.source,
    phoneSource: phone?.source,
    linkedinEvidenceLevel: signals.linkedinEvidenceLevel,
    contactEvidenceLevel: signals.contactEvidenceLevel,
    isDemoEvidence: signals.isDemoEvidence,
    emailNameMatched: signals.emailNameMatched,
    finalScore,
    evidence,
    warnings: [...lead.warnings, ...rejectionReasons],
    enrichedLead: lead,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const result: LeadSearchResult = {
    id: stableEntityId('result', `${search.id}:${candidate.cnpj}`),
    leadSearchId: search.id,
    cnpj: normalizeCnpj(candidate.cnpj),
    leadCrossMatchId: crossMatch.id,
    finalScore,
    status,
    selected: status === 'valid',
    candidate,
    rejectionReasons,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { result, crossMatch };
}

export function bestPartnerDecisionMakerMatch(
  partners: string[],
  decisionMakers: DecisionMaker[],
): { match: DecisionMakerMatch; person?: DecisionMaker } {
  const eligibleDecisionMakers = env.workerMode === 'demo'
    ? decisionMakers
    : decisionMakers.filter((person) => !isDemoDecisionMaker(person) && person.associationVerified === true);
  if (!partners.length) {
    return { match: { matched: false, confidence: 0, explanation: 'Receita Federal local nao informou socios para comparacao.' } };
  }
  if (!eligibleDecisionMakers.length) {
    return { match: { matched: false, confidence: 0, explanation: 'Nenhum decisor do LinkedIn disponivel para comparar com os socios.' } };
  }

  let best: { confidence: number; partner: string; person: DecisionMaker } | undefined;
  for (const person of eligibleDecisionMakers) {
    for (const partner of partners) {
      const localConfidence = nameSimilarity(partner, person.name);
      const hintedConfidence = person.partner_match ? (person.partner_match_confidence ?? 100) : 0;
      const confidence = Math.max(localConfidence, hintedConfidence);
      const matchedPartner = person.matched_partner_name || partner;
      if (!best || confidence > best.confidence) best = { confidence, partner: matchedPartner, person };
    }
  }
  const matched = Boolean(best && best.confidence >= 70);
  return {
    person: matched ? best?.person : undefined,
    match: {
      matched,
      confidence: best?.confidence ?? 0,
      partnerName: best?.partner,
      decisionMakerName: best?.person.name,
      explanation: matched
        ? `Socio ${best?.partner} corresponde ao decisor ${best?.person.name} (${best?.confidence}% de confianca).`
        : `Melhor comparacao socio-decisor ficou em ${best?.confidence ?? 0}%, abaixo do corte de 70%.`,
    },
  };
}

function chooseEmail(
  decisionMaker: DecisionMaker | undefined,
  lead: EnrichedLead,
  candidate: ReceitaCompany,
  search: LeadSearch,
): ContactChoice | undefined {
  const contacts: ContactChoice[] = [
    ...(decisionMaker?.emails ?? []).map((value) => ({ value, source: 'decision_maker' as const })),
    ...splitContactValues(lead.companyEmail ?? candidate.email).map((value) => ({ value, source: 'receita' as const })),
  ].filter((contact) => isValidEmail(contact.value));
  const eligible = contacts.filter((contact) => matchesEmailType(contact.value, emailTypeOf(search))
    && (!search.excludeGenericContacts || !isGenericEmail(contact.value)));
  return eligible.sort((left, right) => emailPriority(right) - emailPriority(left))[0];
}

function choosePhone(
  decisionMaker: DecisionMaker | undefined,
  lead: EnrichedLead,
  candidate: ReceitaCompany,
  search: LeadSearch,
): ContactChoice | undefined {
  const contacts: ContactChoice[] = [
    ...(decisionMaker?.phones ?? []).map((value) => ({ value, source: 'decision_maker' as const })),
    ...splitContactValues(lead.companyPhone ?? candidate.phone).map((value) => ({ value, source: 'receita' as const })),
  ].filter((contact) => isValidPhone(contact.value));
  const eligible = contacts.filter((contact) => !search.onlyMobilePhone || isMobilePhone(contact.value));
  return eligible.sort((left, right) => phonePriority(right) - phonePriority(left))[0];
}

function assessLeadEvidence(
  search: LeadSearch,
  lead: EnrichedLead,
  candidate: ReceitaCompany,
  decisionMaker: DecisionMaker | undefined,
  email: ContactChoice | undefined,
  phone: ContactChoice | undefined,
  match: DecisionMakerMatch,
): LeadEvidenceSignals {
  const isDemoEvidence = hasDemoEvidence(lead, decisionMaker);
  const hasAnyCompanyData = hasExtractedCompanyData(lead);
  const hasRealCompanyData = hasAnyCompanyData && !isDemoValue(lead.companyExtractionMethod) && env.workerMode !== 'demo';
  const hasTrustedCompanyData = env.workerMode === 'demo' ? hasAnyCompanyData : hasRealCompanyData;
  const hasRealLinkedin = Boolean(lead.linkedinUrl) && !isDemoEvidence && !isDemoValue(lead.linkedinProvider);
  const hasTrustedLinkedin = env.workerMode === 'demo' ? Boolean(lead.linkedinUrl) : hasRealLinkedin;
  const hasRealDecisionMaker = Boolean(decisionMaker)
    && !isDemoDecisionMaker(decisionMaker)
    && decisionMaker?.associationVerified === true;
  const hasTrustedDecisionMaker = env.workerMode === 'demo' ? Boolean(decisionMaker) : hasRealDecisionMaker;
  const hasDecisionMakerProfile = Boolean(decisionMaker?.linkedin_url) && (env.workerMode === 'demo' || !isDemoValue(decisionMaker?.linkedin_url));
  const hasDecisionMakerContact = Boolean(decisionMaker && (email?.source === 'decision_maker' || phone?.source === 'decision_maker'))
    && (env.workerMode === 'demo' || hasRealDecisionMaker);
  const hasDecisionMakerPhone = Boolean(decisionMaker && phone?.source === 'decision_maker')
    && (env.workerMode === 'demo' || hasRealDecisionMaker);
  const emailNameMatched = email ? emailContainsPersonName(email.value, [
    decisionMaker?.name,
    match.partnerName,
    match.decisionMakerName,
    ...candidate.partners,
  ], email.source) : false;
  const hasContact = Boolean(email || phone);
  const hasStrongLocalIdentity = !env.linkedinEnabled
    && Boolean(email && phone && (lead.website || candidate.website) && emailNameMatched);
  const minQuality = search.minQuality ?? minQualityFromScore(search.minScore ?? 0);

  let qualityLevel: LeadEvidenceSignals['qualityLevel'] = 'baixo';
  if (hasContact && (hasTrustedLinkedin || hasTrustedCompanyData || lead.website || candidate.website)) qualityLevel = 'medio';
  if (hasContact && (hasTrustedCompanyData || hasTrustedDecisionMaker || (emailNameMatched && (hasTrustedLinkedin || hasStrongLocalIdentity)))) qualityLevel = 'alto';
  if (hasContact && hasTrustedDecisionMaker && hasDecisionMakerContact && match.matched && match.confidence >= 85) qualityLevel = 'muito_alto';

  return {
    minQuality,
    qualityLevel,
    linkedinEvidenceLevel: linkedinEvidenceLevelOf(lead, isDemoEvidence, hasAnyCompanyData, hasRealCompanyData),
    contactEvidenceLevel: contactEvidenceLevelOf(email, phone, emailNameMatched, isDemoEvidence),
    isDemoEvidence,
    emailNameMatched,
    hasRealLinkedin,
    hasLinkedinCompanyData: env.workerMode === 'demo' ? hasAnyCompanyData : hasRealCompanyData,
    hasRealDecisionMaker,
    hasDecisionMakerProfile,
    hasDecisionMakerContact,
    hasDecisionMakerPhone,
    hasStrongLocalIdentity,
    matchConfidenceRequired: matchConfidenceThreshold(search.matchConfidenceLevel),
  };
}

function finalScoreFor(baseScore: number, match: DecisionMakerMatch, signals: LeadEvidenceSignals): number {
  let score = baseScore + (match.matched ? 5 : 0) + (signals.emailNameMatched ? 8 : 0) + (signals.hasStrongLocalIdentity ? 8 : 0);
  let cap = 99;
  const realMode = env.workerMode !== 'demo';
  if (realMode && signals.isDemoEvidence) cap = 49;
  else if (realMode && !signals.hasRealLinkedin) cap = signals.emailNameMatched ? 88 : 74;
  else if (realMode && !signals.hasLinkedinCompanyData && !signals.hasRealDecisionMaker) cap = signals.emailNameMatched ? 92 : 84;
  else if (!canReachPerfectScore(signals, match)) cap = signals.emailNameMatched ? 95 : 94;
  if (canReachPerfectScore(signals, match)) cap = 100;
  score = Math.min(score, cap);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function canReachPerfectScore(signals: LeadEvidenceSignals, match: DecisionMakerMatch): boolean {
  return !signals.isDemoEvidence
    && signals.hasRealLinkedin
    && signals.hasLinkedinCompanyData
    && signals.hasRealDecisionMaker
    && signals.hasDecisionMakerContact
    && match.matched
    && match.confidence >= 90;
}

function validationFailures(
  search: LeadSearch,
  finalScore: number,
  email: ContactChoice | undefined,
  phone: ContactChoice | undefined,
  match: DecisionMakerMatch,
  signals: LeadEvidenceSignals,
): string[] {
  const failures: string[] = [];
  const minimumScore = search.minScore ?? scoreFromMinQuality(signals.minQuality);
  const automatic = automaticQualityRequirements(signals.minQuality);
  const requiredMatchConfidence = Math.max(
    signals.matchConfidenceRequired,
    automatic.matchConfidenceRequired ?? 0,
  );
  if (!email && !phone) failures.push('Contato tecnico valido obrigatorio nao encontrado.');
  if (env.workerMode !== 'demo' && signals.isDemoEvidence) failures.push('Evidencia demonstrativa nao e aceita no modo real.');
  if (qualityRank(signals.qualityLevel) < qualityRank(signals.minQuality)) failures.push(`Qualidade ${qualityLabel(signals.qualityLevel)} abaixo da minima ${qualityLabel(signals.minQuality)}.`);
  if (finalScore < minimumScore) failures.push(`Score tecnico ${finalScore} abaixo do minimo legado ${minimumScore}.`);
  if (search.requirePhone && !phone) failures.push('Telefone valido obrigatorio nao encontrado.');
  if (search.onlyMobilePhone && (!phone || !isMobilePhone(phone.value))) failures.push('Celular valido obrigatorio nao encontrado.');
  if (search.requireEmail && !email) failures.push('E-mail valido obrigatorio nao encontrado.');
  if (search.onlyCorporateEmail && (!email || !isCorporateEmail(email.value))) failures.push('E-mail corporativo valido obrigatorio nao encontrado.');
  if (emailTypeOf(search) === 'non_corporate' && (!email || isCorporateEmail(email.value))) failures.push('E-mail nao corporativo valido obrigatorio nao encontrado.');
  if (search.excludeGenericContacts && email && isGenericEmail(email.value)) failures.push('O e-mail final e generico.');
  if (automatic.requireNonGenericEmail && email && isGenericEmail(email.value)) failures.push('Qualidade alta nao aceita e-mail generico como contato final.');
  if ((search.requireRealLinkedin || automatic.requireRealLinkedin) && !signals.hasRealLinkedin) failures.push('LinkedIn real obrigatorio nao encontrado.');
  if ((search.requireLinkedinCompanyData || automatic.requireLinkedinCompanyData) && !signals.hasLinkedinCompanyData) failures.push('Dados reais da empresa no LinkedIn obrigatorios nao encontrados.');
  if ((search.requireRealDecisionMaker || automatic.requireRealDecisionMaker) && !signals.hasRealDecisionMaker) failures.push('Decisor real obrigatorio nao encontrado.');
  if ((search.requireDecisionMakerProfile || automatic.requireDecisionMakerProfile) && !signals.hasDecisionMakerProfile) failures.push('Perfil LinkedIn do decisor obrigatorio nao encontrado.');
  if ((search.requireDecisionMakerContact || automatic.requireDecisionMakerContact) && !signals.hasDecisionMakerContact) failures.push('Contato do decisor obrigatorio nao encontrado.');
  if ((search.requireNamedEmail || automatic.requireNamedEmail) && !signals.emailNameMatched) failures.push('E-mail com nome do socio ou decisor obrigatorio nao encontrado.');
  if ((search.requireDecisionMakerPhone || automatic.requireDecisionMakerPhone) && !signals.hasDecisionMakerPhone) failures.push('Telefone do decisor obrigatorio nao encontrado.');
  if (automatic.requireCompanyDataDecisionMakerOrNamedEmail && !signals.hasLinkedinCompanyData && !signals.hasRealDecisionMaker && !signals.emailNameMatched) failures.push('Qualidade alta exige dados reais da empresa, decisor real ou e-mail com nome do socio/decisor.');
  if (automatic.requireDecisionMakerContactOrNamedEmail && !signals.hasDecisionMakerContact && !signals.emailNameMatched) failures.push('Qualidade muito alta exige contato do decisor ou e-mail com nome do socio/decisor.');
  if (automatic.requireStrongLocalIdentity && !signals.hasStrongLocalIdentity) failures.push('Sem LinkedIn, qualidade alta exige e-mail com nome, telefone valido e site da empresa.');
  const shouldEnforceMatch = search.requireDecisionMakerMatch || (search.matchConfidenceLevel ?? 'normal') !== 'normal' || Boolean(automatic.matchConfidenceRequired);
  if (shouldEnforceMatch && (!match.matched || match.confidence < requiredMatchConfidence)) failures.push(`Correspondencia entre socio e decisor abaixo de ${requiredMatchConfidence}% de confianca.`);
  return failures;
}

function minQualityFromScore(score: number): NonNullable<LeadSearch['minQuality']> {
  if (score >= 85) return 'muito_alto';
  if (score >= 70) return 'alto';
  if (score >= 50) return 'medio';
  return 'baixo';
}

function scoreFromMinQuality(value: NonNullable<LeadSearch['minQuality']>): number {
  if (value === 'muito_alto') return 85;
  if (value === 'alto') return 70;
  if (value === 'medio') return 50;
  return 0;
}

function automaticQualityRequirements(value: NonNullable<LeadSearch['minQuality']>): QualityRequirements {
  const disabled: QualityRequirements = {
    requireRealLinkedin: false,
    requireLinkedinCompanyData: false,
    requireRealDecisionMaker: false,
    requireDecisionMakerProfile: false,
    requireDecisionMakerContact: false,
    requireNamedEmail: false,
    requireDecisionMakerPhone: false,
    requireNonGenericEmail: false,
    requireCompanyDataDecisionMakerOrNamedEmail: false,
    requireDecisionMakerContactOrNamedEmail: false,
    requireStrongLocalIdentity: false,
  };
  if (env.workerMode === 'demo' || value === 'baixo' || value === 'medio') return disabled;
  if (value === 'alto') {
    if (!env.linkedinEnabled) {
      return {
        ...disabled,
        requireNonGenericEmail: true,
        requireStrongLocalIdentity: true,
      };
    }
    return {
      ...disabled,
      requireRealLinkedin: true,
      requireNonGenericEmail: true,
      requireCompanyDataDecisionMakerOrNamedEmail: true,
    };
  }
  return {
    ...disabled,
    requireRealLinkedin: true,
    requireLinkedinCompanyData: true,
    requireRealDecisionMaker: true,
    requireDecisionMakerProfile: true,
    requireNonGenericEmail: true,
    requireDecisionMakerContactOrNamedEmail: true,
    matchConfidenceRequired: 95,
  };
}

function localLeadFromCandidate(candidate: ReceitaCompany): EnrichedLead {
  let score = 35;
  const evidence = ['LinkedIn desativado: avaliacao limitada aos dados locais da Receita e coerencia dos contatos.'];
  if (candidate.website) {
    score += 8;
    evidence.push('Site empresarial presente na fonte local.');
  }
  if (candidate.city || candidate.uf) score += 5;
  if (candidate.phone) {
    score += 4;
    evidence.push('Telefone empresarial presente na fonte local; ainda sujeito a validacao tecnica.');
  }
  if (candidate.email) {
    score += 4;
    evidence.push('E-mail empresarial presente na fonte local; ainda sujeito a validacao tecnica.');
  }
  return {
    id: stableEntityId('local', candidate.cnpj),
    cnpj: normalizeCnpj(candidate.cnpj),
    inputName: candidate.tradingName ?? candidate.legalName,
    companyName: candidate.tradingName ?? candidate.legalName,
    tradingName: candidate.tradingName,
    linkedinUrl: '',
    linkedinProvider: 'linkedin_disabled',
    linkedinConfidence: 0,
    linkedinReason: 'Cruzamento com LinkedIn desativado por LINKEDIN_ENABLED=false.',
    website: candidate.website,
    city: candidate.city,
    state: candidate.uf,
    companyPhone: candidate.phone,
    companyEmail: candidate.email,
    companyExtractionSuccess: false,
    companyExtractionMethod: 'linkedin_disabled',
    decisionMakers: [],
    quality: 'baixa',
    score,
    evidence,
    warnings: ['Sem LinkedIn, nao e possivel confirmar cargo atual, perfil profissional ou vinculo do decisor.'],
  };
}

function qualityRank(value: NonNullable<LeadSearch['minQuality']>): number {
  if (value === 'muito_alto') return 4;
  if (value === 'alto') return 3;
  if (value === 'medio') return 2;
  return 1;
}

function qualityLabel(value: NonNullable<LeadSearch['minQuality']>): string {
  if (value === 'muito_alto') return 'muito alta';
  if (value === 'alto') return 'alta';
  if (value === 'medio') return 'media';
  return 'baixa';
}

function matchConfidenceThreshold(value: MatchConfidenceLevel | undefined): number {
  if (value === 'muito_alta') return 95;
  if (value === 'alta') return 85;
  return 70;
}

function hasDemoEvidence(lead: EnrichedLead, decisionMaker: DecisionMaker | undefined): boolean {
  if (env.workerMode === 'demo') return true;
  return isDemoValue(lead.linkedinProvider)
    || isDemoValue(lead.linkedinReason)
    || isDemoValue(lead.companyExtractionMethod)
    || isDemoValue(lead.linkedinUrl)
    || lead.decisionMakers.some(isDemoDecisionMaker)
    || Boolean(decisionMaker && isDemoDecisionMaker(decisionMaker));
}

function isDemoDecisionMaker(person: DecisionMaker | undefined): boolean {
  return Boolean(person && (isDemoValue(person.source) || isDemoValue(person.linkedin_url)));
}

function isDemoValue(value: string | undefined): boolean {
  return /\bdemo\b/i.test(String(value ?? ''));
}

function hasExtractedCompanyData(lead: EnrichedLead): boolean {
  if (!lead.companyExtractionSuccess) return false;
  if (!lead.companyExtractionMethod || lead.companyExtractionMethod === 'skipped_by_quality') return false;
  if (['worker_error', 'unavailable', 'real_exception'].includes(lead.companyExtractionMethod)) return false;
  return Boolean(lead.industry || lead.companySize || lead.employeesMin || lead.employeesMax || lead.headquarters || lead.followers || lead.description);
}

function linkedinEvidenceLevelOf(
  lead: EnrichedLead,
  isDemoEvidence: boolean,
  hasAnyCompanyData: boolean,
  hasRealCompanyData: boolean,
): LinkedinEvidenceLevel {
  if (!lead.linkedinUrl) return 'none';
  if (isDemoEvidence) return 'demo';
  if (hasRealCompanyData) return 'real_company_data';
  if (hasAnyCompanyData) return 'company_data';
  return 'url_only';
}

function contactEvidenceLevelOf(
  email: ContactChoice | undefined,
  phone: ContactChoice | undefined,
  emailNameMatched: boolean,
  isDemoEvidence: boolean,
): ContactEvidenceLevel {
  if (!email && !phone) return 'none';
  if (isDemoEvidence) return 'demo';
  if (emailNameMatched && email?.source === 'decision_maker') return 'named_decision_maker_contact';
  if (email?.source === 'decision_maker' || phone?.source === 'decision_maker') return 'decision_maker_contact';
  return 'company_contact';
}

function emailContainsPersonName(email: string, names: Array<string | undefined>, source: ContactChoice['source']): boolean {
  if (!isValidEmail(email)) return false;
  const local = normalizeKey(email.split('@')[0] ?? '').replace(/\s+/g, '');
  if (!local) return false;
  for (const name of names) {
    const tokens = significantNameTokens(name);
    if (tokens.length >= 2 && local.includes(tokens[0]) && local.includes(tokens[tokens.length - 1])) return true;
    if (source === 'decision_maker' && tokens.some((token) => token.length >= 5 && local.includes(token))) return true;
  }
  return false;
}

function significantNameTokens(value: string | undefined): string[] {
  const ignored = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'filho', 'junior', 'neto']);
  return normalizeKey(String(value ?? '')).split(' ').filter((token) => token.length > 1 && !ignored.has(token));
}

function emailTypeOf(search: LeadSearch): LeadSearch['emailType'] {
  if (search.emailType && !(search.emailType === 'any' && search.onlyCorporateEmail)) return search.emailType;
  return search.onlyCorporateEmail ? 'corporate' : 'any';
}

function matchesEmailType(value: string, emailType: LeadSearch['emailType']): boolean {
  if (emailType === 'corporate') return isCorporateEmail(value);
  if (emailType === 'non_corporate') return !isCorporateEmail(value);
  return true;
}

function rejectedWithoutMatch(search: LeadSearch, candidate: ReceitaCompany, reason: string): LeadProcessingOutcome {
  const timestamp = new Date().toISOString();
  return {
    result: {
      id: stableEntityId('result', `${search.id}:${candidate.cnpj}`),
      leadSearchId: search.id,
      cnpj: normalizeCnpj(candidate.cnpj),
      finalScore: 0,
      status: 'rejected',
      selected: false,
      candidate,
      rejectionReasons: [reason],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function emailPriority(contact: ContactChoice): number {
  return (contact.source === 'decision_maker' ? 20 : 0)
    + (isCorporateEmail(contact.value) ? 10 : 0)
    + (!isGenericEmail(contact.value) ? 5 : 0);
}

function phonePriority(contact: ContactChoice): number {
  return (contact.source === 'decision_maker' ? 20 : 0) + (isMobilePhone(contact.value) ? 10 : 0);
}

export function stableEntityId(prefix: string, seed: string): string {
  return `${prefix}_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
}
