#!/usr/bin/env node
/**
 * LES BOUTONS D'UNE MÊME RANGÉE SONT RÉPARTIS À ÉGALE DISTANCE, vérifié dans un
 * vrai navigateur, sur téléphone (390 et 360 px) puis sur ordinateur.
 *
 * La règle (`CLASSE_RANGEE_DE_BOUTONS`, `web/src/components/ui/index.tsx`) :
 * tous les boutons d'une rangée — barre d'en-tête (à gauche, à droite), rangée
 * du bas du champ d'écriture, colonne des projets — sont séparés du MÊME
 * écart, un peu plus serré sur téléphone, et leurs cases d'icône ont la même
 * taille.
 *
 * Le contrôle ne fige AUCUNE valeur en pixels (compétence
 * `verifs-navigateur-etat-plutot-que-hauteur`) : il compare les écarts d'une
 * rangée ENTRE EUX (à ±0,5 px) et les cases d'icône entre elles. Une rangée
 * est repérée par `data-rangee-de-boutons` ; le côté gauche de la barre
 * d'en-tête, qui n'a pas d'enveloppe, est assemblé ici par ses repères
 * (`data-retour-*`, `data-avant-le-fil`, `data-icone-du-cran`). Les écarts se
 * mesurent entre BOÎTES DE MISE EN PAGE (marges comprises) : l'envoi est un carré
 * arrondi de la taille du micro, sans marge négative.
 *
 * Rien ne part au démon hormis des lectures ; une session d'une heure est
 * fabriquée puis retirée.
 *
 *   HAIKO_ECARTS_URL=http://localhost:7191 node scripts/verif-ecarts-des-boutons.mjs
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_ECARTS_URL || 'http://localhost:7191';
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
    'vérification des écarts entre boutons',
  );
  db.close();
}

/**
 * Lu DANS la page : toutes les rangées visibles, avec, pour chacune, ses
 * boutons de gauche à droite (boîte de mise en page, marges comprises).
 */
