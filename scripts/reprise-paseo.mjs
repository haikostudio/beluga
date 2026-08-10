#!/usr/bin/env node
/**
 * Reprise des tâches encore en attente dans l'ancienne interface Paseo.
 *
 * Ne lit QUE les fichiers de Paseo — jamais ne les écrit. Les tâches des trois
 * colonnes d'avant l'exécution (notes, à faire, à valider) sont recopiées en
 * cartes HaikoDev, toutes posées dans « Planifié » : ce sont des tâches non
 * commencées, et seule la validation de l'utilisateur autorise la dépense.
 *
 * Relançable sans dégât : le rapprochement se fait sur le titre normalisé, à
 * l'intérieur d'un même projet. Passé deux fois, rien ne se duplique.
 *
 *   node scripts/reprise-paseo.mjs            # écrit
 *   node scripts/reprise-paseo.mjs --essai    # montre sans rien écrire
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
// Le même contrôle que le serveur : une carte qu'il ne saurait pas relire
// n'entre pas dans la base. Demande d'avoir construit « shared » avant.
import { Card } from '/root/haikodev/shared/dist/models.js';

const DOSSIER_PASEO = '/home/paseo/.paseo/tasks';
const BASE = '/root/haikodev/data/haikodev.db';
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry-run');

/** L'étiquette qui permet de retrouver — ou de retirer — la reprise en bloc. */
const MARQUE = 'repris de Paseo';

/** Les trois colonnes d'avant « en cours », et l'étiquette qui garde leur trace. */
const COLONNES_REPRISES = {
  notes: 'note',
  backlog: null, // « à faire » chez Paseo comme chez HaikoDev : rien à conserver
  validated: 'à valider',
};

/** L'ordre des colonnes sur l'ancien tableau, pour respecter l'ordre d'origine. */
const RANG_COLONNE = { notes: 0, backlog: 1, validated: 2 };

/**
 * Un projet Paseo, un projet HaikoDev. Les noms diffèrent (Paseo range par
 * dépôt, HaikoDev par nom de projet) : la correspondance est écrite ici, en
 * clair, plutôt que devinée.
 */
const CORRESPONDANCE = {
  '/root': 'Root',
  'remote:github.com/getpaseo/paseo': 'paseo',
  'remote:github.com/haikostudio/brain': 'brain',
  'remote:github.com/haikostudio/etsigna-dev': 'etsigna-dev',
  'remote:github.com/haikostudio/formations': 'formations',
  'remote:github.com/haikostudio/haikomail': 'haikomail',
  'remote:github.com/haikostudio/maestria': 'maestria',
};

