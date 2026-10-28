/**
 * LE PARCOURS D'UNE CRÉATION DE MÉDIA, CÔTÉ DÉMON (décision de l'utilisateur
 * du 26/10/2026) : Brief → Esquisses → Montage → Téléchargement.
 *
 *  - LE BOUTON DU BAS (`passerALEtape`) : chaque passage s'écrit sur la carte
 *    (`passageAEcrire`, règle pure), seulement s'il est permis et que c'est le
 *    suivant ; il ne dépense JAMAIS rien. « Passer aux esquisses » réveille le
 *    directeur pour qu'il propose la première génération (à prix, bien sûr).
 *  - LE STUDIO PHOTO (`rendreLaPhoto`) et LE STUDIO SON (`exporterLeSon`) :
 *    rendus sur ce serveur par ffmpeg, dans la file lourde, gratuits ; chaque
 *    rendu devient un MÉDIA FINAL de la carte (`realisation.finaux`).
 *  - LE TÉLÉCHARGEMENT (`telechargementDeLaCarte`, `archiveDuTelechargement`) :
 *    médias finaux, validés, puis esquisses ; l'archive part en flux, sans
 *    compression, avec trois dossiers nommés d'après les étapes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yazl from 'yazl';
import {
  LIBELLES_SECTIONS_DU_TELECHARGEMENT,
  SECTIONS_DU_TELECHARGEMENT,
  ajouterUnFinal,
  argumentsDuFormatSon,
  carteDeMedia,
  filtresFfmpegDeLaPhoto,
  mixageFfmpeg,
  montageSonDeDepart,
  nomDeFichierLisible,
  nomsSansDoublon,
  passageAEcrire,
  photoInchangee,
  realisationDeLaCarte,
  reglagesPhotoLus,
  sectionsDuTelechargement,
  traduire,
  typesDeMediaDeLaRealisation,
  MontageSon,
  type Card,
  type FichierDuTelechargement,
  type FormatDuStudioSon,
  type GesteDuMedia,
  type LangueId,
  type MediaFinal,
  type SectionDuTelechargement,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { dansLaFileLourde } from './file-lourde.js';
import { noterUnEvenement, prevenirLesEcrans } from './production.js';

const executer = promisify(execFile);

function carteDeCreation(cardId: string): Card {
  const card = store.getCard(cardId);
  if (!card || !carteDeMedia(card)) throw new Error('cette carte n’est pas une création de média');
  return card;
}

/** Écrit l'état de réalisation de la carte relue À CET INSTANT, et prévient les écrans. */
function ecrireLaRealisation(cardId: string, champs: Partial<NonNullable<Card['realisation']>>): Card {
  const fraiche = store.getCard(cardId)!;
  const ecrite = store.saveCard({ ...fraiche, realisation: { ...realisationDeLaCarte(fraiche), ...champs } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  prevenirLesEcrans(cardId);
  return ecrite;
}

/* ------------------------------------------------------------------ */
/* 1. Le bouton du bas                                                  */
/* ------------------------------------------------------------------ */

/** Les exports PRÊTS du montage de la carte (vidéo) : l'éditeur du Studio a été retiré, plus aucun export de montage n'existe. */
async function exportsPretsDuMontage(_cardId: string): Promise<{ attachmentId: string; format: string; version: number }[]> {
  return [];
}

/** Ce que le directeur reçoit quand l'utilisateur passe d'étape (il est réveillé seulement quand il a quelque chose à proposer). */
const CONSIGNE_DU_PASSAGE: Partial<Record<GesteDuMedia, string>> = {
  'passer-esquisses':
    'L’UTILISATEUR VIENT DE PASSER AUX ESQUISSES (bouton du bas). Relis l’état (« production » action « etat ») : le brief définit la structure des esquisses. Pose TOUT DE SUITE, dans ce même tour, UNE VALIDATION PAR PLAN OU ÉLÉMENT PRÉVU : pour chacun « realiser » action « devis » (2 à 4 variantes) puis « lot » — chaque bouton « Valider · prix » part dans le fil, et son clic lancera la génération sans toi. Une validation ne t’arrête pas : enchaîne-les toutes. Pour une vidéo : l’image de CHAQUE plan visuel (« plan » = sa clé), pas encore d’animation. Une phrase pour finir, rien de plus.',
  'passer-sequences':
    'L’UTILISATEUR VIENT DE PASSER AUX SÉQUENCES VIDÉO (bouton du bas). Pose TOUT DE SUITE, dans ce même tour, UNE VALIDATION PAR PLAN : l’animation de chaque plan visuel dont l’image est validée (devis capacité « animation », « source » = l’image validée, « plan » = sa clé, « duree » = la durée du plan, puis « lot »), puis la voix off et la musique prévues au brief, chacune par son propre lot. Une validation ne t’arrête pas : enchaîne-les toutes ; une phrase pour finir.',
};

/**
 * LE BOUTON DU BAS : écrit le passage s'il est permis, puis le fait suivre de
 * ce qu'il ouvre (le directeur réveillé, le montage versé). Idempotent : un
 * double clic sur un passage déjà fait ne change rien.
 */
export async function passerALEtape(cardId: string, geste: GesteDuMedia): Promise<{ ok: true; deja: boolean } | { ok: false; raison: string }> {
  const card = carteDeCreation(cardId);
  const { etatDeProductionDeLaCarte } = await import('./realisation.js');
  const production = etatDeProductionDeLaCarte(cardId);
  const exportsPrets = (await exportsPretsDuMontage(cardId)).length;
  const r = passageAEcrire({ carte: card, elements: production.elements, medias: production.medias, exportsPrets, geste, maintenant: Date.now() });
  if (!r.ok) return r;
  if (r.deja) return { ok: true, deja: true };
  ecrireLaRealisation(cardId, r.realisation);
  noterUnEvenement(cardId, 'parcours.passage', { geste });
  /* « Passer aux esquisses » vaut accord sur l'écrit du brief : une retouche ensuite le fera revalider. */
  if (geste === 'passer-esquisses') {
    const { validerLEcritDuBrief } = await import('./responsable-creatif.js');
    validerLEcritDuBrief(cardId);
  }

  /* LE DIRECTEUR EST RÉVEILLÉ À CHAQUE TEMPS (27/10/2026) : il pose d'un coup une validation par plan — images, puis animations, voix et musique. */
  const consigne = CONSIGNE_DU_PASSAGE[geste];
  if (consigne) {
    const { cadrageDeLaCarte } = await import('./cadrage.js');
    const agent = cadrageDeLaCarte(cardId) ?? (card.agentId ? store.getAgent(card.agentId) : null);
    if (agent) {
      const { sendPrompt } = await import('./runtime.js');
      const libelle = geste === 'passer-esquisses' ? 'Passer aux esquisses' : 'Passer aux séquences vidéo';
      void sendPrompt(agent.id, libelle, { context: consigne }).catch((err) => log.warn(`directeur non réveillé au passage : ${String((err as Error)?.message ?? err)}`));
    }
  }
  return { ok: true, deja: false };
}

/* ------------------------------------------------------------------ */
/* 2. Le studio photo                                                    */
/* ------------------------------------------------------------------ */

/** Le fichier d'une image source : un média de la carte, ou une pièce jointe image du projet. */
async function imageSource(card: Card, source: string): Promise<{ chemin: string; nom: string; mime: string; source: string }> {
  const { mediaParId } = await import('./realisation.js');
  const media = mediaParId(source);
  const pieceId = media && media.cardId === card.id && media.genre === 'image' ? media.attachmentId : source;
  const piece = pieceId ? store.getAttachment(pieceId) : null;
  if (!piece || piece.projectId !== card.projectId || !piece.mime.startsWith('image/')) throw new Error('image introuvable sur cette carte');
  const chemin = cheminDePieceJointe(piece);
  if (!fs.existsSync(chemin)) throw new Error(`le fichier « ${piece.name} » est absent du disque`);
  return { chemin, nom: media ? `${media.plan}-v${media.version}` : path.parse(piece.name).name, mime: piece.mime, source: media?.id ?? piece.id };
}

async function dimensions(chemin: string): Promise<{ largeur: number; hauteur: number }> {
  const { stdout } = await executer('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', chemin]);
  const [l, h] = stdout.trim().split('x').map(Number);
  if (!l || !h) throw new Error('dimensions de l’image illisibles');
  return { largeur: l, hauteur: h };
}

/**
 * LE RENDU DU STUDIO PHOTO : la chaîne ffmpeg des réglages (`filtresFfmpegDeLaPhoto`),
 * en PNG pour une source PNG, en JPEG (qualité haute) sinon. Le résultat est
 * joint à la carte et devient le média final de cette image ; les réglages
 * sont gardés pour rouvrir le studio tel quel.
 */
export async function rendreLaPhoto(cardId: string, sourceId: string, brut: unknown): Promise<{ final: MediaFinal; attachmentId: string }> {
  const card = carteDeCreation(cardId);
  const reglages = reglagesPhotoLus(brut);
  const src = await imageSource(card, sourceId);
  const r0 = realisationDeLaCarte(store.getCard(cardId));
  if (photoInchangee(reglages)) {
    /* Rien à rendre : l'original redevient le final de cette image. */
    const piece = store.getAttachment((await import('./realisation.js')).mediaParId(src.source)?.attachmentId ?? src.source);
    const final: MediaFinal = { piece: piece?.id ?? src.source, genre: 'image', source: src.source, nom: `${src.nom}`, studio: 'photo', at: Date.now() };
    ecrireLaRealisation(cardId, { finaux: ajouterUnFinal(r0.finaux, final), retouchesPhoto: { ...(r0.retouchesPhoto ?? {}), [src.source]: reglages } });
    return { final, attachmentId: final.piece };
  }
  const png = src.mime === 'image/png';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-photo-'));
  const sortie = path.join(dossier, `${nomDeFichierLisible([src.nom, 'retouche'])}.${png ? 'png' : 'jpg'}`);
  try {
    const dims = await dimensions(src.chemin);
    const filtre = filtresFfmpegDeLaPhoto(reglages, dims);
    await dansLaFileLourde(() =>
      executer('ffmpeg', ['-y', '-v', 'error', '-i', src.chemin, '-vf', filtre, '-frames:v', '1', ...(png ? [] : ['-q:v', '2']), sortie], { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }),
    );
    const jointe = await joindreUnFichier({ projectId: card.projectId, cardId, fichier: sortie, nom: path.basename(sortie) });
    if (!jointe.ok) throw new Error(jointe.refus);
    const final: MediaFinal = { piece: jointe.attachment.id, genre: 'image', source: src.source, nom: `${src.nom}-retouche`, studio: 'photo', at: Date.now() };
    const r = realisationDeLaCarte(store.getCard(cardId));
    ecrireLaRealisation(cardId, { finaux: ajouterUnFinal(r.finaux, final), retouchesPhoto: { ...(r.retouchesPhoto ?? {}), [src.source]: reglages } });
    noterUnEvenement(cardId, 'studio.photo', { source: src.source, piece: jointe.attachment.id });
    return { final, attachmentId: jointe.attachment.id };
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 3. Le studio son                                                      */
/* ------------------------------------------------------------------ */

async function dureeDuSon(chemin: string): Promise<number | null> {
  try {
    const { stdout } = await executer('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', chemin]);
    const d = Number(stdout.trim());
    return Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : null;
  } catch {
    return null;
  }
}

/** Le montage son de la carte : celui enregistré, sinon un premier montage posé avec les sons validés. */
export async function montageSonDeLaCarte(cardId: string): Promise<MontageSon> {
  const card = carteDeCreation(cardId);
  const enregistre = realisationDeLaCarte(card).montageSon;
  if (enregistre?.extraits.length) return enregistre;
  const { mediasDeLaCarte } = await import('./realisation.js');
  const sons = mediasDeLaCarte(cardId).filter((m) => m.etat === 'fini' && m.genre === 'son' && !!m.retenuLe && !!m.attachmentId);
  const avecDuree = await Promise.all(
    sons.map(async (m) => {
      const piece = store.getAttachment(m.attachmentId!);
      return { mediaId: m.id, piece: m.attachmentId!, nom: `${m.plan} v${m.version}`, capacite: m.capacite, duree: piece ? await dureeDuSon(cheminDePieceJointe(piece)) : null };
    }),
  );
  return montageSonDeDepart(avecDuree);
}

/** Enregistre le montage son tel que l'utilisateur l'a réglé (chaque geste, pour rouvrir le studio tel quel). */
export function enregistrerLeMontageSon(cardId: string, brut: unknown): MontageSon {
  carteDeCreation(cardId);
  const montage = MontageSon.parse({ ...(brut as object), majA: Date.now() });
  ecrireLaRealisation(cardId, { montageSon: montage });
  return montage;
}

/**
 * L'EXPORT DU STUDIO SON : le mixage en une commande ffmpeg (`mixageFfmpeg`),
 * en MP3 ou en WAV, joint à la carte comme média final.
 */
export async function exporterLeSon(cardId: string, brut: unknown, format: FormatDuStudioSon): Promise<{ final: MediaFinal; attachmentId: string }> {
  const card = carteDeCreation(cardId);
  const montage = MontageSon.parse(brut ?? {});
  const chemins = new Map<string, string>();
  for (const x of montage.extraits) {
    const piece = store.getAttachment(x.piece);
    if (!piece || piece.projectId !== card.projectId) throw new Error(`le son « ${x.nom || x.piece} » est introuvable`);
    const chemin = cheminDePieceJointe(piece);
    if (!fs.existsSync(chemin)) throw new Error(`le fichier « ${piece.name} » est absent du disque`);
    chemins.set(x.piece, chemin);
  }
  const mixage = mixageFfmpeg(montage, (piece) => chemins.get(piece)!);
  if (!mixage) throw new Error('rien à entendre : toutes les pistes sont coupées ou vides');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-son-'));
  const sortie = path.join(dossier, `${nomDeFichierLisible([card.title, 'mixage'])}.${format}`);
  try {
    await dansLaFileLourde(() =>
      executer(
        'ffmpeg',
        ['-y', '-v', 'error', ...mixage.entrees.flatMap((e) => ['-i', e]), '-filter_complex', mixage.filtre, '-map', mixage.sortie, '-t', String(Math.max(0.1, mixage.duree)), ...argumentsDuFormatSon(format), sortie],
        { maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60_000 },
      ),
    );
    const jointe = await joindreUnFichier({ projectId: card.projectId, cardId, fichier: sortie, nom: path.basename(sortie) });
    if (!jointe.ok) throw new Error(jointe.refus);
    const final: MediaFinal = { piece: jointe.attachment.id, genre: 'son', source: `mixage-${format}`, nom: `mixage-${format}`, studio: 'son', at: Date.now() };
    const r = realisationDeLaCarte(store.getCard(cardId));
    ecrireLaRealisation(cardId, { finaux: ajouterUnFinal(r.finaux, final), montageSon: { ...montage, majA: Date.now() } });
    noterUnEvenement(cardId, 'studio.son', { format, piece: jointe.attachment.id, duree: mixage.duree });
    return { final, attachmentId: jointe.attachment.id };
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 4. Le téléchargement                                                  */
/* ------------------------------------------------------------------ */

export type TelechargementDeLaCarte = Record<SectionDuTelechargement, (FichierDuTelechargement & { mime: string; taille: number | null })[]>;

/** Les trois sections de la page, chaque fichier relu en base (une pièce disparue n'est pas listée). */
export async function telechargementDeLaCarte(cardId: string): Promise<TelechargementDeLaCarte> {
  const card = carteDeCreation(cardId);
  const { etatDeProductionDeLaCarte } = await import('./realisation.js');
  const production = etatDeProductionDeLaCarte(cardId);
  const exports = await exportsPretsDuMontage(cardId);
  const finaux = [
    ...(realisationDeLaCarte(card).finaux ?? []),
    ...exports.map((e) => ({ piece: e.attachmentId, genre: 'video' as const, nom: `film-${e.format.replace(':', 'x')}-v${e.version}` })),
  ];
  const sections = sectionsDuTelechargement({ titre: card.title, types: typesDeMediaDeLaRealisation(card.realisation), medias: production.medias, finaux });
  const sortie = {} as TelechargementDeLaCarte;
  for (const s of SECTIONS_DU_TELECHARGEMENT) {
    sortie[s] = sections[s].flatMap((f) => {
      const piece = store.getAttachment(f.piece);
      return piece ? [{ ...f, mime: piece.mime, taille: piece.size ?? null }] : [];
    });
  }
  return sortie;
}

/**
 * L'ARCHIVE « TOUT TÉLÉCHARGER » : trois dossiers nommés d'après les étapes
 * (dans la langue de l'utilisateur), en flux et sans compression — une vidéo ne
 * se compresse pas, et rien ne tient en mémoire. Un fichier absent du disque
 * refuse l'archive avec sa raison : une archive à moitié serait prise pour le tout.
 */
export async function archiveDuTelechargement(
  cardId: string,
  langue: LangueId = 'fr',
): Promise<{ ok: true; nom: string; flux: Readable; poids: Promise<number> } | { ok: false; statut: 400 | 404; raison: string }> {
  const card = store.getCard(cardId);
  if (!card || !carteDeMedia(card)) return { ok: false, statut: 404, raison: 'carte introuvable' };
  const sections = await telechargementDeLaCarte(cardId);
  const { TRADUCTIONS } = await import('@beluga/shared/traductions');
  const entrees: { chemin: string; nom: string }[] = [];
  for (const s of SECTIONS_DU_TELECHARGEMENT) {
    const dossier = traduire(TRADUCTIONS, langue, LIBELLES_SECTIONS_DU_TELECHARGEMENT[s]);
    const noms = nomsSansDoublon(
      sections[s].map((f) => {
        const piece = store.getAttachment(f.piece)!;
        return `${f.nom}${path.extname(piece.name) || ''}`;
      }),
    );
    sections[s].forEach((f, i) => {
      const piece = store.getAttachment(f.piece)!;
      entrees.push({ chemin: cheminDePieceJointe(piece), nom: `${dossier}/${noms[i]}` });
    });
  }
  if (!entrees.length) return { ok: false, statut: 400, raison: 'rien à télécharger pour l’instant' };
  for (const e of entrees) if (!fs.existsSync(e.chemin)) return { ok: false, statut: 404, raison: `le fichier « ${path.basename(e.nom)} » est absent du disque` };
  const zip = new yazl.ZipFile();
  for (const e of entrees) zip.addFile(e.chemin, e.nom, { compress: false });
  // Les types de yazl taisent l'argument du rappel : c'est le poids final calculé (-1 s'il est inconnu).
  const finir = zip.end.bind(zip) as unknown as (options: object, poidsCalcule: (octets: number) => void) => void;
  const poids = new Promise<number>((resolve) => finir({}, resolve));
  return { ok: true, nom: `${nomDeFichierLisible([card.title]) || 'creation'}.zip`, flux: zip.outputStream as unknown as Readable, poids };
}
