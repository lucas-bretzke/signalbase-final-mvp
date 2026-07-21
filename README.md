# SignalBase Final MVP

O SignalBase cria listas de leads B2B a partir de **UF, cidade opcional, um ou mais CNAEs e quantidade desejada**. O usuário não precisa conhecer nem importar CNPJs: o backend seleciona empresas na base local da Receita Federal, pagina os candidatos de forma estável e enriquece quantos forem necessários até obter a quantidade de contatos finais válidos solicitada ou esgotar o universo disponível.

> A quantidade é uma meta de **leads válidos**, não um limite de empresas processadas. Uma busca por 100 leads pode examinar e enriquecer centenas de empresas.

## Fluxo principal

1. Em **Nova Busca**, o usuário informa UF, cidade opcional, CNAEs, quantidade e filtros de qualidade.
2. `POST /api/lead-searches` cria a busca e um job assíncrono.
3. O backend consulta a fonte local da Receita configurada (`sqlite` ou `csv`), filtra e pagina empresas candidatas.
4. Cada candidata selecionada passa por resolução da Company Page, extração da empresa, busca de decisores e comparação entre o sócio da Receita e o decisor do LinkedIn.
5. O sistema escolhe e-mail e telefone finais, calcula score, registra evidências e salva o resultado parcial.
6. O job continua por lotes até `totalValidLeads >= targetQuantity` ou até não haver mais candidatos.
7. Em **Revisão de Leads**, o usuário revisa, seleciona e exporta os leads finais da busca.

O modo antigo de entrada direta por CNPJ continua disponível apenas como recurso avançado de teste, debug e enriquecimento manual. Ele não é a jornada principal do produto.

## Telas

- **Dashboard** — visão geral de buscas e indicadores.
- **Nova Busca** — criação por UF, cidade, CNAEs, quantidade e filtros.
- **Buscas em Andamento** — progresso, aproveitamento e faltantes.
- **Revisão de Leads** — resultados válidos, rejeitados e seleção.
- **Detalhes do Lead** — score, contato escolhido, comparação e evidências.
- **Exportações** — CSV dos leads finais da busca.

## Stack e componentes

- React + Vite em `apps/web`;
- Fastify + TypeScript em `apps/api`;
- persistência operacional JSON, separada da base da Receita, em `LEAD_SEARCH_DB_PATH`;
- fonte da Receita selecionada por `RECEITA_SOURCE=sqlite|csv`;
- leitura SQLite somente leitura em `RECEITA_SQLITE_PATH` ou fallback CSV em `RECEITA_CSV_PATH`;
- worker Node/Puppeteer em `services/linkedin-worker`;
- descoberta de Company Page, extração corporativa e busca de decisores pelo navegador.

```text
Nova Busca
  -> API cria LeadSearch
  -> base Receita seleciona e prioriza candidatas
  -> job processa lotes
  -> LinkedIn + decisores + cross-match com sócios
  -> filtros + score + evidências
  -> LeadSearchResult persistido
  -> progresso e exportação dos leads finais
```

## Início rápido local

Pré-requisitos: Node.js 22+, npm e Chrome/Chromium. Nas versões do Node 22 em que `node:sqlite` ainda é experimental, inicie os processos com `--experimental-sqlite`.

```powershell
Copy-Item .env.example .env
npm run install:all
$env:NODE_OPTIONS='--experimental-sqlite'
npm run dev
```

No modo local, a interface Vite fica em `http://localhost:5173` e a API em `http://localhost:7001`.

Encerre com `Ctrl+C` ou envie `SIGTERM` no ambiente de execução. A API interrompe os jobs em andamento, fecha a fonte SQLite/Worker Thread e só então libera o servidor HTTP.

