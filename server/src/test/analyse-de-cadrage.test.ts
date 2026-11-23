import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONSIGNE_CADRAGE,
  GESTES_DU_CADRAGE,
  ISSUES_DE_TOUR_DE_CADRAGE,
  OUTILS_DE_PREPARATION_CADRAGE,
  OUTILS_DE_TERRAIN_CADRAGE,
  outilVerrouilleAvantAnalyse,
  REFUS_AVANT_ANALYSE,
  analyseDeCadrageFaite,
  hooksDuVerrouDAnalyse,
  lectureDePieceJointeAutorisee,
} from '@beluga/shared';
import { buildClaudeArgs } from '../engines/claude.js';
import { EngineRunOptions } from '../engines/types.js';
import { cadrageAllowList, cadrageDenyList } from '../tools.js';

/* ------------------------------------------------------------------ */
/* LE CADRAGE MONTRE CE QU'IL A TROUVÉ, PUIS SEULEMENT APRÈS IL TRAVAILLE */
/*                                                                     */
/* Il partait fouiller le disque et écrire la carte avant d'avoir      */
/* ouvert un seul sujet de la mémoire du projet : l'utilisateur ne     */
/* voyait donc jamais ce qui allait servir de base à la tâche, et ne   */
/* pouvait rien corriger avant le lancement de l'agent complet.        */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(ICI, '../../src');

/* -------- La règle pure -------- */

test('une seule ouverture de mémoire suffit à ouvrir la suite du travail', () => {
  assert.equal(analyseDeCadrageFaite({ ouverturesMemoire: 0 }), false);
  assert.equal(analyseDeCadrageFaite({ ouverturesMemoire: 1 }), true);
  assert.equal(analyseDeCadrageFaite({ ouverturesMemoire: 7 }), true);
});

/* ------------------------------------------------------------------ */
/* LE CADRAGE EST UNE DISCUSSION, ET LA COMPRÉHENSION SUIT LE TRAVAIL   */
/*                                                                     */
/* La compréhension était « OBLIGATOIRE EN FIN DE CHAQUE TOUR », puis   */
/* due à chaque « travail à cadrer » : chaque précision refaisait une   */
/* compréhension, et les questions passaient après. Depuis le           */
/* 30/09/2026, chaque tour RÉPOND d'abord ; la compréhension ne bouge   */
/* que quand la discussion a fait avancer le travail.                  */
/* ------------------------------------------------------------------ */

