import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    poolOptions: {
      threads: {
        execArgv: ['--experimental-sqlite'],
      },
      forks: {
        execArgv: ['--experimental-sqlite'],
      },
    },
  },
});
