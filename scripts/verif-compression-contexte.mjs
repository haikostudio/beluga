#!/usr/bin/env node
/**
 * Contrôle réel de reprise et de mesure du contexte, sous Claude puis Codex.
 * Deux petits tours par moteur : le second doit retrouver le mot du premier,
 * et l'adaptateur doit rendre une taille inférieure à la fenêtre du modèle.
 * Rien n'est écrit dans le projet ni dans la base.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GIT_COMMUN = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: RACINE, encoding: 'utf8' }).trim();
const DEPOT_PRINCIPAL = path.dirname(path.isAbsolute(GIT_COMMUN) ? GIT_COMMUN : path.resolve(RACINE, GIT_COMMUN));
const DATA = process.env.HAIKO_COMPRESSION_DATA || path.join(DEPOT_PRINCIPAL, 'data');
const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-compression-contexte-'));

const { claudeAdapter } = await import(path.join(RACINE, 'server/dist/engines/claude.js'));
const { codexAdapter } = await import(path.join(RACINE, 'server/dist/engines/codex.js'));

function comptes() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  try {
    return db.prepare('SELECT data FROM accounts ORDER BY id').all().map((row) => JSON.parse(row.data));
  } finally {
    db.close();
  }
}

function envCompte(compte) {
  return compte.engine === 'claude'
    ? { CLAUDE_CONFIG_DIR: compte.configDir }
    : { CODEX_HOME: compte.configDir };
}

async function tour(adapter, compte, prompt, sessionId) {
  let fil = sessionId;
  let reponse = '';
  let context = null;
  let panne = '';
  const handle = adapter.run({
    cwd: DOSSIER,
    prompt,
    sessionId,
    fullAccess: false,
    env: envCompte(compte),
    onEvent: (event) => {
      if (event.kind === 'session' && event.sessionId) fil = event.sessionId;
      if (event.kind === 'text' && event.text) reponse += event.text;
      if (event.kind === 'context' && event.context) context = event.context;
      if (event.kind === 'error' && event.error) panne += event.error;
    },
  });
  const fini = await handle.finished;
  return { ok: fini.ok && !panne, fil, reponse, context, panne: panne || fini.error || '' };
}

const resultats = [];
function noter(libelle, ok, detail = '') {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${libelle}${detail ? ` — ${detail}` : ''}`);
}

for (const adapter of [claudeAdapter, codexAdapter]) {
  const candidats = comptes().filter((compte) => compte.engine === adapter.id && !compte.disabled);
  let premier = null;
  let compteRetenu = null;
  console.log(`\n${adapter.label}`);
  for (const compte of candidats) {
    const essai = await tour(adapter, compte, 'Retiens le mot CANNELLE. Réponds seulement NOTÉ.', undefined);
    if (essai.ok && essai.fil) {
      premier = essai;
      compteRetenu = compte;
      break;
    }
  }
  if (!premier || !compteRetenu) {
    noter(`${adapter.label} ouvre un premier fil`, false, 'aucun compte disponible pour le contrôle réel');
    continue;
  }

  noter(`${adapter.label} ouvre un premier fil`, Boolean(premier.fil));
  noter(
    `${adapter.label} mesure le contexte courant`,
    Boolean(premier.context?.tokens && premier.context?.window && premier.context.tokens < premier.context.window),
    premier.context ? `${premier.context.tokens}/${premier.context.window}` : 'mesure absente',
  );

  const reprise = await tour(adapter, compteRetenu, 'Quel mot devais-tu retenir ? Réponds par ce seul mot.', premier.fil);
  noter(`${adapter.label} reprend le même fil`, reprise.ok && reprise.fil === premier.fil, reprise.panne.slice(0, 100));
  noter(`${adapter.label} garde l’information indispensable`, /CANNELLE/i.test(reprise.reponse), reprise.reponse.trim().slice(0, 80));
}

fs.rmSync(DOSSIER, { recursive: true, force: true });
const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
