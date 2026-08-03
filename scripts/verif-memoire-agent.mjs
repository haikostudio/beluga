#!/usr/bin/env node
/*
 * Le contrôle qui compte : un agent qui ne reçoit que l'INDEX de la mémoire
 * va-t-il vraiment chercher le texte entier d'un fait quand il en a besoin ?
 *
 * On monte un projet d'essai avec une mémoire dont un fait porte un détail
 * impossible à deviner, on donne à un VRAI moteur le briefing tel qu'il part
 * en production (index seul) et l'outil `project_memory`, et on regarde s'il
 * ressort le détail. Aucun démon, aucune carte : le mécanisme, tout seul.
 *
 *   node scripts/verif-memoire-agent.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));

/* Le détail introuvable ailleurs : c'est lui qui prouve la lecture. */
const DÉTAIL = 'quatre-vingt-treize millisecondes';
const FAIT_PIÉGÉ =
  `Le tiroir des réglages se referme en tirant sa poignée vers le bas : le geste n'est pris en compte qu'au-delà de ${DÉTAIL}, sinon un simple appui refermait le tiroir sous le doigt.`;

/* ------------------------------------------------------------------ */
/* Le projet d'essai                                                   */
/* ------------------------------------------------------------------ */

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-verif-memoire-'));
const REMPLISSAGE = [
  "La barre du haut ne garde que deux repères : l'icône de réseau à gauche et un bouton à trois points à droite.",
  "Les formulaires posent une étiquette au-dessus et le champ pleine largeur en dessous, jamais deux champs côte à côte.",
  "La publication fusionne les branches du lot dans la principale, vérifie, construit, puis installe la construction.",
  "Le catalogue des modèles interroge les comptes l'un après l'autre : un jeton périmé ne fait plus retomber toute la liste.",
];
for (const ligne of REMPLISSAGE) memory.appendMemory(dossier, ligne);
memory.appendMemory(dossier, FAIT_PIÉGÉ);
memory.appendMemory(dossier, '03.08.2026 : « Une carte quelconque » livrée et publiée.');

const briefing = memory.briefing(dossier, 'Projet d\'essai', true);

if (briefing.includes(DÉTAIL)) {
  console.error(`\n✗ ÉCHEC : le briefing contient déjà le détail « ${DÉTAIL} » — l'index n'est pas un index.`);
  process.exit(1);
}
if (memory.readMemory(dossier).includes('livrée et publiée')) {
  console.error('\n✗ ÉCHEC : une livraison datée est restée dans la mémoire au lieu de partir dans l\'historique.');
  process.exit(1);
}
console.log(`Projet d'essai : ${dossier}`);
// Sur cinq faits, le briefing reste plus long que la mémoire (il porte aussi
// les consignes) : le gain se voit sur un projet chargé, pas sur cet essai.
console.log(`Briefing envoyé : ${briefing.length} signes — mémoire entière : ${memory.readMemory(dossier).length} signes.`);
console.log('Le détail piégé n\'est PAS dans le briefing : il faudra aller le chercher.\n');

/* ------------------------------------------------------------------ */
/* L'outil de mémoire, en petit serveur d'outils                       */
/* ------------------------------------------------------------------ */

const OUTIL = path.join(dossier, 'outil-memoire.mjs');
fs.writeFileSync(
  OUTIL,
  `import readline from 'node:readline';
const memory = await import(${JSON.stringify(path.join(RACINE, 'server/dist/memory.js'))});
const DOSSIER = ${JSON.stringify(dossier)};
const send = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'memoire', version: '1.0.0' } } });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'project_memory', description: "Le TEXTE ENTIER des faits de la mémoire du projet. L'index reçu au lancement est tronqué.", inputSchema: { type: 'object', properties: { sujet: { type: 'string' } } } }] } });
  if (method === 'tools/call') {
    const texte = memory.detailMemoire(DOSSIER, String(params?.arguments?.sujet ?? ''));
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: texte }] } });
  }
  if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
  if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: method } });
});
`,
  'utf8',
);

const CONFIG = path.join(dossier, 'mcp.json');
fs.writeFileSync(
  CONFIG,
  JSON.stringify({ mcpServers: { memoire: { command: process.execPath, args: [OUTIL] } } }, null, 2),
);

/* ------------------------------------------------------------------ */
/* La question posée au vrai moteur                                    */
/* ------------------------------------------------------------------ */

const QUESTION = `${briefing}

---

DEMANDE :
Je m'apprête à toucher au tiroir des réglages et à sa poignée. Avant de modifier quoi que ce soit, dis-moi la règle exacte qui s'applique, chiffre compris. N'invente rien : va la chercher.`;

const args = [
  '-p', QUESTION,
  '--model', 'haiku',
  '--output-format', 'text',
  '--mcp-config', CONFIG,
  '--allowedTools', 'mcp__memoire__project_memory',
  '--permission-mode', 'bypassPermissions',
];

console.log('Interrogation du moteur (Haiku)…\n');
const sortie = await new Promise((resolve, reject) => {
  const proc = spawn('claude', args, { cwd: dossier, env: { ...process.env, HAIKODEV_URL: '' } });
  let out = '';
  let err = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (err += d));
  proc.on('error', reject);
  proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `code ${code}`))));
});

console.log(sortie.trim());
console.log('\n' + '-'.repeat(60));

if (sortie.includes(DÉTAIL) || sortie.includes('93')) {
  console.log(`✓ L'agent est allé chercher le détail dans la mémoire : « ${DÉTAIL} » retrouvé.`);
  fs.rmSync(dossier, { recursive: true, force: true });
  process.exit(0);
}

console.error(
  `✗ ÉCHEC : le détail « ${DÉTAIL} » n'apparaît pas dans la réponse — l'agent n'a pas ouvert la mémoire.\n` +
    `Le projet d'essai reste dans ${dossier} pour être relu.`,
);
process.exit(1);
