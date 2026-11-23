import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Card,
  DELAI_AVANT_REPRISE_APRES_PANNE_MS,
  RAISON_MACHINE_SATUREE,
  RAISON_PANNE_MOTEUR,
  RAISON_PONT_EPUISE,
  RAISON_PONT_MORT,
  ESSAIS_DE_PONT_MAX,
  demarrageAutomatiqueAutorise,
  mentionDeReprise,
  origineDeReprise,
} from '@beluga/shared';

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
process.env.BELUGA_DATA = bacASable;

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

/* ------------------------------------------------------------------ */
/* Un tour privé d'OUTILS ne laisse plus la carte plantée               */
/* ------------------------------------------------------------------ */

/*
 * L'agent n'a jamais reçu le pont d'outils : ni mémoire du projet, ni écriture
 * de mémoire, ni geste de tableau — donc pas même de quoi ranger sa propre
 * carte. La panne se DISAIT déjà (étape rouge, encadré dans la réponse) mais
 * n'avait aucune conséquence : la carte restait figée en « En cours ».
 */

test('un pont d’outils mort-né renvoie la carte en « Planifié », avec sa phrase', () => {
  const c = carte({
    agentId: 'agent-1',
    scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: Date.now() },
  });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', pontMort: true });

  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.waitingReason, RAISON_PONT_MORT);
  assert.equal(apres.scheduling?.tourEnVolDepuis, undefined);
});

test('la carte sans outils attend avant de repartir : le pont ne renaît pas en 15 s', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', pontMort: true });

  const quand = apres.scheduling?.departPrevu;
  assert.ok(quand, 'la carte porte une date de reprise');
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling, quand! - 1_000), false);
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling, quand! + 1_000), true);
  // Et ce n'est pas un essai raté : c'est un tour qui n'a jamais eu ses moyens.
  assert.equal(apres.scheduling?.attempts, 1);
  assert.equal(apres.scheduling?.restarts, 1);
});

test('la carte sans outils se REPREND, elle ne repart pas de zéro', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', pontMort: true });

  assert.equal(origineDeReprise(apres), 'sans-outils');
  assert.match(mentionDeReprise(apres) ?? '', /outils/i);
  assert.match(mentionDeReprise(apres) ?? '', /gardé/);
});

/* ------------------------------------------------------------------ */
/* …ET LES REJEUX ONT UNE FIN : au quatrième tour, on DEMANDE            */
/* ------------------------------------------------------------------ */

/*
 * Rejouer sans plafond est une boucle : une machine durablement pleine referait
 * le tour indéfiniment, en brûlant du quota à chaque passage, sans que personne
 * ne le voie. Trois rejeux silencieux, puis la décision.
 */

test('chaque tour sans outils fait monter le compteur, et le délai avec lui', () => {
  const un = carteApresFinDeTour(
    carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } }),
    { ...FIN, agentId: 'agent-1', pontMort: true },
  );
  assert.equal(un.scheduling?.essaisSansOutils, 1);

  const deux = carteApresFinDeTour(
    carte({ agentId: 'agent-2', scheduling: { asap: false, attempts: 1, restarts: 0, essaisSansOutils: 1 } }),
    { ...FIN, agentId: 'agent-2', pontMort: true },
  );
  assert.equal(deux.scheduling?.essaisSansOutils, 2);
  assert.ok((deux.scheduling?.departPrevu ?? 0) > (un.scheduling?.departPrevu ?? 0));
});

test('au quatrième tour sans outils, la carte NE BOUGE PLUS : elle demande', () => {
  const c = carte({
    agentId: 'agent-3',
    scheduling: { asap: false, attempts: 1, restarts: 0, essaisSansOutils: ESSAIS_DE_PONT_MAX },
  });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-3', pontEpuise: true });

  // Ni refermée — trois tours à l'aveugle ne sont pas un travail livré —
  // ni renvoyée en file : elle reste là, avec sa phrase.
  assert.equal(apres.column, 'running');
  assert.equal(apres.sansModification, RAISON_PONT_EPUISE);
  assert.equal(apres.scheduling?.essaisSansOutils, ESSAIS_DE_PONT_MAX + 1);
});

test('un tour qui a eu ses outils efface l’ardoise', () => {
  const c = carte({
    agentId: 'agent-4',
    scheduling: { asap: false, attempts: 1, restarts: 0, essaisSansOutils: 2 },
  });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-4', reussi: true });
  assert.equal(apres.scheduling?.essaisSansOutils, undefined);
});

test('un moteur muet et une panne passent tous deux devant le pont mort-né', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const muet = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', moteurMuet: true, pontMort: true });
  assert.notEqual(muet.scheduling?.waitingReason, RAISON_PONT_MORT);

  const panne = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', panneDuMoteur: true, pontMort: true });
  assert.equal(panne.scheduling?.waitingReason, RAISON_PANNE_MOTEUR);
});

/* ------------------------------------------------------------------ */
/* Quand c'est LE SERVEUR qui était plein, la carte le dit               */
/* ------------------------------------------------------------------ */

test('une machine saturée écrit sa propre cause, par-dessus les autres', () => {
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, {
    ...FIN,
    agentId: 'agent-1',
    moteurMuet: true,
    machineSaturee: true,
  });

  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.waitingReason, RAISON_MACHINE_SATUREE);
  assert.equal(origineDeReprise(apres), 'machine-pleine');
  // Un moteur muet repartait dans les 15 s : sur une machine pleine, c'était
  // relancer dans le mur, encore et encore.
  assert.ok((apres.scheduling?.departPrevu ?? 0) > Date.now());
});

test('un moteur injoignable ne traîne pas la date d’attente d’une interruption d’avant', () => {
  // Sa phrase promet une nouvelle tentative automatique : une vieille échéance
  // la retenait en « Planifié » sans jamais la faire repartir.
  const c = carte({
    agentId: 'agent-1',
    scheduling: { asap: false, attempts: 1, restarts: 1, departPrevu: Date.now() + 300_000 },
  });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', moteurMuet: true });

  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.departPrevu, undefined);
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling, Date.now()), true);
});

test('une machine saturée ne range RIEN si la carte n’était pas renvoyée en file', () => {
  // Tour tombé sur un échec ordinaire : la règle ne déplace pas la carte, la
  // phrase de saturation n'a donc rien à écrire dessus.
  const c = carte({ agentId: 'agent-1', scheduling: { asap: false, attempts: 1, restarts: 0 } });
  const apres = carteApresFinDeTour(c, { ...FIN, agentId: 'agent-1', machineSaturee: true });

  assert.equal(apres.column, 'running');
  assert.notEqual(apres.scheduling?.waitingReason, RAISON_MACHINE_SATUREE);
});

test.after(() => fs.rmSync(bacASable, { recursive: true, force: true }));
