/**
 * LES NAVIGATEURS AU CHOIX (carte « Navigateurs facultatifs à la liaison », 22/11/2026).
 *
 * Avant : relier un ordinateur imposait Chrome, puis Safari sur un Mac, et l'ordinateur n'était « prêt » qu'avec les
 * deux. Maintenant, Beluga Connect DÉTECTE les navigateurs installés (`NavigateurInstalle`), la personne COCHE ceux à
 * équiper (`navigateursChoisis` de l'ordinateur, colonne `ordinateurs.navigateurs`), et l'automatisme n'équipe QUE
 * ceux-là. Aucun n'est obligatoire : un ordinateur peut être prêt sans navigateur.
 *
 * DEUX NOTIONS, À NE PAS CONFONDRE :
 *  - la MARQUE (`MarqueDeNavigateur`) : Chrome, Edge, Brave, Firefox… — ce que la personne voit et coche ;
 *  - le GENRE technique (`GenreDeNavigateur`, `ordinateurs.ts`) : « chrome » quand l'extension a le débogueur (toute la
 *    famille Chromium), « safari » quand elle joue en mode dégradé (`compat-safari.js` : Safari, Firefox). L'outil des
 *    agents raisonne par genre, l'écran par marque.
 *
 * UNE MARQUE N'EST COCHABLE QUE SI ELLE EST ÉPROUVÉE sur ce système (`MARQUES[m].eprouve`) : le code d'installation
 * existe pour toute la famille Chromium et pour Firefox, mais une marque jamais installée pour de vrai reste en gris
 * « Bientôt ». Règles PURES, testées dans `server/src/test/navigateurs-de-l-ordinateur.test.ts`.
 */
import type { GenreDeNavigateur, NavigateurDOrdinateur, Ordinateur, SystemeDOrdinateur } from './ordinateurs.js';
import { autorisationsDonnees, programmeEnLigne } from './ordinateurs.js';
import { VERSION_EXTENSION_CHROME, versionAuMoins } from './extension-chrome.js';

export const MARQUES_DE_NAVIGATEUR = ['chrome', 'safari', 'firefox', 'edge', 'brave', 'arc', 'opera', 'vivaldi', 'chromium', 'orion'] as const;
export type MarqueDeNavigateur = (typeof MARQUES_DE_NAVIGATEUR)[number];

export interface FicheDeMarque {
  nom: string;
  /** chromium : la même extension que Chrome (débogueur) ; webkit / gecko : le mode dégradé de `compat-safari.js`. */
  famille: 'chromium' | 'webkit' | 'gecko';
  /** Les systèmes où Beluga Connect a déjà équipé ce navigateur POUR DE VRAI : ailleurs, « Bientôt ». */
  eprouve: readonly SystemeDOrdinateur[];
  /** Les systèmes où le code d'installation existe (relais du Mac, Beluga Connect Windows / Linux). */
  code: readonly SystemeDOrdinateur[];
}

const TOUS: readonly SystemeDOrdinateur[] = ['mac', 'windows', 'linux'];

export const MARQUES: Record<MarqueDeNavigateur, FicheDeMarque> = {
  chrome: { nom: 'Chrome', famille: 'chromium', eprouve: TOUS, code: TOUS },
  safari: { nom: 'Safari', famille: 'webkit', eprouve: ['mac'], code: ['mac'] },
  firefox: { nom: 'Firefox', famille: 'gecko', eprouve: [], code: TOUS },
  edge: { nom: 'Edge', famille: 'chromium', eprouve: [], code: TOUS },
  brave: { nom: 'Brave', famille: 'chromium', eprouve: [], code: TOUS },
  arc: { nom: 'Arc', famille: 'chromium', eprouve: [], code: ['mac'] },
  opera: { nom: 'Opera', famille: 'chromium', eprouve: [], code: TOUS },
  vivaldi: { nom: 'Vivaldi', famille: 'chromium', eprouve: [], code: TOUS },
  chromium: { nom: 'Chromium', famille: 'chromium', eprouve: [], code: TOUS },
  orion: { nom: 'Orion', famille: 'webkit', eprouve: [], code: [] },
};

