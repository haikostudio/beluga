import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITRES_DU_MONTAGE,
  etapesPrevuesDepuisGithub,
  etapesPrevuesDuMontageNeuf,
  lignesDuMontage,
  titreDEtape,
} from '@beluga/shared';
import { carnetDuMontage } from '../projects.js';

test('un projet neuf par défaut prévoit git, GitHub, les branches et l’inscription', () => {
  assert.deepEqual(etapesPrevuesDuMontageNeuf({}), ['dossier', 'port', 'fichiers', 'git', 'github', 'branches', 'inscription']);
});

test('un dépôt distant donné à la main remplace la création sur GitHub', () => {
  assert.deepEqual(
    etapesPrevuesDuMontageNeuf({ gitRemote: 'git@exemple:a/b.git', github: true }),
    ['dossier', 'port', 'fichiers', 'git', 'distant', 'branches', 'inscription'],
  );
});

test('sans git, ni dépôt ni branches ; adresse et cahier s’ajoutent à leur place', () => {
  assert.deepEqual(etapesPrevuesDuMontageNeuf({ git: false, sousDomaine: 'site', port: 3000, cahier: true }), [
    'dossier',
    'port',
    'fichiers',
    'adresse',
    'inscription',
    'cahier',
  ]);
});

test('une moitié d’adresse est tentée aussi : le démon dira ce qui manque', () => {
  assert.ok(etapesPrevuesDuMontageNeuf({ sousDomaine: 'site' }).includes('adresse'));
  assert.ok(!etapesPrevuesDuMontageNeuf({ sousDomaine: '  ' }).includes('adresse'));
});

test('depuis GitHub : récupération, branches, puis le reste', () => {
  assert.deepEqual(etapesPrevuesDepuisGithub({}), ['clone', 'branches', 'inscription']);
  assert.deepEqual(etapesPrevuesDepuisGithub({ sousDomaine: 'x', port: 4000, cahier: true }), [
    'clone',
    'branches',
    'adresse',
    'inscription',
    'cahier',
  ]);
});

test('une étape ratée porte sa propre phrase', () => {
  assert.equal(titreDEtape('github', true), 'Dépôt GitHub créé et poussé');
  assert.equal(titreDEtape('github', false), 'Dépôt GitHub non créé');
  assert.equal(titreDEtape('dossier', false), TITRES_DU_MONTAGE.dossier.fait);
});

test('la liste affichée : notées, en cours, à venir, dans l’ordre prévu', () => {
  const prevues = etapesPrevuesDuMontageNeuf({});
  const lignes = lignesDuMontage(
    prevues,
    [
      { cle: 'dossier', titre: titreDEtape('dossier', true), fait: true, detail: '/root/x' },
      { cle: 'port', titre: titreDEtape('port', true), fait: true },
      { cle: 'fichiers', titre: titreDEtape('fichiers', true), fait: true },
      { cle: 'git', titre: titreDEtape('git', false), fait: false, detail: 'refus' },
    ],
    'github',
  );
  assert.deepEqual(
    lignes.map((ligne) => ligne.etat),
    ['fait', 'fait', 'fait', 'rate', 'en-cours', 'a-venir', 'a-venir'],
  );
  assert.equal(lignes[3].titre, 'Dépôt git non démarré');
  assert.equal(lignes[3].detail, 'refus');
  assert.equal(lignes[5].titre, TITRES_DU_MONTAGE.branches.fait);
});

test('une étape notée hors prévision (ancien démon, sans clé) n’est jamais perdue', () => {
  const lignes = lignesDuMontage(['dossier'], [{ titre: 'Étape inconnue', fait: true }]);
  assert.deepEqual(
    lignes.map((ligne) => [ligne.titre, ligne.etat]),
    [
      [TITRES_DU_MONTAGE.dossier.fait, 'a-venir'],
      ['Étape inconnue', 'fait'],
    ],
  );
});

test('le carnet du démon dit chaque étape commencée puis finie, avec les titres partagés', () => {
  const dits: { etapes: number; enCours?: string }[] = [];
  const carnet = carnetDuMontage((etapes, enCours) => dits.push({ etapes: etapes.length, enCours }));
  carnet.commencer('dossier');
  carnet.noter('dossier', true, '/root/x');
  carnet.commencer('github');
  carnet.noter('github', false, 'refus');
  carnet.ajouter('adresse', { titre: 'Adresse publique créée', fait: true });
  assert.deepEqual(dits, [
    { etapes: 0, enCours: 'dossier' },
    { etapes: 1, enCours: undefined },
    { etapes: 1, enCours: 'github' },
    { etapes: 2, enCours: undefined },
    { etapes: 3, enCours: undefined },
  ]);
  assert.deepEqual(
    carnet.etapes.map((etape) => [etape.cle, etape.titre, etape.fait]),
    [
      ['dossier', 'Dossier créé sur le serveur', true],
      ['github', 'Dépôt GitHub non créé', false],
      ['adresse', 'Adresse publique créée', true],
    ],
  );
});

test('un écran qui ne suit plus ne casse jamais le montage', () => {
  const carnet = carnetDuMontage(() => {
    throw new Error('canal fermé');
  });
  carnet.commencer('dossier');
  carnet.noter('dossier', true);
  assert.equal(carnet.etapes.length, 1);
});

test('le bilan d’un montage réussi est vide : la fenêtre se referme', async () => {
  const { bilanDuMontageRate } = await import('@beluga/shared');
  assert.equal(bilanDuMontageRate([{ cle: 'dossier', titre: 'Dossier créé sur le serveur', fait: true }]), null);
  assert.equal(bilanDuMontageRate([]), null);
});

test('le bilan d’un échec partiel nomme les étapes ratées et dit que le projet existe', async () => {
  const { bilanDuMontageRate } = await import('@beluga/shared');
  const bilan = bilanDuMontageRate([
    { cle: 'dossier', titre: 'Dossier créé sur le serveur', fait: true },
    { cle: 'github', titre: 'Dépôt GitHub non créé', fait: false, detail: 'gh a refusé' },
    { cle: 'branches', titre: 'Branches « dev » et « main » en place', fait: true },
    { cle: 'cahier', titre: 'Carte « Cahier des charges » non posée', fait: false },
    { cle: 'inscription', titre: 'Projet inscrit dans la colonne de gauche', fait: true },
  ]);
  assert.ok(bilan);
  assert.deepEqual(
    bilan.ratees.map((etape) => [etape.cle, etape.detail]),
    [
      ['github', 'gh a refusé'],
      ['cahier', undefined],
    ],
  );
  assert.equal(bilan.projetInscrit, true);
});

test('une inscription notée ratée se dit : le projet n’est pas dans la colonne', async () => {
  const { bilanDuMontageRate } = await import('@beluga/shared');
  const bilan = bilanDuMontageRate([{ cle: 'inscription', titre: 'Projet inscrit dans la colonne de gauche', fait: false }]);
  assert.equal(bilan?.projetInscrit, false);
});
