#!/usr/bin/env node
/**
 * LES GESTES DE JARVIS À L'ÉCRAN, DANS UN VRAI NAVIGATEUR (carte « Relier Beluga Pass dans les réglages », 16/11/2026).
 *
 * Sur un démon d'essai (base neuve), un plan de cinq gestes est joué vers l'onglet ouvert, comme si Jarvis l'avait
 * demandé pendant une conversation vocale (`jarvis.essai.jouer`, réservé aux démons d'essai) :
 *   ouvrir « #reglages/belugapass » → ouvrir le menu ⋮ → « Autre adresse de Beluga Pass » → taper l'adresse →
 *   « Enregistrer ». On vérifie :
 *  1. le curseur de Jarvis paraît et SE DÉPLACE, sa pastille « Jarvis » est là, il ne bloque aucun appui ;
 *  2. l'encadré « Jarvis agit sur l'écran » du module de voix coche chaque geste, et l'action finit ;
 *  3. le geste a vraiment eu lieu : l'adresse tapée est retenue par la page (champ React compris) ;
 *  4. le chemin réussi est gardé (table `jarvis_chemins`) ;
 *  5. un vrai mouvement de souris NE COUPE PLUS l'action (décision du 17/11/2026) ; seul l'arrêt demandé l'arrête :
 *     « Arrêté à votre demande », boutons
 *     « Reprendre » et « Annuler » DANS LE FIL ; « Reprendre » finit l'action, mais aucun chemin n'est gardé ;
 *  6. « Annuler » clôt une action arrêtée ;
 *  7. un geste qui engage (« Délier ») est refusé sans confirmation ; rien ne se clique ;
 *  8. téléphone (390 px, au doigt) : le curseur devient un rond, l'action va au bout ; captures clair et sombre ;
 *  9. le module de voix s'affiche toujours (MEM-7563) et la page n'a aucune erreur.
 *
 *   node scripts/verif-gestes-jarvis.mjs     (après `npm run build`, depuis la copie de la carte)
 *   VERIF_CAPTURES=/tmp/captures node scripts/verif-gestes-jarvis.mjs
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN` : la session d'une heure est fabriquée en base jetable, et part avec elle.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-gestes-jarvis-'));
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA, { recursive: true });
/* Un projet « Beluga », posé AVANT le démon : sans projet, l'application attend son premier montage. */
process.env.BELUGA_DATA = DATA;
{
  const store = await import(path.join(RACINE, 'server', 'dist', 'store.js'));
  const { Project } = await import('@beluga/shared');
  const depot = path.join(TMP, 'beluga');
  fs.mkdirSync(depot, { recursive: true });
  store.saveProject(Project.parse({ id: 'p-beluga-essai', name: 'Beluga', path: depot, createdAt: store.now(), updatedAt: store.now() }));
}
const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({ tmp: TMP, port: PORT, depot: false, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');

function base() {
  return new Database(path.join(DATA, 'beluga.db'));
}
function cheminsGardes() {
  const db = base();
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM jarvis_chemins').get().n;
  } finally {
    db.close();
  }
}
function poserLeTheme(clarte) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  db.close();
}

function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BASE.replace('http', 'ws')}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.on('message', (brut) => {
      const trame = JSON.parse(String(brut));
      if (trame.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      resolve(trame);
    });
    socket.on('error', (souci) => {
      clearTimeout(minuteur);
      reject(souci);
    });
  });
}

const ADRESSE = 'https://pass.exemple.ch';
const PLAN = [
  { action: 'ouvrir', cible: '#reglages/belugapass', libelle: 'J’ouvre les réglages de Beluga Pass' },
  { action: 'cliquer', cible: '[data-belugapass-options]', libelle: 'J’ouvre le menu de la liaison' },
  { action: 'cliquer', cible: 'Autre adresse de Beluga Pass', libelle: 'Je choisis « Autre adresse de Beluga Pass »' },
  { action: 'saisir', cible: '[data-belugapass-adresse]', texte: ADRESSE, libelle: 'Je tape l’adresse' },
  { action: 'cliquer', cible: '[data-belugapass-enregistrer-adresse]', libelle: 'J’enregistre' },
];

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function ouvrirLApplication(page) {
  for (let essai = 0; essai < 3; essai++) {
    await page.goto(`${BASE}/#`, { waitUntil: 'load' });
    if (await page.locator('[data-module-voix][data-onglet]').first().waitFor({ state: 'attached', timeout: 20_000 }).then(() => true, () => false)) return;
  }
  const vu = await page.evaluate(() => document.body.innerText.slice(0, 300) + ' | html: ' + document.body.innerHTML.slice(0, 600)).catch(() => '');
  await page.screenshot({ path: '/tmp/dbg-gestes-jarvis.png' }).catch(() => {});
  throw new Error(`le module de voix ne s’affiche pas — la page montre : ${vu}`);
}

