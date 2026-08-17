import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Agent,
  Card,
  EtapeDeReprise,
  Estimate,
  TurnMeasurement,
  OccupantDossier,
  RAISON_SANS_DEPOT,
  RAISON_TRAVAIL_SAUVE,
  cheminDossierDeCarte,
  consigneDeReprise,
  origineDeReprise,
  demarrageAutomatiqueAutorise,
  estLaBrancheDeLaCarte,
  etatDuDepart,
  raisonDattente,
  nomDeBranche,
  phraseDepuisReponse,
  porteDuDepot,
  porteDuDossier,
  avecMesureAnalyse,
  contexteHeritePourExecution,
  PERIODE_VEILLE_MS,
  decisionDeBoucle,
  travailAbandonne,
} from '@haikodev/shared';
import { menageDesDossiers, ouvrirDossierDeCarte, travailDejaSurLaBranche } from './dossier-de-carte.js';
import * as store from './store.js';
import { bus } from './bus.js';
import {
  createAgent,
  isRunning,
  sendPrompt,
  runningCount,
  runningAgentIds,
  veilleDesToursBloques,
} from './runtime.js';
import { rangerLesCartesOubliees } from './deplacement-carte.js';
import { canStartAgent, snapshot } from './capacity.js';
import { refreshQuotas } from './accounts.js';
import { notify } from './notify.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Le chiffrage : rendu par l'agent d'exécution, AU LANCEMENT           */
/* ------------------------------------------------------------------ */

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
      const projection = raw.projection && typeof raw.projection === 'object' ? raw.projection : raw;
      const machineSeconds = num(raw.machineSeconds);
      const seniorHours = num(raw.seniorHours);
      if (machineSeconds === undefined && seniorHours === undefined) continue;
      return Estimate.parse({
        machineSeconds,
        // Ces valeurs décrivent le FUTUR. Elles restent recopiées à plat pour
        // les anciennes vues, mais vivent désormais avec leur formule.
        tokens: num(projection.tokens),
        quotaShare: num(projection.quotaShare),
        projection: {
          tokens: num(projection.tokens),
          quotaShare: num(projection.quotaShare),
          formula: typeof projection.formula === 'string' ? projection.formula : undefined,
          assumptions: Array.isArray(projection.assumptions)
            ? projection.assumptions.filter((item: unknown): item is string => typeof item === 'string')
            : [],
        },
        confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium',
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        seniorHours,
        billingTitle: typeof raw.billingTitle === 'string' ? raw.billingTitle : undefined,
        billingDescription: typeof raw.billingDescription === 'string' ? raw.billingDescription : undefined,
        clientExplanation: typeof raw.clientExplanation === 'string' ? raw.clientExplanation : undefined,
        failed: false,
      });
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Mettre à jour le chiffrage d'une carte après un tour DISCUTÉ.
 *
 * Le chiffrage vit désormais dans le tour de lancement, avec l'exécution. Quand
 * on écrit à l'agent d'une carte pour corriger une hypothèse ou demander de
 * revoir l'estimation, son tour rend souvent des chiffres frais : on les relit
 * pour que la carte reflète la version corrigée.
 *
 * Deux garde-fous, voulus :
 *   - on ne marque JAMAIS la carte en échec. Un tour qui ne rend pas de chiffres
 *     frais (l'agent a seulement répondu à une question) laisse le chiffrage
 *     précédent intact — discuter ne doit pas casser une estimation déjà bonne ;
 *   - on ne touche PAS à la colonne : c'est le suivi de colonne, et lui seul,
 *     qui déplace une carte.
 */
export function appliquerChiffrageDiscute(
  cardId: string,
  text: string,
  ok: boolean,
  measurement?: TurnMeasurement,
): void {
  if (!ok) return;
  const estimate = parseEstimate(text);
  if (!estimate) return;
  const fresh = store.getCard(cardId);
  if (!fresh) return;
  const updated = store.saveCard({
    ...fresh,
    estimate: {
      ...(measurement ? avecMesureAnalyse(estimate, measurement) : estimate),
      summary: estimate.summary ?? text.slice(0, 2000),
      producedAt: Date.now(),
    },
  });
  bus.emit({ type: 'card.upsert', card: updated });
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Les huit dernières cartes closes d'un projet dont on connaît À LA FOIS le
 * chiffrage annoncé et la mesure réelle, triées par la MESURE la plus récente
 * (pas par la position d'affichage, qui suit le glisser-déposer et non le
 * temps). Base commune à la consigne envoyée à l'agent et à l'affichage dans
 * les réglages du projet — un seul calcul, jamais deux formules qui pourraient
 * diverger.
 */
function dernieresCartesChiffrees(projectId: string): Card[] {
  return store
    .listCards(projectId)
    .filter((c) => c.estimate?.machineSeconds && c.consumption?.machineSeconds)
    .sort((a, b) => (b.consumption!.measuredAt ?? 0) - (a.consumption!.measuredAt ?? 0))
    .slice(0, 8);
}

/**
 * Le ratio réel/annoncé moyen, LU par les réglages du projet — visible sans
 * ouvrir de carte, sur la seule mesure de durée machine (aucune mesure
 * indépendante n'existe pour les heures de développeur senior).
 */
export function ecartChiffrage(projectId: string): { count: number; ratioMoyen: number } | null {
  const cards = dernieresCartesChiffrees(projectId);
  if (!cards.length) return null;
  const ratios = cards.map((c) => (c.consumption!.machineSeconds ?? 0) / (c.estimate!.machineSeconds || 1));
  return { count: cards.length, ratioMoyen: ratios.reduce((a, b) => a + b, 0) / ratios.length };
}

function pastGaps(projectId: string): string | null {
  const cards = dernieresCartesChiffrees(projectId);
  const ecart = ecartChiffrage(projectId);
  if (!cards.length || !ecart) return null;

  const pourcentage = Math.round(ecart.ratioMoyen * 100);

  const lignes = cards
    .map(
      (c) =>
        `- « ${c.title} » : annoncé ${Math.round((c.estimate!.machineSeconds ?? 0) / 60)} min, réalisé ${Math.round(
          (c.consumption!.machineSeconds ?? 0) / 60,
        )} min`,
    )
    .join('\n');

  return `${lignes}\n\nEn moyenne sur ces cartes, le réel ne représente que ${pourcentage} % de la durée annoncée : le chiffrage part systématiquement trop haut. Aucune mesure indépendante n'existe pour les heures de développeur senior, mais elles suivent le même excès — corrige machineSeconds ET seniorHours à la baisse dans cette proportion, plutôt que d'ajouter une marge de sécurité.`;
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
  /*
   * Une HEURE DITE passe cette porte, comme « Dès que possible ». Sans cela, une
   * tâche lourde programmée pour 14 h attendrait 22 h : la carte promet qu'elle
   * part à l'heure dite, on ne peut pas la reporter dans son dos. L'heure creuse
   * ne bouge pas pour autant — elle continue de retenir tout ce qui n'a reçu
   * aucune consigne explicite.
   */
  if (
    heavy &&
    !card.scheduling?.asap &&
    etatDuDepart(card.scheduling, Date.now()) !== 'venu' &&
    !isOffPeak()
  ) {
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
  | { kind: 'prete'; nom: string; dossier: string; base?: string }
  | { kind: 'echec'; raison: string };

export async function prepareBranch(projectPath: string, card: Card): Promise<Branche> {
  if (!(await estUnDepotGit(projectPath))) return { kind: 'echec', raison: RAISON_SANS_DEPOT };
  const ouvert = await ouvrirDossierDeCarte(projectPath, card);
  if (ouvert.kind === 'echec') return ouvert;
  return { kind: 'prete', nom: ouvert.branche, dossier: ouvert.dossier, base: ouvert.base };
}

/**
 * LES ÉTAPES DU TOUR COUPÉ, telles qu'elles étaient au moment de l'arrêt.
 *
 * Le moteur renvoie sa liste ENTIÈRE à chaque mise à jour : la dernière liste
 * écrite est donc l'état le plus frais. On remonte le fil jusqu'à elle — un tour
 * coupé très tôt n'en a pas toujours écrit — plutôt que de rendre un vide qui
 * ferait croire à un travail sans étapes.
 */
function etapesDeLaReprise(agentId: string): EtapeDeReprise[] {
  const dernier = [...store.listMessages(agentId)].reverse().find((message) => message.todos.length);
  if (!dernier) return [];
  return dernier.todos.map((todo) => ({ label: todo.label, etat: todo.state }));
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
 * VALIDER une carte : le geste qui autorise la dépense.
 *
 * Il n'y a plus de colonne à traverser, ni « Validé » ni « À faire » : la carte
 * NAÎT dans « Planifié » et n'en bouge pas. Et il n'y a plus d'analyse AVANT le
 * lancement : le geste marque seulement l'autorisation (`analyseDemandee`) et
 * écrit la raison d'attente. Rien ne part au moteur — une carte planifiée ne
 * coûte donc rien. Le chiffrage est rendu par l'agent d'exécution, au
 * lancement, dans le même tour que le travail (voir `startCard`), et une carte
 * qui porte déjà les chiffres du chef d'orchestre n'est jamais rechiffrée.
 *
 * La carte porte sa raison d'attente : l'ordonnanceur ne la démarre pas sans
 * geste de l'utilisateur (voir `demarrageAutomatiqueAutorise`).
 */
export function validerCarte(cardId: string): { ok: boolean; error?: string } {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  if (card.column !== 'planned') {
    return { ok: false, error: 'seule une carte de « Planifié » se valide.' };
  }

  const scheduling = card.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
  const updated = store.saveCard({
    ...card,
    // La trace du geste : c'est elle qui retire le bouton « Valider » d'une
    // carte déjà autorisée. Elle n'ouvre plus aucun tour de moteur.
    analyseDemandee: true,
    scheduling: {
      ...scheduling,
      // La raison ne s'affiche que si la carte attend VRAIMENT le geste : une
      // carte déjà autorisée (« Dès que possible », date de départ posée, déjà
      // lancée) partira sans qu'on lui demande rien.
      waitingReason: raisonDattente(scheduling),
    },
  });
  bus.emit({ type: 'card.upsert', card: updated });
  void tick();
  return { ok: true };
}

/**
 * LES CARTES DONT LE LANCEMENT EST DÉJÀ EN ROUTE, avec l'instant du départ.
 *
 * Entre l'appel de `startCard` et le moment où l'agent passe « au travail », il
 * s'écoule plusieurs secondes : portes à franchir, copie de travail à ouvrir,
 * branche à préparer. La garde de la ligne suivante (`isRunning`) ne voit rien
 * pendant cette fenêtre. Elle suffisait tant qu'un seul tour de boucle tournait
 * à la fois ; depuis qu'un tour trop long peut être déclaré perdu et la boucle
 * repartir, deux tours peuvent se croiser — et lanceraient deux fois la même
 * carte, donc deux agents sur la même branche.
 *
 * La marque est DATÉE, jamais éternelle : un lancement lui-même pendu ne doit
 * pas condamner sa carte pour toujours.
 */
const lancementsEnRoute = new Map<string, number>();

export async function startCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const engage = lancementsEnRoute.get(cardId);
  if (engage !== undefined && !travailAbandonne(Date.now() - engage)) {
    return { ok: true };
  }
  lancementsEnRoute.set(cardId, Date.now());
  try {
    return await lancerLaCarte(cardId);
  } finally {
    lancementsEnRoute.delete(cardId);
  }
}

async function lancerLaCarte(cardId: string): Promise<{ ok: boolean; error?: string }> {
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
   * REPRISE OU PREMIER DÉPART ? La question se pose AVANT de toucher à la carte :
   * le lancement efface la phrase d'attente qui dit d'où vient l'interruption.
   */
  const origine = origineDeReprise(card);
  const agentPrecedent = origine && card.agentId ? store.getAgent(card.agentId) : null;
  /*
   * UNE REPRISE REPART SUR LE MÊME AGENT — même fil du moteur, même dossier,
   * même branche, mêmes étapes. C'est ce qui évite de repayer le contexte et de
   * refaire ce qui était déjà fait ; un agent neuf ne saurait rien de tout cela.
   * L'agent d'un AUTRE projet ou d'un autre rôle n'est pas repris : on retombe
   * alors sur un départ ordinaire.
   */
  const repris =
    agentPrecedent && agentPrecedent.role === 'task' && agentPrecedent.projectId === card.projectId
      ? agentPrecedent
      : null;

  /*
   * UN SEUL AGENT PAR CARTE, de l'étude à la livraison. Plus rien ne tourne
   * avant ce moment : l'agent créé ici est le premier et le seul de la carte.
   * Il lit le contexte lourd une fois (briefing, CLAUDE.md, index de la
   * mémoire), chiffre le travail, puis l'exécute dans la foulée — un seul tour,
   * une seule attente, une seule dépense. La carte a son dossier : l'agent y vit
   * tout son tour, et le démon le referme à la fin (fusion dans la principale,
   * puis `git worktree remove`).
   */
  const agent = repris
    ? // Les réglages et le titre suivent la CARTE : entre l'interruption et le
      // clic, l'utilisateur a pu changer de moteur, de modèle ou de titre.
      store.saveAgent({
        ...repris,
        status: 'idle',
        title: card.title,
        run: card.run ?? repris.run,
        workdir: prepa.dossier,
        endedAt: undefined,
      })
    : createAgent({
        projectId: card.projectId,
        role: 'task',
        title: card.title,
        cardId: card.id,
        run: card.run,
        workdir: prepa.dossier,
      });
  if (repris) bus.emit({ type: 'agent.upsert', agent });

  /*
   * LE TRAVAIL DÉJÀ LÀ SE CONSTATE AVANT DE REPARTIR. Un tour coupé enregistre
   * parfois du code sans jamais pouvoir ranger sa carte : le drapeau n'est donc
   * pas posé, et la reprise se verrait reprocher de « n'avoir rien changé »
   * alors qu'il n'y avait plus rien à changer.
   */
  const dejaEnregistre =
    card.codeDejaEnregistre ||
    (!!origine && (await travailDejaSurLaBranche(project.path, branch, prepa.dossier).catch(() => false)));

  const running = store.saveCard({
    ...card,
    column: 'running',
    position: store.nextPosition(card.projectId, 'running'),
    agentId: agent.id,
    codeDejaEnregistre: dejaEnregistre,
    github: {
      ...(card.github ?? { checks: [], commits: [], fichiers: [], activity: [] }),
      branch,
      // La base n'est notée qu'à la CRÉATION de la branche, et jamais réécrite :
      // c'est elle qui dira, même après la fusion, ce que cette carte a touché.
      baseSha: card.github?.baseSha ?? prepa.base,
    },
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      attempts: (card.scheduling?.attempts ?? 0) + 1,
      waitingReason: undefined,
      // Un départ efface la suspension : c'est le geste qu'elle attendait.
      suspendu: false,
      // Le départ CONSOMME la date : une date, une fois, jamais une récurrence.
      // Sans cela, une carte relancée plus tard traînerait une heure déjà passée
      // et repartirait toute seule à la première boucle.
      departPrevu: undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card: running });

  /*
   * Le chiffrage se fait ICI, dans le tour de lancement — sauf si la carte en
   * porte déjà un (le chef d'orchestre l'a préparé avec sa proposition, ou la
   * carte a déjà été lancée une fois). On ne rechiffre jamais par-dessus des
   * chiffres existants : ils sont ce que l'utilisateur a vu en décidant.
   */
  const chiffrageAttendu = !card.estimate || card.estimate.failed;
  // Les écarts passés du projet affinent les chiffrages (PLAN §24).
  const ecarts = chiffrageAttendu ? pastGaps(card.projectId) : null;
  const consigneChiffrage = chiffrageAttendu
    ? `COMMENCE PAR ÉTUDIER ET CHIFFRER, PUIS ENCHAÎNE. Lis d'abord ce qu'il faut dans le projet pour mesurer l'ampleur du travail et arrête ton chiffrage : durée machine prévue et heures d'un développeur senior. Fais ensuite le travail dans la foulée, sans attendre — c'est le même tour. Le bloc json final reprend le chiffrage arrêté AVANT de commencer, pas un décompte rédigé après coup.${
        ecarts ? `\n\nÉCARTS CONSTATÉS SUR LES TÂCHES PRÉCÉDENTES DE CE PROJET (pour affiner) :\n${ecarts}` : ''
      }\n\n`
    : '';

  /*
   * LA REPRISE PASSE DEVANT LA DEMANDE. Elle dit ce qui est déjà fait, ce qui
   * reste et que le travail écrit est toujours là — sinon l'agent repart de la
   * description de la carte, donc du début, et refait ce qui était acquis.
   */
  const reprise = origine
    ? `${consigneDeReprise({
        origine,
        raison: card.scheduling?.waitingReason,
        branche: branch,
        dossier: prepa.dossier,
        etapes: repris ? etapesDeLaReprise(repris.id) : [],
        codeDejaEnregistre: dejaEnregistre,
      })}\n\n`
    : '';

  const prompt = `${reprise}Réalise cette tâche.

TITRE : ${card.title}
${card.description || '(pas de description)'}

Tu travailles sur la branche « ${branch} », dans le dossier « ${prepa.dossier} » — une copie de travail à toi seul, créée pour cette carte. Reste dedans : n'en change pas et ne change pas de branche. HaikoDev fusionne ta branche dans la principale et referme ce dossier dès que tu as rendu ; ne le fais pas toi-même.

${consigneChiffrage}Va au bout : lis ce qu'il faut, modifie, teste, puis enregistre et sauvegarde (commit + push). Ne publie pas.`;

  /*
   * LE LANCEMENT RÉPOND DÈS QUE LE TOUR EST PARTI, jamais à sa fin.
   *
   * `sendPrompt` ne rend la main qu'une fois le tour TERMINÉ — des minutes,
   * parfois des heures. En l'attendant ici, `startCard` gardait la réponse de
   * `card.start` / `card.move` en suspens tout ce temps : le navigateur, qui
   * abandonne au bout de deux minutes, croyait le geste perdu, éteignait ses
   * boutons pendant l'attente et annonçait « Aucune carte lancée » alors que
   * l'agent travaillait déjà.
   *
   * Tout ce qui devait être vrai AVANT de répondre l'est : les portes sont
   * franchies, la branche est prête, l'agent existe et la carte est passée en
   * « En cours » (`card.upsert` déjà diffusé). La suite se raconte toute seule
   * par les événements — c'est la même règle que le tiroir des procédures, dont
   * le tour ne se livre pas non plus par la réponse de sa commande.
   */
  void sendPrompt(agent.id, prompt, {
    silent: true,
    context: contexteHeritePourExecution(card),
    // Une carte lancée est une vraie tâche : elle mérite le compte rendu entier.
    ampleur: 'complete',
    // Le bloc json du chiffrage s'ajoute au gabarit du compte rendu : un seul
    // tour rend les deux.
    chiffrage: chiffrageAttendu,
    // Les images jointes au chef d'orchestre voyagent jusqu'ici : elles entrent
    // dans le bloc « PIÈCES JOINTES » du prompt, comme pour un message direct.
    attachments: card.attachments,
    onComplete: async (text, ok, measurement) => {
      /*
       * Le chiffrage voyage dans la réponse du tour de lancement. HaikoDev y
       * joint LUI-MÊME la mesure réelle du moteur : une mesure rédigée par
       * l'agent serait ignorée. Aucun chiffre rendu ne casse rien — la carte
       * garde son estimation absente plutôt qu'une estimation inventée.
       */
      if (ok && chiffrageAttendu) {
        const estimate = parseEstimate(text);
        if (estimate) {
          const avant = store.getCard(cardId);
          if (avant) {
            const chiffree = store.saveCard({
              ...avant,
              estimate: {
                ...avecMesureAnalyse(estimate, measurement),
                summary: estimate.summary ?? text.slice(0, 2000),
                producedAt: Date.now(),
              },
            });
            bus.emit({ type: 'card.upsert', card: chiffree });
          }
        }
      }

      const fresh = store.getCard(cardId);
      if (!fresh) return;
      if (ok) {
        /*
         * Le passage en « Terminé » est déjà fait : la carte suit l'issue de son
         * tour (`carteApresFinDeTour`). On ne prévient que si elle y est
         * VRAIMENT arrivée : un tour qui répond sans rien modifier au dépôt
         * renvoie la carte en file, il n'y a donc pas de travail à annoncer.
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
  }).catch((err) => {
    /*
     * Plus personne n'attend cette promesse : une panne du lancement lui-même
     * (moteur introuvable, coffre du compte illisible) doit donc être DITE ici,
     * sinon elle disparaîtrait en silence. La carte, elle, est déjà rangée par
     * les chemins de fin de tour.
     */
    log.error('lancement de carte', err);
    const fresh = store.getCard(cardId);
    bus.toast('error', `Lancement impossible : ${String(err?.message ?? err).slice(0, 200)}`, fresh?.id);
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La boucle                                                           */
/* ------------------------------------------------------------------ */

let ticking = false;
/** L'instant de départ du tour en cours — ce qui permet de le dire perdu. */
let tourPartiA = 0;

/**
 * LE MÉNAGE DES DOSSIERS PASSE DEVANT TOUTE RELANCE.
 *
 * Au démarrage, deux travaux visent les mêmes copies : le ménage, qui enregistre
 * d'office ce qui traîne dedans puis les referme, et l'ordonnanceur, qui reprend
 * les cartes interrompues. Lancés en parallèle, le second pouvait rendre à un
 * agent une copie que le premier était en train de retirer — le travail écrit
 * partait avec elle. La boucle attend donc que le ménage ait fini : c'est une
 * poignée de secondes, une seule fois, au démarrage.
 */
let menageEnCours: Promise<void> | null = null;

/**
 * LE FILET, SUR SA PROPRE HORLOGE.
 *
 * Deux gestes entièrement synchrones : refermer les agents que plus rien
 * n'attend, ranger les cartes restées en « En cours ». Ils vivaient en tête de
 * la boucle d'ordonnancement — donc derrière son verrou « un tour à la fois ».
 * Un seul `await` de cette boucle qui ne revenait jamais (git pendu, appel
 * réseau sans fin) et le verrou n'était plus rendu : le filet ne repassait plus
 * JAMAIS, et seul un redémarrage du serveur libérait les conversations. Le
 * filet ne dépend plus de ce qu'il surveille.
 *
 * Rien ici ne s'attend : `setInterval` ne peut donc pas superposer deux
 * passages. L'enveloppe `try` est ce qui empêche une panne d'un seul agent
 * d'emporter le minuteur — donc le filet — avec elle.
 */
export function passageDeVeille(): void {
  try {
    veilleDesToursBloques();
  } catch (err) {
    log.error('veille des tours bloqués', err);
  }
  try {
    rangerLesCartesOubliees();
  } catch (err) {
    log.error('rangement des cartes oubliées', err);
  }
}

export function startVeille(): NodeJS.Timeout {
  return setInterval(passageDeVeille, PERIODE_VEILLE_MS);
}

export async function tick(): Promise<void> {
  if (menageEnCours) await menageEnCours.catch(() => undefined);
  /*
   * UN TOUR QUI NE REND PAS LA MAIN NE CONDAMNE PLUS LES SUIVANTS. Le verrou
   * reste la règle — deux tours en même temps lanceraient deux fois la même
   * carte —, mais il n'est plus éternel : passé son plafond, le tour en cours
   * est tenu pour perdu et la boucle reprend, en le DISANT. Le garde de
   * `startCard` interdit le double départ pendant que le tour perdu s'achève.
   */
  const decision = decisionDeBoucle({ enCours: ticking, depuisMs: Date.now() - tourPartiA });
  if (!decision.partir) return;
  if (decision.abandon) log.warn(decision.abandon);
  ticking = true;
  /*
   * L'instant de départ sert AUSSI de jeton : un tour déclaré perdu qui
   * reviendrait un jour de son sommeil ne doit pas rendre le verrou du tour qui
   * a pris sa place, sinon deux tours finiraient par tourner ensemble pour de
   * bon.
   */
  const monDepart = Date.now();
  tourPartiA = monDepart;
  try {
    for (const project of store.listProjects()) {
      /*
       * Aucun balayage de chiffrage : une carte validée n'attend plus d'analyse,
       * et rien ne part au moteur avant le lancement. « Planifié » est la
       * colonne où toute carte naît, et une carte simplement posée sur le
       * tableau ne coûte rien.
       *
       * Démarrage : les cartes planifiées, dans l'ordre d'ancienneté.
       */
      const planned = store
        .listCardsInColumn(project.id, 'planned')
        .sort((a, b) => (b.scheduling?.asap ? 1 : 0) - (a.scheduling?.asap ? 1 : 0) || a.createdAt - b.createdAt);

      for (const card of planned) {
        if (card.agentId && isRunning(card.agentId)) continue;
        // Suspendue à la main : elle reste en file, mais elle attend un geste.
        if (card.scheduling?.suspendu) continue;
        // Une carte validée ne s'exécute pas toute seule : lancer, c'est
        // dépenser. L'ordonnanceur ne reprend d'office qu'une carte déjà
        // autorisée (« Dès que possible », HEURE DITE arrivée, ou déjà lancée
        // puis interrompue) ; sinon la bascule Planifié → En cours attend le
        // clic de l'utilisateur. La boucle repassant toutes les quinze
        // secondes, une heure manquée pendant un arrêt du démon est RATTRAPÉE
        // au retour. Plus rien ne tourne avant ce moment : il n'y a donc plus
        // de chiffrage en vol dont il faudrait se garder.
        if (!demarrageAutomatiqueAutorise(card.scheduling)) continue;
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
    // Seul le tour EN TITRE rend le verrou : un tour déjà remplacé se retire en
    // silence.
    if (tourPartiA === monDepart) ticking = false;
  }
}

/**
 * Au démarrage du démon, plus personne ne travaille : les copies de travail de
 * cartes encore ouvertes sont des restes d'un tour tué net. On les referme comme
 * en fin de tour — le travail en cours est ENREGISTRÉ d'office sur la branche de
 * la carte, puis la branche rejoint la principale.
 *
 * Et surtout, on le DIT à la carte : toute carte dont la branche portait du
 * travail repart avec `codeDejaEnregistre`. Sans ce drapeau, sa reprise
 * s'entendait dire « réponse rendue, mais aucun fichier n'a changé » et
 * retombait, retenue, dans « Planifié » — alors que son code était bel et bien
 * livré, simplement par un tour qui n'avait jamais pu ranger sa carte.
 */
async function menageDesDossiersDeCarte(): Promise<void> {
  const occupes = occupantsDesDossiers().map((o) => o.dossier);
  for (const project of store.listProjects()) {
    if (!(await estUnDepotGit(project.path))) continue;
    const rattrapes = await menageDesDossiers(project.path, occupes).catch((err) => {
      log.warn('ménage des dossiers de cartes impossible', String(err).slice(0, 200));
      return [];
    });
    for (const rattrape of rattrapes) {
      if (!rattrape.enregistre && !rattrape.fusionnee) continue;
      marquerCodeDejaEnregistre(project.id, rattrape.branche, rattrape.enregistre);
    }
  }
}

/**
 * La carte derrière une branche « tache/… ».
 *
 * Le nom de branche naît du titre ET du numéro de la carte (`nomDeBranche`),
 * mais seul le NUMÉRO ne bouge jamais : un titre modifié entre l'interruption et
 * le redémarrage faisait échouer la comparaison de nom entier, la carte ne
 * recevait pas son drapeau, et sa reprise s'entendait dire « aucun fichier n'a
 * changé » alors que son code venait justement d'être sauvé. On reconnaît donc
 * la carte à la SIGNATURE de son numéro, celle que porte la fin de la branche.
 *
 * Et l'on DIT ce qui vient de se passer : une carte dont le travail a été
 * enregistré d'office porte la phrase du sauvetage, tout de suite, sans attendre
 * la fin d'un futur tour. Sans elle, le seul mot que l'utilisateur voyait était
 * celui d'un tour ultérieur — qui, lui, n'avait effectivement plus rien à
 * changer.
 */
function marquerCodeDejaEnregistre(projectId: string, branche: string, sauveDOffice: boolean): void {
  const carte = store
    .listCards(projectId)
    .find((c) => nomDeBranche(c.title, c.id) === branche || estLaBrancheDeLaCarte(branche, c.id));
  if (!carte) return;
  if (carte.codeDejaEnregistre && !sauveDOffice) return;
  const marquee = store.saveCard({
    ...carte,
    codeDejaEnregistre: true,
    ...(sauveDOffice ? { sansModification: RAISON_TRAVAIL_SAUVE } : {}),
  });
  bus.emit({ type: 'card.upsert', card: marquee });
  log.info(
    `carte « ${carte.title} » : travail retrouvé sur sa branche, code déjà enregistré${
      sauveDOffice ? " (enregistré d'office)" : ''
    }`,
  );
}

export function startScheduler(): NodeJS.Timeout {
  log.info(`ordonnanceur démarré (plafond ${store.getSettings().maxAgents} agents, ${runningCount()} en cours)`);
  // Le ménage passe devant la boucle : `tick` l'attend (`menageEnCours`) plutôt
  // que de rendre à une carte une copie de travail en cours de fermeture.
  menageEnCours = menageDesDossiersDeCarte().finally(() => {
    menageEnCours = null;
  });
  return setInterval(() => {
    void tick();
  }, 15000);
}
