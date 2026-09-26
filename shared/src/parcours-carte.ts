/**
 * LE PARCOURS D'UNE CARTE EST UN ÉTAT ÉCRIT SUR LA CARTE, JAMAIS UNE DÉDUCTION.
 *
 * Avant, tout se devinait dans le TEXTE des messages : le plan était reconnu à
 * ses quatre titres, la compréhension relue dans un bloc JSON ou dans du
 * markdown, la demande de plan devinée par une expression régulière sur la
 * phrase de l'utilisateur. Six témoins disaient chacun à leur façon où en
 * était la carte, et l'écran allumait ou éteignait ses boutons sans jamais dire
 * pourquoi.
 *
 * Désormais la carte PORTE son parcours (`Card.parcours`, `models.ts`) : la
 * compréhension rendue par l'outil `rendre_comprehension`, les plans rendus par
 * l'outil `rendre_plan` (versionnés, entiers), la demande de plan en cours, et
 * l'incident quand un tour n'a pas tenu sa promesse. Tout ce fichier ne fait
 * que LIRE cet état, avec la colonne de la carte et ce que le fil montre.
 *
 * QUATRE CHAPITRES, TOUJOURS DANS CET ORDRE, ET UN SEUL GESTE PRINCIPAL À
 * CHAQUE INSTANT :
 *
 *  | Chapitre  | Ce qui s'y passe                                  | Geste principal      |
 *  | --------- | ------------------------------------------------- | -------------------- |
 *  | Cadrage   | on explique, l'agent lit, questionne, comprend    | « Valider et lancer »|
 *  | Plan      | un plan a été demandé par l'interrupteur « Plan » | « Valider et lancer »|
 *  |           | et s'affiche sous la compréhension du même tour   |                      |
 *  | Travail   | l'agent complet exécute sur sa branche            | « Arrêter »          |
 *  | Rapport   | le compte rendu est là, la carte se range         | « Terminer »         |
 *
 * Le geste rend TOUJOURS son bouton ET sa raison quand il est éteint : plus
 * jamais un bouton qui disparaît sans un mot.
 *
 * Règle PURE : ni base, ni disque, ni moteur. Elle se rejoue seule
 * (`server/src/test/parcours-carte.test.ts`).
 */

import { BOUTON_LANCER_LA_TACHE, FORME_DE_LA_COMPREHENSION, RAISONS_DU_BOUTON_LANCER } from './cadrage.js';
import { COLONNES_AVANT_LE_TRAVAIL, type ColumnKey } from './columns.js';
import type { ParcoursDeCarte, PlanDeCarte } from './models.js';
import { BLOC_DES_DECISIONS, BLOC_DES_TACHES, BLOC_EN_CLAIR, PARTIES_DU_PLAN, SIGNES_MINIMUM_EN_CLAIR } from './plan-complet.js';
import { carteRangee } from './question-en-texte.js';
import { travailDeLaCarteDejaLance } from './plan-conversation.js';
import {
  cadrageRouvertApresRapport,
  comprehensionDepuisLaRelance,
  planRenduDepuisLaRelance,
} from './relance-apres-rapport.js';

/* ------------------------------------------------------------------ */
/* Les chapitres                                                       */
/* ------------------------------------------------------------------ */

export const CHAPITRES_DU_PARCOURS = ['cadrage', 'plan', 'preparation', 'travail', 'rapport'] as const;
export type ChapitreDuParcours = (typeof CHAPITRES_DU_PARCOURS)[number];

/** Le libellé du champ de saisie, selon le chapitre : il dit ce qu'on y écrit. */
export const LIBELLES_DU_CHAMP: Record<ChapitreDuParcours, string> = {
  cadrage: 'Expliquez ou précisez votre besoin…',
  plan: 'Affinez le plan…',
  preparation: 'Écrire à l’agent…',
  travail: 'Écrire à l’agent…',
  rapport: 'Écrire à l’agent pour reprendre…',
};

/* ------------------------------------------------------------------ */
/* Ce que la règle lit                                                 */
/* ------------------------------------------------------------------ */

/** Le minimum dont cette règle a besoin d'un message du fil. */
export interface MessageDuParcours {
  role: string;
  content?: string;
  /**
   * QUAND CE MESSAGE A ÉTÉ ÉCRIT (`Message.createdAt`). Facultatif : un
   * appelant qui ne le transmet pas retrouve exactement le comportement
   * d'avant. C'est cette date qui sépare une réponse du CADRAGE — écrite avant
   * le clic sur « Lancer » — du premier mot du tour lancé.
   */
  at?: number;
  /** Tant que ce drapeau est levé, le tour écrit encore : rien ne se décide. */
  streaming?: boolean;
  questions?: readonly { answer?: string; cancelled?: boolean }[];
  /** Un tour tombé qui attend « Relancer / Ignorer / Arrêter ». */
  erreurDeTour?: { choix?: string } | null;
  /** Un tour coupé par une limite qui attend « Avec quel compte poursuivre ? ». */
  repriseCompte?: { choisi?: string; abandonnee?: boolean; consommeeA?: number } | null;
}

export interface ContexteParcours {
  /** La colonne de la carte. */
  colonne: ColumnKey;
  /** Le rôle de l'agent qui tient la conversation ; absent sur une carte sans agent. */
  roleAgent?: string;
  /** Un tour tourne dans ce fil. */
  tourEnCours: boolean;
  /**
   * L'ÉTAT SUR LEQUEL ON DÉCIDE EST-IL PÉRIMÉ ?
   *
   * Le canal a été coupé, ou il n'a pas encore renvoyé l'état complet : tout ce
   * qui est affiché date d'AVANT. `tourEnCours` peut alors dire « rien ne
   * tourne » d'un agent qui travaille depuis des heures — c'est exactement le
   * bouton « Générer le plan » allumé pendant la compréhension, et le plan
   * « en cours » depuis sept heures. Un état périmé n'efface pas le bouton : il
   * lui retire seulement le DROIT D'AGIR, avec sa raison, jusqu'à la
   * resynchronisation.
   */
  etatPerime?: boolean;
  /** Les messages du fil, dans l'ordre. */
  messages: readonly MessageDuParcours[];
  /** Ce que la carte porte de son parcours. */
  parcours?: Pick<
    ParcoursDeCarte,
    | 'comprehension'
    | 'plans'
    | 'planDemandeA'
    | 'incident'
    | 'planValide'
    | 'comprehensionValidee'
    | 'cadrageRouvertA'
  > | null;
  /** Le dernier message finit-il sur une question écrite en texte ordinaire ? */
  questionEnTexte?: boolean;
  /**
   * LA MARQUE DE VOL DE LA CARTE (`scheduling.tourEnVolDepuis`) : l'instant où
   * un lancement l'a prise en main. Elle est posée AU CLIC, avant la moindre
   * commande longue, et retirée quand le tour a fini de tout ranger
   * (`shared/src/carte-interrompue.ts`). C'est elle qui distingue une carte
   * PARTIE MAIS PAS ENCORE COMMENCÉE d'une carte dont le tour s'est tu.
   */
  tourEnVolDepuis?: number;
  /**
   * LES LIGNES DE LA LISTE DE TÂCHES QUI N'ONT PAS ÉTÉ MENÉES À BOUT
   * (`agent.todos.unfinished`, refait à la clôture par `progressionDesTaches`).
   * La ligne QUI TOURNAIT à la fin d'un tour réussi est cochée par
   * `cloturerLesTaches` : ce qui reste compté ici n'a donc JAMAIS été commencé.
   */
  tachesNonFaites?: number;
  /** Le dernier tour de l'agent de la carte s'est mal terminé (échec, arrêt). */
  dernierTourEnEchec?: boolean;
  /**
   * CE QUE LE BANDEAU DU PLAN LIT DÉJÀ, ET QUE LE BOUTON IGNORAIT.
   *
   * Le bandeau du plan, dans le flux, ouvre ou ferme sa décision avec
   * `decisionDePlanOuverte` (`plan-conversation.ts`) : version courante, plan
   * pas encore validé, aucun tour en cours, ET travail pas encore lancé. Le
   * BOUTON collé au champ de saisie, lui, ne lisait que la validation — deux
   * réponses possibles à la même question, sur le même écran. Une carte revenue
   * en « Planifié » après avoir déjà enregistré du code offrait donc « Valider
   * le plan » là où le flux, juste au-dessus, n'offrait plus rien.
   *
   * Ces trois champs sont exactement ce qui manquait pour poser la question une
   * seule fois. Absents, la règle retrouve son comportement d'avant.
   */
  codeDejaEnregistre?: boolean;
  /** L'agent qui tient la carte aujourd'hui (`Card.agentId`). */
  agentDeLaCarte?: string;
  /** L'agent qui a écrit le plan affiché. */
  agentDuPlan?: string;
}

/**
 * LE TOUR N'EST PAS ALLÉ AU BOUT, ET LA CARTE DOIT LE DIRE.
 *
 * Le bogue constaté : une carte restée dans « En cours », son parcours
 * ENTIÈREMENT COCHÉ — « Le travail est fait. », « Le compte rendu est rendu. » —
 * et, juste en dessous, deux lignes de sa liste de tâches marquées « non
 * faites ». Le chapitre se déduisait de la seule colonne : « En cours » sans
 * tour vivant valait « rapport », donc tout ce qui précède passait pour fait.
 * Le seul geste offert était « Terminer la tâche » : plus rien à faire d'un
 * travail à moitié rendu.
 *
 * DEUX FAITS SUFFISENT, tous deux ÉCRITS sur la carte et son agent — jamais
 * devinés dans le texte :
 *
 *  - des lignes de tâches sont restées NON FAITES, c'est-à-dire jamais
 *    commencées (`taches-fin-de-tour.ts` coche celle qui tournait) ;
 *  - le dernier tour de l'agent de la carte s'est mal terminé (échec, arrêt).
 *
 * Un tour honnêtement fini dont l'agent n'a pas coché sa dernière ligne n'est
 * donc PAS concerné : cette ligne-là est cochée à la clôture.
 *
 * ET IL FAUT QU'UN TRAVAIL AIT ÉTÉ LANCÉ (`travailDExecutionLance`). L'agent de
 * cadrage EST l'agent de la carte : un tour de compréhension tombé le laisse en
 * « failed », et la règle rougissait « Travail » et « Rapport » avec un encart
 * « Reprendre » sur une carte dont aucun travail n'avait jamais démarré
 * (constaté le 15.09.2026). Quand l'appelant donne la colonne, le chapitre
 * tranche ; sans elle, la règle garde son comportement d'avant.
 */
