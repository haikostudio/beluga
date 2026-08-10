import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTIFS_DE_DEPANNAGE, niveauDAccueil, partsDAccueil } from '@haikodev/shared';
import { appendMemory, blocMemoire, briefing } from '../memory.js';
import { rolePrompt } from '../runtime.js';

/*
 * ALLÉGER LE CONTEXTE DES AGENTS DE DÉPANNAGE DE PUBLICATION.
 *
 * `resoudreConflit`, `reparerLesControles` et `reparerLaConstruction` créent un
 * agent NEUF à chaque incident : la session étant neuve, le briefing complet
 * partait — fichiers d'instructions, compétences partagées et INDEX DE LA
 * MÉMOIRE, qui grandit à chaque carte livrée — pour une demande qui nomme déjà
 * ses fichiers, ses contrôles ou sa cause. Ces trois-là reçoivent désormais un
 * accueil MINIMAL ; tous les autres gardent le leur.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DEPLOY = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

function dossierDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-accueil-'));
  fs.writeFileSync(path.join(dossier, 'CLAUDE.md'), '# Essai\n\nInstructions du moteur.\n');
  for (let i = 0; i < 12; i++) {
    appendMemory(dossier, `Règle ${i} sur le tiroir du téléphone : un piège déjà payé une fois.`);
  }
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

test('le chef d’orchestre reçoit l’accueil de TRI : il ne lit plus le projet', () => {
  assert.equal(niveauDAccueil({ role: 'orchestrator' }), 'tri');
  assert.equal(niveauDAccueil({ role: 'orchestrator', motif: 'conflit' }), 'tri');
});

test('l’accueil minimal n’emporte ni mémoire, ni compétences, ni instructions', () => {
  assert.deepEqual(partsDAccueil('minimal'), { instructions: false, competences: false, memoire: false });
  assert.deepEqual(partsDAccueil('complet'), { instructions: true, competences: true, memoire: true });
});

/*
 * Le tri garde les COMPÉTENCES : le chef n'a pas le droit d'ouvrir celles de son
 * moteur, et sans cette ligne il répondrait « je ne sais pas faire » devant un
 * mode d'emploi qui existe. L'index de la mémoire (des dizaines de faits) et les
 * fichiers d'instructions, eux, ne lui servent plus à rien.
 */
test('l’accueil de tri garde les compétences, mais laisse mémoire et instructions', () => {
  assert.deepEqual(partsDAccueil('tri'), { instructions: false, competences: true, memoire: false });
});

/* ------------------------------------------------------------------ */
/* Ce qui part réellement au moteur                                    */
/* ------------------------------------------------------------------ */

test('le briefing d’un dépannage ne porte plus le bloc mémoire', () => {
  const dossier = dossierDEssai();

  const complet = briefing(dossier, 'Essai', true, 'claude', undefined, 'complet');
  const minimal = briefing(dossier, 'Essai', true, 'claude', undefined, 'minimal');

  // Le témoin : l'accueil complet, lui, porte bien l'index.
  assert.ok(complet.includes(blocMemoire(dossier)), 'l’accueil complet garde la mémoire');
  assert.match(complet, /index des faits retenus \(12\)/);

  assert.doesNotMatch(minimal, /index des faits retenus/);
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
/* Les trois appels de la publication                                  */
/* ------------------------------------------------------------------ */

test('les trois dépannages de publication demandent bien l’accueil réduit', () => {
  for (const [fonction, motif] of [
    ['resoudreConflit', 'conflit'],
    ['reparerLesControles', 'controles'],
    ['reparerLaConstruction', 'construction'],
  ] as const) {
    const debut = SOURCE_DEPLOY.indexOf(`async function ${fonction}`);
    assert.ok(debut > 0, `${fonction} doit exister`);
    const corps = SOURCE_DEPLOY.slice(debut, debut + 4000);
    assert.match(
      corps,
      new RegExp(`sendPrompt\\([^)]*motif: '${motif}'`, 's'),
      `${fonction} doit passer le motif « ${motif} »`,
    );
  }
});

test('la mise en ligne confiée n’est pas traitée comme un dépannage', () => {
  const debut = SOURCE_DEPLOY.indexOf('async function confierLaMiseEnLigne');
  assert.ok(debut > 0, 'confierLaMiseEnLigne doit exister');
  const corps = SOURCE_DEPLOY.slice(debut, debut + 4000);
  assert.match(corps, /motif: 'mise-en-ligne'/);
});
