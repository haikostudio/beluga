#!/usr/bin/env node
/**
 * TROIS RETOUCHES DE LA CARTE « Vitrine mail et bouton Nouvel artefact » (26/11/2026), dans un vrai navigateur, sur le
 * serveur de développement de la copie (qui parle au démon servi).
 *
 * RIEN NE PART : le canal est intercepté. `card.create` et `procedure.tour` ne sont JAMAIS relayés — l'essai les note
 * et répond à leur place. On vérifie :
 *  1. « Nouvel artefact » reste COLLÉ en haut de la colonne de gauche quand elle défile, rien ne le recouvre, son ombre
 *     ne paraît qu'une fois décollé, et « Tableaux de bord » revient en remontant ;
 *  2. la page d'un projet porte un pied « Nouvel artefact » pleine largeur (ordinateur seulement), dont le clic demande
 *     une carte dans CE projet ;
 *  3. « Refaire l'initialisation » (rubrique Déploiement d'un projet prêt) ouvre une CONFIRMATION, aucun tiroir ;
 *     « Annuler » n'envoie rien ; « Relancer » envoie `procedure.tour` AVEC un message, le bouton passe « Agent au
 *     travail… », et aucun tiroir ne s'ouvre ;
 *  4. au téléphone, pas de pied sur la page du projet, rien ne déborde.
 * Captures 1440/390 en clair et sombre.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL nohup npm run dev --workspace web -- --port 7141 --strictPort > /tmp/dev.log 2>&1 &
 *   env -u BELUGA_TOKEN -u BELUGA_URL HAIKO_ARTEFACT_URL=http://localhost:7141 HAIKO_ARTEFACT_PROJET=<id page> \
 *     HAIKO_ARTEFACT_PROJET_PRET=<id d'un projet au déploiement écrit> [HAIKO_ARTEFACT_CAPTURES=<dossier>] \
 *     node scripts/verif-nouvel-artefact-et-relance.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.HAIKO_ARTEFACT_URL || 'http://localhost:7099';
const DATA = process.env.HAIKO_ARTEFACT_DATA || '/root/beluga/data';
const CAPTURES = process.env.HAIKO_ARTEFACT_CAPTURES;
const PROJET = process.env.HAIKO_ARTEFACT_PROJET;
const PROJET_PRET = process.env.HAIKO_ARTEFACT_PROJET_PRET || PROJET;
if (!PROJET) throw new Error('HAIKO_ARTEFACT_PROJET manque');
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const attendre = async (fn, ms = 10000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
  return false;
};

const cookie = crypto.randomBytes(32).toString('hex');
const jeton = crypto.createHash('sha256').update(cookie).digest('hex');
const db = new Database(path.join(DATA, 'beluga.db'));
const MAINTENANT = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(jeton, MAINTENANT, MAINTENANT + 3600_000, 'essai nouvel artefact', 'admin-premier');

const NON_RELAYES = ['prefs.set', 'card.read', 'card.update', 'deploy.start', 'agent.prompt'];
const envois = [];

async function ouvrirPage(contexte) {
  const page = await contexte.newPage();
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        const cmd = lu?.cmd ?? lu;
        if (cmd?.type === 'card.create') {
          envois.push(cmd);
          /* Lente exprès : le bouton doit dire son attente. */
          setTimeout(() => ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: {} })), 900);
          return;
        }
        if (cmd?.type === 'procedure.tour') {
          envois.push(cmd);
          ws.send(
            JSON.stringify({
              type: 'ack',
              id: lu.id,
              ok: true,
              data: { etat: { projectId: cmd.projectId, cible: cmd.cible, enCours: true, echanges: [], depuis: Date.now() } },
            }),
          );
          return;
        }
        if (NON_RELAYES.includes(cmd?.type)) return;
      } catch {
        /* passe tel quel */
      }
      serveur.send(message);
    });
  });
  await page.addInitScript(() => {
    const poser = () => {
      const style = document.createElement('style');
      style.textContent = '[data-volet-de-jarvis]{display:none!important}';
      document.head.appendChild(style);
    };
    if (document.head) poser();
    else document.addEventListener('DOMContentLoaded', poser);
  });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { page, erreurs };
}

