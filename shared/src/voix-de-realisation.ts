/**
 * LES VOIX ET LES MOTS DU DIRECTEUR ARTISTIQUE — sortis du Studio (retiré le
 * 26/10/2026) pour servir aux vidéos que le directeur fabrique sur le serveur.
 *
 *  - VOIX D'ESSAI : Piper, sur le serveur, gratuite (« Claire » par défaut) ;
 *    elle accompagne les images clés de l'arrêt 2, dont l'accord vaut
 *    validation des textes ;
 *  - VOIX FINALES : vingt voix préenregistrées de Gemini, fabriquées PAR
 *    OPENROUTER seulement, après accord sur le prix (MEM-4350). `VOIX_GEMINI`
 *    (quatre voix) reste la voix de lecture de l'application ;
 *  - MOTS HORODATÉS : la reconnaissance (faster-whisper) ne donne que les
 *    TEMPS ; l'affichage garde le texte connu (`alignerMots`).
 *
 * Tout ce qui se décide sans réseau ni disque vit ici, avec son test.
 */

/** La voix d'essai par défaut : Piper, voix « Claire ». */
export const VOIX_ESSAI_PAR_DEFAUT = 'fr_FR-siwis-medium';

/** Les voix d'essai Piper et leur prénom affiché, dans l'ordre de présentation. */
export const VOIX_D_ESSAI: Readonly<Record<string, string>> = {
  'fr_FR-siwis-medium': 'Claire',
  'fr_FR-tom-medium': 'Thomas',
  'fr_FR-upmc-medium@pierre': 'Pierre',
  'fr_FR-upmc-medium@jessica': 'Jessica',
};

export const TIMBRES_VOIX = ['ferme', 'legere', 'lumineuse', 'jeune', 'detendue', 'vive', 'douce', 'nette', 'chaleureuse', 'enjouee', 'posee', 'energique', 'claire', 'veloutee', 'grave', 'amicale', 'experte', 'mure'] as const;
export type TimbreVoix = (typeof TIMBRES_VOIX)[number];

/**
 * LES VINGT VOIX FINALES — des voix préenregistrées de Gemini, dix de femme et
 * dix d'homme, chacune avec son timbre (le qualificatif publié par Google).
 */
export const VOIX_FINALES: readonly { id: string; genre: 'femme' | 'homme'; timbre: TimbreVoix }[] = [
  { id: 'Kore', genre: 'femme', timbre: 'ferme' },
  { id: 'Aoede', genre: 'femme', timbre: 'legere' },
  { id: 'Zephyr', genre: 'femme', timbre: 'lumineuse' },
  { id: 'Leda', genre: 'femme', timbre: 'jeune' },
  { id: 'Callirrhoe', genre: 'femme', timbre: 'detendue' },
  { id: 'Autonoe', genre: 'femme', timbre: 'vive' },
  { id: 'Despina', genre: 'femme', timbre: 'veloutee' },
  { id: 'Erinome', genre: 'femme', timbre: 'nette' },
  { id: 'Achernar', genre: 'femme', timbre: 'douce' },
  { id: 'Sulafat', genre: 'femme', timbre: 'chaleureuse' },
  { id: 'Puck', genre: 'homme', timbre: 'enjouee' },
  { id: 'Charon', genre: 'homme', timbre: 'posee' },
  { id: 'Fenrir', genre: 'homme', timbre: 'energique' },
  { id: 'Orus', genre: 'homme', timbre: 'ferme' },
  { id: 'Iapetus', genre: 'homme', timbre: 'claire' },
  { id: 'Umbriel', genre: 'homme', timbre: 'detendue' },
  { id: 'Algieba', genre: 'homme', timbre: 'veloutee' },
  { id: 'Algenib', genre: 'homme', timbre: 'grave' },
  { id: 'Achird', genre: 'homme', timbre: 'amicale' },
  { id: 'Sadaltager', genre: 'homme', timbre: 'experte' },
];

export const VOIX_FINALE_PAR_DEFAUT = 'Kore';

/**
 * LES POLICES EMBARQUÉES (licence SIL OFL, fichiers dans
 * `outils/polices-de-composition`), copiées dans chaque composition : celles du
 * poste différeraient entre l'aperçu et le rendu.
 */
export const POLICES_DE_COMPOSITION: readonly { famille: string; fichier: string; genre: string }[] = [
  { famille: 'Inter', fichier: 'inter.woff2', genre: 'sans' },
  { famille: 'Montserrat', fichier: 'montserrat.woff2', genre: 'sans' },
  { famille: 'Space Grotesk', fichier: 'space-grotesk.woff2', genre: 'sans' },
  { famille: 'Playfair Display', fichier: 'playfair-display.woff2', genre: 'serif' },
  { famille: 'Bebas Neue', fichier: 'bebas-neue.woff2', genre: 'titre' },
  { famille: 'Caveat', fichier: 'caveat.woff2', genre: 'manuscrite' },
  { famille: 'JetBrains Mono', fichier: 'jetbrains-mono.woff2', genre: 'mono' },
];

