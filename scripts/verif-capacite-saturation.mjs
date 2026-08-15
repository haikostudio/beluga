#!/usr/bin/env node
/**
 * La jauge « Capacité du système » ne doit annoncer une machine saturée que sur
 * une VRAIE saturation.
 *
 * Le cas vécu (capture du 15/08/2026) : « Plus aucun agent ne peut démarrer ·
 * 3 en cours · plafond 15 », barre rouge, charge processeur 216 %. La phrase se
 * contredisait elle-même — il restait douze places, et c'est une pointe de
 * charge d'une minute qui les ramenait à zéro derrière le dos de l'utilisateur.
 *
 * On vérifie ici DEUX choses :
 *   1. la règle pure, sur les chiffres exacts de la capture ;
 *   2. le VRAI relevé du serveur construit, sur cette machine : à sa charge de
 *      fond habituelle, il ne doit ni se déclarer suspendu, ni tomber à zéro
 *      place, et son compte de tâches ne doit jamais dépasser son compte
 *      d'agents.
 *
 *   node scripts/verif-capacite-saturation.mjs
 *
 * Base jetable : aucun projet réel n'est touché, aucun moteur n'est appelé.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Le dépôt d'où PART ce script, jamais /root/haikodev en dur : lancé depuis une
// copie de travail, il doit juger cette copie.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resultats = [];
function note(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const shared = await import(pathToFileURL(path.join(RACINE, 'shared/dist/index.js')).href);
  const { chargeRetenue, detailDesAgents, freinDeCharge, phraseCapacite, tauxOccupation } = shared;

  /* --- 1. La règle pure, sur les chiffres de la capture --------------- */

  const capture = { instantPct: 216, soutenuePct: 105 };
  note(
    'la pointe de 216 % de la capture ne freine plus rien',
    freinDeCharge(capture).placesMax === null,
    `charge retenue ${chargeRetenue(capture)} %`,
  );

  const etatCapture = { runningAgents: 3, slotsFree: 12 };
  note(
    'avec douze places libres, l’écran ne dit plus « Plus aucun agent ne peut démarrer »',
    phraseCapacite(etatCapture) === '12 agents peuvent encore démarrer',
    phraseCapacite(etatCapture),
  );
  note('la barre n’est plus pleine', tauxOccupation(etatCapture) === 20, `${tauxOccupation(etatCapture)} %`);

  note(
    'le compte dit les tâches, pas seulement les agents',
    detailDesAgents({ runningAgents: 3, runningTasks: 2 }) === '2 tâches en cours · 1 agent de service',
    detailDesAgents({ runningAgents: 3, runningTasks: 2 }),
  );

  const durable = freinDeCharge({ instantPct: 400, soutenuePct: 340 });
  note(
    'une surcharge RÉELLE et durable arrête bien les départs',
    durable.placesMax === 0 && /surchargée/.test(durable.raison ?? ''),
    durable.raison ?? '',
  );

  const passagere = freinDeCharge({ instantPct: 250, soutenuePct: 180 });
  note(
    'une charge soutenue freine sans tout bloquer',
    passagere.placesMax === 3,
    `${passagere.placesMax} départs tolérés`,
  );

  /* --- 2. Le VRAI relevé du serveur, sur cette machine ---------------- */

  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-capacite-'));
  process.env.HAIKODEV_DATA = donnees;
  try {
    const capacity = await import(pathToFileURL(path.join(RACINE, 'server/dist/capacity.js')).href);
    const snap = capacity.snapshot();
    console.log(
      `  relevé réel : ${snap.cpuLoadPct} % sur la minute, ${snap.cpuLoadSustainedPct} % sur le quart d'heure, ` +
        `${snap.slotsFree} places, ${snap.runningAgents} agents`,
    );

    note('le relevé porte la charge soutenue', typeof snap.cpuLoadSustainedPct === 'number');
    note('la machine ne se déclare pas suspendue au repos', snap.paused === false, snap.pauseReason ?? '');
    note('il reste des places', snap.slotsFree > 0, `${snap.slotsFree} places`);
    note(
      'les tâches ne dépassent jamais le total des agents',
      (snap.runningTasks ?? 0) <= snap.runningAgents,
      `${snap.runningTasks} sur ${snap.runningAgents}`,
    );
    note('un départ est possible', capacity.canStartAgent().ok, capacity.canStartAgent().reason ?? '');
  } finally {
    fs.rmSync(donnees, { recursive: true, force: true });
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
