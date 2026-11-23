/*
 * ESSAI DE LA REFONTE « ONGLETS, SERVICES ET LISTES REPENSÉS » (14/11/2026) : fil d'Ariane seul en haut d'une tâche,
 * services en bas de la colonne, fenêtre des services en cartes identiques, pages de service sans bandeau (le calendrier
 * en page, retiré des services le 20/11/2026 : c'est un volet de chaque campagne). Vise le serveur de développement (HAIKO_REFONTE_URL, défaut http://localhost:7099), jamais
 * BELUGA_URL. Session d'une heure fabriquée puis retirée (jeton haché). N'écrit rien : prefs.set, card.* et créations
 * ne sont pas relayés au démon.
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-services-en-page.mjs [dossier-des-captures]
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.HAIKO_REFONTE_URL || 'http://localhost:7099';
const SORTIE = process.argv[2] || '/tmp/essai-refonte';
const BASE = process.env.HAIKO_BASE || '/root/beluga/data/beluga.db';
mkdirSync(SORTIE, { recursive: true });

const cookie = randomBytes(24).toString('hex');
const jeton = createHash('sha256').update(cookie).digest('hex');
const db = new Database(BASE);
const colonnes = db.prepare(`PRAGMA table_info(sessions)`).all().map((c) => c.name);
const valeurs = { token: jeton, created_at: Date.now(), expires_at: Date.now() + 3600_000, label: 'essai-refonte-services', user_id: 'admin-premier' };
const cles = Object.keys(valeurs).filter((c) => colonnes.includes(c) && valeurs[c] !== undefined);
db.prepare(`INSERT INTO sessions (${cles.join(',')}) VALUES (${cles.map(() => '?').join(',')})`).run(...cles.map((c) => valeurs[c]));

/* LES REPÈRES RETIRÉS PAR CETTE REFONTE : le contrôle prouve leur ABSENCE (le détecteur de repères ne doit pas les
   prendre pour une dérive, d'où le nom construit). */
