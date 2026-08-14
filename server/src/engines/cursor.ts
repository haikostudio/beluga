import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  API_CURSOR,
  MODELE_CURSOR_PAR_DEFAUT,
  attenteAvantRelecture,
  branchesDuRunCursor,
  coutEnDollars,
  depotGithubPourCursor,
  depotsDepuisCursor,
  enteteDuTour,
  issueDuRunCursor,
  messageDeFinCursor,
  messageDeRapatriement,
  paramsDeReflexionCursor,
  peutRapatrierIci,
  raisonDeRefusCursor,
  type BrancheCursor,
  type EtatCompteCursor,
  type ModeleCursor,
} from '@haikodev/shared';
import { EngineAdapter, EngineEvent, EngineHandle, EngineRunOptions } from './types.js';
import { cleDuCompteCursor, listAccountRecords } from '../accounts.js';
import { log } from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * L'ADAPTATEUR CURSOR. Les deux autres moteurs lancent un PROCESSUS et lisent
 * sa sortie ; celui-ci parle à une API et suit un travail qui tourne AILLEURS
 * (voir `shared/src/moteur-cursor.ts` pour le pourquoi). Le contrat rendu au
 * démon ne change pas d'un iota : les mêmes événements (`session`, `step`,
 * `text`, `usage`, `error`, `done`), le même `stop()`, la même promesse de fin.
 * C'est ce qui permet à l'ordonnanceur, au suivi de carte et à la mesure de ne
 * rien savoir de Cursor.
 *
 * DEUX RÈGLES QUI NE SE NÉGOCIENT PAS :
 *  - un appel refusé se DIT (`kind: 'error'`) et le tour se REFERME
 *    (`kind: 'done'` avec un code non nul). Un témoin qui tourne sur une clé
 *    refusée est précisément le défaut que ce moteur ne doit pas introduire ;
 *  - la clé vient de l'ENVIRONNEMENT du compte porteur (`CURSOR_API_KEY`,
 *    posée par `applyAccountEnv`), jamais d'une constante écrite ici.
 */

/** La clé de ce tour : celle du compte porteur, sinon celle du serveur. */
function cleDuTour(env?: Record<string, string>): string {
  return (env?.CURSOR_API_KEY || process.env.CURSOR_API_KEY || '').trim();
}

/**
 * TOUTES les clés Cursor connues, du compte prioritaire au dernier, celle de
 * l'environnement en dernier recours.
 *
 * Un seul compte ne doit pas décider pour le moteur entier : sa clé peut être
 * révoquée alors qu'un second compte répond très bien. Sans cette liste, le
 * moteur se déclarait ABSENT dès que la clé de l'environnement était refusée —
 * et le compte de relève, pourtant valide, disparaissait avec lui (constaté par
 * `scripts/verif-moteur-cursor.mjs`).
 */
export function clesCursor(): string[] {
  const cles: string[] = [];
  for (const compte of listAccountRecords()
    .filter((a) => a.engine === 'cursor')
    .sort((a, b) => a.priority - b.priority)) {
    const cle = cleDuCompteCursor(compte);
    if (cle && !cles.includes(cle)) cles.push(cle);
  }
  const environnement = cleDuTour();
  if (environnement && !cles.includes(environnement)) cles.push(environnement);
  return cles;
}

export class RefusCursor extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Un appel à l'API. Toute réponse hors 2xx devient un refus EXPLIQUÉ en
 * français : c'est ce message-là qui remonte jusqu'à la bulle rouge.
 */
export async function appelCursor(
  chemin: string,
  cle: string,
  options: { methode?: string; corps?: unknown; plafondMs?: number; signal?: AbortSignal } = {},
): Promise<any> {
  const res = await fetch(`${API_CURSOR}${chemin}`, {
    method: options.methode ?? 'GET',
    headers: {
      authorization: `Bearer ${cle}`,
      ...(options.corps ? { 'content-type': 'application/json' } : {}),
    },
    body: options.corps ? JSON.stringify(options.corps) : undefined,
    signal: options.signal ?? AbortSignal.timeout(options.plafondMs ?? 120_000),
  });
  if (!res.ok) {
    const corps: any = await res.json().catch(() => null);
    const message = typeof corps?.error?.message === 'string' ? corps.error.message
      : typeof corps?.message === 'string' ? corps.message
      : undefined;
    throw new RefusCursor(raisonDeRefusCursor(res.status, message), res.status);
  }
  return res.json().catch(() => ({}));
}

