#!/usr/bin/env node
/**
 * VOTRE MESSAGE SE LIT EN TEXTE DANS SA BULLE, EN CLAIR COMME EN SOMBRE.
 *
 * Un long message collé (titres en #, listes, tableau, encadré) s'affichait
 * dans la bulle sombre d'une carte comme un RAPPORT : un sommaire, puis des
 * cadres blancs à icône « # », texte blanc sur fond blanc. Ce contrôle ouvre
 * une carte dont la demande porte des titres, et la conversation de
 * l'assistant d'un projet, puis juge des ÉTATS :
 *   - aucune `section` ni `nav` dans la bulle ;
 *   - au moins un titre nu (h1/h2/h3), plus grand que le corps du texte ;
 *   - chaque élément qui porte une couleur de fond (code, encadré) garde un
 *     texte lisible dessus, et le texte de la bulle se détache de la bulle
 *     (contraste ≥ 3), dans les DEUX clartés.
 *
 * Une session d'UNE HEURE est posée en base puis retirée ; rien d'autre n'est
 * écrit, aucun message n'est envoyé. Le serveur de DÉVELOPPEMENT est visé par
 * sa propre variable (`BELUGA_URL` désigne l'application déjà publiée) :
 *
 *   env -u BELUGA_TOKEN HAIKO_BULLE_URL=http://localhost:7099 node scripts/verif-bulle-demande.mjs
 *
 * `HAIKO_BULLE_CARTE=<projet>/<carte>` force la carte ; sinon on prend la plus
 * récente dont une demande porte une ligne de titre. `HAIKO_BULLE_CAPTURES=<dossier>`
 * garde une capture par clarté.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cheminDeLaBaseServie, depotPrincipal } from './base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_BULLE_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_BULLE_CAPTURES || '';
const PRINCIPAL = depotPrincipal();
const FICHIER_BASE = cheminDeLaBaseServie();

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function base(lecture = false) {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(FICHIER_BASE, lecture ? { readonly: true } : {});
}

/** Une carte dont une demande (jalon de cadrage ou demande de tâche) porte une ligne « # ». */
function carteAvecTitres() {
  if (process.env.HAIKO_BULLE_CARTE) {
    const [projectId, cardId] = process.env.HAIKO_BULLE_CARTE.split('/');
    return { projectId, cardId };
  }
  const db = base(true);
  const ligne = db
    .prepare(
      `SELECT c.project_id AS projectId, c.id AS cardId FROM card_journal j JOIN cards c ON c.id = j.card_id
       WHERE j.nature IN ('jalon', 'demande') AND j.resultat LIKE '#%' AND c.archived_at IS NULL
       ORDER BY j.at DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne ?? null;
}

function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification bulle de la demande',
  );
  db.close();
  return cookie;
}

function retirerSession(cookie) {
  const db = base();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(crypto.createHash('sha256').update(cookie).digest('hex'));
  db.close();
}

/** Pose une clarté à la main, comme le script de premier affichage. */
async function poserClarte(page, clarte) {
  await page.evaluate((valeur) => {
    const racine = document.documentElement;
    racine.dataset.theme = valeur;
    racine.classList.toggle('dark', valeur === 'sombre');
    racine.style.colorScheme = valeur === 'sombre' ? 'dark' : 'light';
  }, clarte);
}

/** Ce que montrent les bulles visées, mesuré dans la page. */
function mesurer(page, selecteur) {
  return page.evaluate((sel) => {
    const rgb = (texte) => {
      const m = texte.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contraste = (x, y) => {
      const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (a + 0.05) / (b + 0.05);
    };
    /** Le fond réellement visible sous un élément : on remonte jusqu'à un fond opaque. */
    const fondSous = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const f = rgb(getComputedStyle(n).backgroundColor);
        if (f && f.a > 0.5) return f;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const bulles = [...document.querySelectorAll(sel)];
    return bulles.map((bulle) => {
      const fond = fondSous(bulle);
      const textes = [...bulle.querySelectorAll('p, li, h1, h2, h3, td, th, code, [data-callout]')].filter(
        (n) => !n.closest('[data-contenu-pieces]') && n.textContent.trim(),
      );
      let pire = Infinity;
      let pireQuoi = '';
      for (const n of textes) {
        const c = rgb(getComputedStyle(n).color);
        if (!c) continue;
        const f = fondSous(n);
        const r = contraste(c, f);
        if (r < pire) {
          pire = r;
          pireQuoi = `${n.tagName.toLowerCase()} « ${n.textContent.trim().slice(0, 30)} »`;
        }
      }
      const corps = bulle.querySelector('p');
      const titre = bulle.querySelector('h1, h2, h3');
      return {
        sections: bulle.querySelectorAll('section, nav').length,
        titres: bulle.querySelectorAll('h1, h2, h3').length,
        tailleTitre: titre ? parseFloat(getComputedStyle(titre).fontSize) : 0,
        tailleCorps: corps ? parseFloat(getComputedStyle(corps).fontSize) : 0,
        pire: Number.isFinite(pire) ? Math.round(pire * 10) / 10 : null,
        pireQuoi,
        fond: `${fond.r},${fond.g},${fond.b}`,
        largeur: Math.round(bulle.getBoundingClientRect().width),
        defile: bulle.scrollWidth > bulle.clientWidth + 1,
      };
    });
  }, selecteur);
}

/** Le HAUT d'une bulle (un long message dépasse l'écran), en capture. */
async function capturerLeHaut(page, bulle, nom) {
  if (!(await bulle.count())) return;
  await bulle.evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => undefined);
  const boite = await bulle.boundingBox();
  if (!boite) return;
  const haut = Math.max(0, boite.y - 8);
  await page.screenshot({
    path: path.join(CAPTURES, nom),
    clip: { x: Math.max(0, boite.x - 8), y: haut, width: boite.width + 16, height: Math.min(boite.height + 16, 900 - haut) },
  });
}

function juger(lieu, clarte, mesures) {
  record(`${lieu} (${clarte}) : des bulles à juger`, mesures.length > 0, `${mesures.length} bulle(s)`);
  if (!mesures.length) return;
  record(
    `${lieu} (${clarte}) : aucun sommaire ni cadre dans une bulle`,
    mesures.every((m) => m.sections === 0),
    mesures.map((m) => m.sections).join(','),
  );
  const avecTitres = mesures.filter((m) => m.titres > 0);
  if (avecTitres.length) {
    record(
      `${lieu} (${clarte}) : les titres sont plus grands que le texte`,
      avecTitres.every((m) => m.tailleTitre > m.tailleCorps || !m.tailleCorps),
      avecTitres.map((m) => `${m.tailleTitre}/${m.tailleCorps}px`).join(' '),
    );
  }
  const pire = mesures.filter((m) => m.pire !== null).sort((a, b) => a.pire - b.pire)[0];
  record(
    `${lieu} (${clarte}) : tout texte se détache de son fond (contraste ≥ 3)`,
    !pire || pire.pire >= 3,
    pire ? `pire ${pire.pire} sur ${pire.pireQuoi}, fond ${pire.fond}` : 'aucun texte',
  );
  record(
    `${lieu} (${clarte}) : aucune bulle n'est élargie par son contenu`,
    mesures.every((m) => !m.defile),
  );
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  console.log(`Adresse visée : ${BASE}`);
  const carte = carteAvecTitres();
  if (!carte) {
    record('une carte dont la demande porte des titres', false, 'aucune en base');
    return;
  }
  const cookie = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (error) => erreurs.push(String(error)));
    page.setDefaultTimeout(15000);

    /* LA CARTE : sa bulle de demande. Le point « Demande » peut être replié ;
       on l'ouvre s'il le faut. */
    await page.goto(`${BASE}/#projet/${carte.projectId}/tache/${carte.cardId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const bulle = page.locator('[data-bulle="utilisateur"]');
    await bulle.first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
    if (!(await bulle.count())) {
      const point = page.locator('[data-point="demande"]').first();
      if (await point.count()) {
        await point.scrollIntoViewIfNeeded().catch(() => undefined);
        await point.click().catch(() => undefined);
        await bulle.first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => undefined);
      }
    }
    for (const clarte of ['clair', 'sombre']) {
      await poserClarte(page, clarte);
      juger('carte', clarte, await mesurer(page, '[data-bulle="utilisateur"]'));
      if (CAPTURES) await capturerLeHaut(page, bulle.first(), `bulle-carte-${clarte}.png`);
    }

    /* LA CONVERSATION DE L'ASSISTANT : on l'ouvre par son bouton d'entête s'il
       est fermé, et on la referme à la fin — l'ouverture est retenue. */
    await page.goto(`${BASE}/#projet/${carte.projectId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const bouton = page.locator('[data-bouton-du-bord]').first();
    await bouton.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
    const ouvertAvant = (await bouton.getAttribute('data-ouvert').catch(() => null)) === 'oui';
    if (!ouvertAvant) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant'))).catch(() => undefined);
    const bulleAssistant = page.locator('[data-bulle="utilisateur-assistant"]');
    await bulleAssistant.first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
    for (const clarte of ['clair', 'sombre']) {
      await poserClarte(page, clarte);
      juger('assistant', clarte, await mesurer(page, '[data-bulle="utilisateur-assistant"]'));
      if (CAPTURES) {
        await capturerLeHaut(page, bulleAssistant.last(), `bulle-assistant-${clarte}.png`);
      }
    }
    if (!ouvertAvant) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant'))).catch(() => undefined);

    record('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    retirerSession(cookie);
  }
}

main()
  .catch((error) => record('le contrôle tourne jusqu’au bout', false, String(error)))
  .finally(() => {
    const echecs = resultats.filter((r) => !r.ok).length;
    console.log(`\n${resultats.length - echecs}/${resultats.length} vérification(s) réussie(s)`);
    process.exit(echecs ? 1 : 0);
  });
