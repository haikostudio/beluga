#!/usr/bin/env node
/**
 * LE PARCOURS D'UNE CARTE S'ÉCRIT EN DIRECT, ET AVANT TOUT LANCEMENT.
 *
 *   node scripts/verif-parcours-en-direct.mjs
 *
 * CE QUE CE CONTRÔLE REMPLACE. Il s'appelait `verif-analyse-en-cours.mjs` et
 * guettait une phrase — « Analyse en cours » — dans une conversation vide, puis
 * un compte rendu à six titres rendu par un agent d'ANALYSE. Deux choses l'ont
 * périmé, et aucune n'est un regret :
 *
 *   – le chiffrage n'est plus un tour à part : c'est le CADRAGE qui discute la
 *     tâche, sans gabarit imposé (`runtime.ts`, « le cadrage est une
 *     conversation, pas un compte rendu ») ;
 *   – la conversation d'une carte n'est plus un fil de bulles avec un écran
 *     vide à remplir : elle EST le parcours de la carte (`chat.tsx`). Il n'y a
 *     donc plus de conversation vide où annoncer quoi que ce soit — il y a un
 *     journal qui s'écrit sous les yeux.
 *
 * CE QUI EST VÉRIFIÉ, DONC : une carte neuve s'ouvre sur la configuration de
 * son agent et rien d'autre ; la demande envoyée, la configuration se replie
 * VERROUILLÉE et le parcours prend sa place ; ce parcours S'ALLONGE PENDANT le
 * tour au lieu d'attendre la fin (les traces du point « Compréhension »
 * grandissent) ; il se referme sur la compréhension rendue, ouverte d'office,
 * traces techniques repliées et mémoire racontée dans le point. Et la carte n'a jamais quitté
 * « Planifié » : rien n'a été lancé.
 *
 * CE CONTRÔLE COÛTE UN VRAI TOUR. Il parle au démon en service et à un moteur
 * RÉEL : un tour de cadrage part, et il est facturé. C'est le prix de ce qu'il
 * prouve — le journal écrit par le vrai runtime, pas par un faux moteur (pour
 * la version gratuite et hors ligne, voir `verif-carte-fil-cadrage.mjs`).
 *
 * La carte d'essai est supprimée à la fin : le tableau ne se remplit pas.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { creerResultats } from './lib/verif-resultats.mjs';

/* L'interface jugée est celle du DÉPÔT (serveur de développement), le démon
   derrière elle est celui en service : c'est le code qu'on vient d'écrire,
   éprouvé sur les vraies données. */
const BASE = process.env.BELUGA_VERIF_URL || 'http://127.0.0.1:7099';
/* LA BASE RÉELLEMENT SERVIE, jamais un nom écrit à la main : `beluga.db` est un
   fichier VIDE tant que la machine n'a pas basculé, et SQLite l'ouvre sans
   broncher — le contrôle échouait alors sur « no such table: sessions ». */
const DB = process.env.BELUGA_DB || cheminDeLaBaseServie();
const PROJET = process.env.BELUGA_PROJET || 'Beluga';
const SHOTS = `${process.env.BELUGA_DATA || '/root/beluga/data'}/verification`;
const DEMANDE =
  process.env.BELUGA_DEMANDE ||
  "Carte d'essai d'une vérification automatique : ne modifie RIEN, ne lance aucune commande d'écriture. Dis-moi seulement, en trois lignes, où se trouve le composant de la conversation d'une carte.";
/* Le tour de cadrage lit le projet : il lui faut plus que quelques secondes. */
const ATTENTE_MAX_MS = Number(process.env.BELUGA_ATTENTE_MS || 6 * 60_000);

const { results, record } = creerResultats();
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const compter = (page, selecteur) => page.locator(selecteur).count();
const texteDe = async (page, selecteur) =>
  (await compter(page, selecteur)) ? (await page.locator(selecteur).first().innerText()) : '';

