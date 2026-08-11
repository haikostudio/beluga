import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClaudeArgs } from '../engines/claude.js';
import { buildCodexArgs } from '../engines/codex.js';
import {
  consigneDePlanEntier,
  consigneDeRepriseDuPlan,
  dernierPlanRedige,
  etatDuPlan,
  indexDuPlanCourant,
  jugerLePlan,
  planEnAttente,
} from '@haikodev/shared';

/*
 * `../runtime.js` importe `../config.js` en cascade (via `../store.js`) : un
 * `import` statique de haut de fichier se résout AVANT toute autre ligne du
 * module, HAIKODEV_DATA compris — la base réelle du démon serait figée dans
 * `PATHS.db` avant même d'être redirigée. D'où l'import dynamique, comme pour
 * `store.js` et `tools.js` juste en dessous.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-plan-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { rolePrompt, TRI_MODE_PLAN } = await import('../runtime.js');

/*
 * Une proposition n'est affichée que si sa description tient debout (règle
 * « description-carte ») : sans rôle « orchestrator » sur le contexte de
 * test, l'exigence est la plus complète — on la fournit donc en entier.
 */
const DESCRIPTION = [
  "Constat : le tableau se fabrique dans `web/src/components/board.tsx` et n’offre aucun bouton d’export des cartes.",
  'Attendu : un bouton d’export rend le contenu de la colonne dans un fichier téléchargeable.',
  "Limites : on ne touche ni au glisser-déposer, ni aux règles de passage d'une colonne à l'autre.",
  'Vérification : rejouer `npm test`, puis cliquer le bouton et ouvrir le fichier obtenu.',
].join('\n');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

/* ------------------------------------------------------------------ */
/* Le mode plan (RunConfig.mode) : l'agent prépare SANS écrire, quel    */
/* que soit son accès habituel — priorité sur `fullAccess`.             */
/* ------------------------------------------------------------------ */

test('Claude : le mode plan force --permission-mode plan même en accès complet', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'prépare la refonte',
    fullAccess: true,
    mode: 'plan',
    role: 'task',
    onEvent: () => {},
  });
  const i = args.indexOf('--permission-mode');
  assert.equal(args[i + 1], 'plan');
});

/*
 * LE CHEF, LUI, GARDE SES OUTILS EN MODE PLAN. Sa frontière est le bac à sable
 * (projet en lecture seule) et ses listes d'outils, pas le mode : le mode plan
 * lui retirait « write_document » et « ask_user », donc son plan écrit et ses
 * questions (`modePlanFermeLEcriture`, `shared/src/droits-mode-plan.ts`).
 */
test('Claude : le chef d’orchestre garde ses outils d’écriture en mode plan', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp/chef',
    prompt: 'prépare la refonte',
    fullAccess: false,
    mode: 'plan',
    role: 'orchestrator',
    onEvent: () => {},
  });
  const i = args.indexOf('--permission-mode');
  assert.notEqual(args[i + 1], 'plan', 'le mode plan ne doit plus fermer les outils du chef');
  assert.equal(args[i + 1], 'manual');
});

test('Codex : le chef d’orchestre n’est pas mis en lecture seule par le mode plan', () => {
  const args = buildCodexArgs({
    cwd: '/root/chef',
    prompt: 'prépare la refonte',
    fullAccess: false,
    mode: 'plan',
    role: 'orchestrator',
    allowedTools: ['mcp__haikodev__write_document'],
    disallowedTools: ['Edit'],
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  // Bridé : c'est l'accès complet qui s'applique, jamais `read-only`. Le mode
  // plan ne referme rien au chef — sa frontière est la liste d'outils.
  assert.ok(!args.includes('sandbox_mode="read-only"'));
  assert.ok(args.includes('sandbox_mode="danger-full-access"'));
});

test('Claude : sans mode plan, l’accès complet garde bypassPermissions', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'ajoute un bouton',
    fullAccess: true,
    mode: 'direct',
    onEvent: () => {},
  });
  const i = args.indexOf('--permission-mode');
  assert.equal(args[i + 1], 'bypassPermissions');
});

