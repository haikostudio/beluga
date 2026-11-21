/**
 * UNE FOURNÉE D'EXEMPLES = UN SEUL CHOIX, ET UNE MAQUETTE PART DE L'ÉCRAN RÉEL (carte « Extension, rapport SEO-GEO et
 * menus », 21/11/2026). Constat : un cadrage à plusieurs travaux avait fabriqué d'un coup quatre maquettes de trois
 * sujets (volet SEO-GEO, un point du volet, fenêtre de Beluga Connect, aide aux Réglages) ; la règle « chaque exemple
 * fabriqué devient un choix » (`verdictDuLot`, DEC-482) les a toutes mises dans UNE question — « tout mélangé ».
 * Et les maquettes redessinées à la main restaient « beaucoup trop brouillon ».
 *
 * Règles pures, sans disque ni navigateur :
 *  - `refusDeFourneeMelangee` : les pistes d'un même appel montrent la MÊME zone (« zone » de chaque piste) ; deux
 *    zones différentes → refus, à refaire en un appel par travail. Une série du même endroit reste permise.
 *  - `releveLu` : le relevé de l'écran réel demandé par une piste (« depuis ») — adresse interne de l'application,
 *    zone à garder, retouches à poser — validé et borné.
 *  - `avecLesIconesReelles` : `<svg data-lucide="nom"></svg>` remplacé par la vraie icône (tracés fournis).
 */

export interface PisteAvecZone {
  titre: string;
  zone?: string | null;
}

