import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EtatDuPoint, composerLePoint, raisonParlee } from './digest.js';
import { VOIX_LONGUEUR_MAX } from '@haikodev/shared';
import * as store from './store.js';
import { CONFIG, PATHS } from './config.js';
import { cachedQuotas } from './accounts.js';
import { runningAgentIds } from './runtime.js';
import { log } from './logger.js';
import { echelleDeVitesse } from '@haikodev/shared';

const execFileAsync = promisify(execFile);

const VENV = path.join(CONFIG.dataDir, 'venv');
const PYTHON = path.join(VENV, 'bin', 'python');
const PIPER = path.join(VENV, 'bin', 'piper');
const VOICES = path.join(CONFIG.dataDir, 'models', 'piper');
const DEFAULT_VOICE = 'fr_FR-siwis-medium';
const PIPER_VOICE = path.join(VOICES, `${DEFAULT_VOICE}.onnx`);
const TRANSCRIBE_SCRIPT = path.join(CONFIG.selfPath, 'scripts', 'transcribe.py');

/* ------------------------------------------------------------------ */
/* Le second moteur : Kokoro, à CÔTÉ de Piper                          */
/* ------------------------------------------------------------------ */

/**
 * Kokoro n'a ni « medium » ni « high » : c'est UN modèle unique, multilingue,
 * accompagné d'un fichier qui porte toutes ses voix. Il vit dans son propre
 * environnement Python (`venv-kokoro`) pour ne rien changer à celui de Piper.
 *
 * Il ne REMPLACE pas Piper : les deux cohabitent, la voix choisie décidant du
 * moteur employé. Une voix Kokoro se nomme « kokoro:<voix> », ce qui la
 * distingue sans ambiguïté d'un modèle Piper.
 */
const KOKORO_VENV = path.join(CONFIG.dataDir, 'venv-kokoro');
const KOKORO_PYTHON = path.join(KOKORO_VENV, 'bin', 'python');
const KOKORO_DIR = path.join(CONFIG.dataDir, 'models', 'kokoro');
const KOKORO_MODELE = path.join(KOKORO_DIR, 'kokoro-v1.0.onnx');
const KOKORO_VOIX = path.join(KOKORO_DIR, 'voices-v1.0.bin');
const KOKORO_SCRIPT = path.join(CONFIG.selfPath, 'scripts', 'kokoro-voix.py');
const KOKORO_PREFIXE = 'kokoro:';

/**
 * Les voix Kokoro proposées. La gamme française de ce moteur est MINCE : le
 * modèle porte cinquante-quatre voix, dont une SEULE en français (`ff_siwis`).
 * On ne montre que celle-là : les voix anglaises ne serviraient à rien pour un
 * assistant qui parle français, et allongeraient la liste de cinquante lignes.
 */
const VOIX_KOKORO: Record<string, { label: string; description: string }> = {
  ff_siwis: {
    label: 'Camille',
    description: 'Voix de femme, moteur Kokoro. La seule voix française de ce moteur.',
  },
};

/** Kokoro est-il réellement posé sur ce serveur ? */
function kokoroInstalle(): boolean {
  return (
    fs.existsSync(KOKORO_PYTHON) &&
    fs.existsSync(KOKORO_MODELE) &&
    fs.existsSync(KOKORO_VOIX) &&
    fs.existsSync(KOKORO_SCRIPT)
  );
}

/* ------------------------------------------------------------------ */
/* Les voix disponibles                                                */
/* ------------------------------------------------------------------ */

/**
 * Un fichier de voix peut contenir PLUSIEURS personnes (le modèle « upmc » en
 * porte deux). Une voix se nomme donc « modèle » ou « modèle arobase
 * personne » : c'est cet identifiant qui est enregistré dans les préférences.
 */
const SEPARATEUR = '@';

/**
 * Les étiquettes tenues à la main. Les noms techniques des modèles sont des
 * noms de jeux de données (« siwis », « upmc ») : ils ne disent rien à
 * l'oreille de personne. Une voix installée mais absente de cette table
 * s'affiche quand même, sous son nom brut.
 */
