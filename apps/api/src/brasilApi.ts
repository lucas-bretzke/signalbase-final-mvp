import { env } from './env.js';
import { CompanyInput } from './types.js';
import { onlyDigits, nonEmpty } from './utils.js';

interface BrasilApiCnpjResponse {
  razao_social?: string;
  nome_fantasia?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string;
  municipio?: string;
  uf?: string;
  qsa?: Array<{ nome_socio?: string; qualificacao_socio?: string }>;
}

export async function enrichFromBrasilApi(input: CompanyInput): Promise<CompanyInput> {
  if (!env.brasilApiEnabled) return input;
  const cnpj = onlyDigits(input.cnpj);
  if (cnpj.length !== 14) return input;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.brasilApiTimeoutMs);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: controller.signal });
    if (!response.ok) return input;
    const data = (await response.json()) as BrasilApiCnpjResponse;
    const socios = data.qsa?.map((s) => `${s.nome_socio ?? ''} ${s.qualificacao_socio ?? ''}`.trim()).filter(Boolean).join('; ');
    return {
      ...input,
      razaoSocial: nonEmpty(input.razaoSocial, data.razao_social),
      nomeFantasia: nonEmpty(input.nomeFantasia, data.nome_fantasia),
      telefone: nonEmpty(input.telefone, data.ddd_telefone_1, data.ddd_telefone_2),
      email: nonEmpty(input.email, data.email),
      cidade: nonEmpty(input.cidade, data.municipio),
      uf: nonEmpty(input.uf, data.uf),
      socios: nonEmpty(input.socios, socios),
    };
  } catch {
    return input;
  } finally {
    clearTimeout(timeout);
  }
}
