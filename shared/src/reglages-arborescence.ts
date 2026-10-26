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
    // Le profil de la personne connectée : le premier réglage qui la concerne elle.
    cle: 'compte',
    titre: 'Mon compte',
    pages: [
      {
        cle: 'mon-compte',
        titre: 'Mon compte',
        // …ET LES ACCÈS TIERS À BELUGA (l'ancien onglet « Sous-comptes ») : une
        // grille de droits par projet et par service. Les comptes clients se
        // créent depuis la messagerie, jamais ici.
        motsCles: [
          'profil', 'mot de passe', 'identifiant', 'courriel', 'mail', 'pseudo', 'nom', 'connexion', 'adresse',
          'accès', 'sous-comptes', 'équipe', 'collaborateur', 'droits', 'invitation', 'utilisateur', 'permission',
        ],
        libelles: ['Nom affiché', 'Adresse de courriel', 'Identifiant de connexion', 'Changer mon mot de passe', 'Accès à Beluga', 'Ouvrir un accès'],
      },
    ],
  },
  {
    cle: 'apparence',
    titre: 'Apparence',
    pages: [
      {
        cle: 'theme',
        titre: 'Clair ou sombre',
        motsCles: ['sombre', 'clair', 'couleur', 'thème', 'apparence', 'nuit', 'noir', 'blanc'],
      },
      {
        // La langue vivait dans le menu « … » de la barre d'en-tête : un réglage
        // GÉNÉRAL se range ici, où on l'atteint depuis n'importe quel écran.
        cle: 'langue',
        titre: 'Langue',
        motsCles: ['langue', 'français', 'english', 'anglais', 'deutsch', 'allemand', 'español', 'espagnol', '中文', 'chinois', 'traduction', 'language'],
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
    cle: 'notifications',
    titre: 'Notifications',
    pages: [
      {
        cle: 'notifications',
        titre: 'Notifications',
        motsCles: ['notification', 'alerte', 'silence', 'prévenir', 'sonnerie', 'appareil', 'appareils', 'téléphone', 'iphone', 'push', 'activer', 'désactiver', 'connecté'],
        libelles: ['Notifications sur cet appareil', 'Vos appareils connectés', 'Ce dont on vous prévient', 'Heures de silence'],
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
      {
        cle: 'services-creation',
        titre: 'Services de création',
        motsCles: ['vidéo', 'image', 'clé', 'kie', 'kie.ai', 'higgsfield', 'byteplus', 'seedance', 'freepik', 'magnific', 'krea', 'runway', 'fal', 'replicate', 'openrouter', 'modèle', 'génération'],
      },
    ],
  },
  {
    cle: 'machine',
    titre: 'Machine',
    pages: [
      {
        // Récupérer les nouveautés du dépôt public de Beluga Build. Visible
        // partout : la machine source et l'offre hébergée y lisent pourquoi
        // elles n'ont rien à récupérer.
        cle: 'mise-a-jour',
        titre: 'Mise à jour',
        motsCles: ['mise à jour', 'mettre à jour', 'nouveautés', 'version', 'dépôt public', 'changelog', 'vérifier', 'upgrade'],
        libelles: ['Mettre à jour', 'Vérifier maintenant'],
      },
      {
        // Ce qui change d'un serveur à l'autre : adresse, nom de domaine, courriels,
        // espace client. Les pages de l'assistant de premier démarrage, réunies.
        cle: 'installation',
        titre: 'Installation',
        motsCles: ['installation', 'domaine', 'adresse', 'courriel', 'email', 'resend', 'github', 'espace client', 'compétences', 'dictée', 'mise en route', 'assistant', 'dépôt'],
        libelles: ['Adresse de Beluga Build', 'Nom de domaine des projets', 'Adresse d’expédition', 'Nom de l’espace client'],
      },
      {
        // Le compte GitHub du serveur : qui est relié, d'où vient le jeton, les
        // projets récupérés, et la réinitialisation du jeton.
        cle: 'github',
        titre: 'GitHub',
        motsCles: ['github', 'jeton', 'token', 'dépôt', 'repo', 'clé', 'gh', 'réinitialiser', 'compte'],
        libelles: ['Réinitialiser le jeton'],
      },
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
  {
    /* TOUT EN BAS DU MENU (demande du 20/10/2026) : redémarrage, terminal et
       arrêt général, ce qui agit sur la machine entière. Le redémarrage est
       AUSSI dans le menu « … » des tableaux de bord ; la clé reste « serveur »
       pour les adresses et les liens existants. */
    cle: 'serveur',
    titre: 'Serveur',
    pages: [
      {
        cle: 'serveur',
        titre: 'Serveur',
        motsCles: ['redémarrer', 'redémarrage', 'relancer', 'terminal', 'console', 'arrêter', 'stop', 'agents', 'serveur', 'démon'],
        libelles: ['Redémarrer le serveur', 'Terminal du serveur', 'Arrêter tous les agents'],
      },
    ],
  },
];

/** Toutes les pages visibles, à plat — dans l'ordre du menu. */
export function pagesDesReglages(groupes: readonly GroupeDeReglages[]): PageDeReglages[] {
  return groupes.flatMap((groupe) => groupe.pages);
}
