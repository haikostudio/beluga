import { blocsDePiece, piecesAffichees, type BlocDePiece } from './mise-en-page-des-pieces.js';
import { LIBELLES_PHASES_DE_REALISATION, type PhaseDeRealisation } from './mode-realisation.js';
import { nomsSansDoublon } from './visionneuse.js';

/**
 * LE BRIEF EN UN SEUL DOCUMENT (26/10/2026, demande de l'utilisateur : « juste
 * un cahier des charges, du texte avec des titres »). L'étape « Brief » du
 * volet de suivi ne montre plus une pile de blocs encadrés : un SOMMAIRE, puis
 * des PARTIES (brief, direction, scénario, storyboard, plans… dans l'ordre des
 * blocs), chacune avec ses SECTIONS (une par pièce écrite affichée).
 *
 *  - LES PIÈCES FOURNIES (éléments `reference` à clé « piece-… », notés par
 *    l'action `piece_recue` avec « Pièce jointe : <id> (<nom>) ») ne forment
 *    plus de section : leur image se pose dans le texte, juste après le
 *    paragraphe qui CITE leur nom (comparé sans accents ni casse) ; jamais
 *    citée, elle va dans la partie finale « Pièces fournies ». Aucune ne se perd.
 *  - L'AMBIANCE (`Card.realisation.ambiance`) se pose à la fin de la section qui
 *    illustre sa phase (direction → direction, scénario → scénario, plans →
 *    plans, intention/format… → brief), avec sa légende, sinon le nom de la
 *    phase ; sans section qui lui corresponde, elle rejoint « Pièces fournies ».
 *  - Les pistes écartées restent hors du document (`piecesAffichees`).
 *
 * `documentDuBriefEnMarkdown` en fait le fichier de l'archive (`images/<nom>`) ou le
 * texte à copier (« Image : légende »).
 */

/** Ce que le document lit d'une pièce écrite : la forme des éléments du suivi. */
export interface PieceDuDocument {
  id: string;
  cle: string;
  genre: string;
  titre: string;
  contenu: string;
  etat: string;
  versions?: readonly { creeLe: number }[];
}

/** Un bloc du brief (une étape du suivi) : sa clé (« brief », « direction »…) et ses pièces. */
export interface BlocDuDocument<E extends PieceDuDocument> {
  etape: string;
  elements: readonly E[];
}

/** Une vignette d'ambiance, telle que la carte la garde. */
export interface AmbianceDuDocument {
  piece: string;
  phase: PhaseDeRealisation | string;
  legende?: string;
  at?: number;
}

/** Une image (ou vidéo, ou son) posée dans le texte. */
export interface MediaDuDocument {
  attachmentId: string;
  legende: string;
  /** Le nom du fichier quand le texte de la pièce le donne (« Pièce jointe : id (nom) »). */
  nomDeFichier: string | null;
  origine: 'piece' | 'ambiance';
  /** Après quel bloc de texte de la section (-1 : avant le premier). */
  apres: number;
  quand: number | null;
}

export interface SectionDuDocument<E extends PieceDuDocument> {
  ancre: string;
  titre: string;
  /** La pièce écrite qu'elle montre (versions, « Modifier », « Corriger ») ; null pour « Pièces fournies ». */
  piece: E | null;
  /** Les pistes écartées de cette section (montrées dans la feuille « Archives » de l’étape). */
  pistes: E[];
  blocs: BlocDePiece[];
  medias: MediaDuDocument[];
}

export interface PartieDuDocument<E extends PieceDuDocument> {
  ancre: string;
  /** La clé du bloc (« brief », « direction »…), ou « pieces-fournies ». */
  cle: string;
  sections: SectionDuDocument<E>[];
  /** Toutes les directions sont écartées : la ligne seule qui les garde reprenables. */
  pistesSeules: E[];
}

export const PARTIE_DES_PIECES_FOURNIES = 'pieces-fournies';
export const LIBELLE_DES_PIECES_FOURNIES = 'Pièces fournies';
const PREFIXE_PIECE_RECUE = 'piece-';

