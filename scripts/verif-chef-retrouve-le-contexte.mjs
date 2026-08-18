#!/usr/bin/env node
/**
 * LE CHEF RETROUVE-T-IL LE SUJET, ET PROPOSE-T-IL LES DEUX CHEMINS ?
 *
 * Deux défauts constatés sur le chef d'orchestre :
 *   1. son fil côté moteur meurt souvent (session expirée, modèle changé) alors
 *      que la conversation, elle, reste à l'écran. Le tour suivant repartait
 *      avec le seul message écrit — « fais-en une carte » ne désignait plus
 *      rien, et le chef redemandait de quoi on parlait ;
 *   2. devant une demande ambiguë, il tranchait seul au lieu de poser les deux
 *      chemins possibles (le faire tout de suite, ou en faire une carte).
 *
 * Le script rejoue DEUX VRAIS TOURS de chef d'orchestre, avec le briefing réel
 * du démon et un PONT D'ESSAI qui applique la vraie règle de description
 * (`shared/dist/description-carte.js`). Rien n'est écrit dans la base ni sur le
 * tableau, et aucune carte n'est créée.
 *
 *   node scripts/verif-chef-retrouve-le-contexte.mjs [claude|codex]
 *
 * Consomme deux petits tours de quota par moteur. N'écrit rien hors de /tmp.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { rolePrompt } = await import(path.join(RACINE, 'server/dist/runtime.js'));
const { adapterFor } = await import(path.join(RACINE, 'server/dist/engines/index.js'));
const { orchestratorAllowList, orchestratorDenyList } = await import(path.join(RACINE, 'server/dist/tools.js'));
const { wrapPrompt, resumeContinuite, renvoieAuFil } = await import(path.join(RACINE, 'shared/dist/index.js'));

const MOTEURS = process.argv[2] ? [process.argv[2]] : ['claude'];

/*
 * LE SUJET DISCUTÉ. Il n'apparaît QUE dans le rappel du fil : le message du
 * tour, lui, ne le nomme pas. Une carte qui parle du minuteur de veille prouve
 * donc que le chef est allé le chercher dans la conversation.
 */
const RAPPEL_DU_FIL = resumeContinuite({
  project: 'Essai',
  workdir: '/tmp/essai',
  role: 'orchestrator',
  title: "Chef d'orchestre — Essai",
  motif: 'fil-neuf',
  exchanges: [
    {
      role: 'user',
      content:
        "Sur l'écran des réglages, le minuteur de veille se remet à zéro dès qu'on change d'onglet : on perd le compte à rebours en cours.",
    },
    {
      role: 'assistant',
      content:
        "Le compte à rebours du minuteur de veille vit dans le composant de l'onglet : il repart de zéro à chaque montage, au lieu d'être gardé au-dessus.",
    },
  ],
});

/** Le message du tour : il renvoie au fil sans nommer le sujet. */
const DEMANDE_RENVOI = "Parfait, fais-en une carte.";

/** Une demande ambiguë : la faire tout de suite, ou en faire une carte ? */
const DEMANDE_AMBIGUE =
  "Il faudrait garder quelque part la procédure de mise en ligne de ce projet, pour ne plus la redemander à chaque fois.";

/** Ce que la carte doit nommer pour prouver que le fil a été remonté. */
const MOTS_DU_SUJET = ['minuteur', 'veille', 'compte à rebours', 'onglet'];

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
const tracer = (outil, charge) => fs.appendFileSync(JOURNAL, JSON.stringify({ outil, ...charge }) + '\\n');

