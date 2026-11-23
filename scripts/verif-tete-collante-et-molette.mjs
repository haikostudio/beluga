/*
 * TÊTE COLLANTE, MOLETTE SUR LE CONTENU ET OMBRES BORNÉES AU CONTENU (17/11/2026, capture #def0f).
 * Sur Sécurité, un autre service (Surveillance), « Tableaux de bord » et l'accueil d'un projet, à 1440 et 2000 px, en
 * clair et en sombre :
 *   1. la molette posée AU CENTRE de la liste fait défiler la page (zone de page scrollTop > 0) ;
 *   2. après défilement, la tête (`[data-tete-collante]`) reste en haut, réduite (`data-tete-reduite`, titre ≤ 20 px),
 *      la liste n'a pas sauté ; revenue en haut, elle reprend son titre de 30 px ;
 *   3. chaque voile allumé et l'ombre de la tête tiennent DANS le contenu (±1 px) ;
 *   4. à 390 px, rien n'est collé (la feuille du téléphone garde sa tête).
 * Vise le serveur de développement (HAIKO_TETE_URL, défaut http://localhost:7099), jamais BELUGA_URL. Session d'une heure
 * fabriquée puis retirée (jeton HACHÉ). N'écrit rien : prefs.set et card.* ne sont pas relayés au démon. La liste est
 * allongée en CLONANT des lignes dans le DOM (rien en base).
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-tete-collante-et-molette.mjs [dossier-des-captures]
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.HAIKO_TETE_URL || 'http://localhost:7099';
const SORTIE = process.argv[2] || '/tmp/essai-tete-collante';
const BASE = process.env.HAIKO_BASE || '/root/beluga/data/beluga.db';
mkdirSync(SORTIE, { recursive: true });

const cookie = randomBytes(24).toString('hex');
const jeton = createHash('sha256').update(cookie).digest('hex');
const db = new Database(BASE);
const projet = process.env.HAIKO_TETE_PROJET || db.prepare(`SELECT id FROM projects WHERE name = 'Beluga'`).get()?.id;
const colonnes = db.prepare(`PRAGMA table_info(sessions)`).all().map((c) => c.name);
const valeurs = { token: jeton, created_at: Date.now(), expires_at: Date.now() + 3600_000, label: 'essai-tete-collante', user_id: 'admin-premier' };
const cles = Object.keys(valeurs).filter((c) => colonnes.includes(c));
db.prepare(`INSERT INTO sessions (${cles.join(',')}) VALUES (${cles.map(() => '?').join(',')})`).run(...cles.map((c) => valeurs[c]));

const BLOQUES = /^(prefs\.set|card\.(read|update|create|move|delete|lancer)|deploy\.start|procedure\.tour|agent\.)/;
const resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai: !!vrai });
  console.log(`${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* Les pages à éprouver : leur adresse, la zone de page qui défile, la liste sur laquelle poser la souris. */
const PAGES_TOUTES = [
  { nom: 'securite', adresse: '#securite', zone: '[data-defilement-de-la-page-de-service]', liste: '[data-securite-tableau]' },
  { nom: 'surveillance', adresse: '#surveillance', zone: '[data-defilement-de-la-page-de-service]', liste: '[data-corps-de-la-page-de-service]' },
  { nom: 'tableaux-de-bord', adresse: '#en-route', zone: null, liste: '[data-colonne-des-tableaux-de-bord]' },
  { nom: 'accueil-du-projet', adresse: '', zone: '[data-fil="tableau-de-bord"]', liste: '[data-colonne-de-l-accueil]' },
];

const PAGES = process.env.HAIKO_TETE_PAGES ? PAGES_TOUTES.filter((p) => process.env.HAIKO_TETE_PAGES.split(',').includes(p.nom)) : PAGES_TOUTES;
const LARGEURS = process.env.HAIKO_TETE_LARGEURS ? process.env.HAIKO_TETE_LARGEURS.split(',').map(Number) : [1440, 2000, 390];

/** Allonge la liste en clonant les enfants du conteneur le plus peuplé, jusqu'à trois hauteurs d'écran. */
async function allonger(page, sel) {
  return page.evaluate((sel) => {
    const racine = document.querySelector(sel);
    if (!racine) return 0;
    // Le conteneur de LIGNES : des enfants empilés à la verticale (jamais la rangée de cellules d'un en-tête).
    const empile = (el) => el.children.length >= 2 && el.children[1].getBoundingClientRect().top > el.children[0].getBoundingClientRect().top + 4;
    let meilleur = racine.querySelector('tbody');
    for (const el of meilleur ? [] : [racine, ...racine.querySelectorAll('*')]) {
      if (el.getBoundingClientRect().height <= 0 || el.closest('[data-tete-collante]') || !empile(el)) continue;
      if (!meilleur || el.children.length > meilleur.children.length) meilleur = el;
    }
    if (!meilleur || !meilleur.children.length) return 0;
    const modeles = [...meilleur.children];
    let n = 0;
    while (document.documentElement.clientHeight * 3 > racine.getBoundingClientRect().height && n < 400) {
      for (const m of modeles) meilleur.appendChild(m.cloneNode(true));
      n += modeles.length;
    }
    return n;
  }, sel);
}

