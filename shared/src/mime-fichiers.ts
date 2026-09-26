/**
 * LE TYPE D'UN FICHIER SE DEVINE, IL NE SE REFUSE PLUS.
 *
 * L'outil qui joint un fichier à la réponse d'un agent ne connaissait que cinq
 * extensions d'image : tout le reste était refusé. Un agent ne pouvait donc pas
 * rendre un rapport PDF, un journal d'exécution ou une archive — il donnait un
 * chemin sur disque, que personne ne pouvait ouvrir depuis l'interface.
 *
 * Cette table ne sert plus de FILTRE mais d'aide à l'AFFICHAGE : le navigateur
 * a besoin du bon type pour montrer une image en vignette ou un PDF dans son
 * cadre. Une extension inconnue ne bloque rien : elle retombe sur
 * `application/octet-stream`, que le navigateur propose tout simplement à
 * télécharger.
 */

/** Les types connus, par extension — pour l'affichage, jamais pour refuser. */
export const MIME_PAR_EXTENSION: Record<string, string> = {
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // Documents
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  // Tableurs et traitements de texte
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  // Sons et vidéos
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  // Code et texte technique — lus en clair dans l'aperçu
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.js': 'text/plain',
  '.mjs': 'text/plain',
  '.jsx': 'text/plain',
  '.py': 'text/plain',
  '.sh': 'text/plain',
  '.sql': 'text/plain',
  '.css': 'text/css',
  '.diff': 'text/plain',
  '.patch': 'text/plain',
};

/** Le repli d'un type inconnu : le navigateur le proposera au téléchargement. */
export const MIME_INCONNU = 'application/octet-stream';

/**
 * Le type d'un fichier, deviné sur son nom. Rend TOUJOURS une valeur : une
 * extension absente ou inconnue vaut `application/octet-stream`.
 */
export function mimeDuFichier(nom: string): string {
  const propre = (nom ?? '').trim().toLowerCase().split(/[?#]/)[0];
  const point = propre.lastIndexOf('.');
  if (point <= 0) return MIME_INCONNU;
  return MIME_PAR_EXTENSION[propre.slice(point)] ?? MIME_INCONNU;
}
