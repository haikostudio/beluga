import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { APPAREIL_INCONNU, construireFragment, identiteDInstallation, nomDAppareil } from '@beluga/shared';
import type { AppareilNotifie } from '@beluga/shared';
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
    /*
     * LE CONTACT ANNONCÉ AUX SERVICES DE NOTIFICATION est celui de
     * l'installation. Les services l'exigent mais ne lui écrivent qu'en cas
     * d'abus : faute de contact réglé, on annonce l'adresse de l'installation
     * elle-même — jamais celle de quelqu'un d'autre.
     */
    const identite = identiteDInstallation();
    const contact = identite.contactDesNotifications
      ? `mailto:${identite.contactDesNotifications}`
      : identite.adressePublique || 'https://localhost';
    webpush.setVapidDetails(contact, pub, priv);
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

/**
 * UN ABONNEMENT APPARTIENT À QUELQU'UN.
 *
 * Tant que `push_subs` n'avait pas de propriétaire, `sendPush` arrosait tous
 * les abonnés : une alerte destinée à un client partait aussi sur le téléphone
 * de Haiko, et sur celui des autres clients. Le propriétaire n'est pas demandé
 * au navigateur — il est LU DERRIÈRE LE COOKIE DE SESSION, comme partout
 * ailleurs : sinon n'importe qui s'abonnerait au nom d'un autre.
 */
export function subscribe(subscription: unknown, userId?: string, userAgent?: string): boolean {
  const record = subscription as { endpoint?: string };
  if (!record?.endpoint) return false;
  const appareil = userAgent ? nomDAppareil(userAgent) : null;
  getDb()
    .prepare(
      `INSERT INTO push_subs (endpoint, data, created_at, user_id, appareil) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data, user_id = excluded.user_id,
         appareil = COALESCE(excluded.appareil, push_subs.appareil)`,
    )
    .run(record.endpoint, JSON.stringify(subscription), Date.now(), userId ?? null, appareil);
  return true;
}

export function unsubscribe(endpoint: string): void {
  getDb().prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

/**
 * L'EMPREINTE D'UN ABONNEMENT : ce que la liste des appareils montre à la
 * place de l'adresse d'abonnement. Cette adresse donne le droit d'écrire sur
 * l'appareil — elle ne sort jamais du démon.
 */
export function empreinteDAbonnement(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
}

/**
 * LES APPAREILS D'UN COMPTE, et de lui seul (MEM-0768) : un abonnement
 * appartient à la personne connectée au moment où il a été posé. `courant`
 * est l'adresse d'abonnement de l'appareil qui regarde, pour le repérer.
 */
export function appareilsDuCompte(
  userId: string,
  courant?: string,
): { appareils: AppareilNotifie[]; courantId: string | null } {
  const lignes = getDb()
    .prepare('SELECT endpoint, appareil, created_at FROM push_subs WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as { endpoint: string; appareil: string | null; created_at: number }[];
  return {
    appareils: lignes.map((ligne) => ({
      id: empreinteDAbonnement(ligne.endpoint),
      nom: ligne.appareil || APPAREIL_INCONNU,
      ajouteLe: ligne.created_at,
    })),
    courantId: courant ? empreinteDAbonnement(courant) : null,
  };
}

/** Retire un appareil — seulement s'il appartient à ce compte. Rend `true` s'il a été retiré. */
export function retirerAppareilDuCompte(userId: string, id: string): boolean {
  const lignes = getDb().prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all(userId) as {
    endpoint: string;
  }[];
  const cible = lignes.find((ligne) => empreinteDAbonnement(ligne.endpoint) === id);
  if (!cible) return false;
  unsubscribe(cible.endpoint);
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  /** Le genre d'événement : le service worker en tire l'image à afficher. */
  motif?: string;
  cardId?: string;
  projectId?: string;
  /** L'agent où répondre, quand la décision ne tient à aucune carte. */
  agentId?: string;
  /** Réponses rendues et pas encore lues : le chiffre de l'icône. */
  nonLues?: number;
  /** L'adresse toute faite où mène l'appui — l'espace client la pose, le reste la déduit. */
  url?: string;
}

/**
 * LES APPAREILS VISÉS. Sans `pour`, on ne sert que les ADMINISTRATEURS : c'est
 * le comportement historique des alertes du démon, et il ne doit jamais
 * déborder sur un client. Avec `pour`, on ne sert que ce compte-là.
 *
 * Un abonnement SANS propriétaire n'est servi par aucune des deux branches :
 * on ne devine pas à qui appartient un téléphone.
 */
function abonnementsVises(pour?: string): { endpoint: string; data: string }[] {
  const db = getDb();
  if (pour) {
    return db.prepare('SELECT endpoint, data FROM push_subs WHERE user_id = ?').all(pour) as {
      endpoint: string;
      data: string;
    }[];
  }
  return db
    .prepare(
      `SELECT p.endpoint, p.data FROM push_subs p
       JOIN users u ON u.id = p.user_id
       WHERE u.role = 'admin' AND u.actif = 1`,
    )
    .all() as { endpoint: string; data: string }[];
}

/**
 * Envoie aux appareils VISÉS ; un abonnement mort est retiré. `pour` nomme le
 * compte destinataire ; sans lui, seuls les administrateurs sont servis.
 */
/**
 * L'ADRESSE OÙ MÈNE UN APPUI SUR LA NOTIFICATION.
 *
 * Elle se construit ICI, avec les règles partagées (`construireFragment`), et
 * jamais dans le service worker : celui-ci ne peut pas importer le module
 * commun, il en recopiait donc le format à la main — deux écritures du même
 * format, qui divergent au premier élargissement. Le service worker se
 * contente désormais de suivre l'adresse qu'on lui donne.
 *
 * L'espace client pose déjà la sienne (`url`) : on ne la touche pas.
 */
function adresseDeLaNotification(payload: PushPayload): string | undefined {
  if (payload.url) return payload.url;
  if (!payload.projectId) return undefined;
  const fragment = construireFragment({
    vue: 'projet',
    projectId: payload.projectId,
    ...(payload.cardId ? { cardId: payload.cardId } : {}),
  });
  return fragment ? `/#${fragment}` : undefined;
}

export async function sendPush(payload: PushPayload, pour?: string): Promise<void> {
  if (!ready) return;
  const rows = abonnementsVises(pour);
  if (!rows.length) return;

  const url = adresseDeLaNotification(payload);
  const body = JSON.stringify(url ? { ...payload, url } : payload);
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
