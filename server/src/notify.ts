import { dansLesHeuresDeSilence } from '@haikodev/shared';
import { bus } from './bus.js';
import { getSettings } from './store.js';

/**
 * Notifications (PLAN §20) : une rafale d'événements devient UNE seule
 * notification (« 3 tâches terminées »), pas une avalanche.
 */

type Kind = 'done' | 'failed' | 'waiting' | 'deploy' | 'proposal' | 'capacity' | 'quota';

interface Pending {
  kind: Kind;
  count: number;
  title: string;
  body: string;
  cardId?: string;
  projectId?: string;
  timer: NodeJS.Timeout;
}

const pending = new Map<Kind, Pending>();
const GROUP_WINDOW_MS = 4000;

function allowed(kind: Kind): boolean {
  const settings = getSettings();
  switch (kind) {
    case 'done':
      return settings.notifyOnDone;
    case 'failed':
      return settings.notifyOnFailed;
    case 'proposal':
      return settings.notifyOnProposal;
    case 'deploy':
      return settings.notifyOnDeploy;
    default:
      return true;
  }
}

function inQuietHours(): boolean {
  const settings = getSettings();
  // La même règle sert à l'amorçage des fenêtres de quota : une seule plage de
  // silence, décrite au même endroit (voir [[amorce]]).
  return dansLesHeuresDeSilence(new Date().getHours(), settings.quietHoursStart, settings.quietHoursEnd);
}

const PLURALS: Record<Kind, (n: number) => string> = {
  done: (n) => `${n} tâches terminées`,
  failed: (n) => `${n} tâches en échec`,
  waiting: (n) => `${n} tâches attendent votre feu vert`,
  deploy: (n) => `${n} publications terminées`,
  proposal: (n) => `${n} tâches proposées — à confirmer`,
  capacity: (n) => `${n} alertes de charge`,
  quota: (n) => `${n} comptes ne répondent plus`,
};

export function notify(input: {
  title: string;
  body: string;
  kind: Kind;
  tag?: string;
  cardId?: string;
  projectId?: string;
}): void {
  if (!allowed(input.kind) || inQuietHours()) return;

  const existing = pending.get(input.kind);
  if (existing) {
    clearTimeout(existing.timer);
    existing.count += 1;
    existing.title = PLURALS[input.kind](existing.count);
    existing.body = '';
    existing.cardId = undefined; // un groupe ne pointe plus vers une carte précise
    existing.timer = setTimeout(() => flush(input.kind), GROUP_WINDOW_MS);
    return;
  }

  pending.set(input.kind, {
    kind: input.kind,
    count: 1,
    title: input.title,
    body: input.body,
    cardId: input.cardId,
    projectId: input.projectId,
    timer: setTimeout(() => flush(input.kind), GROUP_WINDOW_MS),
  });
}

function flush(kind: Kind): void {
  const entry = pending.get(kind);
  if (!entry) return;
  pending.delete(kind);
  const payload = {
    title: entry.title,
    body: entry.body,
    tag: kind,
    cardId: entry.cardId,
    projectId: entry.projectId,
  };
  // Vers les onglets ouverts…
  bus.emit({ type: 'notify', ...payload });
  // …et vers les appareils où l'application est installée mais fermée.
  void import('./push.js').then(({ sendPush }) => sendPush(payload));
}
