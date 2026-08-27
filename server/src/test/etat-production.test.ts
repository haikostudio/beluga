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
  annonceMiseAJourProduction,
  canMove,
  carteRangee,
  colonneAuDemarrage,
  colonneDeReprise,
  ecartProduction,
  empreinteCourte,
  etapeDeLaColonne,
  etapeDePublication,
  etapesDePublication,
  libelleDeReprise,
  productionEnRetard,
  raisonLotBloque,
  repriseAutorisee,
  runDeLEtape,
} from '@haikodev/shared';

/**
 * LA COLONNE « EN PRODUCTION » N'EXISTE PLUS, ET LA PRODUCTION SE DIT PAR SA
 * VERSION.
 *
 * Elle racontait la production par ses CARTES : celles qui avaient été
 * déployées s'y empilaient, et il fallait les lire une à une pour deviner ce
 * qui tournait chez le client. Ce contrôle garde les trois promesses de son
 * retrait :
 *
 *  1. la colonne a disparu, les autres clés n'ont pas bougé d'un signe — les
 *     tableaux déjà enregistrés restent lisibles ;
 *  2. le DÉPLOIEMENT range et CLÔT lui-même ses cartes en « Archivé » ;
 *  3. la MISE EN PRODUCTION n'embarque plus aucune carte : elle pousse une
 *     VERSION, et ce qu'on lit d'elle est un enregistrement et un écart.
 */

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/* -------- La colonne a disparu -------- */

test('« En production » n’est plus une colonne du tableau', () => {
  assert.deepEqual(COLUMN_KEYS, ['notes', 'planned', 'running', 'to_deploy', 'archived']);
  assert.ok(!(COLUMN_KEYS as readonly string[]).includes('in_production'));
  assert.ok(!Object.keys(COLUMN_LABELS).includes('in_production'));
});

test('aucune clé existante n’est renommée : les tableaux d’hier restent lisibles', () => {
  // Règle gravée : on change l'étiquette, jamais la clé. Une carte enregistrée
  // hier dans « À déployer » doit encore s'y retrouver aujourd'hui.
  for (const cle of ['notes', 'planned', 'running', 'to_deploy', 'archived'] as const) {
    assert.ok(COLUMN_KEYS.includes(cle), `la clé « ${cle} » a disparu`);
  }
  assert.equal(COLUMN_LABELS.to_deploy, 'À déployer');
  assert.equal(COLUMN_LABELS.archived, 'Archivé');
});

test('les cartes de l’ancienne colonne sont reprises par une migration', () => {
  // Leur clé n'est plus reconnue par le modèle : sans reprise, elles ne se
  // reliraient pas. La migration les pose en « Archivé », là où le déploiement
  // les range désormais lui-même.
  const source = fs.readFileSync(path.join(RACINE, 'server/src/db.ts'), 'utf8');
  assert.match(source, /retrait-de-la-colonne-en-production/);
  assert.match(source, /UPDATE cards SET column_key = 'archived' WHERE column_key = 'in_production'/);
});

test('« À déployer » n’est plus réservée à l’utilisateur : la machine y range aussi', () => {
  assert.deepEqual(USER_ONLY_TARGETS, []);
  assert.equal(canMove('user', 'to_deploy', 'archived').allowed, true);
  assert.equal(canMove('agent', 'planned', 'to_deploy').allowed, false);
  assert.equal(canMove('machine', 'planned', 'to_deploy').allowed, false);
});

/* -------- Les fins de parcours, sans elle -------- */

test('les fins de parcours sont désormais « À déployer » et « Archivé »', () => {
  assert.deepEqual(COLONNES_HORS_REPRISE, ['to_deploy', 'archived']);
  assert.equal(repriseAutorisee('archived', 'automatique').possible, false);
  assert.equal(colonneAuDemarrage('archived', 'task'), null);
  // Un clic ou un glissement, lui, le peut.
  assert.equal(repriseAutorisee('archived', 'humain').possible, true);
});

test('reprendre une carte la ramène à l’étape juste avant, sans étape fantôme', () => {
  assert.equal(colonneDeReprise('archived'), 'planned');
  assert.equal(colonneDeReprise('to_deploy'), 'running');
  assert.equal(colonneDeReprise('running'), null);
});

test('le bouton de reprise ne parle plus d’un lot à publier depuis l’archive', () => {
  assert.equal(libelleDeReprise('archived'), 'Sortir de l’archive');
  assert.equal(libelleDeReprise('to_deploy'), 'Retirer du lot à publier');
  assert.equal(libelleDeReprise('running'), null);
});