/** Le catalogue brut des modèles, tel que Cursor le rend. */
export async function modelesCursor(cle: string): Promise<any[]> {
  const data = await appelCursor('/v1/models', cle, { plafondMs: 15_000 });
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * Les paramètres du modèle choisi, lus dans le catalogue et gardés quelques
 * minutes : ils décident de la façon d'envoyer le niveau de réflexion, et le
 * catalogue ne bouge pas d'un tour à l'autre.
 */
let cacheModeles: { at: number; items: any[] } | null = null;

async function ficheDuModele(cle: string, modele: string): Promise<ModeleCursor | undefined> {
  if (!cacheModeles || Date.now() - cacheModeles.at > 5 * 60 * 1000) {
    try {
      cacheModeles = { at: Date.now(), items: await modelesCursor(cle) };
    } catch (err) {
      // Catalogue injoignable : on envoie le modèle sans réglage de réflexion
      // plutôt que de faire échouer le tour pour un réglage secondaire.
      log.warn('catalogue Cursor illisible avant un tour', err);
      return undefined;
    }
  }
  return cacheModeles.items.find(
    (m) => m?.id === modele || (Array.isArray(m?.aliases) && m.aliases.includes(modele)),
  );
}

/**
 * LES DÉPÔTS QUE CE COMPTE PEUT VRAIMENT OUVRIR (`GET /v1/repositories`).
 * Envoyer un dépôt que Cursor ne voit pas fait refuser la demande entière
 * (« Failed to determine repository default branch ») : le tour n'aurait alors
 * jamais lieu, alors qu'un agent SANS dépôt, lui, répond. On demande donc la
 * liste avant de proposer quoi que ce soit.
 */
export async function depotAccessible(cle: string, url: string): Promise<boolean | 'inconnu'> {
  try {
    const data = await appelCursor('/v1/repositories', cle, { plafondMs: 15_000 });
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    const cible = url.replace(/^https?:\/\/(www\.)?github\.com\//i, '').toLowerCase();
    return items.some((entree) =>
      JSON.stringify(entree ?? {})
        .toLowerCase()
        .includes(cible),
    );
  } catch (err) {
    // Liste illisible : on ne DÉGRADE pas sur une supposition — le dépôt part
    // comme demandé, et un refus éventuel se dira en clair.
    log.warn('liste des dépôts Cursor illisible', err);
    return 'inconnu';
  }
}

/**
 * L'ÉTAT D'UN COMPTE CURSOR, tel que les réglages l'affichent : la clé
 * répond-elle, et quels dépôts peut-elle ouvrir ? Les deux appels sont
 * indépendants — une liste de dépôts illisible ne fait pas passer une clé
 * valide pour refusée, et l'inverse non plus.
 */
export async function etatDuCompteCursor(cle: string): Promise<EtatCompteCursor> {
  if (!cle) {
    return { cleAcceptee: false, erreur: "aucune clé d'accès configurée sur le serveur", depots: [] };
  }
  let nomDeLaCle: string | undefined;
  try {
    const moi = await appelCursor('/v1/me', cle, { plafondMs: 15_000 });
    nomDeLaCle = typeof moi?.apiKeyName === 'string' ? moi.apiKeyName : undefined;
  } catch (err: any) {
    return { cleAcceptee: false, erreur: err?.message ?? 'la clé n\'a pas pu être éprouvée', depots: [] };
  }
  try {
    const data = await appelCursor('/v1/repositories', cle, { plafondMs: 15_000 });
    return { cleAcceptee: true, nomDeLaCle, depots: depotsDepuisCursor(data?.items) };
  } catch (err: any) {
    return {
      cleAcceptee: true,
      nomDeLaCle,
      depots: [],
      erreurDepots: err?.message ?? 'la liste des dépôts n\'a pas pu être lue',
    };
  }
}

/**
 * LE DÉPÔT SUR LEQUEL L'AGENT CLOUD TRAVAILLE. Il est déduit du dossier du
 * tour : c'est la copie de travail de la carte, donc son `origin` est le dépôt
 * du projet. Rien de trouvé, ou un dépôt qui n'est pas GitHub : l'agent part
 * SANS dépôt — il répond, il ne modifie rien. On ne devine jamais une adresse.
 */
export async function depotDuTour(cwd: string, cle: string): Promise<{ url: string; startingRef?: string } | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 10_000 });
    const url = depotGithubPourCursor(stdout);
    if (!url) return null;
    if ((await depotAccessible(cle, url)) === false) return null;
    let startingRef: string | undefined;
    try {
      const branche = (await execFileAsync('git', ['branch', '--show-current'], { cwd, timeout: 10_000 })).stdout.trim();
      // La branche n'est proposée que si elle existe VRAIMENT chez GitHub :
      // une branche de carte jamais poussée ferait refuser la demande entière.
      if (branche) {
        const distante = await execFileAsync('git', ['ls-remote', '--heads', 'origin', branche], {
          cwd,
          timeout: 20_000,
        });
        if (distante.stdout.trim()) startingRef = branche;
      }
    } catch {
      /* branche indéterminable : Cursor prendra la branche par défaut */
    }
    return { url, startingRef };
  } catch {
    return null;
  }
}

