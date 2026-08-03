import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = process.env.PORT ?? '4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Mirrored in tsconfig.app.json `paths` — shadcn's init needs both (SPEC §11).
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The shared workspace is consumed as TypeScript source, not a build artefact,
      // so there is no build step to forget and no stale dist to debug.
      '@ledger/shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // `--host` is set in the dev script so the app is reachable from a phone on the LAN.
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
