#!/usr/bin/env node
/**
 * LA BULLE VOCALE ET LE RACCOURCI LIBRE DE JARVIS, DANS UN VRAI NAVIGATEUR.
 *
 * Carte « Raccourcis libres et Jarvis vocal » (17/11/2026). Ce contrôle juge :
 *
 *   1. Maj Maj (le raccourci par défaut) ouvre la BULLE VOCALE — pas le volet — et la conversation ;
 *   2. la bulle porte le pied vocal et DEUX boutons ronds de même taille : Muet et Arrêter — plus de bouton fenêtre
 *      (décision du 20/11/2026 : le volet n'existe que sans la voix) ;
 *   3. aucun volet ne s'ouvre pendant la voix, même sur le signal « ouvrir l'assistant » ;
 *   4. une PRODUCTION de Jarvis (`voix.direct.production`) reste dans les bulles : le volet ne s'ouvre plus ;
 *   5. un second Maj Maj arrête la conversation ; taper deux majuscules (« OK ») dans un champ ne déclenche rien ;
 *   6. le toucher du bouton du bord ouvre la bulle, un second toucher l'arrête ;
 *   7. Réglages › Voix : « Maj Maj » affiché ; Ctrl + Maj capturé puis reconnu partout ; Cmd + C refusé ;
 *      « Réinitialiser » rend Maj Maj ;
 *   8. téléphone 390 : la bulle tient dans l'écran, rien ne déborde.
 *   9. (carte « Jarvis n'entend ni ne répond », 17/11/2026) LE MORPHING : au toucher, le bouton du bord se cache et un
 *      calque part de SA boîte, passe par traits → cercle → glisse → bulle, puis la bulle se montre ; à l'arrêt, le
 *      calque revient sur la boîte du bouton, qui réapparaît à la même place. Mouvement réduit : aucun calque.
 *  10. sur ordinateur, la bulle est TOUJOURS en bas à droite, même bouton posé à gauche ; une réponse longue avec un
 *      tableau se lit ENTIÈRE dans sa bulle ; sur téléphone, le bouton n'est jamais en bas (place ancienne ramenée sur
 *      un côté, lâcher près du bas → un côté).
 *
 * Un DÉMON D'ESSAI (base neuve, aucun compte Codex : le direct échoue avant tout moteur, aucun quota) et le serveur
 * de développement de la copie, branché sur lui (`BELUGA_DEMON_PORT`) — `belugaEssai` n'existe qu'hors production.
 * Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-bulle-jarvis.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-bulle-jarvis.mjs   # + captures
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7213);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7114);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-bulle-jarvis-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');

const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', couperVite);

function base() {
  return new Database(path.join(DATA, 'beluga.db'));
}
function poserLeDecor() {
  const db = base();
  const T = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai bulle');
  db.close();
}
function poserLeTheme(clarte) {
  poserLaPreference('theme', clarte);
}
function poserLaPreference(cle, valeur) {
  const db = base();
  if (valeur === null) db.prepare('DELETE FROM preferences WHERE key = ?').run(cle);
  else db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

async function ouvrirPage(navigateur, { telephone = false, reduit = false } = {}) {
  const contexte = await navigateur.newContext({
    reducedMotion: reduit ? 'reduce' : 'no-preference',
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
  // Au chargement, le morphing ne se joue pas (3 s) : on attend d'en être sorti.
  await page.waitForTimeout(3200);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { contexte, page, erreurs };
}

const etat = (page) =>
  page.evaluate(() => ({
    conversation: document.querySelector('[data-module-voix]')?.hasAttribute('data-conversation') ?? false,
    bulle: !!document.querySelector('[data-bulle-vocale]'),
    volet: !!document.querySelector('[data-assistant-chat]'),
  }));
async function attendre(page, predicat, ms = 8000) {
  const fin = Date.now() + ms;
  let e = await etat(page);
  while (Date.now() < fin && !predicat(e)) {
    await page.waitForTimeout(200);
    e = await etat(page);
  }
  return e;
}
async function majMaj(page) {
  await page.keyboard.down('Shift');
  await page.waitForTimeout(40);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(90);
  await page.keyboard.down('Shift');
  await page.waitForTimeout(40);
  await page.keyboard.up('Shift');
}
/* Les bulles d'essai : le module republie l'état du direct tant que la connexion bouge — on les repose jusqu'à les voir. */
async function poserLesBulles(page) {
  for (let i = 0; i < 15; i += 1) {
    await page.evaluate((b) => window.belugaEssai?.bullesDuDirect?.(null, b), BULLES);
    await page.waitForTimeout(400);
    if (await page.locator('[data-bulle-vocale] [data-bulles-du-direct]').count()) return true;
  }
  return false;
}
async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.mouse.move(700, 120);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}
const BULLES = [
  { role: 'user', texte: 'Quelles tâches sont en cours ?' },
  { role: 'assistant', texte: 'Deux tâches tournent : « Corrections des films de la vitrine » et « Présentation Beluga Build à jour ».' },
  { role: 'user', texte: 'Crée-moi une tâche pour les raccourcis.' },
];
/* UNE RÉPONSE LONGUE AVEC UN TABLEAU (17/11/2026, capture #2b157 : les bulles coupaient à la première phrase). */
const REPONSE_LONGUE =
  'Voici où en sont les **trois** projets. Le premier avance bien, le deuxième attend ta validation.\n\n' +
  '| Projet | État | Reste |\n| --- | --- | --- |\n| Beluga | En cours | 2 tâches |\n| Toogo | À valider | 1 tâche |\n| Haiko | Terminé | rien |\n\n' +
  'Dernière phrase entière de la réponse, jamais coupée.';
