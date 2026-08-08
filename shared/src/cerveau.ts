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
 * Ce qui part : TOUTE la documentation Markdown du projet — mémoire,
 * instructions des moteurs, documentation, notes de dossiers. Certains projets
 * portent l'essentiel de ce qu'ils savent dans des pages écrites à côté ; s'en
 * tenir à trois fichiers laissait ce savoir-là derrière.
 *
 * Ceux-ci passent en PREMIER, quel que soit l'ordre du dossier : ce sont les
 * plus porteurs de sens.
 */
export const FICHIERS_PRIORITAIRES = ['MEMOIRE.md', 'CLAUDE.md', 'AGENTS.md', 'DOCUMENTATION.md'] as const;

/**
 * Les faits durables ne vivent plus dans le seul MEMOIRE.md : ils sont rangés
 * PAR SUJET dans `docs/memoire/`. Ces pages-là partent juste après le sommaire,
 * avant le reste de la documentation — c'est la mémoire du projet, ce que le
 * cerveau vient chercher en premier.
 */
export const DOSSIER_MEMOIRE_PROJET = 'docs/memoire';

/**
 * L'historique est un JOURNAL de livraisons : il n'a jamais été destiné à un
 * moteur, et il n'a rien à faire dans une mémoire d'apprentissage. La mémoire
 * d'avant resserrement est une COPIE périmée : elle ferait double emploi.
 */
export const FICHIERS_JAMAIS_ENVOYES = ['HISTORIQUE.md', 'MEMOIRE.avant-synthese.md'] as const;

/**
 * Les dossiers qu'on ne parcourt pas : du code installé, des constructions, des
 * données. Rien de ce qui s'y trouve n'a été écrit par quelqu'un du projet.
 */
export const DOSSIERS_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'data',
  '.next',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
] as const;

/** On ne descend pas indéfiniment : au-delà, ce ne sont plus des pages de projet. */
export const PROFONDEUR_MAX = 5;

/** Un projet bavard ne doit pas monopoliser le passage du soir. */
export const FICHIERS_MAX_PAR_PROJET = 150;

/** Une page de plus de 300 000 signes n'est pas de la documentation. */
export const TAILLE_MAX = 300_000;

/**
 * Cette page part-elle au cerveau ? Un fichier Markdown, jamais un fichier
 * interdit, jamais rangé dans un dossier de machine.
 */
export function estPageDuCerveau(cheminRelatif: string): boolean {
  const morceaux = cheminRelatif.split('/');
  const nom = morceaux[morceaux.length - 1] ?? '';
  if (!/\.mdx?$/i.test(nom)) return false;
  if (FICHIERS_JAMAIS_ENVOYES.includes(nom as (typeof FICHIERS_JAMAIS_ENVOYES)[number])) return false;
  return !morceaux
    .slice(0, -1)
    .some(
      (dossier) =>
        dossier.startsWith('.') || DOSSIERS_IGNORES.includes(dossier as (typeof DOSSIERS_IGNORES)[number]),
    );
}

/**
 * L'ordre d'envoi : les fichiers porteurs d'abord, la racine ensuite, le reste
 * par ordre alphabétique. Quand un projet dépasse le plafond, ce sont bien les
 * pages les moins importantes qui sont laissées de côté.
 */
export function ordonnerPages(chemins: string[]): string[] {
  const rang = (chemin: string) => {
    const index = FICHIERS_PRIORITAIRES.indexOf(chemin as (typeof FICHIERS_PRIORITAIRES)[number]);
    if (index >= 0) return index;
    // Les fichiers de mémoire par sujet suivent immédiatement les porteurs.
    if (chemin.startsWith(`${DOSSIER_MEMOIRE_PROJET}/`)) return FICHIERS_PRIORITAIRES.length;
    return chemin.includes('/') ? 100 + chemin.split('/').length : 50;
  };
  return [...chemins].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b));
}

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
  return `haikodev:${projetId}:${fichier.toLowerCase().replace(/[^a-z0-9./]+/g, '-')}`;
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
 * Les pages réellement envoyables pour un projet : celles qu'on a trouvées, non
 * vides, jamais un fichier interdit, et sans doublon de contenu — `AGENTS.md`
 * qui se contente de renvoyer à `CLAUDE.md` n'apprend rien de plus, mais un
 * `AGENTS.md` qui DIFFÈRE, si. Les plus porteuses passent devant, et le plafond
 * s'applique à la fin : ce sont les moins importantes qui sautent.
 */
export function fichiersACerveau(recoltes: FichierRecolte[]): { nom: string; contenu: string }[] {
  const parNom = new Map(recoltes.map((r) => [r.nom, r]));
  const gardes: { nom: string; contenu: string }[] = [];
  const vus = new Set<string>();
  for (const nom of ordonnerPages([...parNom.keys()])) {
    if (!estPageDuCerveau(nom)) continue;
    const contenu = parNom.get(nom)?.contenu?.trim();
    if (!contenu || contenu.length > TAILLE_MAX) continue;
    if (vus.has(contenu)) continue;
    vus.add(contenu);
    gardes.push({ nom, contenu });
    if (gardes.length >= FICHIERS_MAX_PAR_PROJET) break;
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
