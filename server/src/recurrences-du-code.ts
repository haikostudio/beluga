/**
 * LE RELEVÉ DES ÉLÉMENTS D'INTERFACE DANS LE CODE DES PROJETS — côté disque
 * (règles pures dans `shared/src/recurrences-du-code.ts`).
 *
 * Appelé par le ménage de nuit (`server/src/menage-competences.ts`). Pour chaque
 * projet ouvert, deux lectures git, chacune bornée : la liste des fichiers
 * suivis (`ls-files`), et — hors inventaire initial — ceux qu'un enregistrement
 * a touchés depuis le dernier passage (`log --since`). Aucun fichier n'est lu :
 * c'est l'agent de nuit qui ouvrira ceux qu'on lui cite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  FICHIERS_PAR_PROJET_MAX,
  estFichierDInterface,
  estSystemeDeFichiersDistant,
  lireLesMontages,
  roleSupposeDuFichier,
  rolesRecurrents,
  typeDuSystemeDeFichiers,
  type ElementDInterface,
  type Project,
  type RecurrenceDuCode,
} from '@beluga/shared';
import { log } from './logger.js';
import * as store from './store.js';

const executer = promisify(execFile);

/**
 * LE PLAFOND D'UNE LECTURE GIT SE MESURE AU DISQUE QUI PORTE LE DÉPÔT : 90 s sur
 * le disque de la machine, 10 min sur un montage réseau, où chaque fichier suivi
 * paie une latence. Un dépôt qui dépasse est simplement sauté cette nuit.
 */
export const DELAI_GIT_LOCAL_MS = 90_000;
export const DELAI_GIT_DISTANT_MS = 10 * 60_000;

function delaiGit(chemin: string): number {
  try {
    const montages = lireLesMontages(fs.readFileSync('/proc/mounts', 'utf8'));
    const distant = estSystemeDeFichiersDistant(typeDuSystemeDeFichiers(fs.realpathSync(chemin), montages));
    return distant ? DELAI_GIT_DISTANT_MS : DELAI_GIT_LOCAL_MS;
  } catch {
    return DELAI_GIT_DISTANT_MS;
  }
}

async function git(chemin: string, args: string[]): Promise<string> {
  const { stdout } = await executer('git', ['-C', chemin, ...args], {
    timeout: delaiGit(chemin),
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

/** Les projets ouverts dont le dossier est un dépôt git, un seul par dossier. */
function projetsAReleve(): Project[] {
  const vus = new Set<string>();
  return store.listProjects().filter((projet) => {
    if (projet.archived || !projet.path) return false;
    const dossier = path.resolve(projet.path);
    if (vus.has(dossier) || !fs.existsSync(path.join(dossier, '.git'))) return false;
    vus.add(dossier);
    return true;
  });
}

/** Les fichiers d'interface d'UN projet, avec leur rôle supposé ; `depuis` absent = tout est récent (inventaire). */
export async function elementsDuProjet(projet: Pick<Project, 'name' | 'path'>, depuis?: number): Promise<ElementDInterface[]> {
  const dossier = path.resolve(projet.path);
  const suivis = (await git(dossier, ['ls-files'])).split('\n').filter(Boolean);
  const avecRole = suivis
    .filter(estFichierDInterface)
    .map((relatif) => ({ relatif, role: roleSupposeDuFichier(relatif) }))
    .filter((f): f is { relatif: string; role: string } => !!f.role)
    .slice(0, FICHIERS_PAR_PROJET_MAX);
  if (!avecRole.length) return [];
  let recents: Set<string> | undefined;
  if (depuis !== undefined) {
    const journal = await git(dossier, ['log', `--since=@${Math.floor(depuis / 1000)}`, '--name-only', '--pretty=format:']);
    recents = new Set(journal.split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return avecRole.map(({ relatif, role }) => ({
    projet: projet.name,
    chemin: path.join(dossier, relatif),
    role,
    recent: !recents || recents.has(relatif),
  }));
}

/**
 * LES RÔLES D'INTERFACE QUE PLUSIEURS PROJETS PARTAGENT. `depuis` absent :
 * l'inventaire initial, où tout l'existant compte. Un projet illisible ou trop
 * lent est sauté et DIT au journal ; il ne fait jamais tomber le ménage.
 */
export async function releverLesRecurrencesDuCode(depuis?: number): Promise<RecurrenceDuCode[]> {
  const elements: ElementDInterface[] = [];
  for (const projet of projetsAReleve()) {
    try {
      elements.push(...(await elementsDuProjet(projet, depuis)));
    } catch (err) {
      log.warn(`récurrences du code : « ${projet.name} » sauté — ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return rolesRecurrents(elements);
}
