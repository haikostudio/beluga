/**
 * OÙ MÈNE LE CLIC SUR LA CARTE D'UN AGENT DE VOLET.
 *
 * La carte d'un agent de volet (Studio, Marketing, Surveillance, Sauvegardes)
 * ne livre rien : elle ne sert qu'à le montrer au tableau. Un clic dessus
 * ouvrait pourtant le volet de la carte, et l'utilisateur ne savait plus à quoi
 * elle correspondait. Il doit être ramené dans le service, sur la conversation
 * de l'agent. Le client ne connaît pas le lien « agent → élément » (la création,
 * le projet d'un atelier, le site) : c'est ce module qui le lit, une fois, à
 * la demande.
 *
 * LA RÉPONSE EST `null` QUAND IL N'Y A RIEN OÙ ALLER : un agent de configuration
 * (carte Système violette, qui ouvre déjà son tiroir), une carte ordinaire, la
 * bibliothèque de styles (sa conversation ne se lit que dans sa carte) ou un
 * élément disparu (site retiré, conversation d'un site
 * remplacée par une plus récente). Le client rouvre alors la carte, comme avant :
 * un clic ne tombe jamais dans le vide.
 */
import { serviceAUneConversation, serviceDeLaCarte, type LieuDeService } from '@beluga/shared';
import { listerSites as listerSitesDeSauvegarde } from './backups.js';
import { getDb } from './db.js';
import * as store from './store.js';
import { listerSites as listerSitesSurveilles } from './surveillance.js';

export function lieuDuServiceDeLaCarte(cardId: string): LieuDeService | null {
  const carte = store.getCard(cardId);
  if (!carte?.agentId) return null;
  const agent = store.getAgent(carte.agentId);
  const service = serviceDeLaCarte(agent, carte);
  if (!agent || !service || !serviceAUneConversation(service)) return null;

  switch (service) {
    case 'marketing': {
      const ligne = getDb().prepare('SELECT project_id FROM marketing_espaces WHERE agent_id = ?').get(agent.id) as { project_id: string } | undefined;
      return ligne ? { vue: 'marketing', elementId: ligne.project_id } : null;
    }
    case 'surveillance': {
      const site = listerSitesSurveilles().find((s) => s.agentId === agent.id);
      return site ? { vue: 'surveillance', elementId: site.id } : null;
    }
    case 'backups': {
      const site = listerSitesDeSauvegarde().find((s) => s.assistantId === agent.id || s.recetteAgentId === agent.id);
      return site ? { vue: 'backups', elementId: site.id } : null;
    }
    default:
      return null;
  }
}
