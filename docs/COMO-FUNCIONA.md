# Como o SignalBase Final MVP funciona

## Objetivo

O produto transforma um recorte de mercado em uma lista revisável de contatos B2B. A entrada principal descreve **quais empresas procurar**, não quais CNPJs enriquecer:

- UF obrigatória;
- cidade opcional, sempre pertencente à UF informada;
- um ou mais CNAEs obrigatórios;
- quantidade de contatos finais desejada;
- score mínimo e exigências opcionais de contato e de decisor.

Quando a cidade fica vazia, a consulta cobre todo o estado. Os CNAEs são combinados por “OU”: a empresa pode corresponder a qualquer código informado.

## Visão ponta a ponta

```text
Filtros da busca
  -> consulta da base Receita local
  -> contagem e priorização de candidatas
  -> processamento paginado em lotes
      -> Company Page
      -> perfil corporativo
      -> decisores
      -> sócio Receita x decisor LinkedIn
      -> contato final
      -> score, filtros e evidências
      -> resultado parcial persistido
  -> para ao atingir a meta OU ao esgotar candidatas
  -> revisão, seleção e exportação
```

## 1. Criação da busca

`POST /api/lead-searches` valida e normaliza a entrada:

- UF em duas letras e maiúscula;
- cidade sem espaços excedentes;
- CNAEs somente com os sete dígitos canônicos, sem pontuação;
- quantidade inteira positiva;
- score entre 0 e 100;
- filtros booleanos com valor explícito.

A API cria um `LeadSearch` em estado `queued`, conta as candidatas que correspondem ao recorte e agenda o processamento em segundo plano. A resposta HTTP não espera todo o enriquecimento terminar.

Exemplo de recorte estadual:

```json
{
  "uf": "SC",
  "cnaes": ["7319002"],
  "targetQuantity": 500,
  "minScore": 75,
  "requirePhone": false,
  "requireEmail": true,
  "requireDecisionMakerMatch": false,
  "onlyMobilePhone": false,
  "onlyCorporateEmail": true,
  "excludeGenericContacts": true
}
```

## 2. Seleção na base local da Receita

O backend escolhe a fonte por `RECEITA_SOURCE=sqlite|csv`. As duas implementações obedecem à mesma porta `ReceitaCompanySource`, portanto o serviço de busca recebe registros de empresa sem conhecer driver, arquivo ou dialeto SQL.