function releverLesRangees() {
  const visible = (element) => {
    const r = element.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  /* UN BOUTON RÉUNI (« Déployer » et son chevron, collés) EST UNE SEULE BOÎTE. */
  const BOUTON = 'button, a[href], [role="button"], [data-icone-du-cran], [data-bouton-reuni]';
  const feuilles = (racine, sansImbriquees = false) => {
    const trouves = [];
    const parcourir = (noeud) => {
      for (const enfant of noeud.children) {
        if (!visible(enfant)) continue;
        if (sansImbriquees && enfant.hasAttribute('data-rangee-de-boutons')) continue;
        if (enfant.matches(BOUTON)) {
          trouves.push(enfant);
          continue;
        }
        parcourir(enfant);
      }
    };
    parcourir(racine);
    return trouves;
  };
  const boite = (element) => {
    const r = element.getBoundingClientRect();
    const s = getComputedStyle(element);
    const gauche = r.left - parseFloat(s.marginLeft || '0');
    const droite = r.right + parseFloat(s.marginRight || '0');
    return {
      gauche,
      droite,
      largeur: r.width,
      hauteur: r.height,
      texte: (element.textContent || '').trim().length > 0,
      nom: element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('data-mic-button') !== null && 'micro' || element.className.toString().slice(0, 40),
    };
  };
  const rangees = [];
  const ajouter = (nom, elements) => {
    const boites = elements.filter((e) => visible(e)).map(boite).sort((a, b) => a.gauche - b.gauche);
    if (boites.length >= 2) rangees.push({ nom, boites });
  };

  document.querySelectorAll('[data-entete-de-zone]').forEach((barre, rang) => {
    if (!visible(barre)) return;
    const etiquette = barre.closest('[data-page-carte]') ? 'barre de la carte' : `barre ${rang}`;
    const gauche = [
      ...barre.querySelectorAll(':scope > button'),
      ...barre.querySelectorAll('[data-avant-le-fil] button'),
      ...barre.querySelectorAll('[data-fil-d-ariane] [data-icone-du-cran]'),
    ].filter((e) => {
      /* Seul le côté gauche : avant le fil d'Ariane ou son icône. */
      const fil = barre.querySelector('[data-fil-d-ariane]');
      return !fil || e.getBoundingClientRect().left < fil.getBoundingClientRect().left + 48;
    });
    ajouter(`${etiquette} · gauche`, gauche);
    const droite = barre.querySelector(':scope > [data-rangee-de-boutons]');
    if (droite) ajouter(`${etiquette} · droite`, feuilles(droite));
  });
  document.querySelectorAll('[data-rangee-de-boutons]').forEach((rangee, rang) => {
    if (!visible(rangee)) return;
    const nom = rangee.getAttribute('data-rangee-de-boutons') || `rangée ${rang}`;
    if (rangee.matches('[data-entete-de-zone] > [data-rangee-de-boutons]')) return;
    ajouter(`rangée « ${nom} »${rangee.closest('[data-colonne-projets]') ? ' (colonne des projets)' : ''}`, feuilles(rangee, true));
  });
  return rangees;
}

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const vuesVisees = new Set();
try {
  for (const [nom, viewport] of [
    ['téléphone 390', { width: 390, height: 844 }],
    ['téléphone 360', { width: 360, height: 780 }],
    ['ordinateur', { width: 1280, height: 800 }],
  ]) {
    const contexte = await navigateur.newContext({ viewport });
    await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    const telephone = viewport.width < 640;
    const lire = async (libelle) => {
      const rangees = await page.evaluate(releverLesRangees);
      for (const rangee of rangees) {
        const ecarts = [];
        for (let i = 1; i < rangee.boites.length; i++) {
          ecarts.push(rangee.boites[i].gauche - rangee.boites[i - 1].droite);
        }
        const min = Math.min(...ecarts);
        const max = Math.max(...ecarts);
        const intitule = `${nom} · ${libelle} · ${rangee.nom}`;
        vuesVisees.add(rangee.nom);
        verifier(
          max - min <= TOLERANCE,
          `${intitule} : écarts égaux (${ecarts.map((e) => e.toFixed(1)).join(' / ')}) [${rangee.boites.map((b) => b.nom).join(' | ')}]`,
        );
        /* Les cases d'icône d'une rangée ont la même largeur (l'envoi, carré comme le micro, compris). */
        const cases = rangee.boites.filter((b) => !b.texte).map((b) => b.largeur);
        if (cases.length >= 2) {
          verifier(
            Math.max(...cases) - Math.min(...cases) <= TOLERANCE,
            `${intitule} : cases d'icône de même largeur (${cases.map((c) => c.toFixed(1)).join(' / ')}) [${rangee.boites.filter((b) => !b.texte).map((b) => b.nom).join(' | ')}]`,
          );
        }
      }
      if (!rangees.length) echecs.push(`${nom} · ${libelle} : aucune rangée de boutons repérée`);
    };
    const aller = async (hash, attente) => {
      await page.goto(`${ADRESSE}/#${hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.belugaEssai?.pret?.(), null, { timeout: 60_000 });
      if (attente) await page.waitForSelector(attente, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(900);
    };

    await aller('', '[data-entete-de-zone]');
    await lire('accueil');
    if (telephone) {
      /* La colonne des projets vit dans un panneau : on l'ouvre par la barre. */
      const projets = page.locator('[data-entete-de-zone] button[aria-label="Projets"]').first();
      if (await projets.count()) {
        await projets.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(700);
        await lire('colonne des projets');
        await page.keyboard.press('Escape');
      }
    }
    await aller(`projet/${carte.projectId}`, '[data-entete-de-zone]');
    await lire('tableau du projet');

    await aller(`projet/${carte.projectId}/tache/${carte.id}`, `[data-page-carte="${carte.id}"]`);
    await lire('carte ouverte');
    await page.screenshot({
      path: `/tmp/ecarts-carte-${nom.replace(/\s+/g, '-')}.png`,
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    });

    for (const vue of ['tableau-de-bord', 'memoire', 'statistiques', 'coffre', 'backups', 'notes', 'marketing', 'surveillance', 'espace-client', 'studio']) {
      await aller(vue, '[data-entete-de-zone]');
      await lire(`page ${vue}`);
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

for (const c of constats) console.log(`  ✔ ${c}`);
for (const e of echecs) console.error(`  ✘ ${e}`);
const attendues = ['carte'];
console.log(`\n${constats.length} contrôle(s) réussi(s), ${echecs.length} échec(s). Rangées vues : ${[...vuesVisees].join(' ; ')}`);
void RACINE;
void attendues;
process.exit(echecs.length ? 1 : 0);
