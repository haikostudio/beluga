#!/usr/bin/env node
/**
 * LA CONVERSATION DE JARVIS PASSE DEVANT TOUTE PAGE, FICHE, FEUILLE ET FENÊTRE DE SERVICE (demande du 18/11/2026,
 * capture #5f80c : la fiche d'une demande de la Messagerie, ouverte après le volet au même étage, le masquait).
 *
 * Pour chaque service — Messagerie et la fiche d'une demande, Coffre-fort et la fiche d'un accès, Surveillance,
 * Sauvegardes, Tâches récurrentes, Studio, Statistiques, Communication, Mémoire, Réglages, la page d'une carte,
 * les Tableaux de bord — le volet ouvert (par `beluga:ouvrir-assistant`, jamais par le bouton du bord) :
 *   - le point au centre du volet et celui au centre de son champ tombent DANS `[data-volet-de-jarvis]` ;
 *   - un clic dans le champ y laisse le focus (une fenêtre modale ne le reprend pas), la frappe s'y écrit, et la page
 *     ou la fenêtre dessous reste ouverte ;
 *   - un menu ouvert depuis le volet passe devant lui.
 * Puis la bulle vocale (Maj Maj) sur la fiche d'une demande, et le rond du terminal devant une fenêtre de service.
 * Captures 1440/390, clair et sombre (Messagerie).
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL VERIF_CAPTURES=<dossier> node scripts/verif-jarvis-devant-les-services.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7273);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7174);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail && !ok ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-jarvis-devant-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', () => {});
vite.stderr.on('data', () => {});
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});
const base = () => new Database(path.join(DATA, 'beluga.db'));
function preference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

/** Les écrans, dans l'ordre : adresse, repère qui prouve que la page (ou la fenêtre) est restée ouverte. */
const ECRANS = [
  { nom: 'Messagerie', adresse: '#espace', reste: '[data-colonne-client], [data-ouvrir-demande], main' },
  { nom: 'Coffre-fort', adresse: '#coffre', reste: '[data-fenetre-de-service], [role="dialog"], main' },
  { nom: 'Coffre-fort › fiche d’un accès', adresse: '#coffre/acc-essai', reste: '[role="dialog"], [data-page-de-zone], main' },
  { nom: 'Surveillance', adresse: '#surveillance', reste: 'main' },
  { nom: 'Sauvegardes', adresse: '#backups', reste: 'main' },
  { nom: 'Tâches récurrentes', adresse: '#taches-recurrentes', reste: 'main' },
  { nom: 'Studio', adresse: '#studio', reste: 'main' },
  { nom: 'Statistiques', adresse: '#statistiques', reste: 'main' },
  { nom: 'Communication', adresse: '#communication', reste: 'main' },
  { nom: 'Mémoire (fenêtre)', adresse: '#memoire', reste: '[role="dialog"]' },
  { nom: 'Réglages (fenêtre)', adresse: '#reglages/general', reste: '[data-modale-reglages], [role="dialog"]' },
  { nom: 'Page d’une carte', adresse: '#projet/p-essai/tache/carte-essai', reste: '[data-page-de-zone], [role="dialog"], main' },
  // APRÈS une carte de Toogo : la fiche ne s'ouvre que dans le projet de son client, devenu le projet ouvert.
  { nom: 'Messagerie › fiche d’une demande', adresse: '#espace/cli-essai/demande/dem-essai', reste: '[data-page-de-zone]', fiche: true },
  { nom: 'Tableaux de bord', adresse: '#tableau-de-bord', reste: 'main' },
];


/* LA VOIX SE RALLUME OU SE COUPE EN BASE, PUIS LA PAGE SE RECHARGE (20/11/2026) : le volet ne s'essaie que voix coupée,
   la bulle vocale que voix allumée. */
async function reglerLaVoix(page, active) {
  preference('voix.active', active);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
  await page.waitForTimeout(3200);
}

