#!/usr/bin/env node
/**
 * LE BAS DU FIL ALLÉGÉ, DANS UN VRAI NAVIGATEUR (demande du 24/10/2026).
 *
 *   npm run build && node scripts/verif-bas-du-fil.mjs
 *
 * Le script monte son PROPRE démon (port libre, base neuve, interface construite
 * de CETTE copie) — jamais depuis le dépôt principal, jamais sur l'application
 * publiée. Aucun compte moteur n'est déclaré : une demande mise en file y
 * reste (« sans quota, la demande attend en file »), rien ne part à un moteur.
 *
 * À 390 px (téléphone) puis à 1440 px (ordinateur) :
 *   1. LA VEILLE TIENT LA RANGÉE — une carte en veille montre « Arrêter la
 *      veille » et le lien du service, et NI « Reprendre » NI « Terminer la
 *      tâche » ; arrêter la veille ramène la rangée habituelle, sans recharger ;
 *   2. LA FILE EN SECOND DÉCROCHÉ (27/10/2026) — deux messages en attente :
 *      une seule barre « 2 messages en attente », pleine largeur, en
 *      dégradé bleu (fond et bordure), posée AU-DESSUS de la ligne d'état (ou du champ s'il n'y
 *      en a pas) qu'elle passe dessous de 12 px ; la ligne d'état reste collée
 *      au champ ; aucun message de la file écrit au-dessus du champ, et plus
 *      aucune icône qui flotte ;
 *   3. LE TIROIR — il liste les deux messages ; le crayon le referme et remonte
 *      le message dans le champ.
 *
 * Les captures vont dans `BELUGA_CAPTURES` (par défaut un dossier temporaire).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (path.resolve(RACINE) === '/root/beluga') {
  console.error('Ce contrôle monte un démon jetable : lance-le depuis la copie de travail d’une carte, jamais depuis le dépôt principal.');
  process.exit(2);
}
const PORT = Number(process.env.BELUGA_BAS_DU_FIL_PORT || 7217);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-bas-du-fil-'));
const CAPTURES = process.env.BELUGA_CAPTURES || path.join(TMP, 'captures');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor, écrit par le magasin du démon lui-même, AVANT son lancement */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = PROJETS;

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));

const maintenant = Date.now();
const PROJET = 'p-bas-du-fil';
const CARTE_VEILLE = 'carte-en-veille';
const CARTE_FILE = 'carte-avec-file';
const VEILLE = 'veille-essai';
const RAISON = 'Apple accepte et publie la version iPhone 1.0.0';
const MESSAGES = ['Ajoute aussi un bouton pour exporter en CSV', 'Et traduis le libellé en allemand'];
const jeton = crypto.randomBytes(32).toString('hex');

