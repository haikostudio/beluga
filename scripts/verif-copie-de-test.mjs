#!/usr/bin/env node
/**
 * LA COPIE DE TEST DANS LA PAGE DE MISE EN PRODUCTION — contrôle de bout en bout.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Le « tiroir » de mise en production est
 * une PAGE de la zone principale. Sur ordinateur, on l'ouvre par le bouton de la
 * barre d'en-tête (`data-ouvrir-tiroir-production`, inchangé). Sur téléphone,
 * la bande du bas a disparu : la mise en production est une LIGNE du menu à
 * trois points du projet (`[data-entete-de-zone] [data-menu-general]`, puis
 * `[role="menu"] [data-menu-production]`), qui ouvre la même page.
 *
 * Un démon d'essai, un dépôt d'essai qui suit la convention du registre
 * (`shared/src/copie-de-test.ts`) : une branche `dev` porte
 * `production/rafraichir-copie-de-test.sh` (qui ne fait qu'écrire une ligne) et
 * une entrée `production/a-rejouer/…`. On vérifie, dans un vrai navigateur :
 *   1. le bloc « Copie de test » liste l'entrée en attente, le bouton est éteint
 *      et la raison est écrite ;
 *   2. une fois l'entrée notée « en ligne » (reflet du dossier git), le bouton
 *      s'allume ;
 *   3. un premier clic arme, le second lance ; le rafraîchissement se termine
 *      et son issue se lit ;
 *   4. sur téléphone, le bloc tient dans la largeur ; aucune erreur JavaScript.
 * Aucun site réel n'est touché : le script de rafraîchissement est factice.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-copie-de-test.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_COPIE_TEST_PORT || 7207);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-copie-de-test-', port: PORT, garder: process.env.GARDER_CAPTURES === '1' });

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-copie-test';
const ENTREE = '20261008-0900-desactiver-une-extension.sh';
const git = (...a) => execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', ...a], { cwd: DEPOT }).toString().trim();

function poserDepot() {
  git('checkout', '-q', '-b', 'dev');
  fs.mkdirSync(path.join(DEPOT, 'production', 'a-rejouer'), { recursive: true });
  fs.writeFileSync(path.join(DEPOT, 'production', 'rafraichir-copie-de-test.sh'), '#!/usr/bin/env bash\nsleep 1\necho "copie de test rafraîchie (essai)"\n');
  fs.writeFileSync(path.join(DEPOT, 'production', 'a-rejouer', ENTREE), 'DESCRIPTION="essai"\nappliquer() { true; }\nverifier() { true; }\n');
  git('add', 'production');
  git('commit', '-qm', 'registre d’essai');
  git('checkout', '-q', 'main');
}

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3_600_000, 'vérification de la copie de test');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ ...reglages, maxAgents: 0 }),
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai copie de test',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    miseEnProduction: { processus: { etapes: [{ libelle: 'Contrôle', commande: 'true', delaiS: 10 }] } },
    branchesDePublication: { dev: 'dev', production: 'main' },
    deploiement: {},
    createdAt: t,
    updatedAt: t,
  };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    projet.id,
    projet.name,
    projet.path,
    JSON.stringify(projet),
    t,
    t,
  );
  db.close();
}

async function ouvrirLeTiroir(navigateur, viewport, telephone = false) {
  const contexte = await navigateur.newContext({ viewport, isMobile: telephone, hasTouch: telephone, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1_500);
  }
  if (telephone) {
    /* Sur téléphone : le menu à trois points du projet, puis sa ligne « Mise en production ». */
    const troisPoints = page.locator('[data-entete-de-zone] [data-menu-general]:visible').first();
    await troisPoints.waitFor({ state: 'visible', timeout: 30_000 });
    await troisPoints.tap();
    const ligne = page.locator('[role="menu"] [data-menu-production]').first();
    await ligne.waitFor({ state: 'visible', timeout: 15_000 });
    await ligne.tap();
  } else {
    await page.waitForSelector('[data-ouvrir-tiroir-production]:visible', { timeout: 30_000 });
    await page.click('[data-ouvrir-tiroir-production]:visible');
  }
  await page.waitForSelector('[data-copie-de-test]', { timeout: 15_000 });
  return { contexte, page, erreurs };
}

