import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shared chart package lives outside this app (packages/charts) and is
// consumed as source, so it is aliased instead of installed: adding a file:
// dependency would force both lockfiles to be regenerated for a package that
// has no dependencies of its own.
const chartsRoot = fileURLToPath(new URL('../../packages/charts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@volputas/charts/styles.css': `${chartsRoot}/src/styles/charts.css`,
      '@volputas/charts': `${chartsRoot}/src/index.js`,
    },
  },
  server: {
    port: 5173,
    fs: {
      // dev server must be allowed to read the aliased package outside the root
      allow: ['..', chartsRoot],
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
