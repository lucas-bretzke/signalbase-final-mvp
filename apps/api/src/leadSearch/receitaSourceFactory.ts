import { CsvReceitaCompanySource } from './receitaCsvSource.js';
import { SqliteReceitaCompanySource } from './sqliteReceitaSource.js';
import { ReceitaCompanySource } from './types.js';

export type ReceitaSourceKind = 'csv' | 'sqlite';

export interface ReceitaSourceConfig {
  kind: ReceitaSourceKind;
  csvPath: string;
  sqlitePath: string;
  sqliteBusyTimeoutMs?: number;
}

/** Composition root for the public Receita dataset. */
export function createReceitaCompanySource(config: ReceitaSourceConfig): ReceitaCompanySource {
  switch (config.kind) {
    case 'csv':
      return new CsvReceitaCompanySource(config.csvPath);
    case 'sqlite':
      return new SqliteReceitaCompanySource(config.sqlitePath, {
        busyTimeoutMs: config.sqliteBusyTimeoutMs,
      });
  }
}
