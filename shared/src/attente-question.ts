/**
 * « L'agent pose une question, puis continue comme si de rien n'était. »
 *
 * L'outil `ask_user` rendait la main AUSSITÔT : la question s'affichait, le
 * triangle orange s'allumait, et le moteur enchaînait tranquillement les étapes
 * suivantes de sa liste — celles qui dépendaient justement de la réponse. Pire :
 * la réponse de l'utilisateur, elle, tombait dans la FILE D'ATTENTE de l'agent
 * (« votre message part dès que l'agent a fini »), donc elle n'arrivait qu'une
 * fois tout le travail terminé. On répondait à une question dont le travail
 * qu'elle devait orienter était déjà fait.
 *
 * La correction tient en une phrase : **l'appel d'outil ne rend la main qu'une
 * fois la réponse donnée**. Le moteur, lui, est ARRÊTÉ tant qu'un appel d'outil
 * n'a pas répondu — c'est la mécanique même du protocole d'outils. Aucune
 * consigne à écrire, aucune promesse à tenir : l'attente est structurelle.
 *
 * Ce fichier ne porte que les RÈGLES et les TEXTES, sans base, sans réseau et
 * sans minuterie : ils se testent seuls. Le registre des attentes vit dans
 * `server/src/attente-question.ts`, le va-et-vient dans `server/mcp-bridge.mjs`.
 */

import { texteDeReponse } from './images-reponse.js';

/**
 * COMBIEN DE TEMPS UN AGENT ATTEND UNE RÉPONSE. Trente minutes : assez pour que
 * l'utilisateur voie l'alerte et réponde, pas assez pour qu'un agent oublié
 * tienne une place d'exécution toute la nuit — et surtout pas assez pour
 * empêcher un redémarrage du serveur pour toujours, puisque le démon ne se
 * redémarre jamais tant qu'une tâche tourne.
 */
export const PLAFOND_ATTENTE_MS = 30 * 60 * 1000;

/**
 * L'attente se découpe en TRANCHES. Le pont d'outils redemande « alors ? »
 * toutes les vingt secondes au lieu de tenir une seule requête ouverte une
 * demi-heure : une requête qui dort si longtemps se fait couper par le premier
 * délai venu (celui du client HTTP, d'un proxy, du système), et l'agent se
 * retrouverait relancé sans réponse. Chaque tranche est courte, donc sûre.
 */
export const TRANCHE_ATTENTE_MS = 20 * 1000;

/**
 * Le délai que les moteurs doivent accorder à UN appel d'outil. Sans lui,
 * Claude coupe à cinq minutes et Codex à une minute : la question serait
 * abandonnée avant même que l'utilisateur ait vu l'alerte. On laisse deux
 * minutes de marge au-dessus du plafond d'attente, le temps que le démon rende
 * proprement son « personne n'a répondu ».
 */
export function delaiOutilMoteurMs(plafond: number = PLAFOND_ATTENTE_MS): number {
  return plafond + 2 * 60 * 1000;
}

/** Ce que devient une attente. */
export type EtatDAttente =
  /** Personne n'a encore répondu : le pont redemande. */
  | 'attente'
  /** L'utilisateur a répondu : le texte de sa réponse part au moteur. */
  | 'repondu'
  /** La question a été annulée sans réponse (posée par erreur). */
  | 'annulee'
  /** Le plafond est atteint : l'agent doit s'arrêter là. */
  | 'expiree'
  /** Plus personne n'attend cette question : tour refermé, serveur redémarré. */
  | 'perdue';

/** Une tranche d'attente, telle qu'elle revient au pont d'outils. */
export interface IssueDAttente {
  etat: EtatDAttente;
  /** Le texte rendu au moteur — vide tant que l'attente continue. */
  text: string;
}

/** L'attente continue : le pont redemande, le moteur ne voit rien. */
export const ATTENTE_EN_COURS: IssueDAttente = { etat: 'attente', text: '' };

/**
 * Ce que l'outil rend au moteur quand la réponse arrive. La question n'est pas
 * répétée : c'est lui qui l'a posée, il l'a sous les yeux. On dit en revanche
 * ce qu'il faut en FAIRE, sans quoi un moteur pressé la note et reprend son
 * plan d'avant.
 */
export function texteDeReponseALaQuestion(reponse: string, fichiers: string[] = []): string {
  const propre = reponse.trim();
  const jointes = fichiers.length
    ? `\nFichiers joints à la réponse : ${fichiers.join(', ')}`
    : '';
  return (
    `Réponse de l'utilisateur : ${propre || '(réponse vide)'}${jointes}\n` +
    "Reprends ton travail à partir de cette réponse : elle prime sur ce que tu avais supposé, " +
    'et les étapes suivantes doivent en tenir compte.'
  );
}

