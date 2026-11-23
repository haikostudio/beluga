import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JALON_TOUR_LANCE,
  LABEL_AUTO_AMELIORATION,
  LABEL_RENDEZ_VOUS_DE_NUIT,
  PHRASES_DE_LA_NUIT,
  barreDeSuivi,
  estCarteDuRendezVousDeNuit,
  etapeDeSuiviDuPoint,
  etapesDuFluxSous,
  friseDeSuivi,
  passageViseParLeSegment,
  pointsDuParcours,
  propositionsDeLaNuit,
  segmentActifDeSuivi,
  tonDuSegmentDeSuivi,
} from '@beluga/shared';

/*
 * LA CARTE DU RENDEZ-VOUS DE NUIT SE LIT DEMANDE, EXAMEN, PROPOSITIONS.
 *
 * Elle imitait une tâche : « Compréhension » sautée, « Travail fait »,
 * « À déployer » puis « Archivée » (capture du 07.10.2026). Ces tests
 * verrouillent son parcours à elle, et vérifient qu'aucune autre carte — pas
 * même celles que la nuit propose — n'en hérite.
 */

let rang = 0;
const e = (partiel: Record<string, unknown>) => ({
  id: `n${rang}`,
  cardId: 'nuit',
  rang: rang++,
  at: 1000 + rang,
  nature: 'requete',
  phase: 'execution',
  agentRole: 'analysis',
  libelle: '',
  ...partiel,
});

/* Le journal réel d'une nuit : ni demande, ni compréhension — un tour, des
   points examinés, des lectures, une note, puis le compte rendu. */
