/*
 * LA DEMANDE, COPIABLE EN DEUX FORMATS.
 *
 * Le bloc « Votre demande » se lit dans le flux d'une carte, mais rien ne
 * permettait de l'emporter ailleurs : il fallait sélectionner le texte à la
 * souris, et les images déposées avec lui restaient sur place.
 *
 * On écrit donc DEUX représentations du même bloc, mises ensemble dans le
 * presse-papiers :
 *
 *  - `text/plain` — la demande telle qu'elle a été écrite, suivie du NOM de
 *    chaque pièce jointe. C'est ce que colle un éditeur de code ou un champ de
 *    saisie, qui ne connaissent que du texte.
 *  - `text/html` — la même demande, ses retours à la ligne conservés, et les
 *    images EMBARQUÉES en `data:` : un courriel, un document ou une page de
 *    notes reçoit alors le texte ET les captures, sans lien vers ce serveur.
 *
 * Tout ce qui est ici est PUR : rien ne lit le disque, rien n'appelle le
 * réseau. Le chargement des images est le travail du navigateur
 * (`web/src/lib/copie-riche.ts`), qui ne rend que des `data:` déjà encodées.
 */

/** Une pièce jointe telle que la copie la voit. */
export interface PieceCopiable {
  /** Le nom du fichier, quand on le connaît. */
  nom?: string;
  /** Le type déclaré (`image/png`…), quand on le connaît. */
  type?: string;
  /**
   * L'image ENCODÉE en `data:` — seule forme qui voyage hors de l'application.
   * Une pièce sans source (fichier non-image, ou image qu'on n'a pas pu
   * relire) n'est citée que par son nom.
   */
  source?: string;
}

/** Le nom montré d'une pièce, jamais vide. */
function nomDeLaPiece(piece: PieceCopiable, rang: number): string {
  const nom = (piece.nom ?? '').trim();
  return nom || `pièce ${rang + 1}`;
}

/** Une pièce est-elle une image réellement embarquable ? */
function estImageEmbarquee(piece: PieceCopiable): boolean {
  return !!piece.source && piece.source.startsWith('data:image/');
}

/**
 * LA VERSION TEXTE : la demande, puis les pièces citées par leur nom. Les
 * images ne peuvent pas exister ici — un éditeur de texte n'affiche pas une
 * capture —, mais leur nom dit qu'elles accompagnaient la demande.
 */
export function texteDeLaDemandeCopiable(texte: string, pieces: PieceCopiable[] = []): string {
  const corps = (texte ?? '').trim();
  if (!pieces.length) return corps;
  const noms = pieces.map((piece, rang) => `- ${nomDeLaPiece(piece, rang)}`);
  const titre = pieces.length > 1 ? `${pieces.length} pièces jointes :` : 'Pièce jointe :';
  return [corps, '', titre, ...noms].join('\n').trim();
}

/** Le texte, rendu inoffensif dans du HTML. */
export function echapperHtml(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * LA VERSION MISE EN FORME : le texte garde ses lignes (`<br>` dans des
 * paragraphes), et chaque image devient une balise `<img>` dont la source est
 * la donnée elle-même. Les pièces qui ne sont pas des images embarquées
 * restent une liste de noms — mieux vaut un nom qu'un lien mort.
 */
export function htmlDeLaDemandeCopiable(texte: string, pieces: PieceCopiable[] = []): string {
  const paragraphes = (texte ?? '')
    .trim()
    .split(/\n{2,}/)
    .filter((bloc) => bloc.trim().length > 0)
    .map((bloc) => `<p>${bloc.split('\n').map((ligne) => echapperHtml(ligne)).join('<br>')}</p>`);

  const images = pieces
    .filter(estImageEmbarquee)
    .map(
      (piece, rang) =>
        `<p><img src="${echapperHtml(piece.source!)}" alt="${echapperHtml(nomDeLaPiece(piece, rang))}" style="max-width:100%"></p>`,
    );

  const autres = pieces.filter((piece) => !estImageEmbarquee(piece));
  const liste = autres.length
    ? [
        `<p>${autres.length > 1 ? 'Pièces jointes :' : 'Pièce jointe :'}</p>`,
        `<ul>${autres.map((piece, rang) => `<li>${echapperHtml(nomDeLaPiece(piece, rang))}</li>`).join('')}</ul>`,
      ]
    : [];

  return `<div>${[...paragraphes, ...images, ...liste].join('')}</div>`;
}

/** Les deux représentations d'un coup — ce que le bouton met au presse-papiers. */
export function demandeCopiable(
  texte: string,
  pieces: PieceCopiable[] = [],
): { texte: string; html: string } {
  return {
    texte: texteDeLaDemandeCopiable(texte, pieces),
    html: htmlDeLaDemandeCopiable(texte, pieces),
  };
}
