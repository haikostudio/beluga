/**
 * LA FIN D'UN TOUR : quand elle est acquise, et quand elle ne vient jamais.
 *
 * Un tour d'agent se referme normalement tout seul : le moteur rend la main, le
 * démon fige le message, remet l'agent au repos et libère la barre d'écriture.
 * Trois choses pouvaient empêcher cette fermeture, et l'agent tournait alors
 * « dans le vide » — réponse écrite à l'écran, compteur qui court, barre
 * d'écriture bloquée :
 *
 *   1. LE PROGRAMME EST FINI MAIS SES TUYAUX RESTENT OUVERTS. On n'attendait que
 *      l'événement « close » de Node, qui exige en plus la fermeture de la
 *      sortie standard — or un petit-fils du moteur (pont d'outils, sous-agent)
 *      peut en hériter et la garder ouverte indéfiniment. « exit » suffit à dire
 *      que le programme est fini : on lui laisse un court délai de vidage, puis
 *      on rend la main.
 *   2. LE TRAVAIL D'APRÈS-RÉPONSE N'AVAIT AUCUN PLAFOND. Compression du fil,
 *      mesure de la session, relance d'un plan incomplet : autant d'appels au
 *      moteur passés APRÈS que la réponse est visible, chacun capable de rester
 *      pendu pour toujours. Ils sont désormais bornés.
 *   3. UNE PANNE INTERNE POUVAIT AVALER LA FERMETURE. Le tour restait alors
 *      marqué « au travail » sans que plus personne ne l'attende.
 *   4. LA PRÉPARATION D'AVANT LE MOTEUR N'AVAIT AUCUN PLAFOND. Entre la demande
 *      et le lancement du moteur, le démon choisit un compte, relève des quotas,
 *      cherche la mémoire, ouvre une copie de travail : autant d'appels qui
 *      peuvent rester pendus. L'agent était alors marqué « au travail » ET
 *      compté comme SUIVI — donc le constat 1 ne s'appliquait pas, aucun moteur
 *      n'existait pour le constat 2, aucune réponse pour le constat 3. Rien ne
 *      le refermait jamais : les demandes suivantes s'empilaient dans sa file et
 *      seul un redémarrage du serveur libérait l'agent.
 *   5. UN MOTEUR LANCÉ POUVAIT SE TAIRE POUR TOUJOURS. Processus bien vivant,
 *      aucun événement, aucune réponse écrite : là non plus aucun constat ne
 *      s'appliquait. C'est le même cul-de-sac, une étape plus loin.
 *   6. LE STATUT RETOMBE AVANT QUE LE RANGEMENT SOIT FINI. Le démon remet
 *      l'agent au repos (« terminé », « interrompu ») DÈS que la réponse est
 *      rendue, puis continue son rangement : constat du dépôt, fusion de la
 *      branche de la carte, fermeture de la copie de travail — des commandes
 *      git, qui peuvent rester pendues sur un verrou. Or ce jugement commençait
 *      par écarter tout agent qui n'était plus « au travail » : le constat 3 (la
 *      réponse est figée depuis trop longtemps) ne pouvait donc PLUS JAMAIS
 *      s'appliquer à cette fenêtre-là, la seule où il servait vraiment. La barre
 *      « L'agent termine son tour… » restait allumée pour toujours au-dessus
 *      d'une réponse pourtant complète, et la barre d'écriture avec elle.
 *      Le portier ne regarde donc plus le seul statut : un tour encore SUIVI par
 *      le démon dont la réponse est déjà figée est jugé comme les autres.
 *   7. LE FILET TUAIT LA REPRISE QU'IL DEVAIT PROTÉGER. Une panne PASSAGÈRE du
 *      fournisseur (erreur 500, moteur surchargé, lien coupé) arrête le
 *      processus du moteur, et le tour attend 5, 15 puis 45 secondes avant de
 *      relancer le MÊME fil là où il s'était arrêté
 *      (`shared/src/panne-passagere.ts`). Pendant cette attente, le constat 2
 *      voyait exactement ce qu'il cherche — un moteur mort sous un tour parti
 *      depuis plus d'une minute — et refermait d'autorité un tour qui allait
 *      repartir. Le nouvel essai partait alors dans un tour déjà mort : ses
 *      appels d'outils étaient refusés (« ce tour est terminé »), son travail
 *      perdu, la carte marquée en échec — au MILIEU du travail, après des
 *      dizaines d'étapes réussies, ce qui est précisément le contraire de la
 *      règle « une panne passagère se retente, elle ne tue pas la tâche ».
 *      Une reprise en attente est donc DITE au jugement, et elle l'écarte le
 *      temps — borné — de cette attente.
 *
 * Les seuils et le jugement vivent ici, sans base ni disque : c'est ce qui les
 * rend rejouables.
 */

