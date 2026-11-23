#!/usr/bin/env node
/**
 * UN TOUR DE CARTE QUI FINIT SUR « J'ATTENDS MES CONTRÔLES » EST RELANCÉ UNE FOIS.
 *
 * Constat qui a produit ce contrôle : une carte s'est refermée sur deux
 * paragraphes où l'agent disait attendre des contrôles lancés en tâche de fond.
 * Le contrôle de forme laissait passer ce texte (moins de 160 mots, donc
 * « brève », sans section exigée), et le démon ne suivait pas les tâches de fond.
 *
 * Rien n'est simulé à moitié : un FAUX MOTEUR parle le format de Claude Code,
 * l'adaptateur RÉEL le lance et traduit sa sortie en étapes. Ce qui est vérifié :
 *   1. l'étape d'outil garde son ENTRÉE complète, drapeau `run_in_background`
 *      compris, et son résultat porte l'identifiant de la tâche ;
 *   2. la règle en déduit la tâche encore vivante ;
 *   3. le message d'attente est hors gabarit sous le plancher, et la relance est
 *      due ; un tour arrêté à la main ne l'est pas ;
 *   4. la consigne partie au moteur nomme la tâche, et le compte rendu rendu
 *      par la relance tient le gabarit.
 *
 *   npm run build:server && node scripts/verif-relance-du-rapport.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASE_JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-relance-rapport-'));
process.env.BELUGA_DATA = BASE_JETABLE;

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const MESSAGE_D_ATTENTE =
  "J'ai lancé la construction et les contrôles en tâche de fond.\n\nJ'attends leur résultat avant d'écrire le compte rendu.";

const RAPPORT = [
  '## 1. Analyse', '', 'La demande est comprise.', '',
  '## 2. Ce qui est fait', '', 'npm test a rendu 12 tests passés.', '',
  '## 3. Conséquences', '', 'Rien ne casse.', '',
  '## 4. Impact', '', 'Aucun pour l’utilisateur.', '',
  '## 5. Évolutions possibles', '', '- Ajouter un contrôle', '',
  '## 6. Coûts', '', 'Deux minutes.',
].join('\n');

/*
 * LE FAUX MOTEUR. Au premier appel, il lance une commande en tâche de fond
 * (un `tool_use` Bash avec `run_in_background`, puis le `tool_result` qui
 * annonce l'identifiant) et rend le message d'attente. Aux appels suivants —
 * la relance —, il rend le compte rendu entier.
 */
const FAUX_MOTEUR = path.join(BASE_JETABLE, 'faux-moteur.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
const temoin = process.env.TEMOIN_RELANCE;
const etat = JSON.parse(fs.readFileSync(temoin, 'utf8'));
etat.appels += 1;
let demande = '';
process.stdin.on('data', (c) => (demande += c));
process.stdin.on('end', () => {
  etat.demandes.push(demande);
  fs.writeFileSync(temoin, JSON.stringify(etat));
  const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  dire({ type: 'system', subtype: 'init', session_id: 'session-d-essai' });
  if (etat.appels === 1) {
    dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'outil-1', name: 'Bash',
      input: { command: 'npm run build && npm test', run_in_background: true, description: 'Construire et tester' } }] } });
    dire({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'outil-1',
      content: 'Command running in background with ID: b7f3a1. Output is being written to: /tmp/b7f3a1.output' }] } });
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: ${JSON.stringify(MESSAGE_D_ATTENTE)} }] } });
  } else {
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: ${JSON.stringify(RAPPORT)} }] } });
  }
  dire({ type: 'result', subtype: 'success', session_id: 'session-d-essai', usage: {} });
  process.exit(0);
});
`,
  { mode: 0o755 },
);

const TEMOIN = path.join(BASE_JETABLE, 'temoin.json');
fs.writeFileSync(TEMOIN, JSON.stringify({ appels: 0, demandes: [] }));
process.env.BELUGA_CLAUDE_BIN = FAUX_MOTEUR;
process.env.TEMOIN_RELANCE = TEMOIN;

const { claudeAdapter } = await import(path.join(RACINE, 'server/dist/engines/claude.js'));
const { checkTemplate, consigneDeRelanceDuRapport, rapportAuPlancher, relanceDuRapport, tachesDeFondVivantes } =
  await import(path.join(RACINE, 'shared/dist/index.js'));

/** Un appel au faux moteur, avec les étapes telles que le démon les garde. */
async function appel(prompt) {
  let texte = '';
  const etapes = new Map();
  const handle = claudeAdapter.run({
    cwd: BASE_JETABLE,
    prompt,
    fullAccess: true,
    env: { TEMOIN_RELANCE: TEMOIN },
    onEvent: (event) => {
      if (event.kind === 'text' && event.text) texte += (texte ? '\n\n' : '') + event.text;
      if (event.kind === 'step' && event.step) {
        const avant = etapes.get(event.step.key) ?? {};
        etapes.set(event.step.key, {
          cle: event.step.key,
          outil: event.step.outil ?? avant.outil ?? '',
          entree: event.step.entree ?? avant.entree,
          resultat: event.step.state === 'running' ? avant.resultat : event.step.detail,
          etat: event.step.state,
        });
      }
    },
  });
  const resultat = await handle.finished;
  return { ok: resultat.ok, texte: texte.trim(), etapes: [...etapes.values()] };
}

try {
  const plancher = rapportAuPlancher({ role: 'task', porteUneCarte: true, kind: 'in_run', ampleurImposee: 'complete' });
  noter('un tour d’exécution de carte est sous le plancher', plancher === true);

  const premier = await appel('Fais le travail de la carte.');
  const etape = premier.etapes.find((e) => e.outil === 'Bash');
  noter('l’étape garde son entrée complète, drapeau compris', etape?.entree?.run_in_background === true,
    JSON.stringify(etape?.entree ?? null));
  noter('le résultat de l’étape porte l’identifiant de la tâche', /b7f3a1/.test(etape?.resultat ?? ''));

  const taches = tachesDeFondVivantes(premier.etapes);
  noter('la tâche de fond est vue vivante', taches.length === 1 && taches[0].id === 'b7f3a1',
    taches.map((t) => `${t.commande} (${t.id})`).join(', '));

  const forme = checkTemplate('in_run', premier.texte, 'complete', { plancher });
  noter('le message d’attente est hors gabarit sous le plancher', !forme.ok, forme.missing.join(', '));
  const base = { plancher, formeTenue: forme.ok, texte: premier.texte, echec: !premier.ok, arrete: false };
  noter('la relance est due', relanceDuRapport(base));
  noter('un tour arrêté à la main n’est pas relancé', !relanceDuRapport({ ...base, arrete: true }));

  const consigne = consigneDeRelanceDuRapport({ manquantes: forme.missing, taches });
  const second = await appel(consigne);
  const lu = JSON.parse(fs.readFileSync(TEMOIN, 'utf8'));
  noter('une seule relance est partie', lu.appels === 2, `${lu.appels} appel(s)`);
  noter('la consigne partie au moteur nomme la tâche de fond', /npm run build && npm test \(ID b7f3a1\)/.test(lu.demandes[1] ?? ''));
  const formeRelancee = checkTemplate('in_run', second.texte, 'complete', { plancher });
  noter('le compte rendu relancé tient le gabarit', formeRelancee.ok, formeRelancee.missing.join(', '));
} finally {
  fs.rmSync(BASE_JETABLE, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
