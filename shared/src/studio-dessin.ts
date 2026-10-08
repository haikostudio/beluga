/**
 * NETTOYER ET VALIDER UN DESSIN DU STUDIO — le premier des trois verrous.
 *
 * Un dessin est du CODE ÉCRIT PAR UN MODÈLE, joué ensuite dans l'aperçu et dans
 * le Chrome de rendu. Il ne doit pouvoir ni lire la session, ni appeler le
 * serveur, ni sortir sur le réseau, et il doit se rejouer À L'IDENTIQUE :
 *
 *  1. ici, à la pose : une LISTE FERMÉE de balises et d'attributs HTML/SVG,
 *     aucune adresse extérieure, aucun appel réseau ni hasard dans le code ;
 *  2. l'aperçu vit dans un cadre isolé sans même origine (`studio-page.ts`) ;
 *  3. la page de rendu porte une politique de contenu qui coupe le réseau.
 *
 * Un refus n'est jamais silencieux : chaque erreur est rendue à l'agent, en une
 * phrase qui dit quoi corriger.
 */

/** Les balises permises, en minuscules (le SVG compris). */
const BALISES_HTML = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'br', 'hr',
  'ul', 'ol', 'li', 'img', 'figure', 'figcaption', 'section', 'header', 'footer', 'article', 'aside', 'main', 'blockquote', 'mark', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);
const BALISES_SVG = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath', 'defs', 'lineargradient',
  'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'use', 'symbol', 'marker', 'title', 'desc', 'filter', 'fegaussianblur', 'feoffset',
  'feblend', 'fecolormatrix', 'femerge', 'femergenode', 'feflood', 'fecomposite', 'fedropshadow', 'feturbulence', 'fedisplacementmap',
  'femorphology', 'fecomponenttransfer', 'fefunca', 'fefuncr', 'fefuncg', 'fefuncb', 'image',
]);
/** Les balises vides (sans fermeture). */
const BALISES_VIDES = new Set(['br', 'hr', 'img']);

/** Ce qui n'a rien à faire dans un dessin, avec la raison dite à l'agent. */
const BALISES_REFUSEES: Record<string, string> = {
  script: 'le code d’animation va dans « animation », jamais dans une balise <script>',
  style: 'la feuille de style va dans « css », jamais dans une balise <style>',
  iframe: 'un dessin ne charge aucune autre page',
  frame: 'un dessin ne charge aucune autre page',
  object: 'un dessin ne charge aucun objet extérieur',
  embed: 'un dessin ne charge aucun objet extérieur',
  link: 'un dessin ne charge aucune ressource extérieure',
  meta: 'un dessin ne règle pas la page',
  base: 'un dessin ne règle pas la page',
  form: 'un dessin n’envoie rien',
  input: 'un dessin n’a pas de champ de saisie',
  button: 'un dessin n’a pas de bouton',
  textarea: 'un dessin n’a pas de champ de saisie',
  audio: 'un son se pose sur une piste « Son », pas dans un dessin',
  video: 'une vidéo se pose sur un segment « vidéo », pas dans un dessin',
  canvas: 'un canevas ne se retouche pas pièce par pièce : dessine en SVG',
  foreignobject: 'pas d’objet étranger dans un SVG',
  animate: 'les animations SVG natives ne suivent pas la chronologie : anime avec GSAP',
  animatetransform: 'les animations SVG natives ne suivent pas la chronologie : anime avec GSAP',
  animatemotion: 'les animations SVG natives ne suivent pas la chronologie : anime avec GSAP',
  set: 'les animations SVG natives ne suivent pas la chronologie : anime avec GSAP',
};

