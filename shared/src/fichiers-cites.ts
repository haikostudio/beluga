/**
 * LES FICHIERS CITÉS PAR L'AGENT S'OUVRENT DANS LA VISIONNEUSE.
 *
 * Décision de l'utilisateur (carte « Aperçu des PDF et des liens ») : un
 * chemin de fichier écrit par l'agent — en `code` dans sa réponse, en lien
 * Markdown, ou dans le champ « Chemin » d'une étape — se clique et s'ouvre
 * dans la même visionneuse que les pièces jointes. Les liens vers des sites
 * web, eux, restent en nouvel onglet : aucun aperçu web dans l'application.
 *
 * Un clic ne crée AUCUNE pièce jointe : le fichier est lu sur place par une
 * route en lecture seule (`/api/fichier-cite`), bornée aux dossiers du projet.
 *
 * LA RÈGLE DE RECONNAISSANCE EST PRUDENTE : seul un texte qui a TOUTE la forme
 * d'un chemin devient cliquable — sinon « Node.js » ou « 3/4 » le seraient.
 * Il faut une extension, et pour un chemin relatif au moins un « / » ; aucun
 * espace, aucun joker, aucune adresse web, aucun « .. ». Le suffixe de ligne
 * d'un éditeur (`fichier.ts:42`, `fichier.ts:42:7`) est retiré.
 */

/** Une adresse web ou un autre schéma (`mailto:`, `data:`) n'est jamais un fichier cité. */
const SCHEMA = /^[a-z][a-z0-9+.-]*:/i;
/** La fin d'un chemin : un nom avec une extension de 1 à 10 lettres ou chiffres. */
const AVEC_EXTENSION = /[^/\\]\.[a-z0-9]{1,10}$/i;
/** Ce qu'un chemin cité ne contient pas : espaces, jokers, redirections, variables, parenthèses. */
const INTERDITS = /[\s*?<>|$`"'(){}\[\]]/;

/**
 * Le chemin que désigne ce texte, ou `null` quand ce n'est pas un chemin de
 * fichier. Un `file://` est accepté et rendu sans son schéma.
 */
export function cheminDeFichierCite(texte: string | null | undefined): string | null {
  let chemin = (texte ?? '').trim();
  if (!chemin || chemin.length > 1024) return null;
  if (chemin.startsWith('file://')) chemin = decodeURIComponent(chemin.slice('file://'.length));
  // Le suffixe de ligne et de colonne d'un éditeur.
  chemin = chemin.replace(/:\d+(?::\d+)?$/, '');
  if (SCHEMA.test(chemin) || chemin.startsWith('//')) return null;
  if (INTERDITS.test(chemin)) return null;
  if (chemin.split(/[/\\]/).includes('..')) return null;
  if (!AVEC_EXTENSION.test(chemin)) return null;
  const absolu = chemin.startsWith('/');
  const relatif = !absolu && (chemin.startsWith('./') || chemin.includes('/'));
  if (!absolu && !relatif) return null;
  // Un paquet (`@scope/nom`) ou une fraction n'est pas un fichier.
  if (chemin.startsWith('@')) return null;
  return chemin.replace(/^\.\//, '');
}

/** Le nom de la route en lecture seule qui sert un fichier cité. */
export const ROUTE_FICHIER_CITE = '/api/fichier-cite';

/** L'adresse d'un fichier cité ; `info` rend sa fiche (type, poids) au lieu du contenu. */
export function adresseDeFichierCite(opts: { projectId: string; agentId?: string | null; chemin: string; info?: boolean }): string {
  const params = new URLSearchParams({ project: opts.projectId, path: opts.chemin });
  if (opts.agentId) params.set('agent', opts.agentId);
  if (opts.info) params.set('info', '1');
  return `${ROUTE_FICHIER_CITE}?${params.toString()}`;
}

/**
 * LES TYPES QUI NE SE SERVENT JAMAIS TELS QUELS depuis notre propre adresse :
 * une page HTML ou un SVG ouvert directement y exécuterait son script avec la
 * session de l'utilisateur. La route les sert en texte (HTML, XML, script) ou
 * sous une politique « sandbox » (SVG, qui reste une image dans une balise).
 */
export function typeServiDUnFichierCite(mime: string): { type: string; isole: boolean } {
  const m = mime.toLowerCase();
  if (m === 'image/svg+xml') return { type: m, isole: true };
  if (m === 'text/html' || m === 'application/xhtml+xml' || m.endsWith('/xml') || m.includes('javascript')) {
    return { type: 'text/plain; charset=utf-8', isole: true };
  }
  if (m.startsWith('text/')) return { type: `${m}; charset=utf-8`, isole: false };
  return { type: m, isole: false };
}