export function marqueValable(brut: unknown): MarqueDeNavigateur | null {
  return MARQUES_DE_NAVIGATEUR.includes(brut as MarqueDeNavigateur) ? (brut as MarqueDeNavigateur) : null;
}

/** Le genre technique d'une marque : débogueur (famille Chromium) ou mode dégradé (Safari, Firefox). */
export function genreDeLaMarque(m: MarqueDeNavigateur): GenreDeNavigateur {
  return MARQUES[m].famille === 'chromium' ? 'chrome' : 'safari';
}

/** La marque d'un navigateur relié : celle qu'il a annoncée, sinon celle de son genre (extensions d'avant 1.0.17). */
export function marqueDuNavigateur(n: Pick<NavigateurDOrdinateur, 'genre'> & { marque?: MarqueDeNavigateur | null }): MarqueDeNavigateur {
  return n.marque ?? (n.genre === 'safari' ? 'safari' : 'chrome');
}

/** Beluga sait-il équiper ce navigateur sur ce système (code écrit ET éprouvé) ? */
export function marqueEquipable(m: MarqueDeNavigateur, systeme: SystemeDOrdinateur | null | undefined): boolean {
  return MARQUES[m].eprouve.includes(systeme ?? 'mac');
}

/* ------------------------------------------------------------------ */
/* Ce que Beluga Connect a trouvé sur l'ordinateur                      */
/* ------------------------------------------------------------------ */

export interface NavigateurInstalle {
  marque: MarqueDeNavigateur;
  version: string | null;
  /** Le navigateur par défaut du système. */
  parDefaut: boolean;
}

/** Le rapport de Beluga Connect, nettoyé : marques connues, sans doublon, version courte. */
export function navigateursInstallesValables(brut: unknown): NavigateurInstalle[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<MarqueDeNavigateur>();
  const sortie: NavigateurInstalle[] = [];
  for (const x of brut) {
    const marque = marqueValable((x as { marque?: unknown })?.marque);
    if (!marque || vus.has(marque)) continue;
    vus.add(marque);
    const v = (x as { version?: unknown }).version;
    sortie.push({
      marque,
      version: typeof v === 'string' && /^[\w.+-]{1,32}$/.test(v) ? v : null,
      parDefaut: (x as { parDefaut?: unknown }).parDefaut === true,
    });
  }
  return sortie.sort((a, b) => MARQUES_DE_NAVIGATEUR.indexOf(a.marque) - MARQUES_DE_NAVIGATEUR.indexOf(b.marque));
}

/** Le choix envoyé par l'écran, nettoyé : marques connues, sans doublon, dans l'ordre de la liste. */
export function choixValable(brut: unknown): MarqueDeNavigateur[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set(brut.map(marqueValable).filter((m): m is MarqueDeNavigateur => !!m));
  return MARQUES_DE_NAVIGATEUR.filter((m) => vus.has(m));
}

/**
 * LA LISTE À COCHER de l'étape « Navigateurs » : les navigateurs détectés, plus ceux déjà reliés (un navigateur relié
 * est forcément installé, même si la détection l'a manqué) et ceux déjà choisis. Sans détection (Beluga Connect d'avant
 * cette carte), les navigateurs du système qu'on sait équiper. Chrome passe en tête, puis l'ordre de `MARQUES`.
 */
export function navigateursAProposer(o: Pick<Ordinateur, 'navigateurs' | 'programme' | 'navigateursChoisis'>): NavigateurInstalle[] {
  const systeme = o.programme?.systeme ?? 'mac';
  const detectes = o.programme?.installes ?? null;
  const parMarque = new Map<MarqueDeNavigateur, NavigateurInstalle>();
  for (const n of detectes ?? []) parMarque.set(n.marque, n);
  if (!detectes) {
    for (const m of MARQUES_DE_NAVIGATEUR) if (marqueEquipable(m, systeme)) parMarque.set(m, { marque: m, version: null, parDefaut: false });
  }
  for (const n of o.navigateurs) {
    const m = marqueDuNavigateur(n);
    if (!parMarque.has(m)) parMarque.set(m, { marque: m, version: null, parDefaut: false });
  }
  for (const m of o.navigateursChoisis ?? []) if (!parMarque.has(m)) parMarque.set(m, { marque: m, version: null, parDefaut: false });
  return MARQUES_DE_NAVIGATEUR.filter((m) => parMarque.has(m)).map((m) => parMarque.get(m)!);
}

