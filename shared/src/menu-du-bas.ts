/**
 * LE BAS DE L'ÉCRAN DU TÉLÉPHONE, ÉCRAN PAR ÉCRAN (décision de l'utilisateur du 03/11/2026, carte « Refonte de la
 * navigation mobile », maquettes 0 à 6). Remplace le menu « deux boutons, le bouton central violet, deux boutons,
 * classés par importance », rejeté : le même menu partout, souvent inutile, avec une feuille fourre-tout au centre.
 *
 * TROIS FORMES, ET AUCUNE AUTRE :
 *  - `aucun` : pas de bas du tout (Messagerie, Backup, Surveillance, l'accueil de Marketing…) — aucun menu vaut
 *    mieux qu'un menu inutile ;
 *  - `pleine-largeur` : UN bouton sur toute la largeur (« Nouvelle note », « Vue d'ensemble » de la Mémoire,
 *   l’accueil du Studio…). `page` : c'est le GESTE PRINCIPAL que la page pose (`GestePrincipal`) ;
 *  - `repartis` : des boutons répartis sur toute la largeur, l'action principale AU CENTRE quand il y en a une —
 *    un rond violet (« + » d'un nouvel agent) ou un chevron gris qui ouvre une petite feuille des lieux secondaires.
 *
 * L'ÉCRAN : la vue centrale, précisée par la page quand elle est descendue d'un niveau (une marque de Communication,
 * une création du Studio). Ce fichier ne dit que la règle — quelle forme, quels gestes, dans quel ordre. Les
 * libellés, icônes et gestes vivent dans l'interface (`web/src/components/menu-du-bas.tsx`), la page déclare les
 * siens (`useDeclarerLesGestesDuBas`). Le tableau complet : `docs/mecaniques/menu-du-bas.md`.
 */
import type { VueCentrale } from './vue-centrale.js';

/** Une destination ou une action du bas. */
export const GESTES_DU_MENU_DU_BAS = [
  /* Un projet de développement : plus de bas (13/11/2026) — « Publier » vit dans le haut. Ces gestes restent connus
     pour les pages qui les déclarent encore. */
  'deployer',
  'nouvel-agent',
  'production',
  'outils',
  /* Hors de tout projet */
  'tableaux-de-bord',
  'resume',
  /* Mémoire */
  'vue-d-ensemble',
  /* Communication 2, dans une marque : ses quatre pages (l'étape « Réseaux » a disparu le 12/11/2026) */
  'v2-campagnes',
  'v2-connexion',
  'v2-calendrier',
  'v2-reponses',
  /* Studio, dans une création — et au centre, le rond violet de la mise en production (12/11/2026) */
  'medias-studio',
  'mise-en-production',
  'telechargements',
  'style',
  'archives',
] as const;
export type GesteDuMenuDuBas = (typeof GESTES_DU_MENU_DU_BAS)[number];

/** Le centre d'un bas réparti : une action (rond violet), ou le chevron des lieux secondaires (rond gris). */
export type CentreDuBas = { genre: 'action'; geste: GesteDuMenuDuBas } | { genre: 'chevron'; gestes: readonly GesteDuMenuDuBas[] };

export type MenuDuBas =
  | { forme: 'aucun'; ecran: EcranDuBas }
  /** `page` : le geste principal que la page pose elle-même (`GestePrincipal`). */
  | { forme: 'pleine-largeur'; ecran: EcranDuBas; geste: GesteDuMenuDuBas | 'page' }
  | {
      forme: 'repartis';
      ecran: EcranDuBas;
      gauche: readonly GesteDuMenuDuBas[];
      centre: CentreDuBas | null;
      droite: readonly GesteDuMenuDuBas[];
    };

/** Les écrans qu'une page DÉCLARE quand elle descend d'un niveau (le reste se lit sur la vue). */
export const NIVEAUX_DECLARES = ['communication2-marque', 'studio-creation'] as const;
export type NiveauDeclare = (typeof NIVEAUX_DECLARES)[number];

export type EcranDuBas = 'projet' | 'tableaux-de-bord' | VueCentrale | NiveauDeclare;

/**
 * L'ÉCRAN AFFICHÉ : le niveau que la page a déclaré l'emporte ; sinon la vue, un projet sans projet actif (ou les
 * tableaux de bord) comptant comme « tableaux-de-bord ».
 */
export function ecranDuBas(vue: VueCentrale, contexte: { projetActif: boolean; niveau?: NiveauDeclare | null }): EcranDuBas {
  if (contexte.niveau) return contexte.niveau;
  if (vue === 'projet') return contexte.projetActif ? 'projet' : 'tableaux-de-bord';
  if (vue === 'en-route') return 'tableaux-de-bord';
  return vue;
}

const AUCUN = (ecran: EcranDuBas): MenuDuBas => ({ forme: 'aucun', ecran });

/**
 * LE BAS DE CHAQUE ÉCRAN, tel que l'utilisateur l'a décrit (03/11/2026) et que les maquettes le montrent. Un écran
 * non cité n'a PAS de bas : on n'invente pas un menu pour remplir.
 */
export function menuDuBas(ecran: EcranDuBas): MenuDuBas {
  switch (ecran as string) {
    case 'projet':
      /* PLUS RIEN EN BAS D'UN PROJET (décision du 13/11/2026, carte « Haut d'un projet fixe sur téléphone ») :
         « Publier » est un petit bouton icône tout à droite du haut, les trois points juste à sa gauche ; le « + »
         d'une nouvelle tâche ouvre la rangée d'onglets. */
      return AUCUN(ecran);
    case 'tableaux-de-bord':
    case 'tableau-de-bord':
      return { forme: 'repartis', ecran, gauche: ['tableaux-de-bord'], centre: { genre: 'action', geste: 'nouvel-agent' }, droite: ['resume'] };
    case 'memoire':
      return { forme: 'pleine-largeur', ecran, geste: 'vue-d-ensemble' };
    /* COMMUNICATION 2 : sans marque, rien (la page liste les marques) ; dans une marque, ses QUATRE pages (Campagnes,
       Connexion, Calendrier, Réponses — plus de « Réseaux » depuis le 12/11/2026) réparties sur la largeur, sans rond
       au centre — aucun chef à appeler : on lui écrit depuis le champ de chaque page. */
    case 'communication2':
      return AUCUN(ecran);
    case 'communication2-marque':
      return { forme: 'repartis', ecran, gauche: ['v2-campagnes', 'v2-connexion'], centre: null, droite: ['v2-calendrier', 'v2-reponses'] };
    case 'studio':
      return { forme: 'pleine-largeur', ecran, geste: 'page' };
    case 'studio-creation':
      /* LE ROND VIOLET DU CENTRE (12/11/2026, capture #8adf) : la « Construction » du Studio — version finale et export —,
         le même geste que sur ordinateur ; sans lui, le média ne sortait pas du téléphone. */
      return { forme: 'repartis', ecran, gauche: ['medias-studio', 'telechargements'], centre: { genre: 'action', geste: 'mise-en-production' }, droite: ['style', 'archives'] };
    default:
      /* Messagerie, Backup, Surveillance, Coffre-fort, Tâches récurrentes, Statistiques, l'accueil de Marketing… */
      return AUCUN(ecran);
  }
}