test('une carte archivée est rangée et démarrée', () => {
  assert.ok((COLONNES_RANGEES as readonly string[]).includes('archived'));
  assert.equal(carteRangee('archived'), true);
  assert.ok(COLONNES_DEMARREES.includes('archived'));
  assert.ok(!COLONNES_DEMARREES.includes('in_production' as never));
});

/* -------- Les deux étapes de mise en ligne -------- */

test('il y a toujours deux étapes, mais une seule porte un lot', () => {
  const etapes = etapesDePublication();
  assert.equal(etapes.length, 2);
  assert.deepEqual(
    {
      cible: etapes[0].cible,
      source: etapes[0].source,
      sansLot: etapes[0].sansLot,
      arrivee: etapes[0].arrivee,
      clot: etapes[0].clot,
    },
    { cible: 'dev', source: 'to_deploy', sansLot: false, arrivee: 'archived', clot: true },
  );
  assert.deepEqual(
    {
      cible: etapes[1].cible,
      source: etapes[1].source,
      sansLot: etapes[1].sansLot,
      arrivee: etapes[1].arrivee,
      clot: etapes[1].clot,
    },
    { cible: 'production', source: 'archived', sansLot: true, arrivee: null, clot: false },
  );
});

test('déployer CLÔT la carte : il n’y a plus d’étape intermédiaire', () => {
  // La promesse de fond : une carte déployée est close et archivée du même
  // geste — document de clôture, branche refermée, ligne d'historique.
  const [dev, production] = etapesDePublication();
  assert.equal(dev.clot, true);
  assert.equal(dev.arrivee, 'archived');
  // La mise en production ne range personne : elle n'embarque aucune carte.
  assert.equal(production.clot, false);
  assert.equal(production.arrivee, null);
});

test('sans cible, c’est la première étape — le déploiement', () => {
  assert.equal(etapeDePublication().cible, 'dev');
  assert.equal(etapeDePublication('dev').arrivee, 'archived');
  assert.equal(etapeDePublication('production').arrivee, null);
});

/* -------- Le bloc de publication en tête de colonne -------- */

test('chaque colonne de mise en ligne porte SON étape, les autres n’en ont aucune', () => {
  assert.equal(etapeDeLaColonne('to_deploy')?.cible, 'dev');
  assert.equal(etapeDeLaColonne('archived')?.cible, 'production');
  for (const colonne of ['notes', 'planned', 'running'] as const) {
    assert.equal(etapeDeLaColonne(colonne), null);
  }
});

test('le bouton de la mise en production porte son libellé ENTIER, sans compteur', () => {
  // « Tout déployer (n) » en tête de « À déployer » — un lot se compte. La mise
  // en production, elle, pousse une VERSION : son bouton le dit en toutes
  // lettres, et le texte vient de l'étape, jamais du composant.
  assert.equal(etapeDeLaColonne('to_deploy')?.verbe, 'déployer');
  assert.equal(etapeDeLaColonne('to_deploy')?.bouton, undefined);
  assert.equal(etapeDeLaColonne('archived')?.bouton, 'Mettre à jour la version prod');
});

test('un lot vide n’éteint pas le bouton d’une étape sans lot', () => {
  const commun = { verbe: 'mettre à jour', aPublier: 0, cartesDansLaColonne: 42 };
  // Sans le drapeau, la colonne « Archivé » pleine ferait dire au bouton que
  // « 42 cartes n'entrent pas dans le lot » : un contresens.
  assert.equal(raisonLotBloque({ ...commun, sansLot: true }), null);
  assert.match(raisonLotBloque({ ...commun }) ?? '', /n’entre/);
  // Ce qui bloque vraiment bloque toujours, sansLot ou non.
  assert.match(
    raisonLotBloque({ ...commun, sansLot: true, agentsOccupes: ['une carte'] }) ?? '',
    /travaille encore/,
  );
  assert.match(raisonLotBloque({ ...commun, sansLot: true, horsLigne: true }) ?? '', /lien avec le serveur/);
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
  assert.match(source, /column === 'to_deploy' \|\| column === 'archived'/);
  assert.match(
    source,
    /<DeployPanel[\s\S]*?projectId=\{projectId\}[\s\S]*?cards=\{columnCards\}[\s\S]*?colonne=\{column\}/,
  );
});

/* -------- L'ÉTAT DE LA VERSION EN PRODUCTION -------- */

test('l’empreinte s’affiche courte, et un vide reste vide', () => {
  assert.equal(empreinteCourte('a1b2c3d4e5f6'), 'a1b2c3d');
  assert.equal(empreinteCourte(undefined), '');
  assert.equal(empreinteCourte('  '), '');
});

