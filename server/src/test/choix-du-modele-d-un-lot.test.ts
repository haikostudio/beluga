import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * LE CHOIX DU MODÈLE DANS L'ENCART « GÉNÉRER » (01/11/2026) : les règles pures — capacités au menu, compatibilité
 * avec la demande, total, tri, prix vu revérifié, dernier modèle utilisé et ligne de conseil.
 */
const {
  capaciteAuMenuDesModeles,
  derniersModelesUtilises,
  incompatibiliteAvecLaDemande,
  ligneDesDerniersModeles,
  noteDuModeleConseille,
  refusDuPrixVu,
  totalDuMenu,
  trierLeMenuDesModeles,
  questionDUneGeneration,
} = await import('@beluga/shared');

test('images, vidéos, musiques et sons ont le menu ; voix, 3D et retouches non', () => {
  for (const c of ['image', 'video', 'animation', 'musique', 'son']) assert.ok(capaciteAuMenuDesModeles(c), c);
  for (const c of ['voix', 'avatar', 'synchro', 'angles', 'lumiere', 'visage', 'retouche', 'mouvement']) assert.ok(!capaciteAuMenuDesModeles(c), c);
});

test('un modèle qui ne sait pas faire la demande est écarté', () => {
  assert.equal(incompatibiliteAvecLaDemande({ durees: [5, 10] }, { duree: 5 }), null);
  assert.match(incompatibiliteAvecLaDemande({ durees: [5, 10] }, { duree: 7 })!, /7 s/);
  assert.match(incompatibiliteAvecLaDemande({ fin: false }, { fin: 'piece' })!, /image donnée/);
  assert.equal(incompatibiliteAvecLaDemande({ fin: true }, { fin: 'piece' }), null);
  assert.equal(incompatibiliteAvecLaDemande({}, {}), null);
});

test('le total : la somme, ou « prix non publié » dès qu’une ligne en manque', () => {
  assert.equal(totalDuMenu([0.004, 0.004]), 0.008);
  assert.equal(totalDuMenu([1.5, null]), null);
  assert.equal(totalDuMenu([]), null);
});

test('le menu : le modèle actuel d’abord, puis la qualité, puis le moins cher ; pas de doublon', () => {
  const l = (modele: string, qualite: number, prix: number | null, actuel = false) => ({ service: 'kie', modele, nom: modele, usage: '', qualite, prix, ...(actuel ? { actuel } : {}) });
  const tries = trierLeMenuDesModeles([l('b', 5, 2), l('a', 3, 1, true), l('c', 5, 1), l('c', 5, 1)]);
  assert.deepEqual(tries.map((x) => x.modele), ['a', 'c', 'b']);
});

test('le prix vu fait foi : une hausse ou un prix devenu inconnu est refusé, une baisse passe', () => {
  assert.equal(refusDuPrixVu(1.5, 1.5), null);
  assert.equal(refusDuPrixVu(1.2, 1.5), null);
  assert.match(refusDuPrixVu(1.8, 1.5)!, /a monté/);
  assert.match(refusDuPrixVu(null, 1.5)!, /plus publié/);
  assert.equal(refusDuPrixVu(null, null), null);
  assert.equal(refusDuPrixVu(2, null), null);
});

test('le dernier modèle utilisé par capacité : ni devis ni refus, le plus récent gagne', () => {
  const m = (capacite: string, modele: string, etat: string, creeLe: number) => ({ capacite, service: 'kie', modele, modeleNom: modele.toUpperCase(), etat, creeLe });
  const derniers = derniersModelesUtilises([
    m('animation', 'kling', 'fini', 1),
    m('animation', 'seedance', 'fini', 5),
    m('animation', 'wan', 'devis', 9),
    m('animation', 'veo', 'refuse', 10),
    m('image', 'z-image', 'echec', 3),
    m('voix', 'eleven', 'fini', 4),
  ]);
  assert.equal(derniers.get('animation')?.modele, 'seedance');
  assert.equal(derniers.get('image')?.modele, 'z-image', 'une génération partie compte, même en panne');
  assert.equal(derniers.has('voix'), false);
  assert.match(ligneDesDerniersModeles(derniers), /MÊME modèle/);
  assert.equal(ligneDesDerniersModeles(new Map()), '');
});

test('un autre modèle que le précédent se signale dans l’encart, avec la raison de l’agent', () => {
  assert.equal(noteDuModeleConseille({ precedent: { modele: 'kling', nom: 'Kling 3.0' }, propose: 'kling', raison: 'x' }), null);
  assert.equal(noteDuModeleConseille({ precedent: undefined, propose: 'kling', raison: 'x' }), null);
  assert.equal(noteDuModeleConseille({ precedent: { modele: 'kling', nom: 'Kling 3.0' }, propose: 'seedance', raison: 'plus fluide pour un travelling' }), 'Conseillé à la place de Kling 3.0 : plus fluide pour un travelling');
  const q = questionDUneGeneration({ lotId: 'l', titre: 'T', lignes: [{ plan: 'p', modele: 'Seedance', service: 'kie.ai', prix: 1 }], depense: 0, conseil: 'Conseillé à la place de Kling 3.0' });
  assert.equal(q.devis.conseil, 'Conseillé à la place de Kling 3.0');
  assert.equal(questionDUneGeneration({ lotId: 'l', titre: 'T', lignes: [], depense: 0 }).devis.conseil, undefined);
});
