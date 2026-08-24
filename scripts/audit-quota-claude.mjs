#!/usr/bin/env node
/*
 * L'AUDIT CHIFFRÉ DU QUOTA CLAUDE — QUI CONSOMME LA FENÊTRE DE CINQ HEURES ?
 *
 * Le volet des quotas dit COMBIEN il reste. Le tableau de bord dit quelles cartes
 * ont coûté cher. Aucun des deux ne répond à la question posée : POURQUOI la
 * fenêtre de cinq heures se vide si vite, et pourquoi plus vite qu'avant.
 *
 * D'où ce relevé. Il ne suppose rien : il lit les relevés RÉELS de la table
 * `usage` (jetons frais, jetons relus au cache, jetons rendus, part de fenêtre
 * attribuée par `cumulerPartsQuota`) et les recoupe avec le RÔLE de l'agent, son
 * MODÈLE, son COMPTE et le NOMBRE D'ALLERS-RETOURS de son tour (les étapes
 * enregistrées sur le message).
 *
 * LE MODÈLE DE COÛT qu'il vérifie tient en une ligne :
 *
 *     coût d'un tour ≈ taille du contexte × nombre d'allers-retours
 *
 * Un tour d'agent n'est pas UN appel au moteur : c'est une conversation d'outils,
 * et CHAQUE aller-retour relit la totalité du contexte. Le relevé mesure donc le
 * SOCLE de contexte — ce qui est relu même quand l'agent ne fait rien — et le
 * multiplie par les allers-retours constatés.
 *
 *   node scripts/audit-quota-claude.mjs                 # 7 derniers jours
 *   node scripts/audit-quota-claude.mjs --jours=14
 *   node scripts/audit-quota-claude.mjs --socle         # MESURE le socle en appelant
 *                                                       # le moteur (deux tours minuscules)
 *   node scripts/audit-quota-claude.mjs --json=/tmp/quota.json
 *
 * IL N'ÉCRIT RIEN DANS LA BASE DU DÉMON : la base est d'abord COPIÉE (`VACUUM INTO`)
 * dans un dossier jetable, et tout le relevé travaille sur la copie. Le démon peut
 * tourner pendant ce temps. Sans `--socle`, AUCUN moteur n'est appelé : le relevé
 * ne coûte pas un jeton.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valeur = (nom, defaut) => {
  const trouve = args.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : defaut;
};
const JOURS = Number(valeur('jours', 7));
const SORTIE_JSON = valeur('json', '');
const MESURER_LE_SOCLE = args.includes('--socle');
const DONNEES_REELLES = valeur('donnees', '/root/haikodev/data');

/* ------------------------------------------------------------------ */
/* La copie de la base : rien n'est écrit chez le démon                */
/* ------------------------------------------------------------------ */

const JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-quota-'));
process.on('exit', () => fs.rmSync(JETABLE, { recursive: true, force: true }));

const source = path.join(DONNEES_REELLES, 'haikodev.db');
if (!fs.existsSync(source)) {
  console.error(`Aucune base à ${source}. Passe --donnees=<dossier> si elle vit ailleurs.`);
  process.exit(1);
}
const copie = path.join(JETABLE, 'haikodev.db');
{
  const lecture = new Database(source, { readonly: true });
  lecture.exec(`VACUUM INTO '${copie.replace(/'/g, "''")}'`);
  lecture.close();
}
const db = new Database(copie, { readonly: true });

const DEPUIS = Date.now() - JOURS * 86400 * 1000;
const rapport = { jours: JOURS, depuis: new Date(DEPUIS).toISOString() };

/* ------------------------------------------------------------------ */
/* Petits utilitaires d'affichage                                      */
/* ------------------------------------------------------------------ */

const titre = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);
const nombre = (n, d = 0) => (n == null ? '—' : Number(n).toFixed(d));
const milliers = (n) => (n == null ? '—' : Math.round(n).toLocaleString('fr-CH'));

function tableau(lignes, colonnes) {
  if (!lignes.length) return console.log('  (rien sur la période)');
  const largeurs = colonnes.map((c) =>
    Math.max(c.titre.length, ...lignes.map((l) => String(c.valeur(l) ?? '').length)),
  );
  const ligne = (cells) =>
    '  ' + cells.map((c, i) => (i === 0 ? String(c).padEnd(largeurs[i]) : String(c).padStart(largeurs[i]))).join('  ');
  console.log(ligne(colonnes.map((c) => c.titre)));
  console.log('  ' + largeurs.map((l) => '─'.repeat(l)).join('  '));
  for (const l of lignes) console.log(ligne(colonnes.map((c) => c.valeur(l) ?? '—')));
}

