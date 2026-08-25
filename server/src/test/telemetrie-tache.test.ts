import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JETONS_DE_REFERENCE,
  SECONDES_DE_REFERENCE,
  jetonsFacturables,
  nomDeSujetMesure,
  noteDeQualite,
  partEviteeParLeTri,
  resumeDeTendance,
  tendancesParJour,
  type MesureDeTache,
} from '@haikodev/shared';

const LE_25_AOUT = new Date(2026, 7, 25, 14, 0, 0).getTime();

function mesure(part: Partial<MesureDeTache> = {}): MesureDeTache {
  return {
    cardId: 'carte-1',
    issue: 'terminee',
    tours: 3,
    tokensEntree: 40_000,
    tokensCache: 5_000_000,
    tokensSortie: 20_000,
    secondes: 600,
    memoire: {
      ouvertures: 2,
      millisecondes: 40,
      sujets: ['cartes', 'publication'],
      demandes: 6,
      rendus: 4,
      signesEntiers: 100_000,
      signesServis: 20_000,
    },
    at: LE_25_AOUT,
    ...part,
  };
}

test('la relecture au cache ne compte pas dans les jetons facturables', () => {
  assert.equal(jetonsFacturables({ tokensEntree: 40_000, tokensSortie: 20_000 }), 60_000);
  // Les 5 millions de jetons relus ne changent rien : ils se paient une fraction.
  assert.equal(jetonsFacturables(mesure()), 60_000);
});

test('la part évitée par le tri se mesure sur les signes, jamais sur les blocs', () => {
  assert.equal(partEviteeParLeTri(mesure().memoire), 0.8);
  assert.equal(partEviteeParLeTri({ ...mesure().memoire, signesEntiers: 0, signesServis: 0 }), 0);
  // Servi plus que l'entier n'a pas de sens : la part reste à zéro, jamais négative.
  assert.equal(partEviteeParLeTri({ ...mesure().memoire, signesEntiers: 10, signesServis: 50 }), 0);
});

test('une tâche sobre, rapide et allée au bout vaut tous les points', () => {
  const { note, criteres } = noteDeQualite(
    mesure({ tokensEntree: 10_000, tokensSortie: 10_000, secondes: 300 }),
  );
  assert.equal(note, 98); // 25 + 23 (tri à 80 %) + 25 + 25
  assert.equal(criteres.length, 4);
  assert.equal(criteres[0].points, 25);
  assert.match(criteres[0].raison, /au bout/);
});

test('une tâche en échec perd le quart de sa note, et le DIT', () => {
  const { criteres } = noteDeQualite(mesure({ issue: 'echec' }));
  assert.equal(criteres[0].points, 0);
  assert.match(criteres[0].raison, /échou/);
  const interrompue = noteDeQualite(mesure({ issue: 'interrompue' }));
  assert.equal(interrompue.criteres[0].points, 10);
});

test('une tâche qui n’a jamais ouvert la mémoire ne gagne rien sur ce critère', () => {
  const jamais = noteDeQualite(
    mesure({
      memoire: { ouvertures: 0, millisecondes: 0, sujets: [], demandes: 0, rendus: 0, signesEntiers: 0, signesServis: 0 },
    }),
  );
  assert.equal(jamais.criteres[1].points, 0);
  assert.match(jamais.criteres[1].raison, /jamais été ouverte/);

  // Ouverte mais muette : ce n'est pas la même chose que jamais ouverte.
  const muette = noteDeQualite(
    mesure({
      memoire: { ouvertures: 1, millisecondes: 3, sujets: ['inconnu'], demandes: 1, rendus: 0, signesEntiers: 0, signesServis: 0 },
    }),
  );
  assert.equal(muette.criteres[1].points, 8);
});

