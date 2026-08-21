import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CapacitySnapshot, ChargeMachine, SystemProcess, freinDeCharge } from '@haikodev/shared';
import * as store from './store.js';
import { runningAgentIds, pidFor, stopAgent } from './runtime.js';
import { bus } from './bus.js';
import { notify } from './notify.js';
import { log } from './logger.js';

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
export function snapshot(): CapacitySnapshot {
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
  // processeur, si haute soit-elle, n'est jamais une suspension.
  const paused = manualPause || memPct > 94;

  // La PLACE, c'est la mémoire et le plafond — rien d'autre. C'est elle que la
  // barre montre, et ce qu'annonce « N agents peuvent encore démarrer ».
  const places = paused ? 0 : Math.max(0, Math.min(byMemory, byCeiling));

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
    startableNow: slotsFree,
    paused,
    pauseReason: paused
      ? manualPause
        ? 'Départs suspendus manuellement'
        : `Mémoire presque pleine (${memPct} %) : les nouveaux départs sont suspendus`
      : undefined,
    loadHoldReason: frein.raison,
    avgAgentMemMb: Math.round(perAgent),
    at: Date.now(),
  };
}

export function canStartAgent(): { ok: boolean; reason?: string } {
  const snap = snapshot();
  if (snap.paused) return { ok: false, reason: snap.pauseReason };
  if (snap.slotsFree <= 0) {
    return {
      ok: false,
      reason: `Plafond atteint : ${snap.runningAgents} agents tournent déjà (maximum ${snap.maxAgents})`,
    };
  }
  // Le frein processeur refuse pour SA raison, jamais pour un manque de place.
  if ((snap.startableNow ?? snap.slotsFree) <= 0) {
    return { ok: false, reason: snap.loadHoldReason ?? 'La machine est trop chargée pour lancer un agent de plus.' };
  }
  return { ok: true };
}

/** Échantillonnage régulier : la courbe 24 h et l'alerte prolongée. */
export function sampleCapacity(): void {
  const snap = snapshot();
  store.recordCapacity(snap.loadPct, snap.memUsedMb, snap.runningAgents);
  bus.emit({ type: 'capacity', capacity: snap });

  const settings = store.getSettings();
  if (snap.loadPct >= settings.alertThresholdPct) {
    if (alertSince === null) alertSince = Date.now();
    const minutes = (Date.now() - alertSince) / 60000;
    if (minutes >= settings.alertMinutes && !alertSent) {
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

  // HaikoDev lui-même : visible, mais impossible à éteindre depuis sa propre
  // interface — ce serait scier la branche (PLAN §27).
  out.push({
    id: 'service:haikodev.service',
    kind: 'service',
    label: 'HaikoDev',
    detail: 'cette application',
    memMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    cpuPct: 0,
    canStop: false,
    running: true,
  });

  return out.sort((a, b) => b.memMb - a.memMb);
}

export async function controlProcess(id: string, action: 'start' | 'stop'): Promise<{ ok: boolean; error?: string }> {
  if (id === 'service:haikodev.service') {
    return { ok: false, error: "HaikoDev ne peut pas s'éteindre depuis sa propre interface." };
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
