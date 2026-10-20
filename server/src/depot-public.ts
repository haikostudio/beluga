import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ADRESSE_D_ENVOI_INTERDITE,
  distantVersLeDepotPublic,
  distantsAVerrouiller,
  lireLesDistants,
  prefixesDuDepotPublic,
} from '@beluga/shared';
import { CONFIG, DEMON_D_ESSAI } from './config.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * LE VERROU VERS LE DÉPÔT PUBLIC, CÔTÉ MACHINE (`shared/src/depot-public.ts`).
 *
 * Une installation venue du dépôt public le garde pour LIRE ses nouveautés
 * (`installation-copie.ts`), mais plus rien ne peut y partir : chaque distant
 * qui le désigne reçoit une adresse d'envoi impossible, une règle globale du
 * compte du service détourne toute poussée vers lui, et `gh` passe par un garde
 * qui refuse ce qui y écrirait (ticket, proposition, fork).
 *
 * LA MACHINE DE L'AUTEUR N'EST PAS VERROUILLÉE : c'est d'elle que part le
 * miroir public (`scripts/synchroniser-miroir-public.mjs`), qui pousse sur ce
 * dépôt. Elle se reconnaît au dossier `prive/` du dépôt — jamais publié — ou
 * à `BELUGA_MACHINE_AUTEUR=1`.
 */
export function machineDeLAuteur(): boolean {
  if (process.env.BELUGA_MACHINE_AUTEUR === '1') return true;
  if (process.env.BELUGA_MACHINE_AUTEUR === '0') return false;
  return fs.existsSync(path.join(CONFIG.selfPath, 'prive', 'valeurs-sensibles.json'));
}

async function git(dir: string, args: string[]): Promise<{ ok: boolean; sortie: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args], { timeout: 15000 });
    return { ok: true, sortie: stdout };
  } catch (e: any) {
    return { ok: false, sortie: String(e?.stdout ?? '') + String(e?.stderr ?? '') };
  }
}

/**
 * VERROUILLE LES DISTANTS D'UN DÉPÔT QUI DÉSIGNENT LE DÉPÔT PUBLIC : leur adresse
 * d'envoi devient impossible, leur lecture ne change pas. Et quand le dépôt a
 * un `origin` à lui, `gh` le prend pour dépôt par défaut — jamais le public.
 * Idempotent, sans effet sur la machine de l'auteur. Rend les distants touchés.
 */
export async function verrouillerLesDistants(dir: string): Promise<string[]> {
  if (machineDeLAuteur()) return [];
  const liste = await git(dir, ['remote', '-v']);
  if (!liste.ok) return [];
  const distants = lireLesDistants(liste.sortie);
  const touches: string[] = [];
  for (const nom of distantsAVerrouiller(distants)) {
    const pose = await git(dir, ['remote', 'set-url', '--push', nom, ADRESSE_D_ENVOI_INTERDITE]);
    if (pose.ok) touches.push(nom);
    else log.warn(`${dir} : verrou d'envoi non posé sur « ${nom} » : ${pose.sortie.trim().slice(-200)}`);
  }
  const origine = distants.find((d) => d.nom === 'origin');
  if (origine && !distantVersLeDepotPublic(origine)) {
    // C'est ainsi que `gh repo set-default` range son choix : sans réseau, sans question.
    await git(dir, ['config', 'remote.origin.gh-resolved', 'base']);
  }
  if (touches.length) log.info(`${dir} : envoi vers le dépôt public verrouillé (${touches.join(', ')})`);
  return touches;
}

/** Un envoi vers ce distant partirait-il au dépôt public ? Lecture OU envoi suffisent. */
export async function distantEstLeDepotPublic(cwd: string, distant: string): Promise<boolean> {
  const lecture = await git(cwd, ['remote', 'get-url', distant]);
  const envoi = await git(cwd, ['remote', 'get-url', '--push', distant]);
  return distantVersLeDepotPublic({
    nom: distant,
    lecture: lecture.ok ? lecture.sortie.trim() : undefined,
    envoi: envoi.ok ? envoi.sortie.trim() : undefined,
  });
}

/** Le texte du refus, quand le démon allait pousser vers le dépôt public. */
export const REFUS_D_ENVOI_AU_DEPOT_PUBLIC =
  'Envoi refusé : ce distant est le dépôt public de Beluga Build, qui ne reçoit jamais rien d’une installation.';

/* ------------------------------------------------------------------ */
/* Les verrous de la machine                                            */
/* ------------------------------------------------------------------ */

/** Le dossier du garde de `gh`, placé en TÊTE du chemin des programmes du démon. */
function dossierDuGardeGh(): string {
  return path.join(CONFIG.dataDir, 'garde-gh');
}

/** Le vrai `gh`, le garde lui-même écarté. */
function vraiGh(garde: string): string | null {
  for (const dossier of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dossier || path.resolve(dossier) === path.resolve(garde)) continue;
    const candidat = path.join(dossier, 'gh');
    try {
      fs.accessSync(candidat, fs.constants.X_OK);
      return candidat;
    } catch {
      /* pas ici */
    }
  }
  return null;
}

/**
 * LES VERROUS QUI VALENT POUR TOUTE LA MACHINE, posés au démarrage :
 *  - `url.<interdite>.pushInsteadOf` dans la configuration GLOBALE du compte
 *    du service : une poussée vers le dépôt public, par n'importe quel distant
 *    ou adresse tapée (terminal du serveur compris), part vers l'adresse
 *    impossible ;
 *  - un garde devant `gh`, en tête du chemin des programmes : les agents de
 *    tous les moteurs et le terminal le trouvent avant le vrai.
 * Jamais sur la machine de l'auteur, jamais pour un démon d'essai (il
 * toucherait la configuration de la personne qui lance le contrôle).
 */
export function poserLesVerrousDeLaMachine(): void {
  if (machineDeLAuteur() || DEMON_D_ESSAI) return;
  try {
    const cle = `url.${ADRESSE_D_ENVOI_INTERDITE}.pushInsteadOf`;
    const deja = spawnSync('git', ['config', '--global', '--get-all', cle], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.trim());
    for (const prefixe of prefixesDuDepotPublic()) {
      if (!deja.includes(prefixe)) spawnSync('git', ['config', '--global', '--add', cle, prefixe]);
    }
  } catch (e) {
    log.warn(`verrou global d'envoi non posé : ${(e as Error).message}`);
  }
  try {
    const garde = dossierDuGardeGh();
    const cible = vraiGh(garde);
    if (!cible) return;
    fs.mkdirSync(garde, { recursive: true });
    const script = path.join(CONFIG.selfPath, 'server', 'garde-gh.mjs');
    const contenu = `#!/bin/sh\n# Garde de Beluga Build : rien ne s'écrit sur le dépôt public depuis cette installation.\nnode ${JSON.stringify(script)} "$@" || exit 2\nexec ${JSON.stringify(cible)} "$@"\n`;
    const fichier = path.join(garde, 'gh');
    if (!fs.existsSync(fichier) || fs.readFileSync(fichier, 'utf8') !== contenu) {
      fs.writeFileSync(fichier, contenu, { mode: 0o755 });
    }
    const chemins = (process.env.PATH ?? '').split(path.delimiter);
    if (chemins[0] !== garde) process.env.PATH = [garde, ...chemins.filter((c) => c !== garde)].join(path.delimiter);
  } catch (e) {
    log.warn(`garde de gh non posé : ${(e as Error).message}`);
  }
}
