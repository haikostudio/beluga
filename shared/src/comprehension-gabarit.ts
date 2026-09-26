/**
 * LA COMPRÉHENSION RANGÉE EN POINTS — la même forme que le compte rendu.
 *
 * Ce module RANGE le texte d'une compréhension pour que l'écran pose chaque
 * intitulé en point du fil, sans rien juger ni inventer : une phrase
 * d'ouverture, un SOMMAIRE NUMÉROTÉ s'il y en a un, puis un bloc par point —
 * « **1. Intitulé** — l'explication », « Comment : … » (la manière),
 * « Résultat : … » (ce qu'on verra à la fin). Le numéro du bloc RÉFÈRE à la
 * ligne du sommaire.
 *
 * IL EST TOLÉRANT, ET C'EST DEVENU LE CAS ORDINAIRE. Le cadrage n'IMPOSE plus
 * cette découpe : `FORME_DE_LA_COMPREHENSION` (`cadrage.ts`) accepte désormais
 * un texte libre et court, où les intertitres ne
 * se posent que s'ils aident à lire. Ce module accueille donc les DEUX formes
 * sans rien perdre : un texte sans sommaire, sans numéro, sans « Comment » ni
 * « Résultat » se range comme avant — les champs en question restent
 * simplement vides, `conforme` retombe à faux, et l'écran rend le texte entier
 * en paragraphes aérés. Les compréhensions DÉJÀ enregistrées au gabarit à
 * trois parties gardent, elles, leurs volets : c'est exactement ce que cette
 * tolérance protège. Un paragraphe qui ne s'ouvre pas sur un intitulé en gras,
 * placé APRÈS le premier point, se rattache au point qui le précède ; placé
 * avant, il rejoint l'ouverture ou le sommaire.
 *
 * NE PAS LE DURCIR. Un tour de cadrage dont la compréhension ne s'affiche pas
 * coûte un tour entier : ce module ne refuse jamais rien, il replie.
 *
 * Règle pure : ni base, ni disque, ni réseau
 * (`server/src/test/comprehension-gabarit.test.ts`).
 */

/** Un point compris : son intitulé, sa référence au sommaire, et son texte. */
export interface PointDeComprehension {
  intitule: string;
  /** Le corps ENTIER, tel qu'il a été écrit : le repli des textes non conformes. */
  corps: string;
  /** Le numéro porté par l'intitulé (« **1. Intitulé** »), s'il y en a un. */
  reference?: string;
  /** Le corps SANS la manière ni le résultat. Vaut `corps` quand rien n'est détecté. */
  explication: string;
  /** La manière dont ce sera fait (« Comment : … »), si elle est écrite. */
  comment?: string;
  /** Ce qu'on verra une fois fini (« Résultat : … »), s'il est écrit. */
  resultat?: string;
}

export interface ComprehensionRangee {
  /** Ce qui précède le sommaire et le premier intitulé : la phrase d'ouverture. */
  ouverture: string;
  /** Les lignes du sommaire numéroté, marqueur retiré. Vide sur les anciennes. */
  sommaire: string[];
  points: PointDeComprehension[];
  /** Assez de points pour faire un fil ? */
  conforme: boolean;
}

/** Deux points suffisent à faire un fil, comme pour le compte rendu. */
const MINIMUM_DE_POINTS = 2;

/**
 * « **Intitulé** — corps », « **Intitulé** – corps », « **Intitulé** : corps »
 * ou « **Intitulé :** corps ». Le corps peut être vide (intitulé seul sur sa
 * ligne, texte au paragraphe suivant).
 */
const INTITULE = /^\*\*([^*\n]+?)\s*:?\s*\*\*\s*(?:[—–:-]\s*)?([\s\S]*)$/;

/** « 1. Intitulé », « 2) Intitulé » : le numéro se détache du libellé. */
const NUMERO_EN_TETE = /^(\d{1,2})\s*[.)]\s*(.+)$/;

/** Une ligne de sommaire : « 1. … », « 2) … », ou une puce. */
const LIGNE_DE_SOMMAIRE = /^(?:\*\*)?(?:(\d{1,2})\s*[.)]|[-–•*])\s+(.+)$/;

/**
 * « Comment : … » et « Résultat : … », avec ou sans gras, avec ou sans accent.
 * Le libellé peut ouvrir un paragraphe entier ou une ligne seule.
 */
const SOUS_PARTIES: { champ: 'comment' | 'resultat'; motif: RegExp }[] = [
  { champ: 'comment', motif: /^\s*(?:[-–•*]\s*)?\*{0,2}\s*comment\s*\*{0,2}\s*[:—–]\s*/i },
  { champ: 'resultat', motif: /^\s*(?:[-–•*]\s*)?\*{0,2}\s*r[ée]sultat(?:\s+attendu)?\s*\*{0,2}\s*[:—–]\s*/i },
];

