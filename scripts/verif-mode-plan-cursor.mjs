#!/usr/bin/env node
/**
 * CURSOR EN MODE PLAN : LE PLAN ARRIVE-T-IL DANS LA CONVERSATION ?
 *
 * Le mode plan de HaikoDev attend un TEXTE : le démon y cherche les quatre
 * parties (`jugerLePlan`), pose le cadre « Plan proposé » et ses boutons
 * « Valider » / « Refuser ». Claude et Codex écrivent leur plan dans le fil.
 * Cursor, lui, ne le fait PAS : lancé avec `--mode plan`, il ne laisse dans la
 * conversation qu'une narration (« Je commence par lire tel fichier ») et pose
 * le plan entier dans un appel d'outil `createPlanToolCall` — constaté sur un
 * vrai tour le 14/08/2026. Sans traduction, le plan devenait une étape opaque
 * nommée « createPlan », le message perdait son cadre et ses boutons, et la
 * relance du chef partait pour rien.
 *
 * Ce contrôle rejoue exactement ce cas, sur un VRAI tour Cursor :
 *
 *   1. le mode plan est bien demandé au moteur (`--mode plan` dans la ligne de
 *      commande), et l'accès complet ne le contredit pas ;
 *   2. un tour réel en mode plan rend un PLAN dans le fil, pas une étape ;
 *   3. ce plan, quand la demande le réclame, porte ses QUATRE PARTIES : il est
 *      donc décidable (`jugerLePlan`) ;
 *   4. le dépôt n'a PAS bougé : le mode plan prépare, il n'écrit pas ;
 *   5. le tour se referme proprement, sans rester suspendu.
 *
 *   CURSOR_API_KEY=… node scripts/verif-mode-plan-cursor.mjs
 *
 * Dossier temporaire, dépôt d'essai, aucun démon : le script juge le dépôt d'où
 * il PART, jamais le dossier principal, et ne reprend ni `HAIKODEV_URL` (qui
 * désigne l'application publiée) ni `HAIKODEV_TOKEN`. Un seul vrai tour Cursor :
 * il coûte quelques centimes, rien d'autre.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-plan-cursor-'));
const CLE = (process.env.CURSOR_API_KEY ?? '').trim();

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`  …  dépôt jugé : ${RACINE}`);
if (!CLE) {
  console.error('Aucune clé : poser CURSOR_API_KEY avant de lancer ce contrôle.');
  process.exit(1);
}

process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */
/* 1. La ligne de commande : le mode plan est-il seulement demandé ?   */
/* ------------------------------------------------------------------ */

const { buildCursorArgs } = await import(path.join(RACINE, 'server', 'dist', 'engines', 'cursor.js'));
const { jugerLePlan } = await import(path.join(RACINE, 'shared', 'dist', 'index.js'));

{
  const plan = buildCursorArgs({ cwd: '/tmp', prompt: '', mode: 'plan', role: 'task', fullAccess: true }, 'composer-2.5');
  const direct = buildCursorArgs({ cwd: '/tmp', prompt: '', mode: 'direct', role: 'task', fullAccess: true }, 'composer-2.5');
  const chef = buildCursorArgs({ cwd: '/tmp', prompt: '', mode: 'plan', role: 'orchestrator', fullAccess: true }, 'composer-2.5');

  noter('un agent de tâche en mode plan reçoit « --mode plan »', plan.join(' ').includes('--mode plan'));
  // `--mode plan` suffit à fermer l'écriture ; `--force` reste, sinon les
  // outils du projet sont refusés faute d'approbation et la question du plan
  // ne part jamais (voir `scripts/verif-outils-cursor.mjs`).
  noter("le mode plan ferme l'écriture sans ouvrir le bac à sable", !plan.includes('--sandbox') && plan.includes('--force'));
  noter('hors mode plan, rien ne ferme l’écriture', !direct.join(' ').includes('--mode plan') && direct.includes('--force'));
  // Le chef est déjà tenu par son bac à sable : lui fermer l'écriture le
  // priverait de son plan écrit et de ses questions (`modePlanFermeLEcriture`).
  noter("le chef d'orchestre garde ses outils en mode plan", !chef.join(' ').includes('--mode plan'));
}

