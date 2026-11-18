/**
 * LA FORME D'UN MESSAGE D'AGENT : UNE DISCUSSION, À LA LONGUEUR DE LA DEMANDE.
 *
 * Décision du 17/10/2026 : la conversation avec un agent se lit comme avec une
 * personne, et chaque message tenait en 600 signes au plus. Décision du
 * 25/10/2026, qui REMPLACE ce plafond : « si j'écris à quelqu'un et que sa
 * réponse nécessite une longueur conséquente, c'est une discussion quand même
 * — fais en sorte que les réponses correspondent à la demande ». Un relevé de
 * leads rendu en cinq phrases (capture #ab206) taisait justement le résultat.
 *
 * Plus aucun message n'est refusé ni relancé pour sa longueur. Ce qui reste :
 * la synthèse d'abord, rien qui redise la demande, rien pour remplir, et des
 * mots courants. Règle pure, éprouvée dans `server/src/test/message-court.test.ts`.
 */

/** La phrase commune à toutes les consignes de forme : une seule formulation. */
export const FORME_D_UN_MESSAGE =
  `un message de discussion, à la longueur que la demande appelle : une question simple ou un geste → quelques phrases ; un résultat demandé (une recherche, une liste, une analyse, un relevé, un compte rendu de travail) → la réponse COMPLÈTE, rangée en points : un titre « ### » par point, son texte dessous, et RIEN au-dessus du premier titre (ni phrase d'ouverture, ni image) — l'écran pose lui-même le sommaire en tête ; listes et tableaux permis dans un point quand ils aident à lire. En mots courants pour quelqu'un qui ne programme pas : aucun nom de fichier, de fonction ni de technologie, sauf s'il les demande. Tu ne redis jamais la demande, tu ne remplis pas, tu ne récapitules pas ce que tu viens d'écrire`;

/**
 * LE COMPTE RENDU D'UN TRAVAIL, POINT PAR POINT (demande de l'utilisateur du 06/11/2026) : « liste chaque point de la
 * demande finale qu'il traite, avec un titre relatif au point et en dessous un petit texte qui explique ce qui a été
 * fait, avec pièce jointe des assets dispo ». PLUS RIEN AU-DESSUS DU PREMIER TITRE (06/11/2026, carte « Retouches de
 * la charte graphique ») : « tout doit être résumé dans les différents points » — l'écran pose le sommaire en tête,
 * la synthèse devient le point « Vérifications ». Une question reste une réponse courte, sans titres.
 */
export const FORME_DU_COMPTE_RENDU =
  "COMPTE RENDU D'UN TRAVAIL (le message qui rend ce que tu as modifié, vérifié ou fabriqué) — UN TITRE PAR POINT DE LA DEMANDE, ET RIEN AU-DESSUS : le message COMMENCE par le premier titre — ni phrase de synthèse, ni image en tête ; l'écran pose lui-même le sommaire des titres. Chaque point que l'utilisateur a demandé reçoit son titre « ### … », quelques mots repris de SA demande (« ### Menu des pages sous son bouton »), dans l'ordre où il l'a demandé. Sous chaque titre, deux à quatre phrases courtes : ce qui a été fait et ce qu'on peut constater à l'écran. Puis, quand une image le montre (ta capture d'après, une image qu'il a jointe), elle se pose sous le texte, seule sur sa ligne : « ![légende courte](piece:<identifiant>) » (« attach_file » sur son chemin rend cet identifiant) — une par point au plus. Quand la demande porte une DÉCOUPE DU TRAVAIL (étapes numérotées ou lettrées), CHAQUE étape a son point, sans exception : une étape non faite garde son titre et commence par « Pas fait : » avec sa raison — jamais passée sous silence. Un point non fait, en échec ou à vérifier garde son titre et le dit. Ce qui n'était pas demandé mais a été fait ou constaté (un défaut trouvé en route, un contrôle en échec) prend un dernier titre « ### Aussi ». Ce qu'une synthèse aurait dit (travail enregistré et sauvegardé, non publié ; contrôles relancés et leur résultat, même en échec) prend son propre point, le dernier : « ### Vérifications ». Une simple question reste une réponse en quelques phrases, sans titres";

/** Le même, en une ligne, pour le rappel des tours suivants (la règle entière est déjà dans le fil). */
export const FORME_DU_COMPTE_RENDU_EN_BREF =
  "Compte rendu d'un travail : un titre « ### » par point de la demande (ses mots à lui), RIEN au-dessus du premier titre (ni synthèse, ni image), deux à quatre phrases sous chaque titre et l'image qui le montre « ![légende](piece:<identifiant>) » quand il y en a une ; chaque étape d'une découpe a son point, une étape non faite le dit (« Pas fait : … » et sa raison) ; puis un dernier point « ### Vérifications »";

/**
 * LE BLOC JSON DU CHIFFRAGE NE S'AFFICHE JAMAIS. L'agent d'exécution termine sa
 * réponse par un bloc json (durée machine, heures d'un développeur…) que
 * l'application LIT (`parseEstimate`, `server/src/scheduler.ts`) ; l'écran le
 * retire, et le texte enregistré reste intact. Seul un bloc qui porte
 * `"machineSeconds"` est visé — un autre bloc json reste affiché. Pendant
 * l'écriture, un bloc encore ouvert en fin de texte est retiré dès qu'il
 * commence comme un chiffrage, sans attendre sa fermeture.
 */
export function sansBlocDeChiffrage(texte: string): string {
  if (!texte || !texte.includes('```')) return texte;
  const ferme = texte.replace(/\n?[ \t]*```json[ \t]*\n([\s\S]*?)```[ \t]*/gi, (bloc, corps: string) =>
    corps.includes('"machineSeconds"') ? '' : bloc,
  );
  const ouvert = ferme.match(/\n?[ \t]*```json[ \t]*(?:\n([^`]*))?$/i);
  if (ouvert && commenceCommeUnChiffrage(ouvert[1] ?? '')) return ferme.slice(0, ouvert.index).trimEnd();
  return ferme === texte ? texte : ferme.trimEnd();
}

function commenceCommeUnChiffrage(corps: string): boolean {
  const debut = corps.replace(/\s+/g, '');
  const attendu = '{"machineSeconds"';
  return debut.includes('"machineSeconds"') || attendu.startsWith(debut);
}
