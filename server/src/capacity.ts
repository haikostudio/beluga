import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CapacityEtat,
  ChargeMachine,
  DUREE_ALERTE_MINUTES,
  SEUIL_ALERTE_CHARGE_PCT,
  SEUIL_ALERTE_MEM_PCT,
  SEUIL_ALERTE_TACHES_PCT,
  SEUIL_PAUSE_MEM_PCT,
  SEUIL_PAUSE_TACHES_PCT,
  SystemProcess,
  etatDeLEchange,
  freinDeCharge,
  partDesTaches,
  phraseDeLEchange,
  placesSelonLesTaches,
  pressionDesTaches,
  pressionMemoire,
  pressionDeProcessus,

} from '@beluga/shared';
import * as store from './store.js';
import { runningAgentIds, pidFor, stopAgent } from './runtime.js';
import { bus } from './bus.js';
import { notify } from './notify.js';
import { log } from './logger.js';

/**
 * L'identifiant de Beluga Build dans la liste des processus. Le service s'appelle
 * désormais `beluga.service` ; l'ancien identifiant reste accepté à l'entrée pour
 * qu'un écran resté ouvert avant la bascule ne croie pas pouvoir éteindre le démon.
 */
const SERVICE_DE_BELUGA = 'service:beluga.service';

const execFileAsync = promisify(execFile);

/** Mémoire supposée d'un agent tant qu'aucune mesure n'existe encore. */
const FALLBACK_AGENT_MEM_MB = 420;
/** On garde toujours cette marge pour le système et les autres services. */
const RESERVED_MEM_MB = 1200;

let alertSince: number | null = null;
let alertSent = false;
let manualPause = false;

function memoryMb(): { used: number; total: number } {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key: string) => {
      const match = info.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
      return match ? Number(match[1]) / 1024 : 0;
    };
    const total = get('MemTotal');
    const available = get('MemAvailable');
    return { used: Math.round(total - available), total: Math.round(total) };
  } catch {
    const total = os.totalmem() / 1024 / 1024;
    const free = os.freemem() / 1024 / 1024;
    return { used: Math.round(total - free), total: Math.round(total) };
  }
}

/**
 * Part du fichier d'échange déjà consommée, ou `undefined` si la machine n'en a
 * pas. Une mémoire vive à 75 % pendant que le swap est plein annonce l'OOM :
 * c'est ce que la jauge ne voyait pas.
 */
function echangeMb(): { used: number; total: number } | undefined {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key: string) => {
      const match = info.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
      return match ? Number(match[1]) : 0;
    };
    const total = get('SwapTotal');
    if (!total) return undefined;
    const free = get('SwapFree');
    return { used: Math.round((total - free) / 1024), total: Math.round(total / 1024) };
  } catch {
    return undefined;
  }
}

function swapPct(): number | undefined {
  const echange = echangeMb();
  if (!echange || !echange.total) return undefined;
  return Math.round((echange.used / echange.total) * 100);
}

/* ------------------------------------------------------------------ */
/* Le plafond de TÂCHES du service                                     */
/* ------------------------------------------------------------------ */

/**
 * Le cgroup du démon, tel que le noyau le nomme.
 *
 * `/proc/self/cgroup` rend une ligne « 0::/system.slice/beluga.service » en
 * cgroup v2 : on lit donc le VRAI cgroup en marche, quel que soit le nom de
 * l'unité systemd qui porte le démon.
 */
function cheminDuCgroup(): string | undefined {
  try {
    const brut = fs.readFileSync('/proc/self/cgroup', 'utf8');
    for (const ligne of brut.split('\n')) {
      const v2 = /^0::(.+)$/.exec(ligne.trim());
      if (v2) return v2[1];
    }
  } catch {
    /* pas de cgroup lisible : la machine n'en a pas, ou l'accès est refusé */
  }
  return undefined;
}

/**
 * LA TABLE DES PROCESSUS : combien de fils tournent, et jusqu'où on peut aller.
 *
 * `/proc/loadavg` finit par « prêts/total » : le second nombre est le total des
 * fils d'exécution de la machine. Le plafond est le PLUS BAS des deux murs — la
 * limite du compte qui fait tourner le démon (`/proc/self/limits`) et celle de
 * la machine entière (`threads-max`) : c'est le premier atteint qui rend
 * « Cannot fork ».
 *
 * Une machine qui ne dit pas ses limites rend `max: 0` : on ne suspend alors
 * rien — inventer un mur serait pire que de ne pas en voir.
 */
