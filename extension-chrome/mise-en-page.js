/**
 * LA MISE EN PAGE DES RÉPONSES DU PANNEAU (1.0.7, carte « Réponses mises en page et boutons contrastés ») : la même que
 * la réponse d'un agent dans la conversation de l'application (`Markdown … enPoints`, web/src/lib/markdown.tsx) —
 * sommaire numéroté en tête dès deux titres, titres en gras sans cadre, vrais tableaux qui défilent chez eux, encadrés
 * « > [!NOTE] », citations, séparateurs, listes imbriquées, code en ligne en pastille. Plus AUCUN signe de Markdown
 * brut à l'écran (capture #f6c2 : un tableau sorti en barres et tirets).
 *
 * Module PUR, sans `chrome` ni DOM : il rend des MORCEAUX — du HTML déjà ÉCHAPPÉ, ou un bloc de code que le panneau
 * pose en vignette repliée. Le test du démon l'importe tel quel (server/src/test/extension-chrome.test.ts).
 * Le texte vient de l'agent : il est ÉCHAPPÉ AVANT toute interprétation, et un lien ne s'ouvre que vers http(s).
 */
import { t } from './langues.js';

/** Un sommaire dès DEUX titres, comme le compte rendu en points de l'application (`sommaireDesPoints`). */
export const SOMMAIRE_TITRES_MIN = 2;

export function echapper(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Le texte d'un titre sans ses emojis ni son numéro (« 1. »), comme `titreSansEmoji` de l'application. */
function titreNu(s) {
  return String(s)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
}

/** Le Markdown d'une ligne BRUTE : gras, italique, liens — le code en ligne d'abord, à l'abri de tout le reste. */
export function enLigne(brut) {
  return String(brut)
    .split(/(`[^`\n]+`)/g)
    .map((morceau, i) => {
      if (i % 2) return `<code>${echapper(morceau.slice(1, -1))}</code>`;
      return echapper(morceau)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, texte, href) => (/^https?:\/\//.test(href) ? `<a href="${href}" target="_blank" rel="noreferrer">${texte}</a>` : texte))
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\p{L}\p{N}])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\p{L}\p{N}])/gu, '$1<em>$2</em>')
        .replace(/(^|[^\p{L}\p{N}_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>');
    })
    .join('');
}

/** Le même texte, tel qu'il se lit (sans étoiles ni accents graves) : pour le sommaire. */
function texteLisible(brut) {
  return titreNu(
    String(brut)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2'),
  );
}

/* ------------------------------------------------------------------ */
/* Les blocs                                                            */
/* ------------------------------------------------------------------ */

const SEPARATEUR_DE_TABLEAU = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
const LIGNE_DE_LISTE = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/;
const ENCADRE = /^>\s*\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

/** Les cellules d'une ligne de tableau : un « | » dans du code ou échappé (« \| ») ne coupe pas. */
export function cellules(ligne) {
  let s = ligne.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const sortie = [];
  let courante = '';
  let dansCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      courante += '|';
      i++;
    } else if (c === '`') {
      dansCode = !dansCode;
      courante += c;
    } else if (c === '|' && !dansCode) {
      sortie.push(courante.trim());
      courante = '';
    } else courante += c;
  }
  sortie.push(courante.trim());
  return sortie;
}

const estLigneDeTableau = (l) => l.includes('|') && /^\s*\|?.*\|.*$/.test(l);

/**
 * Le texte découpé en blocs : titre, paragraphe, liste (avec ses niveaux), tableau, encadré, citation, séparateur,
 * code. Un tableau mal formé (aucune ligne de séparation) reste un paragraphe : il ne disparaît jamais.
 */
export function blocs(texte) {
  const lignes = String(texte ?? '').replace(/\r/g, '').split('\n');
  const sortie = [];
  let para = [];
  const fermerPara = () => {
    if (para.length) sortie.push({ genre: 'paragraphe', lignes: para });
    para = [];
  };
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    const nette = ligne.trim();
    if (!nette) {
      fermerPara();
      continue;
    }
    /* Un bloc de code : jusqu'à sa clôture, ou jusqu'à la fin (réponse encore en cours d'écriture). */
    if (nette.startsWith('```')) {
      fermerPara();
      const langage = nette.slice(3).trim();
      const code = [];
      i++;
      while (i < lignes.length && !lignes[i].trim().startsWith('```')) code.push(lignes[i++]);
      sortie.push({ genre: 'code', langage, code: code.join('\n') });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(nette.replace(/\s+/g, ''))) {
      fermerPara();
      sortie.push({ genre: 'separateur' });
      continue;
    }
    const titre = /^(#{1,6})\s+(.+?)\s*#*$/.exec(nette);
    if (titre) {
      fermerPara();
      sortie.push({ genre: 'titre', niveau: titre[1].length, texte: titre[2] });
      continue;
    }
    if (nette.startsWith('>')) {
      fermerPara();
      const encadre = ENCADRE.exec(nette);
      const corps = encadre && encadre[2] ? [encadre[2]] : [];
      if (!encadre) corps.push(nette.replace(/^>\s?/, ''));
      while (i + 1 < lignes.length && lignes[i + 1].trim().startsWith('>')) corps.push(lignes[++i].trim().replace(/^>\s?/, ''));
      sortie.push({ genre: encadre ? 'encadre' : 'citation', variante: encadre ? encadre[1].toUpperCase() : null, lignes: corps.filter((l) => l.trim()) });
      continue;
    }
    if (estLigneDeTableau(nette) && i + 1 < lignes.length && SEPARATEUR_DE_TABLEAU.test(lignes[i + 1].trim()) && lignes[i + 1].includes('-')) {
      fermerPara();
      const tete = cellules(nette);
      const rangees = [];
      i += 2;
      while (i < lignes.length && lignes[i].trim() && estLigneDeTableau(lignes[i].trim())) rangees.push(cellules(lignes[i++]));
      i--;
      /* Des rangées de largeur inégale se calent sur l'en-tête : jamais une case qui manque ni qui déborde. */
      const largeur = tete.length;
      sortie.push({ genre: 'tableau', tete, rangees: rangees.map((r) => (r.length >= largeur ? r.slice(0, largeur) : [...r, ...Array(largeur - r.length).fill('')])) });
      continue;
    }
    if (LIGNE_DE_LISTE.test(ligne)) {
      fermerPara();
      const elements = [];
      while (i < lignes.length) {
        const l = lignes[i];
        const m = LIGNE_DE_LISTE.exec(l);
        if (m) {
          elements.push({ retrait: m[1].replace(/\t/g, '  ').length, numerote: /\d/.test(m[2]), texte: m[3] });
        } else if (l.trim() && /^\s{2,}\S/.test(l) && elements.length) {
          elements[elements.length - 1].texte += ` ${l.trim()}`;
        } else break;
        i++;
      }
      i--;
      sortie.push({ genre: 'liste', elements });
      continue;
    }
    para.push(nette);
  }
  fermerPara();
  return sortie;
}

