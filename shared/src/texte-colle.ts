/**
 * LE TEXTE COLLÉ DEPUIS UN ASSISTANT (ChatGPT, Gemini…) ARRIVE AVEC SES DÉBRIS.
 *
 * Le bouton « copier » de ces assistants rend du Markdown semé de restes de
 * leur page : entités HTML (`&#x20;`, `&nbsp;`), balises (`<br>`, `<span>`),
 * vignettes de sources (`[image](https://www.google.com/s2/favicons…)` suivie
 * du nom du site et d'un « +1 »), et liens marqués `?utm_source=chatgpt.com`.
 * Partis tels quels à l'agent, ces débris brouillent la bulle de la demande.
 *
 * `nettoyerTexteColle` les retire SANS toucher au texte utile : il sert au
 * collage dans la barre d'écriture ET à l'affichage des demandes déjà
 * envoyées (le texte enregistré, lui, ne change pas). Un texte sans débris
 * ressort à l'identique.
 */

const ENTITES_NOMMEES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** Décode les entités HTML : `&#x20;`, `&#160;`, `&nbsp;`… Une entité inconnue reste telle quelle. */
function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, corps: string) => {
    if (corps[0] === '#') {
      const code = corps[1] === 'x' || corps[1] === 'X' ? parseInt(corps.slice(2), 16) : parseInt(corps.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return tout;
      const car = String.fromCodePoint(code);
      // Une espace insécable venue d'une page n'a rien d'intentionnel ici.
      return car === ' ' ? ' ' : car;
    }
    return ENTITES_NOMMEES[corps.toLowerCase()] ?? tout;
  });
}

/** Les balises HTML connues, hors des blocs de code : `<br>` devient un retour à la ligne, le reste disparaît. */
const BALISE = /<\/?(?:br|p|div|span|strong|em|b|i|u|a|sup|sub|small|font|img|hr|ul|ol|li|code|pre|h[1-6]|table|thead|tbody|tr|td|th)\b[^>]*>/gi;

/** Une vignette de source : l'image d'icône d'un site, posée par l'assistant après un paragraphe. */
const VIGNETTE = /^\s*!?\[[^\]]*\]\(https?:\/\/(?:www\.)?google\.com\/s2\/favicons[^)]*\)\s*$/i;
/** Le compteur de sources qui suit une vignette : « +1 », « +12 ». */
const COMPTEUR_DE_SOURCES = /^\s*\+\d+\s*$/;

function nettoyerHorsCode(bloc: string): string {
  let texte = decoderEntites(bloc)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BALISE, '')
    // Les marqueurs de suivi des liens : `?utm_source=chatgpt.com`, `&utm_…`.
    .replace(/https?:\/\/[^\s)]+/g, (adresse) =>
      adresse.replace(/([?&])utm_[a-z]+=[^&#]*&?/gi, '$1').replace(/[?&]+(?=#|$)/, ''),
    )
    // Une barre oblique échappée par le copieur (`\&sz=32`).
    .replace(/\\&/g, '&');

  /* Les vignettes de source : la ligne de l'icône, puis (à une ligne vide près)
     le nom du site et le compteur « +N ». On retire le trio entier. */
  const lignes = texte.split('\n');
  const gardees: string[] = [];
  for (let i = 0; i < lignes.length; i += 1) {
    if (!VIGNETTE.test(lignes[i]!)) {
      gardees.push(lignes[i]!);
      continue;
    }
    let j = i + 1;
    while (j < lignes.length && !lignes[j]!.trim()) j += 1;
    let fin = i;
    if (j < lignes.length && lignes[j]!.trim().length <= 80 && !COMPTEUR_DE_SOURCES.test(lignes[j]!)) {
      let k = j + 1;
      while (k < lignes.length && !lignes[k]!.trim()) k += 1;
      if (k < lignes.length && COMPTEUR_DE_SOURCES.test(lignes[k]!)) fin = k;
      else fin = j;
    } else if (j < lignes.length && COMPTEUR_DE_SOURCES.test(lignes[j]!)) {
      fin = j;
    }
    i = fin;
  }
  texte = gardees
    .join('\n')
    // Plus de deux lignes vides de suite : les trous laissés par les vignettes.
    .replace(/\n{3,}/g, '\n\n');
  return texte;
}

/** Nettoie un texte collé ; le code (```…``` et `…`) est laissé intact. */
export function nettoyerTexteColle(texte: string): string {
  if (!texte) return texte;
  const morceaux = texte.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  const net = morceaux.map((morceau, index) => (index % 2 === 1 ? morceau : nettoyerHorsCode(morceau))).join('');
  return net === texte ? texte : net.replace(/^\n+/, '').replace(/\s+$/, '');
}

/** Le texte porte-t-il des débris qu'un collage devrait retirer ? */
export function texteColleADesDebris(texte: string): boolean {
  return nettoyerTexteColle(texte) !== texte;
}
