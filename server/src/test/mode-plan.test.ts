import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClaudeArgs } from '../engines/claude.js';
import { buildCodexArgs } from '../engines/codex.js';
import {
  cadreDePlanVisible,
  consigneDePlanEntier,
  consigneDePlanPlusFouille,
  consigneDeRepriseDuPlan,
  corpsDesParties,
  dernierPlanRedige,
  etatDuPlan,
  indexDuPlanCourant,
  jugerLeFond,
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

/* ------------------------------------------------------------------ */
/* Le CADRE ne s’ouvre que sur une réponse FINIE : un plan en cours     */
/* d’écriture n’est qu’une phrase d’intention, pas une décision.        */
/* ------------------------------------------------------------------ */

test('un plan encore en cours d’écriture n’ouvre ni cadre ni boutons', () => {
  assert.equal(
    cadreDePlanVisible({ plan: true, content: 'Je vais parcourir le site avant toute analyse.', streaming: true }),
    false,
    'le cadre ne doit pas s’ouvrir pendant que l’agent travaille',
  );
  assert.equal(
    cadreDePlanVisible({ plan: true, content: 'Je vais parcourir le site avant toute analyse.' }),
    true,
    'le même texte, une fois le tour rendu, garde son cadre',
  );
});

test('le cadre du plan reste fermé sur une panne, une reprise de compte ou un message vide', () => {
  assert.equal(cadreDePlanVisible({ plan: true, content: 'plan', error: 'code 1' }), false);
  assert.equal(cadreDePlanVisible({ plan: true, content: 'plan', repriseCompte: { comptes: [] } }), false);
  assert.equal(cadreDePlanVisible({ plan: true, content: '   ' }), false);
  assert.equal(cadreDePlanVisible({ plan: false, content: 'une réponse ordinaire' }), false);
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

/* ------------------------------------------------------------------ */
/* LE FOND : quatre titres remplis d'une phrase chacun ne font pas un   */
/* plan réfléchi. On compte la matière, sans jamais retirer le cadre.   */
/* ------------------------------------------------------------------ */

test('la consigne exige une analyse fouillée, hiérarchisée, et jamais un pavé', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /la VRAIE ANALYSE/);
  assert.match(consigne, /ce que le projet fait AUJOURD'HUI/);
  assert.match(consigne, /étapes NUMÉROTÉES/);
  assert.match(consigne, /titre court en gras/);
  assert.match(consigne, /FOUILLÉ, JAMAIS ILLISIBLE/);
  assert.match(consigne, /Jamais un pavé/);
  assert.match(consigne, /TU OUVRES LE PROJET/);
});

test('la consigne dit que la partie « Améliorations apportées » est une liste cliquable', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /AMÉLIORATIONS APPORTÉES : une LISTE À PUCES/);
  assert.match(consigne, /idées à AJOUTER au plan/);
  assert.match(consigne, /Ce ne sont pas les bénéfices/);
});

test('la consigne annonce la SECONDE vérification, celle du fond', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /LE DÉMON VÉRIFIE, DEUX FOIS/);
  assert.match(consigne, /Le FOND est vérifié ensuite/);
});

/** Un plan qui a vraiment été réfléchi : analyse constatée, étapes, liste. */
const PLAN_FOUILLE = [
  '## Faisabilité',
  '',
  "**Ce qui existe aujourd'hui.** Le cadre du plan pose déjà son entête, ses versions",
  'précédentes et ses deux boutons de décision, et le démon juge le texte rendu sur la',
  'présence de ses quatre titres. Rien ne regarde en revanche ce qu’il y a dessous.',
  '',
  '**Ce que la demande veut.** Une analyse qui constate au lieu d’affirmer, des parties',
  'découpées et un fond gris qui distingue le cadre dans le fil de la conversation.',
  '',
  "**L'écart.** Il manque une règle qui compte la matière du plan, un jeton de couleur",
  'pour son fond, et le passage des améliorations en liste cliquable.',
  '',
  '**Ce dont je ne suis pas sûr.** Le seuil exact au-delà duquel un paragraphe devient',
  'un pavé reste un choix, pas une mesure.',
  '',
  '## Chemin à suivre',
  '',
  '1. **Compter la matière.** Une règle partagée juge le fond du plan.',
  '2. **Poser le fond gris.** Un jeton de couleur décliné pour les deux thèmes.',
  '3. **Rendre les améliorations cliquables.** La même mécanique que les évolutions.',
  '',
  '## Conséquences',
  '',
  'Le chef est relancé une fois quand son plan est trop mince, et le cadre se repère',
  'dans le fil sans le lire.',
  '',
  '## Améliorations apportées',
  '',
  '- Ajoute un aperçu du plan dans la colonne de gauche.',
  '- Chiffre chaque étape du chemin en minutes.',
  '- Dis ce qui peut casser et comment revenir en arrière.',
].join('\n');

test('un plan vraiment fouillé passe la seconde vérification', () => {
  assert.equal(jugerLePlan(PLAN_FOUILLE).complet, true);
  const fond = jugerLeFond(PLAN_FOUILLE);
  assert.deepEqual(fond.reproches.map((r) => r.id), []);
  assert.equal(fond.assezFouille, true);
});

test('quatre titres et une phrase chacun ne suffisent plus', () => {
  const fond = jugerLeFond(PLAN_ENTIER);
  assert.equal(fond.assezFouille, false);
  const ids = fond.reproches.map((r) => r.id);
  assert.ok(ids.includes('analyse-mince'), 'une analyse d’une phrase est signalée');
  assert.ok(ids.includes('chemin-sans-etapes'), 'un chemin sans étapes numérotées est signalé');
  assert.ok(ids.includes('sans-hierarchie'), 'un plan sans sous-titre est signalé');
  assert.ok(ids.includes('ameliorations-non-listees'), 'des améliorations qui ne sont pas une liste');
});