export function tourNonAbouti(
  ctx: Pick<ContexteParcours, 'tachesNonFaites' | 'dernierTourEnEchec' | 'tourEnCours'> &
    Partial<Pick<ContexteParcours, 'colonne' | 'roleAgent' | 'messages' | 'parcours' | 'tourEnVolDepuis'>>,
): boolean {
  if (ctx.tourEnCours) return false;
  if (ctx.colonne && !travailDExecutionLance({ ...ctx, colonne: ctx.colonne, messages: ctx.messages ?? [] })) {
    return false;
  }
  return (ctx.tachesNonFaites ?? 0) > 0 || !!ctx.dernierTourEnEchec;
}

/** Les chapitres où aucun travail d'exécution n'a encore démarré. */
export const CHAPITRES_AVANT_LE_TRAVAIL: readonly ChapitreDuParcours[] = ['cadrage', 'plan', 'preparation'];

/**
 * UN TRAVAIL D'EXÉCUTION A-T-IL DÉMARRÉ SUR CETTE CARTE ? Lu sur le chapitre :
 * cadrage, plan et préparation n'en ont pas — un tour tombé y est une panne de
 * CADRAGE, qui se lit sur l'étape Compréhension (ou Plan), jamais un travail
 * interrompu. Une tâche arrêtée puis ramenée en « Planifié » tient, elle, un
 * agent de tâche : son chapitre reste « travail », et elle se reprend.
 */
export function travailDExecutionLance(
  ctx: Pick<ContexteParcours, 'colonne' | 'tourEnCours' | 'messages'> &
    Partial<Pick<ContexteParcours, 'roleAgent' | 'parcours' | 'tourEnVolDepuis'>>,
): boolean {
  return !CHAPITRES_AVANT_LE_TRAVAIL.includes(chapitreDuParcours(ctx as ContexteParcours));
}

/**
 * UNE DÉCISION OUVERTE ÉTEINT LES GESTES QUI LA CONTREDIRAIENT. Un tour tombé
 * pose « Relancer / Ignorer / Arrêter », une limite de compte pose « Avec quel
 * compte poursuivre ? » : tant que rien n'est tranché, « Lancer », « Reprendre »,
 * « Terminer » ou « Générer le plan » lanceraient un second chemin à côté du
 * premier. Seul « Arrêter » reste : s'arrêter ne contredit jamais rien.
 */
export function decisionsEnAttente(messages: readonly MessageDuParcours[]): number {
  let compte = 0;
  for (const message of messages) {
    if (message.erreurDeTour && !message.erreurDeTour.choix) compte += 1;
    if (
      message.repriseCompte &&
      !message.repriseCompte.choisi &&
      !message.repriseCompte.abandonnee &&
      !message.repriseCompte.consommeeA
    )
      compte += 1;
  }
  return compte;
}

/** Une question d'outil encore ouverte quelque part dans le fil. */
export function questionsOuvertesDuFil(messages: readonly MessageDuParcours[]): number {
  let compte = 0;
  for (const message of messages) {
    for (const question of message.questions ?? []) {
      if (!question.answer && !question.cancelled) compte += 1;
    }
  }
  return compte;
}

/** Un message de l'utilisateur au moins ? Sans quoi il n'y a rien à cadrer. */
function discussionEngagee(messages: readonly MessageDuParcours[]): boolean {
  return messages.some((message) => message.role === 'user' && !!(message.content ?? '').trim());
}

/**
 * UNE RÉPONSE D'AGENT FINIE ET NON VIDE, ÉCRITE APRÈS UN INSTANT DONNÉ — un
 * tour encore en écriture ne compte pas.
 *
 * Le fil lu ici est celui de la CARTE ENTIÈRE, cadrage compris. Sur une carte
 * qui a été cadrée, il porte donc déjà des compréhensions et des plans AVANT le
 * clic sur « Lancer » : demander qu'aucune réponse n'y figure revenait à ne
 * jamais reconnaître une préparation, sauf sur une carte lancée sans un mot de
 * cadrage.
 *
 * On ne regarde donc que ce qui a été écrit DEPUIS le clic. Un message sans
 * date compte comme s'il venait d'être écrit : un appelant qui ne transmet pas
 * `at` garde le comportement d'avant, jamais une préparation qui ne finit pas.
 */
export function reponseRendueDepuis(messages: readonly MessageDuParcours[], depuis: number): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      !message.streaming &&
      !!(message.content ?? '').trim() &&
      (message.at === undefined || message.at >= depuis),
  );
}

/**
 * LA COMPRÉHENSION EST-ELLE RENDUE ? Dans ce que la carte a ÉCRIT, et là
 * seulement : `parcours.comprehension`, posé par l'outil `rendre_comprehension`.
 *
 * Une réponse en texte de l'agent en tenait lieu « pour ne pas murer une carte
 * cadrée avant l'outil ». Mais le bouton « Générer le plan » s'allumait alors
 * sur n'importe quelle phrase finie — un accusé de réception, une question —
 * et disait autre chose que la barre, qui lit la carte. Une carte d'avant
 * l'outil n'est pas murée pour autant : sa prochaine demande fait appeler
 * l'outil, et le bouton s'allume sur ce qui est écrit.
 */
export function comprehensionRendue(ctx: Pick<ContexteParcours, 'messages' | 'parcours'>): boolean {
  return !!ctx.parcours?.comprehension?.texte?.trim();
}

/**
 * LE PLAN NE SE DEMANDE JAMAIS SANS COMPRÉHENSION, CÔTÉ DÉMON AUSSI.
 *
 * Le bouton de l'incident envoyait « Générer le plan » sur une carte dont le
 * cadrage était mort avant la compréhension (carte de nuit fd54689b) : le démon
 * ne vérifiait rien, et un plan est né sans l'étape qui le fonde. La même
 * lecture que le bouton du parcours, pour une carte relancée comme pour les autres.
 */
/** Ce que les deux règles ci-dessous lisent du parcours — rien de plus. */
interface ParcoursLuPourLePlan {
  cadrageRouvertA?: number;
  planDemandeA?: number;
  comprehension?: { texte?: string; at: number } | null;
}

export function comprehensionPourLePlan(carte: {
  column: ColumnKey;
  parcours?: ParcoursLuPourLePlan | null;
}): boolean {
  return cadrageRouvertApresRapport({ column: carte.column, parcours: carte.parcours ?? undefined })
    ? comprehensionDepuisLaRelance(carte.parcours)
    : !!carte.parcours?.comprehension?.texte?.trim();
}

/**
 * UNE CARTE AUTOMATIQUE RESTÉE SANS COMPRÉHENSION EST RATTRAPÉE UNE FOIS, à son
 * ouverture : son cadrage de nuit est mort avant l'étape (verrou d'analyse,
 * modèle trop faible). Le plan déjà rendu, s'il existe, n'est pas touché.
 * Jamais sur une carte sortie du cadrage, ni pendant un tour, ni deux fois.
 */
export function comprehensionARattraper(etat: {
  automatique: boolean;
  column: ColumnKey;
  parcours?: ParcoursLuPourLePlan | null;
  cadrageAuRepos: boolean;
  dejaRattrapee: boolean;
}): boolean {
  if (!etat.automatique || !etat.cadrageAuRepos || etat.dejaRattrapee) return false;
  if (!COLONNES_AVANT_LE_TRAVAIL.includes(etat.column)) return false;
  if (etat.parcours?.planDemandeA) return false;
  return !comprehensionPourLePlan({ column: etat.column, parcours: etat.parcours });
}

/** Le refus du démon quand un plan est demandé avant toute compréhension. */
export const REFUS_PLAN_SANS_COMPREHENSION =
  'Le plan ne peut pas être demandé : aucune compréhension n’est encore rendue sur cette carte. Redemandez d’abord la compréhension.';

/**
 * La consigne du bouton « Redemander la compréhension » : un tour INTERNE, sans
 * bulle d'utilisateur, qui ne vise que l'outil de compréhension — jamais le plan.
 */
export const CONSIGNE_COMPREHENSION_REDEMANDEE = [
  'LA COMPRÉHENSION DE CETTE CARTE N’A JAMAIS ÉTÉ RENDUE, et l’utilisateur la redemande.',
  'Ouvre la mémoire du projet si ce n’est pas fait (outil « memoire »), relis TOUTE la conversation et la description de la carte,',
  'puis appelle « rendre_comprehension » avec ce que tu as compris du besoin.',
  'Ne rends PAS de plan dans ce tour, et n’appelle pas « rendre_plan » : le plan se demande ensuite, par son bouton.',
  'Ta réponse en texte tient en une phrase.',
].join(' ');

/**
 * UNE COMPRÉHENSION PLUS RÉCENTE QUE LE DERNIER PLAN : l'itération a repris.
 *
 * Depuis que la consigne d'affinage ne part plus toute seule, un message
 * envoyé après un plan rendu est un tour de COMPRÉHENSION ordinaire. Ce qu'il
 * écrit sur la carte (`rendre_comprehension`) est daté APRÈS le plan : c'est
 * ce seul écart de dates qui dit que le plan affiché ne répond plus à ce qui
 * vient d'être compris — et qui rallume « Générer le plan » là où le bouton
 * « Lancer la tâche » attendait.
 */
