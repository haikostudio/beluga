/**
 * Ce que HaikoDev envoie chaque jour au cerveau (service « brain »).
 *
 * Le cerveau garde une trace vivante de TOUS les projets : ce qu'ils ont
 * appris (leur mémoire) et les règles qu'ils imposent à leurs moteurs. Tant que
 * chaque projet gardait ses fichiers pour lui, l'apprentissage se faisait
 * projet par projet ; en les rassemblant, il se fait sur l'ensemble.
 *
 * Les règles vivent ici, sans réseau ni disque : ce qui part pour un projet, et
 * la décision « faut-il renvoyer ce fichier ? ». Elles se testent seules.
 */

/** L'adresse du service, la même pour tout le monde. */
export const CERVEAU_URL = 'https://memoire.haiko-s1.com';

/** Le nom sous lequel HaikoDev se présente au cerveau. */
export const CERVEAU_SOURCE = 'haikodev';

/**
 * Les seuls fichiers qui partent : la mémoire du projet et les instructions de
 * ses moteurs. Rien d'autre — surtout pas un fichier trouvé au hasard du
 * dossier, qui pourrait porter des identifiants.
 */
export const FICHIERS_DU_CERVEAU = ['MEMOIRE.md', 'CLAUDE.md', 'AGENTS.md'] as const;

/**
 * L'historique est un JOURNAL de livraisons : il n'a jamais été destiné à un
 * moteur, et il n'a rien à faire dans une mémoire d'apprentissage.
 */
export const FICHIERS_JAMAIS_ENVOYES = ['HISTORIQUE.md'] as const;

/** Un envoi par jour. */
export const PERIODE_ENVOI_MS = 24 * 60 * 60 * 1000;

/**
 * Une fois par semaine, tout repart même si rien n'a changé : c'est la seule
 * façon de réparer une désynchronisation silencieuse (un envoi perdu côté
 * cerveau laisserait un trou qu'aucune empreinte ne signalerait).
 */
export const RATTRAPAGE_MS = 7 * 24 * 60 * 60 * 1000;

/** L'heure creuse : la nuit, personne n'attend le serveur. */
export const HEURE_CREUSE = 4;

/** Un projet, tel que le cerveau a besoin de le connaître. */
export interface IdentiteProjet {
  id: string;
  nom: string;
  chemin: string;
  /** L'adresse du dépôt distant, si le projet en a un. */
  depot?: string;
  archive?: boolean;
}

/** Un fichier lu sur le disque. Un fichier absent vaut `null`. */
export interface FichierRecolte {
  nom: string;
  contenu: string | null;
}

/** Ce qu'on a retenu du dernier envoi d'un fichier. */
export interface EmpreinteRetenue {
  sha: string;
  at: number;
}

/** Un envoi prêt à partir : son identifiant stable, son texte, son empreinte. */
export interface EnvoiPrepare {
  /** Identifiant stable par projet ET par fichier : le cerveau REMPLACE au lieu d'empiler. */
  identifiant: string;
  projet: string;
  fichier: string;
  texte: string;
  sha: string;
  raison: RaisonEnvoi;
}

/**
 * Les projets concernés : ceux qui vivent encore. Un projet archivé est mis de
 * côté par son propriétaire — le cerveau n'a pas à continuer d'apprendre
 * dessus.
 */
export function projetsACerveau<T extends { archive?: boolean }>(projets: T[]): T[] {
  return projets.filter((projet) => !projet.archive);
}

/**
 * L'identifiant que porte un envoi. C'est lui qui fait la différence entre
 * « mettre à jour » et « empiler » : le cerveau upserte une seule ligne par
 * `discussion_id`, donc une seule ligne par projet et par fichier, pour
 * toujours.
 */
export function identifiantEnvoi(projetId: string, fichier: string): string {
  return `haikodev:${projetId}:${fichier.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
}

/**
 * Ce qui part vraiment : le contenu du fichier, précédé de l'identité du projet
 * en clair. Sans cet en-tête, le cerveau recevrait un texte orphelin dont il ne
 * saurait ni de quel projet ni de quel fichier il vient.
 */
export function texteEnvoi(identite: IdentiteProjet, fichier: string, contenu: string, date: Date): string {
  const jour = date.toISOString().slice(0, 10);
  const lignes = [
    `Projet ${identite.nom} — voici ce qui a été récolté aujourd'hui (${jour}).`,
    `Fichier : ${fichier}`,
    `Dossier : ${identite.chemin}`,
  ];
  if (identite.depot) lignes.push(`Dépôt : ${identite.depot}`);
  return `${lignes.join('\n')}\n\n${contenu.trim()}\n`;
}

/**
 * Les fichiers réellement envoyables pour un projet : ceux qu'on a trouvés, non
 * vides, jamais un fichier interdit, et sans doublon de contenu — `AGENTS.md`
 * qui se contente de renvoyer à `CLAUDE.md` n'apprend rien de plus, mais un
 * `AGENTS.md` qui DIFFÈRE, si.
 */
export function fichiersACerveau(recoltes: FichierRecolte[]): { nom: string; contenu: string }[] {
  const gardes: { nom: string; contenu: string }[] = [];
  const vus = new Set<string>();
  for (const recolte of recoltes) {
    if (FICHIERS_JAMAIS_ENVOYES.includes(recolte.nom as (typeof FICHIERS_JAMAIS_ENVOYES)[number])) continue;
    const contenu = recolte.contenu?.trim();
    if (!contenu) continue;
    if (vus.has(contenu)) continue;
    vus.add(contenu);
    gardes.push({ nom: recolte.nom, contenu });
  }
  return gardes;
}

export type RaisonEnvoi = 'jamais-envoye' | 'change' | 'rattrapage' | 'inchange';

/**
 * Faut-il renvoyer ce fichier ? Trois oui et un non : jamais parti, changé
 * depuis, ou trop vieux pour qu'on fasse encore confiance au silence.
 */
export function decisionEnvoi(sha: string, connue: EmpreinteRetenue | undefined, maintenant: number): RaisonEnvoi {
  if (!connue) return 'jamais-envoye';
  if (connue.sha !== sha) return 'change';
  if (maintenant - connue.at >= RATTRAPAGE_MS) return 'rattrapage';
  return 'inchange';
}

/** Un fichier inchangé n'occupe pas le cerveau pour rien. */
export function faitPartir(raison: RaisonEnvoi): boolean {
  return raison !== 'inchange';
}

/**
 * Le passage du jour a-t-il lieu maintenant ? Un envoi par jour, à heure
 * creuse. Au DÉMARRAGE, on rattrape sans attendre l'heure creuse si le dernier
 * envoi date de plus de vingt-quatre heures : un serveur redémarré à midi ne
 * doit pas rester muet jusqu'au lendemain.
 */
export function doitEnvoyerMaintenant(
  dernierEnvoi: number | undefined,
  maintenant: number,
  heureCourante: number,
  auDemarrage = false,
): boolean {
  if (dernierEnvoi !== undefined && maintenant - dernierEnvoi < PERIODE_ENVOI_MS) return false;
  if (auDemarrage) return true;
  return heureCourante === HEURE_CREUSE;
}
