import { TodoItem } from '@haikodev/shared';

/**
 * Le chronomètre de la liste de tâches (PLAN §26).
 *
 * Les moteurs renvoient leur liste ENTIÈRE à chaque mise à jour, sans aucune
 * heure. On rapproche donc la nouvelle liste de l'ancienne, ligne par ligne,
 * pour retenir quand chacune a commencé et quand elle s'est terminée — comme
 * pour les étapes.
 *
 * Cas courant : certains agents ne marquent jamais une ligne « en cours », ils
 * la cochent directement. Son temps part alors de la fin de la ligne précédente
 * (ou du début du tour pour la première) : c'est bien le temps qu'elle a pris.
 */
export function mergeTodos(previous: TodoItem[], incoming: TodoItem[], turnStartedAt: number): TodoItem[] {
  const byLabel = new Map(previous.map((todo) => [todo.label, todo]));
  const now = Date.now();

  // Repère de départ : la dernière fin connue, sinon le début du tour.
  let lastEnd = previous.reduce((max, todo) => Math.max(max, todo.endedAt ?? 0), 0) || turnStartedAt;

  return incoming.map((todo) => {
    const before = byLabel.get(todo.label);
    const merged: TodoItem = { ...todo };

    if (todo.state === 'todo') {
      // Repassée en attente : ses heures ne veulent plus rien dire.
      lastEnd = Math.max(lastEnd, before?.endedAt ?? 0);
      return { label: todo.label, state: 'todo' };
    }

    if (before?.startedAt) {
      merged.startedAt = before.startedAt;
    } else if (todo.state === 'running') {
      merged.startedAt = now;
    } else {
      // Cochée sans jamais avoir été annoncée en cours : son temps part de la
      // fin de la ligne précédente.
      merged.startedAt = lastEnd;
    }

    if (todo.state === 'done') {
      merged.endedAt = before?.state === 'done' ? (before.endedAt ?? now) : now;
      lastEnd = Math.max(lastEnd, merged.endedAt);
    } else {
      // En cours : pas de fin tant qu'elle tourne.
      delete merged.endedAt;
    }

    return merged;
  });
}

/** Vrai quand la liste est complète et entièrement cochée. */
export function allDone(todos: TodoItem[]): boolean {
  return todos.length > 0 && todos.every((todo) => todo.state === 'done');
}
