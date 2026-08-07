#!/usr/bin/env node
/**
 * Le bloc de publication repart-il à zéro après une mise en ligne réussie ?
 *
 * On ouvre le tableau sur un projet dont la DERNIÈRE publication a réussi et
 * qui a de nouveau des cartes prêtes à partir. On vérifie que le bouton
 * « Tout déployer » est là, et que le rapport du passage précédent — ses sept
 * étapes cochées — a bien laissé la place.
 *
 *   node scripts/verif-bloc-publication.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const BASE_DB = '/root/haikodev/data/haikodev.db';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function poserSession() {
  const db = new Database(BASE_DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification bloc de publication',
  );
  db.close();
  return { token, empreinte };
}

function retirerSession(empreinte) {
  const db = new Database(BASE_DB);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Un projet dont la dernière publication a RÉUSSI : c'est le cas qui nous intéresse. */
function projetPublieRecemment() {
  const db = new Database(BASE_DB, { readonly: true });
  const ligne = db
    .prepare(
      `SELECT d.project_id AS id, d.state AS etat, p.name AS nom
         FROM deploys d JOIN projects p ON p.id = d.project_id
        ORDER BY d.started_at DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne;
}

async function main() {
  const projet = projetPublieRecemment();
  if (!projet || projet.etat !== 'success') {
    console.log('Aucune publication réussie en base : rien à vérifier ici.');
    process.exit(0);
  }
  console.log(`Projet : ${projet.nom} (dernière publication : ${projet.etat})`);

  const { token, empreinte } = poserSession();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  /* L'application rouvre là où on l'avait quittée : sur téléphone, ce peut
     être la conversation. Le bloc de publication vit sur le TABLEAU. */
  const ongletTableau = page.getByRole('button', { name: /^Tableau$/ });
  if (await ongletTableau.count()) {
    await ongletTableau.first().click();
    await page.waitForTimeout(2500);
  }

  /* Sur téléphone, le tableau se lit onglet par onglet, et une colonne inactive
     sort de l'arbre d'accessibilité : on active « À déployer » pour être sûr
     que son bloc de publication est bien à l'écran, quel que soit l'onglet
     rouvert. */
  const ongletDeploy = page.locator('[data-onglet-colonne="to_deploy"]');
  if (await ongletDeploy.count()) {
    await ongletDeploy.first().click();
    await page.waitForTimeout(1200);
  }

  /* On vise le bouton du bloc par son attribut DOM, jamais par sa seule
     étiquette : il porte toujours « Tout déployer (n) », même à zéro. */
  const boutonDeploy = page.locator('[data-bloc-publication="to_deploy"] [data-bouton-publication]');
  const aBouton = (await boutonDeploy.count()) > 0;
  const libelle = aBouton ? ((await boutonDeploy.first().textContent()) ?? '').trim() : '';
  // Le nombre entre parenthèses : ce qui attend vraiment de partir.
  const enAttente = Number((libelle.match(/\((\d+)\)/) ?? [])[1] ?? 0);
  noter('le bouton « Tout déployer » est présent', aBouton && /Tout déployer/.test(libelle), libelle);

  // Le déploiement sur l'instance de dev n'est pas touché : seule la MISE EN
  // PRODUCTION demande confirmation. Le bouton « Tout déployer » n'est donc pas
  // un déclencheur de modale — on le CONSTATE sans cliquer, pour ne rien
  // publier sur ce serveur.
  const ouvreModale = aBouton
    ? await boutonDeploy.first().evaluate((el) => el.getAttribute('aria-haspopup') === 'dialog')
    : false;
  noter('« Tout déployer » n’ouvre pas de modale de confirmation', aBouton && !ouvreModale);

  const texte = await page.locator('body').innerText();
  const rapport = /Publié\s*(\([^)]*\))?\s*:\s*\d+\s*tâche/.test(texte);
  const etapes = texte.includes('Redémarrage du serveur') && texte.includes('Fusion des branches');

  // Une publication réussie repart VIERGE : plus de compte rendu ni d'étapes
  // sous le bouton, qu'un nouveau lot attende (enAttente > 0) ou non.
  noter('le rapport de la publication précédente a laissé la place', !rapport && !etapes, `lot en attente : ${enAttente}`);

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await context.close();
  await navigateur.close();
  retirerSession(empreinte);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
