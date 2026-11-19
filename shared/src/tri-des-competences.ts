/**
 * LE TRI DES COMPÉTENCES PAR UN MODÈLE QUI LIT — les règles, sans base ni disque.
 *
 * LE CONSTAT (14/11/2026, carte 71e1006a) : avec ~1 400 fiches dans le pool, la
 * recherche par le sens (vecteurs e5-small) met la bonne fiche dans les trente
 * premières, mais rarement en tête, et ses notes ne séparent pas une fiche qui
 * tombe pile d'une voisine. Le cadrage ne proposait juste que sur 4 demandes
 * sur 11.
 *
 * LA DÉCISION : un TRI EN DEUX TEMPS. La recherche actuelle (fusion des rangs du
 * sens et de la mêlée) présélectionne `PRESELECTION_DU_TRI` fiches ; le modèle de
 * tri local (`MODELE_DE_TRI`) lit la demande avec chacune et rend une note de
 * pertinence entre 0 et 1. Le briefing d'une carte suit ce nouvel ordre ; le
 * cadrage propose selon la note (`retenirParLeTri`). Sans note (modèle absent,
 * trop lent, en panne), tout reste comme avant.
 *
 * Mesuré sur 29 demandes (`scripts/mesure-competences-par-le-sens.mjs`) : la
 * bonne fiche arrive EN TÊTE après tri sur 21 des 24 demandes qui en appellent
 * une, contre 14 par le sens seul.
 */

/** Combien de fiches de la présélection le modèle relit : la vidéo IA (rang 22 avant tri) doit y entrer. */
export const PRESELECTION_DU_TRI = 24;
/** Le texte d'une fiche donné au modèle, en signes : au-delà, le tri ralentit sans mieux classer. */
export const LONGUEUR_DE_FICHE_DU_TRI = 280;
/** Le texte de la demande donné au modèle, en signes. */
export const LONGUEUR_DE_DEMANDE_DU_TRI = 500;
/** Les paires (demande, fiche) sont coupées à ce nombre de jetons. */
export const JETONS_DU_TRI = 192;
/**
 * Les paires passent au modèle par lots de cette taille : par 8, chaque lot ne
 * s'aligne que sur sa plus longue paire — 3,2 s au lieu de 4,6 s pour 24 fiches,
 * et ~400 Mo de mémoire vive en moins qu'en un seul lot (mesure du 14/11/2026).
 */
export const LOT_DU_TRI = 8;
/**
 * Les fils de calcul du trieur. Sans réglage, le moteur prend tous les cœurs :
 * 157 % de processeur le 18/11/2026, au détriment du démon sur une machine de
 * 4 cœurs. Plus lent, un tri qui dépasse son délai garde l'ordre d'avant.
 */
export const FILS_DU_TRI = 2;

/**
 * LES SEUILS DU CADRAGE (mesure du 14/11/2026, 24 demandes avec compétence, 5 sans).
 *
 * Sur une demande sans compétence, la meilleure note vaut au plus 0,086 et se
 * suit de près (écart des logits ≤ 0,2). Une fiche qui tombe pile vaut de 0,001
 * à 0,97 : la note seule ne suffit donc pas, mais une note nette OU une tête qui
 * se DÉTACHE de la suivante signe une vraie correspondance.
 */
export const NOTE_DE_TRI_SUFFISANTE = 0.1;
/** …ou une tête au moins à ce plancher, dont le logit dépasse celui de la suivante de `ECART_DE_TRI`. */
export const NOTE_DE_TRI_PLANCHER = 0.02;
export const ECART_DE_TRI = 1.5;
/** Une seconde ou troisième fiche n'est proposée que si sa note vaut au moins cette part de la tête. */
export const PART_DE_LA_TETE = 0.5;

/** La constante de la fusion des rangs : plus elle est grande, plus les deux classements pèsent pareil loin du haut. */
const FUSION_DES_RANGS = 10;

/**
 * LA FUSION DES DEUX CLASSEMENTS (rangs réciproques) — la présélection. Le sens
 * compte toujours ; la mêlée s'y ajoute quand elle a classé la fiche. Rend les
 * noms, du plus proche au moins proche.
 */
export function ordreDesCompetencesProches(candidates: readonly { nom: string; rangSens: number; rangMele?: number }[]): string[] {
  return candidates
    .map((c) => ({
      nom: c.nom,
      score: 1 / (FUSION_DES_RANGS + c.rangSens) + (c.rangMele === undefined ? 0 : 1 / (FUSION_DES_RANGS + c.rangMele)),
    }))
    .sort((a, b) => b.score - a.score)
    .map((c) => c.nom);
}

