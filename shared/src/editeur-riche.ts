/**
 * L'ÉDITEUR RICHE DES NOTES — les règles de mise en forme, sans DOM ni disque.
 *
 * Une note se STOCKE en Markdown : c'est du texte lisible à l'œil nu, qui
 * survivra à l'éditeur qui l'a écrit. L'écran, lui, travaille en HTML dans une
 * zone modifiable (`contenteditable`). Ce fichier tient les deux traversées :
 *
 *   markdownVersHtml()  — ce qu'on montre à l'ouverture d'une note
 *   noeudsVersMarkdown() — ce qu'on enregistre après chaque frappe
 *
 * LE SENS RETOUR NE LIT PAS LE DOM : le navigateur produit un HTML brouillon
 * (des `<div>` imbriqués, des `<span style>` empilés, des `<b>` et des
 * `<font>`), et ce fichier doit rester testable sans navigateur. L'écran
 * traduit donc d'abord ses vrais nœuds en `NoeudRiche` — une forme minuscule
 * décrite ici — et c'est cette forme qui devient du Markdown.
 *
 * LES COULEURS DE TEXTE n'existent pas en Markdown : elles s'écrivent en
 * `<span style="color:…">`, qui EST du Markdown valide (le HTML y est admis),
 * et se relisent telles quelles.
 */

import { echapperHtml } from './demande-copiable.js';

/** Un nœud de l'éditeur, réduit à ce qui porte du sens. */
export type NoeudRiche =
  | { texte: string }
  | {
      balise: string;
      enfants: NoeudRiche[];
      /** La couleur posée sur ce nœud, au format CSS (`#a0a`, `rgb(…)`). */
      couleur?: string;
      /** L'adresse d'un lien (`a`) ou d'une image (`img`). */
      href?: string;
      src?: string;
      alt?: string;
    };

/** Les balises que l'éditeur sait rendre : tout le reste est traversé. */
const TITRES: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ' };

/** Le texte d'un nœud, sans aucune mise en forme — pour un titre ou un code. */
function texteBrut(noeuds: NoeudRiche[]): string {
  return noeuds
    .map((n) => {
      if ('texte' in n) return n.texte;
      if (n.balise === 'br') return '\n';
      return texteBrut(n.enfants);
    })
    .join('');
}

