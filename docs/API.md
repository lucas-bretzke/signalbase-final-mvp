# API do SignalBase Final MVP

## Convenções

- Base local de desenvolvimento: `http://localhost:7001`.
- O prefixo canônico da aplicação web é `/api`.
- JSON usa `content-type: application/json` e datas ISO 8601 em UTC.
- CNAE e CNPJ podem chegar formatados, mas são persistidos/consultados na forma canônica.
- Listagens usam `page` a partir de 1 e `pageSize`.
- A criação é assíncrona: receber a busca não significa que a meta já foi atingida.

O endpoint principal solicitado no escopo como `POST /lead-searches` e o endpoint canônico **`POST /api/lead-searches`** são registrados pela API e executam o mesmo handler. Isso vale também para as subrotas de busca. O frontend usa sempre o prefixo `/api`.

## Rotas

| Método | Endpoint canônico | Finalidade |
| --- | --- | --- |
| `GET` | `/api/health` | Saúde da API, provedor e worker. |
| `GET` | `/api/capabilities` | Readiness passiva e filtros que podem ser aceitos. |
| `POST` | `/api/linkedin/test` | Teste ativo e explícito da sessão autorizada. |
| `POST` | `/api/lead-searches` | Criar uma busca e iniciar o job. |
| `GET` | `/api/lead-searches` | Listar buscas. |
| `GET` | `/api/lead-searches/:id` | Obter configuração e progresso. |
| `POST` | `/api/lead-searches/:id/pause` | Pausar e cancelar a candidata em voo. |
| `POST` | `/api/lead-searches/:id/resume` | Testar readiness quando necessário e retomar. |
| `POST` | `/api/lead-searches/:id/reprocess` | Criar uma nova busca vinculada à anterior. |
| `DELETE` | `/api/lead-searches/:id` | Excluir a busca e seus resultados. |
| `GET` | `/api/lead-searches/:id/results` | Listar resultados parciais/finais. |
| `GET` | `/api/lead-searches/:id/results/:resultId` | Abrir um resultado com cross-match. |
| `PATCH` | `/api/lead-searches/:id/results/:resultId` | Marcar/desmarcar para exportação. |
| `GET` | `/api/lead-searches/:id/export.csv` | Exportar leads finais da busca. |
| `POST` | `/api/enrich` | Modo CNPJ avançado/legado. |

## Saúde

### `GET /api/health`

Retorna o estado da API, do worker e metadados operacionais seguros da fonte da Receita, como tipo, modo somente leitura, competência declarada e presença do índice de busca otimizado. A resposta não inclui caminhos do sistema de arquivos, `DATABASE_URL`, URLs de conexão ou credenciais. Isso permite trocar SQLite por PostgreSQL futuramente sem publicar detalhes sensíveis da infraestrutura.

## Criar busca

### `POST /api/lead-searches`

```json
{
  "uf": "SC",
  "city": "Florianópolis",
  "cnaes": ["7311400", "7319002", "7319003"],
  "targetQuantity": 100,
  "minScore": 75,
  "requirePhone": true,
  "requireEmail": false,
  "requireDecisionMakerMatch": true,
  "onlyMobilePhone": false,
  "onlyCorporateEmail": true,
  "excludeGenericContacts": true
}
```

