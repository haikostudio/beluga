#!/usr/bin/env node
/**
 * LES FEUILLES DU BAS ONT UNE SEULE TENUE ET UN SEUL GESTE — dans un vrai
 * navigateur (demande du 31/10/2026, captures #44f72, #99d8, #af1f, #f9b0).
 *
 *   node scripts/verif-feuilles-du-bas.mjs
 *
 * Le script monte son PROPRE démon (port libre, base neuve, plafond d'agents à
 * zéro) : aucun moteur appelé, le démon de production n'est pas touché.
 *
 * Ce qui est prouvé :
 *   1. téléphone : le menu principal, qui s'arrête 20 px sous le haut de la
 *      vue, a ses coins du haut arrondis, comme la feuille de la cloche et le
 *      menu « … » ;
 *   2. au doigt, un glissé vers le bas parti des 100 px du haut ferme la
 *      feuille (et elle reste fermée) ; un glissé court la laisse remonter ;
 *      parti plus bas, il ne la ferme pas ; un appui sur un bouton de la bande
 *      reste un appui ;
 *   3. ordinateur : la feuille de la cloche a le MÊME rayon et la MÊME barre
 *      de prise qu'au téléphone ; au doigt elle se tire par la bande, à la
 *      souris par la poignée seule ;
 *   4. la liste des tâches au-dessus du champ tient son défilement
 *      (`overscroll-behavior: contain`) : arrivée en butée, le doigt ne fait
 *      défiler ni la conversation ni rien autour d'elle ;
 *   5. la fermeture au doigt, relevée image par image : le haut de la feuille
 *      ne remonte jamais, de la prise à la disparition ;
 *   6. la marche du bas : 10 px sur téléphone, 0 clavier ouvert, et le champ
 *      d'écriture ne la compte qu'une fois ;
 *   7. aucune croix visible dans une feuille sur téléphone.
 *
 * LIMITE CONNUE : Chrome sans écran ne fait pas glisser la vue entière comme
 * Safari iPhone (capture #f9b0) — même sans la retenue, rien n'y bouge. Le
 * point 4 prouve donc la règle posée et l'absence de régression ; seul un
 * vrai iPhone prouve la correction.
 *
 * Les gestes au doigt passent par CDP `Input.dispatchTouchEvent` (le seul qui
 * produise de vrais toucher en Chrome sans écran) ; chaque point d'appui est
 * SONDÉ (`elementsFromPoint`) avant le geste.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

void fileURLToPath;
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_FEUILLES_PORT || 7217);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-feuilles-du-bas-',
  port: PORT,
  messageCommit: 'feuilles',
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai-feuilles';
const CARTE_ID = 'c-essai-feuilles';
const AGENT_ID = 'a-essai-feuilles';
const TITRE = 'Carte d’essai — feuilles du bas';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification feuilles du bas',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai feuilles',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'task',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'task', 'idle', JSON.stringify(agent), maintenant, maintenant);

  /* Un fil LONG (il doit pouvoir défiler dans les deux sens), puis une
     réponse qui porte une liste de tâches LONGUE (elle déborde de sa zone). */
  const inserer = db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 24; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    const message = {
      id: `m-${i}`,
      agentId: AGENT_ID,
      role,
      content: `Message numéro ${i + 1}. ${'Une phrase pour occuper la hauteur du fil. '.repeat(4)}`,
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      createdAt: maintenant - (30 - i) * 1000,
    };
    inserer.run(message.id, AGENT_ID, role, JSON.stringify(message), message.createdAt);
  }
  const todos = Array.from({ length: 16 }, (_, i) => ({
    state: i < 3 ? 'done' : 'todo',
    label: `Tâche d’essai numéro ${i + 1}, assez longue pour prendre sa ligne`,
  }));
  const derniere = {
    id: 'm-taches',
    agentId: AGENT_ID,
    role: 'assistant',
    content: 'Voici ma liste de tâches.',
    steps: [],
    todos,
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    createdAt: maintenant - 1000,
  };
  inserer.run(derniere.id, AGENT_ID, 'assistant', JSON.stringify(derniere), derniere.createdAt);
  db.close();
}