/* ------------------------------------------------------------------ */
/* 2. Un VRAI tour en mode plan, dans un dépôt d'essai                 */
/* ------------------------------------------------------------------ */

const ATELIER = path.join(TMP, 'atelier');
fs.mkdirSync(ATELIER, { recursive: true });
const g = (...args) => execFileSync('git', args, { cwd: ATELIER, encoding: 'utf8' });
g('init', '-q', '-b', 'main');
g('config', 'user.email', 'essai@haikodev.local');
g('config', 'user.name', 'Essai');
fs.writeFileSync(path.join(ATELIER, 'salut.js'), 'export function saluer() {\n  return "bonjour";\n}\n');
g('add', 'salut.js');
g('commit', '-q', '-m', 'Base');
const empreinteAvant = g('rev-parse', 'HEAD').trim();

const { cursorAdapter } = await import(path.join(RACINE, 'server', 'dist', 'engines', 'cursor.js'));

const vus = [];
const handle = cursorAdapter.run({
  cwd: ATELIER,
  prompt:
    "Prépare un plan pour ajouter au fichier salut.js une fonction « auRevoir » qui rend la chaîne « au revoir ». " +
    'Rends ton plan en QUATRE PARTIES, chacune sous son propre titre Markdown, dans cet ordre exact : ' +
    '« ## Faisabilité », « ## Chemin à suivre », « ## Conséquences », « ## Améliorations apportées ». ' +
    "N'écris et ne modifie aucun fichier.",
  model: 'composer-2.5',
  mode: 'plan',
  role: 'task',
  fullAccess: true,
  plafondMs: 420_000,
  env: { CURSOR_API_KEY: CLE },
  onEvent: (e) => vus.push(e),
});

const issue = await handle.finished;

const textes = vus.filter((e) => e.kind === 'text').map((e) => e.text);
const etapes = vus.filter((e) => e.kind === 'step').map((e) => e.step?.label ?? '');
// Le plan est le plus long des textes rendus : la narration du moteur tient en
// une phrase, le plan en plusieurs sections.
const plan = textes.slice().sort((a, b) => b.length - a.length)[0] ?? '';

noter('le tour en mode plan se referme proprement', issue.ok, issue.error ? issue.error.slice(0, 160) : '');
noter(
  'le plan revient dans la conversation, pas dans le journal des étapes',
  plan.length > 200,
  `${textes.length} texte(s), le plus long : ${plan.length} signes`,
);
noter(
  'aucune étape opaque nommée « createPlan » ne remplace le plan',
  !etapes.some((label) => /createplan/i.test(label)),
  etapes.length ? `étapes : ${[...new Set(etapes)].slice(0, 6).join(', ')}` : 'aucune étape',
);

const jugement = jugerLePlan(plan);
noter(
  'le plan rendu porte ses quatre parties, donc il est décidable',
  jugement.complet,
  jugement.complet ? '' : `manque : ${(jugement.manquantes ?? []).join(', ') || 'inconnu'}`,
);

/* ------------------------------------------------------------------ */
/* 3. Le mode plan prépare : il n'écrit pas                            */
/* ------------------------------------------------------------------ */

const propre = g('status', '--porcelain').trim();
noter('le mode plan n’a modifié aucun fichier du dépôt', propre === '', propre.slice(0, 160));
noter('le dépôt est resté sur le même enregistrement', g('rev-parse', 'HEAD').trim() === empreinteAvant);
noter(
  'la fonction « auRevoir » n’a pas été écrite',
  !fs.readFileSync(path.join(ATELIER, 'salut.js'), 'utf8').includes('auRevoir'),
);

/* ------------------------------------------------------------------ */

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
process.exit(rates.length ? 1 : 0);
