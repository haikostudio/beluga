import { adresseDeLAgentDeService } from '@beluga/shared';
/**
 * OUVRIR UN AGENT SANS CARTE DEPUIS N'IMPORTE QUELLE LISTE (04/11/2026) : l'agent de configuration du déploiement ou de
 * la mise en production, une analyse, un autre agent système. L'écran principal écoute cet événement et joue son
 * ouverture habituelle (`ouvrirAgent` d'app.tsx : le tiroir de l'étape pour un agent de configuration), puis referme
 * le menu du téléphone. Évite de faire descendre le geste à travers toute la colonne de gauche.
 */
export const EVENEMENT_OUVRIR_UN_AGENT = 'beluga:ouvrir-un-agent';

export function ouvrirUnAgent(agentId: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENEMENT_OUVRIR_UN_AGENT, { detail: agentId }));
}

/**
 * L'ÉCRAN D'UN AGENT DE SERVICE SANS CARTE : son adresse de service, sauf l'agent marketing d'un client, dont l'adresse
 * le reconnaît sans désigner d'écran (`adresseDEcranMarketing2`), et un chef de Communication, qui mène à SA
 * conversation dans l'onglet « Agents » de son projet (`adresseDeLAgentDeService`, 24/11/2026). Partagé par la colonne
 * de gauche (`ouvrirAgent` d'app.tsx) et la bande du tableau de bord (en-route.tsx), pour qu'ils mènent au même endroit.
 */
type AgentDeService = { id: string; projectId: string; service: { id: string; adresse: string } };

export function adresseDEcranDeLAgentDeService(agent: AgentDeService): string {
  let adresse = adresseDeLAgentDeService(agent) ?? agent.service.adresse;
  return adresse;
}

/** Va à l'écran d'un agent de service, comme un lien interne : une entrée d'historique, puis l'adresse commande l'écran. */
export function allerALEcranDeLAgentDeService(agent: AgentDeService): void {
  window.history.pushState(null, '', `#${adresseDEcranDeLAgentDeService(agent)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