| Campo | Tipo | Regra |
| --- | --- | --- |
| `uf` | string | obrigatório; sigla brasileira com duas letras. |
| `city` | string | opcional; vazio/ausente consulta o estado inteiro. |
| `cnaes` | string[] | obrigatório; um ou mais CNAEs de sete dígitos. |
| `targetQuantity` | integer ou `"max"` | obrigatório; 1–10.000 leads finais válidos, ou todas as candidatas com `"max"`. |
| `targetMode` | `fixed` ou `max` | opcional; inferido de `targetQuantity` quando ausente. |
| `minScore` | integer | opcional; 0–100, padrão 0. |
| `minQuality` | `baixo`, `medio`, `alto` ou `muito_alto` | opcional; substitui o corte legado de score. |
| `requirePhone` | boolean | só aceita lead com telefone tecnicamente válido. |
| `requireEmail` | boolean | só aceita lead com e-mail tecnicamente válido. |
| `requireDecisionMakerMatch` | boolean | exige cross-match sócio–decisor acima do corte. |
| `onlyMobilePhone` | boolean | quando ativo, contato final precisa ser celular brasileiro. |
| `onlyCorporateEmail` | boolean | rejeita provedores gratuitos no contato final. |
| `emailType` | `any`, `corporate` ou `non_corporate` | tipo de e-mail aceito; filtros específicos também tornam e-mail obrigatório. |
| `excludeGenericContacts` | boolean | exclui caixas como `contato@`, `vendas@` e `info@`. |

Os três últimos filtros são extensões opcionais do payload mínimo e permitem cumprir os filtros adicionais da busca. Envie booleanos, não strings.

Resposta `202 Accepted` ilustrativa:

```json
{
  "search": {
    "id": "search_01J...",
    "uf": "SC",
    "city": "Florianópolis",
    "cnaes": ["7311400", "7319002", "7319003"],
    "targetQuantity": 100,
    "minScore": 75,
    "requirePhone": true,
    "requireEmail": false,
    "requireDecisionMakerMatch": true,
    "onlyMobilePhone": false,
    "onlyCorporateEmail": true,
    "excludeGenericContacts": true,
    "status": "queued",
    "totalCandidatesFound": 0,
    "candidateCountStatus": "lower_bound",
    "totalProcessed": 0,
    "totalValidLeads": 0,
    "remainingQuantity": 100,
    "candidatesRemaining": 0,
    "yieldRate": 0,
    "progressPercent": 0,
    "candidateProgressPercent": 0,
    "createdAt": "2026-07-17T13:00:00.000Z",
    "updatedAt": "2026-07-17T13:00:00.000Z"
  }
}
```

`totalCandidatesFound` pode ser menor, igual ou maior que a meta. O job ainda precisa enriquecer cada empresa para saber quantos contatos serão válidos. Em uma fonte com contagem rápida, `candidateCountStatus` é `exact` desde a criação. No SQLite real ainda sem o índice composto recomendado, a API usa `lower_bound`: responde sem bloquear em um `COUNT(*)` nacional e aumenta `totalCandidatesFound` conforme descobre lotes. Ao esgotar o recorte, o valor passa a `exact`.

## Listar buscas

### `GET /api/lead-searches?page=1&pageSize=20&status=processing`

Parâmetros:

- `page`: página, padrão 1;
- `pageSize`: itens por página, máximo 200;
- `status`: filtro opcional (`queued`, `processing`, `paused`, `blocked`, `completed`, `exhausted`, `failed`).

```json
{
  "items": [{ "id": "search_01J...", "status": "processing", "totalValidLeads": 37 }],
  "total": 8,
  "page": 1,
  "pageSize": 20
}
```

## Progresso da busca

### `GET /api/lead-searches/:id`

Retorna `{ "search": { ... } }`, com todos os campos da busca e as métricas derivadas:

- `remainingQuantity`: contatos que ainda faltam;
- `candidatesRemaining`: candidatas ainda não processadas;
- `yieldRate`: válidos/processados em porcentagem;
- `progressPercent`: válidos/meta em porcentagem, máximo 100;
- `candidateProgressPercent`: processados/candidatas em porcentagem.
- `candidateCountStatus`: `exact` ou `lower_bound`; neste último caso, o total representa apenas as candidatas já descobertas.

Exemplo durante a execução:

```json
{
  "search": {
    "id": "search_01J...",
    "status": "processing",
    "totalCandidatesFound": 642,
    "totalProcessed": 185,
    "totalValidLeads": 37,
    "targetQuantity": 100,
    "remainingQuantity": 63,
    "candidatesRemaining": 457,
    "yieldRate": 20,
    "progressPercent": 37,
    "candidateProgressPercent": 28.82,
    "startedAt": "2026-07-17T13:00:01.000Z",
    "updatedAt": "2026-07-17T13:05:45.000Z"
  }
}
```

O frontend pode fazer polling desse endpoint enquanto o estado for `queued` ou `processing`. Use intervalo moderado e encerre o polling em um estado terminal.

## Resultados

### `GET /api/lead-searches/:id/results`

Query string:

- `page` e `pageSize`;
- `status=valid|rejected|error`;
- `selected=true|false`.

```json
{
  "items": [
    {
      "id": "result_a1b2",
      "leadSearchId": "search_01J...",
      "cnpj": "11.222.333/0001-81",
      "leadCrossMatchId": "cross_c3d4",
      "finalScore": 92,
      "status": "valid",
      "selected": true,
      "candidate": {
        "legalName": "Tech Azul Solutions LTDA",
        "tradingName": "Tech Azul",
        "city": "Florianópolis",
        "uf": "SC",
        "cnae": "7311400"
      },
      "rejectionReasons": [],
      "lead": {
        "companyName": "Tech Azul Solutions",
        "partners": ["Marina Costa"],
        "companyLinkedinUrl": "https://www.linkedin.com/company/tech-azul-solutions",
        "decisionMaker": { "name": "Marina Costa", "title": "Founder & CEO" },
        "decisionMakerMatched": true,
        "finalEmail": "marina.costa@techazul.example",
        "finalPhone": "+55 48 99999-1000",
        "finalScore": 92,
        "evidence": ["Sócio e decisor correspondem com 100% de confiança."]
      }
    }
  ],
  "total": 185,
  "page": 1,
  "pageSize": 20
}
```

Resultados rejeitados também são persistidos, com `rejectionReasons`. Eles contam em `totalProcessed`, mas não em `totalValidLeads` e não entram na exportação final.

### `GET /api/lead-searches/:id/results/:resultId`

Retorna `{ "result": { ... } }` com o resultado e seu `LeadCrossMatch` completo, incluindo contatos escolhidos, fontes, comparação com sócio, flags de validação, evidências e avisos. Use essa rota na tela **Detalhes do Lead**.

## Seleção manual

### `PATCH /api/lead-searches/:id/results/:resultId`

```json
{ "selected": false }
```

Seleção é uma curadoria para exportação; não recalcula score nem altera o estado `valid`/`rejected`. A API rejeita IDs de resultado que não pertencem à busca informada.

## Exportação

### `GET /api/lead-searches/:id/export.csv?selectedOnly=true`

Retorna `text/csv; charset=utf-8` com `content-disposition` para download.

- `selectedOnly=true`: somente resultados `valid` marcados;
- `selectedOnly=false`: todos os resultados `valid` da busca;
- rejeitados e erros nunca devem entrar como leads finais.

O CSV inclui CNPJ/empresa, cidade, UF, CNAE, sócio, Company Page, decisor, match, e-mail/telefone finais, score e evidências disponíveis. A exportação é derivada dos `LeadSearchResult`; ela não é uma exportação bruta dos CNPJs candidatos.

## Estados

### Busca

| Valor | Terminal | Uso |
| --- | --- | --- |
| `queued` | não | aguardando o job. |
| `processing` | não | processando páginas/lotes. |
| `paused` | sim até retomada | pausada pelo operador; a candidata em voo não é consumida. |
| `blocked` | sim até retomada | infraestrutura, autenticação, challenge, deadline ou fila impediram continuar com segurança. |
| `completed` | sim | terminou; consulte `completionReason` (`target_reached` ou `candidate_pool_exhausted`). |
| `exhausted` | sim | valor legado aceito para compatibilidade; novos jobs usam `completed` + `candidate_pool_exhausted`. |
| `failed` | sim | falha impediu o job; consulte `lastError`. |