/* ------------------------------------------------------------------ */
/* Les gestes                                                          */
/* ------------------------------------------------------------------ */

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Un glissé au doigt, de (x, y) sur `dy` px, en `pas` mouvements. */
async function glisser(cdp, x, y, dy, pas = 14) {
  const point = (yy) => [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(y) });
  for (let i = 1; i <= pas; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y + (dy * i) / pas) });
    await pause(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function taper(cdp, x, y) {
  const point = [{ x, y, id: 2, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  await pause(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Le haut de la feuille, son rayon calculé, et ce qui est sous le point visé. */
async function mesurer(page, selecteur, decalageY = 0) {
  return page.evaluate(
    ({ selecteur, decalageY }) => {
      const feuille = document.querySelector(selecteur);
      if (!feuille) return null;
      const r = feuille.getBoundingClientRect();
      const s = getComputedStyle(feuille);
      const x = r.left + r.width / 2 + 60;
      const y = r.top + decalageY;
      const dessous = document.elementsFromPoint(x, y)[0];
      const barre = feuille.querySelector('[data-poignee-tiroir] > *, [data-poignee-tiroir] button, [data-poignee-tiroir] span');
      const rb = barre?.getBoundingClientRect();
      return {
        haut: r.top,
        x,
        y,
        rayon: parseFloat(s.borderTopLeftRadius),
        rayonDroit: parseFloat(s.borderTopRightRadius),
        plafond: parseFloat(s.maxHeight),
        vue: window.innerHeight,
        transform: s.transform,
        dedans: !!dessous && feuille.contains(dessous),
        barre: rb ? { w: Math.round(rb.width), h: Math.round(rb.height) } : null,
      };
    },
    { selecteur, decalageY },
  );
}

/** Ce qui, AUTOUR de la liste, a défilé : ses ancêtres, la page, la vue. */
async function defilementAutour(page) {
  return page.evaluate(() => {
    let total = window.scrollY + (window.visualViewport?.offsetTop ?? 0);
    let el = document.querySelector('[data-essai-liste]')?.parentElement;
    while (el) {
      total += el.scrollTop;
      el = el.parentElement;
    }
    const fil = document.querySelector('[data-fil="conversation"], [data-fil="parcours"]');
    return Math.round(total + (fil?.scrollTop ?? 0));
  });
}

async function ouverte(page, selecteur) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && el.getAttribute('data-state') !== 'closed';
  }, selecteur);
}

/* ------------------------------------------------------------------ */

const FEUILLE = '[data-feuille-du-bas][data-state="open"]';
const MENU = '[data-feuille-du-bas][data-zone="gauche"]';

async function ouvrirLApplication(navigateur, viewport, tactile) {
  const contexte = await navigateur.newContext({
    viewport,
    hasTouch: tactile,
    isMobile: tactile && viewport.width < 640,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  await contexte.addInitScript(() => {
    try {
      localStorage.setItem('beluga.volet-taches.deplie', '1');
    } catch {
      /* rien */
    }
  });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
  const cdp = await contexte.newCDPSession(page);
  return { contexte, page, cdp, erreurs };
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await pause(1500);
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ======================= TÉLÉPHONE ======================= */
  const tel = await ouvrirLApplication(navigateur, { width: 402, height: 874 }, true);
  const { page, cdp } = tel;

  /* 1. Le menu principal, qui monte jusqu'en haut. */
  await page.locator('button[aria-label="Projets"]:visible').first().click();
  await page.waitForTimeout(700);
  let m = await mesurer(page, MENU, 60);
  noter('téléphone : le menu principal s’ouvre en feuille', !!m);
  noter('téléphone : le menu principal a ses coins du haut arrondis', !!m && m.rayon >= 10 && m.rayonDroit >= 10, `rayon ${m?.rayon}`);
  const rayonTelephone = m?.rayon;
  noter('téléphone : le point d’appui à 60 px est bien dans la feuille', !!m?.dedans);
  /* 31/10/2026 : « il ne faut pas que les drawer prennent 100 % de la hauteur, laisse 20px ». */
  noter('téléphone : le menu s’arrête 20 px sous le haut de la vue', !!m && Math.abs(m.haut - 20) <= 1, `${m?.haut} px`);

  /* 2a. Un glissé court : la feuille remonte. */
  await glisser(cdp, m.x, m.y, 40);
  await page.waitForTimeout(500);
  m = await mesurer(page, MENU, 60);
  noter('téléphone : un glissé de 40 px laisse la feuille ouverte, en place', (await ouverte(page, MENU)) && (m?.transform === 'none' || m?.transform === 'matrix(1, 0, 0, 1, 0, 0)'), m?.transform);

  /* 2b. Parti plus bas que la bande, le glissé ne ferme pas. */
  const bas = await mesurer(page, MENU, 200);
  noter('téléphone : le point d’appui à 200 px est bien dans la feuille', !!bas?.dedans);
  await glisser(cdp, bas.x, bas.y, 300);
  await page.waitForTimeout(700);
  noter('téléphone : un glissé parti à 200 px ne ferme pas la feuille', await ouverte(page, MENU));

  /* 2c. Un appui sur un bouton de la bande reste un appui. */
  const bouton = await page.evaluate((sel) => {
    const feuille = document.querySelector(sel);
    const haut = feuille.getBoundingClientRect().top;
    const b = [...feuille.querySelectorAll('button')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.top - haut > 14 && r.bottom - haut < 100 && !el.closest('[data-poignee-tiroir]');
    });
    if (!b) return null;
    b.setAttribute('data-essai-bouton-de-bande', '');
    window.__appuis = 0;
    b.addEventListener(
      'click',
      (e) => {
        window.__appuis++;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, MENU);
  if (bouton) {
    await taper(cdp, bouton.x, bouton.y);
    await page.waitForTimeout(400);
    const appuis = await page.evaluate(() => window.__appuis);
    noter('téléphone : un appui sur un bouton de la bande le déclenche, une fois', appuis === 1, `${appuis} clic(s)`);
    noter('téléphone : …et la feuille reste ouverte', await ouverte(page, MENU));
  } else noter('téléphone : un bouton se trouve dans la bande du menu', false);

  /* 2d. Le glissé vers le bas parti de la bande ferme, et la feuille reste fermée.
     IMAGE PAR IMAGE (31/10/2026 : « c'est comme si elle remontait avant de
     fermer ») : le haut de la feuille ne remonte JAMAIS, du premier mouvement
     du doigt à sa disparition. */
  m = await mesurer(page, MENU, 60);
  await page.evaluate((s) => {
    const hauts = [];
    window.__hautsDeFeuille = hauts;
    const feuille = document.querySelector(s);
    const relever = () => {
      if (!feuille.isConnected) return;
      hauts.push(Math.round(feuille.getBoundingClientRect().top * 10) / 10);
      requestAnimationFrame(relever);
    };
    requestAnimationFrame(relever);
  }, MENU);
  await glisser(cdp, m.x, m.y, 320);
  await page.waitForTimeout(900);
  const hauts = await page.evaluate(() => window.__hautsDeFeuille ?? []);
  const remontees = hauts.filter((h, i) => i > 0 && h < hauts[i - 1] - 1);
  noter(
    'téléphone : de la prise à la disparition, la feuille ne remonte jamais',
    hauts.length > 10 && remontees.length === 0 && hauts[hauts.length - 1] >= 874 - 2,
    `${hauts.length} images, ${remontees.length} remontée(s), ${hauts.slice(0, 3).join(' ')} … ${hauts.slice(-4).join(' ')}`,
  );
  noter('téléphone : un glissé de 320 px parti à 60 px ferme le menu', !(await ouverte(page, MENU)));
  await page.waitForTimeout(800);
  noter('téléphone : …et il reste fermé', !(await ouverte(page, MENU)));

  /* 3. La feuille de la cloche. */
  await page.locator('[data-cloche-notifications]').first().click();
  await page.waitForTimeout(700);
  let c = await mesurer(page, FEUILLE, 50);
  /* 31/10/2026 : sur téléphone, une feuille haute monte au niveau du menu principal ; une feuille courte suit son contenu. */
  noter('téléphone : une feuille haute peut monter au niveau du menu principal', !!c && Math.abs(c.plafond - (c.vue - 20)) <= 1, `plafond ${c?.plafond} / vue ${c?.vue}`);
  noter('téléphone : une feuille au contenu court reste à sa taille', !!c && c.haut > 20 + 40, `haut ${c?.haut} px`);
  noter('téléphone : la feuille de la cloche a le même rayon que le menu', !!c && c.rayon === rayonTelephone, `${c?.rayon} / ${rayonTelephone}`);
  noter('téléphone : la barre de prise mesure 40 × 4', c?.barre?.w === 40 && c?.barre?.h === 4, JSON.stringify(c?.barre));
  const barreTelephone = c?.barre;
  await glisser(cdp, c.x, c.y, 300);
  await page.waitForTimeout(900);
  noter('téléphone : la feuille de la cloche se ferme au glissé de la bande', (await page.locator(FEUILLE).count()) === 0);

  /* 4. Le menu « … » de l'en-tête, feuille du bas sur téléphone. */
  const troisPoints = page.locator('button[aria-haspopup="menu"]:visible').first();
  if (await troisPoints.count()) {
    await troisPoints.click();
    await page.waitForTimeout(600);
    const menu = '[role="menu"][data-state="open"]';
    const d = await mesurer(page, menu, 40);
    noter('téléphone : le menu « … » a le même rayon et sa poignée', !!d && d.rayon === rayonTelephone && d.barre?.w === 40, `${d?.rayon} ${JSON.stringify(d?.barre)}`);
    if (d) {
      await glisser(cdp, d.x, d.y, 300);
      await page.waitForTimeout(800);
      noter('téléphone : le menu « … » se ferme au glissé de la bande', (await page.locator(menu).count()) === 0);
    }
  } else noter('téléphone : un menu « … » est présent dans l’en-tête', false);

  /* 5. La liste des tâches au-dessus du champ ne fait pas défiler la conversation. */
  /* La carte s'ouvre depuis la colonne de gauche, qui liste les agents. */
  await page.locator('button[aria-label="Projets"]:visible').first().click();
  await page.waitForTimeout(800);
  const ligneDeCarte = page.locator(MENU).getByText(TITRE.slice(0, 20)).first();
  if (!(await ligneDeCarte.count())) {
    const projet = page.locator(MENU).getByText('Essai feuilles').first();
    if (await projet.count()) await projet.click();
    await page.waitForTimeout(800);
  }
  await page.locator(MENU).getByText(TITRE.slice(0, 20)).first().click();
  await page.waitForTimeout(3000);
  const zones = await page.evaluate(() => {
    const fil = document.querySelector('[data-fil="conversation"], [data-fil="parcours"]');
    const li = [...document.querySelectorAll('li')].find((el) => el.textContent?.includes('Tâche d’essai numéro 16'));
    let liste = li?.parentElement;
    while (liste && !(liste.scrollHeight > liste.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(liste).overflowY))) liste = liste.parentElement;
    if (!fil || !liste) return { fil: !!fil, liste: !!liste };
    liste.setAttribute('data-essai-liste', '');
    fil.scrollTop = Math.max(0, (fil.scrollHeight - fil.clientHeight) / 2);
    liste.scrollTop = 0;
    const r = liste.getBoundingClientRect();
    return {
      fil: true,
      liste: true,
      contain: getComputedStyle(liste).overscrollBehaviorY,
      deborde: fil.scrollHeight > fil.clientHeight + 50,
      x: r.left + r.width / 2,
      y: r.top + Math.min(40, r.height / 2),
    };
  });
  noter('téléphone : la liste des tâches déborde et défile sur elle-même', !!zones.liste, JSON.stringify(zones).slice(0, 80));
  noter('téléphone : le fil de la conversation peut défiler', !!zones.deborde);
  noter('la zone de la liste tient son défilement (overscroll contain)', zones.contain === 'contain', zones.contain);
  if (zones.liste && zones.fil) {
    const filAvant = await defilementAutour(page);
    /* Liste en haut : le doigt descend (on remonte la liste), elle est déjà en butée. */
    await glisser(cdp, zones.x, zones.y, 120);
    await page.waitForTimeout(600);
    const filApres = await defilementAutour(page);
    noter('téléphone : la liste en butée ne passe le geste ni au fil ni à la page', Math.abs(filApres - filAvant) < 2, `${filAvant} → ${filApres}`);
    /* Puis tout en bas : le doigt monte, la liste est en butée basse. */
    await page.evaluate(() => {
      const l = document.querySelector('[data-essai-liste]');
      l.scrollTop = l.scrollHeight;
    });
    const avant2 = await defilementAutour(page);
    await glisser(cdp, zones.x, zones.y + 60, -120);
    await page.waitForTimeout(600);
    const apres2 = await defilementAutour(page);
    noter('téléphone : en butée basse non plus', Math.abs(apres2 - avant2) < 2, `${avant2} → ${apres2}`);
  }
  /* 6. LA MARCHE DU BAS (31/10/2026) : 10 px de plus sous le champ d'écriture,
     0 clavier ouvert. */
  const marcheDuBas = await page.evaluate(async () => {
    const lire = () => getComputedStyle(document.documentElement).getPropertyValue('--marche-du-bas').trim();
    const espace = () => {
      const champ = [...document.querySelectorAll('[data-composer]')].find((n) => n.getClientRects().length > 0);
      if (!champ) return null;
      const r = champ.getBoundingClientRect();
      return Math.round(window.innerHeight - (r.bottom - parseFloat(getComputedStyle(champ).paddingBottom)));
    };
    const image = () => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)));
    const marche = lire();
    const avec = espace();
    /* La même page sans la marche : l'écart doit être de 10 px, pas 20 (comptée une fois). */
    document.documentElement.style.setProperty('--marche-du-bas', '0px');
    await image();
    const sans = espace();
    document.documentElement.style.removeProperty('--marche-du-bas');
    document.documentElement.setAttribute('data-clavier-ouvert', '');
    const clavier = lire();
    document.documentElement.removeAttribute('data-clavier-ouvert');
    return { marche, clavier, avec, sans };
  });
  noter('téléphone : la marche du bas vaut 10 px, 0 clavier ouvert', marcheDuBas.marche === '10px' && marcheDuBas.clavier === '0px', JSON.stringify(marcheDuBas));
  noter(
    'téléphone : le champ d’écriture remonte de 10 px, comptés une seule fois',
    marcheDuBas.avec !== null && marcheDuBas.avec - marcheDuBas.sans === 10,
    JSON.stringify(marcheDuBas),
  );
  /* 7. AUCUNE CROIX SUR TÉLÉPHONE (31/10/2026, capture #ecc5) : la cloche, sa feuille ouverte. */
  noter('téléphone : aucune croix visible dans une feuille ou une fenêtre', await page.evaluate(() =>
    [...document.querySelectorAll('[data-feuille-du-bas] svg.lucide-x, [data-fenetre-centree] svg.lucide-x, [data-feuille-du-volet] svg.lucide-x')].every((n) => n.getClientRects().length === 0),
  ));
  noter('téléphone : aucune erreur de page', tel.erreurs.length === 0, tel.erreurs.slice(0, 2).join(' | '));
  await tel.contexte.close();

  /* ======================= ORDINATEUR ======================= */
  /* La souris d'abord, sur un ordinateur sans écran tactile. */
  const ord = await ouvrirLApplication(navigateur, { width: 1440, height: 900 }, false);
  const p2 = ord.page;
  await p2.locator('[data-cloche-notifications]:visible').first().click();
  await p2.waitForTimeout(800);
  let o = await mesurer(p2, FEUILLE, 50);
  noter('ordinateur : la feuille de la cloche s’ouvre', !!o);
  noter('ordinateur : une feuille haute reste plafonnée à 92 %', !!o && Math.abs(o.plafond - o.vue * 0.92) <= 1, `plafond ${o?.plafond} / vue ${o?.vue}`);
  noter('ordinateur : même rayon qu’au téléphone', o?.rayon === rayonTelephone, `${o?.rayon} / ${rayonTelephone}`);
  noter('ordinateur : même barre de prise qu’au téléphone', JSON.stringify(o?.barre) === JSON.stringify(barreTelephone), JSON.stringify(o?.barre));

  /* La souris ne tire PAS par la bande, seulement par la poignée. */
  await p2.mouse.move(o.x, o.y);
  await p2.mouse.down();
  await p2.mouse.move(o.x, o.y + 250, { steps: 10 });
  await p2.mouse.up();
  await p2.waitForTimeout(600);
  noter('ordinateur : à la souris, tirer la bande ne ferme rien', (await p2.locator(FEUILLE).count()) === 1);
  const poignee = await p2.evaluate((s) => {
    const r = document.querySelector(s).querySelector('[data-poignee-tiroir]').getBoundingClientRect();
    return { x: r.left + r.width / 2 + 80, y: r.top + r.height / 2 };
  }, FEUILLE);
  await p2.mouse.move(poignee.x, poignee.y);
  await p2.mouse.down();
  await p2.mouse.move(poignee.x, poignee.y + 250, { steps: 10 });
  await p2.mouse.up();
  await p2.waitForTimeout(800);
  noter('ordinateur : à la souris, tirer la poignée ferme la feuille', (await p2.locator(FEUILLE).count()) === 0);

  noter('ordinateur : aucune erreur de page', ord.erreurs.length === 0, ord.erreurs.slice(0, 2).join(' | '));
  await ord.contexte.close();

  /* Au doigt, sur un ordinateur à écran tactile : la bande tire. */
  const tac = await ouvrirLApplication(navigateur, { width: 1440, height: 900 }, true);
  await tac.page.locator('[data-cloche-notifications]:visible').first().click();
  await tac.page.waitForTimeout(800);
  o = await mesurer(tac.page, FEUILLE, 50);
  await glisser(tac.cdp, o.x, o.y, 300);
  await tac.page.waitForTimeout(900);
  noter('ordinateur tactile : un glissé du doigt dans la bande ferme la feuille', (await tac.page.locator(FEUILLE).count()) === 0);

  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join('').slice(-3000));
  process.exit(1);
});
