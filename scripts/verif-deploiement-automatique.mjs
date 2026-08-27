#!/usr/bin/env node
/**
 * L'INTERRUPTEUR « DÉPLOIEMENT AUTOMATIQUE », VÉRIFIÉ DANS UN VRAI NAVIGATEUR.
 *
 * Il vit en tête de la colonne « À déployer », et NULLE PART AILLEURS. Éteint
 * par défaut sur tout projet, il vaut, une fois allumé, consentement
 * permanent : dès que plus rien ne travaille, le lot posé dans « À déployer »
 * part et la mise en ligne suit, sans clic.
 *
 * Ce que ce contrôle juge, et pourquoi une relecture n'y suffit pas :
 *
 *  1. l'interrupteur est bien LÀ, dans l'entête de « À déployer » ;
 *  2. il n'est nulle part ailleurs — une colonne qui le porterait laisserait
 *     croire qu'on règle la mise en production au même endroit ;
 *  3. il est ÉTEINT sur un projet qui n'a jamais rien réglé (la valeur par
 *     défaut du modèle, vue de l'écran) ;
 *  4. un projet dont le réglage est allumé l'affiche ALLUMÉ — c'est bien le
 *     champ du projet qui commande l'affichage, pas un état local ;
 *  5. son repère technique (`aria-label`) ne dépend pas de la langue.
 *
 * Le réglage est posé par le point d'essai (`window.haikodevEssai.projet`) : il
 * n'écrit RIEN sur le serveur, aucun vrai projet n'est modifié.
 *
 * La décision de partir, elle, est une règle PURE et se juge sans navigateur :
 * `server/src/test/deploiement-automatique.test.ts`.
 *
 *   HAIKO_DEPLOI_AUTO_URL=http://localhost:7099 node scripts/verif-deploiement-automatique.mjs
 */
import path from 'node:path';

const ADRESSE = process.env.HAIKO_DEPLOI_AUTO_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';

const refus = [];
const reussites = [];
const juger = (ok, phrase) => (ok ? reussites : refus).push(phrase);

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. Seule écriture en base de ce contrôle,
 * et elle est défaite en partant.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification du déploiement automatique',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  return avecSession(async (session) => {
    const navigateur = await chromium.launch({ channel: 'chrome' });
    const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 950 } });
    await contexte.addCookies([{ name: 'haikodev_session', value: session, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    try {
      await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch (err) {
      await navigateur.close();
      return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
    }
    try {
      await dansLaPage(page);
    } finally {
      await navigateur.close();
    }
    return null;
  });
}

async function dansLaPage(page) {
  await page.waitForTimeout(6000);

  const point = await page.evaluate(() => typeof window.haikodevEssai?.projet === 'function');
  if (!point) return juger(false, 'le point d’essai `window.haikodevEssai.projet` est absent de la page');

  const projets = await page.evaluate(() => window.haikodevEssai.projets());
  if (!projets.length) return juger(false, 'aucun projet dans la base : impossible d’afficher un tableau');
  const projet = projets[0];

  // Le réglage remis à zéro AVANT de juger le défaut : le projet d'essai a pu
  // être allumé par un passage précédent.
  await page.evaluate((id) => {
    window.haikodevEssai.projet(id, { deploiementAutomatique: false });
    window.haikodevEssai.ouvrirProjet(id);
  }, projet.id);
  await page.waitForTimeout(1500);

  /* 1 & 2 — UN SEUL interrupteur, dans l'entête de « À déployer ». */
  const places = await page.evaluate(() =>
    [...document.querySelectorAll('[data-deploiement-automatique]')].map((noeud) => ({
      colonne: noeud.closest('[data-tete-colonne]')?.getAttribute('data-tete-colonne') ?? null,
      etat: noeud.getAttribute('data-deploiement-automatique'),
      repere: noeud.getAttribute('aria-label'),
    })),
  );
  juger(places.length === 1, `un seul interrupteur sur le tableau — ${places.length} trouvé(s)`);
  juger(
    places.length === 1 && places[0].colonne === 'to_deploy',
    `l’interrupteur vit dans l’entête de « À déployer » — vu dans « ${places[0]?.colonne ?? 'nulle part'} »`,
  );

  /* 3 — ÉTEINT par défaut : publier reste sinon un geste de l'utilisateur. */
  juger(places[0]?.etat === 'non', `éteint par défaut — état lu « ${places[0]?.etat ?? 'aucun'} »`);

  /* 5 — le repère technique ne bouge pas avec la langue. */
  juger(
    places[0]?.repere === 'Déploiement automatique',
    `le repère « aria-label » reste en français — lu « ${places[0]?.repere ?? 'aucun'} »`,
  );

  /* 4 — c'est bien le champ du PROJET qui commande l'affichage. */
  await page.evaluate((id) => window.haikodevEssai.projet(id, { deploiementAutomatique: true }), projet.id);
  await page.waitForTimeout(1000);
  const allume = await page.evaluate(
    () => document.querySelector('[data-deploiement-automatique]')?.getAttribute('data-deploiement-automatique'),
  );
  juger(allume === 'oui', `le réglage du projet allume l’interrupteur — état lu « ${allume ?? 'aucun'} »`);

  // On repart comme on est venu : le réglage local est rendu à son état d'avant.
  await page.evaluate((id) => window.haikodevEssai.projet(id, { deploiementAutomatique: false }), projet.id);
}

console.log('\nL’INTERRUPTEUR « DÉPLOIEMENT AUTOMATIQUE »\n');
const panne = await auNavigateur().catch((err) => `contrôle impossible — ${err.message.split('\n')[0]}`);
if (panne) {
  console.log(`  ✗ ${panne}\n`);
  process.exit(1);
}
for (const phrase of reussites) console.log(`  ✓ ${phrase}`);
for (const phrase of refus) console.log(`  ✗ ${phrase}`);
console.log(refus.length ? `\n${refus.length} refus.\n` : '\nTout est en place.\n');
process.exit(refus.length ? 1 : 0);
