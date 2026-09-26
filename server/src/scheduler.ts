import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import {
  Agent,
  agentDeLaCarteAuLancement,
  estUnRegroupement,
  raisonDuRelais,
  BranchesDePublication,
  Card,
  EtapeDeReprise,
  Estimate,
  TurnMeasurement,
  OccupantDossier,
  RAISON_SANS_DEPOT,
  RAISON_DOSSIER_INJOIGNABLE,
  EtatDuDossier,
  RAISON_TRAVAIL_SAUVE,
  consigneDeReprise,
  origineDeReprise,
  COLONNES_AVANT_LE_TRAVAIL,
  COLONNE_DE_FIN_DE_TOUR,
  COLONNES_HORS_REPRISE,
  cadrageRouvertApresRapport,
  carteEnCadrage,
  messagesDepuisLaRelance,
  relanceRetenueAvantLancement,
  planRenduDepuisLaRelance,
  comprehensionDepuisLaRelance,
  demarrageAutomatiqueAutorise,
  cartePrisonniereDuCadrage,
  estLaBrancheDeLaCarte,
  etatDuDepart,
  raisonDattente,
  nomDeBranche,
  phraseDepuisReponse,
  porteDuDepot,
  porteDuDossier,
  avecMesureAnalyse,
  contexteHeritePourExecution,
  blocDeSyntheseDuBesoin,
  PERIODE_VEILLE_MS,
  decisionDeBoucle,
  contexteDeDepart,
  titreDepuisLaDiscussion,
  planCourant,
  titreEncoreVide,
  NIVEAU_PAR_DEFAUT,
  reglagesDuNiveau,
  EtapeDeLancement,
  machinePleine,
  RAISON_MACHINE_SATUREE,
  NIVEAU_DU_PLAN,
  consigneDesDepots,
  depotsDuProjet,
} from '@beluga/shared';
import { avecLesBasesAnnexes, copiesAnnexesOccupees, ouvrirLesCopiesAnnexes, type CopieAnnexe } from './copies-des-depots.js';
import { menageDesDossiers, ouvrirDossierDeCarte, travailDejaSurLaBranche } from './dossier-de-carte.js';
import { dossierDeCarte } from './copies-de-cartes.js';
import { remonterLeDossierDuProjet } from './remontage.js';
import * as store from './store.js';
import { bus } from './bus.js';
import {
  createAgent,
  isRunning,
  sendPrompt,
  runningCount,
  runningAgentIds,
  veilleDesToursBloques,
  reprendreLesFilesEnAttente,
} from './runtime.js';
import { agentDeCadrage, cadrageDeLaCarte } from './cadrage.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { rangerLesCartesOubliees, refermerLesEtapesSansTour } from './deplacement-carte.js';
import {
  lancementEnRoute,
  marquerLancementEnRoute,
  oublierLancementEnRoute,
} from './lancements-en-route.js';
import { passageDuDeploiementAutomatique } from './deploiement-automatique.js';
import { balayerLesPublicationsSansPorteur } from './deploy.js';
import { lancerLaCarteMere } from './regroupements.js';
import { appliquerRedemarrageEnAttente } from './demon.js';
import { canStartAgent, etatCapacite } from './capacity.js';
import { quotasDuMoteur } from './accounts.js';
import { notify } from './notify.js';
import { log } from './logger.js';
import { lecturesDeLaCarte } from './connaissances.js';


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
  /**
   * Ce refus SE ROUVRE-T-IL TOUT SEUL ? Le quota revient à sa remise à zéro, la
   * place sur la machine se libère quand un autre tour finit : dans ces deux
   * cas, le geste de lancement reste valable et la carte doit repartir sans
   * qu'on reclique. Un dépôt qui n'est pas un dépôt git ou un dossier occupé
   * par un autre agent, eux, demandent une action : leur refus est définitif
   * tant qu'on n'a rien fait, et il n'arme aucune reprise.
   */
  reprisePossible?: boolean;
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
  // La machine pleine se vide d'elle-même dès qu'un tour finit : le lancement
  // demandé garde sa valeur, il sera rejoué.
  if (!capacity.ok) return { ok: false, reason: capacity.reason, reprisePossible: true };

  const project = store.getProject(card.projectId);
  if (project) {
    // Le dossier VISÉ par cette carte est le sien, pas celui du projet : deux
    // cartes différentes ne se gênent donc plus.
    const vise = dossierDeCarte(project.path, card.title, card.id);
    const dossier = porteDuDossier({ cardId: card.id, dossier: vise }, occupantsDesDossiers(card.id));
    if (!dossier.ok) return { ok: false, reason: dossier.raison };

    const depot = porteDuDepot(await etatDuDossierDuProjet(project.path));
    if (!depot.ok) return { ok: false, reason: depot.raison };
    /* Chaque dépôt ANNEXE du projet doit être un dépôt joignable, lui aussi : la
       carte y ouvrira sa branche (`copies-des-depots.ts`). */
    for (const annexe of project.depots ?? []) {
      const porte = porteDuDepot(await etatDuDossierDuProjet(annexe.path));
      if (!porte.ok) return { ok: false, reason: `Dépôt « ${annexe.nom} » : ${porte.raison}` };
    }
  }

  /*
   * LES QUOTAS DU SEUL MOTEUR DE LA CARTE, SOUS PLAFOND. Le relevé NU
   * (`refreshQuotas()`) interrogeait TOUS les comptes de TOUS les moteurs,
   * sans limite de temps, sur le chemin critique du lancement : 5,8 s mesurées
   * sur quatre comptes en bonne santé, des dizaines de secondes dès qu'un jeton
   * a expiré ailleurs. On passe donc par la même porte bornée que le choix du
   * compte (`quotasDuMoteur`, vingt secondes, repli sur le dernier relevé
   * connu) — un quota inconnu ne bloque pas : le moteur dira sa limite, alors
   * que ne pas partir du tout tue la carte.
   */
  const quotas = await quotasDuMoteur(card.run.engine);
  const engineQuotas = quotas.filter((q) => q.engine === card.run.engine);
  if (engineQuotas.length && !engineQuotas.some((q) => q.available)) {
    const soonest = engineQuotas
      .map((q) => q.weekly?.resetsAt ?? q.session?.resetsAt)
      .filter((v): v is number => !!v)
      .sort((a, b) => a - b)[0];
    return {
      ok: false,
      // Le quota revient à sa remise à zéro : la carte repartira toute seule,
      // et c'est bien ce que sa phrase annonce (« reprise à … »).
      reprisePossible: true,
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
  return (await etatDuDossierDuProjet(projectPath)) === 'depot';
}

/**
 * POURQUOI GIT A REFUSÉ : LE DIRE, AU LIEU DE TOUT APLATIR EN « PAS DE DÉPÔT ».
 *
 * Cette fonction avalait toute erreur en un `false`, et trois pannes très
 * différentes sortaient par la même phrase :
 *
 *  1. le dossier n'est vraiment pas un dépôt — un réglage à faire ;
 *  2. le dossier est INJOIGNABLE (montage distant décroché) — une panne, mais
 *     une panne MÉCANIQUE : le « bind » est resté accroché à une connexion
 *     morte. On le remonte ici, puis on retente. Le refus ne subsiste que si la
 *     réparation échoue, et il nomme alors toujours la vraie cause ;
 *  3. git refuse le dépôt pour « dubious ownership » — les dossiers montés
 *     appartiennent à root, le démon tourne sous un autre compte, et git exige
 *     alors une déclaration `safe.directory`. Rien n'est cassé : ce cas se
 *     RÉPARE tout seul ici, puis on retente.
 */
export interface SondesDuDossier {
  /** `git rev-parse --git-dir` dans le dossier : rend le message d'échec, ou '' si c'est un dépôt. */
  git: (dossier: string) => Promise<string>;
  /** Le dossier se LIT-il vraiment ? (lister son contenu, pas seulement ses attributs) */
  lisible: (dossier: string) => Promise<boolean>;
  remonter: (dossier: string) => Promise<boolean>;
  declarerSur: (dossier: string) => Promise<void>;
}

const SONDES_REELLES: SondesDuDossier = {
  git: async (dossier) => {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dossier, timeout: 8000 });
      return '';
    } catch (err) {
      return String((err as Error)?.message ?? err) || 'échec de git';
    }
  },
  /*
   * LISTER, JAMAIS `stat`. Constat du 21.09.2026 : sur un « bind » accroché à
   * un sshfs mort, `stat` du dossier RÉUSSISSAIT (attributs gardés en cache,
   * ou lus depuis le parent du point de montage) pendant que `ls` rendait
   * ENOTCONN. Le démon concluait « lisible », sautait le remontage et
   * annonçait « projet non déclaré sur un dépôt » — un réglage fantôme.
   */
  lisible: async (dossier) => {
    try {
      await fs.readdir(dossier);
      return true;
    } catch {
      return false;
    }
  },
  remonter: (dossier) => remonterLeDossierDuProjet(dossier),
  declarerSur: async (dossier) => {
    try {
      await execFileAsync('git', ['config', '--global', '--add', 'safe.directory', dossier], {
        timeout: 8000,
      });
      log.info('dossier déclaré sûr pour git (dubious ownership)', dossier);
    } catch (err) {
      log.warn('déclaration safe.directory impossible', String(err).slice(0, 200));
    }
  },
};

