/**
 * LE TRAVAIL DÉJÀ FAIT SUR UNE CARTE, DIT À L'AGENT QUI EN PARLE (01/11/2026).
 *
 * Sur la carte Wogo 4d0aeccc, un agent d'exécution avait travaillé, rendu
 * son compte rendu, et la carte était en ligne puis archivée. La question
 * « pourquoi tu as travaillé ? » est partie à l'agent de CADRAGE rouvert, dont
 * le contexte ne disait que « Colonne : planned. » : il a répondu « Rien n'a été
 * codé », de mémoire, et c'était faux. Ce bloc court lui donne les FAITS, en
 * dates absolues ; il n'existe que si la carte a réellement eu du travail.
 */

export interface TravailDeCarte {
  /** Les tours d'exécution (agents de tâche) : début et fin, s'ils sont finis. */
  executions: readonly { debut: number; fin?: number }[];
  branche?: string;
  codeDejaEnregistre?: boolean;
  /** Passée par « Terminé » (compte rendu rendu). */
  doneAt?: number;
  deployedAt?: number;
  archivedAt?: number;
}

/** Une date absolue, lisible par un agent sans calcul de fuseau : « 2026-11-01 20:43 UTC ». */
export function dateAbsolue(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function blocDuTravailDejaFait(travail: TravailDeCarte): string | null {
  const { executions } = travail;
  const aEuDuTravail =
    executions.length > 0 || !!travail.codeDejaEnregistre || !!travail.doneAt || !!travail.deployedAt;
  if (!aEuDuTravail) return null;
  const faits: string[] = [];
  if (executions.length) {
    const debut = Math.min(...executions.map((e) => e.debut));
    const fins = executions.map((e) => e.fin).filter((f): f is number => typeof f === 'number');
    const enCours = fins.length < executions.length;
    faits.push(
      `un agent d'exécution a travaillé à partir du ${dateAbsolue(debut)}` +
        (enCours ? ' (un tour tourne encore)' : fins.length ? `, jusqu'au ${dateAbsolue(Math.max(...fins))}` : '') +
        (travail.branche ? `, sur la branche « ${travail.branche} »` : ''),
    );
  } else if (travail.branche) {
    faits.push(`branche de la carte : « ${travail.branche} »`);
  }
  if (travail.codeDejaEnregistre) faits.push('du code a été enregistré');
  if (travail.doneAt) faits.push(`compte rendu rendu le ${dateAbsolue(travail.doneAt)}`);
  if (travail.deployedAt) faits.push(`mis en ligne le ${dateAbsolue(travail.deployedAt)}`);
  if (travail.archivedAt) faits.push(`archivée le ${dateAbsolue(travail.archivedAt)}`);
  return (
    `TRAVAIL DÉJÀ FAIT SUR CETTE CARTE : ${faits.join(' ; ')}. ` +
    'Avant d\'affirmer ce qui a été fait ou non, vérifie (journal de la carte, branche, dépôt) : ne réponds jamais de mémoire.'
  );
}
