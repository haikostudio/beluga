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
  type GenreDAlerte,
  alerte,
  cleEvenement,
  evenementDejaVu,
  familleDuMotif,
  genreDeLAlerte,
  genreDuMessage,
  messageAlerte,
  franchissementSemaine,
  TOLERANCE_FENETRE_MS,
  iconeDuMotif,
  imageDeLAlerte,
  interrompt,
  memeFenetre,
  resumeGroupe,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Ce qui mérite d'interrompre                                          */
/* ------------------------------------------------------------------ */

test('TROIS GENRES alertent, et rien d’autre', () => {
  const genres = new Set(
    (Object.keys(MOTIFS) as MotifNotification[]).map((motif) => genreDeLAlerte(motif)).filter(Boolean),
  );
  assert.deepEqual([...genres].sort(), ['attente', 'erreur', 'termine']);
});

test('chaque motif qui alerte entre dans l’un des trois genres, nommément', () => {
  const parGenre = (genre: GenreDAlerte) =>
    (Object.keys(MOTIFS) as MotifNotification[]).filter((motif) => genreDeLAlerte(motif) === genre).sort();

  // Une attente : un agent a besoin de l'utilisateur.
  assert.deepEqual(parGenre('attente'), ['decision-attendue']);
  // Une tâche finie : y compris la publication, longue et menée par un agent.
  assert.deepEqual(parGenre('termine'), ['publication-terminee', 'tache-terminee', 'travail-sans-carte']);
  // Une erreur : ce qui casse, et ce qui BLOQUE le travail.
  assert.deepEqual(parGenre('erreur'), [
    'agent-interrompu',
    'amorcage-impossible',
    'compte-sature',
    'geste-lent',
    'jeton-claude-bloque',
    'publication-echec',
    // Une étape de publication qui traîne : le travail n'avance plus, donc un
    // blocage, donc une erreur (`shared/src/duree-des-etapes.ts`).
    'publication-en-retard',
    'tache-echec',
  ]);
});

test('les avancements, les états et les étapes ne notifient plus, sur aucun canal', () => {
  for (const motif of [
    'redemarrage-serveur',
    'quota-seuil',
    'quota-surconsommation',
    'quota-emballement',
    'fenetre-bientot-finie',
    'liste-taches',
    'charge-machine',
    'point-du-jour',
  ] as const) {
    assert.equal(genreDeLAlerte(motif), null, motif);
    assert.equal(interrompt(motif), false, motif);
    assert.equal(alerte(motif), false, motif);
  }
});

test('un blocage compte comme une erreur : il alerte', () => {
  // Quota épuisé, identifiant refusé, agent interrompu : le travail n'avance
  // plus, et cela ne se lit nulle part ailleurs.
  assert.equal(genreDeLAlerte('compte-sature'), 'erreur');
  assert.equal(genreDeLAlerte('amorcage-impossible'), 'erreur');
  assert.equal(genreDeLAlerte('agent-interrompu'), 'erreur');
  // Le palier 70 % / 90 %, lui, n'est qu'un avancement.
  assert.equal(genreDeLAlerte('quota-seuil'), null);
});

test('un motif né dans l’application alerte à l’écran, mais ne part jamais en push', () => {
  for (const motif of ['agent-interrompu', 'geste-lent'] as const) {
    assert.equal(alerte(motif), true, motif);
    assert.equal(interrompt(motif), false, motif);
  }
});

test('une publication en échec et sa réussite gardent leur famille de réglage', () => {
  assert.equal(interrompt('publication-echec'), true);
  assert.equal(familleDuMotif('publication-echec'), 'deploy');
  assert.equal(familleDuMotif('redemarrage-serveur'), 'systeme');
});

/* ------------------------------------------------------------------ */
/* Le second canal suit la MÊME règle                                   */
/* ------------------------------------------------------------------ */

test('un message sans motif est jugé sur son niveau : un refus se dit, une réussite se tait', () => {
  assert.equal(genreDuMessage('error', undefined), 'erreur');
  assert.equal(genreDuMessage('warning', undefined), 'erreur');
  assert.equal(genreDuMessage('success', undefined), null);
  assert.equal(genreDuMessage('info', undefined), null);
  assert.equal(messageAlerte('error'), true);
  assert.equal(messageAlerte('success'), false);
});

