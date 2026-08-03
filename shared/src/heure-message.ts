/**
 * L'heure sous les messages du fil.
 *
 * Deux règles, sans base ni disque, donc rejouables seules :
 *
 * 1. Quand plusieurs messages sont écrits dans la MÊME minute, une seule heure
 *    suffit : elle se pose sous le dernier du groupe. Un échange rapide (une
 *    demande, la réponse, une relance) portait sinon trois fois « il y a 2 min »
 *    et alourdissait la lecture pour ne rien apprendre.
 * 2. L'ancienneté (« il y a 20 min ») reste ce qu'on lit ; l'heure exacte se
 *    donne en infobulle, pour qui veut la date précise.
 */

/** Le strict minimum dont ces règles ont besoin d'un message. */
export interface MessageHorodate {
  createdAt: number;
}

/** Deux instants tombent-ils dans la même minute du calendrier ? */
export function memeMinute(a?: number, b?: number): boolean {
  if (!a || !b) return false;
  return Math.floor(a / 60_000) === Math.floor(b / 60_000);
}

/**
 * Faut-il écrire l'heure sous ce message ?
 *
 * Oui pour le DERNIER message d'une suite écrite dans la même minute : c'est
 * lui qui ferme le groupe, et l'heure se lit au plus près de la barre
 * d'écriture. Oui, toujours, pour le dernier message du fil.
 */
export function afficherHeure(messages: MessageHorodate[], index: number): boolean {
  const suivant = messages[index + 1];
  if (!suivant) return true;
  return !memeMinute(messages[index]?.createdAt, suivant.createdAt);
}

/**
 * L'heure exacte, en toutes lettres, pour l'infobulle : le jour puis l'heure à
 * la minute. On ne la met jamais à la place de l'ancienneté — elle la complète.
 */
export function heureExacte(at?: number): string {
  if (!at) return '';
  const date = new Date(at);
  // « lundi, 3 août 2026 » en sortie de fabrique : la virgule ne se dit pas.
  const jour = date
    .toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .replace(',', '');
  const heure = date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  return `${jour} à ${heure}`;
}