test('Codex : le mode plan garde le bac à sable en lecture seule même en accès complet', () => {
  const args = buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'prépare la refonte',
    fullAccess: true,
    mode: 'plan',
    role: 'task',
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'), 'aucun contournement du bac à sable en mode plan');
  const i = args.indexOf('-s');
  assert.equal(args[i + 1], 'read-only');
});

test('Codex : en reprise et mode plan, la surcharge de configuration reste en lecture seule', () => {
  const args = buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'prépare la refonte',
    sessionId: 'fil-123',
    fullAccess: true,
    mode: 'plan',
    role: 'task',
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  assert.ok(args.includes('sandbox_mode="read-only"'));
});

test('Codex : sans mode plan, l’accès complet contourne bien le bac à sable', () => {
  const args = buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'ajoute un bouton',
    fullAccess: true,
    mode: 'direct',
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

/* ------------------------------------------------------------------ */
/* Le mode plan ne doit RENDRE AUCUNE carte : refusé au niveau de       */
/* l'outil, pas seulement dit dans la consigne (PLAN §2 principe 3).    */
/* ------------------------------------------------------------------ */

test('board_create_card est refusé en mode plan, aucune carte n’apparaît', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'plan' } as any, 'board_create_card', {
    title: 'Ajouter un bouton',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined, 'aucune proposition, donc aucune carte affichée');
  assert.match(resultat.text, /mode plan/i);
});

test('propose_task est refusé en mode plan', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'plan' } as any, 'propose_task', {
    title: 'Corriger un défaut',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined);
});

test('sans mode (ou en mode direct), board_create_card fonctionne comme avant', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'direct' } as any, 'board_create_card', {
    title: 'Ajouter un bouton',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, true);
  assert.ok(resultat.proposal);
});

/* ------------------------------------------------------------------ */
/* La consigne du chef change en mode plan : elle demande un plan       */
/* écrit dans la conversation, pas une carte.                           */
/* ------------------------------------------------------------------ */

test('la consigne du chef en mode plan porte les quatre parties du plan et interdit la carte', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /FAISABILITÉ/);
  assert.match(consigne, /CHEMIN À SUIVRE/);
  assert.match(consigne, /CONSÉQUENCES/);
  assert.match(consigne, /AMÉLIORATIONS APPORTÉES/);
  assert.match(consigne, /NE PROPOSES AUCUNE carte/);
  assert.match(consigne, /analysis\.context/);
  assert.ok(consigne.includes(TRI_MODE_PLAN));
});

test('la consigne du chef en mode direct ne porte pas le texte du mode plan', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude');
  assert.ok(!consigne.includes(TRI_MODE_PLAN));
});

test('la consigne exige un plan COMPLET à chaque itération, refus compris', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /CHAQUE RÉPONSE EN MODE PLAN EST UN PLAN COMPLET/);
  assert.match(consigne, /LE NOUVEAU LE REPREND ET L'ENRICHIT/);
  assert.match(consigne, /UN REFUS .* N'EST PAS UNE FIN/);
  assert.match(consigne, /nouveau plan complet/);
});

/* ------------------------------------------------------------------ */
/* Les ITÉRATIONS du plan : un seul plan est encore en jeu, le dernier. */
/* Les précédents se replient et ne portent plus aucun bouton.          */
/* ------------------------------------------------------------------ */

const PLAN = (texte: string) => ({ plan: true, content: texte });
const REPONSE = (texte: string) => ({ plan: false, content: texte });

test('le plan courant est le dernier plan écrit, les précédents sont d’anciennes itérations', () => {
  const fil = [REPONSE('bonjour'), PLAN('version 1'), REPONSE('affine-le'), PLAN('version 2')];
  assert.equal(indexDuPlanCourant(fil), 3);
  assert.equal(etatDuPlan(fil, 1), 'ancien');
  assert.equal(etatDuPlan(fil, 3), 'courant');
  assert.equal(etatDuPlan(fil, 0), null, 'un message ordinaire ne porte aucun plan');
});

test('un plan suivi d’un message n’attend plus de décision', () => {
  const fil = [PLAN('version 1'), REPONSE('Vas-y, lance ce plan.')];
  assert.equal(indexDuPlanCourant(fil), -1);
  assert.equal(etatDuPlan(fil, 0), 'ancien');
});

