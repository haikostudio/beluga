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
 *
 * Le texte complet ne vit plus dans un seul fichier plat : il est RANGÉ PAR
 * SUJET dans `docs/memoire/<sujet>.md`, sur le modèle de `docs/regles/`. Un
 * agent reçoit l'index général, puis ouvre le SEUL fichier de son sujet — on ne
 * charge jamais la mémoire entière, ni au lancement ni à la reprise.
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

/* ------------------------------------------------------------------ */
/* Un fichier par sujet                                                */
/* ------------------------------------------------------------------ */

/** Le dossier où vivent les faits, un fichier par sujet, comme `docs/regles/`. */
export const DOSSIER_MEMOIRE = 'docs/memoire';

/** Le fichier d'un sujet, relatif à la racine du projet. */
export function fichierDuSujet(id: string): string {
  return `${DOSSIER_MEMOIRE}/${id}.md`;
}

/** Les faits écrits dans un fichier de mémoire : les lignes à puce, nettoyées. */
export function faitsDuTexte(texte: string): string[] {
  return texte
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => /^[-*]\s+/.test(ligne))
    .map(nettoyer)
    .filter(Boolean);
}

/**
 * Les faits rangés par sujet, dans l'ordre des sujets. Sert au découpage comme
 * à la réécriture après synthèse : un seul endroit décide où va un fait.
 */
export function repartirParSujet(faits: string[]): Map<string, string[]> {
  const parSujet = new Map<string, string[]>();
  for (const fait of faits) {
    const propre = nettoyer(fait);
    if (!propre) continue;
    const sujet = sujetDuFait(propre);
    const dedans = parSujet.get(sujet) ?? [];
    if (!dedans.some((f) => f.toLowerCase() === propre.toLowerCase())) dedans.push(propre);
    parSujet.set(sujet, dedans);
  }
  // L'ordre des sujets, jamais celui d'arrivée : la numérotation de l'index en dépend.
  const ordonne = new Map<string, string[]>();
  for (const sujet of SUJETS_MEMOIRE) {
    const dedans = parSujet.get(sujet.id);
    if (dedans?.length) ordonne.set(sujet.id, dedans);
  }
  return ordonne;
}

/* ------------------------------------------------------------------ */
/* Les sujets utiles à un travail donné                                */
/* ------------------------------------------------------------------ */

/**
 * Au-delà de trois sujets, une reprise recharge presque toute la mémoire : ce
 * qu'on cherchait précisément à éviter.
 */
export const SUJETS_UTILES_MAX = 3;

/**
 * Les sujets de mémoire que TOUCHE un travail donné — titre de carte,
 * description, rôle de l'agent réunis en un seul texte. C'est la règle de la
 * reprise après compression : on ne recharge que ces fichiers-là, jamais la
 * mémoire entière. Le chef d'orchestre et l'agent de tâche passent par la même
 * fonction : seul le TEXTE qu'on lui donne diffère, jamais le traitement.
 */
export function sujetsUtiles(texte: string, max = SUJETS_UTILES_MAX): string[] {
  const cible = texte.toLowerCase();
  if (!cible.trim()) return [];

  const scores = SUJETS_MEMOIRE.filter((sujet) => sujet.mots.length)
    .map((sujet, rang) => ({
      id: sujet.id,
      rang,
      poids: sujet.mots.filter((mot) => cible.includes(mot)).length,
    }))
    .filter((s) => s.poids > 0);

  scores.sort((a, b) => b.poids - a.poids || a.rang - b.rang);
  return scores.slice(0, Math.max(0, max)).map((s) => s.id);
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
 * LE SOMMAIRE DES SUJETS — la CARTE de la mémoire, sans son territoire.
 *
 * Depuis que la recherche remonte des PASSAGES à la place de l'index, l'agent
 * reçoit quelques extraits bien placés… et plus aucune vue d'ensemble. Or la
 * méthode de travail lui dit d'appeler `project_memory` « pour le SUJET de ta
 * tâche » : sans la liste des sujets qui existent, il devine un nom, se trompe,
 * et travaille sur ce qu'il a sous les yeux au lieu de ce que le projet sait.
 *
 * Le sommaire ne coûte qu'une ligne par sujet — le nom et le nombre de faits —
 * là où l'index en coûte une par fait. C'est la seule part de l'index qu'on
 * remet, et c'est celle qui rend l'outil utilisable.
 */
export function sommaireDesSujets(faits: string[]): { id: string; libelle: string; faits: number }[] {
  const indexes = indexerFaits(faits);
  return SUJETS_MEMOIRE.map((sujet) => ({
    id: sujet.id,
    libelle: sujet.libelle,
    faits: indexes.filter((f) => f.sujet === sujet.id).length,
  })).filter((sujet) => sujet.faits > 0);
}

/** Le sommaire écrit pour le moteur : les sujets qu'il peut demander, et leur poids. */
export function texteDuSommaire(faits: string[]): string {
  const sujets = sommaireDesSujets(faits);
  if (!sujets.length) return '';
  return (
    `LES SUJETS DE LA MÉMOIRE DE CE PROJET (${faits.length} faits en tout), à demander par leur NOM ` +
    `avec « project_memory » — un sujet rend d'un coup ses FAITS, ses RÈGLES et ses CONTRÔLES :\n` +
    sujets.map((s) => `- « ${s.id} » (${s.libelle}) — ${s.faits} fait${s.faits > 1 ? 's' : ''}`).join('\n')
  );
}

/**
 * Le SUJET visé par une demande, quand elle en nomme un. C'est lui qui permet
 * de ne pas resservir deux fois le même fichier dans une session : une demande
 * qui ne vise aucun sujet précis (un numéro, des mots) n'est jamais dédoublonnée.
 */
export function sujetDeLaRequete(requete: string): SujetMemoire | undefined {
  const demande = requete.trim().toLowerCase();
  if (!demande) return undefined;
  return SUJETS_MEMOIRE.find(
    (s) => s.id === demande || s.libelle.toLowerCase() === demande || demande.includes(s.id),
  );
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
  const sujet = sujetDeLaRequete(demande);
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
