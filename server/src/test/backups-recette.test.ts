import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOM_MANIFESTE,
  RecetteDeBackup,
  SiteASauvegarder,
  entreeSure,
  etapesARemettre,
  genreDemande,
  inventaireDesEntrees,
  jugerRecette,
  jugerSite,
  lireManifeste,
  manifesteDArchive,
  recetteDepuisLaFiche,
  recetteEffective,
  recetteProposee,
  siteVide,
  siteVierge,
  variablesDeLaFiche,
  verdictDeLArchive,
  volumeDuPoint,
} from '@beluga/shared';

/*
 * LA RECETTE D'UN BACKUP ET LE VERDICT DE SON ARCHIVE, sans base ni disque.
 */

function recette(etapes: Record<string, unknown>[]): RecetteDeBackup {
  return recetteProposee({ explication: 'essai', etapes });
}

const CODE = { genre: 'code', libelle: 'Le code', prendre: 'git archive HEAD | tar -x -C "$SORTIE"', remettre: 'rsync -a "$ENTREE/" /srv/site/' };
const BASE = { genre: 'base', libelle: 'La base', prendre: 'pg_dump x > "$SORTIE/base.sql"', remettre: 'psql x < "$ENTREE/base.sql"', octetsMin: 100 };

test('une recette sans étape, ou sans commande, est refusée en disant ce qui manque', () => {
  assert.equal(jugerRecette(recette([])).ok, false);
  const sansRemettre = jugerRecette(recette([{ ...CODE, remettre: '' }]));
  assert.equal(sansRemettre.ok, false);
  assert.match(sansRemettre.raison ?? '', /remettre/);
  assert.equal(jugerRecette(recette([CODE, BASE])).ok, true);
});

test('les mots d’un modèle deviennent des genres, et les identifiants sont tirés du libellé, uniques', () => {
  assert.equal(genreDemande('Database'), 'base');
  assert.equal(genreDemande('uploads'), 'fichiers');
  assert.equal(genreDemande('dépôt git'), 'code');
  const lue = recette([
    { ...CODE, libelle: 'Base PocketBase', genre: 'db' },
    { ...CODE, libelle: 'Base PocketBase', genre: 'db' },
  ]);
  assert.deepEqual(
    lue.etapes.map((e) => [e.id, e.genre]),
    [
      ['base-pocketbase', 'base'],
      ['base-pocketbase-2', 'base'],
    ],
  );
  assert.equal(lue.origine, 'agent');
});

test('une étape ne peut pas prendre le nom du manifeste', () => {
  assert.equal(jugerRecette(recette([{ ...CODE, id: 'manifeste' }])).ok, false);
});

test('une fiche d’avant reçoit la recette équivalente à l’ancienne copie, sans aucun mot de passe écrit', () => {
  const site: SiteASauvegarder = {
    ...siteVierge(),
    id: 's1',
    nom: 'Boutique',
    base: { moteur: 'mysql', hote: 'db', port: '3307', nom: 'boutique', utilisateur: 'u', motDePasse: 'SECRET' },
    fichiers: { moyen: 'ssh', chemin: '/var/www/', hote: 'h', port: '', utilisateur: 'deploy', motDePasse: '' },
  };
  const deduite = recetteDepuisLaFiche(site);
  assert.equal(deduite.origine, 'fiche');
  assert.deepEqual(deduite.etapes.map((e) => e.id), ['base', 'fichiers']);
  assert.ok(jugerRecette(deduite).ok);
  assert.ok(!JSON.stringify(deduite).includes('SECRET'), 'le mot de passe passe par l’environnement');
  const variables = variablesDeLaFiche(site);
  assert.equal(variables.MYSQL_PWD, 'SECRET');
  assert.equal(variables.PGPASSWORD, '');
  assert.equal(variables.FICHIERS_CHEMIN, '/var/www');
  assert.equal(recetteEffective(site).origine, 'fiche');
});

