#!/usr/bin/env node
/**
 * UN DOSSIER DE TRAVAIL CASSÉ SE RÉPARE-T-IL VRAIMENT TOUT SEUL ?
 *
 * Constat qui a produit ce contrôle : sur le projet Rezideo, l'ouverture du
 * dossier de travail d'une carte tombait sur un dépôt abîmé. La carte restait
 * bloquée sur le message brut de git, et il fallait qu'un humain le repère à
 * l'écran puis demande la réparation à la main.
 *
 * On fabrique donc un dépôt jetable AVEC son dépôt distant, on le casse de
 * quatre façons connues, et on demande à chaque fois l'ouverture du dossier de
 * la carte comme le fait le démon :
 *
 *   1. un reste de tour précédent occupe le dossier de la carte ;
 *   2. le dossier occupé porte du travail non enregistré → il est SAUVÉ avant
 *      d'être retiré, jamais perdu ;
 *   3. la branche de la carte est retenue par une copie fantôme VERROUILLÉE,
 *      que le rangement ordinaire n'ôte pas ;
 *   4. un objet du dépôt est vide (corruption) → il est redemandé au dépôt
 *      distant ;
 *   5. une panne INCONNUE n'est pas bricolée : le refus est dit en toutes
 *      lettres.
 *
 * Rien n'est touché dans un vrai dépôt : tout se passe dans des dossiers
 * temporaires, effacés en partant. Aucun moteur n'est appelé.
 *
 *   npm run build:server && node scripts/verif-reparation-dossier-de-carte.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ouvrirDossierDeCarte } = await import(path.join(racineDuDepot, 'server/dist/dossier-de-carte.js'));
const { cheminDossierDeCarte, nomDeBranche } = await import(path.join(racineDuDepot, 'shared/dist/index.js'));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const g = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

/** Un dépôt de travail neuf, avec son dépôt distant : origine, base, poussée. */
function depotNeuf(nom) {
  const origine = fs.mkdtempSync(path.join(os.tmpdir(), `${nom}-origine-`));
  execFileSync('git', ['init', '--bare', '-b', 'main', origine]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${nom}-`));
  g(dir, 'init', '-b', 'main');
  g(dir, 'config', 'user.email', 'essai@haikodev.local');
  g(dir, 'config', 'user.name', 'Essai');
  g(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'depart.txt'), 'base\n');
  g(dir, 'add', 'depart.txt');
  g(dir, 'commit', '-m', 'Base');
  g(dir, 'remote', 'add', 'origin', origine);
  g(dir, 'push', '-u', 'origin', 'main');
  return { dir, origine };
}

const aNettoyer = [];
function depot(nom) {
  const d = depotNeuf(nom);
  aNettoyer.push(d.dir, d.origine);
  return d;
}

const carte = { id: 'aaaaaa11', title: 'Réparer le dossier de travail' };
const brancheAttendue = nomDeBranche(carte.title, carte.id);

try {
  /* ---------------------------------------------------------------- */
  /* 1. Un reste de tour précédent occupe le dossier                    */
  /* ---------------------------------------------------------------- */
  {
    const { dir } = depot('verif-reparation-reste');
    const attendu = cheminDossierDeCarte(dir, carte.title, carte.id);
    fs.mkdirSync(attendu, { recursive: true });
    fs.writeFileSync(path.join(attendu, 'reste.txt'), 'vieux fichier\n');

    const ouvert = await ouvrirDossierDeCarte(dir, carte);
    noter(
      'un dossier encombré est vidé et la carte part quand même',
      ouvert.kind === 'pret' && ouvert.dossier === attendu,
      ouvert.kind === 'echec' ? ouvert.raison : ouvert.dossier,
    );
    noter(
      'le dossier rendu est bien posé sur la branche de la carte',
      ouvert.kind === 'pret' && g(attendu, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === brancheAttendue,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Le dossier occupé porte du travail : il est SAUVÉ               */
  /* ---------------------------------------------------------------- */
  {
    const { dir } = depot('verif-reparation-travail');
    const attendu = cheminDossierDeCarte(dir, carte.title, carte.id);
    // Une copie posée sur une AUTRE branche, avec du travail non enregistré.
    g(dir, 'worktree', 'add', '-b', 'autre-chantier', attendu, 'main');
    g(attendu, 'config', 'user.email', 'essai@haikodev.local');
    g(attendu, 'config', 'user.name', 'Essai');
    fs.writeFileSync(path.join(attendu, 'travail.txt'), 'du vrai travail\n');

    const ouvert = await ouvrirDossierDeCarte(dir, carte);
    noter(
      "la carte s'ouvre malgré une copie posée sur une autre branche",
      ouvert.kind === 'pret',
      ouvert.kind === 'echec' ? ouvert.raison : '',
    );
    const sauve = g(dir, 'log', '--name-only', '--format=%s', 'autre-chantier');
    noter(
      "le travail non enregistré a été SAUVÉ sur sa branche, pas jeté",
      sauve.includes('travail.txt'),
      sauve.split('\n').slice(0, 3).join(' / '),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3. Une copie fantôme VERROUILLÉE retient la branche                */
  /* ---------------------------------------------------------------- */
  {
    const { dir } = depot('verif-reparation-fantome');
    const ailleurs = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reparation-ailleurs-'));
    aNettoyer.push(ailleurs);
    const copie = path.join(ailleurs, 'copie');
    g(dir, 'worktree', 'add', '-b', brancheAttendue, copie, 'main');
    g(dir, 'worktree', 'lock', copie);
    fs.rmSync(copie, { recursive: true, force: true });

    const ouvert = await ouvrirDossierDeCarte(dir, carte);
    noter(
      'une copie fantôme verrouillée ne retient plus la branche de la carte',
      ouvert.kind === 'pret' && ouvert.dossier === cheminDossierDeCarte(dir, carte.title, carte.id),
      ouvert.kind === 'echec' ? ouvert.raison : '',
    );
  }

  /* ---------------------------------------------------------------- */
  /* 4. Un objet du dépôt est vide : il est redemandé au distant        */
  /* ---------------------------------------------------------------- */
  {
    const { dir } = depot('verif-reparation-objet');
    const arbre = g(dir, 'rev-parse', 'HEAD^{tree}').trim();
    const chemin = path.join(dir, '.git', 'objects', arbre.slice(0, 2), arbre.slice(2));
    noter("l'objet à casser est bien un fichier libre du dépôt", fs.existsSync(chemin), chemin);
    fs.chmodSync(chemin, 0o644); // un objet libre est écrit en lecture seule
    fs.writeFileSync(chemin, '');

    const ouvert = await ouvrirDossierDeCarte(dir, carte);
    noter(
      'un objet vide est retrouvé auprès du dépôt distant et la carte part',
      ouvert.kind === 'pret',
      ouvert.kind === 'echec' ? ouvert.raison : '',
    );
    if (ouvert.kind === 'pret') {
      noter(
        'le dossier rendu contient bien les fichiers du projet',
        fs.existsSync(path.join(ouvert.dossier, 'depart.txt')),
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* 5. Une panne inconnue n'est pas bricolée                           */
  /* ---------------------------------------------------------------- */
  {
    const { dir } = depot('verif-reparation-inconnue');
    const attendu = cheminDossierDeCarte(dir, carte.title, carte.id);
    // Le rangement des cartes est un FICHIER : git ne peut rien y créer, et
    // aucune de nos pannes connues ne parle de ce cas.
    fs.mkdirSync(path.dirname(attendu), { recursive: true });
    fs.writeFileSync(attendu, 'ceci est un fichier, pas un dossier\n');
    fs.chmodSync(path.dirname(attendu), 0o500);

    const ouvert = await ouvrirDossierDeCarte(dir, carte);
    fs.chmodSync(path.dirname(attendu), 0o700);
    noter(
      "une panne qu'on ne sait pas réparer est DITE, jamais bricolée en silence",
      ouvert.kind === 'echec' && /git worktree/.test(ouvert.raison),
      ouvert.kind === 'echec' ? ouvert.raison.slice(0, 160) : 'ouverture réussie',
    );
  }
} finally {
  for (const d of aNettoyer) fs.rmSync(d, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
process.exit(echecs.length ? 1 : 0);
