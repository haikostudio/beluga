import {
  CARTE_INCHANGEE,
  DELAI_AVANT_REPRISE_APRES_PANNE_MS,
  RAISON_MACHINE_SATUREE,
  RAISON_MOTEUR_INJOIGNABLE,
  RAISON_PANNE_MOTEUR,
  RAISON_PONT_EPUISE,
  RAISON_PONT_MORT,
  ROLES_QUI_DEPLACENT,
  colonneApresArretALaMain,
  colonneApresMoteurMuet,
  colonneApresPanneDuMoteur,
  colonneApresPontMort,
  colonneEnFinDeTour,
  COLONNES_AVANT_LE_TRAVAIL,
  COLONNES_DE_CLOTURE,
  COLUMN_LABELS,
  dateDeMiseEnLignePerimee,
  decisionsParCarte,
  etapeDeCarteAbandonnee,
  INCIDENT_PLAN_NON_RENDU,
  fermetureDesQuestions,
  issueDeCarteOubliee,
  issueDeFinDeTour,
  issueDuPontMort,
  metriquesSessionLlmIndisponibles,
  retenueApresPontEpuise,
  traceAcquise,
  tourDeLaCarte,
  type Agent,
  type AgentRole,
  type Card,
  type ColumnKey,
  type DecisionAttendue,
  type TraceDuTravail,
} from '@beluga/shared';
import { bus } from './bus.js';
import { fermerLesQuestionsSiCarteRangee } from './fermeture-questions.js';
import { lancementEnRoute } from './lancements-en-route.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * RANGER une carte dans une autre colonne — le simple déplacement, une fois
 * que tous les refus ont été levés (`canMove`, `sortieAutorisee`,
 * `repriseAutorisee`) et que le dépôt ne vaut ni un lancement ni une
 * suspension (`effetDuDepot`).
 *
 * Le geste tient en une ligne, sauf pour deux dates qui se posent ou se
 * retirent AVEC la colonne, et qu'on ne veut écrire qu'à un seul endroit :
 *
 *  - `doneAt` : la carte arrive dans « Terminé » ;
 *  - `deployedAt` : la carte ENTRE dans « À déployer », donc elle attend un
 *    NOUVEAU déploiement. Sa date de mise en ligne d'avant est périmée
 *    (`dateDeMiseEnLignePerimee`). Sans cela, le lot l'écartait à jamais
 *    (`deployableCards`), le bouton annonçait « (0) », s'éteignait, et le clic
 *    ne partait nulle part — le bogue du « Tout déployer » muet. Une carte qui
 *    QUITTE « À déployer », elle, garde sa date : c'est la trace de sa mise en
 *    ligne.
 *
 * Cette fonction n'émet rien et ne refuse rien : elle écrit. L'appelant
 * diffuse la carte et dit ce qu'il a à dire.
 */