export function comprehensionApresLePlan(
  parcours?: Pick<ParcoursDeCarte, 'comprehension' | 'plans'> | null,
): boolean {
  const plans = parcours?.plans ?? [];
  const rendue = parcours?.comprehension;
  if (!plans.length || !rendue?.texte?.trim()) return false;
  const dernier = plans.reduce((plusRecent, plan) => (plan.at > plusRecent.at ? plan : plusRecent));
  /* UNE COMPRÉHENSION ÉCRITE DANS LE TOUR MÊME DU PLAN N'EST PAS UNE REPRISE :
     seul un nouveau message ouvre un nouveau tour. Sans cette garde, la
     compréhension réclamée à tort après `rendre_plan` rallumait « Générer le
     plan » par-dessus la décision (14.09.2026). */
  if (rendue.tourId && dernier.tourId && rendue.tourId === dernier.tourId) return false;
  return rendue.at > dernier.at;
}

/* ------------------------------------------------------------------ */
/* Le chapitre                                                         */
/* ------------------------------------------------------------------ */

/**
 * UNE CARTE PARTIE MAIS PAS ENCORE COMMENCÉE EST EN PRÉPARATION, PAS AU RAPPORT.
 *
 * Depuis que la carte passe en « En cours » AU CLIC — et non plus à la fin de la
 * préparation —, sa colonne vaut `running` alors qu'aucun tour ne vit encore.
 * Le chapitre ne connaissait que deux cas dans cette colonne : un tour en cours
 * était le travail, tout le reste le RAPPORT. Pendant la préparation, la ligne
 * de temps annonçait donc « Le travail est fait » et « Le compte rendu est
 * rendu » à une carte que le moteur n'avait pas encore lue.
 *
 * Le troisième cas se lit sur ce que la carte PORTE, jamais sur un signal
 * diffusé : la marque de vol est posée, aucun tour ne vit, et rien n'a encore
 * été rendu DEPUIS le clic. Il tient donc au rechargement de la page comme sur
 * un second appareil.
 *
 * C'est bien « depuis le clic », et non « dans le fil » : le fil d'une carte
 * cadrée porte déjà les réponses du cadrage, et les compter fermait la
 * préparation à la seconde du lancement — la ligne de temps annonçait alors un
 * travail et un compte rendu que personne n'avait écrits.
 */
function enPreparation(ctx: ContexteParcours): boolean {
  if (ctx.colonne !== 'running' || ctx.tourEnCours) return false;
  if (!ctx.tourEnVolDepuis) return false;
  /* Le premier mot du moteur referme la préparation, et rien ne la rouvre. */
  return !reponseRendueDepuis(ctx.messages, ctx.tourEnVolDepuis);
}

/**
 * OÙ EN EST CETTE CARTE. La colonne décide d'abord : « En cours » est le travail
 * tant qu'un tour vit, la PRÉPARATION tant que le lancement n'a pas abouti, le
 * rapport dès que le tour s'est tu ; une carte rangée est au rapport. Dans
 * « Planifié », un agent de tâche dit une carte INTERROMPUE — le travail a
 * commencé, il se reprend —, sinon c'est le plan s'il y en a un, et le cadrage
 * avant.
 */
export function chapitreDuParcours(ctx: ContexteParcours): ChapitreDuParcours {
  if (ctx.colonne === 'running') {
    if (ctx.tourEnCours) return 'travail';
    return enPreparation(ctx) ? 'preparation' : 'rapport';
  }
  /*
   * UN MESSAGE SOUS LE RAPPORT A ROUVERT LE CADRAGE : la carte, restée dans
   * « À déployer » tant que l'échange n'est qu'une discussion, joue une
   * nouvelle demande — compréhension, puis plan sur le bouton. Ses anciens
   * plans ne comptent pas, et son agent de tâche ne fait pas d'elle une carte
   * « au travail » (`shared/src/relance-apres-rapport.ts`).
   */
  if (cadrageRouvertApresRapport({ column: ctx.colonne, parcours: ctx.parcours })) {
    return (ctx.parcours?.plans?.length ?? 0) > 0 ? 'plan' : 'cadrage';
  }
  if (carteRangee(ctx.colonne)) return 'rapport';
  if (ctx.roleAgent && ctx.roleAgent !== 'cadrage') return 'travail';
  return (ctx.parcours?.plans?.length ?? 0) > 0 ? 'plan' : 'cadrage';
}

/* ------------------------------------------------------------------ */
/* Le geste principal                                                  */
/* ------------------------------------------------------------------ */

export type GesteDuParcours =
  /**
   * LE GESTE UNIQUE DU CADRAGE : il écrit la validation de la compréhension
   * sur la carte, puis lance le travail dans la foulée. Il remplace à lui seul
   * « Générer le plan » puis « Valider le plan » : le plan n'est plus un
   * passage obligé, la compréhension est le dernier point d'arrêt avant la
   * dépense.
   */
  | 'valider-et-lancer'
  | 'lancer'
  | 'arreter'
  | 'terminer'
  | 'reprendre'
  | 'aucun';

export const LIBELLES_GESTE: Record<Exclude<GesteDuParcours, 'aucun'>, string> = {
  /* VALIDER, C'EST LANCER : un seul geste, un seul clic. La compréhension
     n'attend plus deux boutons ni deux tours : celui-ci écrit la validation
     sur la carte, puis part (`BarreDAction`, `web/src/components/parcours-carte.tsx`). */
  'valider-et-lancer': 'Valider et lancer',
  lancer: BOUTON_LANCER_LA_TACHE,
  arreter: 'Arrêter',
  terminer: 'Terminer la tâche',
  reprendre: 'Reprendre',
};

/**
 * LES RAISONS QUI ÉTEIGNENT UN GESTE, réunies pour être traduites : elles
 * s'affichent telles quelles sous le bouton. Les trois premières viennent du
 * bouton de lancement d'avant (`RAISONS_DU_BOUTON_LANCER`), les autres sont
 * celles du parcours.
 */
export const RAISONS_DU_GESTE = {
  tourEnCours: RAISONS_DU_BOUTON_LANCER[0],
  rienDit: RAISONS_DU_BOUTON_LANCER[1],
  planAttendu: RAISONS_DU_BOUTON_LANCER[2],
  questionOuverte: 'Répondez d’abord à la question de l’agent.',
  decisionOuverte: 'Une décision attend votre réponse : tranchez-la d’abord.',
  /*
   * LE PLAN ATTEND UNE DEMANDE DE TRAVAIL, PAS SEULEMENT UNE QUESTION.
   *
   * Cette raison disait « Attendez que l’agent dise ce qu’il a compris. » —
   * juste tant que le tour de cadrage n’avait qu’une fin. Depuis qu’un message
   * qui n’est qu’une QUESTION reçoit une réponse en texte libre, sans
   * compréhension (`ISSUES_DE_TOUR_DE_CADRAGE`, `shared/src/cadrage.ts`), une
   * carte peut rester longtemps sans compréhension parce que rien de ce qui a
   * été dit n’était un travail à faire : promettre une attente serait faux, on
   * attendrait pour rien. Le VERROU, lui, ne bouge pas : aucun plan sans
   * compréhension.
   */
  comprehensionAttendue: 'Le lancement attend une vraie demande de travail, pas seulement une question.',
  planEnCours: 'Le plan est en cours de génération.',
  rienNeTourne: 'Rien ne tourne : il n’y a rien à arrêter.',
  etatPerime: 'État inconnu : le serveur ne répond plus. Rien ne peut partir tant que le lien n’est pas rétabli.',
} as const;

/**
 * LE PLAN EST-IL VALIDÉ POUR SA VERSION COURANTE ? « Valider » écrit
 * `parcours.planValide` sur la carte (`card.plan.validate`) ; une version
 * suivante du plan le périme. C'est la seule chose que lit le lancement, avec
 * l'absence de décision ouverte et de tour vivant.
 */
export function planValidePourLaVersionCourante(
  parcours?: Pick<ParcoursDeCarte, 'plans' | 'planValide'> | null,
): boolean {
  const plans = parcours?.plans ?? [];
  if (!plans.length || !parcours?.planValide) return false;
  const courante = Math.max(...plans.map((plan) => plan.numero));
  return parcours.planValide.version === courante;
}

/**
 * LA COMPRÉHENSION EST-ELLE VALIDÉE, POUR CELLE QUI EST AFFICHÉE ?
 *
 * C'EST LE PIVOT DU PARCOURS, à la place de `planValide` : le droit de lancer,
 * le figement des réglages et le palier d'effort s'y adossent tous les trois.
 * Il le fallait, sans quoi une carte SANS plan — le cas ordinaire depuis que
 * l'interrupteur « Plan » naît éteint — n'aurait jamais pu démarrer et ses
 * réglages ne se seraient jamais arrêtés.
 *
 * UNE COMPRÉHENSION RENDUE APRÈS COUP PÉRIME LA DÉCISION, exactement comme une
 * version suivante du plan la périmait : la date de la compréhension validée
 * est gardée avec elle, et un tour d'affinage rouvre donc la décision.
 *
 * LES CARTES DE L'ANCIENNE SÉQUENCE COMPTENT AUSSI : un plan validé pour sa
 * version courante vaut validation, sans quoi une carte cadrée avant ce
 * changement redemanderait un accord déjà donné.
 */
export function comprehensionValideePourLaVersionCourante(
  parcours?: Pick<ParcoursDeCarte, 'comprehension' | 'comprehensionValidee' | 'plans' | 'planValide'> | null,
): boolean {
  const rendue = parcours?.comprehension;
  const validee = parcours?.comprehensionValidee;
  if (rendue && validee) {
    if (validee.comprehensionAt === undefined || validee.comprehensionAt === rendue.at) return true;
    return false;
  }
  /* Une carte de l'ANCIENNE séquence : son plan validé vaut décision, sauf si
     la discussion a repris depuis (`comprehensionApresLePlan`) — auquel cas le
     texte validé ne répond plus à ce qui vient d'être compris. */
  return planValidePourLaVersionCourante(parcours) && !comprehensionApresLePlan(parcours);
}

/**
 * LA VERSION COURANTE DU PLAN, ou `undefined` si la carte n'en porte aucun.
 * C'est elle que le bouton NOMME : « Valider le plan · v3 ». Sans ce numéro, on
 * validait à l'aveugle — le bandeau du flux, lui, a toujours dit sa version, et
 * les deux pouvaient parler de deux textes différents sans qu'on le voie.
 */
