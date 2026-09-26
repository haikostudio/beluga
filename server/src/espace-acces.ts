/**
 * L'ESPACE « ACCÈS », CÔTÉ BASE.
 *
 * Deux tables (migration 57) : le CONTENU libre d'un projet, écrit par Haiko,
 * et le JOURNAL des ouvertures et refermetures. Les règles — qui voit quoi, ce
 * que le déverrouillage exige, les textes de responsabilité — vivent dans
 * `shared/src/espace-acces.ts` ; ce fichier ne fait que lire et écrire.
 *
 * LE JOURNAL NE SE RÉÉCRIT PAS. Aucune fonction ici ne met à jour ni ne supprime
 * une ligne du journal : une prise de responsabilité enregistrée reste telle
 * qu'elle a été donnée, avec la version du texte accepté.
 */
import { EntreeJournalAcces, VERSION_TEXTE_ACCES, type GesteDAcces, type RoleCompte } from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

export interface ContenuDAcces {
  texte: string;
  modifieLe?: number;
  modifiePar?: string;
}

interface LigneContenu {
  texte: string;
  modifie_le: number;
  modifie_par: string;
}

interface LigneJournal {
  id: string;
  project_id: string;
  geste: string;
  compte_id: string;
  nom: string;
  role: string;
  version: number;
  cree_le: number;
}

/** Le contenu libre d'un projet — vide tant que Haiko n'a rien écrit. */
export function contenuDAcces(projectId: string): ContenuDAcces {
  const ligne = getDb()
    .prepare('SELECT texte, modifie_le, modifie_par FROM espace_acces WHERE project_id = ?')
    .get(projectId) as LigneContenu | undefined;
  return ligne ? { texte: ligne.texte, modifieLe: ligne.modifie_le, modifiePar: ligne.modifie_par } : { texte: '' };
}

/** Réécrit le contenu libre. Le texte arrive déjà relu par `lireTexteDAcces`. */
export function ecrireContenuDAcces(projectId: string, texte: string, auteur: string): ContenuDAcces {
  const maintenant = Date.now();
  getDb()
    .prepare(
      `INSERT INTO espace_acces (project_id, texte, modifie_le, modifie_par) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET texte = excluded.texte, modifie_le = excluded.modifie_le,
         modifie_par = excluded.modifie_par`,
    )
    .run(projectId, texte, maintenant, auteur);
  return { texte, modifieLe: maintenant, modifiePar: auteur };
}

/** Le journal d'un projet, du plus ancien au plus récent. */
export function journalDAcces(projectId: string): EntreeJournalAcces[] {
  const lignes = getDb()
    .prepare('SELECT * FROM espace_acces_journal WHERE project_id = ? ORDER BY cree_le ASC, rowid ASC')
    .all(projectId) as LigneJournal[];
  return lignes.map((ligne) =>
    EntreeJournalAcces.parse({
      id: ligne.id,
      projectId: ligne.project_id,
      geste: ligne.geste,
      compteId: ligne.compte_id,
      nom: ligne.nom,
      role: ligne.role,
      version: ligne.version,
      le: ligne.cree_le,
    }),
  );
}

/** Ajoute UNE ligne au journal, sur la version du texte en vigueur. */
export function noterGesteDAcces(entree: {
  projectId: string;
  geste: GesteDAcces;
  compteId: string;
  nom: string;
  role: RoleCompte;
}): EntreeJournalAcces {
  const ligne = EntreeJournalAcces.parse({
    id: store.newId(),
    ...entree,
    version: VERSION_TEXTE_ACCES,
    le: Date.now(),
  });
  getDb()
    .prepare(
      `INSERT INTO espace_acces_journal (id, project_id, geste, compte_id, nom, role, version, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ligne.id, ligne.projectId, ligne.geste, ligne.compteId, ligne.nom, ligne.role, ligne.version, ligne.le);
  return ligne;
}
