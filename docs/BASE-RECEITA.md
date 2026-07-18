# Base local da Receita Federal

## Seleção da fonte

O domínio de busca não depende diretamente de um arquivo ou de um driver. A aplicação seleciona um adapter da porta `ReceitaCompanySource` por configuração:

```dotenv
# Base real desta máquina
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_PATH=D:/cnpj_ativo_final.db

# Persistência da operação; não pertence à base da Receita
LEAD_SEARCH_DB_PATH=./data/lead-search-db.json
```

Os valores aceitos atualmente por `RECEITA_SOURCE` são:

- `sqlite`: consulta a base relacional da Receita sem carregá-la inteira em memória;
- `csv`: mantém o leitor consolidado, útil para a amostra fictícia e para compatibilidade.

O caminho do SQLite e o caminho do JSON operacional têm finalidades diferentes. `D:/cnpj_ativo_final.db` contém empresas, estabelecimentos, municípios e sócios e deve ser tratado como **fonte somente leitura**. `LEAD_SEARCH_DB_PATH` contém buscas, resultados e cross-matches produzidos pela aplicação. Não coloque dados operacionais dentro do arquivo da Receita.

## Fonte SQLite

### Runtime e abertura segura

Use Node.js 22 ou superior. Enquanto `node:sqlite` exigir habilitação explícita na versão instalada, defina a flag antes de iniciar API, testes ou worker de desenvolvimento que carregue a API:

```powershell
$env:NODE_OPTIONS='--experimental-sqlite'
npm run dev
```

O adapter abre o arquivo existente em modo read-only e ativa `query_only`. As consultas síncronas do driver rodam em uma Worker Thread dedicada, evitando bloquear o event loop do Fastify durante uma varredura. Ele não executa migrations, `CREATE INDEX`, `VACUUM`, `ANALYZE`, atualização de schema ou qualquer escrita implícita. Um caminho ausente ou sem permissão causa erro de configuração claro, sem criar um banco vazio por engano.

`GET /api/health` informa o tipo da fonte, modo read-only, referência declarada pela base e se um índice de busca otimizado foi encontrado. Caminhos locais, URLs de conexão e credenciais não fazem parte da resposta. A ausência do índice aparece como alerta de desempenho, não dispara DDL. `RECEITA_SQLITE_BUSY_TIMEOUT_MS` pode ajustar a espera por um lock transitório; o padrão é 5.000 ms.

### Schema utilizado

O arquivo local usa as tabelas normalizadas da Receita. O recorte principal é montado assim:

| Campo do domínio | Origem SQLite |
| --- | --- |
| CNPJ | `estabelecimento.cnpj` |
| CNPJ básico para joins | `estabelecimento.cnpj_basico` |
| Razão social | `empresas.razao_social` |
| Nome fantasia | `estabelecimento.nome_fantasia` |
| Situação ativa | `estabelecimento.situacao_cadastral = '02'` |
| CNAE principal | `estabelecimento.cnae_fiscal` |
| UF | `estabelecimento.uf` |
| Cidade | `municipio.descricao`, por `estabelecimento.municipio = municipio.codigo` |
| E-mail | `estabelecimento.correio_eletronico` |
| Telefone | DDD + telefone 1, com fallback para telefone 2 |
| Sócios | `socios.nome_socio`, ligados por `cnpj_basico` |

O SQLite real não fornece site nem Company Page do LinkedIn. Esses campos permanecem vazios até o pipeline de enriquecimento tentar resolvê-los. Somente `cnae_fiscal`, o CNAE principal, participa do filtro atual; a lista desnormalizada de CNAEs secundários não altera silenciosamente o contrato da busca.

Nomes de município não são chaves únicas. A resolução da cidade deve normalizar caixa e acentos, considerar todos os códigos correspondentes e sempre combinar esses códigos com a UF da busca. Depois de selecionar o lote de estabelecimentos/empresas, os sócios são carregados em uma consulta por lote usando `cnpj_basico`; isso evita N+1 e evita duplicar candidatas durante a paginação.

### Índice de busca recomendado

Os índices já existentes atendem aos joins por `cnpj`, `cnpj_basico` e códigos auxiliares, mas não ao recorte frequente por UF, CNAE, situação e município. Sem um índice composto, `count()` e `find()` podem varrer dezenas de milhões de estabelecimentos.

Para esta base composta por estabelecimentos ativos, o índice parcial recomendado é:

```sql
CREATE INDEX IF NOT EXISTS idx_estabelecimento_busca_ativas
ON estabelecimento (
  uf,
  cnae_fiscal,
  municipio,
  cnpj_basico,
  cnpj
)
WHERE situacao_cadastral = '02';
```

Esse comando é uma tarefa operacional opcional, não uma migration da aplicação. **A API nunca cria o índice automaticamente.** Em um arquivo de vários gigabytes, planeje janela de manutenção, backup verificável e espaço livre para a construção do índice; execute-o manualmente somente depois de autorizar a alteração da cópia correta da base.

### Consulta e paginação

1. Valida e normaliza UF, cidade e CNAEs.
2. Resolve a cidade para código(s) de município dentro da UF.
3. Com o índice otimizado, conta os estabelecimentos do recorte; sem ele, evita a varredura bloqueante e descobre a contagem incrementalmente.
4. Consulta uma página estável de estabelecimentos e junta a razão social por `cnpj_basico`.
5. Carrega os sócios de todos os CNPJs básicos da página em lote.
6. Converte as linhas para `ReceitaCompany` e entrega as candidatas ao job.

A consulta usa parâmetros para todos os filtros e preserva uma ordenação determinística. O CSV pode priorizar sinais de completude; o SQLite sem índice usa a ordem estável de `rowid` para manter a leitura incremental eficiente. Nenhuma dessas ordens transforma uma empresa em lead válido antes do enriquecimento.

Sem o índice composto, a fonte usa paginação por `rowid` em streaming para não repetir uma varredura integral a cada lote. Enquanto o universo ainda não foi esgotado, a API marca `candidateCountStatus=lower_bound`: `totalCandidatesFound` é a quantidade já conhecida, não uma estimativa inventada. Quando uma página final vem incompleta ou vazia, a contagem se torna `exact`. Esse modo deixa a busca utilizável agora, mas o índice continua recomendado para latência previsível e contagem inicial exata.

## Fonte CSV

`RECEITA_CSV_PATH` deve apontar para um **CSV consolidado de estabelecimentos/empresas**, pronto para consulta. Os arquivos públicos originais da Receita são distribuídos em partes e tabelas relacionadas; faça o ETL e a junção fora da aplicação antes de iniciar o MVP.

O leitor aceita:

- UTF-8, com ou sem BOM;
- separador vírgula ou ponto e vírgula, detectado pelo cabeçalho;
- campos entre aspas, inclusive com separadores e quebras de linha;
- nomes de cabeçalho com diferenças de caixa e acentuação.

### Campos

| Campo canônico | Obrigatório | Cabeçalhos reconhecidos |
| --- | --- | --- |
| CNPJ | sim | `cnpj`, `cnpj completo`, `cnpj completo estabelecimento` |
| Razão social | sim | `razao social`, `nome empresarial`, `empresa`, `legal name` |
| Cidade | sim | `cidade`, `municipio`, `nome municipio` |
| UF | sim | `uf`, `estado` |
| CNAE principal | sim | `cnae`, `cnae principal`, `cnae fiscal`, `cnae fiscal principal` |
| Nome fantasia | não | `nome fantasia`, `fantasia`, `trading name` |
| Sócios | não | `socios`, `socio`, `qsa`, `quadro societario` |
| E-mail | não | `email`, `correio eletronico`, `email empresa` |
| Telefone | não | `telefone`, `telefone 1`, `ddd telefone 1`, `phone`; ou `ddd` + `numero telefone` |
| Site | não | `site`, `website`, `url site` |
| Company Page | não | `linkedin url`, `linkedin`, `linkedin company page` |
| Situação | não | `situacao cadastral`, `situacao`, `status` |

Registros sem os cinco campos obrigatórios válidos são ignorados. CNPJ precisa ter 14 dígitos e CNAE, sete. Pontuação nesses dois campos é removida.

Se a situação cadastral estiver presente, entram apenas valores vazios, `2`, `02` ou textos contendo `ATIVA` após normalização. CNPJs repetidos são consolidados em um único registro.

### Exemplo mínimo

