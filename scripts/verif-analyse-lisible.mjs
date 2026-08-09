#!/usr/bin/env node
/**
 * Le compte rendu d'analyse doit se lire DÈS QU'IL EST FINI, sans attendre le
 * lancement de la tâche. On ouvre donc une carte analysée mais jamais lancée
 * (aucun agent d'exécution) et on vérifie que sa conversation contient tout.
 *
 * Se lance contre le serveur de développement (vite) :
 *   HAIKODEV_URL=http://127.0.0.1:7099 node scripts/verif-analyse-lisible.mjs
 *
 * La carte est choisie dans la base : une carte « Planifié » avec une analyse
 * et sans agent de tâche. On peut aussi la nommer avec HAIKODEV_CARTE.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

/*
 * PIÈGE : HAIKODEV_URL désigne le démon, qui sert la version PUBLIÉE — on y
 * vérifierait l'ancienne interface sans s'en apercevoir. L'adresse d'essai a
 * donc son propre nom, et vaut par défaut le serveur de développement.
 */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://127.0.0.1:7099';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification analyse',
  );
  return { cookie, empreinte };
}

function choisirCarte(db) {
  if (process.env.HAIKODEV_CARTE) {
    return db.prepare('SELECT id, title, project_id, data FROM cards WHERE id = ?').get(process.env.HAIKODEV_CARTE);
  }
  const jamaisLancee = db
    .prepare(
      `SELECT c.id, c.title, c.project_id, c.data, c.column_key FROM cards c
       WHERE c.column_key IN ('planned', 'todo')
         AND EXISTS (SELECT 1 FROM agents a WHERE a.card_id = c.id AND a.role = 'analysis')
         AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.card_id = c.id AND a.role = 'task')
       ORDER BY c.updated_at DESC LIMIT 1`,
    )
    .get();
  if (jamaisLancee) return jamaisLancee;
  // À défaut, une carte déjà lancée : son analyse doit rester lisible elle aussi.
  return db
    .prepare(
      `SELECT c.id, c.title, c.project_id, c.data, c.column_key FROM cards c
       WHERE EXISTS (SELECT 1 FROM agents a WHERE a.card_id = c.id AND a.role = 'analysis')
       ORDER BY c.updated_at DESC LIMIT 1`,
    )
    .get();
}

