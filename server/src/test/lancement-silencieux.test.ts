import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELAI_ATTENTE_LANCEMENT_MS,
  DELAI_OUVERTURE_DE_COPIE_MS,
  PLAFOND_LANCEMENT_EN_ROUTE_MS,
  motDeDelaiDepasse,
  motDeLancementSansReponse,
  raisonApresReparations,
  reconnaitrePanneDeDossier,
  sansBruitDeProgression,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UN LANCEMENT QUI N'ABOUTIT PAS LE DIT — IL NE SE TAIT PLUS.         */
/*                                                                     */
/* Constat : sur un dépôt de 41 706 fichiers posé sur un disque        */
/* distant, `git worktree add` était tué à 28 % par son délai de trois */
/* minutes. Le serveur refusait donc le lancement, mais :              */
/*   - sa raison n'était qu'un ruban « Updating files:  27% (…) » ;    */
/*   - il répondait APRÈS les deux minutes d'attente du navigateur ;   */
/*   - et un refus expiré est justement celui que le client avale.     */
/* Le bouton tournait, revenait, et rien ne se lançait jamais.         */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(ICI, '../../../web/src/lib/client.ts');
/* La barre d'action de la carte porte le lancement (`parcours-carte.tsx`), plus le fil lui-même. */
const CHAT = path.resolve(ICI, '../../../web/src/components/parcours-carte.tsx');
/* Le pied du tiroir a disparu : la reprise part désormais du flux en points. */
const FLUX = path.resolve(ICI, '../../../web/src/components/flux-en-points.tsx');
const MESSAGES = path.resolve(ICI, '../../../web/src/components/message-view.tsx');
const DOSSIER = path.resolve(ICI, '../../../server/src/dossier-de-carte.ts');
const GIT = path.resolve(ICI, '../../../server/src/git.ts');
const SCHEDULER = path.resolve(ICI, '../../../server/src/scheduler.ts');
const REGISTRE_LANCEMENTS = path.resolve(ICI, '../../../server/src/lancements-en-route.ts');

/* -------- Le message de git redevient lisible -------- */

const RUBAN =
  'Updating files:  26% (10911/41706)\rUpdating files:  27% (11261/41706)\rUpdating files:  28% (11678/41706)\r';

test('le ruban d’avancement de git est retiré du message', () => {
  assert.equal(sansBruitDeProgression(RUBAN), '');
  assert.equal(sansBruitDeProgression(`${RUBAN}fatal: dossier occupé`), 'fatal: dossier occupé');
  // Les autres rubans de git suivent la même règle.
  assert.equal(sansBruitDeProgression('Resolving deltas: 100% (12/12)\nfatal: x'), 'fatal: x');
  assert.equal(sansBruitDeProgression('Receiving objects:  40% (4/10)\nfatal: y'), 'fatal: y');
  // Ce qui n'est pas un ruban n'est jamais touché.
  assert.equal(sansBruitDeProgression('fatal: 26% de rien'), 'fatal: 26% de rien');
});

test('la raison rendue à la carte porte la cause, plus le ruban', () => {
  const raison = raisonApresReparations(`${RUBAN}fatal: dossier occupé`, null, []);
  assert.match(raison, /fatal: dossier occupé/);
  assert.ok(!/Updating files/.test(raison), `ruban resté : ${raison}`);
});

test('un git qui n’a rien dit ne rend pas une raison vide', () => {
  const raison = raisonApresReparations(RUBAN, null, []);
  assert.match(raison, /git n’a rien dit de plus/);
});

test('une panne se reconnaît même noyée dans le ruban', () => {
  const panne = reconnaitrePanneDeDossier(`${RUBAN}fatal: '/x' already exists`);
  assert.ok(panne, 'la panne devrait être reconnue sous le ruban');
});

/* -------- Le délai dépassé se dit avec ce mot-là -------- */

test('un délai dépassé se met en mots', () => {
  const mot = motDeDelaiDepasse(DELAI_OUVERTURE_DE_COPIE_MS / 1000);
  assert.match(mot, /délai dépassé après 45 min/);
  assert.match(mot, /copie de travail/);
});

