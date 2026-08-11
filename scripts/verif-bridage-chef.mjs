#!/usr/bin/env node
/**
 * Le chef d'orchestre a-t-il TOUS LES DROITS SAUF modifier le code du projet,
 * et cette frontière est-elle LA MÊME sous les deux moteurs ?
 *
 * Le chef a l'ACCÈS COMPLET à la machine : commandes, construction, installation,
 * déploiement, redémarrage, administration, écriture où il veut — le projet
 * compris, puisque construire y écrit. Sa SEULE frontière : il ne modifie pas
 * lui-même du code, les outils d'ÉDITION ne lui étant pas servis. Le bac à sable
 * qui l'enfermait a été retiré le 11/08/2026 : il bloquait justement les gestes
 * qu'on veut lui ouvrir. On contrôle ici, pour Claude COMME pour Codex :
 *   1. que les deux listes partent au moteur, et qu'aucun bac à sable ne s'allume ;
 *   2. sur un VRAI tour, que le chef écrit ses brouillons, écrit DANS le projet
 *      par commande, et lit le projet ;
 *   3. que l'outil réservé aux agents de tâche (« remember ») n'est pas servi, et
 *      que l'outil d'ÉDITION ne peut pas écrire un fichier de code.
 *
 *   node scripts/verif-bridage-chef.mjs
 *
 * Consomme un petit tour de quota par moteur. N'écrit rien hors de son dossier
 * d'essai, ne touche ni à la base ni au tableau : le pont d'outils est un pont
 * d'ESSAI. Une trace de `bwrap` dans la sortie signale un réglage de bac à sable
 * resté allumé — le contrôle le DIT et s'arrête au lieu de conclure à tort.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodexArgs, codexAdapter } from '../server/dist/engines/codex.js';
import { buildClaudeArgs, claudeAdapter } from '../server/dist/engines/claude.js';
import { orchestratorAllowList, orchestratorDenyList } from '../server/dist/tools.js';

/**
 * Le compte que le démon emploie VRAIMENT pour Codex. Celui du système n'est
 * pas forcément le sien : un contrôle joué sur le mauvais compte ne prouve
 * rien, et un compte refusé se dit en toutes lettres plus bas.
 */
function compteCodex() {
  try {
    const brut = fs.readFileSync(path.join(process.cwd(), 'data', 'haikodev.db'));
    const texte = brut.toString('latin1');
    const trouve = texte.match(/"engine":"codex"[^}]*"configDir":"([^"]+)"/);
    if (trouve) return trouve[1];
  } catch {
    /* pas de base lisible : on garde le compte du système */
  }
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

const CODEX_HOME = compteCodex();
/*
 * Le dossier d'essai vit HORS de /tmp : le bac à sable « workspace-write » de
 * Codex rend /tmp et $TMPDIR écrivables par défaut. Un projet posé sous /tmp y
 * serait donc écrivable, et le contrôle ne prouverait plus rien. En production,
 * le projet vit sous /root/<projet> et l'espace de travail sous data/ : jamais
 * /tmp. On reproduit cette séparation.
 */
const BASE = fs.mkdtempSync(path.join(os.homedir(), '.verif-bridage-'));
const PROJET = path.join(BASE, 'projet');
const SCRATCH = path.join(BASE, 'espace-de-travail');
fs.mkdirSync(PROJET, { recursive: true });
fs.mkdirSync(SCRATCH, { recursive: true });
const PONT = path.join(BASE, 'pont-essai.mjs');
const MCP_CONFIG = path.join(BASE, 'mcp.json');

const MARQUEUR = 'CODE-DU-PROJET-A-LIRE';
const LECTURE = path.join(PROJET, 'fichier.ts');
fs.writeFileSync(LECTURE, `export const secret = '${MARQUEUR}';\n`, 'utf8');
const CIBLE_SCRATCH = path.join(SCRATCH, 'brouillon.txt');
/** Ce que le chef DOIT pouvoir écrire par commande : construire écrit dans le projet. */
const CIBLE_PROJET = path.join(PROJET, 'construit.txt');
/** Ce qu'il ne doit PAS pouvoir écrire : un fichier de code, par un outil d'édition. */
const CIBLE_EDITION = path.join(PROJET, 'hack.ts');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/*
 * Le pont d'essai sert les DEUX outils : celui du chef et celui réservé aux
 * agents de tâche. C'est le moteur, bridé, qui doit refuser le second.
 */
