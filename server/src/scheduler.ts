import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Agent,
  Card,
  Estimate,
  OccupantDossier,
  RAISON_SANS_DEPOT,
  cheminDossierDeCarte,
  nomDeBranche,
  phraseDepuisReponse,
  porteDuDepot,
  porteDuDossier,
} from '@haikodev/shared';
import { menageDesDossiers, ouvrirDossierDeCarte } from './dossier-de-carte.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { createAgent, isRunning, sendPrompt, runningCount, runningAgentIds } from './runtime.js';
import { canStartAgent, snapshot } from './capacity.js';
import { refreshQuotas } from './accounts.js';
import { notify } from './notify.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Analyse profonde (PLAN §6 étape 3)                                  */
/* ------------------------------------------------------------------ */

const analysing = new Set<string>();

export async function analyseCard(cardId: string): Promise<void> {
  const card = store.getCard(cardId);
  if (!card || analysing.has(cardId)) return;
  analysing.add(cardId);

  const project = store.getProject(card.projectId);
  if (!project) {
    analysing.delete(cardId);
    return;
  }

  // Les écarts passés du projet affinent les chiffrages (PLAN §24).
  const feedback = pastGaps(card.projectId);

  /*
   * UNE SEULE SESSION PAR CARTE. Le chiffrage et l'exécution partagent le même
   * agent, donc le même fil de moteur : le contexte lourd (briefing, CLAUDE.md,
   * index de la mémoire) n'est lu qu'UNE fois. Pour que le fil se REPRENNE au
   * lancement, les deux tours doivent tourner dans le MÊME dossier — la session
   * de Claude est rangée par dossier — : on ouvre donc la copie de travail de la
   * carte dès le chiffrage. Un projet sans dépôt git n'en a pas : le chiffrage
   * retombe alors sur le dossier du projet, et l'exécution sera de toute façon
   * refusée par les portes dures.
   */
  const prepa = await prepareBranch(project.path, card).catch(() => null);
  const workdir = prepa && prepa.kind === 'prete' ? prepa.dossier : undefined;

  const agent = createAgent({
    projectId: card.projectId,
    role: 'analysis',
    title: `Analyse — ${card.title}`,
    cardId: card.id,
    // MÊME moteur et MÊME modèle que l'exécution : c'est la condition pour que le
    // fil se reprenne (Codex refuse un fil ouvert avec un autre modèle). Seul le
    // niveau de réflexion est abaissé, le chiffrage étant plus léger — il peut
    // varier d'un tour à l'autre sans casser la reprise.
    run: { engine: card.run.engine, model: card.run.model, thinking: 'low' },
    workdir,
  });

  const prompt = `Analyse cette tâche AVANT exécution et chiffre-la. C'est un tour de CHIFFRAGE, pas d'exécution : lis ce qu'il faut dans le projet pour comprendre l'ampleur du travail, mais ne modifie AUCUN fichier, n'enregistre rien, ne pousse rien, n'appelle pas « remember ». Tu feras le travail au tour suivant, quand l'utilisateur lancera la carte — dans ce même fil.

TÂCHE : ${card.title}
${card.description || '(pas de description)'}${
    feedback ? `\n\nÉCARTS CONSTATÉS SUR LES TÂCHES PRÉCÉDENTES DE CE PROJET (pour affiner) :\n${feedback}` : ''
  }`;

  try {
    await sendPrompt(agent.id, prompt, {
      template: 'pre_run',
      silent: true,
      onComplete: async (text, ok) => {
        analysing.delete(cardId);
        const fresh = store.getCard(cardId);
        if (!fresh) return;

        const estimate = ok ? parseEstimate(text) : null;
        if (!estimate) {
          // Une analyse qui ne produit pas de chiffres le DIT sur la carte, au
          // lieu d'être maquillée avec une estimation par défaut (PLAN §9).
          const updated = store.saveCard({
            ...fresh,
            estimate: {
              failed: true,
              failureReason: ok ? "L'analyse n'a pas rendu de chiffres exploitables." : "L'analyse a échoué.",
              summary: text.slice(0, 2000),
              producedAt: Date.now(),
            },
          });
          bus.emit({ type: 'card.upsert', card: updated });
          bus.toast('warning', `Analyse sans chiffres : ${fresh.title}`, fresh.id);
          return;
        }

        // Promotion automatique en « Planifié » dès l'analyse réussie.
        const updated = store.saveCard({
          ...fresh,
          estimate: { ...estimate, summary: estimate.summary ?? text.slice(0, 2000), producedAt: Date.now() },
          column: fresh.column === 'validated' ? 'planned' : fresh.column,
          position: store.nextPosition(fresh.projectId, 'planned'),
          scheduling: { ...(fresh.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: undefined },
        });
        bus.emit({ type: 'card.upsert', card: updated });
        void tick();
      },
    });
  } catch (err) {
    analysing.delete(cardId);
    log.error("analyse impossible", err);
  }
}

/** Les chiffres se lisent UNE fois et se rangent (PLAN §30). */
export function parseEstimate(text: string): Estimate | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  // Le dernier bloc fait foi : une correction en fin de réponse remplace la
  // première estimation. On ne cherche du json « nu » que s'il n'y a aucun bloc.
  const candidates = [...blocks];
  if (!candidates.length) {
    const inline = text.match(/\{[^{}]*"machineSeconds"[\s\S]*?\}/);
    if (inline) candidates.push(inline[0]);
  }

  for (const candidate of candidates.reverse()) {
    try {
      const raw = JSON.parse(candidate.trim());
      const machineSeconds = num(raw.machineSeconds);
      const seniorHours = num(raw.seniorHours);
      if (machineSeconds === undefined && seniorHours === undefined) continue;
      return Estimate.parse({
        machineSeconds,
        tokens: num(raw.tokens),
        quotaShare: num(raw.quotaShare),
        confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium',
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        seniorHours,
        billingTitle: typeof raw.billingTitle === 'string' ? raw.billingTitle : undefined,
        billingDescription: typeof raw.billingDescription === 'string' ? raw.billingDescription : undefined,
        failed: false,
      });
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Mettre à jour le chiffrage d'une carte après un tour d'analyse DISCUTÉ.
 *
 * Quand on écrit à l'agent d'analyse d'une carte pour corriger une hypothèse ou
 * ajouter une précision, il rejoue son analyse (même gabarit « pre_run », car la
 * carte est en « Planifié ») et rend souvent un nouveau chiffrage. On le relit
 * pour que la carte reflète la version corrigée.
 *
 * Deux différences AVEC l'analyse d'origine, voulues :
 *   - on ne marque JAMAIS la carte en échec. Un tour qui ne rend pas de chiffres
 *     frais (l'agent a seulement répondu à une question) laisse le chiffrage
 *     précédent intact — discuter ne doit pas casser une estimation déjà bonne ;
 *   - on ne touche PAS à la colonne. L'analyse ne déplace jamais une carte : elle
 *     reste en « Planifié », le lancement reste un geste de l'utilisateur.
 */
export function appliquerChiffrageDiscute(cardId: string, text: string, ok: boolean): void {
  if (!ok) return;
  const estimate = parseEstimate(text);
  if (!estimate) return;
  const fresh = store.getCard(cardId);
  if (!fresh) return;
  const updated = store.saveCard({
    ...fresh,
    estimate: { ...estimate, summary: estimate.summary ?? text.slice(0, 2000), producedAt: Date.now() },
  });
  bus.emit({ type: 'card.upsert', card: updated });
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function pastGaps(projectId: string): string | null {
  const cards = store
    .listCards(projectId)
    .filter((c) => c.estimate?.machineSeconds && c.consumption?.machineSeconds)
    .slice(0, 5);
  if (!cards.length) return null;
  return cards
    .map(
      (c) =>
        `- « ${c.title} » : annoncé ${Math.round((c.estimate!.machineSeconds ?? 0) / 60)} min, réalisé ${Math.round(
          (c.consumption!.machineSeconds ?? 0) / 60,
        )} min`,
    )
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Les trois portes (PLAN §6 étape 5)                                  */
/* ------------------------------------------------------------------ */

function isOffPeak(): boolean {
  const settings = store.getSettings();
  const hour = new Date().getHours();
  const { offPeakStart: start, offPeakEnd: end } = settings;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface Gate {
  ok: boolean;
  reason?: string;
}

/**
 * Les portes DURES : celles qu'aucun geste ne force, parce que les franchir
 * ferait échouer le tour pour de bon — plus de place sur la machine, plus un
 * seul compte disponible pour ce moteur. Elles valent pour TOUS les chemins de
 * lancement : l'ordonnanceur, le bouton « Lancer maintenant », le dépôt d'une
 * carte dans « En cours ».
 *
 * L'heure creuse, elle, n'est pas une porte dure : c'est une politique
 * d'économie, et l'utilisateur a le droit de passer devant.
 *
 * Deux portes tiennent à la BRANCHE, et elles sont dures pour la même raison :
 * une carte qui part sans branche à elle ne laisse aucune trace vérifiable.
 * Un projet qui n'est pas un dépôt git ne peut pas en avoir ; un dossier déjà
 * occupé par un autre agent ne peut pas en porter deux.
 */
export async function portesDures(card: Card): Promise<Gate> {
  const capacity = canStartAgent();
  if (!capacity.ok) return { ok: false, reason: capacity.reason };

  const project = store.getProject(card.projectId);
  if (project) {
    // Le dossier VISÉ par cette carte est le sien, pas celui du projet : deux
    // cartes différentes ne se gênent donc plus.
    const vise = cheminDossierDeCarte(project.path, card.title, card.id);
    const dossier = porteDuDossier({ cardId: card.id, dossier: vise }, occupantsDesDossiers(card.id));
    if (!dossier.ok) return { ok: false, reason: dossier.raison };

    const depot = porteDuDepot(await estUnDepotGit(project.path));
    if (!depot.ok) return { ok: false, reason: depot.raison };
  }

  const quotas = await refreshQuotas();
  const engineQuotas = quotas.filter((q) => q.engine === card.run.engine);
  if (engineQuotas.length && !engineQuotas.some((q) => q.available)) {
    const soonest = engineQuotas
      .map((q) => q.weekly?.resetsAt ?? q.session?.resetsAt)
      .filter((v): v is number => !!v)
      .sort((a, b) => a - b)[0];
    return {
      ok: false,
      reason: soonest
        ? `Quota épuisé — reprise à ${new Date(soonest).toLocaleString('fr-CH', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
        : 'Quota épuisé sur tous les comptes',
    };
  }

  return { ok: true };
}

/**
 * Toutes les portes de l'ORDONNANCEUR : les dures, plus l'heure creuse. C'est
 * la boucle automatique qui patiente ; un geste humain, lui, ne franchit que
 * les portes dures.
 */
export async function checkGates(card: Card): Promise<Gate> {
  const dures = await portesDures(card);
  if (!dures.ok) return dures;

  const settings = store.getSettings();
  const heavy = (card.estimate?.machineSeconds ?? 0) >= settings.heavyTaskSeconds;
  if (heavy && !card.scheduling?.asap && !isOffPeak()) {
    return {
      ok: false,
      reason: `Tâche lourde : elle attend les heures creuses (à partir de ${settings.offPeakStart} h). Bouton « Dès que possible » pour forcer.`,
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Démarrage réel                                                      */
/* ------------------------------------------------------------------ */

export function branchName(card: Card): string {
  return nomDeBranche(card.title, card.id);
}

/** Le dossier est-il un dépôt git ? La question se pose AVANT de lancer. */
export async function estUnDepotGit(projectPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: projectPath, timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Qui travaille en ce moment, et dans quel dossier. Seul un agent de rôle
 * « task » compte : c'est lui qui tient une copie de travail sur SA branche.
 *
 * Chaque carte ayant son propre dossier, l'occupant déclare le SIEN (`workdir`)
 * et non celui du projet : la porte ne retient plus que deux cartes visant
 * vraiment le même dossier — un agent d'avant ce changement, resté sur le
 * dossier du projet, en fait partie.
 */
export function occupantsDesDossiers(saufCardId?: string): OccupantDossier[] {
  const occupants: OccupantDossier[] = [];
  for (const agentId of runningAgentIds()) {
    const agent = store.getAgent(agentId);
    if (!agent || agent.role !== 'task' || !agent.cardId) continue;
    if (agent.cardId === saufCardId) continue;
    const project = store.getProject(agent.projectId);
    if (!project) continue;
    occupants.push({
      cardId: agent.cardId,
      titre: store.getCard(agent.cardId)?.title ?? agent.title,
      dossier: agent.workdir ?? project.path,
    });
  }
  return occupants;
}

/**
 * Le résultat de la préparation, DIT en toutes lettres. Il n'y a plus de
 * troisième cas « pas un dépôt git, l'agent travaille sur place » : c'est ce
 * silence-là qui laissait partir des agents sur « main », sans branche et sans
 * rien à prouver. Un projet sans dépôt est refusé plus tôt, par les portes dures.
 *
 * La carte reçoit désormais SA branche ET son dossier : le dossier du projet
 * n'est plus basculé d'une branche à l'autre, donc plusieurs cartes du même
 * projet peuvent travailler en même temps.
 */
export type Branche =
  | { kind: 'prete'; nom: string; dossier: string }
  | { kind: 'echec'; raison: string };

export async function prepareBranch(projectPath: string, card: Card): Promise<Branche> {
  if (!(await estUnDepotGit(projectPath))) return { kind: 'echec', raison: RAISON_SANS_DEPOT };
  const ouvert = await ouvrirDossierDeCarte(projectPath, card);
  if (ouvert.kind === 'echec') return ouvert;
  return { kind: 'prete', nom: ouvert.branche, dossier: ouvert.dossier };
}

/**
 * Un lancement refusé se VOIT : la raison s'écrit sur la carte, comme le fait
 * déjà l'ordonnanceur quand il patiente. Sans cela, un refus parti du bouton ou
 * d'un dépôt dans « En cours » ne laissait aucune trace.
 */
function refus(card: Card, raison: string): { ok: false; error: string } {
  const fresh = store.getCard(card.id) ?? card;
  if (fresh.scheduling?.waitingReason !== raison) {
    const updated = store.saveCard({
      ...fresh,
      scheduling: { ...(fresh.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: raison },
    });
    bus.emit({ type: 'card.upsert', card: updated });
  }
  return { ok: false, error: raison };
}

/**
 * Reprend-on l'agent d'analyse d'une carte pour son exécution, plutôt que d'en
 * créer un second ? OUI quand il existe un agent d'analyse pour la carte et qu'il
 * ne tourne pas : c'est lui qui a lu tout le contexte au chiffrage, on poursuit
 * son fil. NON s'il n'y en a pas, s'il tourne encore, ou si le dernier agent de
 * la carte est déjà un agent de tâche (carte relancée) — on repart neuf.
 */
export function reprendPourExecution(prealable: Agent | null, enCours: boolean): boolean {
  return !!prealable && prealable.role === 'analysis' && !enCours;
}

export async function startCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  if (card.agentId && isRunning(card.agentId)) return { ok: true };

  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  /*
   * Les portes dures d'abord, et pour TOUS les chemins de lancement. Sans
   * elles, un départ forcé sur une machine pleine ou un quota épuisé créait un
   * agent qui mourait aussitôt, en laissant la carte dans « En cours ».
   */
  const portes = await portesDures(card);
  if (!portes.ok) return refus(card, portes.reason ?? 'lancement impossible');

  /*
   * La branche est OBLIGATOIRE : sans elle, l'agent écrirait sur la branche
   * principale, ou sur celle d'un autre. Un échec ici REFUSE le lancement et
   * s'écrit sur la carte, au lieu de laisser partir un agent sur « main ».
   */
  const prepa = await prepareBranch(project.path, card);
  if (prepa.kind === 'echec') return refus(card, prepa.raison);
  const branch = prepa.nom;

  /*
   * UNE SEULE SESSION PAR CARTE. Le chiffrage a déjà ouvert un agent pour cette
   * carte et lu tout le contexte : on le REPREND pour l'exécution plutôt que d'en
   * créer un second. Le fil du moteur se poursuit — briefing, CLAUDE.md et index
   * de la mémoire ne sont pas relus. L'agent d'analyse devient agent de tâche
   * (c'est le rôle « task » qui déplace la carte et referme son dossier en fin de
   * tour) et reçoit les réglages RÉELS de la carte : moteur, modèle et réflexion
   * ont pu changer depuis le chiffrage. Si le modèle a changé, la reprise ouvre
   * d'elle-même un fil neuf (voir `cleDeSession`), ce qui est correct.
   *
   * Pas d'agent d'analyse réutilisable (chiffrage posé à la main, ou carte
   * relancée dont l'agent précédent était déjà un agent de tâche) : on repart sur
   * un agent neuf, comme avant.
   */
  const prealable = store.getLastAgentByCard(cardId);
  const reprend = prealable ? reprendPourExecution(prealable, isRunning(prealable.id)) : false;
  let agent: Agent;
  if (reprend && prealable) {
    agent = store.saveAgent({
      ...prealable,
      role: 'task',
      run: card.run,
      // La carte a son dossier : l'agent y vit tout son tour, et le démon le
      // referme à la fin (fusion dans la principale, puis `git worktree remove`).
      workdir: prepa.dossier,
      status: 'idle',
    });
    bus.emit({ type: 'agent.upsert', agent });
  } else {
    agent = createAgent({
      projectId: card.projectId,
      role: 'task',
      title: card.title,
      cardId: card.id,
      run: card.run,
      workdir: prepa.dossier,
    });
  }

  const running = store.saveCard({
    ...card,
    column: 'running',
    position: store.nextPosition(card.projectId, 'running'),
    agentId: agent.id,
    github: { ...(card.github ?? { checks: [], commits: [], activity: [] }), branch },
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      attempts: (card.scheduling?.attempts ?? 0) + 1,
      waitingReason: undefined,
      // Un départ efface la suspension : c'est le geste qu'elle attendait.
      suspendu: false,
    },
  });
  bus.emit({ type: 'card.upsert', card: running });

  const prompt = `Réalise cette tâche.

TITRE : ${card.title}
${card.description || '(pas de description)'}

Tu travailles sur la branche « ${branch} », dans le dossier « ${prepa.dossier} » — une copie de travail à toi seul, créée pour cette carte. Reste dedans : n'en change pas et ne change pas de branche. HaikoDev fusionne ta branche dans la principale et referme ce dossier dès que tu as rendu ; ne le fais pas toi-même.

Va au bout : lis ce qu'il faut, modifie, teste, puis enregistre et sauvegarde (commit + push). Ne publie pas.`;

  await sendPrompt(agent.id, prompt, {
    silent: true,
    // Une carte lancée est une vraie tâche : elle mérite le compte rendu entier.
    ampleur: 'complete',
    // Les images jointes au chef d'orchestre voyagent jusqu'ici : elles entrent
    // dans le bloc « PIÈCES JOINTES » du prompt, comme pour un message direct.
    attachments: card.attachments,
    onComplete: async (text, ok) => {
      const fresh = store.getCard(cardId);
      if (!fresh) return;
      if (ok) {
        /*
         * Le passage en « Terminé » est déjà fait : la carte suit l'état de son
         * agent (`colonneEnFinDeTour`). On ne prévient que si elle y est
         * VRAIMENT arrivée : un tour qui répond sans rien modifier au dépôt
         * laisse la carte où elle est, il n'y a donc rien à annoncer.
         */
        if (fresh.column === 'done' || fresh.column === 'to_deploy' || fresh.column === 'in_production') {
          /*
           * La voix préfère un résumé du VRAI contenu de la réponse au seul
           * titre : on le tire du texte que l'agent vient d'écrire (aucune
           * génération payante). Null quand rien de propre ne s'en dégage —
           * la voix retombe alors sur la phrase par titre.
           */
          const voix =
            phraseDepuisReponse(text, {
              nom: store.getSettings().voixNom,
              heure: new Date().getHours(),
            }) ?? undefined;
          notify({
            motif: 'tache-terminee',
            title: 'Tâche terminée',
            body: fresh.title,
            reference: fresh.id,
            element: fresh.title,
            voix,
            cardId: fresh.id,
            projectId: fresh.projectId,
          });
        }
        bus.toast('success', `Agent terminé : ${fresh.title}`, fresh.id);
      } else {
        bus.toast('error', `Agent en échec : ${fresh.title}`, fresh.id);
      }
    },
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La boucle                                                           */
/* ------------------------------------------------------------------ */

let ticking = false;

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const project of store.listProjects()) {
      // Analyse : les cartes fraîchement validées.
      for (const card of store.listCardsInColumn(project.id, 'validated')) {
        if (!card.estimate && !analysing.has(card.id)) {
          void analyseCard(card.id);
        }
      }

      // Démarrage : les cartes planifiées, dans l'ordre d'ancienneté.
      const planned = store
        .listCardsInColumn(project.id, 'planned')
        .sort((a, b) => (b.scheduling?.asap ? 1 : 0) - (a.scheduling?.asap ? 1 : 0) || a.createdAt - b.createdAt);

      for (const card of planned) {
        if (card.agentId && isRunning(card.agentId)) continue;
        // Suspendue à la main : elle reste en file, mais elle attend un geste.
        if (card.scheduling?.suspendu) continue;
        const gate = await checkGates(card);
        if (!gate.ok) {
          if (card.scheduling?.waitingReason !== gate.reason) {
            const updated = store.saveCard({
              ...card,
              scheduling: { ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: gate.reason },
            });
            bus.emit({ type: 'card.upsert', card: updated });
          }
          continue;
        }
        await startCard(card.id);
        // Les démarrages sont ÉCHELONNÉS : jamais quinze dans la même seconde.
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } catch (err) {
    log.error('boucle d\'ordonnancement', err);
  } finally {
    ticking = false;
  }
}

/**
 * Au démarrage du démon, plus personne ne travaille : les copies de travail de
 * cartes encore ouvertes sont des restes d'un tour tué net. On les referme comme
 * en fin de tour — le travail enregistré rejoint la principale, une copie où
 * traîne du travail non enregistré est laissée telle quelle.
 */
async function menageDesDossiersDeCarte(): Promise<void> {
  const occupes = occupantsDesDossiers().map((o) => o.dossier);
  for (const project of store.listProjects()) {
    if (!(await estUnDepotGit(project.path))) continue;
    await menageDesDossiers(project.path, occupes).catch((err) =>
      log.warn('ménage des dossiers de cartes impossible', String(err).slice(0, 200)),
    );
  }
}

export function startScheduler(): NodeJS.Timeout {
  log.info(`ordonnanceur démarré (plafond ${store.getSettings().maxAgents} agents, ${runningCount()} en cours)`);
  void menageDesDossiersDeCarte();
  return setInterval(() => {
    void tick();
  }, 15000);
}