test('le tour qui démarre (message encore vide) ne périme pas le plan affiché', () => {
  const fil = [PLAN('version 1'), { plan: true, content: '' }];
  assert.equal(indexDuPlanCourant(fil), 0);
  assert.equal(etatDuPlan(fil, 0), 'courant');
  assert.equal(etatDuPlan(fil, 1), null, 'un plan sans texte ne s’affiche pas encore');
});

test('une conversation sans plan n’a pas de plan courant', () => {
  assert.equal(indexDuPlanCourant([REPONSE('bonjour'), REPONSE('salut')]), -1);
  assert.equal(indexDuPlanCourant([]), -1);
});

/* ------------------------------------------------------------------ */
/* Le REFUS AUTOMATIQUE : un nouveau message remplace le plan affiché,  */
/* et le chef reçoit ce plan pour le reprendre EN ENTIER.               */
/* ------------------------------------------------------------------ */

test('le plan qui attend une décision est retrouvé, avec son numéro de version', () => {
  const fil = [REPONSE('bonjour'), PLAN('version 1'), REPONSE('affine-le'), PLAN('version 2')];
  const attente = planEnAttente(fil);
  assert.equal(attente?.numero, 2);
  assert.equal(attente?.contenu, 'version 2');
  assert.equal(planEnAttente([PLAN('version 1'), REPONSE('vas-y')]), null, 'un plan déjà dépassé n’attend plus rien');
  assert.equal(planEnAttente([]), null);
});

test('la consigne de reprise nomme la version refusée et recopie son texte', () => {
  const texte = consigneDeRepriseDuPlan({ index: 1, numero: 2, contenu: '## Faisabilité\nTout tient.' });
  assert.match(texte, /VERSION 2, REFUSÉE D'OFFICE/);
  assert.match(texte, /VERSION 3/, 'la version suivante est nommée');
  assert.match(texte, /EN ENTIER/);
  assert.ok(texte.includes('## Faisabilité'), 'le plan précédent voyage avec la consigne');
});

test('un plan très long est recopié tronqué, jamais en entier', () => {
  const texte = consigneDeRepriseDuPlan({ index: 0, numero: 1, contenu: 'x'.repeat(20000) });
  assert.ok(texte.length < 12000, `la consigne doit rester sous plafond (${texte.length} signes)`);
  assert.match(texte, /\[…\]/);
});

/* ------------------------------------------------------------------ */
/* Ce que la consigne du mode plan promet désormais : outils ouverts,   */
/* question posée avant le plan, refus automatique dit.                 */
/* ------------------------------------------------------------------ */

test('la consigne du mode plan dit que les outils d’écriture restent ouverts', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /TU AS TOUS TES OUTILS EN MODE PLAN/);
  assert.match(consigne, /write_document/);
});

test('la consigne du mode plan impose la question posée AVANT le plan', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /UNE DÉCISION QUI NE T'APPARTIENT PAS SE DEMANDE AVANT LE PLAN/);
  assert.match(consigne, /ask_user/);
  assert.match(consigne, /jamais « par défaut/i);
});

test('la consigne du mode plan dit le refus automatique du plan précédent', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /TOUT NOUVEAU MESSAGE DE L'UTILISATEUR REFUSE LE PLAN PRÉCÉDENT/);
});

/* ------------------------------------------------------------------ */
/* UNE ITÉRATION REND LE PLAN ENTIER — et le démon le vérifie.          */
/* Le texte rendu doit ANNONCER ses quatre parties : sinon ce n'est pas */
/* un plan, il ne porte pas de bouton, et le chef est relancé une fois. */
/* ------------------------------------------------------------------ */

const PLAN_ENTIER = [
  '## Faisabilité',
  'Oui, tout tient avec le moteur actuel.',
  '',
  '## Chemin à suivre',
  '1. Mesurer le découpage. 2. Pondérer par fraîcheur.',
  '',
  '## Conséquences',
  'La recherche remonte des passages plus courts.',
  '',
  '## Améliorations apportées',
  'Moins de bruit dans le contexte envoyé.',
].join('\n');

