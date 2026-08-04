#!/usr/bin/env node
/**
 * Changer de modèle en cours de conversation casse-t-il la reprise sous Codex ?
 *
 * Le démon retenait le fil d'un agent par MOTEUR seulement. Codex, lui,
 * enregistre le modèle qui a ouvert le fil et refuse de le reprendre avec un
 * autre : « This session was recorded with model `X` but is resuming with `Y` ».
 * Douze de ces erreurs dans le journal du chef d'orchestre.
 *
 * On rejoue ici le chemin RÉEL du démon, avec la règle `cleDeSession` :
 *   1. un premier tour ouvre un fil sous le modèle A ;
 *   2. un second tour, MÊME modèle, reprend le fil et se souvient ;
 *   3. un troisième tour, modèle B, ouvre un fil NEUF — aucune erreur ;
 *   4. la reprise à l'ancienne (fil de A, modèle B) est jouée exprès pour
 *      montrer que l'erreur existe bel et bien, et que c'est elle qu'on évite.
 *
 *   node scripts/verif-reprise-modele.mjs
 *
 * Consomme trois ou quatre petits tours du quota Codex. N'écrit rien hors de
 * /tmp, ne touche ni à la base ni au tableau.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodexArgs, codexAdapter } from '../server/dist/engines/codex.js';
import { cleDeSession } from '../shared/dist/index.js';

const MODELE_A = process.env.VERIF_MODELE_A || 'gpt-5.6-sol';
const MODELE_B = process.env.VERIF_MODELE_B || 'gpt-5.6-terra';

/** Le compte que le démon emploie VRAIMENT pour Codex. */
function compteCodex() {
  try {
    const texte = fs.readFileSync(path.join(process.cwd(), 'data', 'haikodev.db')).toString('latin1');
    const trouve = texte.match(/"engine":"codex"[^}]*"configDir":"([^"]+)"/);
    if (trouve) return trouve[1];
  } catch {
    /* pas de base lisible : on garde le compte du système */
  }
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

const CODEX_HOME = compteCodex();
const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reprise-modele-'));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Le petit dictionnaire de fils du démon, en mémoire pour l'essai. */
const fils = {};

function tour(prompt, model, sessionId) {
  return {
    cwd: DOSSIER,
    prompt,
    model,
    sessionId,
    fullAccess: true,
    env: { CODEX_HOME },
    onEvent: () => {},
  };
}

async function jouer(options) {
  const args = buildCodexArgs(options);
  const sortie = await new Promise((resolve) => {
    const enfant = spawn(codexAdapter.binary, args, {
      cwd: DOSSIER,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let texte = '';
    enfant.stdout.on('data', (c) => (texte += c.toString('utf8')));
    enfant.stderr.on('data', (c) => (texte += c.toString('utf8')));
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 300000);
    enfant.on('close', () => {
      clearTimeout(minuteur);
      resolve(texte);
    });
  });

  const evenements = [];
  for (const ligne of sortie.split('\n')) {
    const t = ligne.trim();
    if (!t.startsWith('{')) continue;
    try {
      evenements.push(JSON.parse(t));
    } catch {
      /* ligne partielle */
    }
  }
  const items = evenements.map((e) => e.item).filter(Boolean);
  return {
    brut: sortie,
    threadId: evenements.map((e) => e.thread_id).find(Boolean) ?? null,
    reponse: items
      .filter((i) => i.type === 'agent_message')
      .map((i) => i.text ?? '')
      .join('\n'),
    pannes: evenements
      .filter((e) => e.type === 'error' || e.type === 'turn.failed')
      .map((e) => e.message ?? e.error?.message ?? '')
      .join('\n'),
  };
}

const ERREUR_MODELE = /recorded with model|resuming with/i;
const COMPTE_REFUSE = /token|sign in|log out|unauthorized|401/i;

console.log(`  …  compte Codex : ${CODEX_HOME}`);
console.log(`  …  modèles : ${MODELE_A} puis ${MODELE_B}`);

/* --- La règle, sans quota --- */
noter('un modèle différent donne une clé différente', cleDeSession('codex', MODELE_A) !== cleDeSession('codex', MODELE_B));
noter('le même modèle retrouve la même clé', cleDeSession('codex', MODELE_A) === cleDeSession('codex', MODELE_A));

/* --- Tour 1 : ouverture du fil sous le modèle A --- */
console.log('  …  tour 1 (ouverture du fil)');
const t1 = await jouer(tour('Retiens ce mot : ANANAS. Réponds seulement : NOTÉ.', MODELE_A, undefined));

if (COMPTE_REFUSE.test(t1.pannes)) {
  console.log(`\n  ARRÊT  le compte Codex est refusé par le moteur : ${t1.pannes.split('\n')[0]}`);
  console.log("         les tours réels n'ont PAS pu être joués — reconnecter le compte, puis relancer.");
  fs.rmSync(DOSSIER, { recursive: true, force: true });
  process.exit(1);
}

noter('le premier tour ouvre bien un fil', Boolean(t1.threadId), t1.threadId ?? t1.pannes.slice(0, 120));
if (t1.threadId) fils[cleDeSession('codex', MODELE_A)] = t1.threadId;

/* --- Tour 2 : même modèle, le fil se reprend --- */
console.log('  …  tour 2 (même modèle, reprise)');
const t2 = await jouer(tour('Quel mot devais-tu retenir ? Un seul mot.', MODELE_A, fils[cleDeSession('codex', MODELE_A)]));
noter('le même modèle reprend le fil sans erreur', !ERREUR_MODELE.test(t2.brut), t2.pannes.split('\n')[0]?.slice(0, 120) ?? '');
noter('le fil repris se souvient de la conversation', /ANANAS/i.test(t2.reponse), t2.reponse.trim().slice(0, 80));

/* --- Tour 3 : autre modèle, fil neuf --- */
console.log('  …  tour 3 (autre modèle)');
const cleB = cleDeSession('codex', MODELE_B);
noter("un autre modèle ne reprend AUCUN fil existant", fils[cleB] === undefined);
const t3 = await jouer(tour('Réponds seulement : PRÊT.', MODELE_B, fils[cleB]));
noter(
  "changer de modèle n'affiche plus d'erreur de reprise",
  !ERREUR_MODELE.test(t3.brut),
  t3.brut.match(ERREUR_MODELE) ? t3.pannes.split('\n')[0]?.slice(0, 160) : '',
);
noter('le tour du nouveau modèle aboutit', Boolean(t3.reponse.trim()), t3.reponse.trim().slice(0, 80));

/* --- Contre-épreuve : l'ancienne façon de faire --- */
if (t1.threadId) {
  console.log("  …  contre-épreuve (l'ancienne façon : fil du modèle A, modèle B)");
  const ancien = await jouer(tour('Réponds seulement : PRÊT.', MODELE_B, t1.threadId));
  noter(
    "l'erreur évitée existe bel et bien (contre-épreuve)",
    ERREUR_MODELE.test(ancien.brut),
    ERREUR_MODELE.test(ancien.brut)
      ? 'le moteur refuse le fil enregistré sous un autre modèle'
      : "le moteur ne proteste plus : la contre-épreuve ne prouve plus rien, contrôle à revoir",
  );
}

fs.rmSync(DOSSIER, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
