import { lireFragment } from '@beluga/shared';
import { estInstallee } from './application-installee';
import { readPref } from './prefs';

/**
 * CE QUE L'ÉCRAN MESURE DE LUI-MÊME pour le rapport d'usage anonyme
 * (`server/src/usage-installation.ts`, décisions du 22/10/2026) : les écrans
 * ouverts et leur temps d'apparition, le temps passé par zone, le profil
 * d'affichage (langue, taille d'écran, application installée, thème) et les
 * coupures du canal. Que des NOMS D'ÉCRAN et des nombres : jamais ce qui s'y
 * lit ni s'y écrit.
 *
 * Le démon décide : le partage coupé, ou une installation qui ne joint pas
 * l'équipe Beluga, et ce qui arrive est ignoré. L'envoi part toutes les deux
 * minutes s'il y a du neuf, et quand la page passe à l'arrière-plan (balise
 * `sendBeacon`, qui survit à la fermeture de l'onglet).
 */

interface Ouverture {
  nom: string;
  ms: number;
}

let ouvertures: Ouverture[] = [];
let zones: Record<string, number> = {};
let coupures = 0;
let ecranCourant: string | null = null;
let depuis = 0;
let demarree = false;
let profilEnvoye = false;

/** Le nom de l'écran affiché, lu dans l'adresse : la vue, et « carte » quand une carte est ouverte. */
function ecranDeLAdresse(): string {
  try {
    const ecran = lireFragment(window.location.hash) as { vue?: string; cardId?: string; page?: string };
    const vue = ecran.vue ?? 'accueil';
    if (ecran.cardId) return `${vue}.carte`;
    // Une page des réglages a un nom fixe (« installation », « mise-a-jour ») : il se garde.
    return vue === 'reglages' && ecran.page && /^[a-z-]{1,30}$/.test(ecran.page) ? `reglages.${ecran.page}` : vue;
  } catch {
    return 'accueil';
  }
}

/** Le temps passé sur l'écran quitté s'ajoute à sa zone. */
function compterLeTemps(maintenant: number): void {
  if (ecranCourant && depuis && document.visibilityState === 'visible') {
    const secondes = Math.round((maintenant - depuis) / 1000);
    if (secondes > 0 && secondes < 6 * 3600) zones[ecranCourant] = (zones[ecranCourant] ?? 0) + secondes;
  }
  depuis = maintenant;
}

/** Un écran change : son temps d'apparition est mesuré jusqu'à la seconde image dessinée. */
function surveillerLEcran(): void {
  const nom = ecranDeLAdresse();
  if (nom === ecranCourant) return;
  const debut = performance.now();
  compterLeTemps(Date.now());
  ecranCourant = nom;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      ouvertures.push({ nom, ms: Math.round(performance.now() - debut) });
      if (ouvertures.length > 200) ouvertures = ouvertures.slice(-200);
    }),
  );
}

function corpsDeLEnvoi(): string | null {
  compterLeTemps(Date.now());
  if (!ouvertures.length && !Object.keys(zones).length && !coupures && profilEnvoye) return null;
  const corps = {
    langue: readPref<string>('langue', 'fr'),
    langueNavigateur: navigator.language,
    ecran: `${Math.round(window.screen.width)}x${Math.round(window.screen.height)}`,
    installee: estInstallee(),
    theme: readPref<string | undefined>('theme', undefined) ?? 'automatique',
    ouvertures,
    zones,
    coupures,
  };
  ouvertures = [];
  zones = {};
  coupures = 0;
  profilEnvoye = true;
  return JSON.stringify(corps);
}

function envoyer(enPartant: boolean): void {
  const corps = corpsDeLEnvoi();
  if (!corps) return;
  try {
    if (enPartant && navigator.sendBeacon) {
      navigator.sendBeacon('/api/usage', new Blob([corps], { type: 'application/json' }));
      return;
    }
    void fetch('/api/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: corps, keepalive: true }).catch(() => undefined);
  } catch {
    /* la mesure ne gêne jamais */
  }
}

/** Une coupure du canal temps réel (appelée par `client.ts`). */
export function noterUneCoupure(): void {
  coupures += 1;
}

/**
 * Démarre la mesure, une fois, depuis la racine de l'application. Le premier
 * écran compte le chargement entier de la page.
 */
export function demarrerLaMesureDeLEcran(): void {
  if (demarree || typeof window === 'undefined') return;
  demarree = true;
  ecranCourant = ecranDeLAdresse();
  depuis = Date.now();
  ouvertures.push({ nom: `${ecranCourant}.chargement`.slice(0, 40), ms: Math.round(performance.now()) });
  window.addEventListener('popstate', surveillerLEcran);
  window.addEventListener('hashchange', surveillerLEcran);
  // L'application réécrit l'adresse par `history` sans événement : un coup d'œil régulier, page visible seulement.
  window.setInterval(() => {
    if (document.visibilityState === 'visible') surveillerLEcran();
  }, 3000);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') envoyer(false);
  }, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') envoyer(true);
    else depuis = Date.now();
  });
  window.setTimeout(() => envoyer(false), 20_000);
}