async function main() {
  const db = new Database(DB);
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3600_000,
    'vérification parcours en direct',
  );

  /* La carte d'essai est reconnue par son IDENTIFIANT, jamais par son titre :
     une carte de cadrage naît sans titre choisi, et le cadrage lui en donnera
     un. On relève donc les cartes AVANT le clic pour isoler la nouvelle. */
  const idsDesCartes = () => new Set(db.prepare('SELECT id FROM cards').all().map((c) => c.id));
  const carteEnBase = (id) => db.prepare('SELECT id, column_key, title FROM cards WHERE id = ?').get(id);
  const agentsDeLaCarte = (id) => db.prepare('SELECT id, role FROM agents WHERE card_id = ?').all(id);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));

  let carteId = null;

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await attendre(5000);

    /* LE TABLEAU EN SERVICE PEUT ÊTRE OUVERT SUR AUTRE CHOSE — un tiroir de
       carte laissé ouvert, un dialogue. Son voile intercepte tous les clics :
       on referme ce qui traîne AVANT de viser le projet, sinon le contrôle
       échouerait sur l'état où l'on a trouvé l'écran, pas sur son sujet. */
    const refermerCeQuiTraine = async () => {
      for (let essai = 0; essai < 4; essai += 1) {
        const tiroir = page.locator('[role="dialog"]').last();
        if (!(await tiroir.count())) return;
        /* La touche « Échap » ne referme que le tiroir QUI A LE FOCUS : sur une
           page tout juste chargée, il est resté au corps du document. On pose
           donc le doigt dans un coin inerte du tiroir avant de la presser. */
        await tiroir.click({ position: { x: 10, y: 10 } }).catch(() => undefined);
        await page.keyboard.press('Escape');
        await attendre(1200);
      }
    };
    await refermerCeQuiTraine();

    await page.getByText(PROJET, { exact: true }).first().click();
    await attendre(2500);
    await refermerCeQuiTraine();

    /* ---------- 1. Une carte neuve, née d'un clic ---------- */

    const avant = idsDesCartes();
    const tuile = page.locator('[data-column="planned"] [data-nouvelle-carte="planned"]');
    await tuile.scrollIntoViewIfNeeded();
    await tuile.click();
    await attendre(3500);

    const nouvelles = [...idsDesCartes()].filter((id) => !avant.has(id));
    carteId = nouvelles[0] ?? null;
    record(
      'un clic sur « Nouvelle tâche » fait naître UNE carte',
      nouvelles.length === 1,
      `${nouvelles.length} carte(s) née(s)`,
    );
    record(
      'elle naît dans « Planifié », avec son agent de cadrage',
      carteEnBase(carteId)?.column_key === 'planned' &&
        agentsDeLaCarte(carteId).some((a) => a.role === 'cadrage'),
      `${carteEnBase(carteId)?.column_key ?? '—'} · ${agentsDeLaCarte(carteId).map((a) => a.role).join(', ') || 'aucun agent'}`,
    );

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/parcours-en-direct-1-configuration.png` });

    /* ---------- 2. Elle s'ouvre sur la CONFIGURATION, et sur rien d'autre ---------- */

    record(
      'sa conversation s’ouvre sur la CONFIGURATION de son agent',
      (await compter(page, '[data-carte-configuration]')) === 1,
    );
    record(
      '…seule : aucun parcours, aucune ligne de réglages figés tant que rien n’est dit',
      (await compter(page, '[data-flux-points]')) === 0 &&
        (await compter(page, '[data-reglages-agent]')) === 0,
    );
    record(
      '…et aucun onglet « Parcours » ne double la conversation',
      !(await texteDe(page, '[data-barre-onglets]')).includes('Parcours'),
    );
    record(
      'la barre d’écriture attend la demande',
      (await compter(page, '[data-composer] textarea')) >= 1,
    );

    /* ---------- 3. La demande part : UN TOUR RÉEL, ET LE SEUL ---------- */

    const champ = page.locator('[data-composer] textarea').last();
    await champ.click();
    await champ.fill(DEMANDE);
    await page.keyboard.press('Enter');

    /*
     * PENDANT LE TOUR, ON REGARDE — c'est tout l'objet de ce contrôle. Le
     * parcours doit APPARAÎTRE puis GRANDIR sous les yeux, sans qu'on ait rien
     * lancé et sans attendre la fin du tour. On échantillonne donc au lieu de
     * ne juger qu'à l'arrivée.
     */
    const mesures = [];
    let colonneVueAilleurs = null;
    let reponseVue = false;
    const finDAttente = Date.now() + ATTENTE_MAX_MS;
    while (Date.now() < finDAttente) {
      await attendre(2500);
      mesures.push(await page.locator('[data-point="comprehension"] [data-bloc-raconte]').count());
      const ou = await page.evaluate(
        (id) => document.querySelector(`[data-carte="${id}"]`)?.closest('[data-column]')?.getAttribute('data-column') ?? null,
        carteId,
      );
      if (ou && ou !== 'planned') colonneVueAilleurs = ou;
      if ((await compter(page, '[data-moment="comprehension"]')) >= 1 && (await compter(page, '[data-point="comprehension"][data-point-etat="fait"]')) >= 1) {
        reponseVue = true;
        break;
      }
    }
    const pendant = mesures.filter((n) => n > 0);
    await page.screenshot({ path: `${SHOTS}/parcours-en-direct-2-tour.png`, fullPage: false });

    record(
      'la configuration se REPLIE en une ligne dès que la demande est partie, encore modifiable jusqu’au plan validé',
      (await compter(page, '[data-carte-configuration]')) === 0 &&
        (await compter(page, '[data-reglages-agent="modifiable"]')) === 1,
    );
    record(
      '…repliée : ses lignes de choix ne vivent que dans son tiroir',
      (await compter(page, '[data-ligne-configuration]')) === 0 &&
        (await compter(page, '[data-reglages-avant-lancement]')) === 0,
    );
    record(
      'le PARCOURS prend la place du fil de messages',
      (await compter(page, '[data-flux-points]')) === 1 &&
        (await compter(page, '[data-flux-cadrage]')) === 0,
    );
    record(
      'il s’écrit PENDANT le tour, il n’attend pas la fin — les traces du point « Compréhension » grandissent',
      pendant.length >= 2 && pendant[pendant.length - 1] > pendant[0],
      `entrées vues : ${pendant.join(' → ') || 'aucune'}`,
    );
    /*
     * LA DEMANDE DE DÉPART EST LE POINT « DEMANDE », et son TEXTE se lit sans
     * clic : tous les grands points sont ouverts d'office.
     */
    const detailDeLaDemande = await texteDe(page, '[data-point="demande"]');
    record(
      'la demande écrite ouvre le parcours, et son texte exact se lit dans son point, ouvert d’office',
      (await compter(page, '[data-point="demande"][data-point-ouvert="oui"]')) >= 1 && detailDeLaDemande.includes(DEMANDE.slice(0, 40)),
      `${detailDeLaDemande.length} signes`,
    );
    record(
      'la barre d’étapes dit le moment où l’on est, sans illustration',
      (await compter(page, '[data-barre-etapes]')) === 1 && (await compter(page, '[data-segment]')) === 5,
      await page.locator('[data-barre-etapes]').getAttribute('data-barre-etapes').catch(() => '—'),
    );

    /* ---------- 4. Le point « Compréhension » se referme sur ce que l'agent a compris ---------- */

    record(
      'le tour a rendu sa compréhension dans le temps imparti',
      reponseVue,
      reponseVue ? '' : `rien après ${Math.round(ATTENTE_MAX_MS / 1000)} s`,
    );
    const texteComprehension = await texteDe(page, '[data-point="comprehension"] [data-moment="comprehension"]');
    record(
      'le point « Compréhension » est ouvert d’office sur ce que l’agent a compris',
      (await compter(page, '[data-point="comprehension"][data-point-ouvert="oui"]')) >= 1 && texteComprehension.length > 40,
      `${texteComprehension.length} signes`,
    );
    record(
      '…et ses traces techniques restent repliées, un geste plus loin',
      (await compter(page, '[data-point="comprehension"] [data-blocs-racontes]')) >= 1 &&
        (await compter(page, '[data-point-traces-contenu]')) === 0,
    );
    record(
      '…et le flux raconte la mémoire que la compréhension a ouverte',
      (await compter(page, '[data-point="comprehension"] [data-point-memoire], [data-point="demande"] [data-point-memoire]')) >= 1,
    );
    await page.screenshot({ path: `${SHOTS}/parcours-en-direct-3-reponse.png` });

    /* ---------- 5. Rien n'a été lancé ---------- */

    record(
      'la carte n’a JAMAIS quitté « Planifié » à l’écran : discuter n’est pas lancer',
      colonneVueAilleurs === null,
      colonneVueAilleurs ? `vue dans « ${colonneVueAilleurs} »` : 'jamais vue ailleurs',
    );
    record(
      '…ni en base',
      carteEnBase(carteId)?.column_key === 'planned',
      carteEnBase(carteId)?.column_key ?? '—',
    );
    record('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

    /* ---------- 6. La carte d'essai ne reste pas sur le tableau ---------- */

    await page.locator('[role="dialog"]').last().getByRole('button', { name: 'Autres actions' }).click();
    await attendre(700);
    await page.getByRole('menuitem', { name: /Supprimer la carte/ }).click();
    await attendre(700);
    await page.getByRole('button', { name: /Supprimer la carte/ }).click();
    await attendre(2500);
    record('la carte d’essai a été retirée du tableau', !carteEnBase(carteId));
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    if (carteId && carteEnBase(carteId)) {
      console.log(`\n⚠ Carte d'essai encore présente : ${carteId} — à supprimer à la main.`);
    }
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
