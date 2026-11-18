/**
 * CE QUI A CHANGÉ D'UNE COMPRÉHENSION À LA SUIVANTE, MARQUÉ EN VIOLET PAR L'ÉCRAN (décision du
 * 13/11/2026, carte « Ressources : volet, modales et sources » : « il faut marquer en violet le
 * contenu qui a changé dans le texte de la compréhension complète par rapport à la précédente »).
 *
 * Chaque échange se termine par la compréhension COMPLÈTE ; l'agent ne signale rien. L'écran
 * compare la nouvelle à la compréhension IMMÉDIATEMENT précédente de la même carte : il découpe
 * chacune en points « ### », puis en phrases, et dit pour chaque phrase de la nouvelle si elle
 * est INCHANGÉE ou NOUVELLE (ou modifiée). La comparaison est NORMALISÉE — casse, espaces,
 * ponctuation et habillage Markdown ne comptent pas : une virgule déplacée ne colore rien. Un
 * point au TITRE nouveau est neuf en entier, titre compris. Sans précédente (première
 * compréhension), rien n'est neuf.
 *
 * Règle PURE : `marquerLesEcarts` pose deux caractères invisibles autour de chaque phrase neuve,
 * APRÈS le préfixe Markdown de sa ligne (titre, puce, numéro, citation) pour ne jamais casser la
 * mise en page ; le rendu Markdown de l'écran les lit et colore la phrase en violet.
 */

/** Ouvre une phrase neuve (caractère d'usage privé, jamais tapé par personne). */
export const MARQUE_ECART_OUVRE = '';
/** Ferme une phrase neuve. */
export const MARQUE_ECART_FERME = '';

export interface PhraseComparee {
  /** La phrase telle qu'écrite dans la nouvelle compréhension. */
  texte: string;
  /** Le titre « ### » du point qui la porte (vide avant le premier titre). */
  point: string;
  /** Un titre de point, ou une phrase de son texte. */
  titre: boolean;
  etat: 'inchangee' | 'neuve';
}

