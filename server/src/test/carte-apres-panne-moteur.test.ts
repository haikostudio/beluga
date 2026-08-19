import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Card,
  DELAI_AVANT_REPRISE_APRES_PANNE_MS,
  RAISON_PANNE_MOTEUR,
  demarrageAutomatiqueAutorise,
  mentionDeReprise,
  origineDeReprise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une panne du fournisseur ne laisse plus la carte plantée             */
/* ------------------------------------------------------------------ */

/*
 * Quand une panne passagère du moteur résiste à TOUS les essais du tour, le
 * message affiché promet en toutes lettres que le travail « repartira où il
 * s'était arrêté dès que le fournisseur répondra de nouveau »
 * (`messageDePanneDefinitive`). Personne ne tenait cette promesse : le tour
 * finissait en `reussi: false`, donc `issueDeFinDeTour` ne bougeait rien, la
 * carte restait plantée en « En cours » et l'agent en « stopped » — ce qui
 * interdisait même au balayage des cartes oubliées d'y toucher. Seule une
 * reprise à la main en sortait.
 */

// Une vraie base, dans un dossier jetable, avant d'importer ce qui la lit.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'panne-moteur-carte-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { carteApresFinDeTour } = await import('../deplacement-carte.js');

function carte(overrides: Partial<Card> = {}) {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      title: 'Carte d’essai',
      column: 'running',
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    }),
  );
}

const FIN = {
  role: 'task' as const,
  reussi: false,
  trace: 'non' as const,
  moteurMuet: false,
};

test('une panne qui a résisté à tous les essais renvoie la carte en « Planifié »', () => {
  const c = carte({
    agentId: 'agent-1',
    scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: Date.now() },
  });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: true });

  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.waitingReason, RAISON_PANNE_MOTEUR);
  // La marque de vol s'éteint : le tour a fini de ranger.
  assert.equal(apres.scheduling?.tourEnVolDepuis, undefined);
});

test('une panne n’est pas un essai raté : `attempts` ne bouge pas, `restarts` monte', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 2, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: true });

  assert.equal(apres.scheduling?.attempts, 2);
  assert.equal(apres.scheduling?.restarts, 1);
});

test('la carte repart TOUTE SEULE, mais seulement une fois le délai passé', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: true });

  const quand = apres.scheduling?.departPrevu;
  assert.ok(quand, 'la carte porte une date de reprise');
  // Retenue tant que la panne peut encore durer…
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling, quand! - 1_000), false);
  // …puis reprise par l'ordonnanceur, sans aucun geste humain.
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling, quand! + 1_000), true);
  // Et ce délai laisse vraiment le temps à la panne de passer.
  assert.ok(quand! - Date.now() > DELAI_AVANT_REPRISE_APRES_PANNE_MS - 10_000);
});

test('la carte revenue d’une panne se REPREND, elle ne repart pas de zéro', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: true });

  assert.equal(origineDeReprise(apres), 'panne');
  assert.match(mentionDeReprise(apres) ?? '', /panne/i);
  assert.match(mentionDeReprise(apres) ?? '', /gardé/);
});

test('un échec ORDINAIRE de la tâche laisse toujours la carte en « En cours »', () => {
  // La règle ne bouge pas : un code cassé, des tests qui tombent, cela se relit
  // et se corrige à la main — la carte reste là où on la relance.
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: false });

  assert.equal(apres.column, 'running');
  assert.equal(apres.scheduling?.restarts, 0);
  assert.equal(apres.scheduling?.departPrevu, undefined);
});

test('le tour d’un AUTRE agent ne renvoie rien en file, même sur une panne', () => {
  const c = carte({ agentId: 'agent-2', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: true });

  assert.equal(apres.column, 'running');
  assert.equal(apres.scheduling?.restarts, 0);
});

test('un moteur MUET garde sa propre route : il passe devant la panne', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, {
    ...FIN,
    agentId: 'agent-1',
    moteurMuet: true,
    panneDuMoteur: true,
  });

  assert.equal(apres.column, 'planned');
  assert.notEqual(apres.scheduling?.waitingReason, RAISON_PANNE_MOTEUR);
  // Un lancement jamais parti n'attend rien : il repart à la boucle suivante.
  assert.equal(apres.scheduling?.departPrevu, undefined);
});

test.after(() => fs.rmSync(bacASable, { recursive: true, force: true }));
