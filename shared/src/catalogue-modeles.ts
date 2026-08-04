import { EngineInfo, ModelInfo } from './models.js';

/**
 * Ce qui reste du catalogue rendu par un moteur, et ce qu'on en dit à l'écran.
 *
 * Deux règles, toutes deux sans base ni disque :
 *
 * 1. Un modèle est UNIQUE par son IDENTIFIANT, jamais par son nom affiché. Le
 *    catalogue de Codex propose plusieurs modèles réellement différents sous le
 *    même `display_name` ; dédoublonner sur le nom en faisait disparaître —
 *    l'utilisateur ne voyait qu'une partie de ce que son compte lui offre. Les
 *    homonymes qui survivent portent leur identifiant en repère, sinon le menu
 *    afficherait deux lignes identiques.
 * 2. Une liste de SECOURS se dit. Quand le catalogue n'a pas pu être lu, ce qui
 *    s'affiche n'est plus la liste du moteur : le menu doit l'annoncer au lieu
 *    de laisser croire à une liste complète.
 */

/**
 * Garde un seul modèle par identifiant (le premier rencontré, donc l'ordre de
 * tri est préservé) et distingue les homonymes restants par leur identifiant.
 */
export function dedoublonnerModeles(models: ModelInfo[]): ModelInfo[] {
  const parId = new Map<string, ModelInfo>();
  for (const model of models) {
    if (!parId.has(model.id)) parId.set(model.id, model);
  }
  const gardes = [...parId.values()];

  const compteParNom = new Map<string, number>();
  for (const model of gardes) compteParNom.set(model.label, (compteParNom.get(model.label) ?? 0) + 1);

  return gardes.map((model) =>
    (compteParNom.get(model.label) ?? 0) > 1 && !model.note ? { ...model, note: model.id } : model,
  );
}

/**
 * La phrase à poser en tête du menu des modèles, ou `null` quand la liste vient
 * bien du moteur. Elle nomme la cause quand le moteur l'a donnée.
 */
export function messageDeRepli(engine: Pick<EngineInfo, 'installed' | 'live' | 'catalogError'> | undefined): string | null {
  if (!engine || !engine.installed || engine.live) return null;
  const cause = engine.catalogError?.trim();
  return cause
    ? `Liste de secours : le catalogue du moteur n'a pas pu être lu (${cause}).`
    : "Liste de secours : le catalogue du moteur n'a pas pu être lu.";
}