store.saveProject(shared.Project.parse({ id: PROJET, name: 'Application iPhone', path: PROJETS, createdAt: maintenant, updatedAt: maintenant }));
const resume = {
  id: VEILLE,
  etat: 'en_cours',
  raison: RAISON,
  echeance: maintenant + 47 * 3_600_000,
  prochainControleA: maintenant + 3_600_000,
  dernierControle: { a: maintenant - 60_000, issue: 'pas-encore' },
};
for (const [id, titre, veille] of [
  [CARTE_VEILLE, 'Images traduites à poser chez Apple', resume],
  [CARTE_FILE, 'Export de la liste', undefined],
]) {
  store.saveAgent(
    shared.Agent.parse({ id: `agent-${id}`, projectId: PROJET, role: 'task', title: titre, cardId: id, run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant }),
  );
  store.saveMessage(
    shared.Message.parse({ id: `rapport-${id}`, agentId: `agent-${id}`, role: 'assistant', content: 'Travail rendu.', createdAt: maintenant - 120_000 }),
  );
  store.saveCard(
    shared.Card.parse({
      id,
      projectId: PROJET,
      title: titre,
      column: 'running',
      position: 0,
      agentId: `agent-${id}`,
      run: { engine: 'claude' },
      createdAt: maintenant,
      updatedAt: maintenant,
      ...(veille
        ? {
            veille,
            scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: true, enPause: true, waitingReason: `En veille : ${RAISON}` },
          }
        : {}),
    }),
  );
}
for (const texte of MESSAGES) store.enqueuePrompt(`agent-${CARTE_FILE}`, texte, []);
const db = getDb();
db.prepare(
  `INSERT INTO veilles_de_carte (id, card_id, agent_id, raison, recette, intervalle_ms, echeance, etat, cree_a, prochain_controle_a, dernier_controle, termine_a)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  VEILLE,
  CARTE_VEILLE,
  `agent-${CARTE_VEILLE}`,
  RAISON,
  JSON.stringify({ url: 'https://exemple.ch/statut', leveeSi: 'reussite', recette: { type: 'appel', motAttendu: 'Ready for Sale' } }),
  3_600_000,
  resume.echeance,
  'en_cours',
  maintenant - 3_600_000,
  resume.prochainControleA,
  JSON.stringify(resume.dernierControle),
  null,
);
db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(jeton).digest('hex'),
  maintenant,
  maintenant + 3_600_000,
  'vérification du bas du fil',
);
db.close();

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

const journal = [];
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_TOKEN: '',
    BELUGA_URL: '',
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_CAPTURES) fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error(journal.join('').slice(-3000));
  throw new Error('le démon jetable n’a jamais ouvert son port');
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                        */
/* ------------------------------------------------------------------ */

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const erreurs = [];

async function pageA(largeur, hauteur) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-CH', hasTouch: largeur < 640 });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return page;
}

const ouvrirLaCarte = (page, cardId) =>
  page.goto(`${BASE}/#${shared.construireFragment({ vue: 'projet', projectId: PROJET, cardId })}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

try {
  let veilleArretee = false;
  for (const [largeur, hauteur] of [
    [390, 844],
    [1440, 900],
  ]) {
    const page = await pageA(largeur, hauteur);

    /* 1. LA VEILLE TIENT LA RANGÉE (le premier passage l'arrête : le second
          vérifie qu'une carte sans veille garde sa rangée habituelle). */
    await ouvrirLaCarte(page, CARTE_VEILLE);
    const composer = page.locator('[data-composer]:visible').first();
    await composer.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
    if (!veilleArretee) {
      const rangee = composer.locator('[data-rangee-veille]');
      const vue = await rangee.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
      const gestes = await composer.locator('[data-barre-action]').count();
      const texte = await composer.innerText();
      noter(
        `À ${largeur} px, la veille tient la rangée : ni « Reprendre » ni « Terminer la tâche »`,
        vue && gestes === 0 && !texte.includes('Reprendre') && !texte.includes('Terminer la tâche') && (await rangee.locator('[data-veille-arreter]').count()) === 1 && (await rangee.locator('[data-veille-service]').count()) === 1,
        `${gestes} rangée(s) d’action`,
      );
      await composer.screenshot({ path: path.join(CAPTURES, `veille-${largeur}.png`) });
      await rangee.locator('[data-veille-arreter]').click();
      const revenue = await composer.locator('[data-barre-action]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
      noter(
        `À ${largeur} px, arrêter la veille ramène la rangée habituelle, sans recharger`,
        revenue && (await composer.locator('[data-rangee-veille]').count()) === 0,
        await composer.locator('[data-barre-action]').first().getAttribute('data-gestes').catch(() => 'aucune'),
      );
      await composer.screenshot({ path: path.join(CAPTURES, `veille-arretee-${largeur}.png`) });
      veilleArretee = true;
    } else {
      noter(
        `À ${largeur} px, une carte sans veille garde sa rangée habituelle`,
        (await composer.locator('[data-barre-action]').count()) >= 1 && (await composer.locator('[data-rangee-veille]').count()) === 0,
      );
    }

    /* 2. LA FILE EN SECOND DÉCROCHÉ. */
    await ouvrirLaCarte(page, CARTE_FILE);
    const pastille = page.locator('[data-file-attente-barre]:visible').first();
    const vuePastille = await pastille.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
    const barre = page.locator('[data-composer]:visible').first();
    const texteBarre = vuePastille ? await barre.innerText() : '';
    noter(
      `À ${largeur} px, deux messages en attente : une barre « 2 messages en attente », aucun message de la file au-dessus du champ`,
      vuePastille &&
        (await pastille.getAttribute('data-file-attente-barre')) === '2' &&
        (await pastille.innerText()).trim() === '2 messages en attente' &&
        !MESSAGES.some((m) => texteBarre.includes(m)) &&
        !/partiront|dès que l.agent a fini/.test(texteBarre) &&
        (await page.locator('[data-file-attente-pastille]').count()) === 0,
      texteBarre.replace(/\s+/g, ' ').slice(0, 120),
    );
    const mesure = await page.evaluate(() => {
      const composer = [...document.querySelectorAll('[data-composer]')].find((el) => el.getBoundingClientRect().height > 0);
      const barreFile = composer?.querySelector('[data-file-attente-barre]');
      const champ = composer?.querySelector('[data-champ-d-ecriture]');
      if (!barreFile || !champ) return null;
      const temoinEl = [...composer.querySelectorAll('[data-temoin-reflexion]')].find((el) => el.getBoundingClientRect().height > 0);
      const b = barreFile.getBoundingClientRect();
      const c = champ.getBoundingClientRect();
      const t = temoinEl?.getBoundingClientRect();
      const style = getComputedStyle(barreFile);
      /* LE VIOLET ATTENDU : le jeton `--teinte` de la palette affichée,
         résolu par le navigateur (capture #312b, 27/10/2026). */
      const sonde = document.createElement('span');
      sonde.style.color = 'hsl(var(--teinte))';
      document.body.append(sonde);
      const teinte = getComputedStyle(sonde).color;
      sonde.remove();
      /* Qui est dessus au milieu de la bande de recouvrement : le suivant
         (témoin ou champ), jamais la barre. */
      const dessous = t ?? c;
      const auPoint = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.bottom - 4));
      return {
        barre: { x: Math.round(b.left), d: Math.round(b.right), y: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) },
        champ: { x: Math.round(c.left), d: Math.round(c.right), y: Math.round(c.top) },
        temoin: t ? { y: Math.round(t.top), b: Math.round(t.bottom) } : null,
        suivant: Math.round(dessous.top),
        recouvert: Boolean(auPoint && !barreFile.contains(auPoint)),
        fond: style.backgroundColor,
        texte: style.color,
        teinte,
        /* La bordure en dégradé est un second fond peint sous le premier
           (`.decroche-degrade`) : le filet reste transparent, et c'est le
           fond de la boîte entière qui part du violet. */
        fondDeBordure: style.backgroundImage.split(/,\s*(?=linear-gradient)/)[1] ?? '',
        boites: style.backgroundClip,
        bordureHaut: style.borderTopColor,
        bordureBas: parseFloat(style.borderBottomWidth),
        epaisseur: parseFloat(style.borderTopWidth),
      };
    });
    noter(
      `À ${largeur} px, la barre passe 12 px sous la ligne d’état (ou le champ), sur sa largeur, en dégradé violet (fond et bordure) ; la ligne d’état touche le champ`,
      Boolean(
        mesure &&
          Math.abs(mesure.barre.b - mesure.suivant - 12) <= 1 && mesure.recouvert &&
          (!mesure.temoin || Math.abs(mesure.temoin.b - mesure.champ.y - 12) <= 1) &&
          Math.abs(mesure.barre.x - mesure.champ.x) <= 1 && mesure.barre.d >= mesure.champ.d - 1 &&
          !/250, 204, 21|234, 179, 8/.test(mesure.fond) && mesure.texte !== 'rgb(0, 0, 0)' &&
          mesure.fondDeBordure.startsWith(`linear-gradient(${mesure.teinte}, `) &&
          /, (?:rgba\(0, 0, 0, 0\)|transparent) \d+px\)$/.test(mesure.fondDeBordure) &&
          mesure.boites === 'padding-box, border-box' && mesure.epaisseur === 1 && mesure.bordureBas === 0 &&
          mesure.barre.h - 12 === (largeur < 640 ? 36 : 32),
      ),
      JSON.stringify(mesure),
    );
    await page.screenshot({ path: path.join(CAPTURES, `file-${largeur}.png`) });

    /* 2 bis. LES DEUX CLARTÉS (29/10/2026, capture #42b7) : en sombre, le
       dégradé violet (fond et bordure) ; en clair, un fond PLEIN gris, ni
       dégradé ni bordure colorée, l'icône et le libellé en violet. */
    for (const sombre of [true, false]) {
      const clarte = await page.evaluate((sombre) => {
        document.documentElement.classList.toggle('dark', sombre);
        const composer = [...document.querySelectorAll('[data-composer]')].find((el) => el.getBoundingClientRect().height > 0);
        const barreFile = composer?.querySelector('[data-file-attente-barre]');
        if (!barreFile) return null;
        const sonde = document.createElement('span');
        sonde.style.color = 'hsl(var(--teinte))';
        document.body.append(sonde);
        const teinte = getComputedStyle(sonde).color;
        sonde.remove();
        const style = getComputedStyle(barreFile);
        const encres = [...barreFile.querySelectorAll('.encre-du-decroche')].map((el) => getComputedStyle(el).color);
        return {
          teinte,
          image: style.backgroundImage,
          fond: style.backgroundColor,
          bordureHaut: style.borderTopColor,
          encres,
        };
      }, sombre);
      noter(
        sombre
          ? `À ${largeur} px, en sombre, la barre garde son dégradé violet (fond et bordure)`
          : `À ${largeur} px, en clair, la barre est un fond gris plein, sans dégradé ni bordure, icône et libellé en violet`,
        Boolean(
          clarte &&
            (sombre
              ? clarte.image.includes(`linear-gradient(${clarte.teinte}, `)
              : clarte.image === 'none' &&
                /^rgba?\(\d+, \d+, \d+\)$/.test(clarte.fond) &&
                /rgba\(0, 0, 0, 0\)|transparent/.test(clarte.bordureHaut) &&
                clarte.encres.length === 2 &&
                clarte.encres.every((c) => c === clarte.teinte)),
        ),
        JSON.stringify(clarte),
      );
      await page.screenshot({ path: path.join(CAPTURES, `file-${largeur}-${sombre ? 'sombre' : 'clair'}.png`) });
    }

    /* 3. LE TIROIR, PUIS LE CRAYON. */
    await pastille.click();
    const tiroir = page.locator('[data-file-attente-tiroir]');
    const ouvert = await tiroir.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    const elements = ouvert ? await tiroir.locator('[data-file-attente-element]').count() : 0;
    const texteTiroir = ouvert ? await tiroir.innerText() : '';
    await page.waitForTimeout(500);
    noter(`À ${largeur} px, le tiroir liste les deux messages`, ouvert && elements === 2 && MESSAGES.every((m) => texteTiroir.includes(m)), `${elements} élément(s)`);
    await page.screenshot({ path: path.join(CAPTURES, `tiroir-${largeur}.png`) });
    if (ouvert) {
      await tiroir.locator('[data-file-attente-modifier]').first().click();
      const ferme = await tiroir.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
      await page.waitForTimeout(500);
      const champ = await barre.locator('textarea').first().inputValue();
      noter(`À ${largeur} px, le crayon referme le tiroir et remonte le message dans le champ`, ferme && champ.includes(MESSAGES[0]), champ.slice(0, 80));
    }
    await page.context().close();
  }
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
} catch (err) {
  noter('le contrôle est allé au bout', false, String(err).split('\n')[0]);
} finally {
  await navigateur.close();
}

const rates = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - rates}/${resultats.length} au vert${process.env.BELUGA_CAPTURES ? ` — captures dans ${CAPTURES}` : ''}`);
process.exit(rates ? 1 : 0);