async function ouvrirLeVolet(page, ouvrir = true) {
  await page.evaluate((o) => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant', { detail: { ouvrir: o } })), ouvrir);
  if (ouvrir) await page.locator('[data-volet-de-jarvis]').first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

/** Ce qui est RÉELLEMENT au premier plan au centre du volet et au centre de son champ d'écriture. */
async function premierPlan(page) {
  return page.evaluate(() => {
    const volet = document.querySelector('[data-volet-de-jarvis]');
    if (!volet) return { volet: false };
    const dans = (x, y) => {
      const e = document.elementFromPoint(x, y);
      return { ok: !!e && volet.contains(e), quoi: e ? `${e.tagName.toLowerCase()}${e.getAttribute('data-page-de-zone') !== null ? '[page-de-zone]' : ''}${e.closest('[role="dialog"]') && !volet.contains(e) ? '[fenêtre]' : ''}` : null };
    };
    const r = volet.getBoundingClientRect();
    const champ = volet.querySelector('textarea, [contenteditable="true"]');
    const c = champ?.getBoundingClientRect();
    const st = getComputedStyle(volet);
    const calque = document.querySelector('[data-calque-du-morphing]');
    return {
      volet: true,
      diag: { vis: st.visibility, op: st.opacity, z: st.zIndex, r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], calque: calque ? calque.getAttribute('data-morphing-etape') : null, bouton: document.querySelector('[data-jarvis-natif]')?.getAttribute('data-morphing') ?? null },
      centre: dans(r.left + r.width / 2, r.top + r.height / 2),
      entete: dans(r.left + r.width / 2, r.top + 14),
      champ: c ? dans(c.left + Math.min(40, c.width / 2), c.top + c.height / 2) : { ok: false, quoi: 'pas de champ' },
    };
  });
}

async function principal() {
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas démarré');
  const T = Date.now();
  {
    const db = base();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai jarvis devant les services');
    /* LE VOLET N'EXISTE QUE SANS LA VOIX (décision de l'utilisateur, 20/11/2026) : ce contrôle du volet coupe la voix. */
    db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('voix.active', 'false', T);
    const p = { id: 'p-essai', name: 'Toogo', path: path.join(DATA, 'depot-essai'), defaultEngine: 'claude', isSelf: false, rank: 5, archived: false, createdAt: T, updatedAt: T };
    fs.mkdirSync(p.path, { recursive: true });
    db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(p.id, p.name, p.path, JSON.stringify(p), T, T);
    try {
      db.prepare("INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES ('cli-essai', 'cli-essai', 'client', 'Client essai', 's', 'h', 1, ?)").run(T);
      db.prepare("INSERT INTO user_projects (user_id, project_id) VALUES ('cli-essai', 'p-essai')").run();
      db.prepare("INSERT INTO demandes (id, project_id, auteur_id, colonne, rang, titre, data, creee_le, derniere_activite) VALUES ('dem-essai', 'p-essai', 'cli-essai', 'a-faire', 1, 'Refaire la page d’accueil', ?, ?, ?)").run(JSON.stringify({ auteurNom: 'Client essai', description: 'Le bandeau du haut est trop grand sur téléphone.' }), T, T);
    } catch (err) {
      console.log(`  (demande d'essai non posée : ${err.message})`);
    }
    try {
      db.prepare("INSERT INTO secrets (id, nom, type, cree_le, modifie_le) VALUES ('acc-essai', 'Clé d’essai', 'cle-api', ?, ?)").run(T, T);
    } catch (err) {
      console.log(`  (accès d'essai non posé : ${err.message})`);
    }
    db.close();
  }
  for (let i = 0; i < 90; i += 1) {
    if (await fetch(BASE).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    /* ---------- ORDINATEUR : chaque service, volet ouvert ---------- */
    preference('theme', 'dark');
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#taches`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    // L'écouteur d'ouverture se pose avec l'application : on renvoie l'ordre tant que le volet n'est pas là.
    for (let i = 0; i < 5 && !(await page.locator('[data-volet-de-jarvis]').count()); i += 1) await ouvrirLeVolet(page);
    verifier('le volet de Jarvis s’ouvre', await page.locator('[data-volet-de-jarvis]').count());
    for (const ecran of ECRANS) {
      // La page s'ouvre APRÈS le volet : c'est l'ordre qui la faisait passer devant lui.
      await page.evaluate((a) => (window.location.hash = a), ecran.adresse);
      await page.waitForTimeout(2200);
      if (!(await page.locator('[data-volet-de-jarvis]').count())) await ouvrirLeVolet(page);
      const vu = await premierPlan(page);
      verifier(`${ecran.nom} : le volet est au premier plan (centre, entête, champ)`, vu.volet && vu.centre.ok && vu.entete.ok && vu.champ.ok, JSON.stringify(vu));
      // Un clic dans le champ : le focus y reste, la frappe s'y écrit, la page dessous reste ouverte.
      const resteAvant = await page.locator(ecran.reste).count();
      if (ecran.fiche) {
        verifier(`${ecran.nom} : la fiche est bien ouverte`, resteAvant > 0, await page.evaluate(() => window.location.hash));
      }
      const champ = page.locator('[data-volet-de-jarvis] textarea, [data-volet-de-jarvis] [contenteditable="true"]').first();
      await champ.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(250);
      await page.keyboard.type('ab');
      await page.waitForTimeout(250);
      const apres = await page.evaluate(() => {
        const volet = document.querySelector('[data-volet-de-jarvis]');
        const actif = document.activeElement;
        const champ = volet?.querySelector('textarea, [contenteditable="true"]');
        return { focus: !!volet && !!actif && volet.contains(actif), texte: (champ?.value ?? champ?.textContent ?? '').slice(-2) };
      });
      const resteApres = await page.locator(ecran.reste).count();
      verifier(`${ecran.nom} : un clic dans le champ y garde le focus et la frappe`, apres.focus && apres.texte === 'ab', JSON.stringify(apres));
      verifier(`${ecran.nom} : la page ou la fenêtre dessous reste ouverte`, resteAvant === 0 || resteApres > 0, `${resteAvant} → ${resteApres}`);
      // Vider le champ (sélection entière puis effacement).
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      if (ecran.fiche && CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'jarvis-devant-messagerie-ordinateur-sombre.png') });
      // Un menu ouvert depuis le volet passe devant lui.
      if (ecran.fiche) {
        const declencheur = page.locator('[data-volet-de-jarvis] button[aria-haspopup="menu"]').first();
        if (await declencheur.count()) {
          await declencheur.click().catch(() => {});
          await page.waitForTimeout(500);
          const menu = await page.evaluate(() => {
            const m = document.querySelector('[role="menu"]');
            if (!m) return { ouvert: false };
            const r = m.getBoundingClientRect();
            const e = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(18, r.height / 2));
            return { ouvert: true, devant: !!e && m.contains(e) };
          });
          verifier(`${ecran.nom} : un menu ouvert depuis le volet passe devant lui`, menu.ouvert && menu.devant, JSON.stringify(menu));
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          verifier(`${ecran.nom} : Échap ferme le menu sans fermer la fiche`, (await page.locator('[data-page-de-zone]').count()) > 0);
        } else verifier(`${ecran.nom} : un menu à ouvrir dans le volet`, false, 'aucun bouton de menu trouvé');
      }
      // Revenir à l'accueil : referme la page ou la fenêtre avant la suivante.
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => (window.location.hash = '#taches'));
      await page.waitForTimeout(700);
    }

    /* ---------- Le rond du terminal devant une fenêtre de service ---------- */
    await ouvrirLeVolet(page, false);
    await page.evaluate(() => (window.location.hash = '#memoire'));
    await page.waitForTimeout(2000);
    const rond = await page.evaluate(() => {
      const r = document.querySelector('[data-rond-seul]');
      if (!r) return { present: false };
      const b = r.getBoundingClientRect();
      const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { present: true, devant: !!e && r.contains(e), z: getComputedStyle(r).zIndex };
    });
    verifier('le rond du terminal reste devant une fenêtre de service', !rond.present || rond.devant, JSON.stringify(rond));

    /* ---------- La bulle vocale sur la fiche d'une demande ---------- */
    await reglerLaVoix(page, true);
    await page.evaluate(() => (window.location.hash = '#espace/cli-essai/demande/dem-essai'));
    await page.waitForTimeout(1500);
    await page.waitForTimeout(2200);
    await page.mouse.click(700, 450).catch(() => {});
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.down('Shift');
      await page.waitForTimeout(40);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(120);
    }
    await page.locator('[data-bulle-vocale]').first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const bulle = await page.evaluate(() => {
      const b = document.querySelector('[data-bulle-vocale]');
      if (!b) return { present: false };
      const r = b.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { present: true, devant: !!e && b.contains(e), quoi: e ? `${e.tagName} ${[...e.attributes].map((a) => a.name).join(' ')}` : null, page: !!document.querySelector('[data-page-de-zone]') };
    });
    verifier('la bulle vocale passe devant la fiche d’une demande', bulle.present && bulle.devant, JSON.stringify(bulle));
    if (bulle.present) {
      await page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').first().click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    verifier('raccrocher dans la bulle ne ferme pas la fiche', (await page.locator('[data-page-de-zone]').count()) > 0);
    preference('voix.active', false);
    await contexte.close();

    /* ---------- Captures : Messagerie, 1440/390, clair et sombre ---------- */
    for (const [appareil, clarte] of [['ordinateur', 'clair'], ['telephone', 'sombre'], ['telephone', 'clair']]) {
      const telephone = appareil === 'telephone';
      preference('theme', clarte === 'clair' ? 'light' : 'dark');
      const ctx = await navigateur.newContext({ viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: telephone, hasTouch: telephone, serviceWorkers: 'block' });
      await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const p = await ctx.newPage();
      await p.goto(`${BASE}/#espace/cli-essai/demande/dem-essai`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(3500);
      await ouvrirLeVolet(p);
      const vu = await premierPlan(p);
      verifier(`${appareil} ${clarte} : le volet passe devant la fiche d’une demande`, vu.volet && vu.centre.ok && vu.champ.ok, JSON.stringify(vu));
      if (CAPTURES) await p.screenshot({ path: path.join(CAPTURES, `jarvis-devant-messagerie-${appareil}-${clarte}.png`) });
      await ouvrirLeVolet(p, false);
      await ctx.close();
    }
  } finally {
    await navigateur.close();
  }
}

principal()
  .catch((err) => {
    console.error(err);
    resultats.push(false);
  })
  .finally(() => {
    nettoyer();
    const ok = resultats.filter(Boolean).length;
    console.log(`${ok}/${resultats.length} contrôles réussis`);
    process.exit(ok === resultats.length && resultats.length > 0 ? 0 : 1);
  });
