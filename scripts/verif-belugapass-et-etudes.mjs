#!/usr/bin/env node
/**
 * LES ÉTUDES RATTACHÉES ET LA LIAISON BELUGA PASS, DANS UN VRAI NAVIGATEUR (carte « Audits passés et synchro Beluga
 * Pass », 15/11/2026).
 *
 * Sur un démon d'essai (base neuve, jamais celle en service) et un BELUGA PASS FACTICE local qui chiffre avec le VRAI
 * cœur de Beluga Pass (son module WebAssembly `bp_wasm`, copié dans le dossier temporaire) :
 *  1. au démarrage, l'étude du projet « Beluga » est rattachée seule : la liste Sécurité le montre suivi, sans audit en
 *     cours, « étude approfondie », et sa page montre le rapport classé par gravité, cases cochables ;
 *  2. les Réglages ont leur page « Beluga Pass » (elle a quitté le coffre-fort le 16/11/2026), en SIMPLE LISTE (piste
 *     D, même carte) : le bouton foncé « Relier » ouvre un onglet sur `<Beluga Pass>/app/beluga#endpoint=…&token=…`
 *     (valeurs dans le fragment) ET la petite fenêtre où trois étapes se cochent, sans texte barré ; « Saisir à la
 *     main » y montre la même clé ; Échap ne ferme qu'elle ; « Rouvrir » reprend la même clé ;
 *  3. Beluga Pass appelle avec cette clé : liaison reconnue, sauvegarde chiffrée reçue (date, coffres, fiches),
 *     une clé inconnue est refusée ;
 *  4. l'interrupteur « Accès des agents » prévient Beluga Pass (webhook) ; Beluga Pass confirme ; un agent lit un
 *     coffre scellé par bp-core et la lecture s'inscrit dans la page — sans qu'aucune valeur n'entre en base ;
 *  5. téléphone (390 px) : la page reste lisible, sans débordement, la petite fenêtre monte du bas ; captures en clair et en sombre ;
 *  6. le coffre-fort n'a plus de rubrique « Beluga Pass ».
 *
 *   node scripts/verif-belugapass-et-etudes.mjs     (après `npm run build`, depuis la copie de la carte)
 *   VERIF_CAPTURES=/tmp/captures node scripts/verif-belugapass-et-etudes.mjs
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN` : la session d'une heure est fabriquée en base jetable, et part avec elle.
 */
import { porteeSurTousLesProjets } from './lib/navigation.mjs';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7198);
const PORT_BP = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
const PROJET = '90b65dcb-5139-460a-998d-a93cec9230e1'; // le projet « Beluga » de l'étude figée (docs/securite/etudes-2026-11-15/beluga.md)
const VALEUR_FACTICE = 'MOT-DE-PASSE-FACTICE-' + crypto.randomBytes(4).toString('hex');

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ---------------- Le décor, posé AVANT le démon (l'import des études se fait à son démarrage) ---------------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-belugapass-'));
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA, { recursive: true });
process.env.BELUGA_DATA = DATA;
const store = await import(path.join(RACINE, 'server', 'dist', 'store.js'));
const { Project } = await import('@beluga/shared');
const DEPOT_PROJET = path.join(TMP, 'beluga');
fs.mkdirSync(DEPOT_PROJET, { recursive: true });
store.saveProject(Project.parse({ id: PROJET, name: 'Beluga', path: DEPOT_PROJET, createdAt: store.now(), updatedAt: store.now() }));
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  db.close();
}

