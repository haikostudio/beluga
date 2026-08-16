/**
 * UN BOUTON QUI PART EN REQUÊTE LE DIT TOUT DE SUITE.
 *
 * « Terminer la tâche », « Lancer maintenant », « Mettre en file de
 * publication » : le clic envoyait sa commande au serveur et le bouton restait
 * exactement tel quel jusqu'à la réponse. Rien ne distinguait un geste parti
 * d'un clic tombé à côté — on recliquait, donc on envoyait la même commande
 * deux fois.
 *
 * La règle est PURE : elle ne connaît ni React ni le réseau. Elle ne dit que
 * l'ENCHAÎNEMENT des trois états d'un bouton et ce que chacun autorise ; c'est
 * l'écran qui pose la roue qui tourne et la coche.
 *
 * Trois principes :
 *   — un clic ouvre l'état « en cours » AVANT toute réponse, et cet état FERME
 *     le bouton : deux envois pour un geste, c'est un geste de trop ;
 *   — la RÉUSSITE se montre brièvement (une coche), puis le bouton revient de
 *     lui-même — un bouton figé sur « fait » ne se reclique plus jamais ;
 *   — l'ÉCHEC ramène à l'état INITIAL, sans rien afficher de neuf : la raison
 *     du refus est déjà dite ailleurs, en rouge, et le geste doit redevenir
 *     possible immédiatement.
 */

/** Les trois états visibles d'un bouton qui porte une requête. */
export type EtatDeBouton = 'repos' | 'en-cours' | 'reussi';

/** L'issue d'une requête, telle que la voit le bouton. */
export type IssueDeRequete = 'reussite' | 'echec';

/**
 * Combien de temps la coche de réussite reste affichée. Assez pour être vue,
 * assez court pour que le bouton redevienne utilisable sans qu'on l'attende.
 */
export const DUREE_REUSSITE_MS = 1400;

/**
 * Au-delà de ce délai, une roue qui tourne ne rassure plus : elle inquiète. On
 * DIT alors que la demande est partie et qu'elle prend son temps, au lieu de
 * laisser deviner entre « ça travaille » et « c'est bloqué ».
 */
export const SEUIL_LONGUE_ATTENTE_MS = 10_000;

/** L'événement de page qui porte cet avertissement jusqu'aux messages passagers. */
export const EVENEMENT_ATTENTE_LONGUE = 'haikodev:attente-longue';

/**
 * Le mot dit au bout de dix secondes. Il ne conclut RIEN — ni panne, ni
 * réussite : la requête est partie, elle n'a pas encore répondu. Le nom du
 * geste, quand on le connaît, remplace « la demande ».
 */
export function motDAttenteLongue(geste?: string): string {
  const quoi = geste?.trim() ? `« ${geste.trim()} »` : 'La demande';
  return `${quoi} prend plus de temps que prévu — la demande est bien partie, elle attend encore la réponse du serveur.`;
}

/**
 * Un bouton en cours de requête n'accepte plus de clic. C'est le seul état qui
 * ferme le bouton : une réussite affichée reste cliquable, sans quoi un geste
 * qu'on veut refaire attendrait la fin de l'animation.
 */
export function boutonOccupe(etat: EtatDeBouton): boolean {
  return etat === 'en-cours';
}

/** L'état à prendre une fois la réponse connue. */
export function etatApresIssue(issue: IssueDeRequete): EtatDeBouton {
  return issue === 'reussite' ? 'reussi' : 'repos';
}

/**
 * Le retour d'un gestionnaire de clic porte-t-il une requête à attendre ?
 *
 * On ne juge pas sur `instanceof Promise` : une chaîne `.then()` peut venir
 * d'une autre réalisation. Tout objet muni d'un `then` appelable fait l'affaire,
 * et tout le reste — `undefined`, un booléen, un état posé à la main — laisse le
 * bouton au repos, exactement comme avant.
 */
export function estUneRequete(retour: unknown): retour is PromiseLike<unknown> {
  if (retour === null || (typeof retour !== 'object' && typeof retour !== 'function')) return false;
  return typeof (retour as { then?: unknown }).then === 'function';
}

/**
 * L'issue d'une requête qui a RÉPONDU.
 *
 * Toutes les requêtes ne refusent pas en levant une erreur : `moveCard` et
 * `validerCarte` rendent `{ ok: false, error }` — elles ont déjà dit le refus en
 * rouge et rendent la main normalement. Prendre cette réponse pour une réussite
 * afficherait une coche sur un geste refusé, ce qui est pire que pas de repère
 * du tout. Tout objet portant `ok: false` est donc un ÉCHEC ; le reste — une
 * valeur quelconque, `undefined`, un objet sans `ok` — est une réussite.
 */
export function issueDeLaReponse(valeur: unknown): IssueDeRequete {
  if (valeur && typeof valeur === 'object' && 'ok' in valeur) {
    return (valeur as { ok?: unknown }).ok === false ? 'echec' : 'reussite';
  }
  return 'reussite';
}

/**
 * Ce que l'état doit devenir à cet instant précis, vu de l'écran.
 *
 * `attente` vrai = une requête est partie et n'a pas répondu. Le reste suit :
 * une réponse arrivée ferme l'attente, un échec revient au repos. Écrit sous
 * forme de fonction pour qu'un test dise l'enchaînement entier sans monter de
 * composant.
 */
export function suiteDesEtats(
  etat: EtatDeBouton,
  evenement: 'clic' | 'reussite' | 'echec' | 'fin-de-coche',
): EtatDeBouton {
  if (evenement === 'clic') return boutonOccupe(etat) ? etat : 'en-cours';
  if (evenement === 'fin-de-coche') return etat === 'reussi' ? 'repos' : etat;
  return etatApresIssue(evenement === 'reussite' ? 'reussite' : 'echec');
}
