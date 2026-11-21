/**
 * LE RETRAIT DES PROPOSITIONS ORPHELINES, CÔTÉ DÉMON (règle pure : `shared/src/propositions-orphelines.ts`).
 *
 * Une carte qui RENDS son travail (fin de tour de tâche rangée en « À déployer » ou « Archivé », `runtime.ts`) retire
 * les propositions de carte restées en attente dans la conversation de ses agents, quand elles visent le même projet.
 * Le retrait suit le chemin d'un refus (`proposal.decide`, `ws.ts`) : table des propositions, message mis à jour,
 * signal d'attention recalculé — la cloche et le cadre orange s'éteignent du même coup. Une ligne dans le fil le dit.
 *
 * Le BALAYAGE (`rattraperLesPropositionsOrphelines`, au démarrage) fait de même, une fois, pour les cartes déjà
 * rendues ; une carte encore en cours n'est jamais touchée.
 */
import { LIGNE_PROPOSITION_RETIREE, propositionsARetirerAuRendu, travailRendu, TaskProposal, type Message } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { projetDAccueilDeLaProposition } from './proposition-de-site.js';

function projetDAccueil(proposal: TaskProposal, agentId: string): string | null {
  const agent = store.getAgent(agentId);
  if (!agent) return null;
  try {
    return projetDAccueilDeLaProposition(proposal, agent);
  } catch {
    return null;
  }
}

/** Retire les propositions orphelines d'UNE carte qui a rendu son travail. Rend le nombre retiré. */
export function retirerLesPropositionsOrphelines(cardId: string): number {
  const carte = store.getCard(cardId);
  if (!carte || !travailRendu(carte.column)) return 0;
  const enAttente = store.propositionsEnAttenteDesCartes(cardId);
  if (!enAttente.length) return 0;
  const lues = enAttente.flatMap((ref) => {
    const message = store.getMessage(ref.messageId);
    const proposal = message?.proposals.find((p) => p.id === ref.proposalId);
    return message && proposal ? [{ ref, message, proposal }] : [];
  });
  const aRetirer = new Set(
    propositionsARetirerAuRendu(
      lues.map(({ ref, proposal }) => ({ id: proposal.id, decision: proposal.decision, projetDAccueil: projetDAccueil(proposal, ref.agentId) })),
      carte.projectId,
    ),
  );
  if (!aRetirer.size) return 0;
  const parMessage = new Map<string, Message>();
  const agentsTouches = new Set<string>();
  for (const { ref, message, proposal } of lues) {
    if (!aRetirer.has(proposal.id)) continue;
    const decided = TaskProposal.parse({
      ...(store.decideProposal(proposal.id, 'refused') ?? { ...proposal, decision: 'refused', decidedAt: Date.now() }),
      retireeAuRendu: true,
    });
    store.saveProposal(message.id, carte.projectId, decided);
    // Relu à l'écriture : seule CETTE proposition change dans le message (`appliquerDecisionAuMessage`).
    const ecrit = store.appliquerDecisionAuMessage(message.id, decided);
    if (ecrit) parMessage.set(message.id, ecrit);
    agentsTouches.add(ref.agentId);
  }
  for (const message of parMessage.values()) bus.emit({ type: 'message.upsert', message });
  for (const agentId of agentsTouches) {
    const ligne = store.saveMessage({ id: store.newId(), agentId, role: 'system', content: LIGNE_PROPOSITION_RETIREE, createdAt: store.now() } as Message);
    bus.emit({ type: 'message.upsert', message: ligne });
  }
  bus.emit({ type: 'attention', ...store.signalAttention() });
  log.info(`carte ${cardId} rendue : ${aRetirer.size} proposition(s) en suspens retirée(s)`);
  return aRetirer.size;
}

/**
 * LES MESSAGES DÉSACCORDÉS DE LA TABLE `proposals` (21/11/2026) : une décision effacée du message par une réécriture
 * concurrente y est recopiée depuis la table — décision, carte, heure —, sans jamais créer de carte (MEM-0354).
 */
export function resynchroniserLesDecisions(): number {
  const reecrits = store.resynchroniserLesDecisionsDesMessages();
  for (const message of reecrits) bus.emit({ type: 'message.upsert', message });
  if (reecrits.length) bus.emit({ type: 'attention', ...store.signalAttention() });
  return reecrits.length;
}

/** LE BALAYAGE DE RATTRAPAGE : les cartes DÉJÀ rendues qui gardent des propositions en suspens du même projet. */
export function rattraperLesPropositionsOrphelines(): number {
  const cartes = new Set(store.propositionsEnAttenteDesCartes().map((ref) => ref.cardId));
  let total = 0;
  for (const cardId of cartes) {
    try {
      total += retirerLesPropositionsOrphelines(cardId);
    } catch (err) {
      log.warn(`propositions orphelines de la carte ${cardId} : retrait impossible`, err);
    }
  }
  return total;
}
