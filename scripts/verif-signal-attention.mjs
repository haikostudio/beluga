#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, des signaux de la colonne de gauche —
 * « ce projet attend une réponse » ET « ce projet a terminé quelque chose » :
 *
 *  - à l'ARRIVÉE d'une demande, la ligne du projet fait une petite secousse ;
 *  - un travail RENDU pas encore consulté secoue la ligne LUI AUSSI ;
 *  - la secousse ne se rejoue PAS en boucle, ni sur un compte inchangé ;
 *  - le projet déjà ouvert et regardé ne bouge jamais ;
 *  - le triangle d'alerte reste tant que la demande est en attente ;
 *  - le MÊME triangle se pose là où la décision se prend : sur la carte du
 *    tableau, et sur l'entrée de conversation quand aucune carte n'est en jeu ;
 *  - le compte annoncé sur le projet vaut le nombre de repères visibles ;
 *  - le triangle du projet EMMÈNE à la première décision (clic) ;
 *  - le badge bleu clignote tant que le travail n'a pas été consulté, et
 *    s'éteint dès que le compte retombe (conversation ouverte) ;
 *  - un groupe replié qui contient un tel projet porte les mêmes signaux.
 *
 * Les demandes sont SIMULÉES : on injecte les événements « attention » et
 * « rendus » dans le canal temps réel, sans toucher à la base ni déranger un
 * agent au travail.
 *
 *   HAIKODEV_URL=http://localhost:7133 node scripts/verif-signal-attention.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const require = createRequire(import.meta.url);
  const db = require('/root/haikodev/node_modules/better-sqlite3')('/root/haikodev/data/haikodev.db');
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification signal attention',
  );
  return cookie;
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    // Sans cela, un poste réglé sur « réduire les animations » éteindrait la
    // secousse et le clignotement : on ne jugerait plus rien.
    reducedMotion: 'no-preference',
    ignoreHTTPSErrors: true,
    // Sinon c'est la version PUBLIÉE qui s'affiche, pas celle qu'on vérifie.
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: poserSession(), url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  /*
   * On garde la main sur le canal temps réel : « __attention(compte) » rejoue
   * l'événement du serveur tel qu'il arriverait pour de vrai.
   */
  await page.addInitScript(() => {
    window.__ecouteurs = [];
    // L'application pose sa fonction sur « onmessage » : c'est donc là qu'on
    // se greffe, sans rien remplacer de ce qui arrive vraiment du serveur.
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    const rejouer = (type, byProject, extra) => {
      const donnees = JSON.stringify({ type, byProject, ...extra });
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
    /*
     * Le serveur envoie le compte ET le détail : où chaque décision se prend.
     * Sans détail, on rejoue l'ancien message — c'est ce qui permet de vérifier
     * qu'une version d'avant ne casse rien.
     */
    window.__attention = (byProject, decisions) =>
      rejouer('attention', byProject, decisions ? { decisions } : undefined);
    // Le travail rendu et pas encore lu : le serveur le diffuse pareillement.
    window.__rendus = (byProject) => rejouer('rendus', byProject);
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  // L'application reprend l'endroit quitté : un tiroir resté ouvert masquerait
  // la colonne de gauche.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /*
   * Tous les groupes sont dépliés le temps du contrôle : sinon le projet
   * ouvert peut être caché dans un groupe replié, et il n'y aurait plus rien
   * à comparer. On les rend à leur état d'origine à la fin.
   */
  page.setDefaultTimeout(8000);
  const basculerGroupe = async (id) => {
    try {
      await page.locator(`[data-drag-kind="group"][data-drag-id="${id}"] button`).first().click();
      await page.waitForTimeout(250);
      return true;
    } catch {
      return false;
    }
  };
  const groupesReplies = [];
  for (const id of await page.locator('[data-drag-kind="group"]').evaluateAll((n) =>
    n.map((g) => g.getAttribute('data-drag-id')),
  )) {
    const replie = await page.evaluate(
      (identifiant) =>
        !document.querySelector(`[data-drop-group="${identifiant}"] [data-drag-kind="project"]`),
      id,
    );
    if (!replie) continue;
    if (await basculerGroupe(id)) groupesReplies.push(id);
  }

  const lignes = page.locator('[data-drag-kind="project"]');
  const total = await lignes.count();
  record('la colonne des projets s’affiche', total > 0, `${total} projet(s)`);
  if (!total) {
    await browser.close();
    process.exit(1);
  }

  /** Le projet ouvert (fond marqué) et un autre, qu'on ne regarde pas. */
  const ids = await lignes.evaluateAll((noeuds) =>
    noeuds.map((n) => ({ id: n.getAttribute('data-drag-id'), actif: n.className.includes('bg-raised') })),
  );
  const actif = ids.find((p) => p.actif);
  const dormant = ids.find((p) => !p.actif);
  record('un projet est ouvert et un autre ne l’est pas', !!actif && !!dormant);

  const ligneDe = (id) => page.locator(`[data-drag-kind="project"][data-drag-id="${id}"]`);
  const secoue = async (id) => (await ligneDe(id).getAttribute('class')).includes('animate-secousse');

  /* --- 1. L'arrivée d'une demande secoue la ligne ------------------- */
  if (dormant) {
    await page.evaluate((id) => window.__attention({ [id]: 1 }), dormant.id);
    await page.waitForTimeout(120);
    record('la ligne bouge à l’arrivée d’une demande', await secoue(dormant.id));

    const triangle = ligneDe(dormant.id).locator('[data-signal-attention]');
    record('elle porte le triangle d’attention', (await triangle.count()) === 1);

    await page.screenshot({ path: `${SHOTS}/signal-attention.png` });

    /* --- 2. La secousse s'arrête : elle signale, elle ne harcèle pas -- */
    await page.waitForTimeout(1200);
    record('la secousse s’arrête d’elle-même', !(await secoue(dormant.id)));
    record('le triangle, lui, reste', (await triangle.count()) === 1);

    /* --- 3. Le même compte ne rejoue rien ---------------------------- */
    await page.evaluate((id) => window.__attention({ [id]: 1 }), dormant.id);
    await page.waitForTimeout(200);
    record('un compte inchangé ne relance pas la secousse', !(await secoue(dormant.id)));

    /* --- 4. Une demande de PLUS secoue de nouveau -------------------- */
    await page.evaluate((id) => window.__attention({ [id]: 2 }), dormant.id);
    await page.waitForTimeout(120);
    record('une demande de plus fait bouger la ligne à nouveau', await secoue(dormant.id));
    await page.waitForTimeout(1200);

    /* --- 5. Plus rien en attente : le triangle s'éteint --------------- */
    await page.evaluate(() => window.__attention({}));
    await page.waitForTimeout(200);
    record('le triangle s’éteint quand plus rien n’attend', (await triangle.count()) === 0);
    record('et rien ne bouge quand le compte retombe', !(await secoue(dormant.id)));
  }

  /* --- 6. Un travail RENDU non consulté secoue la ligne, lui aussi ---- */
  if (dormant) {
    const badge = ligneDe(dormant.id).locator('[data-signal-termine]');
    /* On part d'une page blanche : le serveur diffuse l'état RÉEL, et des
       travaux déjà rendus fausseraient la comparaison « avant / après ». */
    await page.evaluate(() => window.__rendus({}));
    await page.waitForTimeout(250);
    record('aucun badge bleu tant que rien n’a été rendu', (await badge.count()) === 0);

    await page.evaluate((id) => window.__rendus({ [id]: 1 }), dormant.id);
    await page.waitForTimeout(120);
    record('la ligne bouge quand un agent vient de terminer', await secoue(dormant.id));
    record('elle porte le badge bleu du travail terminé', (await badge.count()) === 1);

    // Il clignote pour de vrai, et il est bien bleu : sinon il se confondrait
    // avec la pastille verte, qui ne bouge pas.
    const allure = await badge.evaluate((noeud) => {
      const style = getComputedStyle(noeud);
      return { animation: style.animationName, couleur: style.backgroundColor };
    });
    record('le badge clignote', allure.animation !== 'none', allure.animation);
    record('et il est bleu', /rgb\(\s*\d+,\s*\d+,\s*(1[5-9]\d|2[0-5]\d)\s*\)/.test(allure.couleur), allure.couleur);

    // La pastille verte chiffrée a disparu : elle disait la MÊME chose que le
    // point bleu, sur la même ligne de quelques centimètres.
    record(
      'plus de pastille verte chiffrée à côté',
      (await ligneDe(dormant.id).locator('button[aria-label^="Marquer"]').count()) === 0,
    );
    // Le geste « j'ai vu » n'est pas perdu pour autant : le point se clique.
    record(
      'le point bleu se clique pour marquer comme lu',
      (await badge.evaluate((n) => n.tagName)) === 'BUTTON',
    );

    /* --- 6 bis. Un seul repère à la fois : la décision l'emporte ------- */
    await page.evaluate((id) => window.__attention({ [id]: 1 }), dormant.id);
    await page.waitForTimeout(200);
    const triangleAussi = ligneDe(dormant.id).locator('[data-signal-attention]');
    record('une décision qui arrive prend la place', (await triangleAussi.count()) === 1);
    record('et le point bleu s’efface le temps de la décision', (await badge.count()) === 0);

    await page.evaluate(() => window.__attention({}));
    await page.waitForTimeout(200);
    record('la décision réglée, le point bleu revient tout seul', (await badge.count()) === 1);

    await page.screenshot({ path: `${SHOTS}/signal-travail-termine.png` });

    await page.waitForTimeout(1200);
    record('la secousse du travail terminé s’arrête aussi', !(await secoue(dormant.id)));
    record('le badge bleu, lui, reste', (await badge.count()) === 1);

    await page.evaluate((id) => window.__rendus({ [id]: 1 }), dormant.id);
    await page.waitForTimeout(200);
    record('un travail déjà signalé ne relance pas la secousse', !(await secoue(dormant.id)));

    /* La conversation ouverte : le serveur repousse le repère de lecture et le
       compte retombe à zéro — le badge doit s'éteindre. */
    await page.evaluate(() => window.__rendus({}));
    await page.waitForTimeout(200);
    record('le badge s’éteint dès que le travail est consulté', (await badge.count()) === 0);
    record('et la ligne ne bouge pas pour autant', !(await secoue(dormant.id)));
  }

  /* --- 7. Le projet qu'on regarde déjà ne bouge pas ------------------ */
  if (actif) {
    await page.evaluate((id) => window.__attention({ [id]: 1 }), actif.id);
    await page.waitForTimeout(200);
    record('le projet ouvert et regardé ne bouge pas', !(await secoue(actif.id)));
    record(
      'mais il porte quand même son triangle',
      (await ligneDe(actif.id).locator('[data-signal-attention]').count()) === 1,
    );
    await page.evaluate(() => window.__attention({}));

    await page.evaluate((id) => window.__rendus({ [id]: 1 }), actif.id);
    await page.waitForTimeout(200);
    record('un travail rendu ne secoue pas le projet déjà ouvert', !(await secoue(actif.id)));
    record(
      'mais son badge bleu s’allume quand même',
      (await ligneDe(actif.id).locator('[data-signal-termine]').count()) === 1,
    );
    await page.evaluate(() => window.__rendus({}));
  }

  /* --- 7 bis. La décision se voit LÀ OÙ elle se prend ---------------- */
  if (actif) {
    /*
     * On travaille sur le projet OUVERT : c'est le seul dont les cartes sont
     * chargées, donc affichées. La carte est prise dans la base, comme la
     * session : on ne devine aucun identifiant.
     */
    const require = createRequire(import.meta.url);
    const db = require('/root/haikodev/node_modules/better-sqlite3')('/root/haikodev/data/haikodev.db');
    const carte = db
      /* « À faire » d'abord : c'est la colonne visible d'emblée, donc celle où
         la copie d'écran montre vraiment quelque chose. */
      .prepare(
        `SELECT id FROM cards WHERE project_id = ? AND column_key <> 'archived'
         ORDER BY column_key = 'todo' DESC, position DESC LIMIT 1`,
      )
      .get(actif.id);
    db.close();

    if (!carte) {
      record('report sur la carte : aucune carte au tableau', true, 'contrôle sauté');
    } else {
      const surLaCarte = page.locator(`[data-attention-carte="${carte.id}"]`);
      const surLaConversation = page.locator(`[data-attention-conversation="${actif.id}"]`);

      // 1. Une décision née dans le travail d'une CARTE.
      await page.evaluate(
        ({ projet, carteId }) =>
          window.__attention({ [projet]: 1 }, [
            { projectId: projet, agentId: 'agent-essai', cardId: carteId, genre: 'question' },
          ]),
        { projet: actif.id, carteId: carte.id },
      );
      await page.waitForTimeout(250);
      record('la carte concernée porte le triangle', (await surLaCarte.count()) >= 1);
      record(
        'et la conversation ne le porte PAS : sinon la décision compterait deux fois',
        (await surLaConversation.count()) === 0,
      );
      await page.screenshot({ path: `${SHOTS}/decision-sur-la-carte.png` });

      // 2. Le clic sur le triangle du projet EMMÈNE à cette carte : son tiroir
      //    s'ouvre, et l'onglet de la conversation porte le même triangle.
      await ligneDe(actif.id).locator('[data-signal-attention]').click();
      await page.waitForTimeout(900);
      record('le triangle du projet ouvre la carte en attente', (await surLaCarte.count()) >= 2);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // 3. Une décision qui ne tient à AUCUNE carte : c'est la conversation.
      await page.evaluate(
        (projet) =>
          window.__attention({ [projet]: 1 }, [
            { projectId: projet, agentId: 'agent-essai', genre: 'validation' },
          ]),
        actif.id,
      );
      await page.waitForTimeout(250);
      record("l'entrée de conversation porte le triangle", (await surLaConversation.count()) >= 1);
      record('et aucune carte ne s’allume à tort', (await surLaCarte.count()) === 0);
      await page.screenshot({ path: `${SHOTS}/decision-sur-la-conversation.png` });

      // 4. La décision prise : les trois repères s'éteignent ENSEMBLE.
      await page.evaluate(() => window.__attention({}, []));
      await page.waitForTimeout(250);
      record(
        'la décision prise, plus un seul repère nulle part',
        (await surLaCarte.count()) === 0 &&
          (await surLaConversation.count()) === 0 &&
          (await ligneDe(actif.id).locator('[data-signal-attention]').count()) === 0,
      );

      // 5. Un serveur d'avant, qui n'envoie pas le détail : rien ne casse, la
      //    ligne du projet s'allume seule plutôt que de faire tomber la page.
      await page.evaluate((projet) => window.__attention({ [projet]: 1 }), actif.id);
      await page.waitForTimeout(200);
      record(
        'un compte sans détail n’allume que la ligne du projet',
        (await ligneDe(actif.id).locator('[data-signal-attention]').count()) === 1 &&
          (await surLaCarte.count()) === 0,
      );
      await page.evaluate(() => window.__attention({}, []));
      await page.waitForTimeout(200);
    }
  }

  /* --- 8. Un groupe replié porte les signaux de ses projets ---------- */
  const groupes = page.locator('[data-drag-kind="group"]');
  if (await groupes.count()) {
    // Tous les groupes sont dépliés à ce stade : on lit les membres du premier.
    const membres = await page.evaluate(() => {
      for (const groupe of document.querySelectorAll('[data-drop-group]')) {
        const ids = [...groupe.querySelectorAll('[data-drag-kind="project"]')].map((n) =>
          n.getAttribute('data-drag-id'),
        );
        if (ids.length) return { groupeId: groupe.getAttribute('data-drop-group'), ids };
      }
      return null;
    });
    if (membres?.ids?.length) {
      // On replie le groupe, puis on fait arriver une demande dans un membre.
      await basculerGroupe(membres.groupeId);
      await page.evaluate((id) => window.__attention({ [id]: 1 }), membres.ids[0]);
      await page.waitForTimeout(150);
      const ligneGroupe = page.locator(`[data-drag-kind="group"][data-drag-id="${membres.groupeId}"]`);
      record(
        'un groupe replié porte le triangle de ses projets',
        (await ligneGroupe.locator('[data-signal-attention]').count()) === 1,
      );
      await page.evaluate(() => window.__attention({}));

      // Et le badge bleu, de même : replier ne doit rien cacher.
      await page.evaluate(() => window.__rendus({}));
      await page.waitForTimeout(250);
      await page.evaluate((id) => window.__rendus({ [id]: 1 }), membres.ids[0]);
      await page.waitForTimeout(150);
      record(
        'un groupe replié porte le badge bleu de ses projets',
        (await ligneGroupe.locator('[data-signal-termine]').count()) === 1,
      );
      // Un groupe qui contient le projet OUVERT est déjà sous les yeux : il ne
      // bouge pas, et le contrôle n'aurait aucun sens.
      const regarde = actif ? membres.ids.includes(actif.id) : false;
      const bouge = (await ligneGroupe.getAttribute('class')).includes('animate-secousse');
      record(
        regarde
          ? 'le groupe du projet ouvert ne bouge pas, comme attendu'
          : 'et il bouge quand l’un d’eux vient de terminer',
        regarde ? !bouge : bouge,
      );
      await page.evaluate(() => window.__rendus({}));
      await page.waitForTimeout(150);
      // On rend la colonne telle qu'on l'a trouvée : le groupe se redéplie.
      await basculerGroupe(membres.groupeId);
    } else {
      record('groupe replié : aucun groupe peuplé à contrôler', true, 'contrôle sauté');
    }
  } else {
    record('groupe replié : aucun groupe à contrôler', true, 'contrôle sauté');
  }

  // La colonne est rendue telle qu'elle était : ce qui était replié le redevient.
  for (const id of groupesReplies) await basculerGroupe(id);

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));

  await browser.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