/** Ce qui ne compte pas dans une comparaison : casse, espaces, ponctuation, habillage Markdown. */
export function normaliserUnePhrase(phrase: string): string {
  return phrase
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[*_`~[\]()]/g, ' ')
    .replace(/[.,;:!?…«»"'’‘“”—–\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le préfixe Markdown d'une ligne : titre, puce, numéro, citation — jamais marqué. */
const PREFIXE_DE_LIGNE = /^(\s*(?:#{1,6}\s+(?:\d+\.\s+)?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)*)/;
/** La fin d'une phrase : ponctuation forte (et ses habillages fermants) suivie d'un blanc. */
const FIN_DE_PHRASE = /(?<=[.!?…][*_`»"”’)]*)\s+(?=\S)/g;

interface Morceau {
  prefixe: string;
  /** Les phrases de la ligne, et le blanc qui suit chacune. */
  phrases: { texte: string; apres: string }[];
  titre: boolean;
  code: boolean;
}

/** Une image seule sur sa ligne (« ![légende](piece:id) ») : un bloc INSÉCABLE, jamais coupé en phrases. */
const LIGNE_D_IMAGE = /^!\[[^\]]*\]\(piece:[A-Za-z0-9-]+\)$/;

function decouperUneLigne(ligne: string, dansLeCode: boolean): Morceau {
  if (dansLeCode || ligne.trim().startsWith('```')) return { prefixe: ligne, phrases: [], titre: false, code: true };
  /* UNE LIGNE D'IMAGE reste UN SEUL morceau : sa légende peut porter « … » ou « . » suivis d'un blanc, et une coupe
     en plein milieu laissait une marque DANS la ligne, que l'écran ne reconnaissait plus comme une image (capture
     #fbac0, 14/11/2026). Neuve, elle est entourée en entier ; le rendu (`lireLigneDIllustration`) lit la marque. */
  if (LIGNE_D_IMAGE.test(ligne.trim())) {
    const debut = ligne.match(/^\s*/)?.[0] ?? '';
    return { prefixe: debut, phrases: [{ texte: ligne.trim(), apres: '' }], titre: false, code: false };
  }
  const prefixe = ligne.match(PREFIXE_DE_LIGNE)?.[0] ?? '';
  const reste = ligne.slice(prefixe.length);
  const titre = /^\s*#{1,6}\s/.test(prefixe);
  const phrases: { texte: string; apres: string }[] = [];
  if (titre) {
    if (reste) phrases.push({ texte: reste, apres: '' });
    return { prefixe, phrases, titre, code: false };
  }
  let depart = 0;
  for (const coupe of reste.matchAll(FIN_DE_PHRASE)) {
    /* Jamais de coupe DANS un habillage (`**…**`, `` `…` ``) : la marque le casserait à l'écran. */
    const avant = reste.slice(0, coupe.index);
    if ((avant.split('**').length - 1) % 2 === 1 || (avant.split('`').length - 1) % 2 === 1) continue;
    phrases.push({ texte: reste.slice(depart, coupe.index), apres: coupe[0] });
    depart = (coupe.index ?? 0) + coupe[0].length;
  }
  if (depart < reste.length) phrases.push({ texte: reste.slice(depart), apres: '' });
  return { prefixe, phrases, titre, code: false };
}

function decouper(texte: string): Morceau[] {
  const morceaux: Morceau[] = [];
  let dansLeCode = false;
  for (const ligne of texte.replace(/\r/g, '').split('\n')) {
    const morceau = decouperUneLigne(ligne, dansLeCode);
    if (ligne.trim().startsWith('```')) dansLeCode = !dansLeCode;
    morceaux.push(morceau);
  }
  return morceaux;
}

/** Les titres et les phrases d'une compréhension, normalisés. */
function empreintes(texte: string): { titres: Set<string>; phrases: Set<string> } {
  const titres = new Set<string>();
  const phrases = new Set<string>();
  for (const morceau of decouper(texte)) {
    for (const phrase of morceau.phrases) {
      const cle = normaliserUnePhrase(phrase.texte);
      if (!cle) continue;
      (morceau.titre ? titres : phrases).add(cle);
    }
  }
  return { titres, phrases };
}

/** Parcourt la nouvelle et décide, phrase par phrase, si elle est neuve. */
function parcourir(precedente: string | null | undefined, nouvelle: string, visiter: (morceau: Morceau, neuves: boolean[], point: string) => void): void {
  const avant = precedente?.trim() ? empreintes(precedente) : null;
  let point = '';
  let pointNeuf = false;
  for (const morceau of decouper(nouvelle)) {
    if (morceau.titre) {
      point = morceau.phrases.map((p) => p.texte).join(' ').trim();
      const cle = normaliserUnePhrase(point);
      pointNeuf = !!avant && !!cle && !avant.titres.has(cle);
    }
    const neuves = morceau.phrases.map((phrase) => {
      if (!avant) return false;
      const cle = normaliserUnePhrase(phrase.texte);
      if (!cle) return false;
      if (morceau.titre) return pointNeuf;
      return pointNeuf || !avant.phrases.has(cle);
    });
    visiter(morceau, neuves, point);
  }
}

/** Pour chaque phrase de la nouvelle compréhension : inchangée, ou neuve (nouvelle ou modifiée). */
export function ecartsDeComprehension(precedente: string | null | undefined, nouvelle: string): PhraseComparee[] {
  const resultat: PhraseComparee[] = [];
  parcourir(precedente, nouvelle, (morceau, neuves, point) => {
    morceau.phrases.forEach((phrase, i) => {
      if (!normaliserUnePhrase(phrase.texte)) return;
      resultat.push({ texte: phrase.texte.trim(), point, titre: morceau.titre, etat: neuves[i] ? 'neuve' : 'inchangee' });
    });
  });
  return resultat;
}

/**
 * La nouvelle compréhension, chaque phrase neuve entourée de `MARQUE_ECART_OUVRE` /
 * `MARQUE_ECART_FERME`. Sans précédente, le texte revient tel quel.
 */
export function marquerLesEcarts(precedente: string | null | undefined, nouvelle: string): string {
  if (!precedente?.trim()) return nouvelle;
  const lignes: string[] = [];
  parcourir(precedente, nouvelle, (morceau, neuves) => {
    if (morceau.code) {
      lignes.push(morceau.prefixe);
      return;
    }
    const corps = morceau.phrases
      .map((phrase, i) => {
        if (!neuves[i]) return phrase.texte + phrase.apres;
        /* Le blanc de fin reste HORS de la marque : il sépare la phrase de la suivante. */
        const fin = phrase.texte.match(/\s*$/)?.[0] ?? '';
        const coeur = phrase.texte.slice(0, phrase.texte.length - fin.length);
        return `${MARQUE_ECART_OUVRE}${coeur}${MARQUE_ECART_FERME}${fin}${phrase.apres}`;
      })
      .join('');
    lignes.push(morceau.prefixe + corps);
  });
  return lignes.join('\n');
}

/** Le texte sans ses marques d'écart (sommaire, copie, texte lisible). */
export function sansMarquesDEcart(texte: string): string {
  return texte.replaceAll(MARQUE_ECART_OUVRE, '').replaceAll(MARQUE_ECART_FERME, '');
}
