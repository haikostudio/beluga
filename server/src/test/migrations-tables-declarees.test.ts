import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS } from '../db.js';

/* ------------------------------------------------------------------ */
/* UNE MIGRATION GARDÉE DÉCLARE TOUTES LES TABLES QU'ELLE TOUCHE       */
/*                                                                     */
/* Le garde `siTable` reporte une migration tant que la table nommée    */
/* manque. N'en nommer QU'UNE sur une migration qui en touche plusieurs */
/* laissait la migration partir sur une base partielle, puis tomber sur */
/* la deuxième table (« no such table: queue ») — et l'échec emportait   */
/* l'ouverture de la base, donc des contrôles sans aucun rapport.       */
/* ------------------------------------------------------------------ */

/** Les tables citées par une requête SQL, hors fonctions de table SQLite. */
function tablesCitees(sql: string): string[] {
  const trouvees = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|UPDATE|INTO|JOIN)\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
    const nom = m[1].toLowerCase();
    if (nom === 'json_each' || nom === 'json_tree') continue;
    trouvees.add(nom);
  }
  // Une table CRÉÉE par la migration elle-même n'a évidemment pas à exister avant.
  for (const m of sql.matchAll(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
    trouvees.delete(m[1].toLowerCase());
  }
  return [...trouvees];
}

test('une migration gardée par une table les déclare toutes', () => {
  for (const migration of MIGRATIONS) {
    if (!migration.siTable) continue;
    const declarees = new Set(
      (Array.isArray(migration.siTable) ? migration.siTable : [migration.siTable]).map((t) => t.toLowerCase()),
    );
    const oubliees = tablesCitees(migration.sql).filter((t) => !declarees.has(t));
    assert.deepEqual(
      oubliees,
      [],
      `migration ${migration.id} (${migration.name}) : table(s) ${oubliees.join(', ')} touchée(s) mais non déclarée(s) dans siTable`,
    );
  }
});
