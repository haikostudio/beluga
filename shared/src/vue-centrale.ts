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
  /* Le Studio : visuels et vidéos animées de chaque projet, modifiables pièce
     par pièce (`shared/src/studio.ts`). */
  'studio',
  /* Le service Statistiques : le suivi des visites de chaque projet mesuré
     et des sites autonomes (`shared/src/statistiques.ts`). */
  'statistiques',
] as const;

export type VueCentrale = (typeof VUES_CENTRALES)[number];

/**
 * LE BAS DE L'ÉCRAN DU TÉLÉPHONE, SELON L'ÉCRAN AFFICHÉ (demande du 26/09/2026 :
 * « visible uniquement à l'intérieur d'un projet, là où il y a le tableau »).
 *
 * UN SEUL BOUTON, JAMAIS UNE BARRE (demande du 11/10/2026 : « je ne veux plus
 * la barre avec tableau, agent et fichiers, je veux juste un bouton nouvelle
 * tâche »). Rien d'autre ne s'empile en bas de l'écran : les fichiers et les
 * deux gestes de publication sont dans le menu à trois points du haut.
 *
 *  - `nouvelle-tache` : dans un projet ouvert, le bouton « Nouvelle tâche », qui
 *    fait naître une carte de ce projet ;
 *  - `nouvel-agent` : le bouton « Nouvel agent », sur les deux tableaux de bord
 *    généraux (« en-route », « tableau-de-bord ») et quand aucun projet n'est
 *    ouvert — il fait d'abord choisir le projet ;
 *  - `geste-de-page` : sur un SERVICE (marketing, studio, statistiques, coffre,
 *    notes, mémoire, espace client, sauvegardes, surveillance), le bas de
 *    l'écran appartient à la page affichée, qui y pose SON geste principal —
 *    « Nouveau site », « Nouvel accès », « Nouvelle note »… (demande du
 *    11/10/2026 : « les boutons principaux doivent être en bas, centre,
 *    fullwidth »). Une page qui n'en a pas, ou qui a ouvert un enfant, ne pose
 *    rien : la bande ne prend alors aucune place, et l'écran reprend la sienne.
 *
 * Il n'y a donc plus de vue SANS règle : cette fonction dit toujours à qui est
 * le bas de l'écran, et il n'y a jamais deux boutons.
 */
export type MenuBasTelephone = 'nouvelle-tache' | 'nouvel-agent' | 'geste-de-page';

export function menuBasTelephone(vue: VueCentrale, projetActif: boolean): MenuBasTelephone {
  if (vue === 'projet') return projetActif ? 'nouvelle-tache' : 'nouvel-agent';
  if (vue === 'en-route' || vue === 'tableau-de-bord') return 'nouvel-agent';
  return 'geste-de-page';
}

/**
 * LE VOLET D'UNE CARTE NE S'AFFICHE QUE LÀ OÙ IL A SA PLACE (demande du
 * 09/10/2026 : « arrêter d'ouvrir des volets en dehors du panneau principal »).
 *
 *  - sur le tableau du PROJET, toujours : c'est l'endroit dont la carte fait
 *    partie, et sa reprise au retour y a lieu ;
 *  - sur « En route » et « Tableaux de bord », seulement si la carte y a été
 *    ouverte d'un clic (`vueDeLaCarte` = la vue où elle s'est ouverte) ;
 *  - JAMAIS sur un service plein (coffre, mémoire, Studio, sauvegardes…) : la
 *    carte restée ouverte avant d'y entrer, ou celle retenue pour le projet, ne
 *    se pose plus par-dessus un écran qui n'a rien à voir.
 */
export function carteVisibleSurLaVue(vue: VueCentrale, vueDeLaCarte: VueCentrale): boolean {
  if (vue === 'projet') return true;
  if (vue === 'en-route' || vue === 'tableau-de-bord') return vueDeLaCarte === vue;
  return false;
}

/**
 * CHOISIR LA PAGE OÙ L'ON EST DÉJÀ, ALORS QU'UNE CARTE LA RECOUVRE, REFERME LA
 * CARTE (demande du 12/10/2026 : « le bouton ne réagit pas quand je clique sur
 * une carte depuis le Tableau de bord »).
 *
 * Une carte ouverte d'un clic depuis « En route » ou « Tableau de bord »
 * s'affiche PAR-DESSUS cette page (`carteVisibleSurLaVue`). Demander la même
 * page depuis le menu des services, le fil d'Ariane ou la colonne ne changeait
 * donc AUCUN état : la vue restait la même, la carte restait posée, et le bouton
 * semblait mort. Depuis un projet, la vue change vraiment et la carte disparaît
 * — d'où le « ça marche depuis une carte du projet ».
 *
 * Ne vise QUE ces deux pages : sur le tableau d'un projet la carte est un
 * volet que l'on veut retrouver, et un service plein ne l'affiche pas — sa
 * mémoire (`openCardId`) n'est jamais effacée par un simple choix de vue.
 */
export function carteARefermerSurChoixDeVue(choix: {
  vueDemandee: VueCentrale;
  vueActuelle: VueCentrale;
  /** La vue où la carte ouverte s'est ouverte (`carteOuverteSur`). */
  vueDeLaCarte: VueCentrale;
  /** Une carte est-elle ouverte ? */
  carteOuverte: boolean;
}): boolean {
  if (!choix.carteOuverte) return false;
  if (choix.vueDemandee !== choix.vueActuelle) return false;
  if (choix.vueDemandee !== 'en-route' && choix.vueDemandee !== 'tableau-de-bord') return false;
  return carteVisibleSurLaVue(choix.vueActuelle, choix.vueDeLaCarte);
}
