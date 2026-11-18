/**
 * QUI PARLE À CET AGENT ? Le compte du dernier geste humain qui l'a fait
 * travailler : un message écrit (`agent.prompt`), un « Lancer » (`card.start`),
 * une réponse à sa question. Retenu par agent ET par carte (un agent de tâche
 * né au lancement hérite de celui qui a cliqué), en base (`meta`) pour
 * survivre au redémarrage.
 *
 * Les droits d'un agent sont ceux de cet interlocuteur
 * (`shared/src/services-de-l-agent.ts`). Inconnu : s'il n'existe aucun accès
 * tiers actif, le propriétaire est le seul interlocuteur possible ; sinon, le
 * droit le plus étroit (`null`).
 */
import { accesDeLAgent, type AccesDeLAgent, type CompteUtilisateur, type Interlocuteur, type ServiceDeLAgent } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import * as store from './store.js';

const cleAgent = (id: string) => `interlocuteur.agent.${id}`;
const cleCarte = (id: string) => `interlocuteur.carte.${id}`;

function retenir(cle: string, compteId: string): void {
  try {
    if (getMeta(cle) !== compteId) setMeta(cle, compteId);
  } catch {
    /* base indisponible : le droit le plus étroit s'appliquera */
  }
}

/** Retient l'auteur d'une commande humaine qui fait travailler un agent. Un client n'est jamais retenu. */
export function noterLInterlocuteur(cible: { agentId?: string | null; cardId?: string | null }, compte: Pick<CompteUtilisateur, 'id' | 'role'>): void {
  if (compte.role === 'client') return;
  if (cible.agentId) retenir(cleAgent(cible.agentId), compte.id);
  const cardId = cible.cardId ?? (cible.agentId ? store.getAgent(cible.agentId)?.cardId : null);
  if (cardId) retenir(cleCarte(cardId), compte.id);
}

/** L'agent né d'un autre (le directeur d'une vidéo demandée) parle au même interlocuteur que lui. */
export function heriterLInterlocuteur(deAgentId: string, vers: { agentId?: string; cardId?: string }): void {
  const compteId = compteIdDeLAgent(deAgentId);
  if (!compteId) return;
  if (vers.agentId) retenir(cleAgent(vers.agentId), compteId);
  if (vers.cardId) retenir(cleCarte(vers.cardId), compteId);
}

function compteIdDeLAgent(agentId: string): string | null {
  try {
    const direct = getMeta(cleAgent(agentId));
    if (direct) return direct;
    const cardId = store.getAgent(agentId)?.cardId;
    return cardId ? getMeta(cleCarte(cardId)) : null;
  } catch {
    return null;
  }
}

/** Le compte qui parle à cet agent, ou `null` (droit le plus étroit). */
export async function interlocuteurDeLAgent(agentId: string): Promise<(Interlocuteur & { id?: string }) | null> {
  const { compteParId, listerComptes } = await import('./comptes.js');
  const compteId = compteIdDeLAgent(agentId);
  const retenu = compteId ? compteParId(compteId) : null;
  if (retenu && retenu.actif) return retenu;
  const comptes = listerComptes();
  const tiers = comptes.some((c) => c.actif && (c.role === 'membre' || c.role === 'lecteur'));
  if (tiers) return null;
  const admin = comptes.find((c) => c.actif && c.role === 'admin');
  /* Une installation sans aucun compte (essais, démon neuf) n'a qu'un maître : son propriétaire. */
  return admin ?? (comptes.length ? null : { role: 'admin', projets: [] });
}

/** L'accès de cet agent à un service, pour un projet. */
export async function accesDeCetAgent(agentId: string, service: ServiceDeLAgent, projectId?: string | null): Promise<AccesDeLAgent> {
  const agent = store.getAgent(agentId);
  return accesDeLAgent({ interlocuteur: await interlocuteurDeLAgent(agentId), service, projectId, projetDeLAgent: agent?.projectId ?? null });
}