/* ------------------------------------------------------------------ */
/* 1. Qui consomme : la part de fenêtre par RÔLE                       */
/* ------------------------------------------------------------------ */

/*
 * `quota_5h` est en POINTS DE POURCENTAGE de la fenêtre de cinq heures, attribués
 * au tour par `cumulerPartsQuota` — la seule grandeur qui dise vraiment « ce que
 * ça a coûté au compte ». Les jetons servent à EXPLIQUER, jamais à classer.
 */
const parRole = db
  .prepare(
    `SELECT COALESCE(a.role,'(agent effacé)') role,
            COUNT(*) tours,
            SUM(u.quota_5h) pct5h,
            AVG(u.quota_5h) pct5h_moy,
            AVG(u.cached_tokens) cache_moy,
            AVG(u.input_tokens) frais_moy,
            AVG(u.output_tokens) sortie_moy
       FROM usage u LEFT JOIN agents a ON a.id = u.agent_id
      WHERE u.engine = 'claude' AND u.created_at > ?
      GROUP BY role ORDER BY pct5h DESC`,
  )
  .all(DEPUIS);
const totalPct = parRole.reduce((s, r) => s + (r.pct5h ?? 0), 0);

titre(`1. QUI CONSOMME — part de la fenêtre de 5 h, ${JOURS} derniers jours`);
console.log(`  Total attribué : ${nombre(totalPct, 1)} points de fenêtre (100 = une fenêtre entière)`);
tableau(
  parRole.map((r) => ({ ...r, part: (100 * (r.pct5h ?? 0)) / (totalPct || 1) })),
  [
    { titre: 'rôle', valeur: (l) => l.role },
    { titre: 'tours', valeur: (l) => l.tours },
    { titre: 'points 5h', valeur: (l) => nombre(l.pct5h, 1) },
    { titre: 'part', valeur: (l) => nombre(l.part, 1) + ' %' },
    { titre: 'pts/tour', valeur: (l) => nombre(l.pct5h_moy, 2) },
    { titre: 'k relus/tour', valeur: (l) => milliers((l.cache_moy ?? 0) / 1000) },
    { titre: 'k frais/tour', valeur: (l) => milliers((l.frais_moy ?? 0) / 1000) },
  ],
);
rapport.parRole = parRole;

/* ------------------------------------------------------------------ */
/* 1 bis. LES CARTES LES PLUS GOURMANDES                               */
/* ------------------------------------------------------------------ */

/*
 * « Qui consomme » par rôle ne dit pas QUELLE carte a coûté cher. Ici, une ligne
 * par carte, avec le compte et le modèle qui ont servi : c'est ce croisement qui
 * explique un pic — presque toujours un gros modèle sur un petit compte. Les
 * tours SANS carte (chef d'orchestre, publication d'un projet) sont regroupés
 * sous « (sans carte) » plutôt que jetés : ils font partie du total.
 */
const parCarte = db
  .prepare(
    `SELECT COALESCE(ca.title,'(sans carte)') titre,
            CASE WHEN u.card_id IS NULL THEN '(tous projets)' ELSE COALESCE(u.project_name,'?') END projet,
            COUNT(*) tours,
            SUM(u.quota_5h) pct5h,
            SUM(u.cached_tokens) cache,
            GROUP_CONCAT(DISTINCT u.account) comptes,
            GROUP_CONCAT(DISTINCT u.model) modeles
       FROM usage u LEFT JOIN cards ca ON ca.id = u.card_id
      WHERE u.engine='claude' AND u.created_at > ?
      GROUP BY u.card_id ORDER BY pct5h DESC LIMIT 15`,
  )
  .all(DEPUIS);
const court = (t, n) => (String(t ?? '').length > n ? String(t).slice(0, n - 1) + '…' : String(t ?? ''));

titre(`1 bis. LES CARTES LES PLUS GOURMANDES — ${JOURS} derniers jours`);
tableau(parCarte, [
  { titre: 'carte', valeur: (l) => court(l.titre, 44) },
  { titre: 'projet', valeur: (l) => court(l.projet, 14) },
  { titre: 'tours', valeur: (l) => l.tours },
  { titre: 'points 5h', valeur: (l) => nombre(l.pct5h, 1) },
  { titre: 'part', valeur: (l) => nombre((100 * (l.pct5h ?? 0)) / (totalPct || 1), 1) + ' %' },
  { titre: 'Mj relus', valeur: (l) => nombre((l.cache ?? 0) / 1e6, 1) },
  { titre: 'compte(s)', valeur: (l) => (l.comptes ?? '').replace(/claude-/g, '') },
  { titre: 'modèle(s)', valeur: (l) => (l.modeles ?? '').replace(/claude-/g, '') },
]);
rapport.parCarte = parCarte;