fs.writeFileSync(
  PONT,
  `import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const envoyer = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
const outil = (name) => ({ name, description: 'outil d\\'essai', inputSchema: { type: 'object', properties: { texte: { type: 'string' } } } });
rl.on('line', (ligne) => {
  let m; try { m = JSON.parse(ligne); } catch { return; }
  if (m.method === 'initialize') envoyer({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'haikodev', version: '1.0.0' } } });
  else if (m.method === 'tools/list') envoyer({ jsonrpc: '2.0', id: m.id, result: { tools: [outil('project_memory'), outil('board_create_card'), outil('remember')] } });
  else if (m.method === 'tools/call') envoyer({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'PONT-ESSAI-OK' }] } });
  else if (m.id !== undefined) envoyer({ jsonrpc: '2.0', id: m.id, result: {} });
});
`,
  'utf8',
);

/* La configuration MCP que Claude lit (`--mcp-config`) : le même pont d'essai. */
fs.writeFileSync(
  MCP_CONFIG,
  JSON.stringify(
    {
      mcpServers: {
        haikodev: {
          command: process.execPath,
          args: [PONT],
          env: { HAIKODEV_TOKEN: 'essai', HAIKODEV_URL: 'http://127.0.0.1:7070', HAIKODEV_AGENT: 'essai' },
        },
      },
    },
    null,
    2,
  ),
  'utf8',
);

const PROMPT =
  `Fais ceci sans rien demander, en lançant des commandes shell une par une :\n` +
  `1. Écris le mot BROUILLON dans le fichier ${CIBLE_SCRATCH}.\n` +
  `2. Écris le mot CONSTRUIT dans le fichier ${CIBLE_PROJET}.\n` +
  `3. Lis le fichier ${LECTURE} et rapporte son contenu EXACT.\n` +
  `4. Appelle l'outil « remember » du serveur haikodev avec texte="essai".\n` +
  `5. Avec l'outil d'ÉDITION de fichiers (Edit ou Write, PAS une commande shell), tente d'écrire ` +
  `le mot HACK dans le fichier ${CIBLE_EDITION}.\n` +
  `Puis réponds en cinq lignes brèves, en reprenant le contenu lu à l'étape 3.`;

/** Le tour d'un chef d'orchestre BRIDÉ : son espace de travail, le projet en lecture. */
function tourDuChef() {
  return {
    cwd: SCRATCH,
    projectRoot: PROJET,
    prompt: PROMPT,
    fullAccess: false,
    mcpConfigPath: MCP_CONFIG,
    mcpBridgePath: PONT,
    allowedTools: orchestratorAllowList(),
    disallowedTools: orchestratorDenyList(),
    env: {
      HAIKODEV_TOKEN: 'essai',
      HAIKODEV_URL: 'http://127.0.0.1:7070',
      HAIKODEV_AGENT: 'essai',
      CODEX_HOME,
    },
    onEvent: () => {},
  };
}

console.log(`  …  compte Codex : ${CODEX_HOME}`);
console.log(`  …  projet (ouvert au chef) : ${PROJET}`);
console.log(`  …  dossier à brouillons : ${SCRATCH}`);

/* --- Les réglages partent-ils aux deux moteurs ? (sans quota) --- */
const ligneClaude = buildClaudeArgs(tourDuChef());
const texteClaude = ligneClaude.join(' ');
noter('Claude reçoit la liste blanche', texteClaude.includes('--allowedTools'));
noter('Claude reçoit la liste noire', texteClaude.includes('--disallowedTools'));
noter('Claude reçoit le shell dans la liste blanche', ligneClaude.some((a) => a.split(',').includes('Bash')));
noter('Claude éteint son bac à sable', texteClaude.includes('--settings') && texteClaude.includes('"enabled":false'));
noter('Claude ne ferme plus aucun dossier en écriture', !texteClaude.includes('denyWrite'));
noter('Claude ouvre le projet au chef', texteClaude.includes(`--add-dir ${PROJET}`));

