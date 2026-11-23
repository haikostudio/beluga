#!/usr/bin/env node
/**
 * AJOUTER UN MOTEUR, ET RECONNECTER UN COMPTE À CLÉ — dans un vrai navigateur.
 *
 * Quatre promesses de Réglages › Comptes :
 *   1. « Reconnecter » un compte MiMo déplie un champ de CLÉ, jamais la page de
 *      connexion de Claude ; une clé refusée s'affiche avec sa raison ;
 *   2. un moteur AJOUTÉ actif (fiche en base) a sa ligne, et son compte figure
 *      avec les autres ;
 *   3. « Ajouter un LLM » liste les moteurs connus, et « Ajouter un autre LLM »
 *      ouvre la page de l'agent (un tiroir avant la refonte), sur sa question
 *      d'accueil et son champ d'écriture — sans rien envoyer au moteur ;
 *   4. retirer le moteur ajouté fait disparaître sa ligne ET son compte ;
 *   5. un moteur ajouté resté EN ESSAI n'est plus une ligne morte : essai raté
 *      et sa raison, compatibilité avec les agents dite en clair, champ de clé
 *      et « Réessayer l'essai », et le lien vers la CARTE de son ajout (posée
 *      au démarrage par le rattrapage), qui referme les réglages pour la montrer.
 *
 *   node scripts/verif-ajout-de-moteur.mjs
 *
 * Le script monte son PROPRE démon (base neuve, HOME à lui), pose le décor,
 * puis le relance : les moteurs ajoutés entrent au registre au démarrage.
 * Aucun compte réel n'est lu ni touché ; le seul appel extérieur est l'épreuve
 * d'une clé MiMo volontairement fausse, que Xiaomi refuse.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Les réglages ne sont plus une entrée du
 * menu « Menu » (disparu) : ils s'ouvrent par leur bouton, au pied de la colonne
 * de gauche (`[data-reglages-menu]`). « Ajouter un LLM » et l'agent d'ajout sont
 * des PAGES ouvertes depuis la fenêtre des réglages : elles doivent passer
 * DEVANT elle (`Drawer empile`). Tant qu'elles s'ouvrent dessous, le clic sur
 * « Ajouter un autre LLM » n'aboutit pas et les deux points de l'agent échouent,
 * avec cette raison — c'est l'écran qui est en défaut, pas le contrôle.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-ajout-moteur-'));
const SHOTS = path.join(RACINE, 'data', 'verification');
const HOME = path.join(TMP, 'home');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const premier = demarrerDemonDEssai({ tmp: TMP, port: PORT, dossiers: [HOME], env: { HOME }, garder: true });
if (!(await premier.attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + premier.journal.join(''));
  process.exit(1);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const COFFRE_MIMO = path.join(TMP, 'coffre-mimo');
const COFFRE_EXT = path.join(TMP, 'coffre-ext');

function poserLeDecor() {
  const db = new Database(path.join(premier.DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3600_000, 'vérification ajout de moteur');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ ...reglages, maxAgents: 0 }),
  );
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects', 'accounts']) db.prepare(`DELETE FROM ${table}`).run();

  const projet = { id: 'projet-essai', name: 'Essai', path: premier.DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    projet.id, projet.name, projet.path, JSON.stringify(projet), t, t,
  );

  const fiche = {
    id: 'ext-essai',
    label: 'Essai Compatible',
    nomCourt: 'Essai',
    famille: 'anthropic',
    urlDeBase: 'https://essai.invalid/anthropic',
    modeleParDefaut: 'essai-pro',
    statut: 'actif',
    epreuve: { ok: true, at: t, resume: 'Épreuve réussie (décor du contrôle).' },
    creeLe: t,
  };
  db.prepare('INSERT INTO moteurs_ajoutes (id, data, maj_le) VALUES (?, ?, ?)').run(fiche.id, JSON.stringify(fiche), t);
  // Resté en essai : l'épreuve a vu la clé acceptée, mais aucun outil utilisé.
  const rate = {
    id: 'ext-essai-rate',
    label: 'Essai Rate',
    nomCourt: 'Rate',
    famille: 'openai',
    api: 'chat',
    urlDeBase: 'https://rate.invalid/v1',
    modeleParDefaut: 'rate-pro',
    statut: 'essai',
    epreuve: {
      ok: false,
      at: t,
      resume: 'Épreuve ratée : aucun outil n’a été utilisé (lecture du fichier).',
      constat: { cleAcceptee: true, formatReconnu: true, outilUtilise: false, reponseJuste: false },
    },
    creeLe: t,
  };
  db.prepare('INSERT INTO moteurs_ajoutes (id, data, maj_le) VALUES (?, ?, ?)').run(rate.id, JSON.stringify(rate), t + 1);

  for (const [compte, coffre, cle] of [
    [{ id: 'mimo-essai', engine: 'mimo', label: 'MiMo — essai', priority: 10, configDir: COFFRE_MIMO }, COFFRE_MIMO, 'ancienne-cle'],
    [{ id: 'ext-essai-principal', engine: 'ext-essai', label: 'Essai — compte principal', priority: 50, configDir: COFFRE_EXT }, COFFRE_EXT, 'cle-ext'],
  ]) {
    fs.mkdirSync(coffre, { recursive: true });
    fs.writeFileSync(path.join(coffre, 'api-key'), `${cle}\n`, { mode: 0o600 });
    db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(compte.id, compte.engine, JSON.stringify(compte), t);
  }
  db.close();
}

poserLeDecor();
premier.demon.kill('SIGTERM');
await new Promise((resolve) => premier.demon.once('exit', resolve));

const second = demarrerDemonDEssai({ tmp: TMP, port: PORT, depot: false, env: { HOME } });
if (!(await second.attendrePort())) {
  console.error('Le démon d’essai n’a pas redémarré :\n' + second.journal.join(''));
  process.exit(1);
}

async function attendre(page, lire, limiteMs) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await lire().catch(() => false)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

fs.mkdirSync(SHOTS, { recursive: true });
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await attendre(page, async () => (await page.locator('[data-assistant-moteurs="1"], [data-reglages-menu]').count()) > 0, 30_000);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(SHOTS, 'ajout-de-moteur-depart.png') });

/**
 * RÉGLAGES › COMPTES. Depuis la refonte, les réglages n'ont plus d'entrée dans
 * un menu « Menu » : ils s'ouvrent par LEUR bouton, au pied de la colonne de
 * gauche (`[data-reglages-menu]`). L'écran d'accueil sans aucun moteur garde
 * son propre bouton (`data-assistant-reglages`).
 */
