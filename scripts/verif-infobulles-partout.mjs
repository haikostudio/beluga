#!/usr/bin/env node
/**
 * CHAQUE BOUTON SANS LIBELLÉ A SA BULLE D'AIDE, vérifié dans un vrai navigateur.
 *
 * Sur chaque page de l'application, tout élément cliquable visible qui ne porte
 * AUCUN texte (une icône seule, un point, une vignette) doit dire ce qu'il fait :
 * soit par un `title` (repris par la couche des infobulles), soit par une bulle
 * posée par `Tooltip`. Le contrôle survole chaque élément sans libellé et exige
 * une bulle `[role="tooltip"]` / `[data-infobulle]` — ou un `title` au moins.
 * Il vérifie aussi que la bulle est CONTRASTÉE : son fond est celui de l'encre
 * du thème, son texte celui du fond (noire sur clair, blanche sur sombre).
 *
 * Rien ne part au démon hormis des lectures ; une session d'une heure est
 * fabriquée puis retirée.
 *
 *   HAIKO_INFOBULLES_URL=http://localhost:7099 node scripts/verif-infobulles-partout.mjs
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_INFOBULLES_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const TOLERANCE = 0.5;
const require = createRequire(import.meta.url);
const ouvrirBase = (options) =>
  require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES), options);

const echecs = [];
const constats = [];
const verifier = (ok, message) => (ok ? constats.push(message) : echecs.push(message));

/* Un projet actif, et une carte à cadrer (« Planifié ») : son champ d'écriture
   porte « Plan » et « Création ». À défaut, la carte la plus récente. */
const lecture = ouvrirBase({ readonly: true });
const carte =
  lecture
    .prepare(
      "SELECT c.id, c.project_id AS projectId FROM cards c JOIN projects p ON p.id = c.project_id WHERE p.archived = 0 AND c.column_key = 'planned' ORDER BY c.updated_at DESC LIMIT 1",
    )
    .get() ??
  lecture
    .prepare(
      "SELECT c.id, c.project_id AS projectId FROM cards c JOIN projects p ON p.id = c.project_id WHERE p.archived = 0 AND c.column_key != 'archived' ORDER BY c.updated_at DESC LIMIT 1",
    )
    .get();
lecture.close();
if (!carte) {
  console.error('Aucune carte dans la base servie : rien à vérifier.');
  process.exit(1);
}

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const db = ouvrirBase();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification des infobulles',
  );
  db.close();
}


/**
 * Lu DANS la page : les éléments cliquables visibles SANS texte et SANS `title`.
 * Chacun reçoit un repère temporaire pour être survolé ensuite.
 */
