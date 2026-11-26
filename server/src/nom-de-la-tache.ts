/**
 * LE NOM DE LA TÂCHE D'UN AGENT DES SERVICES (règle pure : `titreDeTacheLu`, shared/src/puissance-des-agents.ts).
 *
 * L'outil `nommer_la_tache` réécrit le titre de l'agent — celui que la colonne « En cours » et le fil d'Ariane lisent
 * pour un agent sans carte — et, pour un agent de volet, le titre de SA carte attitrée (Marketing de l'atelier,
 * surveillance d'un site, sauvegardes, sécurité). Jamais une carte dont le titre sert de repère (un robot de création
 * d'un réseau se retrouve par son titre), jamais l'agent personnalisé (son nom est la rubrique « nom » de sa fiche),
 * jamais un chef de Communication (son titre dit sa place dans la hiérarchie des chefs).
 */
import { LABEL_AGENT_PERSO, LABEL_BACKUP, LABEL_MARKETING, LABEL_SECURITE, LABEL_SURVEILLANCE, SERVICE_DU_DIRECTEUR, titreDeTacheLu, type Agent } from '@beluga/shared';
import { bus } from './bus.js';
import { lireEspace } from './marketing.js';
import { estUnAgentDesServices } from './puissance-des-agents.js';
import * as store from './store.js';

/** L'agent qui configure une étape de publication (retenu sur son projet) : un agent des services lui aussi. */
function estAgentDeConfiguration(agent: Agent): boolean {
  if (agent.role !== 'deploy') return false;
  const projet = store.getProject(agent.projectId);
  return !!projet && (projet.deploiement?.agentId === agent.id || projet.miseEnProduction?.agentId === agent.id);
}

/** Cet agent reçoit-il l'outil ? */
export function peutNommerSaTache(agentId: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent || agent.assistantGlobal) return false;
  if (agent.service?.id === SERVICE_DU_DIRECTEUR) return false;
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  if (carte?.labels.includes(LABEL_AGENT_PERSO)) return false;
  return estUnAgentDesServices(agent) || estAgentDeConfiguration(agent);
}

/** La carte attitrée dont le titre peut suivre celui de la tâche, s'il y en a une. */
function carteQuiSuit(agent: Agent) {
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  if (!carte || carte.agentId !== agent.id) return null;
  if (carte.labels.some((l) => l === LABEL_SURVEILLANCE || l === LABEL_BACKUP || l === LABEL_SECURITE)) return carte;
  if (carte.labels.includes(LABEL_MARKETING) && lireEspace(carte.projectId)?.cardId === carte.id) return carte;
  return null;
}

export function nommerLaTache(agentId: string, valeur: unknown): { ok: boolean; texte: string } {
  if (!peutNommerSaTache(agentId)) return { ok: false, texte: 'Cet outil ne sert qu’aux agents des services.' };
  const lu = titreDeTacheLu(valeur);
  if (!lu.ok) return { ok: false, texte: lu.raison };
  const agent = store.getAgent(agentId)!;
  if (agent.title !== lu.titre) bus.emit({ type: 'agent.upsert', agent: store.saveAgent({ ...agent, title: lu.titre }) });
  const carte = carteQuiSuit(agent);
  if (carte && carte.title !== lu.titre) bus.emit({ type: 'card.upsert', card: store.saveCard({ ...carte, title: lu.titre }) });
  return { ok: true, texte: `Ta tâche s’appelle désormais « ${lu.titre} ». Renomme-la quand ton travail change de sujet.` };
}
