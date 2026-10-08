import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type Composition,
  type DepenseStudio,
  type FormatStudio,
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
  estVoixFinaleStudio,
  voixFinaleDuProjet,
  alignerMots,
  cleOpenRouterDuRelais,
  devisClip,
  devisVoix,
  montantLisible,
  motsRepartis,
  raisonDepenseRefusee,
  recaler,
  sonGeminiEnWav,
  texteVoixFinaleStudio,
  texteDeLaPrise,
  lotsDeLaPrise,
  bornesDesPhrases,
  phrasesDeLaPrise,
  priseARefaire,
  PRISE_ENTIERE,
  trouverSegment,
  FORMATS_STUDIO,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getMeta, setMeta } from './db.js';
import { listerAcces } from './coffre-fort.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { resoudre } from './voice.js';
import { dansLaFileLourde } from './studio-file.js';
import { refaireLExportApresLaVoix } from './studio-rendu.js';
import {
  ajouterMedia,
  assurerEspaceStudio,
  compositionCourante,
  creerDepense,
  depensesValideesDeGenre,
  diffuserStudio,
  ecrireDetailsDepense,
  enregistrerVersion,
  lireCreation,
  lireDepense,
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

/** Où vivent l'environnement Python et les modèles (le dépôt principal depuis une copie de carte). */
function dossierDesOutils(): string {
  return fs.existsSync(path.join(CONFIG.dataDir, 'venv')) ? CONFIG.dataDir : path.join(CONFIG.depotDuDemon, 'data');
}
const PYTHON = () => path.join(dossierDesOutils(), 'venv', 'bin', 'python');
const SCRIPT_MOTS = path.join(CONFIG.selfPath, 'scripts', 'mots-horodates.py');
const DOSSIER_TRAVAIL = () => path.join(CONFIG.dataDir, 'studio', 'travail');
const DOSSIER_EXTRAITS = () => path.join(CONFIG.dataDir, 'studio', 'extraits');

/** La durée réelle d'un fichier son ou vidéo, lue par ffprobe. */
export async function dureeDuFichier(fichier: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier], { timeout: 30_000 });
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error('durée illisible');
  return d;
}