function releverLesSansLibelle() {
  const visible = (element) => {
    const r = element.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (style.pointerEvents === 'none') return false;
    /* ATTEIGNABLE : un élément recouvert (le tableau sous la page d'une carte
       ouverte) n'est pas survolable — la souris tomberait sur ce qui le couvre. */
    const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (dessus && dessus !== element && !element.contains(dessus) && !dessus.contains(element)) return false;
    return true;
  };
  const CIBLES = 'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], summary, input[type="checkbox"], input[type="radio"]';
  const trouves = [];
  document.querySelectorAll(CIBLES).forEach((el, i) => {
    if (el.disabled) return;
    if (el.hasAttribute('data-bulle-info-bouton')) return; /* le « i » ouvre sa propre bulle, riche */
    if (!visible(el)) return;
    /* Un champ coché dans une étiquette qui porte du texte est déjà nommé par elle. */
    const etiquette = el.closest('label');
    if (etiquette && (etiquette.textContent || '').trim().length > 1) return;
    const texte = (el.innerText || '').trim();
    if (texte.length > 0) return;
    if (el.getAttribute('title') || el.getAttribute('data-infobulle-titre')) return;
    /* Une image avec texte alternatif visible n'est pas du texte : on la compte comme icône. */
    el.setAttribute('data-sans-libelle', String(i));
    const r = el.getBoundingClientRect();
    trouves.push({
      i: String(i),
      nom: el.getAttribute('aria-label') || '',
      balise: el.tagName.toLowerCase(),
      classe: String(el.className?.baseVal ?? el.className).slice(0, 80),
      data: [...el.attributes].filter((a) => a.name.startsWith('data-') && a.name !== 'data-sans-libelle').map((a) => a.name).slice(0, 3).join(' '),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    });
  });
  return trouves;
}

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const manques = new Map();
let verifies = 0;
let contrastes = null;
try {
  for (const [nom, viewport] of [['ordinateur', { width: 1280, height: 800 }]]) {
    const contexte = await navigateur.newContext({ viewport });
    await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    const lire = async (libelle) => {
      const sans = await page.evaluate(releverLesSansLibelle);
      console.log(`  · ${libelle} : ${sans.length} sans libellé`);
      for (const s of sans) {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(60);
        /* EN PLUSIEURS PAS, comme une vraie souris : un seul saut ne produit
           qu'un mouvement, que la bulle Radix ignore tant qu'elle croit le
           pointeur « en route » vers la bulle d'avant. */
        await page.mouse.move(s.x, s.y, { steps: 4 });
        await page.waitForTimeout(150);
        await page.mouse.move(s.x + 1, s.y);
        await page.mouse.move(s.x, s.y);
        let bulle = null;
        for (let essai = 0; essai < 12 && !bulle; essai++) {
          await page.waitForTimeout(80);
          bulle = await page.evaluate(({ x, y }) => {
            /* UNE BULLE QUI COMPTE EST À L'ÉCRAN, PRÈS DE CE QU'ON SURVOLE. Une
               bulle « ouverte » mais sans ancre (un déclencheur qui ne transmet
               pas sa référence) reste dessinée hors champ : elle passait pour
               bonne, et trois interrupteurs n'ont eu aucune bulle visible. */
            const DISTANCE_MAX = 80;
            const b = [...document.querySelectorAll('[role="tooltip"], [data-infobulle], [data-bulle-info]')].find((e) => {
              const r = e.getBoundingClientRect();
              if (!(r.width > 0 && getComputedStyle(e).opacity !== '0' && (e.textContent || '').trim())) return false;
              if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
              const dx = Math.max(r.left - x, 0, x - r.right);
              const dy = Math.max(r.top - y, 0, y - r.bottom);
              return Math.hypot(dx, dy) <= DISTANCE_MAX;
            });
            if (!b) return null;
            const c = getComputedStyle(b);
            return { texte: b.textContent.trim().slice(0, 60), fond: c.backgroundColor, encre: c.color };
          }, { x: s.x, y: s.y });
        }
        verifies++;
        if (bulle) {
          if (!contrastes) contrastes = bulle;
          continue;
        }
        const cle = `${libelle} · ${s.balise}${s.nom ? ` « ${s.nom} »` : ''} [${s.data || s.classe}]`;
        if (!manques.has(cle)) manques.set(cle, s);
      }
    };
    const aller = async (hash, attente) => {
      await page.goto(`${ADRESSE}/#${hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.belugaEssai?.pret?.(), null, { timeout: 60_000 });
      if (attente) await page.waitForSelector(attente, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(900);
    };

    await aller('', '[data-entete-de-zone]');
    await lire('accueil');
    await aller(`projet/${carte.projectId}`, '[data-entete-de-zone]');
    await lire('tableau du projet');
    await aller(`projet/${carte.projectId}/tache/${carte.id}`, `[data-page-carte="${carte.id}"]`);
    await lire('carte ouverte');
    /* L'ÉTIQUETTE DU MODE (11/11/2026 : elle remplace les trois interrupteurs) doit montrer SA bulle, à l'écran.
       Une carte sans mode confirmé n'en porte pas : rien à survoler. */
    for (const repere of ['data-etiquette-du-mode']) {
      const bouton = page.locator(`[${repere}]`).first();
      if (!(await bouton.count())) {
        constats.push('carte à cadrer : aucun mode confirmé, pas d’étiquette à survoler');
        continue;
      }
      const boite = await bouton.boundingBox();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(100);
      const x = boite.x + boite.width / 2;
      const y = boite.y + boite.height / 2;
      await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(150);
      await page.mouse.move(x + 1, y);
      await page.mouse.move(x, y);
      await page.waitForTimeout(700);
      const visible = await page.evaluate(({ x, y }) =>
        [...document.querySelectorAll('[role="tooltip"], [data-infobulle]')].some((e) => {
          const r = e.getBoundingClientRect();
          if (!(r.width > 0 && (e.textContent || '').trim())) return false;
          if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
          return Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)) <= 80;
        }), { x, y });
      verifier(visible, `carte à cadrer : bulle de [${repere}] visible au survol`);
    }
    /* LA FENÊTRE DE CONFIGURATION DU PROJET, rubrique par rubrique (adresse « config/<rubrique> »). */
    for (const cle of ['general', 'dossiers', 'deploiement', 'production', 'facturation', 'archivage', 'retrait']) {
      await aller(`projet/${carte.projectId}/config/${cle}`, '[data-rubrique-contenu], [data-rubrique-ouverte]');
      await lire(`réglages du projet · ${cle}`);
    }
    /* LA MINI-CARTE DU GRAPHE DE LA MÉMOIRE : sa poignée a sa bulle. */
    await aller('memoire', '[data-graphe-minicarte]');
    await page.hover('[data-graphe-minicarte-cadre]').catch(() => {});
    await lire('mémoire · graphe');
    for (const vue of ['tableau-de-bord', 'memoire', 'statistiques', 'coffre', 'backups', 'notes', 'marketing', 'surveillance', 'espace-client', 'studio']) {
      await aller(vue, '[data-entete-de-zone]');
      await lire(`page ${vue}`);
    }
    /* LA BULLE EST CONTRASTÉE : noire (texte clair) sur une interface claire, blanche (texte foncé) sur une interface sombre. */
    await aller('', '[data-entete-de-zone]');
    for (const sombre of [false, true]) {
      await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
      await page.waitForTimeout(300);
      const cible = page.locator('[data-entete-de-zone] button[aria-label]:visible').first();
      const boite = await cible.boundingBox();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(100);
      await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
      await page.waitForTimeout(450);
      const mesure = await page.evaluate(() => {
        const b = document.querySelector('[role="tooltip"][data-infobulle], [data-infobulle]');
        if (!b) return null;
        const lum = (css) => {
          const m = css.match(/[\d.]+/g).map(Number);
          const [r, g, bl] = m.slice(0, 3).map((v) => v / 255);
          return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        };
        const c = getComputedStyle(b);
        return { fond: lum(c.backgroundColor), texte: lum(c.color), page: lum(getComputedStyle(document.body).backgroundColor) };
      });
      const nomTheme = sombre ? 'sombre' : 'clair';
      if (!mesure) echecs.push(`${nomTheme} : aucune bulle à mesurer`);
      else if (sombre ? !(mesure.fond > 0.6 && mesure.texte < 0.3) : !(mesure.fond < 0.3 && mesure.texte > 0.6))
        echecs.push(`${nomTheme} : bulle non contrastée (fond ${mesure.fond.toFixed(2)}, texte ${mesure.texte.toFixed(2)}, page ${mesure.page.toFixed(2)})`);
      else console.log(`  ✔ ${nomTheme} : bulle ${sombre ? 'blanche' : 'noire'} (fond ${mesure.fond.toFixed(2)}, texte ${mesure.texte.toFixed(2)})`);
    }
    void nom;
    await contexte.close();
  }
} finally {
  await navigateur.close();
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

for (const [cle, s] of manques) echecs.push(`${cle} — (${s.x}, ${s.y}) sans bulle`);
console.log(`${verifies} élément(s) sans libellé survolé(s).`);
if (contrastes) console.log(`Exemple de bulle : « ${contrastes.texte} », fond ${contrastes.fond}, texte ${contrastes.encre}`);
for (const e of echecs) console.error(`  ✘ ${e}`);
console.log(`\n${echecs.length} élément(s) sans bulle.`);
process.exit(echecs.length ? 1 : 0);
