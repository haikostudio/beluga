/**
 * MESHY, LE SERVICE 3D DU STUDIO : demandes, lecture des réponses (simulées),
 * prix du devis, et garde — l'agent ne l'appelle jamais en direct.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDITS_MESHY,
  commandeFabriqueHorsDeKie,
  devisPersonnage3d,
  dureeDuMouvement3d,
  glbDeLaTache,
  lireCatalogueMeshy,
  lireCreationMeshy,
  lireSuiviMeshy,
  mouvementsDemandes,
  requeteDeTest,
  requeteDesMouvements,
  requeteDuSquelette,
  requeteImageVers3d,
  serviceDeCreation,
  verdictDuTest,
} from '@beluga/shared';

test('Meshy est un service de création, testé par son solde (gratuit)', () => {
  assert.equal(serviceDeCreation('meshy')?.nom, 'Meshy');
  const r = requeteDeTest('meshy', 'msy_x');
  assert.equal(r.adresse, 'https://api.meshy.ai/openapi/v1/balance');
  assert.equal(r.entetes.Authorization, 'Bearer msy_x');
  assert.equal(verdictDuTest('meshy', 401).ok, false);
  assert.equal(verdictDuTest('meshy', 200).ok, true);
});

test('les demandes suivent la documentation : image en data URI, squelette, mouvements groupés', () => {
  const image = requeteImageVers3d('k', 'data:image/png;base64,AAAA');
  assert.equal(image.adresse, 'https://api.meshy.ai/openapi/v1/image-to-3d');
  assert.deepEqual(
    { url: (image.corps as any).image_url, tex: (image.corps as any).should_texture, pose: (image.corps as any).pose_mode },
    { url: 'data:image/png;base64,AAAA', tex: true, pose: 'a-pose' },
  );
  assert.deepEqual(requeteDuSquelette('k', 't1').corps, { input_task_id: 't1', height_meters: 1.7 });
  assert.deepEqual(requeteDesMouvements('k', 'r1', [25, 28]).corps, { rig_task_id: 'r1', action_ids: [25, 28] });
});

test('création et suivi d’une tâche : identifiant, attente, fin avec crédits, échec remboursé', () => {
  assert.deepEqual(lireCreationMeshy('image-to-3d', 202, { result: 'abc' }), { ok: true, id: 'abc' });
  assert.match((lireCreationMeshy('rigging', 422, {}) as any).raison, /humanoïde/);
  assert.match((lireCreationMeshy('image-to-3d', 402, {}) as any).raison, /crédit Meshy est épuisé/);
  assert.deepEqual(lireSuiviMeshy(200, { status: 'IN_PROGRESS', progress: 40 }), { etat: 'attente', progression: 40 });
  assert.equal(lireSuiviMeshy(503, {}).etat, 'attente');
  const fini = lireSuiviMeshy(200, { status: 'SUCCEEDED', consumed_credits: 30, model_urls: { glb: 'https://assets.meshy.ai/m.glb' } });
  assert.equal(fini.etat, 'fini');
  assert.equal((fini as any).credits, 30);
  assert.equal(glbDeLaTache('image-to-3d', (fini as any).tache), 'https://assets.meshy.ai/m.glb');
  const echec = lireSuiviMeshy(200, { status: 'FAILED', task_error: { message: 'mauvaise image' } });
  assert.deepEqual(echec, { etat: 'echec', raison: 'mauvaise image', rembourse: true });
});

test('le squelette rend la marche et la course offertes ; un mouvement payé rend son propre fichier', () => {
  const rig = { result: { rigged_character_glb_url: 'https://a/rig.glb', basic_animations: { walking_glb_url: 'https://a/walk.glb', running_glb_url: 'https://a/run.glb' } } };
  assert.equal(glbDeLaTache('rigging', rig), 'https://a/rig.glb');
  assert.equal(glbDeLaTache('rigging', rig, 'walking'), 'https://a/walk.glb');
  assert.equal(glbDeLaTache('animations', { result: { animation_glb_url: 'https://a/anim.glb' } }), 'https://a/anim.glb');
  assert.equal(glbDeLaTache('animations', { result: { animation_glb_url: 'http://pas-sur/anim.glb' } }), null);
});

test('le catalogue public écarte les deux mouvements offerts ; une demande hors catalogue est refusée', () => {
  const catalogue = lireCatalogueMeshy({ result: { list: [{ id: -2, name: 'Walking' }, { id: 28, name: 'Big Wave Hello', category: 'DailyActions', subCategory: 'Interacting' }] } });
  assert.deepEqual(catalogue, [{ id: 28, nom: 'Big Wave Hello', categorie: 'DailyActions', sousCategorie: 'Interacting' }]);
  assert.deepEqual(mouvementsDemandes(undefined, catalogue), { ok: true, ids: [-2] });
  assert.deepEqual(mouvementsDemandes([28, '-1'], catalogue), { ok: true, ids: [28, -1] });
  assert.equal(mouvementsDemandes([999], catalogue).ok, false);
  assert.equal(mouvementsDemandes([28, -1, -2, 28], catalogue).ok, false);
});

test('le devis : modèle et squelette une fois, puis 3 crédits par mouvement payé ; la marche est offerte', () => {
  const neuf = devisPersonnage3d({ modeleNeuf: true, mouvements: [-2, 28] });
  assert.equal(neuf.credits, CREDITS_MESHY.modele + CREDITS_MESHY.squelette + CREDITS_MESHY.mouvement);
  assert.equal(neuf.dollars, 0.76);
  assert.deepEqual(devisPersonnage3d({ modeleNeuf: false, mouvements: [-2] }), { credits: 0, dollars: 0, payants: [] });
  assert.equal(devisPersonnage3d({ modeleNeuf: false, mouvements: [28, 25], dollarsParCredit: 0.01 }).dollars, 0.06);
  assert.equal(dureeDuMouvement3d(undefined), 4);
  assert.equal(dureeDuMouvement3d(60), 10);
});

test('la garde refuse un appel direct de l’agent à Meshy, sans rouvrir fal.ai ni Higgsfield', () => {
  assert.equal(commandeFabriqueHorsDeKie('curl -X POST https://api.meshy.ai/openapi/v1/image-to-3d -d @x').refusee, true);
  assert.equal(commandeFabriqueHorsDeKie('curl https://api.meshy.ai/openapi/v1/rigging').refusee, true);
  assert.equal(commandeFabriqueHorsDeKie('curl https://api.meshy.ai/web/public/animations/resources').refusee, false);
  assert.equal(commandeFabriqueHorsDeKie('curl https://queue.fal.run/fal-ai/veo3').refusee, true);
  assert.equal(commandeFabriqueHorsDeKie('curl https://api.higgsfield.ai/x').refusee, true);
});
