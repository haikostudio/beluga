import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMOIRE_EVENEMENT_MS,
  MOTIFS,
  type MotifNotification,
  SEUILS_SEMAINE,
  cleEvenement,
  evenementDejaVu,
  familleDuMotif,
  franchissementSemaine,
  interrompt,
  resumeGroupe,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Ce qui mérite d'interrompre                                          */
/* ------------------------------------------------------------------ */

test('seuls les motifs qui appellent une décision ou annoncent une fin interrompent', () => {
  const interrompent = (Object.keys(MOTIFS) as MotifNotification[]).filter(interrompt).sort();
  assert.deepEqual(interrompent, [
    'decision-attendue',
    'publication-terminee',
    'quota-emballement',
    'quota-seuil',
    'quota-surconsommation',
    'tache-echec',
    'tache-terminee',
    'travail-sans-carte',
  ]);
});

test('la charge machine, l’amorçage et la fenêtre de quota ne sortent plus de l’application', () => {
  for (const motif of ['charge-machine', 'amorcage-impossible', 'fenetre-bientot-finie', 'point-du-jour'] as const) {
    assert.equal(interrompt(motif), false, motif);
  }
});

test('chaque motif garde la famille de réglage que l’utilisateur connaît déjà', () => {
  assert.equal(familleDuMotif('tache-terminee'), 'done');
  assert.equal(familleDuMotif('tache-echec'), 'failed');
  assert.equal(familleDuMotif('publication-terminee'), 'deploy');
  assert.equal(familleDuMotif('quota-seuil'), 'quota');
});

/* ------------------------------------------------------------------ */
/* Un même événement ne produit qu'une notification                     */
/* ------------------------------------------------------------------ */

test('la fin d’un tour et la clôture de la carte sont le MÊME événement', () => {
  // C'était le doublon d'origine : « Liste de tâches terminée » puis
  // « Tâche terminée », deux endroits du code, une seule chose arrivée.
  assert.equal(cleEvenement('liste-taches', 'carte-1'), cleEvenement('tache-terminee', 'carte-1'));
});

test('deux chemins de clôture d’une même carte ne font qu’une notification', () => {
  const vus = new Map<string, number>();
  const maintenant = 1_000_000;
  // L'ordonnanceur clôt la carte…
  assert.equal(evenementDejaVu(vus, cleEvenement('tache-terminee', 'carte-1'), maintenant), false);
  // …puis l'utilisateur clique « Terminer » sur la même carte.
  assert.equal(evenementDejaVu(vus, cleEvenement('tache-terminee', 'carte-1'), maintenant + 2000), true);
});

test('deux cartes différentes se signalent chacune', () => {
  const vus = new Map<string, number>();
  assert.equal(evenementDejaVu(vus, cleEvenement('tache-terminee', 'carte-1'), 1000), false);
  assert.equal(evenementDejaVu(vus, cleEvenement('tache-terminee', 'carte-2'), 1000), false);
});

test('le même événement se redit une fois la mémoire écoulée', () => {
  const vus = new Map<string, number>();
  const cle = cleEvenement('tache-echec', 'agent-1');
  assert.equal(evenementDejaVu(vus, cle, 0), false);
  assert.equal(evenementDejaVu(vus, cle, MEMOIRE_EVENEMENT_MS + 1), false);
});

test('un événement qui se répète en boucle ne reste pas muet pour toujours', () => {
  // L'inscription ne se rafraîchit pas : sinon un rappel toutes les minutes
  // repousserait l'échéance sans fin.
  const vus = new Map<string, number>();
  const cle = cleEvenement('tache-echec', 'agent-1');
  assert.equal(evenementDejaVu(vus, cle, 0), false);
  for (let t = 60_000; t < MEMOIRE_EVENEMENT_MS; t += 60_000) {
    assert.equal(evenementDejaVu(vus, cle, t), true);
  }
  assert.equal(evenementDejaVu(vus, cle, MEMOIRE_EVENEMENT_MS + 1), false);
});

/* ------------------------------------------------------------------ */
/* Les paliers du quota de la semaine                                   */
/* ------------------------------------------------------------------ */

test('les deux paliers de la semaine sont 70 % puis 90 %', () => {
  assert.deepEqual(SEUILS_SEMAINE, [70, 90]);
});

test('un palier franchi ne s’annonce qu’une fois par fenêtre', () => {
  const semaine = 5_000_000;
  const premier = franchissementSemaine(undefined, 72, semaine);
  assert.equal(premier?.seuil, 70);
  // La consommation continue de monter : plus rien tant que 90 % n'est pas là.
  assert.equal(franchissementSemaine(premier!.etat, 80, semaine), null);
  assert.equal(franchissementSemaine(premier!.etat, 89.9, semaine), null);
  const second = franchissementSemaine(premier!.etat, 91, semaine);
  assert.equal(second?.seuil, 90);
  assert.equal(franchissementSemaine(second!.etat, 99, semaine), null);
});

test('un bond de 60 à 95 % ne fait qu’une seule alerte, au palier le plus haut', () => {
  const bond = franchissementSemaine({ resetsAt: 5_000_000, franchis: [] }, 95, 5_000_000);
  assert.equal(bond?.seuil, 90);
  assert.deepEqual(bond?.etat.franchis, [70, 90]);
  assert.equal(franchissementSemaine(bond!.etat, 99, 5_000_000), null);
});

test('la nouvelle semaine efface les paliers déjà annoncés', () => {
  const avant = { resetsAt: 5_000_000, franchis: [70, 90] };
  const apres = franchissementSemaine(avant, 71, 6_000_000);
  assert.equal(apres?.seuil, 70);
});

test('sans fenêtre connue ou sans chiffre, aucun palier n’est annoncé', () => {
  assert.equal(franchissementSemaine(undefined, 95, undefined), null);
  assert.equal(franchissementSemaine(undefined, undefined, 5_000_000), null);
  assert.equal(franchissementSemaine(undefined, Number.NaN, 5_000_000), null);
});

/* ------------------------------------------------------------------ */
/* Un groupe nomme ses éléments                                         */
/* ------------------------------------------------------------------ */

test('un groupe énumère les éléments au lieu d’un compte muet', () => {
  const groupe = resumeGroupe('done', ['Le volet des quotas', 'La ligne de projet', 'Le fondu de défilement']);
  assert.equal(groupe.titre, '3 tâches terminées');
  assert.equal(groupe.corps, 'Le volet des quotas · La ligne de projet · Le fondu de défilement');
});

test('un groupe venu d’un seul projet le nomme en tête', () => {
  const groupe = resumeGroupe('quota', ['Compte A — 70 %', 'Compte B — 90 %'], 'HaikoDev');
  assert.equal(groupe.titre, 'HaikoDev — 2 alertes de quota');
  assert.equal(groupe.corps, 'Compte A — 70 % · Compte B — 90 %');
});

test('un groupe très long est coupé proprement, jamais au milieu d’un mot', () => {
  const elements = Array.from({ length: 12 }, (_, i) => `Une tâche au titre plutôt long numéro ${i + 1}`);
  const groupe = resumeGroupe('done', elements);
  assert.equal(groupe.titre, '12 tâches terminées');
  assert.ok(groupe.corps.length <= 180);
  assert.ok(groupe.corps.endsWith('…'));
  assert.ok(groupe.corps.startsWith('Une tâche au titre plutôt long numéro 1'));
});
