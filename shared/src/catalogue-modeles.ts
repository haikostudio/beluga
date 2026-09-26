import { EngineInfo, ModelInfo, RunConfig } from './models.js';

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
 * 3. Les catalogues Claude et Cursor ne gardent que la version la plus RÉCENTE
 *    de chaque FAMILLE. Un vieux modèle qui traîne dans le menu se choisit par habitude —
 *    plus cher à l'usage, moins capable que la version actuelle — sans que
 *    personne ne l'ait vraiment voulu. Mais couper la liste ENTIÈRE aux trois
 *    plus récents, comme on le faisait, ne retirait pas des vieilleries : ça
 *    retirait des modèles ENTIERS. Sous Cursor, qui revend une dizaine de
 *    familles à la fois, le menu ne proposait plus que les trois variantes de
 *    GPT-5.6 — ni Composer, ni Grok, ni Opus, ni Sonnet (constaté le
 *    14/08/2026). Le tri par famille dit la même chose sans mentir sur l'offre.
 *    GPT fait exception : son menu reflète chaque IDENTIFIANT encore annoncé
 *    par Codex. Astra ou une ancienne version disponible ne doivent donc jamais
 *    disparaître à cause d'une ressemblance de nom.
 */

/** Combien de versions, de la plus récente à la plus ancienne, restent par famille. */
export const MODELES_PAR_FAMILLE = 1;

/**
 * LA FAMILLE D'UN MODÈLE : son identifiant débarrassé de ses NUMÉROS.
 *
 * « claude-opus-5 », « claude-opus-4-8 » et « claude-4.5-opus » sont trois
 * versions d'une même famille (`claude-opus`) ; « gpt-5.6-sol » et
 * « gpt-5.6-luna » sont deux familles distinctes, et pas deux versions l'une de
 * l'autre. On enlève donc les segments qui ne sont QUE des nombres, et rien
 * d'autre — un segment comme « k3 » ou « o1 » fait partie du nom, pas de la
 * version, et l'effacer confondrait des modèles réellement différents.
 */
export function familleDeModele(model: Pick<ModelInfo, 'id'>): string {
  const segments = (model.id ?? '')
    .toLowerCase()
    .split('-')
    .filter((segment) => segment && !/^v?\d+(?:\.\d+)*$/.test(segment));
  // Tout était numérique : l'identifiant entier fait alors office de famille.
  return segments.length ? segments.join('-') : (model.id ?? '').toLowerCase();
}

/**
 * Ne garde, par FAMILLE, que les N premiers modèles d'une liste déjà triée du
 * plus récent au plus ancien (le tri lui-même vient d'ailleurs — cette fonction
 * ne trie pas). L'ordre reçu est préservé.
 */
export function limiterAuxPlusRecents(models: ModelInfo[], parFamille = MODELES_PAR_FAMILLE): ModelInfo[] {
  const vus = new Map<string, number>();
  const gardes: ModelInfo[] = [];
  for (const model of models) {
    const famille = familleDeModele(model);
    const deja = vus.get(famille) ?? 0;
    if (deja >= parFamille) continue;
    vus.set(famille, deja + 1);
    gardes.push(model);
  }
  return gardes;
}

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
 * LE MODÈLE ACTUEL D'UN RÉGLAGE MÉMORISÉ. Les moteurs se mettent à jour seuls
 * chaque nuit, et leur catalogue ne garde que la version la plus récente de
 * chaque famille : un réglage qui disait « claude-opus-5 » (défaut d'un projet,
 * dernier choix, carte planifiée) pointe alors vers une version RETIRÉE. On le
 * fait suivre à la version la plus récente de la MÊME famille (Opus 5 → Opus
 * 5.5), et seulement si la famille a disparu, au défaut du moteur.
 *
 * Ce n'est pas une réécriture du choix au sens de DEC-213 : la famille voulue
 * est gardée, seule la version change, et seulement parce que l'ancienne
 * n'existe plus au catalogue.
 */
export function modeleActuel(
  engine: Pick<EngineInfo, 'models' | 'defaultModel'> | undefined,
  modelId: string | undefined,
): ModelInfo | undefined {
  const models = engine?.models ?? [];
  const exact = modelId ? models.find((entry) => entry.id === modelId) : undefined;
  if (exact) return exact;
  if (modelId) {
    // La liste arrive triée du plus récent au plus ancien : le premier de la
    // famille est la version actuelle.
    const famille = familleDeModele({ id: modelId });
    const parente = models.find((entry) => familleDeModele(entry) === famille);
    if (parente) return parente;
  }
  return models.find((entry) => entry.id === engine?.defaultModel) ?? models[0];
}

/**
 * Le réglage (modèle + réflexion) à ÉCRIRE à la place d'un réglage mémorisé
 * devenu obsolète, ou `null` quand il n'y a rien à changer. Ne répond que sur
 * un catalogue réellement LU (`live`) : une liste de secours ne prouve pas
 * qu'un modèle a disparu, et migrer dessus écraserait un bon réglage.
 */
export function migrationDeReglage(
  engine: Pick<EngineInfo, 'models' | 'defaultModel' | 'live' | 'installed'> | undefined,
  modelId: string | undefined,
  thinkingId: string | undefined,
): { model: string; thinking?: string } | null {
  if (!engine || !engine.installed || !engine.live || !modelId) return null;
  if (engine.models.some((entry) => entry.id === modelId)) return null;
  const actuel = modeleActuel(engine, modelId);
  if (!actuel) return null;
  const niveaux = actuel.thinking ?? [];
  const thinking = niveaux.find((entry) => entry.id === thinkingId)?.id ?? niveaux[0]?.id;
  return { model: actuel.id, ...(thinking ? { thinking } : {}) };
}

export type ChoixCatalogue = Partial<Pick<RunConfig, 'engine' | 'model' | 'thinking'>>;

/**
 * Résout ensemble le moteur, son modèle et son niveau à chaque rendu.
 *
 * Le modèle ne se cherche JAMAIS dans toute la liste : il vient uniquement du
 * moteur résolu. La même opération rejouée après un changement de moteur ou un
 * rafraîchissement du catalogue ne peut donc pas afficher le titre d'un moteur
 * avec les modèles d'un autre.
 */
export function resoudreRun(engines: EngineInfo[], choix: ChoixCatalogue | undefined) {
  const installed = engines.filter((engine) => engine.installed);
  const engine = installed.find((entry) => entry.id === choix?.engine) ?? installed[0];
  const models = engine?.models ?? [];
  const model = modeleActuel(engine, choix?.model);
  const thinkingOptions = model?.thinking ?? [];
  const thinking = thinkingOptions.find((entry) => entry.id === choix?.thinking) ?? thinkingOptions[0];
  return { installed, engine, models, model, thinkingOptions, thinking };
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