test('la consigne s’ouvre sur la discussion : répondre d’abord, en suivant le fil', () => {
  assert.deepEqual([...ISSUES_DE_TOUR_DE_CADRAGE], ['cadrage', 'reponse']);
  /* La discussion est annoncée AVANT les gestes : c'est la première
     décision du tour, pas une note de bas de page. */
  const discussion = CONSIGNE_CADRAGE.indexOf("C'EST UNE DISCUSSION, ET TU Y RÉPONDS D'ABORD");
  assert.ok(discussion >= 0, 'la consigne doit s’ouvrir sur la discussion');
  assert.ok(discussion < CONSIGNE_CADRAGE.indexOf('1. TITRER LA CARTE'));
  assert.match(CONSIGNE_CADRAGE, /tu y RÉPONDS EN PREMIER, avant tout le reste/);
  assert.match(CONSIGNE_CADRAGE, /Tu SUIS LE FIL/);
  /* Une réponse d'étude n'est pas un avis en l'air, et elle CONCLUT. */
  assert.match(CONSIGNE_CADRAGE, /ARGUMENTÉE et OBJECTIVE/);
  assert.match(CONSIGNE_CADRAGE, /tu RECOMMANDES celle que tu retiendrais/);
  assert.match(CONSIGNE_CADRAGE, /La décision reste à l'utilisateur/);
  /* Plus d'arbitrage binaire, ni de ligne finale qui annonce « la fin prise ». */
  assert.doesNotMatch(CONSIGNE_CADRAGE, /DEUX FINS POSSIBLES/);
  assert.doesNotMatch(CONSIGNE_CADRAGE, /la fin que tu as prise/);
  assert.doesNotMatch(CONSIGNE_CADRAGE, /dit seulement où en est la carte/);
});

test('la compréhension se met à jour quand la discussion a fait avancer le travail, et d’office sur une carte qui n’en a aucune', () => {
  assert.ok(!CONSIGNE_CADRAGE.includes('OBLIGATOIRE EN FIN DE CHAQUE TOUR'));
  assert.match(CONSIGNE_CADRAGE, /QUAND LA DISCUSSION A FAIT AVANCER LE TRAVAIL, PAS À CHAQUE MESSAGE/);
  /* Sans compréhension, rien ne part : la première se rend dès que le travail est clair. */
  assert.match(CONSIGNE_CADRAGE, /la carte n'en porte ENCORE AUCUNE[\s\S]*?dans le doute, tu cadres/);
  /* L'utilisateur garde ses deux mots. */
  assert.match(CONSIGNE_CADRAGE, /« cadre ça »[\s\S]*?« réponds-moi seulement »/);
  /* Une réponse qui ne change rien laisse la compréhension telle quelle, sans amorcer de plan. */
  assert.match(CONSIGNE_CADRAGE, /la compréhension déjà rendue reste valable telle quelle, l'écran la repose en entier sous ta réponse \(tu ne la réécris pas\), aucun plan ne s'amorce/);
  /* Le quatrième geste porte la même condition. */
  assert.match(GESTES_DU_CADRAGE[3], /rendre_comprehension/);
  assert.match(GESTES_DU_CADRAGE[3], /fait avancer le travail/);
  assert.ok(!GESTES_DU_CADRAGE[3].includes('chaque tour'));
});

test('la consigne tient en quatre gestes, chacun porté par un outil, dans l\'ordre', () => {
  /*
   * LE DÉROULÉ N'EST PLUS DEMANDÉ AU MODÈLE EN HUIT TEMPS ET UN BLOC JSON : il
   * tient en quatre gestes, et chacun laisse une trace que le démon écrit
   * lui-même sur la carte (`shared/src/parcours-carte.ts`).
   */
  assert.equal(GESTES_DU_CADRAGE.length, 4);
  const outils = ['board_update_card', 'memoire', 'ask_user', 'rendre_comprehension'];
  let position = -1;
  for (const outil of outils) {
    const ici = CONSIGNE_CADRAGE.indexOf(`« ${outil} »`);
    assert.ok(ici > position, `« ${outil} » doit se lire dans la consigne, à sa place`);
    position = ici;
  }
  /* Le plan est FACULTATIF, et ce n'est pas l'agent qui en décide : c'est
     l'interrupteur « Plan » de la barre d'écriture, éteint par défaut. */
  assert.ok(CONSIGNE_CADRAGE.includes('rendre_plan'));
  assert.ok(CONSIGNE_CADRAGE.includes('LE PLAN EST DEVENU FACULTATIF, ET CE N\'EST PAS TOI QUI EN DÉCIDES'));
  assert.match(CONSIGNE_CADRAGE, /Tant que cette consigne n'est pas venue, tu n'écris aucun plan/);
  /* Le second registre de la compréhension est EXIGÉ : c'est lui qui part à
     l'agent d'exécution quand aucun plan n'est demandé. */
  assert.ok(CONSIGNE_CADRAGE.includes('partieTechnique'));
  assert.match(CONSIGNE_CADRAGE, /ET IL EST OBLIGATOIRE/);
  /* Plus aucun bloc de données ni gabarit à recopier. */
  assert.ok(!CONSIGNE_CADRAGE.includes('```'));
  /* La mémoire s'ouvre avant que la carte ne s'écrive au-delà du titre. */
  assert.ok(CONSIGNE_CADRAGE.indexOf('« memoire »') < CONSIGNE_CADRAGE.indexOf('ÉCRIS LA CARTE'));
});

/* ------------------------------------------------------------------ */
/* LE VERROU D'ANALYSE EST VIVANT, PAS FIGÉ AU LANCEMENT DU TOUR         */
/*                                                                     */
/* Les outils de terrain étaient retirés de la liste blanche au départ */
/* du tour : le modèle les appelait quand même et le moteur refusait   */
/* en rouge, puis la liste restait bridée tout le premier tour, même   */
/* une fois la mémoire ouverte. Le démon est désormais interrogé À     */
/* L'APPEL de chaque outil de terrain.                                 */
/* ------------------------------------------------------------------ */

const SCRIPT_DU_VERROU = path.resolve(ICI, '../../verrou-analyse.mjs');

function tourDeCadrage(extra: Partial<EngineRunOptions> = {}): EngineRunOptions {
  return {
    cwd: '/tmp/brouillon-cadrage',
    prompt: 'bonjour',
    fullAccess: false,
    allowedTools: cadrageAllowList(),
    disallowedTools: cadrageDenyList(),
    gardeDuDemonPath: '/opt/beluga/server/garde-demon.mjs',
    onEvent: () => {},
    ...extra,
  } as EngineRunOptions;
}

test('la liste blanche du cadrage garde ses outils de terrain : l’ordre du travail ne tient plus sur elle', () => {
  const permis = new Set(cadrageAllowList());
  for (const outil of OUTILS_DE_TERRAIN_CADRAGE) {
    assert.ok(permis.has(outil), `${outil} reste dans la liste : l’en retirer ne le cachait pas au modèle`);
  }
  for (const outil of ['mcp__beluga__memoire', 'mcp__beluga__competences', 'mcp__beluga__ask_user', 'TaskCreate']) {
    assert.ok(permis.has(outil), `${outil} reste ouvert`);
  }
  const interdits = new Set(cadrageDenyList());
  for (const outil of permis) {
    assert.equal(interdits.has(outil), false, `${outil} ne peut pas être des deux côtés`);
  }
});

test('le verrou se pose devant CHAQUE outil de terrain, à côté du garde du démon', () => {
  const verrou = hooksDuVerrouDAnalyse('/opt/beluga/server/verrou-analyse.mjs').PreToolUse as any[];
  assert.deepEqual(verrou[0].matcher.split('|'), [...OUTILS_DE_TERRAIN_CADRAGE]);

  const args = buildClaudeArgs(tourDeCadrage({ verrouAnalysePath: '/opt/beluga/server/verrou-analyse.mjs' }));
  const reglages = JSON.parse(args[args.indexOf('--settings') + 1]);
  const poses = (reglages.hooks.PreToolUse as any[]).map((h) => `${h.matcher} → ${h.hooks[0].command}`);
  assert.ok(poses.includes('Bash → node /opt/beluga/server/garde-demon.mjs'), 'le garde du démon reste posé');
  assert.ok(
    poses.some((p) => p.startsWith('Read|') && p.endsWith('node /opt/beluga/server/verrou-analyse.mjs')),
    'le verrou d’analyse est posé devant les outils de terrain',
  );

  // Analyse déjà faite, ou autre rôle : aucun verrou, aucun processus en plus.
  assert.ok(!buildClaudeArgs(tourDeCadrage()).join(' ').includes('verrou-analyse'));
});

function lancerLeVerrou(url: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [SCRIPT_DU_VERROU], {
      env: { ...process.env, BELUGA_URL: url, BELUGA_TOKEN: 'jeton-essai', BELUGA_AGENT: 'a1', BELUGA_TOUR: 't1' },
    });
    let stderr = '';
    enfant.stderr.on('data', (bout) => (stderr += bout));
    enfant.on('close', (code) => resolve({ code, stderr }));
    enfant.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
  });
}

