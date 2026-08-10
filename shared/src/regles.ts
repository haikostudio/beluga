/**
 * La mémoire du projet, côté RÈGLES et CONTRÔLES.
 *
 * Comme pour les faits (voir `memoire.ts`), le texte entier ne part plus en bloc
 * au lancement d'un agent : les règles vivent PAR SUJET dans `docs/regles/`, les
 * contrôles dans `docs/verifications.md`, et l'outil `project_memory` en rend le
 * sujet touché par la tâche. Ce module ne touche ni au disque ni à la base : il
 * décide seulement QUELS sujets répondent à une demande, et sait repérer les
 * règles qui contiennent des mots. Il est donc lisible et testable seul.
 */

/** Un sujet de règles : son identifiant, son libellé, son fichier, ses mots. */
export interface SujetRegles {
  id: string;
  libelle: string;
  fichier: string;
  mots: string[];
}

/**
 * Les huit sujets, dans l'ordre où on les cite. Les mots servent à retrouver un
 * sujet depuis une demande en langage libre ; l'identifiant et le libellé aussi.
 */
export const SUJETS_REGLES: SujetRegles[] = [
  {
    id: 'publication',
    libelle: 'Publication',
    fichier: 'docs/regles/publication.md',
    mots: [
      'publication', 'publier', 'publie', 'déploie', 'déploiement', 'déployer', 'mise en ligne',
      'mise en production', 'production', 'construction', 'recompil', 'redémarr', 'conflit', 'prompt',
    ],
  },
  {
    id: 'cartes',
    libelle: 'Cartes',
    fichier: 'docs/regles/cartes.md',
    mots: [
      'carte', 'cartes', 'colonne', 'tableau', 'chef', 'propose', 'proposition', 'chiffrage', 'analyse',
      'pause', 'arrêt', 'arrêter', 'lot', 'à faire', 'terminé', 'planifié', 'archivé', 'étape', 'image',
    ],
  },
  {
    id: 'branches',
    libelle: 'Branches et dossiers',
    fichier: 'docs/regles/branches.md',
    mots: ['branche', 'worktree', 'tache/', 'hors-tache', 'copie de travail', 'dossier de travail', 'fusionne'],
  },
  {
    id: 'projets',
    libelle: 'Projets',
    fichier: 'docs/regles/projets.md',
    mots: ['projet', 'projets', 'monter', 'montage', 'adresse publique', 'sous-domaine', 'dépôt de travail', 'mis de côté', 'archive'],
  },
  {
    id: 'interface',
    libelle: 'Interface, téléphone et notifications',
    fichier: 'docs/regles/interface.md',
    mots: [
      'interface', 'zonedefilement', 'défile', 'défilement', 'fondu', 'téléphone', 'mobile', 'notification',
      'décision', 'pile', 'tiroir', 'menu', 'infobulle', 'onglet', 'écran', 'bandeau', 'filet',
    ],
  },
  {
    id: 'voix',
    libelle: 'Voix et écoute',
    fichier: 'docs/regles/voix.md',
    mots: [
      'voix', 'vocal', 'vocale', 'écoute', 'réveil', 'dis haiko', 'synthèse', 'piper', 'kokoro', 'dictée',
      'micro', 'transcription', 'onde', 'raccourci',
    ],
  },
  {
    id: 'quotas',
    libelle: 'Quotas, comptes et modèles',
    fichier: 'docs/regles/quotas.md',
    mots: [
      'quota', 'compte', 'comptes', 'modèle', 'catalogue', 'tableau de bord', 'prévision', 'consommation',
      'cerveau', "mur d'accès", 'intensité',
    ],
  },
  {
    id: 'methode',
    libelle: 'Méthode, moteurs, outils et silence',
    fichier: 'docs/regles/methode.md',
    mots: [
      'méthode', 'identifiant', 'mot de passe', 'clé', 'jeton', 'moteur', 'codex', 'claude', 'outil', 'outils',
      'compétence', 'reprise', 'bridé', 'déroulé', 'longueur', 'chemin', '/home', 'facturation', 'compta', 'vps',
    ],
  },
];

/**
 * Le sujet nommé par son identifiant ou son libellé exact, sinon rien.
 *
 * La distinction compte : NOMMER un sujet est un choix explicite de l'agent, qui
 * lui vaut le fichier ENTIER ; des mots-clés ne décrivent qu'un besoin, et ne
 * valent qu'un extrait (`shared/src/extrait-regles.ts`).
 */
export function sujetNomme(requete: string): SujetRegles | undefined {
  const demande = requete.trim().toLowerCase();
  return SUJETS_REGLES.find((s) => s.id === demande || s.libelle.toLowerCase() === demande);
}

/**
 * Les sujets que touche une demande : d'abord un sujet nommé (identifiant ou
 * libellé), sinon TOUS ceux dont un mot apparaît dans la demande. Plusieurs
 * réponses sont permises — une tâche croise parfois deux sujets — mais un mot
 * précis vaut mieux qu'un mot vague pour ne pas tout ramener.
 */
export function sujetsPourRequete(requete: string): SujetRegles[] {
  const demande = requete.trim().toLowerCase();
  if (!demande) return [];

  const nomme = sujetNomme(requete);
  if (nomme) return [nomme];

  return SUJETS_REGLES.filter((s) => s.mots.some((mot) => demande.includes(mot)));
}

/** Les puces de règles (`- **…`) d'un texte, chacune avec son corps entier. */
export function decouperRegles(texte: string): string[] {
  const lignes = texte.split('\n');
  const regles: string[] = [];
  let courante: string[] | null = null;
  for (const ligne of lignes) {
    if (/^- \*\*/.test(ligne)) {
      if (courante) regles.push(courante.join('\n').trimEnd());
      courante = [ligne];
    } else if (courante) {
      courante.push(ligne);
    }
  }
  if (courante) regles.push(courante.join('\n').trimEnd());
  return regles;
}

/**
 * Les règles qui CONTIENNENT les mots de la demande — le repli quand aucun sujet
 * n'est nommé ni reconnu. On garde les mots de plus de trois lettres et on exige
 * qu'ils soient TOUS présents, comme la recherche des faits.
 */
export function reglesContenant(regles: string[], requete: string): string[] {
  const mots = requete
    .trim()
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9/]+/i)
    .filter((m) => m.length > 3);
  if (!mots.length) return [];
  return regles.filter((r) => {
    const texte = r.toLowerCase();
    return mots.every((mot) => texte.includes(mot));
  });
}
