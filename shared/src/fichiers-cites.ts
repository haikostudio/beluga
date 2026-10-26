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

/* ------------------------------------------------------------------ */
/* Les documents produits par un tour                                  */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut d'un appel d'outil pour savoir s'il a produit un document. */
export interface AppelDOutil {
  outil?: string;
  /** Les paramètres en JSON — souvent BORNÉS au journal, donc parfois coupés en route. */
  params?: string;
  reussie?: boolean;
}

/** Les fichiers qu'on vient LIRE : jamais du code, une image a déjà sa pastille. */
const EXTENSIONS_DE_DOCUMENT = /\.(md|markdown|txt|csv|tsv|html?|pdf|docx?|xlsx?|pptx?|odt|ods|rtf)$/i;

/** Une valeur de chaîne lue dans un JSON peut-être coupé : on la cherche, on ne parse pas le tout. */
function valeurDe(params: string, cle: string): string | undefined {
  const trouve = params.match(new RegExp(`"${cle}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!trouve) return undefined;
  try {
    return JSON.parse(`"${trouve[1]}"`) as string;
  } catch {
    return undefined;
  }
}

/**
 * Un chemin dans la COPIE DE TRAVAIL d'une carte devient relatif au projet :
 * la copie est refermée après la fusion, le fichier vit alors dans le projet.
 */
function cheminDuDocument(chemin: string): string {
  const copie = chemin.match(/\/\.worktrees\/[^/]+\/(.+)$/);
  const propre = copie ? copie[1] : chemin;
  // Un nom nu (« rapport.md ») reste un chemin : la règle de reconnaissance l'exige.
  return propre.includes('/') ? propre : `./${propre}`;
}

/**
 * LES DOCUMENTS QU'UN TOUR A PRODUITS (25/10/2026). Sous la réponse de l'agent,
 * chacun porte un bouton qui l'ouvre dans la visionneuse : un relevé écrit dans
 * un fichier (capture #ab206) ne se cherchait plus dans le dépôt. Calculé à
 * l'affichage depuis les appels d'outils DÉJÀ gardés — d'où le bouton sous les
 * anciennes réponses aussi, sans rien migrer.
 *
 * Retenus : un document écrit (« write_document », hors suppression), un
 * fichier de document écrit par le moteur (« Write ») ou joint (« attach_file »).
 * Un appel refusé, un chemin illisible ou du code ne donnent rien. Sans
 * doublon, dans l'ordre d'écriture.
 */
export function documentsDuTour(appels: readonly AppelDOutil[]): string[] {
  const vus = new Set<string>();
  const documents: string[] = [];
  for (const appel of appels) {
    if (appel.reussie === false || !appel.outil || !appel.params) continue;
    const outil = appel.outil.replace(/^mcp__[^_]+__/, '');
    let chemin: string | undefined;
    if (outil === 'write_document') {
      if (/"action"\s*:\s*"supprimer"/.test(appel.params)) continue;
      chemin = valeurDe(appel.params, 'relativePath');
    } else if (outil === 'Write') {
      chemin = valeurDe(appel.params, 'file_path');
      if (chemin && !EXTENSIONS_DE_DOCUMENT.test(chemin)) chemin = undefined;
    } else if (outil === 'attach_file' || outil === 'attach_screenshot') {
      chemin = valeurDe(appel.params, 'path');
      if (chemin && !EXTENSIONS_DE_DOCUMENT.test(chemin)) chemin = undefined;
    }
    const reconnu = chemin ? cheminDeFichierCite(cheminDuDocument(chemin)) : null;
    if (!reconnu || vus.has(reconnu)) continue;
    vus.add(reconnu);
    documents.push(reconnu);
  }
  return documents;
}
