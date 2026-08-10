import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLONNES_DEMARREES,
  COLONNES_HORS_REPRISE,
  COLONNES_RANGEES,
  COLUMN_KEYS,
  COLUMN_LABELS,
  USER_ONLY_TARGETS,
  canMove,
  carteRangee,
  colonneAuDemarrage,
  colonneDeReprise,
  etapeDeLaColonne,
  etapeDePublication,
  etapesDePublication,
  libelleDeReprise,
  repriseAutorisee,
  runDeLEtape,
} from '@haikodev/shared';

/**
 * La colonne « En production » : la mise en ligne compte DEUX étapes, toujours.
 *
 * Ce contrôle garde trois promesses : aucune clé de colonne existante ne bouge
 * (les tableaux déjà enregistrés restent lisibles), la nouvelle colonne obéit
 * exactement aux mêmes règles de fin de parcours que « À déployer », et les
 * DEUX étapes existent pour tout projet, sans le moindre réglage.
 */

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/* -------- La colonne elle-même -------- */

test('« En production » s’intercale entre « À déployer » et « Archivé »', () => {
  assert.deepEqual(COLUMN_KEYS, [
    'notes',
    'todo',
    'running',
    'done',
    'to_deploy',
    'in_production',
    'archived',
  ]);
  assert.equal(COLUMN_LABELS.in_production, 'En production');
});

test('aucune clé existante n’est renommée ni supprimée', () => {
  // Règle gravée : on change l'étiquette, jamais la clé. Une carte enregistrée
  // hier dans « À déployer » doit encore s'y retrouver aujourd'hui.
  for (const cle of ['notes', 'todo', 'running', 'done', 'to_deploy', 'archived'] as const) {
    assert.ok(COLUMN_KEYS.includes(cle), `la clé « ${cle} » a disparu`);
  }
  assert.equal(COLUMN_LABELS.to_deploy, 'À déployer');
  assert.equal(COLUMN_LABELS.archived, 'Archivé');
});

test('« En production » n’est atteignable que par l’utilisateur', () => {
  assert.ok(USER_ONLY_TARGETS.includes('in_production'));
  assert.equal(canMove('user', 'to_deploy', 'in_production').allowed, true);
  assert.equal(canMove('agent', 'todo', 'in_production').allowed, false);
  assert.equal(canMove('machine', 'running', 'in_production').allowed, false);
});

/* -------- Elle ne se rouvre que sur geste humain -------- */

test('« En production » est une fin de parcours comme « À déployer »', () => {
  assert.ok(COLONNES_HORS_REPRISE.includes('in_production'));
  // Un tour d'agent, une question posée dans la conversation : rien
  // d'automatique ne l'en sort.
  assert.equal(repriseAutorisee('in_production', 'automatique').possible, false);
  assert.match(repriseAutorisee('in_production', 'automatique').raison ?? '', /En production/);
  assert.equal(colonneAuDemarrage('in_production', 'task'), null);
  // Un clic ou un glissement, lui, le peut.
  assert.equal(repriseAutorisee('in_production', 'humain').possible, true);
});

test('reprendre une carte « En production » la ramène à l’étape juste avant', () => {
  assert.equal(colonneDeReprise('in_production'), 'to_deploy');
  // Les deux autres reprises ne changent pas d'un pouce.
  assert.equal(colonneDeReprise('to_deploy'), 'done');
  assert.equal(colonneDeReprise('archived'), 'todo');
  assert.equal(colonneDeReprise('running'), null);
});

test('le bouton de reprise dit ce qu’il fait, colonne par colonne', () => {
  assert.equal(libelleDeReprise('in_production'), 'Repasser dans le lot à publier');
  assert.equal(libelleDeReprise('to_deploy'), 'Retirer du lot à publier');
  assert.equal(libelleDeReprise('archived'), 'Sortir de l’archive');
  assert.equal(libelleDeReprise('running'), null);
});

test('une carte « En production » est rangée et démarrée', () => {
  // Plus rien ne s'y décide : une question écrite en chemin a trouvé sa réponse.
  assert.ok((COLONNES_RANGEES as readonly string[]).includes('in_production'));
  assert.equal(carteRangee('in_production'), true);
  // Son travail est parti : ses réglages sont des faits, plus des intentions.
  assert.ok(COLONNES_DEMARREES.includes('in_production'));
});

/* -------- Les deux étapes de mise en ligne -------- */

