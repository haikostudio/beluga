import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type Composition,
  trouverSegment,
  type DepenseStudio,
  type MediaStudio,
  type MotHorodate,
  type SegmentVoix,
  type AvancementVoix,
  DUREE_PHRASE_VOIX_FINALE_MS,
  MARGE_DUREE_VOIX_FINALE,
  MODELE_TTS_GEMINI,
  PHRASE_EXTRAIT_STUDIO,
  VOIX_ESSAI_PAR_DEFAUT,
  VOIX_FINALES_STUDIO,
  VOIX_FINALE_PAR_DEFAUT,
  MODELE_VOIX_ELEVENLABS_STUDIO,
  VOIX_ELEVENLABS_STUDIO,
  modeleKie,
  voixElevenLabsDuStudio,
  nomElevenLabsDuStudio,
  nomDeVoixFinale,
  estVoixFinaleStudio,
  voixFinaleDuProjet,
  alignerMots,
  cleOpenRouterDuRelais,
  devisVoix,
  montantLisible,
  motsRepartis,
  raisonDepenseRefusee,
  recaler,
  sonGeminiEnWav,
  texteDeVoixFinale,
  texteDeLaPrise,
  lotsDeLaPrise,
  bornesDesPhrases,
  phrasesDeLaPrise,
  phrasesARefaire,
  groupesParVoix,
  PRISE_ENTIERE,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getMeta, setMeta } from './db.js';
import { listerAcces } from './coffre-fort.js';
import { cleDuService, prixDeLaVoixChezKie, voixChezKie } from './studio-services.js';
import { modelesChoisisDeLaCreation } from './studio-modeles-choisis.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { dansLaFileLourde } from './file-lourde.js';
import { refaireLExportApresLaVoix } from './studio-rendu.js';
import {
  MODELE_VOIX_OPENROUTER,
  RAISON_SANS_CLE_OPENROUTER,
  cleOpenRouter,
  dossierDesOutils,
  dureeDuFichier,
  motsDeLaVoix,
  prixDeLaVoix,
  resoudreEssai,
  synthetiserParPiper,
  voixDEssaiDisponibles,
  voixParOpenRouter,
} from './voix-de-realisation.js';
export { MODELE_VOIX_OPENROUTER, RAISON_SANS_CLE_OPENROUTER, dureeDuFichier, prixDeLaVoix, voixDEssaiDisponibles };
import {
  ajouterMedia,
  assurerEspaceStudio,
  genreDuMime,
  importerPieceJointe,
  mediaDejaImporte,
  compositionCourante,
  creerDepense,
  depensesValideesDeGenre,
  diffuserStudio,
  ecrireDetailsDepense,
  enregistrerVersion,
  estMontageDeCarte,
  lireCreation,
  lireDepense,
  lireMedia,
  modifierMedia,
  nettoyerLesDessins,
  nouvelId,
  solderDepense,
  type Resultat,
} from './studio.js';
import { log } from './logger.js';
import * as store from './store.js';
import { cheminDePieceJointe } from './pieces-jointes.js';

const execFileAsync = promisify(execFile);

/**
 * LA FABRICATION DES SONS ET MÉDIAS DU STUDIO — GRATUIT D'ABORD.
 *
 *  (a) les visuels ne passent PAS ici : l'agent les écrit en code ;
 *  (b) VOIX D'ESSAI : Piper, sur le serveur, gratuit et sans limite ;
 *  (c) VOIX FINALE : une voix Gemini fabriquée PAR OPENROUTER seulement, avec
 *      la clé du relais (l'espace OpenRouter de Beluga Build, qui paie TOUTES
 *      les voix finales, quel que soit le projet), déclenchée SEULEMENT par
 *      « Valider la voix », dans le plafond validé. Plus de passage direct par
 *      la clé Gemini du coffre. Sans clé : le devis le DIT (`cle: false`) et la
 *      validation est refusée. JAMAIS de repli silencieux sur Piper : un refus
 *      se dit, le segment reste en voix d'essai ;
 *  (d) SOUS-TITRES : les mots horodatés par Whisper sur le serveur, alignés sur
 *      le texte connu ;
 *  (e)(f)(g) musique, image, clip : seulement sur une dépense VALIDÉE.
 *
 * LA GARDE DE DÉPENSE EST ICI, AVANT TOUT APPEL RÉSEAU PAYANT : sans dépense
 * validée de son genre pour sa création, l'appel n'est pas tenté.
 */

const DOSSIER_TRAVAIL = () => path.join(CONFIG.dataDir, 'studio', 'travail');
const DOSSIER_EXTRAITS = () => path.join(CONFIG.dataDir, 'studio', 'extraits');

/**
 * Ce qu'on sait d'un média en UNE lecture ffprobe : la taille du premier flux d'image
 * (image ou vidéo) et la durée (vidéo ou son). Ne lève jamais : un fichier illisible
 * rend {}, et l'import se fait sans mesure.
 */