/** Le temps laissé aux sorties du moteur pour se vider une fois le programme fini. */
export const DELAI_VIDAGE_SORTIE_MS = 2_000;

/**
 * Plafond d'un appel au moteur passé APRÈS la réponse (compression native,
 * mesure de la session, résumé de repli, relance d'un plan incomplet). Aucun de
 * ces appels ne mérite de retenir la barre d'écriture plus d'une minute et
 * demie : passé ce délai, on arrête le processus et on continue sans lui.
 */
export const PLAFOND_APPEL_APRES_REPONSE_MS = 90_000;

/**
 * LE RATTRAPAGE DU PLAN ÉCRIT UN PLAN ENTIER, PAS UNE REMISE EN FORME. Un plan
 * complet sous Codex en réflexion poussée dépasse souvent la minute et demie :
 * coupé à 90 s, il posait « Le plan n'est pas venu » sur un plan presque écrit.
 * Cinq minutes suffisent à l'écrire, et restent sous `PLAFOND_FERMETURE_MS`
 * pour qu'un moteur muet ne mure jamais la carte.
 */
export const PLAFOND_RATTRAPAGE_PLAN_MS = 5 * 60_000;

/**
 * Au-delà, un tour dont la réponse est DÉJÀ figée n'a plus d'excuse : tout le
 * travail d'après-réponse est borné, sa somme tient largement dessous. On
 * referme donc d'autorité. Le filet, pas la règle.
 */
export const PLAFOND_FERMETURE_MS = 6 * 60_000;

/**
 * Un processus se cherche mal dans la seconde qui suit son lancement (le
 * numéro n'est pas encore posé, le système ne l'a pas encore inscrit). On ne
 * croit donc un moteur disparu qu'après cette minute de grâce.
 */
export const DELAI_AVANT_PROCESSUS_DISPARU_MS = 60_000;

/**
 * PRÉPARER UN TOUR N'EST PAS UN TRAVAIL SANS FIN. Avant le moteur, le démon lit
 * le projet, choisit le compte, relève les quotas, cherche la mémoire et ouvre
 * la copie de travail — quelques secondes d'ordinaire, une minute au pire quand
 * un dossier de carte doit être réparé. Passé CINQ minutes, la préparation est
 * tenue pour perdue : mieux vaut un agent libéré, qui dit ce qui s'est passé,
 * qu'un agent bloqué jusqu'au prochain redémarrage.
 */
export const PLAFOND_PREPARATION_MS = 5 * 60_000;

/**
 * UN MOTEUR QUI SE TAIT TROP LONGTEMPS. Filet de dernier recours, jamais une
 * règle de travail : un agent qui construit, teste ou lance une longue commande
 * reste muet quelques minutes, et une question posée à l'utilisateur suspend
 * légitimement le tour jusqu'à trente minutes. L'heure entière laisse tout cela
 * passer largement — et un tour qui ATTEND UNE RÉPONSE n'est de toute façon
 * jamais jugé silencieux.
 */