function filsDeLaMachine(): { utilises: number; max: number } {
  try {
    const charge = fs.readFileSync('/proc/loadavg', 'utf8');
    const fils = charge.trim().split(/\s+/)[3] ?? '';
    const utilises = Number(fils.split('/')[1] ?? 0);
    const limites = fs.readFileSync('/proc/self/limits', 'utf8');
    const parCompte = Number(limites.match(/^Max processes\s+(\d+)/m)?.[1] ?? 0);
    const parMachine = Number(fs.readFileSync('/proc/sys/kernel/threads-max', 'utf8').trim());
    const murs = [parCompte, parMachine].filter((v) => Number.isFinite(v) && v > 0);
    return {
      utilises: Number.isFinite(utilises) ? utilises : 0,
      max: murs.length ? Math.min(...murs) : 0,
    };
  } catch {
    return { utilises: 0, max: 0 };
  }
}

function lireEntier(chemin: string): number | undefined {
  try {
    const texte = fs.readFileSync(chemin, 'utf8').trim();
    // « max » = aucun plafond : ce n'est pas un nombre, et ce n'est pas zéro.
    if (!texte || texte === 'max') return undefined;
    const valeur = Number(texte);
    return Number.isFinite(valeur) ? valeur : undefined;
  } catch {
    return undefined;
  }
}

export interface CompteursDeTaches {
  courant?: number;
  plafond?: number;
  /** Combien de fois le plafond a refusé un `fork` depuis le démarrage. */
  refus?: number;
}

/**
 * CE QUE LE SERVICE CONSOMME DE SON PLAFOND DE TÂCHES.
 *
 * Le verrou qui a refusé le `fork` du 08.09.2026 n'était pas la mémoire : le
 * service tournait sous `TasksMax=512` et en occupait déjà 286. Ce compteur-là
 * n'était lu nulle part — la jauge annonçait donc de la place pendant que la
 * machine refusait de lancer un programme de plus.
 *
 * Tout est `undefined` quand la machine n'a pas de cgroup ou que son plafond
 * est illimité : on ne devine jamais un verrou qu'on n'a pas lu.
 */
export function compteursDeTaches(): CompteursDeTaches {
  const chemin = cheminDuCgroup();
  if (!chemin) return {};
  const base = `/sys/fs/cgroup${chemin === '/' ? '' : chemin}`;
  const courant = lireEntier(`${base}/pids.current`);
  const plafond = lireEntier(`${base}/pids.max`);
  let refus: number | undefined;
  try {
    const evenements = fs.readFileSync(`${base}/pids.events`, 'utf8');
    const trouve = /^max (\d+)$/m.exec(evenements);
    if (trouve) refus = Number(trouve[1]);
  } catch {
    /* le fichier n'existe pas sur toutes les versions du noyau */
  }
  return { courant, plafond, refus };
}

/** Dernière lecture des compteurs d'échange : le débit est une DIFFÉRENCE. */
let dernierEchange: { pages: number; at: number } | null = null;

/**
 * Le DÉBIT du fichier d'échange, en kilo-octets par seconde.
 *
 * Le remplissage ne dit rien : c'est le va-et-vient des pages qui fait ramer la
 * machine. `/proc/vmstat` compte les pages entrées et sorties depuis le
 * démarrage ; on en prend la différence entre deux lectures. La toute première
 * lecture ne rend donc rien — il n'y a encore rien à soustraire.
 */
function debitDEchangeKoS(): number | undefined {
  try {
    const stats = fs.readFileSync('/proc/vmstat', 'utf8');
    const compteur = (cle: string) => {
      const m = stats.match(new RegExp(`^${cle} (\\d+)`, 'm'));
      return m ? Number(m[1]) : 0;
    };
    const pages = compteur('pswpin') + compteur('pswpout');
    const at = Date.now();
    const avant = dernierEchange;
    dernierEchange = { pages, at };
    if (!avant) return undefined;
    const secondes = (at - avant.at) / 1000;
    if (secondes <= 0) return undefined;
    // Une page vaut 4 ko sur toutes les machines que ce démon connaît.
    return Math.round(((pages - avant.pages) * 4) / secondes);
  } catch {
    return undefined;
  }
}

/**
 * Charge en % des cœurs : 100 = un processus prêt par cœur, 200 = file d'attente
 * double. On lit l'INSTANT (une minute) ET le SOUTENU (quinze minutes) : seule
 * une charge qui dure dit quelque chose d'une machine vraiment saturée.
 */
