/**
 * LA MISE EN PRODUCTION D'UNE PARTIE SEULEMENT DES TÂCHES DÉPLOYÉES (refonte du 13/11/2026, menu « Publier »).
 *
 * Jusqu'ici, mettre en production faisait passer TOUTE la branche de déploiement dans la branche de production
 * (`fusion-vers-production.ts`). Le menu « Publier » laisse cocher les tâches à envoyer : seules celles-là partent.
 *
 * COMMENT. Au déploiement, chaque carte fusionnée laisse son APPORT : la tête de la branche de déploiement juste
 * avant et juste après sa fusion (table `apports_de_carte`). La branche `tache/…` disparaît ensuite à l'archivage ;
 * l'apport, lui, reste. Mettre en production les cartes cochées, c'est rejouer leurs apports, dans l'ordre où elles
 * ont été déployées, sur la tête de la branche de production — sans copie de travail : `git merge-tree` calcule
 * l'arbre, `commit-tree` pose le commit. Aucun dossier ne change de branche, rien n'est envoyé en force.
 *
 * DÉPENDANCES. Un apport qui ne s'applique pas sans une carte décochée (conflit), ou qui touche un fichier qu'une
 * carte décochée PLUS ANCIENNE a aussi touché, ne part pas : l'essai à blanc le dit AVANT, en nommant la carte qu'il
 * faut cocher aussi. Tout cocher garde le geste d'avant (la branche entière).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from './db.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], timeout = 120000): Promise<{ ok: boolean; code: number; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    return { ok: true, code: 0, out: `${stdout}${stderr}`.trim() };
  } catch (err: any) {
    return {
      ok: false,
      code: typeof err?.code === 'number' ? err.code : 1,
      out: `${err?.stdout ?? ''}${err?.stderr ?? ''}`.trim() || String(err?.message ?? err),
    };
  }
}

export interface ApportDeCarte {
  cardId: string;
  projectId: string;
  avant: string | null;
  apres: string;
  branche: string | null;
  fusionneLe: number;
  productionLe: number | null;
}

function versApport(ligne: any): ApportDeCarte {
  return {
    cardId: ligne.card_id,
    projectId: ligne.project_id,
    avant: ligne.avant ?? null,
    apres: ligne.apres,
    branche: ligne.branche ?? null,
    fusionneLe: ligne.fusionne_le,
    productionLe: ligne.production_le ?? null,
  };
}

/** Retient l'apport d'une carte fusionnée au déploiement. Une carte redéployée remplace son apport. */
export function retenirLApport(apport: { cardId: string; projectId: string; avant: string | null; apres: string; branche?: string | null }): void {
  if (!/^[0-9a-f]{40}$/.test(apport.apres)) return;
  getDb()
    .prepare(
      `INSERT INTO apports_de_carte (card_id, project_id, avant, apres, branche, fusionne_le, production_le)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(card_id) DO UPDATE SET project_id = excluded.project_id, avant = excluded.avant, apres = excluded.apres,
         branche = excluded.branche, fusionne_le = excluded.fusionne_le, production_le = NULL`,
    )
    .run(apport.cardId, apport.projectId, apport.avant && /^[0-9a-f]{40}$/.test(apport.avant) ? apport.avant : null, apport.apres, apport.branche ?? null, Date.now());
}

/** Les apports d'un projet encore absents de la production, du plus ancien au plus récent. */
export function apportsEnAttenteDeProduction(projectId: string): ApportDeCarte[] {
  return (getDb()
    .prepare('SELECT * FROM apports_de_carte WHERE project_id = ? AND production_le IS NULL ORDER BY fusionne_le ASC')
    .all(projectId) as any[]).map(versApport);
}

/** Marque des cartes comme parties en production (toutes celles du projet si `cardIds` est absent). */
export function noterLaProduction(projectId: string, cardIds?: readonly string[]): void {
  const quand = Date.now();
  if (!cardIds) {
    getDb().prepare('UPDATE apports_de_carte SET production_le = ? WHERE project_id = ? AND production_le IS NULL').run(quand, projectId);
    return;
  }
  const maj = getDb().prepare('UPDATE apports_de_carte SET production_le = ? WHERE card_id = ? AND project_id = ?');
  for (const id of cardIds) maj.run(quand, id, projectId);
}

