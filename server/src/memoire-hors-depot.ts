/**
 * UNE MÉMOIRE QUE GIT IGNORE RESTE LA MÉMOIRE DU PROJET.
 *
 * Un projet peut garder sa mémoire de travail HORS de son dépôt : fichier
 * d'instructions, mémoire, règles, fichiers d'attente — tout ce qui dit comment
 * la machine est montée et n'a rien à faire dans un dépôt que d'autres lisent.
 * Le `.gitignore` du projet EST ce réglage : aucun nom de projet n'est écrit ici,
 * et un projet qui suit sa mémoire (Beluga Build lui-même) ne voit rien changer.
 *
 * La mémoire se lit et s'écrit déjà dans le dossier du PROJET (`remember`,
 * `project_memory`) : elle reste donc lisible. Trois endroits, en revanche,
 * supposaient qu'elle voyage par git, et les voici :
 *
 *  1. la copie de travail d'une carte NAÎT de git : elle n'aurait pas son
 *     fichier d'instructions — on l'y DÉPOSE à l'ouverture, sans l'enregistrer ;
 *  2. le dépôt de règles d'une carte (`docs/instructions-en-attente/<copie>.md`)
 *     partait avec sa branche — ignoré, il disparaîtrait avec la copie : on le
 *     RECOLLE dans le dossier du projet avant de la retirer ;
 *  3. le rangement de nuit enregistrait ses fichiers — il n'enregistre plus que
 *     ceux que git suit (`instructions-en-attente.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DOSSIER_D_ATTENTE, FICHIER_D_ATTENTE, FICHIERS_INSTRUCTIONS } from '@beluga/shared';
import { log } from './logger.js';

/** Parmi ces chemins (relatifs), ceux que git ignore dans ce dossier. */
export function cheminsIgnores(dossier: string, chemins: readonly string[]): Set<string> {
  if (!chemins.length) return new Set();
  const lire = (sortie: unknown) =>
    new Set(
      String(sortie ?? '')
        .split('\n')
        .map((ligne) => ligne.trim())
        .filter(Boolean),
    );
  try {
    return lire(
      execFileSync('git', ['-C', dossier, 'check-ignore', '--stdin'], {
        input: `${chemins.join('\n')}\n`,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }),
    );
  } catch (err: any) {
    // `check-ignore` sort en erreur quand AUCUN chemin n'est ignoré : ce n'est
    // pas une panne, sa sortie (vide) dit la vérité.
    return lire(err?.stdout);
  }
}

/**
 * DÉPOSER DANS LA COPIE D'UNE CARTE les fichiers d'instructions que git ignore.
 * Rend les noms déposés. Un fichier suivi est déjà dans la copie ; un fichier
 * ni suivi ni ignoré n'est PAS déposé — il partirait sur la branche au premier
 * enregistrement d'office.
 */
export function deposerLesFichiersIgnores(racine: string, dossier: string): string[] {
  try {
    const absents = FICHIERS_INSTRUCTIONS.filter(
      (nom) => fs.existsSync(path.join(racine, nom)) && !fs.existsSync(path.join(dossier, nom)),
    );
    const ignores = cheminsIgnores(dossier, absents);
    const deposes: string[] = [];
    for (const nom of absents) {
      if (!ignores.has(nom)) continue;
      fs.copyFileSync(path.join(racine, nom), path.join(dossier, nom));
      deposes.push(nom);
    }
    if (deposes.length) log.info(`copie de carte ${dossier} : ${deposes.join(', ')} déposé(s) hors dépôt`);
    return deposes;
  } catch (err) {
    log.warn(`copie de carte ${dossier} : fichiers d'instructions non déposés — ${(err as Error).message}`);
    return [];
  }
}

/**
 * RECOLLER DANS LE DOSSIER DU PROJET les dépôts de règles que la carte a écrits
 * dans sa copie et que git ignore. Un fichier absent du projet y est créé ; un
 * fichier présent reçoit le texte de la carte à sa suite, sauf s'il le porte
 * déjà. Rend les chemins recollés.
 */
export function recollerLesDepotsIgnores(racine: string, dossier: string): string[] {
  try {
    const candidats: string[] = [];
    if (fs.existsSync(path.join(dossier, FICHIER_D_ATTENTE))) candidats.push(FICHIER_D_ATTENTE);
    const repertoire = path.join(dossier, DOSSIER_D_ATTENTE);
    if (fs.existsSync(repertoire) && fs.statSync(repertoire).isDirectory()) {
      for (const nom of fs.readdirSync(repertoire).filter((n) => n.endsWith('.md')).sort()) {
        candidats.push(path.posix.join(DOSSIER_D_ATTENTE, nom));
      }
    }
    const ignores = cheminsIgnores(dossier, candidats);
    const recolles: string[] = [];
    for (const relatif of candidats) {
      if (!ignores.has(relatif)) continue;
      const texte = fs.readFileSync(path.join(dossier, relatif), 'utf8');
      if (!texte.trim()) continue;
      const cible = path.join(racine, relatif);
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      if (fs.existsSync(cible)) {
        const existant = fs.readFileSync(cible, 'utf8');
        if (existant.includes(texte.trim())) continue;
        fs.appendFileSync(cible, `${existant.endsWith('\n') ? '' : '\n'}\n${texte}`);
      } else {
        fs.writeFileSync(cible, texte);
      }
      recolles.push(relatif);
    }
    if (recolles.length) log.info(`copie de carte ${dossier} : ${recolles.join(', ')} recollé(s) dans ${racine}`);
    return recolles;
  } catch (err) {
    log.warn(`copie de carte ${dossier} : dépôts de règles non recollés — ${(err as Error).message}`);
    return [];
  }
}
