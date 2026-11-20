/**
 * LES PAROLES DE BELUGA PENDANT LA MISE EN ROUTE (carte « Assistant d'installation et Jarvis », 20/11/2026).
 *
 * Dès qu'un moteur est relié, l'écran de mise en route demande les paroles de l'agent : le démon les fait écrire
 * par CE moteur, en un appel à part (même mécanique que `autres-idees.ts`) — aucun `sessionId`, aucune carte, un
 * dossier temporaire vide, outils d'écriture fermés, palier « léger », borné. Les règles pures (la demande, la
 * lecture tolérante) vivent dans `shared/src/mise-en-route.ts`.
 *
 * Les paroles se GARDENT par langue (`meta`) : un rechargement, un second appareil ne repaient rien. Un seul appel
 * à la fois par langue ; un second demandeur attend le premier. Un échec n'est jamais bloquant : l'écran garde
 * ses textes écrits d'avance.
 *
 * Les tests ne paient pas de modèle (garde `NODE_TEST_CONTEXT`). Un DÉMON D'ESSAI peut recevoir une réponse toute
 * faite par `BELUGA_PAROLES_D_ESSAI` (texte rendu tel quel), pour que les contrôles d'interface ne dépensent rien.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MOTEURS_DE_L_ASSISTANT,
  demandeDesParoles,
  lireLesParoles,
  nomDeLAssistant,
  reglagesDuNiveau,
  type EngineId,
  type ParolesDeLaMiseEnRoute,
} from '@beluga/shared';
import { applyAccountEnv, pickAccount } from './accounts.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { DEMON_D_ESSAI } from './config.js';
import { getMeta, setMeta } from './db.js';
import { adapterFor } from './engines/index.js';
import { log } from './logger.js';
import { machineHebergee } from './offre-hebergee.js';
import { getSettings } from './store.js';

const PLAFOND_MS = 90_000;
const OUTILS_FERMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch'];
const LANGUES_CONNUES = new Set(['fr', 'en', 'es', 'de', 'zh']);

export type ResultatDesParoles = { ok: true; paroles: ParolesDeLaMiseEnRoute; moteur?: EngineId } | { ok: false; raison: string };

const enCours = new Map<string, Promise<ResultatDesParoles>>();

function cleDesParoles(langue: string, nom: string): string {
  return `mise-en-route.paroles.${langue}.${nom.toLowerCase()}`;
}

/** Le premier moteur de la liste qui a un compte prêt : c'est lui qui parle. */
async function moteurQuiParle(): Promise<{ engine: EngineId; model: string | undefined } | null> {
  const catalogue = await catalogueMoteurs().catch(() => []);
  for (const { id } of MOTEURS_DE_L_ASSISTANT) {
    const entree = catalogue.find((m) => m.id === id);
    if (!entree?.installed) continue;
    const compte = await pickAccount(id).catch(() => null);
    if (!compte) continue;
    return { engine: id, model: reglagesDuNiveau(entree, 'leger').model };
  }
  return null;
}

async function demanderAuMoteur(demande: string): Promise<{ texte: string; moteur?: EngineId }> {
  const dEssai = DEMON_D_ESSAI ? (process.env.BELUGA_PAROLES_D_ESSAI ?? '').trim() : '';
  if (dEssai) return { texte: dEssai };
  if (process.env.NODE_TEST_CONTEXT) throw new Error('aucun modèle n’est appelé pendant les tests');
  const choisi = await moteurQuiParle();
  if (!choisi) throw new Error('aucun moteur n’a encore de compte prêt');
  const compte = await pickAccount(choisi.engine);
  if (!compte) throw new Error('aucun compte de ce moteur n’a de quota en ce moment');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-mise-en-route-'));
  let texte = '';
  let erreur: string | undefined;
  try {
    const handle = adapterFor(choisi.engine).run({
      cwd,
      prompt: demande,
      model: choisi.model,
      fullAccess: false,
      role: 'task',
      disallowedTools: OUTILS_FERMES,
      env: applyAccountEnv(compte),
      plafondMs: PLAFOND_MS,
      onEvent: (event) => {
        if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
        if (event.kind === 'error' && event.error) erreur = event.error;
      },
    });
    const resultat = await handle.finished;
    if (!texte.trim()) throw new Error(resultat.error ?? erreur ?? 'le moteur n’a rien rendu');
    return { texte, moteur: choisi.engine };
  } finally {
    fs.rm(cwd, { recursive: true, force: true }, () => {});
  }
}

/** Les paroles déjà écrites pour cette langue et ce nom, sans rien demander. */
function parolesGardees(langue: string, nom: string): ParolesDeLaMiseEnRoute | null {
  const brut = getMeta(cleDesParoles(langue, nom));
  if (!brut) return null;
  try {
    const lu = JSON.parse(brut) as ParolesDeLaMiseEnRoute;
    return lu && typeof lu === 'object' && Object.keys(lu).length ? lu : null;
  } catch {
    return null;
  }
}

/**
 * LES PAROLES DE LA MISE EN ROUTE, écrites par le moteur relié — gardées, sinon demandées. Ne lève jamais :
 * un refus se rend en phrase, et l'écran garde ses textes.
 */
export async function parolesDeLaMiseEnRoute(langueDemandee?: string): Promise<ResultatDesParoles> {
  const langue = LANGUES_CONNUES.has(langueDemandee ?? '') ? langueDemandee! : 'fr';
  const nom = nomDeLAssistant(getSettings());
  const gardees = parolesGardees(langue, nom);
  if (gardees) return { ok: true, paroles: gardees };
  const cle = cleDesParoles(langue, nom);
  const deja = enCours.get(cle);
  if (deja) return deja;
  const travail = (async (): Promise<ResultatDesParoles> => {
    const depart = Date.now();
    try {
      const { texte, moteur } = await demanderAuMoteur(demandeDesParoles({ langue, nom, hebergee: machineHebergee() }));
      const paroles = lireLesParoles(texte);
      if (!Object.keys(paroles).length) {
        log.warn(`mise en route : paroles illisibles (${texte.slice(0, 200)})`);
        return { ok: false, raison: 'Le moteur n’a rendu aucune parole lisible.' };
      }
      setMeta(cle, JSON.stringify(paroles));
      log.info(`mise en route : ${Object.keys(paroles).length} paroles écrites en ${Math.round((Date.now() - depart) / 1000)} s`);
      return { ok: true, paroles, moteur };
    } catch (err) {
      const pourquoi = String((err as Error)?.message ?? err);
      log.warn(`mise en route : paroles non écrites (${pourquoi})`);
      return { ok: false, raison: pourquoi };
    } finally {
      enCours.delete(cle);
    }
  })();
  enCours.set(cle, travail);
  return travail;
}
