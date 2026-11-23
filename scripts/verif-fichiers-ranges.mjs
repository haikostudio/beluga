#!/usr/bin/env node
/**
 * LA FENÊTRE « FICHIERS » DANS UN VRAI NAVIGATEUR (carte « Fichiers rangés et captures pleine page »).
 *
 *   node scripts/verif-fichiers-ranges.mjs        # BELUGA_FICHIERS_PORT pour changer de port (7233)
 *
 * Un démon d'essai à soi (base neuve, `demarrerDemonDEssai`), deux projets, des pièces jointes, un document de carte
 * et un journal posés dans SA base, puis :
 *  1. administrateur : le bouton « Fichiers » en haut de la colonne ouvre la fenêtre ; le bandeau propose l'essai à
 *     blanc (rapport) puis « Ranger maintenant » ; l'arbre montre les deux projets ; on descend jusqu'aux pièces ;
 *  2. la recherche en mots courants trouve le document par un mot de son contenu ;
 *  3. renommer, mettre à la corbeille, restaurer ;
 *  4. un compte MEMBRE ne voit que son projet, sans journaux ; le serveur refuse le contenu d'un journal ;
 *  5. SUR TÉLÉPHONE (07/11/2026), la fenêtre est la FEUILLE QUI MONTE DU BAS : la page reste visible au-dessus, et
 *     la poignée tirée vers le bas la referme ; sur ordinateur, elle reste la fenêtre centrée (point 1).
 * Ne reprend jamais `BELUGA_URL` ni `BELUGA_TOKEN` (l'application publiée).
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import * as ws from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

for (const nom of ['BELUGA_URL', 'BELUGA_TOKEN', 'BELUGA_AGENT', 'BELUGA_TOUR']) delete process.env[nom];

const PORT = Number(process.env.BELUGA_FICHIERS_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = path.join(os.tmpdir(), 'verif-fichiers-ranges');
fs.mkdirSync(CAPTURES, { recursive: true });

const { DATA, PROJETS, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-fichiers-ranges-', port: PORT, depot: false, signaux: true });
if (!(await attendrePort(90_000))) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

let echecs = 0;
const ok = (cond, texte) => {
  console.log(`  ${cond ? '✓' : '✗'}  ${texte}`);
  if (!cond) echecs++;
};
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = () => new Database(path.join(DATA, 'beluga.db'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function attendreLeCalme(limiteMs = 90_000) {
  const fin = Date.now() + limiteMs;
  let calmes = 0;
  while (Date.now() < fin && calmes < 2) {
    const depart = Date.now();
    const r = await fetch(`${BASE}/health`).catch(() => null);
    calmes = r?.ok && Date.now() - depart < 500 ? calmes + 1 : 0;
    await pause(1000);
  }
}
await attendreLeCalme();

const jetonAdmin = crypto.randomBytes(32).toString('hex');
const jetonMembre = crypto.randomBytes(32).toString('hex');
{
  const db = base();
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(sha(jetonAdmin), Date.now(), Date.now() + 3_600_000, 'verif fichiers', admin?.id ?? null);
  db.close();
}

function ouvrirCanal(jeton) {
  return new Promise((resolve, reject) => {
    const socket = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const attentes = new Map();
    socket.on('message', (brut) => {
      const e = JSON.parse(brut.toString());
      if (e.type === 'ack' && attentes.has(e.id)) {
        attentes.get(e.id)(e);
        attentes.delete(e.id);
      }
    });
    socket.on('open', () =>
      resolve({
        socket,
        demander: (cmd, delai = 30_000) =>
          new Promise((r) => {
            const id = crypto.randomBytes(6).toString('hex');
            attentes.set(id, r);
            socket.send(JSON.stringify({ id, cmd }));
            setTimeout(() => attentes.has(id) && (attentes.delete(id), r({ ok: false, error: 'sans réponse' })), delai);
          }),
      }),
    );
    socket.on('error', reject);
  });
}

const canal = await ouvrirCanal(jetonAdmin);
await attendreLeCalme();
for (const d of ['boulangerie', 'garage']) fs.mkdirSync(path.join(PROJETS, d), { recursive: true });
fs.writeFileSync(path.join(PROJETS, 'boulangerie', 'index.html'), '<h1>Boulangerie</h1>');
const p1 = (await canal.demander({ type: 'project.create', name: 'Boulangerie Martin', path: path.join(PROJETS, 'boulangerie') }, 60_000)).data?.project?.id;
const p2 = (await canal.demander({ type: 'project.create', name: 'Garage Durand', path: path.join(PROJETS, 'garage') }, 60_000)).data?.project?.id;
ok(!!p1 && !!p2, 'deux projets d’essai créés');

/* Des pièces, un document de carte et un journal, posés dans la base d'essai. */
const CARTE = 'c0ffee12-1111-4000-8000-000000000000';
{
  const db = base();
  const maintenant = Date.now();
  const carte = { id: CARTE, projectId: p1, column: 'archived', position: 1, title: 'Nouvelle vitrine', labels: [], run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(CARTE, p1, 'archived', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('agent-verif', p1, CARTE, 'task', 'done', JSON.stringify({ id: 'agent-verif', projectId: p1, cardId: CARTE, role: 'task', title: 'Agent de tâche', run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant }), maintenant, maintenant);
  fs.mkdirSync(path.join(DATA, 'attachments'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  for (const [id, projet, nom] of [
    ['aaaa1111-0000-4000-8000-000000000001', p1, 'devanture.png'],
    ['bbbb2222-0000-4000-8000-000000000002', p1, 'croissants.png'],
    ['cccc3333-0000-4000-8000-000000000003', p2, 'atelier.png'],
  ]) {
    const piece = { id, projectId: projet, alias: id.slice(0, 4), name: nom, mime: 'image/png', size: png.length, sha: sha(id), createdAt: maintenant, ...(projet === p1 ? { cardId: CARTE } : {}) };
    db.prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?,?,?,?,?)').run(id, projet, piece.sha, JSON.stringify(piece), maintenant);
    fs.writeFileSync(path.join(DATA, 'attachments', `${id.slice(0, 4)}-${nom}`), png);
  }
  db.close();
  fs.mkdirSync(path.join(DATA, 'documents'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'documents', 'nouvelle-vitrine-c0ffee12.md'), '# Cahier des charges\n\nLa vitrine présente les viennoiseries du matin et les horaires d’ouverture.');
  fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'logs', 'agent-verif.log'), 'journal de l’agent');
}

/* Le compte membre, sur le seul projet de la boulangerie. */
{
  const db = base();
  db.prepare("INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, 'membre', ?, ?, 'x', 1, ?)").run('u-membre', 'membre-verif', 'Membre', 'sel', Date.now());
  db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run('u-membre', p1);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(sha(jetonMembre), Date.now(), Date.now() + 3_600_000, 'verif fichiers', 'u-membre');
  db.close();
}

if (process.env.DEBUG_FICHIERS) console.log(JSON.stringify(await canal.demander({ type: 'fichiers.rangement', appliquer: false })).slice(0, 800));
const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
try {
  /* ------------------------------ 1. administrateur ------------------------------ */
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await contexte.addCookies([{ name: 'beluga_session', value: jetonAdmin, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  if (process.env.DEBUG_FICHIERS) {
    page.on('console', (m) => console.log('console:', m.text().slice(0, 200)));
    page.on('websocket', (w) => { console.log('ws ouvert', w.url()); w.on('framereceived', (f) => console.log('ws<', String(f.payload).slice(0, 160))); w.on('framesent', (f) => console.log('ws>', String(f.payload).slice(0, 160))); w.on('close', () => console.log('ws fermé')); });
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ligne-fichiers]').first().waitFor({ timeout: 45_000 });
  ok(true, 'le bouton « Fichiers » est en haut de la colonne de gauche');
  await page.locator('[data-ligne-fichiers]').first().click();
  await page.locator('[data-fenetre-fichiers]').waitFor({ timeout: 15_000 });
  ok((await page.locator('[data-fenetre-fichiers]').getAttribute('data-fenetre-fichiers-forme')) === 'fenetre', 'sur ordinateur, « Fichiers » s’ouvre en fenêtre centrée');
  /* Le canal se lie après le premier état : l'arbre chargé prouve que les commandes passent. */
  await page.locator('[data-fichiers-arbre] [data-fichiers-noeud]').first().waitFor({ timeout: Number(process.env.DELAI_ARBRE || 90_000) });
  await page.locator('[data-fichiers-bandeau-rangement]').waitFor({ timeout: 15_000 });
  ok(true, 'le bandeau propose de ranger les fichiers existants');
  if (process.env.DEBUG_FICHIERS) page.on('console', (m) => console.log('console:', m.text().slice(0, 300)));
  await page.locator('[data-fichiers-essai-a-blanc]').click();
  if (process.env.DEBUG_FICHIERS) { await pause(3000); await page.screenshot({ path: path.join(CAPTURES, 'debug.png') }); console.log(await page.locator('[data-fichiers-bandeau-rangement]').innerText()); }
  await page.locator('[data-fichiers-rapport="essai"]').waitFor({ timeout: 30_000 });
  const rapport = await page.locator('[data-fichiers-rapport="essai"]').innerText();
  ok(/5 fichiers|5 files/.test(rapport), `l’essai à blanc rend son rapport (${rapport.split('\n')[0]})`);
  ok(!fs.existsSync(path.join(DATA, 'fichiers', 'Boulangerie Martin')), 'l’essai à blanc n’a rien posé sur le disque');
  await page.screenshot({ path: path.join(CAPTURES, '1-essai-a-blanc.png') });
  await page.locator('[data-fichiers-ranger]').click();
  await page.locator('[data-fichiers-bandeau-rangement]').waitFor({ state: 'detached', timeout: 30_000 });
  ok(fs.lstatSync(path.join(DATA, 'fichiers', 'Boulangerie Martin', 'Conversations', 'Nouvelle vitrine', 'devanture.png')).isSymbolicLink(), 'le rangement pose les liens Projet / Service / Carte sur le disque');
  ok(fs.existsSync(path.join(DATA, 'attachments', 'aaaa-devanture.png')), 'l’original reste à sa place (ancien lien valide)');
  const arbre = page.locator('[data-fichiers-arbre]');
  await arbre.locator('[data-fichiers-noeud="Boulangerie Martin"]').waitFor({ timeout: 15_000 });
  ok((await arbre.locator('[data-fichiers-noeud="Garage Durand"]').count()) === 1, 'l’arbre montre les deux projets à l’administrateur');
  await arbre.locator('[data-fichiers-noeud="Boulangerie Martin"] button').nth(1).click();
  await page.locator('[data-fichiers-sous-dossier="Boulangerie Martin/Conversations"]').click();
  /* L'APERÇU À LA PLACE DE L'ICÔNE DE DOSSIER (carte « Aperçu, chat, Agentik et vraie charte ») : la miniature du fichier le plus récent. */
  const sousDossier = page.locator('[data-fichiers-sous-dossier="Boulangerie Martin/Conversations/Nouvelle vitrine"]');
  await sousDossier.waitFor({ timeout: 15_000 });
  const apercuDossier = sousDossier.locator('[data-fichiers-vignette="apercu"] img');
  ok((await apercuDossier.count()) === 1 && /[?&]w=\d+/.test((await apercuDossier.getAttribute('src')) ?? ''), 'un dossier montre l’aperçu réduit de son fichier, plus l’icône de dossier');
  await sousDossier.click();
  await page.locator('[data-fichiers-nom="devanture.png"]').waitFor({ timeout: 15_000 });
  ok((await page.locator('[data-fichiers-ligne]').count()) === 2, 'le dossier de la carte montre ses deux pièces');
  ok((await page.locator('[data-fichiers-nom="devanture.png"] [data-fichiers-badge="PNG"]').count()) === 1, 'chaque fichier porte le badge de son type');
  await page.screenshot({ path: path.join(CAPTURES, '2-dossier-de-carte.png') });

  /* ------------------------------ 2. la recherche ------------------------------ */
  await page.locator('[data-fenetre-fichiers] [data-fichiers-recherche] input, [data-fenetre-fichiers] input[data-fichiers-recherche]').first().fill('viennoiseries');
  await page.locator('[data-fichiers-resultat]').first().waitFor({ timeout: 15_000 });
  const premier = await page.locator('[data-fichiers-resultat]').first().innerText();
  ok(/Nouvelle vitrine\.md/.test(premier) && /viennoiseries/.test(premier), 'la recherche trouve le document par un mot de son contenu, avec son extrait');
  await page.screenshot({ path: path.join(CAPTURES, '3-recherche.png') });
  await page.locator('[data-fichiers-resultat-dossier]').first().click();
  await page.locator('[data-fichiers-dossier="Boulangerie Martin/Cartes"]').waitFor({ timeout: 10_000 });
  ok(true, 'l’emplacement d’un résultat ramène dans l’arbre');

  /* ------------------------------ 3. renommer, corbeille ------------------------------ */
  await page.locator('[data-fichiers-sous-dossier]').count();
  await page.locator('[data-fichiers-fil] button').nth(1).click();
  await page.locator('[data-fichiers-sous-dossier="Boulangerie Martin/Conversations"]').click();
  await page.locator('[data-fichiers-sous-dossier="Boulangerie Martin/Conversations/Nouvelle vitrine"]').click();
  const ligne = page.locator('[data-fichiers-nom="croissants.png"]');
  await ligne.hover();
  await ligne.locator('[data-fichiers-renommer]').click();
  await page.locator('[data-fichiers-nouveau-nom]').fill('croissants du matin.png');
  await page.locator('[data-fichiers-valider-nom]').click();
  await page.locator('[data-fichiers-nom="croissants du matin.png"]').waitFor({ timeout: 10_000 });
  ok(fs.lstatSync(path.join(DATA, 'fichiers', 'Boulangerie Martin', 'Conversations', 'Nouvelle vitrine', 'croissants du matin.png')).isSymbolicLink(), 'renommer change le nom dans l’arbre et sur le disque');
  const renomme = page.locator('[data-fichiers-nom="croissants du matin.png"]');
  await renomme.hover();
  await renomme.locator('[data-fichiers-supprimer]').click();
  await page.getByRole('button', { name: /Mettre à la corbeille|Move to trash/ }).last().click();
  await renomme.waitFor({ state: 'detached', timeout: 10_000 });
  ok(true, 'mettre à la corbeille retire le fichier de l’arbre');
  await page.locator('[data-fichiers-ouvrir-corbeille]').first().click();
  await page.locator('[data-fichiers-restaurer]').first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(CAPTURES, '4-corbeille.png') });
  await page.locator('[data-fichiers-restaurer]').first().click();
  await page.locator('[data-fichiers-ligne-corbeille]').first().waitFor({ state: 'detached', timeout: 10_000 });
  ok(fs.lstatSync(path.join(DATA, 'fichiers', 'Boulangerie Martin', 'Conversations', 'Nouvelle vitrine', 'croissants du matin.png')).isSymbolicLink(), 'restaurer remet le fichier à sa place');
  await contexte.close();

  /* ------------------------------ 4. un membre ------------------------------ */
  const contexteMembre = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await contexteMembre.addCookies([{ name: 'beluga_session', value: jetonMembre, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const pm = await contexteMembre.newPage();
  await pm.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pm.locator('[data-ligne-fichiers]').first().waitFor({ timeout: 45_000 });
  await pm.locator('[data-ligne-fichiers]').first().click();
  await pm.locator('[data-fichiers-arbre] [data-fichiers-noeud]').first().waitFor({ timeout: 90_000 });
  const noeuds = await pm.locator('[data-fichiers-arbre] [data-fichiers-noeud]').evaluateAll((l) => l.map((e) => e.getAttribute('data-fichiers-noeud')));
  ok(noeuds.length === 1 && noeuds[0] === 'Boulangerie Martin', `un membre ne voit que son projet (${noeuds.join(', ')})`);
  ok((await pm.locator('[data-fichiers-bandeau-rangement]').count()) === 0, 'un membre n’a pas le bouton de rangement');
  await pm.locator('[data-fichiers-arbre] [data-fichiers-noeud="Boulangerie Martin"] button').nth(1).click();
  await pm.locator('[data-fichiers-sous-dossier="Boulangerie Martin/Conversations"]').waitFor({ timeout: 10_000 });
  ok((await pm.locator('[data-fichiers-sous-dossier="Boulangerie Martin/Journaux"]').count()) === 0, 'un membre ne voit pas les journaux');
  await pm.screenshot({ path: path.join(CAPTURES, '5-membre.png') });
  const reponses = await pm.evaluate(async () => {
    const lire = (u) => fetch(u).then((r) => r.status);
    return { autre: await lire('/api/fichiers/contenu?id=code:inconnu:index.html') };
  });
  ok([403, 404].includes(reponses.autre), `le serveur ne sert rien hors de la portée (${reponses.autre})`);
  await contexteMembre.close();

  const canalMembre = await ouvrirCanal(jetonMembre);
  const journal = await canal.demander({ type: 'fichiers.dossier', chemin: 'Boulangerie Martin/Journaux/Nouvelle vitrine' });
  const idJournal = journal.data?.fichiers?.[0]?.id;
  ok(!!idJournal, 'l’administrateur voit le journal de l’agent');
  const refus = await canalMembre.demander({ type: 'fichiers.dossier', chemin: 'Boulangerie Martin/Journaux' });
  ok(refus.ok === false, 'le serveur refuse au membre le dossier des journaux');
  const refusGarage = await canalMembre.demander({ type: 'fichiers.dossier', chemin: 'Garage Durand' });
  ok(refusGarage.ok === false, 'le serveur refuse au membre un projet hors de sa portée');
  const contenu = await fetch(`${BASE}/api/fichiers/contenu?id=${idJournal}`, { headers: { cookie: `beluga_session=${jetonMembre}` } });
  ok([403, 404].includes(contenu.status), `le serveur ne sert pas le contenu d’un journal au membre (${contenu.status})`);
  const permis = await canalMembre.demander({ type: 'fichiers.dossier', chemin: 'Boulangerie Martin/Cartes' });
  const idDoc = permis.data?.fichiers?.[0]?.id;
  const lu = await fetch(`${BASE}/api/fichiers/contenu?id=${idDoc}`, { headers: { cookie: `beluga_session=${jetonMembre}` } });
  ok(lu.status === 200 && (await lu.text()).includes('viennoiseries'), `le membre lit un document de son projet (${lu.status})`);
  const contenuAdmin = await fetch(`${BASE}/api/fichiers/contenu?id=${idJournal}`, { headers: { cookie: `beluga_session=${jetonAdmin}` } });
  ok(contenuAdmin.status === 200 && (await contenuAdmin.text()).includes('journal'), 'le contenu se sert à l’administrateur');
  canalMembre.socket.close();

  /* ------------------------------ 5. téléphone : la feuille du bas ------------------------------ */
  const contexteTel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await contexteTel.addCookies([{ name: 'beluga_session', value: jetonAdmin, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const pt = await contexteTel.newPage();
  await pt.goto(BASE, { waitUntil: 'domcontentloaded' });
  /* Sur téléphone, la colonne est repliée dans le menu du bas : on ouvre par l'événement que ses boutons émettent. */
  await pt.locator('[data-ligne-fichiers]').first().waitFor({ state: 'attached', timeout: 45_000 }).catch(() => undefined);
  await pause(3000);
  const ouvrirSurTelephone = () => pt.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-les-fichiers', { detail: {} })));
  await ouvrirSurTelephone();
  const fenetreTel = pt.locator('[data-fenetre-fichiers]');
  await fenetreTel.waitFor({ timeout: 15_000 });
  await pt.locator('[data-fichiers-arbre] [data-fichiers-noeud], [data-fichiers-ligne], [data-fichiers-sous-dossier]').first().waitFor({ timeout: 90_000 }).catch(() => undefined);
  await pause(600);
  const forme = await fenetreTel.evaluate((el) => {
    const feuille = el.closest('[data-feuille-du-bas]');
    const cadre = feuille?.getBoundingClientRect();
    return { forme: el.getAttribute('data-fenetre-fichiers-forme'), feuille: !!feuille, haut: cadre ? Math.round(cadre.top) : null, bas: cadre ? Math.round(cadre.bottom) : null, vue: window.innerHeight };
  });
  ok(forme.forme === 'feuille' && forme.feuille, `sur téléphone, « Fichiers » s’ouvre en feuille du bas (${JSON.stringify(forme)})`);
  ok(forme.haut !== null && forme.haut >= 16 && forme.bas >= forme.vue - 2, 'la feuille monte du bas et laisse voir la page au-dessus');
  for (const clarte of ['clair', 'sombre']) {
    await pt.evaluate((c) => {
      const racine = document.documentElement;
      racine.dataset.theme = c;
      racine.classList.toggle('dark', c === 'sombre');
      racine.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
    }, clarte);
    await pause(300);
    await pt.screenshot({ path: path.join(CAPTURES, `6-telephone-feuille-${clarte}.png`) });
  }
  /* LA POIGNÉE TIRÉE VERS LE BAS REFERME LA FEUILLE. */
  const poignee = await pt.locator('[data-feuille-du-bas] [data-poignee-tiroir]').first().boundingBox();
  if (poignee) {
    await pt.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
    await pt.mouse.down();
    for (let pas = 1; pas <= 12; pas++) await pt.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2 + pas * 40);
    await pt.mouse.up();
  }
  const fermee = await fenetreTel.waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false);
  ok(fermee, 'tirée vers le bas par sa poignée, la feuille se referme');
  await contexteTel.close();

  /* Les captures de l'ordinateur, en clair et en sombre. */
  const contexteOrdi = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await contexteOrdi.addCookies([{ name: 'beluga_session', value: jetonAdmin, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const po = await contexteOrdi.newPage();
  await po.goto(BASE, { waitUntil: 'domcontentloaded' });
  await po.locator('[data-ligne-fichiers]').first().waitFor({ timeout: 45_000 });
  await po.locator('[data-ligne-fichiers]').first().click();
  await po.locator('[data-fichiers-arbre] [data-fichiers-noeud]').first().waitFor({ timeout: 90_000 });
  for (const clarte of ['clair', 'sombre']) {
    await po.evaluate((c) => {
      const racine = document.documentElement;
      racine.dataset.theme = c;
      racine.classList.toggle('dark', c === 'sombre');
      racine.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
    }, clarte);
    await pause(300);
    await po.screenshot({ path: path.join(CAPTURES, `7-ordinateur-fenetre-${clarte}.png`) });
  }
  await contexteOrdi.close();
} catch (err) {
  echecs++;
  console.error(`✗  ${err.message.split('\n')[0]}`);
  console.error(journal.join('').split('\n').filter((l) => !/INFO migration/.test(l)).slice(-40).join('\n'));
} finally {
  await navigateur.close();
  canal.socket.close();
}

console.log(echecs ? `\n${echecs} contrôle(s) en échec. Captures : ${CAPTURES}` : `\nTout est bon. Captures : ${CAPTURES}`);
process.exit(echecs ? 1 : 0);
