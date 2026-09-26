/**
 * LES PIÈCES JOINTES VOLUMINEUSES : VIDÉOS ET FICHIERS JUSQU'À 2 GO.
 *
 * Deux règles pures, partagées par le démon et l'écran :
 *
 * - le PLAFOND d'un envoi (2 Gio) se juge AVANT de lire le corps, sur la
 *   taille annoncée, puis à nouveau au fil de la lecture — un envoi qui ment sur
 *   sa taille est coupé dès qu'il dépasse ;
 * - une LECTURE PARTIELLE (`Range: bytes=…`) se découpe ici : c'est elle qui
 *   permet au lecteur vidéo de se déplacer dans un fichier de 2 Go sans le
 *   télécharger en entier.
 *
 * Le genre d'une pièce (image, vidéo, fichier) se lit avec `genreDuFichier`
 * (`shared/src/espace-client.ts`).
 */

/** 2 Gio : le plus gros fichier accepté dans une conversation. */
export const TAILLE_MAX_PIECE_JOINTE = 2 * 1024 * 1024 * 1024;

export type JugementTaille = { ok: true } | { ok: false; raison: string };

/** Taille lisible par un humain : « 1,4 Go », « 820 Mo », « 12 Ko ». */
export function tailleLisible(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return '?';
  const unites = ['o', 'Ko', 'Mo', 'Go'];
  let valeur = octets;
  let i = 0;
  while (valeur >= 1024 && i < unites.length - 1) {
    valeur /= 1024;
    i += 1;
  }
  const arrondi = i === 0 || valeur >= 100 ? Math.round(valeur).toString() : valeur.toFixed(1).replace('.', ',');
  return `${arrondi.replace(/,0$/, '')} ${unites[i]}`;
}

/**
 * Juge une taille (annoncée par l'entête ou mesurée par l'écran avant
 * l'envoi). Une taille inconnue passe : c'est la lecture au fil de l'eau qui
 * coupera si elle dépasse.
 */
export function jugerTaillePieceJointe(octets: number | undefined, max = TAILLE_MAX_PIECE_JOINTE): JugementTaille {
  if (octets === undefined || !Number.isFinite(octets)) return { ok: true };
  if (octets > max) {
    return {
      ok: false,
      raison: `Fichier trop volumineux (${tailleLisible(octets)}) : la limite est de ${tailleLisible(max)}.`,
    };
  }
  return { ok: true };
}

/** Lit l'entête `content-length` : un nombre entier positif, sinon rien. */
export function tailleAnnoncee(entete: string | string[] | undefined): number | undefined {
  const brut = Array.isArray(entete) ? entete[0] : entete;
  if (brut === undefined || !/^\d+$/.test(brut.trim())) return undefined;
  return Number(brut.trim());
}

export type Plage =
  | { genre: 'entier' }
  | { genre: 'partiel'; debut: number; fin: number }
  | { genre: 'impossible' };

/**
 * Découpe une demande de lecture partielle (`Range: bytes=debut-fin`).
 *
 * - pas d'entête, ou une unité inconnue, ou plusieurs plages → le fichier
 *   ENTIER (un serveur a le droit d'ignorer ce qu'il ne sait pas servir) ;
 * - `bytes=500-` → de 500 à la fin ; `bytes=-500` → les 500 derniers octets ;
 * - une plage qui commence au-delà de la fin → « impossible » (réponse 416).
 *
 * `fin` est INCLUSE, comme dans l'entête `Content-Range`.
 */
export function plageDemandee(entete: string | undefined, taille: number): Plage {
  if (!entete) return { genre: 'entier' };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(entete);
  if (!m) return { genre: 'entier' };
  const [, a, b] = m;
  if (a === '' && b === '') return { genre: 'entier' };
  if (taille <= 0) return { genre: 'impossible' };
  if (a === '') {
    const suffixe = Number(b);
    if (suffixe === 0) return { genre: 'impossible' };
    return { genre: 'partiel', debut: Math.max(0, taille - suffixe), fin: taille - 1 };
  }
  const debut = Number(a);
  if (debut >= taille) return { genre: 'impossible' };
  const fin = b === '' ? taille - 1 : Math.min(Number(b), taille - 1);
  if (fin < debut) return { genre: 'impossible' };
  return { genre: 'partiel', debut, fin };
}
