import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAPES_DE_SUIVI,
  barreDeSuivi,
  carteDoitSecouer,
  ecranRegarde,
  etapeCouranteDeSuivi,
  etatDuDeploiement,
  friseDeSuivi,
  passageViseParLeSegment,
  segmentActifDeSuivi,
  tonDeLEtapeDeSuivi,
  tonDuBadgeDEtape,
  tonDuSegmentDeSuivi,
  type PointDuParcours,
} from '@beluga/shared';

/*
 * LA SECOUSSE D'UNE CARTE QUI ATTEND, ET LA FRISE DES CINQ ÉTAPES.
 */

test('une carte secoue tant qu’une décision alertante l’attend', () => {
  assert.equal(carteDoitSecouer({ alertes: 0 }), false);
  assert.equal(carteDoitSecouer({ alertes: 1 }), true);
});

test('ouvrir la carte la calme, une nouvelle décision la relance', () => {
  assert.equal(carteDoitSecouer({ alertes: 1, alertesVues: 1 }), false);
  assert.equal(carteDoitSecouer({ alertes: 2, alertesVues: 1 }), true);
  assert.equal(carteDoitSecouer({ alertes: 0, alertesVues: 1 }), false);
});

test('la frise a toujours cinq ronds, dans l’ordre', () => {
  assert.deepEqual([...ETAPES_DE_SUIVI], ['demande', 'comprehension', 'travail', 'a_deployer', 'archivee']);
  assert.equal(friseDeSuivi({ colonne: 'planned' }).etapes.length, 5);
});

test('l’étape courante suit la colonne et le parcours', () => {
  assert.equal(etapeCouranteDeSuivi({ colonne: 'planned' }), 'demande');
  assert.equal(etapeCouranteDeSuivi({ colonne: 'planned', agentActif: true }), 'comprehension');
  assert.equal(etapeCouranteDeSuivi({ colonne: 'planned', parcours: { comprehension: {} } }), 'comprehension');
  // Le plan n'a pas de rond : il fait partie de « Compréhension ».
  assert.equal(etapeCouranteDeSuivi({ colonne: 'planned', parcours: { plans: [{}] } }), 'comprehension');
  assert.equal(etapeCouranteDeSuivi({ colonne: 'running' }), 'travail');
  // Le rapport rendu range la carte dans « À déployer ».
  assert.equal(etapeCouranteDeSuivi({ colonne: 'to_deploy' }), 'a_deployer');
  assert.equal(etapeCouranteDeSuivi({ colonne: 'archived' }), 'archivee');
});

test('les ronds avant la courante sont faits, ceux d’après à venir', () => {
  const frise = friseDeSuivi({ colonne: 'running', agentActif: true });
  assert.deepEqual(
    frise.etapes.map((e) => e.etat),
    ['fait', 'fait', 'courant', 'avenir', 'avenir'],
  );
  assert.equal(frise.allure, 'travaille');
});

test('une décision attendue prime sur le travail, une carte archivée est au repos', () => {
  assert.equal(friseDeSuivi({ colonne: 'running', agentActif: true, decisionEnAttente: true }).allure, 'attend');
  assert.equal(friseDeSuivi({ colonne: 'planned', parcours: { comprehension: {} } }).allure, 'repos');
  assert.equal(friseDeSuivi({ colonne: 'archived', decisionEnAttente: true }).allure, 'repos');
});

/* ---- La mise en ligne, dans la frise et dans la barre du tiroir ---- */

test('la mise en ligne se lit sur la colonne, la publication et la date', () => {
  assert.equal(etatDuDeploiement({ colonne: 'running' }), 'aucun');
  assert.equal(etatDuDeploiement({ colonne: 'to_deploy' }), 'attend');
  assert.equal(etatDuDeploiement({ colonne: 'to_deploy', enPublication: true }), 'en_cours');
  assert.equal(etatDuDeploiement({ colonne: 'to_deploy', publicationEchouee: true }), 'echec');
  assert.equal(etatDuDeploiement({ colonne: 'archived', deployeeA: 5 }), 'en_ligne');
  assert.equal(etatDuDeploiement({ colonne: 'archived' }), 'archivee');
});

test('« À déployer » attend au repos, part en orange, tombe en rouge', () => {
  assert.equal(friseDeSuivi({ colonne: 'to_deploy' }).allure, 'repos');
  assert.equal(friseDeSuivi({ colonne: 'to_deploy', enPublication: true }).allure, 'travaille');
  assert.equal(friseDeSuivi({ colonne: 'to_deploy', publicationEchouee: true }).allure, 'erreur');
});