export function versionCouranteDuPlan(parcours?: Pick<ParcoursDeCarte, 'plans'> | null): number | undefined {
  const plans = parcours?.plans ?? [];
  if (!plans.length) return undefined;
  return Math.max(...plans.map((plan) => plan.numero));
}

export interface EtatDuGeste {
  geste: GesteDuParcours;
  /** Le geste est-il possible en l'état ? */
  possible: boolean;
  /** Pourquoi il ne l'est pas — dit à l'écran, jamais tu. */
  raison?: string;
  /** Le chapitre qui a décidé du geste. */
  chapitre: ChapitreDuParcours;
  /**
   * LA VERSION DU PLAN SUR LAQUELLE PORTE LE GESTE. Posée sur « Valider le
   * plan » et sur « Lancer » depuis un plan : l'écran l'affiche à côté du
   * libellé, dans les cinq langues, sans qu'aucune phrase soit à traduire.
   */
  versionDuPlan?: number;
}

/**
 * LE GESTE PRINCIPAL, ET LE DROIT DE L'EXÉCUTER.
 *
 * Le calcul du geste, lui, n'a pas changé : c'est `gesteCalcule` juste en
 * dessous. Ce qui s'ajoute ici est le seul refus qui ne vient pas du parcours
 * mais du LIEN : sur un état périmé, on ne décide plus. Autrement dit, on ne
 * remplace pas une déduction fausse par une autre — on refuse de conclure.
 */
export function gesteDuParcours(ctx: ContexteParcours): EtatDuGeste {
  const etat = gesteCalcule(ctx);
  if (!ctx.etatPerime || !etat.possible) return etat;
  return { ...etat, possible: false, raison: RAISONS_DU_GESTE.etatPerime };
}

function gesteCalcule(ctx: ContexteParcours): EtatDuGeste {
  const chapitre = chapitreDuParcours(ctx);
  /* Une question en texte ordinaire compte comme une question d'outil : elle attend une réponse. */
  const questions = questionsOuvertesDuFil(ctx.messages) + (ctx.questionEnTexte ? 1 : 0);
  const decisions = decisionsEnAttente(ctx.messages);
  const eteint = (geste: GesteDuParcours, raison: string): EtatDuGeste => ({ geste, possible: false, raison, chapitre });

  /*
   * CADRAGE ET PLAN NE FONT PLUS QU'UN SEUL CHEMIN DE DÉCISION.
   *
   * Il y avait deux étapes validables — « Générer le plan », puis « Valider le
   * plan » —, donc deux attentes et deux clics là où cinq cartes sur six
   * n'itéraient jamais sur leur plan. Le plan est devenu FACULTATIF
   * (interrupteur de la barre d'écriture) : le seul point d'arrêt avant la
   * dépense est désormais la COMPRÉHENSION, qu'un plan l'accompagne ou non.
   *
   * Le chapitre, lui, reste distinct : il donne le libellé du champ de saisie
   * et la lecture du flux d'une carte qui porte des plans.
   */
  if (chapitre === 'cadrage' || chapitre === 'plan') {
    /*
     * UNE CARTE SANS AGENT DE CADRAGE — proposée par le chef d'orchestre,
     * écrite à la main — a déjà sa description : elle se lance telle quelle,
     * comme avant.
     */
    if (!ctx.roleAgent) {
      if (ctx.tourEnCours) return eteint('lancer', RAISONS_DU_GESTE.tourEnCours);
      if (decisions > 0) return eteint('lancer', RAISONS_DU_GESTE.decisionOuverte);
      return { geste: 'lancer', possible: true, chapitre };
    }
    /* Une relance se cadre sur ce qui a été compris DEPUIS le rapport, pas
       sur la compréhension d'origine, qui a déjà servi au travail livré. */
    const relance = cadrageRouvertApresRapport({ column: ctx.colonne, parcours: ctx.parcours });
    const comprise = relance ? comprehensionDepuisLaRelance(ctx.parcours) : comprehensionRendue(ctx);
    /*
     * LE GESTE NOMME LA VERSION DU PLAN QUAND IL Y EN A UNE À L'ÉCRAN. Sur une
     * relance, seul le plan rendu DEPUIS la réouverture compte : nommer une
     * version déjà exécutée ferait croire qu'on relance celle-là.
     */
    const version = relance ? (planRenduDepuisLaRelance(ctx.parcours) ? versionCouranteDuPlan(ctx.parcours) : undefined) : versionCouranteDuPlan(ctx.parcours);
    const avecVersion = (etat: EtatDuGeste): EtatDuGeste =>
      version ? { ...etat, versionDuPlan: version } : etat;

    /*
     * UNE CARTE DONT LE TRAVAIL A DÉJÀ COMMENCÉ NE SE REVALIDE PAS. La
     * décision porte sur une dépense à venir : sur une carte qui a déjà
     * enregistré du code, ou qui est passée dans les mains d'un autre agent,
     * revalider relancerait la carte entière. Le geste redevient un simple
     * « Lancer » (`travailDeLaCarteDejaLance`, `plan-conversation.ts`).
     */
    const planAffiche = version ? ctx.parcours?.plans?.find((plan) => plan.numero === version) : undefined;
    if (
      /* UNE RELANCE APRÈS RAPPORT EST UNE NOUVELLE DEMANDE : le travail déjà
         livré ne lui interdit pas sa décision — c'en est même tout l'objet. */
      !relance &&
      travailDeLaCarteDejaLance({
        colonne: ctx.colonne,
        ...(ctx.parcours?.cadrageRouvertA ? { cadrageRouvertA: ctx.parcours.cadrageRouvertA } : {}),
        ...(planAffiche ? { planRenduA: planAffiche.at } : {}),
        agentDeLaCarte: ctx.agentDeLaCarte,
        agentDuPlan: ctx.agentDuPlan,
        codeDejaEnregistre: ctx.codeDejaEnregistre,
      })
    ) {
      if (ctx.tourEnCours) return avecVersion(eteint('lancer', RAISONS_DU_GESTE.tourEnCours));
      if (decisions > 0) return avecVersion(eteint('lancer', RAISONS_DU_GESTE.decisionOuverte));
      return avecVersion({ geste: 'lancer', possible: true, chapitre });
    }

    if (!discussionEngagee(ctx.messages)) return avecVersion(eteint('valider-et-lancer', RAISONS_DU_GESTE.rienDit));
    if (ctx.parcours?.planDemandeA) return avecVersion(eteint('valider-et-lancer', RAISONS_DU_GESTE.planEnCours));
    if (ctx.tourEnCours) return avecVersion(eteint('valider-et-lancer', RAISONS_DU_GESTE.tourEnCours));
    if (decisions > 0) return avecVersion(eteint('valider-et-lancer', RAISONS_DU_GESTE.decisionOuverte));
    if (questions > 0) return avecVersion(eteint('valider-et-lancer', RAISONS_DU_GESTE.questionOuverte));
    /*
     * LA DÉCISION EST DÉJÀ PRISE : le bouton ne la redemande pas. Une carte
     * validée mais pas encore partie (lancement refusé pour quota, départ
     * programmé) garde donc « Lancer la tâche », sans revalider. Ce test vient
     * AVANT l'exigence de compréhension : une carte de l'ANCIENNE séquence,
     * validée sur son plan, n'a parfois rien d'écrit sous ce nom-là, et elle
     * ne doit pas se retrouver bloquée.
     */
    if (comprehensionValideePourLaVersionCourante(ctx.parcours)) {
      return avecVersion({ geste: 'lancer', possible: true, chapitre });
    }
    if (!comprise) return avecVersion(eteint('valider-et-lancer', RAISONS_DU_GESTE.comprehensionAttendue));
    return avecVersion({ geste: 'valider-et-lancer', possible: true, chapitre });
  }

  if (chapitre === 'preparation') {
    /*
     * LE LANCEMENT EST PARTI, LE MOTEUR N'A PAS ENCORE PARLÉ. « Terminer la
     * tâche » n'aurait aucun sens ici — il n'y a rien à terminer —, et c'est
     * pourtant ce que le chapitre « rapport » proposait. Le seul geste qui
     * existe est d'ARRÊTER : il ramène la carte en « Planifié », exactement
     * comme sur un tour au travail.
     */
    return { geste: 'arreter', possible: true, chapitre };
  }

  if (chapitre === 'travail') {
    /* Dans « Planifié » avec un agent de tâche : la carte a été interrompue,
       elle se REPREND — jamais un second départ de zéro. */
    if (COLONNES_AVANT_LE_TRAVAIL.includes(ctx.colonne)) {
      if (ctx.tourEnCours) return eteint('reprendre', RAISONS_DU_GESTE.tourEnCours);
      /* « Relancer / Ignorer / Arrêter » ou le choix d'un compte attendent :
         reprendre d'ici lancerait un second chemin à côté du premier. */
      if (decisions > 0) return eteint('reprendre', RAISONS_DU_GESTE.decisionOuverte);
      return { geste: 'reprendre', possible: true, chapitre };
    }
    if (!ctx.tourEnCours) return eteint('arreter', RAISONS_DU_GESTE.rienNeTourne);
    return { geste: 'arreter', possible: true, chapitre };
  }

  /* Rapport : dans « En cours », la carte se termine d'ici ; rangée, ses
     gestes (reprendre, étape suivante) vivent au pied du tiroir. */
  if (ctx.colonne === 'running') {
    /*
     * LE TOUR NE S'EST PAS RENDU JUSQU'AU BOUT : LE GESTE EST DE LE REPRENDRE.
     * « Terminer la tâche » restait la seule issue d'une carte dont des lignes
     * n'avaient jamais été faites — c'était proposer de refermer un travail à
     * moitié rendu. Il reste offert par `gestesDuParcours`, en second, pour qui
     * juge que ce qui est fait suffit.
     */
    const nonAbouti = tourNonAbouti(ctx);
    if (nonAbouti) {
      if (decisions > 0) return eteint('reprendre', RAISONS_DU_GESTE.decisionOuverte);
      if (questions > 0) return eteint('reprendre', RAISONS_DU_GESTE.questionOuverte);
      return { geste: 'reprendre', possible: true, chapitre };
    }
    if (decisions > 0) return eteint('terminer', RAISONS_DU_GESTE.decisionOuverte);
    if (questions > 0) return eteint('terminer', RAISONS_DU_GESTE.questionOuverte);
    return { geste: 'terminer', possible: true, chapitre };
  }
  return { geste: 'aucun', possible: false, chapitre };
}