/* Le cas RÉEL qui a motivé la carte : trois pistes présentées en « version 3 ». */
const FRAGMENT = [
  'Trois pistes, par ordre de gain réel :',
  '',
  '**Le découpage avant le modèle.** La qualité d’un RAG tient surtout à la taille des passages.',
  '',
  '**Pondérer par fraîcheur.** À pertinence égale, remonter le passage le plus récent.',
  '',
  '**Garder la voie des mots exacts.** Elle existe déjà et rattrape ce que le sens seul rate.',
  '',
  'Dites-moi laquelle intégrer au plan.',
].join('\n');

test('un texte qui annonce les quatre parties est un plan entier', () => {
  assert.deepEqual(jugerLePlan(PLAN_ENTIER), { complet: true, manquantes: [] });
});

test('les quatre parties se reconnaissent aussi en gras et en tête de ligne', () => {
  const autre = [
    '**Faisabilité.** Réalisable en une carte.',
    '',
    'CHEMIN À SUIVRE : trois étapes courtes.',
    '',
    '**Conséquences** — le tiroir change d’aspect.',
    '',
    '- Améliorations apportées : un seul texte à lire.',
  ].join('\n');
  assert.equal(jugerLePlan(autre).complet, true);
});

test('une liste de pistes suivie d’une question n’est PAS un plan', () => {
  const jugement = jugerLePlan(FRAGMENT);
  assert.equal(jugement.complet, false);
  assert.deepEqual(jugement.manquantes, [
    'Faisabilité',
    'Chemin à suivre',
    'Conséquences',
    'Améliorations apportées',
  ]);
});

test('une partie manquante est nommée, les autres ne le sont pas', () => {
  const troisParties = PLAN_ENTIER.split('\n## Conséquences')[0];
  assert.deepEqual(jugerLePlan(troisParties).manquantes, ['Conséquences', 'Améliorations apportées']);
});

test('une notion citée en pleine phrase ne vaut pas une partie du plan', () => {
  const prose = 'Les conséquences seront faibles et les améliorations viendront plus tard.';
  assert.equal(jugerLePlan(prose).complet, false);
});

test('le dernier plan écrit est retrouvé même quand un message le suit', () => {
  const fil = [PLAN('version 1'), REPONSE('affine-le'), PLAN('version 2'), REPONSE('et si on faisait autrement ?')];
  const dernier = dernierPlanRedige(fil);
  assert.equal(dernier?.numero, 2);
  assert.equal(dernier?.contenu, 'version 2');
  assert.equal(planEnAttente(fil), null, 'ce plan n’attend plus de décision, mais il existe');
  assert.equal(dernierPlanRedige([REPONSE('bonjour')]), null);
});

test('la relance nomme la version attendue, les parties manquantes et la place de la question', () => {
  const texte = consigneDePlanEntier(3, ['Conséquences', 'Améliorations apportées']);
  assert.match(texte, /VERSION 3/);
  assert.match(texte, /Conséquences, Améliorations apportées/);
  assert.match(texte, /APRÈS les quatre parties/);
  assert.match(texte, /N'EST PAS UN PLAN ENTIER/);
});

test('la consigne du chef dit qu’une question se répond DANS le plan, et que le démon vérifie', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /UNE QUESTION DE L'UTILISATEUR SE RÉPOND DANS LE PLAN/);
  assert.match(consigne, /dites-moi laquelle intégrer au plan/i);
  assert.match(consigne, /LE DÉMON VÉRIFIE/);
});

test('la consigne de reprise dit qu’une question ne remplace pas le plan', () => {
  const texte = consigneDeRepriseDuPlan({ index: 0, numero: 1, contenu: 'version 1' });
  assert.match(texte, /MÊME SI LE MESSAGE CI-DESSOUS EST UNE QUESTION/);
  assert.match(texte, /APRÈS les quatre parties/);
});

test('le refus de carte en mode plan ne renvoie pas l’utilisateur au bouton « Plan »', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'plan' } as any, 'board_create_card', {
    title: 'Ajouter un bouton',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, false);
  assert.match(resultat.text, /NE DIS PAS À L'UTILISATEUR QUE LA CRÉATION EST BLOQUÉE/);
  assert.match(resultat.text, /ne lui demande pas de quitter le mode plan/i);
  assert.match(resultat.text, /Écris donc ton plan, entier/);
});
