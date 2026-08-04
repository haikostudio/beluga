#!/usr/bin/env node
/**
 * La ligne d'un projet, dans la colonne de gauche, sur un ÉCRAN DE TÉLÉPHONE —
 * là où la largeur manque et où l'empilement de repères se paie comptant.
 *
 * Ce qu'on contrôle :
 *
 *  - un agent au travail se montre par un ROBOT, à la place du dossier : plus
 *    d'anneau qui tourne, plus de compteur vert à l'autre bout de la ligne ;
 *  - le nombre ne s'écrit qu'à partir de DEUX agents ;
 *  - un seul repère d'attente à la fois : la décision (triangle orange)
 *    l'emporte sur le travail rendu (point bleu), qui reparaît une fois la
 *    décision réglée ;
 *  - au pire des cas (agent + décision + travail rendu), la ligne ne porte pas
 *    plus de DEUX repères en plus du bouton de réglages, et elle ne déborde
 *    pas de la colonne ;
 *  - une PUBLICATION en cours allume un point jaune du côté du robot (un état,
 *    pas une décision) qui s'éteint dès qu'elle se termine.
 *
 * Les états sont SIMULÉS : on rejoue les messages du serveur dans le canal
 * temps réel, sans toucher à la base ni déranger un agent au travail.
 *
 *   HAIKODEV_URL=http://localhost:7099 node scripts/verif-ligne-projet.mjs
 *
 * Attention : HAIKODEV_URL par défaut désigne l'application PUBLIÉE. Pour juger
 * d'un code non publié, viser le serveur de développement.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const require = createRequire(import.meta.url);
const base = require('/root/haikodev/node_modules/better-sqlite3')('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/* Les jetons de session sont stockés HACHÉS : on ne peut pas en reprendre un,
   le script s'en fabrique donc un d'une heure et le retire en partant. Surtout
   pas HAIKODEV_TOKEN : c'est le jeton d'un agent, et la page resterait sur
   « Connexion au serveur… ». */
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification ligne de projet');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

fs.mkdirSync(SHOTS, { recursive: true });
const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 402, height: 874 },
  isMobile: true,
  hasTouch: true,
  locale: 'fr-CH',
  // Sans cela, un poste réglé sur « réduire les animations » éteindrait le
  // clignotement du point bleu : on ne jugerait plus rien.
  reducedMotion: 'no-preference',
});
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

/* On se greffe sur le canal temps réel pour rejouer les messages du serveur
   tels qu'ils arriveraient pour de vrai. */
