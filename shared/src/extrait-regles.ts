/**
 * CLASSER DES RÈGLES PAR LES MOTS D'UNE DEMANDE : les règles qui parlent d'au
 * moins un mot, les mieux servies d'abord. Sert au pool de compétences
 * (`competences.ts`) pour ranger ses fiches au poids du travail d'une carte.
 */

/** Une règle retenue, avec ce qui l'a fait retenir. */
export interface RegleClassee {
  texte: string;
  /** Combien de mots de la demande apparaissent dans la règle. */
  touches: number;
}

/**
 * Les mots utiles d'une demande : au-delà de trois lettres, sans doublon. Les
 * mots courts (« de », « la », « un ») apparaissent partout et ne classent rien.
 */
export function motsDeLaRequete(requete: string): string[] {
  const mots = requete
    .trim()
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9/]+/i)
    .filter((mot) => mot.length > 3);
  return [...new Set(mots)];
}

/**
 * Les règles qui parlent d'au moins un mot de la demande, les mieux servies
 * d'abord. On ne trie PAS sur la longueur : une règle courte qui touche trois
 * mots vaut mieux qu'un pavé qui en touche un. À égalité, l'ordre du fichier est
 * gardé — c'est celui dans lequel les règles ont été écrites.
 */
export function classerRegles(regles: string[], requete: string): RegleClassee[] {
  const mots = motsDeLaRequete(requete);
  if (!mots.length) return [];
  return regles
    .map((texte, rang) => {
      const minuscule = texte.toLowerCase();
      return { texte, rang, touches: mots.filter((mot) => minuscule.includes(mot)).length };
    })
    .filter((regle) => regle.touches > 0)
    .sort((a, b) => b.touches - a.touches || a.rang - b.rang)
    .map(({ texte, touches }) => ({ texte, touches }));
}
