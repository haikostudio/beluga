/**
 * FAIRE PASSER « dev » DANS « main » À LA MISE EN PRODUCTION — le geste git.
 *
 * Les règles (quel geste, quel récit) vivent dans
 * `shared/src/fusion-vers-production.ts`. Ici, git, et trois prudences :
 *
 *  1. AUCUNE COPIE DE TRAVAIL NE CHANGE DE BRANCHE. Le commit se fabrique sur
 *     les références (`commit-tree`) : le dossier partagé, qui fait tourner
 *     l'instance de dev, ne voit pas un fichier bouger.
 *  2. JAMAIS EN FORCE. `main` reçoit un commit dont son ancien sommet est un
 *     ancêtre ; si GitHub refuse l'avance rapide, l'étape échoue et le dit.
 *  3. RIEN NE SE PERD. Une branche locale qu'on ne peut pas avancer sans
 *     abandonner des commits est d'abord mise à l'abri sous « archive/… ».
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  gesteVersProduction,
  messageVersProduction,
  recitVersProduction,
  type GesteVersProduction,
} from '@beluga/shared';

const execFileAsync = promisify(execFile);

async function lancer(cwd: string, args: string[], timeout = 120000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err: any) {
    return { ok: false, out: `${err?.stdout ?? ''}${err?.stderr ?? ''}`.trim() || String(err?.message ?? err) };
  }
}

export interface IssueVersProduction {
  ok: boolean;
  geste: GesteVersProduction | 'panne';
  recit: string;
  /** Le sommet de la branche de production après le geste. */
  commit?: string;
}

export async function fusionnerVersLaProduction(cwd: string, source: string, cible: string): Promise<IssueVersProduction> {
  const sha = async (ref: string) => {
    const r = await lancer(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], 20000);
    const out = r.out.trim();
    return r.ok && /^[0-9a-f]{40}$/.test(out) ? out : null;
  };
  const ancetre = async (a: string, b: string) => (await lancer(cwd, ['merge-base', '--is-ancestor', a, b], 30000)).ok;
  const panne = (recit: string): IssueVersProduction => ({ ok: false, geste: 'panne', recit });

  const distants = (await lancer(cwd, ['remote'], 20000)).out.split('\n').map((n) => n.trim());
  const aDistant = distants.includes('origin');
  if (aDistant) {
    const recup = await lancer(cwd, ['fetch', '--quiet', 'origin'], 300000);
    if (!recup.ok) return panne(`Récupération du dépôt distant impossible avant la fusion vers « ${cible} » : ${recup.out.slice(-300)}`);
  }

  /*
   * LA SOURCE EST CE QUI TOURNE ICI : la branche locale, que le déploiement a
   * fusionnée et poussée. Sa copie distante ne sert que de repli.
   */
  const sourceDistante = aDistant ? await sha(`refs/remotes/origin/${source}`) : null;
  const S = (await sha(`refs/heads/${source}`)) ?? sourceDistante;
  // La cible publiée fait foi : c'est elle qu'il faut avancer sans forcer.
  const cibleLocale = await sha(`refs/heads/${cible}`);
  const T = (aDistant ? await sha(`refs/remotes/origin/${cible}`) : null) ?? cibleLocale;

  const arbre = async (commit: string) => (await lancer(cwd, ['rev-parse', `${commit}^{tree}`], 20000)).out.trim();
  const geste = gesteVersProduction({
    sourceExiste: !!S,
    cibleExiste: !!T,
    cibleContientSource: !!S && !!T && (await ancetre(S, T)),
    sourceContientCible: !!S && !!T && (await ancetre(T, S)),
    arbresEgaux: !!S && !!T && (await arbre(S)) === (await arbre(T)),
  });
  if (geste === 'sans-source' || !S) {
    return { ok: false, geste: 'sans-source', recit: recitVersProduction({ geste: 'sans-source', source, cible }) };
  }

  let M = S;
  let ecartes: string[] = [];
  let fichiers: string[] = [];
  if (geste === 'deja-a-jour' && T) M = T;
  if ((geste === 'recalage' || geste === 'fusion') && T) {
    ecartes = (await lancer(cwd, ['log', '--no-merges', '--format=%h %s', `${S}..${T}`])).out.split('\n').filter(Boolean);
    fichiers = (await lancer(cwd, ['diff', '--name-only', S, T])).out.split('\n').filter(Boolean);
    const parents = geste === 'fusion' ? ['-p', T, '-p', S] : ['-p', T];
    const pose = await lancer(cwd, ['commit-tree', `${S}^{tree}`, ...parents, '-m', messageVersProduction(geste, source, cible)]);
    if (!pose.ok || !/^[0-9a-f]{40}$/.test(pose.out.trim())) {
      return panne(`Le commit de fusion vers « ${cible} » n’a pas pu être posé : ${pose.out.slice(-300)}`);
    }
    M = pose.out.trim();
  }

  const notes: string[] = [];
  if (aDistant && M !== T) {
    const envoi = await lancer(cwd, ['push', 'origin', `${M}:refs/heads/${cible}`], 300000);
    if (!envoi.ok) {
      return panne(
        `L’envoi de « ${cible} » a été refusé (aucun envoi forcé n’est tenté) : ${envoi.out.split('\n').slice(-3).join(' ')}`,
      );
    }
  }

  /*
   * « dev » RATTRAPE LE COMMIT DE FUSION : son arbre est le même, aucun fichier
   * ne bouge, et les deux branches ne se comptent plus de retard l'une sur
   * l'autre. Seulement en avance rapide, et seulement si GitHub n'a pas vu
   * passer d'autres commits sur « dev » entre-temps.
   */
  if (M !== S && aDistant) {
    if (!sourceDistante || (await ancetre(sourceDistante, M))) {
      const envoiSource = await lancer(cwd, ['push', 'origin', `${M}:refs/heads/${source}`], 300000);
      if (!envoiSource.ok) notes.push(`« ${source} » n’a pas pu rattraper le commit de fusion sur le dépôt distant : ${envoiSource.out.slice(-200)}`);
    } else {
      notes.push(`« ${source} » porte sur le dépôt distant des commits absents d’ici : elle n’est pas avancée.`);
    }
  }

  const courante = (await lancer(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 20000)).out.trim();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  for (const branche of M !== S ? [cible, source] : [cible]) {
    const avant = await sha(`refs/heads/${branche}`);
    if (avant === M) continue;
    if (branche === courante) {
      const avance = await lancer(cwd, ['merge', '--ff-only', '--quiet', M], 120000);
      if (!avance.ok) notes.push(`La branche locale « ${branche} » (copie de travail) n’a pas pu avancer : ${avance.out.slice(-200)}`);
      continue;
    }
    if (avant && !(await ancetre(avant, M))) {
      const abri = `archive/${branche}-avant-production-${stamp}`;
      await lancer(cwd, ['branch', abri, avant]);
      notes.push(`L’ancienne « ${branche} » locale portait des commits absents de la version mise en production : gardée sous « ${abri} ».`);
    }
    await lancer(cwd, ['update-ref', `refs/heads/${branche}`, M]);
  }

  return {
    ok: true,
    geste,
    commit: M,
    recit: recitVersProduction({ geste, source, cible, avant: T ?? undefined, apres: M, ecartes, fichiers, notes }),
  };
}
