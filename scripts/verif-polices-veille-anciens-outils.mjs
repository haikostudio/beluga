#!/usr/bin/env node
/**
 * POLICE DU PRODUIT, VEILLE LISIBLE, ANCIENS OUTILS RETIRÉS (carte « Campagne, studio et mode du champ », 11/11/2026)
 * — sur un DÉMON JETABLE, sans aucun moteur :
 *
 *  1. VEILLE — une veille dont le relais est mort : « Vérifier maintenant » DIT le résultat (contrôle en panne et son
 *     détail), la ligne passe en rouge, « Demander à l'agent de réparer » paraît, dans la conversation ET dans
 *     « Tâches récurrentes » ;
 *  2. POLICE — une police importée du projet (vrai woff2) : listée dans le volet Style, proposée dans le menu des
 *     polices, CHARGÉE dans le cadre d'aperçu (`document.fonts.check`), copiée dans le dossier de rendu de l'export
 *     avec sa déclaration `@font-face` (HyperFrames rend hors ligne, depuis ce dossier) ;
 *  3. MARKETING — l'évolution, les réglages du client, les réglages du service s'ouvrent dans Marketing ; l'ancienne
 *     adresse « #strategie/<dossier> » y mène ;
 *  4. COMMUNICATION — « Réglages avancés » s'ouvre dans Communication ; « #communication/<marque>/canaux » y mène ;
 *  5. rien ne déborde, aucune erreur de page, à 1440 et 390 px (captures clair et sombre si
 *     HAIKO_POLICES_VEILLE_CAPTURES est posé).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-polices-veille-anciens-outils.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_POLICES_VEILLE_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.HAIKO_POLICES_VEILLE_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
/* Une vraie police libre (Inter est embarquée par le Studio : on la range ici sous un AUTRE nom de famille, comme une
   police de produit qui ne fait pas partie des sept). */
const FICHIER_DE_POLICE = path.join(RACINE, 'outils', 'polices-de-composition', 'space-grotesk.woff2');
const FAMILLE = 'Produit Sans';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, demon, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-polices-veille-',
  port: PORT,
  depot: false,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0', BELUGA_PUBLICATION_SOCIALE: '0', BELUGA_COULISSES_ESSAI: '1', BELUGA_STRATEGIE_SANS_DIRECTEUR: '1' },
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusquA(test, limite = 10_000) {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await test().catch(() => false)) return true;
    await attendre(200);
  }
  return !!(await test().catch(() => false));
}
const jeton = crypto.randomBytes(32).toString('hex');

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const fin = setTimeout(() => (w.close(), reject(new Error('sans réponse'))), 60000);
    w.on('open', () => w.send(JSON.stringify({ id, cmd })));
    w.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) return clearTimeout(fin), w.close(), ev.ok === false ? reject(new Error(ev.error)) : resolve(ev.data);
    });
    w.on('error', reject);
  });
}

