import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ATTENTE_PLACE_MAX_MS,
  AXES_D_EXAMEN,
  FENETRE_HEURES,
  HEURE_RENDEZ_VOUS,
  PERIODE_MS,
  PROPOSITIONS_MAX,
  consigneDAutoAmelioration,
  decisionDuRendezVous,
  demandeDeCadrageDeLaNuit,
  heureDuRendezVous,
  raisonDite,
  titreDuRendezVous,
  LABEL_AUTO_AMELIORATION,
  LABEL_RENDEZ_VOUS_DE_NUIT,
  descriptionDuRendezVous,
  rapportDuRendezVous,
} from '@beluga/shared';

test('la carte du rendez-vous : étiquette distincte des propositions, rapport qui les nomme', () => {
  // Distincte : la carte du rendez-vous ne se cadre pas au réveil et ne porte
  // pas la phrase d'intro ludique réservée aux propositions.
  assert.notEqual(LABEL_RENDEZ_VOUS_DE_NUIT, LABEL_AUTO_AMELIORATION);
  assert.match(rapportDuRendezVous([]), /aucune proposition/);
  const rapport = rapportDuRendezVous(['Alléger le tableau', 'Dire la panne']);
  assert.ok(rapport.includes('2 proposition'));
  assert.ok(rapport.includes('« Alléger le tableau »') && rapport.includes('« Dire la panne »'));
  assert.ok(descriptionDuRendezVous('Beluga Build').includes('« Beluga Build »'));
});

/*
 * LE RENDEZ-VOUS D'AUTO-AMÉLIORATION (voir [[auto-amelioration]]).
 *
 * Ce que ces tests verrouillent, dans l'ordre de ce qui coûterait cher :
 *   1. le rendez-vous ne part JAMAIS en pleine journée — c'est la réserve du
 *      jour qu'on protège, et un agent d'analyse n'est pas gratuit ;
 *   2. quand aucune place n'est libre, il ATTEND — même après la fenêtre
 *      3 h-5 h — au lieu de sauter la nuit, et jusqu'à dix-huit heures ;
 *   3. un seul passage par nuit ;
 *   4. la consigne dit bien à l'agent de ne rien modifier et de se tenir à
 *      quelques propositions.
 */

const NUIT = (heure: number) => new Date(2026, 7, 13, heure, 20).getTime();

function base(surcharges: Partial<Parameters<typeof decisionDuRendezVous>[0]> = {}) {
  return decisionDuRendezVous({
    projetPresent: true,
    dernierPassage: undefined,
    maintenant: NUIT(HEURE_RENDEZ_VOUS),
    heureCourante: HEURE_RENDEZ_VOUS,
    placeLibre: true,
    ...surcharges,
  });
}

test('à 3 h, une place libre et sans passage du jour, le rendez-vous part', () => {
  assert.deepEqual(base(), { lancer: true });
});

test('en pleine journée, sans attente déjà engagée, le rendez-vous ne part jamais', () => {
  for (const heure of [8, 11, 14, 17, 20, 22]) {
    const decision = base({ heureCourante: heure, maintenant: NUIT(heure) });
    assert.deepEqual(
      decision,
      { lancer: false, raison: 'pas-l-heure' },
      `il ne doit rien partir à ${heure} h : c'est la réserve de la journée`,
    );
  }
});

test('la fenêtre de DÉPART couvre 3 h, 4 h et 5 h, et rien d’autre', () => {
  for (let pas = 0; pas < FENETRE_HEURES; pas += 1) {
    assert.ok(heureDuRendezVous(HEURE_RENDEZ_VOUS + pas), `${HEURE_RENDEZ_VOUS + pas} h est dans la fenêtre`);
  }
  assert.equal(heureDuRendezVous(HEURE_RENDEZ_VOUS - 1), false, 'juste avant, non');
  assert.equal(heureDuRendezVous(HEURE_RENDEZ_VOUS + FENETRE_HEURES), false, 'juste après, non plus');
});

test('sans place libre, le rendez-vous ATTEND, il ne l’annule pas', () => {
  const reporte = base({ placeLibre: false });
  assert.deepEqual(reporte, { lancer: false, raison: 'travail-en-cours' });
  // Une heure plus tard, toujours dans la fenêtre : il repart tout seul.
  assert.deepEqual(base({ heureCourante: HEURE_RENDEZ_VOUS + 1, placeLibre: true }), { lancer: true });
});