/* -------- Les délais se tiennent entre eux -------- */

test('chaque délai laisse le suivant finir', () => {
  // Mesuré : ~40 fichiers par seconde sur le montage réseau, soit ~17 minutes
  // pour le dépôt de 41 706 fichiers. Le plafond doit garder de la marge.
  assert.ok(DELAI_OUVERTURE_DE_COPIE_MS >= 30 * 60_000);
  // La garde d'un lancement déjà en route survit à l'ouverture la plus lente,
  // sans quoi l'ordonnanceur relance la même carte par-dessus la première.
  assert.ok(PLAFOND_LANCEMENT_EN_ROUTE_MS > DELAI_OUVERTURE_DE_COPIE_MS);
  // …et l'écran attend plus longtemps que le serveur ne peut mettre.
  assert.ok(DELAI_ATTENTE_LANCEMENT_MS > DELAI_OUVERTURE_DE_COPIE_MS);
});

/* -------- Le serveur s'en sert vraiment -------- */

test('l’ouverture de la copie prend son délai à elle, sans ruban', () => {
  const source = fs.readFileSync(DOSSIER, 'utf8');
  assert.ok(source.includes('DELAI_OUVERTURE_DE_COPIE_MS'), 'le délai d’ouverture doit être appliqué');
  assert.match(source, /'worktree', 'add', '--quiet'/, 'git ne doit plus écrire son ruban');
  // Un git tué par son délai le nomme, au lieu de rendre « Command failed ».
  // L'enveloppe `git()` vit désormais à UN seul endroit (`server/src/git.ts`) :
  // c'est là que le mot du délai et la coupe du ruban doivent se trouver.
  const enveloppe = fs.readFileSync(GIT, 'utf8');
  assert.ok(enveloppe.includes('motDeDelaiDepasse'));
  assert.ok(enveloppe.includes('sansBruitDeProgression'));
});

test('un lancement déjà en route n’est plus doublé au bout de cinq minutes', () => {
  // Le registre a quitté l'ordonnanceur pour son propre fichier : le balayage
  // des cartes oubliées en a besoin, lui aussi (`lancements-en-route.ts`).
  const registre = fs.readFileSync(REGISTRE_LANCEMENTS, 'utf8');
  assert.match(registre, /travailAbandonne\(Date\.now\(\) - engage\.depuis, PLAFOND_LANCEMENT_EN_ROUTE_MS\)/);
  const source = fs.readFileSync(SCHEDULER, 'utf8');
  assert.match(source, /if \(lancementEnRoute\(cardId\)\) return \{ ok: true \};/);
  assert.match(source, /marquerLancementEnRoute\(cardId, carte\?\.projectId\)/);
  assert.match(source, /oublierLancementEnRoute\(cardId\)/);
});

/* -------- L'écran s'en sert vraiment -------- */

test('les trois boutons de lancement passent par le même chemin', () => {
  const client = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(client.includes('async demanderLeLancement'));
  // L'attente suit ce que le serveur peut mettre, plus les deux minutes d'avant.
  assert.ok(client.includes('DELAI_ATTENTE_LANCEMENT_MS'));
  // Une attente dépassée porte SA phrase, au lieu d'être avalée par signalerRefus.
  assert.ok(client.includes('motDeLancementSansReponse'));
  // Une attente qui dure se dit, par le même événement que les autres boutons.
  assert.ok(client.includes('EVENEMENT_ATTENTE_LONGUE'));
  for (const fichier of [CHAT, FLUX, MESSAGES]) {
    const source = fs.readFileSync(fichier, 'utf8');
    assert.ok(source.includes('demanderLeLancement'), `${path.basename(fichier)} doit passer par le chemin unique`);
    assert.ok(!/call\(\{ type: 'card\.start'/.test(source), `${path.basename(fichier)} ne doit plus appeler card.start`);
  }
});

test('le mot du lancement sans réponse ne crie pas à la panne', () => {
  const mot = motDeLancementSansReponse();
  assert.match(mot, /lancement/i);
  // Ni « le serveur ne répond pas », ni « panne » : la demande est partie.
  assert.ok(!/serveur ne répond pas|panne/i.test(mot));
});