/**
 * RAMENER DANS LA CARTE CE QUE L'AGENT CLOUD A ÉCRIT.
 *
 * L'agent Cursor ne travaille pas sur la machine : il pousse son travail sur
 * une branche « cursor/… » du dépôt GitHub. Sans ce rapatriement, une carte
 * lancée sur Cursor finissait sans une ligne de code dans sa copie de
 * travail — donc sans preuve de travail, donc jamais « Terminé ».
 *
 * Trois portes, toutes DURES (`peutRapatrierIci`) : on n'est que dans le
 * dossier d'une carte (branche « tache/… »), le dossier est propre, et la
 * fusion se fait sans conflit. Chaque refus est DIT dans une étape, avec le nom
 * de la branche — le travail n'est jamais perdu, il reste chez GitHub.
 */
export async function rapatrierLeTravail(
  cwd: string,
  branches: BrancheCursor[],
  onEvent: (event: EngineEvent) => void,
): Promise<void> {
  if (!branches.length) return;
  const git = (args: string[], timeout = 60_000) => execFileAsync('git', args, { cwd, timeout });

  let brancheLocale = '';
  let propre = true;
  try {
    brancheLocale = (await git(['branch', '--show-current'], 10_000)).stdout.trim();
    propre = !(await git(['status', '--porcelain'], 20_000)).stdout.trim();
  } catch {
    // Pas un dépôt lisible : rien à ramener, et on le dit plus bas.
    brancheLocale = '';
  }

  for (const branche of branches) {
    const etape = (etat: 'done' | 'failed', message: string) =>
      onEvent({
        kind: 'step',
        step: { key: `cursor-rapatriement-${branche.branche}`, label: message, state: etat, detail: branche.demandeDeFusion },
      });

    if (!peutRapatrierIci(brancheLocale, propre)) {
      etape('done', messageDeRapatriement(branche.branche, 'hors-carte'));
      continue;
    }
    try {
      await git(['fetch', 'origin', branche.branche], 120_000);
      await git(['merge', '--no-edit', 'FETCH_HEAD'], 120_000);
      etape('done', messageDeRapatriement(branche.branche, 'fusionnee'));
    } catch (err: any) {
      // Une fusion à moitié faite est pire que pas de fusion du tout : on la
      // défait avant de rendre la main, et la cause s'écrit en clair.
      await git(['merge', '--abort'], 30_000).catch(() => undefined);
      const conflit = /conflict/i.test(String(err?.stdout ?? '') + String(err?.stderr ?? ''));
      log.warn('rapatriement du travail Cursor impossible', err);
      etape(
        'failed',
        conflit
          ? messageDeRapatriement(branche.branche, 'conflit')
          : messageDeRapatriement(branche.branche, 'echec', (err?.stderr ?? err?.message ?? '').toString().trim().slice(0, 200)),
      );
    }
  }
}

/** La mesure du tour, lue sur l'agent une fois le run terminé. */
async function mesureDuRun(cle: string, agentId: string, runId: string): Promise<EngineEvent['usage'] | undefined> {
  try {
    const data = await appelCursor(`/v1/agents/${agentId}/usage`, cle, { plafondMs: 20_000 });
    const runs: any[] = Array.isArray(data?.runs) ? data.runs : [];
    const propre = runs.find((r) => r?.id === runId);
    const usage = propre?.usage ?? data?.totalUsage;
    if (!usage) return undefined;
    const cache = Number(usage.cacheReadTokens ?? 0);
    return {
      // Cursor compte le cache À PART de `inputTokens` (constaté sur un tour
      // réel : 2 733 en entrée, 11 072 relus). Les deux parts restent donc
      // disjointes, comme le contrat interne l'exige.
      inputTokens: Number(usage.inputTokens ?? 0),
      outputTokens: Number(usage.outputTokens ?? 0),
      cachedTokens: Number.isFinite(cache) ? cache : undefined,
      costUsd: coutEnDollars(propre?.cost?.chargedCents ?? data?.cost?.chargedCents),
    };
  } catch (err) {
    // La mesure n'est pas le tour : son absence se dit « indisponible », elle
    // ne fait jamais échouer un travail rendu.
    log.warn('mesure Cursor illisible', err);
    return undefined;
  }
}

