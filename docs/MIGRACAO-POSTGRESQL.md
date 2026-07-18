# Migração da base da Receita para PostgreSQL

## Objetivo

O SQLite em `D:/cnpj_ativo_final.db` é a fonte empresarial temporária. A migração para PostgreSQL deve trocar o adapter de consulta, não reescrever rotas, jobs, enriquecimento ou frontend. O corte também não precisa mover imediatamente a persistência operacional JSON: fonte da Receita e dados produzidos pelo SignalBase são responsabilidades separadas.

Hoje a seleção aceita:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_PATH=D:/cnpj_ativo_final.db
```

ou:

```dotenv
RECEITA_SOURCE=csv
RECEITA_CSV_PATH=./apps/api/data/receita-demo.csv
```

Uma entrega futura acrescentará `postgres` ao conjunto aceito e uma URL própria da fonte, por exemplo:

```dotenv
RECEITA_SOURCE=postgres
RECEITA_DATABASE_URL=postgresql://usuario:senha@host:5432/receita
```

`RECEITA_SOURCE=postgres` e `RECEITA_DATABASE_URL` são o contrato planejado, não uma promessa de suporte na versão SQLite atual. Credenciais reais devem permanecer no gerenciador de segredos do ambiente e nunca no Git.

## Fronteiras que devem permanecer estáveis

```text
LeadSearchService
  -> ReceitaCompanySource
       -> CsvReceitaCompanySource
       -> SqliteReceitaCompanySource
       -> PostgresReceitaCompanySource (futuro)

LeadSearchService
  -> repositório operacional
       -> JSON (MVP)
       -> PostgreSQL operacional (etapa posterior)
```

`ReceitaCompanySource` é a porta de leitura que conta e pagina `ReceitaCompany`. SQL, pool, placeholders e nomes físicos de tabela ficam dentro do adapter. O serviço não deve receber uma conexão genérica nem construir trechos SQL.

O repositório operacional deve ter sua própria porta. Operações como registrar um resultado e atualizar os contadores da busca precisam representar intenções transacionais; não exponha callbacks arbitrários de mutação que sejam simples no JSON, mas inseguros em concorrência no PostgreSQL.

## Modelo de origem

O adapter SQLite atual deriva o domínio das tabelas:

- `estabelecimento`: CNPJ, situação, CNAE principal, UF, município e contatos;
- `empresas`: razão social e atributos por CNPJ básico;
- `socios`: nomes por CNPJ básico;
- `municipio`: código e descrição;
- tabelas auxiliares de CNAE, natureza jurídica, qualificação e Simples.

O PostgreSQL pode preservar esses nomes durante a primeira migração para reduzir risco. Uma camada analítica ou schema canônico pode ser criada depois. O importante é manter:

- CNPJ completo com 14 dígitos e CNPJ básico com 8;
- CNAE principal com 7 dígitos;
- situação ativa representada sem perda (`02` na origem);
- códigos de município como texto, preservando zeros à esquerda;
- múltiplos sócios por CNPJ básico;
- competência/referência do snapshot importado.

Não converta CNPJ, CNAE, CEP, telefone ou códigos para números. Esses campos são identificadores textuais.

## Índices no PostgreSQL

O equivalente ao índice SQLite de recorte pode ser criado de forma concorrente depois da carga inicial:

```sql
CREATE INDEX CONCURRENTLY idx_estabelecimento_busca_ativas
ON estabelecimento (
  uf,
  cnae_fiscal,
  municipio,
  cnpj_basico,
  cnpj
)
WHERE situacao_cadastral = '02';
```

Também preserve índices de join em:

```sql
CREATE INDEX CONCURRENTLY idx_empresas_cnpj_basico
  ON empresas (cnpj_basico);

CREATE INDEX CONCURRENTLY idx_socios_cnpj_basico
  ON socios (cnpj_basico);

CREATE INDEX CONCURRENTLY idx_municipio_codigo
  ON municipio (codigo);
