import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Tests import modules that validate process.env at load time, so the root .env is
// loaded here rather than requiring a --env-file flag on every vitest invocation.
const rootEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