test('le verrou refuse avant la mémoire, laisse passer après — et laisse passer un démon muet', async () => {
  let analyseFaite = false;
  const vus: string[] = [];
  const serveur = http.createServer((req, res) => {
    vus.push(`${req.url} ${req.headers['x-beluga-agent']} ${req.headers['x-beluga-tour']}`);
    req.resume();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ analyseFaite, text: analyseFaite ? '' : REFUS_AVANT_ANALYSE }));
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', () => resolve()));
  const { port } = serveur.address() as { port: number };
  const url = `http://127.0.0.1:${port}`;
  try {
    const avant = await lancerLeVerrou(url);
    assert.equal(avant.code, 2, 'avant la mémoire, l’outil est refusé');
    assert.ok(avant.stderr.includes('« memoire »'), 'et le refus dit quoi faire à la place');

    analyseFaite = true;
    const apres = await lancerLeVerrou(url);
    assert.equal(apres.code, 0, 'la mémoire ouverte, l’outil passe dans le même tour');
    assert.equal(apres.stderr, '');
    assert.deepEqual(vus, ['/internal/analyse a1 t1', '/internal/analyse a1 t1']);
  } finally {
    await new Promise<void>((resolve) => serveur.close(() => resolve()));
  }

  const muet = await lancerLeVerrou(url);
  assert.equal(muet.code, 0, 'un démon qui ne répond pas ne mure jamais le cadrage');
});

/* -------- Le verrou sur la carte, lu dans la source -------- */

test('la carte ne s\'écrit pas avant que la mémoire ait été ouverte', () => {
  const tools = fs.readFileSync(path.join(SOURCES, 'tools.ts'), 'utf8');
  const debut = tools.indexOf("case 'board_update_card'");
  const extrait = tools.slice(debut, debut + 1600);
  assert.ok(extrait.includes("ctx.role === 'cadrage'"), 'le verrou ne vise que le cadrage');
  assert.ok(extrait.includes('consultationsDeLAgent'), 'il se fonde sur les ouvertures réelles de mémoire');
  assert.ok(extrait.includes('REFUS_AVANT_ANALYSE'), 'le refus dit quoi faire à la place');
  assert.ok(
    extrait.includes('ecritureDeCarteAutoriseeAuCadrage'),
    'seul le titre seul échappe au verrou, et par la règle pure',
  );
  assert.ok(REFUS_AVANT_ANALYSE.includes('« memoire »'));
});