/** Les caractères qui feraient basculer du texte ordinaire en mise en forme. */
function echapperMarkdown(texte: string): string {
  return texte.replace(/([\\`*_[\]])/g, '\\$1');
}

/**
 * Le contenu EN LIGNE d'un bloc : gras, italique, code, liens, images,
 * couleurs. Les blocs (titres, listes, citations) sont traités au-dessus.
 */
function enLigneVersMarkdown(noeuds: NoeudRiche[]): string {
  let sortie = '';
  for (const noeud of noeuds) {
    if ('texte' in noeud) {
      sortie += echapperMarkdown(noeud.texte);
      continue;
    }
    const balise = noeud.balise;
    if (balise === 'br') {
      sortie += '\n';
      continue;
    }
    if (balise === 'img') {
      sortie += `![${noeud.alt ?? ''}](${noeud.src ?? ''})`;
      continue;
    }
    const dedans = enLigneVersMarkdown(noeud.enfants);
    if (balise === 'a') {
      sortie += `[${dedans}](${noeud.href ?? ''})`;
    } else if (balise === 'b' || balise === 'strong') {
      sortie += dedans.trim() ? `**${dedans}**` : dedans;
    } else if (balise === 'i' || balise === 'em') {
      sortie += dedans.trim() ? `*${dedans}*` : dedans;
    } else if (balise === 'code') {
      sortie += `\`${texteBrut(noeud.enfants)}\``;
    } else if (noeud.couleur) {
      sortie += `<span style="color:${noeud.couleur}">${dedans}</span>`;
    } else {
      sortie += dedans;
    }
  }
  return sortie;
}

/** Un bloc de liste, aplati en lignes Markdown. */
function listeVersMarkdown(
  noeud: Extract<NoeudRiche, { balise: string }>,
  ordonnee: boolean,
): string[] {
  const lignes: string[] = [];
  let rang = 1;
  for (const enfant of noeud.enfants) {
    if ('texte' in enfant) continue;
    if (enfant.balise !== 'li') continue;
    const puce = ordonnee ? `${rang}. ` : '- ';
    lignes.push(puce + enLigneVersMarkdown(enfant.enfants).replace(/\n+/g, ' ').trim());
    rang += 1;
  }
  return lignes;
}

function estBloc(balise: string): boolean {
  return (
    balise in TITRES ||
    balise === 'ul' ||
    balise === 'ol' ||
    balise === 'blockquote' ||
    balise === 'pre' ||
    balise === 'p' ||
    balise === 'div'
  );
}

/**
 * LA TRAVERSÉE PRINCIPALE : les nœuds de l'éditeur deviennent du Markdown.
 *
 * Les blocs sont séparés par une ligne vide — sauf les lignes d'une même liste,
 * qui se suivent : une liste coupée par des blancs se relit comme des puces
 * détachées.
 */
export function noeudsVersMarkdown(noeuds: NoeudRiche[]): string {
  const blocs: string[] = [];

  const parcourir = (liste: NoeudRiche[]) => {
    // Ce qui traîne hors d'un bloc (du texte nu à la racine) fait un paragraphe.
    let enAttente: NoeudRiche[] = [];
    const viderAttente = () => {
      if (!enAttente.length) return;
      const texte = enLigneVersMarkdown(enAttente).trim();
      enAttente = [];
      if (texte) blocs.push(texte);
    };

    for (const noeud of liste) {
      if ('texte' in noeud) {
        if (noeud.texte.trim()) enAttente.push(noeud);
        continue;
      }
      const balise = noeud.balise;
      if (balise in TITRES) {
        viderAttente();
        const titre = enLigneVersMarkdown(noeud.enfants).trim();
        if (titre) blocs.push(TITRES[balise] + titre);
      } else if (balise === 'ul' || balise === 'ol') {
        viderAttente();
        const lignes = listeVersMarkdown(noeud, balise === 'ol');
        if (lignes.length) blocs.push(lignes.join('\n'));
      } else if (balise === 'blockquote') {
        viderAttente();
        const dedans = enLigneVersMarkdown(noeud.enfants).trim();
        if (dedans) blocs.push(dedans.split('\n').map((l) => `> ${l}`).join('\n'));
      } else if (balise === 'pre') {
        viderAttente();
        const code = texteBrut(noeud.enfants).replace(/\n+$/, '');
        blocs.push('```\n' + code + '\n```');
      } else if (balise === 'div' || balise === 'p') {
        viderAttente();
        // Un `div` peut contenir un vrai bloc (le navigateur enveloppe tout) :
        // on redescend, et ce qui n'est qu'en ligne fait un paragraphe.
        if (noeud.enfants.some((e) => !('texte' in e) && estBloc(e.balise))) {
          parcourir(noeud.enfants);
        } else {
          const texte = enLigneVersMarkdown(noeud.enfants).trim();
          if (texte) blocs.push(texte);
        }
      } else {
        enAttente.push(noeud);
      }
    }
    viderAttente();
  };

  parcourir(noeuds);
  return blocs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Une adresse acceptée dans un lien ou une image : rien d'exécutable. */
export function adresseSure(adresse: string): string {
  const nette = adresse.trim();
  if (/^(https?:|mailto:|data:image\/|\/|#)/i.test(nette)) return nette;
  return '';
}

/** Une couleur acceptée : un nom simple, un `#rgb`/`#rrggbb`, un `rgb(…)`. */
export function couleurSure(couleur: string): string {
  const nette = couleur.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(nette)) return nette;
  if (/^rgba?\([\d\s.,%/]+\)$/i.test(nette)) return nette;
  if (/^hsla?\([\d\s.,%/]+\)$/i.test(nette)) return nette;
  if (/^[a-z-]{3,24}$/i.test(nette)) return nette;
  return '';
}

/** Le contenu en ligne d'une ligne Markdown, rendu en HTML. */
function enLigneVersHtml(source: string): string {
  const morceaux: string[] = [];
  let reste = source;

  // Les `<span style="color:…">` écrits par l'éditeur sont rendus tels quels,
  // après contrôle de la couleur : c'est le seul HTML admis dans une note.
  const motif =
    /(\\.)|(<span style="color:([^"]*)">([\s\S]*?)<\/span>)|(!\[([^\]]*)\]\(([^)]*)\))|(\[([^\]]*)\]\(([^)]*)\))|(`([^`]+)`)|(\*\*([\s\S]+?)\*\*)|(\*([^*\n]+)\*)/;

  while (reste) {
    const trouve = motif.exec(reste);
    if (!trouve) {
      morceaux.push(echapperHtml(reste));
      break;
    }
    morceaux.push(echapperHtml(reste.slice(0, trouve.index)));
    const [entier] = trouve;
    if (trouve[1]) {
      morceaux.push(echapperHtml(trouve[1].slice(1)));
    } else if (trouve[2]) {
      const couleur = couleurSure(trouve[3] ?? '');
      const dedans = enLigneVersHtml(trouve[4] ?? '');
      morceaux.push(
        couleur ? `<span style="color:${echapperHtml(couleur)}">${dedans}</span>` : dedans,
      );
    } else if (trouve[5]) {
      const src = adresseSure(trouve[7] ?? '');
      morceaux.push(
        src ? `<img src="${echapperHtml(src)}" alt="${echapperHtml(trouve[6] ?? '')}" />` : '',
      );
    } else if (trouve[8]) {
      const href = adresseSure(trouve[10] ?? '');
      const texte = enLigneVersHtml(trouve[9] ?? '');
      morceaux.push(href ? `<a href="${echapperHtml(href)}">${texte}</a>` : texte);
    } else if (trouve[11]) {
      morceaux.push(`<code>${echapperHtml(trouve[12] ?? '')}</code>`);
    } else if (trouve[13]) {
      morceaux.push(`<b>${enLigneVersHtml(trouve[14] ?? '')}</b>`);
    } else if (trouve[15]) {
      morceaux.push(`<i>${enLigneVersHtml(trouve[16] ?? '')}</i>`);
    }
    reste = reste.slice(trouve.index + entier.length);
  }
  return morceaux.join('');
}

/**
 * LE MARKDOWN D'UNE NOTE, RENDU EN HTML MODIFIABLE.
 *
 * Chaque bloc devient un élément à lui : le curseur du navigateur a alors
 * quelque chose à quoi s'accrocher, et « titre 2 » posé sur une ligne ne
 * déborde pas sur la suivante. Une note vide rend un paragraphe vide, sans
 * quoi la zone modifiable n'aurait aucune ligne où écrire.
 */
export function markdownVersHtml(markdown: string): string {
  const lignes = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const sortie: string[] = [];
  let i = 0;

  while (i < lignes.length) {
    const ligne = lignes[i];

    if (!ligne.trim()) {
      i += 1;
      continue;
    }

    // Un bloc de code fermé par ses trois accents graves.
    if (/^```/.test(ligne)) {
      const corps: string[] = [];
      i += 1;
      while (i < lignes.length && !/^```/.test(lignes[i])) {
        corps.push(lignes[i]);
        i += 1;
      }
      i += 1;
      sortie.push(`<pre><code>${echapperHtml(corps.join('\n'))}</code></pre>`);
      continue;
    }

    const titre = /^(#{1,3})\s+(.*)$/.exec(ligne);
    if (titre) {
      const niveau = titre[1].length;
      sortie.push(`<h${niveau}>${enLigneVersHtml(titre[2])}</h${niveau}>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(ligne)) {
      const corps: string[] = [];
      while (i < lignes.length && /^>\s?/.test(lignes[i])) {
        corps.push(lignes[i].replace(/^>\s?/, ''));
        i += 1;
      }
      sortie.push(
        `<blockquote>${enLigneVersHtml(corps.join('\n')).replace(/\n/g, '<br />')}</blockquote>`,
      );
      continue;
    }

    if (/^[-*]\s+/.test(ligne)) {
      const items: string[] = [];
      while (i < lignes.length && /^[-*]\s+/.test(lignes[i])) {
        items.push(`<li>${enLigneVersHtml(lignes[i].replace(/^[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      sortie.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(ligne)) {
      const items: string[] = [];
      while (i < lignes.length && /^\d+[.)]\s+/.test(lignes[i])) {
        items.push(`<li>${enLigneVersHtml(lignes[i].replace(/^\d+[.)]\s+/, ''))}</li>`);
        i += 1;
      }
      sortie.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Un paragraphe : les lignes qui se suivent forment un seul bloc.
    const corps: string[] = [];
    while (
      i < lignes.length &&
      lignes[i].trim() &&
      !/^(#{1,3}\s|>|```|[-*]\s|\d+[.)]\s)/.test(lignes[i])
    ) {
      corps.push(lignes[i]);
      i += 1;
    }
    sortie.push(`<p>${enLigneVersHtml(corps.join('\n')).replace(/\n/g, '<br />')}</p>`);
  }

  return sortie.join('') || '<p><br /></p>';
}

/**
 * LE RÉSUMÉ D'UNE NOTE POUR SA CARTE : le Markdown débarrassé de ses signes.
 *
 * La liste de gauche montre un extrait sur deux lignes ; y laisser les dièses
 * et les étoiles ferait lire de la ponctuation au lieu du texte.
 */
export function extraitDeNote(markdown: string, longueur = 140): string {
  const plat = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<span style="color:[^"]*">([\s\S]*?)<\/span>/g, '$1')
    .replace(/^[>#\s]+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/[*`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plat.length > longueur ? `${plat.slice(0, longueur - 1).trimEnd()}…` : plat;
}

/**
 * LES TONS PROPOSÉS PAR L'ÉDITEUR, nommés par leur JETON de thème.
 *
 * Aucune couleur n'est écrite ici : seul le nom du jeton l'est. L'écran lit sa
 * valeur réelle sur la page, donc les douze palettes s'appliquent sans qu'une
 * seule teinte soit fixée. Les libellés vivent ici, avec le reste des règles :
 * l'écran les passe au dictionnaire au moment de les afficher.
 */
export const TONS_EDITEUR: { cle: string; libelle: string; jeton: string }[] = [
  { cle: 'defaut', libelle: 'Couleur du texte', jeton: '--text' },
  { cle: 'accent', libelle: 'Accent', jeton: '--accent' },
  { cle: 'danger', libelle: 'Alerte', jeton: '--danger' },
  { cle: 'warning', libelle: 'Attention', jeton: '--warning' },
  { cle: 'ok', libelle: 'Validé', jeton: '--ok' },
];
