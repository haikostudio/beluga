import * as store from './store.js';
import { bus } from './bus.js';
import { isRunning } from './runtime.js';
import { appendHistory } from './memory.js';
import { log } from './logger.js';
import { fermerLesQuestionsSiCarteRangee } from './fermeture-questions.js';
import { archiverLaBrancheDeCarte } from './dossier-de-carte.js';
import { archiverLesBranchesAnnexes } from './copies-des-depots.js';
import { ajouterAuChangelog, marquerLaPublication, purgerLeBrouillon } from './connaissances.js';
import { redigerLEntreeDeLaCarte } from './redaction-changelog.js';

/**
 * L'archivage (PLAN §11) : il fait deux choses, dans cet ordre.
 * 1. la branche est refermée et l'espace de travail nettoyé ;
 * 2. la carte part dans « Archivé ».
 *
 * Et jamais tant qu'un agent parle encore (PLAN §30).
 *
 * PLUS AUCUN DOCUMENT DE CLÔTURE : la conversation figée en Markdown n'était
 * lue par personne, et le tiroir portait un bouton de téléchargement de plus.
 * Le parcours de la carte raconte déjà tout ce que ce document recopiait.
 */
export async function archiveCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };

  if (card.agentId && isRunning(card.agentId)) {
    return { ok: false, error: "l'agent parle encore : l'archivage attend qu'il se taise" };
  }

  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  /*
   * 1. La branche de la carte — et elle SEULE — est archivée
   *    (`archiverLaBrancheDeCarte`, règle pure `decisionDArchivage`) : une
   *    branche du projet (« main », « dev », « master », celles des réglages)
   *    ou déjà « archive/… » ne bouge pas ; une branche de carte FUSIONNÉE dans
   *    la branche de déploiement est supprimée ; une branche non fusionnée est
   *    renommée « archive/tache/… », une seule fois. Le nom obtenu est ÉCRIT
   *    sur la carte : c'est ce qui manquait, et qui faisait empiler jusqu'à
   *    neuf « archive/ » sur une carte rouverte puis réarchivée.
   */
  const branch = card.github?.branch;
  const bilan = await archiverLaBrancheDeCarte(project.path, branch, project.branchesDePublication);
  if (branch) log.info(`archivage de « ${card.title} » : ${bilan.detail}`);
  // La même branche, dans chaque dépôt annexe du projet, par la même règle.
  if (branch && project.depots?.length) {
    for (const { nom, bilan: annexe } of await archiverLesBranchesAnnexes(project, branch)) {
      log.info(`archivage de « ${card.title} » (dépôt « ${nom} ») : ${annexe.detail}`);
    }
  }
  const github =
    card.github && bilan.branche !== card.github.branch
      ? { ...card.github, branch: bilan.branche }
      : card.github;

  // 2. La carte part dans « Archivé ».
  const archived = store.saveCard({
    ...card,
    github,
    column: 'archived',
    position: store.nextPosition(card.projectId, 'archived'),
    // La date du passage : elle survit à une sortie d'archive, c'est ce qui
    // permet de lire plus tard que la carte y était allée, et quand.
    archivedAt: Date.now(),
  });
  bus.emit({ type: 'card.upsert', card: archived });

  /*
   * 3. Les questions restées ouvertes se ferment APRÈS le rangement, jamais
   *    avant : le compte de décisions qu'elles diffusent RELIT la colonne de la
   *    carte, et l'aurait relue « En cours ». Même ordre que `rangerLaCarte`.
   *    Le tour qui espérait encore une réponse repart en sachant que rien n'a
   *    été tranché.
   */
  fermerLesQuestionsSiCarteRangee(card.id, 'archived');

  // La clôture alimente l'HISTORIQUE, pas la mémoire : « telle carte livrée le
  // 3 août » se relit à la main, mais n'apprend rien à un agent au travail et
  // occupait près d'un quart du contexte envoyé à chaque lancement.
  noterLivraison(card.id);

  // WORKING : le brouillon de la carte disparaît avec elle. Ce qui méritait de durer a été promu en fin de tâche.
  purgerLeBrouillon(card.id);

  return { ok: true };
}

/**
 * ÉCRIRE LA LIVRAISON DÈS QU'ELLE EST RÉELLE. La publication l'appelle avant
 * la vitrine liée, puis l'archivage la rappelle après avoir rangé la carte.
 * `appendHistory` déduplique la ligne exacte : le journal est donc disponible
 * pendant le même cycle, sans doublon à la clôture.
 */
export function noterLivraison(cardId: string, publiee = false): boolean {
  const card = store.getCard(cardId);
  if (!card) return false;
  const project = store.getProject(card.projectId);
  if (!project) return false;
  const when = new Date().toLocaleDateString('fr-CH');
  const what = card.title.replace(/\s+/g, ' ').slice(0, 120);
  appendHistory(project.path, `${when} : « ${what} » livrée${publiee || card.deployedAt ? ' et publiée' : ''}.`);
  /*
   * LE CHANGELOG DU PROJET SE TIENT TOUT SEUL. Une carte livrée a son entrée
   * (celle que son agent a écrite, sinon son titre) ; la publication marque
   * l'entrée de sa date de mise en ligne. Une panne ici ne retient jamais la
   * livraison.
   */
  try {
    ajouterAuChangelog({
      projectId: project.id,
      texte: what,
      branche: card.github?.branch?.replace(/^archive\//, '') ?? null,
      cardId: card.id,
      source: 'carte',
    });
    if (publiee || card.deployedAt) marquerLaPublication(project.id, `publiée le ${new Date().toISOString().slice(0, 10)}`, card.id);
    // L'agent n'a pas rédigé l'entrée : elle se rédige en arrière-plan à partir du travail réel de la carte.
    redigerLEntreeDeLaCarte(card, project.name);
  } catch (err) {
    log.warn(`changelog de « ${card.title} » non tenu : ${(err as Error).message}`);
  }
  return true;
}
