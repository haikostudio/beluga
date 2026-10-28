import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import { MAX_IMAGES_PAR_ARCHIVE, MAX_SIGNES_PAR_TEXTE_D_ARCHIVE, MAX_TEXTES_PAR_ARCHIVE, cheminSurDansLArchive, nomDArchiveDImages, nomsSansDoublon, type Attachment } from '@beluga/shared';

/**
 * « TOUT TÉLÉCHARGER » DE LA VISIONNEUSE : les images qu'elle parcourt, en UNE
 * archive. EN DEUX TEMPS : `POST /api/attachments/archive` reçoit la liste
 * (corps JSON), la vérifie ENTIÈRE (`verifierArchive`) et la met de côté sous
 * un jeton (`deposerLot`) ; `GET …?lot=<jeton>` rend le zip. La liste ne passe
 * plus dans l'adresse : au-delà de ~300 images, elle dépassait les 16 Ko
 * d'entêtes que Node accepte, et la demande mourait en 431.
 *
 * LE MÊME CONTRÔLE QUE `/api/attachment`, POUR CHAQUE IMAGE : `peutLire` dit si
 * le compte peut lire la pièce (pour un client : une pièce de SES demandes ou de
 * SON fil ; une image du coffre-fort : l'administrateur seul). UNE SEULE pièce
 * hors de portée refuse TOUTE l'archive, avec le refus ordinaire : un lot à
 * moitié rempli se prendrait pour le lot entier.
 *
 * Les captures d'étape d'un agent (`/api/capture`) y entrent aussi, pour
 * l'administrateur seul — un client n'en voit jamais.
 *
 * Chaque fichier garde son VRAI nom (`attachment.name`, jamais l'étiquette
 * « #alias »), dédoublonné. L'archive part en FLUX et sans compression (des
 * images sont déjà compressées) : rien ne tient en mémoire, et le poids final
 * est connu d'avance pour l'entête `content-length`.
 */
export type ArchiveDesImages =
  | { ok: true; nom: string; flux: Readable; poids: Promise<number>; fichiers: string[] }
  | { ok: false; statut: 400 | 403 | 404; raison: string };

export interface DemandeDArchive {
  ids: string[];
  /** Les captures d'étape, toutes du même projet. */
  captures?: { projet: string; chemins: string[] };
  nom?: string | null;
  /** Le chemin de chaque pièce dans l'archive (id → « images/photo.png »), quand l'écran le fixe (brief téléchargé). */
  nomsDansLArchive?: Record<string, string>;
  /** Des textes posés à la racine (« brief.md »). */
  textes?: { nom: string; contenu: string }[];
}

export interface AccesDeLArchive {
  lirePiece: (id: string) => Attachment | null | undefined;
  peutLire: (piece: Attachment) => boolean;
  cheminDe: (piece: Attachment) => string;
  /** Le fichier d'une capture d'étape, ou null ; absent : captures refusées (client). */
  trouverCapture?: (projet: string, chemin: string) => string | null;
  refus: string;
}

type Entree = { chemin: string; nom: string } | { contenu: Buffer; nom: string };
type Refus = { ok: false; statut: 400 | 403 | 404; raison: string };