export async function mesurerMedia(fichier: string, genre: MediaStudio['genre']): Promise<{ duree?: number; largeur?: number; hauteur?: number }> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', fichier],
      { timeout: 30_000 },
    );
    const j = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const flux = j.streams?.[0];
    const largeur = Number(flux?.width);
    const hauteur = Number(flux?.height);
    const duree = Number(j.format?.duration);
    return {
      ...((genre === 'image' || genre === 'video') && largeur > 0 && hauteur > 0 ? { largeur, hauteur } : {}),
      ...((genre === 'video' || genre === 'audio') && Number.isFinite(duree) && duree > 0 ? { duree } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Une pièce jointe entre dans la bibliothèque MESURÉE (taille, durée) : le chemin
 * commun de l'import par l'agent et par le bouton de l'écran. Seul un NOUVEAU média
 * se mesure — un doublon rend l'existant tel quel.
 */
export async function importerPieceJointeMesuree(
  projectId: string,
  attachmentId: string,
  /** `garderLeFond` : un décor voulu, ou l'original qu'on remet ; le retrait d'office passe son chemin. */
  extra: { licence?: string; creationId?: string; garderLeFond?: boolean } = {},
): Promise<Resultat<{ media: MediaStudio; nouveau: boolean }>> {
  const piece = store.getAttachment(attachmentId);
  const genre = piece && piece.projectId === projectId ? genreDuMime(piece.mime) : null;
  const mesure = piece && genre && !mediaDejaImporte(projectId, attachmentId) ? await mesurerMedia(cheminDePieceJointe(piece), genre) : {};
  const { garderLeFond, ...suite } = extra;
  const r = importerPieceJointe(projectId, attachmentId, { ...suite, ...mesure });
  /* UNE IMAGE À FOND UNI ENTRE SANS SON FOND, dans le Studio. L'original reste en base : « Remettre le fond » le reprend. */
  if (!r.ok || garderLeFond || !extra.creationId || r.media.genre !== 'image') return r;
  const creation = lireCreation(extra.creationId);
  if (!creation || estMontageDeCarte(creation)) return r;
  const { retirerLeFondDOffice } = await import('./studio-fond.js');
  const sansFond = await retirerLeFondDOffice({ projectId, attachmentId, ...(creation.cardId ? { cardId: creation.cardId } : {}) });
  if (!sansFond) return r;
  const detoure = await importerPieceJointeMesuree(projectId, sansFond, { ...suite, garderLeFond: true });
  if (!detoure.ok) return r;
  if (detoure.nouveau) modifierMedia(detoure.media.id, { nom: r.media.nom });
  return { ok: true, media: lireMedia(detoure.media.id) ?? detoure.media, nouveau: r.nouveau };
}

function fichierProvisoire(extension: string): string {
  fs.mkdirSync(DOSSIER_TRAVAIL(), { recursive: true });
  return path.join(DOSSIER_TRAVAIL(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
}

/* ------------------------------------------------------------------ */
/* Mots horodatés                                                       */
/* ------------------------------------------------------------------ */

/** Les silences d'un son (ffmpeg silencedetect, sous −40 dB pendant 0,15 s), pour couper une prise entre ses phrases. */
async function silencesDuSon(fichier: string): Promise<{ debut: number; fin: number }[]> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', ['-hide_banner', '-i', fichier, '-af', 'silencedetect=noise=-40dB:d=0.15', '-f', 'null', '-'], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const silences: { debut: number; fin: number }[] = [];
    let debut: number | null = null;
    for (const m of stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
      if (m[1] === 'start') debut = Number(m[2]);
      else if (debut !== null) {
        silences.push({ debut, fin: Number(m[2]) });
        debut = null;
      }
    }
    return silences;
  } catch (err: any) {
    log.warn('studio : silences de la prise illisibles, coupe sur les mots seuls', err?.message);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Poser un son sur un segment de voix, puis recaler                    */
/* ------------------------------------------------------------------ */

async function poserLeSon(entree: {
  creationId: string;
  segmentId: string;
  fichier: string;
  provenance: 'voix-essai' | 'voix-finale';
  voix: string;
  cout?: number;
  raison: string;
}): Promise<Resultat<{ duree: number; mediaId: string }>> {
  const creation = lireCreation(entree.creationId);
  const composition = compositionCourante(entree.creationId);
  if (!creation || !composition) return { ok: false, raison: 'création introuvable' };
  const trouve = trouverSegment(composition, entree.segmentId);
  if (!trouve || trouve.segment.genre !== 'voix') return { ok: false, raison: 'segment de voix introuvable' };
  const segment = trouve.segment as SegmentVoix;
  const { mots, duree } = await motsDeLaVoix(entree.fichier, segment.texte);
  const jointe = await joindreUnFichier({
    projectId: creation.projectId,
    agentId: creation.agentId ?? '',
    fichier: entree.fichier,
    nom: `${entree.provenance === 'voix-finale' ? 'voix-finale' : 'voix-essai'}-${segment.id}.wav`,
  });
  if (!jointe.ok) return { ok: false, raison: jointe.refus };
  const media = ajouterMedia({
    projectId: creation.projectId,
    creationId: creation.id,
    genre: 'audio',
    provenance: entree.provenance,
    nom: `${entree.provenance === 'voix-finale' ? 'Voix finale' : 'Voix d’essai'} — ${segment.texte.slice(0, 40)}`,
    attachmentId: jointe.attachment.id,
    mime: 'audio/wav',
    duree,
    usage: entree.voix,
    ...(entree.cout !== undefined ? { cout: entree.cout } : {}),
  });
  // Le segment est relu SUR LA VERSION COURANTE au moment de poser : un geste fait entre-temps n'est pas écrasé.
  const actuelle = compositionCourante(entree.creationId)!;
  const copie: Composition = JSON.parse(JSON.stringify(actuelle));
  const cible = trouverSegment(copie, entree.segmentId);
  if (!cible || cible.segment.genre !== 'voix') return { ok: false, raison: 'le segment a été retiré entre-temps' };
  const v = cible.segment as SegmentVoix;
  v.mediaId = media.id;
  v.etat = entree.provenance === 'voix-finale' ? 'finale' : 'essai';
  if (entree.provenance === 'voix-finale') {
    v.voixFinale = entree.voix;
    v.coutReel = entree.cout ?? 0;
  } else {
    v.voixEssai = entree.voix;
    delete v.coutReel;
  }
  const recalee = recaler(copie, entree.segmentId, duree, mots);
  const r = enregistrerVersion(entree.creationId, recalee, entree.raison, 'systeme');
  if (!r.ok) return r;
  return { ok: true, duree, mediaId: media.id };
}

/* ------------------------------------------------------------------ */
/* (b) Voix d'essai                                                     */
/* ------------------------------------------------------------------ */

/** Fabrique la voix d'essai d'UN segment : gratuite, sur le serveur. */
export async function fabriquerVoixEssai(creationId: string, segmentId: string): Promise<Resultat<{ duree: number }>> {
  const composition = compositionCourante(creationId);
  if (!composition) return { ok: false, raison: 'création introuvable' };
  const trouve = trouverSegment(composition, segmentId);
  if (!trouve || trouve.segment.genre !== 'voix') return { ok: false, raison: 'segment de voix introuvable' };
  const segment = trouve.segment as SegmentVoix;
  if (!segment.texte.trim()) return { ok: false, raison: 'le texte de la voix est vide' };
  const id = segment.voixEssai || VOIX_ESSAI_PAR_DEFAUT;
  const retenue = await resoudreEssai(id);
  if (!retenue) return { ok: false, raison: `la voix d’essai « ${id} » n’est pas posée sur le serveur` };
  const sortie = fichierProvisoire('wav');
  try {
    await dansLaFileLourde(() => synthetiserParPiper(retenue, segment.texte, sortie));
    const r = await poserLeSon({ creationId, segmentId, fichier: sortie, provenance: 'voix-essai', voix: id, raison: 'voix d’essai fabriquée' });
    if (!r.ok) return r;
    return { ok: true, duree: r.duree };
  } catch (err: any) {
    log.warn('studio : voix d’essai impossible', err?.message);
    return { ok: false, raison: `la voix d’essai n’a pas pu être fabriquée (${String(err?.message ?? err).slice(0, 160)})` };
  } finally {
    fs.rmSync(sortie, { force: true });
  }
}

/** Les voix d'essai de tous les segments qui n'en ont pas encore. */
export async function fabriquerVoixManquantes(creationId: string): Promise<{ faites: number; erreurs: string[] }> {
  const composition = compositionCourante(creationId);
  if (!composition) return { faites: 0, erreurs: ['création introuvable'] };
  const aFaire = composition.pistes
    .flatMap((p) => p.segments)
    .filter((s): s is SegmentVoix => s.genre === 'voix' && (s.etat === 'aucune' || !s.mediaId) && !!s.texte.trim());
  let faites = 0;
  const erreurs: string[] = [];
  for (const s of aFaire) {
    const r = await fabriquerVoixEssai(creationId, s.id);
    if (r.ok) faites += 1;
    else erreurs.push(r.raison);
  }
  return { faites, erreurs };
}

/* ------------------------------------------------------------------ */
/* Prix lus en direct                                                   */
/* ------------------------------------------------------------------ */

const OPENROUTER = 'https://openrouter.ai/api/v1';

/** Le compte OpenRouter qui paie : celui de l'utilisateur s'il est branché. */
export function payeurOpenRouter(): 'utilisateur' | 'beluga' {
  return cleDuService('openrouter') ? 'utilisateur' : 'beluga';
}

/** Le solde du crédit OpenRouter (commun à toutes les clés du coffre). */
export async function soldeOpenRouter(): Promise<{ solde: number | null; raison?: string }> {
  const cle = cleOpenRouter();
  if (!cle) return { solde: null, raison: 'aucune clé OpenRouter au coffre-fort' };
  try {
    const r = await fetch(`${OPENROUTER}/credits`, { headers: { Authorization: `Bearer ${cle}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { solde: null, raison: `solde illisible (${r.status})` };
    const c = (await r.json()) as { data?: { total_credits?: number; total_usage?: number } };
    const solde = Number(c.data?.total_credits ?? 0) - Number(c.data?.total_usage ?? 0);
    return { solde: Math.round(solde * 100) / 100 };
  } catch (err: any) {
    return { solde: null, raison: String(err?.message ?? err) };
  }
}

/* ------------------------------------------------------------------ */
/* (c) Voix finale                                                      */
/* ------------------------------------------------------------------ */

/**
 * LES PHRASES DU PROCHAIN « GÉNÉRER » (02/11/2026) : celles COCHÉES par l'utilisateur (`segmentIds`), dans l'ordre
 * de la ligne de temps ; sans choix, celles à (re)faire ; `refaire` (ancien bouton « Refaire la voix », outil de
 * l'agent) : toutes. Les phrases non choisies gardent leur son.
 */
function phrasesDuDevis(creationId: string, voixDuProjet: string, segmentIds?: string[], refaire = false): SegmentVoix[] {
  const composition = compositionCourante(creationId);
  if (!composition) return [];
  const toutes = phrasesDeLaPrise(composition);
  if (segmentIds?.length) {
    const choisies = new Set(segmentIds);
    return toutes.filter((s) => choisies.has(s.id));
  }
  return refaire ? toutes : phrasesARefaire(composition, voixDuProjet);
}

export interface DevisDeVoix {
  /** Les phrases qui seront dites, dans l'ordre de la ligne de temps, chacune avec SA voix. */
  segments: { id: string; texte: string; voix: string; dureeAudio?: number }[];
  secondes: number;
  plafond: number;
  /** Le modèle de la fabrication ; « plusieurs » quand les phrases choisies passent par plusieurs fournisseurs. */
  modele: string;
  /** Les clés de TOUS les fournisseurs nécessaires sont là : sans elles, rien ne peut partir (l'écran le dit et mène au coffre). */
  cle: boolean;
  solde: number | null;
}

/**
 * QUI DIT LA VOIX FINALE, ET AVEC QUEL MODÈLE : une voix ElevenLabs du Studio (`eleven:…`) part chez kie.ai avec son
 * modèle multilingue ; sinon le modèle de VOIX kie.ai retenu sur la création ; sinon OpenRouter (voix Gemini). Un
 * modèle OpenRouter retenu comme « voix » (31/10/2026) n'est pas un modèle kie.ai : la voix reste chez OpenRouter.
 */
function voixChezKieDe(creationId: string, voix: string): { modele: string; voice?: string } | null {
  // Une voix ElevenLabs du Studio part chez OPENROUTER (31/10/2026 : kie.ai tombait en « Internal Error ») : pas ici.
  if (voixElevenLabsDuStudio(voix)) return null;
  const retenu = modelesChoisisDeLaCreation(creationId).voix;
  return retenu && modeleKie(retenu, 'voix') ? { modele: retenu } : null;
}

/**
 * LA VOIX QUI DIT UNE PHRASE, telle que la fabrication la reçoit : la voix choisie pour elle ; sans choix, le modèle
 * kie.ai retenu sur la création, sinon la voix du projet.
 */
function voixDeFabrication(creationId: string, phrase: SegmentVoix, voixDuProjet: string): string {
  if (estVoixFinaleStudio(phrase.voixChoisie)) return phrase.voixChoisie;
  const chezKie = voixChezKieDe(creationId, voixDuProjet);
  return chezKie ? chezKie.modele : voixDuProjet;
}

/** Le fournisseur d'une voix de fabrication : un modèle kie.ai retenu, une voix ElevenLabs, ou une voix Gemini. */
function fournisseurDeLaVoix(creationId: string, voix: string): 'kie' | 'eleven' | 'gemini' {
  const retenu = voixChezKieDe(creationId, VOIX_FINALE_PAR_DEFAUT);
  if (retenu && voix === retenu.modele) return 'kie';
  return voixElevenLabsDuStudio(voix) ? 'eleven' : 'gemini';
}

/**
 * LE DEVIS, AVANT LE CLIC : le plafond de prix des phrases choisies, voix par voix (chaque voix est une prise à part,
 * dite d'un seul appel). `refaire` (outil de l'agent) chiffre toutes les phrases, même déjà finales.
 */
export async function devisDesVoix(creationId: string, segmentIds?: string[], options: { refaire?: boolean } = {}): Promise<Resultat<{ devis: DevisDeVoix }>> {
  const creation = lireCreation(creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const voixDuProjet = voixFinaleDuProjet(assurerEspaceStudio(creation.projectId).voixFinale);
  const phrases = phrasesDuDevis(creationId, voixDuProjet, segmentIds, options.refaire === true);
  if (!phrases.length) {
    return { ok: false, raison: segmentIds?.length ? 'aucune des phrases choisies n’a de texte à dire' : 'aucune voix à valider : toute la voix est déjà en voix finale' };
  }
  const segments = phrases.map((s) => ({ id: s.id, texte: s.texte, voix: voixDeFabrication(creation.id, s, voixDuProjet), ...(s.dureeAudio ? { dureeAudio: s.dureeAudio } : {}) }));
  let plafond = 0;
  let cle = true;
  let viaOpenRouter = false;
  const modeles = new Set<string>();
  for (const groupe of groupesParVoix(segments)) {
    const textes = groupe.phrases.map((p) => p.texte);
    const fournisseur = fournisseurDeLaVoix(creation.id, groupe.voix);
    if (fournisseur === 'kie') {
      const prix = await prixDeLaVoixChezKie(groupe.voix, textes.join(' ').length);
      if (prix === null) return { ok: false, raison: `le prix de « ${groupe.voix} » n’est pas publié par kie.ai en ce moment : rien n’est lancé sans prix affiché` };
      plafond += prix;
      cle &&= !!cleDuService('kie');
      modeles.add(groupe.voix);
      continue;
    }
    viaOpenRouter = true;
    cle &&= !!cleOpenRouter();
    if (fournisseur === 'eleven') {
      let parCaractere: number;
      try {
        parCaractere = await prixElevenLabsParCaractere();
      } catch (err: any) {
        return { ok: false, raison: `le prix ne peut pas être lu en direct (${err?.message ?? err}) : rien n’est lancé sans prix affiché` };
      }
      plafond += plafondElevenLabs(texteDeLaPrise(textes).length, parCaractere);
      modeles.add(MODELE_VOIX_ELEVENLABS_STUDIO);
      continue;
    }
    let prix;
    try {
      prix = await prixDeLaVoix();
    } catch (err: any) {
      return { ok: false, raison: `le prix ne peut pas être lu en direct (${err?.message ?? err}) : rien n’est lancé sans prix affiché` };
    }
    plafond += devisVoix(groupe.phrases, prix).plafond;
    modeles.add(MODELE_TTS_GEMINI);
  }
  const solde = viaOpenRouter ? (await soldeOpenRouter()).solde : null;
  return {
    ok: true,
    devis: {
      segments,
      secondes: devisVoix(segments, { parJetonAudio: 0, parJetonTexte: 0 }).secondes,
      plafond: Math.round(plafond * 1e6) / 1e6,
      modele: modeles.size === 1 ? [...modeles][0]! : 'plusieurs',
      cle,
      solde,
    },
  };
}

/** Le prix d'ElevenLabs chez OpenRouter, AU CARACTÈRE (`pricing.prompt`), lu en direct et gardé dix minutes. */
let prixElevenLabsEnCache: { a: number; prix: number } | null = null;
async function prixElevenLabsParCaractere(): Promise<number> {
  if (prixElevenLabsEnCache && Date.now() - prixElevenLabsEnCache.a < 10 * 60_000) return prixElevenLabsEnCache.prix;
  const cle = cleOpenRouter();
  const reponse = await fetch(`${OPENROUTER}/models?output_modalities=speech`, { headers: cle ? { Authorization: `Bearer ${cle}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!reponse.ok) throw new Error(`liste des prix illisible (${reponse.status})`);
  const corps = (await reponse.json()) as { data?: { id: string; pricing?: { prompt?: string } }[] };
  const prix = Number(corps.data?.find((m) => m.id === MODELE_VOIX_ELEVENLABS_STUDIO)?.pricing?.prompt);
  if (!Number.isFinite(prix) || prix <= 0) throw new Error(`le prix de « ${MODELE_VOIX_ELEVENLABS_STUDIO} » n’est pas publié`);
  prixElevenLabsEnCache = { a: Date.now(), prix };
  return prix;
}

/** Le plafond d'une prise ElevenLabs : le texte au tarif publié, avec 10 % de marge (balises, arrondis du fournisseur). */
function plafondElevenLabs(caracteres: number, parCaractere: number): number {
  return Math.round(caracteres * parCaractere * 1.1 * 1e6) / 1e6;
}

/** Ce qu'OpenRouter a RÉELLEMENT débité pour une génération (sa fiche), ou `null` s'il ne la rend pas à temps. */
async function coutDeLaGeneration(cle: string, generation: string | null): Promise<number | null> {
  if (!generation) return null;
  for (let essai = 0; essai < 4; essai++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const g = await fetch(`${OPENROUTER}/generation?id=${encodeURIComponent(generation)}`, { headers: { Authorization: `Bearer ${cle}` } });
      if (g.ok) {
        const corps = (await g.json()) as { data?: { total_cost?: number } };
        if (typeof corps.data?.total_cost === 'number') return corps.data.total_cost;
      }
    } catch {
      /* réessayer */
    }
  }
  return null;
}

/**
 * UNE VOIX ELEVENLABS PAR OPENROUTER, écrite en WAV (mono, 24 kHz) dans `sortie`. La voix se nomme par son NOM
 * (« Laura ») : OpenRouter refuse l'identifiant ElevenLabs. Le français vient du texte (modèle multilingue). Rend ce
 * qui a été débité : la fiche de génération, sinon le texte au tarif publié.
 */
export async function voixElevenLabsParOpenRouter(voix: string, texte: string, sortie: string): Promise<number> {
  const nom = nomElevenLabsDuStudio(voix);
  if (!nom) throw new Error(`voix ElevenLabs inconnue : ${voix}`);
  const cle = cleOpenRouter();
  if (!cle) throw new Error(RAISON_SANS_CLE_OPENROUTER);
  const reponse = await fetch(`${OPENROUTER}/audio/speech`, {
    method: 'POST',
    signal: AbortSignal.timeout(240_000),
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELE_VOIX_ELEVENLABS_STUDIO, input: texte, voice: nom, response_format: 'mp3' }),
  });
  if (!reponse.ok) {
    const t = await reponse.text().catch(() => '');
    throw new Error(`OpenRouter a refusé la voix ${nom} (${reponse.status}) : ${t.slice(0, 160)}`);
  }
  const brut = `${sortie}.mp3`;
  fs.writeFileSync(brut, Buffer.from(await reponse.arrayBuffer()));
  try {
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', brut, '-ac', '1', '-ar', '24000', '-f', 'wav', sortie], { timeout: 120_000 });
  } finally {
    fs.rmSync(brut, { force: true });
  }
  const reel = await coutDeLaGeneration(cle, reponse.headers.get('x-generation-id'));
  return reel ?? texte.length * (await prixElevenLabsParCaractere().catch(() => 0));
}

/**
 * « VALIDER LA VOIX » — le clic de l'utilisateur. Le plafond qu'il a VU est
 * revérifié contre le prix du moment (un prix qui a monté refuse, il ne
 * dépasse pas) ; la dépense est posée VALIDÉE, puis consommée segment par
 * segment sans jamais dépasser le plafond. Rend la main tout de suite : la
 * fabrication se suit par l'événement `studio`.
 */
export async function validerVoixFinales(
  creationId: string,
  segmentIds: string[] | undefined,
  plafondVu: number,
  options: { refaire?: boolean } = {},
): Promise<Resultat<{ depense: DepenseStudio }>> {
  const r = await devisDesVoix(creationId, segmentIds, options);
  if (!r.ok) return r;
  if (!r.devis.cle) {
    const viaKie = r.devis.segments.some((x) => fournisseurDeLaVoix(creationId, x.voix) === 'kie');
    return { ok: false, raison: viaKie && cleOpenRouter() ? 'kie.ai n’est pas branché : ajoutez sa clé dans les paramètres, rubrique « Services de création »' : RAISON_SANS_CLE_OPENROUTER };
  }
  const creation = lireCreation(creationId)!;
  if (r.devis.plafond > plafondVu + 1e-6) {
    return { ok: false, raison: `le prix a changé depuis l’affichage (${montantLisible(r.devis.plafond)} au lieu de ${montantLisible(plafondVu)}) : revois le devis avant de valider` };
  }
  const depense = creerDepense({
    projectId: creation.projectId,
    creationId,
    genre: 'voix',
    modele: r.devis.modele === 'plusieurs' ? MODELE_TTS_GEMINI : r.devis.modele,
    plafond: r.devis.plafond,
    raison: `${options.refaire ? 'Voix finale refaite' : 'Voix finale'} : ${r.devis.segments.length} phrase(s) en ${groupesParVoix(r.devis.segments).length} voix, ≈ ${Math.round(r.devis.secondes)} s`,
    etat: 'validee',
    details: { segments: r.devis.segments },
    demandeePar: 'humain',
  });
  void produireVoixFinales(depense.id).catch((err) => log.error('studio : voix finales', err));
  return { ok: true, depense };
}

/**
 * Ce que la fabrication mesure : les millisecondes de travail (voix, mots,
 * pose) par seconde de voix, pour estimer la prise suivante. Sans mesure :
 * ≈ 300 ms/s de fabrication + 200 ms/s de reconnaissance des mots, et un
 * socle fixe (premier son, prix, pose).
 */
const CLE_MS_PAR_SECONDE = 'studio_voix_prise_ms_par_seconde';
const SOCLE_PRISE_MS = DUREE_PHRASE_VOIX_FINALE_MS;

function msParSecondeDeVoix(): number {
  const lue = Number(getMeta(CLE_MS_PAR_SECONDE));
  return Number.isFinite(lue) && lue > 50 ? lue : 500;
}

function dureeEstimeeDeLaPrise(secondes: number): number {
  return Math.round(SOCLE_PRISE_MS + secondes * msParSecondeDeVoix());
}

function retenirDureeDeLaPrise(ms: number, secondes: number): void {
  if (secondes <= 0) return;
  const mesure = Math.max(0, ms - SOCLE_PRISE_MS) / secondes;
  // Moyenne glissante : une fabrication lente ne fausse pas toutes les suivantes.
  setMeta(CLE_MS_PAR_SECONDE, String(Math.round(msParSecondeDeVoix() * 0.5 + mesure * 0.5)));
}

/** L'avancement est rangé dans la dépense elle-même, puis diffusé : la fenêtre et le bouton du haut le suivent. */
function ecrireAvancement(depense: DepenseStudio, avancement: AvancementVoix): void {
  ecrireDetailsDepense(depense.id, { ...depense.details, avancement });
  diffuserStudio(depense.projectId, depense.creationId);
}

/**
 * Au démarrage : une fabrication de voix restée « validée » a été coupée par
 * l'arrêt du démon (elle tourne dans son processus). Elle le DIT et se solde,
 * au lieu de rester affichée « en cours » pour toujours.
 */
export function rattraperVoixCoupees(): void {
  for (const d of depensesValideesDeGenre('voix')) {
    const av = (d.details.avancement ?? {}) as Partial<AvancementVoix>;
    solderDepense(d.id, {
      erreur: av.faits?.length
        ? 'coupée par un redémarrage du serveur juste après la pose de la voix'
        : 'coupée par un redémarrage du serveur avant la pose : aucune phrase n’a changé, relancez « Valider la voix »',
    });
  }
}

/**
 * LA VOIX FINALE DES PHRASES CHOISIES, UNE PRISE PAR VOIX. Les phrases d'une
 * même voix sont dites d'un seul appel (un lot de plus seulement au-delà de
 * `PLAFOND_SIGNES_PRISE`), les mots de la prise sont reconnus, puis chaque
 * phrase reçoit SON passage du fichier commun (MEM-4384 : plusieurs segments,
 * un fichier, des `debutMedia` différents). TOUT OU RIEN : tant que toutes les
 * prises ne sont pas fabriquées et découpées, aucune phrase ne change ; elles se
 * posent ensuite en UNE version. Les phrases non choisies gardent leur son.
 */
async function produireVoixFinales(depenseId: string): Promise<void> {
  const depense = lireDepense(depenseId);
  if (!depense) return;
  // LA GARDE : rien ne part sans une dépense validée, de ce genre, pour cette création.
  const refus = raisonDepenseRefusee(depense, { genre: 'voix', creationId: depense.creationId });
  if (refus) {
    solderDepense(depenseId, { erreur: refus });
    return;
  }
  const creation = lireCreation(depense.creationId);
  if (!creation) return;
  const segments = (depense.details.segments ?? []) as { id: string; texte: string; voix: string; dureeAudio?: number }[];
  /* CHAQUE PHRASE GARDE SA VOIX (02/11/2026) : le modèle kie.ai retenu, ou une des voix finales du Studio — jamais un
     nom reçu tel quel. Les phrases d'une même voix sont dites ensemble (une prise par voix). */
  const retenuKie = voixChezKieDe(creation.id, VOIX_FINALE_PAR_DEFAUT);
  const voixSure = (v: string | undefined) => (retenuKie && v === retenuKie.modele ? retenuKie.modele : estVoixFinaleStudio(v) ? v : VOIX_FINALE_PAR_DEFAUT);
  const groupes = groupesParVoix(segments.map((s) => ({ ...s, voix: voixSure(s.voix) })));
  const depuis = Date.now();
  const secondesPrevues = devisVoix(segments, { parJetonAudio: 0, parJetonTexte: 0 }).secondes / MARGE_DUREE_VOIX_FINALE;
  // L'AVANCEMENT, lu par la fenêtre et le bouton « Mettre en production » : toutes les phrases avancent ensemble.
  const avancement: AvancementVoix = { faits: [], echecs: [], dureeMs: dureeEstimeeDeLaPrise(secondesPrevues), enCours: { id: PRISE_ENTIERE, depuis } };
  ecrireAvancement(depense, avancement);
  const fichiers: string[] = [];
  let depenseTotale = 0;
  let secondesDites = 0;
  try {
    const prises: { fichier: string; duree: number; cout: number; voix: string; phrases: { segmentId: string; texte: string; debut: number; fin: number; mots: MotHorodate[] }[] }[] = [];
    for (const groupe of groupes) {
      const voix = groupe.voix;
      const fournisseur = fournisseurDeLaVoix(creation.id, voix);
      const chezKie = fournisseur === 'kie' ? retenuKie : null;
      const eleven = fournisseur === 'eleven';
      const prix = chezKie || eleven ? { parJetonAudio: 0, parJetonTexte: 0 } : await prixDeLaVoix();
      const parCaractere = eleven ? await prixElevenLabsParCaractere() : 0;
      for (const lot of lotsDeLaPrise(groupe.phrases.map((s) => s.texte))) {
        const phrases = lot.map((i) => groupe.phrases[i]!);
        const estime = chezKie
          ? ((await prixDeLaVoixChezKie(chezKie.modele, texteDeLaPrise(phrases.map((p) => p.texte)).length)) ?? 0)
          : eleven
            ? plafondElevenLabs(texteDeLaPrise(phrases.map((p) => p.texte)).length, parCaractere)
            : devisVoix(phrases, prix).plafond;
        if (depense.plafond !== null && depenseTotale + estime > depense.plafond + 1e-9) {
          throw new Error(`le plafond validé (${montantLisible(depense.plafond)}) serait dépassé : la voix reste comme avant`);
        }
        const texte = texteDeLaPrise(phrases.map((p) => p.texte));
        const fichier = fichierProvisoire('wav');
        fichiers.push(fichier);
        const cout = chezKie
          ? await voixChezKie(chezKie.modele, texte, fichier, undefined, chezKie.voice)
          : eleven
            ? await voixElevenLabsParOpenRouter(voix, texte, fichier)
            : await voixParOpenRouter(voix, texte, fichier);
        depenseTotale += cout;
        const { mots, reconnus, duree } = await motsDeLaVoix(fichier, texte);
        secondesDites += duree;
        if (!reconnus) log.warn('studio : prise de voix découpée au prorata, faute de mots reconnus');
        const bornes = bornesDesPhrases(phrases.map((p) => p.texte), mots, duree, await silencesDuSon(fichier));
        prises.push({ fichier, duree, cout, voix, phrases: phrases.map((p, k) => ({ segmentId: p.id, texte: p.texte, ...bornes[k]! })) });
      }
    }
    // Dans l'ordre de la ligne de temps : chaque recalage décale ce qui suit (`poserLaPrise`).
    const rang = new Map(segments.map((s, i) => [s.id, i]));
    const pose = await poserLaPrise({ creationId: creation.id, prises, ordre: (id) => rang.get(id) ?? 0 });
    if (!pose.ok) throw new Error(pose.raison);
    avancement.faits = pose.posees;
    avancement.echecs = pose.ecartees;
    retenirDureeDeLaPrise(Date.now() - depuis, secondesDites);
    // LA VIDÉO SUIT : l'export est refait avec la voix finale, une fois par prise posée (son échec ne touche pas la voix).
    refaireLExportApresLaVoix(creation.id);
  } catch (err: any) {
    const raison = String(err?.message ?? err);
    log.warn('studio : voix finale impossible', raison);
    avancement.echecs = segments.map((s) => ({ id: s.id, raison: raison.slice(0, 200) }));
  } finally {
    for (const f of fichiers) fs.rmSync(f, { force: true });
  }
  delete avancement.enCours;
  ecrireAvancement(depense, avancement);
  const erreurs = [...new Set(avancement.echecs.map((e) => e.raison))];
  solderDepense(depenseId, {
    montantReel: Math.round(depenseTotale * 1e6) / 1e6,
    ...(erreurs.length ? { erreur: erreurs.slice(0, 3).join(' · ') } : {}),
  });
}

/**
 * POSER LA PRISE : chaque fichier entre UNE fois dans la bibliothèque, chaque
 * phrase y pointe avec son passage, et le tout part en UNE version. Les
 * segments sont relus sur la version COURANTE : une phrase retirée ou dont le
 * texte a changé pendant la fabrication est écartée (elle redevient « à
 * refaire », et la prochaine prise la reprendra avec toutes les autres).
 */
async function poserLaPrise(entree: {
  creationId: string;
  prises: { fichier: string; duree: number; cout: number; voix: string; phrases: { segmentId: string; texte: string; debut: number; fin: number; mots: MotHorodate[] }[] }[];
  /** Le rang de chaque phrase sur la ligne de temps : les phrases se posent dans cet ordre, toutes voix mêlées. */
  ordre: (segmentId: string) => number;
}): Promise<{ ok: true; posees: string[]; ecartees: { id: string; raison: string }[] } | { ok: false; raison: string }> {
  const creation = lireCreation(entree.creationId);
  if (!creation || !compositionCourante(entree.creationId)) return { ok: false, raison: 'création introuvable' };
  const medias: string[] = [];
  for (const prise of entree.prises) {
    const jointe = await joindreUnFichier({
      projectId: creation.projectId,
      agentId: creation.agentId ?? '',
      fichier: prise.fichier,
      nom: `voix-finale-prise-${Date.now()}.wav`,
    });
    if (!jointe.ok) return { ok: false, raison: jointe.refus };
    const media = ajouterMedia({
      projectId: creation.projectId,
      creationId: creation.id,
      genre: 'audio',
      provenance: 'voix-finale',
      nom: `Voix finale — ${nomDeVoixFinale(prise.voix)} (${prise.phrases.length} phrase(s))`,
      attachmentId: jointe.attachment.id,
      mime: 'audio/wav',
      duree: prise.duree,
      usage: prise.voix,
      cout: prise.cout,
    });
    medias.push(media.id);
  }
  const posees: string[] = [];
  const ecartees: { id: string; raison: string }[] = [];
  let copie: Composition = JSON.parse(JSON.stringify(compositionCourante(entree.creationId)!));
  const aPoser = entree.prises
    .flatMap((prise, rang) => {
      const total = prise.phrases.reduce((a, p) => a + Math.max(0, p.fin - p.debut), 0) || 1;
      return prise.phrases.map((p) => ({ p, prise, rang, total }));
    })
    .sort((x, y) => entree.ordre(x.p.segmentId) - entree.ordre(y.p.segmentId));
  for (const { p, prise, rang, total } of aPoser) {
    const cible = trouverSegment(copie, p.segmentId);
    if (!cible || cible.segment.genre !== 'voix') {
      ecartees.push({ id: p.segmentId, raison: 'phrase retirée pendant la fabrication' });
      continue;
    }
    const v = cible.segment as SegmentVoix;
    if (v.texte.trim() !== p.texte.trim()) {
      ecartees.push({ id: p.segmentId, raison: 'texte modifié pendant la fabrication : la voix est à refaire' });
      continue;
    }
    v.mediaId = medias[rang]!;
    v.etat = 'finale';
    v.voixFinale = prise.voix;
    v.coutReel = Math.round(((prise.cout * Math.max(0, p.fin - p.debut)) / total) * 1e6) / 1e6;
    // Dans l'ordre de la ligne de temps : chaque recalage décale ce qui suit, la phrase suivante est relue après.
    copie = recaler(copie, p.segmentId, prise.duree, p.mots, { debut: p.debut, fin: p.fin });
    posees.push(p.segmentId);
  }
  if (!posees.length) return { ok: false, raison: ecartees[0]?.raison ?? 'aucune phrase à poser' };
  const r = enregistrerVersion(entree.creationId, copie, `voix finale posée (${posees.length} phrase(s))`, 'systeme');
  if (!r.ok) return r;
  return { ok: true, posees, ecartees };
}

/* ------------------------------------------------------------------ */
/* Extraits des voix finales : fabriqués UNE fois, gardés               */
/* ------------------------------------------------------------------ */

/** Ce que les extraits payants ont coûté, voix par voix (aucune création ne les porte : ils servent à tous les projets). */
const CLE_DEPENSES_EXTRAITS = 'studio_extraits_depenses';

function depensesDesExtraits(): Record<string, number> {
  try {
    return JSON.parse(getMeta(CLE_DEPENSES_EXTRAITS) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Le fichier gardé de l'extrait d'une voix (le même nom pour la fabrication et pour la liste). */
function fichierDeLExtrait(voix: string): string {
  return path.join(DOSSIER_EXTRAITS(), `${voix.replace(/[^\w@.-]/g, '_')}.wav`);
}

export function extraitsDisponibles(): { voix: string; genre: string; timbre?: string; pret: boolean; cout?: number }[] {
  const couts = depensesDesExtraits();
  return [
    ...VOIX_FINALES_STUDIO.map((v) => ({ voix: v.id, genre: v.genre, timbre: v.timbre as string | undefined })),
    ...VOIX_ELEVENLABS_STUDIO.map((v) => ({ voix: v.id, genre: v.genre, timbre: undefined })),
  ].map((v) => ({
    voix: v.voix,
    genre: v.genre,
    ...(v.timbre ? { timbre: v.timbre } : {}),
    pret: fs.existsSync(fichierDeLExtrait(v.voix)),
    ...(couts[v.voix] !== undefined ? { cout: couts[v.voix] } : {}),
  }));
}

/** Deux écoutes simultanées de la même voix ne la fabriquent qu'une fois. */
const extraitsEnCours = new Map<string, Promise<{ ok: true; fichier: string } | { ok: false; raison: string }>>();

/**
 * L'EXTRAIT D'UNE VOIX, pour la choisir à l'oreille depuis la liste — la même
 * phrase fixe pour toutes. Fabriqué UNE SEULE FOIS puis gardé hors de tout projet
 * (`data/studio/extraits`) et resservi à tous :
 *  - une voix FINALE (vingt voix Gemini) : par OpenRouter seulement, comme la
 *    voix finale elle-même — quelques centimes, une fois par voix (accord donné
 *    au cadrage du Studio enrichi, 05/10/2026, puis « tout par OpenRouter »
 *    au cadrage « Studio : réglages plus intuitifs », 06/10/2026) —, montant
 *    noté (`studio_extraits_depenses`) et dit au journal. Les extraits déjà
 *    fabriqués restent servis. Jamais de repli silencieux sur une autre voix ;
 *  - une voix d'ESSAI (Piper, sur le serveur) : gratuite, dans la file lourde.
 */
export function fichierDExtrait(voix: string): Promise<{ ok: true; fichier: string } | { ok: false; raison: string }> {
  const finale = estVoixFinaleStudio(voix);
  const essai = !finale && voixDEssaiDisponibles().some((v) => v.id === voix);
  if (!finale && !essai) return Promise.resolve({ ok: false, raison: 'voix inconnue' });
  const fichier = fichierDeLExtrait(voix);
  if (fs.existsSync(fichier)) return Promise.resolve({ ok: true, fichier });
  const deja = extraitsEnCours.get(voix);
  if (deja) return deja;
  const travail = (async (): Promise<{ ok: true; fichier: string } | { ok: false; raison: string }> => {
    fs.mkdirSync(DOSSIER_EXTRAITS(), { recursive: true });
    const provisoire = `${fichier}.${process.pid}.tmp`;
    try {
      if (essai) {
        const retenue = await resoudreEssai(voix);
        if (!retenue) return { ok: false, raison: `la voix d’essai « ${voix} » n’est pas posée sur le serveur` };
        await dansLaFileLourde(() => synthetiserParPiper(retenue, PHRASE_EXTRAIT_STUDIO, provisoire));
      } else if (voixElevenLabsDuStudio(voix)) {
        /* UNE VOIX ELEVENLABS : la même phrase française, une seule fois, par OpenRouter (kie.ai tombait en panne). */
        const cout = await voixElevenLabsParOpenRouter(voix, PHRASE_EXTRAIT_STUDIO, provisoire);
        setMeta(CLE_DEPENSES_EXTRAITS, JSON.stringify({ ...depensesDesExtraits(), [voix]: Math.round(cout * 1e6) / 1e6 }));
        log.info(`studio : extrait de la voix ${voix} fabriqué par OpenRouter (ElevenLabs) — ${montantLisible(cout)}`);
      } else {
        const cout = await voixParOpenRouter(voix, PHRASE_EXTRAIT_STUDIO, provisoire);
        setMeta(CLE_DEPENSES_EXTRAITS, JSON.stringify({ ...depensesDesExtraits(), [voix]: Math.round(cout * 1e6) / 1e6 }));
        log.info(`studio : extrait de la voix ${voix} fabriqué par OpenRouter — ${montantLisible(cout)}`);
      }
      fs.renameSync(provisoire, fichier);
      return { ok: true, fichier };
    } catch (err: any) {
      fs.rmSync(provisoire, { force: true });
      // Dit tel quel : une clé absente, un refus ou un prix illisible.
      return { ok: false, raison: String(err?.message ?? err) };
    } finally {
      extraitsEnCours.delete(voix);
    }
  })();
  extraitsEnCours.set(voix, travail);
  return travail;
}

/**
 * LES EXTRAITS QUI MANQUENT, FABRIQUÉS D'AVANCE (demande du 31/10/2026 : « qu'on n'ait pas à attendre qu'elles se
 * chargent ») : chaque voix finale sans extrait le reçoit, l'une après l'autre, une seule fois — un extrait déjà
 * gardé n'est jamais refait, et son coût est noté comme à l'écoute (`studio_extraits_depenses`). Lancé au démarrage
 * du démon et par `scripts/preparer-extraits-des-voix.mjs`. Un échec se dit au journal et n'arrête pas les suivantes.
 */
export async function preparerLesExtraitsManquants(): Promise<{ faits: string[]; echecs: { voix: string; raison: string }[] }> {
  const faits: string[] = [];
  const echecs: { voix: string; raison: string }[] = [];
  for (const { voix, pret } of extraitsDisponibles()) {
    if (pret) continue;
    const r = await fichierDExtrait(voix);
    if (r.ok) faits.push(voix);
    else {
      echecs.push({ voix, raison: r.raison });
      log.warn(`studio : extrait de la voix ${voix} impossible — ${r.raison}`);
    }
  }
  if (faits.length || echecs.length) log.info(`studio : extraits de voix préparés — ${faits.length} fait(s), ${echecs.length} échec(s)`);
  return { faits, echecs };
}

/**
 * SÉPARER L'IMAGE ET LE SON D'UN EXTRAIT : l'image sans le son (copiée telle
 * quelle, rien n'est réencodé) et, s'il en a un, le son seul. Un extrait SANS
 * piste son ne donne que l'image : jamais un son vide.
 */
export async function separerImageEtSon(fichier: string): Promise<{ video: string; audio?: string }> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', fichier], { timeout: 30_000 });
  const aDuSon = stdout.trim().length > 0;
  const video = fichierProvisoire('mp4');
  await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', fichier, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', video], { timeout: 5 * 60_000 });
  if (!aDuSon) return { video };
  const audio = fichierProvisoire('m4a');
  await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', fichier, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', audio], { timeout: 5 * 60_000 });
  return { video, audio };
}
