/**
 * LES ENTÊTES DE SÉCURITÉ DE BELUGA — posés par le DÉMON sur chacune de ses réponses
 * (`server/src/http.ts`, `poserLesEntetesDeSecurite`), jamais par le relais Caddy : toute installation
 * (`scripts/installer.sh`, `/opt/beluga`) les reçoit ainsi, pas seulement celle de ce serveur.
 *
 * Ce sont des valeurs PAR DÉFAUT : une réponse qui pose déjà le sien (la plaquette client et sa
 * politique « default-src 'none' », la page d'installation et son « no-referrer ») le garde — Node
 * fait passer l'entête de `writeHead` avant celui de `setHeader`.
 *
 * LA POLITIQUE DES SOURCES (CSP) EST APPLIQUÉE, pas en observation (décision de l'utilisateur,
 * 07/11/2026). Ses compromis, voulus :
 *  - `script-src` garde `'unsafe-inline'` : l'aperçu du Studio est une page `srcdoc` qui HÉRITE de
 *    la politique de l'application et porte ses propres scripts en ligne, comme le script du thème
 *    qui précède le premier affichage (`web/index.html`). Ce qui est fermé : tout script venu d'un
 *    AUTRE site — seule l'origine de Beluga (`'self'`) et `blob:` sont admis.
 *  - `'wasm-unsafe-eval'` : la détection des visages du Studio compile son moteur WebAssembly.
 *  - images, sons, vidéos, polices, cadres et appels réseau restent ouverts en `https:` : favicons
 *    des projets, médias des services de génération, aperçus des sites des projets.
 *  - `frame-ancestors 'self'` (et `X-Frame-Options: SAMEORIGIN` pour les vieux navigateurs) : Beluga
 *    peut s'afficher dans son propre cadre, jamais dans celui d'un autre site.
 *
 * HSTS N'EST ENVOYÉ QUE SUR UNE REQUÊTE ARRIVÉE EN HTTPS (relais `X-Forwarded-Proto: https`) : envoyé
 * en HTTP local, il forcerait `localhost` en HTTPS dans le navigateur pour un an.
 *
 * Règle pure, éprouvée dans `server/src/test/entetes-de-securite.test.ts`.
 */

export const POLITIQUE_DES_SOURCES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' ws: wss: https: data: blob:",
  "frame-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

export const HSTS = 'max-age=31536000; includeSubDomains';

/** La requête est-elle arrivée en HTTPS ? Derrière le relais, c'est `X-Forwarded-Proto` qui le dit. */
export function requeteEnHttps(xForwardedProto: string | string[] | undefined, chiffreeEnDirect = false): boolean {
  if (chiffreeEnDirect) return true;
  const brut = Array.isArray(xForwardedProto) ? xForwardedProto[0] : xForwardedProto;
  return (brut ?? '').split(',')[0]!.trim().toLowerCase() === 'https';
}

/** Les entêtes de sécurité par défaut d'une réponse du démon. */
export function entetesDeSecurite(enHttps: boolean): Record<string, string> {
  return {
    'content-security-policy': POLITIQUE_DES_SOURCES,
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...(enHttps ? { 'strict-transport-security': HSTS } : {}),
  };
}
