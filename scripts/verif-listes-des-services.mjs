/*
 * ESSAI DES LISTES DES SERVICES EN TABLEAU (carte « Onglets, services et listes repensés », 14/11/2026, décision de
 * l'utilisateur : « tableau seul, sans bascule » partout, la bascule tableau / cartes SEULEMENT pour Communication,
 * Studio et Charte graphique ; un aperçu au survol partout). Pour chaque service ouvert depuis « Voir plus » de la
 * colonne : un tableau est rendu, la bascule n'existe que là où elle doit, le survol d'une ligne (souris) montre
 * l'aperçu dans l'écran, et la vue « cartes » remplace bien le tableau. Au téléphone (390 px), la même adresse ne
 * déborde pas et ne montre jamais d'aperçu.
 *
 * Vise le serveur de développement (HAIKO_LISTES_URL, défaut http://localhost:7099), jamais BELUGA_URL. Session d'une
 * heure fabriquée puis retirée (jeton haché). N'écrit rien : prefs.set, card.* et créations ne sont pas relayés.
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-listes-des-services.mjs [dossier-des-captures]
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.HAIKO_LISTES_URL || 'http://localhost:7099';
const SORTIE = process.argv[2] || '/tmp/essai-listes-des-services';
const BASE = process.env.HAIKO_BASE || '/root/beluga/data/beluga.db';
mkdirSync(SORTIE, { recursive: true });

const SERVICES = ['communication2', 'studio', 'plaquettes', 'marketing2', 'statistiques', 'espace-client', 'backups', 'surveillance', 'taches-recurrentes'];
/* LA BASCULE LIGNES / CARTES EST DANS TOUS LES SERVICES (carte « Services homogènes et centrés », 14/11/2026) : la règle
   qui la réservait à Communication, Studio et Charte est remplacée. */
const AVEC_BASCULE = new Set(SERVICES);

const cookie = randomBytes(24).toString('hex');
const jeton = createHash('sha256').update(cookie).digest('hex');
const db = new Database(BASE);
const colonnes = db.prepare(`PRAGMA table_info(sessions)`).all().map((c) => c.name);
const valeurs = { token: jeton, created_at: Date.now(), expires_at: Date.now() + 3600_000, label: 'essai-listes-des-services', user_id: 'admin-premier' };
const cles = Object.keys(valeurs).filter((c) => colonnes.includes(c) && valeurs[c] !== undefined);
db.prepare(`INSERT INTO sessions (${cles.join(',')}) VALUES (${cles.map(() => '?').join(',')})`).run(...cles.map((c) => valeurs[c]));