/** Les cases cochées d'office : chaque navigateur proposé que Beluga sait équiper (l'automatisme reste le défaut). */
export function choixParDefaut(o: Pick<Ordinateur, 'navigateurs' | 'programme' | 'navigateursChoisis'>): MarqueDeNavigateur[] {
  const systeme = o.programme?.systeme ?? 'mac';
  return navigateursAProposer(o)
    .map((n) => n.marque)
    .filter((m) => marqueEquipable(m, systeme));
}

/**
 * LE CHOIX QUI VAUT POUR UN ORDINATEUR : celui de la personne ; sinon (ordinateur relié avant cette carte) les marques
 * des navigateurs DÉJÀ reliés — un Mac qui a Chrome mais dont Safari n'a jamais pris n'attend plus Safari. `null` : rien
 * de choisi ni de relié, l'étape « Navigateurs » attend la personne et l'automatisme n'équipe rien.
 */
export function choixEffectif(choisis: readonly MarqueDeNavigateur[] | null | undefined, navigateurs: readonly Pick<NavigateurDOrdinateur, 'genre' | 'marque'>[]): MarqueDeNavigateur[] | null {
  if (choisis) return [...choisis];
  const relies = choixValable(navigateurs.map((n) => marqueDuNavigateur(n)));
  return relies.length ? relies : null;
}

/** Le navigateur relié d'une marque sur un ordinateur : celui en ligne d'abord, puis le plus récent. */
export function navigateurDeLaMarque(o: Pick<Ordinateur, 'navigateurs'> | null | undefined, m: MarqueDeNavigateur): NavigateurDOrdinateur | null {
  return (
    o?.navigateurs
      .filter((n) => marqueDuNavigateur(n) === m)
      .sort((a, b) => Number(b.enLigne) - Number(a.enLigne) || (b.vuLe ?? 0) - (a.vuLe ?? 0))[0] ?? null
  );
}

/**
 * UN NAVIGATEUR CHOISI EST-IL PRÊT ? Relié et en ligne ; pour la famille Chromium, extension à jour, et sur un Mac
 * autorisée en navigation privée (Beluga Connect la vérifie).
 */
export function navigateurPret(o: Pick<Ordinateur, 'navigateurs' | 'programme'>, m: MarqueDeNavigateur): boolean {
  const n = navigateurDeLaMarque(o, m);
  if (!n?.enLigne) return false;
  if (MARQUES[m].famille !== 'chromium') return true;
  const mac = (o.programme?.systeme ?? 'mac') === 'mac';
  return versionAuMoins(n.version, VERSION_EXTENSION_CHROME) && (!mac || n.incognito === true);
}

/**
 * L'ORDINATEUR A-T-IL TOUT CE QU'IL FAUT ? Beluga Connect en marche et relié, autorisations données (Mac), un choix de
 * navigateurs fait (même vide : « Continuer sans navigateur »), et chaque navigateur CHOISI prêt. Aucun n'est obligatoire.
 */
export function ordinateurPret(o: Ordinateur | null | undefined): boolean {
  if (!o) return false;
  const p = o.programme;
  if (!programmeEnLigne(p) || !p?.connect || !autorisationsDonnees(p)) return false;
  const choix = choixEffectif(o.navigateursChoisis, o.navigateurs);
  return !!choix && choix.every((m) => navigateurPret(o, m));
}

/** Le texte de fin du parcours : les navigateurs retenus, nommés (« Chrome et Safari »), ou « sans navigateur ». */
export function navigateursNommes(marques: readonly MarqueDeNavigateur[], et: string): string {
  const noms = marques.map((m) => MARQUES[m].nom);
  if (noms.length <= 1) return noms[0] ?? '';
  return `${noms.slice(0, -1).join(', ')} ${et} ${noms[noms.length - 1]}`;
}
