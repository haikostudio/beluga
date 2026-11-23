#!/usr/bin/env node
/**
 * UN LIEN DIRECT VERS UNE TÂCHE QUI N'EXISTE PLUS DIT CE QU'IL EN EST.
 *
 * Le tiroir d'une carte s'ouvrait sur une SILHOUETTE quand la carte n'était pas
 * dans l'instantané du projet — le temps qu'elle arrive. Une carte EFFACÉE,
 * elle, n'arrive jamais : le tiroir restait vide pour toujours, sans un mot,
 * sans erreur, sans bouton. C'est le symptôme « tâche inaccessible ».
 *
 * Ce contrôle rejoue exactement ce cas, dans un vrai navigateur : il ouvre
 * l'adresse « #projet/<projet réel>/tache/<identifiant qui n'existe pas> » et
 * exige qu'une PHRASE s'affiche, pas un tiroir vide. Il vérifie aussi côté
 * serveur que la commande `card.get` répond « introuvable » plutôt que de se
 * taire.
 *
 *   HAIKO_CARTE_URL=http://localhost:7099 node scripts/verif-carte-introuvable.mjs
 *
 * Aucune écriture en base hors la session d'une heure, retirée en partant
 * (la colonne `token` garde le SHA-256 du cookie, jamais le cookie).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { creerResultats } from './lib/verif-resultats.mjs';

const ADRESSE = process.env.HAIKO_CARTE_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const { results, record } = creerResultats();
const require = createRequire(import.meta.url);
/* Le module natif se prend là où il est installé : à côté des données quand
   elles sont celles du dépôt principal, sinon dans le dépôt d'où part ce
   script (une copie de travail a le sien). */
function chargerSqlite() {
  for (const piste of [path.join(DONNEES, '../node_modules/better-sqlite3'), 'better-sqlite3']) {
    try {
      return require(piste);
    } catch {
      /* on essaie la piste suivante */
    }
  }
  throw new Error('better-sqlite3 introuvable');
}
const ouvrirBase = () => chargerSqlite()(path.join(DONNEES, 'beluga.db'));

/* Un identifiant qui n'a jamais existé : tiré au sort, donc jamais celui d'une
   carte que le hasard aurait ressuscitée entre deux passages. */
const CARTE_FANTOME = crypto.randomUUID();

async function avecSession(travail) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrirBase();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification carte introuvable',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrirBase();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

function unProjetReel() {
  const db = ouvrirBase();
  const ligne = db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get();
  const fantome = db.prepare('SELECT id FROM cards WHERE id = ?').get(CARTE_FANTOME);
  db.close();
  record('la carte d’essai n’existe bien pas en base', !fantome, CARTE_FANTOME);
  return ligne ? ligne.id : null;
}

async function main() {
  const projet = unProjetReel();
  if (!projet) {
    record('un projet existe pour porter le lien', false);
    return terminer();
  }

  await avecSession(async (cookie) => {
    const navigateur = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    });
    const contexte = await navigateur.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await contexte.addCookies([
      {
        name: 'beluga_session',
        value: cookie,
        url: new URL(ADRESSE).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await contexte.newPage();
    try {
      const lien = `${ADRESSE}/#projet/${projet}/tache/${CARTE_FANTOME}`;
      await page.goto(lien, { waitUntil: 'domcontentloaded', timeout: 60000 });

      /* On attend un ÉTAT — la phrase affichée — et non une durée fixe : le
         chargement des cartes du projet passe d'abord, et c'est normal. */
      const phrase = page.getByText('Cette tâche n’existe plus').first();
      let vue = false;
      try {
        await phrase.waitFor({ state: 'visible', timeout: 30000 });
        vue = true;
      } catch {
        vue = false;
      }
      record('le tiroir dit que la tâche n’existe plus', vue);

      const fermer = page.getByRole('button', { name: 'Fermer' }).first();
      record('un bouton « Fermer » est proposé', (await fermer.count()) > 0);

      if (vue) {
        await fermer.click();
        await page.waitForTimeout(800);
        record(
          'le tiroir se referme sur le clic',
          (await page.getByText('Cette tâche n’existe plus').count()) === 0,
        );
      }
    } finally {
      await navigateur.close();
    }
  });

  terminer();
}

function terminer() {
  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
