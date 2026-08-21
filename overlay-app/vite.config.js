import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 共有チャートは packages/charts を source のまま alias で取り込む
// (player-profile-server/frontend と同じ扱い: 実装を二重に持たない)。
const chartsRoot = fileURLToPath(new URL('../packages/charts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Tauri が dev server を掴むので固定ポート。失敗したら落とす。
  clearScreen: false,
  resolve: {
    alias: {
      '@volputas/charts/styles.css': `${chartsRoot}/src/styles/charts.css`,
      '@volputas/charts': `${chartsRoot}/src/index.js`,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: ['..', chartsRoot] },
  },
  build: {
    target: 'esnext',
    emptyOutDir: true,
  },
});
