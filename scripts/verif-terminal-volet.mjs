#!/usr/bin/env node
/**
 * LE TERMINAL DU SERVEUR, EN VOLET DU BAS, DANS UN VRAI NAVIGATEUR.
 *
 * Un démon JETABLE (base neuve, `scripts/lib/demon-d-essai.mjs`) sert la page
 * construite (`web/dist`) de CETTE copie de travail. Son tmux est isolé
 * (`TMUX_TMPDIR` dans un dossier à soi) : la vraie session « beluga » du
 * serveur n'est ni attachée ni écrite. Le navigateur vérifie :
 *
 *  1. sur ordinateur, un ROND identique à celui de l'assistant se tient à sa
 *     gauche sur toutes les pages, REPLIÉ derrière lui : le survol du robot
 *     l'étale (20/10/2026) ; terminal ouvert, la rangée remonte au-dessus du
 *     volet ; les « Tableaux de bord » n'ont plus de
 *     bouton du terminal, et leur menu « … » porte « Redémarrer le serveur » ;
 *  2. un clic ouvre le volet, ancré en bas de l'écran, sur toute la largeur,
 *     DERRIÈRE l'application qui remonte de sa hauteur ; il est noir en thème clair ;
 *  3. une commande tapée dans le terminal s'exécute (sa sortie revient) ;
 *  4. « Agrandir » monte le volet, « Réduire » le ramène ; la poignée règle la hauteur ;
 *  5. « Fermer » retire le volet SANS tuer la session tmux ;
 *  6. rechargée avec l'adresse du volet ouvert, la page le rouvre ;
 *  7. aucune erreur de page, sur ordinateur et sur téléphone (390 px) ;
 *  8. la COPIE : une sélection fait paraître « Copier », Ctrl+Maj+C copie aussi,
 *     Ctrl+C arrête toujours la commande ;
 *  9. RÉDUIRE : le volet se cache sans se détacher, le rond (ouvert, il le
 *     réduit) tourne quand ça travaille, rouvre le terminal tel qu'il était, et
 *     l'état réduit revient après un rechargement ; sur téléphone, aucun rond
 *     ni pastille : un bouton du pied du menu principal, à côté des réglages.
 *
 *   node scripts/verif-terminal-volet.mjs   (après `npm run build`)
 *   HAIKO_VOLET_PORT=7241 node scripts/verif-terminal-volet.mjs
 *
 * Captures : data/verification/terminal-volet-*.png
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_VOLET_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* Le tmux du démon d'essai vit dans un dossier à lui : jamais la session du serveur. */
const TMUX_DIR = fs.mkdtempSync('/tmp/verif-volet-tmux-');
const { DATA, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-volet-',
  port: PORT,
  signaux: true,
  env: { TMUX_TMPDIR: TMUX_DIR },
});

const jeton = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const tmuxDEssai = (args) => spawnSync('tmux', args, { encoding: 'utf8', env: { ...process.env, TMUX_TMPDIR: TMUX_DIR } });

