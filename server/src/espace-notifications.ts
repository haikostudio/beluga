/**
 * LA CLOCHE D'UN CLIENT, CÔTÉ BASE.
 *
 * La cloche de l'administration garde ses annonces dans le navigateur ; celle
 * d'un client ne le peut pas : il passe du téléphone à l'ordinateur, et ce qu'il
 * a lu sur l'un doit être lu sur l'autre. Une ligne par notification ET par
 * destinataire, avec son état lu.
 *
 * Trois règles tiennent le fichier :
 *  - un compte ne lit JAMAIS que ses propres lignes — le destinataire vient de
 *    la session, jamais de la commande ;
 *  - une RAFALE ne fait qu'une ligne (`prolongeLaRafale`) : la dernière, non
 *    lue, du même geste sur la même demande, est mise à jour ;
 *  - les lignes LUES de plus de 90 jours sont purgées au fil de l'eau, au plus
 *    une fois par heure : la table ne grossit pas sans fin.
 */
import {
  DUREE_NOTIFICATION_LUE_MS,
  NotificationEspace,
  prolongeLaRafale,
  type CibleNotification,
  type EvenementEspace,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

interface LigneNotification {
  id: string;
  user_id: string;
  project_id: string | null;
  demande_id: string | null;
  evenement: string;
  data: string;
  cree_le: number;
  lu_le: number | null;
}

function enNotification(ligne: LigneNotification): NotificationEspace {
  return NotificationEspace.parse({
    ...(JSON.parse(ligne.data) as Record<string, unknown>),
    id: ligne.id,
    pour: ligne.user_id,
    projectId: ligne.project_id ?? undefined,
    demandeId: ligne.demande_id ?? undefined,
    evenement: ligne.evenement,
    creeLe: ligne.cree_le,
    luLe: ligne.lu_le ?? undefined,
  });
}

/** Ce qui vit dans le bloc JSON : ce qu'on ne trie ni ne filtre en SQL. */
function bloc(notification: NotificationEspace): string {
  return JSON.stringify({
    cible: notification.cible,
    motif: notification.motif,
    auteur: notification.auteur,
    demandeTitre: notification.demandeTitre,
    detail: notification.detail,
    fois: notification.fois,
  });
}

export interface NouvelleNotification {
  pour: string;
  projectId?: string;
  demandeId?: string;
  cible: CibleNotification;
  motif: string;
  evenement: EvenementEspace;
  auteur?: string;
  demandeTitre?: string;
  detail?: string;
}

let dernierePurge = 0;

function purgerLesVieillesLues(maintenant: number): void {
  if (maintenant - dernierePurge < 3600_000) return;
  dernierePurge = maintenant;
  getDb()
    .prepare('DELETE FROM espace_notifications WHERE lu_le IS NOT NULL AND cree_le < ?')
    .run(maintenant - DUREE_NOTIFICATION_LUE_MS);
}

/**
 * CONSIGNER UNE NOTIFICATION. Rend la ligne écrite, et `prolongee` quand elle
 * a seulement mis à jour la précédente — l'appelant ne refait alors pas de
 * message passager : la rafale se lit dans la cloche, pas en cinq toasts.
 */
export function consignerNotification(
  nouvelle: NouvelleNotification,
  maintenant = Date.now(),
): { notification: NotificationEspace; prolongee: boolean } {
  purgerLesVieillesLues(maintenant);
  const db = getDb();
  const derniere = db
    .prepare(
      `SELECT * FROM espace_notifications
       WHERE user_id = ? AND evenement = ? AND COALESCE(demande_id, '') = ?
       ORDER BY cree_le DESC LIMIT 1`,
    )
    .get(nouvelle.pour, nouvelle.evenement, nouvelle.demandeId ?? '') as LigneNotification | undefined;
  const precedente = derniere ? enNotification(derniere) : null;

  if (precedente && prolongeLaRafale(precedente, nouvelle, maintenant)) {
    const suite = NotificationEspace.parse({
      ...precedente,
      auteur: nouvelle.auteur ?? precedente.auteur,
      demandeTitre: nouvelle.demandeTitre ?? precedente.demandeTitre,
      detail: nouvelle.detail ?? precedente.detail,
      fois: precedente.fois + 1,
      creeLe: maintenant,
    });
    db.prepare('UPDATE espace_notifications SET data = ?, cree_le = ? WHERE id = ?').run(bloc(suite), maintenant, suite.id);
    return { notification: suite, prolongee: true };
  }

  const notification = NotificationEspace.parse({
    ...nouvelle,
    id: store.newId(),
    fois: 1,
    creeLe: maintenant,
  });
  db.prepare(
    `INSERT INTO espace_notifications (id, user_id, project_id, demande_id, evenement, data, cree_le, lu_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    notification.id,
    notification.pour,
    notification.projectId ?? null,
    notification.demandeId ?? null,
    notification.evenement,
    bloc(notification),
    notification.creeLe,
  );
  return { notification, prolongee: false };
}

/**
 * LA PORTÉE SE REVÉRIFIE À LA LECTURE. Un client retiré d'un projet ne relit
 * plus les notifications qui en parlaient : `projets` borne la liste, `null`
 * la laisse entière (administrateur).
 */
function filtreDePortee(projets: readonly string[] | null): { sql: string; valeurs: string[] } {
  if (projets === null) return { sql: '', valeurs: [] };
  if (!projets.length) return { sql: ' AND project_id IS NULL', valeurs: [] };
  return { sql: ` AND (project_id IS NULL OR project_id IN (${projets.map(() => '?').join(',')}))`, valeurs: [...projets] };
}

export function nonLuesDe(pour: string, projets: readonly string[] | null): number {
  const portee = filtreDePortee(projets);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM espace_notifications WHERE user_id = ? AND lu_le IS NULL${portee.sql}`)
    .get(pour, ...portee.valeurs) as { n: number };
  return row.n;
}

/** Les plus récentes d'abord, par pages : `avant` est la date de la dernière ligne déjà montrée. */
export function listerNotifications(
  pour: string,
  projets: readonly string[] | null,
  avant?: number,
  limite = 30,
): { notifications: NotificationEspace[]; suite: boolean; nonLues: number } {
  const portee = filtreDePortee(projets);
  const borne = Math.min(Math.max(1, Math.floor(limite)), 100);
  const lignes = getDb()
    .prepare(
      `SELECT * FROM espace_notifications
       WHERE user_id = ? AND cree_le < ?${portee.sql}
       ORDER BY cree_le DESC LIMIT ?`,
    )
    .all(pour, avant ?? Number.MAX_SAFE_INTEGER, ...portee.valeurs, borne + 1) as LigneNotification[];
  return {
    notifications: lignes.slice(0, borne).map(enNotification),
    suite: lignes.length > borne,
    nonLues: nonLuesDe(pour, projets),
  };
}

/**
 * MARQUER LU : une ligne, celles d'une demande, celles de la discussion, ou
 * toutes. Toujours bornées au compte — un identifiant d'un autre ne touche rien.
 * Rend le nombre de lignes passées à « lue ».
 */
export function marquerNotificationsLues(
  pour: string,
  quoi: { id?: string; demandeId?: string; cible?: CibleNotification } = {},
  quand = Date.now(),
): number {
  const conditions = ['user_id = ?', 'lu_le IS NULL'];
  const valeurs: (string | number)[] = [pour];
  if (quoi.id) {
    conditions.push('id = ?');
    valeurs.push(quoi.id);
  }
  if (quoi.demandeId) {
    conditions.push('demande_id = ?');
    valeurs.push(quoi.demandeId);
  }
  if (quoi.cible) {
    conditions.push("json_extract(data, '$.cible') = ?");
    valeurs.push(quoi.cible);
  }
  const resultat = getDb()
    .prepare(`UPDATE espace_notifications SET lu_le = ? WHERE ${conditions.join(' AND ')}`)
    .run(quand, ...valeurs);
  return resultat.changes;
}
