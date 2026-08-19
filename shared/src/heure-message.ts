/**
 * L'HEURE ET LA DATE SOUS LES MESSAGES DU FIL.
 *
 * Trois règles, sans base ni disque, donc rejouables seules :
 *
 * 1. CHAQUE message porte son heure, des deux côtés du fil. Le regroupement à
 *    la minute (une seule heure sous le dernier d'une suite) a été retiré : sur
 *    téléphone, une demande suivie dans la même minute d'une bulle de mémoire
 *    ou d'une réponse perdait son heure, et la ligne sous la bulle se réduisait
 *    à « Écouter / Copier ». On ne devine pas quand on a écrit.
 * 2. L'heure est COURTE, jamais une phrase : « il y a 5 min » dans l'heure qui
 *    suit, l'heure seule le jour même, la date et l'heure au-delà
 *    (« 14/08/25 8:43 »). L'heure exacte en toutes lettres reste en infobulle.
 * 3. Un CHANGEMENT DE JOUR pose un séparateur pleine largeur, la date centrée
 *    dessus : sans lui, deux messages collés pouvaient être écrits à trois
 *    jours d'écart sans que rien ne le montre.
 *
 * Le TEXTE, lui, se fabrique côté interface (`web/src/lib/utils.ts`) : il passe
 * par le dictionnaire des cinq langues et par le format régional. Ici, on ne
 * décide que la FORME à employer.
 */

/** Le strict minimum dont ces règles ont besoin d'un message. */
export interface MessageHorodate {
  createdAt: number;
}

/** Deux instants tombent-ils le même jour, heure locale ? */
export function memeJour(a?: number, b?: number): boolean {
  if (!a || !b) return false;
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

/**
 * Faut-il poser un séparateur de date AVANT ce message ?
 *
 * Oui pour le tout premier du fil — il ouvre son jour — et à chaque fois que le
 * jour change d'un message au suivant.
 */
export function separateurDeJour(messages: MessageHorodate[], index: number): boolean {
  const message = messages[index];
  if (!message) return false;
  const precedent = messages[index - 1];
  if (!precedent) return true;
  return !memeJour(precedent.createdAt, message.createdAt);
}

/** La forme que prend la date d'un séparateur de jour. */
export type FormeDeJour = { genre: 'aujourdhui' } | { genre: 'hier' } | { genre: 'date' };

/**
 * Le jour d'un message, vu depuis maintenant : « Aujourd'hui », « Hier », ou la
 * date écrite. Le texte des deux premiers vient du dictionnaire.
 */
export function formeDeJour(at: number, maintenant = Date.now()): FormeDeJour {
  if (memeJour(at, maintenant)) return { genre: 'aujourdhui' };
  const veille = new Date(maintenant);
  veille.setDate(veille.getDate() - 1);
  if (memeJour(at, veille.getTime())) return { genre: 'hier' };
  return { genre: 'date' };
}

/** La forme que prend l'heure sous une bulle. */
export type FormeHeureCourte =
  | { genre: 'instant' }
  | { genre: 'minutes'; minutes: number }
  | { genre: 'heure' }
  | { genre: 'dateEtHeure' };

/**
 * L'heure d'un message, vue depuis maintenant.
 *
 * Moins d'une minute : « à l'instant ». Moins d'une heure : les minutes
 * écoulées, qui se lisent plus vite qu'une heure absolue sur un échange en
 * cours. Le jour même : l'heure seule. Au-delà : la date ET l'heure — le
 * séparateur de jour donne déjà la date, mais un message copié ou lu de loin
 * doit rester daté à lui seul.
 */
export function formeHeureCourte(at: number, maintenant = Date.now()): FormeHeureCourte {
  const minutes = Math.floor((maintenant - at) / 60_000);
  if (minutes < 1) return { genre: 'instant' };
  if (minutes < 60) return { genre: 'minutes', minutes };
  if (memeJour(at, maintenant)) return { genre: 'heure' };
  return { genre: 'dateEtHeure' };
}

/**
 * L'heure exacte, en toutes lettres, pour l'infobulle : le jour puis l'heure à
 * la minute. On ne la met jamais à la place de l'heure courte — elle la complète.
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
