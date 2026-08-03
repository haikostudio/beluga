#!/usr/bin/env node
/**
 * Le moteur Codex reçoit-il VRAIMENT les outils du projet ?
 *
 * On construit la ligne de commande avec le code du démon (buildCodexArgs),
 * mais on branche un pont d'outils d'ESSAI à la place du vrai : ainsi le
 * contrôle ne touche ni à la base ni au tableau. On lance un vrai tour de
 * Codex et on vérifie deux choses, les deux qui étaient cassées :
 *   1. l'outil « board_create_card » est bien PRÉSENT dans la session ;
 *   2. l'appel n'est pas ANNULÉ faute d'approbation.
 *
 *   node scripts/verif-outils-codex.mjs
 *
 * Consomme un petit tour du quota Codex. Ne publie rien, n'écrit rien hors
 * de /tmp.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodexArgs, codexAdapter } from '../server/dist/engines/codex.js';

const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-codex-'));
const PONT = path.join(DOSSIER, 'pont-essai.mjs');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

fs.writeFileSync(
  PONT,
  `import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const envoyer = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
rl.on('line', (ligne) => {
  let m; try { m = JSON.parse(ligne); } catch { return; }
  if (m.method === 'initialize') envoyer({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'haikodev', version: '1.0.0' } } });
  else if (m.method === 'tools/list') envoyer({ jsonrpc: '2.0', id: m.id, result: { tools: [
    { name: 'board_create_card', description: 'Propose une carte au tableau', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
    { name: 'project_memory', description: 'Le texte entier des faits du projet', inputSchema: { type: 'object', properties: { sujet: { type: 'string' } } } },
  ] } });
  else if (m.method === 'tools/call') envoyer({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'PONT-ESSAI-OK' }] } });
  else if (m.id !== undefined) envoyer({ jsonrpc: '2.0', id: m.id, result: {} });
});
`,
  'utf8',
);

const evenements = [];
const args = buildCodexArgs({
  cwd: DOSSIER,
  prompt:
    'Appelle tout de suite l\'outil board_create_card du serveur haikodev avec title="essai", ' +
    'puis recopie exactement le texte rendu par l\'outil. Si l\'outil n\'existe pas, réponds « OUTIL ABSENT ».',
  // Le cas qui plantait : le chef d\'orchestre, donc SANS accès complet.
  fullAccess: false,
  mcpConfigPath: path.join(DOSSIER, 'inutile.json'),
  mcpBridgePath: PONT,
  env: { HAIKODEV_TOKEN: 'essai', HAIKODEV_URL: 'http://127.0.0.1:7070', HAIKODEV_AGENT: 'essai' },
  onEvent: () => {},
});

noter('la ligne de commande annonce le pont d\'outils', args.join(' ').includes(PONT));
noter(
  'les outils sont approuvés d\'avance',
  args.join(' ').includes('mcp_servers.haikodev.default_tools_approval_mode="approve"'),
);

console.log('  …  un tour de Codex est lancé (une minute environ)');
const sortie = await new Promise((resolve) => {
  const enfant = spawn(codexAdapter.binary, args, {
    cwd: DOSSIER,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let texte = '';
  enfant.stdout.on('data', (c) => {
    texte += c.toString('utf8');
  });
  enfant.stderr.on('data', () => {});
  const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 240000);
  enfant.on('close', () => {
    clearTimeout(minuteur);
    resolve(texte);
  });
});

for (const ligne of sortie.split('\n')) {
  const t = ligne.trim();
  if (!t.startsWith('{')) continue;
  try {
    evenements.push(JSON.parse(t));
  } catch {
    /* ligne partielle */
  }
}

const appels = evenements
  .map((e) => e.item)
  .filter((i) => i && i.type === 'mcp_tool_call');
const reponse = evenements
  .map((e) => e.item)
  .filter((i) => i && i.type === 'agent_message')
  .map((i) => i.text ?? '')
  .join('\n');

noter('l\'outil du tableau est présent dans la session', appels.length > 0 && !/OUTIL ABSENT/i.test(reponse));
const annule = appels.some((a) => /cancel|reject|denied/i.test(a.error?.message ?? ''));
noter('aucun appel n\'est annulé faute d\'approbation', appels.length > 0 && !annule);
noter('le résultat de l\'outil revient au moteur', /PONT-ESSAI-OK/.test(reponse));

fs.rmSync(DOSSIER, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