/** Ce que l'essai à blanc dit d'une sélection. */
export interface VerdictDeSelection {
  ok: boolean;
  /** Pour chaque carte cochée qui ne peut pas partir seule : la (ou les) carte(s) décochée(s) dont elle a besoin. */
  manques: { cardId: string; besoinDe: string[]; raison: 'heurt' | 'fichiers-communs' | 'sans-apport' }[];
}

async function fichiersDeLApport(cwd: string, apport: ApportDeCarte): Promise<string[]> {
  if (!apport.avant) return [];
  const r = await git(cwd, ['diff', '--name-only', apport.avant, apport.apres], 60000);
  return r.ok ? r.out.split('\n').map((f) => f.trim()).filter(Boolean) : [];
}

/**
 * REJOUE LES APPORTS COCHÉS sur `base` (la tête de la branche de production). Rend le commit obtenu, ou les cartes
 * qui ne passent pas. `ecrire` faux : l'essai à blanc — l'arbre est calculé, aucun commit n'est gardé.
 */
export async function rejouerLesApports(
  cwd: string,
  base: string,
  choisis: readonly ApportDeCarte[],
  enAttente: readonly ApportDeCarte[],
  ecrire: boolean,
  message: (apport: ApportDeCarte) => string,
): Promise<{ ok: true; commit: string } | { ok: false; verdict: VerdictDeSelection; panne?: string }> {
  const coches = new Set(choisis.map((a) => a.cardId));
  const ordre = [...choisis].sort((a, b) => a.fusionneLe - b.fusionneLe);
  const manques: VerdictDeSelection['manques'] = [];
  /* LES FICHIERS DES CARTES DÉCOCHÉES PLUS ANCIENNES : une carte cochée qui touche les mêmes fichiers s'appuie
     probablement sur elles — elle partirait avec un code qui n'existe pas encore en production. */
  const decochees = enAttente.filter((a) => !coches.has(a.cardId));
  const fichiersDecoches = new Map<string, string[]>();
  for (const a of decochees) fichiersDecoches.set(a.cardId, await fichiersDeLApport(cwd, a));
  let tete = base;
  for (const apport of ordre) {
    if (!apport.avant) {
      manques.push({ cardId: apport.cardId, besoinDe: [], raison: 'sans-apport' });
      continue;
    }
    const mesFichiers = new Set(await fichiersDeLApport(cwd, apport));
    const anterieures = decochees.filter(
      (d) => d.fusionneLe < apport.fusionneLe && (fichiersDecoches.get(d.cardId) ?? []).some((f) => mesFichiers.has(f)),
    );
    if (anterieures.length) {
      manques.push({ cardId: apport.cardId, besoinDe: anterieures.map((d) => d.cardId), raison: 'fichiers-communs' });
      continue;
    }
    const calcul = await git(cwd, ['merge-tree', '--write-tree', '--no-messages', `--merge-base=${apport.avant}`, tete, apport.apres], 120000);
    const arbre = calcul.out.split('\n')[0]?.trim() ?? '';
    if (!calcul.ok || !/^[0-9a-f]{40}$/.test(arbre)) {
      /* Le heurt vient d'une carte décochée ou de la production elle-même : on nomme les décochées plus anciennes. */
      manques.push({
        cardId: apport.cardId,
        besoinDe: decochees.filter((d) => d.fusionneLe < apport.fusionneLe).map((d) => d.cardId),
        raison: 'heurt',
      });
      continue;
    }
    if (!ecrire) continue;
    const pose = await git(cwd, ['commit-tree', arbre, '-p', tete, '-m', message(apport)], 60000);
    if (!pose.ok || !/^[0-9a-f]{40}$/.test(pose.out.trim())) {
      return { ok: false, verdict: { ok: false, manques }, panne: `Le commit de « ${apport.cardId} » n’a pas pu être posé : ${pose.out.slice(-300)}` };
    }
    tete = pose.out.trim();
  }
  if (manques.length) return { ok: false, verdict: { ok: false, manques } };
  return { ok: true, commit: tete };
}

/**
 * L'ESSAI À BLANC D'UNE SÉLECTION : rien n'est écrit. `base` : la tête de la branche de production (distante si
 * elle existe, sinon locale).
 */