/** Le transport lui-même est mort : aucune lecture ne peut réussir, inutile de sonder. */
const TRANSPORT_MORT = /ENOTCONN|Transport endpoint is not connected|EIO\b|Input\/output error|EHOSTDOWN|Stale file handle|ESTALE/i;
/** Le dossier ne répond peut-être pas — ou c'est git qui manque : on sonde avant de trancher. */
const DOSSIER_DOUTEUX = /ENOENT|EACCES|cannot change to|No such file or directory/i;

export async function etatDuDossierDuProjet(
  projectPath: string,
  sondes: SondesDuDossier = SONDES_REELLES,
): Promise<EtatDuDossier> {
  let message = await sondes.git(projectPath);
  if (!message) return 'depot';

  const injoignable =
    TRANSPORT_MORT.test(message) || (DOSSIER_DOUTEUX.test(message) && !(await sondes.lisible(projectPath)));
  if (injoignable) {
    /*
     * Le dossier ne répond pas : on tente de le remonter AVANT de refuser.
     * Un « bind » accroché à une connexion morte se répare en deux commandes,
     * et le refus n'a plus à attendre une main humaine pour ça.
     */
    if (!(await sondes.remonter(projectPath))) return 'injoignable';
    message = await sondes.git(projectPath);
    if (!message) return 'depot';
    // Remonté, mais git refuse encore : les deux cas suivants restent à juger.
  }

  // Propriétaire douteux : on déclare le dossier sûr, puis on retente une fois.
  if (/dubious ownership|safe\.directory/i.test(message)) {
    await sondes.declarerSur(projectPath);
    message = await sondes.git(projectPath);
    if (!message) return 'depot';
  }

  /*
   * DERNIÈRE GARDE AVANT « SANS DÉPÔT » : ce verdict envoie l'utilisateur
   * chercher un réglage. On ne le rend que sur un dossier qui se LIT — sinon
   * c'est une panne d'accès, quel que soit le texte de git.
   */
  if (!(await sondes.lisible(projectPath))) return 'injoignable';
  return 'sans-depot';
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
  | { kind: 'prete'; nom: string; dossier: string; base?: string; annexes?: CopieAnnexe[] }
  | { kind: 'echec'; raison: string };

export async function prepareBranch(
  projectPath: string,
  card: Card,
  reglees?: BranchesDePublication,
): Promise<Branche> {
  const etat = await etatDuDossierDuProjet(projectPath);
  if (etat !== 'depot')
    return { kind: 'echec', raison: etat === 'injoignable' ? RAISON_DOSSIER_INJOIGNABLE : RAISON_SANS_DEPOT };
  const ouvert = await ouvrirDossierDeCarte(projectPath, card, reglees);
  if (ouvert.kind === 'echec') return ouvert;
  /*
   * LES DÉPÔTS ANNEXES, APRÈS LE PRINCIPAL : la même branche, une copie par
   * dépôt. Un annexe qui refuse fait échouer le lancement en se nommant — un
   * agent ne part pas sur un projet dont il manquerait une partie.
   */
  const project = store.getProjectByPath(projectPath);
  let annexes: CopieAnnexe[] = [];
  if (project?.depots?.length) {
    const ouvertes = await ouvrirLesCopiesAnnexes(project, card);
    if (ouvertes.kind === 'echec') return ouvertes;
    annexes = ouvertes.copies;
  }
  return { kind: 'prete', nom: ouvert.branche, dossier: ouvert.dossier, base: ouvert.base, annexes };
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
function refus(
  card: Card,
  raison: string,
  reprisePossible = false,
  /*
   * LA COLONNE D'AVANT, quand le lancement a DÉJÀ posé la carte en « En cours ».
   * Le clic déplace la carte tout de suite (voir `lancerLaCarte`) : un refus
   * arrivé ensuite doit la ramener d'où elle vient, sans quoi une carte jamais
   * partie resterait affichée « En cours » sans le moindre agent.
   */
  colonneAvant?: Card['column'],
): { ok: false; error: string } {
  const fresh = store.getCard(card.id) ?? card;
  const dejaArmee = !!fresh.scheduling?.reprendreDesQuePossible;
  const aRamener = colonneAvant !== undefined && fresh.column !== colonneAvant;
  if (fresh.scheduling?.waitingReason !== raison || dejaArmee !== reprisePossible || aRamener) {
    const updated = store.saveCard({
      ...fresh,
      ...(aRamener ? { column: colonneAvant } : {}),
      scheduling: {
        ...(fresh.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
        waitingReason: raison,
        /*
         * LA MARQUE DE VOL POSÉE PAR LE CLIC S'ÉTEINT AVEC LE REFUS. Le
         * lancement pose `tourEnVolDepuis` en même temps qu'il fait passer la
         * carte en « En cours » (`lancerLaCarte`) ; un lancement refusé n'a
         * plus de tour à annoncer, et la laisser derrière lui ferait raconter
         * un travail en vol à une carte revenue en file.
         */
        ...(aRamener ? { tourEnVolDepuis: undefined } : {}),
        /*
         * LE GESTE DEMANDÉ N'EST PAS PERDU. Une porte qui se rouvre seule
         * (quota, place sur la machine) arme la reprise : l'ordonnanceur
         * rejouera ce lancement dès que l'obstacle sera levé, sans second clic.
         * Un refus définitif (dépôt absent, dossier occupé) la désarme au
         * contraire : rien ne doit repartir tant que personne n'a agi.
         */
        reprendreDesQuePossible: reprisePossible ? true : undefined,
      },
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
  if (!COLONNES_AVANT_LE_TRAVAIL.includes(card.column)) {
    return { ok: false, error: 'seule une carte de « Demande » ou de « Plan » se valide.' };
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
 * UNE CARTE DONT LE LANCEMENT EST DÉJÀ EN ROUTE NE REPART PAS UNE SECONDE FOIS.
 *
 * Entre l'appel de `startCard` et le moment où l'agent passe « au travail », il
 * s'écoule plusieurs secondes : portes à franchir, copie de travail à ouvrir,
 * branche à préparer. La garde de la ligne suivante (`isRunning`) ne voit rien
 * pendant cette fenêtre. Elle suffisait tant qu'un seul tour de boucle tournait
 * à la fois ; depuis qu'un tour trop long peut être déclaré perdu et la boucle
 * repartir, deux tours peuvent se croiser — et lanceraient deux fois la même
 * carte, donc deux agents sur la même branche.
 *
 * Le registre lui-même vit dans `lancements-en-route.ts` : le balayage des
 * cartes oubliées en a besoin, lui aussi, pour ne pas fermer une carte dont le
 * lancement se prépare encore.
 */
/**
 * VALIDER LA COMPRÉHENSION D'UNE CARTE : UN SEUL CHANGEMENT D'ÉTAT, ÉCRIT UNE FOIS.
 *
 * La décision portait sur le PLAN, qui était un passage obligé. Il ne l'est
 * plus : l'interrupteur « Plan » naît éteint, et la plupart des cartes partent
 * sur leur seule compréhension — à deux registres, dont une part technique
 * destinée à l'agent qui exécutera. Le dernier point d'arrêt avant la dépense
 * est donc la COMPRÉHENSION, et c'est elle qu'on valide.
 *
 * Rien ne part au moteur — valider ne coûte pas un jeton —, la carte est
 * autorisée (`analyseDemandee`), le niveau choisi est retenu sur elle, et le
 * lancement lit cet état (`gesteDuParcours`, `shared/src/parcours-carte.ts`).
 * Le clic est UNIQUE : l'écran enchaîne la validation puis le lancement.
 */
export function validerLaComprehension(
  cardId: string,
  /* Le palier transmis, s'il y en a un. Il ne REMPLIT que ce qui manque : */
  niveauDemande?: 'leger' | 'standard' | 'approfondi',
): { ok: boolean; error?: string; card?: Card } {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  /* Sur une carte relancée, la compréhension d'origine a déjà servi au travail
     livré : seule celle de la relance se valide. */
  const relance = cadrageRouvertApresRapport(card);
  const comprise = card.parcours?.comprehension;
  const valable = !!comprise?.texte?.trim() && (!relance || comprehensionDepuisLaRelance(card.parcours));
  if (!comprise || !valable) {
    return { ok: false, error: 'cette carte ne porte aucune compréhension à valider.' };
  }
  /* La validation se prend depuis « Demande » comme depuis « Plan » — c'est là
     que le démon range la carte pendant qu'un plan s'écrit. */
  if (!carteEnCadrage(card)) {
    return { ok: false, error: 'seule une carte encore en cadrage valide sa compréhension.' };
  }
  if (card.parcours?.comprehensionValidee?.comprehensionAt === comprise.at) return { ok: true, card };
  const scheduling = card.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
  /*
   * LE RÉGLAGE VISIBLE AU MOMENT DE « VALIDER » EST CELUI QUI PART. Une carte
   * qui porte un modèle — choisi dans sa configuration, modifiable jusqu'ici —
   * le garde tel quel : le palier « Approfondi » n'était plus qu'une étiquette
   * qui laissait croire à un autre modèle. Sans modèle, la carte part toujours
   * au palier le plus ample (`NIVEAU_DU_PLAN`), traduit au lancement.
   */
  const modelePose = !!card.run?.model;
  const niveau = modelePose ? card.run?.niveau : (niveauDemande ?? NIVEAU_DU_PLAN);
  const updated = store.saveCard({
    ...card,
    analyseDemandee: true,
    run: !modelePose && niveau ? ({ ...card.run, niveau } as Card['run']) : card.run,
    parcours: {
      ...(card.parcours ?? { plans: [] }),
      comprehensionValidee: { at: Date.now(), comprehensionAt: comprise.at, niveau },
    },
    scheduling: { ...scheduling, waitingReason: raisonDattente(scheduling) },
  });
  bus.emit({ type: 'card.upsert', card: updated });
  log.info(`compréhension validée sur la carte ${cardId}${niveau ? ` (niveau ${niveau})` : ''}`);
  return { ok: true, card: updated };
}

/**
 * UNE DÉCISION OUVERTE SUR LA CARTE INTERDIT SON LANCEMENT. Un tour tombé qui
 * attend « Relancer / Ignorer / Arrêter », une limite de compte qui attend
 * « Avec quel compte poursuivre ? » : lancer par-dessus ouvrirait un second
 * chemin à côté du premier. L'écran éteint déjà le bouton ; le démon refuse
 * aussi, pour les chemins qui ne passent pas par lui (glisser-déposer, API).
 */
export function decisionOuverteSurLaCarte(cardId: string): string | null {
  /*
   * SEULE UNE DÉCISION POSÉE SUR LE DERNIER TOUR DE L'AGENT COMPTE. Une erreur
   * de tour restée sans réponse pendant qu'un message a déjà relancé l'agent —
   * et qu'un tour suivant a été rendu — n'arrête plus rien : la bloquer ici
   * aurait interdit à l'ordonnanceur de relancer une carte qui a repris depuis
   * (constaté par `scripts/verif-cycle-de-vie-carte.mjs`).
   */
  /*
   * UNE CARTE SUSPENDUE À LA MAIN N'A PLUS RIEN À TRANCHER : l'arrêt était le
   * geste, et la relance au clic est justement ce que la suspension attend.
   * Le tour coupé par cet arrêt ne pose plus de décision (`erreurDeTourAPoser`,
   * critère `arretDemande`) ; celles posées avant cette règle ne doivent pas
   * non plus retenir la carte.
   */
  if (store.getCard(cardId)?.scheduling?.suspendu) return null;
  const surLeDernierTour = (agentId: string, messageId: string): boolean => {
    const reponses = store.listMessages(agentId).filter((m) => m.role === 'assistant');
    return reponses.length > 0 && reponses[reponses.length - 1].id === messageId;
  };
  const reprise = store
    .reprisesDeCompteEnAttente()
    .find((a) => a.cardId === cardId && surLeDernierTour(a.agentId, a.messageId));
  if (reprise) {
    return `le compte « ${reprise.compteEpuiseLabel} » a atteint sa limite : choisissez dans « Une décision attend » sur quel compte, moteur ou modèle poursuivre.`;
  }
  const erreur = store
    .erreursDeTourEnAttente()
    .find((a) => a.cardId === cardId && surLeDernierTour(a.agentId, a.messageId));
  if (erreur) return 'une erreur a arrêté le travail : tranchez-la d’abord (relancer, ignorer ou arrêter).';
  return null;
}

export async function startCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  if (lancementEnRoute(cardId)) return { ok: true };
  const decision = decisionOuverteSurLaCarte(cardId);
  if (decision) return { ok: false, error: `Lancement refusé : ${decision}` };
  marquerLancementEnRoute(cardId);
  try {
    return await lancerLaCarte(cardId);
  } finally {
    oublierLancementEnRoute(cardId);
  }
}

/**
 * CE QUE LE CADRAGE LAISSE À LA CARTE AVANT DE S'EFFACER.
 *
 * Deux choses, et deux seulement :
 *
 *  - SON TITRE. L'agent de cadrage est censé l'écrire au fil de la discussion
 *    (`board_update_card`). S'il ne l'a pas fait, la colonne se remplirait de
 *    cartes « Nouvelle tâche » : on prend alors la première phrase de la
 *    première demande.
 *  - SON MODÈLE, quand elle n'en a aucun. Une carte qui porte déjà un modèle
 *    part avec celui-là, point : c'est ce que l'utilisateur a vu en haut de la
 *    discussion, et rien ne le réécrit ici. Sans modèle du tout, on reprend
 *    celui de la conversation de cadrage — elle ne tourne plus de force sur un
 *    modèle économe —, et à défaut seulement on traduit le palier.
 */
/**
 * CE QUE L'AGENT DE CADRAGE LIT EN PASSANT EN EXÉCUTION. Il reprend sa propre
 * conversation : la discussion n'est donc pas recopiée, mais ses droits, son
 * dossier et sa consigne ont changé depuis son dernier tour.
 */
const CONSIGNE_DE_BASCULE =
  "TU PASSES DU CADRAGE À L'EXÉCUTION. Tu es l'agent qui a cadré cette carte avec l'utilisateur : la discussion ci-dessus, dans ta propre conversation, est la demande. " +
  "Tu n'es plus bridé : tu as désormais l'accès complet (lecture, écriture, commandes, enregistrement et sauvegarde), et tu travailles dans la copie de travail de la carte indiquée plus bas, plus dans ton espace de cadrage. " +
  'Ce que tu as affirmé sur le code pendant le cadrage se vérifie avant d’être repris.';

async function prendreLaSuiteDuCadrage(
  card: Card,
  discussion: { role: string; content: string }[],
  runDuCadrage?: { engine?: string; model?: string; thinking?: string },
): Promise<Card> {
  const title = titreEncoreVide(card.title) ? titreDepuisLaDiscussion(discussion, card.title) : card.title;
  /* LE PLAN EST DÉJÀ DANS LA CARTE : l'outil `rendre_plan` l'y a écrit avec
     sa description (`server/src/tools.ts`). Rien ne se recopie plus du fil. */
  let run = card.run;
  /*
   * Sans modèle arrêté, la carte reprend d'abord celui de SA CONVERSATION —
   * le modèle affiché en haut du fil, choisi par l'utilisateur. Le palier ne
   * sert plus que de dernier recours, pour une carte qui n'a ni modèle ni
   * conversation derrière elle.
   */
  if (!run?.model && runDuCadrage?.model) {
    run = {
      ...(run ?? {}),
      engine: runDuCadrage.engine ?? run?.engine,
      model: runDuCadrage.model,
      thinking: runDuCadrage.thinking ?? run?.thinking,
    } as Card['run'];
  }
  if (!run?.model) {
    const palier = run?.niveau ?? NIVEAU_PAR_DEFAUT;
    try {
      const moteurs = await catalogueMoteurs();
      const moteur =
        moteurs.find((m) => m.id === card.run?.engine) ?? moteurs.find((m) => m.models.length) ?? moteurs[0];
      if (moteur) {
        const reglages = reglagesDuNiveau(moteur, palier);
        run = { ...(run ?? {}), engine: moteur.id, ...reglages, niveau: palier } as Card['run'];
      }
    } catch (err) {
      // Catalogue illisible : la carte repart sur le moteur par défaut du
      // projet, comme n'importe quelle carte sans réglage. Mieux qu'un refus.
      log.warn('niveau par défaut du cadrage : catalogue des moteurs illisible', err);
    }
  }
  if (title === card.title && run === card.run) return card;
  const frais = store.saveCard({ ...card, title, run });
  bus.emit({ type: 'card.upsert', card: frais });
  return frais;
}

/**
 * L'ÉTAPE DE PRÉPARATION, DITE PENDANT QU'ELLE SE FAIT.
 *
 * Entre le clic et le premier mot du moteur, l'ouverture de la copie de travail
 * peut tenir plusieurs minutes sur un gros dépôt. Rien n'en sortait : l'écran
 * finissait par annoncer que « ça prend plus de temps que prévu », comme pour un
 * bouton en panne. On DIFFUSE désormais l'étape en cours — jamais enregistrée,
 * aucune préparation ne survivant à un redémarrage du démon
 * (`shared/src/lancement-en-cours.ts`). `undefined` referme la préparation.
 */
function etapeDeLancement(card: Card, etape?: EtapeDeLancement): void {
  bus.emit({
    type: 'card.lancement',
    cardId: card.id,
    projectId: card.projectId,
    etape,
    depuis: Date.now(),
  });
}

/**
 * CE QUE CHAQUE ÉTAPE DE PRÉPARATION A COÛTÉ, ÉCRIT AU JOURNAL DU DÉMON.
 *
 * On savait NOMMER l'étape en cours, jamais dire son PRIX : « ça a mis X
 * secondes » restait une impression, et on corrigeait à l'aveugle. Ce petit
 * chronomètre relève chaque étape et rend une ligne lisible — « portes 5.8s,
 * dossier 0.2s, agent 0.0s, moteur 1.1s » — posée à l'instant où le tour part.
 * Rien n'est enregistré en base : une préparation ne survit pas au démon.
 */
function chronoDeLancement() {
  const debut = Date.now();
  let dernier = debut;
  const etapes: string[] = [];
  return {
    /** Referme l'étape qui vient de finir, et note ce qu'elle a pris. */
    etape(nom: string) {
      const maintenant = Date.now();
      etapes.push(`${nom} ${((maintenant - dernier) / 1000).toFixed(1)}s`);
      dernier = maintenant;
    },
    /** La ligne du journal, une fois la préparation finie. */
    bilan(titre: string): string {
      return `préparation de « ${titre} » : ${((Date.now() - debut) / 1000).toFixed(1)}s au total — ${etapes.join(', ')}`;
    },
    /** Le temps total de la préparation, en millisecondes. */
    total(): number {
      return Date.now() - debut;
    },
  };
}

async function lancerLaCarte(cardId: string): Promise<{ ok: boolean; error?: string }> {
  let card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  if (card.agentId && isRunning(card.agentId)) return { ok: true };

  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  /*
   * UNE CARTE D'UN PROJET RÉUNI NE LANCE AUCUN AGENT : c'est une carte MÈRE,
   * qui pose une carte fille dans chaque projet touché et les lance par ce
   * même chemin — chacune dans SON dépôt, sur SA branche
   * (`server/src/regroupements.ts`).
   */
  if (estUnRegroupement(project)) return lancerLaCarteMere(card, project, startCard);

  /*
   * LA CARTE PASSE EN « EN COURS » AU CLIC, PAS À LA FIN DE LA PRÉPARATION.
   *
   * Elle attendait jusqu'ici que la copie de travail soit ouverte — donc
   * jusqu'à plusieurs minutes sur un gros dépôt : pendant tout ce temps, elle
   * restait affichée dans « Planifié » alors que son lancement était bel et
   * bien parti, et l'utilisateur recliquait. Le déplacement est fait ici, avant
   * la moindre commande longue ; tout refus survenu ensuite la RAMÈNE d'où elle
   * vient (quatrième argument de `refus`).
   */
  const colonneAvant = card.column;
  const positionEnCours = card.column === 'running' ? card.position : store.nextPosition(card.projectId, 'running');
  /*
   * ET ELLE Y ENTRE AVEC SA MARQUE DE VOL, POSÉE DANS LE MÊME GESTE.
   *
   * Sans elle, la carte passait en « En cours » sans qu'aucun témoin ne dise
   * qu'un tour la tenait : pas encore d'agent (il est créé plus bas, après
   * l'ouverture de la copie de travail), pas encore de `tourEnVolDepuis`
   * (posé par `replacerCarteAuDemarrage`, à l'envoi de la demande). Le
   * balayage des cartes oubliées, qui repasse toutes les quinze secondes,
   * voyait donc une carte « en cours » que plus rien ne tenait et la fermait
   * en « Terminée » — d'où, l'interrupteur de déploiement automatique aidant,
   * des cartes qui sautaient en « À déployer » à la seconde de leur
   * lancement. La marque se pose AVANT la première commande longue, et le
   * refus qui suivrait la retire (`refus`).
   */
  if (card.column !== 'running' || !card.scheduling?.tourEnVolDepuis) {
    card = store.saveCard({
      ...card,
      column: 'running',
      position: positionEnCours,
      scheduling: {
        ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
        tourEnVolDepuis: card.scheduling?.tourEnVolDepuis ?? Date.now(),
        /*
         * ET LA SUSPENSION TOMBE ICI, PAS À LA FIN DE LA PRÉPARATION.
         *
         * Le départ efface la marque de suspension — c'est le geste qu'elle
         * attendait — mais il ne le faisait qu'APRÈS la copie de travail et le
         * choix du compte, soit plusieurs minutes plus loin. Une préparation qui
         * meurt dans cet intervalle (compte au jeton expiré, dépôt lent) laissait
         * donc la carte en « En cours » AVEC sa marque : l'état impossible que
         * plus rien ne range, puisque l'ordonnanceur s'interdit de reprendre une
         * carte suspendue. Constaté le 05.09.2026 sur une carte restée fantôme
         * près de trois heures. La marque tombe donc au même instant que le
         * déplacement en « En cours », comme la phrase qui l'accompagnait.
         */
        suspendu: false,
        waitingReason: undefined,
      },
    });
    bus.emit({ type: 'card.upsert', card });
  }
  const chrono = chronoDeLancement();
  etapeDeLancement(card, 'portes');

  /*
   * LE CADRAGE SE FERME ICI. Une carte née du « + » a discuté son besoin avec
   * un agent léger : cette discussion devient le CONTEXTE DE DÉPART de l'agent
   * d'exécution, et le niveau retenu pendant la discussion devient son MODÈLE.
   * Rien de tout cela n'existe sur une carte venue d'ailleurs : le tour reste
   * alors exactement celui d'avant.
   */
  /*
   * UNE RELANCE APRÈS RAPPORT reprend l'agent de cadrage ROUVERT (un agent de
   * tâche l'a suivi, `agentDeCadrage` ne le rendrait plus) et n'emporte que ce
   * qui s'est dit depuis la réouverture : le cadrage d'origine a déjà servi au
   * travail livré. La carte vient d'être posée en « En cours » : c'est la
   * colonne d'AVANT le clic (« Demande », « Plan », ou « Rapport » d'avant le
   * rattrapage) et la date de réouverture qui disent la relance.
   */
  const relance = cadrageRouvertApresRapport({ column: colonneAvant, parcours: card.parcours });
  const cadrage = relance ? cadrageDeLaCarte(cardId) : agentDeCadrage(cardId);
  const discussion = cadrage
    ? messagesDepuisLaRelance(store.listMessages(cadrage.id), relance ? card.parcours?.cadrageRouvertA : undefined)
    : [];
  /* LE PLAN RETENU PART EN CLAIR avec la discussion : c'est le chemin que
     l'utilisateur a relu et lancé (`card.parcours.plans`, dernière version). */
  const planRetenu = planCourant(card.parcours?.plans);
  /*
   * UN SEUL AGENT PAR CARTE : L'AGENT QUI A CADRÉ EXÉCUTE.
   *
   * La carte prend d'abord la suite du cadrage (titre, modèle quand elle n'en a
   * pas) ; on compare ENSUITE le réglage sur lequel la conversation a tourné à
   * celui avec lequel la carte part (`shared/src/agent-unique-de-carte.ts`).
   * Même moteur, même modèle : l'agent de cadrage devient l'agent d'exécution
   * et reprend SON fil — la discussion est déjà dans sa conversation, elle ne
   * se recopie plus. Moteur ou modèle changé, ou moteur qui ne reprend pas un
   * fil depuis un autre dossier : un nouvel agent prend le relais, et reçoit la
   * discussion en texte comme avant.
   */
  if (cadrage) card = await prendreLaSuiteDuCadrage(card, discussion, cadrage.run);
  const choixDeLAgent = cadrage ? agentDeLaCarteAuLancement(cadrage.run, card.run ?? cadrage.run) : null;
  /* Une reprise d'un AUTRE agent d'exécution passe devant (cartes cadrées
     avant l'agent unique) : la discussion doit alors lui être recopiée. */
  const autreAgentARependre =
    !!origineDeReprise(card) &&
    !!card.agentId &&
    card.agentId !== cadrage?.id &&
    store.getAgent(card.agentId)?.role === 'task';
  const agentUnique =
    cadrage && choixDeLAgent?.reprendre && !isRunning(cadrage.id) && !autreAgentARependre ? cadrage : null;
  if (cadrage && !agentUnique) {
    log.info(
      `lancement de « ${card.title} » : un nouvel agent prend le relais du cadrage — ${
        choixDeLAgent && !choixDeLAgent.reprendre ? raisonDuRelais(choixDeLAgent.raison) : 'le cadrage répond encore'
      }`,
    );
  }
  const contexteDuCadrage = cadrage
    ? contexteDeDepart(
        agentUnique ? [] : discussion,
        agentUnique
          ? []
          : [
              ...store.sujetsMemoireDemandes(cadrage.id),
              ...lecturesDeLaCarte(cardId),
            ],
        planRetenu
          ? { numero: planRetenu.numero, texte: planRetenu.texte, notesTechniques: planRetenu.notesTechniques }
          : undefined,
        /* LA PART TECHNIQUE DE LA COMPRÉHENSION PART AUSSI, avec ou sans plan :
           c'est elle qui porte les faits du projet que l'agent d'exécution
           n'irait pas chercher (deux tiers des tours ne l'ont jamais fait). */
        card.parcours?.comprehension?.partieTechnique,
      )
    : '';

  /*
   * Les portes dures d'abord, et pour TOUS les chemins de lancement. Sans
   * elles, un départ forcé sur une machine pleine ou un quota épuisé créait un
   * agent qui mourait aussitôt, en laissant la carte dans « En cours ».
   */
  chrono.etape('cadrage');
  const portes = await portesDures(card);
  chrono.etape('portes');
  if (!portes.ok) {
    etapeDeLancement(card);
    return refus(card, portes.reason ?? 'lancement impossible', portes.reprisePossible, colonneAvant);
  }

  /*
   * La branche est OBLIGATOIRE : sans elle, l'agent écrirait sur la branche
   * principale, ou sur celle d'un autre. Un échec ici REFUSE le lancement et
   * s'écrit sur la carte, au lieu de laisser partir un agent sur « main ».
   */
  etapeDeLancement(card, 'dossier');
  const prepa = await prepareBranch(project.path, card, project.branchesDePublication);
  chrono.etape('dossier');
  if (prepa.kind === 'echec') {
    etapeDeLancement(card);
    /*
     * UNE MACHINE PLEINE N'EST PAS UN DOSSIER CASSÉ.
     *
     * `git worktree add` meurt sur `spawn git EAGAIN` quand la table des
     * processus est saturée : rien n'est cassé, la place manque, et elle
     * revient dès qu'un agent voisin finit. C'était pourtant un refus
     * DÉFINITIF — la carte s'arrêtait là, sans reprise armée, et il fallait
     * recliquer. La même cause côté moteur est depuis longtemps une panne
     * passagère qui se retente toute seule ; les deux chemins disent
     * maintenant la même chose.
     */
    if (machinePleine(prepa.raison)) {
      log.warn(`lancement remis en file, machine pleine : ${prepa.raison.slice(0, 160)}`);
      return refus(card, RAISON_MACHINE_SATUREE, true, colonneAvant);
    }
    return refus(card, prepa.raison, false, colonneAvant);
  }
  etapeDeLancement(card, 'agent');
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
   * …ET UN SIMPLE NOUVEAU DÉPART AUSSI, tant que rien n'oblige à changer
   * d'agent. Une carte ramenée en « Planifié » puis relancée sans reprise à
   * honorer gardait son agent d'exécution sur le côté et en créait un autre :
   * elle garde désormais le sien, même moteur et même modèle à l'appui.
   */
  const agentDejaLa =
    !repris && !cadrage && card.agentId ? store.getAgent(card.agentId) : null;
  const memeAgent =
    agentDejaLa &&
    agentDejaLa.role === 'task' &&
    agentDejaLa.cardId === card.id &&
    agentDejaLa.projectId === card.projectId &&
    !isRunning(agentDejaLa.id) &&
    agentDeLaCarteAuLancement(agentDejaLa.run, card.run ?? agentDejaLa.run).reprendre
      ? agentDejaLa
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
  const agentGarde = repris ?? memeAgent;
  const agent = agentGarde
    ? // Les réglages et le titre suivent la CARTE : entre l'interruption et le
      // clic, l'utilisateur a pu changer de moteur, de modèle ou de titre.
      store.saveAgent({
        ...agentGarde,
        status: 'idle',
        title: card.title,
        run: card.run ?? agentGarde.run,
        workdir: prepa.dossier,
        endedAt: undefined,
      })
    : agentUnique
      ? /* L'agent de cadrage PASSE EN EXÉCUTION : même identifiant, même fil.
           Il change de rôle (outils d'édition ouverts, consigne d'exécution —
           la consigne système change ici UNE fois, à la bascule), de dossier
           (la copie de travail de la carte) et reçoit le briefing d'exécution
           à son premier tour. */
        store.saveAgent({
          ...agentUnique,
          role: 'task',
          status: 'idle',
          title: card.title,
          run: card.run ?? agentUnique.run,
          workdir: prepa.dossier,
          endedAt: undefined,
          briefingDExecutionAttendu: true,
        })
      : createAgent({
        projectId: card.projectId,
        role: 'task',
        title: card.title,
        cardId: card.id,
        run: card.run,
        workdir: prepa.dossier,
      });
  if (agentGarde || agentUnique) bus.emit({ type: 'agent.upsert', agent });

  /*
   * LE TRAVAIL DÉJÀ LÀ SE CONSTATE AVANT DE REPARTIR. Un tour coupé enregistre
   * parfois du code sans jamais pouvoir ranger sa carte : le drapeau n'est donc
   * pas posé, et la reprise se verrait reprocher de « n'avoir rien changé »
   * alors qu'il n'y avait plus rien à changer.
   */
  const dejaEnregistre =
    card.codeDejaEnregistre ||
    (!!origine &&
      (await travailDejaSurLaBranche(
        project.path,
        branch,
        prepa.dossier,
        project.branchesDePublication,
      ).catch(() => false)));

  const running = store.saveCard({
    ...card,
    column: 'running',
    // La place a été prise au CLIC, quand la carte est passée en « En cours » :
    // la reprendre ici la ferait sauter sous les yeux de qui la regardait.
    position: positionEnCours,
    agentId: agent.id,
    /* Une relance repart d'un travail DÉJÀ livré, et referme sa réouverture :
       la date de clôture et la phrase du rapport d'avant ne disent plus rien. */
    codeDejaEnregistre: dejaEnregistre || relance,
    ...(relance
      ? {
          doneAt: undefined,
          sansModification: undefined,
          parcours: { ...(card.parcours ?? { plans: [] }), cadrageRouvertA: undefined },
        }
      : {}),
    // Pour un projet à plusieurs dépôts, la base de chaque annexe s'ajoute à côté.
    github: avecLesBasesAnnexes(
      {
        ...(card.github ?? { checks: [], commits: [], fichiers: [], activity: [] }),
        branch,
        // La base n'est notée qu'à la CRÉATION de la branche, et jamais réécrite :
        // c'est elle qui dira, même après la fusion, ce que cette carte a touché.
        baseSha: card.github?.baseSha ?? prepa.base,
      },
      prepa.annexes ?? [],
    ),
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      attempts: (card.scheduling?.attempts ?? 0) + 1,
      waitingReason: undefined,
      // Un départ efface la suspension : c'est le geste qu'elle attendait.
      suspendu: false,
      // …et il honore la reprise armée par un refus de quota : elle a servi.
      reprendreDesQuePossible: undefined,
      // Le départ CONSOMME la date : une date, une fois, jamais une récurrence.
      // Sans cela, une carte relancée plus tard traînerait une heure déjà passée
      // et repartirait toute seule à la première boucle.
      departPrevu: undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card: running });
  chrono.etape('agent');
  etapeDeLancement(running, 'moteur');

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

  /* L'agent qui a cadré apprend qu'il passe en exécution, et ce qui change pour lui. */
  const bascule = agentUnique && !repris ? `${CONSIGNE_DE_BASCULE}\n\n` : '';
  const prompt = `${bascule}${contexteDuCadrage ? `${contexteDuCadrage}\n\n` : ''}${reprise}Réalise cette tâche.

TITRE : ${card.title}
${card.description || '(pas de description)'}

${blocDeSyntheseDuBesoin(card.briefing)}Tu travailles sur la branche « ${branch} », dans le dossier « ${prepa.dossier} » — une copie de travail à toi seul, créée pour cette carte. Reste dedans : n'en change pas et ne change pas de branche. Beluga Build fusionne ta branche dans la principale et referme ce dossier dès que tu as rendu ; ne le fais pas toi-même.
${prepa.annexes?.length ? `\n${consigneDesDepots(branch, prepa.dossier, prepa.annexes)}\n` : ''}
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
  /*
   * LA PRÉPARATION EST FINIE : le tour part au moteur, et c'est lui qui parle
   * désormais (étapes du tour, liste de tâches, réponse). L'écran retire donc
   * sa barre d'avancement de préparation.
   */
  const finDeLaPreparation = () => etapeDeLancement(running);

  /*
   * ET ELLE DIT CE QU'ELLE A COÛTÉ, ÉTAPE PAR ÉTAPE. C'est la seule trace qui
   * permette de corriger la lenteur d'un départ sans deviner : le poste le plus
   * cher se lit d'un coup d'œil dans le journal du démon.
   */
  log.info(chrono.bilan(card.title));

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
      // Le tour est allé jusqu'au bout : plus rien à préparer.
      finDeLaPreparation();
      /*
       * Le chiffrage voyage dans la réponse du tour de lancement. Beluga Build y
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
         * Le passage en « Terminée » est déjà fait : la carte suit l'issue de
         * son tour (`carteApresFinDeTour`). On ne prévient que si elle y est
         * VRAIMENT arrivée : un tour qui répond sans rien modifier au dépôt
         * renvoie la carte en file, il n'y a donc pas de travail à annoncer.
         */
        if (fresh.column === COLONNE_DE_FIN_DE_TOUR) {
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
        // Une tâche finie est l'un des TROIS motifs qui alertent : le message
        // est un « success », son motif dit qu'il s'affiche quand même.
        bus.toast('success', `Agent terminé : ${fresh.title}`, fresh.id, 'tache-terminee');
      } else {
        bus.toast('error', `Agent en échec : ${fresh.title}`, fresh.id, 'tache-echec');
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
    // Une panne du lancement lui-même referme aussi la barre de préparation :
    // rien ne prépare plus rien, et l'erreur est dite juste en dessous.
    finDeLaPreparation();
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
  /*
   * ET LES ÉTAPES OUVERTES PAR UN TOUR MORT. Une carte de cadrage ne quitte
   * jamais « Planifié » : le balayage ci-dessus ne la voit pas, et sa demande
   * de plan restait allumée pour toujours. Celui-ci la referme sur l'incident
   * déjà dessiné.
   */
  try {
    refermerLesEtapesSansTour();
  } catch (err) {
    log.error('fermeture des étapes sans tour', err);
  }
  /*
   * LA FILE D'UN AGENT AU REPOS. Une demande empilée faute de quota n'a plus
   * aucune fin de tour derrière elle pour la dépiler : ce troisième geste va la
   * chercher. Il est le SEUL du filet à demander une lecture de quota, donc le
   * seul qui attende — il part de côté pour ne pas retenir les deux autres, qui
   * doivent rester strictement synchrones.
   */
  void reprendreLesFilesEnAttente().catch((err) => log.error('reprise des files en attente', err));
  /*
   * LE DÉPLOIEMENT AUTOMATIQUE, sur les seuls projets dont l'interrupteur de la
   * colonne « Terminé » est allumé. Il part de côté lui aussi : lancer une
   * publication n'est pas instantané, et le filet doit rester synchrone. Son
   * verrou interne empêche deux passages de se superposer.
   */
  /*
   * Les publications dont plus personne ne tient le fil sont refermées AVANT
   * de juger un nouveau départ : sans cela, une publication fantôme « en
   * cours » retiendrait le lot indéfiniment.
   */
  try {
    balayerLesPublicationsSansPorteur();
  } catch (err) {
    log.error('balayage des publications sans porteur', err);
  }
  void passageDuDeploiementAutomatique().catch((err) => log.error('déploiement automatique', err));
  /*
   * ET LE REDÉMARRAGE RETENU EST REJOUÉ ICI, à chaque passage.
   *
   * Publier Beluga Build écrit le nouveau code sur le disque ; le démon en marche
   * garde celui qu'il a chargé à son lancement. Quand l'étape « redémarrage »
   * de la publication ne peut pas partir — un agent travaille, une autre
   * publication tourne —, la demande est RETENUE
   * (`etapeDeRedemarrageDePublication`) et rejouée par ce qui finit : la fin de
   * tout tour d'agent et la fin de toute publication l'appellent déjà.
   *
   * Ce passage-ci est le FILET de ces deux chemins : ils tiennent tous les deux
   * à un `finally`, et une demande retenue qu'un tour perdu ne rejouerait jamais
   * laisserait le nouveau code dormir sur le disque jusqu'au prochain geste à la
   * main — c'est précisément ce qui a fait qu'un correctif publié le 20/08/2026
   * n'a jamais tourné. Un point de passage régulier ne dépend, lui, de rien.
   *
   * La règle pure ne bouge pas : rien ne part tant qu'un agent travaille ou
   * qu'une publication tourne, et rien n'est demandé si personne n'a rien
   * demandé (`redemarrageEnAttente`).
   */
  try {
    appliquerRedemarrageEnAttente();
  } catch (err) {
    log.error('redémarrage retenu', err);
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
      /* Les DEUX colonnes d'avant le travail : une carte posée dans « Plan »
         porte le même départ programmé et le même « dès que possible » qu'une
         carte de « Demande » — l'oublier la laisserait attendre pour toujours. */
      const planned = COLONNES_AVANT_LE_TRAVAIL.flatMap((colonne) => store.listCardsInColumn(project.id, colonne)).sort(
        (a, b) => (b.scheduling?.asap ? 1 : 0) - (a.scheduling?.asap ? 1 : 0) || a.createdAt - b.createdAt,
      );

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
        /* Une carte RELANCÉE a déjà été lancée : ses essais ne valent pas un
           nouveau clic, elle attend le sien (`relanceRetenueAvantLancement`). */
        if (relanceRetenueAvantLancement(card)) continue;
        /*
         * ET LE CADRAGE ENCORE OUVERT RETIENT LA CARTE. Une carte née du « + »
         * discute son besoin : tant qu'aucun plan n'en est sorti, il n'y a rien
         * à exécuter. Les cartes neuves n'ont plus de date du tout
         * (`createCard`) ; ce refus couvre celles qui en portent déjà une.
         */
        if (
          cartePrisonniereDuCadrage({
            aUnCadrage: !!agentDeCadrage(card.id),
            plansRendus: card.parcours?.plans?.length ?? 0,
          })
        ) {
          continue;
        }
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

      /*
       * LES LANCEMENTS REFUSÉS FAUTE DE QUOTA, HORS DE « PLANIFIÉ ».
       *
       * La boucle ci-dessus ne regarde que « Planifié », ce qui couvre la
       * quasi-totalité des cas. Mais un lancement se demande aussi depuis une
       * autre colonne — une carte de « Notes » ou de « Terminé » déposée dans
       * « En cours » : la porte du quota la refuse AVANT tout changement de
       * colonne, la carte reste donc là où elle était, armée pour la reprise…
       * et personne ne repassait jamais la voir. Ce second passage ne prend que
       * les cartes PORTANT LA MARQUE, c'est-à-dire celles dont le lancement a
       * réellement été demandé puis refusé par une porte qui se rouvre seule.
       */
      const armees = store
        .cartesArmeesPourReprise(project.id)
        .filter((card) => !COLONNES_AVANT_LE_TRAVAIL.includes(card.column) && card.column !== 'running')
        // Les fins de parcours ne se rouvrent que sur geste humain : une marque
        // oubliée sur une carte archivée entre-temps ne la ressuscite pas.
        .filter((card) => !COLONNES_HORS_REPRISE.includes(card.column))
        .filter((card) => card.scheduling?.reprendreDesQuePossible && !card.scheduling.suspendu);

      for (const card of armees) {
        if (card.agentId && isRunning(card.agentId)) continue;
        const gate = await portesDures(card);
        if (!gate.ok) continue;
        await startCard(card.id);
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
  const occupants = occupantsDesDossiers();
  // Les copies ANNEXES des cartes au travail sont occupées elles aussi.
  const occupes = [
    ...occupants.map((o) => o.dossier),
    ...copiesAnnexesOccupees(occupants.map((o) => o.cardId)),
  ];
  for (const project of store.listProjects()) {
    // Le principal, puis chaque dépôt annexe : leurs copies se rangent pareil.
    for (const racine of depotsDuProjet(project).map((d) => d.path)) {
      if (!(await estUnDepotGit(racine))) continue;
      const rattrapes = await menageDesDossiers(racine, occupes).catch((err) => {
        log.warn('ménage des dossiers de cartes impossible', String(err).slice(0, 200));
        return [];
      });
      for (const rattrape of rattrapes) {
        if (!rattrape.enregistre && !rattrape.fusionnee) continue;
        marquerCodeDejaEnregistre(project.id, rattrape.branche, rattrape.enregistre);
      }
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
