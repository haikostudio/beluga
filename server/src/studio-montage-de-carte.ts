/**
 * LE MONTAGE D'UNE CARTE, CÔTÉ DÉMON (grand volet de montage, carte 3 du
 * chantier « Beluga Creative Studio », 24/10/2026).
 *
 * `ouvrirLeMontageDeLaCarte` rend la création du Studio liée à la carte — créée
 * au premier appel, en trois formats (vertical, carré, horizontal) — puis y
 * VERSE, en arrière-plan, les plans que la carte a livrés et qui n'y sont pas
 * encore : une vidéo se sépare en image muette et son (`separerImageEtSon`,
 * dans la file lourde), puis se pose à la suite des autres par `poserLExtrait`.
 * Chaque plan versé est UNE version (auteur « systeme ») : « Annuler » le
 * retire comme n'importe quel geste.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  compositionDuMontage,
  FORMATS_DU_MONTAGE,
  lireFondARetirer,
  poseManuelle,
  trouverSegment,
  type PlaceAnnoncee,
  type Segment,
  elementsAVerserDuMedia,
  marqueDePlanVerse,
  marqueDuSonDePlanVerse,
  type Composition,
  type GenreSegment,
  plansAVerser,
  poserUnMediaValide,
  poserUnPlanDeLaCarte,
  retirerLesMediasDeLaComposition,
  titreDuMontage,
  type Creation,
  type ElementAVerser,
  type ModeDePose,
  type OperationStudio,
  type PlanAPoser,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { mediasLivresDe } from './medias-livres.js';
import { dansLaFileLourde } from './file-lourde.js';
import { fabriquerCopieAlpha } from './studio-copie-alpha.js';
import { marquerFondRemis, noterFondRetire, pieceOriginaleDuFond, pieceSansFond } from './studio-fond.js';
import { ajouterMedia, appliquerOperationStudio, compositionCourante, creationDeLaCarte, creationDeMontage, creerCreation, diffuserStudio, enregistrerVersion, estMontageDeCarte, lierLeMontageALaCarte, lireCreation, lireMedia, lireSelection, modifierMedia, nouvelId } from './studio.js';

/** Les montages en train d'être nourris : deux ouvertures rapprochées ne versent pas deux fois. */
const enCours = new Map<string, Promise<number>>();

/**
 * Ce que la carte donne à sa création et que celle-ci n'a pas encore reçu : pour une
 * carte caméra, ce qu'elle a VALIDÉ, dans l'ordre du découpage ; pour toute autre
 * carte, la dernière version de chaque plan livré dans son fil.
 */
async function elementsAVerser(creationId: string, cardId: string): Promise<ElementAVerser[]> {
  const deja = plansDejaVerses(creationId);
  if (!store.getCard(cardId)?.parcours?.realisationSouhaitee) {
    return plansAVerser(mediasLivresDe({ cardId }), deja).map((m) => ({ attachmentId: m.attachmentId, genre: m.genre, sujet: m.sujet, poser: true }));
  }
  const { etatDeProductionDeLaCarte } = await import('./realisation.js');
  const production = etatDeProductionDeLaCarte(cardId);
  return elementsAVerserDuMedia({ elements: production.elements, medias: production.medias, deja });
}

/**
 * « MONTER AU STUDIO » : la création de la carte — la sienne si elle en a une
 * (création née au Studio), sinon créée au premier appel — qui reçoit en
 * arrière-plan ce que la carte a validé. `versement` : l'écran n'attend pas, il se
 * relit au signal du Studio.
 */
export async function ouvrirLeMontageDeLaCarte(cardId: string): Promise<{ creation: Creation; aVerser: number; versement?: Promise<number> }> {
  const carte = store.getCard(cardId);
  if (!carte) throw new Error('carte introuvable');
  let creation = creationDeLaCarte(cardId);
  if (!creation) {
    const r = creerCreation({ projectId: carte.projectId, titre: titreDuMontage(carte.title), formats: [...FORMATS_DU_MONTAGE], composition: compositionDuMontage(FORMATS_DU_MONTAGE[0]) });
    if (!r.ok) throw new Error(r.raison);
    lierLeMontageALaCarte(r.creation.id, cardId);
    creation = creationDeMontage(cardId)!;
  }
  const aVerser = (await elementsAVerser(creation.id, cardId)).length;
  if (aVerser && !enCours.has(creation.id)) {
    const id = creation.id;
    const travail = verserLesPlans(id, cardId)
      .catch((err) => {
        log.warn(`montage : plans de la carte non versés (${(err as Error).message})`);
        return 0;
      })
      .finally(() => enCours.delete(id));
    enCours.set(id, travail);
  }
  const versement = enCours.get(creation.id);
  return { creation, aVerser, ...(versement ? { versement } : {}) };
}

function plansDejaVerses(creationId: string): Set<string> {
  const lignes = getDb().prepare("SELECT categorie FROM studio_medias WHERE creation_id = ? AND categorie LIKE 'plan:%'").all(creationId) as { categorie: string }[];
  return new Set(lignes.map((l) => l.categorie.slice('plan:'.length)));
}

/** Verse les plans manquants, un par un, chacun relu À CET INSTANT (un geste fait entre-temps n'est jamais écrasé). */
export async function verserLesPlans(creationId: string, cardId: string): Promise<number> {
  const carte = store.getCard(cardId);
  if (!carte) return 0;
  let verses = 0;
  for (const element of await elementsAVerser(creationId, cardId)) {
    try {
      if (await verserUnPlan(creationId, { attachmentId: element.attachmentId, sujet: element.sujet, genre: element.genre, projectId: carte.projectId, cardId, poser: element.poser })) verses++;
    } catch (err) {
      log.warn(`montage : plan « ${element.sujet} » non versé (${(err as Error).message})`);
    }
  }
  return verses;
}

/** Ce que la préparation d'un plan rend du détourage : rien à faire, fait, ou la raison de l'échec. */
type IssueDuDetourage = { fait: true } | { fait: false; raison: string };

interface PlanAVerser {
  attachmentId: string;
  sujet: string;
  genre: 'image' | 'video' | 'son';
  projectId: string;
  /** Absent : une création née sans carte. */
  cardId?: string;
  /** Faux : l'élément va seulement à la bibliothèque, à portée de main (une image validée). */
  poser: boolean;
  /** Le fond uni à retirer, annoncé par l'agent : « auto » ou une couleur. */
  fond?: string | null;
  /** Le retrait d'office (Studio) : sans annonce, un vrai fond uni part quand même, et son absence ne se dit pas. */
  fondAuto?: boolean;
}