/**
 * LES GESTES DE LA RANGÉE, DANS L'ORDRE — un ou deux, jamais plus.
 *
 * Le geste principal reste celui de `gesteDuParcours` : c'est lui qui donne
 * son nom à la rangée et qui prend la place de gauche. Un SECOND geste ne
 * s'ajoute que lorsque le principal est « Reprendre », et les deux issues se
 * valent alors — « Reprendre » là où le tour s'était arrêté, ou « Terminer la
 * tâche » parce que ce qui est fait suffit. Deux situations le posent : une
 * tâche ARRÊTÉE, revenue en « Planifié » alors qu'un agent de tâche avait déjà
 * travaillé, et un TOUR NON ABOUTI resté dans « En cours » (`tourNonAbouti`).
 * Les deux gestes se lisent côte à côte, au-dessus du champ, et non plus au
 * pied du tiroir.
 *
 * Ailleurs, la rangée ne porte qu'un geste : « Arrêter » pendant le travail,
 * « Terminer la tâche » quand le rapport est rendu.
 */
export function gestesDuParcours(ctx: ContexteParcours): EtatDuGeste[] {
  const principal = gesteDuParcours(ctx);
  if (principal.geste !== 'reprendre') return principal.geste === 'aucun' ? [] : [principal];
  const questions = questionsOuvertesDuFil(ctx.messages) + (ctx.questionEnTexte ? 1 : 0);
  const decisions = decisionsEnAttente(ctx.messages);
  const terminer: EtatDuGeste = ctx.etatPerime
    ? { geste: 'terminer', possible: false, raison: RAISONS_DU_GESTE.etatPerime, chapitre: principal.chapitre }
    : ctx.tourEnCours
    ? { geste: 'terminer', possible: false, raison: RAISONS_DU_GESTE.tourEnCours, chapitre: principal.chapitre }
    : decisions > 0
      ? { geste: 'terminer', possible: false, raison: RAISONS_DU_GESTE.decisionOuverte, chapitre: principal.chapitre }
      : questions > 0
        ? { geste: 'terminer', possible: false, raison: RAISONS_DU_GESTE.questionOuverte, chapitre: principal.chapitre }
        : { geste: 'terminer', possible: true, chapitre: principal.chapitre };
  return [principal, terminer];
}

/* ------------------------------------------------------------------ */
/* Le plan rendu par l'outil                                           */
/* ------------------------------------------------------------------ */

/** Ce que l'outil `rendre_plan` reçoit, une fois relu. */
export interface PlanRendu {
  titre: string;
  /**
   * L'OUVERTURE « EN CLAIR » — le premier bloc du plan, adressé à
   * l'utilisateur : ce qui sera fait, comment ça fonctionnera une fois en
   * place, à quoi ça servira. Exigée à la remise (`lirePlanRendu`).
   */
  enClair: string;
  /**
   * LA LISTE DES TÂCHES — le premier bloc du plan, à la place de l'ancienne
   * phrase de résumé en italique : chaque chose à réaliser, avec sa
   * description détaillée.
   */
  taches: { titre: string; description: string }[];
  /**
   * LES DÉCISIONS DES ITÉRATIONS — une ligne par point décidé, changé ou
   * abandonné, et quand. Chaque version est GLOBALE : ce bloc garde la trace
   * de ce qui a bougé, et un point ne sort du plan qu'en y étant noté abandonné.
   */
  decisions: string[];
  /**
   * Le plan en une phrase. Il ne s'écrit PLUS dans le corps du plan ; il sert
   * encore à la DESCRIPTION de la carte et s'enregistre sur chaque version.
   */
  resume: string;
  /** Ce qui va être fait, en deux ou trois phrases simples : affiché sous le point « Plan » du fil. */
  synthese: string;
  faisabilite: string;
  chemin: { titre: string; detail: string }[];
  consequences: string;
  ameliorations: string[];
  verifications: string[];
  /**
   * LES NOTES TECHNIQUES : fichiers, fonctions, commandes, pièges repérés.
   * Tout le reste du plan est LU PAR L'UTILISATEUR et s'écrit simplement ; ces
   * notes-là ne s'affichent pas (`rendrePlan` ne les écrit pas) et partent à
   * l'agent d'exécution avec le plan (`contexteDeDepart`) — le détail technique
   * change de destinataire, il ne se perd pas.
   */
  notesTechniques?: string;
}

/**
 * LA PART TECHNIQUE RENDUE AVEC LA COMPRÉHENSION — le second registre, jamais
 * affiché d'emblée. Elle remplace ce que le plan portait seul : la découpe du
 * travail, les faits du projet à respecter et ce qui risque de casser.
 */
export interface PartieTechniqueRendue {
  taches: { titre: string; description: string }[];
  faits: string[];
  risques: string;
}

/** Ce que l'outil `rendre_comprehension` reçoit, une fois relu. */
export interface ComprehensionRendue {
  texte: string;
  /** Le second registre. Absent quand le tour ne fait que RÉPONDRE à une question. */
  partieTechnique?: PartieTechniqueRendue;
  /**
   * CE QUE L'AGENT ASSUME, faute d'avoir eu la réponse. Ce champ portait
   * autrefois « ce qui reste flou » : une rubrique où déposer ses doutes, donc
   * une invitation à ne PAS poser la question. Un point qui change le travail
   * se pose avec `ask_user` ; un point resté sans réponse se TRANCHE et
   * s'écrit « Je suppose que… ».
   */
  hypotheses: string[];
  sujets: string[];
  /** Sur un projet réuni : les projets membres que la carte touche (noms ou identifiants). */
  projetsTouches?: string[];
  /** Ce qui a été demandé, en deux ou trois phrases simples : affiché sous le point « Demande » du fil. */
  resumeDemande: string;
  /** Ce que l'agent a compris, en deux ou trois phrases simples : affiché sous le point « Compréhension ». */
  resumeComprehension: string;
}

/**
 * LES TOURNURES D'UNE QUESTION RESTÉE EN SUSPENS. Une hypothèse AFFIRME ; dès
 * qu'une ligne interroge, elle n'est pas une hypothèse — c'est une question
 * que l'agent n'a pas posée.
 */
const DEBUTS_INTERROGATIFS =
  /^(quel|quelle|quels|quelles|qui|que|quoi|quand|ou|comment|pourquoi|combien|lequel|laquelle|faut-il|doit-on|dois-je|est-ce|y a-t-il|souhait|voul|prefer|confirm|faut il|doit on)/;

/** Minuscules et accents retirés : pour comparer sans se tromper. */
function sansAccent(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .trim();
}

/**
 * CETTE LIGNE EST-ELLE UNE QUESTION DÉGUISÉE EN HYPOTHÈSE ? Deux preuves
 * suffisent : elle se termine par un point d'interrogation, ou elle commence
 * par un mot interrogatif. Une phrase qui commence par « Je suppose » est
 * TOUJOURS une hypothèse, même si elle cite une question ensuite.
 */
export function estUneQuestionEnSuspens(ligne: string): boolean {
  const plat = sansAccent(ligne);
  if (!plat) return false;
  if (/^je suppose|^on suppose|^hypothese\b|^je retiens|^je tranche/.test(plat)) return false;
  if (plat.endsWith('?')) return true;
  return DEBUTS_INTERROGATIFS.test(plat);
}

/**
 * LA FORME D'UN RÉSUMÉ DU FIL — sous « Demande », « Compréhension » et « Plan ».
 * Il se lit SANS ouvrir le point : il remplace la phrase fixe.
 *
 * IL S'AÉRE : une LIGNE VIDE entre chaque idée, jamais un pavé de trois phrases
 * collées. Le fil le rend tel quel (`whitespace-pre-line`), les sauts de ligne
 * sont donc VISIBLES — et `texteDe` ne rogne que les extrémités.
 */
export const FORME_DES_RESUMES_DU_FIL =
  'deux ou trois idées, chacune en une ou deux phrases simples et concises, SÉPARÉES PAR UNE LIGNE VIDE (un saut de ligne double) et jamais collées en un seul pavé, pour quelqu’un qui ne programme pas, sans titre, sans liste à puces, sans nom de fichier ni de technologie';

export type LectureDOutil<T> = { ok: true; valeur: T } | { ok: false; raison: string };

const texteDe = (valeur: unknown): string => (typeof valeur === 'string' ? valeur.trim() : '');
const listeDe = (valeur: unknown): string[] =>
  Array.isArray(valeur) ? valeur.map((v) => texteDe(v)).filter((v) => v.length > 0) : [];

/**
 * LE PLAFOND DES HYPOTHÈSES — large, et DIT quand il est dépassé.
 *
 * L'outil coupait autrefois la liste à six lignes, sans rien dire : une
 * compréhension qui reprend sept demandes voyait ses hypothèses suivantes
 * disparaître, et l'agent les regroupait à l'aveugle pour ne rien perdre. Une
 * liste trop longue est désormais REFUSÉE avec ce qu'il faut faire — jamais
 * tronquée en silence.
 */
export const HYPOTHESES_MAX = 20;

/**
 * RELIT LES ARGUMENTS DE `rendre_comprehension`. Un refus DIT ce qui manque :
 * un refus muet ferait tourner le modèle en rond.
 */