export async function verifierLaSelection(cwd: string, base: string, projectId: string, cardIds: readonly string[]): Promise<VerdictDeSelection> {
  const enAttente = apportsEnAttenteDeProduction(projectId);
  const voulus = new Set(cardIds);
  const choisis = enAttente.filter((a) => voulus.has(a.cardId));
  const manques: VerdictDeSelection['manques'] = [...voulus]
    .filter((id) => !choisis.some((a) => a.cardId === id))
    .map((cardId) => ({ cardId, besoinDe: [], raison: 'sans-apport' as const }));
  const essai = await rejouerLesApports(cwd, base, choisis, enAttente, false, () => '');
  if (!essai.ok) manques.push(...essai.verdict.manques);
  return { ok: manques.length === 0, manques };
}

/**
 * LA MISE EN PRODUCTION PARTIELLE, le geste git : la branche de production avance d'un commit par carte cochée,
 * puis est envoyée — en avance rapide seulement. Rend le récit pour le déroulé.
 */
export async function produireLaSelection(
  cwd: string,
  production: string,
  projectId: string,
  cardIds: readonly string[],
  titres: (cardId: string) => string,
): Promise<{ ok: boolean; recit: string; commit?: string }> {
  const sha = async (ref: string) => {
    const r = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], 20000);
    return r.ok && /^[0-9a-f]{40}$/.test(r.out.trim()) ? r.out.trim() : null;
  };
  const distants = (await git(cwd, ['remote'], 20000)).out.split('\n').map((n) => n.trim());
  const aDistant = distants.includes('origin');
  if (aDistant) {
    const recup = await git(cwd, ['fetch', '--quiet', 'origin'], 300000);
    if (!recup.ok) return { ok: false, recit: `Récupération du dépôt distant impossible : ${recup.out.slice(-300)}` };
  }
  const base = (aDistant ? await sha(`refs/remotes/origin/${production}`) : null) ?? (await sha(`refs/heads/${production}`));
  if (!base) return { ok: false, recit: `La branche de production « ${production} » est introuvable.` };
  const enAttente = apportsEnAttenteDeProduction(projectId);
  const voulus = new Set(cardIds);
  const choisis = enAttente.filter((a) => voulus.has(a.cardId));
  if (choisis.length !== voulus.size) {
    return { ok: false, recit: 'Certaines tâches cochées n’ont pas d’apport connu : elles ont été déployées avant la mise en production partielle. Cochez toutes les tâches pour les envoyer.' };
  }
  const rejeu = await rejouerLesApports(cwd, base, choisis, enAttente, true, (a) => `Mise en production : ${titres(a.cardId)}`);
  if (!rejeu.ok) {
    const noms = rejeu.verdict.manques.map((m) => `« ${titres(m.cardId)} »`).join(', ');
    return { ok: false, recit: rejeu.panne ?? `Ces tâches ne peuvent pas partir seules : ${noms}. Cochez aussi les tâches dont elles dépendent.` };
  }
  const commit = rejeu.commit;
  if (aDistant && commit !== base) {
    const envoi = await git(cwd, ['push', 'origin', `${commit}:refs/heads/${production}`], 300000);
    if (!envoi.ok) return { ok: false, recit: `L’envoi de « ${production} » a été refusé (aucun envoi forcé n’est tenté) : ${envoi.out.split('\n').slice(-3).join(' ')}` };
  }
  /* LA BRANCHE LOCALE suit, en avance rapide seulement ; sinon elle est gardée telle quelle et on le dit. */
  const locale = await sha(`refs/heads/${production}`);
  const notes: string[] = [];
  const courante = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 20000)).out.trim();
  if (locale !== commit && courante !== production) {
    const ancetre = !locale || (await git(cwd, ['merge-base', '--is-ancestor', locale, commit], 30000)).ok;
    if (ancetre) await git(cwd, ['update-ref', `refs/heads/${production}`, commit]);
    else notes.push(`La branche locale « ${production} » porte des commits absents d’ici : elle n’est pas avancée.`);
  }
  noterLaProduction(projectId, [...voulus]);
  const liste = choisis.map((a) => `- ${titres(a.cardId)}`).join('\n');
  return {
    ok: true,
    commit,
    recit: [`Mise en production partielle : ${choisis.length} tâche(s) rejouée(s) sur « ${production} » (${base.slice(0, 7)} → ${commit.slice(0, 7)}).`, liste, ...notes].filter(Boolean).join('\n'),
  };
}