function chargeMachine(): ChargeMachine {
  const [une, , quinze] = os.loadavg();
  const coeurs = Math.max(1, os.cpus().length);
  return {
    instantPct: Math.round((une / coeurs) * 100),
    soutenuePct: Math.round((quinze / coeurs) * 100),
  };
}

/** Les agents qui tournent, séparés par rôle : les TÂCHES d'un côté, le reste de l'autre. */
function comptesDAgents(): { total: number; taches: number } {
  const ids = runningAgentIds();
  let taches = 0;
  for (const id of ids) {
    // Une carte du tableau, c'est un agent de rôle « task » : le chef
    // d'orchestre, l'analyse de nuit et la publication ne s'y voient pas.
    if (store.getAgent(id)?.role === 'task') taches += 1;
  }
  return { total: ids.length, taches };
}

/**
 * Le chiffre qui compte : « N agents peuvent encore démarrer ».
 * CALCULÉ à partir de la mémoire libre et de ce qu'un agent consomme en
 * moyenne — mesuré sur les agents précédents, pas supposé (PLAN §27).
 */
export function etatCapacite(): CapacityEtat {
  const settings = store.getSettings();
  const mem = memoryMb();
  const charge = chargeMachine();
  const load = charge.instantPct;
  const { total: running, taches } = comptesDAgents();
  const measured = store.averageAgentMemMb();
  const perAgent = measured && measured > 50 ? measured : FALLBACK_AGENT_MEM_MB;

  const freeForAgents = Math.max(0, mem.total - mem.used - RESERVED_MEM_MB);
  const byMemory = Math.floor(freeForAgents / perAgent);
  const byCeiling = Math.max(0, settings.maxAgents - running);

  const memPct = Math.round((mem.used / mem.total) * 100);
  // Seules la mémoire et la main de l'utilisateur SUSPENDENT : une charge
  // processeur, si haute soit-elle, n'est jamais une suspension. La mémoire, ici,
  // c'est la vive ET le fichier d'échange — c'est lui qui sature en premier.
  const echange = echangeMb();
  const echangePct = swapPct();
  const echangeDebit = debitDEchangeKoS();
  const pression = pressionMemoire(memPct, echangePct);
  /*
   * LE PLAFOND DE TÂCHES SUSPEND AUSSI. Un cgroup plein refuse tout `fork` de
   * plus, à mémoire large : c'est le verrou qui a bloqué la publication du
   * 08.09.2026 pendant que la jauge annonçait de la place.
   */
  const tachesDuService = compteursDeTaches();
  const pressionTaches = pressionDesTaches(tachesDuService.courant, tachesDuService.plafond);
  /*
   * …ET LA TABLE DES PROCESSUS, qui se remplit sans que la mémoire bouge. Elle
   * suspend au même titre que la mémoire vive : atteinte, elle ne fait pas
   * échouer le tour « pour une raison inconnue », elle met le lancement en
   * file avec sa cause écrite (`portesDures`, reprise possible).
   */
  const fils = filsDeLaMachine();
  const pressionFils = pressionDeProcessus(fils.utilises, fils.max);
  const paused = manualPause || pression.suspendre || pressionTaches.suspendre || pressionFils.suspendre;

  // La PLACE, c'est la mémoire, le plafond d'agents et le plafond de TÂCHES du
  // service — rien d'autre. C'est elle que la barre montre, et ce qu'annonce
  // « N agents peuvent encore démarrer ».
  const parTaches = placesSelonLesTaches(tachesDuService.courant, tachesDuService.plafond);
  const places = paused
    ? 0
    : Math.max(0, Math.min(byMemory, byCeiling, parTaches === null ? Infinity : parTaches));

  // La charge, elle, FREINE : elle réduit les départs simultanés sans jamais se
  // déguiser en manque de place, et sa cause se dit en clair.
  const frein = freinDeCharge(charge);
  const slotsFree = frein.placesMax === null ? places : Math.min(places, frein.placesMax);

  return {
    loadPct: Math.max(Math.min(load, 100), memPct),
    cpuLoadPct: load,
    cpuLoadSustainedPct: charge.soutenuePct,
    memUsedMb: mem.used,
    memTotalMb: mem.total,
    cpuCount: os.cpus().length,
    runningAgents: running,
    runningTasks: taches,
    maxAgents: settings.maxAgents,
    slotsFree: places,
    placesParMemoire: byMemory,
    placesParTaches: parTaches === null ? undefined : parTaches,
    startableNow: slotsFree,
    paused,
    pauseReason: paused
      ? manualPause
        ? 'Départs suspendus manuellement'
        : (pression.raison ?? pressionTaches.raison ?? pressionFils.raison)
      : undefined,
    filsUtilises: fils.max ? fils.utilises : undefined,
    filsMax: fils.max || undefined,
    filsPct: fils.max ? pressionFils.partPct : undefined,
    loadHoldReason: frein.raison,
    avgAgentMemMb: Math.round(perAgent),
    // Le fichier d'échange : son remplissage ET son débit. Le second seul dit
    // si la machine rame vraiment ; le premier ne fait que décrire un rangement.
    swapUsedMb: echange?.used,
    swapTotalMb: echange?.total,
    swapPct: echangePct,
    swapDebitKoS: echangeDebit,
    // Le plafond de tâches : la donnée qui manquait pour comprendre un « Cannot
    // fork » survenu à mémoire large.
    tasksCurrent: tachesDuService.courant,
    tasksMax: tachesDuService.plafond,
    tasksPct: partDesTaches(tachesDuService.courant, tachesDuService.plafond),
    tasksRefus: tachesDuService.refus,
    at: Date.now(),
  };
}

