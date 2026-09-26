import crypto from 'node:crypto';
import { Note, jugerNote, type ImportanceNote } from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

/**
 * LES NOTES — le rangement sur le disque.
 *
 * Les règles qui se décident sans base (forme d'une note, importances,
 * recherche, tris) vivent dans `shared/src/notes.ts`. Ici : lire, écrire,
 * effacer, et rien d'autre.
 *
 * LA RECHERCHE ET LE TRI NE SE FONT PAS ICI. L'écran a déjà toutes les notes en
 * main — il y en a des dizaines, pas des millions —, et faire un aller-retour
 * au serveur à chaque lettre tapée rendrait la liste poussive pour rien
 * (`filtrerEtTrierNotes`, côté navigateur).
 */

interface LigneNote {
  id: string;
  project_id: string;
  titre: string;
  description: string;
  echeance: number | null;
  importance: string;
  pieces_jointes: string;
  cree_le: number;
  modifie_le: number;
}

function depuisLigne(ligne: LigneNote): Note {
  let pieces: string[] = [];
  try {
    const lu = JSON.parse(ligne.pieces_jointes ?? '[]');
    if (Array.isArray(lu)) pieces = lu.filter((v) => typeof v === 'string');
  } catch {
    // Une note dont la liste de fichiers est abîmée se montre sans eux plutôt
    // que de faire tomber la page entière.
  }
  return {
    id: ligne.id,
    projectId: ligne.project_id,
    titre: ligne.titre,
    description: ligne.description ?? '',
    echeance: ligne.echeance ?? null,
    importance: (ligne.importance ?? 'aucune') as ImportanceNote,
    piecesJointes: pieces,
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
  };
}

/** Toutes les notes, de tous les projets, la plus récemment touchée d'abord. */
export function listerNotes(): Note[] {
  const lignes = getDb()
    .prepare('SELECT * FROM notes ORDER BY modifie_le DESC')
    .all() as LigneNote[];
  return lignes.map(depuisLigne);
}

/**
 * Les pièces jointes d'une liste de notes, retrouvées par leur identifiant.
 * Celles qui ont disparu du disque sont simplement absentes : une note reste
 * lisible sans ses fichiers.
 */
export function piecesDesNotes(notes: readonly Note[]) {
  const vues = new Set<string>();
  const pieces = [] as NonNullable<ReturnType<typeof store.getAttachment>>[];
  for (const note of notes) {
    for (const id of note.piecesJointes) {
      if (vues.has(id)) continue;
      vues.add(id);
      const piece = store.getAttachment(id);
      if (piece) pieces.push(piece);
    }
  }
  return pieces;
}

export type EnregistrementNote = { ok: true; note: Note } | { ok: false; raison: string };

/**
 * Écrit une note : nouvelle si `id` est vide, remplacée sinon. Le retour est la
 * note telle qu'elle est désormais rangée — l'interface s'en sert plutôt que de
 * recopier ce qu'elle croyait avoir envoyé.
 *
 * LA DATE DE CRÉATION NE BOUGE JAMAIS : seule celle de modification suit.
 */
export function enregistrerNote(brut: unknown, maintenant = Date.now()): EnregistrementNote {
  const brouillon = (brut ?? {}) as Record<string, any>;
  const juge = jugerNote({
    id: brouillon.id,
    projectId: String(brouillon.projectId ?? ''),
    titre: String(brouillon.titre ?? ''),
    description: brouillon.description,
    echeance: brouillon.echeance ?? null,
    importance: brouillon.importance,
    piecesJointes: brouillon.piecesJointes,
  });
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const projectId = String(brouillon.projectId).trim();
  if (!store.getProject(projectId)) return { ok: false, raison: 'projet introuvable' };

  const db = getDb();
  const id = String(brouillon.id ?? '').trim();
  const ancienne = id
    ? (db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as LigneNote | undefined)
    : undefined;
  if (id && !ancienne) return { ok: false, raison: 'note introuvable' };

  const note: Note = Note.parse({
    id: ancienne?.id ?? crypto.randomUUID(),
    projectId,
    titre: String(brouillon.titre).trim(),
    description: String(brouillon.description ?? '').trim(),
    echeance:
      brouillon.echeance === undefined || brouillon.echeance === null
        ? null
        : Math.round(Number(brouillon.echeance)),
    importance: brouillon.importance ?? 'aucune',
    piecesJointes: Array.isArray(brouillon.piecesJointes)
      ? brouillon.piecesJointes.filter((v: unknown) => typeof v === 'string')
      : [],
    creeLe: ancienne?.cree_le ?? maintenant,
    modifieLe: maintenant,
  });

  db.prepare(
    `INSERT INTO notes (id, project_id, titre, description, echeance, importance, pieces_jointes, cree_le, modifie_le)
     VALUES (@id, @project_id, @titre, @description, @echeance, @importance, @pieces_jointes, @cree_le, @modifie_le)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       titre = excluded.titre,
       description = excluded.description,
       echeance = excluded.echeance,
       importance = excluded.importance,
       pieces_jointes = excluded.pieces_jointes,
       modifie_le = excluded.modifie_le`,
  ).run({
    id: note.id,
    project_id: note.projectId,
    titre: note.titre,
    description: note.description,
    echeance: note.echeance,
    importance: note.importance,
    pieces_jointes: JSON.stringify(note.piecesJointes),
    cree_le: note.creeLe,
    modifie_le: note.modifieLe,
  });

  return { ok: true, note };
}

/** Efface une note. Ses pièces jointes restent au dépôt : elles peuvent servir ailleurs. */
export function supprimerNote(id: string): { ok: boolean } {
  const resultat = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  return { ok: resultat.changes > 0 };
}
