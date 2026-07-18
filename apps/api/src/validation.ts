import { z } from 'zod';
import { onlyDigits, uniq } from './utils.js';

const quality = z.enum(['baixa', 'normal', 'alta', 'muito_alta']);
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
  targetQuantity: z.number().int().min(1).max(10_000),
  minScore: z.number().int().min(0).max(100).optional().default(0),
  requirePhone: z.boolean().optional().default(false),
  requireEmail: z.boolean().optional().default(false),
  requireDecisionMakerMatch: z.boolean().optional().default(false),
  onlyMobilePhone: z.boolean().optional(),
  requireMobilePhone: z.boolean().optional(),
  onlyCorporateEmail: z.boolean().optional(),
  requireCorporateEmail: z.boolean().optional(),
  excludeGenericContacts: z.boolean().optional().default(false),
}).transform((value) => {
  const onlyMobilePhone = value.onlyMobilePhone ?? value.requireMobilePhone ?? false;
  const onlyCorporateEmail = value.onlyCorporateEmail ?? value.requireCorporateEmail ?? false;
  return {
    uf: value.uf,
    city: value.city,
    cnaes: value.cnaes,
    targetQuantity: value.targetQuantity,
    minScore: value.minScore,
    requirePhone: value.requirePhone || onlyMobilePhone,
    requireEmail: value.requireEmail || onlyCorporateEmail,
    requireDecisionMakerMatch: value.requireDecisionMakerMatch,
    onlyMobilePhone,
    onlyCorporateEmail,
    excludeGenericContacts: value.excludeGenericContacts,
  };
});

export const resultSelectionSchema = z.object({ selected: z.boolean() });
