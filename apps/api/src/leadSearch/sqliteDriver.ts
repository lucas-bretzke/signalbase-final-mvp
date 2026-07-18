import { createRequire } from 'node:module';

// Node 22.11 does not list the experimental node:sqlite module in
// module.builtinModules. Loading it through createRequire keeps Vite/Vitest from
// mistaking `sqlite` for an npm package while retaining full TypeScript types.
const sqliteModuleName = ['node', 'sqlite'].join(':');
const sqliteModule = createRequire(import.meta.url)(sqliteModuleName) as typeof import('node:sqlite');

export const DatabaseSync = sqliteModule.DatabaseSync;
export type SqliteDatabaseConnection = InstanceType<typeof DatabaseSync>;
