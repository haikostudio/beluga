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
import http from 'node:http';
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
noter('la mémoire interne du moteur est éteinte', args.includes('features.memories=false'));

/* --- Le pont s'annonce-t-il au démon ? (sans quota, sans vrai démon) --- */
{
  const vus = [];
  const faux = http.createServer((req, res) => {
    vus.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tools: [{ name: 'project_memory', description: 'x', inputSchema: { type: 'object' } }] }));
  });
  await new Promise((r) => faux.listen(0, '127.0.0.1', r));
  const adresse = `http://127.0.0.1:${faux.address().port}`;
  const enfant = spawn(process.execPath, [path.join(process.cwd(), 'server', 'mcp-bridge.mjs')], {
    env: { ...process.env, HAIKODEV_URL: adresse, HAIKODEV_TOKEN: 'essai', HAIKODEV_AGENT: 'essai' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  enfant.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n',
  );
  await new Promise((r) => setTimeout(r, 1200));
  enfant.kill('SIGKILL');
  faux.close();
  noter('le pont annonce son démarrage au démon', vus.includes('/internal/pont'));
}

/* --- Le moteur accepte-t-il ces réglages ? (lecture seule, sans quota) --- */
{
  const liste = await new Promise((resolve) => {
    const enfant = spawn(codexAdapter.binary, ['mcp', 'list', '--json', ...args.filter((a, i) => a === '-c' || args[i - 1] === '-c')], {
      cwd: DOSSIER,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let texte = '';
    enfant.stdout.on('data', (c) => (texte += c.toString('utf8')));
    enfant.on('close', () => resolve(texte));
  });
  let serveurs = [];
  try {
    serveurs = JSON.parse(liste);
  } catch {
    /* le moteur n'a rien rendu */
  }
  const notre = serveurs.find((s) => s.name === 'haikodev');
  noter('le moteur retient le serveur d\'outils du projet', Boolean(notre) && notre.enabled !== false);
  noter(
    'les serveurs d\'outils étrangers sont éteints',
    serveurs.filter((s) => s.name !== 'haikodev').every((s) => s.enabled === false),
    serveurs.map((s) => `${s.name}=${s.enabled ? 'allumé' : 'éteint'}`).join(', '),
  );
}

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

/*
 * UN COMPTE REFUSÉ N'EST PAS UN OUTIL ABSENT. Sans ce tri, un jeton périmé
 * faisait dire au contrôle « l'outil n'est pas présent dans la session » —
 * c'est-à-dire une panne d'identité racontée comme une panne de branchement.
 */
const pannes = evenements
  .filter((e) => e.type === 'error' || e.type === 'turn.failed')
  .map((e) => e.message ?? e.error?.message ?? '')
  .join('\n');
const compteRefuse = /token|sign in|log out|unauthorized|401/i.test(pannes);

if (compteRefuse) {
  console.log(`\n  ARRÊT  le compte Codex est refusé par le moteur : ${pannes.split('\n')[0]}`);
  console.log('         les contrôles du vrai tour n\'ont PAS pu être joués — reconnecter le compte, puis relancer.');
} else {
  noter('l\'outil du tableau est présent dans la session', appels.length > 0 && !/OUTIL ABSENT/i.test(reponse));
  const annule = appels.some((a) => /cancel|reject|denied/i.test(a.error?.message ?? ''));
  noter('aucun appel n\'est annulé faute d\'approbation', appels.length > 0 && !annule);
  noter('le résultat de l\'outil revient au moteur', /PONT-ESSAI-OK/.test(reponse));
}

fs.rmSync(DOSSIER, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length || compteRefuse ? 1 : 0);
