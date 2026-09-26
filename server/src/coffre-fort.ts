import crypto from 'node:crypto';
import {
  AccesCoffre,
  TypeAcces,
  archivePurgeable,
  jugerAcces,
  trierAcces,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';

/**
 * LE COFFRE-FORT — le rangement sur le disque.
 *
 * Les règles qui se décident sans base vivent dans `shared/src/coffre-fort.ts`.
 * Ici : lire, écrire, effacer. La fiche « accès SSH de la machine », reflet des
 * anciens réglages du VPS, a disparu avec eux : toutes les fiches viennent du
 * coffre lui-même.
 */

interface LigneAcces {
  id: string;
  nom: string;
  type: string;
  project_id: string | null;
  champs: string;
  note: string;
  cree_le: number;
  modifie_le: number;
  archive_le?: number | null;
}

function depuisLigne(ligne: LigneAcces): AccesCoffre {
  let champs: Record<string, string> = {};
  try {
    const lu = JSON.parse(ligne.champs ?? '{}');
    if (lu && typeof lu === 'object') champs = lu as Record<string, string>;
  } catch {
    // Une fiche au JSON abîmé se montre vide plutôt que de faire tomber la liste.
  }
  return {
    id: ligne.id,
    nom: ligne.nom,
    type: ligne.type as TypeAcces,
    projectId: ligne.project_id,
    champs,
    note: ligne.note ?? '',
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    origine: 'coffre',
    archiveLe: ligne.archive_le ?? null,
  };
}

/**
 * Toutes les fiches ACTIVES, la plus récemment touchée d'abord. Les fiches archivées n'y sont JAMAIS : ni les agents, ni les surveillances,
 * ni les relais ne s'appuient sur un accès retiré. Elles se lisent à part,
 * par `listerArchives`.
 */
export function listerAcces(): AccesCoffre[] {
  const lignes = getDb().prepare('SELECT * FROM secrets WHERE archive_le IS NULL').all() as LigneAcces[];
  return trierAcces(lignes.map(depuisLigne));
}

/** Les fiches archivées, la plus récemment retirée d'abord. */
export function listerArchives(): AccesCoffre[] {
  const lignes = getDb()
    .prepare('SELECT * FROM secrets WHERE archive_le IS NOT NULL ORDER BY archive_le DESC, nom ASC')
    .all() as LigneAcces[];
  return lignes.map(depuisLigne);
}

export type EnregistrementAcces = { ok: true; acces: AccesCoffre } | { ok: false; raison: string };

/**
 * Écrit une fiche : nouvelle si `id` est vide, remplacée sinon. Le retour est
 * la fiche telle qu'elle est désormais rangée — l'interface s'en sert plutôt
 * que de recopier ce qu'elle croyait avoir envoyé.
 */
export function enregistrerAcces(brut: unknown, maintenant = Date.now()): EnregistrementAcces {
  const juge = jugerAcces(brut);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const id = String((brut as any)?.id ?? '').trim();

  // Un projet inconnu ne se range pas : la contrainte de la base refuserait la
  // ligne avec un message illisible.
  if (juge.projectId) {
    const existe = getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(juge.projectId);
    if (!existe) return { ok: false, raison: 'Ce projet n’existe pas.' };
  }

  const champs = JSON.stringify(juge.champs);

  if (id) {
    const ligne = getDb().prepare('SELECT * FROM secrets WHERE id = ?').get(id) as LigneAcces | undefined;
    if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
    if (ligne.archive_le != null)
      return { ok: false, raison: 'Cet accès est archivé : restaurez-le avant de le corriger.' };
    getDb()
      .prepare(
        'UPDATE secrets SET nom = ?, type = ?, project_id = ?, champs = ?, note = ?, modifie_le = ? WHERE id = ?',
      )
      .run(juge.nom, juge.type, juge.projectId, champs, juge.note, maintenant, id);
    return { ok: true, acces: depuisLigne({ ...ligne, nom: juge.nom, type: juge.type, project_id: juge.projectId, champs, note: juge.note, modifie_le: maintenant }) };
  }

  const neuf: LigneAcces = {
    id: crypto.randomUUID(),
    nom: juge.nom,
    type: juge.type,
    project_id: juge.projectId,
    champs,
    note: juge.note,
    cree_le: maintenant,
    modifie_le: maintenant,
  };
  getDb()
    .prepare(
      'INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(neuf.id, neuf.nom, neuf.type, neuf.project_id, neuf.champs, neuf.note, neuf.cree_le, neuf.modifie_le);
  log.info(`coffre-fort : accès « ${neuf.nom} » enregistré`);
  return { ok: true, acces: depuisLigne(neuf) };
}

/**
 * Les surveillances dont la recette lit cette fiche (`acces: { id, champ }`).
 * Une fiche qu'une surveillance utilise ne s'archive pas : la surveillance
 * tomberait en panne sans que rien ne dise pourquoi.
 */
function surveillancesQuiLisent(id: string): string[] {
  try {
    const lignes = getDb()
      .prepare("SELECT url, recette FROM sites_surveilles WHERE recette LIKE '%' || ? || '%'")
      .all(id) as { url: string; recette: string | null }[];
    return lignes.map((l) => l.url);
  } catch {
    return [];
  }
}

/**
 * RETIRE une fiche : elle n'est plus effacée mais ARCHIVÉE, avec l'instant du
 * retrait. Elle quitte la liste et tout ce que les agents consultent, reste
 * lisible dans les archives, se restaure, et n'est effacée pour de bon qu'au
 * bout de six mois (`purgerArchives`).
 */
export function supprimerAcces(id: string, maintenant = Date.now()): { ok: boolean; raison?: string } {
  const ligne = getDb().prepare('SELECT nom, archive_le FROM secrets WHERE id = ?').get(id) as
    | { nom: string; archive_le: number | null }
    | undefined;
  if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
  if (ligne.archive_le != null) return { ok: false, raison: 'Cet accès est déjà archivé.' };
  const sites = surveillancesQuiLisent(id);
  if (sites.length)
    return {
      ok: false,
      raison: `Une surveillance lit encore cet accès (${sites.join(', ')}) : faites-la pointer vers une autre fiche avant de le retirer.`,
    };
  getDb().prepare('UPDATE secrets SET archive_le = ? WHERE id = ?').run(maintenant, id);
  log.info(`coffre-fort : accès « ${ligne.nom} » archivé`);
  return { ok: true };
}

/** Remet une fiche archivée parmi les accès actifs. */
export function restaurerAcces(id: string): { ok: boolean; raison?: string } {
  const res = getDb().prepare('UPDATE secrets SET archive_le = NULL WHERE id = ? AND archive_le IS NOT NULL').run(id);
  if (!res.changes) return { ok: false, raison: 'Archive introuvable.' };
  log.info(`coffre-fort : accès ${id} restauré depuis les archives`);
  return { ok: true };
}

/**
 * EFFACE POUR DE BON les fiches archivées depuis plus de six mois — et elles
 * seules : la règle (`archivePurgeable`) ne rend jamais vrai pour une fiche
 * active. Chaque effacement laisse sa ligne au journal. Rend le nombre effacé.
 */
export function purgerArchives(maintenant = Date.now()): number {
  let effacees = 0;
  for (const acces of listerArchives()) {
    if (!archivePurgeable(acces, maintenant)) continue;
    getDb().prepare('DELETE FROM secrets WHERE id = ? AND archive_le IS NOT NULL').run(acces.id);
    log.info(
      `coffre-fort : archive « ${acces.nom} » (${acces.id}) effacée, retirée le ${new Date(acces.archiveLe ?? 0).toISOString()}`,
    );
    effacees += 1;
  }
  return effacees;
}

/** La purge des archives : cinq minutes après le démarrage, puis chaque jour. */
export function planifierPurgeDesArchives(): NodeJS.Timeout[] {
  const passer = () => {
    try {
      purgerArchives();
    } catch (err) {
      log.warn(`coffre-fort : purge des archives sautée — ${(err as Error).message}`);
    }
  };
  const premiere = setTimeout(passer, 5 * 60_000);
  premiere.unref();
  const chaqueJour = setInterval(passer, 24 * 3600_000);
  chaqueJour.unref();
  return [premiere, chaqueJour];
}