/* ---------------- Le Beluga Pass factice, qui scelle avec le vrai bp-core ---------------- */
let core = null;
const SOURCE_WASM = '/root/belugapass/web/app/lib/bp-wasm';
if (fs.existsSync(path.join(SOURCE_WASM, 'bp_wasm_bg.wasm'))) {
  const dossier = path.join(TMP, 'bp-wasm');
  fs.mkdirSync(dossier);
  fs.copyFileSync(path.join(SOURCE_WASM, 'bp_wasm.js'), path.join(dossier, 'bp_wasm.mjs'));
  fs.copyFileSync(path.join(SOURCE_WASM, 'bp_wasm_bg.wasm'), path.join(dossier, 'bp_wasm_bg.wasm'));
  core = await import(path.join(dossier, 'bp_wasm.mjs'));
  core.initSync({ module: fs.readFileSync(path.join(dossier, 'bp_wasm_bg.wasm')) });
}
const recus = [];
let accesBp = false;
let clePubliqueDesAgents = '';
const serveurBp = http.createServer(async (req, res) => {
  let corps = '';
  for await (const morceau of req) corps += morceau;
  recus.push({ methode: req.method, url: req.url, corps: corps ? JSON.parse(corps) : null, agent: req.headers['x-beluga-agent'] ?? null });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/beluga/agent/vaults') {
    if (!accesBp || !core) return res.writeHead(403).end('{}');
    const cle = core.random_key();
    const coffre = crypto.randomUUID();
    const fiche = crypto.randomUUID();
    return res.end(
      JSON.stringify({
        vaults: [{ id: coffre, meta_enc: core.encrypt_json(cle, coffre, JSON.stringify({ name: 'Serveurs' })), key_sealed: core.seal(clePubliqueDesAgents, cle) }],
        items: [{ id: fiche, vault_id: coffre, revision: 1, data_enc: core.encrypt_json(cle, fiche, JSON.stringify({ type: 'login', title: 'Console d’essai', fields: { username: 'essai', password: VALEUR_FACTICE }, urls: ['https://essai.exemple.ch'] })) }],
      }),
    );
  }
  return res.end('{"ok":true}');
});
await new Promise((r) => serveurBp.listen(PORT_BP, '127.0.0.1', r));