```csv
cnpj;razao_social;nome_fantasia;cidade;uf;cnae;socios;email;telefone;site;linkedin_url;situacao_cadastral
11222333000181;Tech Azul Solutions LTDA;Tech Azul;Florianópolis;SC;7311400;Marina Costa - Sócia Administradora;contato@techazul.example;+55 48 99999-1000;https://techazul.example;https://www.linkedin.com/company/tech-azul-solutions;ATIVA
22333444000172;Vértice Marketing LTDA;Vértice;Blumenau;SC;7319002;André Valente;;;https://vertice.example;;02
```

Use domínios e contatos reservados/fictícios em ambientes de teste.

### Sócios

No CSV consolidado, coloque múltiplos sócios na mesma célula separados por ponto e vírgula, barra vertical ou quebra de linha. Quando a qualificação vier no formato `Nome - Sócio Administrador`, o leitor preserva o nome e remove a qualificação para o cross-match.

Exemplo:

```text
Marina Costa - Sócia Administradora|Rafael Nogueira - Sócio
```

### Como a consulta CSV funciona

1. Na primeira consulta, o CSV é lido e normalizado em memória.
2. O cache é reutilizado enquanto a data de modificação do arquivo não mudar.
3. Empresas inativas ou estruturalmente inválidas são descartadas.
4. O filtro aplica UF e qualquer um dos CNAEs solicitados.
5. Cidade é comparada sem diferenciar caixa/acentuação quando informada.
6. Candidatas são ordenadas por completude e pelos filtros de contato da busca.
7. O job consome fatias por `offset` e `limit`.

Sinais como LinkedIn já conhecido, site, sócios e contatos tecnicamente válidos aumentam a prioridade. Isso só altera a ordem de enriquecimento; não garante que o resultado será aceito.

## Caminhos local e Docker

Execução local com a base SQLite real:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_PATH=D:/cnpj_ativo_final.db
```

Execução local com CSV fictício/consolidado:

```dotenv
RECEITA_SOURCE=csv
RECEITA_CSV_PATH=./apps/api/data/receita-demo.csv
```

O `docker-compose.yml` versionado usa SQLite por padrão e monta o arquivo do host como `/data/receita/cnpj.db:ro`:

```dotenv
RECEITA_SOURCE=sqlite
RECEITA_SQLITE_HOST_PATH=D:/cnpj_ativo_final.db
```

Dentro do container, o Compose configura `RECEITA_SQLITE_PATH=/data/receita/cnpj.db`; não reutilize o caminho `D:/...` como se ele existisse na imagem. O JSON operacional permanece no volume `signalbase-final-mvp-data`.

O CSV continua disponível como adapter alternativo, mas uma execução Compose customizada deve fornecer um arquivo/caminho interno compatível com `RECEITA_CSV_PATH`. A troca de `RECEITA_SOURCE` não transforma um caminho do host em caminho do container automaticamente.

## Atualização da base

Prepare a nova versão em outro caminho, valide schema/cabeçalhos, competência e quantidade de registros, e só então faça uma troca controlada. Não sobrescreva o SQLite ou CSV enquanto jobs o leem. Reinicie a API depois de apontar para o novo snapshot e preserve o anterior para rollback. Uma evolução de produção deve persistir na busca qual competência da Receita foi consultada.

## Escala e produção

O leitor CSV carrega o consolidado em memória e é apropriado para amostras. O adapter SQLite consulta a base nacional no próprio banco, mas ainda depende do índice de recorte, de paginação estável e de uma única máquina com acesso ao arquivo. Ele é a etapa temporária antes do PostgreSQL, não uma arquitetura distribuída final.

Para escala real:

- execute ETL incremental e valide CNPJ/CNAE;
- armazene campos normalizados e a competência da Receita;
- mantenha índices compatíveis com UF, CNAE, situação e município;
- migre para PostgreSQL quando precisar de concorrência, observabilidade e operação distribuída;
- faça paginação por cursor/chave, não por offsets grandes;
- mantenha o arquivo bruto criptografado e separado da aplicação;
- monitore duplicidade, cobertura de sócios e qualidade de contatos;
- siga o roteiro de [migração para PostgreSQL](./MIGRACAO-POSTGRESQL.md).

## Segurança dos dados

A base e os resultados podem conter dados pessoais de sócios e representantes. Não faça commit do SQLite, do CSV, de cópias do JSON operacional nem de exportações. Restrinja o acesso pelo princípio do menor privilégio, mantenha a fonte read-only para a aplicação, criptografe disco e backups, registre acessos e aplique a política de retenção descrita em [Produção e LGPD](./PRODUCAO-LGPD.md).
