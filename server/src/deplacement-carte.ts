import {
  CARTE_INCHANGEE,
  RAISON_MOTEUR_INJOIGNABLE,
  ROLES_QUI_DEPLACENT,
  colonneApresMoteurMuet,
  dateDeMiseEnLignePerimee,
  issueDeFinDeTour,
  traceAcquise,
  tourDeLaCarte,
  type AgentRole,
  type Card,
  type ColumnKey,
  type TraceDuTravail,
} from '@haikodev/shared';
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
 *  3. QUELLE EST L'ISSUE DU TOUR ? `issueDeFinDeTour` la dit en un mot : la
 *     carte se ferme, ou elle redescend en file avec sa raison. Rien ne reste
 *     en « En cours » sans agent au travail.
 *  4. LA CARTE DOIT-ELLE ÊTRE RETENUE ? Une carte renvoyée en file après un
 *     tour qui n'a rien changé ne repart pas toute seule — sinon elle
 *     recommencerait en boucle le même tour vide.
 *
 * La MARQUE DE VOL (`tourEnVolDepuis`) s'éteint ici, et nulle part avant : ce
 * tour a fini de tout ranger. Coupé plus tôt, le démon retrouve la marque au
 * démarrage et rend la carte comme interrompue.
 */
export function carteApresFinDeTour(card: Card, fin: FinDeTour): Card {
  const leSien = tourDeLaCarte(card, fin.agentId);

  const relanceMoteurMuet = leSien ? colonneApresMoteurMuet(card.column, fin.role, fin.moteurMuet) : null;
  const issue = leSien
    ? issueDeFinDeTour(card.column, fin.reussi, fin.role, fin.trace, dejaEnregistreApres(card, fin))
    : CARTE_INCHANGEE;

  // Le moteur muet passe devant : ce n'est pas une issue du travail, c'est un
  // lancement manqué.
  const cible = relanceMoteurMuet ?? issue.colonne;
  const raison = relanceMoteurMuet ? null : issue.raison;
  const retenue = !relanceMoteurMuet && issue.retenue;

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
          ...(retenue ? { suspendu: true, waitingReason: raison ?? undefined } : {}),
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
    // la laisse telle quelle plutôt que de l'effacer.
    ...(leSien ? { sansModification: raison ?? undefined } : {}),
  };
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
