/**
 * LES CHARTES D'INTERFACE : lecture, choix de la charte d'un tour, garde-fou des
 * éléments natifs, porte de fin de tour (`shared/src/chartes.ts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RENVOIS_MAX_DE_LA_PORTE,
  chartesConcernees,
  cheminCorrespond,
  cheminsCitesDans,
  codeSansCommentaires,
  controlerLesInterdits,
  lireCharte,
  texteDesChartes,
  verdictDeFinDeTour,
  type Charte,
} from '@beluga/shared';

const TEXTE = `---
titre: Application
domaine: web
etat: validee
chemins: web/src/**
mots: écran, formulaire, espace client
modeles: web/src/components/modeles
interdit: <select> | Liste native : ListeDeroulante | web/src/components/ui/index.tsx
interdit: <input type=checkbox|color> | Élément natif : elements-maison | web/src/components/ui/elements-maison.tsx
interdit: /\\bwindow\\.confirm\\(/ | Fenêtre native
---
1. Règle une.
`;

const charte = lireCharte('application', TEXTE) as Charte;

test('une charte se lit : entête, interdits, corps', () => {
  assert.ok(charte);
  assert.equal(charte.titre, 'Application');
  assert.equal(charte.etat, 'validee');
  assert.deepEqual(charte.chemins, ['web/src/**']);
  assert.equal(charte.interdits.length, 3);
  assert.deepEqual(charte.interdits[0].sauf, ['web/src/components/ui/index.tsx']);
  assert.equal(charte.corps, '1. Règle une.');
  assert.equal(lireCharte('x', 'sans entête'), null);
  assert.equal(lireCharte('application', TEXTE.replace('etat: validee', 'etat: proposee'))?.etat, 'proposee');
});

test('les chemins : ** traverse les dossiers, * reste dans un nom', () => {
  assert.ok(cheminCorrespond('web/src/**', 'web/src/components/a.tsx'));
  assert.ok(cheminCorrespond('web/src/*.tsx', 'web/src/app.tsx'));
  assert.ok(!cheminCorrespond('web/src/*.tsx', 'web/src/x/app.tsx'));
  assert.ok(cheminCorrespond('shared/src/plaquette.ts', 'shared/src/plaquette.ts'));
  assert.ok(cheminCorrespond('web/src', 'web/src/a.tsx'));
  assert.ok(!cheminCorrespond('web/src/**', 'server/src/a.ts'));
});

test('la charte d’un tour : fichiers prévus ou touchés, ou mots de la demande', () => {
  assert.equal(chartesConcernees([charte], { fichiers: ['web/src/components/x.tsx'] }).length, 1);
  assert.equal(chartesConcernees([charte], { demande: 'Refaire le formulaire du coffre' }).length, 1);
  assert.equal(chartesConcernees([charte], { demande: 'Les ECRANS du studio' }).length, 1, 'accents et pluriel ignorés');
  assert.equal(chartesConcernees([charte], { demande: 'Ouvrir l’espace client aux équipes' }).length, 1, 'un mot de deux termes');
  assert.equal(chartesConcernees([charte], { demande: 'Quota des comptes Claude', fichiers: ['server/src/quota.ts'] }).length, 0);
  assert.deepEqual(cheminsCitesDans('Corriger web/src/components/plaquettes.tsx:865 et `server/src/a.ts`'), [
    'web/src/components/plaquettes.tsx',
    'server/src/a.ts',
  ]);
});

test('le bloc servi reste sous son plafond et dit l’état « proposée »', () => {
  const longue = { ...charte, corps: 'x'.repeat(50_000) };
  const bloc = texteDesChartes([longue, { ...charte, nom: 'autre', etat: 'proposee' as const }]);
  assert.ok(bloc.length < 15_000, `bloc de ${bloc.length} signes`);
  assert.match(bloc, /PROPOSÉE/);
  assert.match(texteDesChartes([charte], { cadrage: true }), /recopie dans les faits/);
});

test('le garde-fou trouve les natifs, ignore commentaires et exemptions', () => {
  const plaquettes = [
    "const couleur = () => (",
    "  <label>",
    "    <input type=\"color\" value={marque[cle]} onChange={(e) => onChange({ [cle]: e.target.value })} />",
    "  </label>",
    ");",
    "// <select> dans un commentaire",
    "/* <select> */",
    "const a = <input onChange={(e) => x(e)} type='checkbox' />;",
    "const b = <input type=\"text\" />;",
    "const c = <select className={cn('a')} value={v}>",
    "  <option>1</option>",
    "</select>;",
    "const d = 'https://exemple.fr/<select>';",
    "if (window.confirm('ok ?')) {}",
  ].join('\n');
  const m = controlerLesInterdits([charte], [
    { chemin: 'web/src/components/plaquettes.tsx', contenu: plaquettes },
    { chemin: 'web/src/components/ui/index.tsx', contenu: '/**\n * (`<select>`)\n */\nexport const x = <select />;' },
    { chemin: 'server/src/a.ts', contenu: '<select>' },
  ]);
  const lignes = m.filter((x) => x.chemin.endsWith('plaquettes.tsx')).map((x) => x.ligne);
  // couleur (l.3), case après une flèche (l.8), liste (l.10), adresse dans une chaîne (l.13), fenêtre native (l.14)
  assert.deepEqual(lignes.sort((a, b) => a - b), [3, 8, 10, 13, 14]);
  assert.ok(!m.some((x) => x.chemin.endsWith('index.tsx')), 'le composant maison est exempté');
  assert.ok(!m.some((x) => x.chemin.startsWith('server/')), 'hors des chemins de la charte');
});

test('les commentaires ôtés gardent lignes et longueur', () => {
  const code = "a // b\n/* c\nd */ e\n'// pas un commentaire'";
  const propre = codeSansCommentaires(code);
  assert.equal(propre.length, code.length);
  assert.equal(propre.split('\n').length, code.split('\n').length);
  assert.match(propre, /'\/\/ pas un commentaire'/);
});

test('la porte de fin de tour : hors interface, renvoi, puis issue au troisième passage', () => {
  const base = { chartes: [charte], manquements: [], captures: 0, renvois: 0 };
  assert.deepEqual(verdictDeFinDeTour({ ...base, fichiersModifies: ['server/src/a.ts'] }), { issue: 'rendre', raison: 'hors-interface' });
  const sansImage = verdictDeFinDeTour({ ...base, fichiersModifies: ['web/src/a.tsx'] });
  assert.equal(sansImage.issue, 'renvoyer');
  assert.match((sansImage as { texte: string }).texte, /RELECTURE EN IMAGES/);
  assert.deepEqual(verdictDeFinDeTour({ ...base, fichiersModifies: ['web/src/a.tsx'], captures: 4 }), { issue: 'rendre', raison: 'conforme' });
  const natif = verdictDeFinDeTour({
    ...base,
    captures: 4,
    fichiersModifies: ['web/src/a.tsx'],
    manquements: [{ charte: 'application', chemin: 'web/src/a.tsx', ligne: 3, motif: '<select>', message: 'Liste native', extrait: '<select>' }],
  });
  assert.equal(natif.issue, 'renvoyer');
  assert.match((natif as { texte: string }).texte, /web\/src\/a\.tsx:3/);
  const epuise = verdictDeFinDeTour({ ...base, fichiersModifies: ['web/src/a.tsx'], renvois: RENVOIS_MAX_DE_LA_PORTE });
  assert.equal(epuise.issue, 'rendre');
  assert.equal((epuise as { raison: string }).raison, 'renvois-epuises');
});