async function verserUnPlan(creationId: string, plan: PlanAVerser): Promise<boolean> {
  const prepare = await preparerLePlan(creationId, plan);
  if (!prepare) return false;
  const { aPoser, nom } = prepare;
  if (!plan.poser) return true;
  const actuelle = compositionCourante(creationId);
  if (!actuelle) return false;
  const r = poserUnPlanDeLaCarte(actuelle, aPoser, nouvelId);
  if (!r.ok) {
    log.warn(`montage : « ${nom} » rangé en bibliothèque mais pas posé (${r.raison})`);
    return false;
  }
  return enregistrerVersion(creationId, r.composition, `plan de la carte versé : ${r.resume}`, 'systeme').ok;
}

/** Les médias du Studio déjà nés de cette pièce (l'image marquée, et le son séparé d'une vidéo). */
function mediasDuStudioDeLaPiece(creationId: string, attachmentId: string): { id: string; genre: string; duree: number | null; categorie: string; attachment_id: string | null }[] {
  return getDb()
    .prepare('SELECT id, genre, duree, categorie, attachment_id FROM studio_medias WHERE creation_id = ? AND categorie IN (?, ?)')
    .all(creationId, marqueDePlanVerse(attachmentId), marqueDuSonDePlanVerse(attachmentId)) as { id: string; genre: string; duree: number | null; categorie: string; attachment_id: string | null }[];
}

/** Tous les médias du Studio nés de cette pièce : ceux qu'une validation a rangés, et celui qu'une pose à la main a pris. */
function tousLesMediasDeLaPiece(creationId: string, attachmentId: string): string[] {
  /* Sa version sans fond et son original comptent pour la même pièce : retirer la validation les ôte ensemble. */
  const original = pieceOriginaleDuFond(attachmentId) ?? attachmentId;
  const sansFond = pieceSansFond(original)?.piece ?? original;
  const lignes = getDb()
    .prepare('SELECT id FROM studio_medias WHERE (creation_id = ? OR creation_id IS NULL) AND (categorie IN (?, ?) OR attachment_id IN (?, ?, ?))')
    .all(creationId, marqueDePlanVerse(attachmentId), marqueDuSonDePlanVerse(attachmentId), attachmentId, original, sansFond) as { id: string }[];
  return lignes.map((l) => l.id);
}

/**
 * LE PLAN RANGÉ DANS LA BIBLIOTHÈQUE DU STUDIO, prêt à poser : une vidéo se
 * sépare en image muette et son, une image ou un son entre tel quel. Un plan
 * déjà rangé (marque `plan:<pièce>`) n'est pas refait : ses médias servent.
 */
