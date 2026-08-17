/**
 * ARRÊTER UN AGENT — ET QUE LE CLIC MORDE TOUJOURS.
 *
 * Le bouton d'arrêt ne savait faire qu'une chose : retrouver le tour vivant de
 * l'agent et couper son moteur. Sans tour vivant — une préparation restée
 * pendue, une panne qui a mangé la fermeture, un tour d'un démon d'avant — il
 * rendait « faux » et s'arrêtait là : rien ne bougeait à l'écran, aucune erreur
 * n'était dite, et l'agent gardait sa mention « au travail » pour toujours.
 *
 * Restait un cas plus sournois, celui du chef qui « refuse de s'arrêter » : un
 * tour vivant DONT LE MOTEUR N'EST PLUS LÀ. Cela arrive à chaque fin de tour, et
 * cela dure : passé la réponse, le tour continue en SERVICE (relire le quota du
 * compte, comprimer le fil, refermer la copie de travail, ranger la carte) et
 * reste inscrit parmi les tours vivants tout ce temps, l'agent affiché « au
 * travail », son compteur qui court. Le clic tombait alors sur le geste
 * « coupe », envoyait un signal à un processus déjà mort, ne disait rien — et
 * l'agent continuait de se dire au travail. C'est exactement le silence
 * reproché.
 *
 * La règle vit ici, sans base ni disque : quel geste l'arrêt doit-il faire,
 * selon ce qu'on constate de l'agent — et que dire à l'utilisateur dans chaque
 * cas. Le démon l'applique, les tests la rejouent.
 */

import type { StatutDAgent } from './fin-de-tour.js';

/** Ce que le démon constate de l'agent au moment du clic. */
export interface EtatALArret {
  /** Le statut enregistré de l'agent. */
  statut: StatutDAgent;
  /** Un tour vivant porte-t-il encore cet agent (moteur lancé, suivi) ? */
  tourVivant: boolean;
  /**
   * Le tour est-il en cours de PRÉPARATION (parti, mais pas encore de moteur) ?
   * C'est la fenêtre où l'agent est marqué « starting » sans figurer dans les
   * tours vivants : elle pouvait durer pour toujours si la préparation se
   * coinçait, et le bouton n'avait alors rien à couper.
   */
  enPreparation?: boolean;
  /**
   * Le processus du moteur répond-il encore ? `undefined` quand on ne peut pas
   * le savoir (aucun numéro de processus connu) : on suppose alors qu'il vit,
   * pour ne pas refermer d'autorité un tour qui travaille peut-être.
   *
   * Faux, c'est un tour vivant SANS moteur : lui envoyer un signal ne fait rien
   * du tout. Il faut le refermer, pas le « couper ».
   */
  moteurVivant?: boolean;
  /**
   * La réponse est-elle DÉJÀ figée à l'écran ? Au-delà, le tour ne fait plus que
   * du service — et il n'y a plus de réflexion à interrompre, seulement un agent
   * à libérer.
   */
  reponseFigee?: boolean;
  /**
   * Combien de moteurs de SERVICE tournent encore pour cet agent — compression
   * du fil, relance d'un plan, résumé de continuité. Ce ne sont pas des tours :
   * ils n'écrivent rien à l'écran, et l'agent peut se dire au repos pendant
   * qu'ils tournent. Un arrêt demandé les emporte quand même, et il le DIT :
   * sinon le clic paraît sans effet sur une machine qui, elle, travaille encore.
   */
  moteursDeService?: number;
}

/**
 * Le geste à faire :
 *   - « coupe »   : un moteur tourne, on l'arrête — le chemin de tous les jours ;
 *   - « secours » : plus rien ne tourne mais l'agent se dit au travail, on le
 *                   referme d'autorité pour qu'il cesse enfin de le prétendre ;
 *   - « inactif » : l'agent ne travaillait déjà plus, il n'y a rien à faire.
 */
export type GesteDArret = 'coupe' | 'secours' | 'inactif';

export interface DecisionDArret {
  geste: GesteDArret;
  /** Ce qui est dit à l'utilisateur, dans tous les cas — jamais le silence. */
  message: string;
  /** L'agent était-il réellement en train de travailler ? */
  travaillait: boolean;
}

