/**
 * LES IMAGES D'UN TOUR, RASSEMBLÉES EN PIED DE FLUX.
 *
 * Une capture prise par l'agent pendant son travail vivait SOUS SON ÉTAPE, dans
 * un déroulé replié : pour voir ce que l'agent voyait, il fallait déplier le
 * déroulé puis chercher l'étape. Elles se rassemblent désormais en une bande de
 * vignettes au BAS de la réponse, sur une seule ligne qui défile, et la bande
 * grandit en direct à chaque nouvelle image.
 *
 * LA BANDE MONTRE TOUTES LES IMAGES DE L'AGENT : les captures d'étape
 * (`RunStep.capture`, ce qu'il a regardé) ET les pièces image jointes par ses
 * messages (captures rangées par le démon, illustrations qu'il a fabriquées).
 * Les images que l'UTILISATEUR a jointes n'y entrent pas : l'appelant ne passe
 * que les pièces des messages de l'agent. Les copies d'icônes et d'écrans de
 * démarrage qu'une construction d'application a écrites non plus
 * (`pieceVenueDUneConstruction`). (La version précédente, c64446d0,
 * n'acceptait que les captures d'étape : une illustration rangée sans étape
 * disparaissait de la bande.)
 *
 * UNE IMAGE, UNE VIGNETTE. Une capture d'étape rangée en pièce jointe est
 * remplacée par sa pièce — reconnue par le lien posé par le démon
 * (`RunStep.capturePiece`), à défaut par le même nom de fichier. Une pièce a
 * déjà une empreinte unique dans le projet : la même image vue dix fois reste
 * une seule pièce.
 *
 * L'ordre : LA PLUS RÉCENTE D'ABORD (tout à gauche de la bande), d'après le
 * début de l'étape ou la date de la pièce ; à égalité, l'ordre d'arrivée
 * renversé.
 */

import { pieceVenueDUneConstruction } from './images-ecrites.js';

export interface EtapeAvecCapture {
  id: string;
  label: string;
  capture?: string;
  /** La pièce jointe où le démon a rangé cette capture. */
  capturePiece?: string;
  startedAt?: number;
}

export interface JointeDuTour {
  id: string;
  name: string;
  mime: string;
  createdAt?: number;
}

export type CaptureDuFlux =
  | { cle: string; genre: 'etape'; chemin: string; libelle: string }
  | { cle: string; genre: 'jointe'; id: string; libelle: string; chemin?: string };

/** Le dernier morceau d'un chemin, sans dépendre du système de fichiers. */
export function nomDuChemin(chemin: string): string {
  return chemin.split(/[\\/]/).pop() ?? chemin;
}

export function capturesDuFlux(etapes: readonly EtapeAvecCapture[], jointes: readonly JointeDuTour[] = []): CaptureDuFlux[] {
  // Les copies d'icônes d'une construction n'entrent pas dans la bande (décision de l'utilisateur).
  const images = jointes.filter((j) => j.mime.startsWith('image/') && !pieceVenueDUneConstruction(j.name));
  const parId = new Map(images.map((j) => [j.id, j] as const));
  const parNom = new Map<string, JointeDuTour>();
  for (const j of images) parNom.set(j.name, j);

  const placees = new Set<string>();
  const chemins = new Set<string>();
  const rendu: Array<{ capture: CaptureDuFlux; quand: number; rang: number }> = [];
  const poser = (capture: CaptureDuFlux, quand: number | undefined) =>
    rendu.push({ capture, quand: quand ?? 0, rang: rendu.length });

  for (const etape of etapes) {
    const chemin = etape.capture?.trim();
    if (!chemin) continue;
    const piece = (etape.capturePiece ? parId.get(etape.capturePiece) : undefined) ?? parNom.get(nomDuChemin(chemin));
    if (piece) {
      if (placees.has(piece.id)) continue;
      placees.add(piece.id);
      poser({ cle: `jointe:${piece.id}`, genre: 'jointe', id: piece.id, libelle: etape.label, chemin }, etape.startedAt ?? piece.createdAt);
      continue;
    }
    if (chemins.has(chemin)) continue;
    chemins.add(chemin);
    poser({ cle: `etape:${etape.id}`, genre: 'etape', chemin, libelle: etape.label }, etape.startedAt);
  }
  for (const piece of images) {
    if (placees.has(piece.id)) continue;
    placees.add(piece.id);
    poser({ cle: `jointe:${piece.id}`, genre: 'jointe', id: piece.id, libelle: piece.name }, piece.createdAt);
  }
  return rendu.sort((a, b) => b.quand - a.quand || b.rang - a.rang).map((r) => r.capture);
}

/**
 * La vignette qui montre l'image d'un chemin donné (une capture vue dans le
 * fil) : par son chemin exact, à défaut par son nom de fichier.
 */
export function captureDuChemin(captures: readonly CaptureDuFlux[], chemin: string): CaptureDuFlux | undefined {
  const exact = captures.find((c) => c.chemin === chemin);
  if (exact) return exact;
  const nom = nomDuChemin(chemin);
  return captures.find((c) => (c.chemin ? nomDuChemin(c.chemin) === nom : c.genre === 'jointe' && c.libelle === nom));
}