function zoneNormalisee(z: string): string {
  return z
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Le refus d'une fournée qui mélange plusieurs zones de l'écran ; `null` : la fournée est d'un seul tenant. */
export function refusDeFourneeMelangee(pistes: readonly PisteAvecZone[]): string | null {
  const zones = new Map<string, string>();
  for (const p of pistes) {
    const z = (p.zone ?? '').trim();
    if (z) zones.set(zoneNormalisee(z), z);
  }
  if (zones.size <= 1) return null;
  return [
    `Fournée refusée : ces pistes montrent ${zones.size} endroits différents (${[...zones.values()].map((z) => `« ${z} »`).join(', ')}).`,
    'UNE FOURNÉE = UN SEUL CHOIX : toutes les pistes d’un appel montrent la MÊME zone, pour le même travail — sinon la question qui suit mélange des sujets.',
    'Plusieurs travaux ? Traite-les UN PAR UN : un appel « exemple_de_choix » pour le premier, sa question (ask_user), sa réponse, puis le suivant.',
  ].join('\n');
}

/** Une retouche posée sur l'écran figé : le contenu de `selecteur` est remplacé par `html`. */
export interface RetoucheDeReleve {
  selecteur: string;
  html: string;
}

/** Le relevé de l'écran réel demandé par une piste. */
export interface ReleveDemande {
  /** L'adresse interne de l'application, après « # » (« marketing2/<dossier> »). */
  adresse: string;
  /** La zone attendue puis photographiée seule (sélecteur CSS) ; absente : tout l'écran. */
  selecteur: string | null;
  /** Le sélecteur dont l'apparition dit que l'écran est prêt (défaut : `selecteur`, sinon `[data-zone]`). */
  attendre: string;
  theme: 'sombre' | 'clair';
  largeur: number;
  hauteur: number;
  remplacer: RetoucheDeReleve[];
}

const SELECTEUR_SUR = /^[^<>{}`]{1,300}$/;
const HTML_MAX = 60_000;
const RETOUCHES_MAX = 12;

/** Le relevé lu ; `{ refus }` quand il ne tient pas — le texte dit quoi corriger. */
export function releveLu(brut: unknown): ReleveDemande | { refus: string } {
  const b = (brut ?? {}) as Record<string, unknown>;
  const adresse = String(b.adresse ?? '')
    .trim()
    .replace(/^#/, '');
  if (!adresse || /^[a-z]+:|\/\//i.test(adresse) || adresse.length > 400) {
    return { refus: '« depuis.adresse » : l’adresse INTERNE de l’écran, ce qui suit « # » (« marketing2/<dossier> », « projet/<id> ») — jamais un site extérieur.' };
  }
  const selecteur = typeof b.selecteur === 'string' && b.selecteur.trim() ? b.selecteur.trim() : null;
  if (selecteur && !SELECTEUR_SUR.test(selecteur)) return { refus: '« depuis.selecteur » : un sélecteur CSS simple (« [data-m2-volet-dossier] »).' };
  const attendreBrut = typeof b.attendre === 'string' && b.attendre.trim() ? b.attendre.trim() : null;
  if (attendreBrut && !SELECTEUR_SUR.test(attendreBrut)) return { refus: '« depuis.attendre » : un sélecteur CSS simple.' };
  const borne = (v: unknown, min: number, max: number, defaut: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(Math.min(max, Math.max(min, n))) : defaut;
  };
  const remplacer: RetoucheDeReleve[] = [];
  const liste = Array.isArray(b.remplacer) ? b.remplacer : [];
  if (liste.length > RETOUCHES_MAX) return { refus: `« depuis.remplacer » : ${RETOUCHES_MAX} retouches au plus — ne change que ce qui change.` };
  let total = 0;
  for (const r of liste as Record<string, unknown>[]) {
    const s = String(r?.selecteur ?? '').trim();
    const h = String(r?.html ?? '');
    if (!s || !SELECTEUR_SUR.test(s)) return { refus: 'Chaque retouche de « depuis.remplacer » porte « selecteur » (CSS simple) et « html ».' };
    total += h.length;
    remplacer.push({ selecteur: s, html: h });
  }
  if (total > HTML_MAX) return { refus: `« depuis.remplacer » : ${HTML_MAX} signes de HTML au plus — ne remplace que la zone qui change.` };
  return {
    adresse,
    selecteur,
    attendre: attendreBrut ?? selecteur ?? '[data-zone]',
    theme: b.theme === 'clair' ? 'clair' : 'sombre',
    largeur: borne(b.largeur, 360, 1920, 1440),
    hauteur: borne(b.hauteur, 480, 1400, 900),
    remplacer,
  };
}

/** Un tracé d'icône Lucide : `[balise, attributs]`, tel que `createLucideIcon` le reçoit. */
export type TraceDIcone = readonly (readonly [string, Record<string, string | number>])[];

function echapperAttribut(v: string | number): string {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Les icônes posées par nom (`<svg data-lucide="search" class="h-4 w-4"></svg>`) deviennent la vraie icône du
 * produit : mêmes tracés, trait 1,6, bouts arrondis. Une icône inconnue reste telle quelle (et se voit vide).
 */
export function avecLesIconesReelles(html: string, traceDe: (nom: string) => TraceDIcone | null): string {
  return html.replace(/<svg\b([^>]*)\bdata-lucide="([a-z0-9-]+)"([^>]*)>\s*<\/svg>/gi, (tout, avant: string, nom: string, apres: string) => {
    const trace = traceDe(nom);
    if (!trace) return tout;
    const enfants = trace.map(([balise, attrs]) => `<${balise} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${echapperAttribut(v)}"`).join(' ')}/>`).join('');
    return `<svg${avant}data-lucide="${nom}"${apres} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${enfants}</svg>`;
  });
}

/** Joué DANS la page (texte : le démon n'a pas les types du navigateur) : figer, masquer, retoucher. */
export const SCRIPT_DU_RELEVE = `({ theme, retouches }) => {
  const racine = document.getElementById('root');
  if (racine) racine.replaceWith(racine.cloneNode(true));
  const html = document.documentElement;
  html.classList.toggle('dark', theme === 'sombre');
  html.dataset.theme = theme;
  html.style.colorScheme = theme === 'sombre' ? 'dark' : 'light';
  for (const el of document.querySelectorAll('[data-rond-seul], [data-au-dessus-de-tout], [data-bande-sous-l-heure], [data-banniere-extension]')) el.style.display = 'none';
  const absents = [];
  for (const x of retouches) {
    const el = document.querySelector(x.selecteur);
    if (el) el.outerHTML = x.html;
    else absents.push(x.selecteur);
  }
  return absents;
}`;

