import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cheminDeLaBaseServie, dossierDesDonnees } from './base-servie.mjs';

/**
 * LA SESSION D'ESSAI DES SCRIPTS DE CONTRÔLE — une seule recette.
 *
 * Un contrôle qui passe par le navigateur (ou par l'API) se fabrique une session
 * d'UNE HEURE directement en base, puis la retire en partant. La colonne `token`
 * garde le SHA-256 du cookie, JAMAIS le cookie lui-même (même règle que le
 * démon). Ne lit ni `BELUGA_TOKEN` ni `BELUGA_URL`.
 *
 *   const { cookie, retirer } = poserSessionDEssai('vérification des thèmes');
 *   try { … Cookie: `beluga_session=${cookie}` … } finally { retirer(); }
 *
 * `chemin` : la base visée. Par défaut la base réellement servie
 * (`cheminDeLaBaseServie`) ; un contrôle à démon jetable passe la sienne
 * (`path.join(DATA, 'beluga.db')`). La table `sessions` doit déjà exister.
 * La base n'est ouverte que le temps d'un geste (poser, retirer) : rien ne reste
 * verrouillé pendant le contrôle.
 */
const DUREE_MS = 3_600_000;

function ouvrirLaBase(chemin) {
  const require = createRequire(import.meta.url);
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    /* Copie de travail sans node_modules : le module vit dans le dépôt principal. */
    Database = require(path.join(dossierDesDonnees(), '../node_modules/better-sqlite3'));
  }
  return new Database(chemin);
}

export function poserSessionDEssai(label, { chemin = cheminDeLaBaseServie() } = {}) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  const db = ouvrirLaBase(chemin);
  try {
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
      empreinte,
      maintenant,
      maintenant + DUREE_MS,
      label,
    );
  } finally {
    db.close();
  }
  let retiree = false;
  return {
    cookie,
    retirer() {
      if (retiree) return;
      const fin = ouvrirLaBase(chemin);
      try {
        fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
        retiree = true;
      } finally {
        fin.close();
      }
    },
  };
}
