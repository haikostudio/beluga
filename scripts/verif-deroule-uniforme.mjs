#!/usr/bin/env node
/*
 * LE DÉROULÉ D'AGENT EST-IL LE MÊME SOUS CODEX ET SOUS CLAUDE ?
 *
 * Sur UNE MÊME demande test, le script reconstruit l'instruction ENTIÈRE que le
 * démon enverrait à chaque moteur (consignes de rôle + méthode de travail +
 * gabarit de réponse), puis compare les deux ligne à ligne. La seule différence
 * tolérée est le NOM de l'outil de liste de tâches, qui appartient au moteur.
 *
 * Le relevé AVANT / APRÈS se lit dans git : la version de référence est l'état
 * d'avant la tâche d'uniformisation. On n'y compile rien — on y compte ce qui
 * était laissé au modèle et ne l'est plus.
 *
 *   node scripts/verif-deroule-uniforme.mjs [référence git]
 *
 * Ne demande ni serveur ni navigateur : tout se joue dans le texte envoyé.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = process.argv[2] ?? '2142365';

const { rolePrompt, rappelDeMethode } = await import(path.join(RACINE, 'server/dist/runtime.js'));
const { ORCHESTRATOR_ALLOWED_NATIVE } = await import(path.join(RACINE, 'server/dist/tools.js'));
const { wrapPrompt } = await import(path.join(RACINE, 'shared/dist/templates.js'));

const MOTEURS = ['claude', 'codex'];
const ROLES = ['cadrage', 'analysis', 'deploy', 'task'];

/** La demande test : une vraie demande de travail, la même pour les deux moteurs. */
const DEMANDE =
  "Le tableau se met à glisser de haut en bas sur téléphone alors qu'il ne devrait pas. " +
  'Corrige-le, vérifie sur un vrai navigateur, puis enregistre.';

/** L'instruction entière, telle que le démon la compose au premier tour. */
function instruction(moteur, role = 'task') {
  const consignes = rolePrompt(role, true, moteur);
  const demande = wrapPrompt('in_run', DEMANDE, `Projet : HaikoDev (dossier ${RACINE}).`);
  return `${consignes}\n\n---\n\n${demande}`;
}

/** Les lignes présentes chez l'un et pas chez l'autre. */
function divergences(a, b) {
  const lignesB = new Set(b.split('\n'));
  const lignesA = new Set(a.split('\n'));
  return {
    seulementA: a.split('\n').filter((l) => l.trim() && !lignesB.has(l)),
    seulementB: b.split('\n').filter((l) => l.trim() && !lignesA.has(l)),
  };
}

const estLigneOutil = (l) => l.startsWith("1. AVANT d'agir, annonce ta liste de tâches");

/* ------------------------------------------------------------------ */
/* 1. Les deux moteurs, sur la même demande                            */
/* ------------------------------------------------------------------ */

console.log('\nMÊME DEMANDE, DEUX MOTEURS\n');
console.log(`Demande test : « ${DEMANDE} »\n`);

let fautes = 0;

for (const role of ROLES) {
  const claude = instruction('claude', role);
  const codex = instruction('codex', role);
  const { seulementA, seulementB } = divergences(claude, codex);
  const inattendues = [...seulementA, ...seulementB].filter((l) => !estLigneOutil(l));

  const taille = `${Math.round(claude.length / 4)} jetons environ`;
  if (inattendues.length === 0) {
    console.log(`  ${role.padEnd(13)} identique (${taille}), au seul nom d'outil près.`);
  } else {
    fautes++;
    console.log(`  ${role.padEnd(13)} ${inattendues.length} ligne(s) qui diffèrent SANS raison :`);
    for (const l of inattendues.slice(0, 6)) console.log(`      ${l.slice(0, 120)}`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Ce que HaikoDev impose désormais, et que le modèle choisissait    */
/* ------------------------------------------------------------------ */

let source = null;
try {
  source = execFileSync('git', ['show', `${REFERENCE}:server/src/runtime.ts`], {
    cwd: RACINE,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch {
  console.log(`\nLa référence « ${REFERENCE} » n'existe plus : le relevé AVANT est sauté.`);
}

const CONTROLES = [
  {
    quoi: "Outil de liste : un seul nommé par moteur",
    avant: (s) => /TaskCreate puis TaskUpdate pour Claude.*update_plan pour Codex/.test(s),
    avantDit: 'les deux outils annoncés à tout le monde — le modèle choisissait',
    apres: () =>
      MOTEURS.every((m) => {
        const p = rolePrompt('task', false, m);
        return m === 'claude' ? !p.includes('update_plan') : !p.includes('TaskCreate');
      }),
  },
  {
    quoi: 'Méthode de lecture et de constat imposée',
    avant: (s) => !/MÉTHODE DE TRAVAIL IMPOSÉE/.test(s),
    avantDit: 'aucune : chaque moteur décidait quoi lire et comment raisonner',
    apres: () => MOTEURS.every((m) => rolePrompt('task', false, m).includes('MÉTHODE DE TRAVAIL IMPOSÉE')),
  },
  {
    quoi: 'Déroulé encore présent au fil de la conversation',
    avant: (s) => !/systemPromptRappel/.test(s),
    avantDit: 'Claude le recevait à chaque tour, Codex seulement au premier',
    apres: () => MOTEURS.every((m) => rappelDeMethode(m).includes('RAPPEL DE MÉTHODE')),
  },
  {
    quoi: 'Liste de tâches permise au chef bridé',
    avant: () => true,
    avantDit: "« TaskCreate » manquait à la liste autorisée : liste impossible sous Claude",
    apres: () => ['TaskCreate', 'TaskUpdate'].every((t) => ORCHESTRATOR_ALLOWED_NATIVE.includes(t)),
  },
];

console.log('\nAVANT / APRÈS\n');
for (const c of CONTROLES) {
  const ok = c.apres();
  if (!ok) fautes++;
  const avant = source ? (c.avant(source) ? c.avantDit : 'déjà en place') : 'non relevé';
  console.log(`  ${ok ? '✓' : '✗'} ${c.quoi}`);
  console.log(`      avant : ${avant}`);
  console.log(`      après : ${ok ? 'imposé par HaikoDev, identique aux deux moteurs' : 'MANQUANT'}`);
}

console.log('');
if (fautes) {
  console.error(`${fautes} écart(s) : le déroulé n'est pas encore unique.\n`);
  process.exit(1);
}
console.log('Déroulé unique : les deux moteurs ne font plus qu’exécuter.\n');
