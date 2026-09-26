/**
 * LE TEXTE D'UN TOUR, DÉCOUPÉ À CHAQUE ACTION.
 *
 * Le démon collait bout à bout TOUT ce que le moteur écrivait pendant un tour
 * (`runState.text`) et rendait le tout comme réponse. Les phrases de passage
 * qu'un agent écrit entre deux actions — « Je vérifie le démon… », « Première
 * cause trouvée… » — se retrouvaient donc EN TÊTE du bloc « Réponse », de la
 * compréhension et du compte rendu, au lieu d'accompagner les actions dans
 * « Réflexions » (capture #47ac).
 *
 * La règle : le texte se coupe à chaque action du moteur. Chaque morceau clos
 * par une action est une NOTE DE L'AGENT, journalisée à sa place parmi les
 * actions (`JALON_NOTE_DE_L_AGENT`, `shared/src/journal-carte.ts`) ; la réponse
 * est le texte écrit APRÈS la dernière action — ou, s'il n'y en a pas, le
 * dernier morceau non vide.
 *
 * Règle pure : ni base, ni disque. Éprouvée seule dans
 * `server/src/test/texte-du-tour.test.ts`.
 */

/** Deux morceaux recollés se séparent comme le démon les séparait déjà. */
const SEPARATEUR = '\n\n';

/**
 * LE TEXTE RENDU PAR LE TOUR.
 *
 * `morceaux` est le texte du tour coupé à chaque action, dans l'ordre ; le
 * dernier est ce qui a été écrit après la dernière action (il peut être vide).
 *
 * `tient` est le gabarit du compte rendu, quand le rôle en a un. Un agent qui
 * écrit son rapport en plusieurs fois, séparées par une action, ne doit pas se
 * voir amputé de sa première moitié — le rapport serait jugé hors format et
 * relancé pour rien. On rend donc la PLUS COURTE fin de tour qui tient le
 * gabarit ; si aucune ne le tient (le texte entier non plus, donc rien ne
 * change pour la relance), la réponse reste le dernier morceau.
 */
export function texteRenduDuTour(
  morceaux: readonly string[],
  tient?: (texte: string) => boolean,
): string {
  const pleins = morceaux.map((morceau) => morceau.trim()).filter(Boolean);
  if (!pleins.length) return '';
  const dernier = pleins[pleins.length - 1];
  if (!tient) return dernier;
  for (let debut = pleins.length - 1; debut >= 0; debut -= 1) {
    const candidat = pleins.slice(debut).join(SEPARATEUR);
    if (tient(candidat)) return candidat;
  }
  return dernier;
}

/**
 * LE MORCEAU À VERSER DANS LA RÉFLEXION quand une action commence : le texte
 * écrit depuis l'action précédente, s'il dit quelque chose. `undefined` quand
 * il n'y a rien à journaliser — une action qui suit une autre action.
 */
export function noteAvantLAction(morceauCourant: string): string | undefined {
  const note = morceauCourant.trim();
  return note || undefined;
}
