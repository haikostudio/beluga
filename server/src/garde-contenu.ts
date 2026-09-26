/**
 * LA GARDE DE CONTENU, JUSTE AVANT L'ENVOI SUR LE DÉPÔT.
 *
 * Un projet réglé « dépôt sans données sensibles » ne pousse plus rien sans que
 * les commits qui partiraient soient passés au filtre de contenu
 * (`shared/src/filtre-contenu.ts`, `scripts/filtre-contenu.mjs`) : chaque
 * fichier écrit par le lot, chaque message, chaque identité. Au moindre reste,
 * l'envoi est REFUSÉ, et le refus nomme le fichier, la ligne, le motif — et la
 * carte dont la branche a porté le commit.
 *
 * Un filtre qui ne répond pas refuse aussi : une garde qui laisse passer quand
 * elle est en panne n'en est pas une.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { recitDesRestes, type Reste } from '@beluga/shared';
import { CONFIG, ROOT } from './config.js';

const execFileAsync = promisify(execFile);

/** Le filtre du code qui tourne d'abord, celui du dépôt du démon en repli. */
export function cheminDuFiltreDeContenu(): string {
  const ici = path.join(ROOT, 'scripts', 'filtre-contenu.mjs');
  if (fs.existsSync(ici)) return ici;
  return path.join(CONFIG.depotDuDemon, 'scripts', 'filtre-contenu.mjs');
}

export const DELAI_GARDE_MS = 5 * 60 * 1000;

export interface VerdictDeGarde {
  ok: boolean;
  recit: string;
  restes: Reste[];
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: stdout.trim() };
  } catch (err: any) {
    return { ok: false, out: String(err?.stdout ?? '').trim() };
  }
}

/** La carte dont la branche porte le dernier commit du lot qui a touché ce fichier. */
async function carteDuFichier(
  cwd: string,
  base: string,
  chemin: string,
  cartes: { titre: string; branche?: string }[],
): Promise<string | undefined> {
  const commit = await git(cwd, ['log', '-1', '--format=%H', '--no-merges', `${base}..HEAD`, '--', chemin]);
  if (!commit.ok || !commit.out) return undefined;
  for (const carte of cartes) {
    if (!carte.branche) continue;
    if ((await git(cwd, ['merge-base', '--is-ancestor', commit.out, carte.branche])).ok) return carte.titre;
  }
  return undefined;
}

/**
 * EXAMINER CE QUI PARTIRAIT sur `branche` : les commits de HEAD absents de
 * `origin/<branche>` (ou de toute branche distante, pour une branche neuve).
 */
export async function garderLEnvoi(
  cwd: string,
  branche: string,
  cartes: { titre: string; branche?: string }[] = [],
  script = cheminDuFiltreDeContenu(),
): Promise<VerdictDeGarde> {
  const base = `origin/${branche}`;
  const args = [script, '--lot', cwd, '--jusqua', 'HEAD', '--depuis', base, '--json'];
  let sortie = '';
  let code = 0;
  let erreur = '';
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd,
      timeout: DELAI_GARDE_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    sortie = stdout;
  } catch (err: any) {
    sortie = String(err?.stdout ?? '');
    erreur = String(err?.stderr ?? err?.message ?? '');
    code = typeof err?.code === 'number' ? err.code : 2;
  }

  let resultat: { commits?: number; fichiers?: number; restes?: Reste[] } | null = null;
  try {
    resultat = JSON.parse(sortie.trim().split('\n').pop() ?? '');
  } catch {
    resultat = null;
  }
  if (!resultat || (code !== 0 && code !== 1)) {
    return {
      ok: false,
      restes: [],
      recit: `Filtre de contenu inutilisable : l’envoi est refusé tant qu’il ne répond pas. ${erreur.trim().slice(-400)}`.trim(),
    };
  }

  const restes = resultat.restes ?? [];
  if (!restes.length) {
    return {
      ok: true,
      restes,
      recit: `Filtre de contenu : ${resultat.commits ?? 0} commit(s) et ${resultat.fichiers ?? 0} fichier(s) examinés, aucun reste.`,
    };
  }

  const nommes: Reste[] = [];
  const parFichier = new Map<string, string | undefined>();
  for (const reste of restes) {
    if (!parFichier.has(reste.chemin) && parFichier.size < 20) {
      parFichier.set(reste.chemin, await carteDuFichier(cwd, base, reste.chemin, cartes));
    }
    const carte = parFichier.get(reste.chemin);
    nommes.push(carte ? { ...reste, chemin: `${reste.chemin} (carte « ${carte} »)` } : reste);
  }
  return {
    ok: false,
    restes: nommes,
    recit: `${recitDesRestes(nommes)}\nRien n’a été envoyé. Retirer la valeur du commit en cause, puis relancer la publication.`,
  };
}
