/*
 * LE PRIX D'UN CHOIX DE GÉNÉRATION, DIT EN EUROS (demande du 31/10/2026) : « pas juste combien j'en veux, une
 * estimation par coût ». Les services facturent en dollars : le dollar d'origine reste entre parenthèses, et l'euro
 * est dit approximatif. Le prix vient toujours des tarifs relevés (`realiser` action « chiffrer ») : un prix inventé
 * par l'agent serait pire qu'aucun prix, et une question de quantité ou de modèle sans prix est refusée.
 */

/** Le taux, mis à jour à la main : relevé sur la Banque centrale européenne (frankfurter.dev) pour le 30/10/2026. */
export const EUROS_PAR_DOLLAR = 0.895;

function centimes(valeur: number): string {
  /* Sous le centime, le prix ne se dit pas « 0,00 » : la plus petite somme qu'on sache écrire. */
  const arrondi = valeur > 0 && valeur < 0.01 ? 0.01 : Math.round(valeur * 100) / 100;
  return arrondi.toFixed(2).replace('.', ',');
}

/** « environ 0,05 € (0,06 $) », la forme exacte de chaque choix. */
export function prixEnEurosEtDollars(dollars: number): string {
  return `environ ${centimes(dollars * EUROS_PAR_DOLLAR)} € (${centimes(dollars)} $)`;
}

/** Une ligne par quantité : le prix TOTAL de chaque choix, jamais le seul prix unitaire. */
export function prixParQuantite(dollarsLUnite: number, quantites: readonly number[]): string[] {
  return quantites.map((n) => `${n} : ${prixEnEurosEtDollars(dollarsLUnite * n)}`);
}

/** La règle des agents créatifs, recopiée dans leur consigne. */
export const REGLE_DU_PRIX_DES_CHOIX =
  'LE PRIX DE CHAQUE CHOIX DE GÉNÉRATION : toute question qui propose une quantité (propositions, variantes, versions) ou un modèle à générer porte, dans la « description » de CHAQUE option, le prix TOTAL de ce choix, sous la forme « environ 0,11 € (0,12 $) ». Ne le calcule jamais de tête : lis-le avec « realiser » action « chiffrer » (capacité, modèle, durée ou texte, « quantites »), permis à toute étape et sans frais. Le service ne publie pas de prix : écris « prix non publié ». « Le double du prix d’une seule » ne suffit pas.';

const QUANTITE_DEMANDEE = /\b(combien|nombre)\s+(de|d['’])\s*(propositions?|variantes?|versions?|d[ée]clinaisons?|essais?|prises?|images?|photos?|vid[ée]os?|musiques?|sons?|voix|plans?|visuels?)\b/i;
const OPTION_EN_QUANTITE = /^\s*\d+\s+(propositions?|variantes?|versions?|d[ée]clinaisons?|essais?|prises?|images?|photos?|vid[ée]os?|musiques?|sons?|voix|plans?|visuels?)\b/i;
const MODELE_DEMANDE = /\b(quel|quelle|choisi\w*)\b.{0,40}\b(mod[eè]les?|service)\b/i;
const OPTION_CHIFFREE = /€|prix non publi/i;

/**
 * CETTE QUESTION D'UN AGENT CRÉATIF PROPOSE-T-ELLE UNE GÉNÉRATION SANS DIRE SON PRIX ? Rend le refus à lui répondre,
 * ou `null`. Une consigne seule s'oublie (capture #cc7eb, « au double du prix d'une seule ») : l'outil la tient.
 */
export function refusDeQuestionSansPrix(entree: {
  question: string;
  description?: string;
  options: readonly { label: string; description?: string }[];
}): string | null {
  if (!entree.options.length) return null;
  const texte = `${entree.question} ${entree.description ?? ''}`;
  const concerne = QUANTITE_DEMANDEE.test(texte) || MODELE_DEMANDE.test(entree.question) || entree.options.some((o) => OPTION_EN_QUANTITE.test(o.label));
  if (!concerne) return null;
  if (entree.options.every((o) => OPTION_CHIFFREE.test(`${o.label} ${o.description ?? ''}`))) return null;
  return 'Question refusée : chaque option d’un choix de génération porte son prix TOTAL, « environ 0,11 € (0,12 $) ». Lis-le avec « realiser » action « chiffrer », recopie-le dans la « description » de chaque option (ou « prix non publié »), puis repose la question.';
}