/* ------------------------------------------------------------------ */
/* 2. Sur quel COMPTE — le plan décide du prix, pas le travail         */
/* ------------------------------------------------------------------ */

/*
 * Deux comptes Claude au même travail ne coûtent PAS la même part de fenêtre :
 * une fenêtre Pro est bien plus petite qu'une fenêtre Max. Le même tour y pèse
 * donc plusieurs fois plus. C'est la colonne « pts/tour » qui le montre.
 */
const parCompte = db
  .prepare(
    `SELECT u.account compte, COUNT(*) tours, SUM(u.quota_5h) pct5h, AVG(u.quota_5h) pct5h_moy
       FROM usage u WHERE u.engine='claude' AND u.created_at > ?
      GROUP BY u.account ORDER BY pct5h DESC`,
  )
  .all(DEPUIS);
const plans = new Map(
  db
    .prepare(`SELECT id, data FROM accounts WHERE engine='claude'`)
    .all()
    .map((r) => {
      let plan;
      try {
        plan = JSON.parse(r.data).plan;
      } catch {
        plan = undefined;
      }
      return [r.id, plan ?? '?'];
    }),
);

titre('2. SUR QUEL COMPTE — le plan décide du prix');
tableau(
  parCompte.map((c) => ({
    ...c,
    plan: plans.get(c.compte) ?? '?',
    partTours: (100 * c.tours) / (parCompte.reduce((s, x) => s + x.tours, 0) || 1),
    partPct: (100 * (c.pct5h ?? 0)) / (totalPct || 1),
  })),
  [
    { titre: 'compte', valeur: (l) => l.compte },
    { titre: 'plan', valeur: (l) => l.plan },
    { titre: 'tours', valeur: (l) => l.tours },
    { titre: 'part des tours', valeur: (l) => nombre(l.partTours, 1) + ' %' },
    { titre: 'points 5h', valeur: (l) => nombre(l.pct5h, 1) },
    { titre: 'part du coût', valeur: (l) => nombre(l.partPct, 1) + ' %' },
    { titre: 'pts/tour', valeur: (l) => nombre(l.pct5h_moy, 2) },
  ],
);
rapport.parCompte = parCompte;

/* ------------------------------------------------------------------ */
/* 2 quater. LA FENÊTRE DE SEPT JOURS, PAR RÔLE ET PAR COMPTE          */
/* ------------------------------------------------------------------ */

/*
 * La SEULE unité honnête pour comparer deux comptes : chacun a sa propre
 * fenêtre de sept jours, et 100 points veut dire « la semaine entière » sur
 * l'un comme sur l'autre. Additionner des points de CINQ HEURES venus de deux
 * plans différents est trompeur ; additionner des points de SEMAINE par compte
 * ne l'est pas. C'est ce tableau qui dit si le travail TIENT dans la capacité
 * achetée, et ce que coûte au grand compte un tour envoyé sur le petit.
 */
const semaineParRole = db
  .prepare(
    `SELECT u.account compte, COALESCE(a.role,'(agent effacé)') role,
            COUNT(*) tours, SUM(u.quota_semaine) sem, AVG(u.quota_semaine) sem_moy
       FROM usage u LEFT JOIN agents a ON a.id = u.agent_id
      WHERE u.engine='claude' AND u.created_at > ?
      GROUP BY compte, role ORDER BY sem DESC`,
  )
  .all(DEPUIS);

titre(`2 quater. LA FENÊTRE DE SEPT JOURS — par compte et par rôle, ${JOURS} derniers jours`);
console.log('  100 points = la semaine entière DE CE COMPTE. Comparable d\'un compte à l\'autre.');
tableau(semaineParRole, [
  { titre: 'compte', valeur: (l) => l.compte.replace(/^claude-/, '') },
  { titre: 'rôle', valeur: (l) => l.role },
  { titre: 'tours', valeur: (l) => l.tours },
  { titre: 'points semaine', valeur: (l) => nombre(l.sem, 2) },
  { titre: 'par tour', valeur: (l) => nombre(l.sem_moy, 4) },
]);
rapport.semaineParRole = semaineParRole;

const semaineParCompte = db
  .prepare(
    `SELECT u.account compte, COUNT(*) tours, SUM(u.quota_semaine) sem
       FROM usage u WHERE u.engine='claude' AND u.created_at > ?
      GROUP BY compte ORDER BY sem DESC`,
  )
  .all(DEPUIS);
