/**
 * L'ARBORESCENCE DES RÉGLAGES : six RUBRIQUES par usage, leurs PAGES, et les
 * mots qui y mènent (refonte « Réglages à deux niveaux », 21/11/2026 : 22 pages
 * en 9 groupes d'une seule colonne devenaient illisibles). Elle vit ICI, dans le
 * socle partagé, pour trois raisons.
 *
 * 1. Les titres sont des CLÉS DU DICTIONNAIRE : l'écran les passe à `t()` au
 *    moment de l'affichage, jamais avant — un titre traduit une fois pour
 *    toutes serait figé dans la langue du démarrage.
 * 2. Les MOTS-CLÉS de la recherche ne sont jamais affichés : ce sont des
 *    repères de saisie, à leur place dans une donnée, pas dans un écran.
 * 3. Une structure sans base ni disque se teste seule
 *    (`server/src/test/recherche-reglages.test.ts`).
 *
 * DEUX NIVEAUX : la fenêtre s'ouvre sur les six rubriques ; une rubrique ouverte
 * devient la colonne de gauche, ses pages techniques (`avance`) repliées sous
 * « Avancé » en bas. Les ANCIENNES clés de page (liens, événement
 * `beluga:ouvrir-reglages`, adresses `#reglages/<page>`) mènent toujours à leur
 * nouvelle place par `ALIAS_DES_PAGES_DE_REGLAGES`.
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
  /** Une page TECHNIQUE : rangée sous « Avancé », replié, en bas de sa rubrique. */
  avance?: boolean;
}

/** Une rubrique du premier niveau : un titre, une phrase, ses pages dans l'ordre. */
export interface GroupeDeReglages {
  cle: string;
  titre: string;
  /** Ce que la rubrique contient, en une phrase (clé du dictionnaire). */
  phrase: string;
  pages: PageDeReglages[];
}