function fichierProvisoire(extension: string): string {
  fs.mkdirSync(DOSSIER_TRAVAIL(), { recursive: true });
  return path.join(DOSSIER_TRAVAIL(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
}

/** Les voix d'essai proposées : les voix Piper posées sur le serveur. */
export function voixDEssaiDisponibles(): { id: string; label: string }[] {
  const dossier = path.join(dossierDesOutils(), 'models', 'piper');
  const etiquettes: Record<string, string> = {
    'fr_FR-siwis-medium': 'Claire',
    'fr_FR-tom-medium': 'Thomas',
    'fr_FR-upmc-medium@pierre': 'Pierre',
    'fr_FR-upmc-medium@jessica': 'Jessica',
  };
  try {
    const presents = new Set(fs.readdirSync(dossier).filter((f) => f.endsWith('.onnx')).map((f) => f.replace(/\.onnx$/, '')));
    return Object.entries(etiquettes)
      .filter(([id]) => presents.has(id.split('@')[0]!))
      .map(([id, label]) => ({ id, label }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Mots horodatés                                                       */
/* ------------------------------------------------------------------ */

async function motsReconnus(fichier: string): Promise<MotHorodate[]> {
  const { stdout } = await execFileAsync(PYTHON(), [SCRIPT_MOTS, fichier, 'base'], {
    timeout: 180_000,
    env: { ...process.env, BELUGA_WHISPER_DIR: path.join(dossierDesOutils(), 'models', 'whisper') },
    maxBuffer: 8 * 1024 * 1024,
  });
  const r = JSON.parse(stdout) as { mots: MotHorodate[] };
  return Array.isArray(r.mots) ? r.mots : [];
}

/** Les mots du texte CONNU, aux temps de la voix ; une reconnaissance impossible répartit au prorata. */
async function motsDeLaVoix(fichier: string, texte: string, duree: number): Promise<{ mots: MotHorodate[]; reconnus: boolean }> {
  try {
    const reconnus = await motsReconnus(fichier);
    if (reconnus.length) return { mots: alignerMots(texte, reconnus, duree), reconnus: true };
  } catch (err: any) {
    log.warn('studio : reconnaissance des mots impossible, temps répartis au prorata', err?.message);
  }
  return { mots: motsRepartis(texte, duree), reconnus: false };
}

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
  const duree = await dureeDuFichier(entree.fichier);
  const { mots } = await dansLaFileLourde(() => motsDeLaVoix(entree.fichier, segment.texte, duree));
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
  const retenue = resoudreEssai(id);
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

/**
 * PIPER, PAR SON MODULE (`python -m piper`, jamais le lanceur `venv/bin/piper`
 * dont l'entête vise un chemin disparu — MEM-4331), avec l'interpréteur du
 * dossier des outils : celui du dépôt principal depuis une copie de carte.
 */
function synthetiserParPiper(retenue: { modele: string; personne?: number }, texte: string, sortie: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const enfant = execFile(
      PYTHON(),
      ['-m', 'piper', '--model', retenue.modele, ...(retenue.personne === undefined ? [] : ['--speaker', String(retenue.personne)]), '--output_file', sortie],
      { timeout: 180_000 },
      (err) => (err ? reject(err) : resolve()),
    );
    enfant.stdin?.end(texte);
  });
}

/** Une voix d'essai est TOUJOURS une voix Piper du serveur : jamais Gemini, même mal nommée. */
function resoudreEssai(id: string) {
  const dossier = dossierDesOutils();
  if (dossier !== CONFIG.dataDir) {
    // Depuis une copie de carte, les modèles vivent dans le dépôt principal.
    const [modele, personne] = id.split('@');
    const fichier = path.join(dossier, 'models', 'piper', `${modele}.onnx`);
    if (!fs.existsSync(fichier)) return null;
    if (!personne) return { moteur: 'piper' as const, modele: fichier };
    try {
      const numero = JSON.parse(fs.readFileSync(`${fichier}.json`, 'utf8')).speaker_id_map?.[personne];
      return typeof numero === 'number' ? { moteur: 'piper' as const, modele: fichier, personne: numero } : null;
    } catch {
      return null;
    }
  }
  const r = resoudre(id);
  return r && r.moteur === 'piper' ? r : null;
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
export const MODELE_VOIX_OPENROUTER = `google/${MODELE_TTS_GEMINI}`;

function cleOpenRouter(): string | undefined {
  try {
    return cleOpenRouterDuRelais(listerAcces());
  } catch {
    return undefined;
  }
}
/** Ce que dit l'écran quand la clé manque : où la poser, sans jargon de fournisseur. */
export const RAISON_SANS_CLE_OPENROUTER = 'aucune clé OpenRouter dans le coffre-fort : la voix finale passe par l’espace OpenRouter de Beluga Build (fiche « OpenRouter — Haiko — relais IA »)';

let prixEnCache: { a: number; prix: { parJetonAudio: number; parJetonTexte: number } } | null = null;

/** Le prix de la voix Gemini chez le fournisseur, relu toutes les dix minutes — jamais écrit en dur. */
export async function prixDeLaVoix(): Promise<{ parJetonAudio: number; parJetonTexte: number }> {
  if (prixEnCache && Date.now() - prixEnCache.a < 10 * 60_000) return prixEnCache.prix;
  const cle = cleOpenRouter();
  const reponse = await fetch(`${OPENROUTER}/models?output_modalities=speech`, {
    headers: cle ? { Authorization: `Bearer ${cle}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!reponse.ok) throw new Error(`liste des prix illisible (${reponse.status})`);
  const corps = (await reponse.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
  const modele = corps.data?.find((m) => m.id === MODELE_VOIX_OPENROUTER);
  const audio = Number(modele?.pricing?.completion);
  const texte = Number(modele?.pricing?.prompt);
  if (!Number.isFinite(audio) || audio <= 0) throw new Error(`le prix de « ${MODELE_VOIX_OPENROUTER} » n’est pas publié`);
  prixEnCache = { a: Date.now(), prix: { parJetonAudio: audio, parJetonTexte: Number.isFinite(texte) ? texte : 0 } };
  return prixEnCache.prix;
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
 * LES PHRASES DE LA PROCHAINE PRISE : TOUTES celles de la création, dans
 * l'ordre de la ligne de temps, dès qu'une seule est à (re)faire — jamais une
 * phrase seule, qui sortirait dans un autre timbre ou un autre accent.
 * `refaire` : l'utilisateur redemande la prise alors que tout est déjà final
 * (bouton « Refaire la voix ») — toujours la prise ENTIÈRE.
 */
function voixPourSegments(creationId: string, voixDuProjet: string, refaire = false): SegmentVoix[] {
  const composition = compositionCourante(creationId);
  if (!composition) return [];
  if (!refaire && !priseARefaire(composition, voixDuProjet)) return [];
  return phrasesDeLaPrise(composition);
}

export interface DevisDeVoix {
  /** Toutes les phrases de la prise unique, dans l'ordre où elles seront dites. */
  segments: { id: string; texte: string; voix: string; dureeAudio?: number }[];
  secondes: number;
  plafond: number;
  modele: string;
  /** La clé OpenRouter du relais est au coffre : sans elle, rien ne peut partir (l'écran le dit et mène au coffre). */
  cle: boolean;
  solde: number | null;
}

/**
 * LE DEVIS, AVANT LE CLIC : le plafond de prix de la prise entière. Des
 * `segmentIds` éventuels (ancien protocole, outil de l'agent) ne réduisent
 * plus rien : une prise partielle n'existe pas. `refaire` (le clic humain
 * « Refaire la voix », jamais l'outil de l'agent) chiffre la prise entière même
 * quand toutes les phrases sont déjà en voix finale.
 */
export async function devisDesVoix(creationId: string, _segmentIds?: string[], options: { refaire?: boolean } = {}): Promise<Resultat<{ devis: DevisDeVoix }>> {
  const creation = lireCreation(creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  // UNE SEULE VOIX : celle du projet, pour chaque phrase — jamais un `voixFinale` resté sur un segment.
  const voix = voixFinaleDuProjet(assurerEspaceStudio(creation.projectId).voixFinale);
  const segments = voixPourSegments(creationId, voix, options.refaire === true);
  if (!segments.length) return { ok: false, raison: 'aucune voix à valider : toute la voix est déjà en voix finale' };
  const cle = !!cleOpenRouter();
  let prix;
  try {
    prix = await prixDeLaVoix();
  } catch (err: any) {
    return { ok: false, raison: `le prix ne peut pas être lu en direct (${err?.message ?? err}) : rien n’est lancé sans prix affiché` };
  }
  const d = devisVoix(segments, prix);
  const solde = await soldeOpenRouter();
  return {
    ok: true,
    devis: {
      segments: segments.map((s) => ({ id: s.id, texte: s.texte, voix, ...(s.dureeAudio ? { dureeAudio: s.dureeAudio } : {}) })),
      secondes: d.secondes,
      plafond: d.plafond,
      modele: MODELE_TTS_GEMINI,
      cle,
      solde: solde.solde,
    },
  };
}

/** Une voix Gemini PAR OPENROUTER, payée sur le crédit de l'espace Beluga Build. Rend ce qui a été débité. */
async function voixParOpenRouter(voix: string, texte: string, sortie: string, prix: { parJetonAudio: number; parJetonTexte: number }): Promise<number> {
  const cle = cleOpenRouter();
  if (!cle) throw new Error(RAISON_SANS_CLE_OPENROUTER);
  const reponse = await fetch(`${OPENROUTER}/audio/speech`, {
    method: 'POST',
    // Une prise entière de plusieurs minutes se fabrique en ≈ 35 s, mesuré le 07/10/2026 : large marge.
    signal: AbortSignal.timeout(240_000),
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELE_VOIX_OPENROUTER, input: texteVoixFinaleStudio(texte), voice: voix, response_format: 'pcm' }),
  });
  if (!reponse.ok) {
    const t = await reponse.text().catch(() => '');
    throw new Error(`OpenRouter a refusé la voix (${reponse.status}) : ${t.slice(0, 160)}`);
  }
  const brut = Buffer.from(await reponse.arrayBuffer());
  fs.writeFileSync(sortie, sonGeminiEnWav(brut, reponse.headers.get('content-type') ?? 'audio/pcm;rate=24000'));
  // Le montant RÉEL : la fiche de génération du fournisseur s'il la donne, sinon le tarif appliqué à la durée réelle.
  const generation = reponse.headers.get('x-generation-id');
  if (generation) {
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
  }
  const duree = await dureeDuFichier(sortie);
  return duree * 25 * prix.parJetonAudio + (texte.length / 4) * prix.parJetonTexte;
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
  if (!r.devis.cle) return { ok: false, raison: RAISON_SANS_CLE_OPENROUTER };
  const creation = lireCreation(creationId)!;
  if (r.devis.plafond > plafondVu + 1e-6) {
    return { ok: false, raison: `le prix a changé depuis l’affichage (${montantLisible(r.devis.plafond)} au lieu de ${montantLisible(plafondVu)}) : revois le devis avant de valider` };
  }
  const depense = creerDepense({
    projectId: creation.projectId,
    creationId,
    genre: 'voix',
    modele: MODELE_TTS_GEMINI,
    plafond: r.devis.plafond,
    raison: `${options.refaire ? 'Voix finale refaite' : 'Voix finale'} en une seule prise : ${r.devis.segments.length} phrase(s), ≈ ${Math.round(r.devis.secondes)} s`,
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
 * LA VOIX FINALE EN UNE SEULE PRISE. Toutes les phrases sont dites d'un seul
 * appel (un lot de plus seulement au-delà de `PLAFOND_SIGNES_PRISE`), les mots
 * de la prise sont reconnus, puis chaque phrase reçoit SON passage du fichier
 * commun (MEM-4384 : plusieurs segments, un fichier, des `debutMedia`
 * différents). TOUT OU RIEN : tant que la prise entière n'est pas fabriquée et
 * découpée, aucune phrase ne change ; elle se pose ensuite en UNE version.
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
  // Une des VINGT voix finales du Studio, jamais un nom reçu tel quel — la même pour toute la prise.
  const voix = estVoixFinaleStudio(segments[0]?.voix) ? segments[0]!.voix : VOIX_FINALE_PAR_DEFAUT;
  const depuis = Date.now();
  const secondesPrevues = devisVoix(segments, { parJetonAudio: 0, parJetonTexte: 0 }).secondes / MARGE_DUREE_VOIX_FINALE;
  // L'AVANCEMENT, lu par la fenêtre et le bouton « Mettre en production » : toutes les phrases avancent ensemble.
  const avancement: AvancementVoix = { faits: [], echecs: [], dureeMs: dureeEstimeeDeLaPrise(secondesPrevues), enCours: { id: PRISE_ENTIERE, depuis } };
  ecrireAvancement(depense, avancement);
  const fichiers: string[] = [];
  let depenseTotale = 0;
  let secondesDites = 0;
  try {
    const prix = await prixDeLaVoix();
    const prises: { fichier: string; duree: number; cout: number; phrases: { segmentId: string; texte: string; debut: number; fin: number; mots: MotHorodate[] }[] }[] = [];
    for (const lot of lotsDeLaPrise(segments.map((s) => s.texte))) {
      const phrases = lot.map((i) => segments[i]!);
      const estime = devisVoix(phrases, prix).plafond;
      if (depense.plafond !== null && depenseTotale + estime > depense.plafond + 1e-9) {
        throw new Error(`le plafond validé (${montantLisible(depense.plafond)}) serait dépassé : la voix reste comme avant`);
      }
      const texte = texteDeLaPrise(phrases.map((p) => p.texte));
      const fichier = fichierProvisoire('wav');
      fichiers.push(fichier);
      const cout = await voixParOpenRouter(voix, texte, fichier, prix);
      depenseTotale += cout;
      const duree = await dureeDuFichier(fichier);
      secondesDites += duree;
      const { mots, reconnus } = await dansLaFileLourde(() => motsDeLaVoix(fichier, texte, duree));
      if (!reconnus) log.warn('studio : prise de voix découpée au prorata, faute de mots reconnus');
      const bornes = bornesDesPhrases(phrases.map((p) => p.texte), mots, duree, await silencesDuSon(fichier));
      prises.push({ fichier, duree, cout, phrases: phrases.map((p, k) => ({ segmentId: p.id, texte: p.texte, ...bornes[k]! })) });
    }
    const pose = await poserLaPrise({ creationId: creation.id, voix, prises });
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
  voix: string;
  prises: { fichier: string; duree: number; cout: number; phrases: { segmentId: string; texte: string; debut: number; fin: number; mots: MotHorodate[] }[] }[];
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
      nom: `Voix finale — prise entière (${prise.phrases.length} phrase(s))`,
      attachmentId: jointe.attachment.id,
      mime: 'audio/wav',
      duree: prise.duree,
      usage: entree.voix,
      cout: prise.cout,
    });
    medias.push(media.id);
  }
  const posees: string[] = [];
  const ecartees: { id: string; raison: string }[] = [];
  let copie: Composition = JSON.parse(JSON.stringify(compositionCourante(entree.creationId)!));
  entree.prises.forEach((prise, rang) => {
    const total = prise.phrases.reduce((a, p) => a + Math.max(0, p.fin - p.debut), 0) || 1;
    for (const p of prise.phrases) {
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
      v.voixFinale = entree.voix;
      v.coutReel = Math.round(((prise.cout * Math.max(0, p.fin - p.debut)) / total) * 1e6) / 1e6;
      // Dans l'ordre de la ligne de temps : chaque recalage décale ce qui suit, la phrase suivante est relue après.
      copie = recaler(copie, p.segmentId, prise.duree, p.mots, { debut: p.debut, fin: p.fin });
      posees.push(p.segmentId);
    }
  });
  if (!posees.length) return { ok: false, raison: ecartees[0]?.raison ?? 'aucune phrase à poser' };
  const r = enregistrerVersion(entree.creationId, copie, 'voix finale posée (une seule prise)', 'systeme');
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

export function extraitsDisponibles(): { voix: string; genre: string; timbre: string; pret: boolean; cout?: number }[] {
  const couts = depensesDesExtraits();
  return VOIX_FINALES_STUDIO.map((v) => ({
    voix: v.id,
    genre: v.genre,
    timbre: v.timbre,
    pret: fs.existsSync(path.join(DOSSIER_EXTRAITS(), `${v.id}.wav`)),
    ...(couts[v.id] !== undefined ? { cout: couts[v.id] } : {}),
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
  const nom = `${voix.replace(/[^\w@.-]/g, '_')}.wav`;
  const fichier = path.join(DOSSIER_EXTRAITS(), nom);
  if (fs.existsSync(fichier)) return Promise.resolve({ ok: true, fichier });
  const deja = extraitsEnCours.get(voix);
  if (deja) return deja;
  const travail = (async (): Promise<{ ok: true; fichier: string } | { ok: false; raison: string }> => {
    fs.mkdirSync(DOSSIER_EXTRAITS(), { recursive: true });
    const provisoire = `${fichier}.${process.pid}.tmp`;
    try {
      if (essai) {
        const retenue = resoudreEssai(voix);
        if (!retenue) return { ok: false, raison: `la voix d’essai « ${voix} » n’est pas posée sur le serveur` };
        await dansLaFileLourde(() => synthetiserParPiper(retenue, PHRASE_EXTRAIT_STUDIO, provisoire));
      } else {
        const prix = await prixDeLaVoix();
        const cout = await voixParOpenRouter(voix, PHRASE_EXTRAIT_STUDIO, provisoire, prix);
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

/* ------------------------------------------------------------------ */
/* (e)(f)(g) Musique, image, clip : DEVIS d'abord, puis seulement sur clic */
/* ------------------------------------------------------------------ */

export const MODELE_MUSIQUE = 'google/lyria-3-clip-preview';
export const MODELE_CLIP = 'google/veo-3.1-lite';

async function tarifsDuClip(modele: string): Promise<Record<string, string> | undefined> {
  const cle = cleOpenRouter();
  const r = await fetch(`${OPENROUTER}/videos/models`, { headers: cle ? { Authorization: `Bearer ${cle}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return undefined;
  const corps = (await r.json()) as any;
  const liste: any[] = Array.isArray(corps) ? corps : corps.data ?? [];
  return liste.find((m) => m.id === modele)?.pricing_skus;
}

/**
 * UN DEVIS DE GÉNÉRATION (musique, image, clip). Rien n'est appelé : la
 * dépense naît « en attente », et seul le clic « Valider » de l'écran la fera
 * produire. Une image passe d'abord par Codex (abonnement, sans frais) ; un
 * prix que le fournisseur ne publie pas est DIT, jamais inventé.
 */
export async function devisDeGeneration(entree: {
  creationId: string;
  genre: 'musique' | 'image' | 'clip';
  consigne: string;
  duree?: number;
  format?: FormatStudio;
  avecSon?: boolean;
  raison: string;
  demandeePar: 'humain' | 'agent';
}): Promise<Resultat<{ depense: DepenseStudio }>> {
  const creation = lireCreation(entree.creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const consigne = entree.consigne.trim().slice(0, 2000);
  if (!consigne) return { ok: false, raison: 'la consigne est vide' };
  const format = entree.format ?? creation.formats[0] ?? '9:16';
  let modele: string;
  let plafond: number | null;
  const details: Record<string, unknown> = { consigne, format };
  if (entree.genre === 'clip') {
    const duree = [4, 6, 8].includes(Number(entree.duree)) ? Number(entree.duree) : 4;
    modele = MODELE_CLIP;
    plafond = devisClip(await tarifsDuClip(modele).catch(() => undefined), { duree, son: !!entree.avecSon, resolution: '720p' });
    if (plafond === null) return { ok: false, raison: 'le tarif du clip n’est pas publié en ce moment : rien n’est proposé sans prix' };
    Object.assign(details, { duree, avecSon: !!entree.avecSon, ratio: FORMATS_STUDIO[format].largeur > FORMATS_STUDIO[format].hauteur ? '16:9' : '9:16' });
  } else if (entree.genre === 'image') {
    modele = 'codex';
    plafond = 0;
    Object.assign(details, { voie: 'codex' });
  } else {
    modele = MODELE_MUSIQUE;
    plafond = null;
    Object.assign(details, { duree: Math.min(30, Math.max(5, Number(entree.duree) || 15)) });
  }
  return {
    ok: true,
    depense: creerDepense({
      projectId: creation.projectId,
      creationId: creation.id,
      genre: entree.genre,
      modele,
      plafond,
      raison: entree.raison.trim().slice(0, 400) || consigne.slice(0, 200),
      details,
      demandeePar: entree.demandeePar,
    }),
  };
}

/** Après le clic « Valider » : la génération part, sa dépense se solde. */
export async function lancerGenerationValidee(depenseId: string): Promise<void> {
  const depense = lireDepense(depenseId);
  if (!depense || depense.genre === 'voix') return;
  const refus = raisonDepenseRefusee(depense, { genre: depense.genre, creationId: depense.creationId });
  if (refus) {
    solderDepense(depenseId, { erreur: refus });
    return;
  }
  const creation = lireCreation(depense.creationId);
  if (!creation) return;
  try {
    let fichier: string;
    let mime: string;
    let cout = 0;
    if (depense.genre === 'image') {
      ({ fichier, mime } = await dansLaFileLourde(() => imageParCodex(String(depense.details.consigne ?? ''), String(depense.details.format ?? '1:1'))));
    } else if (depense.genre === 'clip') {
      ({ fichier, mime, cout } = await clipParOpenRouter(depense));
    } else {
      ({ fichier, mime, cout } = await musiqueParOpenRouter(depense));
    }
    const jointe = await joindreUnFichier({ projectId: creation.projectId, agentId: creation.agentId ?? '', fichier, nom: `${depense.genre}-${depense.id}${path.extname(fichier)}` });
    fs.rmSync(fichier, { force: true });
    if (!jointe.ok) throw new Error(jointe.refus);
    const genre: MediaStudio['genre'] = depense.genre === 'image' ? 'image' : depense.genre === 'clip' ? 'video' : 'audio';
    let duree: number | undefined;
    if (genre !== 'image') duree = await dureeDuFichier(cheminDuJoint(jointe.attachment.id)).catch(() => undefined);
    ajouterMedia({
      projectId: creation.projectId,
      creationId: creation.id,
      genre,
      provenance: 'genere',
      nom: `${depense.genre === 'image' ? 'Image' : depense.genre === 'clip' ? 'Clip' : 'Musique'} — ${String(depense.details.consigne ?? '').slice(0, 50)}`,
      attachmentId: jointe.attachment.id,
      mime,
      ...(duree ? { duree } : {}),
      licence: depense.genre === 'image' ? 'Générée par Codex pour ce projet' : `Générée par ${depense.modele} pour ce projet`,
      cout,
    });
    solderDepense(depenseId, { montantReel: cout });
  } catch (err: any) {
    solderDepense(depenseId, { erreur: String(err?.message ?? err).slice(0, 300) });
  }
}

function cheminDuJoint(attachmentId: string): string {
  const piece = store.getAttachment(attachmentId);
  return piece ? cheminDePieceJointe(piece) : '';
}

/** (f) Une image par le générateur de Codex (abonnement), UN appel à la fois. */
async function imageParCodex(consigne: string, format: string): Promise<{ fichier: string; mime: string }> {
  const dossierImages = path.join(os.homedir(), '.codex', 'generated_images');
  const avant = Date.now();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-codex-'));
  const forme = format === '16:9' ? 'landscape 3:2' : format === '1:1' ? 'square' : 'portrait 2:3';
  const texte = `Produce exactly ONE image with your built-in image generation tool. Do not write code, do not run shell commands. Format: ${forme}. ${consigne}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const enfant = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', temp, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let sortie = '';
      const minuteur = setTimeout(() => enfant.kill('SIGTERM'), 6 * 60_000);
      enfant.stdout.on('data', (d) => (sortie += String(d)).length > 20_000 && (sortie = sortie.slice(-20_000)));
      enfant.stderr.on('data', (d) => (sortie += String(d)).length > 20_000 && (sortie = sortie.slice(-20_000)));
      enfant.on('close', (code) => {
        clearTimeout(minuteur);
        if (/usage_limit_reached/.test(sortie)) reject(new Error('quota d’images de Codex épuisé : réessaie plus tard (aucun passage au payant)'));
        else if (code === 0) resolve();
        else reject(new Error(`Codex n’a pas rendu d’image (code ${code})`));
      });
      enfant.stdin.end(texte);
    });
    let plusRecente: { chemin: string; date: number } | null = null;
    const parcourir = (dossier: string) => {
      for (const nom of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) {
        const chemin = path.join(dossier, nom);
        const st = fs.statSync(chemin);
        if (st.isDirectory()) parcourir(chemin);
        else if (/\.(png|webp|jpe?g)$/i.test(nom) && st.mtimeMs >= avant && (!plusRecente || st.mtimeMs > plusRecente.date)) plusRecente = { chemin, date: st.mtimeMs };
      }
    };
    parcourir(dossierImages);
    if (!plusRecente) throw new Error('Codex a fini sans image');
    const cible = fichierProvisoire(path.extname((plusRecente as { chemin: string }).chemin).slice(1));
    fs.copyFileSync((plusRecente as { chemin: string }).chemin, cible);
    return { fichier: cible, mime: cible.endsWith('.png') ? 'image/png' : cible.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** (g) Un clip filmé par IA : travail ASYNCHRONE chez OpenRouter, suivi jusqu'au fichier. */
async function clipParOpenRouter(depense: DepenseStudio): Promise<{ fichier: string; mime: string; cout: number }> {
  const cle = cleOpenRouter();
  if (!cle) throw new Error('aucune clé OpenRouter au coffre-fort');
  const d = depense.details as any;
  const depart = await fetch(`${OPENROUTER}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: depense.modele, prompt: d.consigne, aspect_ratio: d.ratio, duration: d.duree, resolution: '720p', generate_audio: !!d.avecSon }),
    signal: AbortSignal.timeout(60_000),
  });
  const corps = (await depart.json().catch(() => ({}))) as any;
  if (!depart.ok || !corps.id) throw new Error(`OpenRouter a refusé le clip (${depart.status}) : ${JSON.stringify(corps).slice(0, 160)}`);
  const fin = Date.now() + 15 * 60_000;
  let etat: any = corps;
  while (Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 10_000));
    const r = await fetch(`${OPENROUTER}/videos/${encodeURIComponent(corps.id)}`, { headers: { Authorization: `Bearer ${cle}` } });
    etat = await r.json().catch(() => ({}));
    if (/fail|error/i.test(String(etat.status))) throw new Error(`le clip a échoué chez le fournisseur : ${String(etat.error ?? etat.status).slice(0, 160)}`);
    if (/complete|succeed|done/i.test(String(etat.status))) break;
  }
  const contenu = await fetch(`${OPENROUTER}/videos/${encodeURIComponent(corps.id)}/content`, { headers: { Authorization: `Bearer ${cle}` } });
  if (!contenu.ok) throw new Error(`le clip n’a pas pu être téléchargé (${contenu.status})`);
  const fichier = fichierProvisoire('mp4');
  fs.writeFileSync(fichier, Buffer.from(await contenu.arrayBuffer()));
  const cout = Number(etat?.usage?.cost ?? etat?.cost ?? depense.plafond ?? 0);
  return { fichier, mime: 'video/mp4', cout: Number.isFinite(cout) ? cout : depense.plafond ?? 0 };
}

/** (e) Une musique générée (Lyria par OpenRouter), seulement sur dépense validée. */
async function musiqueParOpenRouter(depense: DepenseStudio): Promise<{ fichier: string; mime: string; cout: number }> {
  const cle = cleOpenRouter();
  if (!cle) throw new Error('aucune clé OpenRouter au coffre-fort');
  const d = depense.details as any;
  const r = await fetch(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: depense.modele,
      modalities: ['audio'],
      audio: { format: 'mp3' },
      messages: [{ role: 'user', content: `${d.consigne} — instrumental, about ${d.duree} seconds.` }],
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const corps = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(`OpenRouter a refusé la musique (${r.status}) : ${JSON.stringify(corps).slice(0, 160)}`);
  const donnees = corps?.choices?.[0]?.message?.audio?.data;
  if (!donnees) throw new Error('le fournisseur a répondu sans musique');
  const fichier = fichierProvisoire('mp3');
  fs.writeFileSync(fichier, Buffer.from(donnees, 'base64'));
  return { fichier, mime: 'audio/mpeg', cout: Number(corps?.usage?.cost ?? 0) || 0 };
}