const BULLES_LONGUES = [...BULLES, { role: 'assistant', texte: REPONSE_LONGUE }];

/** La boîte du bouton visible, et son état (caché par le morphing ou non). */
const boutonVu = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('[data-bouton-du-bord]')?.getBoundingClientRect();
    const enveloppe = document.querySelector('[data-jarvis-natif]');
    return {
      boite: b ? { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } : null,
      cache: enveloppe ? getComputedStyle(enveloppe).visibility === 'hidden' : null,
      bord: enveloppe?.getAttribute('data-bord') ?? null,
      morphing: enveloppe?.getAttribute('data-morphing') ?? null,
    };
  });

/**
 * LE MORPHING, IMAGE PAR IMAGE : un relevé posé DANS la page (requestAnimationFrame) note à chaque image la boîte et
 * l'étape du calque, et la visibilité du bouton ; on le lit une fois, à la fin.
 */
async function releverLeMorphing(page, geste, ms = 1600) {
  await page.evaluate(() => {
    const notes = [];
    window.__morphing = notes;
    const debut = performance.now();
    const boucle = () => {
      const c = document.querySelector('[data-calque-du-morphing]');
      const r = c?.getBoundingClientRect();
      notes.push({
        t: Math.round(performance.now() - debut),
        etape: c?.getAttribute('data-morphing-etape') ?? null,
        sens: c?.getAttribute('data-morphing-du-bord') ?? null,
        boite: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
        boutonCache: getComputedStyle(document.querySelector('[data-jarvis-natif]') ?? document.body).visibility === 'hidden',
        bulleOpacite: document.querySelector('[data-bulle-vocale]') ? getComputedStyle(document.querySelector('[data-bulle-vocale]')).opacity : null,
      });
      if (performance.now() - debut < 2400) requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
  });
  await geste();
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__morphing);
}
const proche = (a, b, tol = 3) => !!a && !!b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= tol);
async function capturesDuMorphing(page, prefixe, geste) {
  if (!CAPTURES) return geste();
  const instants = [0, 80, 200, 350, 500, 800];
  await geste();
  const debut = Date.now();
  for (const ms of instants) {
    const attente = ms - (Date.now() - debut);
    if (attente > 0) await page.waitForTimeout(attente);
    await page.screenshot({ path: path.join(CAPTURES, `${prefixe}-${String(ms).padStart(3, '0')}ms.png`) });
  }
}