test('un message qui NOMME son motif est jugé sur lui, jamais sur son niveau', () => {
  // Une tâche finie s'affiche même en « success »…
  assert.equal(messageAlerte('success', 'tache-terminee'), true);
  // …un agent coupé d'autorité même en « info »…
  assert.equal(messageAlerte('info', 'agent-interrompu'), true);
  // …et une étape de publication se tait, même en « info ».
  assert.equal(messageAlerte('info', 'redemarrage-serveur'), false);
  assert.equal(messageAlerte('warning', 'charge-machine'), false);
});

test('un motif inconnu — serveur plus récent — retombe sur son niveau', () => {
  assert.equal(messageAlerte('error', 'motif-d-une-version-plus-recente'), true);
  assert.equal(messageAlerte('info', 'motif-d-une-version-plus-recente'), false);
});

test('une publication en échec n’est jamais avalée par la réussite du même lot', () => {
  assert.notEqual(cleEvenement('publication-echec', 'projet-1'), cleEvenement('publication-terminee', 'projet-1'));
});

/* ------------------------------------------------------------------ */
/* Chaque genre porte SON image                                         */
/* ------------------------------------------------------------------ */

test('les motifs qui alertent portent chacun l’image de leur genre — les images ne bougent pas', () => {
  assert.equal(iconeDuMotif('tache-terminee'), 'termine');
  assert.equal(iconeDuMotif('travail-sans-carte'), 'termine');
  assert.equal(iconeDuMotif('decision-attendue'), 'attention');
  assert.equal(iconeDuMotif('tache-echec'), 'erreur');
  assert.equal(iconeDuMotif('publication-terminee'), 'publication');
  // Une publication tombée est un échec, pas une publication en plus pâle.
  assert.equal(iconeDuMotif('publication-echec'), 'erreur');
  // Un blocage de quota garde l'image du quota : on ne touche pas au contenu
  // des messages, seulement à ce qui les déclenche.
  assert.equal(iconeDuMotif('compte-sature'), 'quota');
  assert.equal(iconeDuMotif('amorcage-impossible'), 'quota');
});

test('quatre images distinctes servent les alertes poussées', () => {
  const images = new Set(
    (Object.keys(MOTIFS) as MotifNotification[]).filter(interrompt).map((motif) => imageDeLAlerte(motif)),
  );
  // termine, attention, erreur, publication, quota.
  assert.equal(images.size, 5);
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
    // Le service worker ne voit passer que les alertes POUSSÉES : un motif qui
    // n'alerte plus, ou qui ne naît que dans le navigateur, n'y a rien à faire.
    if (!interrompt(motif)) {
      assert.equal(ligne, null, `${motif} ne part pas en push : rien à traduire`);
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
  // Une VRAIE nouvelle fenêtre s'écarte de plusieurs jours : ici sept jours.
  const apres = franchissementSemaine(avant, 71, 5_000_000 + 7 * 24 * 3600_000);
  assert.equal(apres?.seuil, 70);
});

test('deux échéances proches décrivent la même fenêtre', () => {
  assert.equal(memeFenetre(5_000_000, 5_000_000), true);
  assert.equal(memeFenetre(5_000_000, 5_000_000 + TOLERANCE_FENETRE_MS), true);
  assert.equal(memeFenetre(5_000_000, 5_000_000 + TOLERANCE_FENETRE_MS + 1), false);
  assert.equal(memeFenetre(undefined, 5_000_000), false);
  assert.equal(memeFenetre(5_000_000, undefined), false);
});

test('un resetsAt Codex qui dérive de quelques secondes ne rallume pas le palier', () => {
  // Codex recalcule resetsAt à chaque lecture : il glisse de quelques secondes.
  const premier = franchissementSemaine(undefined, 91, 5_000_000);
  assert.equal(premier?.seuil, 90);
  // Deux relevés suivants, échéance dérivée : plus aucune alerte.
  assert.equal(franchissementSemaine(premier!.etat, 92, 5_004_000), null);
  assert.equal(franchissementSemaine(premier!.etat, 93, 5_009_000), null);
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
