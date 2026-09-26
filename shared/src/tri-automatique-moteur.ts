/**
 * QUEL MOTEUR REÇOIT UNE CARTE QUE PERSONNE N'A RÉGLÉE À LA MAIN.
 *
 * Avant cette règle, une carte posée sans clic (rendez-vous de nuit) héritait
 * toujours du moteur PAR DÉFAUT du projet — en pratique, toujours le même,
 * quel que soit le genre de la trouvaille. Le tri par Laya
 * (`server/src/jugement-rapide.ts`) classe le texte de la carte en deux genres ; cette
 * règle, pure et sans disque, traduit ce genre en moteur RÉELLEMENT
 * disponible :
 *
 *   - programmation avancée → Claude d'abord, GPT en repli ;
 *   - administratif         → GPT d'abord, Claude en repli ;
 *   - indéterminé (Laya absent, silencieux ou peu sûr de lui) → Claude
 *     d'abord, comme le réglage par défaut d'avant cette carte.
 *
 * JAMAIS CURSOR PAR BASCULE AUTOMATIQUE (DEC-156, même règle que la
 * publication) : il se facture au crédit, pas à la fenêtre, et y basculer sans
 * qu'on l'ait demandé dépenserait de l'argent au nom de personne.
 *
 * Le PLAFOND du modèle le plus cher, lui, ne vit pas ici : il continue de
 * passer par `niveauPlancherAutomatique`/`runPlancherAutomatique`
 * (`niveau-agent.ts`), qui s'applique déjà à toute carte posée sans clic, quel
 * que soit le moteur retenu par cette règle-ci.
 */

import type { IdMoteur, MoteurCatalogue } from './reglages-proposition.js';

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
 * Chaque liste ne contient QUE Claude et Codex — jamais Cursor (DEC-156) — dans
 * l'ordre de préférence du genre : le second sert déjà de repli si le premier
 * n'a plus de quota, sans qu'un troisième moteur de bascule soit nécessaire.
 */
const PREFERENCE_PAR_GENRE: Record<GenreCarte, IdMoteur[]> = {
  programmation_avancee: ['claude', 'codex'],
  administratif: ['codex', 'claude'],
  indetermine: ['claude', 'codex'],
};

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
 * Le moteur à poser sur une carte automatique, selon son genre et la place
 * réellement restante de chaque moteur.
 *
 * Le premier moteur de la préférence du genre qui a encore du quota gagne ;
 * sinon le second (l'un des deux a forcément du quota dans le cas courant).
 * Si aucun des deux n'en a, le premier de la préférence est rendu quand même :
 * la proposition portera l'avertissement « aucun compte disponible » déjà posé
 * par `reglagesDeLaProposition`, plutôt que d'échouer à choisir un moteur.
 */
export function moteurDuTriAutomatique(genre: GenreCarte, catalogue: MoteurCatalogue[]): ChoixDeMoteurAutomatique {
  const ordre = PREFERENCE_PAR_GENRE[genre];
  const choisi = ordre.find((id) => aDuQuota(catalogue, id)) ?? ordre[0];
  return { engine: choisi, bascule: choisi !== ordre[0] };
}
