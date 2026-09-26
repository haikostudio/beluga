import { tailleLisible } from './fichiers-volumineux.js';

/**
 * LE MÉNAGE DU DISQUE — les règles, sans disque ni base.
 *
 * Le serveur n'a que 150 Go, et rien ne se vidait jamais : 13 Go de fichiers
 * temporaires, 4 Go de caches de téléchargement, des restes de construction
 * `*.ancien` abandonnés par des publications, des emplacements de copies de
 * cartes refermées. Tant que les projets vivaient sur le stockage distant, la
 * place locale n'inquiétait personne ; ils sont maintenant ICI, et ce qui
 * s'accumule doit repartir.
 *
 * Ce module DÉCIDE seulement : ce qui peut disparaître, à partir de quel âge,
 * et surtout ce qui ne doit JAMAIS être touché. L'effacement, lui, vit dans
 * `server/src/menage.ts` — qui ne supprime rien sans passer par ici.
 *
 * DEUX PRINCIPES, et aucun troisième :
 *   1. On n'efface QUE ce qui se reconstruit tout seul (caches, temporaires,
 *      restes de construction). Jamais une donnée, jamais une sauvegarde.
 *   2. Dans le doute, on garde. Une protection l'emporte toujours sur une
 *      cible, et un chemin non reconnu n'est pas une cible.
 */

/** Une famille de choses à effacer, avec l'âge à partir duquel elle ne sert plus. */
export interface CibleDeMenage {
  /** Ce qu'on nettoie, en clair — c'est ce qui s'écrit dans le journal. */
  nom: string;
  /** Le dossier parcouru. */
  dossier: string;
  /**
   * `contenu` : les entrées DANS ce dossier partent, le dossier reste.
   * `motif` : seules les entrées dont le nom correspond partent.
   * `videSeulement` : seules les entrées vides partent.
   */
  genre: 'contenu' | 'motif' | 'videSeulement';
  /** Pour `motif` : le nom doit finir par l'un de ces suffixes. */
  suffixes?: string[];
  /** Âge minimal, en jours, avant qu'une entrée puisse partir. */
  ageMinJours: number;
  /** Pourquoi ça peut partir sans rien casser. */
  raison: string;
}

/** Le jour, en millisecondes — un âge se raisonne en jours, pas en nombres magiques. */
export const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * CE QU'ON NE TOUCHE JAMAIS, quoi qu'il arrive.
 *
 * Les pièces jointes et la base sont les DONNÉES du produit : elles ne se
 * reconstruisent pas. Les sauvegardes sont le dernier filet. Les fichiers
 * d'échange mémoire (`swapfile`) tiennent la machine debout. Le montage
 * distant, enfin, porte tout ce qui précède — un ménage qui s'y promène
 * effacerait la sauvegarde qu'il est censé protéger.
 */
const PROTEGES = [
  '/mnt/sauvegardes',
  '/swapfile',
  '/swapfile2',
  '/etc',
  '/boot',
  '/usr',
  '/var/lib',
];

/** Les noms qui, où qu'ils soient, interdisent l'effacement. */
const NOMS_PROTEGES = ['attachments', 'beluga.db', 'beluga.db-wal', 'beluga.db-shm', 'live', 'backups', 'Backups'];

function normaliser(chemin: string): string {
  const propre = (chemin ?? '').trim().replace(/\/+$/, '');
  return propre || '/';
}

/** Ce chemin est-il, lui ou l'un de ses parents, une chose qu'on ne touche jamais ? */
export function estProtege(chemin: string, protegesEnPlus: readonly string[] = []): boolean {
  const cible = normaliser(chemin);
  if (cible === '/' || cible === '/root' || cible === '/home') return true;
  for (const protege of [...PROTEGES, ...protegesEnPlus]) {
    const p = normaliser(protege);
    if (cible === p || cible.startsWith(`${p}/`)) return true;
  }
  return cible.split('/').some((segment) => NOMS_PROTEGES.includes(segment));
}

/** Cette entrée a-t-elle dépassé l'âge où elle cesse de servir ? */
export function assezVieux(derniereModification: number, maintenant: number, ageMinJours: number): boolean {
  if (!Number.isFinite(derniereModification) || derniereModification <= 0) return false;
  return maintenant - derniereModification >= ageMinJours * JOUR_MS;
}

/**
 * LES CIBLES, telles que mesurées sur la machine le 21.09.2026 : /tmp 13 Go,
 * ~/.cache 4 Go, ~/.npm 762 Mo, plus les restes de construction et les
 * emplacements de copies déjà refermées.
 *
 * `dossierDuDemon` est le dépôt du démon (ses données vivent dessous),
 * `dossierPersonnel` le compte qui fait tourner les agents.
 */
