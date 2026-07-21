import { stringify } from 'csv-stringify/sync';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { testLinkedinSession } from '../workerClient.js';
import { resultSelectionSchema, leadSearchCreateSchema } from '../validation.js';
import { LeadSearchService } from './service.js';
import { LeadSearchResultStatus, LeadSearchStatus } from './types.js';

const SEARCH_STATUSES = new Set<LeadSearchStatus>(['queued', 'processing', 'paused', 'blocked', 'completed', 'exhausted', 'failed']);
const RESULT_STATUSES = new Set<LeadSearchResultStatus>(['valid', 'rejected', 'error']);

export function registerLeadSearchRoutes(app: FastifyInstance, service: LeadSearchService): void {
  for (const prefix of ['/api', '']) registerPrefix(app, service, prefix);
}

function registerPrefix(app: FastifyInstance, service: LeadSearchService, prefix: string): void {
  app.post(`${prefix}/lead-searches`, async (request, reply) => {
    const parsed = leadSearchCreateSchema.safeParse(request.body);
    if (!parsed.success) return invalidPayload(reply, parsed.error.flatten());
    if (!env.linkedinEnabled && parsed.data.minQuality === 'muito_alto') {
      return reply.status(400).send({
        ok: false,
        error: 'Qualidade muito alta exige o cruzamento com LinkedIn. Ative LINKEDIN_ENABLED=true.',
      });
    }
    try {
      const search = await service.create(parsed.data);
      return reply.status(202).send({ search });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ ok: false, error: 'Nao foi possivel criar a busca.', details: errorMessage(error) });
    }
  });

  app.get(`${prefix}/lead-searches`, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const pagination = paginationFrom(query);
    if (!pagination) return invalidQuery(reply);
    const status = stringValue(query.status) as LeadSearchStatus | undefined;
    if (status && !SEARCH_STATUSES.has(status)) return invalidQuery(reply, 'Status de busca invalido.');
    return service.list({ ...pagination, status });
  });

  app.get(`${prefix}/lead-searches/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const search = await service.get(id);
    if (!search) return notFound(reply, 'Busca nao encontrada.');
    return { search };
  });

  app.post(`${prefix}/lead-searches/:id/resume`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await service.get(id);
    if (!current) return notFound(reply, 'Busca nao encontrada.');
    if (current.status === 'blocked') {
      const diagnostic = await testLinkedinSession();
      if (diagnostic.ready !== true) {
        return reply.status(503).send({ ok: false, error: 'LinkedIn ainda nao esta pronto para retomar a busca.', diagnostic });
      }
    }
    const search = await service.resume(id);
    if (!search) return notFound(reply, 'Busca nao encontrada.');
    return reply.status(202).send({ search });
  });

  app.post(`${prefix}/lead-searches/:id/pause`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const search = await service.pause(id);
    if (!search) return notFound(reply, 'Busca nao encontrada.');
    return reply.status(202).send({ search });
  });

  app.post(`${prefix}/lead-searches/:id/reprocess`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const search = await service.reprocess(id);
    if (!search) return notFound(reply, 'Busca nao encontrada.');
    return reply.status(202).send({ search });
  });

  app.delete(`${prefix}/lead-searches/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await service.delete(id);
    if (!deleted) return notFound(reply, 'Busca nao encontrada.');
    return reply.status(204).send();
  });

  app.get(`${prefix}/lead-searches/:id/results`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const pagination = paginationFrom(query);
    if (!pagination) return invalidQuery(reply);
    const status = stringValue(query.status) as LeadSearchResultStatus | undefined;
    if (status && !RESULT_STATUSES.has(status)) return invalidQuery(reply, 'Status de resultado invalido.');
    const selected = optionalBoolean(query.selected);
    if (selected === null) return invalidQuery(reply, 'selected deve ser true ou false.');
    const results = await service.results({ searchId: id, ...pagination, status, selected });
    if (!results) return notFound(reply, 'Busca nao encontrada.');
    return results;
  });

  app.get(`${prefix}/lead-searches/:id/results/:resultId`, async (request, reply) => {
    const { id, resultId } = request.params as { id: string; resultId: string };
    const result = await service.result(id, resultId);
    if (!result) return notFound(reply, 'Resultado nao encontrado.');
    return { result };
  });

  app.patch(`${prefix}/lead-searches/:id/results/:resultId`, async (request, reply) => {
    const { id, resultId } = request.params as { id: string; resultId: string };
    const parsed = resultSelectionSchema.safeParse(request.body);
    if (!parsed.success) return invalidPayload(reply, parsed.error.flatten());
    const result = await service.select(id, resultId, parsed.data.selected);
    if (!result) return notFound(reply, 'Resultado nao encontrado.');
    return { result };
  });

  app.get(`${prefix}/lead-searches/:id/export.csv`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const selectedOnly = optionalBoolean(query.selectedOnly);
    if (selectedOnly === null) return invalidQuery(reply, 'selectedOnly deve ser true ou false.');
    const results = await service.exportResults(id, selectedOnly ?? true);
    if (!results) return notFound(reply, 'Busca nao encontrada.');
    const rows = results.map((result) => {
      const lead = result.lead;
      return {
        cnpj: safeCsv(result.cnpj),
        razao_social: safeCsv(result.candidate.legalName),
        nome_fantasia: safeCsv(result.candidate.tradingName),
        cidade: safeCsv(result.city),
        uf: safeCsv(result.uf),
        cnae: safeCsv(result.cnae),
        socio_receita: safeCsv(lead?.decisionMakerMatch.partnerName ?? result.candidate.partners.join('; ')),
        linkedin_empresa: safeCsv(lead?.companyLinkedinUrl),
        decisor: safeCsv(lead?.decisionMaker?.name),
        cargo_decisor: safeCsv(lead?.decisionMaker?.title),
        linkedin_decisor: safeCsv(lead?.decisionMaker?.linkedin_url),
        match_socio_decisor: lead?.decisionMakerMatched ? 'sim' : 'nao',
        confianca_match: lead?.decisionMakerMatch.confidence ?? 0,
        email_final: safeCsv(lead?.finalEmail),
        telefone_final: safeCsv(lead?.finalPhone),
        email_validado: lead?.emailValidated ? 'sim' : 'nao',
        telefone_validado: lead?.phoneValidated ? 'sim' : 'nao',
        evidencia_linkedin: lead?.linkedinEvidenceLevel ?? '',
        evidencia_contato: lead?.contactEvidenceLevel ?? '',
        evidencia_demo: lead?.isDemoEvidence ? 'sim' : 'nao',
        email_com_nome: lead?.emailNameMatched ? 'sim' : 'nao',
        score_final: result.finalScore,
        evidencias: safeCsv(lead?.evidence.join(' | ')),
      };
    });
    const columns = [
      'cnpj', 'razao_social', 'nome_fantasia', 'cidade', 'uf', 'cnae', 'socio_receita',
      'linkedin_empresa', 'decisor', 'cargo_decisor', 'linkedin_decisor', 'match_socio_decisor',
      'confianca_match', 'email_final', 'telefone_final', 'email_validado', 'telefone_validado',
      'evidencia_linkedin', 'evidencia_contato', 'evidencia_demo', 'email_com_nome', 'score_final', 'evidencias',
    ];
    const csv = stringify(rows, { header: true, bom: true, columns });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="signalbase-leads-${id}.csv"`);
    return reply.send(csv);
  });
}

function paginationFrom(query: Record<string, unknown>): { page: number; pageSize: number } | undefined {
  const page = positiveInteger(query.page, 1);
  const pageSize = positiveInteger(query.pageSize, 25);
  if (!page || !pageSize || pageSize > 200) return undefined;
  return { page, pageSize };
}

function positiveInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function invalidPayload(reply: FastifyReply, details: unknown) {
  return reply.status(400).send({ ok: false, error: 'Payload invalido.', details });
}

function invalidQuery(reply: FastifyReply, error = 'Paginacao invalida.') {
  return reply.status(400).send({ ok: false, error });
}

function notFound(reply: FastifyReply, error: string) {
  return reply.status(404).send({ ok: false, error });
}

function safeCsv(value: unknown): string {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