test('chaque partie est jugée sur SON corps, jamais sur celui de la voisine', () => {
  const corps = corpsDesParties(PLAN_FOUILLE);
  assert.ok((corps.get('Faisabilité') ?? '').includes("Ce qui existe aujourd'hui"));
  assert.ok(!(corps.get('Faisabilité') ?? '').includes('Poser le fond gris'));
  assert.ok((corps.get('Chemin à suivre') ?? '').includes('Compter la matière'));
  assert.ok((corps.get('Améliorations apportées') ?? '').includes('aperçu du plan'));
});

test('le pavé est refusé autant que la maigreur', () => {
  const pave = PLAN_FOUILLE.replace(
    'Le chef est relancé une fois quand son plan est trop mince, et le cadre se repère\ndans le fil sans le lire.',
    'Le chef est relancé. '.repeat(120),
  );
  assert.ok(jugerLeFond(pave).reproches.some((r) => r.id === 'pave'));

  const fleuve = `${PLAN_FOUILLE}\n\n${'Encore une phrase de plus, sans rien apporter.\n\n'.repeat(400)}`;
  assert.ok(jugerLeFond(fleuve).reproches.some((r) => r.id === 'plan-fleuve'));
});

/**
 * LE CHEMIN ÉCRIT COMME LE CHEF L'ÉCRIT VRAIMENT : chaque étape porte un titre,
 * donc son numéro est habillé — « **Étape 1 — … » ou « ### 2. … ». Le compteur
 * n'acceptait que « 1. » en tête de ligne nue : il voyait ZÉRO étape sur ce
 * chemin-là, le reproche partait à chaque plan, et le démon payait un tour de
 * moteur entier avant d'afficher le cadre.
 */
const CHEMIN_A_TITRES = [
  '## Faisabilité',
  '',
  "**Ce qui existe aujourd'hui.** Le compteur d'étapes n'accepte qu'un numéro nu en tête",
  'de ligne, alors que le chef donne un titre à chacune de ses étapes et écrit donc son',
  'numéro en gras ou en sous-titre. Mesuré sur les douze derniers plans du projet, le',
  'reproche est parti douze fois sur douze, et la relance ne l’a jamais fait taire.',
  '',
  '**Ce que la demande veut.** Que le cadre du plan paraisse au moment même où le plan',
  'est rendu, sans un tour de moteur de plus.',
  '',
  "**L'écart.** Le compteur, et lui seul : le reste de la règle du fond tient.",
  '',
  '## Chemin à suivre',
  '',
  '**Étape 1 — Enlever l’habillage avant de chercher le numéro**',
  'Le titre Markdown, la puce et le gras sont retirés, puis le numéro est cherché.',
  '',
  '### 2. Accepter le mot qui précède le numéro',
  '« Étape », « Phase », « Lot » : le chef les écrit naturellement.',
  '',
  '- 3) Garder un numéro court',
  'Deux chiffres au plus, sinon une date passerait pour une étape.',
  '',
  '## Conséquences',
  '',
  'Un chemin bien découpé n’est plus renvoyé au chef pour la forme.',
  '',
  '## Améliorations apportées',
  '',
  '- Compte aussi les étapes écrites en toutes lettres.',
  '- Dis dans le déroulé quel reproche a déclenché la reprise.',
  '- Mesure le temps que la reprise ajoute au tour.',
].join('\n');

test('une étape numérotée compte quelle que soit la façon dont elle est écrite', () => {
  assert.equal(jugerLePlan(CHEMIN_A_TITRES).complet, true);
  const ids = jugerLeFond(CHEMIN_A_TITRES).reproches.map((r) => r.id);
  assert.ok(!ids.includes('chemin-sans-etapes'), `un chemin à étapes titrées est accepté (${ids.join(', ')})`);
});

test('un chiffre qui n’ouvre pas une étape n’en fait pas une', () => {
  const faux = CHEMIN_A_TITRES.replace(
    '**Étape 1 — Enlever l’habillage avant de chercher le numéro**\nLe titre Markdown, la puce et le gras sont retirés, puis le numéro est cherché.\n\n### 2. Accepter le mot qui précède le numéro\n« Étape », « Phase », « Lot » : le chef les écrit naturellement.\n\n- 3) Garder un numéro court\nDeux chiffres au plus, sinon une date passerait pour une étape.',
    ['Le 2026-08-17 : on a mesuré le coût de la reprise.',
     '1000 signes : au-delà, un paragraphe devient un pavé.',
     '- 3 fichiers seulement sont touchés par ce travail.'].join('\n'),
  );
  const ids = jugerLeFond(faux).reproches.map((r) => r.id);
  assert.ok(ids.includes('chemin-sans-etapes'), 'ni une date, ni un compte, ni un nombre ne sont des étapes');
});

test('la relance de fond nomme la version attendue et ce qui manque', () => {
  const texte = consigneDePlanPlusFouille(4, jugerLeFond(PLAN_ENTIER).reproches);
  assert.match(texte, /VERSION 4/);
  assert.match(texte, /PAS SA MATIÈRE/);
  assert.match(texte, /l'ANALYSE est trop mince/);
  assert.match(texte, /jamais un pavé/);
  // La relance n'a plus d'outil : elle ne doit pas promettre d'aller lire.
  assert.match(texte, /tu n'as plus d'outil ici/);
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
