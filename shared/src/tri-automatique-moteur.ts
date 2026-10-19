/**
 * QUEL MOTEUR REÇOIT UNE CARTE QUE PERSONNE N'A RÉGLÉE À LA MAIN.
 *
 * C'EST L'UTILISATEUR QUI RANGE LES MOTEURS (réglages « Comptes et quotas »,
 * `Settings.ordreDesMoteurs`) : le premier moteur de sa liste qui a encore du
 * quota reçoit la carte, le suivant prend le relais s'il n'en a plus. Avant, un
 * ordre figé dépendait du GENRE de la carte (Claude d'abord pour la
 * programmation, GPT d'abord pour l'administratif, tranché par Laya) : le genre
 * ne décide plus du moteur, il reste dans la signature pour les appelants.
 *
 * JAMAIS DE REPLI PAYANT PAR BASCULE AUTOMATIQUE (DEC-156, même règle que la
 * publication) : un moteur facturé au crédit, pas à la fenêtre (Cursor, MiMo,
 * les moteurs ajoutés), ne se choisit pas sans qu'on l'ait demandé — cela
 * dépenserait de l'argent au nom de personne, même rangé en tête de la liste.
 * La SOURCE de cette règle est le registre (`secoursAutomatique`, lu par
 * `moteursDeSecours()`).
 *
 * Le PLAFOND du modèle le plus cher, lui, ne vit pas ici : il continue de
 * passer par `niveauPlancherAutomatique`/`runPlancherAutomatique`
 * (`niveau-agent.ts`), qui s'applique déjà à toute carte posée sans clic, quel
 * que soit le moteur retenu par cette règle-ci.
 */

import type { IdMoteur, MoteurCatalogue } from './reglages-proposition.js';
import { moteursDeSecours } from './registre-moteurs.js';

export const GENRES_CARTE = ['programmation_avancee', 'administratif', 'indetermine'] as const;
export type GenreCarte = (typeof GENRES_CARTE)[number];

/**
 * En dessous de ce seuil, la classification de Laya n'est pas assez sûre
 * d'elle pour trancher entre les deux moteurs : la carte est traitée comme
 * « indéterminée ». `classerLeGenreDeLaCarte` (server/src/jugement-rapide.ts) applique
 * déjà ce seuil ; il vit ici, à côté du reste de la règle, pour rester lisible
 * et testable sans lancer le classifieur.
 */
export const SEUIL_CONFIANCE_TRI = 0.6;

/**
 * L'ORDRE DES MOTEURS À SUIVRE : celui de l'utilisateur, restreint aux moteurs
 * de secours du registre, complété par ceux qu'il n'a pas rangés (dans l'ordre
 * du registre). Un moteur de secours installé plus tard n'est donc jamais
 * inatteignable, et un moteur payé au crédit n'y entre jamais.
 */
export function ordreDeMoteursComplet(voulu: readonly string[] = []): IdMoteur[] {
  const secours = moteursDeSecours() as IdMoteur[];
  const gardes = [...new Set(voulu)].filter((id): id is IdMoteur => (secours as string[]).includes(id));
  return [...gardes, ...secours.filter((id) => !gardes.includes(id))];
}

function aDuQuota(catalogue: MoteurCatalogue[], id: IdMoteur): boolean {
  const moteur = catalogue.find((m) => m.id === id);
  return !!moteur && moteur.installed && moteur.comptesDisponibles > 0;
}

export interface ChoixDeMoteurAutomatique {
  engine: IdMoteur;
  /** A-t-on dû quitter le premier choix du genre, faute de quota ? */
  bascule: boolean;
}

/**
 * Le moteur à poser sur une carte automatique, selon l'ordre réglé par
 * l'utilisateur et la place réellement restante de chaque moteur.
 *
 * Le premier moteur de l'ordre qui a encore du quota gagne ; si aucun n'en a,
 * le premier de l'ordre est rendu quand même : la proposition portera
 * l'avertissement « aucun compte disponible » déjà posé par
 * `reglagesDeLaProposition`, plutôt que d'échouer à choisir un moteur.
 */
export function moteurDuTriAutomatique(
  _genre: GenreCarte,
  catalogue: MoteurCatalogue[],
  ordreDesMoteurs?: readonly string[],
): ChoixDeMoteurAutomatique {
  const ordre = ordreDeMoteursComplet(ordreDesMoteurs);
  // Registre sans aucun moteur de secours : le premier de la liste, comme avant.
  const liste = ordre.length > 0 ? ordre : (['claude'] as IdMoteur[]);
  const choisi = liste.find((id) => aDuQuota(catalogue, id)) ?? liste[0];
  return { engine: choisi, bascule: choisi !== liste[0] };
}
