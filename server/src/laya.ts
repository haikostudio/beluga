/**
 * FAIRE TOURNER LAYA — le processus, et rien que lui.
 *
 * Les règles (où vit le modèle, quels délais, quel seuil, comment se lit une
 * réponse) vivent dans `shared/src/laya.ts`, testables sans modèle. Ici :
 * trouver l'installation, lancer le processus Python UNE fois, lui passer les
 * questions une à une, l'arrêter au repos.
 *
 * TOUT ÉCHEC REND « RIEN ». Installation absente, mémoire trop juste, modèle
 * qui ne se charge pas, délai dépassé, réponse illisible : `interrogerLaya`
 * rend `undefined` et l'appelant reprend le chemin qu'il avait avant. Aucune
 * exception ne sort d'ici.
 *
 * POURQUOI UN PROCESSUS QUI RESTE : le modèle met ~11 s à se charger et juge
 * ensuite en 0,2 s. Le relancer à chaque question (comme Needle 3 le faisait,
 * qui relisait 35 Mo à chaque verdict) coûterait cinquante fois le jugement.
 * Il reste donc allumé tant qu'on l'interroge, et s'arrête après
 * `REPOS_DE_LAYA_MS` de silence : 1,7 Go ne se gardent pas pour rien.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import {
  CACHE_LAYA,
  DELAI_LAYA_MS,
  DOSSIER_LAYA,
  LONGUEUR_LAYA,
  MEMOIRE_LIBRE_MIN_MO,
  PYTHON_LAYA,
  REPOS_DE_LAYA_MS,
  etatPourLaya,
  type QuestionDuJuge,
  type ReponseBruteDeLaya,
} from '@beluga/shared';

import { CONFIG, ROOT } from './config.js';
import { log } from './logger.js';

/* ------------------------------------------------------------------ */
/* OÙ EST LAYA                                                          */
/* ------------------------------------------------------------------ */

/**
 * OÙ CHERCHER LE MODÈLE, DANS L'ORDRE (MEM-3233).
 *
 * L'environnement Python et les poids ne sont PAS versionnés (1,2 Go + 650 Mo) :
 * ils s'installent sur la machine (`scripts/installer-laya.mjs`) sous
 * `outils/laya/`. Un dossier imposé (`BELUGA_LAYA_DIR`) est le SEUL regardé :
 * c'est ce qui permet à un contrôle de rendre Laya absent ou factice.
 */
function dossiersCandidats(): string[] {
  const impose = process.env.BELUGA_LAYA_DIR?.trim();
  if (impose) return [impose];
  return [path.join(ROOT, DOSSIER_LAYA), path.join(CONFIG.depotDuDemon, DOSSIER_LAYA)];
}

export interface InstallationLaya {
  dossier: string;
  python: string;
}

/** Le modèle installé, s'il l'est. Relu à chaque appel : une installation en cours doit se voir. */
export function installationLaya(): InstallationLaya | undefined {
  for (const dossier of dossiersCandidats()) {
    const python = path.join(dossier, PYTHON_LAYA);
    try {
      if (fs.existsSync(python)) return { dossier, python };
    } catch {
      /* un dossier illisible n'est pas une panne : on regarde le suivant */
    }
  }
  return undefined;
}

/** Laya est-il installé ? La question que se posent l'écran et les appelants. */
export function layaPret(): boolean {
  try {
    return !!installationLaya();
  } catch {
    return false;
  }
}

/** Le script du service, versionné avec le démon. */
function scriptDuService(): string {
  const ici = path.join(ROOT, 'scripts', 'laya-service.py');
  return fs.existsSync(ici) ? ici : path.join(CONFIG.depotDuDemon, 'scripts', 'laya-service.py');
}

/**
 * L'ENTRAÎNEMENT DE NUIT TIENT-IL LA MACHINE ? `scripts/laya-nuit.mjs` pose un
 * verrou (son pid) le temps de la nuit : Laya ne se recharge pas tant que ce
 * processus vit, pour lui laisser la mémoire. Un verrou orphelin (processus
 * mort) ne bloque rien.
 */
