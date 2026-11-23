#!/usr/bin/env node
/**
 * UNE PAGE QUI SE CHARGE NE SÈME PLUS DE « GESTE NON PARTI », ET CHAQUE
 * FERMETURE DU CANAL LAISSE SA LIGNE CÔTÉ SERVEUR.
 *
 *   node scripts/verif-gestes-du-chargement.mjs
 *
 * LA PANNE REJOUÉE (enquête « Décrochages du serveur », 28/10/2026). Au
 * chargement, l'écran demandait ses premières données (nouveautés, état de la
 * production, cartes en route) AVANT que son canal soit ouvert : chacune
 * était refusée, notée « geste non parti » (canal « en ouverture », « coupé
 * depuis : jamais »), et l'enquête des décrochages comptait ces rafales comme
 * des pannes du serveur — quatre fausses alertes sur six en un jour.
 *
 * Le contrôle monte son PROPRE démon (base neuve), recharge la page plusieurs
 * fois dans un vrai navigateur dont chaque ouverture de canal est freinée,
 * puis vérifie :
 *
 *   1. qu'aucun « geste non parti » n'a été rangé au journal des erreurs
 *      d'interface du démon d'essai ;
 *   2. que chaque canal refermé par un rechargement a laissé sa ligne
 *      « canal fermé : code … après … s » au journal du démon.
 *
 * Tout est jugé sur des fichiers et des lignes, jamais sur une capture.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7223);
const PORT_RELAIS = PORT + 1;
const BASE = `http://127.0.0.1:${PORT_RELAIS}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-gestes-du-chargement-'));
const RECHARGEMENTS = 4;
const LATENCE_MS = Number(process.env.BELUGA_VERIF_LATENCE || 1_500);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, journal, attendrePort } = demarrerDemonDEssai({ tmp: TMP, port: PORT });

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/* Une session d'une heure, hachée comme les vraies. */
const jeton = crypto.randomBytes(32).toString('hex');
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
    t,
    t + 3600_000,
    'vérification gestes du chargement',
  );
  db.close();
}

/* UN VRAI RÉSEAU : en local le canal s'ouvre en une milliseconde et la panne
   ne se voit pas. Un relais retarde chaque OUVERTURE de canal (la demande
   « Upgrade: websocket ») de LATENCE_MS, comme un téléphone ou une connexion
   lointaine : les demandes du chargement partent alors pendant l'ouverture.
   La latence réseau simulée du navigateur ne freine pas les canaux. */
const relais = net.createServer((client) => {
  const serveur = net.connect(PORT, '127.0.0.1');
  let premier = true;
  client.on('data', (morceau) => {
    if (premier && /^GET \/ws/.test(morceau.toString('latin1', 0, 16))) {
      premier = false;
      client.pause();
      setTimeout(() => {
        serveur.write(morceau);
        client.resume();
      }, LATENCE_MS);
      return;
    }
    premier = false;
    serveur.write(morceau);
  });
  serveur.on('data', (morceau) => client.write(morceau));
  const couper = () => {
    client.destroy();
    serveur.destroy();
  };
  client.on('close', couper).on('error', couper);
  serveur.on('close', couper).on('error', couper);
});
await new Promise((r) => relais.listen(PORT_RELAIS, '127.0.0.1', r));

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();

const journalDesErreurs = path.join(DATA, 'logs', 'interface-erreurs.log');
const gestesNonPartis = () =>
  (fs.existsSync(journalDesErreurs) ? fs.readFileSync(journalDesErreurs, 'utf8') : '')
    .split('\n')
    .filter((l) => l.includes('geste non parti'));

for (let i = 0; i <= RECHARGEMENTS; i++) {
  if (i === 0) await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  else await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  /* Plus de huit secondes par page : un rechargement plus rapide passe pour un
     démarrage coupé et jette la copie locale — or c'est elle qui affiche
     l'écran AVANT le canal, donc elle qui fait partir les demandes trop tôt. */
  await page.waitForTimeout(10_000);
}
await page.close();
await navigateur.close();
relais.close();
// Les rapports d'erreur partent par requête, le dernier canal se ferme avec le navigateur.
await new Promise((r) => setTimeout(r, 2_000));

const refus = gestesNonPartis();
noter(
  `aucun « geste non parti » sur ${RECHARGEMENTS + 1} chargements`,
  refus.length === 0,
  refus.length ? refus.slice(0, 3).map((l) => JSON.parse(l).message).join(' · ') : '',
);

const fermetures = journal.join('').split('\n').filter((l) => /canal fermé : code \d+ .*après [\d.]+ s/.test(l));
noter(
  `chaque fermeture du canal laisse sa ligne au journal du démon (${fermetures.length} pour ${RECHARGEMENTS + 1} canaux)`,
  fermetures.length >= RECHARGEMENTS,
  fermetures[0]?.replace(/^.*canal fermé/, 'canal fermé') ?? '',
);

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