Para consultar temporariamente a base SQLite real desta máquina, acrescente ou ajuste no `.env`:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_PATH=D:/cnpj_ativo_final.db
LEAD_SEARCH_DB_PATH=./data/lead-search-db.json
```

Use barras `/` no caminho do Windows para evitar dúvidas de escape. A API abre `D:/cnpj_ativo_final.db` como arquivo existente e somente leitura; buscas, resultados e cross-matches continuam no JSON operacional indicado por `LEAD_SEARCH_DB_PATH`. A aplicação não cria tabelas, índices nem qualquer outro dado dentro da base da Receita.

Para usar a amostra fictícia versionada, selecione explicitamente o fallback CSV:

```dotenv
RECEITA_SOURCE=csv
RECEITA_CSV_PATH=./apps/api/data/receita-demo.csv
```

Para validar a interface sem acessar LinkedIn, mantenha:

```dotenv
LINKEDIN_ENABLED=true
LINKEDIN_WORKER_MODE=demo
```

O worker demo aceita empresas locais genéricas, gera resultados determinísticos e usa o primeiro nome de `partner_names` como decisor correspondente. **Nomes, e-mails e telefones produzidos pelo worker demo são fictícios**, servem somente para desenvolvimento e nunca devem ser usados em campanhas ou interpretados como contatos reais da empresa.

Em Linux/macOS, o equivalente à variável de runtime é:

```bash
NODE_OPTIONS=--experimental-sqlite npm run dev
```

### Testes e build

```powershell
$env:NODE_OPTIONS='--experimental-sqlite'
npm test
npm run build
```

### Worker real com Puppeteer

O projeto não usa API paga de busca. O Puppeteer pesquisa a Company Page, abre o LinkedIn, extrai dados corporativos, procura decisores e reaproveita uma sessão persistente controlada pelo operador.

```powershell
npm run linkedin:login
```

Faça login na janela aberta e pressione Enter no terminal quando o feed estiver visível. Depois configure `LINKEDIN_ENABLED=true`, `LINKEDIN_WORKER_MODE=real` e inicie `npm run dev`. O perfil e o cache ficam em `data/`, fora do Git. Se o worker real escutar fora de loopback, defina também `WORKER_AUTH_TOKEN` com um segredo longo; a API envia esse token somente no header `Authorization`.

Para validar uma empresa isoladamente com o Chrome visível, pare o worker em execução e use:

```powershell
npm run linkedin:smoke -- --linkedin-url=https://www.linkedin.com/company/ventura-web-solutions --company="VENTURA Web Solutions" --partner="FABRICIO VENTURA"
```

O teste imprime separadamente sessão, dados da empresa e decisores com vínculo atual comprovado. Se as portas `8010` ou `7001` estiverem ocupadas por outro serviço, `npm run dev` encerra com o PID responsável em vez de reaproveitar um processo incompatível.

Use `LINKEDIN_ENABLED=false` para desligar completamente o cruzamento. Nesse estado, o backend não chama o worker, a qualidade `muito alto` fica bloqueada e os demais níveis usam somente evidências locais. O worker não tenta contornar CAPTCHA ou verificação de segurança; quando isso ocorrer, a sessão precisa ser revisada manualmente.

### Docker Compose

O `docker-compose.yml` monta o SQLite do host em `/data/receita/cnpj.db` como somente leitura. Copie `.env.example` para `.env`, confirme estas opções e execute:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_HOST_PATH=D:/cnpj_ativo_final.db
```

```bash
docker compose up --build
```

A aplicação fica em `http://localhost:3000` e o worker em `http://localhost:8010`. Dentro do container, `RECEITA_SQLITE_PATH` já aponta para `/data/receita/cnpj.db`; o JSON operacional é guardado no volume separado `signalbase-final-mvp-data`. Para `LINKEDIN_WORKER_MODE=real` no Compose, configure `WORKER_AUTH_TOKEN` no `.env`, porque o worker escuta em `0.0.0.0` dentro da rede Docker.

Para usar outro arquivo no host, altere apenas o bind:

```dotenv
RECEITA_SQLITE_HOST_PATH=D:/bases/receita/cnpj_ativo_final.db
```

Não use diretamente `D:/cnpj_ativo_final.db` como caminho interno: esse é o caminho do host. O Compose faz a tradução para `/data/receita/cnpj.db`. A imagem usa Node 22; se a versão concreta ainda exigir a flag, acrescente `NODE_OPTIONS=--experimental-sqlite` ao `.env` usado pelo Compose.

## Exemplo de busca

```bash
curl -X POST http://localhost:7001/api/lead-searches \
  -H "content-type: application/json" \
  -d '{
    "uf": "SC",
    "city": "Florianópolis",
    "cnaes": ["7311400", "7319002"],
    "targetQuantity": 100,
    "minScore": 75,
    "requirePhone": true,
    "requireEmail": false,
    "requireDecisionMakerMatch": true,
    "onlyMobilePhone": false,
    "onlyCorporateEmail": true,
    "excludeGenericContacts": true
  }'
```

Consulte `GET /api/lead-searches/:id` para acompanhar candidatos encontrados, empresas processadas, leads válidos, faltantes, taxa de aproveitamento e estado atual.

Quando o índice composto ainda não existe, a criação responde sem uma varredura de contagem bloqueante. Nesse modo, `candidateCountStatus=lower_bound` e `totalCandidatesFound` cresce conforme os lotes são descobertos; ao esgotar o recorte, a contagem passa a `exact`. Com o índice recomendado presente, a API calcula a contagem exata no início.

## Variáveis essenciais

