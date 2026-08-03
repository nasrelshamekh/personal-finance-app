import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

/**
 * The single .env lives at the repo root, but the Prisma CLI only looks next to the
 * schema. Node 20.12+ can load an env file at an explicit path, so we do that here
 * rather than pulling in dotenv or keeping a second copy of the file.
 */
const rootEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: fileURLToPath(new URL('./prisma/schema.prisma', import.meta.url)),
  migrations: {
    path: fileURLToPath(new URL('./prisma/migrations', import.meta.url)),
    seed: 'tsx prisma/seed.ts',
  },
});
