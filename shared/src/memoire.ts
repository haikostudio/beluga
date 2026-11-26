/**
 * La mémoire du projet, côté RÈGLES (PLAN §25). Ce module ne touche ni au
 * disque ni à la base : il décide des sujets qui existent et les rend
 * comparables. Il est donc lisible et testable seul.
 *
 * La mémoire d'un projet est une base de connaissances (outil `memoire`). Les
 * sujets de `SUJETS_MEMOIRE` sont toujours connus du rangement de nuit des
 * instructions, en plus de ceux que portent déjà les unités du projet.
 *
 * Les anciens noms de sujets ne disparaissent pas : la table `ANCIENS_SUJETS`
 * ramène à son sujet réel une règle déposée sous l'un d'eux.
 */

/** Un sujet de classement, avec les mots qui le désignent. */
export interface SujetMemoire {
  id: string;
  libelle: string;
  /** Les mots qui désignent ce sujet. */
  mots: string[];
  /** Le titre long des contrôles de ce sujet. Absent pour « divers ». */
  controles?: string;
}

/**
 * Les sujets sont volontairement peu nombreux : au-delà d'une dizaine, le
 * classement redevient une liste à plat.
 */
export const SUJETS_MEMOIRE: SujetMemoire[] = [
  {
    id: 'methode',
    libelle: 'Méthode, moteurs, outils et mémoire',
    controles: 'Méthode, moteurs et outils',
    mots: [
      'mémoire', 'contexte envoyé', 'briefing', 'gabarit', 'claude.md', 'agents.md', 'liste de tâches',
      'todowrite', 'synthèse', 'historique', 'compte rendu', 'méthode', 'codex', 'cursor', 'compétence',
      'coffre-fort', 'identifiant', 'mot de passe', 'reprise', 'compression', 'facturation', 'compta', 'vps',
      '.gitignore', 'gitignore', 'rev-parse', 'cherry-pick', 'npm install', 'npm run build', 'npm run dev',
      'outils tiers', 'terminal', 'tmux', 'rollup', 'barrel', 'migration', 'taskcreate', 'todowrite tool',
      'project_memory', 'agents suspendus', 'swap', 'compactage', 'rangement de nuit', 'télémétrie', 'décor',
      'apostrophes droites', 'slash.list', 'commandes/slash',
    ],
  },
  {
    id: 'quotas',
    libelle: 'Quotas, comptes et modèles',
    controles: 'Quotas, comptes et modèles',
    mots: [
      'quota', 'fenêtre de cinq heures', 'amorce', 'amorçage', 'amorcer', 'comptes', 'jeton', 'jetons',
      'consommation', 'facture', 'modèle', 'catalogue', 'capacité', 'dépense', 'tableau de bord', 'prévision',
      "mur d'accès", 'intensité', 'pickaccount', 'compte tour', 'limites-connues', 'manque crédit',
    ],
  },
  {
    id: 'publication',
    libelle: 'Publication',
    controles: 'Publication',
    mots: [
      'publication', 'publier', 'publie', 'déploie', 'déploiement', 'déployer', 'mise en ligne',
      'mise en production', 'production', 'construction', 'recompil', 'redémarr', 'conflit', 'fusion',
      'commit', 'data/live', 'démon', 'service', 'prompt', 'systemd', 'base servie', 'beluga.db',
      'courriel', 'resend',
    ],
  },
  {
    id: 'branches',
    libelle: 'Branches et dossiers',
    controles: 'Branches et dossiers',
    mots: [
      'branche', 'worktree', 'tache/', 'hors-tache', 'copie de travail', 'copie travail', 'copies travail',
      'dossier de travail', 'fusionne',
    ],
  },
  {
    id: 'voix',
    libelle: 'Voix et écoute',
    controles: 'Voix et écoute',
    mots: [
      'voix', 'vocal', 'vocale', 'écoute', 'transcription', 'point du jour', 'réveil', 'dis haiko', 'piper',
      'kokoro', 'dictée', 'micro', 'onde', 'raccourci',
    ],
  },
  {
    id: 'cartes',
    libelle: 'Cartes et tableau',
    controles: 'Cartes',
    mots: [
      'carte', 'cartes', 'colonne', 'tableau', 'kanban', 'glissement', 'glisser', 'archiver', 'archivage',
      'clôture', 'clôturer', 'badge', 'voyant', 'chef', 'propose', 'proposition', 'chiffrage', 'analyse',
      'pause', 'arrêt', 'arrêter', 'lot', 'à faire', 'terminé', 'planifié', 'archivé', 'étape', 'cadrage', 'plan',
      'drapeau poursuite', 'parcours', 'vignette',
    ],
  },
  {
    id: 'projets',
    libelle: 'Projets',
    controles: 'Projets',
    mots: [
      'projet', 'projets', 'monter', 'montage', 'adresse publique', 'sous-domaine', 'dépôt de travail',
      'mis de côté', 'archive', 'ssh', 'backup', 'backups', 'recette', 'restauration', 'sauvegarde',
      'archive zip',
    ],
  },
  {
    id: 'interface',
    libelle: 'Interface, téléphone et conversation',
    controles: 'Interface, téléphone et notifications',
    mots: [
      'téléphone', 'mobile', 'tiroir', 'clavier', 'doigt', 'appui long', 'safe-area', 'dvh', 'visualviewport',
      'panneau latéral', 'creux', 'conversation', 'message', 'messages', 'composeur', "barre d'écriture",
      'brouillon', 'fil', 'pièce jointe', 'pièces jointes', 'sommaire', 'déroulé', 'copier', 'thème', 'sombre',
      'contraste', 'bordure', 'onglet', 'onglets', 'bouton', 'formulaire', 'champ', 'réglages', 'affichage',
      'écran', 'couleur', 'marge', 'interface', 'zonedefilement', 'défile', 'défilement', 'fondu',
      'notification', 'alerte', 'décision', 'pile', 'menu', 'infobulle', 'bandeau', 'filet',
      'arrondis', 'rounded', 'bloc demande', 'cloche', 'navigateur', 'débordement flex', 'min-w-0', 'palette',
      '#09090b', 'mode simple', 'serveur de dev', 'surveillance', 'silhouette',
    ],
  },
  { id: 'divers', libelle: 'Divers', mots: [] },
];

/**
 * LES ANCIENS NOMS DE SUJETS, ramenés à leur sujet réel. La mémoire des projets
 * a été rangée pendant un mois sous des sujets (conversation, tableau, mobile,
 * memoire, cadrage, general) dont les invariants vivaient sous un autre. Sans
 * cette table, une règle déposée sous l'un de ces noms serait rangée au mauvais
 * endroit.
 *
 * Elle s'applique au rangement de nuit des instructions
 * (`shared/src/instructions-en-attente.ts`).
 */
export const ANCIENS_SUJETS: Readonly<Record<string, string>> = {
  memoire: 'methode',
  general: 'methode',
  tableau: 'cartes',
  cadrage: 'cartes',
  conversation: 'interface',
  mobile: 'interface',
};


/** Le texte d'un fait, sans sa puce ni ses espaces de bord. */
export function nettoyer(texte: string): string {
  return texte.replace(/^\s*[-*]\s*/, '').trim();
}



