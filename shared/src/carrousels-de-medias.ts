
/* ------------------------------------------------------------------ */
/* Les liens publication ↔ pièce, réparés                               */
/* ------------------------------------------------------------------ */

/** Un lien « cette pièce illustre cette publication », avec son instant (il fait l'ordre du carrousel). */
export interface LienDePost {
  contenu: string;
  piece: string;
  creeLe: number;
}

/** Ce qu'il faut savoir d'une pièce de média pour réparer ses liens. */
export interface PieceAReparer {
  piece: string;
  projet: string;
  /** Le nom lisible (« Instagram Post 5 — Ça existe, carrousel 2 sur 4 »). */
  nom: string;
  /** `cleDesVersions` : deux pièces de même clé sont deux versions d'un même média. */
  versions: string;
  version: number | null;
  creeLe: number;
}

/** « …, carrousel 2 sur 4 » : le sujet commun, la place et le total. */
const PLACE_DANS_UN_CARROUSEL = /^(.*?)[\s,·—–-]*carrousel\s+(\d+)\s+sur\s+(\d+)\s*$/i;

export function placeDansUnCarrousel(nom: string): { sujet: string; rang: number; total: number } | null {
  const m = PLACE_DANS_UN_CARROUSEL.exec(nom.trim());
  if (!m) return null;
  const rang = Number(m[2]);
  const total = Number(m[3]);
  if (!rang || !total || rang > total) return null;
  return { sujet: m[1]!.trim().toLowerCase(), rang, total };
}

/**
 * LES LIENS D'UNE PUBLICATION, RÉPARÉS (carte du 04/11/2026, « Fiche campagne et médias réorganisés ») — deux défauts
 * vus sur Wogo, réparés à chaque lecture des médias (idempotent : la seconde fois, rien à faire) :
 *   - UNE VERSION REMPLACE L'AUTRE : deux versions d'un même média liées à la même publication (le post 6 portait sa
 *     v1 ET sa v2) → seule la plus récente reste, à la place de la plus ancienne dans l'ordre du carrousel ;
 *   - UN CARROUSEL EST ENTIER : les images « …, carrousel k sur N » d'un même sujet, quand UNE seule publication en
 *     porte et que les autres ne servent nulle part (le post 5 n'avait que sa première image) → elles la rejoignent,
 *     rangées 1 → N. Plusieurs publications candidates : on ne devine pas, rien ne bouge.
 * Rend les liens à retirer, puis ceux à poser (ou à reposer avec un autre instant).
 */
export function reparationsDesLiens(liens: readonly LienDePost[], pieces: readonly PieceAReparer[]): { retirer: { contenu: string; piece: string }[]; poser: LienDePost[] } {
  const parPiece = new Map(pieces.map((p) => [p.piece, p]));
  const retirer: { contenu: string; piece: string }[] = [];
  const poser: LienDePost[] = [];
  const restants: LienDePost[] = [];
  /* 1. Une version remplace l'autre, publication par publication. */
  const parContenu = new Map<string, LienDePost[]>();
  for (const l of liens) parContenu.set(l.contenu, [...(parContenu.get(l.contenu) ?? []), l]);
  for (const [contenu, siens] of parContenu) {
    const parVersions = new Map<string, LienDePost[]>();
    for (const l of siens) {
      const cle = parPiece.get(l.piece)?.versions;
      if (!cle) {
        restants.push(l);
        continue;
      }
      parVersions.set(cle, [...(parVersions.get(cle) ?? []), l]);
    }
    for (const groupe of parVersions.values()) {
      if (groupe.length < 2) {
        restants.push(...groupe);
        continue;
      }
      const recente = (l: LienDePost) => parPiece.get(l.piece)!;
      const gardee = groupe.reduce((a, b) => {
        const pa = recente(a);
        const pb = recente(b);
        return (pb.version ?? 0) > (pa.version ?? 0) || ((pb.version ?? 0) === (pa.version ?? 0) && pb.creeLe > pa.creeLe) ? b : a;
      });
      const place = Math.min(...groupe.map((l) => l.creeLe));
      for (const l of groupe) if (l !== gardee) retirer.push({ contenu, piece: l.piece });
      if (gardee.creeLe !== place) poser.push({ contenu, piece: gardee.piece, creeLe: place });
      restants.push({ ...gardee, creeLe: place });
    }
  }
  /* 2. Un carrousel est entier. */
  const liees = new Set(restants.map((l) => l.piece));
  const versionsLiees = new Set(restants.map((l) => parPiece.get(l.piece)?.versions).filter((x): x is string => !!x));
  const carrousels = new Map<string, { piece: PieceAReparer; rang: number }[]>();
  for (const p of pieces) {
    const place = placeDansUnCarrousel(p.nom);
    if (!place) continue;
    const cle = `${p.projet}\n${place.sujet}\n${place.total}`;
    carrousels.set(cle, [...(carrousels.get(cle) ?? []), { piece: p, rang: place.rang }]);
  }
  for (const membres of carrousels.values()) {
    const ancres = restants.filter((l) => membres.some((m) => m.piece.piece === l.piece));
    const contenus = [...new Set(ancres.map((l) => l.contenu))];
    if (contenus.length !== 1) continue;
    const contenu = contenus[0]!;
    const rangDe = (piece: string) => membres.find((m) => m.piece.piece === piece)!.rang;
    const ancre = ancres.filter((l) => l.contenu === contenu).reduce((a, b) => (rangDe(b.piece) < rangDe(a.piece) ? b : a));
    /* La plus récente version de chaque place, si aucune version de ce média n'est déjà liée ailleurs. */
    const parRang = new Map<number, PieceAReparer>();
    for (const m of membres) {
      const deja = parRang.get(m.rang);
      if (!deja || (m.piece.version ?? 0) > (deja.version ?? 0) || ((m.piece.version ?? 0) === (deja.version ?? 0) && m.piece.creeLe > deja.creeLe)) parRang.set(m.rang, m.piece);
    }
    for (const [rang, p] of parRang) {
      if (liees.has(p.piece) || versionsLiees.has(p.versions)) continue;
      poser.push({ contenu, piece: p.piece, creeLe: ancre.creeLe + (rang - rangDe(ancre.piece)) });
      liees.add(p.piece);
      versionsLiees.add(p.versions);
    }
  }
  return { retirer, poser };
}
