/**
 * LE SEUL BOUTON DU STUDIO : « Construction » s'allume dès qu'une
 * version se lit et qu'aucune fabrication n'est en cours ; éteint, il dit pourquoi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAISON_AGENT_TRAVAILLE,
  RAISON_FABRICATION_EN_COURS,
  RAISON_PREMIERE_VERSION,
  compositionAUneVoix,
  etapeDeDepartDeConstruction,
  etapesDeConstruction,
  etatDuBoutonDeProduction,
  uneVersionSeLit,
} from '@beluga/shared';

const piste = (genre: 'video' | 'son', durees: number[], masquee = false) => ({
  id: `p-${genre}`,
  nom: genre,
  genre,
  masquee,
  segments: durees.map((duree, i) => ({ id: `s${i}`, debut: 0, duree })),
});

test('une composition vide, ou sans visuel, ne se lit pas', () => {
  assert.equal(uneVersionSeLit(null), false);
  assert.equal(uneVersionSeLit({ pistes: [] }), false);
  assert.equal(uneVersionSeLit({ pistes: [piste('son', [4])] } as any), false);
  assert.equal(uneVersionSeLit({ pistes: [piste('video', [0])] } as any), false);
  assert.equal(uneVersionSeLit({ pistes: [piste('video', [3], true)] } as any), false);
  assert.equal(uneVersionSeLit({ pistes: [piste('video', [3])] } as any), true);
});

test('éteint tant que rien ne se lit, avec sa raison', () => {
  const e = etatDuBoutonDeProduction({ composition: { pistes: [] }, depenses: [] });
  assert.deepEqual(e, { pret: false, raison: RAISON_PREMIERE_VERSION });
});

test('une fabrication validée et pas encore soldée l’éteint ; la voix finale non', () => {
  const composition = { pistes: [piste('video', [3])] } as any;
  assert.equal(etatDuBoutonDeProduction({ composition, depenses: [{ etat: 'validee', genre: 'modele3d' as any }] }).raison, RAISON_FABRICATION_EN_COURS);
  assert.equal(etatDuBoutonDeProduction({ composition, depenses: [{ etat: 'validee', genre: 'voix' }] }).pret, true);
  assert.equal(etatDuBoutonDeProduction({ composition, depenses: [{ etat: 'en-attente', genre: 'clip' }, { etat: 'faite', genre: 'image' }] }).pret, true);
});

test('l’agent qui travaille l’éteint aussi', () => {
  const composition = { pistes: [piste('video', [3])] } as any;
  assert.deepEqual(etatDuBoutonDeProduction({ composition, depenses: [], agentTravaille: true }), { pret: false, raison: RAISON_AGENT_TRAVAILLE });
  assert.deepEqual(etatDuBoutonDeProduction({ composition, depenses: [] }), { pret: true, raison: null });
});

/* LA CONSTRUCTION SUIT LE MÉDIA (capture #3e3a) : pas d'étape « Voix finale » sans voix. */
const visuel = { id: 'scenes', nom: 'Scènes', genre: 'vecteur', segments: [{ id: 'd1', genre: 'dessin', debut: 0, duree: 6 }] };
const musique = { id: 'son', nom: 'Son', genre: 'son', segments: [{ id: 'm1', genre: 'audio', debut: 0, duree: 30, mediaId: 'med1' }] };
const voix = (masque = false, masquee = false) => ({
  id: 'voix',
  nom: 'Voix 1',
  genre: 'voix',
  masquee,
  segments: [{ id: 'v1', genre: 'voix', debut: 0, duree: 4, texte: 'Bonjour.', masque }],
});

test('une vidéo sans voix (scènes + musique) se construit en deux étapes : formats puis fichiers', () => {
  const composition = { pistes: [visuel, musique] } as any;
  assert.equal(compositionAUneVoix(composition), false);
  assert.deepEqual(etapesDeConstruction(composition), ['formats', 'fichiers']);
  assert.equal(etapeDeDepartDeConstruction(etapesDeConstruction(composition), false), 'formats');
});

test('une piste des voix VIDE, un son sur la piste des voix, une voix masquée : toujours pas de voix à fabriquer', () => {
  assert.equal(compositionAUneVoix({ pistes: [visuel, { id: 'voix', nom: 'Voix 1', genre: 'voix', segments: [] }] } as any), false);
  assert.equal(compositionAUneVoix({ pistes: [visuel, { ...musique, id: 'voix', genre: 'voix' }] } as any), false);
  assert.equal(compositionAUneVoix({ pistes: [visuel, voix(true)] } as any), false);
  assert.equal(compositionAUneVoix({ pistes: [visuel, voix(false, true)] } as any), false);
});

test('une vidéo avec une voix garde ses trois étapes et s’ouvre sur la voix finale', () => {
  const composition = { pistes: [visuel, voix(), musique] } as any;
  assert.equal(compositionAUneVoix(composition), true);
  assert.deepEqual(etapesDeConstruction(composition), ['voix', 'formats', 'fichiers']);
  assert.equal(etapeDeDepartDeConstruction(etapesDeConstruction(composition), false), 'voix');
});

test('un export en fabrication rouvre la fenêtre sur les fichiers, avec ou sans voix', () => {
  assert.equal(etapeDeDepartDeConstruction(['voix', 'formats', 'fichiers'], true), 'fichiers');
  assert.equal(etapeDeDepartDeConstruction(['formats', 'fichiers'], true), 'fichiers');
  assert.equal(etapeDeDepartDeConstruction(etapesDeConstruction(null), false), 'formats');
});