export const MESSAGE_ARRET_COUPE = "Agent arrêté : son moteur a été coupé.";

export const MESSAGE_ARRET_SECOURS =
  "Cet agent n'avait plus de moteur en marche : il se disait au travail sans que rien ne tourne. Il a été refermé et repasse au repos.";

export const MESSAGE_ARRET_INACTIF = "Cet agent ne travaille plus : il n'y avait rien à arrêter.";

/**
 * Le cas de l'agent qui paraît au repos alors qu'un moteur de service tourne
 * encore derrière lui. Le clic a bel et bien coupé quelque chose : on ne lui
 * répond pas « il n'y avait rien à arrêter ».
 */
export const MESSAGE_ARRET_SERVICE =
  "Cet agent avait fini de répondre, mais un moteur tournait encore en arrière-plan : il a été coupé.";

/** L'agent se dit-il au travail ? Les deux seuls statuts qui l'affirment. */
export function seDitAuTravail(statut: StatutDAgent): boolean {
  return statut === 'running' || statut === 'starting';
}

/**
 * Ce tour vivant a-t-il encore quelque chose à COUPER ?
 *
 * Deux façons de n'avoir plus rien : son processus de moteur ne répond plus, ou
 * sa réponse est déjà figée — le tour ne fait plus que du service derrière
 * l'écran. Dans les deux cas, envoyer un signal ne change rien : c'est une
 * fermeture d'autorité qu'il faut.
 */
export function tourACouper(etat: EtatALArret): boolean {
  if (!etat.tourVivant) return false;
  if (etat.reponseFigee) return false;
  return etat.moteurVivant !== false;
}

/**
 * Que fait le bouton d'arrêt, ici et maintenant ?
 *
 * Un tour vivant qui a encore un moteur à couper se coupe. Sinon, tout agent qui
 * se DIT encore au travail — « running » ou « starting », préparation et tour de
 * service compris — est refermé d'autorité : c'est le seul moyen pour que le
 * clic ait toujours un effet visible, quel que soit l'endroit où le tour est
 * bloqué. Un agent déjà au repos ne se referme pas, et le dit — sauf s'il lui
 * reste un moteur de SERVICE en marche, auquel cas le clic coupe ce moteur-là
 * et l'annonce, plutôt que de prétendre qu'il n'y avait rien à faire.
 */
export function decisionDArret(etat: EtatALArret): DecisionDArret {
  if (tourACouper(etat)) {
    return { geste: 'coupe', message: MESSAGE_ARRET_COUPE, travaillait: true };
  }
  if (etat.tourVivant || seDitAuTravail(etat.statut) || etat.enPreparation) {
    return { geste: 'secours', message: MESSAGE_ARRET_SECOURS, travaillait: true };
  }
  if (etat.moteursDeService) {
    return { geste: 'secours', message: MESSAGE_ARRET_SERVICE, travaillait: false };
  }
  return { geste: 'inactif', message: MESSAGE_ARRET_INACTIF, travaillait: false };
}

/** La raison écrite sur le tour refermé de force par le bouton d'arrêt. */
export const RAISON_ARRET_DE_SECOURS =
  "Arrêté à la main alors que plus aucun moteur ne tournait : le tour a été refermé pour libérer l'agent.";

/**
 * LE COUP DE GRÂCE, ET COMBIEN DE TEMPS ON ATTEND AVANT DE LE DONNER.
 *
 * Arrêter, c'est d'abord DEMANDER (SIGTERM) : un moteur qui obéit range ses
 * affaires et s'en va en une fraction de seconde. Ce n'est pas lui le problème.
 * Le problème, c'est celui qui n'obéit pas — pendu dans un appel qui ne revient
 * jamais, ou occupé à ignorer le signal. On lui laissait QUATRE secondes avant
 * de l'achever : quatre secondes d'un écran qui ne bouge pas, après un clic
 * explicite, c'est exactement ce qui fait croire que le bouton ne marche pas.
 *
 * Une seconde et demie suffit : un moteur qui allait partir est déjà parti, et
 * celui qui reste n'avait aucune intention de s'en aller.
 */
