#!/usr/bin/env node
/**
 * LE BOUTON DU BORD, LE VOLET DE L'ASSISTANT ET LES ONDES DE JARVIS (carte « Jarvis : volet, voix et rapidité »,
 * décisions de l'utilisateur du 16/11/2026, capture #698f, maquette #115d).
 *
 * Dans un vrai Chrome, sur un démon d'essai jetable et le serveur de développement de la copie branché sur lui (le
 * point d'essai `belugaEssai` n'existe qu'hors production) :
 *   1. ni robot du bas à droite, ni barre d'appel, ni conversation empilée : le bouton du bord est la seule entrée ;
 *   2. le bouton porte TROIS barres de même largeur (petite, moyenne, petite), et ses angles creusés ;
 *   3. glissé, il se pose sur chacun des quatre bords et y reste après rechargement (ordinateur et téléphone à part) ;
 *   4. touché, il ouvre le volet « Assistant Beluga » DU CÔTÉ du bouton ; touché encore, il le referme ;
 *   5. le volet s'ouvre aussi sur les écrans Communication et Marketing, et sur téléphone (sous l'entête) ;
 *   6. en mode voix, la zone d'écriture laisse place aux ondes — JAUNES quand vous parlez, BLEUES quand Jarvis parle —
 *      avec, centrés dessous, deux boutons ronds SANS TEXTE (Muet, Arrêter) ; arrêter rend la zone d'écriture.
 *
 *   env -u BELUGA_TOKEN node scripts/verif-jarvis-volet.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN node scripts/verif-jarvis-volet.mjs   # + captures 1440/390, clair/sombre
 *
 * Jamais BELUGA_URL, jamais BELUGA_TOKEN : tout vise le démon d'essai et son serveur de développement.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7231);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7131);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-jarvis-volet-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');

const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journalVite = [];
vite.stdout.on('data', (d) => journalVite.push(String(d)));
vite.stderr.on('data', (d) => journalVite.push(String(d)));
process.on('exit', () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
});

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const T = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai volet jarvis');
  /* LE VOLET N'EXISTE QUE SANS LA VOIX (décision de l'utilisateur, 20/11/2026) : ce contrôle du volet coupe la voix. */
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('voix.active', 'false', T);
  db.close();
}
function poserPreference(cle, valeur) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}
function lirePreference(cle) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT value FROM preferences WHERE key = ?').get(cle);
  db.close();
  return ligne ? JSON.parse(ligne.value) : null;
}


/* LA VOIX SE RALLUME OU SE COUPE EN BASE, PUIS LA PAGE SE RECHARGE (20/11/2026) : le volet ne s'essaie que voix coupée,
   la bulle vocale que voix allumée. */
async function reglerLaVoix(page, active) {
  poserPreference('voix.active', active);
  await page.reload({ waitUntil: 'domcontentloaded' });
  /* Le volet retenu ouvert se rouvre au rechargement et recouvre le bouton : on l'attend présent, pas visible. */
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000, state: 'attached' });
  await page.waitForTimeout(3200);
}

async function ouvrirPage(navigateur, { telephone = false } = {}) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    permissions: ['microphone'],
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { contexte, page, erreurs };
}

const boite = (page, sel) => page.locator(sel).first().boundingBox();

/** Glisse le bouton du bord jusqu'au point (x, y), par de vrais événements de pointeur, puis relâche. */
async function glisserLeBouton(page, x, y) {
  const b = await boite(page, '[data-bouton-du-bord]');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(cx + ((x - cx) * i) / 12, cy + ((y - cy) * i) / 12);
  // Le point d'appui est sondé AVANT le lâcher : le bouton suit déjà le bord le plus proche.
  const pendant = await page.locator('[data-languette-jarvis]').getAttribute('data-glisse');
  await page.mouse.up();
  await page.waitForTimeout(700);
  return pendant !== null;
}