async function ouvrirLesComptes() {
  if ((await page.locator('[data-assistant-moteurs="1"]').count()) > 0) await page.locator('[data-assistant-reglages="1"]').first().click();
  else await page.locator('[data-reglages-menu]:visible').first().click();
  await page.locator('[data-page-menu="comptes"]').first().click({ timeout: 30000 });
}
await ouvrirLesComptes();
await page.locator('[data-relire-quotas]').first().click({ timeout: 30000 });

/* 2. Le moteur ajouté et son compte. */
const ligneMoteur = page.locator('[data-moteur-ajoute="ext-essai"]');
noter('le moteur ajouté a sa ligne dans les comptes', await attendre(page, async () => (await ligneMoteur.count()) > 0, 30_000));
const compteExt = page.locator('[data-ligne-compte="ext-essai-principal"]');
noter('son compte figure avec les autres', await attendre(page, async () => (await compteExt.count()) > 0, 60_000));

/* 1. Reconnecter un compte MiMo : un champ de clé, pas la page de Claude. */
const ligneMimo = page.locator('[data-ligne-compte="mimo-essai"]');
await attendre(page, async () => (await ligneMimo.locator('[data-reconnecter-compte]').count()) > 0, 60_000);
await ligneMimo.locator('[data-reconnecter-compte]').click();
const champ = page.locator('[data-remplacer-cle="mimo-essai"]');
noter('« Reconnecter » sur MiMo déplie un champ de clé', await attendre(page, async () => (await champ.count()) > 0, 5000));
noter('aucune page de connexion ne s’ouvre', (await page.locator('[data-confirmation-reconnexion="mimo-essai"]').count()) === 0 && (await page.getByText('claude.com').count()) === 0);
await champ.locator('[data-champ-nouvelle-cle]').fill('cle-volontairement-fausse');
await champ.locator('[data-valider-nouvelle-cle]').click();
const refus = champ.locator('[data-erreur-nouvelle-cle]');
noter('une clé refusée s’affiche avec sa raison', await attendre(page, async () => (await refus.count()) > 0, 30_000), (await refus.textContent().catch(() => '')) ?? '');
noter('l’ancienne clé est intacte', fs.readFileSync(path.join(COFFRE_MIMO, 'api-key'), 'utf8').trim() === 'ancienne-cle');
await page.screenshot({ path: path.join(SHOTS, 'reconnexion-par-cle.png') });

/* 3. Le tiroir de l'agent. */
await page.locator('[data-ouvrir-ajout-de-moteur]').click();
const liste = page.locator('[data-tiroir-ajouter-un-llm]');
noter('« Ajouter un LLM » ouvre la liste des moteurs connus', await attendre(page, async () => (await liste.locator('[data-llm-connu]').count()) >= 2, 10_000));
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(SHOTS, 'ajouter-un-llm-liste.png') });
/* LA LISTE EST UNE PAGE OUVERTE DEPUIS LA FENÊTRE DES RÉGLAGES : elle doit être
   DEVANT elle pour qu'on y clique. Un clic qui n'aboutit pas n'arrête pas le
   contrôle — il fait échouer les deux points de l'agent, avec sa raison, et la
   suite (moteur en essai, retrait) est jugée quand même. */
