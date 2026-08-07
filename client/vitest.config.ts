import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Merged with the real vite config rather than restating it.
 *
 * The `@` and `@ledger/shared` aliases already live in `vite.config.ts`, and `shared/` is
 * consumed as TypeScript source — so a second copy here would be a third place for the
 * same path to drift (CLAUDE.md already warns about the two it has). The react plugin
 * comes along with it, which is what compiles JSX in a test file.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      // Assertions are imported from 'vitest' explicitly, matching the other two
      // workspaces. No globals, so nothing appears in scope that the types don't know.
      globals: false,
      restoreMocks: true,
    },
  }),
);
