/**
 * LA VUE CENTRALE — un seul écran à la fois, choisi dans la colonne de gauche.
 *
 * La colonne de gauche est une liste PLATE de destinations : le tableau de
 * bord, le coffre-fort, l'espace client, les backups, la surveillance, le
 * marketing, puis les projets. Cliquer l'une d'elles REMPLACE ce qu'il y a au centre — il n'y a
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
  'coffre',
  'memoire',
  'espace-client',
  'backups',
  'surveillance',
  /* COMMUNICATION : l'espace en quatre étapes guidées (`shared/src/communication-v2.ts`) ; l'ancien (vue
     « communication ») est retiré le 11/11/2026, son adresse y mène. */
  'communication2',
  /* L'atelier marketing : un espace de commercialisation par projet
     (`shared/src/marketing.ts`). */
  'marketing',
  /* Le Studio : visuels et vidéos animées de chaque projet, montés sur une ligne
     de temps et modifiables pièce par pièce (`shared/src/studio.ts`). */
  'studio',
  /* Le service Statistiques : le suivi des visites de chaque projet mesuré
     et des sites autonomes (`shared/src/statistiques.ts`). */
  'statistiques',
  /* Les MÉDIAS fabriqués par les cartes en mode « Réalisation », projet par
     projet, rangés par carte (`server/src/realisation.ts`). */
  'medias',
  /* Les TÂCHES RÉCURRENTES : les veilles posées par les agents, projet par
     projet, actives puis historique (`shared/src/veille-de-carte.ts`). */
  'taches-recurrentes',
  /* Les PLAQUETTES CLIENT : rédigées par l'agent, retouchées ici, lues par le client sur un lien privé
     (`server/src/plaquettes.ts`). */
  'plaquettes',
  /* La SÉCURITÉ : les projets suivis, leur audit de chaque semaine et l'agent qui en tire la carte de correction
     (`shared/src/service-securite.ts`). */
  'securite',
] as const;

export type VueCentrale = (typeof VUES_CENTRALES)[number];

/* LE BAS DE L'ÉCRAN DU TÉLÉPHONE a sa règle à lui : `menu-du-bas.ts` (menu classé par importance, 03/11/2026),
   qui remplace l'ancien `menuBasTelephone` (un seul bouton pleine largeur). */

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

/**
 * L'ÉCRAN D'ARRIVÉE À FROID (décision de l'utilisateur, 02/11/2026 : « elle doit
 * tomber par défaut sur le tableau de bord et non pas le projet Beluga »).
 *
 * Un démarrage SANS adresse précise arrive sur « Tableaux de bord » (`en-route`),
 * toujours et sans délai, y compris quand le téléphone a coupé l'application.
 * Une adresse précise (donc aussi un rechargement, qui la garde) n'est pas
 * concernée : elle commande son écran. `en-route` étant réservé aux admins, un
 * accès tiers revient à `projet` dès que son rôle est connu (`app.tsx`).
 */
export function vueDeDemarrage(ecran: { vue: string }): VueCentrale | null {
  return ecran.vue === 'accueil' ? 'en-route' : null;
}
