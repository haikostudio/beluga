#!/usr/bin/env node
/*
 * LES MESSAGES D'ERREUR AFFICHÉS DISENT LA CAUSE RÉELLE, EN PHRASE SIMPLE.
 *
 *   npm run build && node scripts/verif-messages-d-erreur.mjs
 *
 * Rejoue, sur le code construit de CE dépôt et dans un bac à sable (jamais la
 * base servie, jamais BELUGA_URL ni BELUGA_TOKEN) :
 *   1. la porte du dépôt : bind mort (ENOTCONN, `stat` qui réussit encore) →
 *      injoignable ; dossier vivant sans historique → sans-depot ; vrai dossier
 *      sur disque sans .git → sans-depot ;
 *   2. les familles : stockage coupé, quota, saturation, panne fournisseur →
 *      phrase simple sans code système ; phrase humaine gardée telle quelle ;
 *   3. le juge rapide (Jev) sur un FAUX SERVEUR local, usage « famille-erreur »
 *      allumé dans le bac à sable : un message qu'aucun motif ne reconnaît est
 *      rangé dans une des deux familles larges, sans lever ; un service muet
 *      rend la phrase honnête en temps borné. Jamais le service réel ;
 *   4. sans clé Jev au coffre : la phrase honnête « erreur inattendue ».
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-messages-erreur-'));
process.env.BELUGA_DATA = bac;
delete process.env.BELUGA_URL;
delete process.env.BELUGA_TOKEN;

let echecs = 0;
const noter = (nom, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs += 1;
};

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const { etatDuDossierDuProjet } = await import(path.join(RACINE, 'server/dist/scheduler.js'));

/* 1. La porte du dépôt */
const sondes = (git, lisible, remonter = async () => false) => ({
  git: async () => git,
  lisible: async () => lisible,
  remonter,
  declarerSur: async () => {},
});
noter(
  'bind mort, stat encore bon : injoignable (plus « non déclaré »)',
  (await etatDuDossierDuProjet('/x', sondes('spawn git ENOTCONN', true))) === 'injoignable',
);
noter(
  'dossier vivant sans historique : sans-depot',
  (await etatDuDossierDuProjet('/x', sondes('fatal: not a git repository', true))) === 'sans-depot',
);
const vide = fs.mkdtempSync(path.join(bac, 'sans-git-'));
noter('vrai dossier sur disque sans .git : sans-depot', (await etatDuDossierDuProjet(vide)) === 'sans-depot');
noter(
  'le refus « injoignable » ne parle ni de dépôt ni de réglage',
  !/dépôt git|déclar/i.test(shared.porteDuDepot('injoignable').raison),
  shared.porteDuDepot('injoignable').raison,
);

/* 2. Les familles */
for (const [brut, famille] of [
  ['spawn git ENOTCONN', 'stockage-injoignable'],
  ['API Error: 429 usage limit reached', 'quota'],
  ['spawn claude EAGAIN', 'machine-saturee'],
  ['API Error: 529 overloaded_error', 'panne-fournisseur'],
]) {
  const e = shared.expliquerLErreur(brut);
  noter(`« ${brut} » → ${famille}`, e.famille === famille && !e.phrase.includes(brut.split(' ').pop()), e.phrase);
}
const humaine = 'Ce projet est archivé : il ne reçoit plus de carte.';
noter('une phrase humaine passe telle quelle', shared.expliquerLErreur(humaine).phrase === humaine);

/* 3. Jev, sur un faux serveur local */
const http = await import('node:http');
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const coffre = await import(path.join(RACINE, 'server/dist/coffre-fort.js'));
const { expliquerPourLEcran } = await import(path.join(RACINE, 'server/dist/explication-d-erreur.js'));

/* 4. Sans clé d'abord : rien n'est encore rangé au coffre du bac à sable. */
store.saveSettings({ jugeAllumes: ['famille-erreur'] });
const sans = await expliquerPourLEcran('Error: yet another odd thing in module q', 'verif');
noter('sans clé Jev : phrase honnête, sans lever', sans.phrase === shared.PHRASES_DES_FAMILLES.inconnue);

let muet = false;
const faux = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (muet) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answers: { famille: { type: 'choice', choice: 'panne-exterieure', probabilities: {}, confidence: 0.9 } } }));
  });
});
await new Promise((resolve) => faux.listen(0, '127.0.0.1', resolve));
coffre.enregistrerAcces({
  nom: 'TypeSafe — essai',
  type: 'cle-api',
  champs: { service: 'TypeSafe', cle: 'cle-essai', adresse: `http://127.0.0.1:${faux.address().port}/v1/systemone` },
});
const avecJev = await expliquerPourLEcran('Error: remote end hung up unexpectedly while pushing refs', 'verif');
noter('Jev range un message inconnu dans une famille large', avecJev.famille === 'panne-exterieure' && avecJev.source === 'juge', `${avecJev.famille} (${avecJev.source})`);
muet = true;
const debut = Date.now();
const sansReponse = await expliquerPourLEcran('Error: invalid state: turn already closed', 'verif');
const duree = Date.now() - debut;
noter('Jev muet : phrase honnête en temps borné', sansReponse.phrase === shared.PHRASES_DES_FAMILLES.inconnue && duree < 6000, `${duree} ms`);
faux.closeAllConnections();
faux.close();

fs.rmSync(bac, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} échec(s).` : '\nTout est conforme.');
process.exit(echecs ? 1 : 0);
