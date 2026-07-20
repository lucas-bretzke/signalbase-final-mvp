import { z } from 'zod';
import { onlyDigits, uniq } from './utils.js';

const quality = z.enum(['baixa', 'normal', 'alta', 'muito_alta']);
const minQuality = z.enum(['baixo', 'medio', 'alto', 'muito_alto']);
const emailType = z.enum(['any', 'corporate', 'non_corporate']);
const targetMode = z.enum(['fixed', 'max']);
const matchConfidenceLevel = z.enum(['normal', 'alta', 'muito_alta']);
const targetQuantity = z.union([
  z.number().int().min(1).max(10_000),
  z.string().trim().toLowerCase().refine((value) => value === 'max', {
    message: 'Quantidade deve ser um numero ou max.',
  }),
]);
const BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

export const batchRequestSchema = z.object({
  rows: z.array(
    z.object({
      cnpj: z.string().min(1),
      razaoSocial: z.string().optional().default(''),
      nomeFantasia: z.string().optional().default(''),
      site: z.string().optional().default(''),
      email: z.string().optional().default(''),
      telefone: z.string().optional().default(''),
      socios: z.string().optional().default(''),
      linkedinUrl: z.string().optional().default(''),
      cidade: z.string().optional().default(''),
      uf: z.string().optional().default(''),
      cnae: z.string().optional().default(''),
    }),
  ).min(1),
  quality: quality.default('alta'),
  maxDecisionMakers: z.number().int().min(1).max(30).optional().default(8),
  keywords: z.array(z.string().min(2)).optional(),
});

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === 'string' && !value.trim() ? undefined : value,
  z.string().trim().min(1).max(max).optional(),
);

const cnae = z.string().transform(onlyDigits).refine((value) => value.length === 7, {
  message: 'CNAE deve conter 7 digitos.',
});

export const leadSearchCreateSchema = z.object({
  uf: z.string().trim().length(2).transform((value) => value.toUpperCase()).refine((value) => BRAZILIAN_UFS.has(value), {
    message: 'UF invalida.',
  }),
  city: optionalText(120),
  cnaes: z.array(cnae).min(1).max(50).transform((values) => uniq(values)),
  targetQuantity,
  targetMode: targetMode.optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  minQuality: minQuality.optional(),
  requirePhone: z.boolean().optional().default(false),
  requireEmail: z.boolean().optional().default(false),
  requireDecisionMakerMatch: z.boolean().optional().default(false),
  onlyMobilePhone: z.boolean().optional(),
  requireMobilePhone: z.boolean().optional(),
  emailType: emailType.optional(),
  onlyCorporateEmail: z.boolean().optional(),
  requireCorporateEmail: z.boolean().optional(),
  excludeGenericContacts: z.boolean().optional().default(false),
  requireRealLinkedin: z.boolean().optional().default(false),
  requireLinkedinCompanyData: z.boolean().optional().default(false),
  requireRealDecisionMaker: z.boolean().optional().default(false),
  requireDecisionMakerProfile: z.boolean().optional().default(false),
  requireDecisionMakerContact: z.boolean().optional().default(false),
  requireNamedEmail: z.boolean().optional().default(false),
  requireDecisionMakerPhone: z.boolean().optional().default(false),
  matchConfidenceLevel: matchConfidenceLevel.optional().default('normal'),
}).transform((value) => {
  const onlyMobilePhone = value.onlyMobilePhone ?? value.requireMobilePhone ?? false;
  const selectedEmailType = value.emailType ?? ((value.onlyCorporateEmail ?? value.requireCorporateEmail ?? false) ? 'corporate' : 'any');
  const onlyCorporateEmail = selectedEmailType === 'corporate';
  const selectedTargetMode = value.targetMode ?? (value.targetQuantity === 'max' ? 'max' : 'fixed');
  const selectedMinQuality = value.minQuality ?? minQualityFromScore(value.minScore ?? 0);
  return {
    uf: value.uf,
    city: value.city,
    cnaes: value.cnaes,
    targetQuantity: selectedTargetMode === 'max' ? 0 : Number(value.targetQuantity),
    targetMode: selectedTargetMode,
    minScore: value.minQuality ? scoreFromMinQuality(selectedMinQuality) : value.minScore ?? scoreFromMinQuality(selectedMinQuality),
    minQuality: selectedMinQuality,
    requirePhone: value.requirePhone || onlyMobilePhone,
    requireEmail: value.requireEmail || selectedEmailType !== 'any',
    requireDecisionMakerMatch: value.requireDecisionMakerMatch,
    onlyMobilePhone,
    emailType: selectedEmailType,
    onlyCorporateEmail,
    excludeGenericContacts: value.excludeGenericContacts,
    requireRealLinkedin: value.requireRealLinkedin,
    requireLinkedinCompanyData: value.requireLinkedinCompanyData,
    requireRealDecisionMaker: value.requireRealDecisionMaker,
    requireDecisionMakerProfile: value.requireDecisionMakerProfile,
    requireDecisionMakerContact: value.requireDecisionMakerContact,
    requireNamedEmail: value.requireNamedEmail,
    requireDecisionMakerPhone: value.requireDecisionMakerPhone,
    matchConfidenceLevel: value.matchConfidenceLevel,
  };
});

export const resultSelectionSchema = z.object({ selected: z.boolean() });

function minQualityFromScore(score: number): z.infer<typeof minQuality> {
  if (score >= 85) return 'muito_alto';
  if (score >= 70) return 'alto';
  if (score >= 50) return 'medio';
  return 'baixo';
}

function scoreFromMinQuality(value: z.infer<typeof minQuality>): number {
  if (value === 'muito_alto') return 85;
  if (value === 'alto') return 70;
  if (value === 'medio') return 50;
  return 0;
}
