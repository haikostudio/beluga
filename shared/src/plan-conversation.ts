/**
 * LES PLANS D'UNE CONVERSATION — lequel est encore en jeu, lesquels sont
 * d'anciennes itérations.
 *
 * Le mode plan ne rend pas un plan puis un autre à côté : il rend le MÊME plan,
 * de mieux en mieux. Chaque réponse (une relance, un refus, un ajustement)
 * reprend le plan précédent entier et l'améliore, si bien qu'un fil de mode plan
 * ressemble à une pile de versions dont une seule compte : la dernière.
 *
 * D'où la règle, sans base ni disque, donc rejouable seule :
 *
 * 1. Le plan COURANT est le DERNIER message porteur d'un plan RÉDIGÉ.
 * 2. Il ne l'est plus dès qu'un message rédigé le suit : le fil a repris son
 *    cours — plan validé, refusé, ou dépassé par une nouvelle demande.
 * 3. Tous les autres plans sont d'ANCIENNES itérations : ils se replient, se
 *    rouvrent en lecture, et ne portent plus aucun bouton — décider sur une
 *    version périmée lancerait un travail que personne n'a relu.
 *
 * Un message ENCORE VIDE (l'agent commence à écrire) ne compte pas : il ne dit
 * rien, et il ferait clignoter les boutons du plan qu'il suit.
 */

/** Le strict minimum dont cette règle a besoin d'un message. */
export interface MessageDePlan {
  /** Vrai quand le message a été écrit en mode plan. */
  plan?: boolean;
  content?: string;
}

/** Un message qui dit quelque chose : l'enveloppe vide d'un tour qui démarre ne compte pas. */
function redige(message?: MessageDePlan): boolean {
  return !!message?.content?.trim();
}

/**
 * L'index du plan ENCORE EN JEU dans ce fil, ou -1 s'il n'y en a plus.
 *
 * C'est le dernier message du fil, à condition qu'il porte un plan rédigé : dès
 * qu'un message rédigé le suit, plus aucun plan n'attend de décision.
 */
export function indexDuPlanCourant(messages: MessageDePlan[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!redige(message)) continue;
    return message.plan ? index : -1;
  }
  return -1;
}

/** Ce plan attend-il encore une décision, ou n'est-il qu'une itération passée ? */
export type EtatDuPlan = 'courant' | 'ancien';

/**
 * L'état du plan porté par le message d'index donné — `null` si ce message ne
 * porte aucun plan rédigé.
 */
export function etatDuPlan(messages: MessageDePlan[], index: number): EtatDuPlan | null {
  const message = messages[index];
  if (!message?.plan || !redige(message)) return null;
  return index === indexDuPlanCourant(messages) ? 'courant' : 'ancien';
}