async function main() {
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-2000));
  poserLeDecor();
  for (let i = 0; i < 90 && !(await fetch(BASE).then(() => true).catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 1000));

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    /* ---------------- 1-2. Ordinateur : une seule entrée, la bonne forme ---------------- */
    const { page, erreurs } = await ouvrirPage(navigateur);
    // UNE SEULE ENTRÉE : un seul bouton dit « Ouvrir l’assistant » dans tout l'écran (ni robot, ni bouton d'entête).
    verifier('une seule entrée vers l’assistant : le bouton du bord', (await page.getByRole('button', { name: /Ouvrir l’assistant/ }).count()) === 1);
    // Le module de voix ne pose plus rien d'autre que le bouton : ni barre d'appel, ni conversation empilée.
    verifier('le module de voix ne pose que le bouton du bord', await page.evaluate(() => {
      const fixes = [...document.querySelectorAll('[data-module-voix] > *')].filter((el) => getComputedStyle(el).position === 'fixed');
      return fixes.length === 1 && fixes[0].hasAttribute('data-languette-jarvis');
    }));
    const forme = await page.evaluate(() => {
      const barres = [...document.querySelectorAll('[data-bouton-du-bord] [data-icone-trois-barres] > span')].map((b) => b.getBoundingClientRect());
      const bouton = document.querySelector('[data-bouton-du-bord]').getBoundingClientRect();
      const icone = document.querySelector('[data-bouton-du-bord] [data-icone-trois-barres]').getBoundingClientRect();
      const cible = document.querySelector('[data-bouton-du-bord] [data-cible-du-bord]')?.getBoundingClientRect();
      return {
        air: { gauche: icone.left - bouton.left, droite: bouton.right - icone.right, haut: icone.top - bouton.top, bas: bouton.bottom - icone.bottom },
        cible: cible ? { l: Math.round(cible.width), h: Math.round(cible.height) } : null,
        barres: barres.map((r) => ({ l: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 })),
        bouton: { l: Math.round(bouton.width), h: Math.round(bouton.height), x: Math.round(bouton.left) },
        conges: !!document.querySelector('[data-conges-jarvis] path'),
        bord: document.querySelector('[data-languette-jarvis]').getAttribute('data-bord'),
      };
    });
    verifier('trois barres dans l’icône', forme.barres.length === 3, JSON.stringify(forme.barres));
    verifier('…de même largeur', forme.barres.length === 3 && new Set(forme.barres.map((b) => b.l)).size === 1);
    verifier('…petite, moyenne, petite', forme.barres.length === 3 && forme.barres[1].h > forme.barres[0].h && forme.barres[0].h === forme.barres[2].h);
    // PRESQUE ROND (« D » de 30 × 30, maquette #6950) : l'icône ne touche plus ses côtés (capture #1ba1c).
    verifier('le bouton est presque rond (30 × 30), collé au bord gauche par défaut', forme.bord === 'gauche' && forme.bouton.x === 0 && Math.abs(forme.bouton.h - forme.bouton.l) <= 2 && forme.bouton.l >= 28 && forme.bouton.l <= 32, JSON.stringify(forme.bouton));
    verifier('…l’icône y garde de l’air de chaque côté (5 px au moins)', Object.values(forme.air).every((v) => v >= 5), JSON.stringify(forme.air));
    verifier('…et la zone à toucher fait 44 × 44 au moins', !!forme.cible && forme.cible.l >= 44 && forme.cible.h >= 44, JSON.stringify(forme.cible));
    verifier('ses angles creusés sont là', forme.conges);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'bord-gauche-1440.png') });

    /* ---------------- 3. Les quatre bords, gardés au rechargement ---------------- */
    for (const [bord, x, y] of [
      ['droite', 1436, 420],
      ['bas', 700, 896],
      ['haut', 900, 4],
      ['gauche', 3, 500],
    ]) {
      const suivait = await glisserLeBouton(page, x, y);
      const lu = await page.locator('[data-languette-jarvis]').getAttribute('data-bord');
      const b = await boite(page, '[data-bouton-du-bord]');
      const colle =
        bord === 'droite' ? Math.abs(b.x + b.width - 1440) < 2 : bord === 'gauche' ? b.x < 2 : bord === 'haut' ? b.y < 2 : Math.abs(b.y + b.height - 900) < 3;
      verifier(`glissé vers le bord ${bord}, il s’y colle`, lu === bord && colle, `${lu} ${JSON.stringify(b)}`);
      verifier(`…pendant le geste, il suivait déjà le pointeur (${bord})`, suivait);
      verifier(`…le glisser n’a pas ouvert le volet (${bord})`, (await page.locator('[data-assistant-chat]').count()) === 0);
      if (CAPTURES && bord !== 'gauche') await page.screenshot({ path: path.join(CAPTURES, `bord-${bord}-1440.png`) });
    }
    await glisserLeBouton(page, 1436, 300);
    const retenue = lirePreference('jarvis-bord-ordinateur');
    verifier('la place est retenue dans le compte, pour l’ordinateur', retenue?.bord === 'droite', JSON.stringify(retenue));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    verifier('après rechargement, il est toujours à droite', (await page.locator('[data-languette-jarvis]').getAttribute('data-bord')) === 'droite');

    /* ---------------- 4. Le volet, du côté du bouton (en texte : le toucher du bouton lance la voix) ---------------- */
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
    await page.waitForSelector('[data-assistant-conversation="oui"]', { timeout: 30_000 }).catch(() => undefined);
    const volet = await boite(page, '[data-assistant-chat]');
    const bouton = await boite(page, '[data-bouton-du-bord]');
    verifier('un toucher ouvre le volet « Assistant Beluga »', !!volet);
    /* Depuis le 17/11/2026, le bouton SE TRANSFORME en volet (`lib/morphing-du-bord.ts`) : le volet se pose du côté du
       bouton, à 16 px du bord, et le recouvre (règle aussi jugée par verif-bulle-jarvis.mjs). */
    verifier('…du côté du bouton (à droite, à 16 px du bord)', !!volet && Math.abs(volet.x + volet.width - (1440 - 16)) <= 2 && volet.x > 1440 / 2 - volet.width, volet ? `${Math.round(volet.x + volet.width)} / ${Math.round(bouton.x)}` : '');
    verifier('…avec la conversation de l’assistant et sa zone d’écriture', (await page.locator('[data-assistant-chat] textarea').count()) >= 1);
    verifier('…avec le micro de dictée dans la zone d’écriture, et jamais le bouton voix (18/11/2026)', (await page.locator('[data-assistant-chat] [data-composer] [data-mic-button]').count()) >= 1 && (await page.locator(['parler-a-jarvis'].map((n) => `[data-assistant-chat] [data-${n}]`).join('')).count()) === 0);
    verifier('le volet est hors de portée des gestes de Jarvis (un appui dedans ne les interrompt pas)', (await page.locator('[data-assistant-chat][data-volet-de-jarvis]').count()) === 1);
    const poignee = await boite(page, '[data-assistant-poignee]');
    verifier('la poignée de taille est au coin opposé à l’ancrage (en haut à gauche)', !!poignee && !!volet && poignee.x - volet.x < 4 && poignee.y - volet.y < 4);

    /* ---------------- 6. Les ondes à la place de la zone d'écriture ---------------- */
    await page.evaluate(() => window.belugaEssai?.ondesDuVolet?.('vous'));
    await page.waitForSelector('[data-pied-vocal]', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(900);
    const vocal = await page.evaluate(() => {
      const pied = document.querySelector('[data-pied-vocal]');
      const ondes = document.querySelector('[data-ondes-du-volet]');
      const boutons = [...(pied?.querySelectorAll('button') ?? [])];
      const barres = [...(ondes?.children ?? [])].map((b) => Math.round(b.getBoundingClientRect().width * 10) / 10);
      const piedR = pied?.getBoundingClientRect();
      const milieu = piedR ? piedR.left + piedR.width / 2 : 0;
      const rangee = boutons.length ? (boutons[0].getBoundingClientRect().left + boutons[boutons.length - 1].getBoundingClientRect().right) / 2 : -1;
      return {
        pied: !!pied,
        champ: !!document.querySelector('[data-assistant-chat] textarea'),
        qui: ondes?.dataset.quiParle,
        couleur: ondes ? getComputedStyle(ondes).color : '',
        jaune: getComputedStyle(document.documentElement).getPropertyValue('--voix-vous').trim(),
        bleu: getComputedStyle(document.documentElement).getPropertyValue('--voix-jarvis').trim(),
        boutons: boutons.map((b) => ({ texte: b.textContent.trim(), aria: b.getAttribute('aria-label'), rond: getComputedStyle(b).borderRadius })),
        largeurs: [...new Set(barres)],
        centre: Math.abs(milieu - rangee),
      };
    });
    verifier('mode voix : la zone d’écriture laisse place aux ondes', vocal.pied && !vocal.champ);
    verifier('…les barres des ondes ont toutes la même largeur', vocal.largeurs.length === 1, JSON.stringify(vocal.largeurs));
    verifier('…JAUNES quand vous parlez', vocal.qui === 'vous' && !!vocal.jaune, `${vocal.qui} ${vocal.couleur} (--voix-vous ${vocal.jaune})`);
    await page.evaluate(() => window.belugaEssai?.ondesDuVolet?.('jarvis'));
    await page.waitForTimeout(400);
    const quiJarvis = await page.locator('[data-ondes-du-volet]').getAttribute('data-qui-parle');
    const couleurJarvis = await page.locator('[data-ondes-du-volet]').evaluate((el) => getComputedStyle(el).color);
    verifier('…BLEUES quand Jarvis parle', quiJarvis === 'jarvis' && couleurJarvis !== vocal.couleur, `${couleurJarvis} (--voix-jarvis ${vocal.bleu})`);
    // Trois depuis le 17/11/2026 : Muet, Arrêter, et le bouton fenêtre qui replie la conversation en bulle.
    verifier('trois boutons sous les ondes : Muet, Arrêter, Replier', vocal.boutons.length === 3 && vocal.boutons[2]?.aria === 'Replier la conversation', JSON.stringify(vocal.boutons));
    verifier('…en icône seule, sans texte', vocal.boutons.every((b) => b.texte === '' && !!b.aria));
    verifier('…ronds', vocal.boutons.every((b) => b.rond.startsWith('9999') || b.rond === '50%' || parseFloat(b.rond) >= 20));
    verifier('…centrés sous les ondes', vocal.centre < 3, `écart ${vocal.centre.toFixed(1)} px`);
    if (CAPTURES) {
      for (const clarte of ['sombre', 'clair']) {
        await page.evaluate((c) => document.documentElement.classList.toggle('dark', c === 'sombre'), clarte);
        await page.evaluate(() => window.belugaEssai?.ondesDuVolet?.('vous'));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(CAPTURES, `volet-voix-vous-1440-${clarte}.png`) });
        await page.evaluate(() => window.belugaEssai?.ondesDuVolet?.('jarvis'));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(CAPTURES, `volet-voix-jarvis-1440-${clarte}.png`) });
      }
    }
    // Muet : le bouton se marque, la conversation continue.
    await page.locator('[data-jarvis-micro]').click();
    verifier('Muet se marque sans arrêter', (await page.locator('[data-jarvis-micro]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-pied-vocal]').count()) === 1);
    await page.locator('[data-jarvis-micro]').click();
    // Arrêter : la zone d'écriture revient.
    await page.evaluate(() => window.belugaEssai?.ondesDuVolet?.(null));
    await page.waitForTimeout(500);
    verifier('voix éteinte, la zone d’écriture revient', (await page.locator('[data-assistant-chat] textarea').count()) >= 1 && (await page.locator('[data-pied-vocal]').count()) === 0);
    // Le vrai bouton « Parler à Jarvis » : la conversation démarre aussitôt (« Jarvis arrive… »), Arrêter la ferme.
    /* La voix ne s'ouvre plus d'un bouton du champ (18/11/2026) : l'événement du raccourci. Voix coupée, il ne lance rien. */
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
    await page.waitForTimeout(1500);
    verifier('voix coupée : le raccourci ne lance pas Jarvis, le volet reste l’assistant en texte', (await page.locator('[data-pied-vocal]').count()) === 0 && (await page.locator('[data-assistant-chat] textarea').count()) >= 1);
    /* Voix rallumée (20/11/2026) : le volet disparaît, le raccourci ouvre la bulle vocale. */
    await reglerLaVoix(page, true);
    verifier('voix rallumée : le volet de l’assistant disparaît', (await page.locator('[data-assistant-chat]').count()) === 0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
    await page.waitForSelector('[data-bulle-vocale] [data-pied-vocal]', { timeout: 8000 }).catch(() => undefined);
    verifier('…et le raccourci lance Jarvis dans la bulle vocale', (await page.locator('[data-bulle-vocale] [data-pied-vocal]').count()) === 1);
    await page.locator('[data-jarvis-raccrocher]').click().catch(() => undefined);
    await page.waitForTimeout(800);
    verifier('Arrêter ferme la conversation', (await page.locator('[data-pied-vocal]').count()) === 0);
    await reglerLaVoix(page, false);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant', { detail: { ouvrir: false } })));
    await page.waitForTimeout(800);
    verifier('voix recoupée : le volet revient puis se referme', (await page.locator('[data-assistant-chat]').count()) === 0);

    /* ---------------- 5. Communication et Marketing ---------------- */
    for (const ecran of ['communication2', 'marketing2']) {
      await page.evaluate((e) => (window.location.hash = `#${e}`), ecran);
      await page.waitForTimeout(1500);
      // Le toucher du bouton du bord lance la voix (bulle) : le volet s'ouvre en texte par le point d'essai.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
      await page.waitForSelector('[data-assistant-chat]', { timeout: 10_000 }).catch(() => undefined);
      verifier(`le volet s’ouvre aussi sur l’écran ${ecran}`, (await page.locator('[data-assistant-chat]').count()) === 1);
      /* Le volet ouvert recouvre le bouton (morphing du 17/11/2026) : il se referme par le même signal. */
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant', { detail: { ouvrir: false } })));
      await page.waitForTimeout(800);
    }
    verifier('aucune erreur de page sur ordinateur', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await page.context().close();

    /* ---------------- Téléphone ---------------- */
    const tel = await ouvrirPage(navigateur, { telephone: true });
    const t = tel.page;
    verifier('sur téléphone aussi, le bouton du bord est là', (await t.locator('[data-bouton-du-bord]').count()) === 1);
    verifier('…sur sa propre place (pas celle de l’ordinateur)', (await t.locator('[data-languette-jarvis]').getAttribute('data-bord')) === 'gauche');
    if (CAPTURES) await t.screenshot({ path: path.join(CAPTURES, 'bord-gauche-390.png') });
    await t.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
    await t.waitForSelector('[data-assistant-chat]', { timeout: 20_000 }).catch(() => undefined);
    await t.waitForTimeout(1200);
    // DEPUIS LE 17/11/2026, L'ASSISTANT S'OUVRE EN FEUILLE DU BAS sur téléphone (décision de l'utilisateur).
    const feuilleTel = await t.evaluate(() => {
      const v = document.querySelector('[data-assistant-chat]');
      const f = v?.closest('[data-feuille-du-bas]');
      const r = f?.getBoundingClientRect();
      return r ? { largeur: Math.round(r.width), bas: Math.round(innerHeight - r.bottom), ancre: v.getAttribute('data-assistant-ancre') } : null;
    });
    verifier('l’assistant s’ouvre en feuille du bas, pleine largeur', !!feuilleTel && feuilleTel.largeur === 390 && feuilleTel.ancre === 'feuille', JSON.stringify(feuilleTel));
    verifier('…posée sur le bas de l’écran', !!feuilleTel && Math.abs(feuilleTel.bas) <= 1);
    verifier('…et le bouton du bord s’efface tant qu’elle est ouverte', (await t.locator('[data-bouton-du-bord]').count()) === 0);
    verifier('…sans débordement en largeur', await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (CAPTURES) {
      for (const clarte of ['sombre', 'clair']) {
        await t.evaluate((c) => document.documentElement.classList.toggle('dark', c === 'sombre'), clarte);
        await t.waitForTimeout(300);
        await t.screenshot({ path: path.join(CAPTURES, `volet-390-${clarte}.png`) });
        await t.evaluate(() => window.belugaEssai?.ondesDuVolet?.('jarvis'));
        await t.waitForTimeout(500);
        await t.screenshot({ path: path.join(CAPTURES, `volet-voix-390-${clarte}.png`) });
        await t.evaluate(() => window.belugaEssai?.ondesDuVolet?.(null));
      }
    }
    await t.locator('[data-feuille-du-bas] button[aria-label="Fermer l’assistant"]').first().click().catch(() => undefined);
    await t.waitForTimeout(800);
    await glisserLeBouton(t, 380, 500).catch(() => undefined);
    verifier('aucune erreur de page sur téléphone', tel.erreurs.length === 0, tel.erreurs.slice(0, 2).join(' | '));
    await tel.contexte.close();
  } finally {
    await navigateur.close();
    nettoyer();
  }
  const echecs = resultats.filter((r) => !r).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées${CAPTURES ? ` (captures dans ${CAPTURES})` : ''}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  console.error(journalVite.slice(-20).join(''));
  nettoyer();
  process.exit(1);
});
