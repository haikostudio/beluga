/**
 * LE SUIVI D'UNE PRODUCTION SE FERME, ET CHAQUE CARTE S'EN SOUVIENT (décision
 * du 28/10/2026, qui remplace « toujours ouvert, sans croix » du 25/10/2026).
 *
 * Sur ordinateur, le volet « Suivi de la production » s'ouvre de lui-même sur
 * une nouvelle production ; sa croix, ou le bouton « Suivi » posé au-dessus de
 * « Ce que l'agent a vu », le ferme. Fermé, il RESTE fermé sur cette carte —
 * après un rechargement comme sur un autre appareil — jusqu'à ce qu'on le
 * rouvre. La liste des cartes où il est fermé est un réglage du compte
 * (`suivi.fermes`, table `preferences`), bornée : les plus anciennes sortent.
 *
 * Règle pure : ni base, ni disque, ni React.
 */

export const CLE_SUIVIS_FERMES = 'suivi.fermes';

/** Combien de cartes la liste retient au plus : au-delà, la plus ancienne fermeture s'oublie. */
export const PLAFOND_DES_SUIVIS_FERMES = 200;

/** La liste lue dans les réglages, quelle que soit sa forme : seules des chaînes non vides comptent. */
export function suivisFermes(valeur: unknown): string[] {
  return Array.isArray(valeur) ? valeur.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** La liste après avoir fermé (en tête) ou rouvert le suivi d'une carte. */
export function suivisFermesApres(valeur: unknown, cardId: string, ferme: boolean): string[] {
  const reste = suivisFermes(valeur).filter((x) => x !== cardId);
  return ferme ? [cardId, ...reste].slice(0, PLAFOND_DES_SUIVIS_FERMES) : reste;
}
