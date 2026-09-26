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

/** Un projet à mettre en miroir : son dossier local et sa place sur le stockage. */
export interface ProjetAMirrorer {
  nom: string;
  /** Le dossier sur le disque de la machine. */
  local: string;
  /** Le chemin, relatif au stockage distant, où il est recopié. */
  distant: string;
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
  racineDistante = 'Beluga',
): ProjetAMirrorer[] {
  const vus = new Set<string>();
  const retenus: ProjetAMirrorer[] = [];
  for (const projet of projets ?? []) {
    const local = propre(projet?.path ?? '');
    if (!local || projet.archived) continue;
    if (vus.has(local)) continue;
    if (!estLocal(local)) continue;
    vus.add(local);
    const nom = local.split('/').filter(Boolean).pop()!;
    retenus.push({ nom: projet.name, local, distant: `${propre(racineDistante)}/${nom}` });
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
    ...EXCLUS_DU_MIROIR.flatMap((motif) => ['--exclude', motif]),
    `${propre(projet.local)}/`,
    `${prefixe}${separateur}${projet.distant}/`,
  ];
}