const BLOQUES = /^(prefs\.set|card\.(read|update|create|move|delete|lancer)|communication\.marque\.creer|deploy\.start|procedure\.tour|agent\.)/;
const resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai: !!vrai, detail });
  console.log(`${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const info = (texte) => console.log(`· ${texte}`);

async function ouvrirLeContexte(navigateur, taille, sombre) {
  const contexte = await navigateur.newContext({
    viewport: { width: taille.width, height: taille.height },
    isMobile: !!taille.mobile,
    hasTouch: !!taille.mobile,
    colorScheme: sombre ? 'dark' : 'light',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: URL }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((m) => {
      try {
        const obj = JSON.parse(String(m));
        if (BLOQUES.test(obj?.cmd?.type ?? '')) return;
      } catch {}
      serveur.send(m);
    });
    serveur.onMessage((m) => ws.send(m));
  });
  return { contexte, page, erreurs };
}

/** Attend le tableau de la page (ou un état vide) ; rend le nombre de lignes visibles, ou null sans tableau. */
async function attendreLaListe(page) {
  for (let i = 0; i < 40; i++) {
    const etat = await page.evaluate(() => {
      const racine = document.querySelector('[data-page-de-service]') ?? document;
      const lignes = [...racine.querySelectorAll('[data-ligne-de-tableau]')].filter((e) => e.getBoundingClientRect().height > 0);
      const silhouette = racine.querySelector('[data-silhouette]');
      const tableau = racine.querySelector('[data-tableau]');
      return { lignes: lignes.length, silhouette: !!silhouette, tableau: !!tableau };
    });
    if (etat.lignes > 0) return etat.lignes;
    if (etat.tableau && !etat.silhouette && i > 6) return 0;
    await page.waitForTimeout(500);
  }
  return null;
}

/* AU TÉLÉPHONE, chaque service par son adresse (les outils de création n'en changent pas sur l'ordinateur). */
const ADRESSES_TELEPHONE = { communication2: 'communication2', studio: 'studio', plaquettes: 'plaquettes', marketing2: 'marketing2', statistiques: 'statistiques', 'espace-client': 'espace', backups: 'backups', surveillance: 'surveillance', 'taches-recurrentes': 'taches-recurrentes' };
const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const sombre of [false, true]) {
    const suffixe = `1440-${sombre ? 'sombre' : 'clair'}`;
    const { contexte, page, erreurs } = await ouvrirLeContexte(navigateur, { width: 1440, height: 900 }, sombre);
    await page.goto(URL + '/#en-route');
    await page.waitForSelector('[data-tete-de-colonne]', { timeout: 30000, state: 'attached' });
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
    await page.waitForTimeout(1500);
    for (const service of SERVICES) {
      /* Un service épinglé s'ouvre d'un clic ; les autres par la ligne « Services » du bas de la colonne. */
      const enBas = page.locator(`[data-services-du-bas] [data-service-du-bas="${service}"]`).first();
      if (await enBas.count()) {
        await enBas.click();
      } else {
        await page.locator('[data-bouton-services]').first().click();
        await page.waitForSelector('[data-menu-des-services]', { timeout: 5000 });
        const entree = page.locator(`[data-menu-des-services] [data-service-de-la-colonne="${service}"]`).first();
        if (!(await entree.count())) {
          info(`${suffixe} ${service} : absent du menu (ce compte ne l'a pas)`);
          await page.keyboard.press('Escape');
          continue;
        }
        await entree.click();
      }
      await page.waitForSelector('[data-page-de-service]', { timeout: 10000 }).catch(() => {});
      const lignes = await attendreLaListe(page);
      if (lignes === null) {
        info(`${suffixe} ${service} : pas de liste à l'écran (état vide ou choix préalable)`);
        await page.screenshot({ path: path.join(SORTIE, `${service}-${suffixe}.png`) });
        continue;
      }
      ok(`${suffixe} ${service} : un tableau`, true, `${lignes} ligne(s)`);
      const bascule = await page.$('[data-bascule-tableau-cartes]');
      ok(`${suffixe} ${service} : bascule ${AVEC_BASCULE.has(service) ? 'présente' : 'absente'}`, AVEC_BASCULE.has(service) ? !!bascule : !bascule);
      if (lignes > 0) {
        const boite = await page.locator('[data-page-de-service] [data-ligne-de-tableau]:visible').first().boundingBox();
        await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
        await page.mouse.move(boite.x + boite.width / 2 + 4, boite.y + boite.height / 2);
        await page.waitForTimeout(700);
        const apercu = await page.evaluate(() => {
          const a = document.querySelector('[data-apercu-au-survol]');
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return { dedans: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, pe: getComputedStyle(a).pointerEvents, h: Math.round(r.height) };
        });
        ok(`${suffixe} ${service} : aperçu au survol dans l'écran, sans capter le clic`, apercu && apercu.dedans && apercu.pe === 'none', JSON.stringify(apercu));
        await page.screenshot({ path: path.join(SORTIE, `${service}-survol-${suffixe}.png`) });
        await page.mouse.move(5, 450);
        await page.waitForTimeout(200);
        ok(`${suffixe} ${service} : l'aperçu part avec la souris`, !(await page.$('[data-apercu-au-survol]')));
      }
      /* LA COLONNE PROJET, PARTOUT (14/11/2026) : la cellule commune (pastille et nom), ou l'en-tête « Projet » d'un
         tableau maison (Statistiques), ou l'intitulé de projet d'un groupe (Messagerie). */
      const projet = await page.evaluate(() => {
        const racine = document.querySelector('[data-page-de-service]');
        if (!racine) return false;
        if (racine.querySelector('[data-cellule-projet], [data-intitule-de-projet]')) return true;
        return [...racine.querySelectorAll('th')].some((th) => th.textContent?.trim().startsWith('Projet'));
      });
      ok(`${suffixe} ${service} : le projet de chaque ligne se lit`, projet);
      if (bascule && lignes > 0) {
        await page.click('[data-bascule-tableau-cartes] [data-onglet="cartes"]');
        await page.waitForTimeout(800);
        const cartes = await page.evaluate(() => !document.querySelector('[data-page-de-service] table [data-ligne-de-tableau]'));
        ok(`${suffixe} ${service} : la vue cartes remplace le tableau`, cartes);
        /* DES CARTES DE MÊME FORME ET MÊME TAILLE dans une grille (Studio garde ses affiches, toutes de même format). */
        const hauteurs = await page.evaluate(() => {
          const grille = document.querySelector('[data-page-de-service] [data-tableau-cartes], [data-page-de-service] [data-studio-liste]');
          return grille ? [...grille.children].map((c) => Math.round(c.getBoundingClientRect().height)).filter((h) => h > 0) : [];
        });
        ok(`${suffixe} ${service} : cartes de même hauteur`, hauteurs.length > 0 && Math.max(...hauteurs) - Math.min(...hauteurs) <= 1, hauteurs.slice(0, 6).join(','));
        await page.screenshot({ path: path.join(SORTIE, `${service}-cartes-${suffixe}.png`) });
        await page.click('[data-bascule-tableau-cartes] [data-onglet="tableau"]');
        await page.waitForTimeout(500);
      }
    }
    ok(`${suffixe} aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }
  for (const sombre of [false, true]) {
    const suffixe = `390-${sombre ? 'sombre' : 'clair'}`;
    const { contexte, page, erreurs } = await ouvrirLeContexte(navigateur, { width: 390, height: 844, mobile: true }, sombre);
    for (const service of SERVICES) {
      // Un chargement neuf par service : changer seulement le fragment garderait l'écran d'avant.
      await page.goto('about:blank');
      await page.goto(`${URL}/#${ADRESSES_TELEPHONE[service]}`);
      await page.waitForSelector('[data-haut-du-telephone], [data-tete-de-colonne]', { timeout: 30000, state: 'attached' });
      await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
      const lignes = await attendreLaListe(page);
      const titre = await page.evaluate(() => document.querySelector('[data-haut-du-telephone]')?.textContent?.trim().slice(0, 40) ?? '');
      info(`${suffixe} ${service} : « ${titre} », ${lignes === null ? 'pas de liste' : `${lignes} ligne(s)`}`);
      const deborde = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(`${suffixe} ${service} : rien ne déborde`, deborde <= 0, String(deborde));
      if (lignes) {
        await page.locator('[data-ligne-de-tableau]:visible').first().hover({ force: true }).catch(() => {});
        await page.waitForTimeout(600);
        ok(`${suffixe} ${service} : pas d'aperçu au doigt`, !(await page.$('[data-apercu-au-survol]')));
      }
      await page.screenshot({ path: path.join(SORTIE, `${service}-${suffixe}.png`) });
    }
    ok(`${suffixe} aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
}
const echecs = resultats.filter((r) => !r.vrai);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles`);
process.exit(echecs.length ? 1 : 0);
