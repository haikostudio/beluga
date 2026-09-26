/**
 * LE MOTEUR NE PROPOSE PLUS SES OUTILS DE LISTE DE TÂCHES AUX GRANDS MODÈLES —
 * ET C'EST UNE SECONDE CAUSE, INDÉPENDANTE DU COFFRE.
 *
 * Le coffre d'un compte cassé (`shared/src/coffre-du-compte.ts`) faisait échouer
 * `TaskCreate` à l'écriture. Réparé, la liste ne revenait toujours pas : la
 * cause d'aujourd'hui est AILLEURS, et plus haut. Le CLI 2.1.233 ne DÉCLARE
 * même plus les outils `TaskCreate`, `TaskUpdate`, `TaskList` et `TaskGet` — ni
 * l'ancien `TodoWrite` — quand le modèle demandé appartient à la génération
 * récente (Sonnet 5, Opus 5, Fable 5). Mesuré, pas supposé : la même commande
 * lancée sur Haiku 4.5 les annonce, sur Sonnet 5 et Opus 5 elle ne les annonce
 * pas (message `init` du protocole, champ `tools`).
 *
 * Un agent ne peut pas appeler un outil qui ne lui est pas offert : la consigne
 * « annonce ta liste de tâches » reste alors lettre morte, et les TROIS
 * affichages qui en vivent s'éteignent d'un coup — le volet dépliable au-dessus
 * de la barre d'écriture, le pourcentage en tête de la colonne « En cours » et
 * celui de la ligne du projet dans la colonne de gauche. Seul survit le repère
 * compact, qui lui se nourrit des ÉTAPES (« Commande : … »), pas des tâches.
 *
 * Le CLI garde une porte : la variable d'environnement
 * `CLAUDE_CODE_ENABLE_TODO_TOOLS`. Posée à `1`, elle rétablit les six outils sur
 * tous les modèles. Beluga Build la pose donc à CHAQUE lancement du moteur Claude,
 * agent de tâche comme chef d'orchestre.
 *
 * La règle vit ici, sans disque ni processus : elle décide seulement CE QU'ON
 * AJOUTE à l'environnement. L'adaptateur se contente de l'appliquer.
 */

/** La variable qui rouvre les outils de liste de tâches du CLI Claude. */
export const VARIABLE_LISTE_DE_TACHES = 'CLAUDE_CODE_ENABLE_TODO_TOOLS';

/** Ce que le CLI attend pour rouvrir ses outils. */
export const VALEUR_LISTE_DE_TACHES = '1';

/**
 * L'environnement d'un lancement Claude, complété de ce qu'il faut pour que
 * l'agent puisse ANNONCER sa liste de tâches.
 *
 * Un réglage déjà posé par la machine n'est jamais écrasé — même pour
 * l'éteindre : celui qui a mis la variable dans son environnement sait ce
 * qu'il fait, et Beluga Build ne lui repasse pas dessus. Les autres moteurs
 * (Codex, Cursor) n'ont rien à voir avec cette variable : ils annoncent leur
 * plan par leurs propres outils.
 */
export function environnementDeLaListeDeTaches(
  environnement: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const dejaPose = environnement[VARIABLE_LISTE_DE_TACHES];
  if (typeof dejaPose === 'string' && dejaPose.trim() !== '') return {};
  return { [VARIABLE_LISTE_DE_TACHES]: VALEUR_LISTE_DE_TACHES };
}
