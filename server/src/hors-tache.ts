/**
 * Une carte pour le travail fait HORS TÂCHE.
 *
 * Un agent sans carte — le chef d'orchestre, le plus souvent — peut enregistrer
 * du code. Ce travail n'apparaissait que comme « changements enregistrés sans
 * carte » dans le bloc de publication : il pouvait partir en ligne sans fiche,
 * sans titre, sans conversation rattachée, et sans jamais entrer dans
 * l'historique du projet.
 *
 * On borne donc chaque tour d'agent : on note où en est le dépôt AVANT, on
 * regarde ce qui s'est ajouté APRÈS, et ce qui reste après le tri (voir
 * `travail-hors-tache` dans `shared`) devient une carte posée directement dans
 * « À déployer » — le travail est fait, il n'y a rien à valider.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Agent,
  Card,
  CommitObserve,
  commitsSansCarte,
  descriptionHorsTache,
  nomBrancheHorsTache,
  titreHorsTache,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { notify } from './notify.js';

const execFileAsync = promisify(execFile);

export interface RepereDepot {
  branche: string;
  tete: string;
}

async function git(cwd: string, args: string[], timeout = 20000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Où en est le dépôt à l'instant où l'agent prend la main. Rien à noter si le
 * projet n'est pas suivi par git, ou si la branche n'a pas encore de sommet.
 */