export const DELAI_COUP_DE_GRACE_MS = 1_500;

/**
 * LE DÉLAI LAISSÉ AU MOTEUR APRÈS LE SIGNAL, avant de refermer d'autorité.
 *
 * Un moteur qui reçoit son coup d'arrêt rend la main en une seconde ou deux : le
 * tour se referme alors tout seul, par son chemin normal, et il n'y a rien à
 * faire de plus. Mais un moteur peut aussi ne jamais répondre — bloqué dans un
 * appel réseau, ou déjà mort sans que sa fin ne soit remontée. On lui laisse
 * donc cette fenêtre, puis on constate : si le tour est toujours là, on le
 * referme sans lui demander son avis.
 *
 * Toujours un cran de plus que le coup de grâce ci-dessus, pour ne pas refermer
 * par-dessus un moteur qu'on vient tout juste d'achever et dont la fin n'est pas
 * encore remontée.
 */
export const DELAI_CONFIRMATION_ARRET_MS = 3_000;

/** La raison écrite sur un tour que le signal d'arrêt n'a pas suffi à refermer. */
export const RAISON_ARRET_SANS_REPONSE =
  "Arrêté à la main : le moteur n'a pas rendu la main après son signal d'arrêt, le tour a été refermé d'autorité.";

/**
 * Ce qui est dit à l'écran quand la fermeture d'autorité a dû suivre le signal.
 * Le premier message annonçait « son moteur a été coupé » ; celui-ci corrige, en
 * clair, ce qu'il a fallu faire de plus.
 */
export const MESSAGE_ARRET_ACHEVE =
  "Le moteur n'a pas répondu à son signal d'arrêt : le tour a été refermé d'autorité et l'agent est libéré.";

/**
 * FAUT-IL ACHEVER L'ARRÊT ?
 *
 * Appelée un instant après le signal, sur le constat de ce qui reste. Vrai : le
 * même tour est toujours inscrit parmi les tours vivants, donc le signal n'a
 * rien donné et il faut refermer d'autorité. Faux : le tour s'est refermé de
 * lui-même (le cas ordinaire), ou un AUTRE tour a démarré depuis — celui-là ne
 * nous appartient pas, et le refermer couperait un travail que personne n'a
 * demandé d'arrêter.
 */
export function arretAAchever(constat: {
  /** Le tour visé par le clic est-il encore le tour vivant de cet agent ? */
  memeTourEncoreVivant: boolean;
}): boolean {
  return constat.memeTourEncoreVivant;
}

/*
 * ARRÊTER TOUT LE MONDE — ET DIRE CE QUI A ÉTÉ FAIT, AGENT PAR AGENT.
 *
 * Le bouton du haut ne rendait qu'un NOMBRE : « 3 agents arrêtés ». Or les trois
 * n'ont pas forcément subi le même sort — l'un avait un moteur qu'on a coupé,
 * l'autre se disait au travail sans que rien ne tourne et a été refermé
 * d'autorité, le troisième n'avait déjà plus rien. Un compte anonyme laisse
 * exactement le doute que ce bouton doit lever : est-ce que ça a mordu ?
 *
 * La règle est pure : on lui donne les gestes réellement faits, elle rend la
 * phrase. Le démon compte, elle rédige.
 */

export interface BilanDesArrets {
  /** Combien d'agents ont été touchés, tous gestes confondus. */
  total: number;
  /** Combien de moteurs ont été coupés. */
  coupes: number;
  /** Combien de tours ont été refermés d'autorité, faute de moteur à couper. */
  secours: number;
  /** Combien ne travaillaient déjà plus. */
  inactifs: number;
  /** La phrase à afficher, jamais vide. */
  message: string;
}