/** La question a été annulée : rien n'a été tranché, l'agent ne doit rien deviner. */
export function texteDAnnulation(): string {
  return (
    "La question a été retirée sans réponse. Ne devine pas à la place de l'utilisateur : " +
    'arrête-toi ici, rends la main, et dis en une ligne ce qui reste à trancher.'
  );
}

/** Personne n'a répondu dans le délai : on s'arrête, on ne suppose pas. */
export function texteDExpiration(plafond: number = PLAFOND_ATTENTE_MS): string {
  const minutes = Math.round(plafond / 60000);
  return (
    `Personne n'a répondu après ${minutes} minutes. ARRÊTE-TOI ICI : ne fais aucune des étapes ` +
    "qui dépendaient de cette réponse et ne tranche pas à la place de l'utilisateur. Rends la main " +
    'en disant en une ligne ce que tu attends ; la réponse, quand elle viendra, relancera ce travail.'
  );
}

/** L'attente s'est perdue (tour refermé, serveur redémarré) : même prudence. */
export function texteDePerte(): string {
  return (
    "L'attente de cette réponse a été interrompue côté serveur. Arrête-toi ici sans trancher à la " +
    "place de l'utilisateur, et dis en une ligne ce que tu attends."
  );
}

/** Le plafond est-il atteint ? Le temps est DONNÉ, jamais lu ici. */
export function attenteExpiree(poseeA: number, maintenant: number, plafond: number = PLAFOND_ATTENTE_MS): boolean {
  return maintenant - poseeA >= plafond;
}

/**
 * Ce que l'outil `ask_user` répond au moteur QUAND L'ATTENTE N'A PAS PU ÊTRE
 * POSÉE — vieux pont d'outils qui ne sait pas attendre, par exemple. On revient
 * alors au comportement d'avant, mais en le DISANT : le moteur sait qu'il ne
 * doit pas enchaîner.
 */
export function texteSansAttente(): string {
  return (
    "Question posée à l'utilisateur. ARRÊTE-TOI ICI et rends la main : ne fais aucune étape qui " +
    'dépend de cette réponse. Sa réponse relancera ce travail.'
  );
}

/**
 * Ce que l'agent reçoit quand il pose une question alors qu'une autre attend
 * encore sa réponse. Une question rédigée avant de connaître la réponse à la
 * précédente peut devenir sans objet (« si vous gardez cette option… » après
 * « on supprime ») : la seconde n'est donc PAS posée, et l'agent est prié de
 * la reformuler, s'il en a encore besoin, une fois la réponse reçue.
 */
export function texteDeQuestionSimultanee(): string {
  return (
    "Refusé : une question est déjà posée à l'utilisateur et attend sa réponse. Ne pose UNE SEULE question à la fois. " +
    "Rends la main ; quand la réponse te revient, relis-la, puis pose la question suivante seulement si elle en découle " +
    "(jamais une question conditionnelle, jamais une question que cette réponse rend sans objet)."
  );
}

/**
 * CE TEXTE S'ADRESSE À L'AGENT, PAS AU LECTEUR — IL NE SE LIT DONC PAS DANS LE
 * PARCOURS D'UNE CARTE.
 *
 * Le pont d'outils journalisait ce qu'il rendait au moteur : sous l'intitulé
 * « RÉPONSE » d'une question posée, on lisait « Question posée à l'utilisateur.
 * ARRÊTE-TOI ICI… » — une consigne technique, à la place de la réponse
 * réellement choisie. Ce n'est pas une réponse : c'est un accusé de réception.
 *
 * La reconnaissance est TOLÉRANTE sur la suite de la phrase : le texte a déjà
 * changé de formulation, et les journaux déjà écrits doivent rester propres.
 */
