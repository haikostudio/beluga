#!/usr/bin/env node
/**
 * « Beluga » : l'espace de développement, ANCRÉ EN TÊTE DE LA LISTE.
 *
 * Le projet posé sur le dossier de Beluga Build (marque `isSelf`) n'est pas un
 * projet client : il occupe la PREMIÈRE place de la liste des projets, sous le
 * libellé « Projets », sans jamais entrer dans le rangement. Ce qu'on contrôle :
 *
 *  - il n'a AUCUNE ligne rangeable (pas de `data-drag-id`, ni hors groupe ni
 *    dans un groupe) : on ne peut ni le déplacer dans la liste ni le mettre
 *    dans un groupe ;
 *  - il RECOIT en revanche une carte glissée du tableau, comme toute ligne de
 *    projet (`data-projet-cible`) — c'est le seul geste de souris qui lui reste,
 *    et le déplacement lui-même est prouvé par
 *    `scripts/verif-deplacement-de-projet.mjs` ;
 *  - sa ligne dédiée existe, SOUS le libellé « Projets » et AU-DESSUS du
 *    premier projet de la liste — première ligne de son groupe « Local »
 *    (`shared/src/groupe-local.ts`), lui-même en tête de colonne à sa création ;
 *  - elle s'appelle « Beluga » et porte le favicon de l'application ;
 *  - un clic ouvre bien SON tableau (même identifiant qu'en base) ;
 *  - la ligne s'allume tant que cet espace est celui qu'on regarde ;
 *  - il porte les mêmes repères qu'une ligne de projet : robot quand un agent
 *    travaille, triangle orange quand une décision attend, point bleu pour un
 *    travail rendu non lu — un seul repère d'attente à la fois ;
 *  - ses réglages restent atteignables depuis cette ligne.
 *
 * Les états sont SIMULÉS : on rejoue les messages du serveur dans le canal
 * temps réel, sans toucher à la base ni déranger un agent au travail. Le projet
 * qu'on regardait au départ est remis en place en partant.
 *
 *   HAIKO_ESPACE_DEV_URL=http://localhost:7099 node scripts/verif-espace-dev.mjs
 *
 * Viser le serveur de DÉVELOPPEMENT : `BELUGA_URL` désigne l'application déjà
 * publiée, où l'on verrait l'ancienne version.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où l'on PART : lancé depuis une copie de travail, ce script doit
   juger CE code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_ESPACE_DEV_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const SHOTS = path.join(DONNEES, 'verification');

const require = createRequire(import.meta.url);
const base = require(path.join(RACINE, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'beluga.db'));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/* Les jetons de session sont stockés HACHÉS : on s'en fabrique un d'une heure,
   retiré en partant. Surtout pas BELUGA_TOKEN (jeton d'agent, périmé). */
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification espace de développement');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

/* L'espace de développement, tel que le démon l'a marqué en base. */
const soi = base
  .prepare('SELECT id, name, data FROM projects WHERE archived = 0')
  .all()
  .find((p) => {
    try {
      return JSON.parse(p.data).isSelf === true;
    } catch {
      return false;
    }
  });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

noter('un projet porte la marque « lui-même » en base', !!soi, soi ? `${soi.name} (${soi.id})` : 'aucun');
if (!soi) {
  console.log('\nRien à contrôler sans ce projet.');
  process.exit(1);
}

