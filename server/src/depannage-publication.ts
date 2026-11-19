/**
 * « RÉSOUDRE LE PROBLÈME » — L'AGENT QUI DÉPANNE UNE PUBLICATION TOMBÉE.
 *
 * Le bouton du volet de publication (déploiement comme mise en production)
 * appelle `deploy.depanner`. Ce module :
 *
 *   1. ouvre UN agent de dépannage pour la publication — ou rend celui qui y
 *      travaille déjà (deux clics, deux appareils : jamais deux agents). Le
 *      contrôle et l'écriture du lien se font d'un seul tenant, sans `await`
 *      entre les deux : le démon est mono-fil, rien ne peut s'intercaler ;
 *   2. écrit le lien sur la publication (`run.depannage`) ET sur l'agent
 *      (`agent.depannagePublication`) : le bouton le retrouve après un
 *      redémarrage, et « Tableaux de bord » lui donne sa vignette ;
 *   3. relance la publication quand l'agent le demande (`relancer_publication`),
 *      mais seulement À LA FIN DE SON TOUR : tant qu'un agent travaille dans le
 *      dossier, une publication est refusée (`agentsOccupes`) — lui compris.
 *
 * Règles pures et texte de la demande : `shared/src/depannage-publication.ts`.
 */
import {
  DeployRun,
  Message,
  demandeDeDepannage,
  agentRetientLaPublication,
  depanneurVivant,
  moteurDuTriAutomatique,
  publicationADepanner,
  reglagesDuNiveau,
  repriseApresLeTour,
  titreDuDepanneur,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { arreterLAgent, createAgent, sendPrompt } from './runtime.js';
import { viderLaFileEnRendant } from './file-rendue.js';
import { STEP_LABELS, brancheDeLEtape, dernieresLignes, reprendreLaPublication } from './deploy.js';

/** Combien de temps la veille d'un dépanneur attend la fin de son travail (question comprise). */
const ATTENTE_MAX_RELANCE_MS = 2 * 60 * 60 * 1000;
const PAS_DE_RELANCE_MS = 3000;
/** Le temps laissé à un tour pour démarrer avant de juger qu'il n'est jamais parti. */
const DEPART_DU_TOUR_MS = 90_000;

function enregistrer(run: DeployRun): DeployRun {
  const saved = store.saveDeploy(run);
  bus.emit({ type: 'deploy.upsert', run: saved });
  return saved;
}

/** Une ligne du démon dans la conversation de l'agent : ce qui est arrivé à sa relance. */
function direDansLeFil(agentId: string, texte: string): void {
  const message = store.saveMessage(
    Message.parse({ id: store.newId(), agentId, role: 'assistant', content: texte, createdAt: store.now() }),
  );
  bus.emit({ type: 'message.upsert', message });
}

/**
 * OUVRIR (OU RETROUVER) L'AGENT DE DÉPANNAGE D'UNE PUBLICATION.
 *
 * - agent déjà au travail → rendu tel quel, rien n'est relancé ;
 * - agent qui a fini sur CETTE publication → la même conversation repart
 *   avec la demande, pour ne pas perdre ce qu'il a déjà essayé ;
 * - sinon → un agent neuf, sur un moteur qui a du quota (Claude, puis Codex ;
 *   jamais Cursor par bascule, DEC-156).
 */
export async function depannerLaPublication(
  runId: string,
  /* Les tests remplacent le moteur et le catalogue : aucun vrai tour ne part. */
  outils: { envoyer?: typeof sendPrompt; catalogue?: () => Promise<unknown[]> } = {},
  /* `automatique` : ouvert par le démon à la chute de la publication, pas par le bouton. */
  options: { automatique?: boolean } = {},
): Promise<{ agentId: string; deja: boolean }> {
  const envoyer = outils.envoyer ?? sendPrompt;
  const lireCatalogue = outils.catalogue ?? catalogueMoteurs;
  const depart = store.getDeploy(runId);
  if (!depart) throw new Error('publication introuvable');
  const projet = store.getProject(depart.projectId);
  if (!projet) throw new Error('projet introuvable');

  // Ce qui demande d'attendre se fait AVANT le contrôle : ensuite, plus aucun `await`
  // jusqu'à ce que le lien soit écrit.
  const [catalogue, branche] = await Promise.all([
    lireCatalogue().catch(() => []),
    brancheDeLEtape(projet, depart.cible ?? 'dev')
      .then((b) => b.branche)
      .catch(() => undefined),
  ]);

  const run = store.getDeploy(runId);
  if (!run) throw new Error('publication introuvable');
  if (!publicationADepanner(run, store.latestDeploy(run.projectId))) {
    throw new Error(
      run.state === 'running'
        ? 'La publication est en cours : il n’y a rien à dépanner pour l’instant.'
        : 'Seule la dernière publication tombée du projet se dépanne.',
    );
  }
  const retenu = run.depannage?.agentId ? store.getAgent(run.depannage.agentId) : null;
  if (retenu && depanneurVivant(retenu)) {
    veillerSurLeDepanneur(retenu.id, run.id);
    return { agentId: retenu.id, deja: true };
  }

  let agentId: string;
  if (retenu) {
    agentId = retenu.id;
  } else {
    const moteur = moteurDuTriAutomatique('programmation_avancee', catalogue as any, store.getSettings().ordreDesMoteurs).engine;
    const entree = (catalogue as any[]).find((m) => m.id === moteur);
    // Sans clic, on ne lance pas dans le vide : aucun compte disponible → on le DIT.
    if (options.automatique && !(entree?.installed && entree.comptesDisponibles > 0)) {
      throw new Error('aucun moteur n’a de compte disponible pour dépanner');
    }
    const reglages = entree ? reglagesDuNiveau(entree, 'standard') : { model: undefined, thinking: 'none' };
    const cree = createAgent({
      projectId: run.projectId,
      role: 'deploy',
      title: titreDuDepanneur(run.cible),
      run: { engine: moteur, model: reglages.model, thinking: reglages.thinking as any },
    });
    const marque = store.saveAgent({ ...cree, depannagePublication: { runId: run.id, cible: run.cible ?? 'dev' } });
    bus.emit({ type: 'agent.upsert', agent: marque });
    agentId = marque.id;
  }
  /* Un clic remet le compte des dépannages automatiques à zéro (17/11/2026) : deux nouveaux cycles redeviennent possibles. */
  enregistrer({
    ...run,
    ...(options.automatique ? {} : { depannagesAuto: 0 }),
    depannage: { agentId, at: Date.now(), ...(options.automatique ? { automatique: true } : {}) },
  });

  const tombee = run.steps.find((step) => step.state === 'failed');
  const demande = demandeDeDepannage({
    projet: projet.name,
    dossier: projet.path,
    cible: run.cible,
    etape: tombee ? STEP_LABELS[tombee.key] : undefined,
    erreur: run.error,
    journal: tombee?.log ? dernieresLignes(tombee.log, 3000) : undefined,
    branche,
    origine: options.automatique ? 'automatique' : 'manuel',
  });
  void envoyer(agentId, demande, { template: 'none', silent: true, motif: 'depannage-manuel' }).catch((err) => {
    log.error('dépannage de publication : le tour n’a pas pu partir', err);
    direDansLeFil(agentId, `Le dépannage n’a pas pu démarrer : ${err?.message ?? err}`);
  });
  log.info(`publication ${run.id} : agent de dépannage ${agentId}${retenu ? ' relancé' : ' ouvert'}`);
  veillerSurLeDepanneur(agentId, run.id);
  return { agentId, deja: false };
}

/** Les dépanneurs déjà veillés : une seule veille par agent. */
const veilles = new Set<string>();
/**
 * LES VEILLES COUPÉES PAR UN « RELANCER » : la relance reprend elle-même la publication ; la veille du dépanneur
 * arrêté ne doit pas la reprendre une seconde fois (deux `startDeploy` sur la même ligne).
 */
const veillesCoupees = new Set<string>();

/**
 * LA VEILLE D'UN DÉPANNEUR (17/11/2026 : « une fois le débogage terminé, il doit relancer l'étape ») : à la fin de son
 * tour, la MÊME publication reprend (`reprendreLaPublication`), sans attendre qu'il le demande. Rien ne repart tant
 * qu'il attend une réponse de l'utilisateur ; un tour resté en file faute de quota n'a rien réparé : la file est vidée
 * (sinon il repartirait plus tard sur une publication finie) et la ligne le dit.
 */
export function veillerSurLeDepanneur(agentId: string, runId: string, outils: { pas?: number; depart?: number } = {}): Promise<void> {
  if (veilles.has(agentId)) return Promise.resolve();
  veilles.add(agentId);
  const pas = outils.pas ?? PAS_DE_RELANCE_MS;
  const depart = outils.depart ?? DEPART_DU_TOUR_MS;
  const debut = Date.now();
  let vuAuTravail = false;
  const suivre = async (): Promise<void> => {
    while (Date.now() - debut < ATTENTE_MAX_RELANCE_MS) {
      // Une veille ne retient jamais le démon (ni un test) en vie : son minuteur est détaché.
      await new Promise((resolve) => setTimeout(resolve, pas).unref());
      if (veillesCoupees.has(agentId)) return;
      const run = store.getDeploy(runId);
      const agent = store.getAgent(agentId);
      const aDepanner = !!run && run.depannage?.agentId === agentId && publicationADepanner(run, store.latestDeploy(run.projectId));
      const enFile = store.listQueue(agentId).length > 0;
      const verdict = repriseApresLeTour({ agent, aDesDemandesEnFile: enFile, aDepanner });
      if (verdict === 'attendre') {
        if (agent && (agent.status === 'running' || agent.status === 'starting' || agent.tourVivantDepuis !== undefined)) vuAuTravail = true;
        continue;
      }
      if (verdict === 'abandonner') {
        if (aDepanner && enFile && run) {
          store.clearQueue(agentId);
          enregistrer({ ...run, depannage: { ...run.depannage!, refusAuto: { at: Date.now(), raison: 'aucun compte n’avait de quota pour dépanner' } } });
        }
        return;
      }
      // « reprendre » : seulement une fois le tour réellement passé (ou jamais parti après un délai raisonnable).
      if (!vuAuTravail && Date.now() - debut < depart) continue;
      const issue = await reprendreLaPublication(runId).catch((err) => ({ ok: false, error: err?.message ?? String(err) }));
      if (issue.ok) {
        direDansLeFil(agentId, 'La publication reprend à l’étape qui était tombée. Son avancement se suit dans la colonne de gauche et dans le menu « Publier ».');
      } else {
        const raison = issue.error ?? 'raison inconnue';
        direDansLeFil(agentId, `La reprise de la publication a été refusée : ${raison}`);
        bus.toast('error', `Reprise après dépannage refusée : ${raison}`);
      }
      return;
    }
  };
  return suivre()
    .catch((err) => log.warn(`veille du dépanneur ${agentId} : ${err?.message ?? err}`))
    .finally(() => {
      veilles.delete(agentId);
      veillesCoupees.delete(agentId);
      /* UNE VEILLE QUI S'ARRÊTE SANS AVOIR REPRIS NE LAISSE PAS LA LIGNE PROMETTRE UNE REPRISE : la publication, encore
         tombée, attend désormais le clic (19/11/2026, mise en production restée 39 min « elle reprendra d'elle-même »). */
      const run = store.getDeploy(runId);
      if (run && run.depannage?.agentId === agentId && !run.depannage.enAttenteDeVous && publicationADepanner(run, store.latestDeploy(run.projectId))) {
        enregistrer({ ...run, depannage: { ...run.depannage, enAttenteDeVous: true } });
      }
    });
}

/**
 * L'OUTIL `relancer_publication` : la relance est NOTÉE sur la publication,
 * puis part dès que le tour de l'agent est fini. Réservé à l'agent de
 * dépannage de CETTE publication, et à une publication toujours tombée — rien
 * d'autre ne peut repartir par ce chemin.
 */
export function demanderLaRelance(agentId: string): { ok: boolean; texte: string } {
  const agent = store.getAgent(agentId);
  const lien = agent?.depannagePublication;
  if (!agent || !lien) {
    return { ok: false, texte: 'Cet outil est réservé à l’agent ouvert par « Résoudre le problème » sur une publication tombée.' };
  }
  const run = store.getDeploy(lien.runId);
  if (!run || run.depannage?.agentId !== agentId) return { ok: false, texte: 'La publication que tu dépannes est introuvable.' };
  if (!publicationADepanner(run, store.latestDeploy(run.projectId))) {
    return { ok: false, texte: 'Cette publication n’est plus à relancer : une autre est partie depuis, ou elle est en cours.' };
  }
  if (run.depannage.relanceDemandee) {
    return { ok: true, texte: 'La relance est déjà demandée : elle partira à la fin de ton tour.' };
  }
  enregistrer({ ...run, depannage: { ...run.depannage, relanceDemandee: Date.now() } });
  // La veille du dépanneur reprend la publication à la fin de ce tour (elle tourne déjà ; sinon elle repart).
  void veillerSurLeDepanneur(agentId, run.id);
  return {
    ok: true,
    texte: 'Relance notée : la même publication repartira, à la même étape, dès la fin de ton tour. Termine maintenant ta réponse.',
  };
}


/** Combien de temps « Relancer » attend que le dépanneur arrêté ait lâché le dossier du projet. */
const ATTENTE_ARRET_DU_DEPANNEUR_MS = 20_000;

/**
 * « RELANCER » UNE PUBLICATION BLOQUÉE (19/11/2026, capture #9fdac : dépannage ouvert, plus aucun moyen de relancer).
 * Toujours possible sur la dernière publication tombée du projet :
 *
 *   1. la veille du dépanneur est coupée — c'est cette relance qui reprend, jamais les deux ;
 *   2. un dépanneur au travail est arrêté comme par le bouton « Arrêter » (file vidée AVANT de couper), et on attend
 *      qu'il ne retienne plus le dossier : sinon `startDeploy` refuserait (« un agent travaille encore ») ;
 *   3. la MÊME publication reprend (`reprendreLaPublication`), à l'étape tombée.
 *
 * Le clic de l'utilisateur est le geste de publier : rien ne repart sans lui.
 */
export async function relancerLaPublicationBloquee(
  runId: string,
  outils: { attente?: number; pas?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const run = store.getDeploy(runId);
  if (!run) return { ok: false, error: 'publication introuvable' };
  if (!publicationADepanner(run, store.latestDeploy(run.projectId))) {
    return {
      ok: false,
      error: run.state === 'running' ? 'La publication est déjà repartie.' : 'Seule la dernière publication tombée du projet se relance.',
    };
  }
  const agentId = run.depannage?.agentId;
  if (agentId) {
    veillesCoupees.add(agentId);
    const agent = store.getAgent(agentId);
    if (agent && depanneurVivant(agent)) {
      viderLaFileEnRendant(agentId, 'Publication relancée à la main : le dépannage s’arrête.');
      arreterLAgent(agentId);
      const limite = Date.now() + (outils.attente ?? ATTENTE_ARRET_DU_DEPANNEUR_MS);
      while (Date.now() < limite) {
        const frais = store.getAgent(agentId);
        if (!frais || !agentRetientLaPublication(frais)) break;
        await new Promise((resolve) => setTimeout(resolve, outils.pas ?? 250).unref());
      }
    }
    /* La veille, si elle tourne, voit la marque et s'efface ; sinon la marque ne doit pas survivre à cette relance. */
    if (!veilles.has(agentId)) veillesCoupees.delete(agentId);
  }
  const issue = await reprendreLaPublication(runId).catch((err) => ({ ok: false, error: err?.message ?? String(err) }));
  if (issue.ok) {
    log.info(`publication ${runId} relancée à la main${agentId ? ` (dépanneur ${agentId} arrêté)` : ''}`);
    if (agentId) direDansLeFil(agentId, 'Publication relancée à la main : elle reprend à l’étape qui était tombée.');
  }
  return issue;
}

/**
 * LES VEILLES DE DÉPANNAGE SURVIVENT AU REDÉMARRAGE DU DÉMON (19/11/2026). Elles vivaient en mémoire seulement : une
 * mise en ligne de Beluga pendant un dépannage les effaçait, et la publication restait rouge pour toujours sous la
 * phrase « elle reprendra d'elle-même ». Au démarrage, la dernière publication tombée de chaque projet qui a un
 * dépanneur retrouve sa veille si le dépannage est récent ; plus ancien, elle attend le clic (`enAttenteDeVous`).
 */
export function reprendreLesVeillesDeDepannage(maintenant = Date.now()): number {
  let reprises = 0;
  for (const projet of store.listProjects(true)) {
    const run = store.latestDeploy(projet.id);
    const lien = run?.depannage;
    if (!run || !lien?.agentId || lien.enAttenteDeVous || !publicationADepanner(run, run)) continue;
    if (maintenant - (lien.at ?? 0) < ATTENTE_MAX_RELANCE_MS) {
      void veillerSurLeDepanneur(lien.agentId, run.id);
      reprises += 1;
    } else {
      enregistrer({ ...run, depannage: { ...lien, enAttenteDeVous: true } });
    }
  }
  return reprises;
}
