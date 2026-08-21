/**
 * RECOLLER UN HEURT DE DOCUMENTATION, PARTOUT OÙ IL NAÎT.
 *
 * Le geste existait déjà, mais à UN SEUL endroit : la fusion du lot, au tout
 * dernier moment, quand l'utilisateur clique sur « Publier ». Or une branche de
 * carte est fusionnée dans la principale BIEN AVANT, à la fin du tour de son
 * agent (`refermerDossierDeCarte`) — et là, un heurt était simplement annulé
 * (« la fusion revient à la publication »). Le conflit survivait donc des heures
 * ou des jours, s'ajoutait à ceux des cartes suivantes, et arrivait à la fusion
 * du lot en même temps que tous les autres.
 *
 * Le même recollage est donc posé ICI, dans un module que les DEUX chemins
 * appellent : le heurt meurt à la seconde où il naît, sans moteur, sans agent
 * et sans attente. Ce qui n'est pas de la documentation continue de revenir à
 * un agent, exactement comme avant.
 *
 * ET LE RECOLLAGE EST PARTIEL. Il exigeait que TOUS les fichiers en conflit
 * soient de la documentation : trois documents et un fichier de code partaient
 * tous les quatre à l'agent. Les documents sont désormais recollés dans tous les
 * cas ; l'agent ne reçoit que ce qui reste vraiment — et quand il ne reste rien,
 * il n'est pas appelé du tout.
 *
 * Les règles pures (quel fichier est recollable, comment on garde les deux
 * intentions) vivent dans `shared/src/fusion-du-lot.ts` et se testent seules.
 * Ici, le disque et git.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { documentRecollable, mentionDuRecollage, recollerLesDeuxIntentions } from '@haikodev/shared';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/* Git parle la langue de l'environnement : on la neutralise, comme partout. */
const LANGUE_NEUTRE = { LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };

async function git(cwd: string, args: string[], timeout = 120000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...LANGUE_NEUTRE },
    });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err: any) {
    return { ok: false, out: `${err?.stdout ?? ''}${err?.stderr ?? ''}${err?.message ?? ''}`.trim().slice(-1500) };
  }
}

/** Les fichiers que git a laissés en conflit dans cette copie de travail. */
export async function fichiersEnConflitDuDossier(cwd: string): Promise<string[]> {
  const sortie = await git(cwd, ['diff', '--name-only', '--diff-filter=U'], 60000);
  if (!sortie.ok) return [];
  return sortie.out.split('\n').map((l) => l.trim()).filter(Boolean);
}

export interface BilanRecollage {
  /** La fusion a été recollée ET enregistrée : plus rien n'est en conflit. */
  fusionnee: boolean;
  /** Les fichiers de documentation effectivement recollés. */
  recolles: string[];
  /** Ce qui reste en conflit, et qui demande un agent. */
  restants: string[];
  /** Ce qui s'écrit au journal — vide quand il n'y avait rien à recoller. */
  recit: string;
}

const RIEN = (restants: string[]): BilanRecollage => ({
  fusionnee: false,
  recolles: [],
  restants,
  recit: '',
});

/**
 * RECOLLER CE QUI EST RECOLLABLE, DANS UNE FUSION LAISSÉE EN COURS.
 *
 * L'appelant vient de voir `git merge` échouer et n'a PAS annulé : les fichiers
 * portent leurs marqueurs. On recolle chaque document de la liste fermée, on
 * l'ajoute NOMMÉ (le dossier peut être partagé : jamais `git add -A`), puis :
 *
 *   - plus rien en conflit → `git commit` referme la fusion, `fusionnee` ;
 *   - du code reste en conflit → on ne commit pas, `restants` le nomme, et
 *     l'appelant reprend la main (annuler, appeler un agent) comme avant.
 *
 * TROIS REFUS rendent la main sans rien casser : un fichier illisible, des
 * marqueurs qui ne sont pas exactement ceux qu'on attend, un enregistrement
 * refusé. Rien n'est jamais écrasé — le recollage AJOUTE, il ne choisit pas de
 * camp.
 */
export async function recollerLesDocumentsEnConflit(
  cwd: string,
  enConflit: readonly string[],
): Promise<BilanRecollage> {
  const fichiers = enConflit.map((f) => f.trim()).filter(Boolean);
  const recollables = fichiers.filter((f) => documentRecollable(f));
  const restants = fichiers.filter((f) => !documentRecollable(f));
  if (!recollables.length) return RIEN(restants);

  for (const fichier of recollables) {
    const chemin = path.join(cwd, fichier);
    let avant: string;
    try {
      avant = await fs.promises.readFile(chemin, 'utf8');
    } catch {
      return { fusionnee: false, recolles: [], restants: fichiers, recit: `fichier illisible (${fichier})` };
    }
    const apres = recollerLesDeuxIntentions(avant);
    if (apres === null) {
      return { fusionnee: false, recolles: [], restants: fichiers, recit: `marqueurs inattendus dans ${fichier}` };
    }
    await fs.promises.writeFile(chemin, apres, 'utf8');
  }

  for (const fichier of recollables) {
    const ajout = await git(cwd, ['add', '--', fichier]);
    if (!ajout.ok) {
      return {
        fusionnee: false,
        recolles: [],
        restants: fichiers,
        recit: `enregistrement impossible (${fichier})`,
      };
    }
  }

  if (restants.length) {
    // Recollage PARTIEL : la fusion ne peut pas se refermer, mais l'agent qui
    // prendra la main ne verra plus que le code.
    return {
      fusionnee: false,
      recolles: recollables,
      restants,
      recit: `${recollables.length} document(s) recollé(s) seuls, ${restants.length} fichier(s) de code restent en conflit`,
    };
  }

  // `--no-verify` : un crochet de dépôt qui refuserait ce commit laisserait la
  // copie en pleine fusion, ce qui est bien pire que la fusion elle-même.
  const commit = await git(cwd, ['commit', '--no-verify', '--no-edit']);
  if (!commit.ok) {
    return {
      fusionnee: false,
      recolles: recollables,
      restants: fichiers,
      recit: 'la fusion recollée n’a pas pu être enregistrée',
    };
  }

  log.info(`heurt de documentation recollé sans agent dans ${cwd} : ${recollables.join(', ')}`);
  return { fusionnee: true, recolles: recollables, restants: [], recit: mentionDuRecollage(recollables) };
}
