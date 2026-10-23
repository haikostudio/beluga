import { modeleBanni, remplacantDUnBanni } from './modele-banni.js';
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
 * 3. Le menu montre TOUT le catalogue de chaque moteur, du plus récent au plus
 *    ancien (demande de l'utilisateur, carte « Branches et choix des
 *    modèles ») : dix modèles d'abord, puis « Afficher plus » et une recherche
 *    (`web/src/components/run-selectors.tsx`). Le catalogue ne gardait que la
 *    version la plus récente de chaque famille, et l'on ne pouvait plus choisir
 *    une version précédente. Les DÉFAUTS, les paliers et la migration d'un
 *    réglage retiré visent toujours la version la plus récente d'une famille —
 *    la première rencontrée dans la liste triée. Seule la famille Fable reste
 *    exclue partout (DEC-332).
 */

/** Combien de versions par famille garde `limiterAuxPlusRecents` (plus appliquée aux catalogues des moteurs). */
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
 * chaque nuit, et un modèle peut disparaître de leur catalogue : un réglage qui
 * disait « claude-opus-5 » (défaut d'un projet, dernier choix, carte
 * planifiée) pointe alors vers une version RETIRÉE. On le
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
  // Un modèle BANNI (Fable) suit l'Opus le plus récent, jamais le défaut du
  // moteur : exception voulue à DEC-213 (`modele-banni.ts`).
  if (modeleBanni(modelId)) {
    const remplacant = remplacantDUnBanni(models);
    const opus = models.find((entry) => entry.id === remplacant);
    if (opus) return opus;
  }
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
 * LE NIVEAU DE RÉFLEXION QUI PARTIRA, tel que la configuration de l'agent le
 * montre — c'est la même résolution (`resoudreRun`), donc le bouton de
 * lancement ne peut pas dire autre chose qu'elle. Rien quand la carte n'a pas
 * encore de modèle (c'est alors son palier qui part) ou quand le modèle n'offre
 * qu'un niveau : la configuration ne montre pas non plus de ligne « Réflexion ».
 */
export function niveauDeReflexionQuiPart(engines: EngineInfo[], run: ChoixCatalogue | undefined): string | undefined {
  if (!run?.model) return undefined;
  const { thinkingOptions, thinking } = resoudreRun(engines, run);
  if (thinkingOptions.length < 2) return undefined;
  return thinking?.label;
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

/** Combien de modèles le menu montre avant « Afficher plus ». */
export const MODELES_AFFICHES_D_ABORD = 10;

const sansAccents = (texte: string) =>
  (texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * CE QUE LE MENU DES MODÈLES MONTRE. La liste arrive triée du plus récent au
 * plus ancien : les dix premiers d'abord, le reste derrière « Afficher plus ».
 * Une recherche porte sur la liste ENTIÈRE (libellé et identifiant, sans
 * accents ni casse). Le modèle CHOISI reste toujours visible, même au-delà des
 * dix : on ne cache jamais ce qui est retenu.
 */
export function modelesAffiches<T extends Pick<ModelInfo, 'id' | 'label'>>(
  models: readonly T[],
  options: { recherche?: string; tout?: boolean; choisi?: string },
  premiers = MODELES_AFFICHES_D_ABORD,
): { visibles: T[]; caches: number } {
  const mots = sansAccents(options.recherche ?? '').split(/\s+/).filter(Boolean);
  if (mots.length) {
    const visibles = models.filter((m) => {
      const texte = sansAccents(`${m.label} ${m.id}`);
      return mots.every((mot) => texte.includes(mot));
    });
    return { visibles, caches: 0 };
  }
  if (options.tout || models.length <= premiers) return { visibles: [...models], caches: 0 };
  const visibles = models.slice(0, premiers);
  const choisi = options.choisi ? models.find((m) => m.id === options.choisi) : undefined;
  if (choisi && !visibles.includes(choisi)) visibles.push(choisi);
  return { visibles, caches: models.length - visibles.length };
}

/**
 * Un identifiant technique n'apprend rien : on cherche son libellé dans le
 * catalogue des moteurs.
 *
 * Ce qui SERVIRA (`source: 'prevu'`) suit la même règle que le lancement : un
 * modèle retiré par la mise à jour du moteur est montré sous sa version
 * actuelle, de la même famille (`modeleActuel`) — c'est elle qui partira.
 * Ce qui A SERVI (`reel`) est une trace : on retombe alors sur l'identifiant
 * brut s'il n'est plus au catalogue, sans jamais le réécrire.
 */
export function libellesDuRun(
  engines: EngineInfo[],
  vu: { engine?: string; model?: string; thinking?: string; source?: string },
) {
  const moteur = engines.find((e) => e.id === vu.engine);
  const modele =
    vu.source === 'reel' ? moteur?.models.find((m) => m.id === vu.model) : moteur ? modeleActuel(moteur, vu.model) : undefined;
  const niveau =
    modele?.thinking?.find((t) => t.id === vu.thinking) ?? (vu.source === 'reel' ? undefined : modele?.thinking?.[0]);
  return {
    moteur: moteur?.label ?? vu.engine ?? '—',
    modele: modele?.label ?? vu.model ?? '—',
    reflexion: niveau?.label ?? vu.thinking ?? '—',
  };
}

/**
 * AVEC QUOI CET AGENT TRAVAILLE, EN UNE LIGNE : moteur, modèle et niveau de
 * réflexion, pour les témoins de travail (carte du tableau, vignette d'un
 * agent sans carte, décroché au-dessus du champ d'écriture). Même résolution
 * que ce qui part (`modeleActuel`) : un agent sans modèle explicite montre le
 * modèle par défaut de son moteur. Le niveau est tu quand le modèle n'en offre
 * qu'un — la configuration ne montre pas non plus de ligne « Réflexion ».
 */
export function etiquetteDuRun(
  engines: EngineInfo[],
  run: Pick<RunConfig, 'engine' | 'model' | 'thinking'> | undefined,
): { moteur: string; modele?: string; niveau?: string; texte: string } | null {
  if (!run?.engine) return null;
  const moteur = engines.find((e) => e.id === run.engine);
  const modele = moteur ? modeleActuel(moteur, run.model) : undefined;
  const niveaux = modele?.thinking ?? [];
  // Même repli que `resoudreRun` : un niveau inconnu du modèle montre le premier.
  const niveau = niveaux.length > 1 ? (niveaux.find((n) => n.id === run.thinking) ?? niveaux[0])?.label : undefined;
  const nomDuMoteur = moteur?.label ?? run.engine;
  const nomDuModele = modele?.label ?? run.model;
  return {
    moteur: nomDuMoteur,
    ...(nomDuModele ? { modele: nomDuModele } : {}),
    ...(niveau ? { niveau } : {}),
    texte: [nomDuMoteur, nomDuModele, niveau].filter(Boolean).join(' · '),
  };
}