test('une place manquante APRÈS la fenêtre 3 h-5 h ne fait plus sauter la nuit', () => {
  const debut = NUIT(HEURE_RENDEZ_VOUS);
  // À 3 h, aucune place : l'attente commence.
  assert.deepEqual(
    base({ placeLibre: false }),
    { lancer: false, raison: 'travail-en-cours' },
  );
  // À 8 h, toujours occupé : hors fenêtre, mais l'attente engagée à 3 h le
  // maintient en vie — il ne se fait pas refuser pour « pas-l-heure ».
  assert.deepEqual(
    base({ heureCourante: 8, maintenant: NUIT(8), placeLibre: false, enAttenteDepuis: debut }),
    { lancer: false, raison: 'travail-en-cours' },
    'passé 5 h, une attente déjà engagée continue au lieu de sauter la nuit',
  );
  // Une place se libère à 9 h : il part, alors qu'il est loin de la fenêtre.
  assert.deepEqual(
    base({ heureCourante: 9, maintenant: NUIT(9), placeLibre: true, enAttenteDepuis: debut }),
    { lancer: true },
    'la place trouvée hors fenêtre suffit, l’attente était déjà engagée',
  );
});

test('l’attente ne dure pas indéfiniment : au-delà de dix-huit heures, on renonce', () => {
  const debut = NUIT(HEURE_RENDEZ_VOUS);
  const tropTard = debut + ATTENTE_PLACE_MAX_MS + 60_000;
  assert.deepEqual(
    base({ heureCourante: new Date(tropTard).getHours(), maintenant: tropTard, placeLibre: false, enAttenteDepuis: debut }),
    { lancer: false, raison: 'pas-l-heure' },
    'passé le plafond d’attente, on retombe sur le refus normal, en attendant la nuit suivante',
  );
});

test('un seul rendez-vous par nuit', () => {
  const passage = NUIT(HEURE_RENDEZ_VOUS);
  assert.deepEqual(base({ dernierPassage: passage, maintenant: passage + 60_000 }), {
    lancer: false,
    raison: 'deja-passe',
  });
  // Vingt-quatre heures plus tard, la nuit suivante a lieu.
  assert.deepEqual(base({ dernierPassage: passage, maintenant: passage + PERIODE_MS }), { lancer: true });
});

test('sans projet à examiner, rien ne part', () => {
  assert.deepEqual(base({ projetPresent: false }), { lancer: false, raison: 'projet-absent' });
});

test('chaque raison de sauter se dit en français', () => {
  for (const raison of ['pas-l-heure', 'deja-passe', 'travail-en-cours', 'projet-absent'] as const) {
    const dite = raisonDite(raison);
    assert.ok(dite.length > 10, `« ${raison} » doit se dire en clair, pas en code`);
    assert.ok(!dite.includes(raison), 'une raison dite ne recopie pas son code technique');
  }
});

test('la consigne interdit de modifier quoi que ce soit et plafonne les propositions', () => {
  const consigne = consigneDAutoAmelioration("Beluga Build");
  assert.match(consigne, /TU NE MODIFIES RIEN/, "l'interdit d'écrire doit être écrit en toutes lettres");
  assert.match(consigne, /propose_task/, 'la seule sortie du tour est une proposition de carte');
  assert.ok(
    consigne.includes(String(PROPOSITIONS_MAX)),
    'le plafond de propositions vient de la constante partagée, jamais recopié à la main',
  );
  assert.match(consigne, /Beluga Build/, 'le projet examiné est nommé');
  // Les six axes de recherche partent tous : la liste EST le rendez-vous.
  for (const axe of AXES_D_EXAMEN) assert.ok(consigne.includes(axe), `axe manquant : ${axe.slice(0, 40)}…`);
});

test("la consigne exige une intro simple et ludique avant le Constat technique", () => {
  const consigne = consigneDAutoAmelioration("Beluga Build");
  assert.match(consigne, /CHAMP « intro »/, "le champ à remplir est nommé");
  assert.match(consigne, /sans jargon ni chemin de fichier/, "l’intro doit rester lisible par un non-technicien");
});

test('la consigne autorise une nuit sans rien à proposer', () => {
  const consigne = consigneDAutoAmelioration("Beluga Build");
  assert.match(consigne, /sans rien à proposer est une nuit normale/, 'ne rien trouver ne doit pas forcer la main');
});

