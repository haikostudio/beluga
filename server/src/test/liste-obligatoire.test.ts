import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  COMMANDES_TOLEREES_SANS_LISTE,
  ETAT_INITIAL_DE_LA_LISTE,
  REFUS_AVANT_DE_LACHER,
  REFUS_SANS_LISTE,
  hooksDuVerrouDeListe,
  jugerLaListeObligatoire,
  listeObligatoirePourLeTour,
  type EtatDeLaListeObligatoire,
} from '@beluga/shared';
import { buildClaudeArgs } from '../engines/claude.js';
import { EngineRunOptions } from '../engines/types.js';
import { rolePrompt, rappelDeMethode } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* LA LISTE DE TÂCHES EST OBLIGATOIRE, TENUE PAR REFUS D'OUTIL          */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');
const SCRIPT_DU_VERROU = path.resolve(ICI, '../../verrou-liste.mjs');

/** Rejoue une suite d'appels et rend les gestes, dans l'ordre. */
function rejouer(outils: string[], depart: EtatDeLaListeObligatoire = ETAT_INITIAL_DE_LA_LISTE) {
  let etat = depart;
  const gestes: string[] = [];
  for (const outil of outils) {
    const decision = jugerLaListeObligatoire(etat, { outil });
    gestes.push(decision.geste);
    etat = decision.etat;
  }
  return { gestes, etat };
}

test('une modification sans liste est refusée tout de suite, avec le geste qui lève le refus', () => {
  const decision = jugerLaListeObligatoire(ETAT_INITIAL_DE_LA_LISTE, { outil: 'Edit' });
  assert.equal(decision.geste, 'refuser');
  assert.equal(decision.texte, REFUS_SANS_LISTE);
  assert.ok(REFUS_SANS_LISTE.includes('TaskCreate'));
  assert.ok(REFUS_SANS_LISTE.includes('select:TaskCreate,TaskUpdate'), 'le refus dit comment charger l’outil différé');
  for (const outil of ['Write', 'MultiEdit', 'NotebookEdit']) {
    assert.equal(jugerLaListeObligatoire(ETAT_INITIAL_DE_LA_LISTE, { outil }).geste, 'refuser', outil);
  }
});

test('quelques commandes de lecture passent sans liste, pas au-delà', () => {
  const { gestes } = rejouer(Array(COMMANDES_TOLEREES_SANS_LISTE + 1).fill('Bash'));
  assert.deepEqual(gestes, [...Array(COMMANDES_TOLEREES_SANS_LISTE).fill('passer'), 'refuser']);
});

test('lire reste toujours libre, liste ou pas', () => {
  for (const outil of ['Read', 'Grep', 'Glob', 'ToolSearch', 'TaskCreate', 'mcp__beluga__memoire']) {
    assert.equal(jugerLaListeObligatoire(ETAT_INITIAL_DE_LA_LISTE, { outil }).geste, 'passer', outil);
  }
});

test('la liste annoncée, tout passe — même après un refus', () => {
  const { etat } = rejouer(['Edit']);
  assert.equal(etat.refus, 1);
  const { gestes } = rejouer(['Edit', 'Bash', 'Write', 'Bash', 'Bash', 'Bash', 'Bash'], { ...etat, listeAnnoncee: true });
  assert.ok(gestes.every((g) => g === 'passer'));
});

test('un sous-agent n’est jamais retenu : la liste est celle de l’agent principal', () => {
  const decision = jugerLaListeObligatoire(ETAT_INITIAL_DE_LA_LISTE, { outil: 'Edit', sousAgent: true });
  assert.equal(decision.geste, 'passer');
  assert.deepEqual(decision.etat, ETAT_INITIAL_DE_LA_LISTE, 'et il ne consomme rien du tour');
});

test('le filet est borné : un agent qui ne peut pas obéir passe après quelques refus, sans boucle', () => {
  const { gestes, etat } = rejouer(Array(REFUS_AVANT_DE_LACHER + 3).fill('Write'));
  assert.deepEqual(gestes, [
    ...Array(REFUS_AVANT_DE_LACHER).fill('refuser'),
    'lacher',
    'passer',
    'passer',
  ]);
  assert.equal(etat.lache, true);
});

test('l’agent de tâche ordinaire et l’assistant Beluga sont tenus de lister', () => {
  assert.equal(listeObligatoirePourLeTour({ role: 'task' }), true);
  for (const role of ['cadrage', 'analysis', 'deploy', 'chef']) {
    assert.equal(listeObligatoirePourLeTour({ role }), false, role);
  }
  // Un motif porte sa propre consigne : dépannage (prié de NE PAS lister), Studio, Marketing…
  for (const motif of ['depannage', 'conflit', 'studio', 'configuration-marketing', 'depannage-manuel']) {
    assert.equal(listeObligatoirePourLeTour({ role: 'task', motif }), false, motif);
  }
  // L'assistant Beluga est un agent ordinaire en accès complet (18/10/2026) : il liste aussi.
  assert.equal(listeObligatoirePourLeTour({ role: 'deploy', assistantGlobal: true }), true);
});

