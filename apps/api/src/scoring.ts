import { DecisionMaker, EnrichedLead, QualityFilter } from './types.js';

const qualityRank: Record<QualityFilter, number> = {
  baixa: 1,
  normal: 2,
  alta: 3,
  muito_alta: 4,
};

export function classifyLead(input: Omit<EnrichedLead, 'quality' | 'score'>): Pick<EnrichedLead, 'quality' | 'score'> {
  let score = 35;
  const evidence: string[] = [];
  if (input.linkedinUrl) {
    score += 20;
    evidence.push('Company Page encontrada');
  }
  if (input.website) {
    score += 8;
    evidence.push('Site identificado');
  }
  if (input.companySize || input.employeesMin || input.employeesMax) {
    score += 8;
    evidence.push('Tamanho da empresa identificado');
  }
  if (input.industry) {
    score += 6;
    evidence.push('Segmento identificado');
  }
  if (input.headquarters || input.city || input.state) {
    score += 5;
    evidence.push('Localização identificada');
  }
  if (input.decisionMakers.length > 0) {
    score += 18;
    evidence.push('Decisor provável encontrado');
  }
  const best = input.bestDecisionMaker;
  if (best?.phones?.length) {
    score += 12;
    evidence.push('Telefone de abordagem encontrado');
  }
  if (best?.emails?.length) {
    score += 8;
    evidence.push('E-mail de abordagem encontrado');
  }
  if (input.companyPhone) {
    score += 4;
    evidence.push('Telefone corporativo disponível');
  }
  if (input.companyEmail) {
    score += 4;
    evidence.push('E-mail corporativo disponível');
  }

  input.evidence.push(...evidence.map((item) => `Score: ${item}.`));

  const hasCompanyData = Boolean(input.website || input.industry || input.companySize || input.headquarters || input.employeesMin || input.employeesMax);
  const hasDecisionMaker = input.decisionMakers.length > 0;
  const hasDecisionContact = Boolean(best?.phones?.length || best?.emails?.length);

  let quality: QualityFilter = 'baixa';
  if (input.linkedinUrl && hasCompanyData) quality = 'normal';
  if (input.linkedinUrl && hasDecisionMaker) quality = 'alta';
  // Muito alta deve significar contato do decisor, não apenas telefone/e-mail genérico da empresa.
  if (input.linkedinUrl && hasDecisionMaker && hasDecisionContact) quality = 'muito_alta';

  return { quality, score: Math.min(100, score) };
}

export function passesQualityFilter(leadQuality: QualityFilter, requested: QualityFilter): boolean {
  return qualityRank[leadQuality] >= qualityRank[requested];
}

export function chooseBestDecisionMaker(decisionMakers: DecisionMaker[]): DecisionMaker | undefined {
  return [...decisionMakers].sort((a, b) => {
    const contactA = (a.phones?.length ? 20 : 0) + (a.emails?.length ? 10 : 0);
    const contactB = (b.phones?.length ? 20 : 0) + (b.emails?.length ? 10 : 0);
    return b.confidence + contactB - (a.confidence + contactA);
  })[0];
}