/*
 * CE QUI A ÉTÉ SAUVÉ AVANT LA COUPURE SE DIT DANS LA CONVERSATION.
 *
 * Le démon enregistre d'office, sur la branche de la carte, ce que l'agent avait
 * écrit sans le commiter — sinon ce travail n'entrerait dans aucun déploiement.
 * Mais il le faisait EN SILENCE : la conversation s'arrêtait net, et rien ne
 * disait si le travail des dernières minutes avait survécu. On le dit donc là où
 * l'utilisateur regarde — dans le fil de l'agent —, avec les fichiers concernés
 * et la branche où les retrouver.
 *
 * Deux cas, et le second compte autant : quand RIEN ne traînait, on le dit
 * aussi. « Rien n'a été enregistré » et « il n'y avait rien à enregistrer » ne
 * veulent pas dire la même chose pour qui vient de perdre son agent.
 */

/** Au-delà, on ne cite plus : la liste devient un pavé illisible. */
export const FICHIERS_SAUVES_MONTRES_MAX = 8;

export interface TravailSauve {
  /** Les fichiers qui traînaient et qui viennent d'être enregistrés. */
  fichiers: string[];
  /** La branche de la carte, celle où les retrouver. */
  branche?: string;
  /** Pourquoi la coupure a eu lieu, en une poignée de mots. */
  motif?: string;
}

/**
 * Le message posé dans la conversation d'un agent coupé en force. Il nomme les
 * fichiers (jusqu'à `FICHIERS_SAUVES_MONTRES_MAX`, au-delà il dit combien
 * restent) et la branche — jamais un « votre travail est sauvegardé » sans dire
 * où, qui n'apprend rien à personne.
 */
export function messageDuTravailSauve(travail: TravailSauve): string {
  const motif = travail.motif?.trim() || 'Agent coupé en force';
  const ou = travail.branche ? ` sur la branche « ${travail.branche} »` : ' sur la branche de cette carte';

  const fichiers = travail.fichiers.map((f) => f.trim()).filter(Boolean);
  if (!fichiers.length) {
    return `${motif} : il n’y avait rien à enregistrer${ou} — tout ce qui avait été écrit y était déjà.`;
  }

  const montres = fichiers.slice(0, FICHIERS_SAUVES_MONTRES_MAX);
  const reste = fichiers.length - montres.length;
  const liste = montres.map((f) => `- ${f}`).join('\n');
  const fin = reste > 0 ? `\n- …et ${reste} ${accord(reste, 'autre fichier', 'autres fichiers')}` : '';
  const combien = `${fichiers.length} ${accord(fichiers.length, 'fichier', 'fichiers')}`;

  return `${motif} : le travail en cours a été enregistré${ou} avant la coupure — ${combien}. Rien n’est perdu, et rien n’est publié.\n\n${liste}${fin}`;
}

/** Le mot juste au singulier comme au pluriel, sans « (s) ». */
function accord(n: number, singulier: string, pluriel: string): string {
  return n > 1 ? pluriel : singulier;
}

/**
 * Le compte rendu d'un arrêt groupé. Chaque geste est nommé — coupé, refermé
 * d'autorité, déjà inactif — et rien n'est passé sous silence : un bouton qui
 * n'a rien trouvé à arrêter le DIT, au lieu d'annoncer une réussite vide.
 */
export function bilanDesArrets(gestes: GesteDArret[]): BilanDesArrets {
  const coupes = gestes.filter((g) => g === 'coupe').length;
  const secours = gestes.filter((g) => g === 'secours').length;
  const inactifs = gestes.filter((g) => g === 'inactif').length;
  const total = gestes.length;

  if (!total) {
    return { total, coupes, secours, inactifs, message: 'Aucun agent ne travaillait : il n’y avait rien à arrêter.' };
  }

  const parts: string[] = [];
  if (coupes) parts.push(`${coupes} ${accord(coupes, 'moteur coupé', 'moteurs coupés')}`);
  if (secours) parts.push(`${secours} ${accord(secours, 'tour refermé d’autorité', 'tours refermés d’autorité')}`);
  if (inactifs) parts.push(`${inactifs} ${accord(inactifs, 'agent déjà inactif', 'agents déjà inactifs')}`);

  const tete = `${total} ${accord(total, 'agent arrêté', 'agents arrêtés')}`;
  return { total, coupes, secours, inactifs, message: `${tete} : ${parts.join(', ')}.` };
}
