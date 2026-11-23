#!/usr/bin/env node
/*
 * LE SERVICE PEUT-IL ENCORE OUVRIR UNE COPIE DE TRAVAIL DANS CHAQUE PROJET ?
 *
 * Constat du 22 septembre 2026 : 19 projets sur 24 refusaient de lancer la
 * moindre carte. Leurs dossiers appartenaient à un uid ORPHELIN (539936) —
 * aucun compte ne le portait —, reste de l'aller-retour des dépôts vers la
 * Storage Box, qui avait conservé les uid distants. Rien ne le signalait : la
 * panne se découvrait carte par carte, sur un message brut de git.
 *
 * ON NE SUPPOSE PAS, ON REJOUE. Le contrôle refait, sur chaque projet, les
 * TROIS écritures exactes qu'un lancement demande :
 *
 *   1. créer un dossier sous `<projet>/.worktrees/` — le logement de la copie ;
 *   2. écrire une référence sous `<projet>/.git/refs/heads/tache/` — la
 *      branche de la carte ;
 *   3. écrire un fichier à la racine de `<projet>/.git/` — le verrou et les
 *      fichiers de service que git y pose.
 *
 * CHAQUE TÉMOIN EST RETIRÉ, y compris quand le contrôle échoue (`finally`) :
 * ce contrôle tourne tous les jours sur tous les dépôts, il n'a pas le droit
 * de les salir. Il ne referme JAMAIS un dossier de carte (`MEM-2738` : le
 * geste de fermeture SUPPRIME la copie de travail d'un agent au travail).
 *
 * Sortie : la liste des projets qui bloquent, et un code de sortie non nul dès
 * qu'il y en a un.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cheminDeLaBaseServie, depotPrincipal } from './base-servie.mjs';

const require = createRequire(path.join(depotPrincipal(), 'package.json'));
const Database = require('better-sqlite3');

/** Un nom de témoin qui ne peut se confondre avec rien du dépôt. */
const TEMOIN = `verif-droits-${process.pid}-${Date.now()}`;

/** Le compte qui fait tourner ce contrôle — le même que le service, en principe. */
const moi = os.userInfo();

function retirer(chemin) {
  try {
    fs.rmSync(chemin, { recursive: true, force: true });
  } catch {
    /* un témoin qu'on n'arrive pas à retirer est déjà un projet en panne */
  }
}

/**
 * Le projet accepte-t-il les trois écritures d'un lancement ? Rend `null` quand
 * tout passe, sinon la phrase qui dit CE QUI a bloqué — celle qu'un humain lit.
 */
function pourquoiCeProjetBloque(racine) {
  if (!fs.existsSync(racine)) return 'dossier absent du disque';
  if (!fs.existsSync(path.join(racine, '.git'))) return 'pas un dépôt git';

  const essais = [
    { quoi: 'le logement des copies de travail (.worktrees/)', chemin: path.join(racine, '.worktrees', TEMOIN), dossier: true },
    {
      quoi: 'la branche de la carte (.git/refs/heads/tache/)',
      chemin: path.join(racine, '.git', 'refs', 'heads', 'tache', TEMOIN),
      dossier: false,
    },
    { quoi: 'les fichiers de service de git (.git/)', chemin: path.join(racine, '.git', TEMOIN), dossier: false },
  ];

  for (const essai of essais) {
    try {
      fs.mkdirSync(path.dirname(essai.chemin), { recursive: true });
      if (essai.dossier) fs.mkdirSync(essai.chemin, { recursive: true });
      else fs.writeFileSync(essai.chemin, 'temoin\n');
    } catch (err) {
      return `${essai.quoi} — ${err?.code ?? ''} ${err?.message ?? err}`.trim();
    } finally {
      retirer(essai.chemin);
    }
  }
  return null;
}

/** À qui appartient ce dossier, et est-ce un compte qui existe encore ? */
function proprietaire(racine) {
  try {
    const uid = fs.statSync(racine).uid;
    if (uid === moi.uid) return null;
    return `appartient à l'uid ${uid}, pas à ${moi.username} (${moi.uid})`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */

const base = cheminDeLaBaseServie();
if (!fs.existsSync(base)) {
  console.error(`Base introuvable : ${base}`);
  process.exit(1);
}
const db = new Database(base, { readonly: true, fileMustExist: true });
const projets = db.prepare('SELECT id, name, path FROM projects WHERE archived = 0 ORDER BY name').all();
db.close();

console.log(`Base lue : ${base}`);
console.log(`Compte du contrôle : ${moi.username} (uid ${moi.uid}, gid ${moi.gid})`);
console.log(`${projets.length} projet(s) actif(s) à vérifier.\n`);

const bloques = [];
const suspects = [];
for (const projet of projets) {
  const raison = pourquoiCeProjetBloque(projet.path);
  if (raison) {
    bloques.push({ ...projet, raison });
    console.log(`  ✗ ${projet.name} (${projet.path}) : ${raison}`);
    continue;
  }
  const etrange = proprietaire(projet.path);
  if (etrange) {
    suspects.push({ ...projet, etrange });
    console.log(`  ~ ${projet.name} (${projet.path}) : écrit, mais ${etrange}`);
    continue;
  }
  console.log(`  ✓ ${projet.name}`);
}

console.log(`\n${projets.length - bloques.length}/${projets.length} projet(s) peuvent ouvrir une copie de travail.`);
if (suspects.length) {
  console.log(`${suspects.length} projet(s) écrivent malgré un propriétaire inattendu — à surveiller.`);
}
if (bloques.length) {
  console.log(`\nAUCUNE CARTE NE PARTIRA sur ${bloques.length} projet(s) :`);
  for (const projet of bloques) console.log(`  - ${projet.name} → ${projet.path}`);
  console.log(
    '\nLe lancement d’une carte sait maintenant se réparer seul (panne « droits-insuffisants »,\n' +
      '`shared/src/reparation-worktree.ts`). Un projet qui reste listé ici a donc une cause AUTRE\n' +
      'que la propriété des fichiers : montage en lecture seule, dossier absent, dépôt cassé.',
  );
}
process.exit(bloques.length ? 1 : 0);