export function rangerLaCarte(card: Card, target: ColumnKey, position?: number): Card {
  /*
   * UNE CARTE QUI QUITTE LE TRAVAIL FERME SES QUESTIONS. Archivée, poussée dans
   * « À déployer » ou passée « En production », elle n'a plus rien à faire
   * trancher : la question qui restait ouverte annonçait « Répondre » sur un
   * travail rangé depuis longtemps, et son tour n'existait même plus. Le geste
   * vit dans `fermeture-questions.ts` et ne refuse jamais un déplacement.
   */
  const aFermer = fermetureDesQuestions(card.column, target);

  const rangee = store.saveCard({
    ...card,
    column: target,
    position: position ?? store.nextPosition(card.projectId, target),
    doneAt: COLONNES_DE_CLOTURE.includes(target) ? Date.now() : card.doneAt,
    deployedAt: dateDeMiseEnLignePerimee(card.column, target) ? undefined : card.deployedAt,
    // Toute carte qui entre dans le lot porte une photographie explicite. Une
    // carte ancienne sans relevé ne reçoit jamais quatre faux zéros.
    llmSessionMetrics:
      COLONNES_DE_CLOTURE.includes(target) && !card.llmSessionMetrics
        ? metriquesSessionLlmIndisponibles('unavailable')
        : card.llmSessionMetrics,
    /*
     * RANGER À LA MAIN DÉSARME LA REPRISE. Une carte dont le lancement avait
     * été refusé faute de quota attend que l'ordonnanceur le rejoue ; la
     * déplacer ensuite, c'est décider autre chose pour elle. Sans cette ligne,
     * la carte serait repartie toute seule depuis sa nouvelle colonne.
     */
    scheduling: card.scheduling?.reprendreDesQuePossible
      ? { ...card.scheduling, reprendreDesQuePossible: undefined }
      : card.scheduling,
    /* Ranger à la main une carte relancée HORS du cadrage (« Rapport »,
       « À déployer », « Archivé ») referme cette relance : ressortie un jour,
       elle n'y retombe pas. Entre « Demande » et « Plan », elle se cadre
       encore : la relance tient. */
    parcours:
      card.parcours?.cadrageRouvertA && target !== card.column && !COLONNES_AVANT_LE_TRAVAIL.includes(target)
        ? { ...card.parcours, cadrageRouvertA: undefined }
        : card.parcours,
  });

  /*
   * APRÈS l'écriture, jamais avant. Fermer les questions diffuse le nouveau
   * compte de décisions, et ce compte se calcule EN RELISANT la colonne de la
   * carte : lancé avant l'écriture, il relisait l'ancienne colonne et pouvait
   * rediffuser la décision qu'il venait d'éteindre. C'est le même ordre qui
   * fait disparaître « Répondre / Annuler » sur un écran resté ouvert, sans
   * rechargement à la main.
   */
  if (aFermer) fermerLesQuestionsSiCarteRangee(card.id, target);

  return rangee;
}

/** Ce que le tour qui s'achève a constaté, et qui décide du sort de la carte. */
export interface FinDeTour {
  /** L'agent dont le tour se termine. */
  agentId: string;
  role: AgentRole;
  /** Le tour a-t-il abouti ? Un échec ne range rien. */
  reussi: boolean;
  /** Le constat du dépôt : a-t-il bougé, non, ou n'a-t-il pas pu être lu ? */
  trace: TraceDuTravail;
  /** Le moteur n'a jamais parlé : le lancement n'a pas pu le joindre. */
  moteurMuet: boolean;
  /**
   * Une panne du FOURNISSEUR a résisté à tous les essais du tour. Le moteur
   * avait parlé — ce n'est donc pas un lancement manqué —, mais ce n'est pas
   * non plus un échec de la tâche : le travail a été INTERROMPU.
   */
  panneDuMoteur?: boolean;
  /**
   * LE PONT D'OUTILS N'A JAMAIS DÉMARRÉ, ET LE TOUR N'A RIEN RENDU. L'agent a
   * travaillé sans mémoire du projet, sans écriture de mémoire et sans le
   * moindre geste de tableau : il ne pouvait même pas ranger sa propre carte.
   * Ce n'est pas un échec de la tâche, c'est un tour privé de ses moyens
   * (`colonneApresPontMort`).
   */
  pontMort?: boolean;
  /**
   * LES REJEUX SILENCIEUX SONT ÉPUISÉS. Le pont a manqué trois tours de suite :
   * on ne rejoue plus, on DEMANDE. La carte reste où elle est — la refermer
   * ferait passer trois tours à l'aveugle pour un travail livré — et le message
   * porte la décision « Relancer / Ignorer / Arrêter » (`runtime.ts`).
   */
  pontEpuise?: boolean;
  /**
   * LE SERVEUR LUI-MÊME N'AVAIT PLUS DE PLACE : plus assez de mémoire ou de
   * processus pour lancer quoi que ce soit. La carte repart en file comme après
   * une panne, mais sa phrase ne parle ni du moteur ni du fournisseur — c'est la
   * charge d'à côté qui doit retomber (`RAISON_MACHINE_SATUREE`).
   */
  machineSaturee?: boolean;
}

