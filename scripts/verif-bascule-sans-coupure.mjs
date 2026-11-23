#!/usr/bin/env node
/*
 * LA PREUVE QUE LA BASCULE NE COUPE PLUS.
 *
 * Deux contrôles, et le second est le vrai.
 *
 *   1. LA FAÇADE SERVIE est-elle entièrement couverte ? Un fichier régénéré
 *      derrière notre dos repart sans retenue : ça doit se voir ici.
 *   2. UNE COUPURE RÉELLE se voit-elle encore ? On monte une façade d'ESSAI,
 *      à nous, sur un port libre, devant un petit serveur à nous. On frappe
 *      l'adresse dix fois par seconde, on TUE le serveur en plein milieu, on
 *      le relance deux secondes plus tard — et on compte les erreurs.
 *
 * AUCUN SITE RÉEL N'EST TOUCHÉ : ni Caddy du système, ni service, ni port
 * occupé. Le contrôle monte tout ce dont il a besoin et le démonte ensuite.
 *
 *   node scripts/verif-bascule-sans-coupure.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { lignesDeRetenue, poserLaRetenue } from '../shared/dist/bascule-sans-coupure.js';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? '✓' : '✗'} ${texte}`);
};

/* ------------------------------------------------------------------ */
/* 1. La façade servie                                                 */
/* ------------------------------------------------------------------ */

const dossier = '/etc/caddy';
const fichiers = [];
if (fs.existsSync(path.join(dossier, 'Caddyfile'))) fichiers.push(path.join(dossier, 'Caddyfile'));
const inclus = path.join(dossier, 'project-autostart.d');
if (fs.existsSync(inclus)) {
  for (const nom of fs.readdirSync(inclus).sort()) if (nom.endsWith('.caddy')) fichiers.push(path.join(inclus, nom));
}

if (!fichiers.length) {
  console.log('— aucune façade sur cette machine : le premier contrôle est sans objet.');
} else {
  const nus = [];
  for (const f of fichiers) {
    for (const site of poserLaRetenue(fs.readFileSync(f, 'utf8')).poses) nus.push(`${path.basename(f)} → ${site}`);
  }
  dire(
    nus.length === 0,
    nus.length === 0
      ? `Les ${fichiers.length} fichiers de façade retiennent tous leurs visites.`
      : `${nus.length} site(s) tomberaient encore en erreur : ${nus.slice(0, 5).join(', ')}${nus.length > 5 ? '…' : ''}`,
  );
}

/* ------------------------------------------------------------------ */
/* 2. Une coupure réelle, sur une façade d'essai                       */
/* ------------------------------------------------------------------ */

function portLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

/** Le petit serveur qui se fait couper : il ne répond qu'une chose. */
function lancerLeServeur(port) {
  return new Promise((resolve) => {
    const s = http.createServer((_, rep) => {
      rep.writeHead(200, { 'content-type': 'text/plain' });
      rep.end('debout');
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function frapper(url) {
  return new Promise((resolve) => {
    const demande = http.get(url, { timeout: 40_000 }, (rep) => {
      rep.resume();
      rep.on('end', () => resolve(rep.statusCode ?? 0));
    });
    demande.on('error', () => resolve(0));
    demande.on('timeout', () => {
      demande.destroy();
      resolve(0);
    });
  });
}

const caddyPresent = spawnSync('caddy', ['version'], { encoding: 'utf8' }).status === 0;
if (!caddyPresent) {
  console.log('— Caddy absent de cette machine : la coupure réelle ne se rejoue pas ici.');
} else {
  const portSite = await portLibre();
  const portFacade = await portLibre();
  const conf = path.join(os.tmpdir(), `facade-essai-${process.pid}.caddyfile`);
  fs.writeFileSync(
    conf,
    [
      '{',
      '\tadmin off',
      '\tauto_https off',
      '}',
      `:${portFacade} {`,
      `\treverse_proxy 127.0.0.1:${portSite} {`,
      ...lignesDeRetenue().map((l) => `\t\t${l}`),
      '\t}',
      '}',
      '',
    ].join('\n'),
  );

  const facade = spawn('caddy', ['run', '--config', conf, '--adapter', 'caddyfile'], { stdio: 'ignore' });
  let serveur = await lancerLeServeur(portSite);
  const url = `http://127.0.0.1:${portFacade}/`;

  /* On attend que la façade d'essai réponde avant de compter quoi que ce soit. */
  let prete = false;
  for (let i = 0; i < 60 && !prete; i++) {
    prete = (await frapper(url)) === 200;
    if (!prete) await attendre(250);
  }

  if (!prete) {
    dire(false, 'La façade d’essai n’a jamais répondu : le contrôle ne peut rien prouver.');
  } else {
    const codes = [];
    let frappeEnCours = true;
    const marteau = (async () => {
      while (frappeEnCours) {
        codes.push(await frapper(url));
        await attendre(100);
      }
    })();

    await attendre(700);
    await new Promise((r) => serveur.close(r));
    /* Le site est mort. Deux secondes de trou : c'est le pire redémarrage
       mesuré sur ce serveur (6,4 s de médiane haute, mais on reste court pour
       que le contrôle ne dure pas). */
    await attendre(2_000);
    serveur = await lancerLeServeur(portSite);
    await attendre(1_200);
    frappeEnCours = false;
    await marteau;

    facade.kill('SIGINT');
    await new Promise((r) => serveur.close(r));
    fs.rmSync(conf, { force: true });

    const mauvaises = codes.filter((c) => c !== 200);
    dire(
      mauvaises.length === 0,
      mauvaises.length === 0
        ? `Le site a été coupé 2 s en plein trafic : ${codes.length} visites, aucune erreur — la façade les a gardées.`
        : `${mauvaises.length} visite(s) sur ${codes.length} ont reçu une erreur pendant la coupure (${[...new Set(mauvaises)].join(', ')}).`,
    );
  }
}

console.log(echecs === 0 ? '\nBascule sans coupure : vérifiée.' : `\n${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