export function ciblesDeMenage(dossierDuDemon: string, dossierPersonnel: string): CibleDeMenage[] {
  return [
    {
      nom: 'fichiers temporaires',
      dossier: '/tmp',
      genre: 'contenu',
      ageMinJours: 7,
      raison: 'un temporaire que personne n’a rouvert depuis une semaine ne sert plus',
    },
    {
      nom: 'cache des téléchargements de paquets',
      dossier: `${dossierPersonnel}/.npm/_cacache`,
      genre: 'contenu',
      ageMinJours: 30,
      raison: 'le cache se reconstruit au premier téléchargement suivant',
    },
    {
      nom: 'caches d’outils',
      dossier: `${dossierPersonnel}/.cache`,
      genre: 'contenu',
      ageMinJours: 30,
      raison: 'tout y est reconstruit à la demande',
    },
    {
      nom: 'restes de construction',
      dossier: `${dossierDuDemon}/data/versions`,
      genre: 'motif',
      suffixes: ['.ancien', '.tmp'],
      ageMinJours: 3,
      raison: 'un dossier « .ancien » est la version d’avant, déjà remplacée',
    },
    {
      nom: 'emplacements de copies refermées',
      dossier: `${dossierDuDemon}/data/copies`,
      genre: 'videSeulement',
      ageMinJours: 1,
      raison: 'la copie a été retirée ; il ne reste qu’un dossier vide',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Les branches de travail déjà envoyées                               */
/* ------------------------------------------------------------------ */

/** Ce qu'on sait d'une branche locale avant de décider de son sort. */
export interface BrancheLocale {
  nom: string;
  /** Son contenu est-il déjà dans la branche d'intégration ? */
  fusionnee: boolean;
  /** Existe-t-elle sur le dépôt distant, au même point ? */
  surOriginAuMemeSha: boolean;
  /** Un agent travaille-t-il dessus en ce moment ? */
  occupee: boolean;
}

/**
 * UNE BRANCHE NE SE SUPPRIME QUE SI SON TRAVAIL EXISTE AILLEURS.
 *
 * Mesuré le 21.09.2026 sur le dépôt du démon : 162 branches « tache/… »
 * locales, dont 152 déjà fusionnées et 34 seulement présentes sur le dépôt
 * distant. Supprimer « toutes les branches de tâche » aurait donc effacé pour
 * de bon le travail de celles qui ne sont ni fusionnées ni envoyées.
 *
 * La règle est donc : fusionnée OU envoyée au même point. Jamais l'une des
 * deux « à peu près » — un nom identique ne prouve rien, c'est le sha qui
 * parle. Et jamais une branche sur laquelle un agent travaille.
 */
export function brancheSupprimable(branche: BrancheLocale): boolean {
  if (!branche?.nom?.startsWith('tache/')) return false;
  if (branche.occupee) return false;
  return branche.fusionnee || branche.surOriginAuMemeSha;
}

/**
 * OÙ LE TRAVAIL D'UNE BRANCHE DE TÂCHE PEUT AVOIR ATTERRI.
 *
 * Le ménage a longtemps comparé les branches de tâche à « dev », codé en dur,
 * parce que c'est là que les cartes du démon sont fusionnées. Mesuré le
 * 22.09.2026 sur les vingt dépôts de la machine, deux trous se répondent :
 *
 *  - sept dépôts (brain, projete, haiko-compta, invia, bluemangocloud,
 *    HaikoNote, projeta-saas) n'ont PAS de branche « dev », et maestria n'a ni
 *    « dev » ni « main » — sa principale s'appelle « Agent ». Chez eux
 *    `git branch --merged dev` échoue, et l'échec se lit comme « aucune
 *    branche fusionnée » : leurs 90 branches terminées n'ont jamais été
 *    ramassées ;
 *  - onze dépôts sont posés sur « dev » alors que leur dépôt distant
 *    désigne « main » comme tête. Ne regarder que l'une des deux garderait
 *    pour toujours des branches déjà intégrées dans l'autre.
 *
 * On ne choisit donc PAS une branche unique : on rend toutes les branches
 * d'intégration plausibles qui existent VRAIMENT, et une branche de tâche
 * part dès que son travail est contenu dans l'une d'elles. Une branche
 * citée mais absente serait pire que rien : `--merged <inconnue>` échoue en
 * silence. Les branches de tâche et les branches archivées ne sont jamais
 * des cibles d'intégration — sinon une tâche se justifierait elle-même.
 */
export function branchesDIntegration(
  teteDistante: string | undefined,
  teteCourante: string | undefined,
  branchesLocales: readonly string[],
): string[] {
  const connues = new Set(branchesLocales.map((nom) => nom.trim()).filter(Boolean));
  const recevable = (nom: string | undefined): nom is string =>
    !!nom && connues.has(nom) && !nom.startsWith('tache/') && !nom.startsWith('archive/');
  const candidates = [
    teteDistante?.replace(/^origin\//, '').trim(),
    teteCourante?.trim(),
    'main',
    'master',
    'dev',
  ];
  const retenues: string[] = [];
  for (const candidate of candidates) {
    if (!recevable(candidate) || retenues.includes(candidate)) continue;
    retenues.push(candidate);
  }
  return retenues;
}

/** Ce qu'un passage de ménage a réellement fait — ce qui s'écrit au journal. */
export interface BilanDeMenage {
  simulation: boolean;
  /** Ce qui a été (ou serait) effacé, par cible. */
  lignes: { cible: string; entrees: number; octets: number }[];
  /** Les branches supprimées, et celles gardées faute de preuve. */
  branchesSupprimees: string[];
  branchesGardees: string[];
  octetsLiberes: number;
}

/** Le résumé d'un passage, en une phrase lisible sans rien connaître du disque. */
export function phraseDeMenage(bilan: BilanDeMenage): string {
  const entrees = bilan.lignes.reduce((total, ligne) => total + ligne.entrees, 0);
  const place = tailleLisible(bilan.octetsLiberes);
  const branches = bilan.branchesSupprimees.length;
  const verbe = bilan.simulation ? 'libérerait' : 'a libéré';
  if (entrees === 0 && branches === 0) return bilan.simulation ? 'rien à nettoyer' : 'rien à nettoyer ce soir';
  const bouts = [`${verbe} ${place} (${entrees} élément${entrees > 1 ? 's' : ''})`];
  if (branches > 0) bouts.push(`${branches} branche${branches > 1 ? 's' : ''} de travail retirée${branches > 1 ? 's' : ''}`);
  if (bilan.branchesGardees.length > 0) bouts.push(`${bilan.branchesGardees.length} gardée(s) : travail nulle part ailleurs`);
  return bouts.join(', ');
}
