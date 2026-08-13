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
  groupesHorsTache,
  nomBrancheHorsTache,
  titreHorsTache,
  TraceDuTravail,
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
 * Le dépôt a-t-il RÉELLEMENT bougé pendant le tour ?
 *
 * Deux façons de le constater, l'une comme l'autre suffisante : un
 * enregistrement s'est ajouté depuis le repère de départ, ou des fichiers sont
 * modifiés dans le dossier. C'est ce constat — le MÊME repère que le travail
 * hors tâche, pas un second — qui autorise une carte à passer en « Terminé ».
 *
 * Trois réponses, pas deux (`TraceDuTravail`). Sans repère, le projet n'est pas
 * un dépôt git : il n'y a RIEN à observer, on rend « oui » plutôt que de retenir
 * une carte sur une observation impossible par nature. Mais un dépôt git qui ne
 * RÉPOND PAS rend « inconnue » : c'est un trou, pas une trace, et une carte ne
 * se clôt pas sur un trou.
 */
export async function traceDuTravailDepuis(
  projectPath: string,
  avant: RepereDepot | null,
): Promise<TraceDuTravail> {
  if (!avant) return 'oui';
  const commits = await commitsDuTour(projectPath, avant);
  if (commits.length) return 'oui';
  const enCours = await git(projectPath, ['status', '--porcelain']);
  if (enCours === null) return 'inconnue';
  return enCours.trim().length > 0 ? 'oui' : 'non';
}

/** Une fonctionnalité posée sur sa branche. */
export interface BrancheIsolee {
  commits: CommitObserve[];
  branche: string;
  /** La branche dont celle-ci dépend, quand elle n'a pas pu tenir seule. */
  empileeSur?: string;
}

/**
 * Construit une branche portant EXACTEMENT ces enregistrements, repiqués sur
 * la base donnée. Rend le sommet obtenu, ou null si un repiquage a coincé.
 */
async function construire(
  projectPath: string,
  branche: string,
  base: string,
  commits: CommitObserve[],
): Promise<string | null> {
  if ((await git(projectPath, ['checkout', '-B', branche, base], 60000)) === null) return null;
  for (const commit of commits) {
    if ((await git(projectPath, ['cherry-pick', commit.sha], 60000)) === null) {
      // Un repiquage qui coince laisse le dossier en plein milieu : on annule,
      // sinon plus rien ne peut bouger ensuite.
      await git(projectPath, ['cherry-pick', '--abort'], 30000);
      return null;
    }
  }
  return (await git(projectPath, ['rev-parse', 'HEAD']))?.trim() ?? null;
}

/**
 * Met CHAQUE fonctionnalité du tour sur SA PROPRE branche, et rend la branche
 * de départ à l'état où elle était avant.
 *
 * C'est ce qui rend une fonctionnalité retirable d'un geste : tant qu'elle vit
 * sur sa branche, supprimer sa carte suffit — la branche n'est jamais fusionnée
 * et rien ne part en ligne. Un tour qui enregistre quatre choses donne donc
 * quatre branches et quatre cartes, pas un paquet indivisible.
 *
 * Chaque branche est repiquée depuis l'état d'AVANT le tour : elle ne contient
 * que son propre travail. Quand deux fonctionnalités touchent les mêmes lignes,
 * la seconde ne peut pas tenir seule — elle est alors posée SUR la première, et
 * sa carte le dit.
 *
 * On ne déplace RIEN si le moindre doute existe : le dossier est partagé, et
 * réécrire l'histoire sous les pieds d'un autre agent coûte plus cher que de
 * laisser le travail où il est. Les garde-fous, tous obligatoires :
 *   - le dossier est propre (aucune modification en cours) ;
 *   - on est toujours sur la branche notée au départ ;
 *   - le sommet est bien le dernier enregistrement retenu (personne n'a rien
 *     ajouté après) ;
 *   - aucun de ces enregistrements n'est déjà parti au dépôt (on ne réécrit
 *     JAMAIS une histoire publiée) ;
 *   - aucun nom de branche n'est déjà pris ;
 *   - toutes les branches se construisent, et le retour en arrière réussit.
 *
 * Au moindre échec, TOUT est annulé : les branches créées sont effacées et le
 * travail reste où il était. Mieux vaut une grosse carte qu'un demi-découpage.
 */