const OUTILS = [
  { name: 'board_create_card', description: 'Propose une carte', inputSchema: { type: 'object', required: ['title', 'niveau'], properties: {
      title: { type: 'string' }, description: { type: 'string' },
      niveau: { type: 'string', enum: ['leger', 'standard', 'approfondi'] },
      constat: { type: 'string' }, attendu: { type: 'string' }, limites: { type: 'string' }, verification: { type: 'string' },
  } } },
  { name: 'propose_task', description: 'Propose une tâche dans un cas ambigu', inputSchema: { type: 'object', required: ['title', 'niveau'], properties: {
      title: { type: 'string' }, description: { type: 'string' },
      niveau: { type: 'string', enum: ['leger', 'standard', 'approfondi'] },
  } } },
  { name: 'ask_user', description: "Pose une question à l'utilisateur et ATTEND sa réponse.", inputSchema: { type: 'object', required: ['question'], properties: {
      question: { type: 'string' },
      kind: { type: 'string', enum: ['single', 'multiple', 'text'] },
      options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } } } },
  } } },
  { name: 'write_document', description: 'Crée ou remplace un document', inputSchema: { type: 'object', required: ['relativePath'], properties: {
      relativePath: { type: 'string' }, content: { type: 'string' }, action: { type: 'string' },
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
    const nom = m.params?.name;
    const args = m.params?.arguments ?? {};
    let texte = 'Rien à dire.';
    if (nom === 'board_create_card' || nom === 'propose_task') {
      const composee = composerDescription({
        constat: args.constat ?? '', attendu: args.attendu ?? '',
        limites: args.limites ?? '', verification: args.verification ?? '',
      });
      const description = composee || String(args.description ?? '');
      const verdict = jugerDescription(description, 'courte');
      tracer(nom, { titre: String(args.title ?? ''), description, niveau: niveauDemande(args.niveau), ok: verdict.ok, manques: verdict.manques });
      texte = verdict.ok ? \`Carte « \${args.title} » proposée dans la conversation.\` : verdict.message;
    } else if (nom === 'ask_user') {
      const options = Array.isArray(args.options) ? args.options : [];
      tracer('ask_user', { question: String(args.question ?? ''), options: options.map((o) => String(o?.label ?? '')) });
      // On répond « la carte » : le tour doit alors se poursuivre sans redemander.
      texte = 'Réponse de l’utilisateur : « J’en fais une carte ».';
    } else if (nom === 'write_document') {
      tracer('write_document', { chemin: String(args.relativePath ?? '') });
      texte = 'Document enregistré.';
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

async function tourDeChef(moteur, demande, contexte, etiquette) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `verif-contexte-${moteur}-`));
  const { pont, journal } = ecrirePont(dossier);
  fs.writeFileSync(journal, '', 'utf8');
  fs.writeFileSync(
    path.join(dossier, 'CLAUDE.md'),
    '# Projet d’essai\n\nLes réglages vivent dans `web/src/components/settings.tsx`.\n',
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

  console.log(`  …  ${etiquette} : tour de ${moteur} en cours (quelques minutes)`);
  const contexteEntier = [`Projet : Essai (dossier ${dossier}).`, contexte].filter(Boolean).join('\n\n');
  const handle = adaptateur.run({
    cwd: dossier,
    prompt: wrapPrompt('free', demande, contexteEntier),
    systemPrompt: rolePrompt('orchestrator', false, moteur, 'tri'),
    mcpConfigPath: config,
    mcpBridgePath: pont,
    fullAccess: false,
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
  fs.rmSync(dossier, { recursive: true, force: true });
  return { appels, texte: reponse.join(' ') };
}

/* ------------------------------------------------------------------ */

for (const moteur of MOTEURS) {
  console.log(`\n— ${moteur} : le sujet se retrouve dans le fil —`);
  try {
    const { appels, texte } = await tourDeChef(moteur, DEMANDE_RENVOI, RAPPEL_DU_FIL, 'sujet retrouvé');
    const cartes = appels.filter((a) => a.outil === 'board_create_card' || a.outil === 'propose_task');
    noter(`${moteur} : une carte est proposée sur « fais-en une carte »`, cartes.length > 0,
      cartes.length ? '' : `réponse : ${texte.slice(0, 200) || '(vide)'}`);
    if (cartes.length) {
      const derniere = cartes[cartes.length - 1];
      const entier = `${derniere.titre}\n${derniere.description}`.toLowerCase();
      const trouves = MOTS_DU_SUJET.filter((mot) => entier.includes(mot));
      noter(`${moteur} : la carte NOMME le sujet discuté`, trouves.length > 0,
        trouves.length ? `mots retrouvés : ${trouves.join(', ')}` : `titre : « ${derniere.titre} »`);
      noter(`${moteur} : la carte ne renvoie pas au fil`, !renvoieAuFil(derniere.description));
      noter(`${moteur} : la description passe la règle`, derniere.ok,
        derniere.ok ? `${derniere.description.length} signes` : derniere.manques.join(', '));
    }
    const questions = appels.filter((a) => a.outil === 'ask_user');
    noter(`${moteur} : le sujet étant retrouvable, aucune question n'est posée`, questions.length === 0,
      questions.length ? questions[0].question.slice(0, 120) : '');
  } catch (err) {
    noter(`${moteur} : le tour « sujet retrouvé » se lance`, false, String(err?.message ?? err));
  }

  console.log(`\n— ${moteur} : une demande ambiguë propose les deux chemins —`);
  try {
    const { appels, texte } = await tourDeChef(moteur, DEMANDE_AMBIGUE, '', 'deux chemins');
    const questions = appels.filter((a) => a.outil === 'ask_user');
    noter(`${moteur} : la question est posée avec l'outil, pas en texte`, questions.length > 0,
      questions.length ? '' : `réponse : ${texte.slice(0, 200) || '(vide)'}`);
    if (questions.length) {
      const q = questions[0];
      noter(`${moteur} : deux options au moins sont proposées`, (q.options?.length ?? 0) >= 2,
        `options : ${(q.options ?? []).join(' | ') || 'aucune'}`);
      const tout = `${q.question} ${(q.options ?? []).join(' ')}`.toLowerCase();
      noter(`${moteur} : le chemin « carte » est nommé`, /carte|tâche|tache/.test(tout));
      noter(
        `${moteur} : le chemin « je le fais maintenant » est nommé`,
        /maintenant|tout de suite|directement|conversation|document|moi-même|moi-meme/.test(tout),
      );
    }
  } catch (err) {
    noter(`${moteur} : le tour « deux chemins » se lance`, false, String(err?.message ?? err));
  }
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