test('la recette de l’agent l’emporte sur celle de la fiche, et rend la fiche non vide', () => {
  const site: SiteASauvegarder = { ...siteVierge(), id: 's2', nom: 'Conteneur' };
  assert.equal(siteVide(site), true);
  const avecRecette = { ...site, recette: recette([CODE]) };
  assert.equal(siteVide(avecRecette), false);
  assert.equal(jugerSite(avecRecette).ok, true);
  assert.equal(recetteEffective(avecRecette).origine, 'agent');
});

test('un chemin d’entrée qui sort du dossier est refusé', () => {
  assert.equal(entreeSure('code/src/index.ts'), 'code/src/index.ts');
  assert.equal(entreeSure('./code//a'), 'code/a');
  assert.equal(entreeSure('../etc/passwd'), null);
  assert.equal(entreeSure('code/../../x'), null);
  assert.equal(entreeSure('/etc/passwd'), null);
  assert.equal(entreeSure('C:/Windows'), null);
  assert.equal(entreeSure('code\\..\\x'), null);
});

test('le verdict se lit dans l’archive : tout posé = réussi, une part = partiel, rien = échec', () => {
  const r = recette([CODE, BASE]);
  const entrees = [
    { nom: NOM_MANIFESTE, octets: 300 },
    { nom: 'le-code/', octets: 0 },
    { nom: 'le-code/index.js', octets: 1200 },
    { nom: 'la-base/base.sql', octets: 5000 },
  ];
  const complet = inventaireDesEntrees(entrees, r);
  assert.equal(complet.fichiers, 2);
  assert.equal(verdictDeLArchive(complet).statut, 'reussi');

  const baseLegere = inventaireDesEntrees(
    entrees.map((e) => (e.nom === 'la-base/base.sql' ? { ...e, octets: 10 } : e)),
    r,
  );
  const partiel = verdictDeLArchive(baseLegere);
  assert.equal(partiel.statut, 'partiel');
  assert.match(partiel.detail, /La base : trop léger/);

  const commandeTombee = inventaireDesEntrees([{ nom: NOM_MANIFESTE, octets: 1 }], r, { 'le-code': 'git a rendu 128' });
  const echec = verdictDeLArchive(commandeTombee);
  assert.equal(echec.statut, 'echec');
  assert.match(echec.detail, /Le code : git a rendu 128/);
});

test('une archive sans manifeste est un échec, même pleine', () => {
  const r = recette([CODE]);
  const sans = inventaireDesEntrees([{ nom: 'le-code/a', octets: 10 }], r);
  assert.equal(verdictDeLArchive(sans).statut, 'echec');
  assert.equal(verdictDeLArchive(null).statut, 'echec');
});

test('la restauration rejoue la recette de l’archive, et seulement les étapes présentes', () => {
  const site: SiteASauvegarder = { ...siteVierge(), id: 's3', nom: 'Site' };
  const r = recette([CODE, BASE]);
  const manifeste = lireManifeste(JSON.parse(JSON.stringify(manifesteDArchive(site, r, 42))));
  assert.ok(manifeste);
  const inventaire = inventaireDesEntrees(
    [
      { nom: NOM_MANIFESTE, octets: 1 },
      { nom: 'le-code/a', octets: 10 },
    ],
    r,
  );
  assert.deepEqual(etapesARemettre(manifeste!, inventaire).map((e) => e.id), ['le-code']);
  assert.equal(lireManifeste({ version: 1, siteId: 's', recette: { etapes: [] } }), null);
});

test('le volume d’un point à archive est le poids de son zip', () => {
  const ancien = { octetsBase: 10, octetsFichiers: 5 } as any;
  assert.equal(volumeDuPoint(ancien), 15);
  assert.equal(volumeDuPoint({ ...ancien, cheminArchive: '/x.zip', taille: 7 }), 7);
});