export function lireComprehensionRendue(
  args: Record<string, unknown> | undefined,
  contexte: { questionsPosees?: number } = {},
): LectureDOutil<ComprehensionRendue> {
  const texte = texteDe(args?.texte);
  if (!texte) {
    return { ok: false, raison: `Le champ « texte » est vide : écris ${FORME_DE_LA_COMPREHENSION}.` };
  }
  /*
   * LES RÉSUMÉS DU FIL SONT EXIGÉS : sans eux, les points « Demande » et
   * « Compréhension » retombent sur leurs phrases fixes, et l'utilisateur doit
   * rouvrir chaque point pour savoir ce qu'il contient.
   */
  const resumeDemande = texteDe(args?.resumeDemande);
  const resumeComprehension = texteDe(args?.resumeComprehension);
  const resumesManquants = [
    ...(resumeDemande ? [] : ['« resumeDemande » (ce qui a été demandé)']),
    ...(resumeComprehension ? [] : ['« resumeComprehension » (ce que tu as compris)']),
  ];
  if (resumesManquants.length) {
    return {
      ok: false,
      raison: `Il manque ${resumesManquants.join(' et ')} : ${FORME_DES_RESUMES_DU_FIL}. Rien n’a été enregistré ; rends la compréhension de nouveau avec ces champs.`,
    };
  }
  const hypotheses = listeDe(args?.hypotheses ?? args?.questions_ouvertes ?? args?.questionsOuvertes);
  if (hypotheses.length > HYPOTHESES_MAX) {
    return {
      ok: false,
      raison:
        `${hypotheses.length} hypothèses, pour ${HYPOTHESES_MAX} au plus : regroupe celles qui portent sur le même point ` +
        '(une ligne « Je suppose que… » peut en couvrir plusieurs) et rends la compréhension de nouveau. Rien n’a été enregistré.',
    };
  }
  /*
   * UNE CONSIGNE SEULE NE TIENT PAS : L'OUTIL REFUSE LE FLOU EN SUSPENS.
   * L'agent qui dépose une question dans ses hypothèses sans l'avoir posée est
   * renvoyé à `ask_user`. Une question DÉJÀ posée dans ce tour lève le refus :
   * l'utilisateur a eu la main, l'agent peut écrire ce qu'il en retient.
   */
  if (!contexte.questionsPosees) {
    const enSuspens = hypotheses.find((ligne) => estUneQuestionEnSuspens(ligne));
    if (enSuspens) {
      return {
        ok: false,
        raison:
          `« ${enSuspens} » est une QUESTION, pas une hypothèse. Pose-la avec l'outil « ask_user » — il attend la réponse et te la rend dans ce tour — ` +
          'ou tranche-la toi-même et réécris-la en affirmation : « Je suppose que… ». Le champ « hypotheses » n’accueille que ce que tu ASSUMES.',
      };
    }
  }
  /*
   * LE SECOND REGISTRE EST EXIGÉ, ET SON FOND AVEC.
   *
   * Un tour de cadrage qui ne fait que RÉPONDRE à une question n'appelle pas
   * cet outil (`shared/src/tour-de-cadrage.ts`, mot « réponse ») : tout appel
   * porte donc sur un travail à cadrer, et doit servir à celui qui exécutera.
   * Depuis que le plan est facultatif, c'est le SEUL garde-fou avant la
   * dépense : quatre titres vides le rendraient purement décoratif, comme un
   * plan qui sonne creux.
   */
  const partieTechnique = lirePartieTechnique(args?.partieTechnique);
  if (!partieTechnique.ok) return { ok: false, raison: partieTechnique.raison };
  /* Les projets touchés n'ont de sens que sur un projet réuni : l'appelant
     vérifie qu'ils nomment bien des membres (`projetsTouchesParLaCarte`). */
  const projetsTouches = listeDe(args?.projetsTouches);
  return {
    ok: true,
    valeur: {
      texte,
      partieTechnique: partieTechnique.valeur,
      hypotheses,
      sujets: listeDe(args?.sujets).slice(0, 8),
      resumeDemande,
      resumeComprehension,
      ...(projetsTouches.length ? { projetsTouches } : {}),
    },
  };
}

/**
 * RELIT LA PART TECHNIQUE D'UNE COMPRÉHENSION. Un refus DIT ce qui manque,
 * d'un coup, pour que la relance rende tout à la fois.
 */
function lirePartieTechnique(brut: unknown): LectureDOutil<PartieTechniqueRendue> {
  const source = (brut ?? {}) as Record<string, unknown>;
  const taches = Array.isArray(source.taches)
    ? (source.taches as unknown[])
        .map((tache) =>
          typeof tache === 'string'
            ? { titre: tache.trim(), description: '' }
            : { titre: texteDe((tache as any)?.titre), description: texteDe((tache as any)?.description) },
        )
        .filter((tache) => tache.titre.length > 0)
    : [];
  const faits = listeDe(source.faits);
  const risques = texteDe(source.risques);
  const manques: string[] = [];
  if (!taches.length) manques.push('« taches » (la découpe du travail, chacune avec « titre » et « description »)');
  if (!risques) manques.push('« risques » (ce qui peut casser)');
  if (manques.length) {
    return {
      ok: false,
      raison:
        `Il manque la part technique de la compréhension : ${manques.join(', ')}. ` +
        'Elle ne s’affiche pas d’emblée — elle est REPLIÉE sous le texte clair et sert à l’agent qui exécutera : ' +
        'écris-y la découpe du travail, les faits du projet à respecter (« faits », recopiés de la base de connaissances) et ce qui risque de casser. ' +
        'Rien n’a été enregistré ; rends la compréhension de nouveau avec « partieTechnique ».',
    };
  }
  return { ok: true, valeur: { taches, faits, risques } };
}

/**
 * RELIT LES ARGUMENTS DE `rendre_plan`. Le plan est ENTIER ou il n'est pas :
 * chaque partie manquante est nommée, d'un coup, pour que la relance rende
 * tout à la fois.
 */
export function lirePlanRendu(args: Record<string, unknown> | undefined): LectureDOutil<PlanRendu> {
  const titre = texteDe(args?.titre);
  const resume = texteDe(args?.resume);
  const synthese = texteDe(args?.synthese);
  const taches = Array.isArray(args?.taches)
    ? (args!.taches as unknown[])
        .map((tache) =>
          typeof tache === 'string'
            ? { titre: tache.trim(), description: '' }
            : { titre: texteDe((tache as any)?.titre), description: texteDe((tache as any)?.description) },
        )
        .filter((tache) => tache.titre.length > 0)
    : [];
  const faisabilite = texteDe(args?.faisabilite);
  const consequences = texteDe(args?.consequences);
  const chemin = Array.isArray(args?.chemin)
    ? (args!.chemin as unknown[])
        .map((etape) =>
          typeof etape === 'string'
            ? { titre: etape.trim(), detail: '' }
            : { titre: texteDe((etape as any)?.titre), detail: texteDe((etape as any)?.detail) },
        )
        .filter((etape) => etape.titre.length > 0)
    : [];
  const ameliorations = listeDe(args?.ameliorations);
  const verifications = listeDe(args?.verifications);
  /* LES DÉCISIONS SONT EXIGÉES, comme les tâches : une consigne seule ne tient
     pas, et un plan sans elles perdrait la trace de ce qui a été abandonné. */
  const decisions = listeDe(args?.decisions);
  const enClair = texteDe(args?.enClair);
  const manques: string[] = [];
  if (!titre) manques.push('« titre »');
  if (!ouvertureEnClairSuffisante(enClair))
    manques.push(
      `« enClair » (l'ouverture du plan, adressée à l'utilisateur qui ne programme pas : deux à quatre courts paragraphes, ${SIGNES_MINIMUM_EN_CLAIR} signes et deux phrases au moins, qui disent ce qui sera fait, comment ça fonctionnera une fois en place et à quoi ça lui servira)`,
    );
  if (!synthese) manques.push(`« synthese » (${FORME_DES_RESUMES_DU_FIL} — ici, ce qui va être fait)`);
  if (taches.length < 2)
    manques.push('« taches » (deux entrées au moins, chacune avec « titre » et « description » détaillée)');
  if (decisions.length < 1)
    manques.push('« decisions » (une ligne au moins : ce qui a été décidé, changé ou abandonné, et à quel moment des échanges)');
  if (!faisabilite) manques.push('« faisabilite »');
  if (chemin.length < 2) manques.push('« chemin » (deux étapes au moins, chacune avec « titre » et « detail »)');
  if (!consequences) manques.push('« consequences »');
  if (ameliorations.length < 1) manques.push('« ameliorations » (une ligne au moins)');
  if (manques.length) {
    return { ok: false, raison: `Plan incomplet, rien n'a été enregistré. Il manque : ${manques.join(', ')}. Rappelle « rendre_plan » avec TOUTES les parties.` };
  }
  return {
    ok: true,
    valeur: {
      titre,
      enClair,
      taches,
      decisions,
      resume,
      synthese,
      faisabilite,
      chemin,
      consequences,
      ameliorations,
      verifications,
      notesTechniques: texteDe(args?.notesTechniques),
    },
  };
}

/**
 * L'OUVERTURE « EN CLAIR » A-T-ELLE DU FOND ? Une ligne ne suffit pas : il faut
 * de quoi se représenter le résultat — assez de signes, et deux phrases au
 * moins.
 */
export function ouvertureEnClairSuffisante(texte: string): boolean {
  const nu = (texte ?? '').trim();
  if (nu.length < SIGNES_MINIMUM_EN_CLAIR) return false;
  const phrases = nu.split(/[.!?…](?:\s|$)/).filter((phrase) => phrase.trim().length >= 10);
  return phrases.length >= 2;
}

/**
 * LE SEUL MOTEUR DE RENDU DU PLAN. Le démon écrit le markdown lui-même, sur
 * les QUATRE titres que l'application reconnaît depuis toujours
 * (`PARTIES_DU_PLAN`) : ce que l'écran affiche, ce que la carte reçoit en
 * description et ce que l'agent d'exécution lit sont le même texte.
 *
 * LE PLAN S'OUVRE SUR SA LISTE DE TÂCHES, plus sur une phrase de résumé en
 * italique. Le `resume` n'est pas perdu pour autant : il reste enregistré sur
 * la version et compose la DESCRIPTION de la carte
 * (`descriptionDepuisLePlanRendu`) — il ne s'écrit simplement plus dans le
 * corps du plan.
 */
