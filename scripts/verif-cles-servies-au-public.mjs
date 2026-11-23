#!/usr/bin/env node
/*
 * AUCUNE CLÉ D'API NE DOIT SE TÉLÉCHARGER DEPUIS UN SITE PUBLIÉ.
 *
 * Contrôle STATIQUE, sans navigateur, sans base, sans moteur : il ne lit que des fichiers déjà
 * servis. Il ne regarde PAS où les clés sont rangées dans les dépôts — c'est un choix assumé et ce
 * n'est pas son sujet. Il ne juge qu'une chose : ce qu'un visiteur anonyme peut TÉLÉCHARGER.
 *
 * POURQUOI. Le 30/08/2026, 7,66 USD de crédit OpenRouter sont partis en une heure sur des modèles
 * qu'aucun agent de ce serveur n'utilise (Kimi K3, GPT-5.6-sol). Aucun tour d'agent n'était en
 * cause : la table `usage` ne montre que Claude ce jour-là. La clé venait d'un fichier JavaScript
 * d'un site publié, donc lisible par n'importe qui — une clé bâtie pour le navigateur (préfixe
 * `VITE_`) part dans le paquet livré, et les robots qui moissonnent les paquets JS publics la
 * trouvent en quelques heures.
 *
 * CE QU'IL FAIT. Il parcourt les dossiers RÉELLEMENT SERVIS et cherche les formes de clés connues.
 * Une seule trouvaille suffit à faire échouer le contrôle : la clé est déjà dehors.
 *
 *   node scripts/verif-cles-servies-au-public.mjs
 *   RACINES_PUBLIEES=/var/www,/srv/www node scripts/verif-cles-servies-au-public.mjs
 *
 * Sortie 0 = rien de servi ne porte de clé, 1 = au moins une clé est publique (fichier et forme
 * affichés, jamais la clé entière).
 *
 * Le contrôle vise le dépôt d'où il PART (`import.meta.url`), jamais un chemin en dur : lancé
 * depuis une copie de travail, il juge cette copie et non le dossier principal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Les dossiers servis au public. `data/live` est celui de Beluga Build (écrit uniquement par la
 * publication) ; `/var/www` porte les sites des autres projets du serveur. La variable
 * `RACINES_PUBLIEES` remplace la liste entière, pour viser un seul site.
 */
const RACINES = (process.env.RACINES_PUBLIEES ?? `${path.join(RACINE, 'data/live')},/var/www`)
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

/**
 * Les FORMES de clés, jamais des clés en dur : un motif reconnaît une famille entière, et ce
 * fichier n'a donc aucun secret à garder. La longueur minimale évite de prendre un exemple de
 * documentation (« sk-or-v1-... ») pour une vraie clé.
 */
const FORMES = [
  { nom: 'OpenRouter', motif: /sk-or-v1-[A-Za-z0-9]{32,}/g },
  { nom: 'Anthropic', motif: /sk-ant-[A-Za-z0-9_-]{32,}/g },
  { nom: 'OpenAI', motif: /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/g },
  { nom: 'Cursor', motif: /crsr_[A-Za-z0-9]{32,}/g },
  { nom: 'GitHub', motif: /gh[posu]_[A-Za-z0-9]{32,}/g },
  { nom: 'Groq', motif: /gsk_[A-Za-z0-9]{40,}/g },
];

/** Ce qui se lit : le texte servi. Une image ou une police n'a pas de clé à cacher. */
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.map', '.txt']);

/** Les paquets d'outils ne sont pas servis : les parcourir coûte des minutes pour rien. */
const IGNORES = new Set(['node_modules', '.git', '.cache']);

/** Une clé ne se recopie JAMAIS en entier dans un rapport : son début suffit à la reconnaître. */
function masquer(cle) {
  return `${cle.slice(0, 12)}…${cle.slice(-4)}`;
}

function* fichiers(dossier) {
  let entrees;
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return; // dossier absent ou fermé : ce n'est pas ce que le contrôle juge
  }
  for (const entree of entrees) {
    if (IGNORES.has(entree.name)) continue;
    const complet = path.join(dossier, entree.name);
    if (entree.isSymbolicLink()) continue;
    if (entree.isDirectory()) yield* fichiers(complet);
    else if (EXTENSIONS.has(path.extname(entree.name))) yield complet;
  }
}

const trouvailles = [];
let lus = 0;

for (const racine of RACINES) {
  if (!fs.existsSync(racine)) continue;
  for (const fichier of fichiers(racine)) {
    let texte;
    try {
      texte = fs.readFileSync(fichier, 'utf8');
    } catch {
      continue;
    }
    lus += 1;
    for (const { nom, motif } of FORMES) {
      for (const trouve of texte.match(motif) ?? []) {
        trouvailles.push({ fichier, nom, cle: masquer(trouve) });
      }
    }
  }
}

console.log(`${lus} fichiers servis relus dans : ${RACINES.join(', ')}`);

if (!trouvailles.length) {
  console.log('✅ Aucune clé d’API ne se télécharge depuis un site publié.');
  process.exit(0);
}

const vues = new Set();
console.error(`\n❌ ${trouvailles.length} clé(s) d’API servie(s) au public :\n`);
for (const { fichier, nom, cle } of trouvailles) {
  const repere = `${fichier}|${cle}`;
  if (vues.has(repere)) continue;
  vues.add(repere);
  console.error(`  · ${nom} ${cle} — ${fichier}`);
}
console.error(
  '\nUne clé servie au public est dépensable par n’importe qui : elle se remplace, et la nouvelle' +
    '\nreste du côté serveur. Tant qu’elle est en ligne, son crédit part sans qu’aucune tâche tourne.',
);
process.exit(1);
