import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LA RECHERCHE DES RÉGLAGES, À LA MANIÈRE D'iOS.                      */
/*                                                                     */
/* Les réglages sont une arborescence : on ne VOIT plus où se cache un */
/* réglage, on le demande. Ces règles n'ont besoin ni de base ni de     */
/* disque — elles vivent dans `shared/` et se testent seules.          */
/* ------------------------------------------------------------------ */

const { chercherDansLesReglages, grouperLesResultats, normaliserPourRecherche } =
  await import('@beluga/shared');

const FICHES = [
  { cle: 'theme', titre: 'Thème et ambiance', groupe: 'Apparence', motsCles: ['sombre', 'clair', 'couleur'] },
  { cle: 'personnages', titre: 'Personnages des colonnes', groupe: 'Apparence' },
  { cle: 'comptes', titre: 'Comptes et quotas', groupe: 'Moteurs', motsCles: ['claude', 'codex'] },
  { cle: 'sauvegardes', titre: 'Sauvegarde automatique', groupe: 'Données', libelles: ['Heure de la sauvegarde de nuit'] },
  { cle: 'acces-api', titre: 'Accès API', groupe: 'Développeurs', motsCles: ['clé', 'jeton'] },
];

test('une requête vide rend toutes les pages, dans l’ordre du menu', () => {
  const trouves = chercherDansLesReglages(FICHES, '   ');
  assert.equal(trouves.length, FICHES.length);
  assert.equal(trouves[0].fiche.cle, 'theme');
});

test('les accents et la casse ne comptent pas', () => {
  assert.equal(normaliserPourRecherche('Thème'), 'theme');
  const trouves = chercherDansLesReglages(FICHES, 'THEME');
  assert.equal(trouves[0].fiche.cle, 'theme');
});

test('un mot-clé mène à sa page : « sombre » trouve le thème', () => {
  const trouves = chercherDansLesReglages(FICHES, 'sombre');
  assert.equal(trouves.length, 1);
  assert.equal(trouves[0].fiche.cle, 'theme');
});

test('« quota » trouve « Comptes et quotas »', () => {
  const trouves = chercherDansLesReglages(FICHES, 'quota');
  assert.equal(trouves[0].fiche.cle, 'comptes');
});

test('une faute d’une lettre passe encore, à partir de quatre lettres', () => {
  assert.equal(chercherDansLesReglages(FICHES, 'sauvegrde')[0]?.fiche.cle, 'sauvegardes');
  // Trois lettres : pas de tolérance, sinon « api » attraperait tout.
  assert.equal(chercherDansLesReglages(FICHES, 'zzz').length, 0);
});

test('un libellé de réglage compte aussi, mais moins que le titre', () => {
  const trouves = chercherDansLesReglages(FICHES, 'nuit');
  assert.equal(trouves[0].fiche.cle, 'sauvegardes');
});

test('chaque mot tapé doit coller : deux mots ne font pas une union', () => {
  assert.equal(chercherDansLesReglages(FICHES, 'comptes quotas').length, 1);
  assert.equal(chercherDansLesReglages(FICHES, 'comptes personnages').length, 0);
});

test('rien ne sort quand rien ne colle', () => {
  assert.equal(chercherDansLesReglages(FICHES, 'imprimante').length, 0);
});

test('les résultats se lisent groupés, comme le menu', () => {
  const groupes = grouperLesResultats(chercherDansLesReglages(FICHES, ''));
  assert.deepEqual(groupes.map((g) => g.groupe), ['Apparence', 'Moteurs', 'Données', 'Développeurs']);
  assert.equal(groupes[0].fiches.length, 2);
});

test('le titre passe devant le groupe : « apparence » sort les deux pages du groupe', () => {
  const trouves = chercherDansLesReglages(FICHES, 'apparence');
  assert.equal(trouves.length, 2);
});

/* ------------------------------------------------------------------ */
/* LES SEPT RUBRIQUES (colonne fixe, 24/11/2026)                       */
/* ------------------------------------------------------------------ */

const { ARBORESCENCE_REGLAGES, ALIAS_DES_PAGES_DE_REGLAGES, cibleDesReglages, cleActuelleDeLaPage, rubriqueDeLaPage } =
  await import('@beluga/shared');