await page.addInitScript(() => {
  window.__ecouteurs = [];
  const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return propriete.get.call(this);
    },
    set(ecouteur) {
      window.__ecouteurs.push(ecouteur);
      return propriete.set.call(this, ecouteur);
    },
  });
  const rejouer = (charge) => {
    const donnees = JSON.stringify(charge);
    for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
  };
  window.__attention = (byProject) => rejouer({ type: 'attention', byProject });
  window.__rendus = (byProject) => rejouer({ type: 'rendus', byProject });
  /* Un agent au travail sur ce projet, tel que le démon le diffuse. L'agent
     doit être COMPLET : le bandeau des agents lit `run.engine`, et un champ
     manquant y ferait tomber l'application entière. */
  window.__agent = (id, projectId) =>
    rejouer({
      type: 'agent.upsert',
      agent: {
        id,
        projectId,
        status: 'running',
        role: 'task',
        title: 'Agent d’essai (vérification)',
        run: { engine: 'claude', thinking: 'none', mode: 'direct' },
        startedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  window.__agentFini = (id) => rejouer({ type: 'agent.delete', id });
  /* Une publication de ce projet, telle que le démon la diffuse : `state` vaut
     'running' pendant la mise en ligne, puis 'success' / 'failed' / 'stopped'. */
  window.__deploy = (projectId, state) =>
    rejouer({ type: 'deploy.upsert', run: { id: 'essai-deploy', projectId, state, steps: [] } });
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
// L'application reprend l'endroit quitté : un panneau resté ouvert masquerait
// le bouton des projets.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

/* Sur téléphone, la colonne de gauche vit dans un panneau qui glisse. */
await page.locator('button[aria-label="Projets"]').first().click();
await page.waitForTimeout(1200);

/* La colonne de gauche existe DEUX fois dans la page : celle des grands écrans,
   masquée par la mise en page, et celle du panneau du téléphone. Les deux
   portent les mêmes identifiants — on ne juge que la ligne VISIBLE. */
const lignes = page.locator('[data-drag-kind="project"]:visible');
const combien = await lignes.count();
noter('la liste des projets s’ouvre sur téléphone', combien > 0, `${combien} lignes`);
if (!combien) {
  await navigateur.close();
  process.exit(1);
}

/* On vise un projet AU REPOS : un projet où un vrai agent travaille déjà
   fausserait tout ce qui suit. */
const cible = await lignes.evaluateAll(
  (n) => n.find((e) => !e.querySelector('[data-repere-robot]'))?.getAttribute('data-drag-id') ?? null,
);
noter('un projet au repos à observer', !!cible, cible ?? 'aucun');
if (!cible) {
  await navigateur.close();
  process.exit(1);
}
const ligne = page.locator(`[data-drag-kind="project"][data-drag-id="${cible}"]:visible`);
const robot = ligne.locator('[data-repere-robot]');
const triangle = ligne.locator('[data-signal-attention]');
const point = ligne.locator('[data-signal-termine]');
const jaune = ligne.locator('[data-repere-publication]');

/* On part d'une page blanche : le serveur diffuse l'état RÉEL. */
await page.evaluate(() => {
  window.__attention({});
  window.__rendus({});
});
await page.waitForTimeout(400);

/* --- 1. Au repos : aucun repère --------------------------------------- */
noter('au repos, pas de robot', (await robot.count()) === 0);
noter('au repos, pas de triangle', (await triangle.count()) === 0);
noter('au repos, pas de point bleu', (await point.count()) === 0);
noter('au repos, pas de point jaune', (await jaune.count()) === 0);

/* --- 2. Un agent au travail : un robot, et rien qui tourne ------------- */
await page.evaluate((id) => window.__agent('essai-robot-1', id), cible);
await page.waitForTimeout(400);
noter('un agent au travail montre un robot', (await robot.count()) === 1);
noter(
  'plus d’anneau qui tourne sur la ligne',
  (await ligne.locator('.animate-spin').count()) === 0,
);
noter('un seul agent : aucun nombre écrit', (await robot.innerText()).trim() === '');

/* --- 3. Deux agents : le nombre apparaît -------------------------------- */
await page.evaluate((id) => window.__agent('essai-robot-2', id), cible);
await page.waitForTimeout(400);
noter('deux agents : le robot porte le nombre', (await robot.innerText()).trim() === '2');
await page.screenshot({ path: `${SHOTS}/ligne-projet-robot.png` });

/* --- 4. Un seul repère d'attente : le plus urgent l'emporte ------------- */
await page.evaluate((id) => window.__rendus({ [id]: 3 }), cible);
await page.waitForTimeout(400);
noter('un travail rendu allume le point bleu', (await point.count()) === 1);

await page.evaluate((id) => window.__attention({ [id]: 1 }), cible);
await page.waitForTimeout(400);
noter('une décision attendue prend la place', (await triangle.count()) === 1);
noter('et le point bleu s’efface le temps de la décision', (await point.count()) === 0);

/* --- 5. Deux repères au plus, et rien qui déborde ----------------------- */
const mesure = await ligne.evaluate((n) => {
  const conteneur = n.parentElement;
  return {
    reperes:
      n.querySelectorAll('[data-repere-robot], [data-signal-attention], [data-signal-termine]').length,
    largeurLigne: n.getBoundingClientRect().width,
    largeurColonne: conteneur ? conteneur.clientWidth : 0,
    deborde: n.scrollWidth > n.clientWidth + 1,
  };
});
noter(
  'au pire des cas, deux repères au plus sur la ligne',
  mesure.reperes <= 2,
  `${mesure.reperes} repère(s)`,
);
noter(
  'la ligne tient dans la largeur de la colonne',
  !mesure.deborde && mesure.largeurLigne <= mesure.largeurColonne + 1,
  `${Math.round(mesure.largeurLigne)} px pour ${Math.round(mesure.largeurColonne)} px`,
);
noter('le bouton des réglages est toujours là', (await ligne.locator('[title="Réglages du projet"]').count()) === 1);
await page.screenshot({ path: `${SHOTS}/ligne-projet-telephone.png` });

/* --- 6. Chaque repère se dit en français simple ------------------------- */
const libelles = await ligne.evaluate((n) =>
  [...n.querySelectorAll('[data-repere-robot], [data-signal-attention], [data-signal-termine]')].map(
    (e) => e.getAttribute('aria-label') || '',
  ),
);
noter(
  'chaque repère dit ce qu’il veut dire',
  libelles.length > 0 && libelles.every((l) => l.length > 8),
  libelles.join(' | '),
);

/* --- 7. La décision réglée, le point bleu revient tout seul ------------- */
await page.evaluate(() => window.__attention({}));
await page.waitForTimeout(400);
noter('la décision réglée, le point bleu revient', (await point.count()) === 1);

/* --- 8. Les agents partis, le dossier revient --------------------------- */
await page.evaluate(() => {
  window.__agentFini('essai-robot-1');
  window.__agentFini('essai-robot-2');
  window.__rendus({});
});
await page.waitForTimeout(400);
noter('les agents partis, plus de robot', (await robot.count()) === 0);
noter('et la ligne redevient muette', (await point.count()) === 0 && (await triangle.count()) === 0);

/* --- 9. Une publication en cours : le point jaune, du côté du robot ----- */
await page.evaluate((id) => window.__deploy(id, 'running'), cible);
await page.waitForTimeout(400);
noter('une publication en cours allume le point jaune', (await jaune.count()) === 1);
noter(
  'le point jaune se dit en français simple',
  ((await jaune.getAttribute('aria-label')) || '').length > 8,
  (await jaune.getAttribute('aria-label')) || '',
);
noter(
  'la publication ne compte pas comme repère d’attente',
  (await triangle.count()) === 0 && (await point.count()) === 0,
);
await page.screenshot({ path: `${SHOTS}/ligne-projet-publication.png` });

/* Une publication terminée — quel qu'en soit le sort — éteint le repère. */
await page.evaluate((id) => window.__deploy(id, 'success'), cible);
await page.waitForTimeout(400);
noter('la publication finie, le point jaune s’éteint', (await jaune.count()) === 0);

noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
