import { EngineId, EngineInfo, ficheDuMoteur, idsDesMoteurs, type IdDeMoteurIntegre } from '@beluga/shared';
import { EngineAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { mimoAdapter } from './mimo.js';
import { Catalogue, catalogueDeFiche, claudeCatalog, codexCatalog, cursorCatalog, mimoCatalog, resolveModel } from './catalog.js';
import { adaptateurDeFiche, adaptateurIntrouvable } from './ajoutes.js';

export * from './types.js';

/**
 * LES ADAPTATEURS, UN PAR MOTEUR DU REGISTRE (`shared/src/registre-moteurs.ts`).
 * Le type `Record<EngineId, …>` refuse de compiler tant qu'un moteur déclaré
 * n'a pas son adaptateur ET son catalogue : aucun oubli ne passe en silence.
 */
type Branchement = { adapter: EngineAdapter; catalogue: (version: string) => Promise<Catalogue> };

const ADAPTATEURS: Record<IdDeMoteurIntegre, Branchement> = {
  claude: { adapter: claudeAdapter, catalogue: () => claudeCatalog() },
  codex: { adapter: codexAdapter, catalogue: (version) => codexCatalog(version) },
  cursor: { adapter: cursorAdapter, catalogue: () => cursorCatalog() },
  mimo: { adapter: mimoAdapter, catalogue: () => mimoCatalog() },
};

/**
 * LE BRANCHEMENT D'UN MOTEUR : intégré, ou AJOUTÉ (fiche en base, `ext-…`).
 * Un moteur ajouté inconnu ou retiré reçoit un adaptateur qui REFUSE de
 * partir — jamais un repli silencieux sur Claude, qui consommerait un
 * abonnement à la place d'une clé.
 */
function branchement(engine: EngineId | string | undefined): Branchement | undefined {
  if (!engine) return undefined;
  if (engine in ADAPTATEURS) return ADAPTATEURS[engine as IdDeMoteurIntegre];
  if (!engine.startsWith('ext-')) return undefined;
  const fiche = ficheDuMoteur(engine);
  if (!fiche || fiche.statut === 'retire') {
    return { adapter: adaptateurIntrouvable(engine as `ext-${string}`), catalogue: async () => ({ models: [], live: false }) };
  }
  return { adapter: adaptateurDeFiche(fiche), catalogue: () => catalogueDeFiche(fiche) };
}

export function adapterFor(engine: EngineId | string | undefined): EngineAdapter {
  return branchement(engine)?.adapter ?? claudeAdapter;
}

let cache: { at: number; engines: EngineInfo[] } | null = null;
let enCours: Promise<EngineInfo[]> | null = null;

/**
 * Le dernier catalogue connu, MÊME PÉRIMÉ, sans rien attendre.
 *
 * Dresser le catalogue lance trois exécutables et interroge le réseau : mesuré
 * à 7,5 secondes sur ce serveur. Tant que l'événement `ready` l'attendait,
 * l'application entière — colonne de gauche et tableau compris — restait sur
 * ses silhouettes pendant tout ce temps. Le premier envoi part donc avec ce
 * qu'on sait déjà ; la vraie liste suit par l'événement `engines`.
 */
export function cachedEngines(): EngineInfo[] {
  return cache?.engines ?? [];
}

/** Le catalogue est-il encore frais ? Sert à ne relancer que ce qu'il faut. */
export function enginesFrais(): boolean {
  return !!cache && Date.now() - cache.at < 5 * 60 * 1000;
}

/** Les listes viennent du serveur, jamais d'une liste écrite en dur côté client (PLAN §14). */
export async function listEngines(force = false): Promise<EngineInfo[]> {
  if (!force && cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.engines;
  /*
   * Une seule tournée à la fois : deux navigateurs qui se connectent en même
   * temps lançaient chacun leurs trois exécutables, pour le même résultat.
   */
  if (enCours) return enCours;
  enCours = dresserLeCatalogue().finally(() => {
    enCours = null;
  });
  return enCours;
}

async function dresserLeCatalogue(): Promise<EngineInfo[]> {
  /*
   * LES TROIS MOTEURS SONT INTERROGÉS EN MÊME TEMPS. À la file, on payait la
   * somme de trois exécutables et de leurs appels réseau ; ils ne dépendent
   * pourtant pas les uns des autres. L'ordre de la liste, lui, ne bouge pas.
   */
  const engines = await Promise.all(
    idsDesMoteurs().map(async (id) => {
      const { adapter, catalogue: lireCatalogue } = branchement(id) as Branchement;
      const detected = await adapter.detect();
      let models: EngineInfo['models'] = [];
      let live = false;
      let catalogError: string | undefined;
      if (detected.installed) {
        const catalogue = await lireCatalogue(detected.version ?? '');
        models = catalogue.models;
        live = catalogue.live;
        catalogError = catalogue.error;
      }
      const info: EngineInfo = {
        id: adapter.id,
        label: adapter.label,
        installed: detected.installed,
        // L'OUTIL, séparé du moteur utilisable : Cursor peut être installé sans
        // clé. Un adaptateur qui ne dit rien de plus retombe sur `installed`.
        cliInstalle: detected.cliInstalle ?? detected.installed,
        version: detected.version,
        models,
        // Le modèle par défaut suit l'intention de l'adaptateur (un modèle
        // équilibré), ramenée vers un modèle qui existe vraiment — sinon on
        // retomberait sur le premier de la liste, c'est-à-dire le plus cher.
        defaultModel: resolveModel(models, adapter.defaultModel),
        live,
        // Une liste de secours ne passe pas pour la liste du moteur : le menu le dit.
        catalogError,
        fetchedAt: Date.now(),
      };
      return info;
    }),
  );
  cache = { at: Date.now(), engines };
  for (const ecouteur of ecouteursDuCatalogue) {
    try {
      ecouteur(engines);
    } catch {
      // Un écouteur qui tombe ne prive personne du catalogue.
    }
  }
  return engines;
}

const ecouteursDuCatalogue: ((engines: EngineInfo[]) => void)[] = [];

/**
 * Appelé à chaque catalogue FRAÎCHEMENT dressé (pas sur le cache). Sert à faire
 * suivre les réglages mémorisés quand une mise à jour du moteur retire une
 * version (`server/src/modeles-retires.ts`), sans que ce module-ci dépende de
 * la base.
 */
export function aChaqueCatalogue(ecouteur: (engines: EngineInfo[]) => void): void {
  ecouteursDuCatalogue.push(ecouteur);
}

/** Capacité du modèle réellement retenu, telle que le catalogue l'annonce. */
export async function contextWindowFor(engineId: EngineId, modelId?: string): Promise<number | undefined> {
  const engine = (await listEngines()).find((entry) => entry.id === engineId);
  if (!engine) return undefined;
  const resolved = resolveModel(engine.models, modelId ?? engine.defaultModel);
  return engine.models.find((model) => model.id === resolved)?.contextWindow;
}