async function preparerLePlan(creationId: string, plan: Omit<PlanAVerser, 'poser'>): Promise<{ aPoser: PlanAPoser; nom: string; detourage?: IssueDuDetourage } | null> {
  const piece = store.getAttachment(plan.attachmentId);
  if (!piece) return null;
  const marque = marqueDePlanVerse(plan.attachmentId);
  const nom = plan.sujet || piece.name;
  const deja = mediasDuStudioDeLaPiece(creationId, plan.attachmentId);
  const image = deja.find((d) => d.categorie === marque);
  if (image) {
    const son = deja.find((d) => d.categorie !== marque);
    const transparent = !!image.attachment_id && !!pieceOriginaleDuFond(image.attachment_id);
    if (image.genre === 'video') return { aPoser: { genre: 'video', videoMediaId: image.id, ...(son ? { audioMediaId: son.id } : {}), duree: Math.round((image.duree ?? 4) * 100) / 100, nom, ...(transparent ? { transparent } : {}) }, nom };
    if (image.genre === 'audio') return { aPoser: { genre: 'son', mediaId: image.id, duree: image.duree ?? 4, nom }, nom };
    return { aPoser: { genre: 'image', mediaId: image.id, nom, ...(transparent ? { transparent } : {}) }, nom };
  }
  const source = cheminDePieceJointe(piece);
  if (!fs.existsSync(source)) return null;
  const { mesurerMedia, separerImageEtSon } = await import('./studio-generation.js');
  const projectId = plan.projectId;
  const carteDuPlan = plan.cardId ? { cardId: plan.cardId } : {};
  let detourage: IssueDuDetourage | undefined;
  /* LE FOND À RETIRER : celui que l'agent a annoncé, sinon un vrai fond uni lu sur le fichier. Un fichier déjà détouré ne se détoure pas deux fois. */
  const dejaSansFond = !!pieceOriginaleDuFond(piece.id);
  let fond = dejaSansFond ? null : (plan.fond ?? null);
  if (!fond && !dejaSansFond && plan.fondAuto && plan.genre !== 'son' && !pieceSansFond(piece.id)?.remis) {
    const { lireLeFondDuFichier } = await import('./studio-detourage.js');
    fond = (await dansLaFileLourde(() => lireLeFondDuFichier(source, { video: plan.genre === 'video', exigeant: true }))).couleur;
  }

  if (plan.genre === 'video') {
    // L'IMAGE MUETTE ET LE SON SÉPARÉ : deux médias, deux pistes, calés au même instant.
    const separes = await dansLaFileLourde(() => separerImageEtSon(source));
    const { audio } = separes;
    let video = separes.video;
    /* LE DÉTOURAGE ANNONCÉ : un échec se dit, et le média se pose quand même, entier. */
    if (fond) {
      try {
        const { detourerUneVideo } = await import('./studio-detourage.js');
        const muette = video;
        const couleur = fond;
        video = await dansLaFileLourde(() => detourerUneVideo(muette, couleur));
        fs.rmSync(muette, { force: true });
        detourage = { fait: true };
      } catch (err) {
        detourage = { fait: false, raison: String((err as Error)?.message ?? err).slice(0, 200) };
        log.warn(`montage : détourage de « ${nom} » impossible (${detourage.raison})`);
      }
    }
    const transparente = detourage?.fait === true;
    const ranger = async (chemin: string, genre: 'video' | 'audio') => {
      const jointe = await joindreUnFichier({ projectId, ...carteDuPlan, fichier: chemin, nom: `${genre === 'video' ? 'image' : 'son'}-${path.parse(piece.name).name}${path.extname(chemin)}` });
      fs.rmSync(chemin, { force: true });
      if (!jointe.ok) throw new Error(jointe.refus);
      if (genre === 'video' && transparente) noterFondRetire(projectId, jointe.attachment.id, piece.id);
      const mesure = await mesurerMedia(cheminDePieceJointe(jointe.attachment), genre);
      const media = ajouterMedia({
        projectId,
        creationId,
        genre,
        provenance: 'import',
        nom: `${genre === 'video' ? nom : `Son — ${nom}`}`,
        attachmentId: jointe.attachment.id,
        mime: genre === 'video' ? (transparente ? 'video/webm' : 'video/mp4') : 'audio/mp4',
        ...mesure,
        // L'image dit « ce plan est versé » ; le son porte la sienne, pour partir avec elle.
        categorie: genre === 'video' ? marque : marqueDuSonDePlanVerse(plan.attachmentId),
        licence: 'Plan fabriqué par la carte',
      });
      return { media, duree: mesure.duree, mesure };
    };
    let webm: string | null = null;
    if (transparente) {
      webm = path.join(path.dirname(video), `${path.parse(video).name}-garde.webm`);
      fs.copyFileSync(video, webm);
    }
    const image = await ranger(video, 'video');
    const son = audio ? await ranger(audio, 'audio') : null;
    if (webm) await rangerLaCopieAlpha(creationId, plan, image.media.id, webm, image.mesure);
    return { aPoser: { genre: 'video', videoMediaId: image.media.id, ...(son ? { audioMediaId: son.media.id } : {}), duree: Math.round((image.duree ?? 4) * 100) / 100, nom, ...(transparente ? { transparent: true } : {}) }, nom, ...(detourage ? { detourage } : {}) };
  }
  const genre = plan.genre === 'son' ? 'audio' : 'image';
  /* UNE IMAGE À FOND ANNONCÉ : son PNG détouré devient le média ; l'original reste la pièce du fil. */
  if (genre === 'image' && fond) {
    try {
      const { detourerUneImage } = await import('./studio-detourage.js');
      const couleur = fond;
      const png = await dansLaFileLourde(() => detourerUneImage(source, couleur));
      const jointe = await joindreUnFichier({ projectId, ...carteDuPlan, fichier: png, nom: `detoure-${path.parse(piece.name).name}.png` });
      fs.rmSync(png, { force: true });
      if (!jointe.ok) throw new Error(jointe.refus);
      noterFondRetire(projectId, jointe.attachment.id, piece.id);
      const mesure = await mesurerMedia(cheminDePieceJointe(jointe.attachment), 'image');
      const media = ajouterMedia({ projectId, creationId, genre, provenance: 'import', nom, attachmentId: jointe.attachment.id, mime: 'image/png', ...mesure, categorie: marque, licence: 'Plan fabriqué par la carte' });
      return { aPoser: { genre: 'image', mediaId: media.id, nom, transparent: true }, nom, detourage: { fait: true } };
    } catch (err) {
      detourage = { fait: false, raison: String((err as Error)?.message ?? err).slice(0, 200) };
      log.warn(`montage : détourage de « ${nom} » impossible (${detourage.raison})`);
    }
  }
  const mesure = await mesurerMedia(source, genre);
  const media = ajouterMedia({ projectId, creationId, genre, provenance: 'import', nom, attachmentId: piece.id, mime: piece.mime, ...mesure, categorie: marque, licence: 'Plan fabriqué par la carte' });
  return { aPoser: genre === 'audio' ? { genre: 'son', mediaId: media.id, duree: mesure.duree ?? 4, nom } : { genre: 'image', mediaId: media.id, nom, ...(dejaSansFond ? { transparent: true } : {}) }, nom, ...(detourage ? { detourage } : {}) };
}

/** La copie d'aperçu des navigateurs qui ne lisent pas l'alpha d'une vidéo : son absence n'empêche jamais la pose. */
async function rangerLaCopieAlpha(creationId: string, plan: Pick<PlanAVerser, 'projectId' | 'cardId'>, videoMediaId: string, webm: string, mesure: { largeur?: number; hauteur?: number }): Promise<void> {
  try {
    await fabriquerCopieAlpha({ projectId: plan.projectId, creationId, videoMediaId, fichier: webm, ...mesure });
  } catch (err) {
    log.warn(`montage : copie d’aperçu de ${videoMediaId} impossible (${String((err as Error)?.message ?? err).slice(0, 200)})`);
  } finally {
    fs.rmSync(webm, { force: true });
  }
}

/* ------------------------------------------------------------------ */
/* La pose d'un média VALIDÉ, dès la validation (31/10/2026)            */
/* ------------------------------------------------------------------ */

/** Une pose à la fois par création : deux validations rapprochées ne se marchent pas dessus. */
const posesEnCours = new Map<string, Promise<unknown>>();

function uneAlaFois<T>(creationId: string, travail: () => Promise<T>): Promise<T> {
  const avant = posesEnCours.get(creationId) ?? Promise.resolve();
  const suite = avant.catch(() => undefined).then(travail);
  posesEnCours.set(creationId, suite);
  void suite.catch(() => undefined).finally(() => {
    if (posesEnCours.get(creationId) === suite) posesEnCours.delete(creationId);
  });
  return suite;
}

export type IssueDePoseDuValide =
  | { etat: 'pose'; resume: string; retires: string[]; pisteNom?: string; debut?: number; detourage?: { fait: true } | { fait: false; raison: string } }
  | { etat: 'deja' }
  | { etat: 'occupe'; nom: string }
  | { etat: 'sans-montage' }
  | { etat: 'impossible'; raison: string };

/**
 * POSER UN MÉDIA VALIDÉ DE LA CARTE SUR SA PISTE, tout de suite (choix de la
 * question « Quelle version gardez-vous ? » ou bouton « Valider » du fil) — si
 * la carte a une création du Studio. Une version (auteur « systeme »), que
 * « Annuler » défait. Les médias que « remplacer » ôte de la piste perdent
 * leur validation : valider et retirer restent deux gestes miroirs.
 */
