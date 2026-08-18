#!/usr/bin/env node
/**
 * Les CINQ POINTS qu'une bascule de compte système laisse derrière elle.
 *
 * `scripts/renommer-compte-en-haiko.mjs` les reprend désormais tout seul ; ce
 * contrôle-ci prouve qu'ils sont propres SUR LA MACHINE. Aucun ne se voit dans
 * `git grep` — ce sont des fichiers hors du dépôt, des liens symboliques et des
 * réglages système —, d'où un script dédié.
 *
 * Il ne LIT que, n'écrit rien, ne dépense aucun jeton et ne pousse rien.
 *
 *   node scripts/verif-cinq-points-du-renommage.mjs
 *
 * Sort en 0 si tout est propre, en 1 sinon, en nommant ce qui reste.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ANCIEN = process.env.ANCIEN_COMPTE ?? 'paseo';
const NOUVEAU = process.env.NOUVEAU_COMPTE ?? 'haiko';
const ANCIEN_HOME = `/home/${ANCIEN}`;
const HOME = process.env.MAISON_DU_COMPTE ?? `/home/${NOUVEAU}`;
const DONNEES = process.env.HAIKODEV_DATA ?? '/root/haikodev/data';

const echecs = [];
const dit = (...a) => console.log(...a);
const juge = (nom, ok, detail) => {
  dit(`${ok ? '  ✓' : '  ✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(nom);
};

dit(`\n=== Les cinq points du renommage « ${ANCIEN} » → « ${NOUVEAU} »`);

// 1. La configuration SSH : un IdentityFile périmé fait échouer TOUT git push.
{
  const f = path.join(HOME, '.ssh/config');
  const texte = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  juge(
    'la configuration SSH ne nomme plus l’ancien dossier',
    !texte.includes(ANCIEN_HOME),
    fs.existsSync(f) ? f : 'aucun fichier de configuration SSH',
  );
  const cles = [...texte.matchAll(/^\s*IdentityFile\s+(\S+)/gm)].map((m) => m[1].replace(/^~/, HOME));
  const manquantes = cles.filter((c) => !fs.existsSync(c));
  juge('chaque clé SSH déclarée existe', manquantes.length === 0, manquantes.join(', ') || `${cles.length} clé(s)`);
}

// 2. Les fiches d'identité des comptes moteurs, SUR LE DISQUE.
{
  const dossier = path.join(DONNEES, 'accounts');
  const fautives = [];
  for (const e of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) {
    const meta = path.join(dossier, e, 'meta.json');
    if (!fs.existsSync(meta)) continue;
    const fiche = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (!fiche.configDir) continue;
    if (fiche.configDir.startsWith(ANCIEN_HOME) || !fs.existsSync(fiche.configDir)) fautives.push(e);
  }
  juge('les fiches des comptes moteurs pointent un dossier qui existe', fautives.length === 0, fautives.join(', ') || 'toutes bonnes');
}

// 3. Les compétences partagées : des LIENS que `usermod` ne suit pas.
{
  const dossier = path.join(DONNEES, 'competences');
  const morts = [];
  let liens = 0;
  for (const e of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) {
    const l = path.join(dossier, e);
    if (!fs.lstatSync(l).isSymbolicLink()) continue;
    liens += 1;
    if (!fs.existsSync(l)) morts.push(e);
  }
  juge('aucune compétence partagée en lien mort', morts.length === 0, morts.join(', ') || `${liens} lien(s) vivant(s)`);
}

// 4. Les plages d'identifiants subordonnés (le bac à sable du chef).
{
  const restants = [];
  const absents = [];
  for (const f of ['/etc/subuid', '/etc/subgid']) {
    const texte = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (new RegExp(`^${ANCIEN}:`, 'm').test(texte)) restants.push(f);
    if (!new RegExp(`^${NOUVEAU}:`, 'm').test(texte)) absents.push(f);
  }
  juge('les plages d’identifiants subordonnés sont au nouveau nom', restants.length === 0 && absents.length === 0,
    [...restants.map((f) => `${f} nomme encore ${ANCIEN}`), ...absents.map((f) => `${f} ne nomme pas ${NOUVEAU}`)].join(' ; ') || '/etc/subuid, /etc/subgid');
}

// 5. Cosmétique : ce qu'un audit lit en premier.
{
  const lignes = [];
  for (const f of fs.readdirSync('/etc/systemd/system').filter((e) => e.endsWith('.service') || e.endsWith('.timer'))) {
    const chemin = path.join('/etc/systemd/system', f);
    let texte;
    try {
      texte = fs.readFileSync(chemin, 'utf8');
    } catch {
      continue;
    }
    for (const l of texte.split('\n')) {
      if (/^(Description=|User=|Group=)/.test(l) && new RegExp(`\\b${ANCIEN}\\b`).test(l)) lignes.push(`${f}: ${l}`);
    }
  }
  juge('aucune unit systemd ne nomme l’ancien compte', lignes.length === 0, lignes.join(' | ') || 'units propres');
}

// Le point de départ de tout : un envoi vers le dépôt part-il ? Essai à BLANC —
// pousser pour de bon serait publier, et publier est un geste de l'utilisateur.
{
  let sortie;
  try {
    execFileSync('git', ['push', '--dry-run', 'origin', 'HEAD:main'], {
      cwd: '/root/haikodev',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    sortie = null;
  } catch (e) {
    sortie = String(e.stderr ?? e.message).trim().split('\n').slice(-2).join(' ');
  }
  juge('l’envoi vers le dépôt part (essai à blanc)', sortie === null, sortie ?? 'authentification SSH acceptée');
}

dit(echecs.length ? `\n${echecs.length} point(s) à reprendre.` : '\nLes cinq points sont propres.');
process.exit(echecs.length ? 1 : 0);
