/**
 * Ce avec quoi une carte VA tourner, ou ce avec quoi elle A tourné.
 *
 * Une carte porte ses réglages d'agent (moteur, modèle, niveau de réflexion)
 * dès sa naissance, mais on ne les voyait nulle part : impossible de savoir
 * avant le départ ce qui allait servir, ni de comprendre après coup pourquoi
 * un travail s'était mal passé.
 *
 * La règle est ici, pure et rejouable, parce qu'elle n'a rien à voir avec
 * l'écran : elle dit QUELLES valeurs montrer et si elles se laissent encore
 * changer. Un seul principe — tant que rien n'a démarré, ce sont des
 * intentions et elles se modifient ; dès que le travail est lancé, ce sont des
 * FAITS et ils se lisent tels qu'ils ont servi.
 */

import { ColumnKey } from './columns.js';

/**
 * Les colonnes où le travail a déjà commencé. « Planifié » n'en fait pas
 * partie : une carte en file n'a pas encore de compte ni d'agent, on peut
 * encore changer d'avis jusqu'au départ.
 */
export const COLONNES_DEMARREES: ColumnKey[] = ['running', 'to_deploy', 'archived'];

export interface ChoixAgent {
  engine?: string;
  model?: string;
  thinking?: string;
}

export interface EntreeReglagesCarte {
  colonne: ColumnKey;
  /** Les réglages posés sur la carte : ce avec quoi elle partira. */
  carte: ChoixAgent;
  /**
   * Les réglages de l'agent d'EXÉCUTION, quand il y en a déjà eu un, avec le
   * compte qui a porté le quota. Absent tant que personne n'a travaillé.
   */
  agent?: ChoixAgent & { compte?: string };
  /** Le compte relevé à la fin du tour, quand l'agent lui-même a disparu. */
  compteMesure?: string;
}

export interface ReglagesCarte {
  engine?: string;
  model?: string;
  thinking?: string;
  /** Le compte qui a porté (ou porte) le quota. Inconnu avant le départ. */
  compte?: string;
  /** Vrai tant que la carte n'a pas démarré : les trois réglages se changent. */
  modifiable: boolean;
  /** `prevu` = ce qui servira, `reel` = ce qui a réellement servi. */
  source: 'prevu' | 'reel';
  /** Pourquoi c'est figé, en toutes lettres. Vide quand c'est modifiable. */
  raison?: string;
}

/**
 * Ce qu'il faut afficher dans le détail d'une carte, et si on peut y toucher.
 *
 * Deux freins suffisent chacun à figer : la colonne dit que le travail est
 * parti, ou un agent d'exécution existe déjà. Le second attrape le cas d'une
 * carte revenue en arrière à la main après un tour : ses réglages ont servi,
 * les réécrire ferait mentir le compte rendu.
 */
export function reglagesDeLaCarte(entree: EntreeReglagesCarte): ReglagesCarte {
  const aTourne = !!entree.agent;
  const demarree = aTourne || COLONNES_DEMARREES.includes(entree.colonne);

  // Ce qui a servi prime sur ce qui était prévu ; à défaut, la carte fait foi.
  const source = entree.agent ?? entree.carte;
  const compte = entree.agent?.compte ?? entree.compteMesure;

  return {
    engine: source.engine ?? entree.carte.engine,
    model: source.model ?? entree.carte.model,
    thinking: source.thinking ?? entree.carte.thinking,
    // Avant le départ, le compte n'est pas encore choisi : ne rien montrer vaut
    // mieux qu'un compte deviné qui ne sera peut-être pas celui-là.
    compte: demarree ? compte : undefined,
    modifiable: !demarree,
    source: aTourne ? 'reel' : 'prevu',
    ...(demarree
      ? {
          raison: aTourne
            ? 'Le travail a démarré : ces réglages sont ceux qui ont réellement servi.'
            : 'Le travail a démarré : les réglages ne changent plus.',
        }
      : {}),
  };
}
