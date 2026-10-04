/**
 * LA MISE EN PRODUCTION D'UN REGROUPEMENT — le groupe ne publie rien lui-même,
 * il DÉLÈGUE à ses projets membres.
 *
 * Un regroupement n'a ni dépôt ni processus de mise en production : son bandeau
 * du bas proposait donc d'« initier » une procédure qui n'a pas de sens pour
 * lui, alors que chacun de ses membres a la sienne. Le tiroir du groupe liste
 * ses membres, chacun avec son état et son bouton, plus un bouton qui les lance
 * TOUS EN MÊME TEMPS (sans enchaînement : l'échec de l'un n'arrête pas l'autre).
 *
 * Ici vivent les règles PURES de cet écran — ni base, ni dépôt, ni horloge :
 *  - quelle publication raconte la ligne d'un membre (`runDeProductionDuMembre`) ;
 *  - pourquoi le bouton d'un membre est éteint (`raisonMembrePasPret`) ;
 *  - ce que dit le bandeau FERMÉ du groupe (`resumeDeLaProductionDuGroupe`).
 */

import type { DeployRun } from './models.js';
import { productionEnRetard, type EtatProduction } from './etat-production.js';
import { raisonLotBloque } from './lot-a-deployer.js';
import { procedureEnPlace } from './procedure-publication.js';
import { raisonProductionDesactivee } from './publication-simple.js';
import { suiviDeLaPublication, type EtatDuSuivi } from './suivi-publication.js';

/** Ce qu'on dit d'un membre sans processus : le groupe n'en initie aucun. */
export const MEMBRE_SANS_PROCESSUS =
  'Ce projet n’a pas encore de processus de mise en production : configurez-le dans ses réglages.';

/**
 * L'interrupteur d'un membre est éteint. La phrase du bandeau d'un projet seul
 * renvoie « en haut du tiroir » : celui du groupe n'a pas d'interrupteur, elle
 * y enverrait chercher un bouton qui n'existe pas.
 */
export const MEMBRE_DESACTIVE =
  'La mise en production est désactivée pour ce projet : allumez son interrupteur dans ses réglages pour la permettre.';

/**
 * LA PUBLICATION QUE RACONTE LA LIGNE D'UN MEMBRE : sa dernière mise en
 * PRODUCTION, jamais un déploiement sur ce serveur.
 *
 * L'état du tableau ne garde que la DERNIÈRE publication d'un projet, toutes
 * étapes confondues, et seulement pour un projet déjà ouvert sur cet écran ou
 * dont une publication vient de bouger. On la croise donc avec la dernière mise
 * en production relue dans l'historique : la plus récente des deux l'emporte.
 */
export function runDeProductionDuMembre(
  direct: DeployRun | null | undefined,
  historique: DeployRun | null | undefined,
): DeployRun | null {
  const vivant = direct && direct.cible === 'production' ? direct : null;
  const relu = historique && historique.cible === 'production' ? historique : null;
  if (!vivant) return relu;
  if (!relu) return vivant;
  if (vivant.id === relu.id) return vivant;
  return vivant.startedAt >= relu.startedAt ? vivant : relu;
}

/** Ce que la règle lit d'un membre pour dire s'il peut partir. */
export interface MembreAProduire {
  projet: Parameters<typeof procedureEnPlace>[0] & { miseEnProductionActive?: boolean };
  /** Sa mise en production tourne déjà. */
  enCours?: boolean;
  /** Une AUTRE publication de ce projet tourne (un déploiement sur ce serveur). */
  autrePublication?: boolean;
  /** Les agents encore au travail dans son dossier (titres). */
  agentsOccupes?: readonly string[];
  /** Le refus du serveur, lu au contrôle d'avant-clic. */
  productionBloquee?: string | null;
  horsLigne?: boolean;
}

/**
 * POURQUOI LE BOUTON D'UN MEMBRE EST ÉTEINT — `null` quand il peut partir.
 *
 * Les mêmes refus que le serveur (`startDeploy`), dans le même ordre : pas de
 * processus, puis l'interrupteur éteint, puis ce qui retient un lot. Une mise
 * en production qui tourne déjà n'est pas une raison à écrire : la ligne montre
 * son avancement.
 */
