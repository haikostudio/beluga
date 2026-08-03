#!/usr/bin/env node
/**
 * La pastille « terminé, pas encore lu » dans la colonne des projets.
 *
 * On ne touche PAS au démon de production : le script lève un second démon sur
 * son propre dossier de données (port 7098), y pose deux projets — l'un dans un
 * groupe —, une carte dont l'agent a rendu son travail, et regarde ce que
 * l'interface montre : la pastille sur le projet, le compte qui remonte sur le
 * groupe replié, et l'extinction à l'ouverture de la carte.
 *
 *   node scripts/verif-pastille-projet.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 7098;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = '/tmp/haikodev-verif-pastille';
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(nom, ok, detail = '') {
  results.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const maintenant = Date.now();

function semer(db) {
  const projet = (id, nom, groupId, rank) => {
    const data = {
      id,
      name: nom,
      path: '/root/haikodev',
      archived: false,
      groupId,
      rank,
      defaultRun: { engine: 'claude', model: 'default', thinking: 'normal' },
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,0,?,?,?)',
    ).run(id, nom, '/root/haikodev', JSON.stringify(data), maintenant, maintenant);
  };

  db.prepare('INSERT INTO project_groups (id, name, rank, collapsed, created_at) VALUES (?,?,?,0,?)').run(
    'g1',
    'HAIKO',
    10,
    maintenant,
  );
  projet('p-seul', 'Projet seul', undefined, 5);
  projet('p-groupe', 'Projet du groupe', 'g1', 20);

  const carte = (id, projectId, titre) => {
    const data = {
      id,
      projectId,
      title: titre,
      description: '',
      labels: [],
      column: 'running',
      position: maintenant,
      origin: 'user',
      run: { engine: 'claude', model: 'default', thinking: 'normal' },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, projectId, 'running', maintenant, titre, JSON.stringify(data), maintenant, maintenant);
  };
  const agent = (id, projectId, cardId, statut) => {
    const data = {
      id,
      projectId,
      cardId,
      role: 'task',
      title: 'Agent d’essai',
      run: { engine: 'claude', model: 'default', thinking: 'normal' },
      status: statut,
      endedAt: statut === 'done' ? maintenant : undefined,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, projectId, cardId, 'task', statut, JSON.stringify(data), maintenant, maintenant);
  };

  carte('c-rendue', 'p-seul', 'Une réponse rendue');
  agent('a-rendue', 'p-seul', 'c-rendue', 'done');
  carte('c-groupe', 'p-groupe', 'Rendue dans le groupe');
  agent('a-groupe', 'p-groupe', 'c-groupe', 'done');
}

async function attendre(url, essais = 60) {
  for (let i = 0; i < essais; i += 1) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* pas encore levé */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  const demon = spawn('node', ['/root/haikodev/server/dist/main.js'], {
    env: {
      ...process.env,
      HAIKODEV_DATA: DATA,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_WEB: '/root/haikodev/web/dist',
    },
    stdio: 'ignore',
  });

  let db;
  let browser;
  try {
    if (!(await attendre(`${BASE}/`))) throw new Error('le démon d’essai ne répond pas');
    demon.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));

    db = new Database(path.join(DATA, 'haikodev.db'));
    semer(db);
    const cookie = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)').run(
      crypto.createHash('sha256').update(cookie).digest('hex'),
      maintenant,
      maintenant + 3600_000,
      'vérification pastille',
    );
    db.close();

    const relance = spawn('node', ['/root/haikodev/server/dist/main.js'], {
      env: {
        ...process.env,
        HAIKODEV_DATA: DATA,
        HAIKODEV_PORT: String(PORT),
        HAIKODEV_WEB: '/root/haikodev/web/dist',
      },
      stdio: 'ignore',
    });
    demon.relance = relance;
    if (!(await attendre(`${BASE}/`))) throw new Error('le démon d’essai n’est pas reparti');

    browser = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'haikodev_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    fs.mkdirSync(SHOTS, { recursive: true });

    const ligne = (nom) => page.locator('[data-drag-kind="project"]', { hasText: nom }).first();

    const pastille = async (nom) => {
      const texte = await ligne(nom)
        .locator('.rounded-full.bg-success')
        .allInnerTexts()
        .catch(() => []);
      return texte.join('');
    };

    record('Le projet qui a rendu porte sa pastille', (await pastille('Projet seul')) === '1', await pastille('Projet seul'));
    /*
     * La pastille ne doit pas se confondre avec la roue de l'agent au travail :
     * elle est pleine et IMMOBILE. On ne peut pas semer un agent vivant — le
     * démon remet tout agent « en cours » au repos à son démarrage —, on vérifie
     * donc la forme : rien qui tourne à l'intérieur de la pastille.
     */
    const tourne = await ligne('Projet seul').locator('.rounded-full.bg-success .animate-spin').count();
    record('La pastille est immobile, là où la roue tourne', tourne === 0);
    await page.screenshot({ path: `${SHOTS}/pastille-01-projet.png` });

    // Le groupe est déplié : la pastille du membre se voit sur sa ligne.
    record(
      'Le projet rangé dans le groupe porte aussi la sienne',
      (await pastille('Projet du groupe')) === '1',
    );

    // On replie le groupe : le compte doit remonter sur son titre.
    await page.getByRole('button', { name: /HAIKO/ }).first().click();
    await page.waitForTimeout(500);
    const surGroupe = await page
      .locator('[data-drag-kind="group"] .rounded-full.bg-success')
      .allInnerTexts();
    record('Replié, le groupe affiche le compte de ses projets', surGroupe.join('') === '1', surGroupe.join('·'));
    await page.screenshot({ path: `${SHOTS}/pastille-02-groupe-replie.png` });

    /* ---------- Le compte sur l'icône de l'application installée ---------- */
    const surIcone = await page.evaluate(async () => {
      const poses = [];
      navigator.setAppBadge = async (n) => void poses.push(n ?? 'sans nombre');
      navigator.clearAppBadge = async () => void poses.push('effacée');
      window.__poses = poses;
      return poses.length;
    });
    void surIcone;
    // On rouvre le groupe : le remontage de la colonne rejoue la pose du compte.
    await page.getByRole('button', { name: /HAIKO/ }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /HAIKO/ }).first().click();
    await page.waitForTimeout(600);

    // Marquer comme lu depuis la liste : un clic sur la pastille elle-même.
    await page.getByRole('button', { name: /HAIKO/ }).first().click();
    await page.waitForTimeout(400);
    const avantClic = await pastille('Projet du groupe');
    await ligne('Projet du groupe').locator('.rounded-full.bg-success').first().click();
    await page.waitForTimeout(1200);
    record(
      'Un clic sur la pastille éteint le projet, sans ouvrir sa conversation',
      avantClic === '1' && (await pastille('Projet du groupe')) === '',
      `avant « ${avantClic} », après « ${await pastille('Projet du groupe')} »`,
    );
    const resteOuvert = await page.locator('[role="dialog"]').count();
    record('Aucun tiroir ne s’est ouvert au passage', resteOuvert === 0, `${resteOuvert} tiroir(s)`);
    await page.screenshot({ path: `${SHOTS}/pastille-04-marquee-lue.png` });

    // Lire la carte éteint la pastille — et elle seule.
    await ligne('Projet seul').locator('button').first().click();
    await page.waitForTimeout(1500);
    await page.getByText('Une réponse rendue').first().click();
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    record('Lire la carte éteint la pastille du projet', (await pastille('Projet seul')) === '', await pastille('Projet seul'));
    record('Le projet déjà marqué lu le reste', (await pastille('Projet du groupe')) === '');

    /*
     * Tout est lu : le chiffre a été posé sur l'icône de l'application, puis
     * RETIRÉ — une pastille à « 0 » vaudrait moins que pas de pastille du tout.
     */
    const poses = await page.evaluate(() => window.__poses ?? []);
    record(
      'Le compte est posé sur l’icône, puis retiré quand tout est lu',
      poses.includes(1) && poses.includes('effacée'),
      poses.join(' → '),
    );
    await page.screenshot({ path: `${SHOTS}/pastille-03-apres-lecture.png` });

    record('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    demon.kill('SIGKILL');
    demon.relance?.kill('SIGKILL');
  }

  const echecs = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - echecs}/${results.length} contrôles passés.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
