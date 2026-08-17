#!/usr/bin/env node
/**
 * UN MOTEUR QUI REFUSE DE S'ARRÊTER EST COUPÉ POUR DE BON.
 *
 *   node scripts/verif-arret-moteur-recalcitrant.mjs
 *
 * Le contrôle voisin (`verif-arret-agent-bloque.mjs`) juge la DÉCISION du
 * bouton : que fait-il, et que dit-il. Celui-ci juge le GESTE lui-même, sur de
 * VRAIS processus — c'est le cœur du « j'ai cliqué et rien ne se passe ».
 *
 * Trois choses se vérifient ici, et rien d'autre ne tourne : aucun démon,
 * aucune base, aucun moteur de langage.
 *
 *   1. Un moteur ORDINAIRE, qui répond à son signal, s'en va tout de suite —
 *      on ne va pas plus loin, on ne l'achève pas pour rien.
 *   2. Un moteur qui IGNORE son signal (`trap '' TERM`, exactement ce que fait
 *      un processus pendu dans un appel qui ne revient jamais) est achevé au
 *      bout du délai de grâce. C'est le cas que `child.killed` ratait : le
 *      signal était bien PARTI, donc on croyait le travail fini.
 *   3. Sa DESCENDANCE part avec lui. Un moteur lance son pont d'outils et ses
 *      commandes ; ces petits-enfants ne reçoivent pas le signal du parent, et
 *      l'un d'eux qui survit garde la sortie ouverte — le tour ne se refermait
 *      alors jamais.
 *
 * Et un refus de sûreté est vérifié au passage : ce script lui-même, qui est le
 * père de tout ce petit monde, est toujours vivant à la fin.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { arreterProcessus } = await import(
  pathToFileURL(path.join(RACINE, 'server', 'dist', 'engines', 'fin-de-processus.js')).href
);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ce numéro de processus répond-il encore ? Le signal 0 ne tue rien, il constate. */
function vivant(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Un « moteur » d'essai : un shell qui lance un enfant à lui (le pont d'outils
 * du cas réel) et annonce son numéro sur sa sortie. `recalcitrant` lui fait
 * ignorer le signal d'arrêt, comme un processus pendu.
 */
function lancerFauxMoteur({ recalcitrant }) {
  const script = `${recalcitrant ? "trap '' TERM\n" : ''}sleep 300 &\necho $!\nwait\n`;
  const enfant = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve) => {
    let sortie = '';
    enfant.stdout.on('data', (d) => {
      sortie += String(d);
      const numero = Number(sortie.trim().split('\n')[0]);
      if (Number.isInteger(numero) && numero > 1) resolve({ enfant, petitFils: numero });
    });
  });
}

/** Le délai de grâce du geste réel est de 4 s ; on l'abrège pour le contrôle. */
const GRACE_MS = 700;

async function main() {
  /* -------- 1. Le moteur ordinaire, qui obéit -------- */

  const obeissant = await lancerFauxMoteur({ recalcitrant: false });
  arreterProcessus(obeissant.enfant, 'essai-obeissant', GRACE_MS);
  await dormir(300);
  noter(
    'un moteur qui répond à son signal s’en va tout de suite',
    !vivant(obeissant.enfant.pid),
    `moteur ${obeissant.enfant.pid}`,
  );
  await dormir(GRACE_MS + 400);
  noter('sa descendance ne lui survit pas non plus', !vivant(obeissant.petitFils), `enfant ${obeissant.petitFils}`);

  /* -------- 2 & 3. Le moteur qui fait la sourde oreille -------- */

  const tetu = await lancerFauxMoteur({ recalcitrant: true });
  noter('le décor pose bien un moteur qui ignore son signal', vivant(tetu.enfant.pid) && vivant(tetu.petitFils));

  arreterProcessus(tetu.enfant, 'essai-tetu', GRACE_MS);
  await dormir(300);
  noter(
    'juste après le signal, il est encore là : c’est bien le cas qui coinçait',
    vivant(tetu.enfant.pid),
    `moteur ${tetu.enfant.pid}`,
  );

  await dormir(GRACE_MS + 600);
  noter(
    'passé le délai de grâce, il est achevé pour de bon',
    !vivant(tetu.enfant.pid),
    `moteur ${tetu.enfant.pid} — statut ${vivant(tetu.enfant.pid) ? 'encore vivant' : 'parti'}`,
  );
  noter(
    'et sa DESCENDANCE part avec lui, sans garder la sortie ouverte',
    !vivant(tetu.petitFils),
    `enfant ${tetu.petitFils}`,
  );

  /* -------- Le refus de sûreté -------- */

  noter('le père de tout ce monde — ce script — est toujours vivant', vivant(process.pid));

  const passes = resultats.filter((r) => r.ok).length;
  console.log(`\n${passes}/${resultats.length} vérifications passées`);
  if (passes !== resultats.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