```

Em uma base restaurada que já contenha índices equivalentes, não duplique estruturas. Confirme com `EXPLAIN (ANALYZE, BUFFERS)` usando recortes representativos, monitore tamanho/tempo de construção e execute DDL por processo operacional controlado. A API não cria índices automaticamente em SQLite nem em PostgreSQL.

## Plano de migração

### 1. Fixar o contrato e uma linha de base

- registre a competência da base SQLite;
- capture contagens por tabela e amostras determinísticas de CNPJ;
- meça `count()` e páginas de buscas por UF, cidade e CNAEs reais;
- mantenha testes de contrato comuns para CSV e SQLite;
- registre os casos de cidade repetida, empresas sem sócios e múltiplos estabelecimentos.

### 2. Preparar o PostgreSQL

- crie banco/schema com encoding UTF-8 e timezone explícito;
- crie tabelas sem transformar identificadores textuais;
- use usuário de carga separado do usuário read-only da API;
- dimensione armazenamento para dados, índices, WAL e margem de manutenção;
- configure backups e restauração antes do primeiro corte.

### 3. Executar o ETL

- leia o snapshot SQLite de forma consistente e somente leitura;
- exporte/importe em lotes, preferencialmente com `COPY`;
- carregue primeiro dimensões, depois empresas/estabelecimentos e sócios;
- crie os índices pesados depois da carga, quando isso reduzir o custo total;
- execute `ANALYZE` no PostgreSQL ao final;
- grave a competência e um identificador imutável da carga.

O ETL não deve usar a API web como transportador da base. Ele é um processo próprio, repetível, observável e capaz de retomar lotes com idempotência.

### 4. Implementar o adapter PostgreSQL

- implemente a mesma porta `ReceitaCompanySource`;
- use pool com limites e timeouts explícitos;
- mantenha queries parametrizadas;
- resolva cidade por todos os códigos compatíveis dentro da UF;
- consulte estabelecimentos/empresas primeiro e sócios em lote;
- preserve ordenação e paginação determinísticas;
- devolva os mesmos campos opcionais/vazios do adapter SQLite;
- traduza erros do driver para mensagens operacionais sem expor credenciais.

Evite depender de funções específicas do SQLite, como `GROUP_CONCAT`, ou espalhar placeholders `?` pelo domínio. O adapter PostgreSQL controla `$1`, `$2`, arrays, JSON e diferenças de collation. Se for adotado um query builder, ele continua sendo detalhe de infraestrutura.

### 5. Rodar testes de contrato

O mesmo conjunto de casos deve ser executado contra SQLite e PostgreSQL:

- somente situação ativa;
- UF obrigatória;
- cidade opcional, normalizada e limitada à UF;
- um ou vários CNAEs principais;
- `count()` coerente com a paginação;
- páginas estáveis, sem CNPJ duplicado;
- razão social e sócios corretos por CNPJ básico;
- contatos ausentes preservados como ausentes;
- caracteres acentuados e zeros à esquerda;
- erro claro quando a fonte está indisponível.

Não use o worker demo para validar a veracidade de contatos. Ele gera decisores, e-mails e telefones fictícios e determinísticos; serve apenas para exercitar o fluxo técnico depois que a candidata foi lida.

### 6. Comparar em modo sombra

Antes do corte, execute uma amostra de consultas nas duas fontes e compare:

- total de candidatas;
- sequência de CNPJs nas primeiras páginas;
- campos essenciais de cada candidata;
- quantidade e nomes dos sócios;
- latência e plano de execução.

Diferenças devem ser explicadas por competência, normalização ou bug conhecido. Não aceite apenas uma porcentagem global: compare também casos limítrofes e recortes pequenos que permitam inspeção manual.

### 7. Fazer o corte

1. Conclua e marque uma carga validada como pronta.
2. Preserve o SQLite e a configuração anterior sem alterações.
3. Altere o secret/configuração para `RECEITA_SOURCE=postgres`.
4. Reinicie uma instância da API e valide health check e consultas pequenas.
5. Libere tráfego gradualmente e monitore erros, pool, CPU, I/O e latência.
6. Só depois amplie concorrência e volume.

Buscas já em processamento dependem de paginação estável. Prefira concluir ou pausar a criação de jobs durante o corte; trocar a fonte no meio de uma busca pode alterar `totalCandidatesFound` e a ordem das candidatas.

### 8. Rollback

O rollback da fonte deve ser apenas uma mudança de configuração:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_PATH=D:/cnpj_ativo_final.db
```

Reinicie a API com Node 22 e `--experimental-sqlite` quando exigido pela versão instalada. Como o SQLite permaneceu somente leitura e o JSON operacional ficou separado, não há dados da Receita para reconciliar no retorno. Ainda assim, revise buscas iniciadas durante o período PostgreSQL antes de retomá-las em outra fonte.

## Migração operacional posterior

Mover o JSON para PostgreSQL é uma segunda entrega. Ela deve incluir tabelas próprias para buscas, resultados e cross-matches, constraints de unicidade, transações para contadores, paginação no banco e uma fila durável ou mecanismo de leasing para jobs.

Não grave essas entidades nas tabelas importadas da Receita. Mesmo no mesmo cluster PostgreSQL, use schema, usuário, permissões, backup e retenção separados para:

- dados-fonte da Receita;
- estado operacional do SignalBase;
- exportações e auditoria.

Essa separação mantém o adapter da Receita read-only, reduz o impacto de uma nova carga e permite evoluir a persistência operacional sem reimportar dezenas de milhões de empresas.

## Critérios de conclusão

A migração pode ser considerada concluída quando:

- testes de contrato passam nas duas fontes;
- contagens e amostras foram reconciliadas com a mesma competência;
- planos de consulta usam os índices esperados;
- health checks não expõem secrets e distinguem fonte/competência;
- carga, backup, restauração e rollback foram exercitados;
- a aplicação PostgreSQL usa credencial read-only para a Receita;
- não houve mudança no contrato das APIs públicas nem no frontend;
- documentação operacional e responsabilidades de LGPD foram revisadas.
