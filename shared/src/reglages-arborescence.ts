/**
 * L'ARBORESCENCE DES RÉGLAGES : les GROUPES, leurs PAGES, et les mots qui y
 * mènent. Elle vit ICI, dans le socle partagé, pour trois raisons.
 *
 * 1. Les titres sont des CLÉS DU DICTIONNAIRE : l'écran les passe à `t()` au
 *    moment de l'affichage, jamais avant — un titre traduit une fois pour
 *    toutes serait figé dans la langue du démarrage.
 * 2. Les MOTS-CLÉS de la recherche ne sont jamais affichés : ce sont des
 *    repères de saisie, à leur place dans une donnée, pas dans un écran.
 * 3. Une structure sans base ni disque se teste seule
 *    (`server/src/test/recherche-reglages.test.ts`).
 *
 * L'écran, lui, n'ajoute que ce qui ne peut pas vivre ici : l'icône de chaque
 * page et le module à charger quand on l'ouvre.
 */

/** Une sous-page de réglages, telle que le menu et la recherche la voient. */
export interface PageDeReglages {
  /** La clé de la page : elle vit dans l'adresse et ne se traduit jamais. */
  cle: string;
  /** Le titre, en français : c'est la CLÉ du dictionnaire, pas le texte final. */
  titre: string;
  /** Des mots qu'on pourrait taper sans qu'ils soient à l'écran. */
  motsCles?: string[];
  /** Les libellés des réglages portés par la page : la recherche les lit aussi. */
  libelles?: string[];
}

/** Un groupe du menu : un titre et ses pages, dans l'ordre d'affichage. */
export interface GroupeDeReglages {
  cle: string;
  titre: string;
  pages: PageDeReglages[];
}

export const ARBORESCENCE_REGLAGES: readonly GroupeDeReglages[] = [
  {
    cle: 'apparence',
    titre: 'Apparence',
    pages: [
      {
        cle: 'theme',
        titre: 'Thème et ambiance',
        motsCles: ['sombre', 'clair', 'couleur', 'ambiance', 'apparence', 'nuit'],
      },
    ],
  },
  {
    cle: 'projets',
    titre: 'Projets',
    pages: [
      {
        cle: 'projets',
        titre: 'Projets réunis',
        motsCles: ['projet', 'réunir', 'fusionner', 'regrouper', 'séparer', 'dépôt', 'sous-groupe', 'tableau commun', 'projects'],
        libelles: ['Réunir des projets'],
      },
    ],
  },
  {
    cle: 'agents',
    titre: 'Agents',
    pages: [
      {
        cle: 'agents-paralleles',
        titre: 'Agents en parallèle',
        motsCles: ['plafond', 'parallèle', 'heures creuses', 'tâche lourde', 'simultané'],
        libelles: ["Plafond d'agents", 'Heures creuses'],
      },
      {
        cle: 'notifications',
        titre: 'Ce dont on vous prévient',
        motsCles: ['notification', 'alerte', 'silence', 'prévenir', 'sonnerie'],
        libelles: ['Heures de silence'],
      },
      {
        cle: 'voix',
        titre: 'Voix',
        motsCles: ['micro', 'dictée', 'parler', 'écoute', 'raccourci'],
      },
    ],
  },
  {
    cle: 'moteurs',
    titre: 'Moteurs',
    pages: [
      {
        cle: 'comptes',
        titre: 'Comptes et quotas',
        motsCles: ['quota', 'compte', 'claude', 'codex', 'cursor', 'connexion', 'limite'],
      },
      {
        cle: 'consommation',
        titre: 'Consommation',
        motsCles: ['dépense', 'coût', 'jetons', 'facture', 'usage'],
      },
      {
        cle: 'mode-creation',
        titre: 'Mode Création',
        motsCles: ['création', 'créativité', 'orchestre', 'répartition', 'gpt', 'claude', 'cursor', 'avis', 'modèle'],
        libelles: ['Qui fait quoi', 'Avis complémentaires'],
      },
    ],
  },
  {
    cle: 'machine',
    titre: 'Machine',
    pages: [
      {
        cle: 'capacite',
        titre: 'Capacité du système',
        motsCles: ['mémoire', 'charge', 'processus', 'place', 'disque', 'saturé'],
      },
      {
        cle: 'erreurs',
        titre: 'Dernières erreurs de l’interface',
        motsCles: ['erreur', 'plantage', 'journal', 'page blanche', 'bug'],
      },
    ],
  },
  {
    cle: 'donnees',
    titre: 'Données',
    pages: [
      {
        cle: 'sauvegardes',
        titre: 'Sauvegarde automatique',
        motsCles: ['sauvegarde', 'restauration', 'nuit', 'archive'],
        libelles: ['Heure de la sauvegarde de nuit'],
      },
      {
        cle: 'backups',
        titre: 'Backups des sites',
        motsCles: ['backup', 'site', 'production', 'disque', 'stockage'],
      },
      {
        cle: 'export',
        titre: 'Export des données',
        motsCles: ['export', 'import', 'déménager', 'archive', 'migration'],
      },
    ],
  },
  {
    cle: 'developpeurs',
    titre: 'Développeurs',
    pages: [
      {
        cle: 'acces-api',
        titre: 'Accès API',
        motsCles: ['api', 'clé', 'jeton', 'webhook', 'service extérieur'],
      },
      {
        cle: 'juge-rapide',
        titre: 'Juge rapide',
        motsCles: ['laya', 'juge', 'jugement', 'avis', 'signal', 'urgence', 'niveau', 'local'],
        libelles: ['Le modèle local', 'Ce que le juge décide', 'Les jugements rendus'],
      },
    ],
  },
];

/** Toutes les pages visibles, à plat — dans l'ordre du menu. */
export function pagesDesReglages(groupes: readonly GroupeDeReglages[]): PageDeReglages[] {
  return groupes.flatMap((groupe) => groupe.pages);
}
