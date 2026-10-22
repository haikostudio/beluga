/**
 * LA RELECTURE AUTOMATIQUE DES UNITÉS PEU SÛRES — ses règles pures.
 *
 * Décision du 20/10/2026 : l'écran ne demande plus jamais à l'utilisateur de
 * « confirmer » ce qu'un agent a écrit. Une unité écrite avec peu d'assurance
 * (confiance sous `SEUIL_DE_CONFIANCE`, jamais relue) est relue par le système :
 * d'abord MÉCANIQUEMENT, en vérifiant que les fichiers qu'elle cite existent
 * encore dans le dépôt de sa portée. Ce qui ne se tranche pas ainsi part à
 * l'agent d'analyse de nuit, jamais à l'utilisateur.
 *
 * Les garde-fous sont dans le verdict : on ne déclare une unité « obsolète »
 * que si TOUS les fichiers qu'elle cite ont disparu, et jamais une P0.
 */

/** En dessous, une unité est « peu sûre » et passe en relecture. */
export const SEUIL_DE_CONFIANCE = 0.6;
/** La confiance d'une unité que la relecture a trouvée juste. */
export const CONFIANCE_APRES_RELECTURE = 0.7;
/** Les unités relues par passe : la relecture est sans quota, mais elle reste discrète. */
export const LOT_DE_RELECTURE = 40;

export type VerdictDeRelecture = 'juste' | 'obsolete' | 'indecidable';

const RACINES = ['server', 'web', 'shared', 'scripts', 'docs', 'outils', 'src', 'app', 'lib', 'components', 'pages', 'public', 'data/competences'];
const MOTIF_CHEMIN = new RegExp(
  `(?<![\\w./-])((?:${RACINES.map((r) => r.replace('/', '\\/')).join('|')})\\/[\\w./-]*[\\w-]\\.[a-z0-9]{1,6})(?![\\w/])`,
  'gi',
);

/**
 * Les chemins de fichiers cités par une unité (`server/src/x.ts`,
 * `scripts/verif-y.mjs`…), sans doublon, dans l'ordre d'apparition. Un suffixe
 * de ligne (`fichier.ts:42`) ou une ponctuation finale ne font pas partie du
 * chemin.
 */
export function cheminsCites(texte: string): string[] {
  const vus = new Set<string>();
  for (const m of String(texte ?? '').matchAll(MOTIF_CHEMIN)) {
    const chemin = m[1].replace(/[.]+$/, '');
    if (chemin.includes('..') || chemin.includes('*')) continue;
    vus.add(chemin);
  }
  return [...vus];
}

/**
 * LE VERDICT MÉCANIQUE. Aucun fichier cité : on ne peut rien dire. Tous
 * présents : juste. Tous absents : obsolète — mais SEULEMENT quand le retrait
 * est permis (une unité de projet, jamais une P0) ET que le dossier de tête de
 * chaque chemin existe bien dans le dépôt : sinon le chemin est relatif à autre
 * chose (le dossier d'une compétence, un sous-dossier `frontend/`…) et son
 * absence ne prouve rien. Un mélange : indécidable (un fichier a pu être renommé).
 */
export function verdictMecanique(entree: {
  chemins: readonly string[];
  existe: (chemin: string) => boolean;
  /** Le dossier de tête (`server`, `src`…) existe-t-il dans le dépôt ? */
  dossierExiste?: (dossier: string) => boolean;
  importance?: string;
  /** Faux pour une unité du global : ses chemins ne visent aucun dépôt précis. */
  retraitPermis?: boolean;
}): VerdictDeRelecture {
  if (!entree.chemins.length) return 'indecidable';
  const presents = entree.chemins.filter((c) => entree.existe(c)).length;
  if (presents === entree.chemins.length) return 'juste';
  if (presents > 0) return 'indecidable';
  if (entree.retraitPermis === false || entree.importance === 'P0') return 'indecidable';
  const dossierExiste = entree.dossierExiste ?? (() => false);
  return entree.chemins.every((c) => dossierExiste(c.split('/')[0])) ? 'obsolete' : 'indecidable';
}
