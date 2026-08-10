#!/usr/bin/env node
/**
 * LES BOUTONS « VALIDER / REFUSER » AU BAS D'UN PLAN, ET LE REPLI DES
 * ITÉRATIONS PRÉCÉDENTES — dans un vrai navigateur, sur un agent RÉEL.
 *
 * Le plan s'affine par itérations : seul le DERNIER porte ses boutons. Une
 * version précédente se replie toute seule, se rouvre en lecture, et n'offre
 * plus rien à décider (`indexDuPlanCourant`, `shared/src/plan-conversation.ts`).
 *
 * Le plan lui-même est INJECTÉ par le point d'essai de la page
 * (`window.haikodevEssai.plan`, `web/src/lib/client.ts`) : on n'attend pas
 * qu'un vrai tour d'écriture en produise un. Les DEUX BOUTONS, eux, envoient
 * un vrai message au vrai chef d'orchestre du projet d'essai — c'est ce
 * chemin-là qu'on juge, exactement celui qu'emprunterait un clic humain.
 * L'agent est arrêté juste après chaque envoi : on n'attend pas sa réponse,
 * seul le DÉPART du message compte ici.
 *
 *   HAIKO_PLAN_URL=http://localhost:7099 node scripts/verif-boutons-plan.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKO_PLAN_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';
fs.mkdirSync(SHOTS, { recursive: true });

const db = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Jeton de session, une heure, haché en base et retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jeton),
  Date.now(),
  Date.now() + 3600_000,
  'vérification boutons plan',
);

// Un projet d'essai jetable : un dossier vide suffit, la conversation ne
// touche à aucun code.
const dossier = fs.mkdtempSync('/tmp/boutons-plan-');
const projetId = crypto.randomUUID();
const maintenant = Date.now();
const projet = {
  id: projetId,
  name: 'Essai — boutons plan',
  path: dossier,
  defaultEngine: 'claude',
  isSelf: false,
  miseEnProduction: {},
  archived: false,
  createdAt: maintenant,
  updatedAt: maintenant,
};
db.prepare(
  'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const nettoyer = () => {
  try {
    for (const agent of db.prepare('SELECT id FROM agents WHERE project_id = ?').all(projetId)) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agent.id);
    }
    db.prepare('DELETE FROM agents WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM cards WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projetId);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
  } catch (err) {
    console.error('ménage : ', err);
  }
  fs.rmSync(dossier, { recursive: true, force: true });
};
process.on('exit', nettoyer);

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

await page.goto(`${BASE}/#projet/${projetId}`, { waitUntil: 'domcontentloaded' });

if (!(await page.evaluate(() => Boolean(window.haikodevEssai?.plan)))) {
  noter('la page est bien celle du serveur de développement', false, 'point d’essai absent — viser le serveur de dev');
  await navigateur.close();
  process.exit(1);
}

// Le chef d'orchestre du projet d'essai se crée à l'ouverture du panneau de
// droite : on attend sa conversation avant d'y injecter quoi que ce soit.
await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 20000 });
await page.waitForTimeout(500);

const agentId = await page.evaluate(() => {
  const zone = document.querySelector('textarea[placeholder="Écrivez votre demande…"]');
  const capsule = zone?.closest('div.relative')?.querySelector('[data-agent-contexte]');
  return capsule?.getAttribute('data-agent-contexte') ?? null;
});
noter('le chef d’orchestre du projet d’essai est ouvert', !!agentId, agentId ?? 'introuvable');
if (!agentId) {
  await navigateur.close();
  process.exit(1);
}

const PLAN_1 =
  '## 🎯 Faisabilité\n\nPossible sans réserve particulière.\n\n## 🛤️ Chemin à suivre\n\n1. Ajouter le bouton.\n2. Le relier à l’export.\n\n## 📈 Conséquences\n\nUn export de plus, rien d’autre ne change.\n\n## 🎯 Améliorations apportées\n\n— Un export en un clic.';

/* ---------- 1. Le cadre et ses deux boutons ---------- */

await page.evaluate(([id, texte]) => window.haikodevEssai.plan(id, texte), [agentId, PLAN_1]);
await page.waitForTimeout(400);

const cadre = page.locator('[data-mode-plan-reponse="ouvert"]');
noter('le plan affiche son cadre dédié, déplié d’emblée', (await cadre.count()) === 1);
noter('le bouton Valider est visible', await cadre.getByRole('button', { name: 'Valider' }).isVisible());
noter('le bouton Refuser est visible', await cadre.getByRole('button', { name: 'Refuser' }).isVisible());
await page.screenshot({ path: `${SHOTS}/boutons-plan-ouvert.png` });

/* ---------- 2. « Valider » bascule en direct et enchaîne, sans rien taper ---------- */

