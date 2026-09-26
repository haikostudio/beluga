/**
 * UN SEUL DIALOGUE AVEC GIT, POUR TOUT LE DÉMON.
 *
 * Constat qui a produit ce module : cinq modules du démon portaient chacun
 * leur propre enveloppe `git()` (`dossier-de-carte.ts`, `branche-de-deploiement.ts`,
 * `recollage-documentaire.ts`, `github.ts`, `hors-tache.ts`), et trois d'entre
 * eux — plus `deploy.ts` — recalculaient chacun « la branche principale » du
 * dépôt avec le même code recopié. Trois de ces enveloppes forçaient la langue
 * neutre, deux non ; une seule nommait le délai dépassé ; aucune ne se
 * corrigeait quand les autres l'étaient. Un dépôt en « master » pouvait ainsi
 * être vu « main » par un module et « master » par un autre.
 *
 * Désormais UNE enveloppe, UNE branche principale, UN vocabulaire :
 *
 *  - `git()` rend `{ ok, out }`, jamais une exception : l'appelant lit la sortie
 *    et décide. Git parle en langue NEUTRE (`LC_ALL=C`), sinon un serveur réglé
 *    en français ne reconnaîtrait aucun de ses messages
 *    (`shared/src/reparation-worktree.ts`), et il ne demande jamais rien à un
 *    terminal (`GIT_TERMINAL_PROMPT=0`) : le démon n'en a pas.
 *  - `sortieGit()` ne rend que la sortie standard, ou `null` quand git refuse :
 *    la forme qu'attendent les lectures pures (`rev-parse`, `log`, `diff`).
 *  - `branchePrincipale()` est LA fonction qui dit quelle est la branche
 *    principale d'un dépôt : celle que suit le dépôt distant, sinon « main » ou
 *    « master » si l'une existe, sinon la branche courante. Deviner « main »
 *    sur un dépôt en « master » ferait partir une carte du mauvais endroit et
 *    fusionner le lot au mauvais endroit.
 *
 * Ce module ne connaît ni la base, ni les cartes : rien que git et un dossier.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { motDeDelaiDepasse, sansBruitDeProgression } from '@beluga/shared';

const execFileAsync = promisify(execFile);

/**
 * Git parle la langue de l'environnement. Or les pannes de dossier se
 * reconnaissent à leur MESSAGE : sous un serveur réglé en français, « une
 * branche nommée … existe déjà » ne ressemblerait à aucun de nos motifs et la
 * réparation ne partirait jamais. On force donc la langue neutre pour tout ce
 * que le démon demande à git — et on interdit toute question au terminal.
 */
export const ENVIRONNEMENT_GIT = { LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', GIT_TERMINAL_PROMPT: '0' };

/** Ce que rend une commande git : a-t-elle pris, et ce qu'elle a dit. */
export type SortieGit = { ok: boolean; out: string };

/** Le délai ordinaire d'une commande git : large, parce que les dépôts montés à distance sont lents. */
export const DELAI_GIT_MS = 180000;

/**
 * LANCE GIT ET REND CE QU'IL A DIT, sans jamais lever.
 *
 * `out` réunit la sortie standard et la sortie d'erreur, coupées des bords :
 * c'est ce qu'on relit dans un journal ou sur une carte. Un échec garde les
 * 1500 DERNIERS signes — la phrase utile de git est presque toujours la
 * dernière — et nomme le délai dépassé quand c'est lui qui a coupé.
 */
export async function git(cwd: string, args: string[], timeout = DELAI_GIT_MS): Promise<SortieGit> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...ENVIRONNEMENT_GIT },
    });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err: any) {
    /*
     * UN GIT TUÉ PAR SON DÉLAI LE DIT AVEC CE MOT-LÀ. `execFile` rend alors
     * « Command failed » et un signal : illisible sur une carte. On le nomme
     * ici, en tête, pour que la phrase survive à la coupe des 1500 signes —
     * et on ôte le ruban d'avancement, qui sinon occupait toute la place.
     */
    const tuePourDelai = err?.killed === true || err?.code === 'ETIMEDOUT';
    const brut = sansBruitDeProgression(`${err?.stdout ?? ''}\n${err?.stderr ?? ''}\n${err?.message ?? ''}`);
    /* La phrase du délai passe EN DERNIER : c'est la fin du message qui est
       gardée, ici comme dans `raisonApresReparations`. */
    const dit = tuePourDelai ? `${brut}\n${motDeDelaiDepasse(timeout / 1000)}` : brut;
    return { ok: false, out: dit.trim().slice(-1500) };
  }
}