/** TOUT CE QUI REFUSE UNE ARCHIVE, vérifié AVANT d'en écrire un octet : sert au dépôt du lot comme au zip. */
export function verifierArchive(demande: DemandeDArchive, acces: AccesDeLArchive): { ok: true; entrees: Entree[] } | Refus {
  const ids = [...new Set(demande.ids.filter(Boolean))];
  const chemins = [...new Set(demande.captures?.chemins.filter(Boolean) ?? [])];
  const textes = demande.textes ?? [];
  const total = ids.length + chemins.length;
  if (!total && !textes.length) return { ok: false, statut: 400, raison: 'aucune image demandée' };
  if (textes.length > MAX_TEXTES_PAR_ARCHIVE) return { ok: false, statut: 400, raison: 'trop de textes dans l’archive' };
  if (total > MAX_IMAGES_PAR_ARCHIVE) {
    return { ok: false, statut: 400, raison: `plus de ${MAX_IMAGES_PAR_ARCHIVE} images à la fois : téléchargez-les séparément` };
  }

  const entrees: Entree[] = [];
  for (const id of ids) {
    const piece = acces.lirePiece(id);
    // Une pièce absente et une pièce hors de portée disent la même chose : rien ne se devine.
    if (!piece || !acces.peutLire(piece)) return { ok: false, statut: 403, raison: acces.refus };
    const chemin = acces.cheminDe(piece);
    if (!fs.existsSync(chemin)) return { ok: false, statut: 404, raison: `le fichier « ${piece.name} » est absent du disque` };
    entrees.push({ chemin, nom: cheminSurDansLArchive(demande.nomsDansLArchive?.[id]) ?? (path.basename(piece.name) || 'image') });
  }
  if (chemins.length) {
    if (!acces.trouverCapture || !demande.captures) return { ok: false, statut: 403, raison: acces.refus };
    for (const c of chemins) {
      const fichier = acces.trouverCapture(demande.captures.projet, c);
      if (!fichier) return { ok: false, statut: 404, raison: 'une capture n’existe plus' };
      entrees.push({ chemin: fichier, nom: path.basename(fichier) });
    }
  }
  /* LES TEXTES (le brief en Markdown) : un nom sûr, un poids borné. */
  for (const texte of textes) {
    const nom = cheminSurDansLArchive(texte?.nom);
    if (!nom || typeof texte.contenu !== 'string' || texte.contenu.length > MAX_SIGNES_PAR_TEXTE_D_ARCHIVE) {
      return { ok: false, statut: 400, raison: 'un texte de l’archive est illisible' };
    }
    entrees.push({ contenu: Buffer.from(texte.contenu, 'utf8'), nom });
  }
  return { ok: true, entrees };
}

export function archiveDesImages(demande: DemandeDArchive, acces: AccesDeLArchive): ArchiveDesImages {
  const verifiee = verifierArchive(demande, acces);
  if (!verifiee.ok) return verifiee;
  const { entrees } = verifiee;

  const noms = nomsSansDoublon(entrees.map((e) => e.nom));
  const zip = new yazl.ZipFile();
  entrees.forEach((e, i) => ('contenu' in e ? zip.addBuffer(e.contenu, noms[i]!, { compress: false }) : zip.addFile(e.chemin, noms[i]!, { compress: false })));
  // Les types de yazl taisent l'argument du rappel : c'est le poids final calculé (-1 s'il est inconnu).
  const finir = zip.end.bind(zip) as unknown as (options: object, poidsCalcule: (octets: number) => void) => void;
  const poids = new Promise<number>((resolve) => finir({}, resolve));
  return { ok: true, nom: nomDArchiveDImages(demande.nom), flux: zip.outputStream as unknown as Readable, poids, fichiers: noms };
}

/*
 * LES LOTS PRÉPARÉS : en mémoire, dix minutes, au nom du COMPTE qui les a
 * déposés. Le jeton se relit autant de fois qu'il faut pendant sa vie (le
 * navigateur peut faire un HEAD, reprendre un téléchargement) ; un autre
 * compte, un jeton inconnu ou périmé : refus. Les droits sont REVÉRIFIÉS à
 * chaque lecture (`archiveDesImages` avec le compte courant) — le jeton ne
 * garde que la liste, jamais une permission.
 */
export const DUREE_D_UN_LOT_MS = 10 * 60_000;
const MAX_LOTS = 200;
const lots = new Map<string, { proprietaire: string; demande: DemandeDArchive; expire: number }>();

function purgerLots(maintenant: number): void {
  for (const [jeton, lot] of lots) if (lot.expire <= maintenant) lots.delete(jeton);
}

/** Met une liste VÉRIFIÉE de côté ; rend son jeton. */
export function deposerLot(proprietaire: string, demande: DemandeDArchive, maintenant = Date.now()): string {
  purgerLots(maintenant);
  // Un flot de dépôts ne fait pas grossir la mémoire : les plus anciens partent.
  while (lots.size >= MAX_LOTS) lots.delete(lots.keys().next().value!);
  const jeton = crypto.randomBytes(18).toString('base64url');
  lots.set(jeton, { proprietaire, demande, expire: maintenant + DUREE_D_UN_LOT_MS });
  return jeton;
}

/** La liste d'un lot, pour SON compte seulement ; null sinon (inconnu, périmé, ou d'un autre compte). */
export function lireLot(jeton: string, proprietaire: string, maintenant = Date.now()): DemandeDArchive | null {
  purgerLots(maintenant);
  const lot = lots.get(jeton);
  return lot && lot.proprietaire === proprietaire ? lot.demande : null;
}
