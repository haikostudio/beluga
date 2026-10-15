/**
 * LES AIDES (sous-agents) D'UN AGENT DE TÂCHE SOUS CLAUDE : ÉCONOMES OU RIEN.
 *
 * Un agent de tâche pouvait déjà déléguer (outil `Agent`), sans règle : l'aide
 * « general-purpose » et l'aide de recherche « Explore » prennent par défaut le
 * MÊME modèle que l'agent principal, le plus cher, et chacune relit le projet
 * de zéro. Des aides en parallèle accélèrent, mais consomment plus.
 *
 * Le seul cas qui fait GAGNER du quota : une aide sur modèle léger qui cherche
 * et lit, puis rend un résumé court. La conversation du principal — relue à
 * chaque appel — reste petite. Donc :
 *  - « Explore » est REDÉFINIE (`--agents`) sur le modèle léger, en lecture
 *    seule, avec un retour court et vérifiable ;
 *  - les aides qui écrivent ou prennent le modèle du principal sont FERMÉES
 *    (`--disallowedTools Agent(<type>)`), qu'aucun mode ne rouvre.
 *
 * Vérifié le 13/10/2026 sur Claude Code 2.1.296 : la redéfinition d'« Explore »
 * passe bien sur `claude-haiku-5-5`, et `Agent(general-purpose)` est refusé.
 * Codex et Cursor ne sont pas concernés.
 */

/** Le modèle des aides de lecture : un alias, résolu par Claude Code. */
export const MODELE_DES_AIDES = 'haiku';

/** Les aides fermées aux agents de tâche : elles écrivent ou héritent du modèle cher. */
export const AIDES_FERMEES = ['Agent(general-purpose)', 'Agent(claude)', 'Agent(Plan)'];

const CONSIGNE_DE_L_AIDE = [
  "Tu es une aide de LECTURE pour un agent qui travaille dans ce dépôt. Tu cherches et tu lis ; tu ne modifies RIEN",
  '(aucune écriture de fichier, aucune commande qui change le dépôt ou la machine, aucun commit).',
  '',
  'Ta réponse est relue par un modèle plus cher : elle doit être COURTE et VÉRIFIABLE.',
  '- 15 lignes au plus, sans préambule ni récapitulatif.',
  '- Chaque fait porte son chemin et sa ligne (`chemin/fichier.ts:123`) ; un extrait de code seulement s’il est indispensable, 5 lignes au plus.',
  '- Ce que tu n’as pas trouvé se dit « introuvable », jamais deviné. Ce que tu supposes se dit « hypothèse ».',
  '- Ne recopie pas les fichiers lus : rends ce qu’ils disent en réponse à la question.',
].join('\n');

/** La définition passée à `--agents` : « Explore » sur le modèle léger. */
export function aidesDeLecture(): string {
  return JSON.stringify({
    Explore: {
      description:
        'Aide de lecture sur modèle léger : recherches larges dans le dépôt (fichiers, symboles, usages) et lectures longues. ' +
        'Rend un résumé court avec chemins et lignes. Ne modifie rien. À préférer à toute lecture longue faite soi-même. ' +
        'Lance-la AU PREMIER PLAN (run_in_background: false) : ta suite dépend de sa réponse, et l’attendre en arrière-plan coûte un aller-retour de plus.',
      prompt: CONSIGNE_DE_L_AIDE,
      model: MODELE_DES_AIDES,
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
  });
}