const ETIQUETTES: Record<string, { label: string; description: string }> = {
  'fr_FR-siwis-medium': { label: 'Claire', description: 'Voix de femme, posée et nette. La voix d\'origine.' },
  'fr_FR-tom-medium': { label: 'Thomas', description: 'Voix d\'homme, chaleureuse et très articulée.' },
  [`fr_FR-upmc-medium${SEPARATEUR}pierre`]: { label: 'Pierre', description: 'Voix d\'homme, grave et rapide.' },
  [`fr_FR-upmc-medium${SEPARATEUR}jessica`]: { label: 'Jessica', description: 'Voix de femme, douce et plus feutrée.' },
};

export interface VoiceInfo {
  id: string;
  label: string;
  description: string;
}

/**
 * Une voix RÉSOLUE : le fichier de modèle à charger, et de quoi le faire
 * parler. `moteur` dit lequel des deux chemins de synthèse emprunter ; il
 * entre aussi dans l'empreinte du cache, sans quoi deux voix homonymes de
 * moteurs différents se partageraient le même son.
 */
export interface VoixResolue {
  moteur: 'piper' | 'kokoro';
  /** Le fichier de modèle : une voix Piper, ou le modèle unique de Kokoro. */
  modele: string;
  /** Piper : le numéro de la personne dans un modèle qui en porte plusieurs. */
  personne?: number;
  /** Kokoro : le nom de la voix à prendre dans le fichier de voix. */
  voix?: string;
}

/** Le fichier de modèle d'une voix, et la personne à demander dedans. */
function resoudre(id: string): VoixResolue | null {
  if (id.startsWith(KOKORO_PREFIXE)) {
    const voix = id.slice(KOKORO_PREFIXE.length);
    if (!VOIX_KOKORO[voix] || !kokoroInstalle()) return null;
    return { moteur: 'kokoro', modele: KOKORO_MODELE, voix };
  }

  const [modele, personne] = id.split(SEPARATEUR);
  const fichier = path.join(VOICES, `${modele}.onnx`);
  if (!fichier.startsWith(VOICES) || !fs.existsSync(fichier)) return null;
  if (!personne) return { moteur: 'piper', modele: fichier };
  try {
    const carte = JSON.parse(fs.readFileSync(`${fichier}.json`, 'utf8')).speaker_id_map ?? {};
    const numero = carte[personne];
    return typeof numero === 'number' ? { moteur: 'piper', modele: fichier, personne: numero } : null;
  } catch {
    return null;
  }
}

/**
 * Les voix réellement installées sur le serveur, chacune sous un nom lisible.
 * Un modèle à plusieurs personnes compte pour autant de voix.
 */
export function listVoices(): VoiceInfo[] {
  let fichiers: string[];
  try {
    fichiers = fs.readdirSync(VOICES).filter((name) => name.endsWith('.onnx'));
  } catch {
    return [];
  }

  const voix: VoiceInfo[] = [];
  for (const fichier of fichiers.sort()) {
    const modele = fichier.replace(/\.onnx$/, '');
    let personnes: string[] = [];
    try {
      personnes = Object.keys(JSON.parse(fs.readFileSync(path.join(VOICES, `${fichier}.json`), 'utf8')).speaker_id_map ?? {});
    } catch {
      /* pas de fiche lisible : une seule personne dans ce fichier */
    }
    const ids = personnes.length > 1 ? personnes.map((p) => `${modele}${SEPARATEUR}${p}`) : [modele];
    for (const id of ids) {
      const connue = ETIQUETTES[id];
      voix.push({
        id,
        label: connue?.label ?? id.split(SEPARATEUR).pop() ?? id,
        description: connue?.description ?? 'Voix installée sur le serveur.',
      });
    }
  }

  // Les voix de l'autre moteur entrent dans la MÊME liste : côté réglages, une
  // voix est une voix — le moteur qui la fabrique ne regarde que le serveur.
  if (kokoroInstalle()) {
    for (const [nom, connue] of Object.entries(VOIX_KOKORO)) {
      voix.push({ id: `${KOKORO_PREFIXE}${nom}`, label: connue.label, description: connue.description });
    }
  }

  // La voix d'origine en tête : c'est celle qu'on entend sans rien régler.
  return voix.sort((a, b) => (a.id === DEFAULT_VOICE ? -1 : b.id === DEFAULT_VOICE ? 1 : a.label.localeCompare(b.label)));
}

