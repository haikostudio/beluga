import {
  CARTE_INCHANGEE,
  DELAI_AVANT_REPRISE_APRES_PANNE_MS,
  RAISON_MOTEUR_INJOIGNABLE,
  RAISON_PANNE_MOTEUR,
  ROLES_QUI_DEPLACENT,
  colonneApresArretALaMain,
  colonneApresMoteurMuet,
  colonneApresPanneDuMoteur,
  dateDeMiseEnLignePerimee,
  decisionsParCarte,
  issueDeCarteOubliee,
  issueDeFinDeTour,
  traceAcquise,
  tourDeLaCarte,
  type Agent,
  type AgentRole,
  type Card,
  type ColumnKey,
  type DecisionAttendue,
  type TraceDuTravail,
} from '@haikodev/shared';
import { bus } from './bus.js';
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
  return store.saveCard({
    ...card,
    column: target,
    position: position ?? store.nextPosition(card.projectId, target),
    doneAt: target === 'done' ? Date.now() : card.doneAt,
    deployedAt: dateDeMiseEnLignePerimee(card.column, target) ? undefined : card.deployedAt,
    /*
     * RANGER À LA MAIN DÉSARME LA REPRISE. Une carte dont le lancement avait
     * été refusé faute de quota attend que l'ordonnanceur le rejoue ; la
     * déplacer ensuite, c'est décider autre chose pour elle. Sans cette ligne,
     * la carte serait repartie toute seule depuis sa nouvelle colonne.
     */
    scheduling: card.scheduling?.reprendreDesQuePossible
      ? { ...card.scheduling, reprendreDesQuePossible: undefined }
      : card.scheduling,
  });
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
  const issue = leSien
    ? issueDeFinDeTour(card.column, fin.reussi, fin.role, fin.trace, dejaEnregistreApres(card, fin))
    : CARTE_INCHANGEE;

  // Le moteur muet passe devant : ce n'est pas une issue du travail, c'est un
  // lancement manqué. La panne du fournisseur suit la même route.
  const cible = relanceMoteurMuet ?? relancePanne ?? issue.colonne;
  const raison = relanceMoteurMuet || relancePanne ? null : issue.raison;

  const planification =
    leSien || relanceMoteurMuet
      ? {
          ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
          ...(leSien ? { tourEnVolDepuis: undefined } : {}),
          ...(relanceMoteurMuet
            ? {
                restarts: (card.scheduling?.restarts ?? 0) + 1,
                waitingReason: RAISON_MOTEUR_INJOIGNABLE,
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
           * Une carte qui se FERME ne garde pas l'attente d'un tour précédent :
           * la retenue posée avant ce changement de règle (« rien n'a changé,
           * la carte attend un geste ») afficherait encore son horloge jaune au
           * pied d'une carte pourtant terminée.
           */
          ...(cible === 'done' ? { suspendu: false, waitingReason: undefined } : {}),
        }
      : card.scheduling;

  return {
    ...card,
    ...(cible
      ? {
          column: cible,
          position: store.nextPosition(card.projectId, cible),
          ...(cible === 'done' ? { doneAt: Date.now() } : {}),
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
  const agents = store.listAgents();
  const decisions = store.decisionsEnAttente();
  for (const card of store.cartesEnCours()) {
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
        dernierTourEnEchec: dernierTourEnEchec(card, agents),
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
      ...(issue.colonne === 'done' ? { doneAt: card.doneAt ?? Date.now() } : {}),
      scheduling: {
        ...scheduling,
        // Une marque de vol trop vieille pour être crue (§ `issueDeCarteOubliee`)
        // n'a plus lieu d'être une fois la carte rangée : sinon la prochaine
        // relecture continuerait de raconter un tour toujours en vol.
        tourEnVolDepuis: undefined,
        // Même règle que `carteApresFinDeTour` : une carte qui se ferme ne
        // garde pas l'attente d'un tour précédent.
        ...(issue.colonne === 'done' ? { suspendu: false, waitingReason: undefined } : {}),
      },
      sansModification: issue.raison ?? undefined,
    });
    bus.emit({ type: 'card.upsert', card: rangee });
    log.info(`carte « ${card.title} » oubliée en « En cours », rangée dans « ${issue.colonne} »`);
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