/** Le décor, écrit par les modules du démon eux-mêmes, dans SA base jetable. */
async function poserLeDecor() {
  process.env.BELUGA_DATA = DATA;
  const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
  const studio = await import(path.join(RACINE, 'server/dist/studio.js'));
  const polices = await import(path.join(RACINE, 'server/dist/studio-polices.js'));
  const veilles = await import(path.join(RACINE, 'server/dist/veille-de-carte.js'));
  const db = getDb();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), maintenant, maintenant + 3600_000, 'vérification polices et veille');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const dossier = path.join(PROJETS, 'p-essai');
  fs.mkdirSync(dossier, { recursive: true });
  store.saveProject(shared.Project.parse({ id: 'p-essai', name: 'Kipou', path: dossier, createdAt: maintenant, updatedAt: maintenant }));

  /* ---- La police du produit, rangée dans le projet, et une création qui l'emploie ---- */
  const r = polices.importerUnFichierDePolice('p-essai', { famille: FAMILLE, contenu: fs.readFileSync(FICHIER_DE_POLICE), nom: 'ProduitSans-Variable.woff2' });
  if (!r.ok) throw new Error(`police : ${r.raison}`);
  studio.ecrireEspaceStudio('p-essai', { kit: { policeTitre: FAMILLE } });
  const composition = shared.appliquerOperation(
    shared.compositionVide('9:16', 4),
    { op: 'lot', operations: [{ op: 'inserer', pisteId: 'vecteurs', segment: { id: 'd1', genre: 'texte', debut: 0, duree: 4, texte: 'Kipou', taille: 140, couleur: '#ffffff', position: { x: 50, y: 50 }, police: FAMILLE } }] },
    () => crypto.randomUUID().slice(0, 8),
  );
  if (!composition.ok) throw new Error(`composition : ${JSON.stringify(composition)}`);
  const creation = studio.creerCreation({ projectId: 'p-essai', titre: 'Teaser', formats: ['9:16'], composition: composition.composition });
  if (!creation.ok) throw new Error('création');

  /* ---- Une carte en veille, son relais tombé ---- */
  const site = http.createServer((_q, res) => (res.writeHead(200, { 'content-type': 'text/html' }), res.end('<p>En attente de validation</p>')));
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
  const adresse = `http://127.0.0.1:${site.address().port}/statut`;
  const carte = store.saveCard(shared.Card.parse({ id: 'c-veille', projectId: 'p-essai', title: 'Suivi de la validation Apple', column: 'running', position: 1, agentId: 'ag-veille', run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }));
  store.saveAgent(shared.Agent.parse({ id: 'ag-veille', projectId: 'p-essai', cardId: carte.id, role: 'task', title: 'Suivi', run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant }));
  const pose = await veilles.poserVeille({ agentId: 'ag-veille', cardId: carte.id, args: { raison: 'Apple valide la fiche', url: adresse, recette: { type: 'appel', motAttendu: 'Ready for Sale' }, intervalleMinutes: 15, dureeHeures: 48 } });
  if (!pose.ok) throw new Error(`veille : ${pose.raison ?? JSON.stringify(pose)}`);
  await new Promise((ok) => site.close(ok));
  await veilles.passerLaVeille(veilles.veilleDeLaCarte(carte.id).id);

  return { creationId: creation.creation.id, police: r.police, studio, shared, carte, veilleId: veilles.veilleDeLaCarte(carte.id).id };
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  for (const sombre of [false, true]) {
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
    await attendre(300);
    await page.screenshot({ path: path.join(CAPTURES, `${nom}-${sombre ? 'sombre' : 'clair'}.png`) }).catch(() => undefined);
  }
  await page.evaluate(() => document.documentElement.classList.toggle('dark', false));
}
const deborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const decor = await poserLeDecor();

  /* ---- Le dossier de rendu de l'export (ce que HyperFrames lit, hors ligne) ---- */
  const rendus = path.join(DATA, 'studio', 'rendus');
  const { preparerDossier: dossierDeRendu } = await import(path.join(RACINE, 'server/dist/studio-rendu.js'));
  if (typeof dossierDeRendu === 'function') {
    const c = decor.studio.lireCreation(decor.creationId);
    const d = await dossierDeRendu(c, decor.studio.compositionCourante(c.id), '9:16', 'essai');
    const page = fs.readFileSync(path.join(d.dossier, 'index.html'), 'utf8');
    const copies = decor.police.fichiers.every((f) => fs.existsSync(path.join(d.dossier, 'polices', f.fichier)) && page.includes(`url('polices/${f.fichier}')`));
    noter('export : la police du produit est copiée dans le dossier de rendu et déclarée', copies, d.dossier);
    noter('export : le titre emploie la police du produit', page.includes(`'${FAMILLE}'`));
  } else noter('export : fonction du dossier de rendu exposée', false, Object.keys(await import(path.join(RACINE, 'server/dist/studio-rendu.js'))).join(', ') + ` — ${rendus}`);

  /* ---- Marketing : un dossier client ---- */
  const { dossier } = await commande({ type: 'strategie', action: 'dossier.creer', donnees: { sujet: { genre: 'projet', projectId: 'p-essai', nom: 'Kipou', url: 'https://example.com/' }, type: 'tpe' } });
  await commande({ type: 'communication.marque.creer', nom: 'Kipou', origine: 'projets', projets: ['p-essai'] }).catch((e) => console.log('  (marque : ' + e.message + ')'));
  const marques = await commande({ type: 'communication.marques' });
  const marque = (marques.marques ?? marques ?? []).find?.((m) => m.nom === 'Kipou') ?? (marques.marques ?? [])[0];

  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [nom, viewport, telephone] of [
      ['ordinateur', { width: 1440, height: 900 }, false],
      ['telephone', { width: 390, height: 844 }, true],
    ]) {
      const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', ...(telephone ? { isMobile: true, hasTouch: true } : {}) });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));

      /* -------- 1. La veille -------- */
      await page.goto(`${BASE}/#${decor.shared.construireFragment({ vue: 'projet', projectId: 'p-essai', cardId: decor.carte.id })}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-bandeau-veille]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
      const bandeau = page.locator('[data-bandeau-veille]').first();
      noter(`${nom} · la veille en panne s’affiche en rouge`, await jusquA(async () => /text-danger/.test((await page.locator('[data-veille-horaires]').first().getAttribute('class')) ?? ''), 20000));
      noter(`${nom} · « Demander à l’agent de réparer » paraît`, (await page.locator('[data-veille-reparer]').count()) >= 1);
      await page.locator('[data-veille-verifier]').first().click();
      noter(`${nom} · « Vérifier maintenant » dit le résultat`, await jusquA(async () => /n’arrive plus à joindre/.test((await page.locator('[data-veille-resultat]').first().innerText().catch(() => '')) ?? ''), 20000), await page.locator('[data-veille-resultat]').first().innerText().catch(() => ''));
      noter(`${nom} · rien ne déborde sur la carte en veille`, (await deborde(page)) <= 0);
      await bandeau.scrollIntoViewIfNeeded().catch(() => undefined);
      await capturer(page, `veille-carte-${nom}`);
      await page.goto(`${BASE}/#taches-recurrentes/p-essai/veille/${decor.veilleId}`, { waitUntil: 'domcontentloaded' });
      const ligne = page.locator('[data-recurrentes-veille]').first();
      await ligne.waitFor({ timeout: 20000 }).catch(() => undefined);
      if (!(await page.locator('[data-recurrentes-tiroir]').count())) await ligne.click().catch(() => undefined);
      noter(`${nom} · dans Tâches récurrentes : le bouton de réparation paraît`, await jusquA(async () => (await page.locator('[data-recurrentes-tiroir] [data-veille-reparer]').count()) === 1, 15000));
      noter(`${nom} · et le dernier contrôle est en rouge`, (await page.locator('[data-recurrentes-tiroir] [data-veille-dernier="panne"].text-danger').count()) === 1);
      await capturer(page, `veille-recurrentes-${nom}`);

      /* -------- 2. La police du produit -------- */
      await page.goto(`${BASE}/#studio/${decor.creationId}`, { waitUntil: 'domcontentloaded' });
      await page.locator(`[data-studio-editeur="${decor.creationId}"]`).waitFor({ timeout: 30000 });
      const charge = await jusquA(async () => {
        for (const f of page.frames()) {
          if (f === page.mainFrame()) continue;
          const ok = await f.evaluate((famille) => document.fonts.ready.then(() => [...document.fonts].some((x) => x.family.replace(/["']/g, '') === famille && x.status === 'loaded')), FAMILLE).catch(() => false);
          if (ok) return true;
        }
        return false;
      }, 30000);
      noter(`${nom} · aperçu : la police du produit est CHARGÉE dans le cadre`, charge);
      /* Le volet Style : la rubrique de la colonne sur ordinateur, le bouton du bas sur téléphone. */
      await page.locator('[data-studio-ouvrir="style"]:visible, [data-bouton-du-bas="style"]:visible').first().click();
      noter(`${nom} · volet Style : la police est listée avec « Ajouter une police »`, await jusquA(async () => (await page.locator(`[data-studio-police-projet="${FAMILLE}"]`).count()) === 1 && (await page.locator('[data-studio-police-ajouter]').count()) === 1, 20000));
      await page.locator('[data-studio-champ-police="Police des titres"]').first().click().catch(() => undefined);
      noter(`${nom} · le menu des polices la propose en tête`, await jusquA(async () => /Produit Sans · du projet/.test((await page.locator('[role="listbox"], [role="menu"], [data-liste-deroulante-panneau]').first().innerText().catch(() => '')) ?? ''), 8000));
      await page.keyboard.press('Escape').catch(() => undefined);
      noter(`${nom} · rien ne déborde dans le volet Style`, (await deborde(page)) <= 0);
      await capturer(page, `studio-style-${nom}`);

      /* -------- 3. Marketing -------- */
      await page.goto(`${BASE}/#strategie/${dossier.id}`, { waitUntil: 'domcontentloaded' });
      noter(`${nom} · « #strategie/<dossier> » ouvre le client dans Marketing`, await jusquA(async () => (await page.locator(`[data-marketing2][data-m2-dossier="${dossier.id}"]`).count()) === 1, 20000), await page.evaluate(() => location.hash));
      await page.goto(`${BASE}/#marketing/${dossier.id}/evolution`, { waitUntil: 'domcontentloaded' });
      noter(`${nom} · l’évolution des chiffres s’ouvre dans Marketing`, await jusquA(async () => (await page.locator(`[data-m2-page="evolution"] [data-strategie-dossier-ouvert="${dossier.id}"]`).count()) === 1, 20000));
      noter(`${nom} · rien ne déborde sur l’évolution`, (await deborde(page)) <= 0);
      await capturer(page, `marketing-evolution-${nom}`);
      await page.goto(`${BASE}/#marketing/${dossier.id}/reglages`, { waitUntil: 'domcontentloaded' });
      noter(`${nom} · les réglages du client s’ouvrent dans Marketing`, await jusquA(async () => (await page.locator('[data-m2-page="reglages"]').count()) === 1 && (await page.locator('[role="dialog"]').count()) >= 1, 20000));
      await capturer(page, `marketing-reglages-client-${nom}`);
      await page.goto(`${BASE}/#marketing/reglages`, { waitUntil: 'domcontentloaded' });
      noter(`${nom} · les réglages du service s’ouvrent dans Marketing`, await jusquA(async () => (await page.locator('[data-m2-page="reglages-service"]').count()) === 1, 20000));
      await capturer(page, `marketing-reglages-service-${nom}`);

      /* -------- 4. Communication -------- */
      if (marque?.id) {
        await page.goto(`${BASE}/#communication/${marque.id}/canaux`, { waitUntil: 'domcontentloaded' });
        noter(`${nom} · « #communication/<marque>/canaux » ouvre la page Réseaux de Communication`, await jusquA(async () => (await page.evaluate(() => location.hash)) === `#communication/${marque.id}/canaux` && (await page.locator('[data-v2-reglages-canaux]').count()) === 1, 20000), await page.evaluate(() => location.hash));
        await page.locator('[data-v2-reglages-canaux]').first().click();
        noter(`${nom} · « Réglages avancés » s’ouvre dans Communication, sans renvoi vers l’ancien`, await jusquA(async () => (await page.locator('[data-v2-reglages-avances]').count()) === 1 && (await page.evaluate(() => location.hash)) === `#communication/${marque.id}/canaux/reglages`, 20000), await page.evaluate(() => location.hash));
        noter(`${nom} · les réglages avancés montrent les canaux du projet`, await jusquA(async () => (await page.locator('[data-v2-reglages-avances] [data-logo-reseau], [data-v2-reglages-avances] li').count()) >= 1, 20000));
        await page.goto(`${BASE}/#communication/${marque.id}/canaux/instagram`, { waitUntil: 'domcontentloaded' });
        noter(`${nom} · l’ancienne fiche d’un canal ouvre ses réglages avancés`, await jusquA(async () => (await page.locator('[data-v2-reglages-avances="instagram"]').count()) === 1, 20000), await page.evaluate(() => location.hash));
        noter(`${nom} · rien ne déborde dans les réglages avancés`, (await deborde(page)) <= 0);
        await page.goto(`${BASE}/#communication/${marque.id}/canaux/reglages`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-v2-reglages-avances]').waitFor({ timeout: 20000 }).catch(() => undefined);
        await attendre(800);
        await capturer(page, `communication-reglages-avances-${nom}`);
      } else noter(`${nom} · une marque existe pour l’essai`, false, JSON.stringify(marques).slice(0, 200));

      noter(`${nom} · aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
}

try {
  await main();
} catch (err) {
  noter('l’essai va au bout', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  demon.kill('SIGTERM');
  await attendre(500);
  nettoyer?.();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis.`);
process.exit(echecs ? 1 : 0);
