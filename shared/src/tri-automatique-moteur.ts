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
 * JAMAIS DE REPLI PAYANT PAR BASCULE AUTOMATIQUE (DEC-156, même règle que la
 * publication) : un moteur facturé au crédit, pas à la fenêtre (Cursor, MiMo,
 * les moteurs ajoutés), ne se choisit pas sans qu'on l'ait demandé — cela
 * dépenserait de l'argent au nom de personne. La SOURCE de cette règle est le
 * registre (`secoursAutomatique`, lu par `moteursDeSecours()`) ; la liste
 * ci-dessous ne donne que l'ORDRE de préférence.
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
 * L'ordre de préférence du genre. Tout moteur absent de `moteursDeSecours()`
 * en est écarté au moment du choix : le second sert de repli si le premier n'a
 * plus de quota, sans qu'un troisième moteur de bascule soit nécessaire.
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
  const preference = PREFERENCE_PAR_GENRE[genre];
  const secours = moteursDeSecours();
  const permis = preference.filter((id) => secours.includes(id));
  // Registre sans aucun moteur de secours parmi eux : le premier de la liste, comme avant.
  const ordre = permis.length > 0 ? permis : preference.slice(0, 1);
  const choisi = ordre.find((id) => aDuQuota(catalogue, id)) ?? ordre[0];
  return { engine: choisi, bascule: choisi !== ordre[0] };
}