test('il y a TOUJOURS deux étapes, sans le moindre réglage', () => {
  const etapes = etapesDePublication();
  assert.equal(etapes.length, 2);
  assert.deepEqual(
    { cible: etapes[0].cible, source: etapes[0].source, arrivee: etapes[0].arrivee, clot: etapes[0].clot },
    { cible: 'dev', source: 'to_deploy', arrivee: 'in_production', clot: false },
  );
  assert.deepEqual(
    { cible: etapes[1].cible, source: etapes[1].source, arrivee: etapes[1].arrivee, clot: etapes[1].clot },
    { cible: 'production', source: 'in_production', arrivee: 'archived', clot: true },
  );
});

test('déployer ne clôt RIEN : clore appartient à la mise en production', () => {
  // La promesse de fond : une carte déployée va « En production », jamais aux
  // archives — on peut encore la reprendre, la corriger, la redéployer.
  const [dev, production] = etapesDePublication();
  assert.equal(dev.clot, false);
  assert.equal(dev.arrivee, 'in_production');
  assert.equal(production.clot, true);
  assert.equal(production.arrivee, 'archived');
});

test('sans cible, c’est la première étape — le déploiement', () => {
  assert.equal(etapeDePublication().cible, 'dev');
  assert.equal(etapeDePublication('dev').arrivee, 'in_production');
  assert.equal(etapeDePublication('production').arrivee, 'archived');
});

/* -------- Le bloc de publication en tête de colonne -------- */

test('chaque colonne de mise en ligne porte SON étape, les autres n’en ont aucune', () => {
  assert.equal(etapeDeLaColonne('to_deploy')?.cible, 'dev');
  assert.equal(etapeDeLaColonne('in_production')?.cible, 'production');
  // Aucune autre colonne ne publie : là, pas de bloc du tout.
  for (const colonne of ['todo', 'running', 'done', 'archived'] as const) {
    assert.equal(etapeDeLaColonne(colonne), null);
  }
});

test('le bouton dit ce que son étape fait : déployer, puis publier', () => {
  // « Tout déployer » en tête de « À déployer », « Tout publier » en tête de
  // « En production » : le verbe vient de l'étape, jamais du composant.
  assert.equal(etapeDeLaColonne('to_deploy')?.verbe, 'déployer');
  assert.equal(etapeDeLaColonne('in_production')?.verbe, 'publier');
});

test('une publication ne s’affiche que dans le bloc qui l’a lancée', () => {
  const [dev, production] = etapesDePublication();
  assert.equal(runDeLEtape('dev', dev), true);
  assert.equal(runDeLEtape('dev', production), false);
  assert.equal(runDeLEtape('production', production), true);
  assert.equal(runDeLEtape('production', dev), false);
  // Une publication d'AVANT les deux étapes ne porte pas de cible : elle est
  // celle du lot de « À déployer », le seul qui existait.
  assert.equal(runDeLEtape(undefined, dev), true);
  assert.equal(runDeLEtape(undefined, production), false);
});

test('le bloc de publication est posé en tête des deux colonnes de mise en ligne', () => {
  const source = fs.readFileSync(path.join(RACINE, 'web/src/components/board.tsx'), 'utf8');
  assert.match(source, /column === 'to_deploy' \|\| column === 'in_production'/);
  // Le bloc peut désormais recevoir d'autres props (il remonte ses textes
  // informatifs à la tête de colonne) : on vérifie qu'il est posé avec la
  // colonne et ses cartes, sans exiger une seule ligne.
  assert.match(
    source,
    /<DeployPanel[\s\S]*?projectId=\{projectId\}[\s\S]*?cards=\{columnCards\}[\s\S]*?colonne=\{column\}/,
  );
});

/* -------- Le pied de lot de la colonne -------- */

test('le pied de « À déployer » pousse en production, celui d’« En production » archive', () => {
  // Un pied suit le PARCOURS de la carte : on n'archive jamais par-dessus une
  // étape de mise en ligne. Les entrées vivent dans une seule table du tableau.
  const source = fs.readFileSync(path.join(RACINE, 'web/src/components/board.tsx'), 'utf8');
  const table = source.slice(source.indexOf('const ACTIONS_DE_LOT'), source.indexOf('/**', source.indexOf('const ACTIONS_DE_LOT')));
  // Une colonne porte une LISTE de gestes depuis que « À faire » en compte deux
  // (valider, puis lancer) : la forme change, les cibles ne bougent pas.
  assert.match(table, /to_deploy:\s*\[[^\]]*cible:\s*'in_production'/s);
  assert.match(table, /in_production:\s*\[[^\]]*cible:\s*'archived'/s);
  // « Terminé » ne change pas de cible : il pousse toujours dans le lot.
  assert.match(table, /done:\s*\[[^\]]*cible:\s*'to_deploy'/s);
});