console.log('');
console.log('  Capacité hebdomadaire réellement consommée, compte par compte :');
for (const l of semaineParCompte) {
  console.log(
    `    ${l.compte.replace(/^claude-/, '').padEnd(12)} ${nombre(l.sem, 1).padStart(6)} points de sa semaine` +
      ` (${l.tours} tours, ${nombre((l.sem ?? 0) / (l.tours || 1), 3)} par tour)`,
  );
}
rapport.semaineParCompte = semaineParCompte;

/* ------------------------------------------------------------------ */
/* 2 bis. LA TRAJECTOIRE HEBDOMADAIRE — la limite qui fait basculer    */
/* ------------------------------------------------------------------ */

/*
 * La fenêtre de cinq heures se voit ; la fenêtre de SEPT JOURS, non. Or c'est
 * elle qui décide du basculement : quand la semaine du grand compte touche
 * 100 %, tout le travail part sur le petit, où le même tour pèse dix fois plus.
 * Le relevé lit donc les deux séries, jour par jour, sur les vrais échantillons.
 */
const trajectoire = db
  .prepare(
    `SELECT account compte, date(at/1000,'unixepoch') jour,
            MAX(session_pct) session_max, ROUND(AVG(session_pct)) session_moy,
            MIN(weekly_pct) semaine_debut, MAX(weekly_pct) semaine_fin,
            COUNT(*) releves
       FROM quota_samples
      WHERE account LIKE 'claude%' AND at > ?
      GROUP BY compte, jour ORDER BY jour, compte`,
  )
  .all(Date.now() - Math.max(JOURS, 10) * 86400 * 1000);

titre('2 bis. LA TRAJECTOIRE HEBDOMADAIRE — la limite qui fait basculer');
tableau(trajectoire, [
  { titre: 'jour', valeur: (l) => l.jour },
  { titre: 'compte', valeur: (l) => l.compte.replace(/^claude-/, '') },
  { titre: '5 h max', valeur: (l) => nombre(l.session_max) + ' %' },
  { titre: '5 h moy', valeur: (l) => nombre(l.session_moy) + ' %' },
  { titre: 'semaine', valeur: (l) => `${nombre(l.semaine_debut)} → ${nombre(l.semaine_fin)} %` },
  { titre: 'relevés', valeur: (l) => l.releves },
]);
rapport.trajectoire = trajectoire;

/* ------------------------------------------------------------------ */
/* 2 ter. LE RENDEMENT — ce qu'un point de fenêtre achète              */
/* ------------------------------------------------------------------ */

/*
 * Additionner des points de fenêtre Pro et des points de fenêtre Max x20 est
 * TROMPEUR : les deux fenêtres n'ont pas la même taille. Un pic de « points »
 * peut donc arriver alors que le VOLUME de travail s'écroule. La seule mesure
 * honnête est le rendement : combien de millions de jetons un point de fenêtre
 * a payé ce jour-là. Il s'effondre dès que le travail part sur le petit compte.
 */
const rendement = db
  .prepare(
    `SELECT date(u.created_at/1000,'unixepoch') jour,
            COUNT(*) tours,
            SUM(u.quota_5h) pct5h,
            SUM(u.cached_tokens) cache,
            SUM(u.input_tokens) frais,
            SUM(u.output_tokens) sortie
       FROM usage u WHERE u.engine='claude' AND u.created_at > ?
      GROUP BY jour ORDER BY jour`,
  )
  .all(Date.now() - Math.max(JOURS, 10) * 86400 * 1000);

titre('2 ter. LE RENDEMENT — ce qu\'un point de fenêtre achète');
tableau(rendement, [
  { titre: 'jour', valeur: (l) => l.jour },
  { titre: 'tours', valeur: (l) => l.tours },
  { titre: 'Mj relus', valeur: (l) => nombre((l.cache ?? 0) / 1e6, 1) },
  { titre: 'Mj frais', valeur: (l) => nombre((l.frais ?? 0) / 1e6, 2) },
  { titre: 'points 5h', valeur: (l) => nombre(l.pct5h, 1) },
  { titre: 'Mj par point', valeur: (l) => nombre((l.cache ?? 0) / 1e6 / (l.pct5h || 1), 2) },
]);
rapport.rendement = rendement;

/* ------------------------------------------------------------------ */
/* 3. Le MULTIPLICATEUR — combien d'allers-retours par tour            */
/* ------------------------------------------------------------------ */

/*
 * Le point aveugle du produit : un tour n'est pas UN appel. Chaque étape (appel
 * d'outil) est un aller-retour qui relit tout le contexte. Le nombre d'étapes
 * enregistrées sur le message donne donc le MULTIPLICATEUR du socle.
 */
