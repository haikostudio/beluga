/**
 * LA NUIT DE LAYA, CÔTÉ DÉMON : la déclencher, et la lire.
 *
 * Le travail lui-même vit dans `scripts/laya-nuit.mjs` (entraîner, examiner,
 * ne remplacer que si c'est mieux). Ici, deux gestes seulement :
 *  - UN MINUTEUR regarde chaque minute s'il est entre 3 h et 7 h et si la nuit
 *    n'a pas encore tourné ; si oui, il endort Laya et lance le script, une
 *    seule fois par nuit ;
 *  - LA LECTURE du compte rendu, pour l'écran du juge.
 *
 * `BELUGA_LAYA_NUIT=0` coupe le déclenchement (contrôles, machine atypique).
 * Rien ne se déclenche sans Laya installé. Le démon ne redémarre jamais pour ça.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { dansLaFenetreDeNuit, jourDeLaNuit, type CompteRenduDeNuit } from '@beluga/shared';

import { CONFIG, ROOT } from './config.js';
import { arreterLaya, entrainementEnCours, installationLaya, versionEnService } from './laya.js';
import { log } from './logger.js';

function dossierDeTravail(): string | undefined {
  const installation = installationLaya();
  return installation ? path.join(installation.dossier, 'entrainement') : undefined;
}

/** Le compte rendu de la dernière nuit, s'il y en a un. */
export function derniereNuit(): CompteRenduDeNuit | undefined {
  const dossier = dossierDeTravail();
  if (!dossier) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(dossier, 'derniere-nuit.json'), 'utf8')) as CompteRenduDeNuit;
  } catch {
    return undefined;
  }
}

/** Ce que l'écran du juge affiche de l'entraînement de nuit. */
export interface EtatDeLaNuit {
  enCours: boolean;
  version: string;
  derniere?: CompteRenduDeNuit;
}

export function etatDeLaNuit(): EtatDeLaNuit {
  const version = versionEnService();
  return { enCours: entrainementEnCours(), version: version ? path.basename(version) : 'origine', derniere: derniereNuit() };
}

function scriptDeNuit(): string {
  const ici = path.join(ROOT, 'scripts', 'laya-nuit.mjs');
  return fs.existsSync(ici) ? ici : path.join(CONFIG.depotDuDemon, 'scripts', 'laya-nuit.mjs');
}

/** Faut-il lancer la nuit, maintenant ? Une règle, sans effet. */
export function nuitALancer(maintenant: Date, derniere: CompteRenduDeNuit | undefined, enCours: boolean): boolean {
  if (enCours) return false;
  if (!dansLaFenetreDeNuit(maintenant)) return false;
  return derniere?.jour !== jourDeLaNuit(maintenant);
}

function lancerLaNuit(): void {
  const dossier = dossierDeTravail();
  if (!dossier) return;
  arreterLaya();
  fs.mkdirSync(dossier, { recursive: true });
  const sortie = fs.openSync(path.join(dossier, 'nuit.log'), 'w');
  try {
    const p = spawn(process.execPath, [scriptDeNuit()], {
      cwd: path.dirname(path.dirname(scriptDeNuit())),
      env: { ...process.env, BELUGA_LAYA_DIR: path.dirname(dossier) },
      stdio: ['ignore', sortie, sortie],
      detached: true,
    });
    p.unref();
    log.info(`laya : entraînement de nuit lancé (processus ${p.pid})`);
  } catch (err) {
    log.warn(`laya : entraînement de nuit non lancé (${(err as Error).message})`);
  } finally {
    fs.closeSync(sortie);
  }
}

/** Le minuteur de la nuit. Rend sa fonction d'arrêt. */
export function veillerSurLaNuitDeLaya(): () => void {
  if (process.env.BELUGA_LAYA_NUIT === '0') return () => {};
  const minuteur = setInterval(() => {
    try {
      if (!installationLaya()) return;
      if (nuitALancer(new Date(), derniereNuit(), entrainementEnCours())) lancerLaNuit();
    } catch (err) {
      log.warn(`laya : veille de nuit (${(err as Error).message})`);
    }
  }, 60_000);
  minuteur.unref();
  return () => clearInterval(minuteur);
}