const ATTRIBUTS = new Set([
  'class', 'id', 'style', 'role', 'title', 'alt', 'lang', 'dir', 'width', 'height', 'viewbox', 'preserveaspectratio', 'xmlns', 'xmlns:xlink',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'd', 'points', 'pathlength', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-opacity', 'stroke-miterlimit', 'opacity', 'clip-path', 'clip-rule', 'mask', 'filter', 'vector-effect', 'paint-order',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod', 'patternunits', 'patterncontentunits', 'patterntransform',
  'maskunits', 'maskcontentunits', 'clippathunits', 'filterunits', 'primitiveunits',
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'word-spacing',
  'text-decoration', 'textlength', 'lengthadjust', 'startoffset', 'dx', 'dy', 'rotate', 'href', 'xlink:href', 'src',
  'stddeviation', 'in', 'in2', 'result', 'mode', 'values', 'type', 'flood-color', 'flood-opacity', 'operator', 'k1', 'k2', 'k3', 'k4',
  'basefrequency', 'numoctaves', 'seed', 'stitchtiles', 'scale', 'xchannelselector', 'ychannelselector', 'radius', 'tablevalues', 'slope', 'intercept',
  'amplitude', 'exponent',
  'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits', 'marker-start', 'marker-mid', 'marker-end',
  'colspan', 'rowspan', 'decoding',
]);

/**
 * CE QUE LE CODE D'UN DESSIN NE PEUT PAS CONTENIR. Réseau, sortie du cadre,
 * évaluation de texte, et tout ce qui rend un rendu différent d'une fois à
 * l'autre (hasard, horloge, minuteurs) : l'export doit être identique à l'aperçu.
 */