test('les jetons et la durée décroissent de la référence à trois fois la référence', () => {
  const pile = noteDeQualite(mesure({ tokensEntree: JETONS_DE_REFERENCE, tokensSortie: 0, secondes: SECONDES_DE_REFERENCE }));
  assert.equal(pile.criteres[2].points, 25);
  assert.equal(pile.criteres[3].points, 25);

  const double = noteDeQualite(mesure({ tokensEntree: JETONS_DE_REFERENCE * 2, tokensSortie: 0, secondes: SECONDES_DE_REFERENCE * 2 }));
  assert.equal(double.criteres[2].points, 12.5);
  assert.equal(double.criteres[3].points, 12.5);

  const trop = noteDeQualite(mesure({ tokensEntree: JETONS_DE_REFERENCE * 5, tokensSortie: 0, secondes: SECONDES_DE_REFERENCE * 9 }));
  assert.equal(trop.criteres[2].points, 0);
  assert.equal(trop.criteres[3].points, 0);
});

test('la note reste entre 0 et 100, quoi qu’on lui donne', () => {
  const pire = noteDeQualite(
    mesure({
      issue: 'echec',
      tokensEntree: 10_000_000,
      tokensSortie: 0,
      secondes: 99_999,
      memoire: { ouvertures: 0, millisecondes: 0, sujets: [], demandes: 0, rendus: 0, signesEntiers: 0, signesServis: 0 },
    }),
  );
  assert.equal(pire.note, 0);
});

test('la courbe garde un jour creux à zéro, elle ne le saute pas', () => {
  const tendances = tendancesParJour([mesure()], LE_25_AOUT, 7);
  assert.equal(tendances.length, 7);
  // Du plus ancien au plus récent : le dernier point est aujourd'hui.
  assert.equal(tendances[6].jour, '2026-08-25');
  assert.equal(tendances[6].taches, 1);
  assert.equal(tendances[6].jetons, 60_000);
  assert.equal(tendances[6].minutes, 10);
  assert.equal(tendances[6].minutesParTache, 10);
  assert.equal(tendances[6].rendementMemoire, 0.8);
  // Les six jours d'avant existent, à zéro, sans trou dans la courbe.
  assert.equal(tendances[0].taches, 0);
  assert.equal(tendances[0].jetons, 0);
  assert.equal(tendances[0].note, 0);
});

test('une mesure hors fenêtre ne se glisse dans aucun jour', () => {
  const vieille = mesure({ at: LE_25_AOUT - 30 * 24 * 3600 * 1000 });
  const tendances = tendancesParJour([vieille], LE_25_AOUT, 7);
  assert.equal(
    tendances.reduce((total, point) => total + point.taches, 0),
    0,
  );
});

test('le résumé moyenne par tâche, et le temps de mémoire par ouverture', () => {
  const resume = resumeDeTendance([mesure(), mesure({ cardId: 'carte-2', secondes: 1200 })]);
  assert.equal(resume.taches, 2);
  assert.equal(resume.jetons, 120_000);
  assert.equal(resume.minutesParTache, 15); // (600 + 1200) / 2 / 60
  assert.equal(resume.rendementMemoire, 0.8);
  assert.equal(resume.memoireMs, 20); // 80 ms sur 4 ouvertures
});

test('un résumé sans aucune tâche ne divise par rien', () => {
  const vide = resumeDeTendance([]);
  assert.deepEqual(vide, { taches: 0, jetons: 0, minutesParTache: 0, rendementMemoire: 0, note: 0, memoireMs: 0 });
});

test('un sujet mesuré reste un NOM court, jamais une phrase de travail', () => {
  assert.equal(nomDeSujetMesure('cartes'), 'cartes');
  assert.equal(nomDeSujetMesure('  Publication  '), 'publication');
  // Une demande entière ne doit pas entrer dans une table de mesures.
  assert.equal(nomDeSujetMesure('cartes entier, et le bouton Arrêter de la carte 42'), 'cartes');
  assert.equal(nomDeSujetMesure(''), '(la carte)');
  assert.equal(nomDeSujetMesure('   '), '(la carte)');
  assert.ok(nomDeSujetMesure('a'.repeat(200)).length <= 40);
});