/**
 * LA SORTIE STANDARD SEULE, telle quelle, ou `null` quand git refuse.
 *
 * C'est la forme des LECTURES : un `git log --format=…` se découpe ligne à
 * ligne, et la sortie d'erreur n'a rien à y faire. `null` — et non une chaîne
 * vide — pour que l'appelant distingue « git n'a rien à dire » de « git n'a
 * pas pu répondre ».
 */
export async function sortieGit(cwd: string, args: string[], timeout = 20000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...ENVIRONNEMENT_GIT },
    });
    return stdout;
  } catch {
    return null;
  }
}

/** La branche sur laquelle ce dossier est posé — vide si git ne répond pas. */
export async function brancheCourante(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 20000);
  return r.ok ? r.out.trim() : '';
}

/** La branche existe-t-elle vraiment dans ce dépôt, ici et maintenant ? */
export async function existeLaBranche(racine: string, branche: string): Promise<boolean> {
  const r = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  return r.ok && !!r.out.trim();
}

/**
 * LA BRANCHE PRINCIPALE DU DÉPÔT : celle que suit le dépôt distant
 * (`refs/remotes/origin/HEAD`), sinon celle qui existe réellement parmi
 * « main » et « master », sinon la branche courante — et « main » en tout
 * dernier recours, pour un dépôt sans le moindre enregistrement.
 *
 * C'est LA SEULE fonction qui tranche cette question dans le démon : la
 * publication, le suivi GitHub des cartes, la pose des branches de la règle
 * d'or et l'ouverture des copies de travail passent tous par elle.
 */
export async function branchePrincipale(racine: string): Promise<string> {
  const distant = await git(racine, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 30000);
  const nom = distant.ok ? distant.out.trim().replace(/^origin\//, '') : '';
  if (nom) return nom;
  for (const candidat of ['main', 'master']) {
    if (await existeLaBranche(racine, candidat)) return candidat;
  }
  const courante = await brancheCourante(racine);
  return courante || 'main';
}

/**
 * CETTE BRANCHE EST-ELLE DÉJÀ CONTENUE DANS CELLE-LÀ ? Vrai quand tout ce
 * que porte `branche` fait déjà partie de l'histoire de `dans` : c'est le
 * critère de « fusionnée » que git lui-même applique à `git branch -d`.
 */
export async function brancheContenueDans(racine: string, branche: string, dans: string): Promise<boolean> {
  const r = await git(racine, ['merge-base', '--is-ancestor', branche, dans], 30000);
  return r.ok;
}

/** Les copies de travail ouvertes dans ce dépôt (le dossier principal compris). */
export async function dossiersOuverts(racine: string): Promise<string[]> {
  const liste = await git(racine, ['worktree', 'list', '--porcelain'], 30000);
  if (!liste.ok) return [];
  return liste.out
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter(Boolean);
}

/**
 * QUELLE COPIE DE TRAVAIL TIENT CETTE BRANCHE ? Le chemin de la copie posée
 * dessus — le dossier principal compris —, ou rien si personne ne la tient.
 */
export async function copieQuiTientLaBranche(racine: string, branche: string): Promise<string | undefined> {
  const liste = await git(racine, ['worktree', 'list', '--porcelain'], 30000);
  if (!liste.ok) return undefined;
  let courant = '';
  for (const ligne of liste.out.split('\n')) {
    if (ligne.startsWith('worktree ')) courant = ligne.slice('worktree '.length).trim();
    if (ligne.trim() === `branch refs/heads/${branche}`) return courant || undefined;
  }
  return undefined;
}
