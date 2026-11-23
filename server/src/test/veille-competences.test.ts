import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENTE_PLACE_MAX_MS,
  CRITERES_DE_SOURCE,
  JOUR_DE_LA_VEILLE,
  HEURE_DE_LA_VEILLE,
  LABEL_AUTO_AMELIORATION,
  LABEL_VEILLE_COMPETENCES,
  PERIODE_DE_LA_VEILLE_MS,
  SOURCES_MAX_PAR_PASSAGE,
  SOURCES_VUES_MAX,
  consigneDeVeilleDeCompetences,
  creneauDeLaVeille,
  decisionDeLaVeille,
  demandeDeCadrageDeLaVeille,
  fusionnerSourcesVues,
  rapportDeLaVeille,
  sourcesCitees,
} from '@beluga/shared';

/*
 * LA VEILLE DES SOURCES DE COMPÉTENCES. Ce que ces tests verrouillent :
 *   1. un passage par semaine, au créneau seulement, jamais en pleine journée ;
 *   2. sans place, ou pendant l'auto-amélioration, elle ATTEND au lieu de sauter ;
 *   3. la consigne interdit de modifier, d'importer et d'aller sur X ;
 *   4. une source déjà examinée n'est pas rouverte.
 */

const DIMANCHE_1H = new Date(2026, 9, 11, HEURE_DE_LA_VEILLE, 20).getTime();

function base(surcharges: Partial<Parameters<typeof decisionDeLaVeille>[0]> = {}) {
  return decisionDeLaVeille({
    projetPresent: true,
    maintenant: DIMANCHE_1H,
    jourCourant: JOUR_DE_LA_VEILLE,
    heureCourante: HEURE_DE_LA_VEILLE,
    placeLibre: true,
    autreRendezVousEnCours: false,
    attenteMaxMs: ATTENTE_PLACE_MAX_MS,
    ...surcharges,
  });
}

test('le dimanche vers 1 h, place libre et sans passage de la semaine : la veille part', () => {
  assert.deepEqual(base(), { lancer: true });
});

test('hors du créneau — un autre jour, ou en pleine journée — elle ne part pas', () => {
  assert.equal(creneauDeLaVeille(JOUR_DE_LA_VEILLE, 14), false);
  assert.equal(creneauDeLaVeille(2, HEURE_DE_LA_VEILLE), false);
  assert.deepEqual(base({ jourCourant: 3 }), { lancer: false, raison: 'pas-l-heure' });
  assert.deepEqual(base({ heureCourante: 14 }), { lancer: false, raison: 'pas-l-heure' });
});

test('un seul passage par semaine, même si le précédent a été tardif', () => {
  const hier = DIMANCHE_1H - 24 * 60 * 60 * 1000;
  assert.deepEqual(base({ dernierPassage: hier }), { lancer: false, raison: 'deja-passee' });
  const semaineDerniere = DIMANCHE_1H - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000;
  assert.ok(DIMANCHE_1H - semaineDerniere >= PERIODE_DE_LA_VEILLE_MS);
  assert.deepEqual(base({ dernierPassage: semaineDerniere }), { lancer: true });
});

test('sans place, ou pendant le rendez-vous de nuit, elle attend — et reprend hors créneau', () => {
  assert.deepEqual(base({ placeLibre: false }), { lancer: false, raison: 'travail-en-cours' });
  assert.deepEqual(base({ autreRendezVousEnCours: true }), { lancer: false, raison: 'travail-en-cours' });
  const tard = new Date(2026, 9, 11, 9, 0).getTime();
  const depuis = DIMANCHE_1H;
  assert.deepEqual(base({ maintenant: tard, heureCourante: 9, enAttenteDepuis: depuis }), { lancer: true });
  assert.deepEqual(base({ maintenant: tard, heureCourante: 9 }), { lancer: false, raison: 'pas-l-heure' });
});

test('sans projet pour la porter, elle ne part pas', () => {
  assert.deepEqual(base({ projetPresent: false }), { lancer: false, raison: 'projet-absent' });
});

test('la consigne : rien à modifier ni importer, pas de X, un plafond, les critères et le déjà-vu', () => {
  const consigne = consigneDeVeilleDeCompetences({
    fichesDuPool: ['minimalist-ui', 'brandkit'],
    bibliothequesImportees: ['https://github.com/anthropics/skills'],
    sourcesVues: ['github.com/exemple/ecartee'],
  });
  assert.match(consigne, /N'EXPLORE PAS X/);
  assert.match(consigne, /TU NE MODIFIES ET N'IMPORTES RIEN/);
  assert.match(consigne, /propose_task/);
  assert.ok(consigne.includes(`« ${LABEL_VEILLE_COMPETENCES} »`));
  assert.ok(consigne.includes(`${SOURCES_MAX_PAR_PASSAGE} SOURCES AU PLUS`));
  for (const critere of CRITERES_DE_SOURCE) assert.ok(consigne.includes(critere));
  assert.ok(consigne.includes('github.com/exemple/ecartee'));
  assert.ok(consigne.includes('https://github.com/anthropics/skills'));
  assert.ok(consigne.includes('minimalist-ui, brandkit'));
  assert.notEqual(LABEL_VEILLE_COMPETENCES, LABEL_AUTO_AMELIORATION);
});

test('la consigne plafonne la liste du pool et renvoie le reste à la mémoire', () => {
  const nombreux = Array.from({ length: 400 }, (_, i) => `fiche-${i}`);
  const consigne = consigneDeVeilleDeCompetences({ fichesDuPool: nombreux, bibliothequesImportees: [], sourcesVues: [] });
  assert.ok(consigne.includes('fiche-0'));
  assert.ok(!consigne.includes('fiche-399'));
  assert.match(consigne, /et 250 autres/);
});

test('les dépôts cités se ramènent à une forme unique, sans doublon', () => {
  const texte =
    'Vu https://github.com/Anthropics/Skills, puis github.com/anthropics/skills/tree/main/x et ' +
    '(https://github.com/openai/skills.git). Lien web : https://exemple.org/page.';
  assert.deepEqual(sourcesCitees(texte).sort(), ['github.com/anthropics/skills', 'github.com/openai/skills']);
  assert.deepEqual(sourcesCitees('rien ici'), []);
});

test('la mémoire des sources déjà vues : sans doublon, plafonnée, les plus récentes gardées', () => {
  assert.deepEqual(fusionnerSourcesVues(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  const anciennes = Array.from({ length: SOURCES_VUES_MAX }, (_, i) => `s${i}`);
  const fusion = fusionnerSourcesVues(anciennes, ['neuve']);
  assert.equal(fusion.length, SOURCES_VUES_MAX);
  assert.equal(fusion.at(-1), 'neuve');
  assert.ok(!fusion.includes('s0'));
});

test('le rapport nomme les sources, la demande de cadrage interdit la question et le plan', () => {
  assert.match(rapportDeLaVeille([]), /aucune source/);
  assert.ok(rapportDeLaVeille(['Importer x/y']).includes('« Importer x/y »'));
  const demande = demandeDeCadrageDeLaVeille({ title: 'Importer x/y', description: 'https://github.com/x/y', briefing: 'lu' }, 'Beluga');
  assert.match(demande, /NE POSE AUCUNE QUESTION AVEC « ask_user »/);
  assert.match(demande, /N'appelle jamais « rendre_plan »/);
  assert.ok(demande.includes('https://github.com/x/y') && demande.includes('lu'));
});