export const PLAFOND_SILENCE_MOTEUR_MS = 60 * 60_000;

export type StatutDAgent = 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';

export interface EtatDuTour {
  statut: StatutDAgent;
  /** Le démon attend-il encore ce tour (il figure dans ses tours vivants) ? */
  suivi: boolean;
  /**
   * Le tour est SUIVI, mais son moteur n'a pas encore été lancé : le démon est
   * encore en train de préparer ce qu'il va lui envoyer.
   */
  enPreparation?: boolean;
  /**
   * Le processus du moteur répond-il encore ? `undefined` quand la question ne
   * se pose pas : aucun numéro de processus connu, donc rien à constater.
   */
  processusVivant?: boolean;
  /**
   * Depuis combien de temps la réponse est-elle figée ? `undefined` tant que
   * l'agent écrit encore — un tour long n'est pas un tour bloqué.
   */
  reponseFigeeDepuisMs?: number;
  /** Depuis combien de temps ce tour est-il parti ? */
  partiDepuisMs: number;
  /**
   * Depuis combien de temps le moteur n'a-t-il plus donné le moindre signe de
   * vie (aucun événement reçu) ? `undefined` quand la question ne se pose pas :
   * aucun moteur lancé, ou aucun repère connu.
   */
  silenceDepuisMs?: number;
  /**
   * Ce tour est-il arrêté sur une question posée à l'utilisateur ? Un tour qui
   * attend une réponse se tait pour une bonne raison : on ne le juge jamais.
   */
  attendUneReponse?: boolean;
  /**
   * UNE REPRISE APRÈS PANNE PASSAGÈRE EST-ELLE EN ATTENTE ? Entre la panne du
   * fournisseur et le nouvel essai, le processus du moteur est mort pour une
   * raison connue, et le démon a déjà décidé de le relancer. Ce n'est pas un
   * tour abandonné : c'est un tour qui compte les secondes. Le démon pose ce
   * drapeau depuis une ÉCHÉANCE bornée (l'attente prévue plus une marge de
   * démarrage), jamais depuis un simple « oui » : une reprise qui ne viendrait
   * jamais retomberait sinon dans le trou qu'on vient de boucher.
   */
  repriseApresPanneEnCours?: boolean;
  /**
   * UN MOTEUR DE SERVICE DE CET AGENT TOURNE-T-IL ENCORE ? Le rattrapage du
   * plan, de la compréhension ou du compte rendu lance un SECOND processus :
   * celui du tour est fini, normalement, et c'est le second qui travaille — et
   * qui écrit par les outils du même tour. Chaque service est borné par son
   * propre plafond : l'exclusion ne peut pas murer l'agent.
   */
  serviceEnCours?: boolean;
}

export interface TourBloque {
  raison: string;
}

/**
 * Ce tour est-il resté « au travail » sans que personne ne l'attende plus ?
 *
 * Trois constats, chacun suffisant. Aucun ne juge la DURÉE d'un tour en cours :
 * un agent qui réfléchit une heure travaille, il ne se bloque pas.
 */