/**
 * LA CARTE À LA FIN D'UN TOUR — la carte telle qu'elle doit être enregistrée,
 * sans l'être encore : l'appelant y ajoute ce qu'il sait de son côté (la mesure
 * du tour) et enregistre une seule fois.
 *
 * Tout tient en quatre questions, dans cet ordre :
 *
 *  1. CE TOUR EST-IL ENCORE CELUI DE LA CARTE ? Un tour arrêté rend la main à
 *     son rythme, et un nouvel agent a pu reprendre la carte entre-temps. Un
 *     tour étranger ne range rien et n'efface aucune phrase : il ne lui
 *     appartient plus rien.
 *  2. LE MOTEUR A-T-IL SEULEMENT PARLÉ ? Muet, c'est le LANCEMENT qui a échoué,
 *     pas la tâche : retour en « Planifié », essai recompté, reprise
 *     automatique.
 *  3. QUELLE EST L'ISSUE DU TOUR ? `issueDeFinDeTour` la dit en un mot : un
 *     rapport rendu FERME la carte, et le constat du dépôt décide seulement de
 *     la phrase écrite dessus. Rien ne reste en « En cours » sans agent au
 *     travail, et plus aucune carte n'est RETENUE en file par une fin de tour.
 *
 * La MARQUE DE VOL (`tourEnVolDepuis`) s'éteint ici, et nulle part avant : ce
 * tour a fini de tout ranger. Coupé plus tôt, le démon retrouve la marque au
 * démarrage et rend la carte comme interrompue.
 */