let navigateur;
async function main() {
  if (!(await attendrePort())) {
    noter('le démon jetable démarre', false, journal.join('').slice(-800));
    return;
  }
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3_600_000, 'vérification du volet du terminal');
  db.close();

  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  /* 1. Le rond : sur toutes les pages, à gauche du robot de l'assistant, de la même taille. */
  await page.goto(`${BASE}/#tableau-de-bord`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-resume]', { timeout: 40_000 });
  await page.waitForTimeout(800);
  const rond = page.locator('[data-terminal-rond]');
  /* LE ROBOT DE L'ASSISTANT A DISPARU (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : le bouton du bord est
     l'entrée de l'assistant, et le rond du terminal tient SEUL le coin bas droit, visible sans survol. */
  const devoiler = async () => {};
  const cliquerLeRond = async () => {
    await rond.click();
  };
  noter('plus de robot : le rond du terminal se voit seul, sans survol', await rond.isVisible());
  noter('…posé seul dans le coin', (await page.locator('[data-rond-seul] [data-terminal-rond]').count()) === 1);
  const voisins = await page.evaluate(() => ({
    bulle: document.querySelector('[data-terminal-rond]')?.getAttribute('title') ?? '',
  }));
  noter('il a sa bulle d’aide', voisins.bulle.length > 0, voisins.bulle);
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-page-en-route]', { timeout: 40_000 });
  await page.waitForTimeout(800);
  noter('les tableaux de bord ne portent plus de bouton du terminal', (await page.locator('[data-terminal-bouton-tableau]').count()) === 0);
  await page.locator('[data-options-de-page="menu"]').first().click();
  const redemarrer = page.locator('[data-options-de-page-menu] [data-bouton-redemarrage="tableaux-de-bord"]');
  noter('le menu « … » des tableaux de bord porte « Redémarrer le serveur »', await redemarrer.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false));
  await page.screenshot({ path: path.join(SHOTS, 'terminal-tableaux-menu-redemarrage.png') });
  await page.keyboard.press('Escape');
  await devoiler();
  const boiteBouton = await rond.boundingBox();
  noter('le rond du terminal est en bas à droite', !!boiteBouton && boiteBouton.y > 900 - 90 && boiteBouton.x > 1440 - 200, boiteBouton ? `x=${Math.round(boiteBouton.x)} y=${Math.round(boiteBouton.y)}` : 'absent');
  noter('le volet est fermé au départ', (await page.locator('[data-terminal-volet]').count()) === 0);
  noter('fermé, l’application ne porte aucune transformation', (await page.evaluate(() => getComputedStyle(document.querySelector('[data-app-racine]')).transform)) === 'none');

  /* 2. L'ouverture : l'application remonte, le volet est révélé derrière. */
  await cliquerLeRond();
  const volet = page.locator('[data-terminal-volet]');
  await volet.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600); // le soulèvement dure 190 ms
  const boite = await volet.boundingBox();
  noter('le volet est ancré en bas, sur toute la largeur', !!boite && Math.abs(boite.y + boite.height - 900) < 2 && boite.width >= 1438, boite ? `${Math.round(boite.width)}×${Math.round(boite.height)} à y=${Math.round(boite.y)}` : 'absent');
  noter('il ne couvre pas tout l’écran à l’ouverture', !!boite && boite.height < 600);
  const racine = await page.evaluate(() => {
    const r = document.querySelector('[data-app-racine]').getBoundingClientRect();
    const volet = document.querySelector('[data-terminal-volet]');
    return {
      bas: r.bottom,
      zApp: getComputedStyle(document.querySelector('[data-app-racine]')).zIndex,
      zVolet: getComputedStyle(volet).zIndex,
      ombre: getComputedStyle(document.querySelector('[data-app-racine]')).boxShadow,
      dansLeCorps: volet.parentElement === document.body,
    };
  });
  noter('toute l’application remonte de la hauteur du volet', !!boite && Math.abs(racine.bas - boite.y) < 3, `bas de l’application ${Math.round(racine.bas)}, haut du volet ${Math.round(boite?.y ?? 0)}`);
  noter('le volet est DERRIÈRE l’application (couche inférieure)', Number(racine.zVolet) < Number(racine.zApp), `${racine.zVolet} < ${racine.zApp}`);
  noter('le bord bas de l’application porte une ombre', racine.ombre && racine.ombre !== 'none');
  noter('le volet est porté par le document, hors de l’application qui bouge', racine.dansLeCorps);
  const fondDuVolet = await page.evaluate(() => getComputedStyle(document.querySelector('[data-terminal-volet]')).backgroundColor);
  noter('le volet est noir', /rgb\((\d|1\d), (\d|1\d), (\d|1\d)\)/.test(fondDuVolet), fondDuVolet);
  // LES RONDS REMONTENT AVEC LE TERMINAL : ils ne se posent plus sur lui.
  const robotOuvert = await rond.boundingBox();
  noter(
    'terminal ouvert, le rond du coin remonte au-dessus du volet',
    !!robotOuvert && !!boite && robotOuvert.y + robotOuvert.height <= boite.y - 4,
    robotOuvert && boite ? `bas du rond ${Math.round(robotOuvert.y + robotOuvert.height)}, haut du volet ${Math.round(boite.y)}` : 'absent',
  );

  /* 3. Une vraie commande. */
  await page.locator('[data-terminal-serveur] .xterm-helper-textarea').waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent?.trim(), null, { timeout: 30_000 }).catch(() => undefined);
  await page.locator('[data-terminal-serveur]').click();
  await page.keyboard.type('echo VOLET_$((20+22))_OK');
  await page.keyboard.press('Enter');
  const sortie = await page
    .waitForFunction(() => /VOLET_42_OK/.test(document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent ?? '') && (document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent ?? '').split('VOLET_42_OK').length >= 2, null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  noter('une commande tapée dans le volet s’exécute (sa sortie revient)', sortie);
  await page.screenshot({ path: path.join(SHOTS, 'terminal-volet-ouvert.png') });

  /* 4. Agrandir, réduire, poignée. */
  const hauteur = async () => (await volet.boundingBox())?.height ?? 0;
  const normale = await hauteur();
  await page.locator('[data-terminal-agrandir]').click();
  await page.waitForTimeout(300);
  const grande = await hauteur();
  noter('« Agrandir » monte le volet presque jusqu’en haut', (await volet.getAttribute('data-terminal-volet-taille')) === 'grand' && grande > normale + 150 && grande >= 900 - 70, `${Math.round(normale)} → ${Math.round(grande)} px`);
  await page.screenshot({ path: path.join(SHOTS, 'terminal-volet-grand.png') });
  await page.locator('[data-terminal-agrandir]').click();
  await page.waitForTimeout(300);
  noter('« Réduire » le ramène à sa hauteur d’origine', Math.abs((await hauteur()) - normale) < 3);

  const poignee = await page.locator('[data-terminal-poignee]').boundingBox();
  await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
  await page.mouse.down();
  await page.mouse.move(poignee.x + poignee.width / 2, 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const tiree = await hauteur();
  noter('la poignée règle la hauteur', (await volet.getAttribute('data-terminal-volet-taille')) === 'libre' && Math.abs(tiree - 600) < 25, `${Math.round(tiree)} px (attendu ≈ 600)`);
  const lignes = await page.evaluate(() => document.querySelector('[data-terminal-serveur] .xterm-rows')?.children.length ?? 0);
  noter('le terminal suit la hauteur du volet (plus de lignes qu’au départ)', lignes > 15, `${lignes} lignes`);

  /* 4 bis. LA COPIE : une sélection fait paraître « Copier » ; Ctrl+Maj+C copie aussi ; Ctrl+C arrête toujours. */
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.locator('[data-terminal-serveur]').click();
  await page.keyboard.type('echo ligne-a-copier-$((100+23))');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-terminal-serveur] .xterm-rows > div')].some((d) => d.textContent.trim() === 'ligne-a-copier-123'), null, { timeout: 20_000 });
  noter('sans sélection, aucun bouton « Copier »', (await page.locator('[data-terminal-copier]').count()) === 0);
  const ligneACopier = await page.evaluate(() => {
    const rang = [...document.querySelectorAll('[data-terminal-serveur] .xterm-rows > div')].find((d) => d.textContent.trim() === 'ligne-a-copier-123');
    const r = rang.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, largeurSigne: r.width / Math.max(1, rang.textContent.length) };
  });
  await page.mouse.move(ligneACopier.x + 1, ligneACopier.y);
  await page.mouse.down();
  await page.mouse.move(ligneACopier.x + ligneACopier.largeurSigne * 18 - 1, ligneACopier.y, { steps: 6 });
  await page.mouse.up();
  const boutonCopier = page.locator('[data-terminal-copier]');
  const parait = await boutonCopier.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  noter('une sélection fait paraître le bouton « Copier »', parait);
  await page.evaluate(() => navigator.clipboard.writeText('rien'));
  if (parait) await boutonCopier.click();
  await page.waitForTimeout(300);
  const copieBouton = await page.evaluate(() => navigator.clipboard.readText());
  noter('« Copier » met exactement la sélection dans le presse-papiers', copieBouton === 'ligne-a-copier-123', JSON.stringify(copieBouton));
  noter('le bouton confirme « Copié »', (await page.locator('[data-terminal-copie="oui"]').count()) === 1);
  await page.evaluate(() => navigator.clipboard.writeText('rien'));
  await page.keyboard.press('Control+Shift+C');
  await page.waitForTimeout(300);
  const copieClavier = await page.evaluate(() => navigator.clipboard.readText());
  noter('Ctrl+Maj+C copie la sélection', copieClavier === 'ligne-a-copier-123', JSON.stringify(copieClavier));
  const ecran = tmuxDEssai(['capture-pane', '-p', '-t', 'beluga']).stdout.split('\n').filter((l) => l.trim());
  noter('Ctrl+Maj+C n’envoie rien à la session', !/C\s*$/.test(ecran.at(-1) ?? ''), JSON.stringify(ecran.at(-1)));
  /* 4 ter. LA COPIE D'UN PROGRAMME (Claude Code copie par OSC 52, que tmux relaie) :
     elle arrive au presse-papiers de l'ordinateur, avec le même « Copié ». */
  await page.evaluate(() => navigator.clipboard.writeText('rien'));
  await page.keyboard.type("printf '\\033]52;c;%s\\a' $(printf 'copie-osc52' | base64)");
  await page.keyboard.press('Enter');
  const copieOsc = await page
    .waitForFunction(async () => (await navigator.clipboard.readText()) === 'copie-osc52', null, { timeout: 6_000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  noter('la copie d’un programme (OSC 52) arrive au presse-papiers', copieOsc);
  noter('…avec le « Copié » visible', (await page.locator('[data-terminal-copier][data-terminal-copie="oui"]').count()) === 1);
  await page.evaluate(() => navigator.clipboard.writeText('rien'));
  await page.waitForTimeout(1_700);
  tmuxDEssai(['set-buffer', '-w', 'copie-par-tmux']);
  const copieTmux = await page
    .waitForFunction(async () => (await navigator.clipboard.readText()) === 'copie-par-tmux', null, { timeout: 6_000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  noter('le tampon de tmux (« copied to tmux buffer ») arrive au presse-papiers', copieTmux);
  await page.evaluate(() => navigator.clipboard.writeText('secret-local'));
  await page.keyboard.type("printf '\\033]52;c;?\\a'; echo LECTURE_FINIE");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const ecranLecture = tmuxDEssai(['capture-pane', '-p', '-t', 'beluga']).stdout;
  noter('une demande de LECTURE du presse-papiers ne renvoie rien à la session', !/secret-local|c2VjcmV0LWxvY2Fs/.test(ecranLecture));
  await page.keyboard.type('sleep 30');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await page.keyboard.press('Control+C');
  await page.keyboard.type('echo ARRET_$((3*3))');
  await page.keyboard.press('Enter');
  const arrete = await page
    .waitForFunction(() => /ARRET_9/.test(document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent ?? '') && (document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent ?? '').split('ARRET_9').length >= 2, null, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  noter('Ctrl+C arrête toujours la commande en cours', arrete);

  /* 4 ter. RÉDUIRE : le volet se cache sans se détacher, le rond le dit, et il tourne quand ça travaille. */
  await page.keyboard.type('sleep 3; for i in $(seq 1 30); do echo pas-$i; sleep 0.1; done');
  await page.keyboard.press('Enter');
  await page.locator('[data-terminal-reduire]').click();
  const pastille = rond;
  noter('« Réduire » : le rond passe à l’état réduit', await page.waitForSelector('[data-terminal-rond][data-terminal-etat="reduit"]', { timeout: 5_000 }).then(() => true).catch(() => false));
  await page.waitForTimeout(400);
  const reduit = await page.evaluate(() => ({
    volet: document.querySelector('[data-terminal-volet]')?.getAttribute('data-terminal-reduit'),
    visible: document.querySelector('[data-terminal-volet]') ? getComputedStyle(document.querySelector('[data-terminal-volet]')).visibility : 'absent',
    ouvert: document.documentElement.hasAttribute('data-terminal-ouvert'),
    transformation: getComputedStyle(document.querySelector('[data-app-racine]')).transform,
  }));
  noter('réduit, le volet reste monté mais caché', reduit.volet === 'oui' && reduit.visible === 'hidden', JSON.stringify(reduit));
  noter('réduit, l’application redescend sans aucune transformation', !reduit.ouvert && reduit.transformation === 'none');
  noter('réduit, la session tmux continue', tmuxDEssai(['has-session', '-t', 'beluga']).status === 0);
  const boitePastille = await pastille.boundingBox();
  noter('le rond est en bas à droite', !!boitePastille && boitePastille.x > 1440 - 220 && boitePastille.y > 900 - 80, boitePastille ? `x=${Math.round(boitePastille.x)} y=${Math.round(boitePastille.y)}` : '');
  const tourne = await page.waitForSelector('[data-terminal-rond][data-terminal-actif="oui"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  noter('le rond tourne quand quelque chose travaille dans le terminal', tourne);
  await page.screenshot({ path: path.join(SHOTS, 'terminal-pastille-active.png') });
  // Calmé, le rond se replie derrière le robot : il est attendu dans la page, pas forcément visible.
  const calme = await page.waitForSelector('[data-terminal-rond][data-terminal-actif="non"]', { state: 'attached', timeout: 12_000 }).then(() => true).catch(() => false);
  noter('elle s’arrête quand la commande a fini, et le rond se replie', calme && !(await pastille.isVisible()));
  await page.goto(`${BASE}/#tableau-de-bord`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-resume]', { timeout: 40_000 });
  await devoiler();
  noter('le rond reste sur les autres pages', await pastille.isVisible());
  await cliquerLeRond();
  await volet.waitFor({ state: 'visible', timeout: 10_000 });
  const historique = await page
    .waitForFunction(() => /pas-30/.test(document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent ?? ''), null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const lignesVues = await page.evaluate(() => [...document.querySelectorAll('[data-terminal-serveur] .xterm-rows > div')].map((d) => d.textContent.trim()).filter(Boolean).slice(-4).join(' | '));
  noter('rouvert par le rond, la sortie arrivée pendant la réduction est là', historique, lignesVues);
  noter('rouvert, le rond reste et le dit', (await pastille.getAttribute('data-terminal-etat')) === 'ouvert');
  await cliquerLeRond();
  noter('ouvert, un clic sur le rond réduit le terminal', await page.waitForSelector('[data-terminal-rond][data-terminal-etat="reduit"]', { timeout: 5_000 }).then(() => true).catch(() => false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const revenue = await page.waitForSelector('[data-terminal-rond][data-terminal-etat="reduit"]', { timeout: 40_000 }).then(() => true).catch(() => false);
  noter('rechargée, la page retrouve le terminal réduit', revenue);
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-page-en-route]', { timeout: 40_000 });
  await cliquerLeRond();
  noter('le rond réaffiche le terminal réduit', await volet.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false));
  await page.waitForTimeout(600);

  /* 5. Fermer détache, la session continue. */
  const existeAvant = tmuxDEssai(['has-session', '-t', 'beluga']).status === 0;
  noter('la session tmux (isolée) existe quand le volet est ouvert', existeAvant);
  const adresseOuverte = page.url();
  await page.locator('[data-terminal-fermer]').click();
  await volet.waitFor({ state: 'detached', timeout: 10_000 });
  noter('« Fermer » retire le volet', (await page.locator('[data-terminal-volet]').count()) === 0);
  await page.waitForTimeout(800);
  noter('fermer ne tue pas la session tmux', tmuxDEssai(['has-session', '-t', 'beluga']).status === 0);
  noter('fermé, le rond reste et le dit', (await rond.getAttribute('data-terminal-etat')) === 'ferme');

  /* Le volet se rouvre, rattaché à la même session (la commande est toujours dans l'écran). */
  await cliquerLeRond();
  await volet.waitFor({ state: 'visible', timeout: 20_000 });
  const retrouvee = await page
    .waitForFunction(() => /pas-30/.test(document.querySelector('[data-terminal-serveur] .xterm-rows')?.textContent ?? ''), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  noter('rouvert, le volet retrouve ce qui tournait (même session)', retrouvee);

  /* 6. L'adresse. */
  const adresse = page.url();
  noter('l’adresse garde le volet ouvert', /terminal/.test(adresse), adresse.replace(BASE, ''));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reouvert = await page.locator('[data-terminal-volet]').waitFor({ state: 'visible', timeout: 40_000 }).then(() => true).catch(() => false);
  noter('rechargée avec cette adresse, la page rouvre le volet', reouvert, reouvert ? '' : `adresse après rechargement : ${page.url().replace(BASE, '')}, volets : ${await page.locator('[data-terminal-volet]').count()}`);
  if (reouvert) await page.locator('[data-terminal-fermer]').click();
  await volet.waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(400);
  noter('fermé, l’application redescend à sa place', (await page.evaluate(() => getComputedStyle(document.querySelector('[data-app-racine]')).transform)) === 'none');

  /* Noir en thème clair aussi. */
  const clair = await navigateur.newContext({ viewport: { width: 1200, height: 800 }, locale: 'fr-CH', colorScheme: 'light' });
  await clair.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const pageClaire = await clair.newPage();
  /* L'écran de départ d'un nouvel onglet suit le dernier projet ouvert (réglage partagé) :
     on y revient d'abord, puis on demande les tableaux de bord. */
  await pageClaire.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await pageClaire.waitForSelector('[data-page-en-route], [data-projet-actif], main', { timeout: 40_000 });
  await pageClaire.evaluate(() => (location.hash = '#en-route'));
  await pageClaire.waitForSelector('[data-page-en-route]', { timeout: 40_000 });
  await pageClaire.evaluate(() => {
    document.documentElement.classList.remove('dark');
    window.dispatchEvent(new CustomEvent('beluga:ouvrir-terminal'));
  });
  await pageClaire.locator('[data-terminal-volet]').waitFor({ state: 'visible', timeout: 20_000 });
  await pageClaire.waitForTimeout(500);
  const enClair = await pageClaire.evaluate(() => ({
    sombre: document.documentElement.classList.contains('dark'),
    fond: getComputedStyle(document.querySelector('[data-terminal-volet]')).backgroundColor,
    texte: getComputedStyle(document.querySelector('[data-terminal-volet] h2') ?? document.body).color,
  }));
  noter('en thème clair, le terminal reste noir avec un texte clair', !enClair.sombre && /rgb\((\d|1\d), (\d|1\d), (\d|1\d)\)/.test(enClair.fond) && /rgb\(2\d\d, 2\d\d, 2\d\d\)/.test(enClair.texte), JSON.stringify(enClair));
  await pageClaire.screenshot({ path: path.join(SHOTS, 'terminal-volet-clair.png') });
  await clair.close();

  /* 7. Aucune erreur de page. */
  noter('aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');

  /* 8. Téléphone : le volet tient dans l'écran et ne dépasse pas en largeur. */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', isMobile: true, hasTouch: true });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const mobile = await tel.newPage();
  await mobile.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-page-en-route], main', { timeout: 40_000 });
  await mobile.evaluate(() => (location.hash = '#en-route'));
  await mobile.waitForSelector('[data-page-en-route]', { timeout: 40_000 });
  await mobile.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-terminal')));
  await mobile.locator('[data-terminal-volet]').waitFor({ state: 'visible', timeout: 20_000 });
  await mobile.waitForTimeout(400);
  const boiteMobile = await mobile.locator('[data-terminal-volet]').boundingBox();
  noter('sur téléphone, le volet est en bas et tient dans l’écran', !!boiteMobile && boiteMobile.x >= 0 && boiteMobile.width <= 391 && boiteMobile.y >= 0 && Math.abs(boiteMobile.y + boiteMobile.height - 844) < 3, boiteMobile ? `${Math.round(boiteMobile.width)}×${Math.round(boiteMobile.height)}` : '');
  noter('sur téléphone, la page ne déborde pas', (await mobile.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await mobile.screenshot({ path: path.join(SHOTS, 'terminal-volet-telephone.png') });
  await mobile.locator('[data-terminal-reduire]').click();
  await mobile.waitForTimeout(400);
  noter('sur téléphone, aucun rond ni pastille flottante', (await mobile.locator('[data-terminal-rond], [data-terminal-pastille]').count()) === 0);
  await mobile.locator('header button[aria-label="Projets"]').first().click();
  const pied = mobile.locator('[data-pied-colonne] [data-terminal-pied] >> visible=true');
  const piedVisible = await pied.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  const voisinage = await mobile.evaluate(() => {
    // La colonne d'ordinateur reste montée (cachée) : on lit le bouton VISIBLE.
    const b = [...document.querySelectorAll('[data-pied-colonne] [data-terminal-pied]')].find((n) => n.getClientRects().length > 0);
    const reglages = b?.closest('[data-pied-colonne]')?.querySelector('[data-reglages-menu]');
    return { etat: b?.getAttribute('data-terminal-etat'), bulle: b?.getAttribute('title') ?? '', voisin: b?.nextElementSibling === reglages || b?.nextElementSibling?.contains(reglages) };
  });
  noter('sur téléphone, le bouton du terminal est dans le pied du menu, juste avant les réglages', piedVisible && voisinage.voisin, JSON.stringify(voisinage));
  noter('il dit que le terminal est réduit, avec sa bulle', voisinage.etat === 'reduit' && voisinage.bulle.length > 0);
  await mobile.screenshot({ path: path.join(SHOTS, 'terminal-pied-telephone.png') });
  await pied.click();
  noter('le bouton du pied rouvre le terminal', await mobile.locator('[data-terminal-volet]:not([data-terminal-reduit])').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false));
}

try {
  await main();
} catch (erreur) {
  noter('le contrôle va au bout', false, String(erreur?.stack ?? erreur));
} finally {
  await navigateur?.close().catch(() => undefined);
  tmuxDEssai(['kill-server']);
  nettoyer();
  fs.rmSync(TMUX_DIR, { recursive: true, force: true });
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies.`);
process.exit(echecs ? 1 : 0);