const INTERDITS_CODE: { motif: RegExp; raison: string }[] = [
  { motif: /\bfetch\s*\(/, raison: '« fetch » : un dessin n’appelle pas le réseau' },
  { motif: /XMLHttpRequest/, raison: '« XMLHttpRequest » : un dessin n’appelle pas le réseau' },
  { motif: /WebSocket|EventSource|RTCPeerConnection/, raison: 'un dessin n’ouvre aucun canal réseau' },
  { motif: /\bimport\s*\(|\bimport\s+[\w{*]|\bimportScripts\b/, raison: '« import » : un dessin ne charge aucun module' },
  { motif: /sendBeacon/, raison: '« sendBeacon » : un dessin n’envoie rien' },
  { motif: /\b(?:window|self|globalThis)\s*\.\s*(?:parent|top|opener|frames)\b|\bparent\s*\.|\btop\s*\.|\bopener\b/, raison: 'un dessin ne sort pas de son cadre (parent, top, opener)' },
  { motif: /\bpostMessage\b/, raison: '« postMessage » : un dessin ne parle à personne' },
  { motif: /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, raison: 'un dessin n’évalue pas de texte comme du code' },
  { motif: /Math\s*\.\s*random/, raison: '« Math.random » : le rendu doit se rejouer à l’identique — tire tes valeurs d’une formule (indice, sinus)' },
  { motif: /Date\s*\.\s*now|new\s+Date\b|\bDate\s*\(/, raison: 'l’horloge rend chaque rendu différent : anime avec la chronologie, pas avec l’heure' },
  { motif: /performance\s*\.\s*now/, raison: '« performance.now » : anime avec la chronologie, pas avec l’horloge' },
  { motif: /crypto\s*\.\s*getRandomValues|randomUUID/, raison: 'pas de hasard : le rendu doit se rejouer à l’identique' },
  { motif: /\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame|requestIdleCallback/, raison: 'les minuteurs ne suivent pas la chronologie : place chaque mouvement sur « tl »' },
  { motif: /\b(?:localStorage|sessionStorage|indexedDB|caches)\b|document\s*\.\s*cookie/, raison: 'un dessin ne lit ni n’écrit aucun stockage' },
  { motif: /\blocation\s*\.|\bdocument\s*\.\s*(?:write|domain|location)\b|\bnavigator\s*\./, raison: 'un dessin ne touche ni à l’adresse, ni au navigateur' },
  { motif: /<\/?script|<!--/i, raison: 'pas de balise dans le code d’animation' },
  { motif: /\bWorker\b|serviceWorker|SharedWorker/, raison: 'un dessin ne lance aucun fil de travail' },
  { motif: /\bwindow\s*\.\s*open\b|\bopen\s*\(/, raison: 'un dessin n’ouvre aucune fenêtre' },
];

/** Ce qu'une feuille de style ne peut pas contenir. */
const INTERDITS_CSS: { motif: RegExp; raison: string }[] = [
  { motif: /@import/i, raison: '« @import » : la feuille ne charge rien de l’extérieur' },
  { motif: /@font-face/i, raison: '« @font-face » : prends une des polices embarquées du studio' },
  { motif: /@keyframes|(?:^|[\s;{])animation(?:-[a-z-]+)?\s*:/i, raison: 'les animations CSS ne suivent pas la chronologie : anime avec GSAP dans « animation »' },
  { motif: /(?:^|[\s;{])transition(?:-[a-z-]+)?\s*:/i, raison: 'les transitions CSS ne suivent pas la chronologie : anime avec GSAP' },
  { motif: /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i, raison: 'code interdit dans la feuille de style' },
  { motif: /</, raison: 'pas de « < » dans la feuille de style' },
];

/** Les adresses permises dans un dessin : une ancre interne, une image en ligne, un média du studio. */
const PREFIXE_MEDIA = 'studio-media:';

export function adresseDeDessinPermise(brute: string): boolean {
  const v = brute.trim();
  if (!v) return true;
  if (v.startsWith('#')) return /^#[\w-]+$/.test(v);
  if (v.startsWith(PREFIXE_MEDIA)) return /^studio-media:[a-zA-Z][\w-]{0,63}$/.test(v);
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(v)) return v.length <= 300_000;
  return false;
}

/** Décode les entités, pour juger une valeur comme le navigateur la lira. */
function decoderEntites(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function echapperAttribut(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Toutes les adresses `url(...)` d'un morceau de CSS. */
function adressesCss(css: string): string[] {
  const sortie: string[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) sortie.push(m[2] ?? '');
  return sortie;
}

function jugerCss(css: string, ou: string, erreurs: string[]): void {
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const { motif, raison } of INTERDITS_CSS) if (motif.test(sansCommentaires)) erreurs.push(`${ou} : ${raison}`);
  for (const adresse of adressesCss(sansCommentaires)) {
    if (!adresseDeDessinPermise(adresse)) erreurs.push(`${ou} : adresse extérieure refusée dans url(${adresse.slice(0, 60)}) — seuls « #ancre », une image en data: ou « studio-media:<id> » sont permis`);
  }
}

export interface DessinNettoye {
  html: string;
  css: string;
  animation: string;
  /** Les `data-studio-id` trouvés, dans l'ordre. */
  elements: string[];
  /** Les médias du studio appelés par `studio-media:<id>`. */
  medias: string[];
}

export type IssueDuNettoyage = { ok: true; dessin: DessinNettoye; avertissements: string[] } | { ok: false; erreurs: string[]; avertissements: string[] };

export const TAILLE_HTML_DESSIN_MAX = 200_000;
export const TAILLE_CSS_DESSIN_MAX = 100_000;
export const TAILLE_ANIMATION_DESSIN_MAX = 60_000;

/**
 * NETTOYER ET VALIDER UN DESSIN. Le fragment HTML est relu balise par balise et
 * RÉÉCRIT depuis la liste fermée (rien de ce qui n'est pas compris ne passe) ;
 * la feuille et le code sont jugés sur leurs interdits. Rend le dessin propre,
 * ou la liste des erreurs à corriger.
 */
export function nettoyerDessin(entree: { html?: unknown; css?: unknown; animation?: unknown }): IssueDuNettoyage {
  const html = typeof entree.html === 'string' ? entree.html : '';
  const css = typeof entree.css === 'string' ? entree.css : '';
  const animation = typeof entree.animation === 'string' ? entree.animation : '';
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  if (!html.trim()) erreurs.push('html : le dessin est vide');
  if (html.length > TAILLE_HTML_DESSIN_MAX) erreurs.push(`html : plus de ${TAILLE_HTML_DESSIN_MAX} signes`);
  if (css.length > TAILLE_CSS_DESSIN_MAX) erreurs.push(`css : plus de ${TAILLE_CSS_DESSIN_MAX} signes`);
  if (animation.length > TAILLE_ANIMATION_DESSIN_MAX) erreurs.push(`animation : plus de ${TAILLE_ANIMATION_DESSIN_MAX} signes`);

  const sortie: string[] = [];
  const elements: string[] = [];
  const medias = new Set<string>();
  const pile: string[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      sortie.push(html.slice(i).replace(/>/g, '&gt;'));
      break;
    }
    if (lt > i) sortie.push(html.slice(i, lt).replace(/>/g, '&gt;'));
    if (html.startsWith('<!--', lt)) {
      const fin = html.indexOf('-->', lt + 4);
      i = fin < 0 ? n : fin + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      erreurs.push('html : pas de déclaration (<!…>, <?…>) dans un dessin');
      const fin = html.indexOf('>', lt);
      i = fin < 0 ? n : fin + 1;
      continue;
    }
    const fermeture = html[lt + 1] === '/';
    const debutNom = lt + (fermeture ? 2 : 1);
    const nomMatch = /^[a-zA-Z][\w:-]*/.exec(html.slice(debutNom, debutNom + 40));
    if (!nomMatch) {
      // Un « < » isolé dans un texte : on l'échappe.
      sortie.push('&lt;');
      i = lt + 1;
      continue;
    }
    const nomBrut = nomMatch[0];
    const nom = nomBrut.toLowerCase();
    let j = debutNom + nomBrut.length;

    // Lire les attributs jusqu'au « > ».
    const attributs: { nom: string; valeur: string | null }[] = [];
    let autoFermee = false;
    while (j < n) {
      while (j < n && /\s/.test(html[j]!)) j++;
      if (html[j] === '>') {
        j++;
        break;
      }
      if (html[j] === '/' && html[j + 1] === '>') {
        autoFermee = true;
        j += 2;
        break;
      }
      const a = /^[^\s"'>/=]+/.exec(html.slice(j, j + 200));
      if (!a) {
        j++;
        continue;
      }
      const nomAttr = a[0].toLowerCase();
      j += a[0].length;
      while (j < n && /\s/.test(html[j]!)) j++;
      let valeur: string | null = null;
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j]!)) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const fin = html.indexOf(q, j + 1);
          valeur = html.slice(j + 1, fin < 0 ? n : fin);
          j = fin < 0 ? n : fin + 1;
        } else {
          const v = /^[^\s>]*/.exec(html.slice(j))![0];
          valeur = v;
          j += v.length;
        }
      }
      attributs.push({ nom: nomAttr, valeur });
    }
    i = j;

    if (BALISES_REFUSEES[nom]) {
      if (!fermeture) erreurs.push(`html : <${nom}> refusé — ${BALISES_REFUSEES[nom]}`);
      // Le contenu d'un <script> ou d'un <style> refusé est sauté en entier.
      if (!fermeture && (nom === 'script' || nom === 'style')) {
        const fin = html.toLowerCase().indexOf(`</${nom}`, i);
        i = fin < 0 ? n : fin;
      }
      continue;
    }
    if (!BALISES_HTML.has(nom) && !BALISES_SVG.has(nom)) {
      if (!fermeture) erreurs.push(`html : la balise <${nom}> n’est pas dans la liste permise`);
      continue;
    }
    if (fermeture) {
      const k = pile.lastIndexOf(nom);
      if (k >= 0) {
        // Ferme proprement tout ce qui était resté ouvert dessous.
        for (let q = pile.length - 1; q >= k; q--) sortie.push(`</${nomSortie(pile[q]!)}>`);
        pile.length = k;
      }
      continue;
    }

    const gardes: string[] = [];
    for (const { nom: an, valeur } of attributs) {
      const v = valeur === null ? '' : decoderEntites(valeur);
      if (an.startsWith('on')) {
        erreurs.push(`html : l’attribut « ${an} » est refusé — le code va dans « animation »`);
        continue;
      }
      const estData = /^data-[a-z0-9-]+$/.test(an);
      const estAria = /^aria-[a-z-]+$/.test(an);
      if (!ATTRIBUTS.has(an) && !estData && !estAria) {
        avertissements.push(`html : l’attribut « ${an} » de <${nom}> a été retiré`);
        continue;
      }
      if (/javascript:|vbscript:/i.test(v.replace(/\s/g, ''))) {
        erreurs.push(`html : « javascript: » refusé dans « ${an} »`);
        continue;
      }
      if (an === 'href' || an === 'xlink:href' || an === 'src') {
        if (!adresseDeDessinPermise(v)) {
          erreurs.push(`html : adresse extérieure refusée dans « ${an} » de <${nom}> (« ${v.slice(0, 60)} ») — seuls « #ancre », une image en data: ou « studio-media:<id> » sont permis`);
          continue;
        }
        if (v.startsWith(PREFIXE_MEDIA)) medias.add(v.slice(PREFIXE_MEDIA.length));
      }
      if (an === 'style') jugerCss(v, `style de <${nom}>`, erreurs);
      if (/^(fill|stroke|filter|clip-path|mask|marker-(start|mid|end))$/.test(an) && /url\(/i.test(v)) {
        for (const adresse of adressesCss(v)) if (!adresseDeDessinPermise(adresse)) erreurs.push(`html : adresse extérieure refusée dans « ${an} »`);
      }
      if (an === 'data-studio-id') {
        if (!/^[a-zA-Z][\w-]{0,63}$/.test(v)) {
          erreurs.push(`html : data-studio-id « ${v.slice(0, 40)} » illisible — lettres, chiffres et tirets, en commençant par une lettre`);
          continue;
        }
        if (elements.includes(v)) erreurs.push(`html : data-studio-id « ${v} » utilisé deux fois — chaque pièce a le sien`);
        else elements.push(v);
      }
      gardes.push(valeur === null ? an : `${nomAttribut(an)}="${echapperAttribut(v)}"`);
    }
    const nomPropre = nomSortie(nom);
    sortie.push(`<${nomPropre}${gardes.length ? ' ' + gardes.join(' ') : ''}${autoFermee && !BALISES_VIDES.has(nom) ? '></' + nomPropre : ''}>`);
    if (!BALISES_VIDES.has(nom) && !autoFermee) pile.push(nom);
  }
  for (let q = pile.length - 1; q >= 0; q--) sortie.push(`</${nomSortie(pile[q]!)}>`);

  jugerCss(css, 'css', erreurs);
  const codeSansCommentaires = animation.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  for (const { motif, raison } of INTERDITS_CODE) if (motif.test(codeSansCommentaires)) erreurs.push(`animation : ${raison}`);
  // Les mêmes interdits valent dans le HTML (texte d'un SVG, attribut inattendu).
  if (/Math\s*\.\s*random/.test(html)) erreurs.push('html : « Math.random » n’a rien à faire dans un dessin');

  if (!elements.length && html.trim()) avertissements.push('aucune pièce ne porte de data-studio-id : l’utilisateur ne pourra rien déplacer à la main');

  if (erreurs.length) return { ok: false, erreurs: [...new Set(erreurs)].slice(0, 30), avertissements };
  return { ok: true, dessin: { html: sortie.join(''), css: css.replace(/\/\*[\s\S]*?\*\//g, '').trim(), animation, elements, medias: [...medias] }, avertissements };
}

/** Une pièce d'un dessin, telle que le panneau « Calques » la montre. */
export interface PieceDuDessin {
  id: string;
  /** La balise (« div », « text », « circle »…). */
  balise: string;
  /** Le premier texte qu'elle porte, pour la reconnaître (40 signes au plus). */
  texte?: string;
  /** La pièce qui la contient, s'il y en a une. */
  parent?: string;
  /** Son rang parmi les éléments de son parent dans le dessin (avant tout plan). */
  rang: number;
  profondeur: number;
  /**
   * Les PARAMÈTRES que la pièce porte elle-même (`data-param`, `data-param-src`,
   * `data-param-show` sur elle ou sur un enfant sans nom) : l'inspecteur les
   * montre avec la pièce, les autres restent à la scène.
   */
  parametres?: string[];
}

/**
 * LES PIÈCES D'UN DESSIN (`data-studio-id`), dans l'ordre du document, avec leur
 * pièce parente : de quoi montrer chaque calque composé par l'agent. Lit le HTML
 * NETTOYÉ (balises fermées, attributs entre guillemets) — jamais exécuté.
 */
export function piecesDuDessin(html: string): PieceDuDessin[] {
  const pieces: PieceDuDessin[] = [];
  const pile: { balise: string; piece?: PieceDuDessin; enfants: number }[] = [{ balise: '#racine', enfants: 0 }];
  const motif = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(html))) {
    if (m[4] !== undefined) {
      const texte = decoderEntites(m[4]).replace(/\s+/g, ' ').trim();
      if (!texte) continue;
      // Le premier texte du sous-arbre de chaque pièce encore sans texte (un conteneur se reconnaît à son titre).
      for (const ouvert of pile) if (ouvert.piece && !ouvert.piece.texte) ouvert.piece.texte = texte.slice(0, 40);
      continue;
    }
    const balise = m[2]!.toLowerCase();
    if (m[1]) {
      const k = pile.map((x) => x.balise).lastIndexOf(balise);
      if (k > 0) pile.length = k;
      continue;
    }
    const parent = pile[pile.length - 1]!;
    const rang = parent.enfants++;
    const id = /\sdata-studio-id="([^"]*)"/.exec(m[3]!)?.[1];
    const ancetre = [...pile].reverse().find((x) => x.piece)?.piece;
    let piece: PieceDuDessin | undefined;
    if (id) {
      piece = { id, balise, rang, profondeur: pile.filter((x) => x.piece).length, ...(ancetre ? { parent: ancetre.id } : {}) };
      pieces.push(piece);
    }
    // Un paramètre posé sur une balise sans nom revient à la pièce qui la contient.
    const porteuse = piece ?? ancetre;
    if (porteuse) {
      for (const p of m[3]!.matchAll(/\sdata-param(?:-src|-show)?="([^"]*)"/g)) {
        porteuse.parametres = porteuse.parametres ?? [];
        if (!porteuse.parametres.includes(p[1]!)) porteuse.parametres.push(p[1]!);
      }
    }
    const autoFermee = /\/\s*$/.test(m[3]!);
    if (!BALISES_VIDES.has(balise) && !autoFermee) pile.push({ balise, ...(piece ? { piece } : {}), enfants: 0 });
  }
  return pieces;
}

/** Le SVG tient à sa casse (`linearGradient`, `viewBox`) : on la rend telle qu'il l'attend. */
const CASSE_SVG: Record<string, string> = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', textpath: 'textPath',
  fegaussianblur: 'feGaussianBlur', feoffset: 'feOffset', feblend: 'feBlend', fecolormatrix: 'feColorMatrix', femerge: 'feMerge',
  femergenode: 'feMergeNode', feflood: 'feFlood', fecomposite: 'feComposite', fedropshadow: 'feDropShadow', feturbulence: 'feTurbulence',
  fedisplacementmap: 'feDisplacementMap', femorphology: 'feMorphology', fecomponenttransfer: 'feComponentTransfer',
  fefunca: 'feFuncA', fefuncr: 'feFuncR', fefuncg: 'feFuncG', fefuncb: 'feFuncB',
};
const CASSE_ATTRIBUTS: Record<string, string> = {
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  spreadmethod: 'spreadMethod', patternunits: 'patternUnits', patterncontentunits: 'patternContentUnits', patterntransform: 'patternTransform',
  maskunits: 'maskUnits', maskcontentunits: 'maskContentUnits', clippathunits: 'clipPathUnits', filterunits: 'filterUnits',
  primitiveunits: 'primitiveUnits', stddeviation: 'stdDeviation', basefrequency: 'baseFrequency', numoctaves: 'numOctaves',
  stitchtiles: 'stitchTiles', xchannelselector: 'xChannelSelector', ychannelselector: 'yChannelSelector', tablevalues: 'tableValues',
  markerwidth: 'markerWidth', markerheight: 'markerHeight', refx: 'refX', refy: 'refY', markerunits: 'markerUnits',
  pathlength: 'pathLength', textlength: 'textLength', lengthadjust: 'lengthAdjust', startoffset: 'startOffset',
};

