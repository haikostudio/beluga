#!/usr/bin/env node
/**
 * L'heure sous chaque message doit se lire SANS promener la souris : plus
 * d'effacement au survol, une seule règle pour la demande et pour la réponse,
 * et le bouton « Copier » qui ne bouge pas d'un pixel.
 *
 * CHAQUE message porte la sienne, sans exception : le regroupement à la minute
 * (une seule heure sous le dernier d'une suite) a été retiré — il effaçait
 * l'heure sous une demande dès qu'une réponse suivait dans la même minute.
 *
 * Les heures se relèvent par leur REPÈRE TECHNIQUE (`data-heure-message`,
 * `LigneReperes`), jamais par le texte affiché : celui-ci change avec la langue
 * et avec l'âge du message.
 *
 *   HAIKO_HEURE_URL=http://localhost:7099 node scripts/verif-heure-permanente.mjs
 *
 * Contrôlé en thème sombre, en thème clair, puis sur écran de téléphone. Le
 * serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.HAIKO_HEURE_URL || 'http://localhost:7099';
const DB = '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Une session de courte durée, posée en base : la vérification s'authentifie seule. */
function poserSession(db) {
  const token = crypto.randomBytes(32).toString('hex');
  // Le serveur ne garde que l'empreinte du jeton : c'est elle qu'on écrit.
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification heure permanente',
  );
  return { token, empreinte };
}

/** La carte vivante dont la conversation est la plus fournie : le meilleur terrain. */
function choisirCarte(db) {
  return db
    .prepare(
      `SELECT c.id, c.title, c.project_id, c.column_key, COUNT(m.id) AS n
       FROM cards c
       JOIN agents a ON a.card_id = c.id AND a.role != 'analysis'
       JOIN messages m ON m.agent_id = a.id
       WHERE c.column_key IN ('running', 'to_deploy', 'planned')
       GROUP BY c.id HAVING n >= 2
       ORDER BY n DESC, c.updated_at DESC LIMIT 1`,
    )
    .get();
}

/** Le fil enregistré d'une carte, tous ses agents mêlés, dans l'ordre du temps. */
function filEnregistre(db, cardId) {
  return db
    .prepare(
      `SELECT m.created_at AS at, m.data FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE a.card_id = ? ORDER BY m.created_at`,
    )
    .all(cardId)
    .map((row) => {
      const data = JSON.parse(row.data);
      return { at: row.at, role: data.role, durationMs: data.durationMs };
    });
}

/** La luminance perçue d'une couleur « rgb(r, g, b) », pour juger du contraste. */
function luminance(couleur) {
  const [r, g, b] = couleur.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(avant, arriere) {
  const a = luminance(avant);
  const b = luminance(arriere);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Les heures visibles du fil : on ne garde que les libellés d'ancienneté ou
 * d'horodatage, avec leur opacité réelle et leur couleur calculées.
 */
async function lireHeures(page) {
  return page.evaluate(() => {
    const trouvees = [];
    // On ne regarde QUE le fil de la conversation ouverte : le tableau et les
    // volets rangés affichent eux aussi des anciennetés, sans rapport ici.
    const fils = document.querySelectorAll('[role="dialog"]');
    const fil = fils[fils.length - 1] || document.body;
    for (const span of fil.querySelectorAll('[data-heure-message]')) {
      const texte = (span.textContent || '').trim();
      if (!texte) continue;
      const style = getComputedStyle(span);
      const boite = span.getBoundingClientRect();
      if (!boite.height) continue;
      // L'opacité effective : celle du span et celle de tous ses parents.
      let opacite = 1;
      let coupable = '';
      for (let noeud = span; noeud && noeud !== document.body; noeud = noeud.parentElement) {
        const part = Number(getComputedStyle(noeud).opacity);
        if (part < 0.99 && !coupable) coupable = noeud.className || noeud.tagName;
        opacite *= part;
      }
      trouvees.push({
        texte,
        opacite: Number(opacite.toFixed(3)),
        couleur: style.color,
        taille: style.fontSize,
        fond: style.backgroundColor,
        largeur: Math.round(boite.width),
        x: Math.round(boite.x),
        // L'heure exacte est promise en infobulle, jamais à la place du texte.
        infobulle: span.getAttribute('title') || '',
      });
    }
    return trouvees;
  });
}

/**
 * Les lignes de repères du fil : une par message, avec son côté (les demandes
 * sont alignées à droite), son heure éventuelle et sa durée de travail.
 */
async function lireReperes(page) {
  return page.evaluate(() => {
    const fils = document.querySelectorAll('[role="dialog"]');
    const fil = fils[fils.length - 1] || document.body;
    const lignes = [];
    for (const div of fil.querySelectorAll('[data-ligne-reperes]')) {
      if (!div.getBoundingClientRect().height) continue;
      const spans = [...div.querySelectorAll(':scope > span')].map((s) => s.textContent.trim());
      lignes.push({
        aDroite: /justify-end/.test(div.className),
        heure: div.querySelector('[data-heure-message]')?.textContent.trim() || '',
        jetons: div.querySelector('[data-jetons-message]')?.textContent.trim() || '',
        travail: spans.find((t) => / de travail$/.test(t)) || '',
        copier: !!div.querySelector('button'),
      });
    }
    return lignes;
  });
}

/** La couleur de fond réellement peinte derrière un point de la page. */
async function fondDerriere(page) {
  return page.evaluate(() => {
    let noeud = document.body;
    let fond = 'rgb(0, 0, 0)';
    while (noeud) {
      const c = getComputedStyle(noeud).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)/.test(c)) fond = c;
      noeud = noeud.firstElementChild;
    }
    return getComputedStyle(document.body).backgroundColor || fond;
  });
}