export const ARBORESCENCE_REGLAGES: readonly GroupeDeReglages[] = [
  {
    cle: 'moi',
    titre: 'Moi',
    phrase: 'Votre compte, l’apparence et les notifications.',
    pages: [
      {
        cle: 'mon-compte',
        titre: 'Mon compte',
        // …ET LES ACCÈS TIERS À BELUGA (l'ancien onglet « Sous-comptes ») : une
        // grille de droits par projet et par service. Les comptes clients se
        // créent depuis la messagerie, jamais ici. La visite guidée y est réunie.
        motsCles: [
          'profil', 'mot de passe', 'identifiant', 'courriel', 'mail', 'pseudo', 'nom', 'connexion', 'adresse',
          'accès', 'sous-comptes', 'équipe', 'collaborateur', 'droits', 'invitation', 'utilisateur', 'permission',
          'visite guidée', 'aide', 'tutoriel',
        ],
        libelles: ['Nom affiché', 'Adresse de courriel', 'Identifiant de connexion', 'Changer mon mot de passe', 'Accès à Beluga', 'Ouvrir un accès', 'Revoir la visite guidée'],
      },
      {
        // Thème et langue réunis : l'ancienne page « Langue » y mène.
        cle: 'theme',
        titre: 'Apparence et langue',
        motsCles: [
          'sombre', 'clair', 'couleur', 'thème', 'apparence', 'nuit', 'noir', 'blanc',
          'langue', 'français', 'english', 'anglais', 'deutsch', 'allemand', 'español', 'espagnol', '中文', 'chinois', 'traduction', 'language',
        ],
        libelles: ['Langue'],
      },
      {
        cle: 'notifications',
        titre: 'Notifications',
        motsCles: ['notification', 'alerte', 'silence', 'prévenir', 'sonnerie', 'appareil', 'appareils', 'téléphone', 'iphone', 'push', 'activer', 'désactiver', 'connecté'],
        libelles: ['Notifications sur cet appareil', 'Vos appareils connectés', 'Ce dont on vous prévient', 'Heures de silence'],
      },
    ],
  },
  {
    cle: 'agents-ia',
    titre: 'Agents et IA',
    phrase: 'Les moteurs, leurs quotas, ce qu’ils coûtent et comment ils travaillent.',
    pages: [
      {
        cle: 'comptes',
        titre: 'Comptes et quotas',
        motsCles: ['quota', 'compte', 'claude', 'codex', 'cursor', 'connexion', 'limite', 'moteur'],
      },
      {
        cle: 'consommation',
        titre: 'Consommation',
        motsCles: ['dépense', 'coût', 'jetons', 'facture', 'usage', 'multiplicateur', 'coefficient', 'prix', 'tarif'],
        libelles: ['Multiplicateur du coût des jetons'],
      },
      {
        cle: 'agents-paralleles',
        titre: 'Agents en parallèle',
        motsCles: ['plafond', 'parallèle', 'heures creuses', 'tâche lourde', 'simultané'],
        libelles: ["Plafond d'agents", 'Heures creuses'],
      },
      {
        // L'assistant (nom, voix du direct) et la dictée, réunis : l'ancienne page « Voix » y mène.
        cle: 'assistant',
        titre: 'Assistant et voix',
        motsCles: ['assistant', 'nom', 'voix', 'micro', 'dictée', 'parler', 'écoute', 'raccourci', 'direct'],
      },
      {
        cle: 'services-creation',
        titre: 'Services de création',
        motsCles: ['vidéo', 'image', 'clé', 'kie', 'kie.ai', 'higgsfield', 'byteplus', 'seedance', 'freepik', 'magnific', 'krea', 'runway', 'fal', 'replicate', 'openrouter', 'modèle', 'génération'],
      },
      {
        cle: 'juge-rapide',
        titre: 'Juge rapide',
        avance: true,
        motsCles: ['jev', 'typesafe', 'juge', 'jugement', 'avis', 'signal', 'urgence', 'niveau', 'local'],
        libelles: ['Le modèle local', 'Ce que le juge décide', 'Les jugements rendus'],
      },
    ],
  },
  {
    cle: 'ordinateurs',
    titre: 'Ordinateurs',
    phrase: 'Où les agents travaillent : vos ordinateurs, reliés par Beluga Connect.',
    pages: [
      {
        // UNE SEULE PAGE (carte « Beluga Connect : installation simplifiée », 21/11/2026 ; « Liaison d'ordinateur
        // simplifiée », 22/11/2026) : la liste avec « Ajouter cet ordinateur » et son bouton « Lier » (parcours en
        // étapes empilées), la page de chaque ordinateur (Autorisations, Confirmations, Beluga Connect, Navigateurs,
        // Accès du Mac), puis les sites et les gestes répétés. « beluga-connect » et « navigateur » y mènent.
        cle: 'ordinateurs',
        titre: 'Vos ordinateurs',
        motsCles: [
          'ordinateur', 'mac', 'pc', 'windows', 'linux', 'relier', 'connecter', 'droits', 'piloter', 'installer', 'ajouter', 'délier',
          'beluga connect', 'connect', 'application', 'autorisations', 'lier', 'confirmations', 'accessibilité', 'enregistrement de l’écran', 'télécharger',
          'extension', 'chrome', 'safari', 'navigateur', 'onglet', 'site', 'lecture seule', 'geste répété', 'panneau latéral',
        ],
        libelles: ['Ajouter cet ordinateur', 'Autorisations', 'Confirmations', 'Accès du Mac', 'Sites', 'Gestes répétés'],
      },
    ],
  },
  {
    cle: 'serveur',
    titre: 'Serveur',
    phrase: 'La machine, sa mise à jour, son adresse et ses fonctions.',
    pages: [
      {
        // La fiche, les courbes, les plus lourds et la capacité (« capacite » y mène).
        cle: 'serveur',
        titre: 'La machine',
        motsCles: ['serveur', 'démon', 'capacité', 'mémoire', 'charge', 'processus', 'place', 'disque', 'saturé', 'cpu', 'processeur', 'ram', 'ip', 'adresse ip', 'vcpu', 'stockage', 'explorateur', 'fichiers', 'dossiers', 'ménage', 'version'],
        libelles: ['Capacité du système', 'Ce qui pèse le plus', 'Parcourir les dossiers'],
      },
      {
        // Récupérer les nouveautés : la machine source et l'offre hébergée y lisent pourquoi elles n'ont rien à récupérer.
        cle: 'mise-a-jour',
        titre: 'Mise à jour',
        motsCles: ['mise à jour', 'mettre à jour', 'nouveautés', 'version', 'dépôt public', 'changelog', 'vérifier', 'upgrade'],
        libelles: ['Mettre à jour', 'Vérifier maintenant'],
      },
      {
        // Adresse, nom de domaine des projets et courriels (sortis de l'ancienne page « Installation »).
        cle: 'adresse',
        titre: 'Adresse et courriels',
        motsCles: ['domaine', 'adresse', 'courriel', 'email', 'resend', 'expédition', 'url', 'sous-domaine'],
        libelles: ['Adresse de Beluga Build', 'Nom de domaine des projets', 'Adresse d’expédition'],
      },
      {
        // Mémoire, espace client, compétences et fonctions facultatives (ancienne page « Installation »).
        cle: 'fonctions',
        titre: 'Fonctions',
        motsCles: ['mémoire', 'espace client', 'compétences', 'fonctions', 'facultatif', 'mise en route', 'installation', 'copie'],
        libelles: ['Nom de l’espace client'],
      },
      {
        // Redémarrer, terminal, arrêt général : ce qui agit sur la machine entière.
        cle: 'gestes-serveur',
        titre: 'Gestes sur le serveur',
        avance: true,
        motsCles: ['redémarrer', 'redémarrage', 'relancer', 'terminal', 'console', 'arrêter', 'stop', 'agents', 'shell'],
        libelles: ['Redémarrer le serveur', 'Terminal du serveur', 'Arrêter tous les agents'],
      },
      {
        cle: 'erreurs',
        titre: 'Dernières erreurs de l’interface',
        avance: true,
        motsCles: ['erreur', 'plantage', 'journal', 'page blanche', 'bug'],
      },
    ],
  },
  {
    cle: 'donnees',
    titre: 'Données',
    phrase: 'Sauvegardes, backups des sites, export et projets réunis.',
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
      {
        cle: 'projets',
        titre: 'Projets réunis',
        motsCles: ['projet', 'réunir', 'fusionner', 'regrouper', 'séparer', 'dépôt', 'sous-groupe', 'tableau commun', 'projects'],
        libelles: ['Réunir des projets'],
      },
    ],
  },
  {
    cle: 'connexions',
    titre: 'Connexions',
    phrase: 'GitHub, Beluga Pass et les accès des services extérieurs.',
    pages: [
      {
        cle: 'github',
        titre: 'GitHub',
        motsCles: ['github', 'jeton', 'token', 'dépôt', 'repo', 'clé', 'gh', 'réinitialiser', 'compte'],
        libelles: ['Réinitialiser le jeton'],
      },
      {
        // La liaison avec Beluga Pass, le gestionnaire de mots de passe (16/11/2026 — elle vivait dans le coffre-fort).
        cle: 'belugapass',
        titre: 'Beluga Pass',
        motsCles: ['beluga pass', 'belugapass', 'mots de passe', 'gestionnaire', 'relier', 'liaison', 'clé de liaison', 'sauvegarde chiffrée', 'accès des agents', 'coffre'],
        libelles: ['Relier Beluga Pass', 'Accès des agents', 'Sauvegarde chiffrée', 'Délier Beluga Pass'],
      },
      {
        cle: 'acces-api',
        titre: 'Accès API',
        avance: true,
        motsCles: ['api', 'clé', 'jeton', 'webhook', 'service extérieur'],
      },
    ],
  },
];

