/**
 * LA PUISSANCE DES AGENTS DES SERVICES, côté démon (règle pure : `shared/src/puissance-des-agents.ts`).
 *
 * Un seul endroit décide, à l'envoi de chaque demande (`sendPrompt`), du palier d'un agent des services : le message
 * de l'utilisateur part au palier « approfondi » (enregistré sur l'agent), un passage seul — demande silencieuse du
 * démon — au palier « standard », pour ce tour seulement. Tout est SYNCHRONE : la partie de `sendPrompt` qui précède
 * la mise en file ne doit rien attendre (deux demandes rapprochées se suivent, jamais ne se doublent) ; le catalogue
 * lu est celui déjà en mémoire, et sans lui rien ne change.
 */
import {
  estAgentDeVolet,
  MOTEUR_DES_AGENTS_DES_SERVICES,
  puissanceDuTour,
  reglagesDuNiveau,
  type Agent,
  type MoteurCatalogue,
  type ReglageDeModele,
} from '@beluga/shared';
import { cachedEngines } from './engines/index.js';
import { estAgentMarketing } from './marketing.js';
import * as store from './store.js';
import { bus } from './bus.js';

/**
 * UN AGENT DES SERVICES : un agent de volet (Marketing, surveillance, sauvegardes, sécurité, agent personnalisé),
 * ou un agent porté par un service de l'application (Charte, Communication, Marketing 2, configuration d'une
 * publication…). Le directeur du Studio n'en est pas : c'est un agent de cadrage, dont le modèle est celui choisi
 * dans la barre d'écriture.
 */
export function estUnAgentDesServices(agent: Agent): boolean {
  if (agent.role === 'cadrage') return false;
  if (agent.service) return true;
  if (estAgentMarketing(agent.id)) return true;
  return estAgentDeVolet(agent, agent.cardId ? store.getCard(agent.cardId) : null);
}

/** Le catalogue Claude en mémoire, à la forme qu'attend la traduction d'un palier. */
function catalogueClaude(): MoteurCatalogue | null {
  const claude = cachedEngines().find((e) => e.id === MOTEUR_DES_AGENTS_DES_SERVICES);
  if (!claude?.models?.length) return null;
  return {
    id: claude.id,
    label: claude.label,
    installed: claude.installed,
    models: claude.models.map((m) => ({ id: m.id, label: m.label, thinking: m.thinking.map((t) => ({ id: t.id })), defaultThinking: m.defaultThinking, appetite: m.appetite })),
    defaultModel: claude.defaultModel,
    comptesDisponibles: 1,
  };
}

/** Le réglage de naissance d'un agent des services : le palier « approfondi », retenu comme tel. */
export function reglageDeConversation(moteur: MoteurCatalogue | null | undefined): { model: string | undefined; thinking: string; niveau?: 'approfondi' } {
  if (!moteur) return { model: undefined, thinking: 'none' };
  return { ...reglagesDuNiveau(moteur, 'approfondi'), niveau: 'approfondi' };
}

/**
 * Applique la règle avant l'envoi d'une demande. Enregistre le palier « approfondi » sur l'agent pour un message de
 * l'utilisateur ; rend le réglage du tour pour un passage seul. Ne touche à rien d'autre (moteur, compte).
 */
export function appliquerLaPuissanceDuTour(agent: Agent, humain: boolean): { agent: Agent; duTour?: ReglageDeModele } {
  if (!estUnAgentDesServices(agent)) return { agent };
  const moteur = catalogueClaude();
  if (!moteur) return { agent };
  const regle = puissanceDuTour({
    run: agent.run,
    humain,
    conversation: reglagesDuNiveau(moteur, 'approfondi'),
    passages: reglagesDuNiveau(moteur, 'standard'),
  });
  if (regle.enregistrer) {
    const maj = store.saveAgent({ ...agent, run: { ...agent.run, ...regle.enregistrer } as Agent['run'] });
    bus.emit({ type: 'agent.upsert', agent: maj });
    return { agent: maj };
  }
  return { agent, ...(regle.duTour ? { duTour: regle.duTour } : {}) };
}