/**
 * Le message de refus doit désigner la vraie limite tombée à zéro, pas
 * toujours le plafond d'agents : `slotsFree` est le plus petit de trois murs
 * indépendants (mémoire, plafond d'agents, réserve de tâches du service), et
 * seul celui qui vaut ce minimum est la cause réelle du blocage.
 */
export function raisonDuPlafond(snap: CapacityEtat): string {
  const byMemory = snap.placesParMemoire;
  const byTaches = snap.placesParTaches;
  const byCeiling = Math.max(0, snap.maxAgents - snap.runningAgents);
  const candidats: Array<{ valeur: number; raison: string }> = [];
  if (byMemory !== undefined) {
    candidats.push({
      valeur: byMemory,
      raison: `Mémoire disponible insuffisante pour lancer un agent de plus (chaque agent consomme environ ${snap.avgAgentMemMb ?? FALLBACK_AGENT_MEM_MB} Mo).`,
    });
  }
  if (byTaches !== undefined) {
    candidats.push({
      valeur: byTaches,
      raison: `Réserve de tâches du service presque pleine (${snap.tasksCurrent} sur ${snap.tasksMax}) : impossible de lancer un agent de plus pour l'instant.`,
    });
  }
  candidats.push({
    valeur: byCeiling,
    raison: `Plafond atteint : ${snap.runningAgents} agents tournent déjà (maximum ${snap.maxAgents})`,
  });
  const minimum = Math.min(...candidats.map((c) => c.valeur));
  return candidats.find((c) => c.valeur === minimum)!.raison;
}

export function canStartAgent(): { ok: boolean; reason?: string } {
  const snap = etatCapacite();
  if (snap.paused) return { ok: false, reason: snap.pauseReason };
  if (snap.slotsFree <= 0) {
    return { ok: false, reason: raisonDuPlafond(snap) };
  }
  // Le frein processeur refuse pour SA raison, jamais pour un manque de place.
  if ((snap.startableNow ?? snap.slotsFree) <= 0) {
    return { ok: false, reason: snap.loadHoldReason ?? 'La machine est trop chargée pour lancer un agent de plus.' };
  }
  return { ok: true };
}

/** Échantillonnage régulier : la courbe 24 h et l'alerte prolongée. */
export function sampleCapacity(): void {
  const snap = etatCapacite();
  store.recordCapacity(snap.loadPct, snap.memUsedMb, snap.runningAgents);
  bus.emit({ type: 'capacity', capacity: snap });

  /* Seuils fixés par le système (`shared/src/capacite.ts`), plus un réglage. */
  if (snap.loadPct >= SEUIL_ALERTE_CHARGE_PCT) {
    if (alertSince === null) alertSince = Date.now();
    const minutes = (Date.now() - alertSince) / 60000;
    if (minutes >= DUREE_ALERTE_MINUTES && !alertSent) {
      alertSent = true; // une seule alerte, pas une par minute
      // La charge de la machine ne réveille plus personne : elle se lit dans
      // la barre de capacité, où elle a toujours été visible.
      notify({
        motif: 'charge-machine',
        title: 'Serveur très chargé',
        // On ne promet plus une suspension qui n'a pas forcément lieu : c'est
        // la mémoire qui suspend, la charge ne fait que ralentir.
        body: `Charge à ${snap.loadPct} % depuis ${Math.round(minutes)} minutes.${
          snap.loadHoldReason ? ` ${snap.loadHoldReason}` : ''
        }`,
      });
    }
  } else {
    // Le silence ne revient qu'une fois la situation détendue.
    alertSince = null;
    alertSent = false;
  }

  alerterSurLaMemoire(snap, DUREE_ALERTE_MINUTES);
  alerterSurLesTaches(snap, DUREE_ALERTE_MINUTES);
}

