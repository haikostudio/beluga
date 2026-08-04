#!/usr/bin/env node
/**
 * Pont d'outils HaikoDev : parle MCP en entrée/sortie standard avec le moteur
 * (Claude Code ou Codex) et relaie chaque appel au démon en HTTP local.
 * Fichier volontairement autonome, sans dépendance ni compilation.
 */
import readline from 'node:readline';

const URL_BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7070';
const TOKEN = process.env.HAIKODEV_TOKEN || '';
const AGENT = process.env.HAIKODEV_AGENT || '';

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function callDaemon(route, body) {
  const res = await fetch(`${URL_BASE}/internal/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-haikodev-token': TOKEN, 'x-haikodev-agent': AGENT },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`démon indisponible (${res.status})`);
  return res.json();
}

/**
 * Le pont s'annonce au démon dès la poignée de main du moteur. C'est la SEULE
 * preuve qu'il a démarré : sans elle, un tour sans aucun outil du projet ne se
 * distinguait pas d'un tour normal. On n'attend pas la réponse et un échec ne
 * casse rien — le moteur passe avant.
 */
function annoncerLeDemarrage() {
  callDaemon('pont', {}).catch(() => {});
}

let toolsCache = null;

async function getTools() {
  if (toolsCache) return toolsCache;
  const data = await callDaemon('tools', {});
  toolsCache = data.tools ?? [];
  return toolsCache;
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }

  const { id, method, params } = message;

  try {
    switch (method) {
      case 'initialize':
        annoncerLeDemarrage();
        reply(id, {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'haikodev', version: '1.0.0' },
        });
        return;

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // notification : aucune réponse attendue

      case 'ping':
        reply(id, {});
        return;

      case 'tools/list':
        reply(id, { tools: await getTools() });
        return;

      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments ?? {};
        const result = await callDaemon('call', { name, args });
        reply(id, {
          content: [{ type: 'text', text: String(result.text ?? '') }],
          isError: result.ok === false,
        });
        return;
      }

      case 'resources/list':
        reply(id, { resources: [] });
        return;

      case 'prompts/list':
        reply(id, { prompts: [] });
        return;

      default:
        if (id !== undefined) replyError(id, -32601, `méthode inconnue : ${method}`);
        return;
    }
  } catch (err) {
    if (id !== undefined) replyError(id, -32000, err?.message ?? String(err));
  }
});

rl.on('close', () => process.exit(0));
