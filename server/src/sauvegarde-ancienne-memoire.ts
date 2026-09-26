import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type Database from 'better-sqlite3';

/**
 * LA SAUVEGARDE DE L'ANCIENNE MÉMOIRE, AVANT SON RETRAIT.
 *
 * La migration « retrait-de-l-ancienne-memoire » supprime les tables du modèle
 * d'avant (micro-fiches, fiches de sujet, changelog par entrées, index,
 * vecteurs). Elle ne passe qu'APRÈS cette sauvegarde : `openDb` l'appelle avant
 * toute migration, sur la base brute. Le fichier écrit est complet (toutes les
 * lignes de toutes ces tables, sans les index ni les vecteurs, recalculables) et
 * c'est lui que la génération de la base de connaissances relit
 * (`scripts/generer-connaissances.mjs`).
 *
 * Une sauvegarde déjà écrite n'est jamais écrasée : elle est la seule trace du
 * modèle d'avant une fois les tables parties.
 */

export const TABLES_DE_L_ANCIENNE_MEMOIRE = [
  'classeurs',
  'classeur_themes',
  'classeur_synonymes',
  'fiches',
  'fiche_versions',
  'fiche_doublons',
  'fiches_sujet',
  'fiche_sujet_versions',
  'memoire_changelog',
  'memoire_correspondance',
] as const;

export function cheminDeLaSauvegarde(dossierDonnees: string): string {
  return path.join(dossierDonnees, 'sauvegardes', 'memoire-avant-connaissances.json.gz');
}

/** Rend le chemin écrit, ou null quand il n'y avait rien à sauvegarder (ou déjà sauvegardé). */
export function sauvegarderLAncienneMemoire(database: Database.Database, dossierDonnees: string): string | null {
  const presentes = TABLES_DE_L_ANCIENNE_MEMOIRE.filter((nom) =>
    Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom)),
  );
  if (!presentes.length) return null;
  const lignes = presentes.reduce((n, nom) => n + (database.prepare(`SELECT COUNT(*) AS n FROM ${nom}`).get() as { n: number }).n, 0);
  if (!lignes) return null;
  const fichier = cheminDeLaSauvegarde(dossierDonnees);
  if (fs.existsSync(fichier)) return null;
  const tables: Record<string, unknown[]> = {};
  for (const nom of presentes) tables[nom] = database.prepare(`SELECT * FROM ${nom}`).all();
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const provisoire = `${fichier}.partiel`;
  fs.writeFileSync(provisoire, zlib.gzipSync(JSON.stringify({ version: 1, at: Date.now(), tables })));
  fs.renameSync(provisoire, fichier);
  return fichier;
}
