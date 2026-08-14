#!/usr/bin/env node
/**
 * Le moteur Cursor reçoit-il VRAIMENT les outils du projet — et peut-il les
 * APPELER ?
 *
 * La panne constatée le 14/08/2026 : depuis le chef d'un projet autre
 * qu'HaikoDev (donc SANS accès complet), plus aucune carte ne se créait. Le CLI
 * était lancé sans `--force`, donc en mode « allowlist » : chaque appel d'outil
 * attendait une approbation que personne ne pouvait donner dans un tour `-p`.
 * L'appel était refusé EN SILENCE — sans résultat, sans message —, le pont
 * n'était jamais contacté, et le moteur en concluait de lui-même « la
 * proposition a été refusée ».
 *
 * Le contrôle rejoue exactement cela : la ligne de commande vient du démon
 * (`buildCursorArgs`), mais le pont branché est un pont d'ESSAI qui écrit sa
 * trace dans un fichier — ni base, ni tableau, ni mémoire touchés.
 *
 *   CURSOR_API_KEY=… node scripts/verif-outils-cursor.mjs
 *
 * Deux vrais tours de Cursor (quelques centimes) : le cas qui tombait, puis un
 * TÉMOIN sans `--force` qui doit, lui, rester muet — sinon le contrôle ne
 * prouverait rien.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCursorArgs, cursorAdapter } from '../server/dist/engines/cursor.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-outils-cursor-'));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/* --- Le pont d'essai : il note tout ce qu'on lui demande --- */
const PONT = path.join(DOSSIER, 'pont-essai.mjs');
fs.writeFileSync(
  PONT,
  `import readline from 'node:readline';
import fs from 'node:fs';
const trace = (l) => fs.appendFileSync(process.env.TRACE_PONT, l + '\\n');
trace('demarre');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const envoyer = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
rl.on('line', (ligne) => {
  let m; try { m = JSON.parse(ligne.trim()); } catch { return; }
  if (m.method === 'initialize') { trace('initialize'); envoyer({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'haikodev', version: '1.0.0' } } }); }
  else if (m.method === 'tools/list') { trace('tools/list'); envoyer({ jsonrpc: '2.0', id: m.id, result: { tools: [
    { name: 'board_create_card', description: 'Propose une carte au tableau du projet', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  ] } }); }
  else if (m.method === 'tools/call') { trace('appel:' + m.params?.name); envoyer({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'PONT-ESSAI-OK' }] } }); }
  else if (m.method === 'resources/list') envoyer({ jsonrpc: '2.0', id: m.id, result: { resources: [] } });
  else if (m.method === 'prompts/list') envoyer({ jsonrpc: '2.0', id: m.id, result: { prompts: [] } });
  else if (m.id !== undefined) envoyer({ jsonrpc: '2.0', id: m.id, result: {} });
});
`,
  'utf8',
);

const DEMANDE =
  "Appelle tout de suite l'outil board_create_card du serveur haikodev avec title=\"essai\", " +
  "puis recopie exactement le texte rendu par l'outil. N'écris rien d'autre.";

/** Un atelier à soi, avec sa configuration d'outils et sa trace. */
function atelier(nom) {
  const dossier = path.join(DOSSIER, nom);
  const trace = path.join(DOSSIER, `${nom}.txt`);
  fs.mkdirSync(path.join(dossier, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, '.cursor', 'mcp.json'),
    JSON.stringify(
      { mcpServers: { haikodev: { command: process.execPath, args: [PONT], env: { TRACE_PONT: trace } } } },
      null,
      2,
    ),
    'utf8',
  );
  return { dossier, trace, lire: () => (fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '') };
}

async function tour(dossier, args) {
  return new Promise((resolve) => {
    const enfant = spawn(cursorAdapter.binary, args, {
      cwd: dossier,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let texte = '';
    let erreur = '';
    enfant.stdout.on('data', (c) => (texte += c.toString('utf8')));
    enfant.stderr.on('data', (c) => (erreur += c.toString('utf8')));
    enfant.stdin.write(DEMANDE);
    enfant.stdin.end();
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 240000);
    enfant.on('close', () => {
      clearTimeout(minuteur);
      resolve({ texte, erreur });
    });
  });
}

/* --- 1. La ligne de commande, lue avant tout appel --- */
const options = {
  cwd: DOSSIER,
  prompt: DEMANDE,
  // LE CAS QUI TOMBAIT : le chef d'un projet autre qu'HaikoDev, donc sans
  // accès complet.
  fullAccess: false,
  mcpConfigPath: path.join(DOSSIER, 'inutile.json'),
  onEvent: () => {},
};
const args = buildCursorArgs(options, 'composer-2.5');
noter("les outils sont approuvés d'office, même sans accès complet", args.includes('--force'));
noter("le pont d'outils est approuvé d'avance", args.includes('--approve-mcps'));
noter(
  'le mode plan garde ses outils',
  buildCursorArgs({ ...options, mode: 'plan', role: 'task' }, 'composer-2.5').includes('--force'),
);
noter(
  "le bac à sable, lui, suit toujours l'accès complet",
  !args.includes('--sandbox') && buildCursorArgs({ ...options, fullAccess: true }, 'composer-2.5').includes('--sandbox'),
);

if (!(process.env.CURSOR_API_KEY || '').trim()) {
  console.log("\n  ARRÊT  aucune clé dans CURSOR_API_KEY : le vrai tour n'a PAS pu être joué.");
  fs.rmSync(DOSSIER, { recursive: true, force: true });
  process.exit(1);
}

/* --- 2. Le vrai tour : l'appel arrive-t-il au pont ? --- */
console.log('  …  un tour de Cursor est lancé (une minute environ)');
const vrai = atelier('avec-force');
const sortie = await tour(vrai.dossier, buildCursorArgs({ ...options, cwd: vrai.dossier }, 'composer-2.5'));
const trace = vrai.lire();

const refus = /invalid|unauthorized|not logged in|api key/i.test(sortie.erreur);
if (refus) {
  console.log(`\n  ARRÊT  la clé Cursor est refusée : ${sortie.erreur.trim().split('\n')[0]}`);
  console.log("         les contrôles du vrai tour n'ont PAS pu être joués.");
} else {
  noter("le pont d'outils démarre", /demarre/.test(trace));
  noter('le moteur demande la liste des outils', /tools\/list/.test(trace));
  noter("l'appel d'outil arrive vraiment au pont", /appel:board_create_card/.test(trace));
  noter("le résultat de l'outil revient au moteur", /PONT-ESSAI-OK/.test(sortie.texte));
}

/* --- 3. Le témoin : sans `--force`, l'appel doit rester bloqué --- */
if (!refus) {
  console.log('  …  le témoin sans « --force » est lancé (une minute environ)');
  const temoin = atelier('sans-force');
  await tour(
    temoin.dossier,
    buildCursorArgs({ ...options, cwd: temoin.dossier }, 'composer-2.5').filter((a) => a !== '--force'),
  );
  noter(
    "sans « --force », l'appel n'arrive pas au pont (c'était la panne)",
    !/appel:board_create_card/.test(temoin.lire()),
    'si ce contrôle tombe, le CLI a changé de comportement : la règle est à revoir',
  );
}

fs.rmSync(DOSSIER, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
console.log(`(dépôt vérifié : ${RACINE})`);
process.exit(echecs.length || refus ? 1 : 0);