export const cursorAdapter: EngineAdapter = {
  id: 'cursor',
  label: 'Cursor',
  // Aucun exécutable : ce moteur vit au bout d'une API. Le champ reste au
  // contrat commun, vide, plutôt qu'un faux chemin qu'un script irait chercher.
  binary: '',
  defaultModel: MODELE_CURSOR_PAR_DEFAUT,

  async detect() {
    const cles = clesCursor();
    if (!cles.length) return { installed: false };
    let dernierRefus: unknown = null;
    for (const cle of cles) {
      try {
        const moi = await appelCursor('/v1/me', cle, { plafondMs: 15_000 });
        return { installed: true, version: typeof moi?.apiKeyName === 'string' ? moi.apiKeyName : 'clé acceptée' };
      } catch (err) {
        dernierRefus = err;
        // Compte suivant : une clé révoquée ne doit pas emporter le moteur.
      }
    }
    log.warn('aucune clé Cursor acceptée', dernierRefus);
    return { installed: false };
  },

  async models() {
    for (const cle of clesCursor()) {
      const liste = await modelesCursor(cle).catch(() => null);
      if (liste?.length) return liste;
    }
    return [];
  },

  run(options: EngineRunOptions): EngineHandle {
    const abandon = new AbortController();
    let arrete = false;
    /** L'agent cloud porteur du fil : le premier tour le crée, les suivants s'y ajoutent. */
    let agentId = options.sessionId ?? undefined;
    let runId: string | undefined;

    const finished = (async (): Promise<{ ok: boolean; error?: string }> => {
      const terminer = (ok: boolean, error?: string) => {
        if (!ok && error) options.onEvent({ kind: 'error', error });
        options.onEvent({ kind: 'done', exitCode: ok ? 0 : 1 });
        return { ok, error };
      };

      const cle = cleDuTour(options.env);
      if (!cle) {
        return terminer(
          false,
          "Aucune clé d'accès Cursor n'est configurée sur le serveur : le tour n'est pas parti.",
        );
      }

      try {
        const modele = options.model?.trim() || MODELE_CURSOR_PAR_DEFAUT;
        const params = paramsDeReflexionCursor(await ficheDuModele(cle, modele), options.thinking);

        /*
         * La consigne système part COLLÉE DEVANT la demande, comme sous Codex :
         * l'API n'a pas de consigne séparée. `enteteDuTour` décide de ce qui
         * repart vraiment (`shared/src/prefixe-cache.ts`).
         */
        const entete = enteteDuTour({
          engine: 'cursor',
          reprise: Boolean(agentId),
          systemPrompt: options.systemPrompt,
          systemPromptRappel: options.systemPromptRappel,
        });
        const texte = entete ? `${entete}\n\n---\n\n${options.prompt}` : options.prompt;

        if (!agentId) {
          const depot = await depotDuTour(options.cwd, cle);
          options.onEvent({
            kind: 'step',
            step: {
              key: 'cursor-depart',
              label: depot
                ? `Agent Cursor lancé sur ${depot.url.split('/').slice(-2).join('/')}`
                : 'Agent Cursor lancé sans dépôt',
              state: 'running',
              detail: depot
                ? `${depot.url}${depot.startingRef ? ` (branche ${depot.startingRef})` : ''}`
                : "Aucun dépôt GitHub ouvert à ce compte Cursor : l'agent réfléchit et répond, il ne touche pas au projet.",
            },
          });
          const cree = await appelCursor('/v1/agents', cle, {
            methode: 'POST',
            corps: {
              prompt: { text: texte },
              model: { id: modele, ...(params.length ? { params } : {}) },
              ...(depot ? { repos: [{ url: depot.url, ...(depot.startingRef ? { startingRef: depot.startingRef } : {}) }] } : {}),
              // Une demande de fusion est un geste de l'utilisateur, jamais du moteur.
              autoCreatePR: false,
            },
            signal: abandon.signal,
          });
          agentId = cree?.agent?.id;
          runId = cree?.run?.id ?? cree?.agent?.latestRunId;
          if (!agentId || !runId) throw new RefusCursor("Cursor n'a pas rendu d'agent utilisable.", 0);
          options.onEvent({ kind: 'session', sessionId: agentId });
          options.onEvent({
            kind: 'step',
            step: { key: 'cursor-depart', label: 'Agent Cursor lancé', state: 'done' },
          });
        } else {
          const suite = await appelCursor(`/v1/agents/${agentId}/runs`, cle, {
            methode: 'POST',
            corps: { prompt: { text: texte }, model: { id: modele, ...(params.length ? { params } : {}) } },
            signal: abandon.signal,
          });
          runId = suite?.run?.id;
          if (!runId) throw new RefusCursor("Cursor n'a pas rendu de tour utilisable.", 0);
        }

        /*
         * LE SUIVI. Le flux d'événements de Cursor se coupe sans prévenir
         * (« Run stream is no longer available », constaté sur un run réel) :
         * on ne s'y fie pas et on RELIT le run jusqu'à un statut terminal. Un
         * statut inconnu compte comme terminal — jamais comme un travail qui
         * continue, sinon le témoin tournerait pour toujours.
         */
        let essai = 0;
        let dernierStatut = '';
        const debut = Date.now();
        for (;;) {
          if (arrete) return terminer(false, 'Tour arrêté à la demande.');
          if (options.plafondMs && Date.now() - debut > options.plafondMs) {
            return terminer(false, "Cursor n'a pas rendu la main dans le temps imparti.");
          }
          const run = await appelCursor(`/v1/agents/${agentId}/runs/${runId}`, cle, {
            plafondMs: 30_000,
            signal: abandon.signal,
          });
          const statut = String(run?.status ?? '');
          if (statut && statut !== dernierStatut) {
            dernierStatut = statut;
            options.onEvent({
              kind: 'step',
              step: { key: 'cursor-travail', label: `Cursor : ${libelleDeStatut(statut)}`, state: 'running' },
            });
          }
          const issue = issueDuRunCursor(statut);
          if (issue !== 'en-cours') {
            const resultat = typeof run?.result === 'string' ? run.result.trim() : '';
            options.onEvent({
              kind: 'step',
              step: {
                key: 'cursor-travail',
                label: `Cursor : ${libelleDeStatut(statut)}`,
                state: issue === 'reussi' ? 'done' : 'failed',
              },
            });
            const usage = await mesureDuRun(cle, agentId, runId);
            if (usage) options.onEvent({ kind: 'usage', usage });
            // Ce que l'agent a ÉCRIT revient dans la carte avant que le tour ne
            // se referme : sinon le démon constaterait un dépôt intact.
            if (issue === 'reussi') {
              await rapatrierLeTravail(options.cwd, branchesDuRunCursor(run), options.onEvent);
            }
            if (issue === 'reussi' && resultat) {
              options.onEvent({ kind: 'text', text: resultat });
              return terminer(true);
            }
            return terminer(false, messageDeFinCursor(statut, resultat));
          }
          await new Promise((resolve) => setTimeout(resolve, attenteAvantRelecture(essai++)));
        }
      } catch (err: any) {
        if (arrete) return terminer(false, 'Tour arrêté à la demande.');
        const message =
          err instanceof RefusCursor
            ? err.message
            : err?.name === 'TimeoutError' || err?.name === 'AbortError'
              ? "Le service Cursor n'a pas répondu dans le temps imparti."
              : `L'appel à Cursor a échoué : ${err?.message ?? String(err)}`;
        log.warn('tour Cursor en échec', err);
        return terminer(false, message);
      }
    })();

    return {
      stop: () => {
        arrete = true;
        abandon.abort();
        // L'agent tourne CHEZ Cursor : le prévenir est le seul moyen de ne pas
        // laisser un travail (et une dépense) courir dans le vide.
        const cle = cleDuTour(options.env);
        if (cle && agentId && runId) {
          appelCursor(`/v1/agents/${agentId}/runs/${runId}/cancel`, cle, { methode: 'POST', plafondMs: 15_000 }).catch(
            (err) => log.warn("arrêt du tour Cursor impossible", err),
          );
        }
      },
      finished,
    };
  },
};

/** Le statut de Cursor, dit en français dans l'étape affichée. */
function libelleDeStatut(statut: string): string {
  switch (statut.toUpperCase()) {
    case 'CREATING':
      return 'préparation';
    case 'PENDING':
    case 'QUEUED':
      return 'en attente';
    case 'RUNNING':
    case 'ACTIVE':
      return 'au travail';
    case 'FINISHED':
    case 'COMPLETED':
      return 'terminé';
    case 'CANCELLED':
    case 'CANCELED':
    case 'STOPPED':
      return 'arrêté';
    default:
      return statut.toLowerCase() || 'sans statut';
  }
}