export function carteApresFinDeTour(card: Card, fin: FinDeTour): Card {
  const leSien = tourDeLaCarte(card, fin.agentId);

  const relanceMoteurMuet = leSien ? colonneApresMoteurMuet(card.column, fin.role, fin.moteurMuet) : null;
  /*
   * LA PANNE DU FOURNISSEUR RENVOIE AUSSI LA CARTE EN FILE. Le moteur muet
   * passe devant (le lancement n'a jamais eu lieu, il n'y a rien à reprendre) ;
   * une panne qui a résisté à tous les essais vient juste après, avec sa propre
   * phrase et son délai d'attente (`colonneApresPanneDuMoteur`).
   */
  const relancePanne =
    leSien && !relanceMoteurMuet
      ? colonneApresPanneDuMoteur(card.column, fin.role, !!fin.panneDuMoteur)
      : null;
  /*
   * LE TOUR N'A JAMAIS EU SES OUTILS. Vient en dernier des trois : un moteur
   * jamais joint et une panne du fournisseur disent tous deux quelque chose de
   * plus précis sur la cause. Mais quand le moteur a bien tourné et que seul le
   * pont est mort-né, rien ne voyait plus rien — la carte restait figée en
   * « En cours », sans agent, jusqu'à une reprise à la main.
   */
  const relancePontMort =
    leSien && !relanceMoteurMuet && !relancePanne
      ? colonneApresPontMort(card.column, fin.role, !!fin.pontMort)
      : null;
  /*
   * TROIS TOURS DE SUITE SANS OUTILS : ON NE REJOUE PLUS. La carte ne bouge pas
   * — ni fermée, ni renvoyée en file — et sa décision l'attend sur le message.
   */
  const retenuePontEpuise =
    leSien && !relanceMoteurMuet && !relancePanne && !relancePontMort
      ? retenueApresPontEpuise(card.column, fin.role, !!fin.pontEpuise)
      : false;
  /*
   * L'ESSAI EN COURS, ET SON DÉLAI. Le compteur est CONSÉCUTIF : un tour qui a
   * obtenu ses outils le remet à zéro (plus bas), sans quoi une carte ancienne
   * poserait sa décision au premier incident.
   */
  const essaiDuPont = relancePontMort ? issueDuPontMort(card.scheduling?.essaisSansOutils ?? 0) : null;
  /*
   * UNE QUESTION SANS RÉPONSE RETIENT LA CARTE EN « EN COURS ». On ne pose la
   * question au registre que si le tour allait vraiment fermer la carte : la
   * lecture parcourt les messages du projet, inutile de la payer sur un tour en
   * échec, un rôle qui ne déplace rien ou une carte déjà rangée.
   */
  const irait =
    leSien &&
    !relanceMoteurMuet &&
    !relancePanne &&
    !relancePontMort &&
    !retenuePontEpuise &&
    !!colonneEnFinDeTour(card.column, fin.reussi, fin.role);
  const questionOuverte = irait && store.questionOuverteSurLaCarte(card.id);

  const issue = leSien
    ? issueDeFinDeTour(card.column, fin.reussi, fin.role, fin.trace, dejaEnregistreApres(card, fin), questionOuverte)
    : CARTE_INCHANGEE;

  // Le moteur muet passe devant : ce n'est pas une issue du travail, c'est un
  // lancement manqué. La panne du fournisseur et le pont mort-né suivent la
  // même route : aucune n'est un jugement sur le travail.
  const cible = retenuePontEpuise ? null : (relanceMoteurMuet ?? relancePanne ?? relancePontMort ?? issue.colonne);
  const raison = retenuePontEpuise
    ? RAISON_PONT_EPUISE
    : relanceMoteurMuet || relancePanne || relancePontMort
      ? null
      : issue.raison;
  const renvoyeeEnFile = relanceMoteurMuet ?? relancePanne ?? relancePontMort;
  /*
   * POURQUOI CETTE CARTE REPART EN FILE — écrit au journal, parce que les trois
   * routes se ressemblent à l'écran (« Planifié », une phrase, une reprise) et
   * qu'on ne pouvait pas les distinguer après coup en relisant le serveur.
   */
  if (renvoyeeEnFile) {
    log.info(
      `carte ${card.id} renvoyée en « Planifié » — moteur muet=${!!relanceMoteurMuet}, ` +
        `panne du fournisseur=${!!relancePanne}, sans outils=${!!relancePontMort}` +
        `${essaiDuPont?.rejouer ? ` (essai ${essaiDuPont.essai})` : ''}, ` +
        `serveur saturé=${!!fin.machineSaturee}`,
    );
  }

  const planification =
    leSien || relanceMoteurMuet
      ? {
          ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
          ...(leSien ? { tourEnVolDepuis: undefined } : {}),
          ...(relanceMoteurMuet
            ? {
                restarts: (card.scheduling?.restarts ?? 0) + 1,
                waitingReason: RAISON_MOTEUR_INJOIGNABLE,
                /*
                 * SA PHRASE PROMET UNE NOUVELLE TENTATIVE AUTOMATIQUE : elle ne
                 * peut donc pas traîner la DATE D'ATTENTE d'une interruption
                 * précédente. Une carte renvoyée en file avec cinq minutes de
                 * délai, relancée aussitôt à la main, puis retombée sur un
                 * moteur injoignable gardait cette vieille échéance et restait
                 * en « Planifié » sans repartir — la promesse écrite dessus
                 * n'était pas tenue.
                 */
                departPrevu: undefined,
              }
            : {}),
          /*
           * `restarts` monte — c'est lui qui autorise la reprise automatique —
           * mais `attempts` reste INTACT : une panne du fournisseur n'est pas un
           * essai raté. La DATE de départ, elle, retient la carte le temps que
           * la panne passe, au lieu de la faire repartir dans la boucle
           * suivante, quinze secondes plus tard.
           */
          ...(relancePanne
            ? {
                restarts: (card.scheduling?.restarts ?? 0) + 1,
                waitingReason: RAISON_PANNE_MOTEUR,
                departPrevu: Date.now() + DELAI_AVANT_REPRISE_APRES_PANNE_MS,
                suspendu: false,
              }
            : {}),
          /*
           * LE PONT MORT-NÉ REPART AVEC LE MÊME DÉLAI. Sa cause la plus
           * fréquente est une machine qui ne peut plus lancer de processus :
           * repartir dans les quinze secondes relancerait dans le mur, et la
           * carte tournerait en rond en brûlant du quota à chaque passage.
           */
          ...(relancePontMort && essaiDuPont?.rejouer
            ? {
                restarts: (card.scheduling?.restarts ?? 0) + 1,
                waitingReason: RAISON_PONT_MORT,
                /* LE DÉLAI CROÎT D'UN ESSAI À L'AUTRE : une saturation d'une
                   seconde est déjà passée au premier rejeu, une machine
                   durablement pleine a besoin de bien plus. */
                departPrevu: Date.now() + essaiDuPont.delaiMs,
                essaisSansOutils: essaiDuPont.essai,
                suspendu: false,
              }
            : {}),
          /* LA DÉCISION EST POSÉE : le compteur RESTE au plafond. Le remettre à
             zéro ici rendrait trois rejeux muets à chaque relance à la main. */
          ...(retenuePontEpuise ? { essaisSansOutils: (card.scheduling?.essaisSansOutils ?? 0) + 1 } : {}),
          /* UN TOUR QUI A EU SES OUTILS EFFACE L'ARDOISE : le compteur ne
             mesure que des échecs CONSÉCUTIFS. */
          ...(!relancePontMort && !retenuePontEpuise && !fin.pontMort && !fin.pontEpuise
            ? { essaisSansOutils: undefined }
            : {}),
          /*
           * LA SATURATION DU SERVEUR DIT LA VRAIE CAUSE, PAR-DESSUS LES AUTRES.
           * Un moteur qui n'a pas démarré, un pont mort-né, un tour tombé : sur
           * une machine pleine, ce sont trois symptômes d'un seul fait. La
           * phrase le dit, et la carte attend au lieu de repartir aussitôt.
           */
          ...(renvoyeeEnFile && fin.machineSaturee
            ? {
                waitingReason: RAISON_MACHINE_SATUREE,
                departPrevu: Date.now() + DELAI_AVANT_REPRISE_APRES_PANNE_MS,
                suspendu: false,
              }
            : {}),
          /*
           * Une carte qui se FERME ne garde pas l'attente d'un tour précédent :
           * la retenue posée avant ce changement de règle (« rien n'a changé,
           * la carte attend un geste ») afficherait encore son horloge jaune au
           * pied d'une carte pourtant terminée.
           */
          ...(cible && COLONNES_DE_CLOTURE.includes(cible) ? { suspendu: false, waitingReason: undefined } : {}),
        }
      : card.scheduling;

  return {
    ...card,
    ...(cible
      ? {
          column: cible,
          position: store.nextPosition(card.projectId, cible),
          ...(COLONNES_DE_CLOTURE.includes(cible) ? { doneAt: Date.now() } : {}),
          deployedAt: dateDeMiseEnLignePerimee(card.column, cible) ? undefined : card.deployedAt,
        }
      : {}),
    scheduling: planification,
    codeDejaEnregistre: dejaEnregistreApres(card, fin),
    // La phrase du tour n'appartient qu'à l'agent de la carte : un tour étranger
    // la laisse telle quelle plutôt que de l'effacer. Plus aucune issue de fin
    // de tour ne RETIENT la carte, donc plus aucune phrase ne part dans
    // `waitingReason` : elles s'écrivent toutes ici, sur la carte close.
    ...(leSien ? { sansModification: raison ?? undefined } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Le filet : les cartes OUBLIÉES en « En cours »                       */
/* ------------------------------------------------------------------ */

/** Les statuts d'agent qui disent « un tour travaille en ce moment ». */
const STATUTS_AU_TRAVAIL = ['running', 'starting'];

/** Les statuts d'agent qui disent « ce tour s'est mal fini » — on ne range rien. */
const STATUTS_EN_ECHEC = ['failed', 'stopped'];

/**
 * LE BALAYAGE DES CARTES OUBLIÉES, passé à chaque tour de l'ordonnanceur.
 *
 * `carteApresFinDeTour` donne une issue à tout tour qui SE TERMINE — mais elle
 * ne peut rien pour les cartes bloquées AVANT elle, dont le tour est fini
 * depuis longtemps : plus aucune fin de tour ne viendra les ranger. Ce sont
 * précisément celles que l'utilisateur voit encore comptées dans « EN COURS ».
 * Le balayage les retrouve et leur applique la même règle
 * (`issueDeCarteOubliee`).
 *
 * Il est joué dans la boucle de quinze secondes, donc AUSSI au démarrage du
 * démon, juste après la reprise des tours coupés en vol : les deux filets se
 * complètent sans se marcher dessus — la reprise voit les cartes qui portent
 * encore leur marque, le balayage celles qui ne portent plus rien.
 *
 * Il ne touche jamais une carte qu'un tour tient encore, qu'un agent travaille,
 * ou dont le dernier tour a échoué : ces trois refus vivent dans la règle pure.
 */
export function rangerLesCartesOubliees(): void {
  const cartes = store.cartesEnCours();
  if (!cartes.length) return;
  const cardIds = cartes.map((c) => c.id);
  const agentIds = cartes.map((c) => c.agentId).filter((id): id is string => !!id);
  const agents = store.agentsDesCartesEnCours(cardIds, agentIds);
  const decisions = store.decisionsEnAttente();
  for (const card of cartes) {
    /* UNE CARTE MÈRE n'a jamais d'agent : ce sont ses filles qui travaillent,
       et c'est leur suivi qui la range (`suivreLaMere`). */
    if (card.cartesFilles?.length) continue;
    const issue = issueDeCarteOubliee(
      {
        colonne: card.column,
        tourEnVolDepuis: card.scheduling?.tourEnVolDepuis,
        agentAuTravail: agents.some((a) => a.cardId === card.id && STATUTS_AU_TRAVAIL.includes(a.status)),
        /*
         * LE STATUT N'EST PAS LE SEUL TÉMOIN DE TRAVAIL. Il retombe à
         * « terminé » dès la réponse figée, alors que le tour continue de
         * ranger pendant des minutes (compression, constat du dépôt, fusion de
         * la branche, fermeture du dossier de carte). `tourVivantDepuis`, lui,
         * ne s'éteint qu'à la toute dernière ligne du tour.
         */
        tourEncoreVivant: agents.some((a) => a.cardId === card.id && a.tourVivantDepuis !== undefined),
        /*
         * LE LANCEMENT QUI SE PRÉPARE ENCORE. La carte passe en « En cours » au
         * CLIC, avant l'ouverture de sa copie de travail : pendant cette
         * fenêtre — plusieurs minutes sur un gros dépôt — aucun agent n'existe
         * et aucune marque de vol n'est encore posée. Sans ce refus, le
         * balayage fermait la carte à la seconde de son lancement.
         */
        lancementEnPreparation: lancementEnRoute(card.id),
        /*
         * ET LA DEMANDE QUI ATTEND SON TOUR. Sans quota, la demande entre en
         * file sans déplacer sa carte : l'agent reste au repos, sans tour
         * vivant, et tous les autres témoins diraient « plus rien ne
         * travaille » sur un travail jamais commencé.
         */
        demandeEnFile: agents.some((a) => a.cardId === card.id && store.listQueue(a.id).length > 0),
        dernierTourEnEchec: dernierTourEnEchec(card, agents),
        /*
         * ET LA MARQUE DE SUSPENSION SUR UNE CARTE EN TRAVAIL. Les deux
         * ensemble sont contradictoires : le geste qui suspend range la carte en
         * « Planifié » du même mouvement. La contradiction se répare ici, sans
         * quoi la carte reste en « En cours » à jamais (§ `issueDeCarteOubliee`).
         */
        suspendue: card.scheduling?.suspendu === true,
        dejaEnregistre: !!card.codeDejaEnregistre,
        decisionOuverte: carteAttendUneDecision(card, agents, decisions),
      },
      Date.now(),
    );
    if (!issue.colonne) continue;

    const scheduling = card.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
    const rangee = store.saveCard({
      ...card,
      column: issue.colonne,
      position: store.nextPosition(card.projectId, issue.colonne),
      ...(COLONNES_DE_CLOTURE.includes(issue.colonne) ? { doneAt: card.doneAt ?? Date.now() } : {}),
      deployedAt: dateDeMiseEnLignePerimee(card.column, issue.colonne) ? undefined : card.deployedAt,
      scheduling: {
        ...scheduling,
        // Une marque de vol trop vieille pour être crue (§ `issueDeCarteOubliee`)
        // n'a plus lieu d'être une fois la carte rangée : sinon la prochaine
        // relecture continuerait de raconter un tour toujours en vol.
        tourEnVolDepuis: undefined,
        // Même règle que `carteApresFinDeTour` : une carte qui se ferme ne
        // garde pas l'attente d'un tour précédent.
        ...(COLONNES_DE_CLOTURE.includes(issue.colonne) ? { suspendu: false, waitingReason: undefined } : {}),
      },
      sansModification: issue.raison ?? undefined,
    });
    bus.emit({ type: 'card.upsert', card: rangee });
    log.info(
      `carte « ${card.title} » oubliée en « ${COLUMN_LABELS[card.column]} », rangée dans « ${COLUMN_LABELS[issue.colonne]} »`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Le filet : les ÉTAPES ouvertes par un tour MORT                      */
/* ------------------------------------------------------------------ */

/**
 * AUCUNE ÉTAPE NE RESTE ALLUMÉE PLUS LONGTEMPS QUE LE TOUR QUI L'A OUVERTE.
 *
 * `rangerLesCartesOubliees` s'occupe des CARTES coincées en « En cours ». Mais
 * une carte de cadrage, elle, ne quitte jamais « Planifié » : sa demande de
 * plan (`parcours.planDemandeA`) restait donc ouverte pour l'éternité si le
 * tour mourait sans fin de tour — démon redémarré, machine coupée, moteur tué.
 * L'écran affichait alors « génération du plan en cours » des heures durant, et
 * le bouton « Générer le plan » restait éteint : la carte était murée.
 *
 * Ce balayage-ci ferme ces étapes-là, et pose l'incident DÉJÀ dessiné (« Le
 * plan n'est pas venu », avec son bouton « Redemander le plan ») — le même que
 * la fin de tour poserait. Il passe dans la boucle de quinze secondes, donc
 * aussi au démarrage du démon, juste après la reprise des tours coupés en vol.
 */
export function refermerLesEtapesSansTour(): void {
  const agents = store.listAgents();
  const decisions = store.decisionsEnAttente();
  const parCarte = decisionsParCarte(decisions);
  for (const card of store.cartesAvecDemandeDePlan()) {
    const abandonnee = etapeDeCarteAbandonnee(
      {
        planDemandeA: card.parcours?.planDemandeA,
        agentAuTravail: agents.some((a) => a.cardId === card.id && STATUTS_AU_TRAVAIL.includes(a.status)),
        tourEncoreVivant: agents.some((a) => a.cardId === card.id && a.tourVivantDepuis !== undefined),
        demandeEnFile: agents.some((a) => a.cardId === card.id && store.listQueue(a.id).length > 0),
        lancementEnPreparation: lancementEnRoute(card.id),
        questionOuverte: (parCarte[card.id] ?? 0) > 0,
      },
      Date.now(),
    );
    if (!abandonnee) continue;
    const rangee = store.saveCard({
      ...card,
      parcours: {
        ...(card.parcours ?? { plans: [] }),
        planDemandeA: undefined,
        incident: { texte: INCIDENT_PLAN_NON_RENDU, at: Date.now() },
      },
    });
    bus.emit({ type: 'card.upsert', card: rangee });
    log.info(`carte « ${card.title} » : demande de plan ouverte sans tour vivant, refermée sur son incident`);
  }
}

/**
 * CETTE CARTE ATTEND-ELLE ENCORE UNE DÉCISION DE L'UTILISATEUR ?
 *
 * Deux signaux, aucun des deux propre à la seule colonne « En cours » : une
 * question posée sans réponse (`decisionsParCarte`, qui couvre aussi bien
 * l'outil `ask_user` que la reprise de compte ou la question écrite en texte
 * libre), et une liste de tâches refermée avec des étapes non faites
 * (`Agent.todos.unfinished`, posé à la clôture du tour et qui survit à
 * l'agent). Sert au balayage des cartes oubliées ET au déploiement
 * automatique : ni l'un ni l'autre ne doit ranger — ou déployer — une carte
 * qui attend encore l'utilisateur.
 */
export function carteAttendUneDecision(card: Card, agents: Agent[], decisions: DecisionAttendue[]): boolean {
  const parCarte = decisionsParCarte(decisions);
  if ((parCarte[card.id] ?? 0) > 0) return true;
  const agent = card.agentId ? agents.find((a) => a.id === card.agentId) : undefined;
  return !!agent?.todos?.unfinished && agent.todos.unfinished > 0;
}

/**
 * Le dernier tour de cette carte s'est-il mal fini ? On ne regarde QUE l'agent
 * que la carte reconnaît comme le sien (`card.agentId`) : un vieil agent en
 * échec, remplacé depuis par un tour qui a abouti, ne doit pas retenir la carte
 * pour toujours. Sans agent inscrit, il n'y a pas d'échec à respecter.
 */
function dernierTourEnEchec(card: Card, agents: Agent[]): boolean {
  if (!card.agentId) return false;
  const sien = agents.find((a) => a.id === card.agentId);
  return !!sien && STATUTS_EN_ECHEC.includes(sien.status);
}

/**
 * Cette carte a-t-elle DÉJÀ produit du code, ce tour-ci ou avant ? Le drapeau ne
 * s'efface plus une fois posé : c'est lui qui distingue « rien à changer, tout
 * était déjà là » de « répondre n'est pas travailler ».
 */
function dejaEnregistreApres(card: Card, fin: FinDeTour): boolean {
  const aProduit =
    tourDeLaCarte(card, fin.agentId) &&
    fin.reussi &&
    ROLES_QUI_DEPLACENT.includes(fin.role) &&
    traceAcquise(fin.trace);
  return card.codeDejaEnregistre || aProduit;
}

/**
 * SUSPENDRE UNE CARTE — le seul chemin, pour les trois gestes qui arrêtent.
 *
 * Trois boutons coupaient un agent, et chacun rangeait la carte à sa façon :
 * la sortie à la souris (« En cours » → « Planifié ») la ramenait bien en
 * file, tandis que le bouton d'arrêt d'une carte et « tout arrêter » la
 * laissaient dans « En cours », sans agent au travail et sans rien pour l'en
 * sortir — le balayage de l'ordonnanceur s'interdisant justement d'y toucher
 * après un tour arrêté (`issueDeCarteOubliee`). Le tableau annonçait un
 * travail en cours que plus personne ne faisait.
 *
 * Le rangement est donc écrit ICI, une fois : colonne rendue à « Planifié »
 * quand la carte venait de « En cours » (`colonneApresArretALaMain`), marque
 * de suspension posée, phrase du geste écrite, et la MARQUE DE VOL retirée —
 * sans quoi la carte se serait dite « en cours de rangement » pour un tour qui
 * ne rangera plus rien.
 *
 * La fonction écrit et diffuse ; elle ne coupe aucun moteur et n'affiche aucun
 * message : l'appelant sait quoi dire, et à qui.
 */
export function suspendreLaCarte(card: Card, raison: string): Card {
  const cible = colonneApresArretALaMain(card.column);
  const suspendue = store.saveCard({
    ...card,
    ...(cible ? { column: cible, position: store.nextPosition(card.projectId, cible) } : {}),
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      suspendu: true,
      waitingReason: raison,
      tourEnVolDepuis: undefined,
      // Le geste humain l'emporte sur une reprise promise : une carte qui
      // attendait le retour du quota n'y attend plus, on vient de l'arrêter.
      reprendreDesQuePossible: undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card: suspendue });
  return suspendue;
}