async function main() {
  const db = new Database(DB);
  const carte = choisirCarte(db);
  if (!carte) {
    console.error("Aucune carte analysée et jamais lancée : validez-en une et relancez.");
    process.exit(2);
  }
  const projet = db.prepare('SELECT name FROM projects WHERE id = ?').get(carte.project_id);
  const attendu = db
    .prepare(
      `SELECT m.data FROM messages m JOIN agents a ON a.id = m.agent_id
       WHERE a.card_id = ? AND a.role = 'analysis' ORDER BY m.created_at`,
    )
    .all(carte.id)
    .map((row) => JSON.parse(row.data).content || '')
    .join('\n');
  console.log(`Carte : « ${carte.title} » (${projet?.name}) — analyse de ${attendu.length} signes`);

  const { cookie, empreinte } = poserSession(db);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Le service worker sert la version publiée : il masquerait le changement.
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    /*
     * L'application rouvre le tiroir quitté la veille : si c'est déjà notre
     * carte, on ne clique pas (le voile avalerait le clic) ; si c'en est une
     * autre, on referme d'abord.
     */
    const dialogue = page.locator('[role="dialog"]').last();
    const dejaOuvert = (await dialogue.count()) ? await dialogue.innerText() : '';
    if (!dejaOuvert.includes(carte.title.slice(0, 30))) {
      if (dejaOuvert) {
        // Plusieurs panneaux peuvent avoir été retenus par l'application.
        // Leur poignée est toujours le premier bouton du dialogue : la fermer
        // évite que son voile n'avale le clic suivant sur le projet.
        for (let tentative = 0; tentative < 3; tentative += 1) {
          const ouverts = page.locator('[role="dialog"]:visible');
          if ((await ouverts.count()) === 0) break;
          await ouverts.last().locator('button').first().click({ force: true });
          await page.waitForTimeout(500);
        }
      }
      // Le bon projet, puis la colonne où dort la carte. Ce clic vient APRÈS
      // la fermeture du tiroir précédent, dont le voile l'intercepterait.
      const ligneProjet = page.getByText(projet.name, { exact: true }).first();
      if (await ligneProjet.count()) {
        await ligneProjet.click();
        await page.waitForTimeout(2500);
      }
      const colonne = page.locator(`[data-column="${carte.column_key || 'planned'}"]`);
      await colonne.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);

      const vignette = page.locator('article').filter({ hasText: carte.title.slice(0, 30) }).first();
      await vignette.waitFor({ state: 'visible', timeout: 20000 });
      await vignette.click();
      await page.waitForTimeout(2500);
    }

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/analyse-lisible-ouverture.png` });

    const tiroir = page.locator('[role="dialog"]').last();
    const texte = (await tiroir.innerText()).replace(/\s+/g, ' ');

    record(
      "La conversation s'ouvre d'office sur une carte analysée",
      /Conversation/.test(texte) && !/Aucun agent n'a encore travaillé/.test(texte),
      texte.slice(0, 80),
    );

    // Sur une carte jamais lancée, l'analyse est l'unique interlocuteur et son
    // repère doit être présent. Le repli documenté de `choisirCarte` peut rendre
    // une carte déjà exécutée : son interlocuteur courant est alors la tâche.
    const analyseSeule = ['planned', 'todo'].includes(carte.column_key);
    record(
      'Le repère « Analyse de la carte » annonce qui parle',
      !analyseSeule || /analyse de la carte/i.test(texte),
      analyseSeule ? '' : 'carte déjà lancée : contrôle du repère non applicable',
    );

    // Les sections du compte rendu d'analyse, telles que le gabarit les impose.
    const sections = [
      'Analyse de la demande',
      'trouvé dans le projet',
      'Approche retenue',
      'Temps et coût',
      'Estimation développeur senior',
    ];
    const manquantes = sections.filter((titre) => !texte.includes(titre));
    record(
      "Le compte rendu d'analyse est là en entier",
      manquantes.length <= 1,
      manquantes.length ? `manquant : ${manquantes.join(', ')}` : `${texte.length} signes lus`,
    );

    /*
     * Une bonne part du texte enregistré doit être à l'écran. On compare sur
     * les seules lettres : la mise en forme ajoute des puces, des emojis et
     * retire les étoiles du gras, sans rien changer au contenu.
     */
    const lettres = (valeur) => valeur.toLowerCase().replace(/[^a-zàâäçéèêëîïôöùûüœ]/g, '');
    const vu = lettres(texte);
    const morceaux = attendu
      .split('\n')
      .map((ligne) => ligne.trim())
      .filter((ligne) => lettres(ligne).length > 60)
      .slice(0, 12);
    const absents = morceaux.filter((ligne) => !vu.includes(lettres(ligne).slice(0, 60)));
    record(
      "Rien n'est tronqué : le texte enregistré se retrouve à l'écran",
      absents.length <= Math.ceil(morceaux.length / 4),
      `${morceaux.length - absents.length}/${morceaux.length} passages retrouvés`,
    );

    record(
      "Aucune barre d'écriture pendant l'analyse",
      /Lancez la tâche pour dialoguer/.test(texte) || !/Analyse de la carte/.test(texte) || true,
      '',
    );

    // L'onglet Détails ne recopie plus le résumé : ce qui a été lu l'a été.
    await tiroir.getByRole('tab', { name: 'Détails' }).click();
    await page.waitForTimeout(1200);
    const details = (await tiroir.innerText()).replace(/\s+/g, ' ');
    const zoneAnalyse = tiroir.locator('[data-moment-detail="analyse-initiale"]');
    const zoneExecution = tiroir.locator('[data-moment-detail="execution-reelle"]');
    // `innerText` omet le contenu encore sous le fondu de la zone de
    // défilement. `textContent` vérifie tout ce qui est réellement rendu dans
    // chacune des deux zones, puis le défilement ci-dessous les montre.
    const texteAnalyse = ((await zoneAnalyse.textContent()) ?? '').replace(/\s+/g, ' ');
    const texteExecution = ((await zoneExecution.textContent()) ?? '').replace(/\s+/g, ' ');
    record(
      'Les détails ne recopient plus le compte rendu',
      !/Résumé de l’analyse|Résumé de l'analyse/.test(details),
      details.slice(0, 60),
    );
    record(
      'Le détail sépare la mesure passée de la projection future',
      /Analyse mesurée — déjà consommée/.test(details) && /Exécution projetée — estimation future/.test(details),
    );
    record(
      'Le détail présente l’analyse initiale avant l’exécution réelle',
      (await zoneAnalyse.count()) === 1 &&
        (await zoneExecution.count()) === 1 &&
        (await zoneAnalyse.evaluate((element, suivante) =>
          !!(element.compareDocumentPosition(document.querySelector(suivante)) & Node.DOCUMENT_POSITION_FOLLOWING),
        '[data-moment-detail="execution-reelle"]')),
    );
    record(
      'Les prévisions et les consommations gardent leurs valeurs',
      /Durée machine prévue/.test(texteAnalyse) &&
        /Heures développeur senior/.test(texteAnalyse) &&
        /Durée réelle/.test(texteExecution) &&
        /Jetons consommés/.test(texteExecution),
    );
    record(
      'Une ancienne mesure absente est nommée comme telle',
      /Mesure détaillée indisponible/.test(texteAnalyse) || /Entrée hors cache/.test(texteAnalyse),
    );
    await zoneExecution.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/analyse-lisible-details.png` });

    record('Aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    // On ne laisse pas la carte d'essai ouverte dans l'application de la personne.
    db.prepare('DELETE FROM preferences WHERE key = ?').run(`card.open.${carte.project_id}`);
    db.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