/**
 * La voix lue est celle choisie dans les préférences. Si cette voix n'est pas
 * (ou plus) sur le serveur, on retombe sur la voix livrée d'origine : mieux
 * vaut une autre voix que pas de son du tout.
 */
export function voiceChoisie(demandee?: string): VoixResolue {
  const candidats: string[] = [];
  // Le deux-points sépare le moteur du nom de la voix : il fait partie des
  // signes permis, au même titre que l'arobase des personnes d'un modèle.
  if (demandee) candidats.push(demandee.replace(/[^\w.:@-]/g, ''));
  try {
    if (store.getSettings().ttsVoice) candidats.push(store.getSettings().ttsVoice);
  } catch {
    /* réglages illisibles : la voix d'origine fera l'affaire */
  }
  candidats.push(DEFAULT_VOICE, ...listVoices().map((v) => v.id));

  for (const candidat of candidats) {
    const resolue = resoudre(candidat);
    if (resolue) return resolue;
  }
  return { moteur: 'piper', modele: PIPER_VOICE };
}

/** La phrase d'essai : courte, avec un nombre et une heure, comme un vrai point. */
export const EXTRAIT =
  'Bonjour. Il est quatorze heures trente. Deux tâches sont parties en ligne hier soir, et trois attendent votre feu vert.';