const raisonDuClic = await page
  .locator('[data-ajouter-autre-llm]')
  .click({ timeout: 10_000 })
  .then(() => '')
  .catch((erreur) => (/intercepts pointer events/.test(String(erreur)) ? '« Ajouter un autre LLM » ne se clique pas : la page de la liste s’ouvre SOUS la fenêtre des réglages' : String(erreur).split('\n')[0]));
const accueil = page.locator('[data-accueil-ajout-de-moteur]');
noter(
  '« Ajouter un autre LLM » ouvre le tiroir de l’agent, sur sa question',
  !raisonDuClic && (await attendre(page, async () => (await accueil.count()) > 0, 30_000)),
  raisonDuClic,
);
const tiroir = page.locator('[data-conversation-ajout-de-moteur]');
noter('le tiroir porte un champ d’écriture', (await tiroir.locator('textarea').count()) > 0);
await page.screenshot({ path: path.join(SHOTS, 'ajout-de-moteur-tiroir.png') });
if (raisonDuClic) {
  /* La page restée dessous est la dernière ouverte : Échap la referme, elle,
     et laisse les réglages. */
  await page.keyboard.press('Escape');
  await attendre(page, async () => (await liste.count()) === 0, 5000);
  if ((await page.locator('[data-page-menu="comptes"]').count()) === 0) await ouvrirLesComptes();
} else {
  await page.locator('[data-tiroir-ajout-de-moteur] button[aria-label="Fermer"]').click();
}
await page.waitForTimeout(500);

/* 5. Le moteur resté en essai : état, compatibilité, clé, essai, carte. */
const ligneRate = page.locator('[data-moteur-ajoute="ext-essai-rate"]');
noter('le moteur en essai a sa ligne', await attendre(page, async () => (await ligneRate.count()) > 0, 10_000));
noter('son essai raté se lit, avec sa raison', (await ligneRate.getByText('essai raté').count()) > 0 && (await ligneRate.locator('[data-raison-essai]').count()) > 0);
noter(
  'la ligne dit qu’il est incompatible avec les agents',
  (await ligneRate.locator('[data-compatibilite-agents="sans-outil"]').count()) > 0,
  (await ligneRate.locator('[data-compatibilite-agents]').textContent().catch(() => '')) ?? '',
);
noter('le moteur actif se dit compatible', (await ligneMoteur.locator('[data-compatibilite-agents="eprouve"]').count()) > 0);
noter('le moteur actif avec compte ne propose pas de champ de clé (son compte se reconnecte)', (await ligneMoteur.locator('[data-cle-du-moteur]').count()) === 0);
await ligneRate.locator('[data-cle-du-moteur]').click();
noter('« Clé et essai » déplie un champ de clé et « Réessayer l’essai »', await attendre(page, async () => (await ligneRate.locator('[data-champ-cle-moteur]').count()) > 0 && (await ligneRate.locator('[data-reessayer-essai]').count()) > 0, 5000));
await ligneRate.locator('[data-reessayer-essai]').click();
noter('sans clé, l’essai demande de la coller', await attendre(page, async () => /Collez la clé/.test((await ligneRate.locator('[data-issue-essai]').textContent().catch(() => '')) ?? ''), 15_000));
await page.screenshot({ path: path.join(SHOTS, 'moteur-ajoute-en-essai.png') });
noter('la ligne mène à la carte de son ajout', await attendre(page, async () => (await ligneRate.locator('[data-carte-du-moteur]').count()) > 0, 10_000));
await ligneRate.locator('[data-carte-du-moteur]').click();
noter('ouvrir la carte referme les réglages pour la montrer', await attendre(page, async () => (await page.locator('[data-page-menu="comptes"]').count()) === 0, 10_000));
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(SHOTS, 'carte-de-l-ajout.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
if ((await page.locator('[data-page-menu="comptes"]').count()) === 0) await ouvrirLesComptes();

/* 4. Retirer le moteur ajouté. */
await ligneMoteur.locator('[data-retirer-moteur]').click();
await page.locator('[data-confirmer-retrait-moteur]').click();
noter('retirer le moteur fait disparaître sa ligne', await attendre(page, async () => (await ligneMoteur.count()) === 0, 30_000));
noter('…et son compte', await attendre(page, async () => (await compteExt.count()) === 0, 30_000));

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
process.exit(echecs ? 1 : 0);