/** Depuis quand le plafond de tâches est-il proche, et l'a-t-on déjà dit ? */
let tachesAlerteDepuis: number | null = null;
let tachesAlerteEnvoyee = false;

/**
 * PRÉVENIR AVANT QUE LE `fork` SOIT REFUSÉ.
 *
 * Le plafond de tâches suspend les départs à `SEUIL_PAUSE_TACHES_PCT`. On
 * alerte dès `SEUIL_ALERTE_TACHES_PCT` tenus, exactement comme pour la mémoire
 * vive : ce verrou était jusqu'ici muet, et son refus tombait sans un mot.
 */
function alerterSurLesTaches(snap: CapacityEtat, minutesReglees: number): void {
  const part = snap.tasksPct;
  if (part === undefined || part < SEUIL_ALERTE_TACHES_PCT) {
    tachesAlerteDepuis = null;
    tachesAlerteEnvoyee = false;
    return;
  }
  if (tachesAlerteDepuis === null) tachesAlerteDepuis = Date.now();
  const minutes = (Date.now() - tachesAlerteDepuis) / 60000;
  if (minutes < minutesReglees || tachesAlerteEnvoyee) return;
  tachesAlerteEnvoyee = true;
  notify({
    motif: 'memoire-machine',
    title: 'Plafond de tâches du service bientôt atteint',
    body:
      `Le service occupe ${snap.tasksCurrent} des ${snap.tasksMax} tâches de son plafond (${part} %) depuis ` +
      `${Math.round(minutes)} minutes. Au-delà de ${SEUIL_PAUSE_TACHES_PCT} %, les départs seront suspendus : ` +
      `sans cela, la machine refuserait de lancer un programme de plus.`,
  });
}

/** Depuis quand la mémoire vive est-elle tendue, et l'a-t-on déjà dit ? */
let memAlerteDepuis: number | null = null;
let memAlerteEnvoyee = false;

/**
 * PRÉVENIR avant de suspendre.
 *
 * Les départs s'arrêtent à 94 % de mémoire vive. On alerte dès 85 % TENUS
 * pendant la durée réglée, pour que la suspension ne tombe jamais sans
 * avertissement. Une pointe d'une minute ne réveille personne, et le message ne
 * part qu'une fois : le silence ne revient qu'une fois la mémoire redescendue.
 */
function alerterSurLaMemoire(snap: CapacityEtat, minutesReglees: number): void {
  const memPct = snap.memTotalMb ? Math.round((snap.memUsedMb / snap.memTotalMb) * 100) : 0;
  if (memPct < SEUIL_ALERTE_MEM_PCT || snap.paused) {
    memAlerteDepuis = null;
    memAlerteEnvoyee = false;
    return;
  }
  if (memAlerteDepuis === null) memAlerteDepuis = Date.now();
  const minutes = (Date.now() - memAlerteDepuis) / 60000;
  if (minutes < minutesReglees || memAlerteEnvoyee) return;
  memAlerteEnvoyee = true;
  const echange =
    snap.swapPct === undefined
      ? ''
      : ` Fichier d'échange à ${snap.swapPct} % (${phraseDeLEchange(
          etatDeLEchange(snap.swapPct, snap.swapDebitKoS),
        )}).`;
  notify({
    motif: 'memoire-machine',
    title: 'Mémoire vive tendue',
    body:
      `Mémoire à ${memPct} % depuis ${Math.round(minutes)} minutes. Les départs seront ` +
      `suspendus au-delà de ${SEUIL_PAUSE_MEM_PCT} %.${echange}`,
  });
}

/* ------------------------------------------------------------------ */
/* Ce qui tourne en ce moment                                          */
/* ------------------------------------------------------------------ */