test('le démon pose le verrou tant que l’analyse n’est pas faite, et y répond à l’appel', () => {
  const runtime = fs.readFileSync(path.join(SOURCES, 'runtime.ts'), 'utf8');
  assert.ok(
    runtime.includes('verrouAnalysePath: bride && !analyseDuCadrageFaite(agent.id)'),
    'le tour pose le verrou sur l’état réel de l’analyse',
  );
  assert.ok(!runtime.includes('cadrageAllowList({'), 'plus aucune liste blanche figée au lancement');
  const serveur = fs.readFileSync(path.join(SOURCES, 'http.ts'), 'utf8');
  const debut = serveur.indexOf("route === '/internal/analyse'");
  assert.ok(debut > 0, 'le démon sert le verrou');
  const extrait = serveur.slice(debut, debut + 3200);
  assert.ok(extrait.includes('outilVerrouilleAvantAnalyse'), 'le démon laisse passer la préparation d’outil');
  assert.ok(extrait.includes('analyseDeCadrageFaite') && extrait.includes('REFUS_AVANT_ANALYSE'));
  assert.ok(extrait.includes('lectureDePieceJointeAutorisee'), 'le démon exempte la lecture d’une pièce jointe');
  assert.ok(extrait.includes('realpathSync'), 'le chemin est résolu avant la comparaison');
  const script = fs.readFileSync(path.join(SOURCES, '..', 'verrou-analyse.mjs'), 'utf8');
  assert.ok(script.includes('tool_input'), 'le script transmet le chemin lu');
});

test('lire une pièce jointe passe avant la mémoire, rien d’autre ne s’ouvre', () => {
  const dossiers = ['/data/attachments', '/mnt/stock/beluga-piecesjointes/'];
  const lire = (outil: string, chemin: string) => lectureDePieceJointeAutorisee({ outil, chemin, dossiers });
  assert.equal(lire('Read', '/data/attachments/0f36-IMG_0909.jpeg'), true);
  assert.equal(lire('Read', '/mnt/stock/beluga-piecesjointes/ab/capture.png'), true);
  // Les autres outils, même sur une pièce jointe : verrouillés.
  for (const outil of ['Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'BashOutput']) {
    assert.equal(lire(outil, '/data/attachments/x.png'), false, outil);
  }
  // Fichier du projet, chemin relatif, sortie par « .. », préfixe trompeur, dossier lui-même.
  assert.equal(lire('Read', '/root/beluga/server/src/http.ts'), false);
  assert.equal(lire('Read', 'data/attachments/x.png'), false);
  assert.equal(lire('Read', '/data/attachments/../../etc/passwd'), false);
  assert.equal(lire('Read', '/data/attachments-autre/x.png'), false);
  assert.equal(lire('Read', '/mnt/stock/beluga-piecesjointes-autre/x.png'), false);
  assert.equal(lire('Read', '/data/attachments'), false);
  assert.equal(lire('Read', ''), false);
  assert.equal(lectureDePieceJointeAutorisee({ outil: 'Read', chemin: '/x/y', dossiers: ['', '/'] }), false);
});

test('préparer un outil n’est jamais retenu : ToolSearch charge la mémoire elle-même', () => {
  // Carte de nuit fd54689b : un petit modèle qui ne connaissait pas encore
  // l'outil « memoire » a buté dix fois sur ToolSearch, puis s'est arrêté.
  assert.ok(!(OUTILS_DE_TERRAIN_CADRAGE as readonly string[]).includes('ToolSearch'));
  assert.ok((OUTILS_DE_PREPARATION_CADRAGE as readonly string[]).includes('ToolSearch'));
  assert.equal(outilVerrouilleAvantAnalyse('ToolSearch'), false);
  assert.equal(outilVerrouilleAvantAnalyse('Read'), true);
  assert.equal(outilVerrouilleAvantAnalyse('Bash'), true);
  const verrou = hooksDuVerrouDAnalyse('/x/verrou-analyse.mjs').PreToolUse as any[];
  assert.ok(!verrou[0].matcher.split('|').includes('ToolSearch'), 'le verrou ne vise plus la préparation d’outil');
  assert.ok(new Set(cadrageAllowList()).has('ToolSearch'), 'ToolSearch reste permis au cadrage');
  assert.ok(REFUS_AVANT_ANALYSE.includes('ToolSearch'), 'le refus dit comment charger l’outil');
  const repli = fs.readFileSync(path.join(SOURCES, '..', 'verrou-analyse.mjs'), 'utf8');
  assert.ok(!repli.includes('project_memory'), 'le repli ne cite plus l’ancien nom de l’outil');
});
