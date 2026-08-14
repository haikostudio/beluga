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

/** Ce que la barre d'écriture dit pendant que l'agent attend. */
export const TEXTE_BARRE_EN_ATTENTE = 'L’agent attend votre réponse à sa question…';
