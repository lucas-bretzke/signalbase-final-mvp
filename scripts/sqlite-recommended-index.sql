-- Execute este indice manualmente, fora da aplicacao, em uma janela de manutencao.
-- Crie e valide um backup do banco antes; a operacao exige espaco livre e acesso de escrita.
-- A aplicacao deve continuar abrindo o arquivo SQLite em modo somente leitura.

CREATE INDEX IF NOT EXISTS idx_estabelecimento_busca_ativas
ON estabelecimento (
  uf,
  cnae_fiscal,
  municipio,
  cnpj_basico,
  cnpj
)
WHERE situacao_cadastral = '02';