/** La zone de page qui défile : celle donnée, ou l'ancêtre défilant de la tête. */
const trouverZone = (sel) => `(() => {
  ${sel ? `const donnee = document.querySelector('${sel}'); if (donnee) return donnee;` : ''}
  let z = (document.querySelector('[data-page-de-service]') ?? document).querySelector('[data-tete-collante]')?.parentElement;
  while (z && !/(auto|scroll)/.test(getComputedStyle(z).overflowY)) z = z.parentElement;
  return z;
})()`;

async function mesurerTete(page, p) {
  return page.evaluate((code) => {
    const zone = eval(code);
    // La page de service passe PAR-DESSUS l'accueil du projet, qui reste monté dessous : on lit la tête de la page visible.
    const tetes = [...(document.querySelector('[data-page-de-service]') ?? document).querySelectorAll('[data-tete-collante]')].filter((t) => t.getBoundingClientRect().height > 0);
    const tete = tetes[0];
    const h1 = tete?.querySelector('[data-titre-collant]');
    const ombre = tete?.querySelector('[data-ombre-de-tete]');
    return {
      zoneTop: zone ? Math.round(zone.getBoundingClientRect().top) : null,
      scrollTop: zone ? Math.round(zone.scrollTop) : null,
      teteTop: tete ? Math.round(tete.getBoundingClientRect().top) : null,
      reduite: tete ? tete.hasAttribute('data-tete-reduite') : false,
      police: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
      position: tete ? getComputedStyle(tete).position : null,
      ombre: ombre ? parseFloat(getComputedStyle(ombre).opacity) : null,
    };
  }, trouverZone(p.zone));
}

