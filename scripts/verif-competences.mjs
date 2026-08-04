#!/usr/bin/env node
/**
 * LES COMPÉTENCES PARTAGÉES ARRIVENT-ELLES VRAIMENT AUX AGENTS ?
 *
 * Une compétence (« skill ») est un mode d'emploi écrit d'avance : la
 * facturation, par exemple. Elle vivait dans le dossier personnel de
 * l'utilisateur, donc nulle part pour les agents lancés par HaikoDev — le chef
 * d'orchestre d'un projet répondait « je ne connais pas de moyen de créer une
 * offre ». On contrôle ici, sans rien inventer :
 *
 *   1. le dossier partagé porte au moins une compétence ;
 *   2. le coffre de chaque compte Claude la reçoit (c'est là que le moteur va
 *      la chercher) ;
 *   3. le briefing de DEUX projets réels la nomme, avec le chemin à ouvrir ;
 *   4. sur un VRAI tour du chef d'orchestre bridé, et sur les DEUX projets, une
 *      demande de facturation donne une carte proposée — plus un refus.
 *
 *   node scripts/verif-competences.mjs             # tout, deux tours de quota
 *   node scripts/verif-competences.mjs --sans-tour # les trois premiers seulement
 *
 * Le pont d'outils est un pont d'ESSAI : rien n'est écrit sur le tableau, et le
 * script juge le code du dépôt d'où il PART, jamais celui du dossier principal.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANS_TOUR = process.argv.includes('--sans-tour');

/**
 * La base du démon : celle du dépôt d'où l'on part, sinon celle du projet dont
 * cette copie de travail est issue (`<projet>/.worktrees/<carte>`).
 */
function dossierDonnees() {
  const candidats = [
    process.env.HAIKO_COMPETENCES_DATA,
    path.join(RACINE, 'data'),
    path.resolve(RACINE, '..', '..', 'data'),
  ].filter(Boolean);
  return candidats.find((d) => fs.existsSync(path.join(d, 'haikodev.db'))) ?? path.join(RACINE, 'data');
}

const DONNEES = dossierDonnees();
process.env.HAIKODEV_DATA = DONNEES;

const { listerCompetences, relierCompetencesAuxCoffres } = await import('../server/dist/competences.js');
const { briefing } = await import('../server/dist/memory.js');
const { listAccountRecords } = await import('../server/dist/accounts.js');
const { orchestratorAllowList, orchestratorDenyList } = await import('../server/dist/tools.js');
const { buildClaudeArgs, claudeAdapter } = await import('../server/dist/engines/claude.js');
const { openDb } = await import('../server/dist/db.js');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

console.log(`  …  dépôt jugé : ${RACINE}`);
console.log(`  …  données du démon : ${DONNEES}`);

/* --- 1. Le dossier partagé --- */
const competences = listerCompetences();
noter(
  'le dossier partagé porte au moins une compétence',
  competences.length > 0,
  competences.map((c) => c.nom).join(', ') || 'aucune',
);
const compta = competences.find((c) => c.nom === 'compta');
noter('la compétence « compta » est là, avec son mode d’emploi', Boolean(compta) && fs.existsSync(compta.fichier));

/* --- 2. Les coffres des comptes --- */
openDb();
const bilan = relierCompetencesAuxCoffres();
const comptesClaude = listAccountRecords().filter((c) => c.engine === 'claude');
const manquants = [];
for (const compte of comptesClaude) {
  for (const competence of competences) {
    if (!fs.existsSync(path.join(compte.configDir, 'skills', competence.nom))) {
      manquants.push(`${compte.id}/${competence.nom}`);
    }
  }
}
noter(
  `chaque coffre Claude (${comptesClaude.length}) porte les compétences partagées`,
  comptesClaude.length > 0 && manquants.length === 0,
  manquants.length ? `absentes : ${manquants.join(', ')}` : `posées ${bilan.posees.length}, déjà là ${bilan.dejaLa.length}`,
);

/* --- 3. Le briefing de deux vrais projets --- */
let projets = [];
try {
  const db = openDb();
  projets = db
    .prepare('SELECT data FROM projects')
    .all()
    .map((r) => JSON.parse(r.data))
    .filter((p) => p && p.path && fs.existsSync(p.path) && !p.archived)
    .slice(0, 2);
} catch (err) {
  console.log(`  …  projets illisibles : ${err.message}`);
}
noter('deux projets du tableau sont lisibles', projets.length >= 2, projets.map((p) => p.name).join(', '));

for (const projet of projets) {
  const texte = briefing(projet.path, projet.name, true, 'claude');
  noter(
    `le briefing de « ${projet.name} » nomme la compétence`,
    texte.includes('COMPÉTENCES PARTAGÉES') && texte.includes('compta'),
  );
}

