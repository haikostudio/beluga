/**
 * LE RATTRAPAGE D'UNE CARTE ÉCARTÉE, CÔTÉ DÉMON.
 *
 * Les règles (quand, une fois, quel texte) sont pures et vivent dans
 * `shared/src/rattrapage-ecartee.ts`. Ici : relire les publications qui ont
 * un rattrapage en attente, choisir un compte AVANT tout écrit (DEC-039),
 * relancer l'agent de la carte par `sendPrompt` (DEC-037 : jamais à côté), et
 * écrire l'issue sur la tâche du lot et dans le journal de la carte.
 *
 * Deux portes, une seule fonction : la fin de publication (puis la veille,
 * qui reprend ce qu'un redémarrage ou un quota vide a laissé) et le bouton
 * « Réconcilier » du volet.
 */

import {
  JALON_ECARTEE_DU_LOT,
  JALON_RATTRAPAGE_APRES_ECARTEMENT,
  RATTRAPAGE_PERIME_MS,
  avecRattrapage,
  demandeDeReconciliation,
  issueDuRattrapage,
  reconciliationALaMain,
  tachesARattraper,
  type Card,
  type DeployRun,
  type RattrapageDeTache,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { redemarrageEstEnAttente } from './demon.js';
import { pickAccount } from './accounts.js';
import { isRunning, sendPrompt } from './runtime.js';

/** L'heure où CE démon a démarré : un rattrapage posé avant un redémarrage demandé attend qu'il soit passé. */
const DEMON_DEMARRE_A = Date.now() - Math.round(process.uptime() * 1000);

/** Les rattrapages en train de partir, pour qu'une veille et un clic ne lancent pas deux fois le même. */
const enDepart = new Set<string>();

function journaliser(card: Card, libelle: string, resultat: string, reussie: boolean): void {
  const entree = ajouterAuJournal({
    cardId: card.id,
    phase: phaseDeLaCarte(card.id, 'task'),
    nature: 'jalon',
    libelle,
    agentId: card.agentId,
    resultat,
    reussie,
  });
  if (entree) bus.emit({ type: 'journal.entree', entree });
}

/** Le jalon « Écartée de la publication » (JALON_ECARTEE_DU_LOT), avec la phrase nommée. */
export function noterLEcartementSurLaCarte(card: Card, phrase: string): void {
  try {
    journaliser(card, JALON_ECARTEE_DU_LOT, phrase, false);
  } catch (err) {
    log.warn(`jalon d'écartement non écrit pour « ${card.title} »`, err);
  }
}

/** Réécrit le rattrapage d'une tâche sur la publication LA PLUS FRAÎCHE en base. */
function poserLeRattrapage(runId: string, cardId: string, rattrapage: RattrapageDeTache): DeployRun | null {
  const run = store.getDeploy(runId);
  if (!run?.taches?.length) return null;
  const saved = store.saveDeploy({ ...run, taches: avecRattrapage(run.taches, cardId, rattrapage) });
  bus.emit({ type: 'deploy.upsert', run: saved });
  return saved;
}

/**
 * RELANCE L'AGENT D'UNE CARTE ÉCARTÉE pour qu'il réconcilie sa branche. Rend
 * ce qui s'est passé, en français, pour le bouton comme pour le journal du
 * démon. Ne lève jamais.
 */
export async function reconcilierLaCarte(
  runId: string,
  cardId: string,
  par: 'automatique' | 'humain',
): Promise<{ ok: boolean; error?: string; etat?: RattrapageDeTache['etat'] }> {
  const cle = `${runId}:${cardId}`;
  if (enDepart.has(cle)) return { ok: false, error: 'Cette réconciliation est déjà en train de partir.' };
  enDepart.add(cle);
  try {
    const run = store.getDeploy(runId);
    const tache = run?.taches?.find((t) => t.cardId === cardId);
    if (!run || !tache) return { ok: false, error: 'Cette tâche n’existe plus dans cette publication.' };
    const card = store.getCard(cardId);
    const avant = tache.rattrapage;
    const base = { at: Date.now(), par, ...(avant?.apresRedemarrage ? { apresRedemarrage: true } : {}) };

    if (!card || card.column !== 'to_deploy') {
      const detail = card ? `la carte est en « ${card.column} », plus dans « À déployer »` : 'la carte n’existe plus';
      if (par === 'automatique') poserLeRattrapage(runId, cardId, { ...base, etat: 'sans-objet', detail });
      return { ok: false, error: `Rien à réconcilier : ${detail}.`, etat: 'sans-objet' };
    }
    if (!reconciliationALaMain(tache, card.column)) {
      return { ok: false, error: 'Cette carte ne peut pas être réconciliée maintenant.' };
    }
    const agent = card.agentId ? store.getAgent(card.agentId) : null;
    if (!agent) {
      poserLeRattrapage(runId, cardId, { ...base, etat: 'echec', detail: 'la carte n’a pas d’agent de tâche à relancer' });
      return { ok: false, error: 'Cette carte n’a pas d’agent de tâche à relancer.', etat: 'echec' };
    }
    if (isRunning(agent.id)) return { ok: false, error: 'L’agent de cette carte travaille déjà.' };

    /* LE COMPTE D'ABORD (DEC-039) : sans quota, rien n'est écrit chez l'agent,
       la carte ne bouge pas, et la veille reprendra la demande. */
    const compte = await pickAccount(agent.run.engine).catch(() => null);
    if (!compte) {
      poserLeRattrapage(runId, cardId, { ...base, etat: 'attente-quota', detail: 'aucun compte n’a de quota pour le moment' });
      return { ok: false, error: 'Aucun compte n’a de quota pour le moment : la réconciliation repartira seule.', etat: 'attente-quota' };
    }

    /* Une publication d'avant le détail structuré ne dit pas sa branche
       d'accueil : on la redemande au projet, comme la publication l'a fait. */
    const projet = store.getProject(card.projectId);
    const brancheDAccueil =
      tache.ecart?.brancheDAccueil ??
      (projet ? (await (await import('./deploy.js')).brancheDeLEtape(projet, 'dev').catch(() => null))?.branche : undefined) ??
      'dev';
    const texte = demandeDeReconciliation({
      branche: tache.branche ?? card.github?.branch ?? '',
      brancheDAccueil,
      ecart: tache.ecart,
      raison: tache.detail,
    });
    const lance = poserLeRattrapage(runId, cardId, { ...base, etat: 'lance' });
    const apresDepart = lance?.taches?.find((t) => t.cardId === cardId)?.rattrapage;
    journaliser(
      card,
      JALON_RATTRAPAGE_APRES_ECARTEMENT,
      par === 'humain'
        ? 'Réconciliation demandée depuis le volet de publication : l’agent reprend sa branche.'
        : 'Réconciliation lancée seule après la publication : l’agent reprend sa branche.',
      true,
    );
    log.info(`rattrapage après écartement : « ${card.title} » (${par})`);

    void sendPrompt(agent.id, texte, {
      silent: true,
      demandeur: 'humain',
      ampleur: 'complete',
      onComplete: (_text, ok) => {
        const apres = store.getCard(cardId);
        const issue = issueDuRattrapage(apres?.column, ok);
        poserLeRattrapage(runId, cardId, { ...(apresDepart ?? base), etat: issue.etat, at: Date.now(), ...(issue.detail ? { detail: issue.detail } : {}) });
      },
    }).catch((err) => {
      log.warn(`rattrapage de « ${card.title} » tombé au départ`, err);
      poserLeRattrapage(runId, cardId, { ...base, etat: 'echec', detail: 'le tour n’a pas pu partir' });
    });
    return { ok: true, etat: 'lance' };
  } catch (err) {
    log.warn('rattrapage après écartement impossible', err);
    return { ok: false, error: 'La réconciliation n’a pas pu partir.' };
  } finally {
    enDepart.delete(cle);
  }
}

/**
 * REPREND LES RATTRAPAGES EN ATTENTE : au démarrage, en fin de publication
 * sans redémarrage, et à chaque passage de la veille. Rien ne part pendant
 * qu'une publication du projet tourne ni tant qu'un redémarrage attend.
 */
export async function reprendreLesRattrapages(maintenant = Date.now()): Promise<number> {
  let lances = 0;
  try {
    const contexte = { maintenant, demonDemarreA: DEMON_DEMARRE_A, redemarrageEnAttente: redemarrageEstEnAttente() };
    if (contexte.redemarrageEnAttente) return 0;
    const occupes = new Set(store.runningDeploys().map((r) => r.projectId));
    for (const run of store.deploysAvecRattrapageEnAttente(maintenant - RATTRAPAGE_PERIME_MS)) {
      if (occupes.has(run.projectId)) continue;
      for (const tache of tachesARattraper(run.taches, contexte)) {
        const issue = await reconcilierLaCarte(run.id, tache.cardId, 'automatique');
        if (issue.ok) lances += 1;
      }
    }
  } catch (err) {
    log.warn('reprise des rattrapages après écartement incomplète', err);
  }
  return lances;
}
