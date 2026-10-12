import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { empreinteDuServiceWorker } from './empreinte-paquet';

const demon = Number(process.env.BELUGA_DEMON_PORT || 7070);

/**
 * LE PREMIER ÉCRAN SE TÉLÉCHARGE EN MÊME TEMPS QUE LE CODE D'ENTRÉE.
 *
 * Le morceau de l'application (`app-*.js`) n'est demandé qu'une fois le code
 * d'entrée téléchargé ET exécuté : deux temps d'attente l'un derrière l'autre,
 * sur un téléphone. On le déclare dans la page (`modulepreload`) pour que le
 * navigateur le prenne tout de suite, avec ses dépendances directes. Seul ce
 * morceau — jamais les écrans qui s'ouvrent à la demande (DEC-050).
 */
function prechargerLePremierEcran(): Plugin {
  return {
    name: 'beluga-precharger-le-premier-ecran',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, contexte) {
        const paquet = contexte.bundle;
        if (!paquet) return;
        /* Le morceau de `src/app.tsx` : son nom de morceau est « app » (le fichier
           d'origine n'est pas toujours rappelé quand Rollup fusionne des modules). */
        const morceau = Object.values(paquet).find(
          (m) =>
            m.type === 'chunk' &&
            !m.isEntry &&
            (m.name === 'app' || m.facadeModuleId?.replace(/\\/g, '/').endsWith('/src/app.tsx')),
        );
        if (!morceau || morceau.type !== 'chunk') return;
        const entree = Object.values(paquet).find((m) => m.type === 'chunk' && m.isEntry);
        const dejaDansLEntree = new Set(
          entree && entree.type === 'chunk' ? [entree.fileName, ...entree.imports] : [],
        );
        const fichiers = [morceau.fileName, ...morceau.imports.filter((f) => !dejaDansLEntree.has(f))];
        return fichiers.map((fichier) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `/${fichier}` },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), empreinteDuServiceWorker(), prechargerLePremierEcran()],
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
      // Le cadre d'aperçu du Studio lit GSAP, les polices et ses médias signés hors de `/api`.
      '/studio/': `http://127.0.0.1:${demon}`,
      '/studio-media/': `http://127.0.0.1:${demon}`,
    },
  },
});