const parEtapes = db
  .prepare(
    `SELECT COALESCE(a.role,'(agent effacé)') role_agent,
            COUNT(*) tours,
            AVG(json_array_length(json_extract(m.data,'$.steps'))) etapes_moy,
            MAX(json_array_length(json_extract(m.data,'$.steps'))) etapes_max
       FROM messages m JOIN agents a ON a.id = m.agent_id
      WHERE m.role='assistant' AND m.created_at > ?
      GROUP BY role_agent ORDER BY tours DESC`,
  )
  .all(DEPUIS);

titre('3. LE MULTIPLICATEUR — allers-retours par tour');
tableau(parEtapes, [
  { titre: 'rôle', valeur: (l) => l.role_agent },
  { titre: 'tours', valeur: (l) => l.tours },
  { titre: 'étapes moy.', valeur: (l) => nombre(l.etapes_moy, 1) },
  { titre: 'étapes max', valeur: (l) => l.etapes_max },
]);
rapport.parEtapes = parEtapes;

/* ------------------------------------------------------------------ */
/* 3 bis. DE QUOI SONT FAITS LES ALLERS-RETOURS                        */
/* ------------------------------------------------------------------ */

/*
 * Savoir qu'un tour de carte fait soixante allers-retours ne dit pas OÙ les
 * réduire. Chaque étape enregistrée porte un libellé ; on les regroupe par
 * FAMILLE et on pèse aussi le résultat gardé dans le contexte. C'est le seul
 * endroit du relevé qui désigne un geste concret à changer : si une famille
 * porte les deux tiers des allers-retours, c'est là que le produit
 * « contexte × allers-retours » se réduit.
 */