const tour = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE });
const point1 = e({ nature: 'point', libelle: 'Relire les fiches de mémoire modifiées depuis hier' });
const lecture = e({ outil: 'memoire', libelle: 'memoire', params: '{"geste":"lire"}', resultat: '# MEM-1' });
const note = e({ nature: 'jalon', libelle: 'Note de l’agent', resultat: 'Je cherche du code mort.' });
const rendu = e({ phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', resultat: 'Cette nuit, deux propositions.' });
const JOURNAL = [tour, point1, lecture, note, rendu];

const DESCRIPTION = 'Un agent d’analyse relit « Beluga » et propose au plus trois améliorations.';
const PROPOSITIONS = [
  { titre: 'Rangement de nuit : paragraphe en double', cardId: 'carte-a' },
  { titre: 'Six fonctions orphelines', cardId: 'carte-b' },
];
const ctxRange = {
  chapitre: 'rapport',
  colonne: 'archived',
  tourEnCours: false,
  parcours: null,
  descriptionDeLaCarte: DESCRIPTION,
  creeeA: 900,
  rendezVousDeNuit: { propositions: PROPOSITIONS },
} as const;

const titres = (points: any[]) => points.map((p) => `${p.etape}:${p.titre ?? ''}:${p.etat}`);

test('le prédicat ne reconnaît que l’étiquette exacte du rendez-vous', () => {
  assert.equal(estCarteDuRendezVousDeNuit({ labels: [LABEL_RENDEZ_VOUS_DE_NUIT] }), true);
  // Les cartes PROPOSÉES par la nuit gardent leur parcours de tâche.
  assert.equal(estCarteDuRendezVousDeNuit({ labels: [LABEL_AUTO_AMELIORATION] }), false);
  assert.equal(estCarteDuRendezVousDeNuit({ labels: [] }), false);
  assert.equal(estCarteDuRendezVousDeNuit({}), false);
  assert.equal(estCarteDuRendezVousDeNuit(undefined), false);
});

test('les cartes nées de la nuit se lisent sur les propositions acceptées', () => {
  const messages = [
    { proposals: [] },
    {
      proposals: [
        { title: 'A', decision: 'accepted', cardId: 'ca' },
        { title: 'B', decision: 'refused' },
        { title: 'C', decision: 'merged' },
        { title: 'D', decision: 'accepted' },
      ],
    },
    {},
  ];
  assert.deepEqual(propositionsDeLaNuit(messages), [{ titre: 'A', cardId: 'ca' }, { titre: 'D' }]);
});

test('une nuit rangée : Demande, Examen, Propositions — rien d’autre, rien de sauté', () => {
  const points = pointsDuParcours(JOURNAL as any, ctxRange as any);
  assert.deepEqual(titres(points), ['demande:Demande:fait', 'travail:Examen:fait', 'rapport:Propositions:fait']);
  assert.ok(points.every((p) => !p.sautee), 'aucune étape « sautée »');
  // La demande se lit sur la description de la carte, faute de jalon.
  assert.equal(points[0].moments[0]?.entree.resultat, DESCRIPTION);
  // L'examen garde les actions de l'agent.
  assert.ok(points[1].traces.length >= 2);
  assert.equal(points[1].phrase, PHRASES_DE_LA_NUIT.examen.fait);
  // Les propositions : le compte rendu, puis les cartes.
  assert.ok(points[2].moments.some((m) => m.sorte === 'rapport'));
  assert.deepEqual(points[2].propositions, PROPOSITIONS);
  assert.equal(points[2].phrase, PHRASES_DE_LA_NUIT.propositions.cartes);
});

test('zéro proposition se dit, et un fil pas encore arrivé ne dit pas « aucune »', () => {
  const vide = pointsDuParcours(JOURNAL as any, { ...ctxRange, rendezVousDeNuit: { propositions: [] } } as any);
  assert.equal(vide[2].phrase, PHRASES_DE_LA_NUIT.propositions.aucune);
  const inconnu = pointsDuParcours(JOURNAL as any, { ...ctxRange, rendezVousDeNuit: {} } as any);
  assert.equal(inconnu[2].phrase, PHRASES_DE_LA_NUIT.propositions.rendues);
  assert.equal(inconnu[2].propositions, undefined);
});

test('pendant le tour, l’examen tourne et les propositions sont à venir', () => {
  const points = pointsDuParcours(
    [tour, point1, lecture] as any,
    { ...ctxRange, chapitre: 'travail', colonne: 'running', tourEnCours: true, rendezVousDeNuit: {} } as any,
  );
  assert.deepEqual(titres(points), ['demande:Demande:fait', 'travail:Examen:encours', 'rapport:Propositions:avenir']);
  assert.equal(points[2].phrase, PHRASES_DE_LA_NUIT.propositions.avenir);
});

test('une panne se dit en clair sur l’examen, et rien n’est proposé', () => {
  const panne = 'Le tour de l’agent est tombé sans aboutir : session expirée';
  const points = pointsDuParcours(
    [tour, point1, lecture] as any,
    { ...ctxRange, chapitre: 'travail', colonne: 'planned', rendezVousDeNuit: { propositions: [], panne } } as any,
  );
  assert.deepEqual(titres(points), ['demande:Demande:fait', 'travail:Examen:erreur', 'rapport:Propositions:avenir']);
  assert.ok(points[1].erreurs.some((erreur) => erreur.texte === panne));
  assert.equal(points[2].phrase, PHRASES_DE_LA_NUIT.propositions.interrompu);
});

test('une carte ordinaire garde son parcours de tâche', () => {
  const { rendezVousDeNuit: _, ...ordinaire } = ctxRange;
  const points = pointsDuParcours(JOURNAL as any, ordinaire as any);
  assert.ok(points.some((p) => p.etape === 'comprehension'));
  assert.ok(points.every((p) => p.titre === undefined && p.propositions === undefined));
});

test('la barre et la frise de la nuit ont trois ronds, sans « À déployer » ni « Archivée »', () => {
  const points = pointsDuParcours(JOURNAL as any, ctxRange as any);
  const suivi = { colonne: 'archived', rendezVousDeNuit: true };
  assert.deepEqual(barreDeSuivi(points, suivi), [
    { etape: 'demande', etat: 'fait' },
    { etape: 'examen', etat: 'fait' },
    { etape: 'propositions', etat: 'fait' },
  ]);
  assert.equal(segmentActifDeSuivi(suivi), 'propositions');
  // L'arrivée est validée (bleu fixe), comme « Archivée » pour une tâche.
  assert.equal(tonDuSegmentDeSuivi({ etape: 'propositions', etat: 'fait' }, 'propositions'), 'valide');
  const frise = friseDeSuivi(suivi);
  assert.deepEqual(frise.etapes.map((x) => x.etape), ['demande', 'examen', 'propositions']);
  assert.equal(frise.allure, 'repos');
  // Pendant le tour, ou après une panne, la carte est à l'examen.
  assert.equal(segmentActifDeSuivi({ colonne: 'running', agentActif: true, rendezVousDeNuit: true }), 'examen');
  assert.equal(segmentActifDeSuivi({ colonne: 'planned', rendezVousDeNuit: true }), 'examen');
  // Une tâche garde ses cinq ronds.
  assert.equal(barreDeSuivi(points, { colonne: 'archived' }).length, 5);
});

test('chaque segment de la nuit vise son point, et chaque point son segment', () => {
  const points = pointsDuParcours(JOURNAL as any, ctxRange as any);
  assert.deepEqual(etapesDuFluxSous('examen'), ['travail']);
  assert.deepEqual(etapesDuFluxSous('propositions'), ['rapport']);
  assert.equal(passageViseParLeSegment(points, 'examen')?.etape, 'travail');
  assert.equal(passageViseParLeSegment(points, 'propositions')?.etape, 'rapport');
  assert.equal(etapeDeSuiviDuPoint('travail', true), 'examen');
  assert.equal(etapeDeSuiviDuPoint('rapport', true), 'propositions');
  assert.equal(etapeDeSuiviDuPoint('rapport', false), 'travail');
});
