/**
 * L'ENTRAÎNEMENT DE NUIT DE LAYA — les règles pures, sans modèle ni disque.
 *
 * Chaque nuit entre 3 h et 7 h, Laya est réentraîné sur ce serveur à partir
 * des décisions réelles de Beluga Build (`scripts/laya-nuit.mjs`). Ce fichier
 * porte ce qui se décide sans machine : la fenêtre horaire, la découpe
 * entraînement / examen, et la règle qui dit si une version entraînée
 * REMPLACE celle en service.
 *
 * TROIS RÈGLES QUI NE SE DISCUTENT PAS :
 *
 *  1. L'EXAMEN N'EST JAMAIS VU À L'ENTRAÎNEMENT. La découpe se fait par
 *     GROUPE (la carte d'où vient l'exemple), par une empreinte fixe : un
 *     exemple d'examen le reste d'une nuit à l'autre, et deux exemples tirés
 *     de la même carte tombent du même côté.
 *  2. UNE VERSION NE REMPLACE L'ACTUELLE QUE SI ELLE FAIT MIEUX, et ne recule
 *     nulle part : un gain sur un usage ne paie pas une perte sur un autre.
 *  3. RIEN NE S'ALLUME TOUT SEUL. Un usage reste piloté par sa fiche et ses
 *     interrupteurs (`jugement-rapide.ts`) : la preuve chiffrée décide.
 */

/** La fenêtre de la nuit, en heures locales du serveur : [début, fin). */
export const FENETRE_DE_NUIT = { debut: 3, fin: 7 } as const;

/**
 * LES MARGES DE LA NUIT, en minutes avant la fin de la fenêtre : l'entraînement
 * s'arrête à 6 h 10 pour laisser l'examen et la bascule finir avant 7 h.
 */
export const MARGE_EXAMEN_MIN = 50;

/** Dans la fenêtre de nuit ? */
export function dansLaFenetreDeNuit(date: Date): boolean {
  const h = date.getHours();
  return h >= FENETRE_DE_NUIT.debut && h < FENETRE_DE_NUIT.fin;
}

/** L'instant (ms) où l'entraînement doit rendre la main, pour une nuit commencée à `date`. */
export function finDeLEntrainement(date: Date): number {
  const fin = new Date(date);
  fin.setHours(FENETRE_DE_NUIT.fin, 0, 0, 0);
  if (fin.getTime() <= date.getTime() - 12 * 3600_000) fin.setDate(fin.getDate() + 1);
  return fin.getTime() - MARGE_EXAMEN_MIN * 60_000;
}