/* --- 4. Le vrai tour du chef d'orchestre, sur les deux projets --- */
if (!SANS_TOUR && projets.length) {
  const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-competences-'));
  const PONT = path.join(DOSSIER, 'pont-essai.mjs');
  const TRACE = path.join(DOSSIER, 'appels.jsonl');
  fs.writeFileSync(
    PONT,
    `import fs from 'node:fs';
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const envoyer = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
const outil = (name) => ({ name, description: 'outil d\\'essai', inputSchema: { type: 'object', properties: { title: { type: 'string' }, constat: { type: 'string' }, attendu: { type: 'string' }, limites: { type: 'string' }, verification: { type: 'string' } } } });
rl.on('line', (ligne) => {
  let m; try { m = JSON.parse(ligne); } catch { return; }
  if (m.method === 'initialize') envoyer({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'haikodev', version: '1.0.0' } } });
  else if (m.method === 'tools/list') envoyer({ jsonrpc: '2.0', id: m.id, result: { tools: [outil('board_create_card'), outil('propose_task'), outil('project_memory')] } });
  else if (m.method === 'tools/call') {
    fs.appendFileSync(${JSON.stringify(TRACE)}, JSON.stringify(m.params) + '\\n');
    envoyer({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'carte proposée (essai)' }] } });
  } else if (m.id !== undefined) envoyer({ jsonrpc: '2.0', id: m.id, result: {} });
});
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(DOSSIER, 'mcp.json'),
    JSON.stringify({ mcpServers: { haikodev: { command: process.execPath, args: [PONT] } } }, null, 2),
  );

  const compteClaude = comptesClaude[0];
  for (const projet of projets) {
    const demande =
      `${briefing(projet.path, projet.name, true, 'claude')}\n\n` +
      `DEMANDE : Fais une offre de 2500 CHF pour le client « Essai Vérification » ` +
      `(une ligne : « accompagnement », 2500 CHF). Réponds en une phrase avant d'agir.`;

    console.log(`  …  un tour du chef d'orchestre est lancé sur « ${projet.name} » (une minute environ)`);
    const args = buildClaudeArgs({
      cwd: projet.path,
      prompt: demande,
      fullAccess: false,
      mcpConfigPath: path.join(DOSSIER, 'mcp.json'),
      mcpBridgePath: PONT,
      allowedTools: orchestratorAllowList(),
      disallowedTools: orchestratorDenyList(),
      systemPrompt: 'Tu es le chef d’orchestre : tu ne fais pas le travail, tu proposes une carte avec board_create_card.',
    });

    const sortie = await new Promise((resolve) => {
      const enfant = spawn(claudeAdapter.binary, args, {
        cwd: projet.path,
        env: { ...process.env, CLAUDE_CONFIG_DIR: compteClaude?.configDir ?? '', FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let texte = '';
      let erreur = '';
      enfant.stdin.write(demande);
      enfant.stdin.end();
      enfant.stdout.on('data', (c) => (texte += c.toString('utf8')));
      enfant.stderr.on('data', (c) => (erreur += c.toString('utf8')));
      const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 300000);
      enfant.on('close', () => {
        clearTimeout(minuteur);
        resolve({ texte, erreur });
      });
    });

    /*
     * Un compte refusé se reconnaît à SA phrase, jamais à un nombre : « 401 »
     * apparaît dans n'importe quel identifiant de la sortie, et un tour réussi
     * se serait déclaré en panne.
     */
    const brut = sortie.texte;
    const compteRefuse =
      /authentication token has been invalidated|please sign in|invalid api key|oauth token has expired/i.test(
        brut + sortie.erreur,
      );
    const appels = fs.existsSync(TRACE) ? fs.readFileSync(TRACE, 'utf8').trim().split('\n').filter(Boolean) : [];
    fs.rmSync(TRACE, { force: true });

    if (compteRefuse) {
      console.log('\n  ARRÊT  le compte Claude est refusé par le moteur : le vrai tour n’a PAS pu être joué.');
      console.log('         reconnecter le compte depuis les réglages, puis relancer ce script.');
      fs.rmSync(DOSSIER, { recursive: true, force: true });
      process.exit(1);
    }

    const texteAppels = appels.join('\n');
    noter(`« ${projet.name} » : une carte est proposée`, appels.length > 0, `${appels.length} appel(s) d’outil`);
    noter(
      `« ${projet.name} » : la carte parle bien de facturation`,
      /compta|factur|offre|devis/i.test(texteAppels),
      texteAppels.slice(0, 140),
    );
    noter(
      `« ${projet.name} » : aucune réponse « je ne sais pas faire »`,
      !/je ne (sais|connais) pas|aucun moyen|pas en mesure/i.test(brut),
    );
  }
  fs.rmSync(DOSSIER, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
