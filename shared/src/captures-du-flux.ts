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
 *
 * CHAQUE IMAGE PORTE SON HEURE (`quand`) : celle qui sert déjà au tri — le
 * moment où l'agent l'a regardée, à défaut la date de sa pièce. La vignette
 * l'affiche, et la visionneuse aussi : une seule source, donc jamais deux
 * heures pour la même image (la date de RANGEMENT d'une pièce, elle, tombe
 * après l'étape).
 *
 * ET UNE IDENTITÉ QUI NE CHANGE PAS. La clé d'une capture d'étape devient celle
 * de sa pièce le jour où le démon la range (`etape:…` → `jointe:…`), souvent
 * en plein tour. Ce qui se retient par image — « déjà vue » — se lit donc sous
 * les DEUX clés (`clesDeVue`), sinon le repère s'éteindrait tout seul.
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
  | { cle: string; genre: 'etape'; chemin: string; libelle: string; /** Quand l'agent l'a regardée (ms) ; 0 = inconnu. */ quand: number }
  | {
      cle: string;
      genre: 'jointe';
      id: string;
      libelle: string;
      chemin?: string;
      /** Quand l'agent l'a regardée, à défaut la date de la pièce (ms) ; 0 = inconnu. */
      quand: number;
      /** La clé que cette image portait AVANT d'être rangée en pièce jointe. */
      cleDOrigine?: string;
    };

/** Le dernier morceau d'un chemin, sans dépendre du système de fichiers. */
export function nomDuChemin(chemin: string): string {
  return chemin.split(/[\\/]/).pop() ?? chemin;
}

/**
 * LES BORNES D'UNE LISTE DE CLÉS envoyée au serveur (lire ou marquer les images
 * vues). Une carte porte couramment des centaines d'images, chacune sous deux
 * clés au plus : l'écran découpe sa demande en tranches (`tranchesDeCles`), le
 * protocole refuse ce qui dépasse.
 */
export const MAX_CLES_DE_CAPTURES = 500;
export const MAX_SIGNES_DE_CLE_DE_CAPTURE = 200;

/** Une liste de clés, sans doublon ni clé hors borne, découpée en tranches acceptées par le protocole. */
export function tranchesDeCles(cles: readonly string[], taille = MAX_CLES_DE_CAPTURES): string[][] {
  const uniques = [...new Set(cles)].filter((cle) => cle.length > 0 && cle.length <= MAX_SIGNES_DE_CLE_DE_CAPTURE);
  const tranches: string[][] = [];
  for (let debut = 0; debut < uniques.length; debut += taille) tranches.push(uniques.slice(debut, debut + taille));
  return tranches;
}

/** Les clés sous lesquelles une image a pu être retenue : la sienne, et celle d'avant son rangement. */
export function clesDeVue(capture: CaptureDuFlux): string[] {
  return capture.genre === 'jointe' && capture.cleDOrigine ? [capture.cle, capture.cleDOrigine] : [capture.cle];
}

/** Cette image a-t-elle déjà été affichée en grand ? Vrai dès que l'une de ses clés est retenue. */
export function captureDejaVue(capture: CaptureDuFlux, vues: ReadonlySet<string>): boolean {
  return clesDeVue(capture).some((cle) => vues.has(cle));
}

/** Les images qu'aucune de leurs clés ne retient encore : l'ordre de la liste est gardé. */
export function capturesPasEncoreVues(captures: readonly CaptureDuFlux[], vues: ReadonlySet<string>): CaptureDuFlux[] {
  return captures.filter((c) => !captureDejaVue(c, vues));
}

/**
 * LES CLÉS À MARQUER POUR « TOUT MARQUER COMME VU » : celles de chaque image pas
 * encore vue, sous ses DEUX clés possibles (`clesDeVue`), sans doublon. Les
 * images déjà vues n'y sont pas — rien à renvoyer au serveur pour elles. Une
 * carte de plusieurs centaines d'images donne plusieurs centaines de clés :
 * l'envoi les découpe en tranches (`tranchesDeCles`).
 */
export function clesAMarquerVues(captures: readonly CaptureDuFlux[], vues: ReadonlySet<string>): string[] {
  return [...new Set(capturesPasEncoreVues(captures, vues).flatMap(clesDeVue))];
}

/**
 * LE BADGE DE LA BANDE REPLIÉE : combien d'images sont arrivées APRÈS le repli
 * (`depuis`, en ms). Ce n'est pas « pas encore vues » : une image ancienne jamais
 * ouverte n'y compte pas. Une image d'heure inconnue (`quand` = 0) n'est jamais
 * comptée, et sans moment de repli connu (`depuis` = 0) il n'y a rien à compter.
 */
export function capturesArriveesDepuis(captures: readonly CaptureDuFlux[], depuis: number): number {
  if (!(depuis > 0)) return 0;
  return captures.reduce((n, c) => (c.quand > 0 && c.quand > depuis ? n + 1 : n), 0);
}

export function capturesDuFlux(etapes: readonly EtapeAvecCapture[], jointes: readonly JointeDuTour[] = []): CaptureDuFlux[] {
  // Les copies d'icônes d'une construction n'entrent pas dans la bande (décision de l'utilisateur).
  const images = jointes.filter((j) => j.mime.startsWith('image/') && !pieceVenueDUneConstruction(j.name));
  const parId = new Map(images.map((j) => [j.id, j] as const));
  const parNom = new Map<string, JointeDuTour>();
  for (const j of images) parNom.set(j.name, j);

  const placees = new Set<string>();
  const chemins = new Set<string>();
  const rendu: Array<{ capture: CaptureDuFlux; rang: number }> = [];
  const poser = (capture: CaptureDuFlux) => rendu.push({ capture, rang: rendu.length });

  for (const etape of etapes) {
    const chemin = etape.capture?.trim();
    if (!chemin) continue;
    const piece = (etape.capturePiece ? parId.get(etape.capturePiece) : undefined) ?? parNom.get(nomDuChemin(chemin));
    if (piece) {
      if (placees.has(piece.id)) continue;
      placees.add(piece.id);
      poser({
        cle: `jointe:${piece.id}`,
        genre: 'jointe',
        id: piece.id,
        libelle: etape.label,
        chemin,
        quand: etape.startedAt ?? piece.createdAt ?? 0,
        cleDOrigine: `etape:${etape.id}`,
      });
      continue;
    }
    if (chemins.has(chemin)) continue;
    chemins.add(chemin);
    poser({ cle: `etape:${etape.id}`, genre: 'etape', chemin, libelle: etape.label, quand: etape.startedAt ?? 0 });
  }
  for (const piece of images) {
    if (placees.has(piece.id)) continue;
    placees.add(piece.id);
    poser({ cle: `jointe:${piece.id}`, genre: 'jointe', id: piece.id, libelle: piece.name, quand: piece.createdAt ?? 0 });
  }
  return rendu.sort((a, b) => b.capture.quand - a.capture.quand || b.rang - a.rang).map((r) => r.capture);
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