let navigateur = null;
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  poserLeDecor();
  for (let i = 0; i < 90; i += 1) {
    const ok = await fetch(BASE).then((r) => r.ok, () => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });

  /* ===== Ordinateur ===== */
  poserLeTheme('sombre');
  const { contexte, page, erreurs } = await ouvrirPage(navigateur);

  // 1. Maj Maj ouvre la bulle, pas le volet.
  await majMaj(page);
  let e = await attendre(page, (x) => x.bulle);
  verifier('Maj Maj ouvre la conversation dans la bulle vocale, sans le volet', e.conversation && e.bulle && !e.volet, JSON.stringify(e));

  // 2. Deux boutons ronds de même taille, plus de bouton fenêtre (20/11/2026).
  const boutons = await page.evaluate(() =>
    ['[data-jarvis-micro]', '[data-jarvis-raccrocher]'].map((s) => {
      const r = document.querySelector(`[data-bulle-vocale] ${s}`)?.getBoundingClientRect();
      return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null;
    }),
  );
  verifier('la bulle porte Muet et Arrêter, de même taille', boutons.every((b) => b === '44x44'), boutons.join(' '));
  verifier('plus de bouton fenêtre vers le volet', (await page.locator(['jarvis-deplier'].map((n) => `[data-${n}]`).join('')).count()) === 0);
  const boite = await page.locator('[data-bulle-vocale]').boundingBox();
  verifier('la bulle se pose en bas de l’écran, dans l’écran', !!boite && boite.y + boite.height <= 900 && boite.y > 450 && boite.x >= 0 && boite.x + boite.width <= 1440, JSON.stringify(boite));
  const pile = await poserLesBulles(page);
  const auDessus = await page.evaluate(() => {
    const p = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]')?.getBoundingClientRect();
    const b = document.querySelector('[data-bulle-vocale]')?.getBoundingClientRect();
    return !!p && !!b && p.bottom <= b.top + 1;
  });
  verifier('les bulles de l’échange flottent au-dessus de la bulle vocale', pile && auDessus);
  await capturer(page, 'ordinateur-sombre-bulle');

  // 3. Aucun volet pendant la voix, même sur le signal d'ouverture (20/11/2026).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  await page.waitForTimeout(800);
  e = await etat(page);
  verifier('le signal « ouvrir l’assistant » n’ouvre aucun volet pendant la voix', !e.volet && e.bulle && e.conversation, JSON.stringify(e));

  // 4. Une production reste dans les bulles.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:voix-directe', { detail: { type: 'voix.direct.production', agentId: 'x', messageId: 'm-essai' } })));
  await page.waitForTimeout(800);
  e = await etat(page);
  verifier('une production de Jarvis n’ouvre plus le volet', !e.volet && e.bulle, JSON.stringify(e));

  // 5. Second Maj Maj : arrêt.
  await page.mouse.click(700, 400);
  await majMaj(page);
  e = await attendre(page, (x) => !x.conversation && !x.bulle);
  verifier('un second Maj Maj arrête la conversation et retire la bulle', !e.conversation && !e.bulle, JSON.stringify(e));

  // Deux majuscules tapées dans un champ ne déclenchent rien (un champ de la page : le volet n'existe plus avec la voix).
  await page.evaluate(() => {
    const champ = document.createElement('textarea');
    champ.setAttribute('data-champ-d-essai', '');
    champ.style.cssText = 'position:fixed;top:120px;left:400px;width:300px;height:60px;z-index:99';
    document.body.appendChild(champ);
  });
  const champ = page.locator('[data-champ-d-essai]');
  await champ.click();
  for (const lettre of ['KeyO', 'KeyK']) {
    await page.keyboard.down('Shift');
    await page.keyboard.press(lettre);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);
  e = await etat(page);
  const tape = await champ.inputValue();
  verifier('taper « OK » dans un champ ne lance pas Jarvis', !e.conversation && tape === 'OK', `tapé « ${tape} » ${JSON.stringify(e)}`);
  await champ.fill('');
  // Le raccourci marche aussi dans un champ.
  await majMaj(page);
  e = await attendre(page, (x) => x.conversation);
  verifier('Maj Maj marche aussi depuis un champ d’écriture, sans volet', e.conversation && !e.volet, JSON.stringify(e));
  await majMaj(page);
  await attendre(page, (x) => !x.conversation);
  await page.evaluate(() => document.querySelector('[data-champ-d-essai]')?.remove());
  await page.waitForTimeout(500);

  // 6. Le bouton du bord, et LE MORPHING (17/11/2026, illustration #0666). Le volet vient de se fermer : son retour au
  // bouton (morphing) se laisse finir avant de relever le suivant.
  await page.waitForTimeout(1500);
  const avantOuverture = await boutonVu(page);
  const ouverture = await releverLeMorphing(page, () => page.locator('[data-bouton-du-bord]').click());
  e = await attendre(page, (x) => x.bulle);
  verifier('le toucher du bouton du bord ouvre la bulle, pas le volet', e.bulle && !e.volet && e.conversation, JSON.stringify(e));
  const premieres = ouverture.filter((n) => n.boite);
  const etapesVues = [...new Set(premieres.map((n) => n.etape))];
  verifier('à l’ouverture, le calque part de la boîte du bouton', proche(premieres[0]?.boite, avantOuverture.boite, 4), `${JSON.stringify(premieres[0]?.boite)} / bouton ${JSON.stringify(avantOuverture.boite)}`);
  verifier('le morphing passe par traits → cercle → glisse → bulle', ['traits', 'cercle', 'glisse', 'bulle'].every((x) => etapesVues.includes(x)) && etapesVues.indexOf('traits') < etapesVues.indexOf('bulle'), etapesVues.join(' → '));
  verifier('le bouton disparaît dès le début et reste caché bulle ouverte', ouverture.filter((n) => n.boite).every((n) => n.boutonCache) && (await boutonVu(page)).cache === true);
  const finOuverture = await page.locator('[data-bulle-vocale]').boundingBox();
  const derniere = premieres.at(-1)?.boite;
  verifier('le calque finit sur la boîte de la bulle, puis la bulle se montre', proche(derniere, finOuverture && { x: Math.round(finOuverture.x), y: Math.round(finOuverture.y), w: Math.round(finOuverture.width), h: Math.round(finOuverture.height) }, 6) && ouverture.at(-1)?.bulleOpacite === '1' && !ouverture.at(-1)?.boite, `${JSON.stringify(derniere)} / ${JSON.stringify(finOuverture)}`);
  // Toujours en bas à droite, à gauche du rond du terminal.
  verifier('la bulle est en bas à droite, à 16 px du bord droit comme du bas (17/11/2026)', !!finOuverture && Math.abs(finOuverture.x + finOuverture.width - (1440 - 16)) <= 2 && Math.abs(finOuverture.y + finOuverture.height - (900 - 16)) <= 2, JSON.stringify(finOuverture));
  // Une réponse longue avec un tableau se lit en entier.
  for (let i = 0; i < 15; i += 1) {
    await page.evaluate((b) => window.belugaEssai?.bullesDuDirect?.(null, b), BULLES_LONGUES);
    await page.waitForTimeout(400);
    if (await page.locator('[data-bulle-vocale] [data-texte-entier] table').count()) break;
  }
  const longue = await page.evaluate(() => {
    const bulles = [...document.querySelectorAll('[data-bulle-vocale] [data-bulle="jarvis"]')];
    const derniere = bulles.at(-1);
    const tableau = derniere?.querySelector('table');
    const enveloppe = derniere?.querySelector('[data-tableau-markdown]');
    const b = document.querySelector('[data-bulle-vocale]')?.getBoundingClientRect();
    const d = derniere?.getBoundingClientRect();
    return {
      texte: derniere?.innerText ?? '',
      lignes: tableau?.querySelectorAll('tbody tr').length ?? 0,
      gras: !!derniere?.querySelector('strong'),
      dansLaBulle: !!b && !!d && d.right <= b.right + 1 && d.left >= b.left - 1,
      tableauDansSonCadre: !!enveloppe && enveloppe.getBoundingClientRect().right <= (d?.right ?? 0) + 1,
    };
  });
  verifier('une réponse longue de Jarvis se lit ENTIÈRE, avec son tableau et son gras', longue.texte.includes('Dernière phrase entière de la réponse, jamais coupée.') && longue.lignes === 3 && longue.gras, `${longue.lignes} lignes, « …${longue.texte.slice(-50)} »`);
  verifier('la réponse et son tableau restent dans la largeur de la bulle', longue.dansLaBulle && longue.tableauDansSonCadre, JSON.stringify(longue));
  /* LES BULLES AU-DESSUS DU COMPOSANT, ALIGNÉES SUR SES BORDS, 90 % AU PLUS, JARVIS EN BLEU (décision du 17/11/2026,
     maquette #26a8d) — et le rond du terminal remonté au-dessus de Jarvis, jamais dessous. */
  const pileJ = await page.evaluate(() => {
    const carte = document.querySelector('[data-bulle-vocale]')?.getBoundingClientRect();
    const pied = document.querySelector('[data-bulle-vocale] [data-pied-vocal]')?.getBoundingClientRect();
    const bulles = [...document.querySelectorAll('[data-bulle-vocale] [data-bulle="jarvis"], [data-bulle-vocale] [data-bulle="vous"]')].map((b) => {
      const corps = b.firstElementChild;
      const r = corps.getBoundingClientRect();
      return { qui: b.getAttribute('data-bulle'), left: r.left, right: r.right, width: r.width, bottom: r.bottom, fond: getComputedStyle(corps).backgroundColor, texte: getComputedStyle(corps).color };
    });
    const rond = document.querySelector('[data-rond-seul]')?.getBoundingClientRect();
    return { carte: carte && { left: carte.left, right: carte.right, top: carte.top, width: carte.width }, pied: pied && { top: pied.top }, bulles, rond: rond && { bottom: rond.bottom, height: rond.height } };
  });
  const deJarvis = pileJ.bulles.filter((b) => b.qui === 'jarvis');
  verifier('les bulles de Jarvis touchent le bord gauche du composant', deJarvis.length > 0 && deJarvis.every((b) => Math.abs(b.left - pileJ.carte.left) <= 1), JSON.stringify(deJarvis.map((b) => b.left)) + ' / ' + pileJ.carte?.left);
  const deVous = pileJ.bulles.filter((b) => b.qui === 'vous');
  verifier('les vôtres touchent son bord droit', deVous.every((b) => Math.abs(b.right - pileJ.carte.right) <= 1), JSON.stringify(deVous.map((b) => b.right)) + ' / ' + pileJ.carte?.right);
  verifier('aucune bulle ne dépasse 90 % de la largeur du composant', pileJ.bulles.every((b) => b.width <= pileJ.carte.width * 0.9 + 1), JSON.stringify(pileJ.bulles.map((b) => Math.round(b.width))));
  verifier('les bulles restent AU-DESSUS du composant, jamais dedans', pileJ.bulles.every((b) => b.bottom <= pileJ.carte.top + 1), JSON.stringify(pileJ.bulles.map((b) => b.bottom)) + ' / ' + pileJ.carte?.top);
  verifier('les bulles de Jarvis sont bleues, texte blanc en sombre', deJarvis.every((b) => /rgb\(0, 1\d\d, 2\d\d\)/.test(b.fond) && b.texte === 'rgb(255, 255, 255)'), JSON.stringify(deJarvis.map((b) => [b.fond, b.texte])));
  await page.waitForTimeout(400); // le rond se relève quatre fois par seconde
  const rond = await page.evaluate(() => {
    const r = document.querySelector('[data-rond-seul]')?.getBoundingClientRect();
    const haut = Math.min(...[...document.querySelectorAll('[data-bulle-vocale], [data-bulle-vocale] [data-bulles-du-direct]')].map((e) => e.getBoundingClientRect().top));
    return r ? { bottom: r.bottom, haut } : null;
  });
  verifier('le rond du terminal remonte au-dessus de Jarvis et de ses bulles', !rond || rond.bottom <= rond.haut + 1, JSON.stringify(rond));
  await capturer(page, 'ordinateur-sombre-reponse-longue');
  // L'arrêt : le calque revient sur le bouton, qui réapparaît à sa place.
  const fermeture = await releverLeMorphing(page, () => page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').click(), 1800);
  e = await attendre(page, (x) => !x.conversation && !x.bulle);
  verifier('Arrêter dans la bulle arrête la conversation', !e.conversation && !e.bulle, JSON.stringify(e));
  const retour = fermeture.filter((n) => n.boite);
  const apres = await boutonVu(page);
  verifier('à la fermeture, le morphing joue à l’envers jusqu’au bouton', retour.length > 3 && retour.every((n) => n.sens === 'fermeture') && retour.at(-1)?.etape === 'traits' && proche(retour.at(-1)?.boite, apres.boite, 4), `${[...new Set(retour.map((n) => n.etape))].join(' → ')} ; fin ${JSON.stringify(retour.at(-1)?.boite)} / bouton ${JSON.stringify(apres.boite)}`);
  verifier('le bouton réapparaît exactement à sa place', apres.cache === false && apres.morphing === 'repos' && proche(apres.boite, avantOuverture.boite, 1), JSON.stringify(apres));
  // Un double toucher rapide (ouvrir puis arrêter en plein vol) ne laisse rien de coincé.
  await page.locator('[data-bouton-du-bord]').click();
  await page.waitForTimeout(250);
  await majMaj(page);
  await page.waitForTimeout(2500);
  const coince = await boutonVu(page);
  e = await etat(page);
  verifier('ouvrir puis arrêter en plein morphing : le bouton revient, rien ne reste coincé', !e.bulle && coince.cache === false && !(await page.locator('[data-calque-du-morphing]').count()), JSON.stringify({ e, coince }));
  // Avec la voix, le volet n'existe pas (20/11/2026) : le signal d'ouverture ne cache pas le bouton.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  await page.waitForTimeout(1300);
  verifier('voix disponible : aucun volet, le bouton reste à sa place', !(await page.locator('[data-assistant-chat]').count()) && (await boutonVu(page)).cache === false);

  // 7. Réglages › Voix.
  await page.evaluate(() => (window.location.hash = '#reglages/voix'));
  const champRaccourci = page.locator('[data-raccourci-ecoute]').first();
  await champRaccourci.waitFor({ timeout: 20_000 });
  verifier('le réglage affiche « Maj Maj » par défaut', (await champRaccourci.innerText()).includes('Maj Maj'), await champRaccourci.innerText());
  await capturer(page, 'ordinateur-sombre-reglage');
  await champRaccourci.click();
  await page.keyboard.down('Meta');
  await page.keyboard.press('KeyC');
  await page.keyboard.up('Meta');
  await page.waitForTimeout(300);
  const refus = await page.locator('[data-raccourci-ecoute] ~ *, p.text-danger').allInnerTexts();
  verifier('Cmd + C est refusé (raccourci du système)', refus.some((r) => /système ou au navigateur/.test(r)), refus.join(' | '));
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(80);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1200);
  const libelle = await champRaccourci.innerText();
  verifier('Ctrl + Maj relâchés seuls sont capturés', libelle.includes('Ctrl + Maj') || libelle.includes('⌃ ⇧'), libelle);
  await page.mouse.click(700, 120);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(80);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  e = await attendre(page, (x) => x.conversation);
  verifier('Ctrl + Maj ouvre ensuite Jarvis partout', e.conversation, JSON.stringify(e));
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(80);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await attendre(page, (x) => !x.conversation);
  await page.locator('[data-raccourci-defaut]').click();
  await page.waitForTimeout(1000);
  verifier('« Réinitialiser » rend Maj Maj', (await champRaccourci.innerText()).includes('Maj Maj'), await champRaccourci.innerText());
  verifier('aucune erreur ne sort de la page (ordinateur)', erreurs.length === 0, erreurs[0] ?? '');
  await contexte.close();

  /* ===== Bouton posé à gauche : la bulle reste en bas à droite ===== */
  poserLaPreference('jarvis-bord-ordinateur', { bord: 'gauche', fraction: 0.4 });
  {
    const o = await ouvrirPage(navigateur);
    const b0 = await boutonVu(o.page);
    const releve = await releverLeMorphing(o.page, () => o.page.locator('[data-bouton-du-bord]').click());
    await attendre(o.page, (x) => x.bulle);
    const b = await o.page.locator('[data-bulle-vocale]').boundingBox();
    verifier('bouton posé à gauche : la bulle s’ouvre quand même en bas à droite', b0.bord === 'gauche' && !!b && Math.abs(b.x + b.width - (1440 - 16)) <= 2, `${b0.bord} ${JSON.stringify(b)}`);
    verifier('bouton à gauche : le calque part de lui, à gauche', (releve.find((n) => n.boite)?.boite?.x ?? 999) <= 2);
    await capturer(o.page, 'ordinateur-sombre-bouton-a-gauche');
    await o.page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').click();
    await attendre(o.page, (x) => !x.bulle);
    await o.page.waitForTimeout(1500);
    verifier('bouton à gauche : il revient à gauche', proche((await boutonVu(o.page)).boite, b0.boite, 1) && (await boutonVu(o.page)).cache === false);
    await o.contexte.close();
  }
  poserLaPreference('jarvis-bord-ordinateur', null);

  /* ===== Mouvement réduit : aucun calque ===== */
  {
    const o = await ouvrirPage(navigateur, { reduit: true });
    const releve = await releverLeMorphing(o.page, () => o.page.locator('[data-bouton-du-bord]').click(), 800);
    const e2 = await attendre(o.page, (x) => x.bulle);
    verifier('mouvement réduit : la bulle s’ouvre d’un coup, sans calque, bouton caché', e2.bulle && releve.every((n) => !n.boite) && (await boutonVu(o.page)).cache === true);
    await o.page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').click();
    await attendre(o.page, (x) => !x.bulle);
    await o.page.waitForTimeout(500);
    verifier('mouvement réduit : le bouton revient d’un coup', (await boutonVu(o.page)).cache === false);
    await o.contexte.close();
  }

  /* ===== Téléphone : jamais en bas ===== */
  poserLaPreference('jarvis-bord-telephone', { bord: 'bas', fraction: 0.8 });
  {
    const o = await ouvrirPage(navigateur, { telephone: true });
    const b0 = await boutonVu(o.page);
    verifier('téléphone : une place ancienne au bas revient sur un côté', b0.bord === 'droite', JSON.stringify(b0));
    // Glisser le bouton tout en bas, au milieu : il finit sur un côté.
    const depart = await o.page.locator('[data-bouton-du-bord]').boundingBox();
    await o.page.mouse.move(depart.x + depart.width / 2, depart.y + depart.height / 2);
    await o.page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await o.page.mouse.move(depart.x + (150 - depart.x) * (i / 12), depart.y + (838 - depart.y) * (i / 12));
    await o.page.mouse.up();
    await o.page.waitForTimeout(800);
    const b1 = await boutonVu(o.page);
    verifier('téléphone : lâché tout en bas, le bouton se pose sur un côté', b1.bord === 'gauche' || b1.bord === 'droite', JSON.stringify(b1));
    verifier('téléphone : aucune erreur ne sort de la page (place du bouton)', o.erreurs.length === 0, o.erreurs[0] ?? '');
    await o.contexte.close();
  }
  poserLaPreference('jarvis-bord-telephone', null);

  /* ===== Téléphone, et captures clair/sombre ===== */
  for (const clarte of CAPTURES ? ['sombre', 'clair'] : ['sombre']) {
    poserLeTheme(clarte);
    for (const telephone of CAPTURES ? [false, true] : [true]) {
      const o = await ouvrirPage(navigateur, { telephone });
      const appareil = telephone ? 'telephone' : 'ordinateur';
      await capturesDuMorphing(o.page, `${appareil}-${clarte}-morphing-ouverture`, () =>
        telephone ? o.page.locator('[data-bouton-du-bord]').tap() : o.page.locator('[data-bouton-du-bord]').click(),
      );
      e = await attendre(o.page, (x) => x.bulle);
      await poserLesBulles(o.page);
      const b = await o.page.locator('[data-bulle-vocale]').boundingBox();
      const deborde = await o.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const largeur = telephone ? 390 : 1440;
      verifier(`${appareil} ${clarte} : la bulle s’ouvre et tient dans l’écran`, e.bulle && !!b && b.x >= 0 && b.x + b.width <= largeur && deborde <= 0, `${JSON.stringify(b)} débord ${deborde}`);
      await capturer(o.page, `${appareil}-${clarte}-bulle`);
      /* LE CHEVRON (carte « Ménage de la mémoire de la voix », 18/11/2026) : centré entre la pile et le panneau vocal, il
         replie les bulles puis les rouvre ; en mode Jarvis sur téléphone, le champ de la page sous la bulle se retire. */
      const chevron = o.page.locator('[data-bulle-vocale] [data-replier-les-bulles]');
      const centre = await chevron.boundingBox();
      const bulleBoite = await o.page.locator('[data-bulle-vocale]').boundingBox();
      verifier(
        `${appareil} ${clarte} : le chevron est centré entre les bulles et le panneau`,
        !!centre && !!bulleBoite && Math.abs(centre.x + centre.width / 2 - (bulleBoite.x + bulleBoite.width / 2)) <= 2 && centre.y + centre.height <= bulleBoite.y + 1,
        JSON.stringify({ centre, bulleBoite }),
      );
      await (telephone ? chevron.tap() : chevron.click());
      await o.page.waitForTimeout(300);
      const repliees = (await o.page.locator('[data-bulle-vocale] [data-bulles-repliees]').count()) === 1 && (await o.page.locator('[data-bulle-vocale] [data-bulles-du-direct]').count()) === 0;
      verifier(`${appareil} ${clarte} : un toucher du chevron replie les bulles`, repliees && (await chevron.getAttribute('data-replier-les-bulles')) === 'repliees');
      await capturer(o.page, `${appareil}-${clarte}-bulles-repliees`);
      await (telephone ? chevron.tap() : chevron.click());
      await o.page.waitForTimeout(300);
      verifier(`${appareil} ${clarte} : un second toucher les rouvre`, (await o.page.locator('[data-bulle-vocale] [data-bulles-du-direct]').count()) === 1);
      if (telephone) {
        const champVisible = await o.page.evaluate(() =>
          [...document.querySelectorAll('[data-champ-sous-jarvis] textarea, [data-champ-sous-jarvis] [data-mic-button]')].some((el) => (el instanceof HTMLElement ? el.offsetParent !== null : false)),
        );
        verifier(`${appareil} ${clarte} : en mode Jarvis, le champ de la page ne dépasse plus sous la bulle`, !champVisible);
      }
      // La voix de Jarvis refusée par le navigateur (iPhone) : le pied vocal le dit, avec un bouton (17/11/2026).
      let sonBloque = false;
      for (let i = 0; i < 15 && !sonBloque; i += 1) {
        await o.page.evaluate((bulles) => window.belugaEssai?.bullesDuDirect?.(null, bulles, { sonBloque: true }), BULLES);
        await o.page.waitForTimeout(400);
        sonBloque = (await o.page.locator('[data-bulle-vocale] [data-jarvis-activer-son]').count()) > 0;
      }
      verifier(`${appareil} ${clarte} : la voix bloquée se dit, avec « Toucher pour entendre Jarvis »`, sonBloque);
      await capturer(o.page, `${appareil}-${clarte}-son-bloque`);
      if (CAPTURES) {
        for (let i = 0; i < 15; i += 1) {
          await o.page.evaluate((b) => window.belugaEssai?.bullesDuDirect?.(null, b), BULLES_LONGUES);
          await o.page.waitForTimeout(400);
          if (await o.page.locator('[data-bulle-vocale] [data-texte-entier] table').count()) break;
        }
        await capturer(o.page, `${appareil}-${clarte}-reponse-longue`);
      }
      await capturesDuMorphing(o.page, `${appareil}-${clarte}-morphing-fermeture`, () =>
        telephone ? o.page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').tap() : o.page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').click(),
      );
      await attendre(o.page, (x) => !x.conversation);
      await o.page.waitForTimeout(1200);
      verifier(`${appareil} ${clarte} : la bulle fermée, le bouton revient`, (await boutonVu(o.page)).cache === false);
      if (CAPTURES) {
        await o.page.evaluate(() => (window.location.hash = '#reglages/voix'));
        await o.page.locator('[data-raccourci-ecoute]').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
        await o.page.locator('[data-raccourci-ecoute]').first().scrollIntoViewIfNeeded().catch(() => undefined);
        await capturer(o.page, `${appareil}-${clarte}-reglage`);
      }
      verifier(`${appareil} ${clarte} : aucune erreur ne sort de la page`, o.erreurs.length === 0, o.erreurs[0] ?? '');
      await o.contexte.close();
    }
  }
} catch (e) {
  verifier('le contrôle est allé au bout', false, String(e).slice(0, 400));
} finally {
  if (navigateur) await navigateur.close().catch(() => undefined);
  couperVite();
  nettoyer();
}

const rates = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - rates}/${resultats.length} contrôles passés`);
process.exit(rates ? 1 : 0);
