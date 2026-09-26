/**
 * QUELLE ICÔNE PORTE UN PROJET, quand son adresse publique n'en donne pas.
 *
 * L'adresse de dev reste la source de vérité — mais la plupart des projets
 * n'ont AUCUNE adresse inscrite, et cherchaient donc l'icône nulle part : la
 * colonne de gauche restait aux initiales pour presque tout le monde. Le
 * DÉPÔT du projet, lui, est toujours là : `public/favicon.svg`,
 * `web/public/icon-192.png`, `favicon.ico` à la racine…
 *
 * Ce fichier ne touche NI au disque NI au réseau : il reçoit la liste des
 * chemins RELATIFS trouvés dans le dépôt et dit lequel prendre. C'est ce qui
 * le rend rejouable dans un test, sans dépôt sous la main.
 */

/** Les extensions qu'un navigateur sait afficher dans une pastille de 15 px. */
export const EXTENSIONS_D_ICONE = ['.svg', '.png', '.ico', '.webp', '.jpg', '.jpeg', '.gif'] as const;

/**
 * Les dossiers qu'on ne parcourt jamais : machine, copies de travail, sorties
 * de construction. Une icône y serait au mieux un doublon, au pire l'icône
 * d'une DÉPENDANCE — jamais celle du projet.
 */
export const DOSSIERS_ECARTES = [
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'build',
  '.output',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  'tmp',
  'target',
] as const;

/**
 * Les dossiers où un site RANGE ses icônes. Un fichier trouvé ailleurs (une
 * image d'interface, une capture) ne compte pas : c'est ce qui évite de
 * confondre `assets/imgs/icon-folder.png` avec l'icône du site.
 */
const DOSSIERS_D_ICONES = [
  '',
  'public',
  'static',
  'assets',
  'web/public',
  'web/static',
  'frontend/public',
  'front/public',
  'client/public',
  'app/public',
  'site/public',
  'src/app',
  'src/assets',
  'public/favicon',
  'public/favicons',
  'public/icons',
  'public/images/favicons',
  'web/public/icons',
  'frontend/public/icons',
  'static/icons',
  'assets/icons',
];

/** Le nom du fichier, sans son dossier ni son extension, en minuscules. */
function nomEtExtension(chemin: string): { nom: string; ext: string; dossier: string } {
  const normalise = chemin.replace(/\\/g, '/').replace(/^\.\//, '');
  const coupe = normalise.lastIndexOf('/');
  const fichier = (coupe === -1 ? normalise : normalise.slice(coupe + 1)).toLowerCase();
  const dossier = coupe === -1 ? '' : normalise.slice(0, coupe).toLowerCase();
  const point = fichier.lastIndexOf('.');
  return {
    nom: point === -1 ? fichier : fichier.slice(0, point),
    ext: point === -1 ? '' : fichier.slice(point),
    dossier,
  };
}

/**
 * Le nom dit-il « icône de ce site » ? On accepte `favicon…`,
 * `apple-touch-icon…`, `icon` suivi d'une TAILLE (`icon-192`, `icon-512x512`),
 * `logo` et `android-chrome-…` — jamais un `icon-folder` ou un `icon-phone`,
 * qui sont des images d'interface.
 */
function nomDIcone(nom: string): boolean {
  if (/^favicon(\b|[-_.]|$)/.test(nom)) return true;
  if (/^apple-?touch-?icon/.test(nom)) return true;
  if (/^android-?(chrome|icon)/.test(nom)) return true;
  if (/^(ms|mstile)/.test(nom)) return false;
  if (/^icon([-_]?\d+(x\d+)?)?(@\d+x)?$/.test(nom)) return true;
  if (/^logo([-_]?\d+(x\d+)?)?$/.test(nom)) return true;
  return false;
}

/** La taille annoncée par le nom (`icon-192`, `favicon-32x32`), s'il en donne une. */
function tailleAnnoncee(nom: string): number {
  const m = /(\d{2,4})(?:x\d{2,4})?$/.exec(nom.replace(/@\d+x$/, ''));
  return m ? Number(m[1]) : 0;
}

/**
 * Le score d'un candidat : plus il est HAUT, mieux il vaut. Trois idées,
 * dans cet ordre — un `favicon` déclaré vaut mieux qu'un logo ; un fichier
 * rangé dans `public/` vaut mieux qu'un fichier perdu au fond du dépôt ; et
 * à égalité, une taille proche de 128 px rend mieux qu'une icône de 16 px
 * (floue une fois agrandie) ou de 512 px (lourde pour une pastille).
 */
function score(chemin: string): number | null {
  const { nom, ext, dossier } = nomEtExtension(chemin);
  if (!(EXTENSIONS_D_ICONE as readonly string[]).includes(ext)) return null;
  if (!nomDIcone(nom)) return null;
  const segments = dossier ? dossier.split('/') : [];
  if (segments.some((s) => (DOSSIERS_ECARTES as readonly string[]).includes(s))) return null;
  if (!DOSSIERS_D_ICONES.includes(dossier)) return null;

  let points = 0;
  if (/^favicon/.test(nom)) points += 400;
  else if (/^apple-?touch-?icon/.test(nom)) points += 300;
  else if (/^android-?(chrome|icon)/.test(nom)) points += 280;
  else if (/^icon/.test(nom)) points += 260;
  else points += 120; // logo : le dernier recours, mais mieux que des initiales

  // Un SVG ne pixellise jamais ; un ICO tient dans tous les navigateurs.
  if (ext === '.svg') points += 60;
  else if (ext === '.png' || ext === '.webp') points += 40;
  else if (ext === '.ico') points += 30;

  // Moins on descend, plus c'est probablement l'icône du site lui-même.
  points -= segments.length * 12;

  const taille = tailleAnnoncee(nom);
  if (taille) points += 30 - Math.min(30, Math.round(Math.abs(taille - 128) / 16));

  return points;
}

/**
 * Classe les chemins RELATIFS trouvés dans un dépôt, du meilleur au moins
 * bon, en écartant tout ce qui n'est pas une icône de site. Rend une liste
 * vide quand le dépôt n'a rien à offrir : l'écran retombe alors sur les
 * initiales, ce qui reste la bonne réponse.
 */
export function classerIconesDuDepot(chemins: string[]): string[] {
  return chemins
    .map((chemin) => ({ chemin, points: score(chemin) }))
    .filter((c): c is { chemin: string; points: number } => c.points !== null)
    .sort((a, b) => b.points - a.points || a.chemin.length - b.chemin.length || a.chemin.localeCompare(b.chemin))
    .map((c) => c.chemin);
}

/** La meilleure icône du dépôt, ou `null` s'il n'en porte aucune. */
export function meilleureIconeDuDepot(chemins: string[]): string | null {
  return classerIconesDuDepot(chemins)[0] ?? null;
}
