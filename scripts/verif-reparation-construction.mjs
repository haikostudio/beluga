#!/usr/bin/env node
/**
 * Une construction qui échoue est-elle RÉPARÉE, comme un conflit ?
 *
 * On joue le vrai mécanisme de la publication — `construireAvecReparation`,
 * celui-là même que les deux étapes « Construction » appellent — sur un projet
 * d'essai monté dans un dossier temporaire, avec sa propre base.
 *
 * Deux cas :
 * 1. une panne RÉPARABLE : le script de construction échoue tant qu'un fichier
 *    témoin manque, et le passage de l'agent de secours le pose. La
 *    construction doit être rejouée et finir par passer.
 * 2. une panne IRRÉPARABLE : la construction casse toujours, sur le fichier
 *    illisible vu sur haiko-compta (`EACCES: permission denied, open
 *    '…/.tmp/tsconfig.node…'`). Après les passes prévues, le refus doit rester
 *    entier et NOMMER la cause.
 *
 * L'agent de secours n'est pas un vrai moteur : la réparation est passée en
 * argument, pour ne dépenser aucun quota. Ce qu'on vérifie est le MÉCANISME —
 * combien de fois on rejoue, ce qu'on demande à l'agent, ce que dit le refus.
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché :
 * HAIKODEV_DATA est détourné vers le dossier d'essai avant tout import.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-reparation-build-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import('../server/dist/store.js');
const { construireAvecReparation, REPARATIONS_MAX } = await import('../server/dist/deploy.js');
const { consigneDeReparationConstruction } = await import('../shared/dist/index.js');

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}`);
};

/*
 * Le faux agent de secours : au lieu d'un tour payant, il exécute la réparation
 * qu'on lui confie et note la consigne qu'il a reçue — la VRAIE, celle que la
 * publication enverrait.
 */
let reparation = () => {};
let consignesRecues = [];
const fauxAgent = async (projectId, cwd, commande, sortie, passe) => {
  consignesRecues.push(consigneDeReparationConstruction(commande, sortie, passe, REPARATIONS_MAX));
  reparation();
  return { tente: true, recit: `passe ${passe} : agent d’essai` };
};

/** Un petit projet dont la construction échoue tant que `temoin` n'existe pas. */
function monterProjet(nom, temoin) {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  const compteur = path.join(cwd, 'tentatives.txt');
  const casse = `echo "EACCES: permission denied, open '${cwd}/node_modules/.tmp/tsconfig.node.tsbuildinfo'" >&2 && exit 1`;
  const script = temoin
    ? `echo x >> ${compteur} && ( test -f ${temoin} || ( ${casse} ) )`
    : `echo x >> ${compteur} && ${casse}`;
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify({ name: nom, version: '1.0.0', private: true, scripts: { build: script } }, null, 2),
  );
  const maintenant = Date.now();
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1000,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  const tentatives = () =>
    fs.existsSync(compteur) ? fs.readFileSync(compteur, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  return { projet, cwd, tentatives };
}

/* --- 1. Une panne réparable ---------------------------------------- */

console.log('\n1. Une construction cassée que l’agent sait réparer');
const temoin = path.join(racine, 'reparé.txt');
const reparable = monterProjet('essai-reparable', temoin);
consignesRecues = [];
reparation = () => fs.writeFileSync(temoin, 'droits rendus\n');

const bon = await construireAvecReparation(reparable.projet.id, reparable.cwd, 'npm run build', '', fauxAgent);

dire(bon.ok === true, 'la construction finit par passer');
dire(reparable.tentatives() === 2, `la construction est REJOUÉE après réparation (${reparable.tentatives()} tentatives)`);
dire(consignesRecues.length === 1, `un seul agent de secours a suffi (${consignesRecues.length})`);
dire(/EACCES: permission denied/.test(consignesRecues[0] ?? ''), 'la cause est NOMMÉE à l’agent de secours');
dire(
  /Ne désactive JAMAIS la construction/.test(consignesRecues[0] ?? ''),
  'la consigne interdit de contourner le problème',
);
dire(/Réparations tentées/.test(bon.detail), 'l’étape affiche ce que l’agent a tenté');

/* --- 2. Une panne irréparable --------------------------------------- */

console.log('\n2. Une construction cassée que rien ne répare');
const perdu = monterProjet('essai-irreparable', null);
consignesRecues = [];
reparation = () => {};

const mauvais = await construireAvecReparation(perdu.projet.id, perdu.cwd, 'npm run build', '', fauxAgent);

dire(mauvais.ok === false, 'la publication ne passe pas : le refus reste entier');
dire(
  perdu.tentatives() === REPARATIONS_MAX + 1,
  `la construction est tentée ${REPARATIONS_MAX + 1} fois (1 + ${REPARATIONS_MAX} passes), pas une de plus`,
);
dire(consignesRecues.length === REPARATIONS_MAX, `${REPARATIONS_MAX} passes de réparation, comme les contrôles`);
dire(/EACCES: permission denied/.test(mauvais.phrase), `le refus NOMME la cause : « ${mauvais.phrase.slice(0, 100)}… »`);
dire(/Rien n’est mis en ligne/.test(mauvais.phrase), 'le refus dit que rien ne part en ligne');
dire(/Ce qui a cassé la construction/.test(mauvais.detail), 'le détail pose la cause en tête');

console.log(echecs ? `\n${echecs} contrôle(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