test('la phrase d’écart ne ment jamais, et ne se tait jamais', () => {
  assert.deepEqual(ecartProduction(null), { texte: 'Jamais mise en production' });
  assert.deepEqual(ecartProduction({}), { texte: 'Jamais mise en production' });
  assert.deepEqual(ecartProduction({ commit: 'abc1234', ecart: 0 }), { texte: 'À jour avec le dépôt' });
  assert.deepEqual(ecartProduction({ commit: 'abc1234', ecart: 1 }), {
    texte: '1 enregistrement de retard sur le dépôt',
  });
  // Le chiffre reste un TROU : la clé du dictionnaire ne le contient jamais,
  // sinon chaque nombre demanderait sa propre traduction.
  assert.deepEqual(ecartProduction({ commit: 'abc1234', ecart: 7 }), {
    texte: '{n} enregistrements de retard sur le dépôt',
    valeurs: { n: 7 },
  });
  // Une mesure MANQUANTE se dit « inconnue » : jamais « à jour », qui serait faux.
  assert.deepEqual(ecartProduction({ commit: 'abc1234' }), { texte: 'Écart avec le dépôt inconnu' });
});

test('le repère n’alerte que sur un vrai retard', () => {
  assert.equal(productionEnRetard(null), false);
  assert.equal(productionEnRetard({ commit: 'abc1234', ecart: 0 }), false);
  // Écart inconnu : on ne crie pas au loup sur une mesure manquante.
  assert.equal(productionEnRetard({ commit: 'abc1234' }), false);
  assert.equal(productionEnRetard({ commit: 'abc1234', ecart: 3 }), true);
});

test('la confirmation annonce ce qui va réellement partir', () => {
  assert.match(annonceMiseAJourProduction(null).texte, /première mise en production/);
  assert.match(annonceMiseAJourProduction({ commit: 'abc1234', ecart: 0 }).texte, /déjà à jour/);
  assert.match(annonceMiseAJourProduction({ commit: 'abc1234', ecart: 1 }).texte, /^1 enregistrement du dépôt/);
  assert.deepEqual(annonceMiseAJourProduction({ commit: 'abc1234', ecart: 4 }), {
    texte: '{n} enregistrements du dépôt vont partir chez le client.',
    valeurs: { n: 4 },
  });
});

test('la lecture de l’état de production n’écrit rien dans le dépôt', () => {
  // Elle peut tourner pendant qu'un agent travaille : aucune commande qui
  // change une branche, aucun appel au moteur, donc aucun jeton.
  const source = fs.readFileSync(path.join(RACINE, 'server/src/deploy.ts'), 'utf8');
  const debut = source.indexOf('export async function etatDeLaProduction');
  assert.ok(debut > 0, 'etatDeLaProduction est introuvable');
  const corps = source.slice(debut, source.indexOf('\n}', debut));
  for (const interdit of ['git checkout', 'git merge', 'git commit', 'git push', 'sendPrompt']) {
    assert.ok(!corps.includes(interdit), `la lecture de l'état ne doit pas faire « ${interdit} »`);
  }
  assert.match(corps, /git rev-list --count/);
});

test('l’écran lit l’état par une commande dédiée, et l’affiche en deux lignes', () => {
  const panneau = fs.readFileSync(path.join(RACINE, 'web/src/components/deploy-panel.tsx'), 'utf8');
  assert.match(panneau, /deploy\.etatProduction/);
  assert.match(panneau, /data-commit-production/);
  assert.match(panneau, /data-ecart-production/);
  // Le bouton porte le libellé de l'étape, jamais un texte écrit sur place.
  assert.match(panneau, /etape\.bouton/);
});

/* -------- Le pied de lot de la colonne -------- */

test('le pied de « À déployer » archive, et plus aucun pied ne pousse « en production »', () => {
  const source = fs.readFileSync(path.join(RACINE, 'web/src/components/board.tsx'), 'utf8');
  const table = source.slice(
    source.indexOf('const ACTIONS_DE_LOT'),
    source.indexOf('/**', source.indexOf('const ACTIONS_DE_LOT')),
  );
  assert.match(table, /to_deploy:\s*\{[^}]*cible:\s*'archived'/s);
  assert.ok(!table.includes('in_production'));
  // « Terminé » ne change pas de cible : il pousse toujours dans le lot.
  assert.match(table, /done:\s*\{[^}]*cible:\s*'to_deploy'/s);
});
