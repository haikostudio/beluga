import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_PAR_DEFAUT,
  MEMOIRE_EVENEMENT_MS,
  MOTIFS,
  type MotifNotification,
  SEUILS_SEMAINE,
  cleEvenement,
  evenementDejaVu,
  familleDuMotif,
  franchissementSemaine,
  iconeDuMotif,
  imageDeLAlerte,
  interrompt,
  resumeGroupe,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Ce qui mérite d'interrompre                                          */
/* ------------------------------------------------------------------ */

test('SEPT motifs interrompent, pas un de plus', () => {
  const interrompent = (Object.keys(MOTIFS) as MotifNotification[]).filter(interrompt).sort();
  assert.deepEqual(interrompent, [
    'decision-attendue',
    'publication-echec',
    'publication-terminee',
    'quota-seuil',
    'redemarrage-serveur',
    'tache-echec',
    'tache-terminee',
    'travail-sans-carte',
  ]);
  // Huit entrées pour sept genres : une tâche terminée l'est avec ou sans carte.
  assert.equal(interrompent.length, 8);
});

test('la charge machine, l’amorçage et la fenêtre de quota ne sortent plus de l’application', () => {
  for (const motif of ['charge-machine', 'amorcage-impossible', 'fenetre-bientot-finie', 'point-du-jour'] as const) {
    assert.equal(interrompt(motif), false, motif);
  }
});

test('la surconsommation et l’emballement de quota redescendent en bannière', () => {
  // Ils redisent ce que les paliers 70 % / 90 % annoncent déjà : trois alertes
  // pour un seul quota faisaient du bruit.
  assert.equal(interrompt('quota-surconsommation'), false);
  assert.equal(interrompt('quota-emballement'), false);
  assert.equal(interrompt('quota-seuil'), true);
});

test('une publication en échec et un redémarrage se disent, et sont bien connus', () => {
  assert.equal(interrompt('publication-echec'), true);
  assert.equal(interrompt('redemarrage-serveur'), true);
  assert.equal(familleDuMotif('publication-echec'), 'deploy');
  assert.equal(familleDuMotif('redemarrage-serveur'), 'systeme');
});

test('une publication en échec n’est jamais avalée par la réussite du même lot', () => {
  assert.notEqual(cleEvenement('publication-echec', 'projet-1'), cleEvenement('publication-terminee', 'projet-1'));
});

/* ------------------------------------------------------------------ */
/* Chaque genre porte SON image                                         */
/* ------------------------------------------------------------------ */

test('les sept motifs qui interrompent portent chacun l’image de leur genre', () => {
  assert.equal(iconeDuMotif('tache-terminee'), 'termine');
  assert.equal(iconeDuMotif('travail-sans-carte'), 'termine');
  assert.equal(iconeDuMotif('decision-attendue'), 'attention');
  assert.equal(iconeDuMotif('tache-echec'), 'erreur');
  assert.equal(iconeDuMotif('publication-terminee'), 'publication');
  // Une publication tombée est un échec, pas une publication en plus pâle.
  assert.equal(iconeDuMotif('publication-echec'), 'erreur');
  assert.equal(iconeDuMotif('quota-seuil'), 'quota');
  assert.equal(iconeDuMotif('redemarrage-serveur'), 'redemarrage');
});

test('six images distinctes servent les motifs qui interrompent', () => {
  const images = new Set(
    (Object.keys(MOTIFS) as MotifNotification[]).filter(interrompt).map((motif) => imageDeLAlerte(motif)),
  );
  assert.equal(images.size, 6);
  for (const image of images) assert.match(image, /^\/notif\/[a-z-]+\.png$/);
});

test('un motif inconnu retombe sur l’icône de l’application, jamais sur un vide', () => {
  assert.equal(imageDeLAlerte('motif-d-une-version-plus-recente'), IMAGE_PAR_DEFAUT);
  assert.equal(imageDeLAlerte(undefined), IMAGE_PAR_DEFAUT);
});

test('le service worker traduit les MÊMES motifs que la règle, et les images existent', () => {
  // Le service worker ne partage rien avec l'application : sa table est
  // recopiée, donc elle peut dériver. Ce contrôle est là pour l'en empêcher.
  const racine = path.resolve(fileURLToPath(import.meta.url), '../../../..');
  const sw = fs.readFileSync(path.join(racine, 'web', 'public', 'sw.js'), 'utf8');
  const table = sw.slice(sw.indexOf('const ICONES'), sw.indexOf('function imageDeLAlerte'));

  for (const motif of Object.keys(MOTIFS) as MotifNotification[]) {
    const ligne = new RegExp(`'${motif}':\\s*'([a-z-]+)'`).exec(table);
    if (!interrompt(motif)) {
      assert.equal(ligne, null, `${motif} n'interrompt pas : rien à traduire`);
      continue;
    }
    assert.ok(ligne, `${motif} manque au service worker`);
    assert.equal(ligne![1], iconeDuMotif(motif), motif);
    const image = path.join(racine, 'web', 'public', 'notif', `${ligne![1]}.png`);
    assert.ok(fs.existsSync(image), `image absente : ${image}`);
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