/**
 * LES ANCIENNES CLÉS DE PAGE ET LEUR NOUVELLE PLACE. Un lien, un bouton
 * (`beluga:ouvrir-reglages`) ou une adresse `#reglages/<page>` écrits avant la
 * refonte doivent mener quelque part : un écran vide passerait pour une panne.
 */
export const ALIAS_DES_PAGES_DE_REGLAGES: Readonly<Record<string, string>> = {
  capacite: 'serveur',
  langue: 'theme',
  voix: 'assistant',
  extension: 'ordinateurs',
  'beluga-connect': 'ordinateurs',
  navigateur: 'ordinateurs',
  installation: 'adresse',
};

/** La clé ACTUELLE d'une page : une ancienne clé suit son alias, une clé à jour reste telle quelle. */
export function cleActuelleDeLaPage(cle: string): string {
  return ALIAS_DES_PAGES_DE_REGLAGES[cle] ?? cle;
}

/** La rubrique qui porte une page (anciennes clés comprises) ; `undefined` si aucune. */
export function rubriqueDeLaPage(
  groupes: readonly GroupeDeReglages[],
  cle: string,
): GroupeDeReglages | undefined {
  const actuelle = cleActuelleDeLaPage(cle);
  return groupes.find((groupe) => groupe.pages.some((page) => page.cle === actuelle));
}
