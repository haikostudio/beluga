#!/usr/bin/env node
/**
 * UNE CARTE PROPOSÉE PORTE-ELLE UNE VRAIE DESCRIPTION, SOUS LES DEUX MOTEURS ?
 *
 * Sur UNE MÊME demande, le script lance un vrai tour de chef d'orchestre avec
 * Claude puis avec Codex, en leur donnant le briefing réel du démon. Les outils
 * du projet sont remplacés par un PONT D'ESSAI qui applique la VRAIE règle
 * (`shared/dist/description-carte.js`) : une description pauvre est refusée et
 * rendue au moteur, exactement comme en production — mais rien n'est écrit
 * dans la base ni sur le tableau.
 *
 * On vérifie, moteur par moteur :
 *   1. la carte est bien proposée (l'outil est appelé) ;
 *   2. la description finalement acceptée passe la règle ;
 *   3. le refus, quand il y en a un, est suivi d'une nouvelle tentative.
 *
 *   node scripts/verif-description-carte.mjs [claude|codex]
 *
 * Consomme un petit tour de quota par moteur. N'écrit rien hors de /tmp.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { rolePrompt } = await import(path.join(RACINE, 'server/dist/runtime.js'));
const { adapterFor } = await import(path.join(RACINE, 'server/dist/engines/index.js'));
const { orchestratorAllowList, orchestratorDenyList } = await import(path.join(RACINE, 'server/dist/tools.js'));
const { wrapPrompt, jugerDescription } = await import(path.join(RACINE, 'shared/dist/index.js'));

const MOTEURS = process.argv[2] ? [process.argv[2]] : ['claude', 'codex'];

/** La demande test : une demande de programmation, la même pour les deux. */
const DEMANDE =
  "Sur téléphone, la colonne « À déployer » du tableau se remet à clignoter chaque fois qu'une carte y entre. " +
  'Il faudrait corriger ça.';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ */
/* Le pont d'outils d'essai : la vraie règle, aucune écriture           */
/* ------------------------------------------------------------------ */

function ecrirePont(dossier) {
  const pont = path.join(dossier, 'pont-essai.mjs');
  const journal = path.join(dossier, 'appels.jsonl');
  fs.writeFileSync(
    pont,
    `import fs from 'node:fs';
import readline from 'node:readline';
import { jugerDescription, composerDescription, niveauDemande } from ${JSON.stringify(path.join(RACINE, 'shared/dist/index.js'))};

const JOURNAL = ${JSON.stringify(journal)};
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const envoyer = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
const OUTILS = [
  { name: 'board_create_card', description: 'Propose une carte', inputSchema: { type: 'object', required: ['title', 'niveau'], properties: {
      title: { type: 'string' }, description: { type: 'string' },
      niveau: { type: 'string', enum: ['leger', 'standard', 'approfondi'] },
      constat: { type: 'string' }, attendu: { type: 'string' }, limites: { type: 'string' }, verification: { type: 'string' },
  } } },
  { name: 'project_memory', description: 'Le texte entier des faits du projet', inputSchema: { type: 'object', properties: { sujet: { type: 'string' } } } },
];

rl.on('line', (ligne) => {
  let m; try { m = JSON.parse(ligne); } catch { return; }
  if (m.method === 'initialize') {
    envoyer({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'haikodev', version: '1.0.0' } } });
  } else if (m.method === 'tools/list') {
    envoyer({ jsonrpc: '2.0', id: m.id, result: { tools: OUTILS } });
  } else if (m.method === 'tools/call') {
    const args = m.params?.arguments ?? {};
    let texte = 'Rien à dire.';
    if (m.params?.name === 'board_create_card') {
      const composee = composerDescription({
        constat: args.constat ?? '', attendu: args.attendu ?? '',
        limites: args.limites ?? '', verification: args.verification ?? '',
      });
      const description = composee || String(args.description ?? '');
      // Le chef d'orchestre est jugé sur une carte COURTE : il ne lit plus le projet.
      const verdict = jugerDescription(description, 'courte');
      const niveau = niveauDemande(args.niveau);
      fs.appendFileSync(JOURNAL, JSON.stringify({ description, niveau, ok: verdict.ok, manques: verdict.manques }) + '\\n');
      texte = verdict.ok
        ? \`Carte « \${args.title} » proposée dans la conversation.\`
        : verdict.message;
    }
    envoyer({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: texte }], isError: false } });
  } else if (m.id !== undefined) {
    envoyer({ jsonrpc: '2.0', id: m.id, result: {} });
  }
});
`,
    'utf8',
  );
  return { pont, journal };
}