const theme = async (page, c) => {
  await page.evaluate((c) => {
    document.documentElement.dataset.theme = c;
    document.documentElement.classList.toggle('dark', c === 'sombre');
    document.documentElement.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
  }, c);
  await page.waitForTimeout(600);
};
const capture = async (page, nom) => {
  if (!CAPTURES) return;
  await page.mouse.move(700, 5);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
};
const allerA = async (page, fragment, repere) => {
  for (let i = 0; i < 3; i += 1) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/${fragment}`);
    if (await attendre(() => page.locator(repere).first().isVisible().catch(() => false), 20000)) return true;
  }
  return false;
};

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  /* ---------------- ORDINATEUR ---------------- */
  const ordi = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ordi.addCookies([{ name: 'beluga_session', value: cookie, url: BASE }]);
  const { page, erreurs } = await ouvrirPage(ordi);

  /* 1. « NOUVEL ARTEFACT » A QUITTÉ LA COLONNE (carte « Beluga piloté par des agents », 26/11/2026) : il n'y a plus de
     bloc collant à mesurer. Le pied pleine largeur de la page d'un projet est « Nouvelle tâche », en bas de l'onglet
     « Tâches » du volet de l'équipe. */
  const vu = await allerA(page, `#projet/${PROJET}`, '[data-gabarit-equipe="projet"]');
  noter('page du projet affichée', vu);
  noter('« Nouvel artefact » n’est plus dans la colonne', (await page.locator('aside[data-zone="gauche"]').getByText('Nouvel artefact').count()) === 0);
  await page.locator('[data-barre-onglets="projet-onglets"] [data-onglet="taches"]').first().click();

  /* 2. LE PIED DE L'ONGLET « TÂCHES » */
  await theme(page, 'clair');
  const pied = page.locator(`[data-nouvelle-tache-de-l-equipe="${PROJET}"]`);
  await pied.waitFor({ state: 'visible', timeout: 10000 });
  const boite = await pied.boundingBox();
  const volet = await page.locator('[data-volet-equipe="projet"]').first().boundingBox();
  noter('pied : en bas de l’écran, visible entier', !!boite && boite.y + boite.height <= 900 && boite.y > 700, JSON.stringify(boite));
  noter('pied : pleine largeur du volet', !!boite && !!volet && boite.width >= volet.width - 80, `${boite?.width} / ${volet?.width}`);
  noter('pied : hors de la zone qui défile', await pied.evaluate((el) => !el.closest('[data-volet-defile]')));
  for (const c of ['clair', 'sombre']) {
    await theme(page, c);
    await capture(page, `page-projet-pied-1440-${c}`);
  }
  await theme(page, 'clair');
  const avant = envois.length;
  await pied.click();
  const occupe = await attendre(() => pied.getAttribute('aria-busy').then((v) => v === 'true'), 800);
  noter('pied : le clic dit son attente', occupe);
  await attendre(() => envois.length > avant, 3000);
  const cree = envois.slice(avant).find((e) => e.type === 'card.create');
  noter('pied : le clic demande une carte dans CE projet', !!cree && cree.projectId === PROJET && cree.cadrage === true, JSON.stringify(cree ?? null));
  await attendre(() => pied.getAttribute('aria-busy').then((v) => v === null), 3000);
  noter('pied : un seul envoi pour un clic', envois.slice(avant).filter((e) => e.type === 'card.create').length === 1);

  /* 3. « REFAIRE L'INITIALISATION » */
  const rubrique = await allerA(page, `#projet/${PROJET_PRET}/config/deploiement`, '[data-agent-configuration="dev"]');
  noter('rubrique Déploiement ouverte', rubrique);
  const bouton = page.locator('[data-agent-configuration="dev"]').first();
  const etatInitial = await bouton.getAttribute('data-etat-bouton-agent');
  noter('le projet est prêt : « Refaire l’initialisation »', etatInitial === 'reconfigurer', etatInitial);
  if (etatInitial === 'reconfigurer') {
    const avantAnnuler = envois.length;
    await bouton.click();
    const dialogue = page.getByRole('dialog', { name: /Refaire l’initialisation/ });
    noter('le clic ouvre la confirmation', await dialogue.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false));
    noter('aucun tiroir ouvert', (await page.locator('[data-tiroir-agent-configuration]').count()) === 0);
    for (const c of ['clair', 'sombre']) {
      await theme(page, c);
      await capture(page, `confirmation-1440-${c}`);
    }
    await theme(page, 'clair');
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await page.waitForTimeout(400);
    noter('« Annuler » n’envoie rien', envois.length === avantAnnuler);
    await bouton.click();
    await dialogue.waitFor({ state: 'visible', timeout: 5000 });
    await dialogue.getByRole('button', { name: 'Relancer' }).click();
    await attendre(() => envois.length > avantAnnuler, 3000);
    const tour = envois.slice(avantAnnuler).find((e) => e.type === 'procedure.tour');
    noter('« Relancer » envoie le tour AVEC un message', !!tour && tour.projectId === PROJET_PRET && tour.cible === 'dev' && /Refais l’initialisation/.test(tour.message ?? ''), JSON.stringify(tour ?? null).slice(0, 160));
    noter('le bouton dit « Agent au travail… »', await attendre(() => bouton.getAttribute('data-etat-bouton-agent').then((v) => v === 'travail'), 3000));
    await page.waitForTimeout(800);
    noter('après « Relancer », toujours aucun tiroir', (await page.locator('[data-tiroir-agent-configuration]').count()) === 0);
    for (const c of ['clair', 'sombre']) {
      await theme(page, c);
      await capture(page, `relance-1440-${c}`);
    }
  }
  noter('ordinateur : aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  /* 4. TÉLÉPHONE */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await tel.addCookies([{ name: 'beluga_session', value: cookie, url: BASE }]);
  const { page: pageTel, erreurs: erreursTel } = await ouvrirPage(tel);
  const telVu = await allerA(pageTel, `#projet/${PROJET}`, `[data-page-du-projet="${PROJET}"]`);
  noter('téléphone : page du projet', telVu);
  await pageTel.waitForTimeout(1500);
  noter('téléphone : pas de pied « Nouvel artefact » en double', (await pageTel.locator('[data-nouvel-artefact-pied-projet]').count()) === 0);
  noter('téléphone : rien ne déborde', await pageTel.evaluate(() => document.documentElement.scrollWidth - innerWidth === 0));
  for (const c of ['clair', 'sombre']) {
    await theme(pageTel, c);
    await capture(pageTel, `page-projet-390-${c}`);
  }
  noter('téléphone : aucune erreur de page', erreursTel.length === 0, erreursTel.slice(0, 2).join(' | '));
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis`);
process.exit(echecs.length ? 1 : 0);