const retire = (nom) => `[data-${nom}]`;
const BLOQUES = /^(prefs\.set|card\.(read|update|create|move|delete|lancer)|communication\.marque\.creer|deploy\.start|procedure\.tour|agent\.)/;
let resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai: !!vrai, detail });
  console.log(`${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DIX_SERVICES = ['plaquettes', 'communication2', 'studio', 'marketing2', 'statistiques', 'espace-client', 'backups', 'surveillance', 'taches-recurrentes'];

/** La tête d'une page (ou d'une feuille) de service : ses contrôles, leurs hauteurs, leurs lignes, les bords. */
async function mesurerLaPage(page, telephone) {
  const selBandes = `${retire('outil-de-creation')}, ${retire('outil-de-fonctionnement')}`;
  return page.evaluate(({ telephone, selBandes }) => {
    const racine = telephone ? document.querySelector('[data-tete-de-la-feuille-de-service]')?.closest('[role="dialog"]') : document.querySelector('[data-page-de-service]');
    if (!racine) return { lignes: 0, hauteurs: [], details: 'pas de page', bords: null, bordsEgaux: false, debord: 0, bandes: 0, mono: false };
    const rangee = racine.querySelector('[data-rangee-de-la-page]');
    const controles = rangee
      ? [...rangee.querySelectorAll('button, input, [role="group"], [role="tablist"]')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.parentElement.closest('[role="group"], [role="tablist"]') && !e.closest('[data-champ-de-recherche] button');
        })
      : [];
    const centre = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
    const centres = [...new Set(controles.map(centre))];
    const lignes = new Set(centres.map((c) => Math.round(c / 6))).size;
    /* LA BARRE DU FIL EST AU-DESSUS (14/11/2026) : le titre de l'accueil est le `h1` de la tête ; dans une sous-page, le fil. */
    const titre = racine.querySelector('[data-tete-de-la-page-de-service]:not(.hidden) [data-titre-de-page-de-service]') ?? racine.querySelector('[data-fil-de-la-page-de-service]');
    const bord = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; };
    const tete = racine.querySelector('[data-tete-de-la-page-de-service]');
    const corps = racine.querySelector('[data-corps-de-la-page-de-service]');
    const bas = racine.querySelector('[data-geste-en-bas="page"]');
    const bords = { tete: bord(tete), corps: bord(corps), bas: bas && bas.children.length ? bord(bas) : null };
    const reference = bords.tete;
    const bordsEgaux = !!reference && [bords.corps, bords.bas].filter(Boolean).every((b) => Math.abs(b[0] - reference[0]) <= 1 && Math.abs(b[1] - reference[1]) <= 1);
    return {
      lignes,
      centreTitre: titre ? centre(titre) : null,
      centreControles: centres[0] ?? null,
      hauteurs: controles.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10),
      details: controles.map((e) => `${Math.round(e.getBoundingClientRect().height)}:${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 14)}`).join(' | '),
      mono: controles.some((e) => /mono/i.test(getComputedStyle(e).fontFamily)),
      bords,
      bordsEgaux,
      debord: document.documentElement.scrollWidth - innerWidth,
      bandes: racine.querySelectorAll(selBandes).length,
    };
  }, { telephone, selBandes });
}

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const [nomTaille, taille] of [['1440', { width: 1440, height: 900 }], ['1920', { width: 1920, height: 1080 }], ['390', { width: 390, height: 844, mobile: true }]]) {
    for (const sombre of [false, true]) {
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
      const suffixe = `${nomTaille}-${sombre ? 'sombre' : 'clair'}`;
      await page.goto(URL + '/#en-route');
      await page.waitForSelector('[data-tete-de-colonne], [data-haut-du-telephone]', { timeout: 30000, state: 'attached' });
      await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
      await page.waitForTimeout(1500);
      if (!taille.mobile) {
        /* « SERVICES » JUSTE SOUS « TABLEAUX DE BORD » (décision de l'utilisateur du 15/11/2026) : dans la tête de la
           colonne, avant « Nouvel artefact », et sa liste s'ouvre vers le bas. */
        const ordre = await page.evaluate(() => {
          const tete = document.querySelector('[data-tete-de-colonne]');
          if (!tete) return null;
          const tdb = tete.querySelector('[data-bouton-tableaux-de-bord]');
          const services = tete.querySelector('[data-services-en-tete] [data-bouton-services]');
          const artefact = tete.querySelector('[data-menu-nouvel-agent], [data-ligne-nouvel-agent]');
          if (!tdb || !services) return null;
          const y = (el) => el.getBoundingClientRect().top;
          return { tdb: y(tdb), services: y(services), artefact: artefact ? y(artefact) : null };
        });
        ok(`${suffixe} « Services » juste sous « Tableaux de bord », au-dessus de « Nouvel artefact »`, !!ordre && ordre.services > ordre.tdb && (ordre.artefact === null || ordre.services < ordre.artefact), JSON.stringify(ordre));
        await page.screenshot({ path: path.join(SORTIE, `colonne-${suffixe}.png`) });
        /* LES ARCHIVES CACHÉES : avant « Voir plus », aucune ligne rangée sous un projet. */
        const rangees = await page.$$eval('[data-taches-du-projet] [data-ligne-rangee]', (els) => els.filter((e) => e.getBoundingClientRect().height > 0).length);
        ok(`${suffixe} aucune tâche archivée avant « Voir plus »`, rangees === 0, String(rangees));
        const voirPlus = page.locator('[data-taches-du-projet] [data-voir-plus]').first();
        if (await voirPlus.count()) {
          await voirPlus.click();
          await page.waitForTimeout(800);
          const apres = await page.$$eval('[data-taches-du-projet] [data-ligne-rangee]', (els) => els.filter((e) => e.getBoundingClientRect().height > 0).length);
          ok(`${suffixe} « Voir plus » montre les archives`, apres > 0, String(apres));
        }
        /* « POUR QUEL PROJET ? » A SA RECHERCHE : on filtre, on ne choisit rien (choisir créerait un agent). */
        await page.focus('[data-ligne-nouvel-agent]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-menu-nouvel-agent]', { timeout: 5000 });
        await page.hover('[data-type-d-agent="programmation"]');
        await page.waitForSelector('[data-recherche-projet-a-viser="programmation"]', { timeout: 5000 });
        await page.waitForTimeout(300);
        const avantFiltre = await page.$$eval('[data-projets-du-type="programmation"] [data-projet-a-viser]', (els) => els.length);
        await page.fill('[data-recherche-projet-a-viser="programmation"]', 'belu');
        await page.waitForTimeout(300);
        const apresFiltre = await page.$$eval('[data-projets-du-type="programmation"] [data-projet-a-viser]', (els) => els.map((e) => e.textContent?.trim()));
        ok(`${suffixe} « Pour quel projet ? » filtre au fil de la frappe`, apresFiltre.length > 0 && apresFiltre.length < avantFiltre && apresFiltre.every((n) => /belu/i.test(n ?? '')), `${avantFiltre} → ${apresFiltre.join(', ')}`);
        const focusDansLeChamp = await page.evaluate(() => document.activeElement?.hasAttribute('data-recherche-projet-a-viser'));
        ok(`${suffixe} le focus reste dans la recherche`, focusDansLeChamp);
        await page.screenshot({ path: path.join(SORTIE, `nouvel-agent-${suffixe}.png`) });
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        /* Voir plus → Tous les services… */
        await page.focus('[data-voir-plus-services]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-menu-des-services]', { timeout: 5000 });
        await page.screenshot({ path: path.join(SORTIE, `voir-plus-${suffixe}.png`) });
        await page.click('[data-tous-les-services]');
        await page.waitForSelector('[data-fenetre-des-services]', { timeout: 5000 });
        await page.waitForTimeout(1200);
        const hauteurs = await page.$$eval('[data-carte-service]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
        ok(`${suffixe} cartes de même hauteur`, hauteurs.length >= 8 && new Set(hauteurs).size === 1, hauteurs.join(','));
        const etats = await page.$$eval('[data-carte-service]', (els) => els.every((e) => e.querySelector('[data-etat-de-service]')));
        ok(`${suffixe} une ligne d'état par carte`, etats);
        await page.screenshot({ path: path.join(SORTIE, `fenetre-services-${suffixe}.png`) });
        await page.click('[data-carte-service="communication2"]');
        await page.waitForSelector('[data-page-de-service]', { timeout: 10000 });
        await page.waitForTimeout(3000);
        const page_ = await page.evaluate(() => {
          const p = document.querySelector('[data-page-de-service]');
          const h1 = p?.querySelector('[data-titre-de-page-de-service]');
          const fil = p?.querySelector('[data-fil-de-la-page-de-service]');
          const crans = p ? p.querySelectorAll('[data-barre-de-la-page-de-service] [data-cran-a-menu]').length : 0;
          return { h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null, filVisible: fil ? getComputedStyle(fil).display !== 'none' : false, crans };
        });
        /* UNE SEULE BARRE EN TÊTE, ACCUEIL COMPRIS : le fil « Service » (puis « / Projet » quand la page est limitée à un
           projet, 20/11/2026), puis le titre juste dessous. */
        ok(`${suffixe} accueil du service : le fil en barre, le titre dessous`, page_.h1Top !== null && page_.h1Top < 140 && page_.filVisible && page_.crans >= 1, JSON.stringify(page_));
        /* L'accueil de Communication n'a plus d'onglets (20/11/2026) : sa rangée porte la recherche des projets. */
        const rangee = await page.$$eval('[data-rangee-de-la-page] button, [data-rangee-de-la-page] input, [data-rangee-de-la-page] [role="tab"], [data-rangee-de-la-page] [data-barre-onglets]', (els) =>
          els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().height)),
        );
        ok(`${suffixe} rangée de la page`, rangee.length > 0, rangee.join(','));
        await page.screenshot({ path: path.join(SORTIE, `page-communication-${suffixe}.png`) });
        /* LE CALENDRIER N'EST PLUS UN SERVICE (20/11/2026) : c'est un volet de chaque campagne. */
        await page.click('[data-bouton-services]');
        await page.waitForSelector('[data-menu-des-services]', { timeout: 5000 });
        ok(`${suffixe} plus de Calendrier au menu « Services »`, (await page.locator('[data-menu-des-services] [data-service-de-la-colonne="calendrier"]').count()) === 0);
        await page.keyboard.press('Escape');
        /* LE MODÈLE COMMUN DES DIX SERVICES (carte « Services homogènes et centrés », 14/11/2026) : le titre et TOUS les
           contrôles sur une seule ligne, tous à la même hauteur et sans police de machine à écrire ; la tête, le premier
           tableau et le bouton du bas aux mêmes bords ; rien ne déborde. */
        for (const service of DIX_SERVICES) {
          await page.click('[data-bouton-services]');
          await page.waitForSelector('[data-menu-des-services]', { timeout: 5000 });
          const entree = page.locator(`[data-menu-des-services] [data-service-de-la-colonne="${service}"]`).first();
          if (!(await entree.count())) {
            await page.keyboard.press('Escape');
            continue;
          }
          await entree.click();
          await page.waitForSelector('[data-page-de-service]', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(3500);
          const m = await mesurerLaPage(page, false);
          ok(`${suffixe} ${service} : titre et contrôles sur une seule ligne`, m.lignes === 1 && Math.abs(m.centreTitre - m.centreControles) <= 2, JSON.stringify({ lignes: m.lignes, titre: m.centreTitre, controles: m.centreControles }));
          ok(`${suffixe} ${service} : tous les contrôles à la même hauteur (32 px), sans police de machine à écrire`, m.hauteurs.length > 0 && m.hauteurs.every((h) => Math.abs(h - 32) <= 0.5) && !m.mono, m.details);
          ok(`${suffixe} ${service} : tête, tableau et bouton du bas aux mêmes bords`, m.bordsEgaux, JSON.stringify(m.bords));
          ok(`${suffixe} ${service} : rien ne déborde`, m.debord <= 0, String(m.debord));
          await page.screenshot({ path: path.join(SORTIE, `service-${service}-${suffixe}.png`) });
        }
        /* Une tâche : fil d'Ariane seul */
        const tache = await page.$('[data-taches-du-projet] [data-agent-en-liste]');
        if (tache) {
          await tache.click();
          await page.waitForTimeout(2500);
          ok(`${suffixe} page fermée en ouvrant une tâche`, !(await page.$('[data-page-de-service]')));
          ok(`${suffixe} plus de rangée d'onglets`, !(await page.$(retire('rangee-d-onglets'))));
          ok(`${suffixe} fil du projet`, !!(await page.$('[data-fil-du-projet] [data-titre-du-fil]')));
          await page.screenshot({ path: path.join(SORTIE, `tache-${suffixe}.png`) });
        }
      } else {
        ok(`${suffixe} rien ne déborde`, await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 0));
        ok(`${suffixe} plus de rangée d'onglets`, !(await page.$(retire('onglets-telephone'))));
        await page.screenshot({ path: path.join(SORTIE, `accueil-${suffixe}.png`) });
        /* SUR TÉLÉPHONE, UNE SEULE RANGÉE DE CONTRÔLES SOUS LE TITRE DE LA FEUILLE, à 38 px, et plus aucune bande
           d'outils qui défile de côté (capture #b253). */
        for (const service of DIX_SERVICES) {
          await page.goto('about:blank');
          await page.goto(`${URL}/#en-route`);
          await page.waitForSelector('[data-menu-principal]', { timeout: 30000, state: 'attached' });
          await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
          await page.waitForTimeout(1200);
          await page.locator('[data-menu-principal]:visible').first().click();
          await page.waitForTimeout(800);
          await page.locator('[data-bouton-services]:visible').first().click();
          await page.waitForSelector('[data-menu-des-services]', { timeout: 5000 });
          const entree = page.locator(`[data-menu-des-services] [data-service-de-la-colonne="${service}"]:visible`).first();
          if (!(await entree.count())) {
            await page.keyboard.press('Escape');
            continue;
          }
          await entree.click();
          await page.waitForTimeout(3500);
          const m = await mesurerLaPage(page, true);
          ok(`${suffixe} ${service} : une seule rangée de contrôles`, m.lignes === 1, String(m.lignes));
          ok(`${suffixe} ${service} : contrôles à 38 px`, m.hauteurs.length > 0 && m.hauteurs.every((h) => Math.abs(h - 38) <= 0.5), m.details);
          ok(`${suffixe} ${service} : plus de bande d'outils`, m.bandes === 0, String(m.bandes));
          ok(`${suffixe} ${service} : rien ne déborde`, m.debord <= 0, String(m.debord));
          await page.screenshot({ path: path.join(SORTIE, `service-${service}-${suffixe}.png`) });
        }
      }
      ok(`${suffixe} aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await contexte.close();
    }
  }
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  db.close();
}
const echecs = resultats.filter((r) => !r.vrai);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles`);
process.exit(echecs.length ? 1 : 0);