export function voiceAvailable(): { transcribe: boolean; speak: boolean } {
  return {
    transcribe: fs.existsSync(PYTHON) && fs.existsSync(TRANSCRIBE_SCRIPT),
    // Un seul des deux moteurs suffit à faire parler le serveur.
    speak: (fs.existsSync(PIPER) || kokoroInstalle()) && listVoices().length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Dictée : les transcriptions passent UNE PAR UNE dans une file       */
/* ------------------------------------------------------------------ */

let queue: Promise<unknown> = Promise.resolve();

export function transcribe(audio: Buffer, extension = 'webm'): Promise<{ ok: boolean; text?: string; error?: string }> {
  const task = queue.then(() => runTranscription(audio, extension));
  queue = task.catch(() => undefined);
  return task;
}

async function runTranscription(
  audio: Buffer,
  extension: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const available = voiceAvailable();
  if (!available.transcribe) {
    return { ok: false, error: 'moteur de transcription absent du serveur' };
  }
  const file = path.join(PATHS.audio, `dictee-${crypto.randomBytes(6).toString('hex')}.${extension}`);
  fs.mkdirSync(PATHS.audio, { recursive: true });
  fs.writeFileSync(file, audio);
  try {
    const { stdout } = await execFileAsync(PYTHON, [TRANSCRIBE_SCRIPT, file], {
      timeout: 300000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, OMP_NUM_THREADS: '1' },
    });
    const text = stdout.trim();
    return { ok: true, text };
  } catch (err: any) {
    log.warn('transcription impossible', err?.message);
    return { ok: false, error: 'transcription impossible' };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* fichier déjà parti */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Le résumé vocal du tableau (PLAN §22)                               */
/* ------------------------------------------------------------------ */

/**
 * Rassemble l'état du tableau, puis le confie au rédacteur pour l'oreille.
 * Ici on ne fait que LIRE et trier ; toute la mise en phrases est dans
 * `digest.ts`, ce qui permet de l'écouter et de la tester séparément.
 */
export function digestText(projectId?: string): string {
  const projects = (projectId ? [store.getProject(projectId)] : store.listProjects()).filter(
    (p): p is NonNullable<typeof p> => !!p,
  );
  const maintenant = Date.now();
  const depuisHier = maintenant - 24 * 3600 * 1000;
  const nomDuProjet = new Map(projects.map((p) => [p.id, p.name]));

  const etat: EtatDuPoint = {
    maintenant,
    projetUnique: projectId ? projects[0]?.name : undefined,
    questions: [],
    bloquees: [],
    aClore: [],
    propositions: [],
    aPublier: [],
    aValider: [],
    enCours: [],
    publiees: [],
  };

  for (const { projectId: pid, question } of store.pendingQuestions()) {
    if (!nomDuProjet.has(pid)) continue;
    etat.questions.push({ projet: nomDuProjet.get(pid)!, titre: question, detail: question });
  }

  for (const { projectId: pid, title } of store.pendingProposals(projectId)) {
    if (!nomDuProjet.has(pid)) continue;
    etat.propositions.push({ projet: nomDuProjet.get(pid)!, titre: title });
  }

  const enMarche = new Set(runningAgentIds());

  for (const project of projects) {
    const projet = project.name;
    for (const card of store.listCards(project.id)) {
      const dite = { projet, titre: card.title };
      if (card.deployedAt && card.deployedAt > depuisHier) {
        etat.publiees.push({ ...dite, quand: card.deployedAt });
      }
      switch (card.column) {
        case 'running': {
          // Une carte reste « en cours » même quand son agent a fini : la
          // clôture est un geste de l'utilisateur (PLAN §4). Trois situations
          // très différentes à l'oreille : ça travaille, c'est fini, c'est en
          // panne. L'état de l'agent tranche, pas la colonne.
          if (card.agentId && enMarche.has(card.agentId)) {
            etat.enCours.push(dite);
            break;
          }
          const agent = card.agentId ? store.getAgent(card.agentId) : store.getAgentByCard(card.id);
          if (agent?.status === 'done') {
            etat.aClore.push(dite);
          } else if (agent) {
            etat.bloquees.push({ ...dite, detail: raisonParlee(card.scheduling?.lastError) });
          } else {
            etat.enCours.push(dite);
          }
          break;
        }
        case 'planned':
          if (card.scheduling?.waitingReason) {
            etat.bloquees.push({ ...dite, detail: raisonParlee(card.scheduling.waitingReason) });
          }
          break;
        case 'to_deploy':
          if (!card.deployedAt) etat.aPublier.push(dite);
          break;
        case 'todo':
          etat.aValider.push(dite);
          break;
        default:
          break;
      }
    }
  }

  const quotas = cachedQuotas();
  if (quotas.length) {
    const worst = quotas
      .map((q) => ({ compte: q.label, pourcent: Math.max(q.session?.usedPct ?? 0, q.weekly?.usedPct ?? 0) }))
      .sort((a, b) => b.pourcent - a.pourcent)[0];
    etat.quota = worst;
  }

  return composerLePoint(etat);
}

/* ------------------------------------------------------------------ */
/* La mémoire des sons : une phrase déjà dite ne se refait jamais       */
/* ------------------------------------------------------------------ */

/**
 * Les sons déjà fabriqués sont RANGÉS dans un sous-dossier à eux, sous un nom
 * qui découle du texte ET de la voix : même phrase, même voix, même fichier.
 * Une réécoute — ou une annonce préparée d'avance — repart alors du fichier
 * gardé, sans relancer Piper. Le dossier ne grossit pas sans fin : au-delà de
 * `CACHE_SONS_MAX` fichiers, les plus vieux tombent (`rangerLeCache`).
 */
const CACHE_SONS = path.join(PATHS.audio, 'cache');
const CACHE_SONS_MAX = 200;

/**
 * L'empreinte d'un son : le MOTEUR, la voix résolue, la vitesse et le texte.
 * Le moteur en fait partie — la même phrase dite par Piper et par Kokoro donne
 * deux sons différents, donc deux fichiers différents.
 */
export function cleDuSon(retenue: VoixResolue, texte: string, echelle: number): string {
  return crypto
    .createHash('sha256')
    .update(
      `${retenue.moteur} ${retenue.modele} ${retenue.personne ?? ''} ${retenue.voix ?? ''} ${echelle} ${texte}`,
    )
    .digest('hex')
    .slice(0, 32);
}

/**
 * Une synthèse déjà EN COURS pour une même empreinte n'est pas relancée : le
 * navigateur qui demande le son pendant qu'on le prépare d'avance attend le
 * MÊME travail, jamais un second Piper sur la même phrase.
 */
const enCours = new Map<string, Promise<{ ok: boolean; file?: string; error?: string }>>();

/** Ne garde que les `CACHE_SONS_MAX` sons les plus récents ; efface le reste. */
function rangerLeCache(): void {
  try {
    const fichiers = fs
      .readdirSync(CACHE_SONS)
      .filter((n) => n.endsWith('.wav'))
      .map((n) => {
        const chemin = path.join(CACHE_SONS, n);
        return { chemin, age: fs.statSync(chemin).mtimeMs };
      })
      .sort((a, b) => b.age - a.age);
    for (const trop of fichiers.slice(CACHE_SONS_MAX)) fs.unlinkSync(trop.chemin);
  } catch {
    /* dossier absent ou fichier déjà parti : rien à ranger */
  }
}

/**
 * Le texte tel que Piper le recevra : borné à la longueur d'une annonce et
 * débarrassé de ses espaces de bord. Appliqué au même endroit côté adresse
 * `/api/speak` et côté préparation d'avance, pour que les deux tombent sur la
 * MÊME empreinte — donc le même fichier.
 */
export function normaliserTexteVoix(texte: string): string {
  return texte.slice(0, VOIX_LONGUEUR_MAX).trim();
}

/**
 * La vitesse lue est celle passée à l'appel (l'essai en impose une), sinon
 * celle des préférences : ainsi TOUTES les paroles — point du jour, annonces
 * automatiques, réécoutes — suivent le réglage sans que le navigateur ait à le
 * répéter à chaque fois.
 */
function vitesseChoisie(vitesse?: string): number {
  if (vitesse) return echelleDeVitesse(vitesse);
  try {
    return echelleDeVitesse(store.getSettings().voixVitesse);
  } catch {
    return echelleDeVitesse();
  }
}

/**
 * Lance le moteur qui convient et lui fait écrire le son demandé. C'est le SEUL
 * endroit où les deux moteurs diffèrent : au-dessus (cache, empreinte, file
 * d'attente) et en dessous (adresse `/api/speak`, essai de voix), tout est
 * commun.
 *
 * Les deux prennent le texte sur leur entrée standard et rendent un WAV, et
 * tous deux reçoivent la MÊME échelle de vitesse : le script de Kokoro se
 * charge de la retourner, ce moteur comptant en vitesse là où Piper compte en
 * longueur.
 */
function lancerLaSynthese(
  retenue: VoixResolue,
  texte: string,
  echelle: number,
  sortie: string,
): Promise<void> {
  const [commande, arguments_] =
    retenue.moteur === 'kokoro'
      ? [
          KOKORO_PYTHON,
          [
            KOKORO_SCRIPT,
            '--model',
            retenue.modele,
            '--voices',
            KOKORO_VOIX,
            '--voice',
            String(retenue.voix),
            '--length-scale',
            String(echelle),
            '--output-file',
            sortie,
          ],
        ]
      : [
          PIPER,
          [
            '--model',
            retenue.modele,
            ...(retenue.personne === undefined ? [] : ['--speaker', String(retenue.personne)]),
            '--length_scale',
            String(echelle),
            '--output_file',
            sortie,
          ],
        ];

  return new Promise<void>((resolve, reject) => {
    const child = execFile(commande, arguments_, { timeout: 180000 }, (err) =>
      err ? reject(err) : resolve(),
    );
    child.stdin?.write(texte);
    child.stdin?.end();
  });
}

/**
 * Fabrique un fichier audio ordinaire, lisible partout. Sans voix précisée,
 * c'est celle des préférences — l'extrait d'essai, lui, en impose une ; de même
 * pour la vitesse.
 */
export async function speak(
  text: string,
  voix?: string,
  vitesse?: string,
): Promise<{ ok: boolean; file?: string; error?: string }> {
  const available = voiceAvailable();
  if (!available.speak) return { ok: false, error: 'voix absente du serveur' };

  const retenue = voiceChoisie(voix);
  const echelle = vitesseChoisie(vitesse);
  const cle = cleDuSon(retenue, text, echelle);
  const file = path.join(CACHE_SONS, `${cle}.wav`);

  // Déjà fabriqué : on le rend tel quel, et on rafraîchit sa date pour qu'un son
  // souvent réécouté ne soit pas emporté par le nettoyage.
  if (fs.existsSync(file)) {
    try {
      const maintenant = new Date();
      fs.utimesSync(file, maintenant, maintenant);
    } catch {
      /* date non modifiable : sans importance */
    }
    return { ok: true, file };
  }

  // Déjà en cours de fabrication (préparation d'avance) : on attend le même son.
  const dejaLa = enCours.get(cle);
  if (dejaLa) return dejaLa;

  const travail = (async () => {
    fs.mkdirSync(CACHE_SONS, { recursive: true });
    // On écrit d'abord dans un fichier temporaire, renommé à la fin : une
    // lecture concurrente ne tombe jamais sur un son à moitié écrit.
    const provisoire = path.join(CACHE_SONS, `.tmp-${crypto.randomBytes(6).toString('hex')}.wav`);
    try {
      await lancerLaSynthese(retenue, text, echelle, provisoire);
      fs.renameSync(provisoire, file);
      rangerLeCache();
      return { ok: true, file };
    } catch (err: any) {
      log.warn('synthèse vocale impossible', err?.message);
      try {
        fs.unlinkSync(provisoire);
      } catch {
        /* rien à retirer */
      }
      return { ok: false, error: 'synthèse vocale impossible' };
    }
  })();

  enCours.set(cle, travail);
  try {
    return await travail;
  } finally {
    enCours.delete(cle);
  }
}

/**
 * Prépare d'avance le son d'une phrase d'annonce, sans bloquer l'appelant : le
 * fichier est ainsi déjà là quand le navigateur le demande, et l'annonce part
 * sans délai perceptible. Un échec de synthèse est avalé — le navigateur
 * retombera sur sa propre voix, comme aujourd'hui.
 */
export function precharger(texte: string): void {
  const t = normaliserTexteVoix(texte);
  if (!t || !voiceAvailable().speak) return;
  void speak(t).catch(() => undefined);
}

/** Les premières phrases COMPLÈTES d'un texte, sans jamais couper un mot. */
function phrasesEntieres(texte: string, maximum: number): string {
  if (texte.length <= maximum) return texte;
  let sortie = '';
  for (const phrase of texte.split(/(?<=[.?!])\s+/)) {
    if (sortie && (sortie + ' ' + phrase).length > maximum) break;
    sortie = sortie ? `${sortie} ${phrase}` : phrase;
  }
  return sortie || texte.slice(0, maximum);
}

/**
 * Le rendez-vous quotidien (PLAN §22) : à l'heure choisie, le point du jour est
 * préparé et arrive en notification ; un appui lance la lecture.
 */
export function scheduleDailyDigest(hourGetter: () => number | undefined): NodeJS.Timeout {
  let lastDay = -1;
  return setInterval(
    async () => {
      const hour = hourGetter();
      if (hour === undefined) return;
      const now = new Date();
      if (now.getHours() !== hour || now.getDate() === lastDay) return;
      lastDay = now.getDate();

      const text = digestText();
      // L'audio est fabriqué à l'avance : au clic, la lecture démarre tout de suite.
      const spoken = await speak(text);
      const { notify } = await import('./notify.js');
      // Le point du jour attend qu'on l'ouvre : il n'appelle aucune décision,
      // il se signale donc dans l'application seulement.
      notify({
        motif: 'point-du-jour',
        title: 'Le point du jour est prêt',
        // La notification s'arrête sur une phrase entière : un texte coupé au
        // milieu d'un mot donne l'impression que quelque chose s'est perdu.
        body: phrasesEntieres(text, 200),
      });
      log.info(`point du jour préparé${spoken.ok ? ' (avec audio)' : ''}`);
    },
    5 * 60 * 1000,
  );
}

export function purgeOldAudio(): void {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const entry of fs.readdirSync(PATHS.audio)) {
      const full = path.join(PATHS.audio, entry);
      const stat = fs.statSync(full);
      // Le sous-dossier des sons gardés se nettoie tout seul (`rangerLeCache`) :
      // on ne le touche pas ici, un `unlinkSync` sur un dossier échouerait.
      if (stat.isDirectory()) continue;
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* rien à purger */
  }
}