export function raisonMembrePasPret(membre: MembreAProduire): string | null {
  if (!procedureEnPlace(membre.projet, 'production')) return MEMBRE_SANS_PROCESSUS;
  if (raisonProductionDesactivee(membre.projet)) return MEMBRE_DESACTIVE;
  if (membre.enCours) return null;
  return raisonLotBloque({
    verbe: 'mettre en production',
    sansLot: true,
    aPublier: 0,
    cartesDansLaColonne: 0,
    autrePublication: membre.autrePublication,
    agentsOccupes: [...(membre.agentsOccupes ?? [])],
    productionBloquee: membre.productionBloquee ?? undefined,
    horsLigne: membre.horsLigne,
  });
}

/** Ce membre peut-il partir maintenant ? Ni refus, ni mise en production déjà en route. */
export function membrePret(membre: MembreAProduire): boolean {
  return !membre.enCours && raisonMembrePasPret(membre) === null;
}

/** Ce que le bandeau fermé du groupe lit d'un membre. */
export interface MembreSuivi {
  /** Sa dernière mise en production (`runDeProductionDuMembre`). */
  run?: DeployRun | null;
  /** L'état de sa version en production. */
  etat?: EtatProduction | null;
}

/** Ce que dit le bandeau FERMÉ d'un regroupement. */
export interface ResumeDuGroupe {
  /** Ce que lit `data-suivi` : la pire nouvelle l'emporte sur le repos. */
  suivi: EtatDuSuivi | 'repos';
  /** Au moins une mise en production d'un membre tourne. */
  enRoute: boolean;
  /** La dernière mise en production d'un membre est tombée ou a été arrêtée. */
  tombee: boolean;
  /**
   * La MOYENNE des mises en production en route ; à défaut, celle des mises en
   * production tombées, figée là où elles se sont arrêtées. `null` au repos.
   */
  pourcent: number | null;
  /** La SOMME des versions en attente des membres ; `null` si aucun chiffre n'est fiable. */
  enAttente: { nombre: number; enRetard: boolean } | null;
}

/**
 * LE RÉSUMÉ DU GROUPE, bandeau fermé.
 *
 * Il se recalcule sur les publications réelles : une mise en production qui se
 * termine sort de la moyenne aussitôt, et le bandeau ne reste jamais « en
 * cours » sur la foi d'un membre déjà arrivé. Un échec ne s'efface pas tout
 * seul — comme sur le bandeau d'un projet seul, il tient jusqu'à la mise en
 * production suivante de ce membre.
 */
export function resumeDeLaProductionDuGroupe(membres: readonly MembreSuivi[]): ResumeDuGroupe {
  const suivis = membres.flatMap((membre) => (membre.run ? [suiviDeLaPublication(membre.run)] : []));
  const enCours = suivis.filter((suivi) => suivi.etat === 'en-cours');
  const enRoute = enCours.length > 0;
  const tombees = suivis.filter((suivi) => suivi.etat === 'en-echec' || suivi.etat === 'arretee');
  const comptees = enRoute ? enCours : tombees;
  const pourcent = comptees.length
    ? Math.round(comptees.reduce((somme, suivi) => somme + suivi.pourcent, 0) / comptees.length)
    : null;

  const chiffres = membres.flatMap((membre) =>
    membre.etat?.commit && membre.etat.ecart !== undefined ? [membre.etat] : [],
  );
  const enAttente = chiffres.length
    ? {
        nombre: chiffres.reduce((somme, etat) => somme + (etat.ecart ?? 0), 0),
        enRetard: membres.some((membre) => productionEnRetard(membre.etat)),
      }
    : null;

  const tombee = tombees.length > 0;
  return { suivi: enRoute ? 'en-cours' : tombee ? 'en-echec' : 'repos', enRoute, tombee, pourcent, enAttente };
}
