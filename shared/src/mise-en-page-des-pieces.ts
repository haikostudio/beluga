/**
 * LA MISE EN PAGE D'UNE PIÈCE ÉCRITE DU SUIVI (brief, direction, scénario,
 * storyboard, plan — 25/10/2026). Le directeur écrit ses pièces ligne à ligne,
 * avec des intitulés (« OBJECTIF : », « - Public : », « DURÉE : 15 s. ANGLE A. »)
 * et parfois un tableau (« | Temps | Visuel | Voix off | »). Cette règle
 * découpe le texte en BLOCS que l'écran dessine (`blocsDePiece`) :
 *
 *  - UN INTITULÉ EST UN TITRE, SON CONTENU EST DESSOUS (demande de
 *    l'utilisateur, capture #2243) : « Objectif » en gras sur sa ligne, puis
 *    « Présenter l'offre… » en dessous — plus jamais « — Objectif : … ». Un
 *    intitulé, c'est un libellé COURT (quatre mots au plus) suivi de « : » en
 *    début de ligne — en capitales (« ACCROCHE (0-2 s) : »), après un marqueur
 *    de liste (« - Message clé : »), déjà en gras (« **Ton** : »), ou capitalisé
 *    de deux mots au plus (« Attention : ») ; au fil de la ligne, seulement un
 *    libellé en CAPITALES qui suit une fin de phrase (« … 65 s. FORMAT : 16:9. »),
 *    qui ouvre alors son propre titre ;
 *  - AUCUN MARQUEUR DE LISTE : le tiret, l'astérisque ou la puce disparaissent ;
 *    le NUMÉRO d'une liste numérotée reste, il porte l'ordre (« 1. Ouverture ») ;
 *  - un intitulé sans rien derrière (« Objectif : » en fin de ligne) est un
 *    titre seul, et les lignes ordinaires qui le suivent deviennent son contenu ;
 *  - RIEN NE BOUGE dans un tableau, un bloc de code, un titre « # », ni sur un
 *    libellé qui porte un chiffre (« 0 à 14 s : ») ou une virgule (« Moi, je
 *    dis : ») : ils restent du texte.
 *
 * Le texte BRUT de la pièce ne change pas : « Modifier » édite toujours ce que
 * l'agent ou l'utilisateur a écrit (MEM-5583).
 */

const MAJ = 'A-ZÀ-ÖØ-Þ';
const MIN = 'a-zß-öø-ÿ';
/** Un libellé en capitales, éventuellement suivi d'une précision entre parenthèses. */
const CAPITALES = `[${MAJ}][${MAJ}'’\\- ]*[${MAJ}](?:\\s*\\([^()\\n]{1,40}\\))?`;
const LIBELLE_EN_CAPITALES_EN_TETE = new RegExp(`^(${CAPITALES})\\s?:(?=\\s|$)`);
const LIBELLE_EN_CAPITALES_AU_FIL = new RegExp(`([.;!?»)]\\s+)(${CAPITALES})\\s?:(?=\\s)`, 'g');
/** Un libellé ordinaire (« Message clé »), réservé au début de ligne ou d'un élément de liste. */
const LIBELLE_ORDINAIRE = new RegExp(`^([${MAJ}${MIN}][${MAJ}${MIN}'’\\-]*(?: [${MAJ}${MIN}'’\\-]+){0,3})\\s?:(?=\\s|$)`);
/** Un libellé déjà mis en gras (« **Ton** : »). */
const LIBELLE_EN_GRAS = /^\*\*([^*\n]{1,60}?)\*\*\s?:(?=\s|$)/;
const LISTE = /^\s*([-*•]|\d+\.)\s+(.*)$/;

