/**
 * L'APPLICATION ROUVRE TOUJOURS, MÊME APRÈS UNE COUPURE DU TÉLÉPHONE.
 *
 * Demande du 26/10/2026 : à la réouverture sur iPhone, Safari affichait parfois
 * « Un problème récurrent est survenu » — la page tuée deux fois de suite
 * pendant son démarrage, sans aucune erreur remontée (une coupure mémoire ne
 * laisse pas de trace). Trois règles pures, sans stockage ni horloge :
 *
 *  - UN DÉMARRAGE COUPÉ SE VOIT AU SUIVANT. L'écran pose un marqueur au début
 *    du démarrage et ne l'efface qu'une fois le premier état reçu ET resté
 *    stable quelques secondes. Un marqueur encore là au chargement suivant dit
 *    que la page précédente est morte en route : on démarre allégé (sans la
 *    copie locale, qui est jetée), une fois.
 *  - UNE PASTILLE DE 15 PX NE TÉLÉCHARGE PAS UNE IMAGE DE 2048 PX. Une icône de
 *    projet décodée à 2048 × 2048 pèse 16 Mo en mémoire d'image ; la pastille
 *    demande une miniature à sa taille.
 *  - LE CONTEXTE ENVOYÉ D'UN MESSAGE NE VOYAGE QU'UNE FOIS par canal : chaque
 *    pas d'un agent au travail renvoyait le message entier, contexte compris
 *    (plus de 100 Ko à chaque fois). Le serveur dit « inchangé », l'écran garde
 *    celui qu'il a déjà.
 */

export const CLE_DU_DEMARRAGE_EN_COURS = 'beluga.demarrage-en-cours';

/** Le premier état reçu doit tenir aussi longtemps pour que le démarrage compte comme réussi. */
export const DELAI_DE_DEMARRAGE_STABLE_MS = 8_000;

/** Un marqueur plus vieux ne dit plus rien d'une coupure récente. */
export const PEREMPTION_DU_MARQUEUR_MS = 10 * 60 * 1000;

/** Le démarrage précédent est-il mort en route ? `brut` : la valeur du marqueur (une date en ms). */
export function demarrageApresCoupure(brut: string | null, maintenant: number): boolean {
  if (!brut) return false;
  const pose = Number(brut);
  if (!Number.isFinite(pose) || pose <= 0) return false;
  const age = maintenant - pose;
  return age >= 0 && age <= PEREMPTION_DU_MARQUEUR_MS;
}

/** La miniature la plus petite que le serveur fabrique (`server/src/miniatures.ts`, LARGEUR_MIN). */
const MINIATURE_MIN = 64;

/**
 * L'adresse d'une icône de projet à la taille de sa pastille : trois pixels
 * d'image par pixel affiché (écrans haute densité), jamais moins que la plus
 * petite miniature. Une adresse qui n'est pas celle du démon passe telle quelle.
 */
export function adresseDePastille(favicon: string, taille: number): string {
  if (!favicon.startsWith('/api/favicon')) return favicon;
  if (/[?&]w=/.test(favicon)) return favicon;
  const largeur = Math.max(MINIATURE_MIN, Math.ceil(taille * 3));
  return `${favicon}${favicon.includes('?') ? '&' : '?'}w=${largeur}`;
}

/**
 * Le message à garder quand un `message.upsert` arrive : si le serveur dit son
 * contexte inchangé, on reprend celui de la version déjà connue. Sans version
 * connue, le message reste sans contexte plutôt que d'en inventer un.
 */
export function messageAvecContexteRepris<M extends { sentContext?: unknown }>(
  recu: M,
  precedent: M | undefined,
  inchange: boolean | undefined,
): M {
  if (!inchange || recu.sentContext !== undefined || precedent?.sentContext === undefined) return recu;
  return { ...recu, sentContext: precedent.sentContext };
}