export function tourBloque(etat: EtatDuTour): TourBloque | null {
  /*
   * QUI A LE DROIT D'ÊTRE JUGÉ. Un agent au repos qui n'intéresse plus personne
   * ne se referme pas : il n'y a rien à refermer. Mais un agent que le démon
   * SUIT ENCORE alors que sa réponse est déjà figée est dans la fenêtre du
   * rangement d'après-réponse — statut déjà retombé, tour bel et bien vivant —
   * et c'est exactement là que le constat 3 doit pouvoir mordre.
   */
  const auTravail = etat.statut === 'running' || etat.statut === 'starting';
  const rangementApresReponse = etat.suivi && etat.reponseFigeeDepuisMs !== undefined;
  if (!auTravail && !rangementApresReponse) return null;

  // 1. Le démon ne suit plus ce tour : une panne interne a mangé sa fermeture,
  //    ou le tour appartient à un démon qui n'existe plus. Personne ne le
  //    refermera jamais.
  if (!etat.suivi) {
    return { raison: "Ce tour n'était plus suivi par le serveur : il a été refermé pour libérer l'agent." };
  }

  // 1 bis. LA PRÉPARATION NE FINIT JAMAIS. Le tour est bien suivi — c'est le
  //    démon lui-même qui prépare —, mais aucun moteur n'a été lancé : ni le
  //    constat 1 (il est suivi), ni le 2 (aucun processus), ni le 3 (aucune
  //    réponse) ne peuvent le voir. Sans ce plafond, un appel pendu dans la
  //    préparation gelait l'agent jusqu'au prochain redémarrage du serveur.
  if (etat.enPreparation && etat.partiDepuisMs > PLAFOND_PREPARATION_MS) {
    return {
      raison:
        "La préparation de ce tour est restée bloquée avant même le lancement du moteur : il a été refermé pour libérer l'agent.",
    };
  }

  // 2. Le moteur a disparu sans rendre la main, ALORS QUE LA RÉPONSE S'ÉCRIT
  //    ENCORE. Une réponse déjà figée, elle, relève du cas 3 : le processus du
  //    tour est normalement fini à ce moment-là, c'est le travail d'après qui
  //    court.
  //    ET LA REPRISE APRÈS PANNE PASSAGÈRE EN EST EXPRESSÉMENT EXCLUE : là, le
  //    moteur est mort parce que le fournisseur a lâché, et le démon a déjà
  //    programmé son nouvel essai sur le même fil. Le refermer ici, c'est tuer
  //    le travail au milieu — le fournisseur n'aura même pas eu le temps de se
  //    remettre.
  if (
    etat.reponseFigeeDepuisMs === undefined &&
    etat.processusVivant === false &&
    !etat.repriseApresPanneEnCours &&
    !etat.serviceEnCours &&
    etat.partiDepuisMs > DELAI_AVANT_PROCESSUS_DISPARU_MS
  ) {
    return { raison: "Le moteur s'est arrêté sans rendre la main : le tour a été refermé." };
  }

  // 3. La réponse est rendue depuis trop longtemps et le tour ne s'est toujours
  //    pas refermé.
  if (etat.reponseFigeeDepuisMs !== undefined && etat.reponseFigeeDepuisMs > PLAFOND_FERMETURE_MS) {
    return {
      raison: `La réponse était rendue depuis ${Math.round(
        etat.reponseFigeeDepuisMs / 60_000,
      )} minutes sans que le tour se referme : il a été refermé.`,
    };
  }

  // 4. Le moteur tourne toujours mais ne dit plus rien depuis très longtemps.
  //    Le filet de dernier recours : un tour arrêté sur une question de
  //    l'utilisateur en est expressément exclu, il se tait pour une raison.
  if (
    !etat.attendUneReponse &&
    etat.silenceDepuisMs !== undefined &&
    etat.silenceDepuisMs > PLAFOND_SILENCE_MOTEUR_MS
  ) {
    return {
      raison: `Le moteur n'a plus donné signe de vie depuis ${Math.round(
        etat.silenceDepuisMs / 60_000,
      )} minutes : le tour a été refermé pour libérer l'agent.`,
    };
  }

  return null;
}

/**
 * Dans quel état laisser un agent qu'on referme d'autorité ? Une réponse
 * rendue, c'est un tour FINI, même si sa fermeture a mal tourné : le marquer en
 * échec afficherait un voyant rouge sur un travail livré. Rien de rendu, en
 * revanche, est bien un échec — et la carte doit pouvoir repartir.
 */
export function statutDeFermetureForcee(input: { reponseRendue: boolean }): 'done' | 'failed' {
  return input.reponseRendue ? 'done' : 'failed';
}
