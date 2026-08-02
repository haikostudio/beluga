import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
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
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:7070', ws: true },
      '/api': 'http://127.0.0.1:7070',
      '/auth': 'http://127.0.0.1:7070',
    },
  },
});
