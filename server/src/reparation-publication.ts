/**
 * LA RÉPARATION SILENCIEUSE D'UNE ÉTAPE DE PUBLICATION — le tour d'agent.
 *
 * Appelée par le déroulé (`server/src/deploy.ts`) quand une étape tombe : un
 * agent de réparation reçoit la panne nommée, travaille dans le dossier du
 * projet, rend son verdict par l'outil `rendre_reparation`, et la publication
 * — TOUJOURS LA MÊME, jamais une nouvelle (`startDeploy` n'accepte aucun nouvel
 * appelant, MEM-3145) — rejoue l'étape. Règles pures : `shared/src/reparation-publication.ts`.
 *
 * Ce module ne touche jamais la publication elle-même : il lance, attend et
 * rend une issue. Le déroulé décide du reste (rejouer, abandonner, se taire).
 *
 *  - Le moteur se choisit AVANT l'agent (Claude puis Codex, jamais Cursor —
 *    DEC-156) ; sans compte libre, rien ne part (DEC-039) : « sans-moteur ».
 *  - Le tour est BORNÉ (`DELAIS_DU_DEPLOIEMENT_MS.reparation`) : au-delà,
 *    l'agent est arrêté et l'essai compte comme raté.
 *  - Un ARRÊT de la publication coupe l'agent aussitôt et vide sa file.
 *  - L'agent n'a ni carte, ni vignette, ni notification : sa conversation se
 *    lit depuis le fil technique de l'étape.
 */
import { DELAIS_DU_DEPLOIEMENT_MS, moteurDuTriAutomatique, reglagesDuNiveau } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { agentsActifs, arreterLAgent, createAgent, sendPrompt } from './runtime.js';

export type IssueDeReparation =
  | { issue: 'reparee'; agentId: string; explication?: string }
  | { issue: 'tentee'; agentId: string }
  | { issue: 'abandon'; agentId: string; explication: string; marcheASuivre?: string }
  | { issue: 'delai'; agentId: string }
  | { issue: 'sans-moteur'; agentId?: string }
  | { issue: 'arret'; agentId?: string };

export interface TourDeReparation {
  projectId: string;
  runId: string;
  cible: 'dev' | 'production';
  /** La clé de l'étape réparée. */
  etape: string;
  /** Le titre de l'agent, lisible dans la conversation. */
  titre: string;
  demande: string;
  /** L'agent des essais précédents : sa conversation garde ce qu'il a déjà tenté. */
  agentId?: string;
  signal: AbortSignal;
}

/** Les tests remplacent le moteur, le catalogue et l'horloge : aucun vrai tour ne part. */
export interface OutilsDeReparation {
  envoyer?: typeof sendPrompt;
  catalogue?: () => Promise<unknown[]>;
  actifs?: () => string[];
  arreter?: (agentId: string) => unknown;
  plafondMs?: number;
  sondeMs?: number;
}

const SONDE_MS = 2000;

/* Les essais de bout en bout (`reparation-silencieuse-bout-en-bout.test.ts`) imposent un faux agent
   à TOUT le déroulé, sans passer par un vrai moteur. Jamais posé en service. */
let outilsImposes: OutilsDeReparation = {};
export function imposerLesOutilsDeReparation(outils: OutilsDeReparation): void {
  outilsImposes = outils;
}

function pause(ms: number): Promise<void> {
  return new Promise((fin) => setTimeout(fin, ms));
}

/** Le tour a-t-il été refusé faute de quota ? (la demande est alors restée en file) */
function refuseFauteDeQuota(agentId: string): boolean {
  if (store.listQueue(agentId).length) return true;
  const dernier = store
    .listMessages(agentId, 5)
    .filter((m) => m.role === 'assistant')
    .pop();
  return dernier?.error === 'quota';
}

/** Ouvre l'agent de réparation, ou reprend celui des essais précédents. Rien sans compte libre. */
async function agentDeReparation(tour: TourDeReparation, lireCatalogue: () => Promise<unknown[]>): Promise<string | null> {
  const catalogue = (await lireCatalogue().catch(() => [])) as any[];
  const repris = tour.agentId ? store.getAgent(tour.agentId) : null;
  if (repris) {
    const entree = catalogue.find((m) => m.id === repris.run.engine);
    if (entree && !(entree.installed && entree.comptesDisponibles > 0)) return null;
    store.saveAgent({ ...repris, reparationPublication: { runId: tour.runId, etape: tour.etape, cible: tour.cible } });
    return repris.id;
  }
  const moteur = moteurDuTriAutomatique('programmation_avancee', catalogue as any, store.getSettings().ordreDesMoteurs).engine;
  const entree = catalogue.find((m) => m.id === moteur);
  if (!(entree?.installed && entree.comptesDisponibles > 0)) return null;
  const reglages = reglagesDuNiveau(entree, 'standard');
  const cree = createAgent({
    projectId: tour.projectId,
    role: 'deploy',
    title: tour.titre,
    run: { engine: moteur, model: reglages.model, thinking: reglages.thinking as any },
  });
  const marque = store.saveAgent({ ...cree, reparationPublication: { runId: tour.runId, etape: tour.etape, cible: tour.cible } });
  bus.emit({ type: 'agent.upsert', agent: marque });
  return marque.id;
}

