import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTIFS_DE_DEPANNAGE, afficheEtapeMemoire, niveauDAccueil, partsDAccueil } from '@beluga/shared';
import { briefing } from '../memory.js';
import { rolePrompt } from '../runtime.js';

/*
 * ALLÉGER LE CONTEXTE DES AGENTS DE DÉPANNAGE DE PUBLICATION.
 *
 * `jouerAvecReparation`, `reparerLesControles` et `reparerLaConstruction` créent un
 * agent NEUF à chaque incident : la session étant neuve, le briefing complet
 * partait — fichiers d'instructions, compétences partagées et INDEX DE LA
 * MÉMOIRE, qui grandit à chaque carte livrée — pour une demande qui nomme déjà
 * ses fichiers, ses contrôles ou sa cause. Ces trois-là reçoivent désormais un
 * accueil MINIMAL ; tous les autres gardent le leur.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));

function dossierDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-accueil-'));
  fs.writeFileSync(path.join(dossier, 'CLAUDE.md'), '# Essai\n\nInstructions du moteur.\n');
  return dossier;
}

/* ------------------------------------------------------------------ */
/* La règle pure                                                       */
/* ------------------------------------------------------------------ */

test('seul un agent de publication en dépannage reçoit un accueil minimal', () => {
  for (const motif of MOTIFS_DE_DEPANNAGE) {
    assert.equal(niveauDAccueil({ role: 'deploy', motif }), 'minimal', `motif ${motif}`);
  }
  // La mise en ligne confiée agit sur le projet entier : elle garde son accueil.
  assert.equal(niveauDAccueil({ role: 'deploy', motif: 'mise-en-ligne' }), 'complet');
  // Sans motif, on accueille : dans le doute, on ne rogne rien.
  assert.equal(niveauDAccueil({ role: 'deploy' }), 'complet');
});

test('les agents de tâche et d’analyse gardent leur accueil, quel que soit le motif', () => {
  for (const role of ['task', 'analysis'] as const) {
    assert.equal(niveauDAccueil({ role }), 'complet');
    assert.equal(niveauDAccueil({ role, motif: 'conflit' }), 'complet');
  }
});

test('l’agent de cadrage reçoit son propre accueil : la mémoire, pas les instructions', () => {
  assert.equal(niveauDAccueil({ role: 'cadrage' }), 'cadrage');
  assert.equal(niveauDAccueil({ role: 'cadrage', motif: 'conflit' }), 'cadrage');
  assert.deepEqual(partsDAccueil('cadrage'), {
    instructions: false,
    competences: true,
    memoire: true,
    github: true,
  });
});

test('l’accueil minimal n’emporte ni mémoire, ni compétences, ni instructions', () => {
  // `github` : l'annonce de l'accès GitHub direct, elle non plus (une panne de
  // publication nommée n'a rien à consulter sur GitHub).
  assert.deepEqual(partsDAccueil('minimal'), {
    instructions: false,
    competences: false,
    memoire: false,
    github: false,
  });
  assert.deepEqual(partsDAccueil('complet'), {
    instructions: true,
    competences: true,
    memoire: true,
    github: true,
  });
});

/* ------------------------------------------------------------------ */
/* Ce qui part réellement au moteur                                    */
/* ------------------------------------------------------------------ */

test('le briefing d’un dépannage ne porte ni la règle durable, ni les instructions, ni les compétences', () => {
  const dossier = dossierDEssai();

  const complet = briefing(dossier, 'Essai', true, 'claude', undefined, 'complet');
  const minimal = briefing(dossier, 'Essai', true, 'claude', undefined, 'minimal');

  // Le témoin : l'accueil complet, lui, dit comment déposer une règle durable.
  assert.match(complet, /RÈGLE DURABLE APPRISE/);

  assert.doesNotMatch(minimal, /RÈGLE DURABLE APPRISE/);
  assert.doesNotMatch(minimal, /project_memory/);
  assert.doesNotMatch(minimal, /Fichiers d'instructions présents/);
  assert.doesNotMatch(minimal, /compétence/i);
  assert.ok(minimal.length < complet.length, `le briefing réduit doit être plus court (${minimal.length})`);

  // Ce qui reste : où l'agent travaille. Sans ça, il ne répare rien.
  assert.match(minimal, /Essai/);
  assert.ok(minimal.includes(dossier), 'le dossier du projet reste dit');
});

test('la consigne système d’un dépannage est ciblée, pas le déroulé complet', () => {
  const consigne = rolePrompt('deploy', false, 'claude', 'minimal');

  // Plus de méthode générale : elle renvoie à un briefing qu'il n'a plus.
  assert.doesNotMatch(consigne, /MÉTHODE DE TRAVAIL IMPOSÉE/);
  assert.doesNotMatch(consigne, /project_memory/);
  assert.doesNotMatch(consigne, /TaskCreate/);

  // Ce qui ne se perd jamais : le silence sur les identifiants, l'interdit de
  // publier, et l'obligation de dire un échec.
  assert.match(consigne, /SILENCE SUR LES IDENTIFIANTS STOCKÉS/);
  assert.match(consigne, /NE PUBLIE RIEN/);
  assert.match(consigne, /NE RIEN INVENTER/);

  assert.ok(
    consigne.length < rolePrompt('deploy', false, 'claude').length / 2,
    'la consigne ciblée doit être bien plus courte que le déroulé complet',
  );
});

test('le rôle « deploy » ordinaire garde son déroulé complet', () => {
  const complet = rolePrompt('deploy', false, 'claude');
  assert.match(complet, /MÉTHODE DE TRAVAIL IMPOSÉE/);
  assert.match(complet, /TU ES L'AGENT DE PUBLICATION/);
});

/* ------------------------------------------------------------------ */
/* L'étape « Base de connaissances » suit la mémoire réellement donnée */
/* ------------------------------------------------------------------ */

test('un dépannage ne montre plus d’étape mémoire, une tâche la garde', () => {
  for (const motif of MOTIFS_DE_DEPANNAGE) {
    const niveau = niveauDAccueil({ role: 'deploy', motif });
    assert.equal(afficheEtapeMemoire({ nouvelleSession: true, niveau }), false, `motif ${motif}`);
  }
  for (const motif of ['configuration-backup', 'configuration-surveillance'] as const) {
    assert.equal(afficheEtapeMemoire({ nouvelleSession: true, niveau: niveauDAccueil({ role: 'task', motif }) }), false);
  }
  assert.equal(afficheEtapeMemoire({ nouvelleSession: true, niveau: niveauDAccueil({ role: 'task' }) }), true);
  assert.equal(afficheEtapeMemoire({ nouvelleSession: true, niveau: niveauDAccueil({ role: 'analysis' }) }), true);
  assert.equal(afficheEtapeMemoire({ nouvelleSession: true, niveau: niveauDAccueil({ role: 'cadrage' }) }), true);
  // Session déjà ouverte : jamais d'étape, quel que soit l'accueil.
  assert.equal(afficheEtapeMemoire({ nouvelleSession: false, niveau: 'complet' }), false);
});

test('le démarrage d’un tour pose l’étape mémoire par la règle d’accueil, jamais sur la seule session neuve', () => {
  const runtime = fs.readFileSync(path.resolve(ICI, '../../src/runtime.ts'), 'utf8');
  assert.match(runtime, /const memoryStep: RunStep \| null = afficheEtapeMemoire\(\{ nouvelleSession, niveau \}\)/);
});