/** La feuille `@font-face` des polices embarquées, chemins relatifs au dossier de la composition. */
export function feuilleDesPolices(dossier = 'polices/'): string {
  return POLICES_DE_COMPOSITION.map((p) => `@font-face { font-family: '${p.famille}'; src: url('${dossier}${p.fichier}') format('woff2'); font-display: block; }`).join('\n');
}

/** Un mot dit, avec ses temps en secondes. */
export interface MotHorodate {
  texte: string;
  debut: number;
  fin: number;
}

function arrondi(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normaliserMot(mot: string): string {
  return mot
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Les mots d'un texte, ponctuation gardée sur le mot (c'est ce qui s'affiche). */
export function motsDitsDuTexte(t: string): string[] {
  return t.split(/\s+/).filter((m) => normaliserMot(m) || /\d/.test(m));
}

/**
 * ALIGNER LE TEXTE CONNU SUR LES MOTS RECONNUS. La reconnaissance se trompe
 * parfois de mot (« voie » pour « voix ») : l'affichage garde le texte écrit,
 * la reconnaissance ne donne que les TEMPS. Alignement par distance d'édition ;
 * un mot connu resté seul prend un temps interpolé entre ses voisins.
 */
export function alignerMots(texteConnu: string, reconnus: MotHorodate[], dureeTotale?: number): MotHorodate[] {
  const connus = motsDitsDuTexte(texteConnu);
  if (!connus.length) return [];
  const a = connus.map(normaliserMot);
  const b = reconnus.map((m) => normaliserMot(m.texte));
  const n = a.length;
  const m = b.length;
  // Coût : 0 si égaux, 1 si proches (même début), 2 sinon ; insertion/suppression 1.
  const cout = (i: number, j: number) => (a[i] === b[j] ? 0 : a[i]!.slice(0, 3) === b[j]!.slice(0, 3) && a[i]!.length > 2 ? 1 : 2);
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cout(i - 1, j - 1));
    }
  }
  const lien: (number | null)[] = Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (d[i]![j] === d[i - 1]![j - 1]! + cout(i - 1, j - 1) && cout(i - 1, j - 1) < 2) {
      lien[i - 1] = j - 1;
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else if (d[i]![j] === d[i]![j - 1]! + 1) j--;
    else {
      // Substitution franche : on lie quand même, la position compte plus que le mot.
      lien[i - 1] = j - 1;
      i--;
      j--;
    }
  }
  const fin = dureeTotale ?? (reconnus.length ? reconnus[reconnus.length - 1]!.fin : connus.length * 0.35);
  const sortie: MotHorodate[] = connus.map((texte, k) => {
    const r = lien[k] !== null ? reconnus[lien[k]!] : undefined;
    return { texte, debut: r ? r.debut : NaN, fin: r ? r.fin : NaN };
  });
  // Les mots restés seuls : temps interpolés entre les voisins connus.
  for (let k = 0; k < sortie.length; k++) {
    if (!Number.isNaN(sortie[k]!.debut)) continue;
    let g = k - 1;
    while (g >= 0 && Number.isNaN(sortie[g]!.debut)) g--;
    let h = k + 1;
    while (h < sortie.length && Number.isNaN(sortie[h]!.debut)) h++;
    const depuis = g >= 0 ? sortie[g]!.fin : 0;
    const jusqua = h < sortie.length ? sortie[h]!.debut : fin;
    const trou = h - g - 1;
    const pas = Math.max(0, jusqua - depuis) / Math.max(1, trou);
    for (let q = g + 1; q < h; q++) {
      const rang = q - g - 1;
      sortie[q] = { texte: sortie[q]!.texte, debut: arrondi(depuis + rang * pas), fin: arrondi(depuis + (rang + 1) * pas) };
    }
    k = h - 1;
  }
  return sortie.map((mot) => ({ texte: mot.texte, debut: arrondi(mot.debut), fin: arrondi(Math.max(mot.debut, mot.fin)) }));
}

/** Sans reconnaissance des mots : des temps répartis au prorata de la longueur des mots. */
export function motsRepartis(texteConnu: string, duree: number): MotHorodate[] {
  const connus = motsDitsDuTexte(texteConnu);
  const poids = connus.map((m) => Math.max(2, m.length));
  const total = poids.reduce((x, y) => x + y, 0) || 1;
  let t = 0;
  return connus.map((texte, k) => {
    const d = (duree * poids[k]!) / total;
    const mot = { texte, debut: arrondi(t), fin: arrondi(t + d) };
    t += d;
    return mot;
  });
}
