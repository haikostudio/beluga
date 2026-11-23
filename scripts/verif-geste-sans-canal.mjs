#!/usr/bin/env node
/**
 * UN GESTE QUI ENGAGE QUELQUE CHOSE NE DISPARAÎT JAMAIS EN SILENCE.
 *
 *   node scripts/verif-geste-sans-canal.mjs
 *
 * LA PANNE REJOUÉE. Confirmer la reconnexion d'un compte refermait l'encart
 * PUIS envoyait la demande par l'envoi sans retour (`client.send`), qui jette
 * ce qu'il ne peut pas transmettre : lien coupé une seconde, l'encart se
 * fermait, le serveur ne recevait rien, et l'écran ne disait rien. Un compte
 * devenait impossible à reconnecter sans qu'aucune trace n'existe nulle part.
 *
 * Le contrôle monte son PROPRE démon (base neuve, HOME à lui, faux moteur
 * `claude` posé dans son PATH), ouvre les réglages dans un vrai navigateur,
 * puis :
 *
 *   1. LIAISON COUPÉE (le contexte du navigateur passe hors ligne, le canal
 *      temps réel se ferme pour de bon) : on confirme la reconnexion et on
 *      vérifie qu'un message NOMMANT le geste paraît, que l'encart RESTE
 *      ouvert, et qu'aucune connexion n'est affichée comme partie ;
 *   2. LIAISON REVENUE : le même clic aboutit — l'encart se referme et la
 *      connexion s'affiche, adresse à ouvrir en tête ;
 *   3. AUCUN GESTE ENGAGEANT NE PASSE PLUS PAR L'ENVOI SANS RETOUR : relecture
 *      du code de l'interface, pour que le défaut ne puisse pas revenir par un
 *      autre bouton que celui d'origine.
 *
 * Tout est jugé sur l'ÉTAT du DOM, jamais sur un délai : le temps de
 * reconnexion dépend de la machine.
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
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7221);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-geste-sans-canal-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const HOME = path.join(TMP, 'home');
const BIN = path.join(TMP, 'bin');
const COFFRE = path.join(TMP, 'coffre-claude');
fs.mkdirSync(BIN, { recursive: true });
fs.mkdirSync(COFFRE, { recursive: true });

/* Le faux moteur : l'invite de `claude auth login`, et rien de plus. Ce
   contrôle ne juge pas la connexion elle-même (c'est l'affaire de
   `verif-reconnexion-compte.mjs`), seulement le DÉPART de la demande. */
fs.writeFileSync(
  path.join(BIN, 'claude'),
  `#!/bin/bash
if [ "$1" = "--version" ]; then echo "2.1.270 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then
  echo "Opening browser to sign in…"
  echo "If the browser didn’t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=essai&state=essai"
  printf "Paste code here if prompted > "
  read code
  sleep 30
  exit 1
fi
exit 1
`,
  { mode: 0o755 },
);

/* UN COFFRE VALIDE : le compte répond, donc son bouton « Reconnecter » ouvre
   une CONFIRMATION — c'est le chemin exact du signalement d'origine. Un coffre
   vidé partirait sans confirmation et ne prouverait pas que l'encart tient. */
fs.writeFileSync(
  path.join(COFFRE, '.credentials.json'),
  JSON.stringify({
    claudeAiOauth: {
      accessToken: 'jeton-d-essai',
      refreshToken: 'renouveau-d-essai',
      expiresAt: Date.now() + 30 * 24 * 3600_000,
      refreshTokenExpiresAt: Date.now() + 60 * 24 * 3600_000,
    },
  }),
);

/* UN RELEVÉ DE QUOTA FACTICE. Le relevé réel interroge le fournisseur : dans un
   décor d'essai il revient toujours refusé, et un compte « à reconnecter » part
   SANS confirmation — l'encart qu'on veut juger ne s'ouvrirait jamais. Le
   fichier ci-dessous donne au compte un relevé propre, donc une connexion
   « valide » et le chemin confirmé du signalement d'origine. */
