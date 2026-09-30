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
  MAX_DEPANNAGES_AUTOMATIQUES,
  depannageAutomatiqueAPoser,
  depannageAutomatiqueEpuise,
  depanneurVivant,
  moteurDuTriAutomatique,
  publicationADepanner,
  reglagesDuNiveau,
  titreDuDepanneur,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { createAgent, sendPrompt } from './runtime.js';
import { STEP_LABELS, brancheDeLEtape, dernieresLignes, retryDeploy } from './deploy.js';

/** Combien de temps la relance attend la fin du tour de l'agent. */
const ATTENTE_MAX_RELANCE_MS = 30 * 60 * 1000;
const PAS_DE_RELANCE_MS = 3000;

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
  const retenu = run.depannage ? store.getAgent(run.depannage.agentId) : null;
  if (retenu && depanneurVivant(retenu)) return { agentId: retenu.id, deja: true };

  let agentId: string;
  if (retenu) {
    agentId = retenu.id;
  } else {
    const moteur = moteurDuTriAutomatique('programmation_avancee', catalogue as any).engine;
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
  enregistrer({ ...run, depannage: { agentId, at: Date.now(), ...(options.automatique ? { automatique: true } : {}) } });

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
  return { agentId, deja: false };
}

/**
 * À LA CHUTE D'UNE PUBLICATION : le dépanneur part seul, si la règle le veut.
 *
 * Appelée par `startDeploy` APRÈS avoir libéré le projet (jamais dedans : le
 * `finally` relance la file et le redémarrage en attente). Ne lève jamais : une
 * publication qui tombe ne doit pas tomber une seconde fois par ici. Quand la
 * chaîne a épuisé son plafond, ou qu'aucun moteur n'a de place, la raison se DIT
 * (toast) au lieu d'un silence — le bouton « Résoudre le problème » reste offert.
 */
export async function depannerSeulApresLaChute(
  runId: string,
  outils: { envoyer?: typeof sendPrompt; catalogue?: () => Promise<unknown[]> } = {},
): Promise<'lance' | 'epuise' | 'sans-moteur' | 'non'> {
  try {
    const run = store.getDeploy(runId);
    const derniere = store.latestDeploy(run?.projectId ?? '');
    if (!depannageAutomatiqueAPoser(run, derniere)) {
      if (run && !run.depannage && publicationADepanner(run, derniere) && depannageAutomatiqueEpuise(run)) {
        const projet = store.getProject(run.projectId);
        bus.toast(
          'info',
          `Dépannage automatique épuisé (${MAX_DEPANNAGES_AUTOMATIQUES} essais)${projet ? ` sur « ${projet.name} »` : ''} : à vous de jouer, « Résoudre le problème » reste disponible.`,
        );
        return 'epuise';
      }
      return 'non';
    }
    await depannerLaPublication(runId, outils, { automatique: true });
    return 'lance';
  } catch (err: any) {
    const raison = err?.message ?? String(err);
    log.warn(`publication ${runId} : dépannage automatique non lancé — ${raison}`);
    bus.toast('info', `Dépannage automatique non lancé : ${raison}. « Résoudre le problème » reste disponible.`);
    return 'sans-moteur';
  }
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
  void relancerApresLeTour(agentId, run.id);
  return {
    ok: true,
    texte: 'Relance notée : la même publication repartira, à la même étape, dès la fin de ton tour. Termine maintenant ta réponse.',
  };
}

/** Attend que l'agent ait rendu la main, puis relance — et dit ce qu'il en est. */
async function relancerApresLeTour(agentId: string, runId: string): Promise<void> {
  const limite = Date.now() + ATTENTE_MAX_RELANCE_MS;
  while (Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, PAS_DE_RELANCE_MS));
    const agent = store.getAgent(agentId);
    if (!agent) return;
    if (agent.status === 'running' || agent.status === 'starting' || agent.tourVivantDepuis !== undefined) continue;
    break;
  }
  const run = store.getDeploy(runId);
  if (!run?.depannage?.relanceDemandee) return;
  const issue = await retryDeploy(runId, { enChaine: true }).catch((err) => ({ ok: false, error: err?.message ?? String(err) }));
  if (issue.ok) {
    direDansLeFil(agentId, 'La publication est relancée. Son avancement se suit dans le volet de publication.');
    return;
  }
  // Relance refusée : le bouton se rallume (plus de relance en attente), et la raison se dit.
  const actuel = store.getDeploy(runId);
  if (actuel?.depannage) enregistrer({ ...actuel, depannage: { ...actuel.depannage, relanceDemandee: undefined } });
  const raison = issue.error ?? 'raison inconnue';
  direDansLeFil(agentId, `La relance de la publication a été refusée : ${raison}`);
  bus.toast('error', `Relance après dépannage refusée : ${raison}`);
}
