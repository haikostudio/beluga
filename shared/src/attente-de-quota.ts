/**
 * LES CARTES RÉELLEMENT BLOQUÉES PAR LE MANQUE DE QUOTA — ce que le badge en
 * haut à droite d'une carte écrit « En attente de quota » (demande du
 * 23/10/2026, « Tableaux de bord » et tableau d'un projet).
 *
 * Deux attentes, et deux seulement :
 *  - une demande DÉJÀ ÉCRITE retombée en file faute de compte
 *    (`QueuedPrompt.messageId`, même critère que `attenteDeLaDemande` →
 *    sorte « quota ») ;
 *  - un tour COUPÉ PAR LA LIMITE d'un compte dont la reprise est encore
 *    ouverte : la décision « reprise-de-compte » non réglée de la liste des
 *    décisions attendues (`store.reprisesDeCompteEnAttente`).
 *
 * Une carte au repos d'un moteur à 100 % n'y est PAS : elle n'attend rien.
 * Les deux signaux sont déjà à l'écran sans charger les fils — la file par
 * agent (`queue.etat`, envoyée au premier envoi pour les files sans quota) et
 * les décisions (`attention`).
 */
export interface EntreeAttenteDeQuota {
  /** Les agents connus de l'écran : seule leur carte compte ici. */
  agents: Iterable<{ id: string; cardId?: string | null }>;
  /**
   * Les cartes connues, par leur agent retenu (`Card.agentId`) : un agent au
   * repos depuis longtemps ne part pas toujours au premier envoi, sa carte si.
   */
  cartes?: Iterable<{ id: string; agentId?: string | null }>;
  /** La file de chaque agent (`state.queues`). */
  files: Readonly<Record<string, readonly { messageId?: string }[] | undefined>>;
  /** Les décisions attendues (`state.decisions`). */
  decisions: readonly { source?: string; cardId?: string; agentId?: string; reglee?: boolean }[];
}

/** Les identifiants des cartes qui attendent un quota. */
export function cartesEnAttenteDeQuota(entree: EntreeAttenteDeQuota): Set<string> {
  const cartes = new Set<string>();
  const carteDeLAgent = new Map<string, string>();
  for (const carte of entree.cartes ?? []) if (carte.agentId) carteDeLAgent.set(carte.agentId, carte.id);
  for (const agent of entree.agents) if (agent.cardId) carteDeLAgent.set(agent.id, agent.cardId);

  for (const [agentId, file] of Object.entries(entree.files)) {
    if (!file?.some((demande) => !!demande.messageId)) continue;
    const carte = carteDeLAgent.get(agentId);
    if (carte) cartes.add(carte);
  }
  for (const decision of entree.decisions) {
    if (decision.source !== 'reprise-de-compte' || decision.reglee) continue;
    const carte = decision.cardId ?? (decision.agentId ? carteDeLAgent.get(decision.agentId) : undefined);
    if (carte) cartes.add(carte);
  }
  return cartes;
}
