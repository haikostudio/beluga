/**
 * CHAQUE CARTE LANCÉE TRAVAILLE DANS SON PROPRE DOSSIER.
 *
 * La branche par carte existait déjà, mais toutes les cartes d'un projet se
 * partageaient UNE copie de travail : la seconde `git checkout -B` arrachait les
 * fichiers à la première, d'où une porte dure qui faisait attendre toute carte
 * dont le dossier était occupé. Conséquence visible : « Tout lancer » ne lançait
 * jamais qu'une carte à la fois.
 *
 * Git sait pourtant donner un dossier par branche (`git worktree add`). Les
 * règles pures du découpage vivent ici — où va le dossier, comment il se nomme,
 * lequel est orphelin — pour être rejouables sans dépôt ni disque. Le démon, lui,
 * appelle git (`server/src/dossier-de-carte.ts`).
 *
 * Le dossier vit DANS le dépôt (`.worktrees/…`) et non à côté : la résolution des
 * dépendances remonte alors toute seule au dossier principal, et un dossier
 * oublié se voit là où on le cherche.
 */

import { nomDeBranche, memeDossier } from './branche-de-carte.js';

/** Le dossier qui rassemble les copies de travail des cartes, dans le dépôt. */
export const DOSSIER_DES_CARTES = '.worktrees';

/**
 * Le nom du dossier d'une carte : celui de sa branche, sans le « tache/ ». Même
 * source que la branche, donc jamais deux repères qui se contredisent.
 */
export function nomDuDossierDeCarte(titre: string, cardId: string): string {
  return nomDeBranche(titre, cardId).slice('tache/'.length);
}

/** Où la carte travaillera : `<projet>/.worktrees/<nom de branche>`. */
export function cheminDossierDeCarte(racine: string, titre: string, cardId: string): string {
  const propre = (racine ?? '').trim().replace(/\/+$/, '');
  return `${propre}/${DOSSIER_DES_CARTES}/${nomDuDossierDeCarte(titre, cardId)}`;
}

/** Le dossier appartient-il au rangement des cartes de ce projet ? */
export function estDossierDeCarte(racine: string, dossier: string): boolean {
  const prefixe = `${(racine ?? '').trim().replace(/\/+$/, '')}/${DOSSIER_DES_CARTES}/`;
  return (dossier ?? '').trim().startsWith(prefixe);
}

/**
 * Les dossiers de cartes qu'aucun agent n'occupe plus : un tour tué net, un démon
 * redémarré en plein travail, et la copie reste là sans personne dedans. On ne
 * ferme QUE les dossiers du rangement des cartes — jamais le dossier principal,
 * jamais un dossier ouvert à la main par quelqu'un.
 */
export function dossiersOrphelins(racine: string, ouverts: string[], occupes: string[]): string[] {
  return (ouverts ?? [])
    .filter((d) => estDossierDeCarte(racine, d))
    .filter((d) => !(occupes ?? []).some((o) => memeDossier(o, d)));
}