const ongletDe = (page) => page.locator('[data-module-voix]').first().getAttribute('data-onglet');

async function jouer(page, titre, intention, gestes = PLAN) {
  const r = await appelDemon({ type: 'jarvis.essai.jouer', client: await ongletDe(page), titre, intention, gestes });
  if (r.error) throw new Error(r.error);
}

/** Ouvrir Jarvis AVANT l'action (barre d'appel sortie) : rien de ce qui s'y passe ne reprend la main. */
async function sourisSurLeModule(page) {
  if (await page.locator('[data-module-voix][data-ouvert]').count()) return;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant'))).catch(() => {});
  await page.locator('[data-module-voix][data-ouvert]').waitFor({ state: 'attached', timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  {
    const db = base();
    const T = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
    /* LE VOLET N'EXISTE QUE SANS LA VOIX (décision de l'utilisateur, 20/11/2026) : ce contrôle du volet coupe la voix. */
    db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('voix.active', 'false', T);
    // Le module de voix est montré (comme `verif-veille-jarvis.mjs`) : c'est lui qui porte l'écoute des gestes et le fil.
    db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('voix.visible', 'true', T);
    db.close();
  }
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const theme of ['light', 'dark']) {
      poserLeTheme(theme);
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', colorScheme: theme });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e.message ?? e)));
      await ouvrirLApplication(page);
      verifier(`le module de voix s’affiche (${theme})`, (await page.locator('[data-module-voix]').count()) === 1);
      await sourisSurLeModule(page);

      /* 1 à 4 : un plan joué jusqu'au bout. Le CADRE et l'ÉCLAIR (17/11/2026) sont relevés à chaque image : aucun cadre
         pendant la visée, un éclair bleu pâle sur la cible à chaque clic, éteint ensuite. */
      await page.evaluate(() => {
        const releve = { eclairs: 0, cadres: 0, fondEclair: '' };
        window.__releveJarvis = releve;
        new MutationObserver(() => {
          if (document.querySelector('[data-contour-jarvis]')) releve.cadres += 1;
          const eclair = document.querySelector('[data-eclair-jarvis][data-allume]');
          if (eclair && !eclair.__compte) {
            eclair.__compte = true;
            releve.eclairs += 1;
            releve.fondEclair = getComputedStyle(eclair).backgroundColor;
          } else if (!eclair) document.querySelectorAll('[data-eclair-jarvis]').forEach((e) => (e.__compte = false));
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-allume', 'data-contour-jarvis'] });
      });
      const avant = cheminsGardes();
      await jouer(page, 'Changer l’adresse de Beluga Pass', theme === 'light' ? 'change l’adresse de Beluga Pass' : 'modifie l’adresse de Beluga Pass');
      const curseur = page.locator('[data-curseur-jarvis]');
      await curseur.waitFor({ state: 'attached', timeout: 10_000 });
      const depart = await curseur.getAttribute('data-x');
      if (theme === 'light') {
        verifier('le curseur de Jarvis paraît, avec sa pastille « Jarvis »', /Jarvis/.test((await curseur.textContent()) ?? ''));
        const traverse = await page.locator('[data-curseur-jarvis-calque]').evaluate((c) => getComputedStyle(c).pointerEvents);
        verifier('le curseur ne bloque aucun appui', traverse === 'none', traverse);
      }
      // Le curseur part vers sa première cible : on le saisit EN ROUTE (l'encadré du fil n'est plus un repère sûr).
      await page.waitForFunction((d) => { const c = document.querySelector('[data-curseur-jarvis]'); return !!c && c.getAttribute('data-x') !== d && !!document.querySelector('[data-pastille-jarvis]')?.textContent?.includes('·'); }, depart, { timeout: 15_000 }).catch(() => {});
      await capturer(page, `jarvis-agit-ordinateur-${theme}`);
      verifier(`le curseur se déplace vers sa cible (${theme})`, (await curseur.getAttribute('data-x').catch(() => depart)) !== depart);
      if (theme === 'light') {
        const bleu = await page.locator('[data-curseur-jarvis]').evaluate((c) => getComputedStyle(c).color).catch(() => '');
        verifier('le curseur de Jarvis est bleu (le bleu de sa voix)', /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)/.test(bleu) && (() => { const [, r, , b] = bleu.match(/(\d+),\s*(\d+),\s*(\d+)/).map(Number); return b > 180 && r < 80; })(), bleu);
        const pastille = (await page.locator('[data-pastille-jarvis]').textContent().catch(() => '')) ?? '';
        verifier('la pastille porte son nom et ce qu’il fait (« Jarvis · … »)', /^Jarvis · .+/.test(pastille.trim()), pastille);
      }
      const encadre = page.locator('[data-action-jarvis]').last();
      // La fin de l'action : le curseur s'en va (1,2 s après « finie »).
      await page.locator('[data-curseur-jarvis]').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
      const etatDeLEncadre = await encadre.getAttribute('data-action-jarvis', { timeout: 2000 }).catch(() => null);
      verifier(`l’action finit, chaque geste coché dans le fil (${theme})`, etatDeLEncadre === 'finie' && (await encadre.locator('[data-etat="done"]').count()) === PLAN.length, String(etatDeLEncadre));
      const releve = await page.evaluate(() => window.__releveJarvis);
      verifier(`aucun cadre autour de la cible pendant la visée (${theme})`, releve.cadres === 0, JSON.stringify(releve));
      verifier(`chaque clic allume un éclair bleu pâle sur la cible (${theme})`, releve.eclairs >= 2 && /rgba?\(\s*\d+,\s*\d+,\s*\d+,\s*0\.1/.test(releve.fondEclair), JSON.stringify(releve));
      verifier(`l’éclair s’éteint seul (${theme})`, (await page.locator('[data-eclair-jarvis][data-allume]').count()) === 0);
      const barre = await encadre.evaluate((e) => [...e.querySelectorAll('*')].some((x) => getComputedStyle(x).textDecorationLine.includes('line-through')), null, { timeout: 2000 }).catch(() => false);
      verifier('aucun geste barré', !barre);
      await capturer(page, `jarvis-fini-ordinateur-${theme}`);
      verifier(`le chemin réussi est gardé (${theme})`, cheminsGardes() === avant + 1, `${cheminsGardes()} chemin(s)`);
      // VERIF_CURSEUR_SEUL=1 : le curseur, l'éclair et le geste réel seulement (sans l'arrêt et la reprise, qui lisent l'encadré).
      if (process.env.VERIF_CURSEUR_SEUL) {
        verifier(`aucune erreur de page (${theme})`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await contexte.close();
        continue;
      }
      if (theme === 'light') {
        // La souris quitte le module (il se replie) : l'utilisateur vérifie lui-même, aucune action ne tourne.
        await page.mouse.move(600, 500);
        await page.waitForTimeout(700);
        await page.locator('[data-belugapass-options]').click();
        await page.locator('[data-belugapass-autre-adresse]').click();
        const valeur = await page.locator('[data-belugapass-adresse]').inputValue();
        verifier('le geste a vraiment eu lieu : l’adresse tapée par Jarvis est retenue', valeur === ADRESSE, valeur);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        await sourisSurLeModule(page);

        /* 5 : bouger la souris NE COUPE PLUS Jarvis ; seul l'arrêt demandé l'arrête ; « Reprendre » la finit, sans chemin gardé. */
        await jouer(page, 'Changer l’adresse malgré la souris', 'change l’adresse de Beluga Pass pendant que je bouge');
        await page.locator('[data-action-jarvis="en-cours"]').last().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        await page.mouse.move(700, 300, { steps: 4 });
        await page.mouse.move(760, 380, { steps: 4 });
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForFunction(() => [...document.querySelectorAll('[data-action-jarvis]')].at(-1)?.getAttribute('data-action-jarvis') !== 'en-cours', null, { timeout: 30_000 }).catch(() => {});
        const etatFinal = await page.locator('[data-action-jarvis]').last().getAttribute('data-action-jarvis');
        verifier('bouger la souris et cliquer ne coupent plus Jarvis : l’action va au bout', etatFinal === 'finie', etatFinal ?? 'aucune action');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await sourisSurLeModule(page);
        const avantArret = cheminsGardes();
        await jouer(page, 'Changer encore l’adresse', 'change encore l’adresse de Beluga Pass');
        await page.locator('[data-action-jarvis="en-cours"] [data-geste-jarvis="1"][data-etat="running"], [data-action-jarvis="en-cours"] [data-geste-jarvis="2"]').first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        await page.evaluate(() => window.dispatchEvent(new Event('beluga:arreter-action-jarvis')));
        const arretee = page.locator('[data-action-jarvis="arretee"]').last();
        await arretee.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        verifier('l’arrêt demandé arrête Jarvis aussitôt', (await arretee.count()) === 1);
        verifier('le fil dit « Arrêté à votre demande »', /Arrêté à votre demande/.test((await arretee.textContent().catch(() => '')) ?? ''));
        verifier('« Reprendre » et « Annuler » sont posés DANS le fil', (await arretee.locator('[data-reprendre-action]').count()) === 1 && (await arretee.locator('[data-annuler-action]').count()) === 1);
        await sourisSurLeModule(page);
        verifier('le volet de l’assistant reste devant la fenêtre ouverte, « Reprendre » joignable', await arretee.locator('[data-reprendre-action]').evaluate((b) => {
          const r = b.getBoundingClientRect();
          const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!dessus && b.contains(dessus);
        }).catch(() => false));
        await capturer(page, 'jarvis-arrete-ordinateur-light');
        await arretee.locator('[data-reprendre-action]').click({ timeout: 8_000 }).catch(async (e) => {
          await page.screenshot({ path: '/tmp/dbg-reprendre.png' });
          throw e;
        });
        const reprise = page.locator('[data-action-jarvis="finie"]').last();
        await page.waitForFunction(() => [...document.querySelectorAll('[data-action-jarvis]')].at(-1)?.getAttribute('data-action-jarvis') === 'finie', null, { timeout: 30_000 }).catch(() => {});
        verifier('« Reprendre » rejoue la suite jusqu’au bout', (await reprise.count()) >= 1 && (await page.locator('[data-action-jarvis]').last().getAttribute('data-action-jarvis')) === 'finie');
        verifier('un chemin interrompu n’est pas gardé', cheminsGardes() === avantArret, `${cheminsGardes()} chemin(s)`);

        /* 6 : « Annuler » clôt une action arrêtée. */
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await sourisSurLeModule(page);
        await jouer(page, 'Encore une fois', 'change l’adresse une troisième fois');
        await page.locator('[data-action-jarvis="en-cours"]').last().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(400);
        await page.evaluate(() => window.dispatchEvent(new Event('beluga:arreter-action-jarvis')));
        await page.locator('[data-action-jarvis="arretee"]').last().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        await sourisSurLeModule(page);
        await page.locator('[data-action-jarvis="arretee"] [data-annuler-action]').last().click().catch(() => {});
        await page.locator('[data-action-jarvis="annulee"]').last().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
        verifier('« Annuler » clôt l’action arrêtée', (await page.locator('[data-action-jarvis="annulee"]').count()) >= 1);

        /* 7 : un geste qui engage est refusé sans confirmation. */
        await page.keyboard.press('Escape');
        const nbAvant = await page.locator('[data-action-jarvis]').count();
        await jouer(page, 'Délier', 'délie Beluga Pass', [{ action: 'cliquer', cible: '[data-belugapass-delier]', libelle: 'Je délie Beluga Pass' }]);
        await page.waitForTimeout(1500);
        verifier('un geste qui engage est refusé sans confirmation : aucune action ne part', (await page.locator('[data-action-jarvis]').count()) === nbAvant);
      }
      verifier(`aucune erreur de page (${theme})`, !erreurs.length, erreurs.join(' | '));
      // Le volet ouvert est RETENU dans le compte : refermé ici, sans quoi le téléphone s'ouvrirait volet déplié, sans bouton.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant', { detail: { ouvrir: false } }))).catch(() => {});
      await page.waitForTimeout(800);
      await contexte.close();

      /* 8 : téléphone, au doigt. */
      const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', colorScheme: theme, hasTouch: true, isMobile: true });
      await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const pageTel = await tel.newPage();
      await ouvrirLApplication(pageTel);
      const avantTel = cheminsGardes();
      await jouer(pageTel, 'Changer l’adresse de Beluga Pass', 'change l’adresse de Beluga Pass depuis le téléphone');
      await pageTel.locator('[data-curseur-jarvis]').waitFor({ state: 'attached', timeout: 10_000 });
      await pageTel.waitForTimeout(1500);
      verifier(`téléphone (${theme}) : le curseur de Jarvis est un rond au doigt`, (await pageTel.locator('[data-curseur-jarvis] svg').count()) === 0);
      await capturer(pageTel, `jarvis-agit-telephone-${theme}`);
      const debut = Date.now();
      while (cheminsGardes() === avantTel && Date.now() - debut < 30_000) await pageTel.waitForTimeout(300);
      verifier(`téléphone (${theme}) : l’action va au bout`, cheminsGardes() === avantTel + 1);
      const deborde = await pageTel.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      verifier(`téléphone (${theme}) : rien ne déborde`, deborde <= 0, `${deborde} px`);
      await tel.close();
    }
  } finally {
    await navigateur.close();
    nettoyer();
  }
  const echecs = resultats.filter((r) => !r).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles verts`);
  process.exit(echecs ? 1 : 0);
}

principal().catch((err) => {
  console.error(err);
  console.error(journal.slice(-30).join(''));
  nettoyer();
  process.exit(1);
});