/* ------------------------------------------------------------------ */
/* Le rendu                                                             */
/* ------------------------------------------------------------------ */

const LIBELLES_D_ENCADRE = { TIP: 'Conseil', NOTE: 'Note', IMPORTANT: 'Important', WARNING: 'Attention', CAUTION: 'Risque' };

/** Une liste et ses sous-listes : un élément plus en retrait que le précédent ouvre une liste dans celui-ci. */
function rendreLaListe(elements) {
  let html = '';
  const pile = [];
  for (const e of elements) {
    while (pile.length && e.retrait < pile[pile.length - 1].retrait) html += `</li></${pile.pop().balise}>`;
    const haut = pile[pile.length - 1];
    if (!haut || e.retrait > haut.retrait) {
      const balise = e.numerote ? 'ol' : 'ul';
      html += `<${balise}>`;
      pile.push({ retrait: e.retrait, balise });
    } else html += '</li>';
    html += `<li>${enLigne(e.texte)}`;
  }
  while (pile.length) html += `</li></${pile.pop().balise}>`;
  return html;
}

function rendreUnBloc(b, rang) {
  switch (b.genre) {
    case 'titre':
      return `<h4 class="titre-du-point" data-titre-du-point="${rang}">${enLigne(titreNu(b.texte))}</h4>`;
    case 'separateur':
      return '<hr>';
    case 'liste':
      return rendreLaListe(b.elements);
    case 'tableau':
      /* UN TABLEAU LARGE DÉFILE CHEZ LUI : l'enveloppe défile, jamais le panneau (piège MEM-7226). */
      return (
        '<div class="tableau" data-tableau-markdown><table><thead><tr>' +
        b.tete.map((c) => `<th>${enLigne(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        b.rangees.map((r) => `<tr>${r.map((c) => `<td>${enLigne(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table></div>'
      );
    case 'encadre':
      return `<div class="encadre" data-encadre="${b.variante}"><div class="libelle-encadre">${echapper(t(LIBELLES_D_ENCADRE[b.variante] ?? 'Note'))}</div>${b.lignes.map((l) => `<p>${enLigne(l)}</p>`).join('')}</div>`;
    case 'citation':
      return `<blockquote>${b.lignes.map((l) => `<p>${enLigne(l)}</p>`).join('')}</blockquote>`;
    default:
      return `<p>${b.lignes.map(enLigne).join('<br>')}</p>`;
  }
}

/**
 * LA RÉPONSE MISE EN PAGE : une suite de morceaux, `{ genre: 'html', html }` ou `{ genre: 'code', langage, code }`
 * (le panneau en fait une vignette repliée). En tête, dès deux titres et hors écriture en cours, le SOMMAIRE : une ligne
 * numérotée par titre, `data-aller-au-titre` désignant le `data-titre-du-point` visé.
 */
export function miseEnPage(texte, { enCours = false } = {}) {
  const liste = blocs(texte);
  const titres = liste.filter((b) => b.genre === 'titre');
  const morceaux = [];
  let html = '';
  const fermer = () => {
    if (html) morceaux.push({ genre: 'html', html });
    html = '';
  };
  if (!enCours && titres.length >= SOMMAIRE_TITRES_MIN) {
    html +=
      `<nav class="sommaire" data-sommaire="${titres.length}" aria-label="Sommaire"><div class="intitule-sommaire">${echapper(t('Sommaire'))}</div>` +
      titres.map((b, i) => `<button type="button" class="ligne-sommaire" data-aller-au-titre="${i + 1}"><span class="rang">${i + 1}.</span><span class="texte">${echapper(texteLisible(b.texte))}</span></button>`).join('') +
      '</nav>';
  }
  let rang = 0;
  for (const b of liste) {
    if (b.genre === 'code') {
      fermer();
      morceaux.push({ genre: 'code', langage: b.langage, code: b.code });
      continue;
    }
    html += rendreUnBloc(b, b.genre === 'titre' ? ++rang : 0);
  }
  fermer();
  return morceaux;
}