const QUOTAS = path.join(TMP, 'quotas-factices.json');
fs.writeFileSync(
  QUOTAS,
  JSON.stringify({
    'claude-essai': {
      available: true,
      plan: 'Max x5',
      session: { usedPct: 12, resetsAt: Date.now() + 3600_000 },
      weekly: { usedPct: 30, resetsAt: Date.now() + 5 * 24 * 3600_000 },
    },
  }),
);

const { DATA, journal, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  dossiers: [HOME],
  env: { HOME, PATH: `${BIN}:${process.env.PATH}`, BELUGA_QUOTAS_FACTICES: QUOTAS },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification geste sans canal',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects', 'accounts']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  const compte = { id: 'claude-essai', engine: 'claude', label: 'Claude — essai', priority: 10, configDir: COFFRE };
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    compte.id,
    compte.engine,
    JSON.stringify(compte),
    t,
  );
  db.close();
}

/** Attendre qu'une condition lue dans la page devienne vraie. */
async function attendre(page, lire, limiteMs) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await lire().catch(() => false)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

fs.mkdirSync(SHOTS, { recursive: true });
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 1400, height: 900 },
  locale: 'fr-CH',
  serviceWorkers: 'block',
});
await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

/* Vers Réglages › Comptes. Sans moteur en ligne, l'assistant de démarrage barre
   l'écran : il porte son propre chemin vers les réglages. */
await attendre(
  page,
  async () =>
    (await page.locator('[data-assistant-moteurs="1"]').count()) > 0 ||
    (await page.getByRole('button', { name: 'Menu' }).count()) > 0,
  60_000,
);
if ((await page.locator('[data-assistant-moteurs="1"]').count()) > 0) {
  await page.locator('[data-assistant-reglages="1"]').first().click();
} else {
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await page.locator('[data-reglages-menu]').first().click();
}
await page.locator('[data-page-menu="comptes"]').first().click({ timeout: 30000 });

const ligne = page.locator('[data-ligne-compte="claude-essai"]');
const encart = page.locator('[data-confirmation-reconnexion="claude-essai"]');
const confirmer = page.locator('[data-confirmer-reconnexion]');
const messages = page.locator('[data-toast]');
const messageDuCanal = page.locator('[data-toast-persistant="canal"]');

/* Le compte est posé APRÈS le démarrage : on fait relire les quotas pour qu'il
   entre dans la liste, au lieu d'attendre le relevé suivant. */
await page.locator('[data-relire-quotas]').first().click({ timeout: 30000 });
noter('la ligne du compte d’essai s’affiche', await attendre(page, async () => (await ligne.count()) > 0, 30_000));

/* ------------------------------------------------------------------ */
/* 1. LIAISON COUPÉE : le clic ne part pas, et ça se VOIT              */
/* ------------------------------------------------------------------ */