| Variável | Uso |
| --- | --- |
| `RECEITA_SOURCE` | Fonte empresarial ativa: `sqlite` ou `csv`. |
| `RECEITA_SQLITE_PATH` | Caminho do SQLite da Receita quando `RECEITA_SOURCE=sqlite`; exemplo local: `D:/cnpj_ativo_final.db`. |
| `RECEITA_SQLITE_HOST_PATH` | Arquivo SQLite do host que o Docker Compose monta como `/data/receita/cnpj.db:ro`. |
| `RECEITA_SQLITE_BUSY_TIMEOUT_MS` | Tempo máximo de espera do SQLite por um lock transitório; padrão de 5.000 ms. |
| `RECEITA_CSV_PATH` | Caminho do CSV consolidado/fictício quando `RECEITA_SOURCE=csv`. |
| `LEAD_SEARCH_DB_PATH` | Arquivo JSON operacional separado, com buscas, resultados e cross-matches. |
| `LEAD_SEARCH_BATCH_SIZE` | Quantidade de candidatas lidas por lote interno. |
| `API_PROXY_TARGET` | Destino server-side do proxy Vite em desenvolvimento; padrão `http://127.0.0.1:7001`. |
| `API_CORS_ORIGINS` | Origens web autorizadas a chamar a API diretamente; por padrão, apenas Vite local em `localhost`/`127.0.0.1:5173`. |
| `LINKEDIN_ENABLED` | Liga ou desliga completamente o cruzamento e a disponibilidade de `muito alto`. |
| `LINKEDIN_WORKER_MODE` | `demo` ou `real`. |
| `WORKER_URL` | URL interna/externa do worker Puppeteer. |
| `WORKER_AUTH_TOKEN` | Token compartilhado API -> worker; obrigatório quando o worker real escuta fora de loopback. |
| `REQUEST_TIMEOUT_MS` / `LEAD_OPERATION_TIMEOUT_MS` | Orçamentos da chamada HTTP e da candidata completa; defaults de 120.000 ms. |
| `WORKER_OPERATION_TIMEOUT_MS` / `WORKER_MAX_OPERATION_TIMEOUT_MS` | Deadline padrão (110.000 ms) e teto aceito (300.000 ms) pelo worker. |
| `WORKER_MIN_NAVIGATION_BUDGET_MS` | Margem mínima restante antes de iniciar outra navegação; padrão de 5.000 ms. |
| `WORKER_QUEUE_WAIT_TIMEOUT_MS` / `WORKER_MAX_QUEUE_DEPTH` | Espera máxima e backpressure da fila serial; defaults de 30.000 ms e 8 itens. |
| `WORKER_RESOURCE_CLOSE_TIMEOUT_MS` / `WORKER_SHUTDOWN_TIMEOUT_MS` | Limites para fechamento de página/navegador e encerramento do worker. |
| `WORKER_SESSION_FRESHNESS_MS` | Janela máxima para considerar uma sessão autenticada ainda pronta; default de 15 minutos. |
| `LINKEDIN_BROWSER_PROFILE_DIR` | Diretório persistente da sessão do navegador. |
| `LINKEDIN_CACHE_PATH` | Cache de páginas, perfis e decisões já pesquisadas. |
| `PUPPETEER_CACHE_TTL_HOURS` | TTL de sucessos verificados; padrão de 168 horas. |
| `PUPPETEER_NEGATIVE_CACHE_TTL_MINUTES` / `PUPPETEER_EMPTY_CACHE_TTL_MINUTES` | TTL curto de resultados negativos e contatos vazios; padrão de 15 minutos. |
| `PUPPETEER_EXECUTABLE_PATH` | Chrome/Chromium do host, quando a detecção automática não for suficiente. |
| `MAX_BATCH_SIZE` | Proteção de tamanho de lote do enriquecimento interno. |
| `ENRICH_CONCURRENCY` / `WORKER_CONCURRENCY` | Limites de paralelismo; o acesso ao navegador permanece serial e o default conservador da API é 1. |

No Docker Compose, a porta do worker é publicada apenas em `127.0.0.1`; a API continua acessando-o pela rede interna em `http://worker:8010`. O worker não habilita CORS para chamadas diretas do navegador e, no modo real fora de loopback, recusa inicialização sem `WORKER_AUTH_TOKEN`.

Veja todas as opções em [.env.example](./.env.example).

## Documentação

- [Como funciona](./docs/COMO-FUNCIONA.md): arquitetura, priorização, jobs, score e estados.
- [API](./docs/API.md): endpoints, payloads, paginação, progresso e exportação.
- [Base local da Receita](./docs/BASE-RECEITA.md): configuração SQLite/CSV, schema, índices e operação somente leitura.
- [Migração para PostgreSQL](./docs/MIGRACAO-POSTGRESQL.md): fronteiras, ETL, validação, corte e rollback.
- [Produção e LGPD](./docs/PRODUCAO-LGPD.md): segurança, retenção, direitos e limites das fontes.

## Limites do MVP

- O SQLite da Receita é uma fonte somente leitura; o índice de busca recomendado deve ser criado em manutenção controlada e nunca automaticamente pela aplicação.
- A persistência JSON operacional é adequada a um único processo e baixo volume; produção distribuída exige banco transacional e fila durável.
- “E-mail/telefone validado” no MVP significa que passou pelas regras técnicas implementadas. Não equivale, por si só, à confirmação de entregabilidade, titularidade ou consentimento.
- LinkedIn e provedores de busca podem impor autenticação, limites e termos próprios. O operador é responsável por autorização e conformidade.
- Score e cross-match são sinais probabilísticos. Leads de alto impacto devem continuar sujeitos à revisão humana.
