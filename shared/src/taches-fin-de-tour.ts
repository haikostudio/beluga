/**
 * LA LISTE DE TÂCHES SE REFERME AVEC LE TOUR.
 *
 * Le bogue constaté : une carte passée en « À déployer », l'agent avait rendu
 * sa réponse, et le volet affichait encore « 4/5 faites » avec « Enregistrer et
 * pousser » marquée EN COURS, chronomètre compris. Pour toujours.
 *
 * La cause est simple : la liste vient du moteur, qui renvoie sa liste entière
 * à chaque mise à jour. Rien ne l'oblige à en renvoyer une dernière une fois le
 * travail fini — Claude coche rarement sa dernière ligne avant de répondre. Le
 * démon figeait bien l'heure de fin de cette ligne, mais lui laissait son ÉTAT
 * « en cours » : le rond orange restait allumé sur une carte close.
 *
 * La règle, donc : AUCUNE LIGNE NE RESTE « EN COURS » APRÈS LE TOUR.
 *
 *  - Tour RÉUSSI — l'agent a rendu sa réponse : la ligne qui tournait est
 *    cochée, marquée `closedByTurnEnd` pour ne pas faire passer une déduction
 *    du démon pour une confirmation de l'agent. Les lignes jamais commencées,
 *    elles, ne sont pas cochées : elles deviennent « non faites », et le disent.
 *  - Tour INTERROMPU — panne, quota, arrêt à la main, redémarrage du serveur :
 *    plus personne ne travaille dessus. Ni la ligne qui tournait ni celles qui
 *    attendaient n'ont été menées à bout : toutes deviennent « non faites ».
 *
 * Règle PURE : ni base, ni disque, ni horloge cachée — l'instant est passé en
 * paramètre, donc le résultat est rejouable.
 */
import { TodoItem } from './models.js';

/** Comment le tour s'est terminé, du point de vue de la liste de tâches. */
export type IssueDeCloture = 'reussi' | 'interrompu';

/** Une ligne qui n'a été ni menée à bout ni abandonnée reste-t-elle ouverte ? */
export function tacheOuverte(todo: Pick<TodoItem, 'state'>): boolean {
  return todo.state === 'running' || todo.state === 'todo';
}

/**
 * Referme une liste de tâches à la fin d'un tour. Rendue telle quelle si rien
 * n'est ouvert : refermer deux fois ne change donc rien (les chemins de
 * fermeture se doublent — fin normale, filet de sécurité, redémarrage).
 */
export function cloturerLesTaches(
  todos: readonly TodoItem[],
  options: { issue: IssueDeCloture; maintenant: number },
): TodoItem[] {
  if (!todos.some(tacheOuverte)) return todos.map((todo) => ({ ...todo }));

  return todos.map((todo) => {
    if (!tacheOuverte(todo)) return { ...todo };

    // La ligne qui tournait au moment où l'agent a rendu sa réponse : le
    // travail annoncé est allé au bout du tour, on la coche — en disant que
    // c'est le démon qui l'a fait.
    if (todo.state === 'running' && options.issue === 'reussi') {
      return {
        ...todo,
        state: 'done',
        endedAt: todo.endedAt ?? options.maintenant,
        closedByTurnEnd: true,
      };
    }

    // Tout le reste n'a pas été fait, et le dit. Une ligne qui avait commencé
    // garde son temps (arrêté ici) ; une ligne jamais commencée n'en a aucun.
    const ferme: TodoItem = { ...todo, state: 'unfinished' };
    if (todo.startedAt) ferme.endedAt = todo.endedAt ?? options.maintenant;
    else delete ferme.endedAt;
    return ferme;
  });
}

/** Ce que l'en-tête du volet annonce en plus du décompte des lignes cochées. */
export function mentionTachesNonFaites(todos: readonly TodoItem[]): string | null {
  const nombre = todos.filter((todo) => todo.state === 'unfinished').length;
  if (!nombre) return null;
  return `${nombre} non faite${nombre > 1 ? 's' : ''}`;
}
