/**
 * UN MESSAGE D'AGENT SE LIT COMME UNE MESSAGERIE : 600 SIGNES AU PLUS.
 *
 * Décision de l'utilisateur (17/10/2026) : la conversation avec un agent doit
 * se lire comme avec une personne. Chaque message affiché — réponse du cadrage,
 * compréhension, réponse en cours de travail, compte rendu de fin, assistant
 * général — tient en 3 à 5 phrases, 600 signes VISIBLES au plus. Seuls le plan
 * et le cahier des charges sont plus fournis. Le détail complet ne s'affiche
 * plus : il voyage à l'agent qui travaille (part technique, notes du plan).
 *
 * Le compte se fait sur ce que l'écran MONTRE : la mise en forme Markdown est
 * retirée, un tag « [fichier: …] » compte comme un mot, et le bloc json du
 * chiffrage (lu par l'application, jamais affiché) ne compte pas.
 *
 * Un message trop long est renvoyé UNE fois à l'agent pour qu'il le raccourcisse
 * (`consigneDeRaccourci`) ; au-delà, il reste tel quel. Règle pure, éprouvée dans
 * `server/src/test/message-court.test.ts`.
 */

export const PLAFOND_D_UN_MESSAGE = 600;

/** La phrase commune à toutes les consignes de forme : une seule formulation. */
export const FORME_D_UN_MESSAGE =
  `un message de messagerie : ${PLAFOND_D_UN_MESSAGE} signes au plus, soit 3 à 5 phrases courtes, sans titres, sans tableau ni liste longue, en mots courants pour quelqu'un qui ne programme pas — aucun nom de fichier, de fonction ni de technologie. Tu vas droit au fait : ce qui est fait ou décidé, puis ce qu'on peut constater. Tu ne redis jamais la demande. L'application refuse un message plus long`;

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

/** Les signes que l'écran montre réellement. */
export function signesVisibles(texte: string): number {
  return visible(texte).length;
}

function visible(texte: string): string {
  return sansBlocDeChiffrage(texte ?? '')
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/\[fichier:[^\]]*\]/g, 'fichier')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?(\[![A-Z]+\])?/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function messageTropLong(texte: string, plafond = PLAFOND_D_UN_MESSAGE): boolean {
  return signesVisibles(texte) > plafond;
}

/** La consigne de la seule relance permise : raccourcir, sans refaire le travail. */
export function consigneDeRaccourci(texte: string, plafond = PLAFOND_D_UN_MESSAGE): string {
  return (
    `TON MESSAGE FAIT ${signesVisibles(texte)} SIGNES, LE PLAFOND EST ${plafond}. ` +
    `Réécris-le MAINTENANT en ${FORME_D_UN_MESSAGE}. ` +
    `Ne refais pas le travail, n'appelle aucun outil sauf pour proposer des suites, ne pose pas de question : rends seulement le message raccourci. ` +
    `Le détail que tu retires n'est pas perdu : il est déjà dans tes traces et dans le dossier de l'agent.`
  );
}

/** Le refus d'un outil qui porte un texte affiché trop long. */
export function refusDeMessageTropLong(champ: string, texte: string, plafond = PLAFOND_D_UN_MESSAGE): string {
  return (
    `Refusé : « ${champ} » fait ${signesVisibles(texte)} signes affichés, le plafond est ${plafond}. Rien n'a été enregistré. ` +
    `Réécris-le en ${FORME_D_UN_MESSAGE}. Le détail qui ne tient pas va dans la part technique, que seul l'agent d'exécution lit. Puis rappelle l'outil.`
  );
}
