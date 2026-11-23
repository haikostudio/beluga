#!/usr/bin/env node
/**
 * AUCUN PROJET NE S'ENDORT PLUS, ET RIEN NE PEUT LE RENDORMIR.
 *
 * La mise en veille des projets a été retirée le 07/09/2026 : elle arrêtait les
 * serveurs `autoproject-*` inactifs pour gagner quelques centaines de
 * mégaoctets, alors qu'un serveur de développement met jusqu'à DEUX MINUTES à
 * répondre après son démarrage — le visiteur tombait sur une page blanche ou un
 * 502 pendant tout ce temps.
 *
 * Ce contrôle a deux moitiés :
 *   — le DÉPÔT : aucun des cinq scripts, aucune unité systemd, et plus aucune
 *     mention de `beluga-veille` ailleurs que dans les règles qui RACONTENT le
 *     retrait. Cette moitié tourne partout, y compris hors du serveur.
 *   — la MACHINE : les trois unités inconnues de systemd, les deux dossiers
 *     absents, la relève des projets en place, et chaque service de projet
 *     activé DEBOUT, avec son redémarrage automatique et son plafond de
 *     mémoire. Cette moitié est SAUTÉE, en le disant, quand `systemctl` n'est
 *     pas là ou qu'aucun projet n'est déclaré.
 *
 * Lecture seule : aucun service n'est touché, rien n'est installé.
 *
 *   node scripts/verif-projets-toujours-debout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let ok = 0;
let ko = 0;
let sautes = 0;

function verifier(titre, condition, detail = '') {
  if (condition) {
    ok += 1;
    console.log(`  OK   ${titre}${detail ? ` — ${detail}` : ''}`);
  } else {
    ko += 1;
    console.log(` ÉCHEC ${titre}${detail ? ` — ${detail}` : ''}`);
  }
}

function sauter(titre, pourquoi) {
  sautes += 1;
  console.log(`  —    ${titre} — sauté : ${pourquoi}`);
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return typeof e?.stdout === 'string' ? e.stdout.trim() : '';
  }
}

console.log('\nAucun projet ne s’endort plus, et rien ne peut le rendormir\n');

// ---------------------------------------------------------------------------
// 1. LE DÉPÔT : le mécanisme n'y est plus.
// ---------------------------------------------------------------------------
console.log('Le dépôt');

const DISPARUS = [
  'scripts/veille-des-projets.mjs',
  'scripts/veilleur-de-projets.mjs',
  'scripts/veille-regles.mjs',
  'scripts/installer-veille-des-projets.sh',
  'scripts/verif-veille-services-essentiels.mjs',
  'scripts/systemd',
];
for (const relatif of DISPARUS) {
  verifier(`« ${relatif} » a disparu du dépôt`, !fs.existsSync(path.join(RACINE, relatif)));
}

// Plus aucune mention du mécanisme dans le code ni les scripts. Les règles ont
// le droit d'en parler : elles racontent justement pourquoi il a été retiré.
const MOTS = ['beluga-veille', 'beluga-veilleur', 'veille-des-projets', 'veilleur-de-projets', 'veille-regles'];
const IGNORES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', 'coverage', '.cache', '.worktrees', 'data']);
const RACONTENT_LE_RETRAIT = new Set([
  'docs/regles/methode.md',
  'docs/regles/publication.md',
  'docs/verifications.md',
  'HISTORIQUE.md',
  'PLAN.md',
  'scripts/releve-des-projets.sh',
  'scripts/verif-projets-toujours-debout.mjs',
]);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.json', '.md', '.service', '.timer']);

const restes = [];
(function parcourir(dossier) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name.startsWith('.') && entree.name !== '.github') continue;
    if (IGNORES.has(entree.name)) continue;
    const complet = path.join(dossier, entree.name);
    const relatif = path.relative(RACINE, complet);
    if (entree.isDirectory()) {
      parcourir(complet);
      continue;
    }
    if (!entree.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entree.name))) continue;
    if (RACONTENT_LE_RETRAIT.has(relatif)) continue;
    if (relatif.startsWith('docs/instructions-en-attente')) continue;
    if (relatif.startsWith('docs/audit-')) continue;
    let texte;
    try {
      texte = fs.readFileSync(complet, 'utf8');
    } catch {
      continue;
    }
    if (MOTS.some((mot) => texte.includes(mot))) restes.push(relatif);
  }
})(RACINE);

verifier(
  'plus aucune mention du mécanisme hors des règles qui racontent son retrait',
  restes.length === 0,
  restes.length ? restes.slice(0, 5).join(', ') : 'aucun reste',
);

// La relève, elle, doit être là : c'est ce qui remplace la veille.
for (const relatif of [
  'scripts/releve-des-projets.sh',
  'scripts/beluga-releve-projets.service',
  'scripts/beluga-releve-projets.timer',
]) {
  verifier(`« ${relatif} » est bien dans le dépôt`, fs.existsSync(path.join(RACINE, relatif)));
}

const releve = fs.existsSync(path.join(RACINE, 'scripts/releve-des-projets.sh'))
  ? fs.readFileSync(path.join(RACINE, 'scripts/releve-des-projets.sh'), 'utf8')
  : '';
verifier('la relève ne RELÈVE que les services activés', releve.includes('--state=enabled'));
verifier('la relève remet à zéro le compteur d’échecs de systemd', releve.includes('reset-failed'));
verifier(
  'la relève n’ARRÊTE jamais rien',
  !/systemctl\s+(stop|disable|kill)\b/.test(releve),
);

// ---------------------------------------------------------------------------
// 2. LA MACHINE : rien n'endort, et tout est debout.
// ---------------------------------------------------------------------------
console.log('\nLa machine');

const systemctl = sh('sh', ['-c', 'command -v systemctl']);
if (!systemctl) {
  sauter('l’état réel des services', 'systemctl est introuvable (hors serveur)');
} else {
  for (const unite of ['beluga-veille.timer', 'beluga-veille.service', 'beluga-veilleur.service']) {
    const etat = sh('systemctl', ['is-enabled', unite]) || 'not-found';
    verifier(`systemd ne connaît plus « ${unite} »`, etat === 'not-found', etat);
  }
  for (const dossier of ['/usr/local/lib/beluga-veille', '/var/lib/beluga-veille']) {
    verifier(`« ${dossier} » n’existe plus`, !fs.existsSync(dossier));
  }

  const releveActive = sh('systemctl', ['is-active', 'beluga-releve-projets.timer']);
  verifier('la relève des projets tourne', releveActive === 'active', releveActive || 'inconnue');

  const declares = sh('systemctl', [
    'list-unit-files',
    'autoproject-*.service',
    '--state=enabled',
    '--no-legend',
    '--no-pager',
  ])
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean);

  if (declares.length === 0) {
    sauter('l’état de chaque projet', 'aucun service « autoproject-* » activé sur cette machine');
  } else {
    for (const unite of declares) {
      const type = sh('systemctl', ['show', unite, '-p', 'Type', '--value']);
      // Une pile docker-compose montée une fois n'a ni redémarrage ni plafond :
      // systemd la tient par RemainAfterExit.
      if (type === 'oneshot') {
        sauter(`« ${unite} »`, 'pile montée une fois (oneshot)');
        continue;
      }
      const actif = sh('systemctl', ['is-active', unite]);
      const restart = sh('systemctl', ['show', unite, '-p', 'Restart', '--value']);
      const max = sh('systemctl', ['show', unite, '-p', 'MemoryMax', '--value']);
      const nom = unite.replace(/^autoproject-|\.service$/g, '');
      verifier(`« ${nom} » est debout`, actif === 'active', actif || 'inconnu');
      verifier(`« ${nom} » redémarre tout seul s’il tombe`, restart === 'always', `Restart=${restart || '—'}`);
      verifier(
        `« ${nom} » porte un plafond de mémoire`,
        max !== '' && max !== 'infinity',
        `MemoryMax=${max === 'infinity' || max === '' ? 'aucun' : `${Math.round(Number(max) / 1048576)} Mo`}`,
      );
    }
  }

  // L'échange ne doit pas être devenu le mode de fonctionnement normal.
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const lireKo = (cle) => Number(new RegExp(`^${cle}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0);
    const total = lireKo('SwapTotal');
    const libre = lireKo('SwapFree');
    const utiliseMo = Math.round((total - libre) / 1024);
    const part = total ? (total - libre) / total : 0;
    verifier(
      'l’échange n’est pas saturé',
      part < 0.9,
      `${utiliseMo} Mo utilisés sur ${Math.round(total / 1024)} Mo (${Math.round(part * 100)} %)`,
    );
  } catch {
    sauter('l’état de l’échange', '/proc/meminfo illisible');
  }
}

console.log(`\n${ok} contrôle(s) au vert, ${ko} en échec, ${sautes} sauté(s).\n`);
process.exit(ko === 0 ? 0 : 1);
