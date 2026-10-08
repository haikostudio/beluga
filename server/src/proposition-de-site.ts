/**
 * LE PROJET D'UNE CARTE PROPOSÉE PAR L'AGENT D'UN SITE SURVEILLÉ — la règle
 * pure (`shared/src/projet-de-proposition-de-site.ts`) branchée sur la base.
 *
 * Lue deux fois : quand l'agent propose (`board_create_card`, `propose_task`),
 * pour refuser la proposition d'un site relié à rien et noter le projet sur la
 * proposition ; puis quand l'utilisateur l'accepte (`proposal.decide`), pour
 * une proposition affichée avant cette règle.
 */
import {
  type ProjetDeProposition,
  projetDeProposition,
  propositionAilleursPermise,
  refusDeProposition,
  trouverLeProjetVise,
} from '@beluga/shared';
import * as store from './store.js';
import { listerSites } from './surveillance.js';

export function projetDeLaPropositionDeLAgent(agentId: string, agentProjectId: string): ProjetDeProposition {
  return projetDeProposition({
    agentId,
    agentProjectId,
    sites: listerSites(),
    projetExiste: (id) => {
      const projet = store.getProject(id);
      return Boolean(projet && !projet.archived);
    },
  });
}

export function refusDeLaPropositionDeLAgent(verdict: ProjetDeProposition): string | null {
  return refusDeProposition(verdict, (id) => store.getProject(id)?.name ?? id);
}

/**
 * Le projet où naît la carte ACCEPTÉE. Celui noté sur la proposition fait foi
 * tant qu'il existe ; sinon (proposition affichée avant cette règle, projet mis
 * de côté depuis) la règle est rejouée. Un site redevenu orphelin refuse
 * l'acceptation en le disant, plutôt que de poser la carte chez Beluga Build.
 */
export function projetDAccueilDeLaProposition(
  proposal: { projectId?: string },
  agent: { id: string; projectId: string },
): string {
  if (proposal.projectId) {
    const note = store.getProject(proposal.projectId);
    if (note && !note.archived) return note.id;
  }
  const verdict = projetDeLaPropositionDeLAgent(agent.id, agent.projectId);
  if (verdict.genre === 'conversation' || verdict.genre === 'site') return verdict.projectId;
  if (verdict.genre === 'non-relie') {
    const noms = verdict.sites.map((site) => `« ${site.nom} »`).join(', ');
    throw new Error(`${noms} n’est relié à aucun projet : choisissez son projet dans le volet du site, puis acceptez la carte.`);
  }
  throw new Error('Cette conversation suit des sites de projets différents : proposez la carte depuis le projet concerné.');
}

/**
 * LE PROJET D'UNE CARTE PROPOSÉE, champ « projet » compris — pour
 * `board_create_card` et `propose_task`.
 *
 * Sans « projet », la règle du site (DEC-340) s'applique telle quelle. Avec lui,
 * seul l'agent d'une conversation du projet de l'APPLICATION (`isSelf`, jamais
 * un nom : « Beluga Build » est le site vitrine) peut viser un autre projet —
 * un travail qui touche plusieurs projets s'y propose en une carte par projet
 * (`shared/src/perimetre-des-agents.ts`).
 *
 * `projectId` est à NOTER sur la proposition dès que le projet d'accueil n'est
 * pas celui de l'agent : c'est lui que `proposal.decide` relit. Sans cette note,
 * une carte proposée par l'assistant général vers un autre projet naissait dans
 * le projet de sa conversation.
 */
export function accueilDeLaProposition(
  ctx: { agentId: string; projectId: string },
  projetVoulu: unknown,
): { refus: string } | { accueil: ProjetDeProposition; projectId?: string } {
  const accueilDuSite = projetDeLaPropositionDeLAgent(ctx.agentId, ctx.projectId);
  const projetDeLAgent = store.getAgent(ctx.agentId)?.projectId ?? ctx.projectId;
  const voulu = typeof projetVoulu === 'string' ? projetVoulu.trim() : '';
  let accueil = accueilDuSite;
  if (voulu) {
    const permis = propositionAilleursPermise({
      projetDeLAgentIsSelf: store.getProject(projetDeLAgent)?.isSelf === true,
      agentDUnSite: accueilDuSite.genre !== 'conversation',
    });
    if (!permis.ok) return { refus: permis.raison };
    const vise = trouverLeProjetVise(
      store.listProjects(true).map((p) => ({ id: p.id, name: p.name, archive: p.archived })),
      voulu,
    );
    if (!vise.ok) return { refus: `${vise.raison} Projets : ${store.listProjects().map((p) => p.name).join(', ')}.` };
    accueil = { genre: 'conversation', projectId: vise.projet.id };
  }
  const refus = refusDeLaPropositionDeLAgent(accueil);
  if (refus) return { refus };
  const projectId = 'projectId' in accueil && accueil.projectId !== projetDeLAgent ? accueil.projectId : undefined;
  return { accueil, ...(projectId ? { projectId } : {}) };
}
