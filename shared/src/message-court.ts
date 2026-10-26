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
  `un message de discussion, à la longueur que la demande appelle : une question simple ou un geste → quelques phrases ; un résultat demandé (une recherche, une liste, une analyse, un relevé, un compte rendu de travail) → la réponse COMPLÈTE, qui s'ouvre sur sa synthèse en une ou deux phrases puis donne tout le contenu utile — titres, listes et tableaux permis quand ils aident à lire. En mots courants pour quelqu'un qui ne programme pas : aucun nom de fichier, de fonction ni de technologie, sauf s'il les demande. Tu ne redis jamais la demande, tu ne remplis pas, tu ne récapitules pas ce que tu viens d'écrire`;

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