async function processStats(pid: number): Promise<{ memMb: number; cpuPct: number } | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], { timeout: 4000 });
    const [rss, cpu] = stdout.trim().split(/\s+/);
    return { memMb: Number(rss) / 1024, cpuPct: Number(cpu) };
  } catch {
    return null;
  }
}

async function serviceStats(unit: string): Promise<{ memMb: number; active: boolean } | null> {
  try {
    const { stdout } = await execFileAsync(
      'systemctl',
      ['show', unit, '--property=MemoryCurrent,ActiveState,ExecMainStartTimestamp'],
      { timeout: 5000 },
    );
    const values = Object.fromEntries(
      stdout
        .trim()
        .split('\n')
        .map((line) => line.split('=') as [string, string]),
    );
    const mem = Number(values.MemoryCurrent);
    return {
      memMb: Number.isFinite(mem) && mem > 0 ? mem / 1024 / 1024 : 0,
      active: values.ActiveState === 'active',
    };
  } catch {
    return null;
  }
}

let cachedUnits: string[] | null = null;

async function projectUnits(): Promise<string[]> {
  if (cachedUnits) return cachedUnits;
  try {
    const { stdout } = await execFileAsync(
      'systemctl',
      ['list-units', '--type=service', '--all', '--no-legend', '--plain', 'autoproject-*.service'],
      { timeout: 8000 },
    );
    cachedUnits = stdout
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((unit) => unit && unit.endsWith('.service'));
  } catch {
    cachedUnits = [];
  }
  return cachedUnits;
}

export async function listProcesses(): Promise<SystemProcess[]> {
  const out: SystemProcess[] = [];

  for (const agentId of runningAgentIds()) {
    const agent = store.getAgent(agentId);
    if (!agent) continue;
    const pid = pidFor(agentId);
    const stats = pid ? await processStats(pid) : null;
    if (stats && agent.cardId) store.recordAgentMem(agentId, stats.memMb);
    const project = store.getProject(agent.projectId);
    out.push({
      id: `agent:${agentId}`,
      kind: 'agent',
      label: agent.title,
      detail: `${project?.name ?? 'projet'} · ${agent.run.engine}`,
      memMb: Math.round(stats?.memMb ?? 0),
      cpuPct: Math.round(stats?.cpuPct ?? 0),
      since: agent.startedAt,
      canStop: true,
      running: true,
      projectId: agent.projectId,
      cardId: agent.cardId,
    });
  }

  for (const unit of await projectUnits()) {
    const stats = await serviceStats(unit);
    if (!stats) continue;
    out.push({
      id: `service:${unit}`,
      kind: 'service',
      label: unit.replace(/^autoproject-/, '').replace(/\.service$/, ''),
      detail: 'serveur de projet',
      memMb: Math.round(stats.memMb),
      cpuPct: 0,
      canStop: true,
      running: stats.active,
    });
  }

  // Beluga Build lui-même : visible, mais impossible à éteindre depuis sa propre
  // interface — ce serait scier la branche (PLAN §27).
  out.push({
    id: SERVICE_DE_BELUGA,
    kind: 'service',
    label: 'Beluga Build',
    detail: 'cette application',
    memMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    cpuPct: 0,
    canStop: false,
    running: true,
  });

  return out.sort((a, b) => b.memMb - a.memMb);
}

export async function controlProcess(id: string, action: 'start' | 'stop'): Promise<{ ok: boolean; error?: string }> {
  if (id === SERVICE_DE_BELUGA) {
    return { ok: false, error: "Beluga Build ne peut pas s'éteindre depuis sa propre interface." };
  }
  if (id.startsWith('agent:')) {
    if (action === 'start') return { ok: false, error: 'Un agent se relance depuis sa carte.' };
    return { ok: stopAgent(id.slice('agent:'.length)) };
  }
  if (id.startsWith('service:')) {
    const unit = id.slice('service:'.length);
    if (!/^[a-zA-Z0-9@._-]+\.service$/.test(unit)) return { ok: false, error: 'Service inconnu.' };
    try {
      await execFileAsync('sudo', ['-n', 'systemctl', action, unit], { timeout: 20000 });
      cachedUnits = null;
      return { ok: true };
    } catch (err: any) {
      log.warn(`contrôle du service ${unit} impossible`, err?.message);
      return { ok: false, error: "Le serveur a refusé l'opération." };
    }
  }
  return { ok: false, error: 'Élément inconnu.' };
}