test('le titre de la conversation porte la date de la nuit', () => {
  const titre = titreDuRendezVous(new Date(2026, 7, 13, 3, 0));
  assert.match(titre, /13\.08\.2026/, 'la date rend les nuits distinguables dans la liste des agents');
});

/*
 * Le branchement, vérifié sur le TEXTE du démon : sans lui, les règles
 * ci-dessus seraient justes et le rendez-vous n'aurait jamais lieu.
 */
test('la veille du rendez-vous est bien démarrée par le démon, et arrêtée à l’extinction', () => {
  const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /planifierAutoAmelioration\(\)/, 'la veille doit être lancée au démarrage');
  assert.match(main, /clearInterval\(autoAmeliorationTimer\)/, "et arrêtée à l'extinction du démon");
  assert.doesNotMatch(
    main,
    /rendezVousDAutoAmelioration\(\s*\{[^}]*auDemarrage/,
    'aucun rattrapage au démarrage : ce serait une analyse en pleine journée',
  );
});

/* ------------------------------------------------------------------ */
/* LES CARTES DE LA NUIT SUIVENT LE MÊME CHEMIN QUE LES AUTRES         */
/* ------------------------------------------------------------------ */

const CARTE_DE_NUIT = {
  title: 'Retirer une fonction que plus rien n’appelle',
  description: 'Supprimer la fonction et son test.',
  briefing: 'Cherchée dans tout le projet : plus aucun appel depuis juin.',
};

test('la demande de cadrage porte le titre, la description et le constat de la nuit', () => {
  const demande = demandeDeCadrageDeLaNuit(CARTE_DE_NUIT, 'Beluga Build');
  assert.ok(demande.includes(CARTE_DE_NUIT.title), 'le titre posé par la nuit doit voyager');
  assert.ok(demande.includes(CARTE_DE_NUIT.description), 'la description doit voyager');
  assert.ok(demande.includes(CARTE_DE_NUIT.briefing), 'le constat de la nuit doit voyager');
  assert.ok(demande.includes('Beluga Build'), 'le projet examiné est nommé');
});

test('la demande de cadrage s’arrête à la compréhension, sans jamais produire de plan', () => {
  const demande = demandeDeCadrageDeLaNuit(CARTE_DE_NUIT, 'Beluga Build');
  assert.ok(demande.includes('rendre_comprehension'), 'le tour se referme sur la compréhension');
  assert.ok(demande.includes("N'APPELLE JAMAIS « rendre_plan »"), 'le plan est explicitement interdit cette nuit');
});

test('la demande de cadrage interdit la question : personne ne répond à 3 h du matin', () => {
  const demande = demandeDeCadrageDeLaNuit(CARTE_DE_NUIT, 'Beluga Build');
  assert.ok(demande.includes('ask_user'), 'l’outil de question doit être nommé pour être interdit');
  assert.ok(/NE POSE AUCUNE QUESTION/.test(demande), 'l’interdit est écrit en toutes lettres');
});

test('une carte de nuit sans description ni constat donne quand même une demande lisible', () => {
  const demande = demandeDeCadrageDeLaNuit({ title: 'Une trouvaille' }, 'Beluga Build');
  assert.ok(demande.includes('Une trouvaille'));
  assert.ok(!demande.includes('CE QUI EST DEMANDÉ'), 'aucun titre de bloc vide');
  assert.ok(!demande.includes('CONSTATÉ'), 'aucun bloc de constat vide');
});

test('les cartes de la nuit passent par le plancher avant d’être créées, et au rattrapage', () => {
  const source = fs.readFileSync(new URL('../../src/auto-amelioration.ts', import.meta.url), 'utf8');
  const debut = source.indexOf('export function accepterPropositionsDeLaNuit');
  const acceptation = source.slice(debut, source.indexOf('bus.emit', debut));
  assert.ok(/run: runPlancherAutomatique\(/.test(acceptation), 'le palier léger de la proposition est relevé');
  assert.ok(!acceptation.includes('run: proposal.run,'), 'le réglage de la proposition ne passe plus tel quel');
  const rattrapage = source.slice(source.indexOf('export async function rattraperLeCadrageDeLaNuit'));
  assert.ok(rattrapage.indexOf('runPlancherAutomatique') < rattrapage.indexOf('ouvrirLesCadragesDeLaNuit(['));
});