/** Le bord gauche/droit du contenu réel : les lignes visibles de la liste. */
async function bordsEtVoiles(page, p) {
  return page.evaluate(({ code, liste }) => {
    const zone = eval(code);
    const racine = document.querySelector(liste);
    // Le contenu : la boîte de contenu de la colonne qui porte la liste (padding exclu).
    let colonne = racine;
    while (colonne && colonne.parentElement && colonne.parentElement !== zone && getComputedStyle(colonne).paddingLeft === '0px') colonne = colonne.parentElement;
    const c = colonne.getBoundingClientRect();
    const s = getComputedStyle(colonne);
    const gauche = c.left + parseFloat(s.paddingLeft);
    const droite = c.right - parseFloat(s.paddingRight);
    const racinePage = zone.closest('[data-page-de-service]') ?? zone.closest('[data-zone="centre"]') ?? zone.parentElement;
    const voiles = [...racinePage.querySelectorAll('[data-voile-defilement^="vertical"][data-voile-allume="oui"], [data-tete-reduite] [data-ombre-de-tete]')]
      .filter((v) => v.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(v).opacity) > 0.5)
      .map((v) => {
        const r = v.getBoundingClientRect();
        return { nom: v.getAttribute('data-voile-defilement') ?? 'ombre-de-tete', g: Math.round(r.left), d: Math.round(r.right) };
      });
    return { gauche: Math.round(gauche), droite: Math.round(droite), voiles };
  }, { code: trouverZone(p.zone), liste: p.liste });
}

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const largeur of LARGEURS) {
    for (const sombre of [false, true]) {
      const telephone = largeur === 390;
      const contexte = await navigateur.newContext({
        viewport: { width: telephone ? 1440 : largeur, height: telephone ? 844 : 900 },
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
            if (BLOQUES.test(JSON.parse(String(m))?.cmd?.type ?? '')) return;
          } catch {}
          serveur.send(m);
        });
        serveur.onMessage((m) => ws.send(m));
      });
      for (const p of PAGES) {
        const suffixe = `${largeur}-${sombre ? 'sombre' : 'clair'}-${p.nom}`;
        await page.goto('about:blank');
        await page.goto(`${URL}/#projet/${projet}`);
        await page.waitForSelector('[data-tete-de-colonne], [data-haut-du-telephone]', { timeout: 30000, state: 'attached' });
        if (p.adresse) await page.evaluate((a) => (location.hash = a), p.adresse);
        await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
        const ouverte = await page.waitForSelector(`${p.liste}`, { timeout: 20000 }).then(() => true, () => false);
        if (!ouverte) {
          ok(`${suffixe} page ouverte`, false, p.liste);
          continue;
        }
        await page.waitForTimeout(2500);
        if (telephone) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(1200);
          const collee = await page.evaluate(() =>
            [...document.querySelectorAll('[data-tete-collante]')].some((t) => t.getBoundingClientRect().height > 0 && getComputedStyle(t).position === 'sticky'),
          );
          ok(`${suffixe} rien n'est collé au téléphone`, !collee);
          ok(`${suffixe} rien ne déborde en largeur`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
          await page.screenshot({ path: path.join(SORTIE, `${suffixe}.png`) });
          await page.setViewportSize({ width: 1440, height: 844 });
          continue;
        }
        const clones = await allonger(page, p.liste);
        await page.waitForTimeout(600);
        const avant = await mesurerTete(page, p);
        ok(`${suffixe} tête collante en place, titre à 30 px au repos`, avant.position === 'sticky' && avant.police === 30 && !avant.reduite && avant.ombre === 0, JSON.stringify({ ...avant, clones }));
        // 1. La molette au CENTRE de la liste.
        const cadre = await page.evaluate((sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return { x: r.left + r.width / 2, y: Math.min(innerHeight - 120, r.top + Math.max(60, r.height / 3)) };
        }, p.liste);
        await page.mouse.move(cadre.x, cadre.y);
        const ligneAvant = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getBoundingClientRect().top ?? null, cadre);
        for (let i = 0; i < 4; i++) {
          await page.mouse.wheel(0, 150);
          await page.waitForTimeout(120);
        }
        await page.waitForTimeout(700);
        const apres = await mesurerTete(page, p);
        const sous = apres.scrollTop > 0 ? '' : await page.evaluate(({ x, y }) => {
          const out = [];
          for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) {
            const st = getComputedStyle(e);
            if (st.overflowY !== 'visible') out.push(`${e.tagName} oy=${st.overflowY} ob=${st.overscrollBehaviorY} ch=${e.clientHeight} sh=${e.scrollHeight} st=${e.scrollTop}`);
          }
          return out.join(' < ');
        }, cadre);
        ok(`${suffixe} la molette sur la liste fait défiler la page`, apres.scrollTop > 0, `scrollTop ${apres.scrollTop} ${sous}`);
        // 2. La tête reste en haut, réduite.
        ok(
          `${suffixe} la tête reste collée en haut, réduite, titre ≤ 20 px, ombre allumée`,
          apres.reduite && apres.police <= 20 && Math.abs(apres.teteTop - apres.zoneTop) <= 1 && apres.ombre === 1,
          JSON.stringify(apres),
        );
        // La liste n'a pas sauté : un pixel défilé = un pixel monté (réduction compensée).
        const decalage = await page.evaluate(
          ({ code }) => {
            const zone = eval(code);
            const avantTop = zone.scrollTop;
            zone.scrollTop = 0;
            return avantTop;
          },
          { code: trouverZone(p.zone) },
        );
        await page.waitForTimeout(500);
        const enHaut = await mesurerTete(page, p);
        ok(`${suffixe} revenue en haut, la tête reprend son titre de 30 px`, !enHaut.reduite && enHaut.police === 30 && enHaut.ombre === 0, JSON.stringify(enHaut));
        const ligneRetour = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getBoundingClientRect().top ?? null, cadre);
        ok(`${suffixe} aucune ligne n'a sauté au seuil`, ligneAvant === null || ligneRetour === null || Math.abs(ligneAvant - ligneRetour) <= 1, `${ligneAvant} → ${ligneRetour} (défilé ${decalage})`);
        // 3. Les ombres dans le contenu.
        await page.evaluate(({ code }) => (eval(code).scrollTop = 300), { code: trouverZone(p.zone) });
        await page.waitForTimeout(700);
        const b = await bordsEtVoiles(page, p);
        const hors = b.voiles.filter((v) => v.g < b.gauche - 1 || v.d > b.droite + 1);
        ok(`${suffixe} ombres et voiles tiennent dans le contenu`, b.voiles.length > 0 && !hors.length, JSON.stringify(b));
        await page.screenshot({ path: path.join(SORTIE, `${suffixe}.png`) });
        // Le voile du haut de la zone ne floute pas la tête collée.
        const voileSurTete = await page.evaluate(({ code }) => {
          const zone = eval(code);
          const env = zone.parentElement;
          return [...env.children].some((v) => v.getAttribute?.('data-voile-defilement') === 'vertical-debut' && v.getAttribute('data-voile-allume') === 'oui');
        }, { code: trouverZone(p.zone) });
        ok(`${suffixe} le voile du haut de la page est éteint sous la tête collée`, !voileSurTete);
      }
      ok(`${largeur}-${sombre ? 'sombre' : 'clair'} aucune erreur de page`, !erreurs.length, erreurs.join(' | ').slice(0, 300));
      await contexte.close();
    }
  }
} finally {
  await navigateur.close();
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(jeton);
  db.close();
}
const echecs = resultats.filter((r) => !r.vrai);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis — captures dans ${SORTIE}`);
process.exit(echecs.length ? 1 : 0);