function nomSortie(nom: string): string {
  return CASSE_SVG[nom] ?? nom;
}
function nomAttribut(nom: string): string {
  return CASSE_ATTRIBUTS[nom] ?? nom;
}

/* ------------------------------------------------------------------ */
/* La feuille de style d'un dessin, cantonnée à son segment            */
/* ------------------------------------------------------------------ */

/** Coupe une liste de sélecteurs aux virgules de premier niveau (pas celles de `:is(a, b)`). */
function couperSelecteurs(liste: string): string[] {
  const morceaux: string[] = [];
  let profondeur = 0;
  let courant = '';
  for (const c of liste) {
    if (c === '(' || c === '[') profondeur++;
    if (c === ')' || c === ']') profondeur--;
    if (c === ',' && profondeur === 0) {
      morceaux.push(courant);
      courant = '';
    } else courant += c;
  }
  morceaux.push(courant);
  return morceaux.map((s) => s.trim()).filter(Boolean);
}

function prefixerSelecteur(selecteur: string, portee: string): string {
  const s = selecteur.replace(/^(?::root|html|body)(?=$|[\s.#:[>+~])/, '').trim();
  if (!s) return portee;
  return `${portee} ${s}`;
}

/**
 * CANTONNER UNE FEUILLE À SON SEGMENT : chaque sélecteur reçoit la portée du
 * segment devant lui. Deux dessins qui nomment tous deux « .titre » ne se
 * marchent plus dessus. `@media` et `@supports` sont descendus ; tout autre
 * bloc « @ » est retiré (le nettoyage a déjà refusé les dangereux).
 */
export function cantonnerCss(css: string, portee: string): string {
  const sortie: string[] = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ouverture = css.indexOf('{', i);
    if (ouverture < 0) break;
    const tete = css.slice(i, ouverture).trim();
    // Trouver l'accolade fermante correspondante.
    let profondeur = 1;
    let j = ouverture + 1;
    while (j < n && profondeur > 0) {
      if (css[j] === '{') profondeur++;
      else if (css[j] === '}') profondeur--;
      j++;
    }
    const corps = css.slice(ouverture + 1, j - 1);
    i = j;
    if (!tete) continue;
    if (tete.startsWith('@')) {
      if (/^@(media|supports|container)\b/i.test(tete)) sortie.push(`${tete}{${cantonnerCss(corps, portee)}}`);
      continue;
    }
    const selecteurs = couperSelecteurs(tete).map((s) => prefixerSelecteur(s, portee));
    sortie.push(`${selecteurs.join(',')}{${corps}}`);
  }
  return sortie.join('\n');
}

/** La portée CSS d'un segment. */
export function porteeDuSegment(segmentId: string): string {
  return `[data-seg="${segmentId}"]`;
}