/* ------------------------------------------------------------------ */
/* Un vrai tour de chef d'orchestre                                     */
/* ------------------------------------------------------------------ */

async function tourDeChef(moteur) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `verif-description-${moteur}-`));
  const { pont, journal } = ecrirePont(dossier);
  fs.writeFileSync(journal, '', 'utf8');
  // Un projet d'essai minuscule : le chef doit pouvoir y trouver un repère.
  fs.writeFileSync(
    path.join(dossier, 'CLAUDE.md'),
    '# Projet d’essai\n\nLe tableau vit dans `web/src/components/board.tsx`.\n',
    'utf8',
  );

  const adaptateur = adapterFor(moteur);
  const reponse = [];
  const config = path.join(dossier, 'mcp.json');
  fs.writeFileSync(
    config,
    JSON.stringify({ mcpServers: { haikodev: { command: process.execPath, args: [pont] } } }),
    'utf8',
  );

  console.log(`  …  tour de ${moteur} en cours (quelques minutes)`);
  const handle = adaptateur.run({
    cwd: dossier,
    prompt: wrapPrompt('in_run', DEMANDE, `Projet : Essai (dossier ${dossier}).`),
    systemPrompt: rolePrompt('orchestrator', false, moteur, 'tri'),
    mcpConfigPath: config,
    mcpBridgePath: pont,
    fullAccess: false,
    // Exactement le bridage du chef d'orchestre en production : sans ces
    // listes, Claude Code demande une approbation que personne ne donne et
    // l'outil n'est jamais appelé.
    allowedTools: orchestratorAllowList(),
    disallowedTools: orchestratorDenyList(),
    env: { HAIKODEV_TOKEN: 'essai', HAIKODEV_URL: 'http://127.0.0.1:7070', HAIKODEV_AGENT: 'essai' },
    onEvent: (evenement) => {
      if (process.env.VERBEUX) console.log('   ·', JSON.stringify(evenement).slice(0, 300));
      if (evenement.kind === 'text' && evenement.text) reponse.push(evenement.text);
    },
  });

  const minuteur = setTimeout(() => handle.stop(), 300000);
  await handle.finished;
  clearTimeout(minuteur);

  const appels = fs
    .readFileSync(journal, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  if (!appels.length) console.log(`  …  réponse du moteur : ${reponse.join(' ').slice(0, 400) || '(vide)'}`);
  fs.rmSync(dossier, { recursive: true, force: true });
  return appels;
}

/* ------------------------------------------------------------------ */

for (const moteur of MOTEURS) {
  console.log(`\n— ${moteur} —`);
  let appels = [];
  try {
    appels = await tourDeChef(moteur);
  } catch (err) {
    noter(`${moteur} : le tour se lance`, false, String(err?.message ?? err));
    continue;
  }

  noter(`${moteur} : la carte est proposée`, appels.length > 0);
  if (!appels.length) continue;

  const dernier = appels[appels.length - 1];
  noter(
    `${moteur} : la description retenue passe la règle`,
    dernier.ok,
    dernier.ok ? `${dernier.description.length} signes` : dernier.manques.join(', '),
  );

  const refuses = appels.filter((a) => !a.ok);
  if (refuses.length) {
    noter(
      `${moteur} : un refus est suivi d'une nouvelle tentative`,
      dernier.ok,
      `${refuses.length} refus avant d'y arriver`,
    );
  } else {
    console.log('  …  aucune tentative refusée : la description était bonne du premier coup');
  }

  /*
   * Le chef ne fait plus qu'un tri : on ne lui demande PLUS de repère tiré du
   * projet (il ne l'ouvre pas), mais le NIVEAU de l'agent qui exécutera — son
   * second et dernier geste.
   */
  noter(
    `${moteur} : la carte annonce le niveau de l'agent qui exécutera`,
    !!dernier.niveau,
    dernier.niveau ? `niveau « ${dernier.niveau} »` : 'aucun niveau reconnaissable',
  );
  noter(
    `${moteur} : la carte reste COURTE (pas de constat inventé)`,
    dernier.description.length <= 1200,
    `${dernier.description.length} signes`,
  );
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