/**
 * « À utiliser quand vous devez chiffrer… » → « chiffrer… ». La formule d'entrée,
 * commune à toutes les fiches, ne dit rien du sujet ; la retirer fait passer la
 * bonne fiche en tête sur 21 demandes au lieu de 20 (devis, réécriture de textes).
 */
export function sansFormuleDEntree(texte: string): string {
  return texte
    .trim()
    .replace(/^À utiliser\s+(dès\s+qu[e']\s*|quand\s+|lorsqu[e']\s*)(vous\s+(devez|voulez|souhaitez)\s+)?/i, '');
}

/**
 * LE TEXTE D'UNE FICHE LU PAR LE MODÈLE : son titre lisible, ce qui dit quand
 * s'en servir (le résumé français d'une fiche importée — la description d'origine
 * classe moins bien : 16 têtes justes sur 24 au lieu de 21), et ses thèmes.
 */
export function texteDeFichePourLeTri(fiche: { titre: string; quandSenServir: string; themes?: readonly string[] }): string {
  const themes = fiche.themes?.length ? ` (${fiche.themes.join(', ')})` : '';
  return `${fiche.titre}. ${sansFormuleDEntree(fiche.quandSenServir)}${themes}`.slice(0, LONGUEUR_DE_FICHE_DU_TRI);
}

/** La demande lue par le modèle : telle quelle, sans préfixe (« compétence utile pour… » classe moins bien). */
export function demandePourLeTri(demande: string): string {
  return demande.trim().slice(0, LONGUEUR_DE_DEMANDE_DU_TRI);
}

/**
 * LE NOUVEL ORDRE DU BRIEFING : les fiches notées, de la meilleure note à la
 * moins bonne, puis le reste de la présélection dans son ordre d'avant. Sans
 * notes (ou un nombre qui ne correspond pas), l'ordre d'avant est rendu tel quel.
 */
export function reordonnerParLeTri(noms: readonly string[], notes: readonly number[] | undefined): string[] {
  if (!notes || !notes.length || notes.length > noms.length) return [...noms];
  const notees = notes
    .map((note, i) => ({ nom: noms[i]!, note: Number.isFinite(note) ? note : -1, i }))
    .sort((a, b) => b.note - a.note || a.i - b.i)
    .map((x) => x.nom);
  return [...notees, ...noms.slice(notes.length)];
}

const logit = (p: number): number => {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(q / (1 - q));
};

/**
 * CE QUE LE CADRAGE PROPOSE D'APRÈS LES NOTES DU TRI. La tête est proposée si sa
 * note est nette (`NOTE_DE_TRI_SUFFISANTE`), ou si elle passe le plancher et se
 * DÉTACHE de la suivante (`ECART_DE_TRI` en logits). Les suivantes ne la
 * rejoignent que si elles ont elles-mêmes une note nette, au moins la moitié de
 * la tête. Jamais une fiche déjà proposée sur la carte ; au plus `place`.
 */
export function retenirParLeTri<T extends { nom: string; note: number }>(
  notees: readonly T[],
  dejaProposees: readonly string[],
  place: number,
  seuils: { suffisante?: number; plancher?: number; ecart?: number; part?: number } = {},
): T[] {
  if (place <= 0) return [];
  const suffisante = seuils.suffisante ?? NOTE_DE_TRI_SUFFISANTE;
  const plancher = seuils.plancher ?? NOTE_DE_TRI_PLANCHER;
  const ecart = seuils.ecart ?? ECART_DE_TRI;
  const part = seuils.part ?? PART_DE_LA_TETE;
  const classees = [...notees].filter((c) => c.nom && Number.isFinite(c.note)).sort((a, b) => b.note - a.note);
  const tete = classees[0];
  if (!tete) return [];
  const suivante = classees[1]?.note ?? 0;
  const teteRetenue = tete.note >= suffisante || (tete.note >= plancher && logit(tete.note) - logit(suivante) >= ecart);
  if (!teteRetenue) return [];
  const deja = new Set(dejaProposees);
  const retenues = [tete, ...classees.slice(1).filter((c) => c.note >= suffisante && c.note >= tete.note * part)];
  return retenues.filter((c) => !deja.has(c.nom)).slice(0, place);
}