/** Retire le gras de fin laissé par « **Comment : …** ». */
const nettoyer = (valeur: string) => valeur.replace(/\*\*\s*$/, '').trim();

/**
 * DÉCOUPE LE CORPS D'UN POINT en explication, manière et résultat. Le découpage
 * se fait LIGNE À LIGNE : le moteur écrit tantôt trois paragraphes, tantôt
 * trois lignes d'un même bloc. Ce qui ne porte aucun libellé reste dans
 * l'explication.
 */
function decouperLeCorps(corps: string): Pick<PointDeComprehension, 'explication' | 'comment' | 'resultat'> {
  const explication: string[] = [];
  const parts: { comment?: string[]; resultat?: string[] } = {};
  let courant: 'comment' | 'resultat' | null = null;
  for (const ligne of corps.split('\n')) {
    const trouve = SOUS_PARTIES.find((sous) => sous.motif.test(ligne));
    if (trouve) {
      courant = trouve.champ;
      parts[courant] = parts[courant] ?? [];
      parts[courant]!.push(nettoyer(ligne.replace(trouve.motif, '')));
      continue;
    }
    if (courant && !ligne.trim()) {
      /* Une ligne vide referme la sous-partie : la suite retourne à l'explication
         seulement si elle n'ouvre pas une autre sous-partie. */
      courant = null;
      continue;
    }
    if (courant) {
      parts[courant]!.push(ligne.trim());
      continue;
    }
    explication.push(ligne);
  }
  const rassembler = (lignes: string[] | undefined) => {
    const texte = (lignes ?? []).join('\n').trim();
    return texte || undefined;
  };
  const texteExplication = explication.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { explication: texteExplication, comment: rassembler(parts.comment), resultat: rassembler(parts.resultat) };
}

/**
 * LE SOMMAIRE EST-IL DANS CE PARAGRAPHE ? Placé AVANT le premier point, un bloc
 * dont toutes les lignes sont numérotées (ou à puce) est le sommaire. Le moteur
 * colle parfois la phrase d'ouverture juste au-dessus, sans ligne vide : les
 * lignes de prose de TÊTE rejoignent alors l'ouverture, le reste le sommaire.
 * Un paragraphe entièrement de prose, lui, ne donne aucun sommaire.
 */
function lireUnSommaire(paragraphe: string): { avant: string[]; lignes: string[] } | null {
  const lignes = paragraphe.split('\n').map((l) => l.trim()).filter(Boolean);
  const debut = lignes.findIndex((ligne) => LIGNE_DE_SOMMAIRE.test(ligne));
  if (debut < 0) return null;
  const listees = lignes.slice(debut);
  if (listees.length < MINIMUM_DE_POINTS) return null;
  const lues = listees.map((ligne) => ligne.match(LIGNE_DE_SOMMAIRE));
  if (lues.some((lue) => !lue)) return null;
  return { avant: lignes.slice(0, debut), lignes: lues.map((lue) => nettoyer(lue![2]).replace(/^\*\*/, '')) };
}

export function rangerLaComprehension(texte: string): ComprehensionRangee {
  const paragraphes = (texte ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const ouverture: string[] = [];
  const sommaire: string[] = [];
  const points: { intitule: string; reference?: string; corps: string[] }[] = [];
  for (const paragraphe of paragraphes) {
    const trouve = paragraphe.match(INTITULE);
    const libelle = trouve?.[1].trim().replace(/\s*:$/, '');
    if (trouve && libelle) {
      const numerote = libelle.match(NUMERO_EN_TETE);
      points.push({
        intitule: numerote ? numerote[2].trim() : libelle,
        reference: numerote ? numerote[1] : undefined,
        corps: trouve[2].trim() ? [trouve[2].trim()] : [],
      });
      continue;
    }
    if (points.length) {
      points[points.length - 1].corps.push(paragraphe);
      continue;
    }
    /* Avant le premier point : le sommaire, ou l'ouverture. */
    const lu = !sommaire.length ? lireUnSommaire(paragraphe) : null;
    if (lu) {
      if (lu.avant.length) ouverture.push(lu.avant.join('\n'));
      sommaire.push(...lu.lignes);
    } else ouverture.push(paragraphe);
  }

  return {
    ouverture: ouverture.join('\n\n'),
    sommaire,
    points: points.map((p) => {
      const corps = p.corps.join('\n\n');
      return { intitule: p.intitule, reference: p.reference, corps, ...decouperLeCorps(corps) };
    }),
    conforme: points.length >= MINIMUM_DE_POINTS,
  };
}