const familleDEtape = (libelle = '') => {
  if (/^Commande/.test(libelle)) return 'Commande (terminal)';
  if (/^(Lecture|Fichier|Lit )/.test(libelle)) return 'Lecture de fichier';
  if (/^(Écrit|Modif|Édition|Remplace)/.test(libelle)) return 'Écriture / édition';
  if (/^Mémoire du projet/.test(libelle)) return 'Mémoire du projet';
  if (/^Outil /.test(libelle)) return 'Outil ' + libelle.replace(/^Outil /, '').split(/[ (]/)[0];
  if (/^(Recherche|Cherche)/.test(libelle)) return 'Recherche';
  return (libelle.split(/[:—(]/)[0] || '(sans libellé)').trim().slice(0, 34);
};

const toursAvecEtapes = db
  .prepare(
    `SELECT m.data data FROM messages m JOIN agents a ON a.id = m.agent_id
      WHERE m.role='assistant' AND m.created_at > ? AND a.role='task'`,
  )
  .all(DEPUIS);

const familles = new Map();
let etapesTotal = 0;
for (const ligne of toursAvecEtapes) {
  let etapes;
  try {
    etapes = JSON.parse(ligne.data)?.steps;
  } catch {
    etapes = undefined;
  }
  if (!Array.isArray(etapes)) continue;
  for (const etape of etapes) {
    const famille = familleDEtape(etape?.label ?? '');
    const vu = familles.get(famille) ?? { famille, appels: 0, signes: 0 };
    vu.appels += 1;
    vu.signes += String(etape?.detail ?? '').length;
    familles.set(famille, vu);
    etapesTotal += 1;
  }
}

titre(`3 bis. DE QUOI SONT FAITS LES ALLERS-RETOURS — rôle « task », ${JOURS} derniers jours`);
tableau(
  [...familles.values()].sort((a, b) => b.appels - a.appels).slice(0, 12),
  [
    { titre: 'famille', valeur: (l) => l.famille },
    { titre: 'appels', valeur: (l) => milliers(l.appels) },
    { titre: 'part', valeur: (l) => nombre((100 * l.appels) / (etapesTotal || 1), 1) + ' %' },
    { titre: 'k signes gardés', valeur: (l) => milliers(Math.round(l.signes / 1000)) },
  ],
);
console.log(
  `  ${milliers(etapesTotal)} allers-retours sur ${toursAvecEtapes.length} tours` +
    ` — ${nombre(etapesTotal / (toursAvecEtapes.length || 1), 1)} par tour.`,
);
rapport.famillesDEtape = [...familles.values()].sort((a, b) => b.appels - a.appels);

/* ------------------------------------------------------------------ */
/* 4. Le SOCLE — ce qui est relu à CHAQUE aller-retour                 */
/* ------------------------------------------------------------------ */

/*
 * Le fichier d'instructions d'un projet (`CLAUDE.md`) est chargé par le moteur
 * lui-même, PAS par HaikoDev : il n'apparaît donc dans aucun de nos compteurs de
 * contexte envoyé. Il est pourtant relu à chaque aller-retour. On le pèse par
 * DIFFÉRENCE, avec deux tours minuscules — un dans un dossier vide, un dans le
 * dépôt — ce qui donne le poids RÉEL, tokeniseur compris.
 */
function socleMesure() {
  const coffre = process.env.CLAUDE_CONFIG_DIR;
  const mesurer = (cwd) => {
    const brut = execFileSync('claude', ['-p', 'Réponds uniquement: ok', '--output-format', 'json'], {
      cwd,
      encoding: 'utf8',
      timeout: 240000,
      env: coffre ? { ...process.env, CLAUDE_CONFIG_DIR: coffre } : process.env,
    });
    const u = JSON.parse(brut).usage ?? {};
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  };
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-vide-'));
  try {
    return { moteurSeul: mesurer(vide), avecLeDepot: mesurer(RACINE) };
  } finally {
    fs.rmSync(vide, { recursive: true, force: true });
  }
}

titre('4. LE SOCLE — ce qui est relu à chaque aller-retour');
let socle = null;
if (MESURER_LE_SOCLE) {
  try {
    const m = socleMesure();
    socle = { ...m, instructions: m.avecLeDepot - m.moteurSeul };
    console.log(`  Moteur seul, dossier vide       : ${milliers(socle.moteurSeul)} jetons`);
    console.log(`  Dans le dépôt                   : ${milliers(socle.avecLeDepot)} jetons`);
    console.log(`  → le fichier d'instructions pèse : ${milliers(socle.instructions)} jetons`);
  } catch (err) {
    console.log(`  mesure impossible : ${err?.message ?? err}`);
  }
} else {
  console.log('  (non mesuré — relancer avec --socle pour appeler le moteur deux fois)');
}
/*
 * À défaut de mesure, on donne au moins la TAILLE des fichiers d'instructions.
 * Le rapport signes/jeton constaté sur ce dépôt est d'environ 2,2 — bien loin des
 * 4 signes par jeton que suppose `mesure-jetons.mjs` sur du texte ordinaire : une
 * page dense en identifiants et en accents se tokenise deux fois plus cher.
 */
const SIGNES_PAR_JETON = 2.2;
const instructions = ['CLAUDE.md', 'AGENTS.md', 'README.md']
  .map((f) => ({ f, taille: fs.existsSync(path.join(RACINE, f)) ? fs.statSync(path.join(RACINE, f)).size : 0 }))
  .filter((x) => x.taille);
tableau(instructions, [
  { titre: 'fichier', valeur: (l) => l.f },
  { titre: 'signes', valeur: (l) => milliers(l.taille) },
  { titre: 'jetons (estimés)', valeur: (l) => milliers(l.taille / SIGNES_PAR_JETON) },
]);
rapport.socle = socle;

/*
 * LE MÊME DÉFAUT EXISTE SUR LES AUTRES PROJETS, et il n'était mesuré nulle part.
 * Rezideo porte un fichier d'instructions plus gros que celui d'HaikoDev : ses
 * agents paient donc un socle plus lourd encore à chaque aller-retour. On lit
 * la taille sur le disque — aucun moteur n'est appelé.
 */
titre("4 bis. LE SOCLE DES AUTRES PROJETS — taille du fichier d'instructions");
const projetsAvecInstructions = db
  .prepare("SELECT name, path FROM projects WHERE archived = 0 ORDER BY name")
  .all()
  .map((p) => {
    const fichier = ['CLAUDE.md', 'AGENTS.md'].find((f) => fs.existsSync(path.join(p.path, f)));
    if (!fichier) return null;
    const taille = fs.statSync(path.join(p.path, fichier)).size;
    const attente = path.join(p.path, 'docs/instructions-en-attente.md');
    return {
      projet: p.name,
      fichier,
      taille,
      gele: fs.existsSync(attente) ? 'oui' : 'non',
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.taille - a.taille);

tableau(projetsAvecInstructions, [
  { titre: 'projet', valeur: (l) => l.projet },
  { titre: 'fichier', valeur: (l) => l.fichier },
  { titre: 'signes', valeur: (l) => milliers(l.taille) },
  { titre: 'jetons (estimés)', valeur: (l) => milliers(l.taille / SIGNES_PAR_JETON) },
  { titre: 'gelé le jour', valeur: (l) => l.gele },
]);
rapport.socleDesProjets = projetsAvecInstructions;
rapport.instructions = instructions;

/* ------------------------------------------------------------------ */
/* 5. LA COMPRESSION SE DÉCLENCHE-T-ELLE ENCORE ?                      */
/* ------------------------------------------------------------------ */

/*
 * La règle veut qu'un contexte à la MOITIÉ de sa fenêtre soit compressé. Le seuil
 * étant une PART de la fenêtre annoncée par le moteur, un modèle à un million de
 * jetons repousse le déclenchement à 500 000 : la compression peut donc être en
 * place, jamais atteinte, et personne ne s'en aperçoit. On le constate ici.
 */
const contextes = db
  .prepare(
    `SELECT COALESCE(json_extract(data,'$.run.model'),'(sans modèle)') modele,
            json_extract(data,'$.context.window') fenetre,
            COUNT(*) agents,
            AVG(json_extract(data,'$.context.tokens')) ctx_moy,
            MAX(json_extract(data,'$.context.tokens')) ctx_max,
            SUM(COALESCE(json_extract(data,'$.context.compressionCount'),0)) compressions
       FROM agents
      WHERE json_extract(data,'$.context.tokens') IS NOT NULL AND updated_at > ?
      GROUP BY modele, fenetre ORDER BY agents DESC`,
  )
  .all(DEPUIS);

titre('5. LA COMPRESSION — seuil atteint, ou hors de portée ?');
tableau(
  contextes.map((c) => ({ ...c, seuil: (c.fenetre ?? 0) / 2 })),
  [
    { titre: 'modèle', valeur: (l) => l.modele },
    { titre: 'fenêtre', valeur: (l) => milliers(l.fenetre) },
    { titre: 'seuil (50 %)', valeur: (l) => milliers(l.seuil) },
    { titre: 'agents', valeur: (l) => l.agents },
    { titre: 'contexte moy.', valeur: (l) => milliers(l.ctx_moy) },
    { titre: 'contexte max', valeur: (l) => milliers(l.ctx_max) },
    { titre: 'compressions', valeur: (l) => l.compressions },
  ],
);
rapport.contextes = contextes;

/* ------------------------------------------------------------------ */
/* 5 bis. LA COMPRESSION QUI ÉCHOUE — un appel plein tarif pour rien   */
/* ------------------------------------------------------------------ */

/*
 * Compresser commence par un `/compact` NATIF : un appel au moteur qui relit
 * tout le contexte de l'agent. S'il ne rend pas la main dans son plafond, il est
 * coupé — et le repli « résumé » paie un SECOND appel. Deux appels au lieu d'un,
 * dont un pour rien. La méthode réellement retenue est donc à surveiller : si le
 * « résumé » domine, le natif est payé sans jamais servir.
 */
const methodes = new Map();
for (const ligne of db.prepare(`SELECT data FROM agents`).all()) {
  let ctx;
  try {
    ctx = JSON.parse(ligne.data)?.context;
  } catch {
    continue;
  }
  if (!ctx?.lastCompressionMethod) continue;
  if ((ctx.lastCompressionAt ?? 0) <= DEPUIS) continue;
  const vu = methodes.get(ctx.lastCompressionMethod) ?? { methode: ctx.lastCompressionMethod, agents: 0 };
  vu.agents += 1;
  methodes.set(ctx.lastCompressionMethod, vu);
}
const totalMethodes = [...methodes.values()].reduce((s, m) => s + m.agents, 0);

titre('5 bis. LA COMPRESSION QUI ÉCHOUE — méthode réellement retenue');
tableau(
  [...methodes.values()].sort((a, b) => b.agents - a.agents),
  [
    { titre: 'méthode', valeur: (l) => (l.methode === 'native' ? 'native (un seul appel)' : 'résumé (deux appels)') },
    { titre: 'agents', valeur: (l) => l.agents },
    { titre: 'part', valeur: (l) => nombre((100 * l.agents) / (totalMethodes || 1), 1) + ' %' },
  ],
);
const echecsNatifs = (() => {
  const journal = path.join(DONNEES_REELLES, 'logs', 'service.log');
  if (!fs.existsSync(journal)) return null;
  const texte = fs.readFileSync(journal, 'utf8');
  return (texte.match(/compression native impossible/g) ?? []).length;
})();
console.log(`  Refus de compression native au journal du service (tout le journal) : ${echecsNatifs ?? '—'}`);
rapport.compression = { methodes: [...methodes.values()], echecsNatifs };

/* ------------------------------------------------------------------ */
/* 6. CE QUI A CHANGÉ — la consommation par tour, jour après jour      */
/* ------------------------------------------------------------------ */

const parJour = db
  .prepare(
    `SELECT date(u.created_at/1000,'unixepoch') jour,
            COALESCE(a.role,'(agent effacé)') role,
            COUNT(*) tours,
            SUM(u.quota_5h) pct5h,
            AVG(u.cached_tokens) cache_moy,
            AVG(u.input_tokens) frais_moy
       FROM usage u JOIN agents a ON a.id = u.agent_id
      WHERE u.engine='claude' AND a.role IN ('task','orchestrator') AND u.created_at > ?
      GROUP BY jour, role ORDER BY role, jour`,
  )
  .all(Date.now() - Math.max(JOURS, 10) * 86400 * 1000);

titre('6. CE QUI A CHANGÉ — coût par tour, jour après jour');
tableau(parJour, [
  { titre: 'jour', valeur: (l) => l.jour },
  { titre: 'rôle', valeur: (l) => l.role },
  { titre: 'tours', valeur: (l) => l.tours },
  { titre: 'points 5h', valeur: (l) => nombre(l.pct5h, 1) },
  { titre: 'k relus/tour', valeur: (l) => milliers((l.cache_moy ?? 0) / 1000) },
  { titre: 'k frais/tour', valeur: (l) => milliers((l.frais_moy ?? 0) / 1000) },
]);
rapport.parJour = parJour;

/*
 * Le fichier d'instructions grossit-il ? C'est la seule pièce du socle qui
 * change tous les jours, et git en garde l'histoire : on la lit, on ne la
 * suppose pas.
 */
titre("6 bis. LA TAILLE DU FICHIER D'INSTRUCTIONS, dans git");
const histoire = [];
try {
  const jours = execFileSync(
    'git',
    ['log', `--since=${Math.max(JOURS, 10)} days ago`, '--format=%H %ad', '--date=short', '--', 'CLAUDE.md'],
    { cwd: RACINE, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, date] = l.split(' ');
      return { sha, date };
    });
  /*
   * `git log` rend du plus récent au plus ancien : on garde donc la PREMIÈRE
   * empreinte vue de chaque jour, c'est-à-dire la DERNIÈRE version de ce jour-là —
   * celle qui a réellement servi aux agents lancés ensuite. Prendre la première
   * du matin sous-estimerait la journée.
   */
  const vus = new Set();
  for (const { sha, date } of jours) {
    if (vus.has(date)) continue;
    vus.add(date);
    const taille = execFileSync('git', ['show', `${sha}:CLAUDE.md`], {
      cwd: RACINE,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    }).length;
    histoire.push({ date, taille, jetons: taille / SIGNES_PAR_JETON, retouches: 0 });
  }
  for (const h of histoire) {
    h.retouches = jours.filter((j) => j.date === h.date).length;
  }
  histoire.sort((a, b) => a.date.localeCompare(b.date));
  tableau(histoire, [
    { titre: 'jour', valeur: (l) => l.date },
    { titre: 'signes', valeur: (l) => milliers(l.taille) },
    { titre: 'jetons (estimés)', valeur: (l) => milliers(l.jetons) },
    { titre: 'réécritures ce jour-là', valeur: (l) => l.retouches },
  ]);
} catch (err) {
  console.log(`  histoire git illisible : ${err?.message ?? err}`);
}
rapport.histoireInstructions = histoire;

/* ------------------------------------------------------------------ */
/* 7. CE QUI NE CONSOMME PAS — les soupçons écartés                    */
/* ------------------------------------------------------------------ */

const relancesPanne = (() => {
  const journal = path.join(DONNEES_REELLES, 'logs', 'service.log');
  if (!fs.existsSync(journal)) return null;
  const texte = fs.readFileSync(journal, 'utf8');
  return (texte.match(/^\[\d{4}.*panne passagère du moteur/gm) ?? []).length;
})();
const toursParCarte = db
  .prepare(
    `SELECT COUNT(*) tours, COUNT(DISTINCT u.card_id) cartes
       FROM usage u JOIN agents a ON a.id=u.agent_id
      WHERE a.role='task' AND u.engine='claude' AND u.created_at > ? AND u.card_id IS NOT NULL`,
  )
  .get(DEPUIS);

titre('7. LES SOUPÇONS ÉCARTÉS');
console.log(`  Relances après panne passagère (tout le journal) : ${relancesPanne ?? '—'}`);
console.log(
  `  Tours par carte exécutée : ${nombre((toursParCarte.tours || 0) / (toursParCarte.cartes || 1), 2)}` +
    ` (${toursParCarte.tours} tours pour ${toursParCarte.cartes} cartes)`,
);
console.log('  Vectorisation de fond, envoi au cerveau, créneau conseillé : aucun appel moteur (aucun `sendPrompt`).');
rapport.soupconsEcartes = { relancesPanne, toursParCarte };

if (SORTIE_JSON) {
  fs.writeFileSync(SORTIE_JSON, JSON.stringify(rapport, null, 2));
  console.log(`\nRelevé complet écrit dans ${SORTIE_JSON}`);
}
console.log('');
