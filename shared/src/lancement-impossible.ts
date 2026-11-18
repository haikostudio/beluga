/**
 * « LANCEMENT IMPOSSIBLE » DIT UNE PHRASE, JAMAIS UNE ERREUR BRUTE.
 *
 * Le 18/11/2026, une carte a été effacée pendant le tour de son agent : à la fin
 * du tour, le démon a voulu réécrire un agent qui n'existait plus, et la
 * validation a rejeté un objet vide. Le message d'erreur — une liste JSON de
 * champs « Required » — est parti tel quel dans le message passager
 * « Lancement impossible : [ {code: invalid_type, path: [id] …} ] ». Personne
 * ne pouvait comprendre que la carte avait disparu, ni que son message en
 * attente n'était pas parti.
 *
 * Deux règles pures (`server/src/test/lancement-impossible.test.ts`) :
 *   - un agent disparu en plein tour lève une erreur NOMMÉE (`AGENT_DISPARU`),
 *     que le démon traduit en une phrase claire ;
 *   - un message qui ressemble à du JSON ou à une validation (Zod) n'est jamais
 *     montré : une phrase générique le remplace, le détail reste au journal.
 */
export const AGENT_DISPARU = 'AgentDisparu';

export const PHRASE_CARTE_SUPPRIMEE =
  'Cette carte a été supprimée pendant son travail : son agent s’est arrêté, et un message qui attendait son tour n’est pas parti.';

export const PHRASE_LANCEMENT_ILLISIBLE =
  'Le lancement a échoué sur une erreur interne. Le détail est au journal du serveur ; relancez la carte, ou écrivez-lui pour la reprendre.';

/** L'erreur levée quand l'agent d'un tour n'est plus en base. */
export function erreurAgentDisparu(agentId: string): Error {
  const err = new Error(`agent ${agentId} disparu de la base pendant son tour`);
  err.name = AGENT_DISPARU;
  return err;
}

function ressembleAUneErreurBrute(texte: string): boolean {
  const t = texte.trim();
  return t.startsWith('[') || t.startsWith('{') || /invalid_type|ZodError|"path"\s*:|Required/.test(t);
}

/** Le texte du message passager « Lancement impossible ». */
export function phraseDeLancementImpossible(err: unknown): string {
  const e = err as { name?: string; message?: string } | null | undefined;
  if (e?.name === AGENT_DISPARU) return PHRASE_CARTE_SUPPRIMEE;
  if (e?.name === 'ZodError') return `Lancement impossible. ${PHRASE_LANCEMENT_ILLISIBLE}`;
  const message = String(e?.message ?? err ?? '').trim();
  if (!message || ressembleAUneErreurBrute(message)) return `Lancement impossible. ${PHRASE_LANCEMENT_ILLISIBLE}`;
  return `Lancement impossible : ${message.slice(0, 200)}`;
}
