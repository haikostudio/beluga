#!/usr/bin/env node
/**
 * LA SUPPRESSION DÉFINITIVE D'UN PROJET, ÉPROUVÉE DANS UN VRAI NAVIGATEUR.
 *
 * Un démon JETABLE (base neuve, `scripts/lib/demon-d-essai.mjs`) sert la page
 * construite de CETTE copie de travail. Le projet d'essai n'a AUCUN dépôt
 * GitHub déclaré : aucun `gh repo delete` ne peut partir. On prouve, sur
 * ordinateur puis sur un écran de téléphone :
 *
 *  1. la rubrique « Supprimer » ne porte plus `[data-archiver-projet]` (rubrique « Archivage » depuis le 20/11/2026) et
 *     ajoute le bouton « Supprimer définitivement… » ;
 *  2. le dialogue propose « Mettre de côté » d'abord, montre les nombres réels
 *     de ce qui partirait, et reste dans l'écran ;
 *  3. le bouton rouge est ÉTEINT tant que le nom n'est pas recopié à
 *     l'identique (une casse différente ne suffit pas) ;
 *  4. un clic sur « Mettre de côté » du dialogue met le projet de côté sans
 *     rien effacer ;
 *  5. la suppression efface le projet, ses cartes et son dossier, et laisse
 *     intact un projet voisin.
 *
 *   node scripts/verif-suppression-projet.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_SUPPRESSION_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, PROJETS, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-suppression-',
  port: PORT,
  signaux: true,
});

const jeton = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

function dossierGit(nom) {
  const dossier = path.join(PROJETS, nom);
  fs.mkdirSync(dossier, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dossier]);
  fs.writeFileSync(path.join(dossier, 'a.txt'), nom);
  return dossier;
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3_600_000, 'vérification de la suppression');
  const projet = (id, nom, dossier) => {
    const valeur = { id, name: nom, path: dossier, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: t, updatedAt: t };
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, nom, dossier, JSON.stringify(valeur), t, t);
    const carte = { id: `c-${id}`, projectId: id, column: 'archived', position: 1, title: 'Une carte', run: { engine: 'claude' }, createdAt: t, updatedAt: t };
    db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(carte.id, id, carte.column, 1, carte.title, JSON.stringify(carte), t, t);
  };
  projet('p-cible', 'Projet Jetable', dossierGit('projet-jetable'));
  projet('p-voisin', 'Voisin', dossierGit('voisin'));
  projet('p-cote', 'Mis de cote', dossierGit('mis-de-cote'));
  db.close();
}

const nombre = (sql, ...params) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare(sql).get(...params).n;
  } finally {
    db.close();
  }
};

let navigateur;
async function ouvrirLaRubrique(page, id = 'p-cible', nom = 'Projet Jetable') {
  // On laisse d'abord la colonne des projets se remplir : une adresse de réglages posée avant que le
  // projet soit connu de l'écran n'ouvre rien.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByText(nom).first().waitFor({ state: 'attached', timeout: 40_000 });
  await page.evaluate((cible) => {
    window.location.hash = `#projet/${cible}/config/retrait`;
  }, id);
  try {
    await page.waitForSelector('[data-rubrique-contenu="retrait"]', { timeout: 40_000 });
  } catch (err) {
    await page.screenshot({ path: '/tmp/verif-suppression-echec.png' });
    throw err;
  }
}

async function main() {
  if (!(await attendrePort())) {
    noter('le démon jetable démarre', false, journal.join('').slice(-800));
    return;
  }
  poserLeDecor();
  // Le démon a lu sa base au démarrage : un projet posé après coup est relu à la connexion de la page.

  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const erreurs = [];
  for (const [nomEcran, viewport] of [['ordinateur', { width: 1440, height: 900 }], ['téléphone', { width: 390, height: 844 }]]) {
    const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', hasTouch: nomEcran === 'téléphone' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await ouvrirLaRubrique(page);

    noter(`[${nomEcran}] l’archivage n’est plus sous « Supprimer » (il a sa rubrique), aucun ancien « Effacer »`,
      (await page.locator('[data-archiver-projet]').count()) === 0 && (await page.locator('[data-effacer-projet]').count()) === 0);
    noter(`[${nomEcran}] le bouton « Supprimer définitivement… » est là`, (await page.locator('[data-supprimer-projet]').count()) === 1);

    await page.locator('[data-supprimer-projet]').click();
    const dialogue = page.locator('[data-dialogue-suppression]');
    await dialogue.waitFor({ timeout: 10_000 });
    await page.waitForSelector('[data-suppression-apercu] ul', { timeout: 15_000 });
    const texte = (await page.locator('[data-suppression-apercu]').innerText()).replace(/\s+/g, ' ');
    noter(`[${nomEcran}] le dialogue montre les nombres réels et le dossier`, /cartes : 1/.test(texte) && /projet-jetable/.test(texte), texte.slice(0, 160));
    noter(`[${nomEcran}] « Mettre de côté » est proposé d'abord`, (await dialogue.locator('[data-dialogue-mettre-de-cote]').count()) === 1);
    await page.waitForTimeout(700); // la feuille glisse depuis le bas : on mesure une fois posée
    const boite = await dialogue.boundingBox();
    noter(`[${nomEcran}] le dialogue reste dans l'écran`, !!boite && boite.x >= -1 && boite.x + boite.width <= viewport.width + 1 && boite.y >= -1 && boite.y + boite.height <= viewport.height + 1,
      boite ? `${Math.round(boite.x)},${Math.round(boite.y)} ${Math.round(boite.width)}×${Math.round(boite.height)}` : 'absent');

    const bouton = dialogue.locator('[data-confirmer-suppression]');
    noter(`[${nomEcran}] le bouton rouge est éteint avant la saisie`, await bouton.isDisabled());
    await dialogue.locator('[data-suppression-nom]').fill('projet jetable');
    noter(`[${nomEcran}] une casse différente ne suffit pas`, await bouton.isDisabled());
    await dialogue.locator('[data-suppression-nom]').fill('Projet Jetable ');
    noter(`[${nomEcran}] un espace en trop ne suffit pas`, await bouton.isDisabled());
    await dialogue.locator('[data-suppression-nom]').fill('Projet Jetable');
    noter(`[${nomEcran}] le nom exact allume le bouton`, !(await bouton.isDisabled()));
    await page.screenshot({ path: path.join(TMP, `suppression-${nomEcran}.png`) });
    if (nomEcran === 'téléphone') {
      fs.mkdirSync('/tmp/verif-suppression-captures', { recursive: true });
      fs.copyFileSync(path.join(TMP, `suppression-${nomEcran}.png`), `/tmp/verif-suppression-captures/${nomEcran}.png`);
    }

    if (nomEcran === 'ordinateur') {
      // On ferme sans supprimer : le projet doit être intact.
      await page.keyboard.press('Escape');
      noter('[ordinateur] fermer le dialogue ne supprime rien', nombre("SELECT count(*) n FROM projects WHERE id = 'p-cible'") === 1);
    } else {
      /* 4. Le geste par défaut : mettre de côté — essayé sur un autre projet. */
      await page.locator('[data-dialogue-suppression] [data-confirmer-suppression]').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('[data-dialogue-suppression]'), null, { timeout: 15_000 });
      await ouvrirLaRubrique(page, 'p-cote', 'Mis de cote');
      await page.locator('[data-supprimer-projet]').click();
      await page.waitForSelector('[data-dialogue-mettre-de-cote]', { timeout: 15_000 });
      await page.locator('[data-dialogue-mettre-de-cote]').click();
      await page.waitForFunction(() => !document.querySelector('[data-dialogue-suppression]'), null, { timeout: 15_000 });
      noter('[téléphone] « Mettre de côté » met le projet de côté sans rien effacer',
        nombre("SELECT archived n FROM projects WHERE id = 'p-cote'") === 1 && nombre("SELECT count(*) n FROM cards WHERE project_id = 'p-cote'") === 1 && fs.existsSync(path.join(PROJETS, 'mis-de-cote', 'a.txt')));

      /* 5. La suppression elle-même. */
      await ouvrirLaRubrique(page);
      await page.locator('[data-supprimer-projet]').click();
      await page.waitForSelector('[data-suppression-apercu] ul', { timeout: 15_000 });
      await page.locator('[data-suppression-nom]').fill('Projet Jetable');
      await page.locator('[data-confirmer-suppression]').click();
      await page.waitForFunction(() => !document.querySelector('[data-dialogue-suppression]'), null, { timeout: 60_000 });
      noter('la suppression retire le projet et ses cartes de la base',
        nombre("SELECT count(*) n FROM projects WHERE id = 'p-cible'") === 0 && nombre("SELECT count(*) n FROM cards WHERE project_id = 'p-cible'") === 0);
      noter('le dossier du projet a disparu du serveur', !fs.existsSync(path.join(PROJETS, 'projet-jetable')));
      noter('le projet voisin est intact (base et dossier)',
        nombre("SELECT count(*) n FROM projects WHERE id = 'p-voisin'") === 1 && fs.existsSync(path.join(PROJETS, 'voisin', 'a.txt')));
      const copies = path.join(DATA, 'backups', 'projets-supprimes');
      noter('une copie de secours du projet seul a été prise avant',
        fs.existsSync(copies) && fs.readdirSync(copies).some((f) => /^projet-supprime-projet-jetable-.*\.tar$/.test(f)));
      noter('aucune sauvegarde complète de l’application n’a été lancée',
        !fs.existsSync(path.join(DATA, 'backups')) || !fs.readdirSync(path.join(DATA, 'backups')).some((f) => f.endsWith('.tar.gz')));
    }
    await contexte.close();
  }
  noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | ').slice(0, 300));
}

try {
  await main();
} catch (err) {
  noter('le contrôle va jusqu’au bout', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  await navigateur?.close().catch(() => undefined);
  nettoyer();
}
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passent.`);
process.exit(echecs.length ? 1 : 0);