No uso local com a base real:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_PATH=D:/cnpj_ativo_final.db
```

O adapter SQLite abre o arquivo somente leitura e com `query_only`, consulta `estabelecimento`, `empresas`, `municipio` e `socios` e nunca cria tabelas, índices ou dados operacionais. Em Node.js 22, use `NODE_OPTIONS=--experimental-sqlite` enquanto a versão instalada ainda exigir a flag para `node:sqlite`.

O fallback CSV continua disponível para amostras e compatibilidade:

```dotenv
RECEITA_SOURCE=csv
RECEITA_CSV_PATH=./apps/api/data/receita-demo.csv
```

Independentemente da fonte, o adapter cria registros de empresa com:

- CNPJ;
- razão social e nome fantasia;
- cidade e UF;
- CNAE principal;
- sócios;
- e-mail, telefone, site e LinkedIn, quando a fonte local tiver esses campos.

O filtro obrigatório usa UF + CNAEs. Cidade só participa quando foi informada. A comparação de cidade deve tolerar diferenças de caixa, acentos e espaços; CNAE e CNPJ são comparados apenas pelos dígitos.

No schema SQLite, a cidade é um código em `estabelecimento.municipio`, resolvido por `municipio.codigo`, e a razão social/sócios são ligados por `cnpj_basico`. Como nomes de cidade podem se repetir, a resolução considera a UF e pode produzir mais de um código. Os sócios do lote são buscados juntos depois da página principal, evitando uma consulta por empresa e evitando duplicidade no resultado.

Os índices originais atendem aos joins por CNPJ, mas não ao recorte por UF, CNAE, situação ativa e município. Há um índice composto recomendado em [Base local da Receita](./BASE-RECEITA.md), cuja criação é uma ação manual de manutenção. A aplicação apenas detecta/usa os índices disponíveis; ela não modifica automaticamente a base de vários gigabytes.

A base é somente a fonte de candidatas. Um e-mail ou telefone presente nela ainda precisa passar pelas regras técnicas e pelos filtros da busca antes de virar contato final.

## 3. Priorização e paginação interna

As candidatas são processadas em ordem estável. O adapter CSV prioriza registros mais completos — por exemplo, nome fantasia, site, contato e sócios. O SQLite sem índice percorre `rowid` de forma incremental para evitar repetir varreduras nacionais; a qualificação final continua sendo feita pelo pipeline, não pela ordem de leitura. A ordem precisa continuar determinística entre páginas e retomadas, mesmo que SQLite e CSV implementem a consulta de modos diferentes.

O job lê páginas internas em vez de carregar e enriquecer todo o estado de uma vez. A paginação não altera a meta: se o usuário pedir 100 contatos, o job continua solicitando páginas enquanto houver candidatas e ainda faltarem contatos válidos.

Uma mesma candidata deve gerar no máximo um `LeadSearchResult` dentro da mesma busca. Isso permite reprocessamento idempotente e evita inflar `totalProcessed`.

## 4. Enriquecimento por empresa

Para cada candidata, o pipeline:

1. resolve a Company Page pelo URL já conhecido ou pelo provedor de busca configurado;
2. pede ao worker os dados corporativos da página;
3. busca pessoas com cargos de decisão;
4. envia ao worker os nomes de sócios em `partner_names`;
5. compara nomes normalizados e registra a força da correspondência;
6. escolhe o melhor e-mail e telefone entre decisor e empresa;
7. classifica e-mail corporativo/genérico e telefone móvel/fixo;
8. calcula o score final;
9. avalia os filtros da busca;
10. salva evidências, avisos e motivos de rejeição.

### Worker demo

O modo `demo` não acessa o LinkedIn. Ele aceita qualquer empresa local, usa dados determinísticos e, quando recebe sócios, cria o primeiro decisor a partir do primeiro nome de `partner_names`. Se houver domínio corporativo, gera um e-mail sintético no domínio; se houver contexto suficiente de empresa, pode gerar um telefone sintético. A resposta explicita `source=demo_*`.

Isso torna a execução reproduzível e permite testar centenas de candidatas. **Todo nome de decisor, e-mail e telefone gerado pelo worker demo é fictício.** Nenhum contato demo deve ser usado comercialmente, misturado a uma exportação real ou interpretado como informação confirmada da empresa consultada no SQLite.

### Worker real

O modo `real` usa um worker Node/Puppeteer com perfil persistente. Ele descobre a Company Page sem API paga, abre a página corporativa, extrai os dados visíveis, pesquisa pessoas por nomes de sócios e cargos e, quando a sessão permite, lê os contatos exibidos no perfil. Os mesmos campos `partner_names` são opcionais, portanto clientes antigos continuam compatíveis. Pessoas encontradas recebem os metadados adicionais:

- `partner_match`;
- `matched_partner_name`;
- `partner_match_confidence`.

Uma sessão LinkedIn válida e controlada pelo operador é necessária. O worker serializa a navegação, aplica intervalo entre páginas e usa cache para evitar acessos repetidos. Ele não contorna CAPTCHA ou desafios: registra o bloqueio e exige revisão manual da sessão. Limites, termos de uso e disponibilidade das fontes continuam aplicáveis.

Com `LINKEDIN_ENABLED=false`, nenhuma chamada ao worker é feita. A qualidade `muito alto` fica indisponível; `baixo`, `médio` e `alto` usam somente contatos e sinais locais, sem afirmar que cargo ou vínculo profissional estão atuais.

## 5. Contato final e filtros

A escolha privilegia o contato do decisor quando ele é tecnicamente utilizável; na ausência dele, pode recorrer ao contato empresarial da Receita. A evidência deve registrar a fonte escolhida.

Uma candidata só conta em `totalValidLeads` quando satisfaz simultaneamente:

- `finalScore >= minScore`;
- telefone presente, se `requirePhone=true`;
- e-mail presente, se `requireEmail=true`;
- sócio e decisor correspondentes, se `requireDecisionMakerMatch=true`;
- celular, se `onlyMobilePhone=true`;
- domínio corporativo, se `onlyCorporateEmail=true`;
- contato não genérico, se `excludeGenericContacts=true`.

“Validado” neste MVP significa **validação técnica pelas regras da aplicação**. Uma validação real de entregabilidade exigiria integração específica, consentimento/base legal e tratamento de bounces.

## 6. Score, explicações e evidências

O score agrega sinais de identidade e completude, como Company Page resolvida, perfil corporativo, decisor encontrado, correspondência com sócio e contato disponível. Ele não é uma certeza matemática.

Cada `LeadCrossMatch` preserva:

- empresa e CNPJ de origem;
- sócios considerados;
- Company Page e perfil do decisor;
- resultado da comparação de nomes;
- e-mail e telefone finais com suas fontes;
- flags de corporativo/genérico e móvel/fixo;
- score final;
- evidências positivas;
- avisos e razões de rejeição.

Essa trilha torna a decisão auditável no detalhe do lead e evita apresentar apenas um número sem explicação.

## 7. Persistência e jobs

O MVP usa `LEAD_SEARCH_DB_PATH`, um arquivo JSON operacional com versão de schema e três coleções lógicas:

- `searches`: configurações, estado e contadores de `LeadSearch`;
- `results`: um `LeadSearchResult` por candidata processada;
- `crossMatches`: detalhes completos dos enriquecimentos produzidos.

Resultados e contadores são persistidos durante o processamento, não somente no final. Assim, o frontend consegue exibir progresso parcial e revisar leads que já ficaram prontos.

Esse JSON é independente de `RECEITA_SQLITE_PATH`: a API lê empresas em `D:/cnpj_ativo_final.db`, mas grava somente no arquivo operacional. O banco da Receita não recebe `LeadSearch`, `LeadSearchResult`, cross-match, score, seleção nem exportação.

A implementação JSON foi escolhida para o MVP e pressupõe uma única instância gravadora. Ao iniciar, a API reagenda buscas persistidas em `queued` ou `processing`; os IDs determinísticos impedem duplicar uma candidata já registrada. Isso é uma retomada simples, não uma fila durável: para produção com múltiplos processos, substitua por banco transacional, fila, locks distribuídos, retries com backoff e workers idempotentes.

### Fronteiras para PostgreSQL

A arquitetura separa duas responsabilidades:

- `ReceitaCompanySource`: conta e pagina empresas candidatas; hoje possui adapters SQLite e CSV e poderá receber um adapter PostgreSQL;
- repositório operacional de buscas: persiste jobs, resultados e cross-matches; hoje usa JSON e pode migrar em uma etapa independente.

Rotas, validação, enriquecimento e frontend não devem importar APIs de SQLite/PostgreSQL. A composição escolhe os adapters a partir da configuração. O roteiro de schema, ETL, testes de contrato, corte e rollback está em [Migração para PostgreSQL](./MIGRACAO-POSTGRESQL.md).

## 8. Estados e término

| Estado | Significado |
| --- | --- |
| `queued` | Busca persistida e aguardando início. |
| `processing` | Candidatas sendo enriquecidas. |
| `completed` | Meta de leads válidos atingida. |
| `exhausted` | Todas as candidatas foram examinadas antes de atingir a meta. |
| `failed` | Erro impediu a continuidade; `lastError` traz o diagnóstico disponível. |

Os nomes retornados pela API são canônicos em minúsculas. O frontend pode renderizar rótulos em português sem alterar esses valores.

## 9. Métricas de progresso

| Campo | Definição |
| --- | --- |
| `totalCandidatesFound` | Empresas da base que atendem UF/cidade/CNAEs. |
| `totalProcessed` | Candidatas para as quais já existe resultado final de processamento. |
| `totalValidLeads` | Resultados `valid` que satisfazem todos os filtros. |
| `remainingQuantity` | `max(targetQuantity - totalValidLeads, 0)`. |
| `candidatesRemaining` | `max(totalCandidatesFound - totalProcessed, 0)`. |
| `yieldRate` | `totalValidLeads / totalProcessed * 100`; zero antes do primeiro processamento. |
| `progressPercent` | Progresso em relação à meta de leads válidos, limitado a 100%. |
| `candidateProgressPercent` | Parcela do universo candidato já processada. |

Exemplo: 500 candidatas encontradas, 240 processadas e 72 válidas para uma meta de 100. Faltam 28 contatos, o aproveitamento é 30% e 48% das candidatas foram examinadas.

## 10. Revisão e exportação

`LeadSearchResult.selected` permite curadoria sem apagar o resultado original. A tela **Revisão de Leads** pode filtrar válidos/rejeitados, abrir evidências e marcar quais contatos serão exportados.

A exportação pertence a uma busca e contém seus leads finais. Ela não exporta a lista bruta de CNPJs candidatos. A opção `selectedOnly=true` limita o CSV aos resultados válidos selecionados.

## 11. Modo CNPJ avançado

O endpoint legado de enriquecimento por CNPJ pode continuar disponível para suporte, teste ou uma ação manual no detalhe. Ele não cria o universo por filtros, não substitui `LeadSearch` e não deve ocupar a tela principal.

Use esse modo somente quando já houver um CNPJ específico para diagnosticar. Para geração de listas, use sempre a jornada **Nova Busca**.