test('les réglages tiennent en sept rubriques, « Accès » en deuxième, chacune avec sa phrase', () => {
  assert.deepEqual(
    ARBORESCENCE_REGLAGES.map((r: any) => r.cle),
    ['moi', 'acces', 'agents-ia', 'ordinateurs', 'serveur', 'donnees', 'connexions'],
  );
  for (const rubrique of ARBORESCENCE_REGLAGES as any[]) {
    assert.ok(rubrique.phrase && rubrique.phrase.length > 10, `${rubrique.cle} a sa phrase`);
    assert.ok(rubrique.pages.some((p: any) => !p.avance), `${rubrique.cle} a au moins une page ordinaire`);
  }
});

test('aucune page n’apparaît deux fois, et « Installation » n’existe plus', () => {
  const cles = (ARBORESCENCE_REGLAGES as any[]).flatMap((r) => r.pages.map((p: any) => p.cle));
  assert.equal(new Set(cles).size, cles.length);
  assert.ok(!cles.includes('installation'));
  assert.ok(!cles.includes('extension'));
});

test('les pages techniques sont rangées sous « Avancé »', () => {
  const avancees = (ARBORESCENCE_REGLAGES as any[]).flatMap((r) => r.pages.filter((p: any) => p.avance).map((p: any) => p.cle));
  assert.deepEqual(avancees.sort(), ['acces-api', 'erreurs', 'gestes-serveur', 'juge-rapide']);
});

test('chaque ancienne clé de page mène à une page qui existe', () => {
  for (const [ancienne, nouvelle] of Object.entries(ALIAS_DES_PAGES_DE_REGLAGES as Record<string, string>)) {
    assert.equal(cleActuelleDeLaPage(ancienne), nouvelle);
    assert.ok(rubriqueDeLaPage(ARBORESCENCE_REGLAGES, ancienne), `${ancienne} → ${nouvelle} a sa rubrique`);
  }
  assert.equal(rubriqueDeLaPage(ARBORESCENCE_REGLAGES, 'extension')?.cle, 'ordinateurs');
  assert.equal(rubriqueDeLaPage(ARBORESCENCE_REGLAGES, 'langue')?.cle, 'moi');
  assert.equal(rubriqueDeLaPage(ARBORESCENCE_REGLAGES, 'inconnue'), undefined);
  // Les comptes clients (ex-Messagerie) et les accès tiers (ex-« Mon compte ») mènent à « Accès ».
  assert.equal(rubriqueDeLaPage(ARBORESCENCE_REGLAGES, 'sous-comptes')?.cle, 'acces');
  assert.equal(rubriqueDeLaPage(ARBORESCENCE_REGLAGES, 'comptes-clients')?.cle, 'acces');
});

test('une clé de rubrique seule ouvre la rubrique, une clé de page descend à sa section', () => {
  assert.deepEqual(
    { r: cibleDesReglages(ARBORESCENCE_REGLAGES, 'donnees')?.rubrique.cle, p: cibleDesReglages(ARBORESCENCE_REGLAGES, 'donnees')?.page },
    { r: 'donnees', p: undefined },
  );
  assert.equal(cibleDesReglages(ARBORESCENCE_REGLAGES, 'notifications')?.page, 'notifications');
  assert.equal(cibleDesReglages(ARBORESCENCE_REGLAGES, 'langue')?.page, 'theme');
  assert.equal(cibleDesReglages(ARBORESCENCE_REGLAGES, 'inconnue'), undefined);
});

test('la recherche trouve les accès des clients et de l’équipe dans « Accès », plus dans « Mon compte »', () => {
  const fiches = (ARBORESCENCE_REGLAGES as any[]).flatMap((r) =>
    r.pages.map((p: any) => ({ cle: p.cle, titre: p.titre, groupe: r.titre, motsCles: p.motsCles, libelles: p.libelles })),
  );
  for (const requete of ['client', 'collaborateur', 'mot de passe client', 'sous-comptes']) {
    assert.equal(chercherDansLesReglages(fiches, requete)[0]?.fiche.cle, 'acces', requete);
  }
  assert.ok(chercherDansLesReglages(fiches, 'mot de passe').some((r: any) => r.fiche.cle === 'mon-compte'));
});