export async function isoleChaqueGroupe(
  projectPath: string,
  avant: RepereDepot,
  groupes: CommitObserve[][],
): Promise<BrancheIsolee[] | null> {
  const retenus = groupes.flat();
  if (!retenus.length) return null;

  const propre = await git(projectPath, ['status', '--porcelain']);
  if (propre === null || propre.trim()) return null;

  const brancheActuelle = (await git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  if (!brancheActuelle || brancheActuelle !== avant.branche || brancheActuelle === 'HEAD') return null;

  const tete = (await git(projectPath, ['rev-parse', 'HEAD']))?.trim();
  if (!tete || tete !== retenus[retenus.length - 1].sha) return null;

  // Déjà au dépôt : l'histoire est publique, on n'y touche pas.
  for (const commit of retenus) {
    const distants = await git(projectPath, ['branch', '-r', '--contains', commit.sha]);
    if (distants === null || distants.trim()) return null;
  }

  const noms = groupes.map((groupe) => nomBrancheHorsTache(groupe));
  for (const nom of noms) {
    if ((await git(projectPath, ['rev-parse', '--verify', '--quiet', nom]))?.trim()) return null;
  }

  const faites: (BrancheIsolee & { tete: string })[] = [];
  let complet = true;
  for (const [index, groupe] of groupes.entries()) {
    const nom = noms[index];
    const precedente = faites[faites.length - 1];
    // D'abord seule, depuis l'état d'avant le tour. Si ça coince, empilée sur
    // la fonctionnalité d'avant — c'est qu'elles se partagent des lignes.
    let sommet = await construire(projectPath, nom, avant.tete, groupe);
    let empileeSur: string | undefined;
    if (!sommet && precedente) {
      sommet = await construire(projectPath, nom, precedente.tete, groupe);
      if (sommet) empileeSur = precedente.branche;
    }
    if (!sommet) {
      complet = false;
      break;
    }
    faites.push({ commits: groupe, branche: nom, empileeSur, tete: sommet });
  }

  // Retour sur la branche de départ, quoi qu'il arrive : le dossier est
  // partagé, on ne le laisse jamais posé sur une branche de travail.
  const revenu = await git(projectPath, ['checkout', avant.branche], 60000);
  if (revenu === null || !complet) {
    for (const faite of faites) await git(projectPath, ['branch', '-D', faite.branche]);
    return null;
  }

  // Les branches portent tout le travail : la branche de départ peut revenir en
  // arrière sans rien perdre. En cas d'échec, on efface les branches créées
  // plutôt que de laisser deux copies du même travail.
  if ((await git(projectPath, ['reset', '--hard', avant.tete], 60000)) === null) {
    for (const faite of faites) await git(projectPath, ['branch', '-D', faite.branche]);
    return null;
  }

  // Envoi au dépôt : les branches survivent à une remise à zéro du dossier. Un
  // échec (pas de dépôt distant, réseau coupé) ne remet rien en cause.
  for (const faite of faites) {
    await git(projectPath, ['push', '-u', 'origin', faite.branche], 120000);
    log.info(`travail hors tâche isolé sur la branche ${faite.branche}`);
  }
  return faites.map(({ commits, branche, empileeSur }) => ({ commits, branche, empileeSur }));
}

/** La carte d'UNE fonctionnalité, posée directement dans « À déployer ». */
function poserCarte(
  agent: Agent,
  commits: CommitObserve[],
  branche: string,
  isolee: boolean,
  empileeSur?: string,
): Card {
  const card = store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: agent.projectId,
      title: titreHorsTache(commits),
      description: descriptionHorsTache(
        commits,
        agent.title || 'un agent',
        isolee ? branche : undefined,
        empileeSur,
      ),
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
        commits: commits.map((commit) => ({ sha: commit.sha, message: commit.titre, date: commit.date })),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  bus.emit({ type: 'card.upsert', card });
  return card;
}

/**
 * Fabrique les cartes, s'il y a de quoi. Rend celles créées.
 *
 * UNE FONCTIONNALITÉ = UNE BRANCHE = UNE CARTE. Un tour qui enregistre quatre
 * choses différentes rend quatre cartes : on peut alors en publier une, en
 * supprimer une autre, sans que les quatre se tiennent par la main.
 *
 * On ne crée rien pour un agent qui a déjà sa carte : son travail est déjà
 * fiché, et sa branche part au lot par le chemin habituel.
 */
export async function cartesDuTravailHorsTache(agent: Agent, avant: RepereDepot | null): Promise<Card[]> {
  if (agent.cardId) return [];
  const project = store.getProject(agent.projectId);
  if (!project) return [];

  let observes: CommitObserve[];
  try {
    observes = await commitsDuTour(project.path, avant);
  } catch (err) {
    log.warn('lecture des enregistrements du tour impossible', err);
    return [];
  }
  if (!observes.length) return [];

  const retenus = commitsSansCarte(observes, {
    shasCouverts: store.shasCouverts(agent.projectId),
    branchesDeCartes: store.branchesDeCartes(agent.projectId),
  });
  if (!retenus.length) return [];

  const groupes = groupesHorsTache(retenus);

  /*
   * Chaque fonctionnalité part sur SA branche avant d'être fichée : sa carte
   * porte une branche à elle, exactement comme une carte de tâche, et la
   * supprimer suffit à l'écarter. Si le découpage n'est pas sûr — dossier qui a
   * bougé, travail déjà envoyé au dépôt, lignes qui se chevauchent trop —, tout
   * reste où il est et une seule carte le dit franchement.
   */
  const isolees = avant ? await isoleChaqueGroupe(project.path, avant, groupes).catch(() => null) : null;

  const cartes = isolees
    ? isolees.map((part) => poserCarte(agent, part.commits, part.branche, true, part.empileeSur))
    : [poserCarte(agent, retenus, retenus[0].branche ?? '', false)];

  const premier = cartes[0];
  if (isolees) {
    bus.toast(
      'info',
      cartes.length > 1
        ? `${cartes.length} fonctionnalités fichées, chacune sur sa branche, dans « À déployer ».`
        : `Travail hors tâche fiché sur sa branche : « ${premier.title} » vous attend dans « À déployer ».`,
    );
  } else {
    bus.toast('warning', `Travail hors tâche fiché : « ${premier.title} » — il est resté sur la branche principale.`);
  }

  // UNE seule notification pour le tour : quatre cartes ne font pas quatre
  // sonneries. Elle pointe la première, les autres sont juste à côté.
  notify({
    motif: 'travail-sans-carte',
    title: cartes.length > 1 ? `${cartes.length} travaux enregistrés sans tâche` : 'Travail enregistré sans tâche',
    body:
      cartes.length > 1
        ? cartes.map((carte) => carte.title).join(' · ')
        : `${premier.title} — une carte a été créée dans « À déployer ».`,
    reference: cartes.map((carte) => carte.id).join(','),
    element: premier.title,
    cardId: premier.id,
    projectId: premier.projectId,
  });
  log.info(
    `${cartes.length} carte(s) hors tâche créée(s) (${retenus.length} enregistrement(s)) pour l'agent ${agent.id}`,
  );
  return cartes;
}