### Resultado

| Valor | Conta como processado | Conta como válido |
| --- | --- | --- |
| `valid` | sim | sim |
| `rejected` | sim | não |
| `error` | sim | não |

## Erros

Formato típico:

```json
{
  "ok": false,
  "error": "Payload inválido",
  "details": { "fieldErrors": { "cnaes": ["Informe pelo menos um CNAE"] } }
}
```

| HTTP | Significado |
| --- | --- |
| `400` | payload ou query string inválida. |
| `401` / `409` | token do worker ausente/inválido, login do LinkedIn ou verificação manual necessários. |
| `404` | busca/resultado não encontrado ou associação incorreta. |
| `429` / `503` | backpressure, fila cheia/expirada ou worker indisponível. |
| `499` / `504` | operação cancelada ou deadline excedido. |
| `502` | falha transitória de rede ou navegação. |
| `500` | falha interna/persistência. |

`POST /api/enrich` preserva os status tipados acima. Endpoints de readiness, criação e retomada
podem normalizar indisponibilidade para `503`, mantendo `errorCode` no corpo. Quando disponível,
`errorCode` preserva uma categoria estável: `auth_required`, `challenge`,
`navigation_error`, `network_error`, `deadline_exceeded`, `request_cancelled`, `queue_timeout`,
`queue_full`, `worker_unauthorized`, `worker_unavailable`, `wrong_worker`, `invalid_request` ou um resultado funcional como
`no_company_candidate`, `company_not_verified`, `no_verified_match` e `rejected_by_filters`. Falhas de infraestrutura
não são convertidas em resultado funcional vazio.

## Modo CNPJ avançado

### `POST /api/enrich`

Compatibilidade para teste, debug ou enriquecimento manual:

```json
{
  "quality": "alta",
  "maxDecisionMakers": 8,
  "rows": [
    {
      "cnpj": "11.222.333/0001-81",
      "razaoSocial": "Tech Azul Solutions LTDA",
      "nomeFantasia": "Tech Azul",
      "site": "https://techazul.example",
      "socios": "Marina Costa - Sócia Administradora"
    }
  ]
}
```

Esse endpoint não cria `LeadSearch`, não consulta o universo por UF/CNAE e não garante uma quantidade de contatos válidos. Não o use como fluxo principal.

## API interna do worker

A API principal envia `x-request-id`, `x-request-deadline` e, quando `WORKER_AUTH_TOKEN` está configurado, `Authorization: Bearer <token>`. O worker `3.2.0` aplica o deadline desde o início da requisição HTTP, inclusive leitura do body, e recusa modo real fora de loopback sem token compartilhado. A prontidão do worker considera a sessão autenticada apenas enquanto `WORKER_SESSION_FRESHNESS_MS` estiver vigente; criação/retomada de buscas LinkedIn dependentes fazem checagem ativa em modo real.

### `POST http://worker:8010/company/extract`

```json
{
  "linkedin_url": "https://www.linkedin.com/company/tech-azul-solutions",
  "cnpj": "11222333000181",
  "company_name": "Tech Azul Solutions LTDA",
  "domain": "techazul.example",
  "city": "Florianópolis",
  "uf": "SC",
  "cnae": "7311400"
}
```

### `POST http://worker:8010/decision-makers/search`

```json
{
  "company_name": "Tech Azul Solutions LTDA",
  "linkedin_url": "https://www.linkedin.com/company/tech-azul-solutions",
  "domain": "techazul.example",
  "cnpj": "11222333000181",
  "partner_names": ["Marina Costa", "Rafael Nogueira"],
  "keywords": ["CEO", "Founder", "Diretor"],
  "max_results": 8
}
```

Além dos campos tradicionais, cada pessoa pode trazer `partner_match`, `matched_partner_name` e `partner_match_confidence`. `partner_names` é opcional para manter clientes anteriores compatíveis.
