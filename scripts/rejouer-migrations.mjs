#!/usr/bin/env node
/**
 * REJOUE LES MIGRATIONS EN ATTENTE SUR LA BASE SERVIE, SANS COUPER LE DÉMON.
 *
 * `openDb()` applique déjà lui-même ce qui manque, mais seulement au démarrage
 * du démon — et redémarrer le démon coupe les tours en cours. Quand une
 * migration a été SAUTÉE (numéro repris par un autre nom : voir le registre en
 * tête de `server/src/db.ts`), ce script ouvre la même base dans un processus à
 * part et laisse le MÊME code faire le MÊME travail.
 *
 * Aucune règle SQL n'est écrite ici : la seule source reste `MIGRATIONS`.
 *
 * Les requêtes du démon sont préparées à chaque appel : une colonne ajoutée ici
 * est visible du démon SANS redémarrage.
 */
import { openDb } from '../server/dist/db.js';

const db = openDb();
const registre = db.prepare('SELECT id, name, applied_at FROM migrations ORDER BY id').all();
console.log(`migrations au registre : ${registre.length}`);
for (const ligne of registre.slice(-5)) {
  console.log(`  ${ligne.id} — ${ligne.name} (${new Date(ligne.applied_at).toISOString()})`);
}
