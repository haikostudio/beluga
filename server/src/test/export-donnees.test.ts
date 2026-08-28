import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES_EXPORT,
  VERSION_ARCHIVE,
  categorieDeLaTable,
  cheminDeLaTable,
  colonnesRetenues,
  definitionCategorie,
  dependancesManquantes,
  nomArchive,
  tablesDeLaSelection,
  toutesLesCategories,
  validerManifeste,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le catalogue des catégories                                        */
/* ------------------------------------------------------------------ */

test('les six catégories nommées par la carte existent, et rien ne se recouvre', () => {
  const cles = toutesLesCategories();
  for (const attendue of ['coffre-fort', 'snapshots', 'projets', 'cartes', 'messages', 'branches']) {
    assert.ok(cles.includes(attendue as never), `catégorie manquante : ${attendue}`);
  }
  // Une même table dans deux catégories ferait deux fichiers pour une seule
  // vérité : la seconde écraserait la première à l'import.
  const vues = new Set<string>();
  for (const categorie of CATEGORIES_EXPORT) {
    for (const table of categorie.tables) {
      assert.ok(!vues.has(table), `la table ${table} appartient à deux catégories`);
      vues.add(table);
    }
  }
});

test('tout est coché au départ : l’utilisateur retire, il n’ajoute pas', () => {
  assert.equal(toutesLesCategories().length, CATEGORIES_EXPORT.length);
});

test('un mot qui ne veut rien dire ne rend aucune définition', () => {
  assert.equal(definitionCategorie('coffre-fort')?.libelle, 'Coffre-fort');
  assert.equal(definitionCategorie('gadget'), undefined);
});

/* ------------------------------------------------------------------ */
/* L'ordre de remontée : les projets avant les cartes                  */
/* ------------------------------------------------------------------ */

test('les projets se remontent avant les cartes, quel que soit l’ordre demandé', () => {
  const tables = tablesDeLaSelection(['messages', 'cartes', 'projets']);
  assert.ok(tables.indexOf('projects') < tables.indexOf('cards'), 'les projets doivent précéder les cartes');
  assert.ok(tables.indexOf('projects') < tables.indexOf('messages'), 'les projets doivent précéder les messages');
});

test('une sélection réduite n’emporte que ses tables', () => {
  assert.deepEqual(tablesDeLaSelection(['coffre-fort']), ['secrets']);
  assert.deepEqual(tablesDeLaSelection([]), []);
});

test('« branches » n’emporte aucune table : elle lit les dépôts git', () => {
  assert.deepEqual(tablesDeLaSelection(['branches']), []);
});

test('chaque table est rangée dans le dossier de sa catégorie', () => {
  assert.equal(categorieDeLaTable('secrets'), 'coffre-fort');
  assert.equal(categorieDeLaTable('snapshot_points'), 'snapshots');
  assert.equal(categorieDeLaTable('table_inconnue'), undefined);
  assert.equal(cheminDeLaTable('secrets'), 'donnees/coffre-fort/secrets.json');
});

/* ------------------------------------------------------------------ */
/* Ce qui arriverait orphelin                                          */
/* ------------------------------------------------------------------ */

test('des cartes sans leurs projets sont annoncées orphelines, pas cochées de force', () => {
  assert.deepEqual(dependancesManquantes(['cartes']), ['projets']);
  assert.deepEqual(dependancesManquantes(['cartes', 'projets']), []);
});

test('le coffre-fort et la surveillance ne dépendent de rien', () => {
  assert.deepEqual(dependancesManquantes(['coffre-fort', 'surveillance', 'snapshots']), []);
});

/* ------------------------------------------------------------------ */
/* La validation d'une archive                                         */
/* ------------------------------------------------------------------ */

const manifesteValable = {
  version: VERSION_ARCHIVE,
  outil: 'haikodev',
  versionOutil: '1.0.0',
  creeLe: 1_700_000_000_000,
  origine: 'srv1188900',
  categories: ['coffre-fort', 'gadget'],
  tables: [{ table: 'secrets', categorie: 'coffre-fort', chemin: 'donnees/coffre-fort/secrets.json', lignes: 3, empreinte: 'abc' }],
  git: [],
};

test('une archive d’un autre logiciel est refusée en clair', () => {
  const juge = validerManifeste({ outil: 'autre-chose', version: 1 });
  assert.equal(juge.ok, false);
  assert.match(juge.ok ? '' : juge.raison, /archive HaikoDev/);
});

test('une archive d’une autre version dit laquelle, et laquelle on sait lire', () => {
  const juge = validerManifeste({ ...manifesteValable, version: 99 });
  assert.equal(juge.ok, false);
  assert.match(juge.ok ? '' : juge.raison, /99/);
});

test('un manifeste sans liste de tables est refusé', () => {
  const juge = validerManifeste({ ...manifesteValable, tables: undefined });
  assert.equal(juge.ok, false);
});

test('un fichier illisible ne fait pas tomber la validation', () => {
  assert.equal(validerManifeste(null).ok, false);
  assert.equal(validerManifeste('bonjour').ok, false);
});

test('une archive valable rend son manifeste, catégories inconnues jetées', () => {
  const juge = validerManifeste(manifesteValable);
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  assert.deepEqual(juge.manifeste.categories, ['coffre-fort']);
  assert.equal(juge.manifeste.tables.length, 1);
  assert.equal(juge.manifeste.origine, 'srv1188900');
});

/* ------------------------------------------------------------------ */
/* Les colonnes qu'on ne connaît pas encore                            */
/* ------------------------------------------------------------------ */

test('une colonne venue d’une version plus récente est laissée de côté, pas fatale', () => {
  const tri = colonnesRetenues(['id', 'nom', 'nouveaute'], ['id', 'nom']);
  assert.deepEqual(tri.gardees, ['id', 'nom']);
  assert.deepEqual(tri.ignorees, ['nouveaute']);
});

test('une colonne d’ici absente de l’archive n’invente rien', () => {
  const tri = colonnesRetenues(['id'], ['id', 'nom']);
  assert.deepEqual(tri.gardees, ['id']);
  assert.deepEqual(tri.ignorees, []);
});

/* ------------------------------------------------------------------ */
/* Le nom du fichier                                                   */
/* ------------------------------------------------------------------ */

test('le nom de l’archive est daté à la minute et finit en .zip', () => {
  const nom = nomArchive(new Date('2026-08-28T14:35:12.000Z'));
  assert.equal(nom, 'haikodev-donnees-2026-08-28T14-35.zip');
});
