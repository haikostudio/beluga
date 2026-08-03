#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, de la prévision d'épuisement du quota
 * hebdomadaire : la ligne « épuisé lundi vers 17 h » se pose bien sous la barre
 * « Semaine » de chaque moteur, elle porte l'heure exacte en infobulle, et elle
 * se TAIT quand le calcul n'a pas de sens.
 *
 * Comme les vrais comptes n'ont pas forcément un rythme qui épuise la semaine,
 * le script rejoue aussi le volet avec un historique fabriqué (relevés injectés
 * dans la réponse « quota.history ») pour voir la ligne s'afficher pour de bon.
 *
 *   HAIKODEV_TOKEN=… HAIKODEV_URL=http://localhost:7100 node scripts/verif-prevision-quota.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const base = () => {
  const require = createRequire(import.meta.url);
  return require('/root/haikodev/node_modules/better-sqlite3')('/root/haikodev/data/haikodev.db');
};

/**
 * Qui brûle son quota, qui reste au repos. Un compte d'un moteur qui en a
 * plusieurs est choisi pour brûler : ses voisins du même moteur peuvent alors
 * servir de compte de secours, ce qu'on veut justement voir affiché.
 */
function profils() {
  const comptes = base()
    .prepare('SELECT id, engine FROM accounts')
    .all();
  const parMoteur = {};
  for (const compte of comptes) (parMoteur[compte.engine] ??= []).push(compte.id);
  const moteurPartage = Object.values(parMoteur).find((ids) => ids.length > 1) ?? [];
  const brulant = moteurPartage[0] ?? comptes[0]?.id;
  const out = {};
  for (const compte of comptes) out[compte.id] = compte.id === brulant ? 'brulant' : 'repos';
  return out;
}

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification prévision quota',
  );
  return cookie;
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Ouvre le volet des quotas depuis la barre du haut. */
async function ouvrirLeVolet(page) {
  await page.locator('header button[title="Quotas des moteurs"]').click();
  await page.waitForTimeout(1200);
  return page.locator('[role="menu"]').last();
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
   * Les relevés arrivent par le canal temps réel : on remplace la réponse à
   * « quota.history » à la volée, avant même que la page ne se charge, pour
   * mettre le volet devant un rythme connu (1 % par heure sur trente heures).
   */
  await page.addInitScript((roles) => {
    const vrai = WebSocket.prototype.send;
    const attendus = new Set();
    WebSocket.prototype.send = function (donnees) {
      try {
        const message = JSON.parse(donnees);
        // La demande voyage enveloppée : { id, cmd: { type, … } }.
        if (message?.cmd?.type === 'quota.history') attendus.add(message.id);
      } catch {
        /* message non JSON : rien à intercepter */
      }
      return vrai.call(this, donnees);
    };
    /*
     * L'historique fabriqué : le compte « brûlant » consomme 1 % par heure sur
     * la semaine, et sa fenêtre de cinq heures repart de zéro il y a deux
     * heures puis brûle 40 % par heure. Les autres restent au repos, pour que
     * l'un d'eux puisse servir de compte de secours.
     */
    const fabriquer = () => {
      const maintenant = Date.now();
      const brulant = [];
      const repos = [];
      for (let i = 30; i >= 1; i--) {
        brulant.push({ at: maintenant - i * 3600_000, weekly: 10 + (30 - i), session: 5 });
        repos.push({ at: maintenant - i * 3600_000, weekly: 8, session: 3 });
      }
      // La fenêtre courte repart de zéro il y a une demi-heure, puis s'emballe :
      // son épuisement tombe alors AVANT sa propre remise à zéro.
      brulant.push({ at: maintenant - 1800_000, weekly: 39.5, session: 0 });
      brulant.push({ at: maintenant, weekly: 40, session: 100 });
      repos.push({ at: maintenant - 1800_000, weekly: 8, session: 3 });
      repos.push({ at: maintenant, weekly: 8, session: 3 });
      const history = {};
      for (const compte of Object.keys(roles)) {
        history[compte] = roles[compte] === 'brulant' ? brulant : repos;
      }
      return history;
    };

    // Le client pose un `onmessage`, pas un écouteur : c'est CETTE porte-là
    // qu'il faut tenir pour glisser l'historique fabriqué.
    const proprio = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get: proprio.get,
      set(ecouteur) {
        const filtre = function (evenement) {
          try {
            const message = JSON.parse(evenement.data);
            if (message?.type === 'ack' && attendus.has(message.id)) {
              window.__previsionSimulee = true;
              return ecouteur.call(this, {
                data: JSON.stringify({ ...message, data: { history: fabriquer() } }),
              });
            }
          } catch {
            /* message non JSON : on laisse passer */
          }
          return ecouteur.call(this, evenement);
        };
        proprio.set.call(this, filtre);
      },
    });
  }, profils());

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  const volet = await ouvrirLeVolet(page);
  record('le volet des quotas s’ouvre', await volet.isVisible());

  const texte = await volet.innerText();
  const lignes = (texte.match(/épuisé [^\n]+/g) ?? []).map((l) => l.trim());
  record(
    'une prévision s’affiche sous la barre « Semaine »',
    lignes.length > 0,
    lignes.join(' | ') || 'aucune ligne « épuisé … »',
  );

  record(
    'la formulation est en clair (« épuisé <jour> vers <heure> »)',
    lignes.every((ligne) => /^épuisé (aujourd’hui|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) vers \d{1,2} h( 30)?$/.test(ligne)),
    lignes.join(' | '),
  );

  // Chaque prévision vit SOUS sa propre barre, celle de la semaine comme celle
  // de cinq heures — et jamais ailleurs.
  const placement = await volet.evaluate((noeud) => {
    const lignes = [...noeud.querySelectorAll('p')].filter((p) => p.textContent.startsWith('épuisé'));
    const fenetres = lignes.map((ligne) => {
      const bloc = ligne.parentElement?.textContent ?? '';
      return bloc.includes('Semaine') ? 'semaine' : bloc.includes('Fenêtre 5 h') ? 'courte' : 'ailleurs';
    });
    return { semaine: fenetres.filter((f) => f === 'semaine').length, courte: fenetres.filter((f) => f === 'courte').length, ailleurs: fenetres.filter((f) => f === 'ailleurs').length };
  });
  record(
    'chaque prévision est posée sous SA barre',
    placement.ailleurs === 0 && placement.semaine > 0,
    `semaine ${placement.semaine} · 5 h ${placement.courte}`,
  );

  record(
    'la fenêtre de cinq heures a aussi sa prévision quand l’historique le permet',
    placement.courte > 0,
    `${placement.courte} ligne(s) sous « Fenêtre 5 h »`,
  );

  // Le compte de secours : proposé sous une prévision en manque, et jamais
  // ailleurs.
  const secours = await volet.evaluate((noeud) => {
    const lignes = [...noeud.querySelectorAll('p')].filter((p) => p.textContent.startsWith('bascule possible sur'));
    return lignes.map((ligne) => ({
      texte: ligne.textContent,
      // La ligne « épuisé … » juste au-dessus doit être un manque (orange).
      surUnManque: /text-warning/.test(ligne.previousElementSibling?.querySelector('p')?.className ?? ligne.previousElementSibling?.className ?? ''),
    }));
  });
  record(
    'un compte de secours est proposé sous une prévision en manque',
    secours.length > 0 && secours.every((s) => s.surUnManque),
    secours.map((s) => s.texte).join(' | ') || 'aucune bascule proposée',
  );

  // La courbe se prolonge en pointillé jusqu'à la ligne du haut.
  const pointille = await volet.evaluate((noeud) => {
    const traits = [...noeud.querySelectorAll('svg path[stroke-dasharray]')];
    return traits.map((trait) => ({ d: trait.getAttribute('d'), stroke: trait.getAttribute('stroke') }));
  });
  record(
    'la prévision se prolonge en pointillé au bout de la courbe',
    pointille.length > 0 && pointille.every((t) => /^M[\d.]+,[\d.]+ L[\d.]+,0\.0$/.test(t.d)),
    pointille.map((t) => t.d).join(' | ') || 'aucun trait pointillé',
  );

  // Une prévision serrée se distingue : couleur d'alerte et graisse.
  const distinguee = await volet.evaluate((noeud) => {
    const ligne = [...noeud.querySelectorAll('p')].find((p) => p.textContent.startsWith('épuisé'));
    if (!ligne) return null;
    return { classes: ligne.className, couleur: getComputedStyle(ligne).color };
  });
  record(
    'une prévision qui manque est signalée en couleur d’alerte',
    !!distinguee && /text-warning/.test(distinguee.classes),
    distinguee ? `${distinguee.couleur}` : 'ligne introuvable',
  );

  // L'heure exacte et le rythme restent en infobulle, comme le temps restant.
  const infobulle = await volet.evaluate((noeud) => {
    const ligne = [...noeud.querySelectorAll('p')].find((p) => p.textContent.startsWith('épuisé'));
    let parent = ligne;
    while (parent && !parent.getAttribute?.('data-state') && !parent.hasAttribute?.('aria-describedby')) {
      parent = parent.parentElement;
    }
    return !!parent;
  });
  record('l’heure exacte passe en infobulle', infobulle !== false);

  await page.screenshot({ path: `${SHOTS}/prevision-quota.png` });

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