const RELEVE = () => {
  const bloc = document.querySelector('[data-copie-de-test]');
  if (!bloc) return null;
  const bouton = bloc.querySelector('[data-rafraichir-copie]');
  const r = bloc.getBoundingClientRect();
  return {
    etat: bloc.getAttribute('data-copie-de-test'),
    attente: bloc.querySelector('[data-copie-en-attente]')?.getAttribute('data-copie-en-attente'),
    liste: [...bloc.querySelectorAll('li')].map((li) => li.textContent?.trim()),
    bouton: bouton?.textContent?.trim(),
    eteint: bouton?.hasAttribute('disabled') ?? null,
    arme: bouton?.getAttribute('data-rafraichir-copie'),
    raison: bloc.querySelector('[data-raison-copie]')?.textContent?.trim() ?? null,
    derniere: bloc.querySelector('[data-derniere-copie]')?.getAttribute('data-derniere-copie') ?? null,
    deborde: r.right > window.innerWidth + 1 || r.left < -1,
  };
};

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  poserDepot();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* 1. Une entrée attend : bouton éteint, raison écrite. */
  let { contexte, page, erreurs } = await ouvrirLeTiroir(navigateur, { width: 1400, height: 900 });
  const bloque = await page.evaluate(RELEVE);
  noter('le bloc « Copie de test » paraît dans la page de mise en production', !!bloque, JSON.stringify(bloque));
  noter('il liste l’entrée qui attend sa mise en production', bloque?.attente === '1' && bloque.liste?.[0] === ENTREE, JSON.stringify(bloque?.liste));
  noter('le bouton est éteint, et la raison est écrite', bloque?.etat === 'en-attente' && bloque.eteint === true && /perdrait/.test(bloque.raison ?? ''), JSON.stringify(bloque));
  await page.screenshot({ path: path.join(TMP, 'copie-bloquee.png') });
  await contexte.close();

  /* 2. L'entrée est notée en ligne : le bouton s'allume. */
  const commun = git('rev-parse', '--git-common-dir');
  fs.writeFileSync(path.resolve(DEPOT, commun, 'beluga-production-appliques.txt'), `${ENTREE}\n`);
  ({ contexte, page, erreurs } = await ouvrirLeTiroir(navigateur, { width: 1400, height: 900 }));
  const pret = await page.evaluate(RELEVE);
  noter('l’entrée en ligne ne compte plus, le bouton s’allume', pret?.etat === 'prete' && pret.attente === '0' && pret.eteint === false && !pret.raison, JSON.stringify(pret));

  /* 3. Premier clic : armé ; second : lancé ; puis l'issue se lit. */
  await page.click('[data-rafraichir-copie]');
  await page.waitForTimeout(300);
  const arme = await page.evaluate(RELEVE);
  noter('un premier clic ARME le bouton sans rien lancer', arme?.arme === 'arme' && /Confirmer/.test(arme.bouton ?? ''), arme?.bouton);
  await page.click('[data-rafraichir-copie]');
  await page.waitForTimeout(500);
  const lance = await page.evaluate(RELEVE);
  noter('le second clic lance le rafraîchissement', lance?.etat === 'en-cours' && /en cours/.test(lance.bouton ?? ''), JSON.stringify(lance));
  await page.waitForSelector('[data-derniere-copie]', { timeout: 20_000 }).catch(() => undefined);
  const fini = await page.evaluate(RELEVE);
  noter('le rafraîchissement se termine et son issue se lit', fini?.derniere === 'reussie' && fini.etat === 'prete', JSON.stringify(fini));
  await page.screenshot({ path: path.join(TMP, 'copie-rafraichie.png') });
  noter('ordinateur — aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();

  /* 4. Téléphone. */
  const tel = await ouvrirLeTiroir(navigateur, { width: 390, height: 844 }, true);
  const surTel = await tel.page.evaluate(RELEVE);
  noter('téléphone — le bloc tient dans la largeur', surTel && !surTel.deborde, JSON.stringify(surTel));
  await tel.page.screenshot({ path: path.join(TMP, 'copie-telephone.png') });
  noter('téléphone — aucune erreur JavaScript', tel.erreurs.length === 0, tel.erreurs.slice(0, 2).join(' | '));
  await tel.contexte.close();

  await navigateur.close();
  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés. (captures dans ${TMP})`);
  process.exit(rates.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
