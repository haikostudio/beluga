import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { empreinteDuServiceWorker } from './empreinte-paquet';

const demon = Number(process.env.BELUGA_DEMON_PORT || 7070);

export default defineConfig({
  plugins: [react(), empreinteDuServiceWorker()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 7071,
    /* Le démon visé par l'interface de développement. Il vaut 7070 — le démon
       en service — sauf quand on veut essayer une BRANCHE sans y toucher : un
       démon d'essai à soi, sur un autre port, et `BELUGA_DEMON_PORT` pointé
       dessus. C'est ce que fait `scripts/verif-synthese-dans-le-fil.mjs`. */
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${demon}`, ws: true },
      '/api': `http://127.0.0.1:${demon}`,
      '/auth': `http://127.0.0.1:${demon}`,
    },
  },
});
