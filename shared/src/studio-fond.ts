/**
 * RECONNAÎTRE ET RETIRER UN FOND UNI, en règles pures sur des pixels RGBA (décisions de l'utilisateur du
 * 02/11/2026 : retrait d'office à la génération et à l'import, ou depuis le menu, sans agent).
 *
 * Le contrôle lit TOUT LE TOUR de l'image, pas ses seuls coins : un fond qui a de vrais coins unis mais un décor
 * sur un côté n'est pas un fond uni. Un sujet coupé par un bord (un buste en bas du cadre) reste admis : trois
 * côtés sur quatre doivent être nets. Le mode `exigeant` (retrait automatique, jamais demandé) écarte en plus une
 * capture d'écran ou un document (beaucoup de morceaux) et un cadre plein posé sur un fond (un grand rectangle) :
 * dans le doute, le média reste entier, sans rien dire.
 */

export type LectureDuFond = { etat: 'uni'; couleur: string } | { etat: 'transparent' } | { etat: 'non-uni'; raison: string };

/** Écart toléré autour de la couleur du fond, sur 255, canal le plus éloigné : la compression d'une image y tient. */
const TOLERANCE_DU_TOUR = 30;
const CONFORMITE_D_UN_COTE = 0.92;
const CONFORMITE_DU_COTE_COUPE = 0.1;
const PART_MIN_DU_SUJET = 0.03;
const PART_MAX_DU_SUJET = 0.97;
/** Au-delà, ce sont des lignes de texte ou une interface, pas un sujet détouré. */
const MORCEAUX_MAX = 25;
/** La part couverte de sa boîte au-delà de laquelle le plus grand morceau est un rectangle plein. */
const RECTANGLE_PLEIN = 0.97;
const AIRE_MIN_DU_RECTANGLE = 0.3;
/** Le fond retiré : jusqu'ici tout est transparent, puis les bords s'adoucissent jusqu'à SEUIL_BORD. */
const SEUIL_FOND = 34;
const SEUIL_BORD = 95;
/** Une couleur franche (vert, bleu, magenta…) : les trous fermés du sujet qui la portent partent aussi. */
const ECART_D_UNE_COULEUR_FRANCHE = 90;
const SEUIL_D_UN_TROU = 24;