const point = (etape: string, etat: string, ancre = etape) => ({ etape, etat, ancre }) as unknown as PointDuParcours;

test('la barre du tiroir a les cinq étapes de la frise, et la même étape désignée', () => {
  const points = [point('configuration', 'fait'), point('demande', 'fait'), point('comprehension', 'fait'), point('travail', 'avenir'), point('rapport', 'avenir')];
  const carte = { colonne: 'planned', parcours: { comprehension: {} } };
  assert.deepEqual(
    barreDeSuivi(points, carte).map((s) => `${s.etape}:${s.etat}`),
    ['demande:fait', 'comprehension:fait', 'travail:avenir', 'a_deployer:avenir', 'archivee:avenir'],
  );
  assert.equal(segmentActifDeSuivi(carte), etapeCouranteDeSuivi(carte));
  assert.equal(segmentActifDeSuivi(carte), 'comprehension');
});

test('un plan en cours garde « Compréhension » orange, une question la passe en attente', () => {
  const base = [point('demande', 'fait'), point('comprehension', 'fait')];
  const avecPlan = barreDeSuivi([...base, point('plan', 'encours')], { colonne: 'planned' });
  assert.equal(avecPlan.find((s) => s.etape === 'comprehension')?.etat, 'encours');
  const question = barreDeSuivi([point('demande', 'fait'), point('comprehension', 'question')], { colonne: 'planned' });
  assert.equal(question.find((s) => s.etape === 'comprehension')?.etat, 'question');
});

test('le rapport rendu clôt « Travail » ; la carte rangée et en ligne est bleue jusqu’au bout', () => {
  const points = [point('demande', 'fait'), point('comprehension', 'fait'), point('travail', 'fait'), point('rapport', 'fait')];
  assert.deepEqual(
    barreDeSuivi(points, { colonne: 'archived', deployeeA: 9 }).map((s) => s.etat),
    ['fait', 'fait', 'fait', 'fait', 'fait'],
  );
  const attend = barreDeSuivi(points, { colonne: 'to_deploy' });
  assert.equal(attend.find((s) => s.etape === 'a_deployer')?.etat, 'avenir', 'attendre n’est pas « en cours »');
  assert.equal(segmentActifDeSuivi({ colonne: 'to_deploy' }), 'a_deployer', '…mais c’est l’étape désignée');
  assert.equal(barreDeSuivi(points, { colonne: 'to_deploy', enPublication: true })[3].etat, 'encours');
  assert.equal(barreDeSuivi(points, { colonne: 'to_deploy', publicationEchouee: true })[3].etat, 'erreur');
});

test('une carte en ligne ou en publication ne garde aucune étape amont « en cours »', () => {
  /* Un passage « Travail » vide, resté ouvert après une compréhension qui a seulement répondu. */
  const points = [point('demande', 'fait'), point('comprehension', 'fait'), point('travail', 'encours')];
  assert.deepEqual(
    barreDeSuivi(points, { colonne: 'archived', deployeeA: 9 }).map((s) => s.etat),
    ['fait', 'fait', 'fait', 'fait', 'fait'],
  );
  assert.equal(barreDeSuivi(points, { colonne: 'to_deploy', enPublication: true })[2].etat, 'fait');
  assert.equal(barreDeSuivi(points, { colonne: 'running' })[2].etat, 'encours', 'un vrai travail reste en cours');
  const question = [point('demande', 'fait'), point('comprehension', 'question')];
  assert.equal(barreDeSuivi(question, { colonne: 'archived' })[1].etat, 'question', 'une vraie question reste visible');
});

test('un segment vise le dernier passage commencé de son groupe', () => {
  const points = [
    point('demande', 'fait', 'd1'),
    point('comprehension', 'fait', 'c1'),
    point('plan', 'fait', 'p1'),
    point('travail', 'fait', 't1'),
    point('rapport', 'avenir', 'r1'),
  ];
  assert.equal(passageViseParLeSegment(points, 'comprehension')?.ancre, 'p1');
  assert.equal(passageViseParLeSegment(points, 'travail')?.ancre, 't1');
  assert.equal(passageViseParLeSegment([point('demande', 'avenir', 'd0'), point('travail', 'avenir', 't0')], 'travail')?.ancre, 't0');
});

/* ---- La lecture implicite n'a lieu que sous les yeux ---------------- */

