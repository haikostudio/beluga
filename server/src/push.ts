import webpush from 'web-push';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';

/**
 * Notifications poussées (PLAN §20) : une application installée doit prévenir
 * même quand elle est fermée — sinon l'installation ne sert à rien.
 */

let ready = false;

export function initPush(): string | null {
  try {
    let pub = getMeta('push.publicKey');
    let priv = getMeta('push.privateKey');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      setMeta('push.publicKey', pub);
      setMeta('push.privateKey', priv);
      log.info('clés de notification créées');
    }
    webpush.setVapidDetails('mailto:contact@haikostudio.cloud', pub, priv);
    ready = true;
    return pub;
  } catch (err) {
    log.warn('notifications poussées indisponibles', err);
    return null;
  }
}

export function publicKey(): string | null {
  return getMeta('push.publicKey');
}

export function subscribe(subscription: unknown): boolean {
  const record = subscription as { endpoint?: string };
  if (!record?.endpoint) return false;
  getDb()
    .prepare(
      `INSERT INTO push_subs (endpoint, data, created_at) VALUES (?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data`,
    )
    .run(record.endpoint, JSON.stringify(subscription), Date.now());
  return true;
}

export function unsubscribe(endpoint: string): void {
  getDb().prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  cardId?: string;
  projectId?: string;
  /** Réponses rendues et pas encore lues : le chiffre de l'icône. */
  nonLues?: number;
}

/** Envoie à tous les appareils inscrits ; un abonnement mort est retiré. */
export async function sendPush(payload: PushPayload): Promise<void> {
  if (!ready) return;
  const rows = getDb().prepare('SELECT endpoint, data FROM push_subs').all() as {
    endpoint: string;
    data: string;
  }[];
  if (!rows.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(JSON.parse(row.data), body, { TTL: 3600 });
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          unsubscribe(row.endpoint);
        } else {
          log.debug('notification poussée refusée', err?.statusCode);
        }
      }
    }),
  );
}