export function rendrePlan(plan: PlanRendu): string {
  const [faisabilite, chemin, consequences, ameliorations] = PARTIES_DU_PLAN.map((partie) => partie.nom);
  /* LE PREMIER BLOC : la liste des tâches. Le titre de chaque tâche en gras
     sur sa ligne, sa description détaillée dessous — jamais une puce, qui la
     ferait passer pour une idée cliquable comme celles des améliorations. */
  const taches = (plan.taches ?? [])
    .map((tache) => `**${tache.titre}**${tache.description ? `\n${tache.description}` : ''}`)
    .join('\n\n');
  /* LE DEUXIÈME BLOC : les décisions des itérations, en puces. Elles ne sont
     pas cliquables — seules le sont celles des « Améliorations apportées ». */
  const decisions = (plan.decisions ?? []).length
    ? ['', `## ${BLOC_DES_DECISIONS.nom}`, plan.decisions.map((d) => `- ${d}`).join('\n')]
    : [];
  const etapes = plan.chemin
    .map((etape, index) => `${index + 1}. **${etape.titre}**${etape.detail ? ` — ${etape.detail}` : ''}`)
    .join('\n');
  const verifications = plan.verifications.length
    ? `\n\nVérifications prévues :\n${plan.verifications.map((v) => `- ${v}`).join('\n')}`
    : '';
  /* L'OUVERTURE « EN CLAIR » passe avant tout : on sait d'abord ce que le plan
     va représenter, la liste des tâches vient ensuite. */
  const enClair = plan.enClair?.trim() ? [`## ${BLOC_EN_CLAIR.nom}`, plan.enClair.trim(), ''] : [];
  return [
    `# ${plan.titre}`,
    '',
    ...enClair,
    `## ${BLOC_DES_TACHES.nom}`,
    taches,
    ...decisions,
    '',
    `## ${faisabilite}`,
    plan.faisabilite,
    '',
    `## ${chemin}`,
    etapes,
    '',
    `## ${consequences}`,
    `${plan.consequences}${verifications}`,
    '',
    `## ${ameliorations}`,
    plan.ameliorations.map((a) => `- ${a}`).join('\n'),
  ]
    .filter((ligne, index, lignes) => !(ligne === '' && lignes[index - 1] === ''))
    .join('\n')
    .trim();
}

/**
 * LA DESCRIPTION DE LA CARTE, TIRÉE DU PLAN : le résumé et le chemin, rien de
 * plus. La colonne du tableau la montre en deux lignes, et l'agent d'exécution
 * reçoit le plan entier par ailleurs.
 */
export function descriptionDepuisLePlanRendu(plan: PlanRendu): string {
  const chemin = plan.chemin.map((etape, index) => `${index + 1}. ${etape.titre}`).join('\n');
  return [plan.resume, chemin].filter((partie) => partie.trim().length > 0).join('\n\n');
}

/**
 * LA VERSION SUIVANTE À ENREGISTRER : toujours n+1, jamais un trou ni un
 * doublon, quel que soit le désordre de ce qui est déjà là.
 */
export function numeroDuProchainPlan(plans: readonly Pick<PlanDeCarte, 'numero'>[] | undefined): number {
  return (plans ?? []).reduce((max, plan) => Math.max(max, plan.numero), 0) + 1;
}

/** Le plan courant : la version la plus haute, ou rien. */
export function planCourant(plans: readonly PlanDeCarte[] | undefined): PlanDeCarte | undefined {
  if (!plans?.length) return undefined;
  return [...plans].sort((a, b) => b.numero - a.numero)[0];
}

/**
 * UN PLAN ÉTAIT ATTENDU DE CE TOUR, ET IL N'EST PAS VENU. La carte porte la
 * demande (`planDemandeA`) tant que l'outil `rendre_plan` ne l'a pas honorée :
 * si elle est encore là à la fin du tour, le tour n'a pas tenu sa promesse.
 * Une question d'outil laissée ouverte n'est pas un manquement — l'agent
 * attend une réponse — et un tour tombé porte déjà sa propre décision.
 */
export function planManquant(etat: {
  planDemandeA: number | undefined;
  questionPosee: boolean;
  echec: boolean;
}): boolean {
  if (!etat.planDemandeA) return false;
  if (etat.questionPosee || etat.echec) return false;
  return true;
}

/**
 * UNE ÉTAPE OUVERTE PLUS LONGTEMPS QUE LE TOUR QUI L'A OUVERTE.
 *
 * `planManquant` ne juge qu'à la FIN d'un tour. Un tour qui ne finit
 * JAMAIS — démon redémarré, machine coupée, moteur tué en pleine course — ne
 * passe par aucune fin de tour : la demande de plan (`planDemandeA`) restait
 * alors sur la carte pour toujours, et l'écran affichait « génération du plan
 * en cours » sept heures après la mort du tour, bouton « Générer le plan »
 * éteint avec, sans aucun moyen d'en sortir.
 *
 * Cette règle-ci est celle du BALAYAGE : elle regarde une demande de plan
 * SANS tour vivant derrière elle. Cinq refus, chacun signant un travail réel,
 * plus un délai de grâce — entre le clic et le démarrage du moteur, aucun agent
 * n'est encore au travail, et fermer là serait fermer un plan qui allait
 * partir.
 */
export const DELAI_ETAPE_SANS_TOUR_MS = 3 * 60_000;

export function etapeDeCarteAbandonnee(
  etat: {
    planDemandeA?: number;
    /** Un agent de cette carte est au travail (statut `running`/`starting`). */
    agentAuTravail: boolean;
    /** Un tour vit encore, même après réponse figée (`tourVivantDepuis`). */
    tourEncoreVivant: boolean;
    /** Une demande attend son quota dans la file : le tour n'a pas commencé. */
    demandeEnFile: boolean;
    /** Le lancement se prépare encore (copie de travail en cours d'ouverture). */
    lancementEnPreparation: boolean;
    /** L'agent a posé une question : sa demande de plan tient toujours. */
    questionOuverte: boolean;
  },
  maintenant: number,
): boolean {
  if (!etat.planDemandeA) return false;
  if (etat.agentAuTravail || etat.tourEncoreVivant) return false;
  if (etat.demandeEnFile || etat.lancementEnPreparation) return false;
  if (etat.questionOuverte) return false;
  return maintenant - etat.planDemandeA >= DELAI_ETAPE_SANS_TOUR_MS;
}

/**
 * UNE CARTE DONT LE CADRAGE EST ENCORE OUVERT NE PART PAS TOUTE SEULE.
 *
 * Le cadrage est une DISCUSSION : tant qu'aucun plan n'en est sorti, la carte
 * n'a pas encore de travail défini. La faire partir à l'heure creuse, c'est
 * lancer un agent d'exécution sur une carte dont personne n'a écrit ce qu'elle
 * doit faire. Les cartes neuves ne reçoivent d'ailleurs plus de date tant que
 * leur cadrage est ouvert (`createCard`) ; ce refus-ci est le FILET, pour
 * celles qui en portent déjà une, posée avant cette règle ou à la main.
 */
export function cartePrisonniereDuCadrage(etat: { aUnCadrage: boolean; plansRendus: number }): boolean {
  return etat.aUnCadrage && etat.plansRendus === 0;
}

/** L'étape visible dans le fil quand le démon réclame le plan manquant. */
export const ETAPE_PLAN_RECLAME = 'Plan réclamé';
export const ETAPE_PLAN_RECLAME_ID = 'plan-reclame';

/** Ce que porte l'incident posé sur la carte quand le plan n'est pas venu. */
export const INCIDENT_PLAN_NON_RENDU =
  'L’agent n’a pas rendu de plan, même relancé. Redemandez-le, ou précisez votre besoin puis redemandez.';

/* ------------------------------------------------------------------ */
/* Les consignes du plan                                               */
/* ------------------------------------------------------------------ */

/**
 * CE QUE LE DÉMON ENVOIE À L'AGENT DE CADRAGE SUR LE CLIC « GÉNÉRER LE PLAN ».
 * Une consigne courte et INTERNE — jamais un faux message de l'utilisateur
 * dans le fil — qui ne demande qu'une chose : le plan, par l'outil.
 */
export function consigneDeRenduDuPlan(numero: number): string {
  return `LE CADRAGE EST TERMINÉ : rends maintenant le PLAN COMPLET de cette demande, version ${numero}, en appelant l'outil « rendre_plan » avec TOUTES ses parties (titre, enClair, synthese, taches, decisions, resume, faisabilite, chemin de deux étapes au moins avec titre et detail, consequences, ameliorations, verifications). « enClair » : L'OUVERTURE DU PLAN, AVANT la liste des tâches — deux à quatre courts paragraphes adressés à l'utilisateur, en mots courants, qui lui font se représenter le résultat : ce que tu vas faire (« je vais… »), comment ça fonctionnera une fois en place, et à quoi ça lui servira au quotidien. Le ton attendu, par exemple : « Vous n'avez pas besoin de connaître le marketing… L'agent rédige, illustre, publie après votre accord… Vous, vous décidez. » Liste des tâches : LE BLOC QUI SUIT, deux entrées au moins — tout ce qu'il y a à réaliser, chacune avec son « titre » en quelques mots et sa « description » DÉTAILLÉE en texte suivi (ce qui est fait et pourquoi). TOUT CE QUE LE PLAN AFFICHE EST LU PAR L'UTILISATEUR, QUI NE PROGRAMME PAS : tâches, décisions, faisabilité, chemin, conséquences, améliorations et vérifications s'écrivent en mots courants, sans nom de fichier, de fonction ni de technologie. Le détail technique utile à l'agent qui fera le travail (fichiers, fonctions, commandes, pièges) va dans « notesTechniques » : l'écran ne le montre pas, l'agent d'exécution le reçoit. C'est la liste des CHOSES À FAIRE ; le chemin, lui, dit l'ORDRE de mise en œuvre. Décisions (bloc « Décisions des itérations ») : une ligne par point décidé, changé ou abandonné pendant le cadrage, en disant à quel moment des échanges — s'il n'y a encore rien eu à trancher, une seule ligne qui le dit. Faisabilité : ce que le projet fait aujourd'hui d'après la mémoire ouverte, ce que la demande veut de plus, l'écart, et ce dont tu n'es pas sûr — dis « je suppose » quand tu supposes. Chemin : les étapes numérotées, chacune avec ce qu'elle change. Conséquences : ce que ça change, ce que ça casse. Améliorations : une ligne par demande actionnable, trois au moins. Synthèse : ce qui va être fait, en deux ou trois phrases simples et concises (plus seulement si nécessaire) — elle s'affiche sous le point « Plan » du fil, pour qu'on sache ce qui sera fait sans ouvrir le plan. Résumé : une phrase — elle ne s'affiche plus dans le plan, elle sert à la description de la carte. N'écris PAS le plan en texte dans ta réponse : l'outil le porte, l'écran l'affiche. Le tour s'arrête avec le plan : n'appelle PAS « rendre_comprehension » dans ce tour. Ne pose aucune question ici : écris le plan avec ce que tu sais, et marque tes suppositions. Ta réponse en texte tient en une phrase.`;
}

