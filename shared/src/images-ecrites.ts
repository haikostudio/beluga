/**
 * LES IMAGES QU'UNE ÉTAPE A ÉCRITES, RETROUVÉES DANS SON TEXTE.
 *
 * Un script d'essai (navigateur d'essai, capture d'écran en ligne de commande)
 * écrit son PNG sur disque et n'en dit le chemin que dans sa commande ou dans sa
 * sortie. L'agent ne relit pas toujours l'image : sans cette lecture, la capture
 * n'apparaissait nulle part. La règle est pure — elle ne regarde ni le disque ni
 * l'heure : elle sort les chemins d'image d'un texte, dans leur ordre
 * d'apparition, sans doublon, et écarte ce qui ne peut pas être une capture
 * (dépendances, dépôt git, dossier construit, motif à étoile ou variable).
 * Le démon filtre ensuite par existence, date de modification et racines
 * autorisées (`server/src/captures-auto.ts`).
 */

import { slug } from './slugs.js';

const EXTENSION_IMAGE = /\.(?:png|jpe?g|gif|webp)$/i;
const SEPARATEURS = /[\s"'`<>|;&(),=:{}\[\]]+/;
const DOSSIERS_ECARTES = /(?:^|\/)(?:node_modules|\.git|dist)(?:\/|$)/;

export function cheminsDImages(...textes: Array<string | undefined | null>): string[] {
  const vus = new Set<string>();
  const rendu: string[] = [];
  for (const texte of textes) {
    if (!texte) continue;
    for (const brut of texte.split(SEPARATEURS)) {
      // Une ponctuation de phrase ou une barre inverse de fin n'est pas du chemin.
      const chemin = brut.replace(/^[\\]+|[.,\\]+$/g, '');
      if (chemin.length < 5 || !EXTENSION_IMAGE.test(chemin)) continue;
      if (/[*$?~]/.test(chemin) || chemin.startsWith('http') || chemin.includes('//')) continue;
      if (DOSSIERS_ECARTES.test(chemin)) continue;
      if (vus.has(chemin)) continue;
      vus.add(chemin);
      rendu.push(chemin);
    }
  }
  return rendu;
}

/**
 * LES COPIES D'ICÔNES QU'UNE CONSTRUCTION D'APPLICATION ÉCRIT TOUTE SEULE.
 *
 * Une construction mobile (Capacitor, Android, iOS) recopie l'icône et l'écran
 * de démarrage en dizaines de tailles : `mipmap-*`, `drawable-*`,
 * `Assets.xcassets`, `ic_launcher*`, `AppIcon*`. L'agent ne les a ni fabriquées
 * ni regardées : elles remplissaient la place des vraies captures (27 copies
 * pour 12 captures perdues sur une même carte). Décision de l'utilisateur :
 * elles restent HORS de la bande et des pièces jointes.
 */
const DOSSIER_DE_CONSTRUCTION = /(?:^|[\\/])(?:(?:mipmap|drawable)(?:-[\w-]+)?|[^\\/]+\.xcassets|[^\\/]+\.appiconset|[^\\/]+\.imageset)(?:[\\/]|$)/i;
const NOM_DE_CONSTRUCTION = /^(?:ic_launcher|appicon|launchimage)/i;

export function estUneCopieDeConstruction(chemin: string): boolean {
  const nom = chemin.split(/[\\/]/).pop() ?? chemin;
  return DOSSIER_DE_CONSTRUCTION.test(chemin) || NOM_DE_CONSTRUCTION.test(nom);
}

/**
 * LA MÊME RECONNAISSANCE SUR UNE PIÈCE DÉJÀ RANGÉE, dont on ne connaît plus que
 * le NOM (le dossier d'origine est perdu, un doublon a reçu « (2) »). Elle sert
 * à la bande : les copies rangées avant que le démon ne les écarte
 * (« splash (7).png », « ic_launcher_round (3).png ») n'y paraissent plus.
 */
const SPLASH_DE_CONSTRUCTION = /^splash(?:-\d+x\d+(?:-\d+)?)?\.png$/i;

export function pieceVenueDUneConstruction(nom: string): boolean {
  const sansDoublon = nom.replace(/ \(\d+\)(?=\.[^.]+$)/, '');
  return NOM_DE_CONSTRUCTION.test(sansDoublon) || SPLASH_DE_CONSTRUCTION.test(sansDoublon);
}

/**
 * LE NOM D'UNE CAPTURE RANGÉE EN PIÈCE JOINTE : son vrai nom de fichier, sauf
 * quand ce nom ne dit rien (« image.png », « screenshot-2.png », « out.png ») —
 * il reçoit alors le titre de la carte devant lui, pour qu'on la retrouve parmi
 * les pièces jointes du projet. Sans titre, le nom reste tel quel.
 */
const NOM_VAGUE =
  /^(?:image|img|screenshot|screen|capture|shot|sortie|output|out|test|essai|page|apercu|preview|tmp|temp|untitled|photo|picture)(?:[-_ ]?\d+)?\.[a-z0-9]+$/i;

export function nomDeCaptureRangee(nomDuFichier: string, titreDeCarte?: string | null): string {
  if (!NOM_VAGUE.test(nomDuFichier)) return nomDuFichier;
  const prefixe = slug(titreDeCarte ?? '');
  return prefixe ? `${prefixe}-${nomDuFichier}` : nomDuFichier;
}

/**
 * LES FICHIERS DU DÉPÔT QUE L'AGENT N'A PAS TOUCHÉS NE SONT PAS DES CAPTURES.
 *
 * La copie de travail d'une carte est créée APRÈS le début du tour : chaque
 * fichier suivi par git y reçoit une date de modification fraîche, et le
 * balayage rangeait comme captures toutes les icônes et anciennes captures du
 * projet (55 images sur 56 pour une carte de ProjetE, octobre 2026). Une image
 * SUIVIE au départ du tour et restée IDENTIQUE depuis n'a été ni prise ni
 * modifiée par l'agent : elle sort de la bande. Une image qu'il a retouchée,
 * ajoutée ou laissée hors du dépôt reste une capture.
 *
 * Règle pure : le démon lui donne la sortie de git (`server/src/captures-auto.ts`).
 */
export interface EtatDuDepot {
  /** Les chemins suivis au départ du tour, relatifs à la racine du dépôt. */
  suivis: ReadonlySet<string>;
  /** Les chemins qui ont bougé depuis : modifiés, ajoutés, renommés, commités pendant le tour. */
  modifies: ReadonlySet<string>;
}

/** Une liste de chemins séparés par NUL (`git ls-files -z`, `git diff --name-only -z`). */
export function cheminsSeparesParNul(sortie: string): Set<string> {
  return new Set((sortie ?? '').split('\0').filter((chemin) => chemin.length > 0));
}

/**
 * LES CHEMINS QUI ONT BOUGÉ, LUS DANS `git status --porcelain -z`. Chaque entrée
 * est « XY chemin » ; un renommage ou une copie ajoute l'ancien chemin en entrée
 * suivante, compté lui aussi.
 */
export function cheminsDuStatutGit(sortie: string): Set<string> {
  const rendu = new Set<string>();
  const entrees = (sortie ?? '').split('\0');
  for (let index = 0; index < entrees.length; index += 1) {
    const entree = entrees[index];
    if (entree.length < 4) continue;
    const etat = entree.slice(0, 2);
    rendu.add(entree.slice(3));
    if ((etat.includes('R') || etat.includes('C')) && entrees[index + 1]) {
      rendu.add(entrees[index + 1]);
      index += 1;
    }
  }
  return rendu;
}

/** `relatif` : le chemin de l'image depuis la racine du dépôt, séparé par « / ». */
export function imageDuDepotInchangee(relatif: string, depot: EtatDuDepot): boolean {
  const chemin = relatif.split('\\').join('/').replace(/^\.\//, '');
  return depot.suivis.has(chemin) && !depot.modifies.has(chemin);
}

/**
 * LE NETTOYAGE DES MESSAGES DÉJÀ POLLUÉS (une seule fois, rejouable sans
 * dommage) : les pièces d'un message d'agent dont le CONTENU est celui d'une
 * image du dépôt du projet, et qu'aucune étape n'a regardée. Une pièce reliée à
 * une étape — par son identifiant (`capturePiece`) ou par le nom du fichier
 * regardé — reste : l'agent l'a vue. Rien n'est effacé du disque ni des pièces
 * jointes du projet : seule la liste du message change.
 */
export interface PieceAJuger {
  id: string;
  sha: string;
  name: string;
  mime: string;
}

export function piecesDuDepotARetirer(
  message: { attachments?: readonly string[]; steps?: readonly { capture?: string; capturePiece?: string }[] },
  pieces: ReadonlyMap<string, PieceAJuger>,
  empreintesDuDepot: ReadonlySet<string>,
): string[] {
  const regardees = new Set<string>();
  const nomsRegardes = new Set<string>();
  for (const etape of message.steps ?? []) {
    if (etape.capturePiece) regardees.add(etape.capturePiece);
    const nom = etape.capture?.trim().split(/[\\/]/).pop();
    if (nom) nomsRegardes.add(nom);
  }
  return (message.attachments ?? []).filter((id) => {
    const piece = pieces.get(id);
    if (!piece || !piece.mime.startsWith('image/')) return false;
    if (regardees.has(id) || nomsRegardes.has(piece.name)) return false;
    return empreintesDuDepot.has(piece.sha);
  });
}
