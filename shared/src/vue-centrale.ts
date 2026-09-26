/**
 * LA VUE CENTRALE — un seul écran à la fois, choisi dans la colonne de gauche.
 *
 * La colonne de gauche est une liste PLATE de destinations : le tableau de
 * bord, le coffre-fort, l'espace client, les backups, la surveillance, le
 * marketing, les notes, puis les projets. Cliquer l'une d'elles REMPLACE ce qu'il y a au centre — il n'y a
 * plus de panneau posé par-dessus, donc plus de croix à trouver pour revenir.
 *
 * Ce fichier ne dit que la règle : quelles destinations existent, et laquelle
 * occupe tout l'espace. L'écran vit dans `web/src/app.tsx`.
 */

/** Les destinations possibles du volet central. */
export const VUES_CENTRALES = [
  'projet',
  /* « En route » : les cartes de tous les projets entre la demande et le
     déploiement (`shared/src/en-route.ts`). C'est aussi ce que montre le
     centre quand aucun projet n'est ouvert. */
  'en-route',
  'tableau-de-bord',
  'notes',
  'coffre',
  'memoire',
  'espace-client',
  'backups',
  'surveillance',
  /* L'atelier marketing : un espace de commercialisation par projet
     (`shared/src/marketing.ts`). */
  'marketing',
] as const;

export type VueCentrale = (typeof VUES_CENTRALES)[number];

/**
 * Une vue PLEINE prend toute la largeur : ni tableau du projet, ni volet de
 * conversation à côté. Seul « projet » laisse la place aux deux.
 */
export function vuePleine(vue: VueCentrale): boolean {
  return vue !== 'projet';
}