const normaliser = (titre) =>
  String(titre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Lit toutes les tâches Paseo à reprendre, groupées par projet d'origine. */
function lirePaseo() {
  const parProjet = new Map();
  for (const fichier of fs.readdirSync(DOSSIER_PASEO)) {
    if (!fichier.endsWith('.json')) continue;
    const nom = Buffer.from(fichier.replace(/\.json$/, ''), 'base64url').toString();
    if (!(nom in CORRESPONDANCE)) continue;
    let contenu;
    try {
      contenu = JSON.parse(fs.readFileSync(path.join(DOSSIER_PASEO, fichier), 'utf8'));
    } catch {
      continue;
    }
    const taches = (contenu.tasks ?? [])
      .filter((t) => t.column in COLONNES_REPRISES)
      .sort((a, b) => (RANG_COLONNE[a.column] - RANG_COLONNE[b.column]) || (a.order ?? 0) - (b.order ?? 0));
    if (taches.length) parProjet.set(nom, taches);
  }
  return parProjet;
}

/** L'estimation de Paseo, traduite dans le vocabulaire de HaikoDev. */
function traduireEstimation(estimation) {
  if (!estimation) return undefined;
  const nombre = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const traduite = {
    machineSeconds: nombre(estimation.estimatedMinutes) !== undefined ? estimation.estimatedMinutes * 60 : undefined,
    tokens: nombre(estimation.tokens),
    // Paseo compte en pourcents, HaikoDev en part (0,08 = 8 %).
    quotaShare: nombre(estimation.quotaPercent) !== undefined ? estimation.quotaPercent / 100 : undefined,
    confidence: ['low', 'medium', 'high'].includes(estimation.confidence) ? estimation.confidence : undefined,
    summary: typeof estimation.summary === 'string' ? estimation.summary : undefined,
    seniorHours: nombre(estimation.billingHours),
    billingTitle: typeof estimation.billingTitle === 'string' ? estimation.billingTitle : undefined,
    billingDescription: typeof estimation.billingDescription === 'string' ? estimation.billingDescription : undefined,
    failed: false,
    producedAt: Date.parse(estimation.estimatedAt ?? '') || undefined,
  };
  for (const [cle, valeur] of Object.entries(traduite)) if (valeur === undefined) delete traduite[cle];
  return traduite;
}

function etiquettes(tache) {
  const liste = [...(Array.isArray(tache.tags) ? tache.tags : [])];
  const origine = COLONNES_REPRISES[tache.column];
  if (origine) liste.push(origine);
  liste.push(MARQUE);
  return [...new Set(liste.map((e) => String(e)).filter(Boolean))];
}

const base = new Database(BASE, { readonly: ESSAI });
const projets = base.prepare('SELECT id, name, data FROM projects').all().map((p) => {
  let reglages = {};
  try {
    reglages = JSON.parse(p.data);
  } catch {
    reglages = {};
  }
  return { id: p.id, name: p.name, moteur: reglages.defaultEngine ?? 'claude', modele: reglages.defaultModel };
});
const parNom = new Map(projets.map((p) => [p.name, p]));

let creees = 0;
let deja = 0;
const manquants = [];

for (const [nomPaseo, taches] of lirePaseo()) {
  const cible = parNom.get(CORRESPONDANCE[nomPaseo]);
  if (!cible) {
    manquants.push(`${nomPaseo} → ${CORRESPONDANCE[nomPaseo]}`);
    continue;
  }

  // Les titres déjà présents dans le projet, toutes colonnes confondues : une
  // carte reprise puis déplacée à la main ne doit pas revenir en double.
  const existants = new Set(
    base
      .prepare('SELECT title FROM cards WHERE project_id = ?')
      .all(cible.id)
      .map((r) => normaliser(r.title)),
  );

  const aCreer = taches.filter((t) => !existants.has(normaliser(t.title)));
  deja += taches.length - aCreer.length;
  if (!aCreer.length) {
    console.log(`${cible.name} : ${taches.length} tâche(s), toutes déjà reprises`);
    continue;
  }

  // Le tableau affiche les positions décroissantes : la première tâche de
  // Paseo doit donc porter la plus haute, et passer devant l'existant.
  const plafond = base
    .prepare('SELECT MAX(position) AS m FROM cards WHERE project_id = ? AND column_key = ?')
    .get(cible.id, 'planned');
  const depart = Math.max(plafond?.m ?? 0, Date.now()) + aCreer.length;

  aCreer.forEach((tache, index) => {
    const instant = Date.now();
    const carte = {
      id: randomUUID(),
      projectId: cible.id,
      title: String(tache.title ?? '').slice(0, 200),
      description: String(tache.description ?? ''),
      labels: etiquettes(tache),
      column: 'planned',
      position: depart - index,
      origin: 'user',
      run: { engine: cible.moteur, ...(cible.modele ? { model: cible.modele } : {}), thinking: 'none', mode: 'direct' },
      excludedFromDeploy: false,
      horsTache: false,
      scheduling: { asap: false, attempts: 0, restarts: 0 },
      createdAt: Date.parse(tache.createdAt ?? '') || instant,
      updatedAt: instant,
    };
    const estimation = traduireEstimation(tache.estimate);
    if (estimation) carte.estimate = estimation;

    const validee = Card.parse(carte);
    console.log(`${ESSAI ? '[essai] ' : ''}${cible.name} ← ${validee.title}`);
    if (!ESSAI) {
      base
        .prepare(
          `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          validee.id,
          validee.projectId,
          validee.column,
          validee.position,
          validee.title,
          JSON.stringify(validee),
          validee.createdAt,
          validee.updatedAt,
        );
    }
    creees += 1;
  });
}

if (manquants.length) console.log(`\nProjet HaikoDev introuvable : ${manquants.join(', ')}`);
console.log(`\n${ESSAI ? '[essai] ' : ''}${creees} carte(s) créée(s), ${deja} déjà présente(s).`);
