#!/usr/bin/env node
/*
 * LES SCRIPTS SYSTEME INSTALLÉS SONT-ILS ENCORE CEUX DU DÉPÔT ?
 *
 * Certains scripts dont le démon dépend ne tournent pas depuis le dépôt : ils
 * sont posés dans `/usr/local/bin` et déclenchés par une minuterie systemd.
 * Rien ne les redéployait, rien ne les relisait — une correction faite à la
 * main sur la machine se perdait au premier remaniement, et une modification
 * faite à la main SANS passer par le dépôt ne se voyait nulle part.
 *
 * Le 06/09/2026, c'est exactement ce couple qui a coûté un tour de travail :
 * `/usr/local/bin/root-storage-cleanup` jugeait « abandonnée » la copie de
 * travail d'une carte EN TRAIN de travailler, et l'a retirée sous les pieds de
 * son agent. Le correctif vit désormais dans `scripts/systeme/` ; ce contrôle
 * vérifie qu'il est bien celui qui tourne.
 *
 * Il compare, octet pour octet, chaque script versionné à sa copie installée.
 * Aucun service n'est touché, rien n'est écrit : il LIT.
 *
 * Le contrôle vise le dépôt d'où il PART (copie de travail comprise). Un
 * script encore absent de CE dépôt — branche pas encore fusionnée — n'est pas
 * une dérive : il est signalé et sauté.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Chaque script système du dépôt, avec l'endroit où il doit être installé. */
const SCRIPTS = [
  {
    versionne: path.join(RACINE, 'scripts', 'systeme', 'root-storage-cleanup.sh'),
    installe: '/usr/local/bin/root-storage-cleanup',
    role: 'nettoyage automatique du disque (minuterie toutes les 30 min)',
  },
  {
    versionne: path.join(RACINE, 'scripts', 'systeme', 'montage-distant-watchdog.sh'),
    installe: '/usr/local/bin/montage-distant-watchdog',
    role: 'surveillant du montage du grand disque (minuterie toutes les minutes)',
  },
  {
    versionne: path.join(RACINE, 'scripts', 'systeme', 'root-storage-cleanup.beluga.env'),
    installe: '/etc/default/root-storage-cleanup',
    role: 'réglages du nettoyage propres à Beluga (3 jours d’historiques, rangés sur le grand disque)',
  },
];

const REPARER = 'sudo bash scripts/systeme/installer.sh';

let echecs = 0;
let sautes = 0;

console.log('CONTRÔLE DES SCRIPTS SYSTÈME — l’installé est-il le versionné ?\n');

for (const script of SCRIPTS) {
  const nom = path.basename(script.installe);

  if (!fs.existsSync(script.versionne)) {
    console.log(`  ⏭  ${nom} — pas encore versionné dans CE dépôt (${script.role})`);
    console.log('     Rien à comparer : la branche qui l’apporte n’est pas fusionnée ici.');
    sautes += 1;
    continue;
  }

  if (!fs.existsSync(script.installe)) {
    console.log(`  ✗  ${nom} — versionné, mais ABSENT de la machine (${script.installe})`);
    console.log(`     À poser : ${REPARER}`);
    echecs += 1;
    continue;
  }

  const attendu = fs.readFileSync(script.versionne);
  const pose = fs.readFileSync(script.installe);
  if (attendu.equals(pose)) {
    console.log(`  ✓  ${nom} — identique au dépôt (${attendu.length} octets)`);
    continue;
  }

  console.log(`  ✗  ${nom} — DÉRIVE : l’installé n’est pas celui du dépôt`);
  console.log(`     dépôt    : ${attendu.length} octets — ${script.versionne}`);
  console.log(`     machine  : ${pose.length} octets — ${script.installe}`);
  console.log(`     À reposer : ${REPARER}`);
  echecs += 1;
}

console.log('');
if (echecs) {
  console.log(`ÉCHEC : ${echecs} script(s) système en dérive ou absent(s).`);
  process.exit(1);
}
console.log(
  sautes
    ? `OK — ${SCRIPTS.length - sautes} script(s) vérifié(s), ${sautes} pas encore versionné(s) ici.`
    : `OK — les ${SCRIPTS.length} script(s) système installés sont ceux du dépôt.`,
);
