# Produção, segurança e LGPD

> Este documento é um checklist técnico de produto, não um parecer jurídico. O controlador deve validar finalidade, hipótese legal, contratos e operação com profissionais de privacidade/jurídico antes de tratar dados reais.

## Por que a LGPD se aplica

Dados de uma pessoa jurídica, isoladamente, não identificam necessariamente uma pessoa natural. Porém, nomes de sócios e decisores, perfis, e-mails individualizados, telefones e evidências podem ser dados pessoais. O fato de uma informação estar em uma fonte pública não elimina automaticamente os princípios, direitos e deveres aplicáveis ao tratamento.

Mapeie pelo menos:

| Dado | Fonte possível | Risco principal |
| --- | --- | --- |
| Nome e qualificação do sócio | Receita/ETL local | associação indevida ou dado desatualizado |
| Nome, cargo e perfil do decisor | LinkedIn via navegador autorizado | uso além da expectativa e erro de identidade |
| E-mail e telefone | Receita, empresa ou decisor | contato não desejado, titularidade incorreta |
| Score, match e evidências | inferência do SignalBase | falsa certeza e impacto reputacional |
| Histórico de busca/exportação | usuário e aplicação | acesso interno excessivo e vazamento |

## Papéis e finalidade

Antes do deploy, identifique por escrito:

- quem decide a finalidade e os meios do tratamento (controlador);
- quais fornecedores tratam dados em nome dele (operadores/suboperadores);
- quem atende titulares e atua como encarregado, quando aplicável;
- finalidade específica de cada busca, público autorizado e uso permitido;
- categorias de dados, fontes, compartilhamentos e transferências internacionais;
- hipótese legal adequada a cada operação.

Não trate “prospecção B2B” como uma autorização genérica. Se a organização avaliar legítimo interesse, documente o teste de balanceamento nas etapas indicadas pela ANPD: finalidade, necessidade e balanceamento/salvaguardas. Essa hipótese não autoriza dados pessoais sensíveis e não substitui transparência nem o direito de oposição quando aplicável.

## Controles de produto necessários

### Transparência e direitos

- publique aviso de privacidade com fontes, finalidades, retenção, compartilhamentos e canal do titular;
- implemente busca por pessoa e rastreabilidade para localizar seus dados em sócios, decisores, resultados, exportações e backups;
- mantenha processo autenticado para confirmação, acesso, correção, oposição e eliminação quando cabíveis;
- registre a decisão e o prazo de cada solicitação;
- mantenha lista de supressão para impedir novo contato após oposição/opt-out, sem reintroduzir o dado em importações posteriores;
- informe que score e correspondência são inferências e ofereça revisão humana.

O MVP não entrega sozinho um portal completo de direitos nem uma política de retenção automática. Esses controles são requisitos anteriores à abertura para usuários reais.

### Minimização e retenção

- carregue somente colunas necessárias da base Receita consolidada;
- não colete dados sensíveis, vida pessoal ou conteúdo não relacionado à função profissional;
- não grave respostas brutas do provedor quando evidências estruturadas bastarem;
- estabeleça prazos diferentes para candidatos rejeitados, leads válidos, logs e exportações;
- apague ou anonimize dados ao fim da finalidade, preservando apenas o mínimo exigido para obrigação legal, segurança ou supressão;
- teste a exclusão também em réplicas e backups, com expiração documentada.

Um prazo como “90 dias” pode ser uma decisão interna de produto, mas não é um prazo universal definido pela LGPD. O controlador deve justificar e configurar a duração conforme a finalidade concreta.

### Qualidade e revisão

- registre competência/data da base Receita e horário de cada enriquecimento;
- mostre fonte e confiança ao lado de cada contato;
- permita corrigir falso match entre homônimos;
- não apresente validação sintática como confirmação de entregabilidade ou consentimento;
- mantenha revisão humana para scores baixos, conflitos de fontes e ações de maior impacto;
- propague correções aos resultados derivados e impeça exportação de registros contestados.

## Segurança mínima de produção

O código atual é um MVP. Antes de expô-lo à internet:

- adicione autenticação, autorização por organização e isolamento entre tenants;
- use TLS em trânsito e criptografia de volumes/backups em repouso;
- armazene segredos e sessões LinkedIn em cofre, nunca no repositório ou imagem;
- limite acesso ao CSV Receita e monte-o como somente leitura;
- proteja `LEAD_SEARCH_DB_PATH`, exportações e temporários com permissões mínimas;
- aplique rate limit, cotas de busca e limites de quantidade/CNAEs;
- valide URLs de provedores para reduzir SSRF e sanitize conteúdo exibido/exportado;
- mantenha logs de auditoria para criação, consulta, seleção, exportação e exclusão;
- remova e-mails, telefones, cookies e payloads integrais dos logs de aplicação;
- faça backup criptografado e teste restauração e expiração;
- atualize dependências, gere SBOM e execute análise de vulnerabilidades;
- monitore falhas, anomalias de exportação e acesso em massa.

A persistência JSON suporta somente uma instância gravadora. Para produção, migre para banco transacional e fila durável, aplique controle de concorrência e torne jobs idempotentes. Não escale horizontalmente o arquivo JSON compartilhado.

## LinkedIn e fontes externas

- use apenas contas e sessões sob controle e autorização do operador;
- verifique termos, limites, robots, contratos e restrições do provedor antes da coleta;
- não contorne controles de acesso, CAPTCHAs ou bloqueios;
- aplique concorrência conservadora e backoff;
- registre qual provedor e método produziram cada evidência;
- disponha de processo para indisponibilidade, revogação e exclusão na fonte;
- faça avaliação contratual de operadores e transferência internacional, quando houver.

O modo demo gera contatos fictícios e deve ficar visualmente identificável. Nunca misture dados demo com uma campanha real.

## Resposta a incidentes

Mantenha um playbook que cubra:

1. detectar, conter e preservar evidências;
2. identificar sistemas, dados e titulares afetados;
3. avaliar risco ou dano relevante e documentar a decisão;
4. envolver segurança, jurídico/privacidade, encarregado e direção;
5. comunicar ANPD e titulares quando os critérios regulamentares forem atendidos;
6. corrigir a causa, rotacionar segredos e monitorar recorrência;
7. registrar cronologia, impactos e medidas adotadas.

O regulamento vigente da ANPD prevê prazo de três dias úteis para a comunicação aplicável, contado do conhecimento pelo controlador. Consulte sempre a regra oficial atual antes de agir; um plano interno deve escalar o incidente imediatamente, sem esperar o fim desse prazo.

## Checklist de liberação

- [ ] inventário e registro das operações de tratamento aprovados;
- [ ] finalidade, hipótese legal e teste de balanceamento documentados;
- [ ] contratos com operadores/suboperadores e fontes revisados;
- [ ] aviso de privacidade e canal do titular publicados;
- [ ] autenticação, RBAC/tenant isolation e auditoria testados;
- [ ] retenção, exclusão, supressão e backups testados ponta a ponta;
- [ ] criptografia, gestão de segredos e rotação configuradas;
- [ ] limites de busca/exportação e prevenção de abuso configurados;
- [ ] qualidade/correção de dados e revisão humana operacionais;
- [ ] playbook de incidentes exercitado;
- [ ] termos e limitações de LinkedIn/provedores aprovados;
- [ ] responsável por privacidade e contatos internos definidos.

## Referências oficiais

- [Lei nº 13.709/2018 — LGPD, texto compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [ANPD — Guia Orientativo sobre Legítimo Interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse)
- [ANPD — Guia de Segurança da Informação para Agentes de Tratamento de Pequeno Porte](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/processo-guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte.pdf)
- [ANPD — Comunicação de Incidente de Segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
- [ANPD — Guia dos Agentes de Tratamento e do Encarregado](https://www.gov.br/anpd/pt-br/assuntos/noticias/nova-versao-do-guia-dos-agentes-de-tratamento)

Referências verificadas em julho de 2026. Normas e procedimentos podem mudar.