const { journal, attendrePort, nettoyer } = demarrerDemonDEssai({ tmp: TMP, port: PORT, depot: false, signaux: true });
const versBeluga = (methode, route, cle, corps) =>
  fetch(`${BASE}${route}`, {
    method: methode,
    headers: { ...(cle ? { authorization: `Bearer ${cle}` } : {}), ...(corps ? { 'content-type': 'application/json' } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  }).then(async (r) => ({ status: r.status, corps: await r.json().catch(() => null) }));

function poserLeTheme(clarte) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  db.close();
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.mouse.move(2, 2);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function ouvrirTousLesProjets(page) {
  /* LE FIL « SERVICE / PROJET » (20/11/2026) : le nom du service remet la page sur tous les projets. */
  const service = page.locator('[data-cran-a-menu="service-de-la-page"]').first();
  /* Au tout premier chargement, l'arrivée sur « Tableaux de bord » (rôle pas encore connu) peut devancer l'adresse :
     on la redonne, trois fois au plus. */
  for (let essai = 0; essai < 3; essai++) {
    await page.goto(`${BASE}/#securite`, { waitUntil: 'load' });
    if (await service.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false)) break;
    await page.goto(`${BASE}/#`, { waitUntil: 'load' });
  }
  await service.waitFor({ state: 'visible', timeout: 15_000 });
  if (!(await porteeSurTousLesProjets(page))) throw new Error('« Tous les projets » ne se choisit pas');
}

async function ouvrirLaPageBelugaPass(page) {
  for (let essai = 0; essai < 3; essai++) {
    await page.goto(`${BASE}/#reglages/belugapass`, { waitUntil: 'load' });
    if (await page.locator('[data-belugapass-page]:not([data-belugapass-page="chargement"])').first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) return;
    await page.goto(`${BASE}/#`, { waitUntil: 'load' });
  }
  throw new Error('la page « Beluga Pass » des Réglages ne s’ouvre pas');
}

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let cle = '';
  try {
    for (const theme of ['light', 'dark']) {
      poserLeTheme(theme === 'light' ? 'clair' : 'sombre');
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH', colorScheme: theme });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

      /* 1. L'étude rattachée au démarrage. */
      const ligne = page.locator(`[data-securite-ligne="${PROJET}"]`).first();
      for (let essai = 0; essai < 3; essai++) {
        await ouvrirTousLesProjets(page);
        if (await ligne.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false)) break;
        await page.goto('about:blank');
      }
      await ligne.waitFor({ state: 'visible', timeout: 5_000 });
      if (theme === 'light') {
        const texte = (await ligne.textContent()) ?? '';
        verifier('la liste montre Beluga suivi, sans audit en cours', !/Audit en cours/.test(texte), texte.slice(0, 120));
        verifier('les onze points de l’étude sont comptés par gravité', /1 élevée · 4 moyenne · 6 faible/.test(texte));
        await capturer(page, `securite-liste-ordinateur-${theme}`);
      }
      await ligne.click();
      const rapport = page.locator('[data-securite-rapport]:not([data-securite-rapport="attente"])').first();
      await rapport.waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(600);
      const phrase = (await rapport.textContent()) ?? '';
      if (theme === 'light') {
        verifier('le rapport dit « étude approfondie »', /étude approfondie/.test(phrase));
        const points = await page.locator('[data-securite-point^="etude:"]').count();
        verifier('le point élevé est ouvert, les autres repliés par gravité', points === 1, `${points} point(s) visible(s)`);
        verifier('un point grave a sa case, cochable', (await page.locator('[data-securite-point^="etude:un-autre-site"] [data-securite-case]').isEnabled()));
      }
      await capturer(page, `securite-etude-ordinateur-${theme}`);

      /* 2. La page Beluga Pass des Réglages (piste D) : une simple liste, la liaison dans une petite fenêtre. */
      await ouvrirLaPageBelugaPass(page);
      const pageBp = page.locator('[data-belugapass-page]').first();
      if (theme === 'light') {
        verifier('la page s’ouvre « non relié »', (await pageBp.getAttribute('data-belugapass-page')) === 'vide');
        verifier('une simple liste : Liaison, Accès des agents, Sauvegarde, sans grand dessin', (await page.locator('[data-belugapass-ligne="liaison"]').count()) === 1 && (await page.locator('[data-belugapass-ligne="acces"]').count()) === 1 && (await page.locator('[data-belugapass-sauvegarde]').count()) === 1 && (await page.locator('[data-belugapass-page] [data-belugapass-etapes]').count()) === 0);
        verifier('l’interrupteur des agents est grisé tant que rien n’est relié', await page.locator('[data-belugapass-acces]').isDisabled());
        verifier('aucune liste de lectures tant qu’il n’y en a pas', (await page.locator('[data-belugapass-lectures]').count()) === 0);
        const bouton = page.locator('[data-belugapass-relier]');
        const fondDuBouton = await bouton.evaluate((b) => getComputedStyle(b).backgroundColor);
        const clarte = (Number(/\d+/.exec(fondDuBouton.split(',')[0])?.[0]) || 0) + (Number(fondDuBouton.split(',')[1]) || 0) + (Number(fondDuBouton.split(',')[2]) || 0);
        verifier('le bouton « Relier » est plein et foncé (ni gris ni clair)', clarte < 200, fondDuBouton);
        await capturer(page, `reglages-belugapass-vide-ordinateur-${theme}`);
        await page.locator('[data-belugapass-options]').click();
        await page.locator('[data-belugapass-autre-adresse]').click();
        await page.locator('[data-belugapass-adresse]').fill(`http://127.0.0.1:${PORT_BP}`);
        await page.locator('[data-belugapass-enregistrer-adresse]').click();
        await page.locator('[data-belugapass-fenetre-adresse]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
        verifier('la petite fenêtre d’adresse se ferme sans fermer les Réglages', (await page.locator('[data-belugapass-page]').count()) === 1);
        const [onglet] = await Promise.all([page.context().waitForEvent('page', { timeout: 15_000 }), bouton.click()]);
        await onglet.waitForURL(/\/app\/beluga#/, { timeout: 15_000 }).catch(() => {});
        const adresseOuverte = onglet.url();
        await onglet.close();
        const fragment = new URLSearchParams(adresseOuverte.split('#')[1] ?? '');
        cle = fragment.get('token') ?? '';
        verifier('le bouton ouvre Beluga Pass sur /app/beluga', adresseOuverte.startsWith(`http://127.0.0.1:${PORT_BP}/app/beluga#`), adresseOuverte.replace(/token=[^&]+/, 'token=…'));
        verifier('l’adresse et la clé passent dans le fragment, jamais dans la requête', !adresseOuverte.includes('?') && fragment.get('endpoint') === BASE && /^bpl_[A-Za-z0-9_-]{40,}$/.test(cle), `endpoint=${fragment.get('endpoint')}`);
        const fenetre = page.locator('[data-belugapass-fenetre]');
        await fenetre.waitFor({ state: 'visible', timeout: 10_000 });
        verifier('la petite fenêtre « Relier Beluga Pass » s’ouvre avec trois étapes', (await fenetre.locator('[data-belugapass-etape]').count()) === 3);
        await page.locator('[data-belugapass-etape="ouvrir"][data-etat="done"]').waitFor({ state: 'attached', timeout: 15_000 });
        verifier('la première étape se coche seule, la deuxième attend', (await page.locator('[data-belugapass-etape="confirmer"]').getAttribute('data-etat')) === 'running');
        const barre = await fenetre.evaluate((f) => [...f.querySelectorAll('*')].some((e) => getComputedStyle(e).textDecorationLine.includes('line-through')));
        verifier('aucun texte barré dans la fenêtre', !barre);
        await page.locator('[data-belugapass-a-la-main]').click();
        const montree = page.locator('[data-belugapass-cle-montree]');
        await montree.waitFor({ state: 'visible', timeout: 15_000 });
        verifier('« Saisir à la main » montre la même clé, dans la fenêtre', ((await montree.textContent()) ?? '').trim() === cle && (await fenetre.locator('[data-belugapass-cle-montree]').count()) === 1);
        await capturer(page, `reglages-belugapass-attente-ordinateur-${theme}`);
        await page.keyboard.press('Escape');
        await fenetre.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
        verifier('Échap ferme la seule petite fenêtre, les Réglages restent', (await fenetre.count()) === 0 && (await page.locator('[data-belugapass-page="attente"]').count()) === 1);
        verifier('la ligne Liaison dit « En attente » et propose « Rouvrir »', /attente/i.test((await page.locator('[data-belugapass-ligne="liaison"] [data-belugapass-detail]').textContent()) ?? '') && /Rouvrir/.test((await bouton.textContent()) ?? ''));
        const [onglet2] = await Promise.all([page.context().waitForEvent('page', { timeout: 15_000 }), bouton.click()]);
        await onglet2.waitForURL(/\/app\/beluga#/, { timeout: 15_000 }).catch(() => {});
        const cle2 = new URLSearchParams(onglet2.url().split('#')[1] ?? '').get('token');
        await onglet2.close();
        verifier('« Rouvrir » reprend la même clé, sans en créer une nouvelle', cle2 === cle);
        await fenetre.waitFor({ state: 'visible', timeout: 10_000 });

        /* 3. Beluga Pass appelle avec cette clé. */
        verifier('une clé inconnue est refusée', (await versBeluga('GET', '/api/belugapass/link', 'bpl_inconnue_' + 'x'.repeat(30))).status === 401);
        const lien = await versBeluga('GET', '/api/belugapass/link', cle);
        clePubliqueDesAgents = lien.corps?.agent_public_key ?? '';
        verifier('la liaison est reconnue et rend la clé des agents', lien.status === 200 && clePubliqueDesAgents.length === 43, `statut ${lien.status}`);
        const miroir = {
          format: 'belugapass-mirror-1',
          account: { account_id: 'A1', kdf: {}, salt: 'c2Fs', keyset_enc: 'a2V5c2V0', public_key: 'cHVi' },
          vaults: [{ id: 'v1', kind: 'personal', meta_enc: 'bWV0YQ', key_sealed: 'c2NlbGxl', sensitive: false, revision: 3 }],
          items: Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, vault_id: 'v1', data_enc: 'ZGF0YQ', revision: 1, updated_at: 'x', deleted_at: null })),
          sent_at: new Date().toISOString(),
        };
        verifier('la sauvegarde chiffrée est reçue', (await versBeluga('POST', '/api/belugapass/mirror', cle, miroir)).status === 200);
        await page.locator('[data-belugapass-sauvegarde="recue"]').waitFor({ state: 'visible', timeout: 15_000 });
        verifier('les trois étapes sont cochées', (await page.locator('[data-belugapass-etape][data-etat="done"]').count()) === 3);
        verifier('la page montre la sauvegarde (12 fiches)', /12 fiches/.test((await page.locator('[data-belugapass-sauvegarde]').textContent()) ?? ''));
        verifier('la fenêtre dit « Beluga Pass est relié » et propose « Terminé »', (await fenetre.getAttribute('data-belugapass-fenetre')) === 'relie' && (await page.locator('[data-belugapass-termine]').isVisible()));
        await capturer(page, `reglages-belugapass-fenetre-reliee-ordinateur-${theme}`);
        await page.locator('[data-belugapass-termine]').click();
        await fenetre.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
        verifier('la page dit « Relié depuis » et range les gestes au menu ⋮', (await page.locator('[data-belugapass-page="relie"]').count()) === 1 && /Relié depuis/.test((await page.locator('[data-belugapass-ligne="liaison"] [data-belugapass-detail]').textContent()) ?? '') && (await page.locator('[data-belugapass-relier]').count()) === 0 && (await page.locator('[data-belugapass-options]').isVisible()));

        /* 4. L'interrupteur, puis une lecture par un agent. */
        await page.locator('[data-belugapass-acces]').click();
        await page.waitForTimeout(800);
        const webhook = recus.find((r) => r.url === '/api/beluga/webhook' && r.corps?.event === 'agent_access');
        verifier('ouvrir l’accès prévient Beluga Pass', webhook?.corps?.enabled === true);
        accesBp = true;
        verifier('Beluga Pass confirme l’ouverture', (await versBeluga('POST', '/api/belugapass/agent-access', cle, { enabled: true })).status === 200);
        await page.locator('[data-belugapass-acces="ouvert"]').waitFor({ state: 'visible', timeout: 15_000 });
        verifier('l’interrupteur se lit ouvert', true);
        if (core) {
          const bp = await import(path.join(RACINE, 'server', 'dist', 'belugapass.js'));
          const fiches = await bp.lireLesCoffres('Agent d’essai');
          verifier('un coffre scellé par bp-core s’ouvre et se lit', fiches.length === 1 && fiches[0].champs.password === VALEUR_FACTICE && fiches[0].coffre === 'Serveurs');
          verifier('Beluga Pass reçoit le nom de l’agent', recus.some((r) => r.url === '/api/beluga/agent/vaults' && r.agent === "Agent d'essai"));
          const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
          const fuite = tables.find(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()).includes(VALEUR_FACTICE));
          db.close();
          verifier('aucune valeur lue n’entre dans la base', !fuite, fuite ? `table ${fuite.name}` : '');
          await page.reload({ waitUntil: 'load' });
          await ouvrirLaPageBelugaPass(page);
          await page.locator('[data-belugapass-lectures]').waitFor({ state: 'visible', timeout: 15_000 });
          verifier('la lecture s’inscrit dans la page', /Agent d’essai/.test((await page.locator('[data-belugapass-lectures]').textContent()) ?? ''));
        } else {
          verifier('lecture par bp-core : non vérifiée (module WebAssembly de Beluga Pass absent)', true);
        }
        const assistant = await versBeluga('POST', '/api/belugapass/assistant', cle, { question: 'Quels mots de passe sont faibles ?', locale: 'fr', signals: { counts: { weak: 3 } } });
        verifier('l’assistant rend une intention', assistant.status === 200 && assistant.corps?.intent === 'filter' && assistant.corps?.filter === 'weak');
        await capturer(page, `reglages-belugapass-relie-ordinateur-${theme}`);
        const largeur = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        verifier('rien ne déborde à 1440 px', largeur <= 0);
      } else {
        await page.locator('[data-belugapass-page="relie"]').waitFor({ state: 'visible', timeout: 15_000 });
        await capturer(page, `reglages-belugapass-relie-ordinateur-${theme}`);
      }

      /* 5. Téléphone. */
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      // Au téléphone, la fenêtre des réglages se recompose : la page se rouvre par son adresse.
      await ouvrirLaPageBelugaPass(page);
      await page.waitForTimeout(600);
      const largeur = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      verifier(`téléphone (${theme === 'light' ? 'clair' : 'sombre'}) : rien ne déborde`, largeur <= 0, `${largeur} px`);
      verifier(`téléphone (${theme === 'light' ? 'clair' : 'sombre'}) : la page reste lisible`, await page.locator('[data-belugapass-page]').first().isVisible());
      await capturer(page, `reglages-belugapass-telephone-${theme}`);
      if (theme === 'light') {
        /* 6. Le coffre-fort n'a plus de rubrique « Beluga Pass ». */
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${BASE}/#coffre`, { waitUntil: 'load' });
        await page.locator('[data-coffre-rubrique="tous"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
        verifier('le coffre-fort n’a plus de rubrique « Beluga Pass »', (await page.locator('[data-coffre-rubrique="tous"]').count()) > 0 && (await page.locator('[data-coffre-rubrique="belugapass"]').count()) === 0);
      }
      verifier(`aucune erreur de page (${theme})`, !erreurs.length, erreurs.join(' | '));
      await contexte.close();
    }

    /* Délier : Beluga Pass est prévenu, l'ancienne clé ne vaut plus rien. */
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const lignes = db.prepare('SELECT token_hash FROM belugapass_liaison').all();
    db.close();
    verifier('la base ne garde que l’empreinte de la clé', lignes.length === 1 && lignes[0].token_hash !== cle && !JSON.stringify(lignes).includes(cle));
    verifier('Beluga Pass peut délier', (await versBeluga('DELETE', '/api/belugapass/link', cle)).status === 200);
    verifier('après déliaison, la clé est refusée', (await versBeluga('GET', '/api/belugapass/link', cle)).status === 401);
    /* Le bouton, une fois délié, en sombre : ordinateur puis téléphone. */
    {
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH', colorScheme: 'dark' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      await ouvrirLaPageBelugaPass(page);
      verifier('après déliaison, la page revient à « Relier »', (await page.locator('[data-belugapass-page]').first().getAttribute('data-belugapass-page')) === 'vide');
      const fond = await page.locator('[data-belugapass-relier]').evaluate((b) => getComputedStyle(b).backgroundColor);
      const somme = fond.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0);
      verifier('en sombre aussi, le bouton est plein et foncé', somme < 200, fond);
      await capturer(page, 'reglages-belugapass-vide-ordinateur-dark');
      await page.setViewportSize({ width: 390, height: 844 });
      await ouvrirLaPageBelugaPass(page);
      await page.waitForTimeout(600);
      verifier('téléphone : le bouton est visible', await page.locator('[data-belugapass-relier]').isVisible());
      await capturer(page, 'reglages-belugapass-vide-telephone-dark');
      await page.locator('[data-belugapass-options]').click();
      verifier('téléphone : le menu ⋮ s’ouvre', await page.locator('[data-belugapass-autre-adresse]').isVisible());
      await page.locator('[data-belugapass-autre-adresse]').click();
      const petite = page.locator('[data-belugapass-fenetre-adresse]');
      await petite.waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(500);
      const bas = await petite.evaluate((f) => f.getBoundingClientRect().bottom);
      verifier('téléphone : la petite fenêtre monte du bas de l’écran', Math.abs(bas - 844) <= 2, `bas à ${Math.round(bas)} px`);
      await capturer(page, 'reglages-belugapass-fenetre-telephone-dark');
      await contexte.close();
    }
  } finally {
    await navigateur.close();
    serveurBp.close();
    nettoyer();
  }
  const echecs = resultats.filter((r) => !r).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles verts`);
  process.exit(echecs ? 1 : 0);
}

principal().catch((err) => {
  console.error(err);
  console.error(journal.slice(-30).join(''));
  serveurBp.close();
  nettoyer();
  process.exit(1);
});
