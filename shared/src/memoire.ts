/**
 * La mémoire du projet, côté RÈGLES (PLAN §25). Ce module ne touche ni au
 * disque ni à la base : il décide seulement de ce qui est un fait durable, de
 * ce qui n'est qu'une ligne de journal, du sujet d'un fait et de sa forme
 * courte. Il est donc lisible et testable seul.
 *
 * Deux niveaux :
 *  — l'INDEX (une ligne brève par fait, groupée par sujet) part au lancement
 *    de chaque agent : c'est peu de texte et cela suffit à savoir qu'un piège
 *    existe ;
 *  — le TEXTE COMPLET d'un fait reste disponible à la demande, par l'outil de
 *    mémoire, quand le sujet concerne vraiment la tâche en cours.
 */

/** Un sujet de classement, avec les mots qui le désignent. */
export interface SujetMemoire {
  id: string;
  libelle: string;
  mots: string[];
}

/**
 * Les sujets sont volontairement peu nombreux : au-delà d'une dizaine, l'index
 * redevient une liste à plat. L'ordre compte — le premier sujet dont un mot
 * apparaît l'emporte, les plus spécifiques sont donc placés avant.
 */
export const SUJETS_MEMOIRE: SujetMemoire[] = [
  {
    id: 'memoire',
    libelle: 'Mémoire et contexte des agents',
    mots: [
      'mémoire', 'contexte envoyé', 'briefing', 'gabarit', 'claude.md', 'agents.md',
      'liste de tâches', 'todowrite', 'synthèse', 'historique', 'compte rendu',
    ],
  },
  {
    id: 'quotas',
    libelle: 'Quotas, comptes et coûts',
    mots: [
      'quota', 'fenêtre de cinq heures', 'amorce', 'amorçage', 'amorcer', 'comptes', 'jeton', 'jetons',
      'consommation', 'facturation', 'facture', 'modèle', 'catalogue', 'capacité', 'dépense',
    ],
  },
  {
    id: 'publication',
    libelle: 'Publication et branches',
    mots: [
      'publication', 'publier', 'publie', 'déploie', 'déploiement', 'branche', 'fusion', 'conflit',
      'commit', 'worktree', 'data/live', 'redémarrage', 'redémarrer', 'démon', 'service',
    ],
  },
  {
    id: 'mobile',
    libelle: 'Téléphone',
    mots: [
      'téléphone', 'mobile', 'tiroir', 'clavier', 'doigt', 'appui long', 'safe-area', 'dvh',
      'visualviewport', 'panneau latéral', 'creux',
    ],
  },
  {
    id: 'tableau',
    libelle: 'Tableau et cartes',
    mots: [
      'carte', 'cartes', 'colonne', 'tableau', 'kanban', 'glissement', 'glisser', 'archiver',
      'archivage', 'clôture', 'clôturer', 'badge', 'voyant', 'menu', 'projet', 'projets',
    ],
  },
  {
    id: 'conversation',
    libelle: 'Conversation et messages',
    mots: [
      'conversation', 'message', 'messages', 'composeur', 'barre d\'écriture', 'brouillon', 'fil',
      'pièce jointe', 'pièces jointes', 'sommaire', 'déroulé', 'copier', 'dictée',
    ],
  },
  {
    id: 'voix',
    libelle: 'Voix et point du jour',
    mots: ['voix', 'vocal', 'vocale', 'écoute', 'transcription', 'point du jour', 'notification', 'alerte', 'son'],
  },
  {
    id: 'interface',
    libelle: 'Interface',
    mots: [
      'thème', 'sombre', 'contraste', 'bordure', 'onglet', 'onglets', 'bouton', 'formulaire',
      'champ', 'réglages', 'affichage', 'écran', 'couleur', 'marge',
    ],
  },
  { id: 'divers', libelle: 'Divers', mots: [] },
];

const SUJET_PAR_DEFAUT = 'divers';

/**
 * Une ligne de JOURNAL : « 03.08.2026 : « telle tâche » livrée et publiée. »
 * Ces lignes racontent l'histoire du projet, elles n'apprennent rien à un agent
 * qui commence une tâche — elles vivent donc dans l'historique, pas dans ce qui
 * part au moteur.
 */
export function estLigneDeJournal(texte: string): boolean {
  const clean = nettoyer(texte);
  // Une date en tête, suivie de deux points : la forme écrite à la clôture.
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*[:–-]/.test(clean)) return true;
  // La même chose écrite en toutes lettres, avec le verbe de clôture.
  return /^\d{1,2}\s+\w+\s+\d{4}\s*[:–-]/.test(clean) && /(livré|publié|clôtur)/i.test(clean);
}

/** Le texte d'un fait, sans sa puce ni ses espaces de bord. */
export function nettoyer(texte: string): string {
  return texte.replace(/^\s*[-*]\s*/, '').trim();
}

/** Le sujet d'un fait : le premier sujet dont un mot apparaît dans le texte. */
export function sujetDuFait(texte: string): string {
  const needle = nettoyer(texte).toLowerCase();
  for (const sujet of SUJETS_MEMOIRE) {
    if (sujet.mots.some((mot) => needle.includes(mot))) return sujet.id;
  }
  return SUJET_PAR_DEFAUT;
}

export function libelleSujet(id: string): string {
  return SUJETS_MEMOIRE.find((s) => s.id === id)?.libelle ?? 'Divers';
}

const LONGUEUR_INDEX = 110;