function hexa(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function mediane(valeurs: number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[Math.floor(triees.length / 2)] ?? 0;
}

function ecart(p: ArrayLike<number>, i: number, r: number, g: number, b: number): number {
  return Math.max(Math.abs(p[i]! - r), Math.abs(p[i + 1]! - g), Math.abs(p[i + 2]! - b));
}

/** Une couleur franche se reconnaît à l'écart entre ses canaux : le blanc, le noir et les gris n'en ont pas. */
export function couleurFranche(couleur: string): boolean {
  const canaux = [1, 3, 5].map((k) => parseInt(couleur.slice(k, k + 2), 16));
  return Math.max(...canaux) - Math.min(...canaux) >= ECART_D_UNE_COULEUR_FRANCHE;
}

/** Les morceaux du sujet (pixels éloignés du fond), et la forme du plus grand. */
function morceauxDuSujet(sujet: Uint8Array, l: number, h: number): { nombre: number; rectanglePlein: boolean } {
  const vus = new Uint8Array(l * h);
  const pile = new Int32Array(l * h);
  let nombre = 0;
  let meilleur = { aire: 0, boite: 1 };
  for (let depart = 0; depart < l * h; depart++) {
    if (!sujet[depart] || vus[depart]) continue;
    let haut = 0;
    let aire = 0;
    let [xMin, xMax, yMin, yMax] = [l, 0, h, 0];
    pile[haut++] = depart;
    vus[depart] = 1;
    while (haut) {
      const i = pile[--haut]!;
      aire++;
      const x = i % l;
      const y = (i - x) / l;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
      for (const v of [x > 0 ? i - 1 : -1, x < l - 1 ? i + 1 : -1, y > 0 ? i - l : -1, y < h - 1 ? i + l : -1]) {
        if (v >= 0 && sujet[v] && !vus[v]) {
          vus[v] = 1;
          pile[haut++] = v;
        }
      }
    }
    /* Un point isolé est du bruit de compression, pas un morceau. */
    if (aire >= 4) nombre++;
    if (aire > meilleur.aire) meilleur = { aire, boite: (xMax - xMin + 1) * (yMax - yMin + 1) };
  }
  return { nombre, rectanglePlein: meilleur.aire / meilleur.boite >= RECTANGLE_PLEIN && meilleur.boite / (l * h) >= AIRE_MIN_DU_RECTANGLE };
}

/** LE FOND D'UNE IMAGE réduite, lue en RGBA. */
export function lireLeFond(p: ArrayLike<number>, l: number, h: number, options: { exigeant?: boolean } = {}): LectureDuFond {
  if (l < 4 || h < 4) return { etat: 'non-uni', raison: 'image trop petite' };
  const cotes: number[][] = [[], [], [], []];
  for (let x = 0; x < l; x++) {
    cotes[0]!.push(x * 4);
    cotes[1]!.push((x + (h - 1) * l) * 4);
  }
  for (let y = 0; y < h; y++) {
    cotes[2]!.push(y * l * 4);
    cotes[3]!.push((l - 1 + y * l) * 4);
  }
  const tour = cotes.flat();
  if (tour.filter((i) => p[i + 3]! < 128).length / tour.length >= 0.3) return { etat: 'transparent' };
  const [r, g, b] = [0, 1, 2].map((k) => mediane(tour.map((i) => p[i + k]!))) as [number, number, number];
  const conformites = cotes.map((c) => c.filter((i) => ecart(p, i, r, g, b) <= TOLERANCE_DU_TOUR).length / c.length).sort((x, y) => y - x);
  if (conformites[2]! < CONFORMITE_D_UN_COTE || conformites[3]! < CONFORMITE_DU_COTE_COUPE) return { etat: 'non-uni', raison: 'le tour de l’image n’a pas une seule couleur' };
  const sujet = new Uint8Array(l * h);
  let aire = 0;
  for (let k = 0; k < l * h; k++) {
    if (ecart(p, k * 4, r, g, b) > TOLERANCE_DU_TOUR) {
      sujet[k] = 1;
      aire++;
    }
  }
  const part = aire / (l * h);
  if (part < PART_MIN_DU_SUJET || part > PART_MAX_DU_SUJET) return { etat: 'non-uni', raison: 'aucun sujet ne se détache du fond' };
  if (options.exigeant) {
    const { nombre, rectanglePlein } = morceauxDuSujet(sujet, l, h);
    if (nombre > MORCEAUX_MAX) return { etat: 'non-uni', raison: 'ressemble à une capture ou à un document' };
    if (rectanglePlein) return { etat: 'non-uni', raison: 'ressemble à un cadre plein posé sur un fond' };
  }
  return { etat: 'uni', couleur: hexa(r, g, b) };
}

/**
 * RETIRER LE FOND EN TOUTE RÉSOLUTION, sur place : seule la couleur RELIÉE AU BORD part, donc un sujet qui porte la
 * même couleur (le blanc des yeux, une chemise blanche sur un fond blanc) reste entier. Une couleur franche fait
 * exception : les trous fermés qui la portent (entre un bras et le corps, sur un fond vert) partent aussi. Les
 * premiers pixels après le fond s'adoucissent et perdent ce qu'ils portaient de sa couleur.
 */
export function retirerLeFondRelie(p: Uint8Array, l: number, h: number, couleur: string): void {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(couleur.slice(k, k + 2), 16)) as [number, number, number];
  const total = l * h;
  const fond = new Uint8Array(total);
  const pile = new Int32Array(total);
  let haut = 0;
  const semer = (k: number) => {
    if (!fond[k] && ecart(p, k * 4, r, g, b) <= SEUIL_FOND) {
      fond[k] = 1;
      pile[haut++] = k;
    }
  };
  for (let x = 0; x < l; x++) {
    semer(x);
    semer(x + (h - 1) * l);
  }
  for (let y = 0; y < h; y++) {
    semer(y * l);
    semer(l - 1 + y * l);
  }
  if (couleurFranche(couleur)) {
    for (let k = 0; k < total; k++) if (!fond[k] && ecart(p, k * 4, r, g, b) <= SEUIL_D_UN_TROU) semer(k);
  }
  while (haut) {
    const k = pile[--haut]!;
    const x = k % l;
    if (x > 0) semer(k - 1);
    if (x < l - 1) semer(k + 1);
    if (k >= l) semer(k - l);
    if (k < total - l) semer(k + l);
  }
  /* LE BORD ADOUCI : quelques rangs de pixels autour du fond, leur transparence selon leur écart à sa couleur. */
  const rangs = 2 + Math.floor(Math.max(l, h) / 1500);
  let front: number[] = [];
  for (let k = 0; k < total; k++) {
    if (!fond[k]) continue;
    const x = k % l;
    if ((x > 0 && !fond[k - 1]) || (x < l - 1 && !fond[k + 1]) || (k >= l && !fond[k - l]) || (k < total - l && !fond[k + l])) front.push(k);
  }
  const touche = new Uint8Array(total);
  for (let rang = 0; rang < rangs && front.length; rang++) {
    const suivant: number[] = [];
    for (const k of front) {
      const x = k % l;
      for (const v of [x > 0 ? k - 1 : -1, x < l - 1 ? k + 1 : -1, k >= l ? k - l : -1, k < total - l ? k + l : -1]) {
        if (v < 0 || fond[v] || touche[v]) continue;
        touche[v] = 1;
        const i = v * 4;
        const d = ecart(p, i, r, g, b);
        if (d >= SEUIL_BORD) continue;
        const a = Math.min(1, Math.max(0, (d - SEUIL_FOND) / (SEUIL_BORD - SEUIL_FOND)));
        if (a > 0) {
          p[i] = Math.max(0, Math.min(255, Math.round((p[i]! - (1 - a) * r) / a)));
          p[i + 1] = Math.max(0, Math.min(255, Math.round((p[i + 1]! - (1 - a) * g) / a)));
          p[i + 2] = Math.max(0, Math.min(255, Math.round((p[i + 2]! - (1 - a) * b) / a)));
        }
        p[i + 3] = Math.round(p[i + 3]! * a);
        suivant.push(v);
      }
    }
    front = suivant;
  }
  for (let k = 0; k < total; k++) {
    if (fond[k]) {
      p[k * 4] = p[k * 4 + 1] = p[k * 4 + 2] = p[k * 4 + 3] = 0;
    }
  }
}