export async function repereAvant(projectPath: string): Promise<RepereDepot | null> {
  const branche = (await git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  if (!branche) return null;
  const tete = (await git(projectPath, ['rev-parse', 'HEAD']))?.trim();
  if (!tete) return null;
  return { branche, tete };
}

/**
 * Ce qui s'est ajouté pendant le tour, sur la branche où l'agent a fini.
 *
 * Le dossier est PARTAGÉ : l'agent a pu changer de branche en cours de route.
 * On compare donc à ce qu'on avait noté, et si la branche a changé on prend ce
 * que la nouvelle branche a de plus que l'ancien sommet.
 */
export async function commitsDuTour(projectPath: string, avant: RepereDepot | null): Promise<CommitObserve[]> {
  if (!avant) return [];
  const brancheApres = (await git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  if (!brancheApres) return [];

  const sortie = await git(projectPath, [
    'log',
    '--format=%H%x1f%s%x1f%P%x1f%aI',
    `${avant.tete}..HEAD`,
  ]);
  if (!sortie) return [];

  const commits: CommitObserve[] = [];
  for (const ligne of sortie.split('\n')) {
    if (!ligne.trim()) continue;
    const [sha, titre, parents, date] = ligne.split('\u001f');
    if (!sha) continue;
    commits.push({
      sha: sha.trim(),
      titre: (titre ?? '').trim(),
      branche: brancheApres,
      fusion: (parents ?? '').trim().split(/\s+/).filter(Boolean).length > 1,
      date,
    });
  }
  // Du plus ancien au plus récent : le premier message donne le titre.
  return commits.reverse();
}

/**
 * Met ce travail sur SA PROPRE branche, et rend la branche principale à l'état
 * où elle était avant le tour.
 *
 * C'est ce qui rend une fonctionnalité retirable d'un geste : tant qu'elle vit
 * sur sa branche, supprimer sa carte suffit — la branche n'est jamais fusionnée
 * et rien ne part en ligne. Sans cela, le travail du chef d'orchestre était
 * posé sur la branche principale et partait quoi qu'on fasse de la carte.
 *
 * On ne déplace RIEN si le moindre doute existe : le dossier est partagé, et
 * réécrire l'histoire sous les pieds d'un autre agent coûte plus cher que de
 * laisser le travail où il est. Cinq garde-fous, tous obligatoires :
 *   - le dossier est propre (aucune modification en cours) ;
 *   - on est toujours sur la branche notée au départ ;
 *   - le sommet est bien le dernier enregistrement retenu (personne n'a rien
 *     ajouté après) ;
 *   - aucun de ces enregistrements n'est déjà parti au dépôt (on ne réécrit
 *     JAMAIS une histoire publiée) ;
 *   - la création de la branche et le retour en arrière réussissent tous deux.
 *
 * Rend le nom de la branche, ou null si le travail est resté où il était.
 */
export async function isoleSurBranche(
  projectPath: string,
  avant: RepereDepot,
  retenus: CommitObserve[],
): Promise<string | null> {
  if (!retenus.length) return null;

  const propre = await git(projectPath, ['status', '--porcelain']);
  if (propre === null || propre.trim()) return null;

  const brancheActuelle = (await git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  if (!brancheActuelle || brancheActuelle !== avant.branche || brancheActuelle === 'HEAD') return null;

  const tete = (await git(projectPath, ['rev-parse', 'HEAD']))?.trim();
  const dernier = retenus[retenus.length - 1].sha;
  if (!tete || tete !== dernier) return null;

  // Déjà au dépôt : l'histoire est publique, on n'y touche pas.
  for (const commit of retenus) {
    const distants = await git(projectPath, ['branch', '-r', '--contains', commit.sha]);
    if (distants === null || distants.trim()) return null;
  }

  const branche = nomBrancheHorsTache(retenus);
  if ((await git(projectPath, ['rev-parse', '--verify', '--quiet', branche]))?.trim()) return null;
  if ((await git(projectPath, ['branch', branche])) === null) return null;

  // La branche existe et porte le travail : la principale peut revenir en
  // arrière sans rien perdre. En cas d'échec, on efface la branche créée
  // plutôt que de laisser deux copies du même travail.
  if ((await git(projectPath, ['reset', '--hard', avant.tete], 60000)) === null) {
    await git(projectPath, ['branch', '-D', branche]);
    return null;
  }

  // Envoi au dépôt : la branche survit à une remise à zéro du dossier. Un
  // échec (pas de dépôt distant, réseau coupé) ne remet rien en cause.
  await git(projectPath, ['push', '-u', 'origin', branche], 120000);
  log.info(`travail hors tâche isolé sur la branche ${branche}`);
  return branche;
}

/**
 * Fabrique la carte, s'il y a de quoi. Rend la carte créée, ou null.
 *
 * On ne crée rien pour un agent qui a déjà sa carte : son travail est déjà
 * fiché, et sa branche part au lot par le chemin habituel.
 */
export async function carteDuTravailHorsTache(agent: Agent, avant: RepereDepot | null): Promise<Card | null> {
  if (agent.cardId) return null;
  const project = store.getProject(agent.projectId);
  if (!project) return null;

  let observes: CommitObserve[];
  try {
    observes = await commitsDuTour(project.path, avant);
  } catch (err) {
    log.warn('lecture des enregistrements du tour impossible', err);
    return null;
  }
  if (!observes.length) return null;

  const retenus = commitsSansCarte(observes, {
    shasCouverts: store.shasCouverts(agent.projectId),
    branchesDeCartes: store.branchesDeCartes(agent.projectId),
  });
  if (!retenus.length) return null;

  /*
   * Le travail part sur SA branche avant d'être fiché : la carte porte alors
   * une branche à elle, exactement comme une carte de tâche, et la supprimer
   * suffit à écarter la fonctionnalité. Si l'isolement n'est pas sûr, on garde
   * la branche d'origine et la description le dit franchement.
   */
  const isolee = avant ? await isoleSurBranche(project.path, avant, retenus).catch(() => null) : null;
  const branche = isolee ?? retenus[0].branche;
  const card = store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: agent.projectId,
      title: titreHorsTache(retenus),
      description: descriptionHorsTache(retenus, agent.title || 'un agent', isolee ?? undefined),
      labels: isolee ? ['hors tâche'] : ['hors tâche', 'sur la principale'],
      // Le travail est FAIT : il n'y a rien à valider, la carte entre
      // directement dans le lot à publier.
      column: 'to_deploy',
      position: store.nextPosition(agent.projectId, 'to_deploy'),
      origin: 'agent',
      run: agent.run,
      horsTache: true,
      // La conversation de l'agent reste la sienne : la carte s'y rattache
      // sans se l'approprier.
      conversationAgentId: agent.id,
      github: {
        branch: branche,
        checks: [],
        activity: [],
        commits: retenus.map((commit) => ({ sha: commit.sha, message: commit.titre, date: commit.date })),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

  bus.emit({ type: 'card.upsert', card });
  bus.toast(
    isolee ? 'info' : 'warning',
    isolee
      ? `Travail hors tâche fiché sur sa branche : « ${card.title} » vous attend dans « À déployer ».`
      : `Travail hors tâche fiché : « ${card.title} » — il est resté sur la branche principale.`,
  );
  notify({
    kind: 'done',
    title: 'Travail enregistré sans tâche',
    body: `${card.title} — une carte a été créée dans « À déployer ».`,
    cardId: card.id,
    projectId: card.projectId,
  });
  log.info(`carte hors tâche créée (${retenus.length} enregistrement(s)) pour l'agent ${agent.id}`);
  return card;
}