test('le crochet se pose devant les commandes et les modifications, à côté du garde du démon', () => {
  const crochet = hooksDuVerrouDeListe('/opt/beluga/server/verrou-liste.mjs').PreToolUse as any[];
  assert.deepEqual(crochet[0].matcher.split('|'), ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  const options = {
    cwd: '/tmp/tache',
    prompt: 'bonjour',
    fullAccess: true,
    gardeDuDemonPath: '/opt/beluga/server/garde-demon.mjs',
    verrouListePath: '/opt/beluga/server/verrou-liste.mjs',
    onEvent: () => {},
  } as EngineRunOptions;
  const args = buildClaudeArgs(options);
  const reglages = JSON.parse(args[args.indexOf('--settings') + 1]);
  const poses = (reglages.hooks.PreToolUse as any[]).map((h) => `${h.matcher} → ${h.hooks[0].command}`);
  assert.ok(poses.includes('Bash → node /opt/beluga/server/garde-demon.mjs'), 'le garde du démon reste posé');
  assert.ok(poses.includes('Bash|Edit|Write|MultiEdit|NotebookEdit → node /opt/beluga/server/verrou-liste.mjs'));
  const sans = buildClaudeArgs({ ...options, verrouListePath: undefined });
  assert.ok(!sans.join(' ').includes('verrou-liste'), 'un tour non tenu ne lance aucun processus en plus');
});

function lancerLeVerrou(url: string, entree: Record<string, unknown>): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [SCRIPT_DU_VERROU], {
      env: { ...process.env, BELUGA_URL: url, BELUGA_TOKEN: 'jeton-essai', BELUGA_AGENT: 'a1', BELUGA_TOUR: 't1' },
    });
    let stderr = '';
    enfant.stderr.on('data', (bout) => (stderr += bout));
    enfant.on('close', (code) => resolve({ code, stderr }));
    enfant.stdin.end(JSON.stringify(entree));
  });
}

test('le script refuse sur la parole du démon, laisse passer sinon — et laisse passer un démon muet', async () => {
  let refuse = true;
  const corps: any[] = [];
  const serveur = http.createServer((req, res) => {
    let brut = '';
    req.on('data', (b) => (brut += b));
    req.on('end', () => {
      corps.push({ url: req.url, tour: req.headers['x-beluga-tour'], ...JSON.parse(brut) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ refuse, texte: refuse ? REFUS_SANS_LISTE : '' }));
    });
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', () => resolve()));
  const { port } = serveur.address() as { port: number };
  const url = `http://127.0.0.1:${port}`;
  try {
    const avant = await lancerLeVerrou(url, { tool_name: 'Edit', tool_input: {} });
    assert.equal(avant.code, 2, 'sans liste, l’action est refusée');
    assert.ok(avant.stderr.includes('TaskCreate'));

    refuse = false;
    const apres = await lancerLeVerrou(url, { tool_name: 'Bash', tool_input: {}, agent_id: 'sous-agent-1' });
    assert.equal(apres.code, 0);
    assert.equal(apres.stderr, '');
    assert.deepEqual(corps, [
      { url: '/internal/liste', tour: 't1', outil: 'Edit', sousAgent: false },
      { url: '/internal/liste', tour: 't1', outil: 'Bash', sousAgent: true },
    ]);
  } finally {
    await new Promise<void>((resolve) => serveur.close(() => resolve()));
  }
  const muet = await lancerLeVerrou(url, { tool_name: 'Edit' });
  assert.equal(muet.code, 0, 'un démon qui ne répond pas ne mure jamais l’agent');
});

test('le démon pose le verrou sur les tours tenus, compte la liste et répond à l’appel', () => {
  const runtime = fs.readFileSync(path.join(SOURCES, 'runtime.ts'), 'utf8');
  assert.ok(runtime.includes('verrouListePath: runState.listeObligatoire ? verrouListePath : undefined'));
  assert.ok(runtime.includes('if (runState.listeObligatoire) runState.listeObligatoire.listeAnnoncee = true;'));
  assert.ok(
    runtime.includes('listeAnnoncee: todosRepris.length > 0'),
    'une liste reprise d’un tour coupé compte comme annoncée',
  );
  const serveur = fs.readFileSync(path.join(SOURCES, 'http.ts'), 'utf8');
  const debut = serveur.indexOf("route === '/internal/liste'");
  assert.ok(debut > 0, 'le démon sert le verrou');
  assert.ok(serveur.slice(debut, debut + 800).includes('jugerLAppelSousListe'));
});

test('la consigne dit la liste obligatoire à CHAQUE tour qui agit, et son refus', () => {
  const claude = rolePrompt('task', false, 'claude');
  assert.match(claude, /obligatoire à CHAQUE tour où tu agis/);
  assert.match(claude, /select:TaskCreate,TaskUpdate/);
  assert.match(claude, /Sans liste, Beluga Build refuse ta modification ou ta commande/);
  assert.match(rappelDeMethode('claude'), /à CHAQUE tour où tu agis/);
  assert.match(rappelDeMethode('codex'), /update_plan/);
  assert.doesNotMatch(rappelDeMethode('codex'), /TaskCreate/);
});