const avantTexte = await page.locator('textarea[placeholder="Écrivez votre demande…"]').inputValue();
noter('rien n’est écrit dans la barre avant de valider', avantTexte === '');

const messagesAvant = await page.locator('[data-fil="conversation"] >> text=Vas-y, lance ce plan.').count();
await cadre.getByRole('button', { name: 'Valider' }).click();

await page.waitForSelector('text=Vas-y, lance ce plan.', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
const messagesApres = await page.locator('[data-fil="conversation"] >> text=Vas-y, lance ce plan.').count();
noter(
  '« Valider » enchaîne tout seul : un message est parti sans rien taper',
  messagesApres > messagesAvant,
  `${messagesAvant} → ${messagesApres}`,
);

const modeApres = await page.locator('[data-mode-plan]').first().getAttribute('data-mode-plan');
noter('« Valider » a repassé la conversation en mode direct', modeApres === 'inactif', modeApres ?? 'introuvable');

// On coupe le tour tout de suite : seul le départ du message est jugé ici,
// pas la réponse du chef — inutile de laisser tourner un vrai agent.
const arret = page.getByRole('button', { name: "Arrêter l'action en cours" });
if (await arret.count()) {
  await arret.click();
  await page.waitForTimeout(300);
}

/* ---------- 3. Le plan précédent s'est replié tout seul, et se rouvre au clic ---------- */

await page.waitForTimeout(300);
const replieApresValidation = page.locator('[data-mode-plan-reponse="replie"]');
noter(
  'le plan validé se replie tout seul dès qu’un message le suit',
  (await replieApresValidation.count()) >= 1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-replie.png` });

noter(
  'le plan replié est annoncé comme une version précédente',
  (await replieApresValidation.first().getAttribute('data-mode-plan-etat')) === 'ancien',
);

await replieApresValidation.first().click();
await page.waitForTimeout(300);
const rouvertOk = (await page.locator('[data-mode-plan-reponse="ouvert"]').count()) >= 1;
noter('un clic sur le bandeau replié rouvre le plan, contenu intact', rouvertOk);
const contenuIntact = await page.locator('text=Un export de plus').count();
noter('le contenu rouvert est bien celui d’origine, inchangé', contenuIntact >= 1);

// Une version périmée se relit, elle ne se décide plus : aucun bouton dedans.
const ancienOuvert = page.locator('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="ancien"]');
noter('le plan rouvert est bien marqué « ancien »', (await ancienOuvert.count()) === 1);
noter(
  'un plan précédent rouvert ne porte plus aucun bouton d’action',
  (await ancienOuvert.getByRole('button', { name: 'Valider' }).count()) === 0 &&
    (await ancienOuvert.getByRole('button', { name: 'Refuser' }).count()) === 0,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-rouvert.png` });

/* ---------- 4. Un second plan, plus récent : « Refuser » ---------- */

// Un second plan « dernier » : le premier, déjà suivi d'un message, doit
// rester replié pendant que ce nouveau-là s'affiche déplié.
const PLAN_2 =
  '## 🎯 Faisabilité\n\nAutre demande, faisable aussi.\n\n## 🛤️ Chemin à suivre\n\n1. Étape unique.\n\n## 📈 Conséquences\n\nAucune.\n\n## 🎯 Améliorations apportées\n\n— Rien de neuf.';
await page.evaluate(([id, texte]) => window.haikodevEssai.plan(id, texte), [agentId, PLAN_2]);
await page.waitForTimeout(400);

const dernierCadre = page.locator('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="courant"]');
noter('le second plan s’affiche déplié, lui aussi', (await dernierCadre.count()) === 1);
noter(
  'un seul plan porte ses boutons : le plus récent',
  (await page.locator('[data-fil="conversation"]').getByRole('button', { name: 'Valider', exact: true }).count()) ===
    1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-iterations.png` });

const messagesRefusAvant = await page.locator('text=Je refuse ce plan').count();
await dernierCadre.getByRole('button', { name: 'Refuser' }).click();
await page.waitForSelector('text=Je refuse ce plan', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
const messagesRefusApres = await page.locator('text=Je refuse ce plan').count();
noter(
  '« Refuser » envoie aussi son message, sans rien taper',
  messagesRefusApres > messagesRefusAvant,
  `${messagesRefusAvant} → ${messagesRefusApres}`,
);

const arretRefus = page.getByRole('button', { name: "Arrêter l'action en cours" });
if (await arretRefus.count()) await arretRefus.click();

noter('aucune erreur dans la page', erreurs.length === 0, erreurs[0] ?? '');

await navigateur.close();

// On arrête l'agent réel qu'on vient de faire parler : le tour lancé par
// Valider/Refuser n'a plus rien à faire au-delà de ce constat.
try {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
} catch {
  /* déjà retiré en sortie de script */
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