/**
 * La forme courte d'un fait : de quoi RECONNAÎTRE le sujet, pas de quoi s'en
 * servir. La plupart des faits sont écrits « la règle : la raison » — on garde
 * la règle, la raison se lit à la demande.
 */
export function resumerFait(texte: string, longueur = LONGUEUR_INDEX): string {
  let clean = nettoyer(texte).replace(/\s+/g, ' ');

  // Une explication introduite par « : » ou « — » : la règle seule suffit —
  // à condition que cette règle se tienne debout toute seule. Coupée trop tôt,
  // la ligne ne dit plus rien ; on préfère alors la tronquer à la longueur.
  const coupe = clean.search(/\s[:—]\s/);
  if (coupe > 70) clean = clean.slice(0, coupe);
  // Sinon, la première phrase.
  else {
    const point = clean.search(/\.\s+[A-ZÀ-Þ«]/);
    if (point > 40) clean = clean.slice(0, point + 1);
  }

  if (clean.length <= longueur) return clean.replace(/[.,;]$/, '');
  // On coupe sur un mot entier, jamais au milieu.
  const tronque = clean.slice(0, longueur);
  const espace = tronque.lastIndexOf(' ');
  return `${(espace > 40 ? tronque.slice(0, espace) : tronque).replace(/[.,;]$/, '')}…`;
}

export interface FaitIndexe {
  /** Le rang du fait dans la mémoire, à partir de 1 : sert à en demander le détail. */
  numero: number;
  sujet: string;
  texte: string;
  resume: string;
}

/** Les faits, numérotés et classés par sujet. */
export function indexerFaits(faits: string[]): FaitIndexe[] {
  return faits.map((texte, i) => ({
    numero: i + 1,
    sujet: sujetDuFait(texte),
    texte: nettoyer(texte),
    resume: resumerFait(texte),
  }));
}

/**
 * L'index tel qu'il part au moteur : les sujets, puis une ligne brève par fait.
 * Chaque ligne porte son numéro, c'est ainsi qu'on en redemande le texte entier.
 */
export function texteIndex(faits: string[]): string {
  const indexes = indexerFaits(faits);
  if (!indexes.length) return '';

  const lignes: string[] = [];
  for (const sujet of SUJETS_MEMOIRE) {
    const dedans = indexes.filter((f) => f.sujet === sujet.id);
    if (!dedans.length) continue;
    lignes.push(`${sujet.libelle} :`);
    for (const fait of dedans) lignes.push(`  ${fait.numero}. ${fait.resume}`);
    lignes.push('');
  }
  return lignes.join('\n').trim();
}

/**
 * Ce qu'on demande à l'outil de mémoire : un numéro, un sujet, ou des mots.
 * Un numéro rend le fait entier ; un sujet rend tous les faits du sujet ; des
 * mots rendent les faits qui les contiennent.
 */
export function chercherFaits(faits: string[], requete: string): FaitIndexe[] {
  const indexes = indexerFaits(faits);
  const demande = requete.trim().toLowerCase();
  if (!demande) return indexes;

  // Une liste de numéros : « 12 », « 3, 8, 40 ».
  const numeros = demande.match(/\d+/g);
  if (numeros && /^[\d\s,;etu]+$/i.test(demande)) {
    const voulus = new Set(numeros.map((n) => Number(n)));
    const trouves = indexes.filter((f) => voulus.has(f.numero));
    if (trouves.length) return trouves;
  }

  // Un sujet, par son identifiant ou son libellé.
  const sujet = SUJETS_MEMOIRE.find(
    (s) => s.id === demande || s.libelle.toLowerCase() === demande || demande.includes(s.id),
  );
  if (sujet) {
    const trouves = indexes.filter((f) => f.sujet === sujet.id);
    if (trouves.length) return trouves;
  }

  // Sinon : les mots de la demande, tous présents dans le fait.
  const mots = demande.split(/[^a-zà-ÿ0-9]+/i).filter((m) => m.length > 3);
  if (!mots.length) return [];
  return indexes.filter((f) => {
    const texte = f.texte.toLowerCase();
    return mots.every((mot) => texte.includes(mot));
  });
}

/** Le seuil au-delà duquel la mémoire mérite une relecture par un petit modèle. */
export const SEUIL_SYNTHESE = { faits: 60, signes: 14000 };

export function doitSynthetiser(
  faits: string[],
  seuil: { faits: number; signes: number } = SEUIL_SYNTHESE,
): boolean {
  if (faits.length > seuil.faits) return true;
  return faits.reduce((total, f) => total + f.length, 0) > seuil.signes;
}

/**
 * Le garde-fou de la synthèse : un petit modèle peut se tromper, la mémoire ne
 * doit jamais fondre d'un coup. On refuse une réécriture qui perd plus de la
 * moitié des faits, qui n'en retire aucun, ou qui rend des lignes vides.
 */
export function syntheseAcceptable(avant: string[], apres: string[]): { ok: boolean; raison?: string } {
  const propres = apres.map(nettoyer).filter(Boolean);
  if (!propres.length) return { ok: false, raison: 'aucun fait rendu' };
  if (propres.length > avant.length) return { ok: false, raison: 'la synthèse est plus longue que la mémoire' };
  if (propres.length < Math.ceil(avant.length * 0.5))
    return { ok: false, raison: 'plus de la moitié des faits auraient disparu' };
  if (propres.some((l) => l.length < 15)) return { ok: false, raison: 'une ligne est trop courte pour être un fait' };
  return { ok: true };
}