/** La date de la nuit (AAAA-MM-JJ), pour ne lancer qu'une nuit par nuit. */
export function jourDeLaNuit(date: Date): string {
  const a = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

/* ------------------------------------------------------------------ */
/* LA DÉCOUPE                                                           */
/* ------------------------------------------------------------------ */

/** La part des groupes réservée à l'examen, en pour cent. */
export const PART_EXAMEN = 20;
/** Le sel de la découpe : le changer redistribue tout, et invalide les examens passés. */
export const SEL_DE_DECOUPE = 'laya-beluga-2026-09';

/** FNV-1a 32 bits : stable partout, sans dépendance. */
function empreinte32(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) h = Math.imul(h ^ texte.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** De quel côté tombe un exemple, d'après son GROUPE (la carte d'origine). */
export function partieDeLExemple(groupe: string): 'entrainement' | 'examen' {
  return empreinte32(`${SEL_DE_DECOUPE}:${groupe}`) % 100 < PART_EXAMEN ? 'examen' : 'entrainement';
}

/* ------------------------------------------------------------------ */
/* LA BASCULE                                                           */
/* ------------------------------------------------------------------ */

/** Le bilan d'examen d'un usage, tel que `scripts/preuve-laya.mjs --json` l'écrit. */
export interface BilanDExamen {
  usage: string;
  source: string;
  genre: 'decision' | 'tri';
  passe: boolean;
  total?: number;
  repondus?: number;
  justes?: number;
  utiles?: number;
  gardesUtiles?: number;
  inutiles?: number;
  ecartesInutiles?: number;
}

/**
 * LA NOTE D'UN USAGE, sur une seule échelle (0 à 1) : pour une décision, la
 * part de cas RÉSOLUS JUSTE (une non-réponse ne compte pas comme juste, un
 * faux compte contre) ; pour un tri, la moyenne de l'utile gardé et de
 * l'inutile écarté.
 */
export function noteDUnBilan(b: BilanDExamen): number {
  if (b.genre === 'tri') {
    const garde = (b.gardesUtiles ?? 0) / Math.max(1, b.utiles ?? 0);
    const ecarte = (b.ecartesInutiles ?? 0) / Math.max(1, b.inutiles ?? 0);
    return (garde + ecarte) / 2;
  }
  return (b.justes ?? 0) / Math.max(1, b.total ?? 0);
}

/** Un recul plus petit que cela est du bruit de mesure, pas une perte. */
export const TOLERANCE_DE_RECUL = 0.02;
/** Un gain plus petit que cela ne vaut pas une bascule. */
export const GAIN_MINIMAL = 0.03;

export interface VerdictDeBascule {
  remplace: boolean;
  raison: string;
  ecarts: { cle: string; avant: number; apres: number }[];
}

/**
 * LA VERSION ENTRAÎNÉE REMPLACE-T-ELLE CELLE EN SERVICE ?
 *
 * Oui seulement si, sur les MÊMES examens : aucun usage ne recule de plus que
 * la tolérance, et au moins un gagne franchement. Un examen absent d'un côté
 * ne se compare pas — mais s'il manque à la candidate, elle est refusée.
 */
export function verdictDeBascule(actuel: readonly BilanDExamen[], candidat: readonly BilanDExamen[]): VerdictDeBascule {
  const cle = (b: BilanDExamen) => `${b.usage} · ${b.source}`;
  const apres = new Map(candidat.map((b) => [cle(b), b]));
  const ecarts: VerdictDeBascule['ecarts'] = [];
  for (const b of actuel) {
    const c = apres.get(cle(b));
    if (!c) return { remplace: false, raison: `examen « ${cle(b)} » absent pour la version entraînée`, ecarts };
    ecarts.push({ cle: cle(b), avant: noteDUnBilan(b), apres: noteDUnBilan(c) });
  }
  if (!ecarts.length) return { remplace: false, raison: 'aucun examen commun', ecarts };
  const recul = ecarts.find((e) => e.apres < e.avant - TOLERANCE_DE_RECUL);
  if (recul) {
    return {
      remplace: false,
      raison: `recul sur « ${recul.cle} » (${Math.round(recul.avant * 100)} % → ${Math.round(recul.apres * 100)} %)`,
      ecarts,
    };
  }
  const gain = ecarts.find((e) => e.apres >= e.avant + GAIN_MINIMAL);
  if (!gain) return { remplace: false, raison: 'aucun gain franc sur aucun examen', ecarts };
  return { remplace: true, raison: `gain sur « ${gain.cle} » sans recul ailleurs`, ecarts };
}

/* ------------------------------------------------------------------ */
/* LE COMPTE RENDU DE LA NUIT                                           */
/* ------------------------------------------------------------------ */

/** Ce que l'écran du juge lit de la dernière nuit (`outils/laya/entrainement/derniere-nuit.json`). */
export interface CompteRenduDeNuit {
  jour: string;
  debut: number;
  fin: number;
  /** Où en est l'entraînement : rien fait, tranche faite, passe complète, interrompu. */
  issue: 'rien' | 'tranche' | 'passe-complete' | 'interrompu' | 'echec';
  /** Pourquoi, en une phrase courte. */
  raison: string;
  exemples?: { entrainement: number; examen: number };
  /** Progression de la passe en cours, de 0 à 1. */
  progression?: number;
  /** La version en service après la nuit, et si elle vient de changer. */
  versionEnService: string;
  bascule?: VerdictDeBascule;
  examen?: BilanDExamen[];
}
