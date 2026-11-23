#!/usr/bin/env node
/**
 * LE PARCOURS COMPLET DE L'APPLICATION SUR TÉLÉPHONE (règle MEM-6842, demande de l'utilisateur du 03/11/2026 :
 * « il faut que tu parcoures l'app et que tu checkes si tout est cohérent sur mobile, à chaque fois »).
 *
 * Au format téléphone (390 × 844, tactile), il ouvre CHAQUE écran, le photographie, et vérifie :
 *  - le haut : au plus un bouton à gauche, deux à droite, les trois points en bout ;
 *  - aucune image cassée (une `<img>` chargée sans largeur) ;
 *  - rien ne déborde de côté ;
 *  - chaque LIGNE DE LISTE s'ouvre au doigt (un vrai appui : l'adresse change, ou une feuille / une fiche s'ouvre) —
 *    toutes les lignes étaient mortes au doigt avant le 03/11/2026 ;
 *  - dans la conversation d'un chef de Communication, un appui sur une image de sa réponse ouvre l'APERÇU, et aucun
 *    nouvel onglet ne s'ouvre.
 *
 * SANS RIEN ÉCRIRE : il vise le serveur de développement (`HAIKO_PARCOURS_URL`, défaut http://localhost:7099), avec une
 * session d'une heure posée hachée puis retirée, et JETTE en route toute commande qui écrirait (réglage, lu, envoi,
 * validation, création, suppression…). Il n'appuie que sur des lignes et des gestes de navigation.
 *
 *   npm run dev --workspace web -- --port 7099 &
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-parcours-complet-telephone.mjs
 *   HAIKO_PARCOURS_CAPTURES=/tmp/parcours env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-parcours-complet-telephone.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.HAIKO_PARCOURS_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_PARCOURS_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

/** Ce qu'une commande ÉCRIRAIT : elle ne part jamais pendant le parcours. */
const ECRIT = /(\.set$|\.read$|\.unread$|creer|ecrire|valider|supprimer|send|prompt|geste|lancer|publier|marquer|\.voir$|stop|start|delete|update|create|move|accepter|refuser|reunir|sortir|retirer|enregistrer|relever|connect)/i;

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function poserSession() {
  const db = new Database(cheminDeLaBaseServie());
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'parcours complet sur téléphone',
  );
  const lire = (sql) => {
    try {
      return db.prepare(sql).get() ?? null;
    } catch {
      return null;
    }
  };
  const ids = {
    projet: lire('SELECT id FROM projects WHERE archived = 0 ORDER BY rowid LIMIT 1')?.id,
    marque: lire('SELECT m.id FROM communication_marques m ORDER BY rowid LIMIT 1')?.id,
    /* Une marque dont le chef a répondu avec des images posées dans son texte. */
    marqueAImages: lire(
      `SELECT json_extract(g.data, '$.service.adresse') AS adresse FROM messages m JOIN agents g ON g.id = m.agent_id
        WHERE json_extract(g.data, '$.service.id') = 'communication' AND m.role = 'assistant' AND m.data LIKE '%](piece:%'
        ORDER BY m.created_at DESC LIMIT 1`,
    )?.adresse,
  };
  db.close();
  return { cookie, ids };
}

function retirerSession(cookie) {
  const db = new Database(cheminDeLaBaseServie());
  db.prepare('DELETE FROM sessions WHERE token = ?').run(crypto.createHash('sha256').update(cookie).digest('hex'));
  db.close();
}

async function contexte(browser, cookie, telephone = true) {
  const ctx = await browser.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: telephone,
    isMobile: telephone,
    locale: 'fr-CH',
    colorScheme: 'dark',
    serviceWorkers: 'block',
  });
  await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        if (ECRIT.test(lu?.cmd?.type ?? lu?.type ?? '')) return;
      } catch {
        /* un message qui n'est pas du JSON passe tel quel */
      }
      serveur.send(message);
    });
  });
  page.setDefaultTimeout(8000);
  return { ctx, page };
}

