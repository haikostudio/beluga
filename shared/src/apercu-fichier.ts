/**
 * Comment montrer un fichier qu'on ouvre.
 *
 * Un fichier Markdown n'est pas fait pour être lu comme du code : ses dièses,
 * ses étoiles et ses tirets sont des instructions de mise en page, pas du
 * texte. On le montre donc MIS EN PAGE par défaut, avec la possibilité de
 * revenir au texte brut d'un clic — parce qu'on a parfois besoin de voir la
 * source exacte, pour la copier ou pour comprendre un affichage bizarre.
 */

export type FormatApercu = 'visuel' | 'markdown';

/** Les extensions qui désignent un document Markdown. */
export const EXTENSIONS_MARKDOWN = ['.md', '.markdown', '.mdown', '.mkd', '.mdx'];

/**
 * Ce fichier est-il du Markdown ? On juge sur le NOM d'abord — c'est ce que
 * l'utilisateur voit — puis sur le type déclaré, qui manque souvent ou vaut
 * `text/plain` pour un `.md`.
 */
export function estMarkdown(nom: string, type?: string): boolean {
  const propre = (nom ?? '').trim().toLowerCase().split(/[?#]/)[0];
  if (EXTENSIONS_MARKDOWN.some((ext) => propre.endsWith(ext))) return true;
  const mime = (type ?? '').toLowerCase();
  return mime.includes('markdown');
}

/**
 * Le format d'ouverture : mis en page pour un Markdown, texte brut sinon.
 * Un fichier qui n'est pas du Markdown n'a pas de vue « visuelle » à proposer,
 * et la bascule ne s'affiche donc pas pour lui.
 */
export function formatParDefaut(nom: string, type?: string): FormatApercu {
  return estMarkdown(nom, type) ? 'visuel' : 'markdown';
}
