import crypto from 'node:crypto';
import { enrichCompany } from '../enrich.js';
import { DecisionMaker, EnrichedLead } from '../types.js';
import { normalizeCnpj } from '../utils.js';
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
  DecisionMakerMatch,
  LeadCrossMatch,
  LeadProcessingOutcome,
  LeadProcessor,
  LeadSearch,
  LeadSearchResult,
  ReceitaCompany,
} from './types.js';

interface ContactChoice {
  value: string;
  source: 'decision_maker' | 'receita';
}

export class EnrichmentLeadProcessor implements LeadProcessor {
  async process(search: LeadSearch, candidate: ReceitaCompany): Promise<LeadProcessingOutcome> {
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
  const finalScore = Math.min(100, lead.score + (matched.match.matched ? 5 : 0));
  const rejectionReasons = validationFailures(search, finalScore, email, phone, matched.match);
  const status = rejectionReasons.length ? 'rejected' : 'valid';
  const crossMatchId = stableEntityId('cross', `${search.id}:${candidate.cnpj}`);
  const evidence = [
    `Receita Federal local: ${candidate.cnpj}, CNAE ${candidate.cnae}, ${candidate.city}/${candidate.uf}.`,
    ...lead.evidence,
    matched.match.explanation,
    ...(email ? [`E-mail final validado (${email.source}): ${email.value}.`] : ['Nenhum e-mail valido selecionado.']),
    ...(phone ? [`Telefone final validado (${phone.source}${isMobilePhone(phone.value) ? ', celular' : ''}): ${phone.value}.`] : ['Nenhum telefone valido selecionado.']),
    `Score final ${finalScore}/100; corte solicitado ${search.minScore}/100.`,
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
  if (!partners.length) {
    return { match: { matched: false, confidence: 0, explanation: 'Receita Federal local nao informou socios para comparacao.' } };
  }
  if (!decisionMakers.length) {
    return { match: { matched: false, confidence: 0, explanation: 'Nenhum decisor do LinkedIn disponivel para comparar com os socios.' } };
  }

  let best: { confidence: number; partner: string; person: DecisionMaker } | undefined;
  for (const person of decisionMakers) {
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

function validationFailures(
  search: LeadSearch,
  finalScore: number,
  email: ContactChoice | undefined,
  phone: ContactChoice | undefined,
  match: DecisionMakerMatch,
): string[] {
  const failures: string[] = [];
  if (finalScore < search.minScore) failures.push(`Score ${finalScore} abaixo do minimo ${search.minScore}.`);
  if (search.requirePhone && !phone) failures.push('Telefone valido obrigatorio nao encontrado.');
  if (search.onlyMobilePhone && (!phone || !isMobilePhone(phone.value))) failures.push('Celular valido obrigatorio nao encontrado.');
  if (search.requireEmail && !email) failures.push('E-mail valido obrigatorio nao encontrado.');
  if (search.onlyCorporateEmail && (!email || !isCorporateEmail(email.value))) failures.push('E-mail corporativo valido obrigatorio nao encontrado.');
  if (emailTypeOf(search) === 'non_corporate' && (!email || isCorporateEmail(email.value))) failures.push('E-mail nao corporativo valido obrigatorio nao encontrado.');
  if (search.excludeGenericContacts && email && isGenericEmail(email.value)) failures.push('O e-mail final e generico.');
  if (search.requireDecisionMakerMatch && !match.matched) failures.push('Correspondencia entre socio e decisor obrigatoria nao encontrada.');
  return failures;
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