async function aller(page, fragment) {
  await page.goto(`${BASE}/#${fragment}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2800);
}

const releve = (page) =>
  page.evaluate(() => {
    const visibles = (sel) => [...document.querySelectorAll(sel)].filter((b) => b.getBoundingClientRect().width > 0);
    return {
      gauche: visibles('[data-entete-de-zone] [data-cote-du-haut="gauche"] button').length,
      droite: visibles('[data-entete-de-zone] [data-cote-du-haut="droite"] button').length,
      troisPoints: !!document.querySelector('[data-entete-de-zone] [data-trois-points-du-haut]'),
      cassees: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0 && !i.closest('[data-vignette-chargee="non"]')).map((i) => i.getAttribute('src')?.slice(0, 80)),
      deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      /* Seules les lignes qui S'OUVRENT (un geste déclaré) : une ligne de simple lecture n'a pas à réagir. */
      lignes: visibles('[data-ligne-de-tableau][role="button"], tr[data-ligne-de-tableau][tabindex="0"]').length,
    };
  });

/** Un vrai appui sur la première ligne d'une liste : quelque chose doit se passer. */
async function appuyerSurUneLigne(page) {
  const ligne = page.locator('[data-ligne-de-tableau][role="button"]:visible, tr[data-ligne-de-tableau][tabindex="0"]:visible').first();
  if (!(await ligne.count())) return null;
  const avant = await page.evaluate(() => ({ hash: location.hash, feuilles: document.querySelectorAll('[data-feuille-du-bas], [role="dialog"]').length, html: document.querySelector('main')?.innerHTML.length ?? 0 }));
  /* Au milieu de l'écran : une ligne sous le menu du bas recevrait l'appui du menu, pas le sien. */
  await ligne.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {});
  await page.waitForTimeout(300);
  const boite = await ligne.boundingBox();
  if (!boite) return null;
  await page.touchscreen.tap(boite.x + Math.min(40, boite.width / 3), boite.y + boite.height / 2);
  await page.waitForTimeout(1200);
  const apres = await page.evaluate(() => ({ hash: location.hash, feuilles: document.querySelectorAll('[data-feuille-du-bas], [role="dialog"]').length, html: document.querySelector('main')?.innerHTML.length ?? 0 }));
  return apres.hash !== avant.hash || apres.feuilles > avant.feuilles || Math.abs(apres.html - avant.html) > 200 ? (apres.hash !== avant.hash ? 'NAVIGUE' : 'OUVRE') : 'RIEN';
}

async function main() {
  const { cookie, ids } = poserSession();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const { ctx, page } = await contexte(browser, cookie);
    const onglets = [];
    ctx.on('page', (p) => onglets.push(p.url()));

    const ECRANS = [
      ['tableau-de-bord', 'tableaux de bord'],
      ...(ids.projet ? [[`projet/${ids.projet}`, 'projet']] : []),
      ['communication', 'Communication'],
      ...(ids.marque
        ? ['accueil', 'bilan', 'canaux', 'campagnes', 'medias', 'publications/liste', 'publications/calendrier', 'messages'].map((l) => [`communication/${ids.marque}/${l}`, `marque · ${l}`])
        : []),
      ['studio', 'Studio'],
      ['memoire', 'Mémoire'],
      ['espace', 'Messagerie'],
      ['backups', 'Backups'],
      ['surveillance', 'Surveillance'],
      ['statistiques', 'Statistiques'],
      ['taches-recurrentes', 'Tâches récurrentes'],
      ['coffre', 'Coffre-fort'],
    ];
    for (const [fragment, nom] of ECRANS) {
      await aller(page, fragment);
      const r = await releve(page);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `${fragment.replace(/[/:]/g, '_')}.png`) }).catch(() => {});
      noter(`${nom} : un bouton à gauche, deux au plus à droite, les trois points`, r.gauche <= 1 && r.droite <= 2 && r.troisPoints, `${r.gauche} | ${r.droite}`);
      noter(`${nom} : aucune image cassée`, r.cassees.length === 0, r.cassees.join(' '));
      noter(`${nom} : rien ne déborde`, r.deborde <= 1, String(r.deborde));
      /* Les lignes des agents ouvriraient une carte (lue au passage) : on n'appuie que sur les listes des services. */
      if (r.lignes && !/^(tableau-de-bord|projet\/)/.test(fragment)) {
        const effet = await appuyerSurUneLigne(page);
        noter(`${nom} : une ligne s'ouvre au doigt`, effet !== 'RIEN', effet ?? 'aucune ligne');
      }
    }

    /* LES MÉDIAS D'UNE RÉPONSE D'AGENT S'OUVRENT DANS L'APERÇU, JAMAIS DANS UN ONGLET (03/11/2026). */
    if (ids.marqueAImages) {
      const bureau = await contexte(browser, cookie, false);
      const nouveaux = [];
      bureau.ctx.on('page', (p) => nouveaux.push(p.url()));
      await aller(bureau.page, `${ids.marqueAImages}/accueil`);
      await bureau.page.waitForSelector('[data-communication-conversation="ouverte"] [data-illustration-du-plan] button', { timeout: 20000 }).catch(() => {});
      const image = bureau.page.locator('[data-illustration-du-plan] button').last();
      if (await image.count()) {
        await image.scrollIntoViewIfNeeded().catch(() => {});
        await image.click();
        await bureau.page.waitForTimeout(1500);
        const apercu = await bureau.page.locator('[role="dialog"] img, [role="dialog"] video').count();
        noter('une image d’une réponse d’agent s’ouvre dans l’aperçu', apercu >= 1, `${apercu} média(s) dans la fenêtre`);
        noter('aucun nouvel onglet ne s’ouvre', nouveaux.length === 0, nouveaux.join(' '));
      } else {
        noter('une réponse de chef porte des images à ouvrir', false, 'aucune image trouvée dans la conversation');
      }
      await bureau.ctx.close();
    }
    noter('aucun onglet ouvert pendant le parcours', onglets.length === 0, onglets.join(' '));
  } finally {
    await browser.close();
    retirerSession(cookie);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