/**
 * UN ESSAI DE RÉPARATION : l'agent part, on l'attend (borné), on lit son verdict.
 * Ne lève jamais : une panne interne rend « tentee », l'étape est rejouée et
 * dira elle-même si elle passe.
 */
export async function tourDeReparation(tour: TourDeReparation, reglages: OutilsDeReparation = {}): Promise<IssueDeReparation> {
  const outils = { ...outilsImposes, ...reglages };
  const envoyer = outils.envoyer ?? sendPrompt;
  const actifs = outils.actifs ?? agentsActifs;
  const couper = outils.arreter ?? arreterLAgent;
  const plafondMs = outils.plafondMs ?? DELAIS_DU_DEPLOIEMENT_MS.reparation;
  const sondeMs = outils.sondeMs ?? SONDE_MS;
  if (tour.signal.aborted) return { issue: 'arret', agentId: tour.agentId };

  const agentId = await agentDeReparation(tour, outils.catalogue ?? catalogueMoteurs);
  if (!agentId) return { issue: 'sans-moteur', agentId: tour.agentId };

  const arreter = () => {
    store.clearQueue(agentId);
    try {
      couper(agentId);
    } catch (err) {
      log.warn(`réparation de publication : l’arrêt de l’agent ${agentId} a échoué — ${(err as Error)?.message ?? err}`);
    }
  };

  const debut = Date.now();
  try {
    await envoyer(agentId, tour.demande, { template: 'none', silent: true, motif: 'depannage' });
  } catch (err) {
    log.warn(`réparation de publication : le tour de ${agentId} n’a pas pu partir — ${(err as Error)?.message ?? err}`);
    return { issue: 'tentee', agentId };
  }
  while (actifs().includes(agentId)) {
    if (tour.signal.aborted) {
      arreter();
      return { issue: 'arret', agentId };
    }
    if (Date.now() - debut > plafondMs) {
      arreter();
      return { issue: 'delai', agentId };
    }
    await pause(sondeMs);
  }
  if (tour.signal.aborted) return { issue: 'arret', agentId };
  if (refuseFauteDeQuota(agentId)) {
    // La demande ne doit pas repartir plus tard, toute seule, sur une publication finie.
    store.clearQueue(agentId);
    return { issue: 'sans-moteur', agentId };
  }

  const verdict = store.getAgent(agentId)?.reparationPublication?.verdict;
  if (!verdict || verdict.at < debut) return { issue: 'tentee', agentId };
  if (verdict.issue === 'abandon') {
    return { issue: 'abandon', agentId, explication: verdict.explication, marcheASuivre: verdict.marcheASuivre };
  }
  return { issue: 'reparee', agentId, explication: verdict.explication };
}

/**
 * L'OUTIL `rendre_reparation` : l'agent de réparation dit s'il a réparé ou s'il
 * abandonne, avec l'explication et la marche à suivre que l'encadré affichera.
 * Réservé à un agent ouvert par la réparation silencieuse.
 */
export function rendreLaReparation(
  agentId: string,
  args: { issue?: unknown; explication?: unknown; marche_a_suivre?: unknown },
): { ok: boolean; texte: string } {
  const agent = store.getAgent(agentId);
  const lien = agent?.reparationPublication;
  if (!agent || !lien) return { ok: false, texte: 'Cet outil est réservé à l’agent de réparation d’une publication en cours.' };
  const issue = args.issue === 'abandon' ? 'abandon' : args.issue === 'reparee' ? 'reparee' : null;
  if (!issue) return { ok: false, texte: '« issue » doit valoir « reparee » ou « abandon ».' };
  const explication = typeof args.explication === 'string' ? args.explication.trim().slice(0, 1200) : '';
  if (!explication) return { ok: false, texte: '« explication » est obligatoire : ce qui bloquait, en une ou deux phrases simples.' };
  const marche = typeof args.marche_a_suivre === 'string' ? args.marche_a_suivre.trim().slice(0, 1200) : '';
  if (issue === 'abandon' && !marche) {
    return { ok: false, texte: 'Pour un abandon, « marche_a_suivre » est obligatoire : ce que l’utilisateur doit faire, concrètement.' };
  }
  store.saveAgent({
    ...agent,
    reparationPublication: { ...lien, verdict: { issue, explication, ...(marche ? { marcheASuivre: marche } : {}), at: Date.now() } },
  });
  return {
    ok: true,
    texte:
      issue === 'reparee'
        ? 'Noté : l’étape sera rejouée dès la fin de ton tour. Termine maintenant ta réponse en une phrase.'
        : 'Noté : l’utilisateur verra ton explication et ta marche à suivre sur l’étape. Termine maintenant ta réponse en une phrase.',
  };
}