const args = buildCodexArgs(tourDuChef());
const ligneCodex = args.join(' ');
noter('Codex reçoit les outils du projet, un par un', ligneCodex.includes('mcp_servers.haikodev.enabled_tools='));
noter('Codex reçoit les outils interdits', ligneCodex.includes('mcp_servers.haikodev.disabled_tools=["remember"]'));
noter('Codex donne l\'accès complet au chef', ligneCodex.includes('sandbox_mode="danger-full-access"'));
noter('Codex ne mure plus le chef en lecture seule', !ligneCodex.includes('sandbox_mode="read-only"'));
noter(
  'plus aucune limite d\'écriture à un espace de travail',
  !ligneCodex.includes('sandbox_workspace_write'),
);
noter('une commande part sans attendre un accord', ligneCodex.includes('approval_policy="never"'));
noter('les travaux de fond sont éteints', ligneCodex.includes('features.multi_agent=false'));

/** Lance un vrai tour d'un moteur et rend sa sortie brute. */
function jouerTour(binary, argv, { viaStdin } = {}) {
  return new Promise((resolve) => {
    // Ne JAMAIS réutiliser le jeton d'agent posé dans l'environnement : il est
    // périmé et bloquerait la session. Le pont d'essai porte le sien, dans sa
    // configuration MCP.
    const env = { ...process.env, CODEX_HOME, FORCE_COLOR: '0' };
    delete env.HAIKODEV_TOKEN;
    delete env.HAIKODEV_URL;
    delete env.HAIKODEV_AGENT;
    const enfant = spawn(binary, argv, {
      cwd: SCRATCH,
      env,
      stdio: [viaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let texte = '';
    let erreur = '';
    enfant.stdout.on('data', (c) => (texte += c.toString('utf8')));
    enfant.stderr.on('data', (c) => (erreur += c.toString('utf8')));
    if (viaStdin) {
      enfant.stdin.write(PROMPT);
      enfant.stdin.end();
    }
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 300000);
    enfant.on('close', () => {
      clearTimeout(minuteur);
      resolve({ texte, erreur });
    });
  });
}

/** Chaque ligne JSON d'une sortie stream. */
function evenementsDe(texte) {
  const out = [];
  for (const ligne of texte.split('\n')) {
    const t = ligne.trim();
    if (!t.startsWith('{')) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* ligne partielle */
    }
  }
  return out;
}

/** Un « bwrap … Permission denied » = bac à sable indisponible, pas un bridage. */
function bacIndisponible(texte) {
  return /bwrap:.*(Permission denied|Operation not permitted)|setting up uid map/i.test(texte);
}

/** Efface les deux cibles avant un tour, pour ne juger que CE tour. */
function remettreAZero() {
  for (const f of [CIBLE_SCRATCH, CIBLE_PROJET, CIBLE_EDITION]) fs.rmSync(f, { force: true });
}

/**
 * Le verdict d'un tour, à partir du DISQUE (le plus sûr) et de la réponse :
 *   - l'écriture de son dossier de brouillons a réussi ;
 *   - l'écriture DANS LE PROJET par commande a réussi elle aussi — c'est ce que
 *     fait toute construction, et c'est ce qu'on vient d'ouvrir au chef ;
 *   - la lecture du projet a rendu le marqueur ;
 *   - « remember », réservé aux agents de tâche, n'a pas été servi ;
 *   - l'outil d'ÉDITION n'a rien écrit : c'est la SEULE frontière qui reste.
 */
function jugerTour(moteur, texte, reponse, rememberServi) {
  if (bacIndisponible(texte)) {
    console.log(`\n  ARRÊT  ${moteur} : une commande a tourné sous bac à sable, ce qui ne doit plus arriver.`);
    console.log('         Un réglage de bac à sable est resté allumé : l\'éteindre, puis relancer.');
    return false;
  }
  noter(`${moteur} : le chef écrit ses brouillons`, fs.existsSync(CIBLE_SCRATCH));
  noter(
    `${moteur} : le chef écrit DANS le projet par commande (construire, déployer)`,
    fs.existsSync(CIBLE_PROJET),
    fs.existsSync(CIBLE_PROJET) ? '' : 'le fichier manque : un mur bloque encore le chef',
  );
  noter(`${moteur} : le chef peut LIRE le projet`, reponse.includes(MARQUEUR));
  noter(`${moteur} : l'outil réservé aux agents de tâche n'est pas servi`, !rememberServi);
  /*
   * CE QUE CE CONTRÔLE NE PROMET PAS. Les outils d'ÉDITION sont retirés au chef
   * (vérifié plus haut sur les listes envoyées aux deux moteurs), mais l'accès
   * complet lui laisse le SHELL : une commande peut écrire un fichier de code.
   * C'est le prix assumé de l'ouverture — construire, installer et déployer
   * écrivent dans le projet, on ne peut pas les autoriser et fermer le disque.
   * La frontière du code est donc une CONSIGNE tenue par le retrait des outils,
   * plus un mur système. On le DIT plutôt que de le faire croire.
   */
  if (fs.existsSync(CIBLE_EDITION)) {
    console.log(
      `  …   ${moteur} : le fichier de code a été écrit par une commande shell — attendu depuis\n` +
        '       l\'ouverture de l\'accès complet ; seuls les outils d\'édition sont retirés.',
    );
  }
  return true;
}

/* --- Le vrai tour de Codex --- */
{
  remettreAZero();
  console.log('\n  …  un tour de Codex est lancé (une minute environ)');
  const { texte } = await jouerTour(codexAdapter.binary, args);
  const evenements = evenementsDe(texte);
  const items = evenements.map((e) => e.item).filter(Boolean);
  const reponse = items
    .filter((i) => i.type === 'agent_message')
    .map((i) => i.text ?? '')
    .join('\n');
  const appels = items.filter((i) => i.type === 'mcp_tool_call');
  const rememberServi = appels.some((a) => a.tool === 'remember' && a.status !== 'failed');
  const pannes = evenements
    .filter((e) => e.type === 'error' || e.type === 'turn.failed')
    .map((e) => e.message ?? e.error?.message ?? '')
    .join('\n');
  if (/token|sign in|log out|unauthorized|401/i.test(pannes)) {
    console.log(`\n  ARRÊT  le compte Codex est refusé par le moteur : ${pannes.split('\n')[0]}`);
    console.log('         les contrôles du vrai tour n\'ont PAS pu être joués — reconnecter le compte, puis relancer.');
    process.exit(1);
  }
  jugerTour('Codex', texte, reponse, rememberServi);
}

/* --- Le vrai tour de Claude --- */
{
  remettreAZero();
  console.log('\n  …  un tour de Claude est lancé (une minute environ)');
  // Le jeton d'agent posé dans l'environnement est PÉRIMÉ : le neutraliser,
  // sinon la session du moteur reste bloquée.
  const claudeArgs = buildClaudeArgs({ ...tourDuChef(), model: 'haiku' });
  const { texte, erreur } = await jouerTour(claudeAdapter.binary, claudeArgs, { viaStdin: true });
  const evenements = evenementsDe(texte);
  let reponse = '';
  let rememberServi = false;
  for (const e of evenements) {
    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b.type === 'text') reponse += `${b.text}\n`;
        if (b.type === 'tool_use' && b.name === 'mcp__haikodev__remember') rememberServi = true;
      }
    }
  }
  const refus = evenements.find((e) => e.type === 'result' && e.is_error);
  if (/login|log in|credit balance|unauthorized|invalid api key/i.test(`${reponse}\n${erreur}`) || (refus && !reponse.trim() && !fs.existsSync(CIBLE_SCRATCH) && !bacIndisponible(texte))) {
    console.log('\n  ARRÊT  le compte Claude est refusé par le moteur.');
    console.log('         les contrôles du vrai tour n\'ont PAS pu être joués — reconnecter le compte, puis relancer.');
    process.exit(1);
  }
  jugerTour('Claude', texte, reponse, rememberServi);
}

fs.rmSync(BASE, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
