/**
 * Relire une carte DIRECTEMENT dans la base, comme le démon la relit.
 *
 * Les champs stables d'une carte ne vivent plus dans le bloc `data` : ce sont
 * de vraies colonnes, et les étiquettes comme les pièces jointes ont leur table
 * fille. Un script de vérification qui ferait encore `JSON.parse(ligne.data)`
 * ne verrait donc ni la colonne, ni les réglages, ni les dates. Il passe par
 * ici : une seule traduction, celle de `shared`, partagée avec le démon.
 */
import { carteDepuisLigne } from '../shared/dist/carte-sql.js';

function listeFille(db, table, colonne, cardId) {
  try {
    return db
      .prepare(`SELECT ${colonne} AS valeur FROM ${table} WHERE card_id = ? ORDER BY position`)
      .all(cardId)
      .map((ligne) => ligne.valeur);
  } catch {
    // Base d'avant la migration : les tables filles n'existent pas encore.
    return [];
  }
}

/** La carte reconstituée depuis une ligne complète (`SELECT * FROM cards`). */
export function carteDeLaLigne(db, ligne) {
  if (!ligne) return null;
  return carteDepuisLigne(ligne, {
    labels: listeFille(db, 'card_labels', 'label', ligne.id),
    attachments: listeFille(db, 'card_attachments', 'path', ligne.id),
  });
}

/** La carte d'un identifiant, ou `null`. */
export function lireCarteParId(db, id) {
  return carteDeLaLigne(db, db.prepare('SELECT * FROM cards WHERE id = ?').get(id));
}

/** La première carte qui satisfait une condition SQL écrite à la main. */
export function lireCarteOu(db, condition, ...params) {
  return carteDeLaLigne(db, db.prepare(`SELECT * FROM cards WHERE ${condition}`).get(...params));
}

/** Toutes les cartes qui satisfont une condition SQL écrite à la main. */
export function lireCartesOu(db, condition, ...params) {
  return db
    .prepare(`SELECT * FROM cards WHERE ${condition}`)
    .all(...params)
    .map((ligne) => carteDeLaLigne(db, ligne));
}
