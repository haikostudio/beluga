#!/usr/bin/env node
/*
 * PLUS AUCUNE COMMANDE D'AGENT NE COUPE LE DÉMON.
 *
 * Le cas réel du 14/08/2026, rejoué pour de vrai. Un agent avait lancé, pour
 * faire le ménage de ses propres essais :
 *
 *     pkill -9 -f "haikodev-serveu" 2>/dev/null; sleep 1
 *
 * Ses serveurs d'essai portaient EXACTEMENT le même nom que le démon de
 * production — « haikodev-serveur », tronqué à quinze signes par le noyau dans
 * `ps` et `ss`. Le démon est tombé avec onze étapes de travail en vol.
 *
 * Ce contrôle vérifie les deux verrous posés depuis :
 *
 *  1. LE NOM. Un serveur monté sur une base à lui — ce que fait tout script de
 *     contrôle — s'appelle « haikodev-essai-<port> ». On le lance vraiment et on
 *     lit son nom dans /proc, comme le ferait `ps`.
 *  2. LE GARDE. La commande fautive est passée au garde réellement branché
 *     devant les commandes des agents (`server/garde-demon.mjs`), tel que le
 *     moteur l'appelle : le JSON sur l'entrée standard. Elle doit être REFUSÉE,
 *     et le ménage légitime d'un agent doit passer.
 *
 * AUCUN PROCESSUS N'EST TUÉ ICI : le contrôle regarde les noms et le verdict du
 * garde, il ne rejoue jamais le `pkill` lui-même — ce serait couper le démon
 * pour de bon. Aucune base réelle n'est touchée.
 *
 *   node scripts/verif-garde-demon.mjs
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GARDE = path.join(RACINE, 'server', 'garde-demon.mjs');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-garde-demon-'));
const PORT = 7331 + (process.pid % 40);

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/** Le nom que le système voit, celui que `ps` et `ss` affichent (15 signes). */
function nomVuParLeSysteme(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch {
    return '';
  }
}

/** Le garde, appelé comme le moteur l'appelle : JSON sur l'entrée standard. */
function jugerParLeGarde(commande, env = {}) {
  const entree = JSON.stringify({ tool_name: 'Bash', tool_input: { command: commande } });
  try {
    execFileSync('node', [GARDE], {
      input: entree,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { refusee: false, message: '' };
  } catch (err) {
    return { refusee: err.status === 2, message: String(err.stderr ?? '') };
  }
}

/* ------------------------------------------------------------------ */
console.log('\n1. Un serveur monté pour un contrôle ne porte plus le nom du démon');
/* ------------------------------------------------------------------ */

const essai = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: path.join(dossier, 'data'),
    HAIKODEV_PROJECTS_ROOT: path.join(dossier, 'projets'),
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise((resolve) => setTimeout(resolve, 3500));

const nom = nomVuParLeSysteme(essai.pid);
verifier(nom.length > 0, `le serveur d’essai tourne (nom vu par le système : « ${nom || '?'} »)`);
verifier(!nom.startsWith('haikodev-serveu'), 'il ne s’appelle PAS comme le démon de production');
verifier(nom.startsWith('haikodev-essai'), 'il s’appelle « haikodev-essai-… », visable sans danger');

/*
 * Le geste de l'incident, joué à blanc : le motif de l'agent aurait-il désigné
 * ce serveur d'essai ? On le lit, on ne tire pas.
 */
verifier(
  !new RegExp('haikodev-serveu').test(nom),
  'le motif « haikodev-serveu » de l’incident ne le désigne plus',
);

try {
  process.kill(essai.pid, 'SIGKILL');
} catch {
  /* déjà parti */
}

/* ------------------------------------------------------------------ */
console.log('\n2. Le garde refuse la commande qui a coupé la tâche');
/* ------------------------------------------------------------------ */

const fautive = jugerParLeGarde('pkill -9 -f "haikodev-serveu" 2>/dev/null; sleep 1');
verifier(fautive.refusee, 'la commande exacte de l’incident est refusée avant de partir');
verifier(/haikodev-essai/.test(fautive.message), 'le refus dit quoi viser à la place');

const differe = jugerParLeGarde("setsid nohup bash -c 'sleep 30; systemctl restart haikodev' &");
verifier(differe.refusee, 'un redémarrage du service, même différé, est refusé');

const parNumero = jugerParLeGarde('kill -9 4242', { HAIKODEV_DEMON_PID: '4242' });
verifier(parNumero.refusee, 'un « kill -9 » visant le numéro du démon est refusé');

/* ------------------------------------------------------------------ */
console.log('\n3. Le ménage légitime d’un agent passe sans un mot');
/* ------------------------------------------------------------------ */

for (const commande of [
  'pkill -9 -f "scripts/_essai-rotation-carte.mjs" 2>/dev/null; sleep 1',
  'pkill -f "vite.*7099"',
  `pkill -f "haikodev-essai-${PORT}"`,
  'npm test',
]) {
  verifier(!jugerParLeGarde(commande).refusee, `« ${commande.slice(0, 48)}… » passe`);
}

fs.rmSync(dossier, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nTout est vérifié : le démon ne peut plus être coupé par la commande d’un agent.');