export function poserUnMediaValideDeLaCarte(cardId: string, mediaId: string, mode?: ModeDePose): Promise<IssueDePoseDuValide> {
  const creation = creationDeLaCarte(cardId);
  if (!creation) return Promise.resolve({ etat: 'sans-montage' });
  return uneAlaFois(creation.id, async (): Promise<IssueDePoseDuValide> => {
    const { mediaParId, mediasDeLaCarte, oublierLaValidationPosee } = await import('./realisation.js');
    const carte = store.getCard(cardId);
    const m = mediaParId(mediaId);
    if (!carte || !m || m.cardId !== cardId || m.etat !== 'fini' || !m.attachmentId) return { etat: 'impossible', raison: 'média introuvable ou pas fini' };
    if (!m.retenuLe) return { etat: 'impossible', raison: 'ce média n’est plus validé' };
    /* DÉJÀ SUR LA LIGNE DE TEMPS (une pose à la main, un retour en arrière) : on ne prépare ni ne repose rien. */
    const avant = compositionCourante(creation.id);
    if (!avant) return { etat: 'impossible', raison: 'création introuvable' };
    const memePiece = new Set(tousLesMediasDeLaPiece(creation.id, m.attachmentId));
    if (avant.pistes.some((p) => p.segments.some((s) => memePiece.has(String((s as { mediaId?: unknown }).mediaId ?? ''))))) return { etat: 'deja' };
    const annonce = m.demande.montage;
    const prepare = await preparerLePlan(creation.id, { attachmentId: m.attachmentId, sujet: m.plan, genre: m.genre, projectId: carte.projectId, cardId, fond: annonce?.fond ?? null, fondAuto: !estMontageDeCarte(creation) && !annonce?.garderLeFond });
    if (!prepare) return { etat: 'impossible', raison: 'fichier du média introuvable' };
    const autresDuPlan = mediasDeLaCarte(cardId)
      .filter((x) => x.id !== m.id && x.plan === m.plan && x.attachmentId && x.genre === m.genre)
      .flatMap((x) => tousLesMediasDeLaPiece(creation.id, x.attachmentId!));
    const actuelle = compositionCourante(creation.id);
    if (!actuelle) return { etat: 'impossible', raison: 'création introuvable' };
    /* LA TÊTE DE LECTURE, lue dans la sélection que l'écran tient à jour. Un montage sans durée voulue grandit à la suite. */
    const tete = actuelle.dureeVoulue ? lireSelection(creation.id).curseur : null;
    const r = poserUnMediaValide(actuelle, { pose: prepare.aPoser, capacite: m.capacite, autresDuPlan, place: annonce?.place ?? null, tete, voix: m.demande.voix ?? null }, mode, nouvelId);
    if (!r.ok) return r.occupe ? { etat: 'occupe', nom: r.occupe.nom } : { etat: 'impossible', raison: r.raison };
    if (r.deja) return { etat: 'deja' };
    const v = enregistrerVersion(creation.id, r.composition, `média validé posé : ${r.resume}`, 'systeme');
    if (!v.ok) return { etat: 'impossible', raison: v.raison };
    if (r.retires.length) oublierLaValidationPosee(cardId, piecesDesMediasDuStudio(r.retires), m.id);
    const principal = prepare.aPoser.genre === 'video' ? prepare.aPoser.videoMediaId : prepare.aPoser.mediaId;
    const pose = r.composition.pistes.flatMap((p) => p.segments.map((s) => ({ p, s }))).find((x) => (x.s as { mediaId?: unknown }).mediaId === principal);
    /* L'ÉCRAN AMÈNE LA TÊTE DE LECTURE SUR LE MÉDIA POSÉ. */
    if (pose) diffuserStudio(carte.projectId, creation.id, undefined, { segmentId: pose.s.id, debut: pose.s.debut });
    return {
      etat: 'pose',
      resume: r.resume,
      retires: r.retires,
      ...(pose ? { pisteNom: pose.p.nom, debut: pose.s.debut } : {}),
      ...(prepare.detourage ? { detourage: prepare.detourage } : {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* La pose à la main : menu, glisser, boutons de l'atelier              */
/* ------------------------------------------------------------------ */

export interface DemandeDePoseALaMain {
  creationId: string;
  /** Une pièce du fil ou de la bibliothèque commune. */
  attachmentId?: string;
  /** Un média déjà rangé dans le Studio (un dessin gardé, par exemple). */
  mediaId?: string;
  /** Un élément tout fait (un texte, une voix à écrire). */
  segment?: Record<string, unknown>;
  pisteId?: string;
  /** Sur une piste neuve de son type, quoi qu'il y ait ailleurs. */
  nouvellePiste?: boolean;
  debut: number;
  mode?: ModeDePose;
  /** Vrai depuis la conversation : le média est inscrit à la production s'il n'y est pas, puis marqué validé. */
  valider?: boolean;
}

export type IssueDeLaPoseALaMain =
  | { ok: true; composition: Composition; pisteId: string; segmentId: string | null }
  | { ok: false; occupe: { pisteId: string; nom: string } }
  | { ok: false; raison: string; occupe?: undefined };

/**
 * POSER À LA MAIN, GRATUITEMENT ET SANS RÉVEILLER L'AGENT : une seule version,
 * donc un seul « Annuler ». Une place prise rend `occupe` : l'écran pose sa question
 * locale, puis rappelle avec `mode`. La pose passe AVANT la marque « Validé » :
 * `marquerUnePoseValidee` n'appelle aucune pose automatique, donc jamais de double.
 */
export function poserALaMain(d: DemandeDePoseALaMain): Promise<IssueDeLaPoseALaMain> {
  const creation = lireCreation(d.creationId);
  if (!creation) return Promise.resolve({ ok: false, raison: 'création introuvable' });
  return uneAlaFois(creation.id, async (): Promise<IssueDeLaPoseALaMain> => {
    const realisation = await import('./realisation.js');
    const { importerPieceJointeMesuree } = await import('./studio-generation.js');
    let segment: Record<string, unknown> & { genre: GenreSegment; debut: number; duree: number };
    let capacite: string | null = null;
    let sonSepare: string | null = null;
    let piece = d.attachmentId ?? null;
    if (d.segment) {
      segment = { duree: 3, ...d.segment, debut: d.debut } as typeof segment;
    } else {
      let media = d.mediaId ? lireMedia(d.mediaId) : null;
      if (d.attachmentId) {
        const r = await importerPieceJointeMesuree(creation.projectId, d.attachmentId, { creationId: creation.id });
        if (!r.ok) return { ok: false, raison: r.raison };
        media = r.media;
      }
      if (!media || media.projectId !== creation.projectId) return { ok: false, raison: 'média introuvable' };
      piece ??= media.attachmentId ?? null;
      const duree = media.duree && media.duree > 0 ? Math.min(media.duree, 60) : 4;
      if (media.genre === 'dessin' && media.dessin) segment = { genre: 'dessin', debut: d.debut, duree: 4, nom: media.nom, gabarit: media.dessin.gabarit, parametres: media.dessin.parametres, valeurs: media.dessin.valeurs };
      else if (media.genre === 'audio') segment = { genre: 'audio', debut: d.debut, duree, mediaId: media.id, debutMedia: 0, volume: 0.8, nom: media.nom };
      else if (media.genre === 'video') segment = { genre: 'video', debut: d.debut, duree, mediaId: media.id, debutMedia: 0, volume: 1, ajustement: 'couvrir', nom: media.nom };
      else if (media.genre === 'image') segment = { genre: 'image', debut: d.debut, duree, mediaId: media.id, ajustement: 'couvrir', nom: media.nom };
      else return { ok: false, raison: 'ce média ne se pose pas sur une piste' };
      const deLaProduction = creation.cardId && piece ? realisation.mediasDeLaCarte(creation.cardId).find((m) => m.attachmentId === piece) : undefined;
      /* UNE VIDÉO IMPORTÉE À VRAI FOND UNI : à la pose, elle se détoure et son son part sur sa piste, au même instant. */
      const leMedia = media;
      const sansFondSiUneVideo = async () => {
        const prepare = await preparerLePlan(creation.id, { attachmentId: piece!, sujet: deLaProduction?.plan ?? leMedia.nom, genre: 'video', projectId: creation.projectId, ...(creation.cardId ? { cardId: creation.cardId } : {}), fondAuto: true });
        if (prepare?.aPoser.genre !== 'video' || !prepare.aPoser.transparent) return;
        segment.mediaId = prepare.aPoser.videoMediaId;
        segment.volume = 0;
        sonSepare = prepare.aPoser.audioMediaId ?? null;
      };
      if (deLaProduction) {
        capacite = deLaProduction.capacite;
        if (deLaProduction.plan) segment.nom = deLaProduction.plan;
        /* CE QUE L'AGENT A ANNONCÉ VAUT AUSSI POUR UNE POSE À LA MAIN : un média fabriqué sur fond vert se pose détouré, à sa taille. */
        const annonce = deLaProduction.demande.montage;
        if (annonce?.place?.duree) segment.duree = annonce.place.duree;
        if (annonce?.place?.cadre && (segment.genre === 'video' || segment.genre === 'image')) {
          segment.retouches = { [segment.genre]: { ...annonce.place.cadre, cadrage: 'contenir' } };
          segment.ajustement = 'contenir';
        }
        if (annonce?.fond && (segment.genre === 'video' || segment.genre === 'image')) {
          const prepare = await preparerLePlan(creation.id, { attachmentId: piece!, sujet: deLaProduction.plan, genre: deLaProduction.genre, projectId: creation.projectId, cardId: creation.cardId!, fond: annonce.fond });
          if (prepare?.aPoser.genre === 'video') {
            segment.mediaId = prepare.aPoser.videoMediaId;
            /* Le son vit à part : l'image détourée est muette, il repart sur une piste Son au même instant. */
            segment.volume = 0;
            sonSepare = prepare.aPoser.audioMediaId ?? null;
            if (prepare.aPoser.transparent) segment.ajustement = 'contenir';
          } else if (prepare?.aPoser.genre === 'image') {
            segment.mediaId = prepare.aPoser.mediaId;
            if (prepare.aPoser.transparent) segment.ajustement = 'contenir';
          }
        } else if (segment.genre === 'video' && piece && !annonce?.garderLeFond && !estMontageDeCarte(creation)) {
          await sansFondSiUneVideo();
        }
      } else if (segment.genre === 'video' && piece && !estMontageDeCarte(creation)) {
        await sansFondSiUneVideo();
      }
      /* UN SUJET DÉTOURÉ SE POSE ENTIER : en remplissant le cadre, il serait rogné. */
      const segmentSansFond = lireMedia(String(segment.mediaId ?? ''));
      if (segmentSansFond?.attachmentId && pieceOriginaleDuFond(segmentSansFond.attachmentId) && (segment.genre === 'image' || segment.genre === 'video')) segment.ajustement = 'contenir';
    }
    const actuelle = compositionCourante(creation.id);
    if (!actuelle) return { ok: false, raison: 'création introuvable' };
    const r = poseManuelle(actuelle, { ...(d.pisteId ? { pisteId: d.pisteId } : {}), ...(d.nouvellePiste ? { nouvellePiste: true } : {}), capacite, segment }, d.mode, nouvelId);
    if (!r.ok) return r.occupe ? { ok: false, occupe: r.occupe } : { ok: false, raison: r.raison };
    let operation = r.operation;
    if (sonSepare) {
      const son = poseManuelle(actuelle, { capacite: 'son', segment: { genre: 'audio', debut: d.debut, duree: segment.duree, mediaId: sonSepare, debutMedia: 0, volume: 1, nom: `Son — ${String(segment.nom ?? '')}`.slice(0, 80) } }, 'ajouter', nouvelId);
      if (son.ok) operation = { op: 'lot', operations: [r.operation, son.operation] };
    }
    const apres = appliquerOperationStudio(creation.id, operation, 'humain');
    if (!apres.ok) return { ok: false, raison: apres.raison };
    if (creation.cardId) {
      /* « REMPLACER » : ce qui a quitté toute la ligne de temps perd sa marque. */
      const encorePoses = new Set(apres.composition.pistes.flatMap((p) => p.segments.map((s) => String((s as { mediaId?: unknown }).mediaId ?? ''))));
      const partis = r.retires.filter((id) => !encorePoses.has(id));
      if (partis.length) realisation.oublierLaValidationPosee(creation.cardId, piecesDesMediasDuStudio(partis), '');
      if (piece) await realisation.marquerUnePoseValidee(creation.cardId, piece, !!d.valider);
    }
    const pisteFinale = apres.composition.pistes.find((p) => p.id === r.pisteId);
    const neuf = pisteFinale?.segments.find((s) => Math.abs(s.debut - d.debut) < 0.011 && s.genre === segment.genre && (s as { mediaId?: unknown }).mediaId === segment.mediaId);
    return { ok: true, composition: apres.composition, pisteId: r.pisteId, segmentId: neuf?.id ?? null };
  });
}

/**
 * DÉTOURER UN ÉLÉMENT DÉJÀ POSÉ, SANS FRAIS ET SANS NOUVELLE GÉNÉRATION (outil de
 * l'agent : la mascotte #b81c de « Lancement ProjetA »). Le fichier d'origine reste ;
 * le segment passe au média détouré, en une version annulable.
 */
export async function detourerUnSegment(creationId: string, segmentId: string, fondBrut: unknown): Promise<{ ok: true; resume: string } | { ok: false; raison: string }> {
  const creation = lireCreation(creationId);
  const composition = compositionCourante(creationId);
  const trouve = composition ? trouverSegment(composition, segmentId) : null;
  if (!creation || !trouve) return { ok: false, raison: 'élément introuvable' };
  const s: Segment = trouve.segment;
  if (s.genre !== 'video' && s.genre !== 'image') return { ok: false, raison: 'seule une image ou une vidéo se détoure' };
  const source = lireMedia(s.mediaId);
  const piece = source?.attachmentId ? store.getAttachment(source.attachmentId) : null;
  if (!source || !piece) return { ok: false, raison: 'le fichier de cet élément est introuvable' };
  const fichier = cheminDePieceJointe(piece);
  const fond = lireFondARetirer(fondBrut) ?? 'auto';
  const detourage = await import('./studio-detourage.js');
  return uneAlaFois(creationId, async () => {
    try {
      const sortie = await dansLaFileLourde(() => (s.genre === 'video' ? detourage.detourerUneVideo(fichier, fond) : detourage.detourerUneImage(fichier, fond)));
      const garde = s.genre === 'video' ? `${sortie}.garde.webm` : null;
      if (garde) fs.copyFileSync(sortie, garde);
      const jointe = await joindreUnFichier({ projectId: creation.projectId, ...(creation.cardId ? { cardId: creation.cardId } : {}), fichier: sortie, nom: `detoure-${path.parse(piece.name).name}${path.extname(sortie)}` });
      fs.rmSync(sortie, { force: true });
      if (!jointe.ok) throw new Error(jointe.refus);
      noterFondRetire(creation.projectId, jointe.attachment.id, piece.id);
      const { mesurerMedia } = await import('./studio-generation.js');
      const mesure = await mesurerMedia(cheminDePieceJointe(jointe.attachment), s.genre);
      const media = ajouterMedia({
        projectId: creation.projectId,
        creationId,
        genre: s.genre,
        provenance: 'import',
        nom: source.nom,
        attachmentId: jointe.attachment.id,
        mime: s.genre === 'video' ? 'video/webm' : 'image/png',
        ...mesure,
        ...(source.categorie ? { categorie: source.categorie } : {}),
        licence: 'Élément détouré sur le serveur',
      });
      if (garde) await rangerLaCopieAlpha(creationId, { projectId: creation.projectId, ...(creation.cardId ? { cardId: creation.cardId } : {}) }, media.id, garde, mesure);
      const r = appliquerOperationStudio(
        creationId,
        { op: 'lot', operations: [{ op: 'remplacer-media', segmentId, mediaId: media.id }, { op: 'proprietes', segmentId, valeurs: { ajustement: 'contenir' } }] },
        'agent',
      );
      if (!r.ok) return { ok: false, raison: r.raison };
      return { ok: true, resume: `« ${s.nom ?? source.nom} » est détouré : le fond est retiré, le fichier d’origine reste dans la bibliothèque.` };
    } catch (err) {
      return { ok: false, raison: String((err as Error)?.message ?? err).slice(0, 200) };
    }
  });
}

/* ------------------------------------------------------------------ */
/* Retirer ou remettre le fond à la main, sans agent                    */
/* ------------------------------------------------------------------ */

export interface DemandeDuFond {
  creationId: string;
  attachmentId?: string;
  mediaId?: string;
}

type IssueDuFond = { etat: 'fait'; segments: number } | { etat: 'non-uni'; raison: string } | { etat: 'echec'; raison: string };

/** Le travail en cours par fichier : deux clics rapprochés n'en font qu'un. */
const gestesDuFondEnCours = new Set<string>();

function pieceDeLaDemande(d: DemandeDuFond): string | null {
  return d.attachmentId ?? (d.mediaId ? (lireMedia(d.mediaId)?.attachmentId ?? null) : null);
}

/**
 * RÉPOND AUSSITÔT, FINIT PAR UN ÉVÉNEMENT : détourer une vidéo dépasse tout délai de réponse, et l'écran ne doit
 * rien attendre pour rester utilisable. `cle` : l'identifiant de pièce que l'écran garde en attente.
 */
export function lancerLeGesteDuFond(geste: 'retirer' | 'remettre', d: DemandeDuFond): { enCours: true; cle: string } {
  const creation = lireCreation(d.creationId);
  if (!creation) throw new Error('création introuvable');
  const cle = pieceDeLaDemande(d);
  if (!cle) throw new Error('fichier introuvable');
  const travail = `${d.creationId}:${cle}`;
  if (gestesDuFondEnCours.has(travail)) return { enCours: true, cle };
  gestesDuFondEnCours.add(travail);
  void (geste === 'retirer' ? retirerLeFondALaMain(d, cle) : remettreLeFondALaMain(d, cle))
    .catch((err): IssueDuFond => ({ etat: 'echec', raison: String((err as Error)?.message ?? err).slice(0, 200) }))
    .then((issue) => {
      gestesDuFondEnCours.delete(travail);
      diffuserStudio(creation.projectId, creation.id, undefined, undefined, {
        cle,
        geste,
        etat: issue.etat,
        ...(issue.etat === 'fait' ? { segments: issue.segments } : { raison: issue.raison }),
      });
    });
  return { enCours: true, cle };
}

/** Fabrique le média sans fond : image en PNG, vidéo muette en WebM à son séparé. Rien ne touche la composition ici. */
async function fabriquerLaVersionSansFond(creationId: string, projectId: string, cardId: string | undefined, originale: string): Promise<IssueDuFond | { piece: string; media: string; son?: string }> {
  const piece = store.getAttachment(originale);
  if (!piece) return { etat: 'echec', raison: 'fichier introuvable' };
  const source = cheminDePieceJointe(piece);
  if (!fs.existsSync(source)) return { etat: 'echec', raison: 'fichier introuvable sur le disque' };
  const carte = cardId ? { cardId } : {};
  const { detourerUneImage, detourerUneVideo, lireLeFondDuFichier } = await import('./studio-detourage.js');
  const { mesurerMedia, separerImageEtSon } = await import('./studio-generation.js');
  const video = piece.mime.startsWith('video/');
  if (!video && !piece.mime.startsWith('image/')) return { etat: 'echec', raison: 'seule une image ou une vidéo se détoure' };
  const lu = await dansLaFileLourde(() => lireLeFondDuFichier(source, { video }));
  if (lu.transparent) return { etat: 'non-uni', raison: 'ce fichier n’a déjà plus de fond' };
  if (!lu.couleur) return { etat: 'non-uni', raison: lu.raison ?? 'ce n’est pas un fond uni' };
  const couleur = lu.couleur;
  const nom = path.parse(piece.name).name;
  if (!video) {
    const png = await dansLaFileLourde(() => detourerUneImage(source, couleur));
    const jointe = await joindreUnFichier({ projectId, ...carte, fichier: png, nom: `${nom}-sans-fond.png` });
    fs.rmSync(png, { force: true });
    if (!jointe.ok) throw new Error(jointe.refus);
    noterFondRetire(projectId, jointe.attachment.id, piece.id);
    const mesure = await mesurerMedia(cheminDePieceJointe(jointe.attachment), 'image');
    const media = ajouterMedia({ projectId, creationId, genre: 'image', provenance: 'import', nom: piece.name, attachmentId: jointe.attachment.id, mime: 'image/png', ...mesure, licence: 'Élément détouré sur le serveur' });
    return { piece: jointe.attachment.id, media: media.id };
  }
  /* LE SON PART SUR SA PISTE : le fichier détouré est muet. Déjà séparé par une validation, il n'est pas refait. */
  const sonExistant = mediasDuStudioDeLaPiece(creationId, piece.id).find((m) => m.categorie === marqueDuSonDePlanVerse(piece.id));
  const separes = sonExistant ? null : await dansLaFileLourde(() => separerImageEtSon(source));
  const muette = separes?.video ?? source;
  const webm = await dansLaFileLourde(() => detourerUneVideo(muette, couleur));
  if (separes) fs.rmSync(separes.video, { force: true });
  const garde = `${webm}.garde.webm`;
  fs.copyFileSync(webm, garde);
  const jointe = await joindreUnFichier({ projectId, ...carte, fichier: webm, nom: `${nom}-sans-fond.webm` });
  fs.rmSync(webm, { force: true });
  if (!jointe.ok) throw new Error(jointe.refus);
  noterFondRetire(projectId, jointe.attachment.id, piece.id);
  const mesure = await mesurerMedia(cheminDePieceJointe(jointe.attachment), 'video');
  const media = ajouterMedia({ projectId, creationId, genre: 'video', provenance: 'import', nom: piece.name, attachmentId: jointe.attachment.id, mime: 'video/webm', ...mesure, licence: 'Élément détouré sur le serveur' });
  await rangerLaCopieAlpha(creationId, { projectId, ...carte }, media.id, garde, mesure);
  let son = sonExistant?.id;
  if (separes?.audio) {
    const jointeSon = await joindreUnFichier({ projectId, ...carte, fichier: separes.audio, nom: `son-${nom}${path.extname(separes.audio)}` });
    fs.rmSync(separes.audio, { force: true });
    if (jointeSon.ok) {
      const mesureSon = await mesurerMedia(cheminDePieceJointe(jointeSon.attachment), 'audio');
      son = ajouterMedia({ projectId, creationId, genre: 'audio', provenance: 'import', nom: `Son — ${piece.name}`, attachmentId: jointeSon.attachment.id, mime: 'audio/mp4', ...mesureSon, categorie: marqueDuSonDePlanVerse(piece.id), licence: 'Élément détouré sur le serveur' }).id;
    }
  }
  return { piece: jointe.attachment.id, media: media.id, ...(son ? { son } : {}) };
}

/**
 * RETIRER LE FOND, PARTOUT OÙ LE MÉDIA EST POSÉ, EN UN SEUL « ANNULER » (décision du 02/11/2026). Une pièce déjà
 * détourée une fois reprend sa version sans rien refaire. Pas encore posé : la version sans fond rejoint les Médias.
 */
async function retirerLeFondALaMain(d: DemandeDuFond, cle: string): Promise<IssueDuFond> {
  const creation = lireCreation(d.creationId)!;
  const originale = pieceOriginaleDuFond(cle) ?? cle;
  const existante = pieceSansFond(originale);
  let sansFond: { piece: string; media: string; son?: string };
  if (existante) {
    const { importerPieceJointeMesuree } = await import('./studio-generation.js');
    const r = await importerPieceJointeMesuree(creation.projectId, existante.piece, { creationId: creation.id, garderLeFond: true });
    if (!r.ok) return { etat: 'echec', raison: r.raison };
    if (r.nouveau) modifierMedia(r.media.id, { nom: store.getAttachment(originale)?.name ?? r.media.nom });
    const sonExistant = mediasDuStudioDeLaPiece(creation.id, originale).find((m) => m.categorie === marqueDuSonDePlanVerse(originale));
    sansFond = { piece: existante.piece, media: r.media.id, ...(sonExistant ? { son: sonExistant.id } : {}) };
  } else {
    const fait = await fabriquerLaVersionSansFond(creation.id, creation.projectId, creation.cardId, originale);
    if ('etat' in fait) return fait;
    sansFond = fait;
  }
  marquerFondRemis(sansFond.piece, false);
  return uneAlaFois(creation.id, async (): Promise<IssueDuFond> => {
    const actuelle = compositionCourante(creation.id);
    if (!actuelle) return { etat: 'echec', raison: 'création introuvable' };
    const anciens = new Set(tousLesMediasDeLaPiece(creation.id, originale).filter((id) => id !== sansFond.media));
    const operations: OperationStudio[] = [];
    let segments = 0;
    for (const p of actuelle.pistes) {
      for (const s of p.segments) {
        if ((s.genre !== 'image' && s.genre !== 'video') || !anciens.has(s.mediaId)) continue;
        segments++;
        const valeurs: Record<string, unknown> = { ajustement: 'contenir' };
        if (s.genre === 'video' && s.volume > 0) {
          valeurs.volume = 0;
          if (sansFond.son) {
            const son = poseManuelle(actuelle, { capacite: 'son', segment: { genre: 'audio', debut: s.debut, duree: s.duree, mediaId: sansFond.son, debutMedia: s.debutMedia, volume: s.volume, ...(s.vitesse ? { vitesse: s.vitesse } : {}), nom: `Son — ${s.nom ?? ''}`.slice(0, 80) } }, 'ajouter', nouvelId);
            if (son.ok) operations.push(son.operation);
          }
        }
        operations.push({ op: 'remplacer-media', segmentId: s.id, mediaId: sansFond.media }, { op: 'proprietes', segmentId: s.id, valeurs });
      }
    }
    if (operations.length) {
      const r = appliquerOperationStudio(creation.id, { op: 'lot', operations }, 'humain');
      if (!r.ok) return { etat: 'echec', raison: r.raison };
    }
    if (creation.cardId) (await import('./realisation.js')).changerLaPieceDesMedias(creation.cardId, originale, sansFond.piece);
    return { etat: 'fait', segments };
  });
}

/** REMETTRE LE FOND : l'original reprend toutes les places de sa version sans fond, et le retrait d'office ne recommence pas. */
async function remettreLeFondALaMain(d: DemandeDuFond, cle: string): Promise<IssueDuFond> {
  const creation = lireCreation(d.creationId)!;
  const originale = pieceOriginaleDuFond(cle);
  const detouree = originale ? cle : pieceSansFond(cle)?.piece;
  const racine = originale ?? cle;
  if (!detouree) return { etat: 'echec', raison: 'ce média n’a pas de version sans fond' };
  const { importerPieceJointeMesuree } = await import('./studio-generation.js');
  const r = await importerPieceJointeMesuree(creation.projectId, racine, { creationId: creation.id, garderLeFond: true });
  if (!r.ok) return { etat: 'echec', raison: r.raison };
  marquerFondRemis(detouree, true);
  return uneAlaFois(creation.id, async (): Promise<IssueDuFond> => {
    const actuelle = compositionCourante(creation.id);
    if (!actuelle) return { etat: 'echec', raison: 'création introuvable' };
    const lignes = getDb().prepare('SELECT id FROM studio_medias WHERE attachment_id = ?').all(detouree) as { id: string }[];
    const anciens = new Set(lignes.map((l) => l.id));
    const operations: OperationStudio[] = [];
    let segments = 0;
    for (const p of actuelle.pistes) {
      for (const s of p.segments) {
        if ((s.genre !== 'image' && s.genre !== 'video') || !anciens.has(s.mediaId)) continue;
        segments++;
        operations.push({ op: 'remplacer-media', segmentId: s.id, mediaId: r.media.id });
        /* Une taille posée à la main reste ; sinon l'original reprend tout le cadre. */
        if (!s.retouches || !Object.keys(s.retouches).length) operations.push({ op: 'proprietes', segmentId: s.id, valeurs: { ajustement: 'couvrir' } });
      }
    }
    if (operations.length) {
      const a = appliquerOperationStudio(creation.id, { op: 'lot', operations }, 'humain');
      if (!a.ok) return { etat: 'echec', raison: a.raison };
    }
    if (creation.cardId) (await import('./realisation.js')).changerLaPieceDesMedias(creation.cardId, detouree, racine);
    return { etat: 'fait', segments };
  });
}

function piecesDesMediasDuStudio(ids: readonly string[]): string[] {
  if (!ids.length) return [];
  const lignes = getDb().prepare(`SELECT categorie, attachment_id FROM studio_medias WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { categorie: string | null; attachment_id: string | null }[];
  return lignes.map((l) => (/^(son)?plan:/.test(String(l.categorie ?? '')) ? String(l.categorie).replace(/^(son)?plan:/, '') : String(l.attachment_id ?? ''))).filter(Boolean);
}

/**
 * RETIRER LA VALIDATION RETIRE DE LA PISTE : tout segment de la création qui
 * porte ce média (image, vidéo et son séparé) quitte la ligne de temps, en UNE
 * version annulable. Le fichier reste dans le fil et la bibliothèque.
 */
export function retirerUnMediaDuMontage(cardId: string, attachmentId: string): Promise<number> {
  const creation = creationDeLaCarte(cardId);
  if (!creation) return Promise.resolve(0);
  return uneAlaFois(creation.id, async () => {
    const ids = tousLesMediasDeLaPiece(creation.id, attachmentId);
    const actuelle = compositionCourante(creation.id);
    if (!ids.length || !actuelle) return 0;
    const r = retirerLesMediasDeLaComposition(actuelle, ids, nouvelId);
    if (!r.retires) return 0;
    const nom = store.getAttachment(attachmentId)?.name ?? 'média';
    return enregistrerVersion(creation.id, r.composition, `validation retirée : « ${nom} » quitte la ligne de temps`, 'systeme').ok ? r.retires : 0;
  });
}

/**
 * LE RATTRAPAGE (capture #ae82 : la musique validée de « Lancement ProjetA », piste
 * Musique vide) : les médias validés d'une carte à création du Studio qui n'y
 * sont pas encore rangés se posent sur leur piste. Une place prise ne s'écrase
 * pas : le média reste en bibliothèque, à portée de main.
 */
export async function rattraperLesValidesDuMontage(): Promise<number> {
  const lignes = getDb().prepare('SELECT DISTINCT card_id FROM studio_creations WHERE card_id IS NOT NULL').all() as { card_id: string }[];
  const { mediasDeLaCarte } = await import('./realisation.js');
  let poses = 0;
  for (const { card_id: cardId } of lignes) {
    const creation = creationDeLaCarte(cardId);
    if (!creation || !store.getCard(cardId)) continue;
    const deja = plansDejaVerses(creation.id);
    for (const m of mediasDeLaCarte(cardId)) {
      if (!m.retenuLe || m.etat !== 'fini' || !m.attachmentId || deja.has(m.attachmentId)) continue;
      try {
        const r = await poserUnMediaValideDeLaCarte(cardId, m.id);
        if (r.etat === 'pose') poses++;
        else if (r.etat !== 'deja') log.info(`montage : « ${m.plan} » v${m.version} validé, pas posé au rattrapage (${r.etat === 'occupe' ? `place prise par « ${r.nom} »` : r.etat})`);
      } catch (err) {
        log.warn(`montage : rattrapage de « ${m.plan} » impossible (${(err as Error).message})`);
      }
    }
  }
  return poses;
}
