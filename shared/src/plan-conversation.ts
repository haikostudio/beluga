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

/** Le plan qui attend encore une décision, avec son numéro de version. */
export interface PlanEnAttente {
  index: number;
  /** Son numéro de version (1 pour le premier plan du fil). */
  numero: number;
  contenu: string;
}

/**
 * LE PLAN QUI ATTENDAIT UNE DÉCISION quand un nouveau message arrive.
 *
 * `null` s'il n'y en a pas — fil neuf, ou plan déjà dépassé par une réponse.
 */
export function planEnAttente(messages: MessageDePlan[]): PlanEnAttente | null {
  const index = indexDuPlanCourant(messages);
  if (index < 0) return null;
  let numero = 0;
  for (let i = 0; i <= index; i += 1) {
    if (messages[i]?.plan && redige(messages[i])) numero += 1;
  }
  return { index, numero, contenu: messages[index].content!.trim() };
}

/**
 * LE DERNIER PLAN ÉCRIT dans ce fil, qu'il attende encore une décision ou non.
 *
 * `planEnAttente` (ci-dessus) exige que le plan soit le DERNIER mot du fil :
 * c'est la bonne question quand on prépare un tour. À la FIN d'un tour, elle ne
 * l'est plus — le fil s'est déjà enrichi de la demande et de la réponse en
 * cours d'écriture. Or c'est là qu'on doit savoir si une VERSION précédente
 * existe, pour exiger que celle qui vient soit son successeur entier.
 */
export function dernierPlanRedige(messages: MessageDePlan[]): PlanEnAttente | null {
  let numero = 0;
  let dernier: PlanEnAttente | null = null;
  messages.forEach((message, index) => {
    if (!message?.plan || !redige(message)) return;
    numero += 1;
    dernier = { index, numero, contenu: message.content!.trim() };
  });
  return dernier;
}

/** Au-delà, on ne recopie pas le plan précédent : son début suffit à le reconnaître. */
export const SIGNES_PLAN_RECOPIE = 8000;

/**
 * LE REFUS AUTOMATIQUE, DIT AU CHEF.
 *
 * Un nouveau message de l'utilisateur ne s'ajoute pas à côté du plan affiché :
 * il le REFUSE. L'interface le sait déjà (le plan perd ses boutons dès qu'un
 * message rédigé le suit) ; le chef, lui, ne le savait pas — d'où des réponses
 * qui commentaient le plan au lieu de le refaire.
 *
 * On lui redonne donc, à chaque tour de mode plan, le plan qui attendait ET la
 * consigne : reprends-le, adapte-le, rends la version suivante EN ENTIER. Le
 * texte recopié le rend insensible à la compression du contexte — c'est le seul
 * endroit où le plan précédent survit à coup sûr.
 */
export function consigneDeRepriseDuPlan(plan: PlanEnAttente): string {
  const contenu =
    plan.contenu.length > SIGNES_PLAN_RECOPIE
      ? `${plan.contenu.slice(0, SIGNES_PLAN_RECOPIE)}\n[…]`
      : plan.contenu;
  return [
    `PLAN EN COURS — VERSION ${plan.numero}, REFUSÉE D'OFFICE PAR LE MESSAGE CI-DESSOUS.`,
    `Le message qui suit remplace cette version : il ne s'ajoute pas à côté d'elle.`,
    `REPRENDS ce plan, ADAPTE-LE à ce qui vient d'être demandé, et rends la VERSION ${plan.numero + 1}`,
    `EN ENTIER — les quatre parties sous leurs titres, jamais un fragment ni une liste des changements.`,
    `MÊME SI LE MESSAGE CI-DESSOUS EST UNE QUESTION : sa réponse s'INTÈGRE au plan, elle ne le remplace pas.`,
    `Un choix à soumettre se pose APRÈS les quatre parties, en une ligne — jamais à leur place.`,
    '',
    `--- VERSION ${plan.numero} DU PLAN ---`,
    contenu,
    `--- fin de la version ${plan.numero} ---`,
  ].join('\n');
}
