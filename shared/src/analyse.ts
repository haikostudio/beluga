/**
 * Le titre d'un bloc de conversation, selon l'agent qui l'a écrit. Une carte
 * peut avoir eu plusieurs agents : sans repère, le compte rendu d'un chiffrage
 * d'avant la fusion et celui de l'exécution se confondraient.
 */
export function titreDeBloc(role: string | undefined): string {
  switch (role) {
    case 'analysis':
      return 'Analyse de la carte';
    case 'cadrage':
      return 'Cadrage de la tâche';
    case 'deploy':
      return 'Publication';
    default:
      return 'Exécution de la tâche';
  }
}