function nombreDeMots(libelle: string): number {
  return libelle.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

/** L'intitulé qui ouvre un texte, et ce qui le suit ; `null` quand le texte n'en a pas. */
function intituleEnTete(texte: string, dansUneListe: boolean): { libelle: string; reste: string } | null {
  const gras = LIBELLE_EN_GRAS.exec(texte);
  if (gras) {
    const libelle = gras[1]!.trim();
    return nombreDeMots(libelle) <= 4 && !/[\d,]/.test(libelle) ? { libelle, reste: texte.slice(gras[0].length).trim() } : null;
  }
  if (texte.startsWith('*')) return null;
  const capitales = LIBELLE_EN_CAPITALES_EN_TETE.exec(texte);
  if (capitales && nombreDeMots(capitales[1]!) <= 4) return { libelle: capitales[1]!, reste: texte.slice(capitales[0].length).trim() };
  const ordinaire = LIBELLE_ORDINAIRE.exec(texte);
  if (ordinaire && (dansUneListe || (new RegExp(`^[${MAJ}]`).test(ordinaire[1]!) && nombreDeMots(ordinaire[1]!) <= 2))) {
    return { libelle: ordinaire[1]!, reste: texte.slice(ordinaire[0].length).trim() };
  }
  return null;
}

/** Le texte avant le premier intitulé en capitales au fil de la ligne, puis chaque intitulé et sa suite. */
function intitulesAuFil(texte: string): { avant: string; suites: { libelle: string; reste: string }[] } {
  const coupes: { debut: number; fin: number; libelle: string }[] = [];
  for (const m of texte.matchAll(LIBELLE_EN_CAPITALES_AU_FIL)) {
    if (nombreDeMots(m[2]!) > 4) continue;
    const debut = m.index! + m[1]!.length;
    coupes.push({ debut, fin: m.index! + m[0].length, libelle: m[2]! });
  }
  if (!coupes.length) return { avant: texte, suites: [] };
  const avant = texte.slice(0, coupes[0]!.debut).trim();
  const suites = coupes.map((c, i) => ({ libelle: c.libelle, reste: texte.slice(c.fin, coupes[i + 1]?.debut ?? texte.length).trim() }));
  return { avant, suites };
}

/** Un bloc d'une pièce, tel que l'écran le dessine. */
export type BlocDePiece =
  /** Un intitulé : son titre en gras sur sa ligne, son contenu (Markdown) dessous, vide s'il n'en a pas. */
  | { genre: 'intitule'; titre: string; texte: string }
  /** Une ligne ordinaire, sans marqueur de liste ; le numéro d'une liste numérotée à part. */
  | { genre: 'texte'; texte: string; numero?: string }
  /** Un tableau, un bloc de code ou un titre « # », rendus tels quels. */
  | { genre: 'markdown'; texte: string };

/** Le texte d'une pièce, découpé en blocs : intitulés en titre, lignes sans tiret, tableaux intacts. */
export function blocsDePiece(contenu: string): BlocDePiece[] {
  const lignes = String(contenu ?? '').replace(/\r/g, '').split('\n');
  const blocs: BlocDePiece[] = [];
  /* Le bloc tel quel en cours (tableau, code, titre) : ses lignes se suivent. */
  let brut: { genre: 'tableau' | 'code' | 'titre'; lignes: string[] } | null = null;
  /* Un intitulé resté sans contenu : les lignes ordinaires qui suivent le remplissent. */
  const suivi: { enAttente: Extract<BlocDePiece, { genre: 'intitule' }> | null } = { enAttente: null };
  const fermerLeBrut = () => {
    if (brut) blocs.push({ genre: 'markdown', texte: brut.lignes.join('\n') });
    brut = null;
  };
  const intitule = (titre: string, texte: string) => {
    const bloc = { genre: 'intitule' as const, titre, texte };
    blocs.push(bloc);
    suivi.enAttente = texte ? null : bloc;
  };
  for (const ligne of lignes) {
    const nette = ligne.trim();
    if (brut?.genre === 'code') {
      brut.lignes.push(ligne);
      if (nette.startsWith('```')) fermerLeBrut();
      continue;
    }
    if (nette.startsWith('```')) {
      fermerLeBrut();
      suivi.enAttente = null;
      brut = { genre: 'code', lignes: [ligne] };
      continue;
    }
    if (nette.startsWith('|')) {
      if (brut?.genre !== 'tableau') fermerLeBrut();
      brut ??= { genre: 'tableau', lignes: [] };
      brut.lignes.push(nette);
      suivi.enAttente = null;
      continue;
    }
    fermerLeBrut();
    if (!nette) continue;
    if (/^#{1,6}\s/.test(nette) || nette.startsWith('>')) {
      blocs.push({ genre: 'markdown', texte: nette });
      suivi.enAttente = null;
      continue;
    }
    const liste = LISTE.exec(nette);
    const marqueur = liste?.[1];
    const numero = marqueur && /^\d+\.$/.test(marqueur) ? marqueur : undefined;
    const corps = liste ? liste[2]!.trim() : nette;
    const tete = intituleEnTete(corps, !!liste);
    const { avant, suites } = intitulesAuFil(tete ? tete.reste : corps);
    if (tete) intitule(numero ? `${numero} ${tete.libelle}` : tete.libelle, avant);
    else if (avant) {
      const attente = suivi.enAttente;
      if (attente && !liste) attente.texte = attente.texte ? `${attente.texte}\n\n${avant}` : avant;
      else {
        blocs.push(numero ? { genre: 'texte', texte: avant, numero } : { genre: 'texte', texte: avant });
        suivi.enAttente = null;
      }
    }
    for (const suite of suites) intitule(suite.libelle, suite.reste);
  }
  fermerLeBrut();
  return blocs;
}

/**
 * CE QUE LE SUIVI MONTRE D'UNE ÉTAPE (25/10/2026) : une piste ÉCARTÉE
 * (direction `refuse`) ne revient JAMAIS dans la liste, qu'une direction soit
 * retenue ou non — réécrire le brief repasse la retenue « à proposer »
 * (`invaliderLAval`), et les écartées réapparaissaient. Elles vivent dans le
 * menu « Versions » (« Autres pistes ») : celui de la direction retenue, ou,
 * sans retenue, celui de chaque direction montrée ; d'où l'on peut en
 * reprendre une. Le compteur de l'étape compte ce qui est montré.
 */
export function piecesAffichees<T extends { genre: string; etat: string }>(elements: readonly T[]): { affichees: T[]; ecartees: T[]; retenue: T | null } {
  const retenue = elements.find((e) => e.genre === 'concept' && e.etat === 'valide') ?? null;
  const ecartees = elements.filter((e) => e.genre === 'concept' && e.etat === 'refuse');
  return { affichees: elements.filter((e) => !ecartees.includes(e)), ecartees, retenue };
}