fs.mkdirSync(SHOTS, { recursive: true });
const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 900 },
  locale: 'fr-CH',
  // Sinon un poste réglé sur « réduire les animations » éteindrait le
  // clignotement du point bleu : on ne jugerait plus rien.
  reducedMotion: 'no-preference',
});
await contexte.addCookies([
  { name: 'beluga_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
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
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-drop-root]', { timeout: 60000 });
await page.waitForTimeout(4000);
// L'application reprend l'endroit quitté : un panneau resté ouvert masquerait
// la colonne de gauche.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

/* Le projet qu'on regardait au départ : on le remettra en place en partant. */
const projetDeDepart = await page
  .locator('[data-drop-root] [data-drag-kind="project"].bg-raised')
  .first()
  .getAttribute('data-drag-id')
  .catch(() => null);

/* --- 1. Aucune prise pour la souris ------------------------------------- */
const lignes = page.locator(`[data-drop-root] [data-drag-kind="project"][data-drag-id="${soi.id}"]`);
noter('il n’a aucune ligne rangeable dans la liste', (await lignes.count()) === 0);

/* --- 2. Sa ligne, EN TÊTE de la liste des projets ------------------------ */
const bouton = page.locator('[data-ouvrir-espace-dev]').first();
const bloc = page.locator(`[data-espace-dev="${soi.id}"]`).first();
noter('une ligne dédiée lui est réservée', (await bouton.count()) === 1 && (await bloc.count()) === 1);
noter(
  'elle se dit verrouillée, et n’est pas glissable',
  (await bloc.getAttribute('data-espace-dev-verrouille')) === 'oui' &&
    (await bloc.getAttribute('draggable')) !== 'true',
);
noter(
  'elle est malgré tout une destination pour une carte glissée',
  (await bloc.getAttribute('data-projet-cible')) === soi.id,
  (await bloc.getAttribute('data-projet-cible')) ?? 'aucun repère',
);

const places = await page.evaluate(() => {
  const dev = document.querySelector('[data-ouvrir-espace-dev]');
  const premier = document.querySelector('[data-drop-root] [data-drag-kind="project"]');
  const titre = [...document.querySelectorAll('span')].find((s) => s.textContent?.trim() === 'Projets');
  const y = (el) => (el ? el.getBoundingClientRect().top : null);
  return { dev: y(dev), premier: y(premier), titre: y(titre), dansListe: !!dev?.closest('[data-drop-root]') };
});
noter('elle vit DANS la liste des projets', places.dansListe);
noter(
  'elle est posée sous le libellé « Projets »',
  places.dev !== null && places.titre !== null && places.dev > places.titre,
  `ligne à ${Math.round(places.dev ?? -1)} px, libellé à ${Math.round(places.titre ?? -1)} px`,
);
noter(
  'et EN TÊTE : au-dessus du premier projet rangeable',
  places.premier !== null && places.dev < places.premier,
  `ligne à ${Math.round(places.dev ?? -1)} px, premier projet à ${Math.round(places.premier ?? -1)} px`,
);
noter(
  'elle porte SON nom, celui de la base — « Beluga »',
  ((await bouton.innerText()) || '').includes(soi.name) && soi.name === 'Beluga',
  `${(await bouton.innerText()).replace(/\s+/g, ' ').trim()} — en base : ${soi.name}`,
);
/* Le favicon occupe la place de gauche… sauf quand un repère la prend (agent
   au travail, publication, plan, travail rendu) : ce contrôle tourne souvent
   PENDANT un tour d'agent sur cet espace, l'un ou l'autre est donc juste. */
const favicon = await bloc.locator('[data-espace-dev-favicon]').count();
const repereGauche = await bloc.locator('[data-repere-robot]').count();
noter(
  'elle porte le favicon de l’application (ou son repère quand il y a du travail)',
  favicon === 1 || repereGauche === 1,
  favicon === 1 ? 'favicon' : 'repère de travail',
);

/* --- 3. Un clic ouvre SON tableau, et le bouton s'allume ----------------- */
await bouton.click();
await page.waitForTimeout(1500);
noter('un clic ouvre bien cet espace', (await page.evaluate(() => location.hash)).includes(soi.id), await page.evaluate(() => location.hash));
noter(
  'la ligne s’allume tant que cet espace est ouvert',
  ((await bloc.getAttribute('class')) || '').includes('bg-ligne-active'),
);
await page.screenshot({ path: `${SHOTS}/espace-dev-ouvert.png` });

/* --- 4. Les mêmes repères qu'une ligne de projet ------------------------- */
await page.evaluate(() => {
  window.__attention({});
  window.__rendus({});
});
await page.waitForTimeout(400);
const robot = bloc.locator('[data-repere-robot]');
const triangle = bloc.locator('[data-signal-attention]');
/* Le travail rendu se dit par le COMPTEUR posé sur l'icône de la ligne
   (`CompteurNonConsulte`) : il ne cède plus sa place à personne. */
const point = bloc.locator('[data-compteur-non-consulte]');
/* Des agents travaillent-ils VRAIMENT sur cet espace pendant ce contrôle ? Si
   oui, leur repère prime sur le point bleu — c'est la règle, pas une panne. */
const agentsReels = await robot.count();
/* Le robot suit les agents RÉELS de cet espace — celui qui joue ce contrôle
   compris : on ne peut pas exiger le repos, seulement l'absence de repère
   d'ATTENTE tant qu'aucun compte n'est diffusé. */
noter('sans compte diffusé, aucun repère d’attente', (await triangle.count()) === 0 && (await point.count()) === 0);

await page.evaluate((id) => window.__agent('essai-espace-dev', id), soi.id);
await page.waitForTimeout(400);
noter('un agent au travail montre un robot', (await robot.count()) === 1);

await page.evaluate((id) => window.__agentFini('essai-espace-dev'), soi.id);
await page.evaluate((id) => window.__rendus({ [id]: 2 }), soi.id);
await page.waitForTimeout(400);
if (agentsReels) {
  noter('un travail rendu allume le compteur', (await point.count()) === 1);
} else {
  noter('un travail rendu allume le compteur « 2 »', (await point.count()) === 1 && (await point.innerText()).trim() === '2');
}

await page.evaluate((id) => window.__attention({ [id]: 1 }), soi.id);
await page.waitForTimeout(400);
noter('une décision attendue affiche le triangle orange', (await triangle.count()) === 1);
noter('et le compteur reste sur l’icône pendant la décision', (await point.count()) === 1);
await page.screenshot({ path: `${SHOTS}/espace-dev-reperes.png` });

noter(
  'le triangle dit ce qu’il veut dire',
  ((await triangle.getAttribute('aria-label')) || '').length > 8,
  (await triangle.getAttribute('aria-label')) || '',
);

await page.evaluate(() => window.__attention({}));
await page.waitForTimeout(400);
noter(
  'la décision réglée, le triangle s’efface et le compteur est toujours là',
  (await triangle.count()) === 0 && (await point.count()) === 1,
);

/* --- 5. Les réglages restent atteignables -------------------------------- */
noter(
  'ses réglages s’ouvrent depuis cette ligne',
  (await bloc.locator(`[data-reglages-projet="${soi.id}"]`).count()) === 1,
);

/* On remet la page dans l'état où on l'a trouvée. */
await page.evaluate(() => {
  window.__attention({});
  window.__rendus({});
  window.__agentFini('essai-espace-dev');
});
if (projetDeDepart && projetDeDepart !== soi.id) {
  await page.locator(`[data-drop-root] [data-drag-kind="project"][data-drag-id="${projetDeDepart}"] :is(a, button)`).first().click();
  await page.waitForTimeout(1000);
}

noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