export function entrainementEnCours(installation = installationLaya()): boolean {
  if (!installation) return false;
  try {
    const verrou = JSON.parse(fs.readFileSync(path.join(installation.dossier, 'entrainement', 'EN-COURS'), 'utf8'));
    if (!verrou?.pid) return false;
    process.kill(Number(verrou.pid), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * LA VERSION À CHARGER : celle que la nuit a mise en service
 * (`outils/laya/en-service`, un lien vers `versions/…`), sinon le modèle
 * multilingue d'origine, dans le cache.
 */
export function versionEnService(installation = installationLaya()): string | undefined {
  if (!installation) return undefined;
  const lien = path.join(installation.dossier, 'en-service');
  try {
    if (fs.existsSync(path.join(lien, 'model.safetensors'))) return fs.realpathSync(lien);
  } catch {
    /* lien cassé : on retombe sur l'origine */
  }
  return undefined;
}

/** La mémoire réellement disponible, en Mo (`MemAvailable`). Illisible = on ne bloque pas. */
function memoireLibreMo(): number {
  try {
    const ligne = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (ligne) return Math.round(Number(ligne[1]) / 1024);
  } catch {
    /* hors Linux : la mémoire libre du système fait l'affaire */
  }
  return Math.round(os.freemem() / (1024 * 1024));
}

/* ------------------------------------------------------------------ */
/* LE PROCESSUS                                                         */
/* ------------------------------------------------------------------ */

interface Attente {
  resoudre: (reponse: Record<string, ReponseBruteDeLaya> | undefined) => void;
}

let processus: ChildProcessWithoutNullStreams | null = null;
/** Vrai une fois la ligne « prêt » reçue : le modèle est chargé. */
let charge = false;
let chargement: Promise<boolean> | null = null;
let prochainId = 1;
const enAttente = new Map<number, Attente>();
let minuteurDeRepos: NodeJS.Timeout | null = null;

function arreterLeProcessus(raison: string): void {
  if (!processus) return;
  const p = processus;
  processus = null;
  charge = false;
  chargement = null;
  for (const [, attente] of enAttente) attente.resoudre(undefined);
  enAttente.clear();
  try {
    p.kill();
  } catch {
    /* déjà parti */
  }
  log.info(`laya : processus arrêté (${raison})`);
}

function rearmerLeRepos(): void {
  if (minuteurDeRepos) clearTimeout(minuteurDeRepos);
  minuteurDeRepos = setTimeout(() => arreterLeProcessus('repos'), REPOS_DE_LAYA_MS);
  minuteurDeRepos.unref();
}

/**
 * LANCER LAYA, OU DIRE POURQUOI PAS. Rend vrai quand le modèle est chargé.
 * Un seul chargement à la fois : deux questions arrivées ensemble attendent le
 * même.
 */
function demarrer(): Promise<boolean> {
  if (charge && processus) return Promise.resolve(true);
  if (chargement) return chargement;
  const installation = installationLaya();
  if (!installation) return Promise.resolve(false);
  if (entrainementEnCours(installation)) return Promise.resolve(false);
  const version = versionEnService(installation);
  const libre = memoireLibreMo();
  /* Un contrôle qui lance un Laya FACTICE n'a pas besoin de 2 Go libres. */
  const minimum = Number(process.env.BELUGA_LAYA_MEMOIRE_MIN_MO ?? MEMOIRE_LIBRE_MIN_MO);
  if (libre < minimum) {
    log.warn(`laya : non lancé, ${libre} Mo libres (il en faut ${minimum})`);
    return Promise.resolve(false);
  }

  chargement = new Promise<boolean>((resoudre) => {
    let p: ChildProcessWithoutNullStreams;
    try {
      p = spawn(installation.python, [scriptDuService()], {
        cwd: installation.dossier,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HF_HOME: path.join(installation.dossier, CACHE_LAYA),
          /* AUCUN RÉSEAU (MEM-3197) : les poids sont déjà sur le disque. */
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          TOKENIZERS_PARALLELISM: 'false',
          ...(version ? { LAYA_DEPOT: version } : {}),
        },
      });
    } catch (err) {
      log.warn(`laya : lancement impossible (${(err as Error).message})`);
      chargement = null;
      return resoudre(false);
    }
    processus = p;
    const debut = Date.now();
    readline.createInterface({ input: p.stdout }).on('line', (ligne) => {
      let r: { id?: number; pret?: boolean; erreur?: string; answers?: Record<string, ReponseBruteDeLaya> };
      try {
        r = JSON.parse(ligne);
      } catch {
        return; /* un avertissement du moteur, pas une réponse */
      }
      if (r.id === 0) {
        if (r.pret) {
          charge = true;
          log.info(`laya : modèle ${version ? path.basename(version) : 'd’origine'} chargé en ${Date.now() - debut} ms`);
          resoudre(true);
        } else {
          log.warn(`laya : ${r.erreur ?? 'chargement refusé'}`);
          arreterLeProcessus('chargement impossible');
          resoudre(false);
        }
        return;
      }
      const attente = typeof r.id === 'number' ? enAttente.get(r.id) : undefined;
      if (!attente || typeof r.id !== 'number') return;
      enAttente.delete(r.id);
      if (r.erreur) log.warn(`laya : ${r.erreur}`);
      attente.resoudre(r.erreur ? undefined : r.answers);
    });
    p.stderr.on('data', () => {});
    p.on('error', () => {
      if (processus === p) arreterLeProcessus('erreur du processus');
      resoudre(false);
    });
    p.on('exit', () => {
      if (processus === p) arreterLeProcessus('processus terminé');
      resoudre(false);
    });
  });
  rearmerLeRepos();
  return chargement;
}

/** Le modèle est-il chargé, là, tout de suite ? Ce qui décide d'un appel « express ». */
export function layaCharge(): boolean {
  return charge && !!processus;
}

/** Réveiller Laya sans rien lui demander : la prochaine question express le trouvera prêt. */
export function reveillerLaya(): void {
  void demarrer().catch(() => false);
}

/* ------------------------------------------------------------------ */
/* LA FILE                                                              */
/* ------------------------------------------------------------------ */

/**
 * UNE QUESTION À LA FOIS (MEM-3380). Le service Python lit ses lignes dans
 * l'ordre, mais le DÉLAI de chacune doit courir à partir de SON départ : on
 * tient donc la file ici, et une question n'est écrite qu'une fois la
 * précédente rendue.
 */
let file: Promise<unknown> = Promise.resolve();

function aSonTour<T>(travail: () => Promise<T>): Promise<T> {
  const suite = file.then(travail, travail);
  file = suite.catch(() => undefined);
  return suite;
}

export interface DemandeALaya {
  etat: unknown;
  questions: Record<string, QuestionDuJuge>;
  delaiMs?: number;
  /**
   * EXPRESS : sur le chemin d'un tour. Si le modèle n'est pas déjà chargé, on
   * ne l'attend pas — on le réveille et on rend « rien » tout de suite.
   */
  express?: boolean;
  /** Le plafond de lecture, en jetons (défaut : la fenêtre d'origine). */
  maxLen?: number;
}

/**
 * POSER DES QUESTIONS À LAYA ET RENDRE SES RÉPONSES BRUTES — toutes les
 * questions d'un appel partent en UN passage. Rend `undefined` sur tout échec.
 */
export function interrogerLaya(demande: DemandeALaya): Promise<Record<string, ReponseBruteDeLaya> | undefined> {
  if (!layaPret()) return Promise.resolve(undefined);
  if (demande.express && !layaCharge()) {
    reveillerLaya();
    return Promise.resolve(undefined);
  }
  const tour = aSonTour(() => interrogerMaintenant(demande)).catch(() => undefined);
  if (!demande.express) return tour;
  /* Express : l'attente dans la file compte aussi. Un tour ne patiente pas
     derrière une note de fond ; la réponse tardive est simplement ignorée. */
  return Promise.race([tour, attendre(demande.delaiMs ?? DELAI_LAYA_MS).then(() => undefined)]);
}

async function interrogerMaintenant(demande: DemandeALaya): Promise<Record<string, ReponseBruteDeLaya> | undefined> {
  const delai = demande.delaiMs ?? DELAI_LAYA_MS;
  const depart = Date.now();
  /* Le chargement compte dans le délai : une question de fond l'absorbe, une
     question express n'arrive jamais ici sans modèle chargé. */
  const pret = await Promise.race([demarrer(), attendre(delai).then(() => false)]);
  if (!pret || !processus) return undefined;
  rearmerLeRepos();
  const reste = Math.max(500, delai - (Date.now() - depart));
  const id = prochainId++;
  const p = processus;
  return new Promise((resoudre) => {
    const minuteur = setTimeout(() => {
      if (!enAttente.has(id)) return;
      enAttente.delete(id);
      log.warn(`laya : délai dépassé (${delai} ms)`);
      /* Une réponse tardive occuperait la ligne suivante : on coupe le
         processus plutôt que de lire la mauvaise réponse ensuite. */
      arreterLeProcessus('délai dépassé');
      resoudre(undefined);
    }, reste);
    minuteur.unref();
    enAttente.set(id, {
      resoudre: (reponse) => {
        clearTimeout(minuteur);
        resoudre(reponse);
      },
    });
    try {
      p.stdin.write(
        `${JSON.stringify({ id, state: etatPourLaya(demande.etat), questions: demande.questions, max_len: demande.maxLen ?? LONGUEUR_LAYA })}\n`,
      );
    } catch {
      enAttente.delete(id);
      clearTimeout(minuteur);
      resoudre(undefined);
    }
  });
}

function attendre(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref());
}

/** L'arrêt du démon, et les contrôles. */
export function arreterLaya(): void {
  if (minuteurDeRepos) clearTimeout(minuteurDeRepos);
  minuteurDeRepos = null;
  arreterLeProcessus('arrêt');
}
