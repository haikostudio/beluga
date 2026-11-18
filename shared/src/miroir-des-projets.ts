/**
 * LE MIROIR DES PROJETS — les règles, sans disque ni réseau.
 *
 * Tant que les dossiers de projets vivaient sur la Storage Box, ils étaient de
 * fait HORS de la machine : perdre le serveur ne perdait pas le travail. Ils
 * sont revenus sur le disque du serveur pour la vitesse (lire l'état d'un
 * projet passait de trois minutes à une fraction de seconde) — cette
 * redondance-là, elle, ne doit pas disparaître avec le déménagement.
 *
 * Chaque nuit, chaque dossier de projet local est donc recopié vers sa place
 * d'origine sur le stockage distant. Ce module dit QUOI copier et QUOI
 * laisser ; `server/src/miroir-des-projets.ts` fait la copie.
 */

/**
 * CE QUI NE PART JAMAIS DANS LE MIROIR : tout ce qui se réinstalle ou se
 * reconstruit. C'est 95 % des fichiers d'un projet — les emporter ferait durer
 * la copie des heures pour sauvegarder ce que personne ne relira jamais.
 */
export const EXCLUS_DU_MIROIR = [
  'node_modules/',
  '.output/',
  '.nuxt/',
  '.next/',
  'dist/',
  'build/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.cache/',
  '.turbo/',
  '*.ancien/',
  '.worktrees/',
];

/**
 * LE NOM DU MIROIR SUR LE STOCKAGE (08/11/2026, carte « Sauvegardes, fichiers
 * générés et ancien nom ») : « miroir-des-projets ». L'ancien nom, « Beluga »,
 * se lisait comme une sauvegarde de plus à côté des trois autres, et passait
 * pour un reste à supprimer. Le dossier est renommé une seule fois, au premier
 * passage du miroir qui le trouve sous son ancien nom (`server/src/miroir-des-projets.ts`).
 */
export const RACINE_DU_MIROIR = 'miroir-des-projets';
export const ANCIENNE_RACINE_DU_MIROIR = 'Beluga';

/**
 * CE QUI NE PART PAS DANS LE MIROIR DU DOSSIER DE BELUGA LUI-MÊME : ce que
 * l'ancien système de sauvegarde garde déjà deux fois par jour (la base, les
 * pièces jointes, les compétences — fiche `beluga.conf`), et ce qui se
 * reconstruit (environnements Python, modèles, journaux, essais de cadrage,
 * version servie). Mesuré le 08/11/2026 : 6,3 Go du miroir de Beluga étaient
 * ce double. Ancrés à la racine du projet (« / » en tête) : un autre projet qui
 * a son propre `data/` n'est jamais concerné.
 */
export const EXCLUS_DU_MIROIR_DE_BELUGA = [
  '/data/beluga.db*',
  '/data/attachments/',
  '/data/competences/',
  '/data/venv/',
  '/data/deps/',
  '/data/models/',
  '/data/vectoriseur/',
  '/data/logs/',
  '/data/cadrage-scratch/',
  '/data/live/',
];

/** Un projet à mettre en miroir : son dossier local et sa place sur le stockage. */
export interface ProjetAMirrorer {
  nom: string;
  /** Le dossier sur le disque de la machine. */
  local: string;
  /** Le chemin, relatif au stockage distant, où il est recopié. */
  distant: string;
  /** Exclusions propres à ce projet, ancrées à sa racine. */
  exclus?: string[];
}

function propre(chemin: string): string {
  return (chemin ?? '').trim().replace(/\/+$/, '');
}

/**
 * QUELS PROJETS METTRE EN MIROIR.
 *
 * Seuls les dossiers posés sur le disque de la machine ont besoin d'être
 * recopiés : un projet resté sur le stockage distant y est déjà. Un projet
 * archivé n'en a plus besoin non plus, et un projet sans dossier n'existe pas.
 */
export function projetsAMirrorer(
  projets: readonly { name: string; path?: string | null; archived?: boolean | number }[],
  estLocal: (chemin: string) => boolean,
  racineDistante = RACINE_DU_MIROIR,
  /** Le dossier de Beluga lui-même : ses données déjà sauvegardées ailleurs ne repartent pas. */
  dossierDeBeluga?: string,
): ProjetAMirrorer[] {
  const beluga = dossierDeBeluga ? propre(dossierDeBeluga) : '';
  const vus = new Set<string>();
  const retenus: ProjetAMirrorer[] = [];
  for (const projet of projets ?? []) {
    const local = propre(projet?.path ?? '');
    if (!local || projet.archived) continue;
    if (vus.has(local)) continue;
    if (!estLocal(local)) continue;
    vus.add(local);
    const nom = local.split('/').filter(Boolean).pop()!;
    retenus.push({
      nom: projet.name,
      local,
      distant: `${propre(racineDistante)}/${nom}`,
      ...(beluga && local === beluga ? { exclus: [...EXCLUS_DU_MIROIR_DE_BELUGA] } : {}),
    });
  }
  return retenus;
}

/**
 * Les arguments de la copie d'un projet : toujours en miroir, toujours sans
 * les régénérables. `prefixeDeDestination` se termine par « : » (un stockage
 * atteint par ssh) ou par « / » (un dossier).
 */
export function argumentsDuMiroir(projet: ProjetAMirrorer, prefixeDeDestination: string): string[] {
  const prefixe = (prefixeDeDestination ?? '').trim();
  const separateur = prefixe.endsWith(':') || prefixe.endsWith('/') ? '' : '/';
  return [
    '-a',
    '--numeric-ids',
    '--delete',
    // Ce qui est exclu disparaît aussi de la copie distante : un double déjà parti ne reste pas.
    '--delete-excluded',
    ...[...EXCLUS_DU_MIROIR, ...(projet.exclus ?? [])].flatMap((motif) => ['--exclude', motif]),
    `${propre(projet.local)}/`,
    `${prefixe}${separateur}${projet.distant}/`,
  ];
}