await ligne.locator('[data-reconnecter-compte="claude-essai"]').click({ timeout: 20000 });
const confirmationOuverte = await attendre(page, async () => (await encart.count()) > 0, 20_000);
noter(
  '« Reconnecter » ouvre sa confirmation',
  confirmationOuverte,
  confirmationOuverte ? '' : ((await ligne.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 200),
);
if (!confirmationOuverte) {
  /* Sans confirmation, la suite du contrôle n'a plus de sujet : mieux vaut le
     dire que juger un écran qu'on n'a pas su mettre dans l'état voulu. */
  await page.screenshot({ path: path.join(SHOTS, 'geste-sans-canal-sans-confirmation.png') });
  await navigateur.close();
  console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
  process.exit(1);
}

await contexte.setOffline(true);
/* On attend l'ÉTAT, pas un délai : le message persistant du canal ne paraît que
   lorsque le socket est réellement refermé — c'est la preuve que la coupure a
   mordu avant le clic. */
noter(
  'la coupure est constatée par l’écran',
  await attendre(page, async () => (await messageDuCanal.count()) > 0, 30_000),
);

const messagesAvant = await messages.count();
await confirmer.click({ timeout: 20000 });

const plainte = await attendre(
  page,
  async () => /n’a pas pu partir/.test((await page.locator('[data-bloc="toasts"]').textContent()) ?? ''),
  20_000,
);
const texteDesMessages = (await page.locator('[data-bloc="toasts"]').textContent()) ?? '';
noter('le geste refusé se plaint à l’écran', plainte, texteDesMessages.replace(/\s+/g, ' ').slice(0, 180));
noter('la plainte NOMME le geste perdu', /Reconnexion du compte/.test(texteDesMessages));
noter('un message de plus est apparu', (await messages.count()) > messagesAvant);
noter('l’encart de confirmation RESTE ouvert', (await encart.count()) > 0);
noter(
  'aucune connexion n’est affichée comme partie',
  (await page.locator('[data-connexion-en-cours="1"]').count()) === 0,
);
await page.screenshot({ path: path.join(SHOTS, 'geste-sans-canal-coupe.png') });

/* ------------------------------------------------------------------ */
/* 2. LIAISON REVENUE : le même clic aboutit                           */
/* ------------------------------------------------------------------ */

await contexte.setOffline(false);
noter(
  'le lien se rétablit et l’écran cesse de le dire',
  await attendre(page, async () => (await messageDuCanal.count()) === 0, 60_000),
);

/* Si l'encart a disparu (c'est le défaut d'origine : refermé sans rien envoyer),
   on le rouvre pour juger quand même le retour du lien — un contrôle qui
   s'interrompt sur une exception n'apprend rien de plus que son premier rouge. */
if ((await encart.count()) === 0) await ligne.locator('[data-reconnecter-compte="claude-essai"]').click({ timeout: 20000 });
await attendre(page, async () => (await confirmer.count()) > 0, 20_000);
await confirmer.click({ timeout: 30000 });
noter(
  'la connexion part et s’affiche',
  await attendre(page, async () => (await page.locator('[data-connexion-en-cours="1"]').count()) > 0, 30_000),
);
noter('l’encart de confirmation s’est refermé', (await encart.count()) === 0);
await page.screenshot({ path: path.join(SHOTS, 'geste-sans-canal-revenu.png') });

await navigateur.close();

/* ------------------------------------------------------------------ */
/* 3. PLUS AUCUN GESTE ENGAGEANT PAR L'ENVOI SANS RETOUR               */
/* ------------------------------------------------------------------ */

/* Réparer le seul bouton du signalement laisserait les autres piéger plus tard :
   la liste ci-dessous est celle des commandes qui ENGAGENT quelque chose. Les
   gestes décoratifs (dire quel écran on regarde, demander une liste que l'écran
   redemande de lui-même à la reconnexion) restent libres de se perdre. */
const ENGAGEANTS = [
  'account.connect',
  'account.cancel',
  'account.code',
  'account.disable',
  'settings.update',
  'queue.update',
  'queue.remove',
  'agent.reset',
  'deploy.stop',
  'deploy.retry',
  'quota.refresh',
];

const fautifs = [];
const parcourir = (dossier) => {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) parcourir(chemin);
    else if (/\.tsx?$/.test(entree.name)) {
      const lignes = fs.readFileSync(chemin, 'utf8').split('\n');
      lignes.forEach((texte, index) => {
        if (!/\.send\(\s*\{/.test(texte)) return;
        const type = ENGAGEANTS.find((t) => texte.includes(`'${t}'`));
        if (type) fautifs.push(`${path.relative(RACINE, chemin)}:${index + 1} (${type})`);
      });
    }
  }
};
parcourir(path.join(RACINE, 'web', 'src'));
noter(
  'aucun geste engageant ne passe par l’envoi sans retour',
  fautifs.length === 0,
  fautifs.join(', ') || 'aucun',
);

console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