/** Une pièce reçue de l'utilisateur, notée au suivi par `piece_recue`. */
export function estUnePieceRecue(e: Pick<PieceDuDocument, 'genre' | 'cle'>): boolean {
  return e.genre === 'reference' && e.cle.startsWith(PREFIXE_PIECE_RECUE);
}

/** « Pièce jointe : <id> (<nom>) » : l'identifiant et le nom du fichier d'une pièce reçue. */
export function pieceJointeDuTexte(contenu: string): { id: string; nom: string | null } | null {
  const m = /Pièce jointe\s*:\s*#?([\w-]+)(?:\s*\(([^)\n]+)\))?/i.exec(contenu ?? '');
  return m ? { id: m[1]!, nom: m[2]?.trim() || null } : null;
}

/** Un texte comparable : sans accents, sans casse, la ponctuation en espaces. */
export function texteComparable(s: string): string {
  return ` ${String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** Le texte cite-t-il ce nom ? En entier, sinon par tous ses mots porteurs (quatre lettres et plus). */
export function citeLeNom(texte: string, nom: string): boolean {
  const t = texteComparable(texte);
  const n = texteComparable(nom);
  if (n.trim().length < 3) return false;
  if (t.includes(n)) return true;
  const mots = n.trim().split(' ').filter((m) => m.length >= 4);
  return mots.length >= 2 && mots.every((m) => t.includes(` ${m} `) || t.includes(` ${m}s `));
}

/** Le texte brut d'un bloc de pièce, pour y chercher un nom. */
function texteDuBloc(b: BlocDePiece): string {
  return b.genre === 'intitule' ? `${b.titre} ${b.texte}` : b.texte;
}

/** Le paragraphe qui partage le plus de mots porteurs avec une légende (deux au moins), ou -1. */
export function paragrapheQuiEnParle(blocs: readonly BlocDePiece[], legende: string): number {
  const mots = [...new Set(texteComparable(legende).trim().split(' ').filter((m) => m.length >= 4))];
  let meilleur = -1;
  let score = 1;
  blocs.forEach((b, i) => {
    const t = texteComparable(texteDuBloc(b));
    const n = mots.filter((m) => t.includes(` ${m}`)).length;
    if (n > score) {
      score = n;
      meilleur = i;
    }
  });
  return meilleur;
}

/** Les blocs du suivi qu'une phase d'ambiance illustre, du plus juste au repli. */
const BLOCS_DE_LA_PHASE: Record<string, readonly string[]> = {
  intention: ['brief'],
  format: ['brief'],
  scenario: ['scenario', 'ecriture', 'brief'],
  direction: ['direction', 'style', 'brief'],
  personnages: ['direction', 'style', 'scenario', 'brief'],
  plans: ['plans', 'storyboard', 'brief'],
  son: ['brief'],
  montage: ['brief'],
};

/** Une ancre sûre et unique : « brief-direction-2 ». */
function ancreDe(base: string, prises: Set<string>): string {
  const propre =
    String(base ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'section';
  let ancre = `brief-${propre}`;
  for (let i = 2; prises.has(ancre); i++) ancre = `brief-${propre}-${i}`;
  prises.add(ancre);
  return ancre;
}

/** LE DOCUMENT DU BRIEF : ses parties dans l'ordre des blocs, puis « Pièces fournies » s'il en reste. */
export function documentDuBrief<E extends PieceDuDocument>(
  blocs: readonly BlocDuDocument<E>[],
  ambiance: readonly AmbianceDuDocument[] = [],
): PartieDuDocument<E>[] {
  const ancres = new Set<string>();
  const parties: PartieDuDocument<E>[] = [];
  const recues: { piece: E; jointe: { id: string; nom: string | null } }[] = [];
  const sansPieceJointe: E[] = [];

  for (const bloc of blocs) {
    const vues = piecesAffichees(bloc.elements);
    const montrees = vues.affichees.filter((e) => {
      if (!estUnePieceRecue(e)) return true;
      const jointe = pieceJointeDuTexte(e.contenu);
      if (jointe) recues.push({ piece: e, jointe });
      else sansPieceJointe.push(e);
      return false;
    });
    const sections = montrees.map(
      (e): SectionDuDocument<E> => ({
        ancre: ancreDe(`${bloc.etape}-${e.cle}`, ancres),
        titre: e.titre,
        piece: e,
        pistes: (vues.retenue ? e === vues.retenue : e.genre === 'concept') ? vues.ecartees : [],
        blocs: blocsDePiece(e.contenu),
        medias: [],
      }),
    );
    const pistesSeules = vues.ecartees.length && !montrees.some((e) => e.genre === 'concept') ? vues.ecartees : [];
    if (!sections.length && !pistesSeules.length) continue;
    parties.push({ ancre: ancreDe(bloc.etape, ancres), cle: bloc.etape, sections, pistesSeules });
  }

  const restes: MediaDuDocument[] = [];
  const toutes = parties.flatMap((p) => p.sections);

  /* LES PIÈCES FOURNIES : après le premier paragraphe qui cite leur nom. */
  for (const { piece, jointe } of recues) {
    const media: MediaDuDocument = {
      attachmentId: jointe.id,
      legende: piece.titre,
      nomDeFichier: jointe.nom,
      origine: 'piece',
      apres: -1,
      quand: piece.versions?.[0]?.creeLe ?? null,
    };
    let posee = false;
    for (const s of toutes) {
      const i = s.blocs.findIndex((b) => citeLeNom(texteDuBloc(b), piece.titre));
      if (i >= 0 || citeLeNom(s.titre, piece.titre)) {
        s.medias.push({ ...media, apres: Math.max(i, -1) });
        posee = true;
        break;
      }
    }
    if (!posee) restes.push(media);
  }

  /* L'AMBIANCE : à la fin de la section qui illustre sa phase. */
  for (const a of ambiance) {
    const media: MediaDuDocument = {
      attachmentId: a.piece,
      legende: a.legende?.trim() || LIBELLES_PHASES_DE_REALISATION[a.phase as PhaseDeRealisation] || 'Ambiance',
      nomDeFichier: null,
      origine: 'ambiance',
      apres: -1,
      quand: a.at ?? null,
    };
    const cibles = BLOCS_DE_LA_PHASE[a.phase] ?? ['brief'];
    let posee = false;
    for (const cle of cibles) {
      const partie = parties.find((p) => p.cle === cle && p.sections.length);
      if (!partie) continue;
      /* La direction RETENUE (ou la première montrée) porte l'ambiance de sa partie. */
      const section = partie.sections.find((s) => s.piece?.etat === 'valide') ?? partie.sections[0]!;
      /* Sous le paragraphe qui en parle le plus (« DÉCOR : … bois … plantes »), sinon à la fin de la section. */
      const i = paragrapheQuiEnParle(section.blocs, media.legende);
      section.medias.push({ ...media, apres: i >= 0 ? i : section.blocs.length - 1 });
      posee = true;
      break;
    }
    if (!posee) restes.push(media);
  }

  /* Ce que rien n'a placé : la partie finale. Une pièce reçue sans pièce jointe lisible reste un texte. */
  if (restes.length || sansPieceJointe.length) {
    const sections: SectionDuDocument<E>[] = [];
    if (restes.length) {
      sections.push({ ancre: ancreDe('pieces-fournies-images', ancres), titre: LIBELLE_DES_PIECES_FOURNIES, piece: null, pistes: [], blocs: [], medias: restes });
    }
    for (const e of sansPieceJointe) {
      sections.push({ ancre: ancreDe(e.cle, ancres), titre: e.titre, piece: e, pistes: [], blocs: blocsDePiece(e.contenu), medias: [] });
    }
    parties.push({ ancre: ancreDe(PARTIE_DES_PIECES_FOURNIES, ancres), cle: PARTIE_DES_PIECES_FOURNIES, sections, pistesSeules: [] });
  }

  /* Un média n'entre qu'une fois (la même image fournie ET posée en ambiance). */
  const dejaPoses = new Set<string>();
  for (const s of parties.flatMap((p) => p.sections)) {
    s.medias = s.medias.filter((m) => (dejaPoses.has(m.attachmentId) ? false : (dejaPoses.add(m.attachmentId), true)));
  }
  return parties;
}

/** Tous les médias du document, dans l'ordre de lecture. */
export function mediasDuDocument(parties: readonly PartieDuDocument<PieceDuDocument>[]): MediaDuDocument[] {
  return parties.flatMap((p) => p.sections.flatMap((s) => [...s.medias].sort((a, b) => a.apres - b.apres)));
}

/** Une partie se titre-t-elle seule ? Oui quand son unique section porte déjà son nom (« Brief », « Scénario »). */
export function partieFondueDansSaSection(partie: Pick<PartieDuDocument<PieceDuDocument>, 'sections'>, libelleDeLaPartie: string): boolean {
  return partie.sections.length === 1 && texteComparable(partie.sections[0]!.titre) === texteComparable(libelleDeLaPartie);
}

/** Un nom de fichier sûr dans une archive, l'extension gardée. */
function nomDeFichierSur(nom: string): string {
  const propre = String(nom ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f#()[\]]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 80);
  return propre || 'image';
}

/**
 * LES NOMS DES IMAGES DANS L'ARCHIVE (`images/<nom>`), un par pièce jointe,
 * dédoublonnés : le Markdown pointe EXACTEMENT vers eux.
 */
export function nomsDesImagesDuBrief(medias: readonly MediaDuDocument[], nomDe: (m: MediaDuDocument) => string | null | undefined): Map<string, string> {
  const uniques: MediaDuDocument[] = [];
  for (const m of medias) if (!uniques.some((u) => u.attachmentId === m.attachmentId)) uniques.push(m);
  const bruts = uniques.map((m) => {
    const nom = nomDe(m) || m.nomDeFichier || '';
    const ext = /\.[a-z0-9]{2,5}$/i.exec(nom)?.[0] ?? '.png';
    const base = nomDeFichierSur(m.legende || nom.replace(/\.[a-z0-9]{2,5}$/i, ''));
    return `${base}${ext.toLowerCase()}`;
  });
  const noms = nomsSansDoublon(bruts);
  return new Map(uniques.map((m, i) => [m.attachmentId, `images/${noms[i]}`]));
}

/** Un bloc de pièce en Markdown : l'intitulé en gras sur sa ligne, le reste tel quel. */
function blocEnMarkdown(b: BlocDePiece): string {
  if (b.genre === 'intitule') return b.texte ? `**${b.titre}**\n\n${b.texte}` : `**${b.titre}**`;
  if (b.genre === 'texte') return b.numero ? `${b.numero} ${b.texte}` : b.texte;
  return b.texte;
}

/**
 * LE BRIEF EN MARKDOWN : « # titre », le sommaire n'y est pas (les titres le
 * font), « ## » par partie, « ### » par section (sauf la section qui porte le
 * nom de sa partie), les médias à leur place. Avec `images` : `![légende](images/…)`
 * (l'archive) ; sans : « *Image : légende* » (le texte copié).
 */
export function documentDuBriefEnMarkdown(
  parties: readonly PartieDuDocument<PieceDuDocument>[],
  options: { titre: string; libelleDe: (cle: string) => string; images?: ReadonlyMap<string, string> },
): string {
  const morceaux: string[] = [`# ${options.titre}`];
  const media = (m: MediaDuDocument) => {
    const chemin = options.images?.get(m.attachmentId);
    return chemin ? `![${m.legende.replace(/[[\]]/g, '')}](${chemin})` : `*Image : ${m.legende}*`;
  };
  for (const p of parties) {
    const libelle = options.libelleDe(p.cle);
    const fondue = partieFondueDansSaSection(p, libelle);
    morceaux.push(`## ${libelle}`);
    for (const s of p.sections) {
      if (!fondue && s.titre) morceaux.push(`### ${s.titre}`);
      const avant = s.medias.filter((m) => m.apres < 0);
      for (const m of avant) morceaux.push(media(m));
      s.blocs.forEach((b, i) => {
        morceaux.push(blocEnMarkdown(b));
        for (const m of s.medias.filter((x) => x.apres === i)) morceaux.push(media(m));
      });
      for (const m of s.medias.filter((x) => x.apres >= s.blocs.length)) morceaux.push(media(m));
    }
  }
  return `${morceaux.join('\n\n').trim()}\n`;
}
