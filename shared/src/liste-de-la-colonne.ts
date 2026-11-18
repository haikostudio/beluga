/**
 * CE QUI EST OUVERT DANS LA COLONNE DE GAUCHE RESTE OUVERT (demande du 01/11/2026).
 *
 * Trois réglages retiennent, en base, l'état de la colonne : les groupes repliés
 * (`sidebar.collapsed`), les projets réunis dépliés (`sidebar.regroupementsOuverts`)
 * et les projets dépliés sur leurs tâches (`sidebar.projetsDeplies`). Chacun est une
 * LISTE D'IDENTIFIANTS, réécrite EN ENTIER à chaque geste.
 *
 * Deux pièges les faisaient reculer :
 *  - le geste calculait la nouvelle liste depuis la valeur CAPTURÉE au rendu, pas
 *    depuis la dernière connue : deux écritures rapprochées repartaient de la même
 *    liste et la seconde défaisait la première ;
 *  - au premier affichage (copie locale, reconnexion), les réglages du serveur ne
 *    sont pas encore là : la liste lue vaut `[]`, et le dépliage automatique du
 *    projet regardé écrivait `[ce projet]` à la place de tout le reste.
 *
 * La règle : on part TOUJOURS de la dernière valeur lue, on n'écrit QUE si la liste
 * change, et JAMAIS avant que le serveur ait donné les siens (`peutEcrireLaColonne`).
 * Règle PURE : ni réseau, ni état.
 */

/** Une valeur de réglage lue telle quelle : seuls les identifiants texte comptent, sans doublon. */
export function listeDIdentifiants(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return [];
  const vus = new Set<string>();
  for (const element of valeur) if (typeof element === 'string' && element) vus.add(element);
  return [...vus];
}

/**
 * La liste avec (`present` vrai) ou sans `id`. Rend `null` quand rien ne change :
 * l'appelant n'écrit alors rien du tout.
 */
export function listeAvecOuSans(valeur: unknown, id: string, present: boolean): string[] | null {
  const liste = listeDIdentifiants(valeur);
  const dedans = liste.includes(id);
  if (dedans === present) return null;
  return present ? [...liste, id] : liste.filter((element) => element !== id);
}

/** Bascule `id` : présent, il sort ; absent, il entre. */
export function listeBasculee(valeur: unknown, id: string): string[] {
  const liste = listeDIdentifiants(valeur);
  return liste.includes(id) ? liste.filter((element) => element !== id) : [...liste, id];
}

/**
 * Un geste de la colonne peut-il écrire ? Seulement une fois les réglages du serveur
 * arrivés (`pret`) et hors copie locale : sinon il partirait d'une liste vide.
 */
export function peutEcrireLaColonne(etat: { pret: boolean; copieLocale: boolean }): boolean {
  return etat.pret && !etat.copieLocale;
}

/** Les réglages de la colonne gardés avec la copie locale du dernier état : leur préfixe. */
export const PREFIXE_DES_REGLAGES_DE_LA_COLONNE = 'sidebar.';

/** Les seuls réglages de la colonne, pour la copie locale : la colonne se redessine ouverte comme on l'a laissée. */
export function reglagesDeLaColonne(prefs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const rendu: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(prefs)) {
    if (cle.startsWith(PREFIXE_DES_REGLAGES_DE_LA_COLONNE) && valeur !== undefined) rendu[cle] = valeur;
  }
  return rendu;
}
