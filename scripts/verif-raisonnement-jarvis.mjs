#!/usr/bin/env node
/**
 * LE RAISONNEMENT DE JARVIS, MESURÉ SUR SES VRAIS APPELS (carte « Jarvis plus fiable et vérifié », 18/11/2026).
 *
 * Lit les journaux du « cerveau » (fil Codex) des conversations vocales — chaque demande passée par la voix y arrive en
 * `<realtime_delegation>` — et compte, demande par demande : les outils appelés, si le dossier de vérification
 * (`voix_dossier`) vient EN PREMIER, si la mémoire est ouverte, et le temps jusqu'à la réponse finale. Rien n'est
 * envoyé à un moteur : aucun quota. Les phrases de l'utilisateur ne sont jamais copiées dans le dépôt, seulement
 * imprimées à l'écran (`--detail`).
 *
 *   node scripts/verif-raisonnement-jarvis.mjs                 # depuis le 01/11
 *   node scripts/verif-raisonnement-jarvis.mjs --depuis 2026-11-19 --detail
 *   node scripts/verif-raisonnement-jarvis.mjs --exiger        # échoue si une demande n'a pas commencé par le dossier
 *
 * MESURE AVANT (18/11/2026, 21 conversations vocales du 03/11 au 18/11, 91 demandes passées au cerveau) :
 *   dossier en premier 0 %, mémoire consultée 1 % (1/91), AUCUNE vérification 54 % (49/91), 1,0 appel par demande,
 *   8,0 s médianes jusqu'à la réponse finale. APRÈS : à rejouer une fois la carte publiée (`--depuis <jour>`), cible
 *   dossier en premier ≥ 90 %, aucune réponse sans vérification.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const valeur = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
};
const depuis = Date.parse(`${valeur('--depuis', '2026-11-01')}T00:00:00Z`);
const detail = args.includes('--detail');
const exiger = args.includes('--exiger');

/** Les maisons Codex des comptes : `~/.beluga/maisons-codex/<compte>/sessions/AAAA/MM/JJ/*.jsonl`. */
function journaux() {
  const racines = [path.join(os.homedir(), '.beluga', 'maisons-codex'), ...(process.env.MAISONS_CODEX ? [process.env.MAISONS_CODEX] : [])];
  const fichiers = [];
  const parcourir = (dossier, profondeur) => {
    let entrees = [];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      const p = path.join(dossier, e.name);
      // Les maisons des comptes relient souvent `sessions` par un lien symbolique : il se suit.
      let estDossier = e.isDirectory();
      if (e.isSymbolicLink()) {
        try {
          estDossier = fs.statSync(p).isDirectory();
        } catch {
          estDossier = false;
        }
      }
      if (estDossier && profondeur < 6) parcourir(p, profondeur + 1);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) fichiers.push(p);
    }
  };
  for (const r of racines) parcourir(r, 0);
  return fichiers.filter((f) => {
    const m = /rollout-(\d{4}-\d{2}-\d{2})T/.exec(path.basename(f));
    return m && Date.parse(`${m[1]}T00:00:00Z`) >= depuis;
  });
}

/** Les outils de Beluga appelés dans un bloc de code du cerveau (`tools.mcp__beluga__x(...)`) ou en appel direct. */
function outilsDe(appel) {
  const texte = typeof appel.input === 'string' ? appel.input : typeof appel.arguments === 'string' ? appel.arguments : '';
  const vus = [...texte.matchAll(/mcp__beluga__([a-z_]+)/g)].map((m) => m[1]);
  if (!vus.length && typeof appel.name === 'string' && appel.name.startsWith('mcp__beluga__')) vus.push(appel.name.slice(13));
  return vus;
}

function analyser(fichier) {
  const demandes = [];
  let courante = null;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    if (!ligne.trim()) continue;
    let o;
    try {
      o = JSON.parse(ligne);
    } catch {
      continue;
    }
    const p = o.payload ?? {};
    const at = Date.parse(o.timestamp ?? '') || 0;
    if (p.type === 'user_message' && typeof p.message === 'string' && p.message.includes('<realtime_delegation>')) {
      const phrase = /<input>([\s\S]*?)<\/input>/.exec(p.message)?.[1]?.trim() ?? '';
      courante = { phrase, debut: at, outils: [], fin: 0, reponse: '' };
      demandes.push(courante);
      continue;
    }
    if (!courante) continue;
    if (p.type === 'custom_tool_call' || p.type === 'function_call') courante.outils.push(...outilsDe(p));
    if (p.type === 'agent_message' && p.phase === 'final_answer') {
      courante.fin = at;
      courante.reponse = String(p.message ?? '');
    }
  }
  return demandes;
}

const fichiers = journaux().filter((f) => fs.readFileSync(f, 'utf8').includes('<realtime_delegation>'));
const demandes = fichiers.flatMap(analyser).filter((d) => !/^(jarvis|ok|oui|merci)[ .!?]*$/i.test(d.phrase));
const n = demandes.length;
const pct = (k) => (n ? `${Math.round((100 * k) / n)} %` : '—');
const avecDossierDabord = demandes.filter((d) => d.outils[0] === 'voix_dossier').length;
const avecMemoire = demandes.filter((d) => d.outils.includes('memoire') || d.outils.includes('voix_dossier')).length;
const sansOutil = demandes.filter((d) => !d.outils.length).length;
const appelsMoyens = n ? (demandes.reduce((s, d) => s + d.outils.length, 0) / n).toFixed(1) : '—';
const durees = demandes.filter((d) => d.fin && d.debut).map((d) => (d.fin - d.debut) / 1000).sort((a, b) => a - b);
const mediane = durees.length ? durees[Math.floor(durees.length / 2)].toFixed(1) : '—';

console.log(`Conversations vocales lues : ${fichiers.length} — demandes passées au cerveau : ${n}`);
console.log(`- dossier de vérification appelé EN PREMIER : ${avecDossierDabord} (${pct(avecDossierDabord)})`);
console.log(`- mémoire consultée avant la réponse (dossier ou memoire) : ${avecMemoire} (${pct(avecMemoire)})`);
console.log(`- aucune vérification (zéro outil) : ${sansOutil} (${pct(sansOutil)})`);
console.log(`- appels d'outils par demande, en moyenne : ${appelsMoyens}`);
console.log(`- temps médian jusqu'à la réponse finale : ${mediane} s`);
if (detail) {
  for (const d of demandes) {
    console.log(`\n· ${new Date(d.debut).toISOString().slice(0, 16)} — « ${d.phrase.slice(0, 120)} »`);
    console.log(`  outils : ${d.outils.join(' → ') || 'aucun'}${d.fin ? ` — ${((d.fin - d.debut) / 1000).toFixed(1)} s` : ''}`);
    if (d.reponse) console.log(`  réponse : ${d.reponse.slice(0, 200)}`);
  }
}
if (exiger && n && avecDossierDabord < n) {
  console.error(`\nÉCHEC : ${n - avecDossierDabord} demande(s) sans dossier de vérification en premier.`);
  process.exit(1);
}