async function ouvrirCarte(page, carte, projet) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  /*
   * L'application rouvre le tiroir quitté la veille : s'il porte déjà notre
   * carte, on n'y touche pas ; sinon on le referme AVANT de cliquer, car son
   * voile avale les clics du tableau et de la colonne des projets.
   */
  const dialogue = page.locator('[role="dialog"]').last();
  const dejaOuvert = (await dialogue.count()) ? await dialogue.innerText() : '';
  if (dejaOuvert.includes(carte.title.slice(0, 30))) return;
  if (dejaOuvert) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }

  const ligneProjet = page.getByText(projet, { exact: true }).first();
  if (await ligneProjet.count()) {
    await ligneProjet.click();
    await page.waitForTimeout(2000);
  }

  {
    const colonne = page.locator(`[data-column="${carte.column_key}"]`);
    if (await colonne.count()) {
      await colonne.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
    const vignette = page.locator('article').filter({ hasText: carte.title.slice(0, 30) }).first();
    await vignette.waitFor({ state: 'visible', timeout: 20000 });
    await vignette.click();
    await page.waitForTimeout(2500);
  }
}

async function main() {
  const db = new Database(DB);
  const carte = choisirCarte(db);
  if (!carte) {
    console.error('Aucune carte avec une conversation : lancez une tâche et relancez.');
    process.exit(2);
  }
  const projet = db.prepare('SELECT name FROM projects WHERE id = ?').get(carte.project_id).name;
  const filEnBase = filEnregistre(db, carte.id);
  const { token, empreinte } = poserSession(db);
  console.log(`Carte : « ${carte.title} » (${projet})`);

  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  const nouvelOnglet = async (viewport, mobile = false) => {
    const context = await browser.newContext({
      viewport,
      locale: 'fr-CH',
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: mobile ? 3 : 1,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      {
        name: 'haikodev_session',
        value: token,
        url: new URL(BASE).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    return context;
  };

  try {
    // ---------- Ordinateur, thème sombre ----------
    let context = await nouvelOnglet({ width: 1400, height: 900 });
    let page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

    await ouvrirCarte(page, carte, projet);
    // La souris se tient LOIN du fil : c'est tout l'enjeu de la vérification.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/heure-permanente-sombre.png` });

    let heures = await lireHeures(page);
    record('Des heures sont présentes dans le fil', heures.length >= 2, `${heures.length} trouvées`);

    const effacees = heures.filter((h) => h.opacite < 0.99);
    record(
      'Aucune heure effacée souris au loin (thème sombre)',
      effacees.length === 0,
      effacees.length ? effacees.map((h) => `${h.texte} @ ${h.opacite}`).join(', ') : 'toutes à 1',
    );

    const fondSombre = await fondDerriere(page);
    const contrastesSombre = heures.map((h) => contraste(h.couleur, fondSombre));
    const minSombre = Math.min(...contrastesSombre);
    record(
      'Lisible sans attirer l’œil, thème sombre',
      minSombre >= 3 && minSombre <= 12,
      `contraste ${minSombre.toFixed(1)}:1 sur ${fondSombre}`,
    );

    const tailles = [...new Set(heures.map((h) => h.taille))];
    const couleurs = [...new Set(heures.map((h) => h.couleur))];
    record(
      'Une seule règle pour la demande et pour la réponse',
      tailles.length === 1 && couleurs.length === 1,
      `taille ${tailles.join(' / ')} — couleur ${couleurs.join(' / ')}`,
    );

    // L'heure exacte est promise en infobulle, l'ancienneté reste ce qu'on lit.
    const sansInfobulle = heures.filter((h) => !/\d{4}.+\d{2}:\d{2}/.test(h.infobulle));
    record(
      "L'heure exacte se lit en infobulle au survol",
      sansInfobulle.length === 0,
      heures[0] ? `« ${heures[0].texte} » → « ${heures[0].infobulle} »` : '',
    );

    /*
     * UNE HEURE SOUS CHAQUE MESSAGE, sans exception : c'est la règle qui a
     * remplacé le groupement à la minute. On compare ce qui est à l'écran aux
     * lignes de repères réellement posées.
     */
    const reperes = await lireReperes(page);
    const affichees = reperes.filter((r) => r.heure).length;
    record(
      'Une heure sous chaque message, sans exception',
      reperes.length > 0 && affichees === reperes.length,
      `${affichees} heures pour ${reperes.length} messages`,
    );
    // Les jetons sont remis sous les bulles : au moins un message mesuré doit
    // les montrer sur un fil réel (une conversation d'agent en a toujours).
    const avecJetons = reperes.filter((r) => /jetons/.test(r.jetons));
    record(
      'Les jetons se lisent sous les messages mesurés',
      avecJetons.length > 0,
      avecJetons.length ? `ex. « ${avecJetons[0].jetons} »` : 'aucun jeton à l’écran',
    );

    // La durée de travail ne se dit que sous les réponses de l'agent.
    const durationsAttendues = filEnBase.filter(
      (m) => m.role === 'assistant' && m.durationMs >= 1000,
    ).length;
    const avecTravail = reperes.filter((r) => r.travail);
    record(
      "La durée de travail s'affiche sous les réponses de l'agent",
      avecTravail.length === durationsAttendues && durationsAttendues > 0,
      avecTravail.length ? `ex. « ${avecTravail[0].travail} »` : 'aucune durée à l’écran',
    );
    record(
      'Aucune durée sous une demande',
      avecTravail.every((r) => !r.aDroite),
      `${reperes.filter((r) => r.aDroite).length} demandes dans le fil`,
    );

    // Le bouton « Copier » ne doit pas se décaler quand la souris arrive.
    const copiers = page.getByRole('button', { name: /Copier/ });
    const nb = await copiers.count();
    const avant = [];
    for (let i = 0; i < nb; i += 1) avant.push(await copiers.nth(i).boundingBox());
    const lisibiliteCopier = await copiers.first().evaluate((el) => getComputedStyle(el).color);
    record(
      'Le bouton « Copier » est lisible',
      contraste(lisibiliteCopier, fondSombre) >= 3,
      `contraste ${contraste(lisibiliteCopier, fondSombre).toFixed(1)}:1`,
    );

    const fil = page.locator('[role="dialog"]').last();
    await fil.hover({ position: { x: 200, y: 300 } }).catch(() => {});
    await page.waitForTimeout(700);
    const apres = [];
    for (let i = 0; i < nb; i += 1) apres.push(await copiers.nth(i).boundingBox());
    const bouge = avant.filter(
      (b, i) => b && apres[i] && (Math.abs(b.x - apres[i].x) > 0.5 || Math.abs(b.y - apres[i].y) > 0.5),
    );
    record(
      'Le bouton « Copier » ne bouge pas au survol',
      bouge.length === 0,
      `${nb} boutons mesurés`,
    );

    record('Aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();

    // ---------- Ordinateur, thème clair ----------
    context = await nouvelOnglet({ width: 1400, height: 900 });
    page = await context.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem('haikodev.theme', 'light');
      } catch {
        /* stockage refusé : le basculement se fera à la main */
      }
    });
    await ouvrirCarte(page, carte, projet);
    // Le thème clair se reconnaît à la classe absente sur <html>.
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/heure-permanente-clair.png` });

    heures = await lireHeures(page);
    const effaceesClair = heures.filter((h) => h.opacite < 0.99);
    record(
      'Aucune heure effacée souris au loin (thème clair)',
      effaceesClair.length === 0 && heures.length >= 2,
      `${heures.length} heures, ${effaceesClair.length} effacées`,
    );

    const fondClair = await fondDerriere(page);
    const minClair = Math.min(...heures.map((h) => contraste(h.couleur, fondClair)));
    record(
      'Lisible sans attirer l’œil, thème clair',
      minClair >= 3 && minClair <= 12,
      `contraste ${minClair.toFixed(1)}:1 sur ${fondClair}`,
    );
    await context.close();

    // ---------- Téléphone : rien ne doit avoir changé ----------
    context = await nouvelOnglet({ width: 390, height: 844 }, true);
    page = await context.newPage();
    await ouvrirCarte(page, carte, projet);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/heure-permanente-telephone.png` });

    heures = await lireHeures(page);
    const effaceesTel = heures.filter((h) => h.opacite < 0.99);
    record(
      'Sur téléphone, les heures restent visibles',
      heures.length >= 1 && effaceesTel.length === 0,
      `${heures.length} heures, toutes pleinement visibles`,
    );
    await context.close();
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  console.log(`Captures : ${SHOTS}/heure-permanente-*.png`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