export function estUneConsigneAuMoteur(texte: string | undefined): boolean {
  const propre = (texte ?? '').trim();
  if (!propre) return false;
  return propre === texteSansAttente() || /^Question pos[ée]e à l['’]utilisateur\./i.test(propre);
}

/* ------------------------------------------------------------------ */
/* LE TÉMOIN DE TRAVAIL D'UN AGENT QUI ATTEND                           */
/* ------------------------------------------------------------------ */

/**
 * UN AGENT ARRÊTÉ SUR SA QUESTION N'EST PAS EN TRAIN DE TRAVAILLER — ET CELA
 * VAUT POUR TOUS LES AGENTS, QUELLE QUE SOIT LEUR ORIGINE.
 *
 * L'attente est posée par un registre UNIQUE (`server/src/attente-question.ts`),
 * traversé par tout appel de l'outil `ask_user` : un agent de carte, le chef
 * d'orchestre et l'agent d'un tiroir y passent tous. Ce qui manquait n'était
 * donc pas l'arrêt, mais son AFFICHAGE : la conversation d'une carte lisait le
 * drapeau `attendReponse` et disait « l'agent attend votre réponse », tandis
 * que le tiroir de procédure, lui, continuait d'afficher « L'agent travaille…
 * Outil ask_user » avec un chronomètre qui défilait — devant sa propre
 * question restée sans réponse.
 *
 * La règle tient en deux gestes, et c'est ici qu'elle vit pour que tous les
 * témoins la suivent à l'identique :
 *  1. le témoin DIT l'attente au lieu de nommer l'étape figée ;
 *  2. son chronomètre s'ARRÊTE à l'instant où la question est partie, il ne
 *     compte pas le temps que l'utilisateur met à répondre.
 */

/**
 * L'INSTANT QUE LE CHRONOMÈTRE D'UN TÉMOIN DOIT LIRE.
 *
 * Sans attente, c'est l'instant présent — le temps défile. Dès qu'une attente
 * est posée, c'est l'instant de la QUESTION : la durée affichée se fige là et
 * n'avance plus, quel que soit le temps mis à répondre. Le repli sur le présent
 * (`Math.min`) protège d'une horloge de navigateur en retard sur le serveur,
 * qui donnerait une durée négative.
 */
export function instantDuTemoin(maintenant: number, attendDepuis?: number): number {
  return attendDepuis === undefined ? maintenant : Math.min(maintenant, attendDepuis);
}

/** Ce que la barre d'écriture dit pendant que l'agent attend. */
export const TEXTE_BARRE_EN_ATTENTE = 'L’agent attend votre réponse à sa question…';

/* ------------------------------------------------------------------ */
/* LA BARRE D'ÉCRITURE RÉPOND À LA QUESTION                             */
/* ------------------------------------------------------------------ */

/**
 * UN MESSAGE ÉCRIT PENDANT QU'UNE QUESTION ATTEND EST LA RÉPONSE À CETTE
 * QUESTION — pas une demande de plus.
 *
 * La bulle de la question portait son PROPRE champ de saisie, à côté de la
 * barre d'écriture de la conversation : deux endroits pour écrire la même
 * chose. Celui qui répondait dans la barre — le geste naturel, celui que le
 * texte de la barre invite d'ailleurs à faire — voyait sa phrase tomber dans la
 * FILE D'ATTENTE de l'agent, qui ne la lirait qu'après avoir fini. La question,
 * elle, restait ouverte pour toujours : son bouton « Annuler » ne partait
 * jamais, et le triangle orange non plus.
 *
 * La barre d'écriture devient donc la voie de réponse dès qu'une question
 * attend. Un texte vide ne répond rien.
 */
export function texteRepondALaQuestion(entree: {
  /** La question ouverte de cet agent, s'il y en a une. */
  questionEnAttente?: string | null;
  /** Ce qui a été écrit dans la barre. */
  texte: string;
  /**
   * La question accepte-t-elle une réponse écrite ? Une question à choix PUR
   * (aucun texte libre) attend un clic sur une option : ce qu'on écrit alors
   * n'est pas sa réponse, c'est une demande de plus.
   */
  texteLibreAutorise?: boolean;
}): string | null {
  if (!entree.questionEnAttente) return null;
  if (entree.texteLibreAutorise === false) return null;
  return entree.texte.trim() ? entree.questionEnAttente : null;
}

/**
 * CE QUE LA BULLE D'UNE QUESTION TIENT DÉJÀ, avant tout envoi : les choix
 * cochés (par leur libellé), ce qui est écrit dans son champ, ses images.
 */
export interface SaisieDeQuestion {
  libelles: string[];
  texte?: string;
  images?: string[];
}

/**
 * LA RÉPONSE ÉCRITE DANS LA BARRE EMPORTE CE QUE LA BULLE TENAIT DÉJÀ.
 *
 * On coche un choix dans la bulle, puis on écrit sa précision dans la barre du
 * bas — le geste naturel. Seul le texte de la barre partait : le choix coché
 * était perdu, et la question se lisait ensuite sans rien de retenu. La
 * réponse prend donc la MÊME forme que celle du bouton « Répondre » :
 * « libellés — complément » (`texteDeReponse`), que l'affichage sait redécouper.
 *
 * Seuls les libellés RÉELLEMENT proposés par la question passent, dans l'ordre
 * où elle les a posés : ce qui vient de l'écran ne s'écrit pas tel quel.
 */
export function reponseParLaBarre(entree: {
  /** Ce qui a été écrit dans la barre. */
  texte: string;
  /** Les libellés que la question propose. */
  options: readonly string[];
  /** Ce que la bulle de cette question tenait au moment de l'envoi. */
  saisie?: SaisieDeQuestion;
}): string {
  const coches = new Set(entree.saisie?.libelles ?? []);
  const libelles = entree.options.filter((libelle) => coches.has(libelle));
  const complement = [entree.saisie?.texte ?? '', entree.texte]
    .map((morceau) => morceau.trim())
    .filter(Boolean)
    .join('\n');
  return texteDeReponse(libelles, complement, 0);
}