/**
 * L'INTERRUPTEUR « PLAN » EST ALLUMÉ : LE MÊME TOUR REND LES DEUX.
 *
 * Le plan n'est plus un tour à part, demandé après coup par un bouton : quand
 * l'utilisateur laisse l'interrupteur allumé près de son champ d'écriture,
 * chaque tour de cadrage rend sa compréhension PUIS son plan, sans second
 * clic ni seconde attente. Cette consigne part en CONTEXTE du tour, jamais
 * comme un faux message de l'utilisateur.
 */
export function consigneDePlanDansLeMemeTour(numero: number): string {
  return (
    `L'INTERRUPTEUR « PLAN » EST ALLUMÉ SUR CETTE CARTE : ce tour rend DEUX choses, dans cet ordre. ` +
    `D'abord « rendre_comprehension », comme toujours, part technique comprise. ` +
    `PUIS, sans attendre un autre message, le PLAN COMPLET version ${numero} par l'outil « rendre_plan ». ` +
    (numero > 1
      ? `Cette version est GLOBALE : pars du plan version ${numero - 1}, redonné en entier dans le bloc « Dernier plan rendu », et intègres-y tout ce qu'apportent les échanges depuis. Un point ne sort du plan que s'il est noté ABANDONNÉ dans « decisions ». `
      : '') +
    `Le plan porte TOUTES ses parties (titre, enClair, synthese, taches, decisions, resume, faisabilite, chemin, consequences, ameliorations, verifications), ` +
    `et il s'ouvre sur « enClair », L'OUVERTURE DU PLAN, AVANT la liste des tâches — deux à quatre courts paragraphes adressés à l'utilisateur, en mots courants, qui lui font se représenter le résultat : ce que tu vas faire (« je vais… »), comment ça fonctionnera une fois en place, et à quoi ça lui servira au quotidien. Le ton attendu, par exemple : « Vous n'avez pas besoin de connaître le marketing… L'agent rédige, illustre, publie après votre accord… Vous, vous décidez. » ` +
    `Toutes les parties s'écrivent en mots courants pour quelqu'un qui ne programme pas ; le détail technique va dans « notesTechniques ». ` +
    `Ne pose aucune question ici : écris le plan avec ce que tu sais, et marque tes suppositions. Ta réponse en texte tient en une ou deux phrases.`
  );
}

/**
 * LE CLIC « GÉNÉRER LE PLAN » SUR UNE CARTE QUI EN PORTE DÉJÀ UN : l'agent
 * rend la version suivante ENTIÈRE, jamais un « voici ce qui change ». Entre
 * deux clics, aucune consigne de plan ne part — les messages de l'utilisateur
 * sont des tours de compréhension (`server/src/runtime.ts`).
 *
 * CHAQUE VERSION EST GLOBALE. La consigne disait que « l'utilisateur vient de
 * le commenter » : l'agent, contexte comprimé, ne rendait plus que le plan de
 * la DERNIÈRE itération, et l'utilisateur perdait de vue tout ce qui avait été
 * convenu avant. Elle part désormais du plan précédent, redonné en entier au
 * même tour (bloc « Dernier plan rendu », `runtime.ts`), y ajoute tous les
 * échanges, et ne laisse rien tomber sans le noter dans les décisions.
 */
export function consigneDAffinageDuPlan(numero: number): string {
  return `UNE NOUVELLE VERSION DU PLAN EST DEMANDÉE : rends la version ${numero} ENTIÈRE par l'outil « rendre_plan ». Elle est GLOBALE — jamais le plan de la seule dernière itération : pars du plan version ${numero - 1}, redonné en entier dans le bloc « Dernier plan rendu », et intègres-y tout ce qu'apportent la dernière compréhension et TOUS les échanges de cette carte depuis le premier message (demandes, précisions, réponses aux questions). Tout ce qui était établi reste dans le plan, même ce qui ne bouge pas : un point ne sort du plan que s'il est noté ABANDONNÉ dans « decisions ». Toutes les parties, liste des tâches comprise, et d'abord « enClair » : L'OUVERTURE DU PLAN, AVANT la liste des tâches — deux à quatre courts paragraphes adressés à l'utilisateur, en mots courants, qui lui font se représenter le résultat : ce que tu vas faire (« je vais… »), comment ça fonctionnera une fois en place, et à quoi ça lui servira au quotidien. Le ton attendu, par exemple : « Vous n'avez pas besoin de connaître le marketing… L'agent rédige, illustre, publie après votre accord… Vous, vous décidez. » Une nouvelle version RÉÉCRIT cette ouverture en entier, pour le plan tel qu'il est devenu. « decisions » (bloc « Décisions des itérations ») REPREND les lignes de la version ${numero - 1} et y AJOUTE ce qui a été décidé, changé ou abandonné depuis, chaque ligne disant quoi et à quel moment (version, message ou réponse). Ne réponds pas par un fragment ni par « voici ce qui change » : la version rendue remplace la précédente, l'écran montre les différences lui-même. Si un point change ce qui sera fait et que tu ne peux pas trancher, pose ta question avec « ask_user » AVANT de rendre le plan. Le tour s'arrête avec le plan : n'appelle PAS « rendre_comprehension » dans ce tour. Ta réponse en texte tient en une ou deux phrases.`;
}

/**
 * LE DERNIER PLAN, REDONNÉ AU CADRAGE AU TOUR DE PLAN — ET À LUI SEUL.
 *
 * Le plan n'existait dans la session que comme argument d'un ancien appel de
 * `rendre_plan` — l'un des premiers textes que la compression efface : la
 * version suivante ne partait plus que du dernier message. Quand une nouvelle
 * version est demandée (`planDemandeA` posé, un plan déjà rendu), son texte
 * entier repart dans le contexte (`runtime.ts`) pour que la suivante soit
 * GLOBALE (`consigneDAffinageDuPlan`). Jamais sur un tour de compréhension, ni
 * pour un autre rôle : ce texte pèse des milliers de signes.
 */
export function blocDuDernierPlan(etat: {
  role: string;
  planDemandeA: number | undefined;
  plans: readonly PlanDeCarte[] | undefined;
}): string | null {
  if (etat.role !== 'cadrage' || !etat.planDemandeA) return null;
  const plan = planCourant(etat.plans);
  if (!plan?.texte?.trim()) return null;
  const notes = plan.notesTechniques?.trim() ? `\n\nSES NOTES TECHNIQUES (« notesTechniques ») :\n${plan.notesTechniques.trim()}` : '';
  return (
    `DERNIER PLAN RENDU SUR CETTE CARTE (version ${plan.numero}) — la version suivante le reprend EN ENTIER, ` +
    `y intègre tous les échanges, et note dans « decisions » ce qui a été décidé, changé ou abandonné :\n\n${plan.texte.trim()}${notes}`
  );
}

/* ------------------------------------------------------------------ */
/* Ce qui attend une décision sur la carte                             */
/* ------------------------------------------------------------------ */

/** Le minimum dont le panneau de décision a besoin d'un message. */
export interface MessageDeDecision {
  id: string;
  role: string;
  questions?: readonly { id: string; answer?: string; cancelled?: boolean }[];
  erreurDeTour?: { choix?: string } | null;
  repriseCompte?: { choisi?: string; abandonnee?: boolean; consommeeA?: number } | null;
}

export type DecisionDuParcours =
  | { sorte: 'question'; messageId: string; questionId: string }
  | { sorte: 'question-texte'; messageId: string }
  | { sorte: 'erreur'; messageId: string }
  | { sorte: 'reprise'; messageId: string }
  | { sorte: 'incident'; texte: string };

/**
 * UN SEUL PANNEAU POUR TOUT CE QUI ATTEND L'UTILISATEUR — question d'outil,
 * question en texte, erreur de tour, reprise de compte, incident du parcours.
 * La liste est ordonnée : ce qui bloque le plus ancien d'abord, l'incident du
 * parcours à la fin. Les cartes proposées, elles, gardent leur bandeau.
 */
export function decisionsDuParcours(etat: {
  messages: readonly MessageDeDecision[];
  parcours?: Pick<ParcoursDeCarte, 'incident'> | null;
  /** Le dernier message finit-il sur une question écrite en texte ordinaire ? */
  questionEnTexte?: boolean;
}): DecisionDuParcours[] {
  const decisions: DecisionDuParcours[] = [];
  for (const message of etat.messages) {
    for (const question of message.questions ?? []) {
      if (!question.answer && !question.cancelled) {
        decisions.push({ sorte: 'question', messageId: message.id, questionId: question.id });
      }
    }
    if (message.erreurDeTour && !message.erreurDeTour.choix) decisions.push({ sorte: 'erreur', messageId: message.id });
    if (message.repriseCompte && !message.repriseCompte.choisi && !message.repriseCompte.abandonnee) {
      decisions.push({ sorte: 'reprise', messageId: message.id });
    }
  }
  const dernier = etat.messages[etat.messages.length - 1];
  if (etat.questionEnTexte && dernier) decisions.push({ sorte: 'question-texte', messageId: dernier.id });
  if (etat.parcours?.incident?.texte) decisions.push({ sorte: 'incident', texte: etat.parcours.incident.texte });
  return decisions;
}