test('frise : jaune au travail, bleu qui clignote si un geste attend, bleu fixe sinon', () => {
  const tons = (carte: Parameters<typeof friseDeSuivi>[0]) => {
    const frise = friseDeSuivi(carte);
    return frise.etapes.map(({ etape }) => tonDeLEtapeDeSuivi(frise, etape));
  };
  assert.deepEqual(tons({ colonne: 'running', agentActif: true }), ['valide', 'valide', 'travail', 'avenir', 'avenir']);
  assert.deepEqual(tons({ colonne: 'planned', parcours: { comprehension: {} }, decisionEnAttente: true }), [
    'valide', 'a_voir', 'avenir', 'avenir', 'avenir',
  ]);
  assert.deepEqual(tons({ colonne: 'to_deploy' }), ['valide', 'valide', 'valide', 'fini', 'avenir']);
  assert.deepEqual(tons({ colonne: 'to_deploy', publicationEchouee: true }).at(3), 'erreur');
  assert.deepEqual(tons({ colonne: 'planned' }).at(0), 'neutre');
  // Arrivée : tout est validé, la dernière étape comprise.
  assert.deepEqual(tons({ colonne: 'archived', deployeeA: 1 }), ['valide', 'valide', 'valide', 'valide', 'valide']);
});

test('barre du tiroir : un segment fait est validé, sauf l’étape où se trouve la carte', () => {
  assert.equal(tonDuSegmentDeSuivi({ etape: 'comprehension', etat: 'fait' }, 'travail'), 'valide');
  assert.equal(tonDuSegmentDeSuivi({ etape: 'comprehension', etat: 'fait' }, 'comprehension'), 'fini');
  assert.equal(tonDuSegmentDeSuivi({ etape: 'archivee', etat: 'fait' }, 'archivee'), 'valide');
  assert.equal(tonDuSegmentDeSuivi({ etape: 'travail', etat: 'encours' }, 'travail'), 'travail');
  assert.equal(tonDuSegmentDeSuivi({ etape: 'comprehension', etat: 'question' }, 'comprehension'), 'a_voir');
  assert.equal(tonDuSegmentDeSuivi({ etape: 'a_deployer', etat: 'erreur' }, 'a_deployer'), 'erreur');
  assert.equal(tonDuSegmentDeSuivi({ etape: 'archivee', etat: 'avenir' }, 'travail'), 'avenir');
});

test('une conversation n’est lue que si la page est visible ET au premier plan', () => {
  assert.equal(ecranRegarde({ visibilite: 'visible', auPremierPlan: true }), true);
  assert.equal(ecranRegarde({ visibilite: 'hidden', auPremierPlan: true }), false);
  assert.equal(ecranRegarde({ visibilite: 'visible', auPremierPlan: false }), false);
});

test('le badge de statut est jaune à la compréhension, violet au travail, neutre ailleurs', () => {
  assert.equal(tonDuBadgeDEtape('comprehension'), 'comprehension');
  assert.equal(tonDuBadgeDEtape('travail'), 'travail');
  for (const etape of ['demande', 'a_deployer', 'archivee', 'examen', 'propositions', 'creation', 'cahier', 'termine'] as const) {
    assert.equal(tonDuBadgeDEtape(etape), null, etape);
  }
  // La couleur suit l'étape de la carte, même sans agent qui tourne.
  const repos = { colonne: 'running' } as const;
  assert.equal(tonDuBadgeDEtape(etapeCouranteDeSuivi(repos)), 'travail');
  assert.equal(tonDuBadgeDEtape(etapeCouranteDeSuivi({ colonne: 'planned', agentActif: true })), 'comprehension');
  assert.equal(tonDuBadgeDEtape(etapeCouranteDeSuivi({ colonne: 'planned' })), null);
});

test('« À déployer » devient « Déployé » une fois la carte en ligne (13/11/2026, #b6079)', async () => {
  const { libelleDeLEtapeDeSuivi } = await import('@beluga/shared');
  assert.equal(libelleDeLEtapeDeSuivi('a_deployer'), 'À déployer');
  assert.equal(libelleDeLEtapeDeSuivi('a_deployer', { deployeeA: undefined }), 'À déployer');
  assert.equal(libelleDeLEtapeDeSuivi('a_deployer', { deployeeA: 1_700_000_000_000 }), 'Déployé');
  assert.equal(libelleDeLEtapeDeSuivi('travail', { deployeeA: 1_700_000_000_000 }), 'Travail');
});
