import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  AttenteDepassee,
  Card,
  Message,
  RAISON_COUPE_EN_VOL,
  attendreAuPlus,
  decisionsCaduquesAuRedemarrage,
  demandeCoupeeAvantLeMoteur,
  phraseDAttenteDepassee,
  raisonDuRefusDeLancement,
  tourBloque,
  PLAFOND_PREPARATION_MS,
  PLAFONDS_DU_LANCEMENT,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LES TÂCHES SURVIVENT À UN REDÉMARRAGE (15/11/2026)                  */
/*                                                                     */
/* Trois nuits de suite, toutes les préparations de tour sont restées  */
/* pendues à « démarrage du moteur » jusqu'au filet de cinq minutes ;  */
/* « Relancer » repartait et repend ; après le redémarrage forcé, la   */
/* veille des compétences disait « repart d'elle-même » et restait     */
/* retenue en silence par une décision d'avant, et le message d'un      */
/* cadrage coupé n'a jamais été renvoyé.                               */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'redemarrage-borne-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const runtime = await import('../runtime.js');
const scheduler = await import('../scheduler.js');

/* ------------------------------------------------------------------ */
/* 1. Une attente a toujours une fin                                    */
/* ------------------------------------------------------------------ */

test('une attente qui répond à temps rend sa valeur, sans attendre le plafond', async () => {
  const debut = Date.now();
  assert.equal(await attendreAuPlus(Promise.resolve(42), 5_000, 'essai'), 42);
  assert.ok(Date.now() - debut < 1_000);
});

test('une attente pendue rend son repli au plafond, et le dit une fois', async () => {
  const jamais = new Promise<number>(() => {});
  const dits: string[] = [];
  const valeur = await attendreAuPlus(jamais, 30, 'catalogue des moteurs', {
    repli: () => -1,
    auPlafond: (etape) => dits.push(etape),
  });
  assert.equal(valeur, -1);
  assert.deepEqual(dits, ['catalogue des moteurs']);
});

test('sans repli, l’attente pendue rejette une erreur qui NOMME l’étape', async () => {
  const jamais = new Promise<string>(() => {});
  await assert.rejects(attendreAuPlus(jamais, 20, 'copie de travail de la carte'), (err: unknown) => {
    assert.ok(err instanceof AttenteDepassee);
    assert.equal(err.etape, 'copie de travail de la carte');
    assert.match(err.message, /« copie de travail de la carte »/);
    return true;
  });
});

test('une promesse qui échoue après le plafond ne devient pas un rejet non traité', async () => {
  let rejeter: (e: Error) => void = () => {};
  const tardive = new Promise<number>((_, r) => (rejeter = r));
  assert.equal(await attendreAuPlus(tardive, 10, 'essai', { repli: () => 0 }), 0);
  rejeter(new Error('trop tard'));
  await new Promise((r) => setTimeout(r, 20));
});

test('les plafonds du départ tiennent sous le filet de cinq minutes', () => {
  const somme =
    PLAFONDS_DU_LANCEMENT.catalogue +
    PLAFONDS_DU_LANCEMENT.copieDeTravail +
    PLAFONDS_DU_LANCEMENT.copiesAnnexes / 2 +
    PLAFONDS_DU_LANCEMENT.repereGit * 2 +
    PLAFONDS_DU_LANCEMENT.guideDesServices +
    PLAFONDS_DU_LANCEMENT.jetonGithub;
  assert.ok(somme < PLAFOND_PREPARATION_MS, `${somme} ms`);
  assert.match(phraseDAttenteDepassee('jeton GitHub', 15_000), /« jeton GitHub » \(aucune réponse en 15 s\)/);
});

test('le filet de la préparation nomme l’étape où le tour pendait', () => {
  const verdict = tourBloque({
    statut: 'starting',
    suivi: true,
    enPreparation: true,
    partiDepuisMs: PLAFOND_PREPARATION_MS + 1,
    etapeDePreparation: 'repère du dossier partagé',
  });
  assert.match(verdict?.raison ?? '', /à l’étape « repère du dossier partagé »/);
  const anonyme = tourBloque({ statut: 'starting', suivi: true, enPreparation: true, partiDepuisMs: PLAFOND_PREPARATION_MS + 1 });
  assert.match(anonyme?.raison ?? '', /avant même le lancement du moteur :/);
});

/* ------------------------------------------------------------------ */
/* 2. Les règles pures du redémarrage                                   */
/* ------------------------------------------------------------------ */

test('seule une carte avant le travail qui annonce « repart d’elle-même » voit ses décisions closes', () => {
  assert.equal(decisionsCaduquesAuRedemarrage({ column: 'planned', scheduling: { waitingReason: RAISON_COUPE_EN_VOL } }), true);
  assert.equal(
    decisionsCaduquesAuRedemarrage({ column: 'planned', scheduling: { waitingReason: RAISON_COUPE_EN_VOL, suspendu: true } }),
    false,
    'une carte suspendue attend le geste',
  );
  assert.equal(decisionsCaduquesAuRedemarrage({ column: 'running', scheduling: { waitingReason: RAISON_COUPE_EN_VOL } }), false);
  assert.equal(
    decisionsCaduquesAuRedemarrage({ column: 'planned', scheduling: { waitingReason: 'Une erreur a arrêté le travail' } }),
    false,
    'une décision reposée après la reprise reste ouverte',
  );
});

test('le refus d’un lancement s’écrit en clair, sans préfixe', () => {
  assert.equal(
    raisonDuRefusDeLancement('Lancement refusé : une erreur a arrêté le travail : tranchez-la d’abord.'),
    'Une erreur a arrêté le travail : tranchez-la d’abord.',
  );
  assert.equal(raisonDuRefusDeLancement(undefined), undefined);
  assert.equal(raisonDuRefusDeLancement('Lancement refusé :  '), undefined);
});

test('un « Relancer » coupé à son tour rejoue la demande qu’il renvoyait', () => {
  const maintenant = 1_000_000_000;
  const humaine = { id: 'u', role: 'user' as const, createdAt: maintenant - 60_000 };
  const echec = {
    id: 'e',
    role: 'assistant' as const,
    createdAt: maintenant - 30_000,
    error: 'bloquée',
    erreurDeTour: { choix: 'relancer', demandeARejouer: 'u' },
  };
  assert.equal(demandeCoupeeAvantLeMoteur([echec, humaine], maintenant)?.id, 'u');
  // Sans relance choisie, l'échec est une réponse : rien ne repart seul.
  assert.equal(demandeCoupeeAvantLeMoteur([{ ...echec, erreurDeTour: { demandeARejouer: 'u' } }, humaine], maintenant), null);
  // Une demande déjà reçue par un moteur ne repart pas.
  assert.equal(demandeCoupeeAvantLeMoteur([echec, { ...humaine, sentContext: {} }], maintenant), null);
});

/* ------------------------------------------------------------------ */
/* 3. Au démarrage : la décision caduque se ferme, la carte repart      */
/* ------------------------------------------------------------------ */

function agent(id: string, extra: Partial<Agent> = {}): Agent {
  const maintenant = Date.now();
  return store.saveAgent(
    Agent.parse({
      id,
      projectId: 'projet-essai',
      role: 'analysis',
      title: `Agent ${id}`,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'failed',
      createdAt: maintenant,
      updatedAt: maintenant,
      ...extra,
    }),
  );
}

function carte(overrides: Partial<Card> = {}): Card {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      title: 'Veille des compétences — essai',
      column: 'planned',
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    }),
  );
}

function echecOuvert(agentId: string): Message {
  return store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId,
      role: 'assistant',
      content: 'La préparation de ce tour est restée bloquée avant même le lancement du moteur.',
      error: 'bloquée',
      erreurDeTour: { cause: 'bloquée', at: Date.now() - 60_000 },
      createdAt: Date.now() - 60_000,
    }),
  );
}

test('LA VEILLE : la décision d’avant le redémarrage est close, la carte n’est plus retenue', () => {
  const c = carte({ scheduling: { asap: false, attempts: 1, restarts: 1, waitingReason: RAISON_COUPE_EN_VOL } });
  const a = agent('agent-veille', { cardId: c.id });
  store.saveCard({ ...c, agentId: a.id });
  const m = echecOuvert(a.id);
  assert.match(scheduler.decisionOuverteSurLaCarte(c.id) ?? '', /erreur a arrêté le travail/, 'le constat du 15/11');

  assert.equal(runtime.fermerLesDecisionsCaduques(), 1);
  const ferme = store.getMessage(m.id)!;
  assert.equal(ferme.erreurDeTour?.choix, 'relancer');
  assert.equal(ferme.erreurDeTour?.fermeeParRedemarrage, true);
  assert.equal(scheduler.decisionOuverteSurLaCarte(c.id), null, 'plus rien ne retient la carte');
  assert.equal(runtime.fermerLesDecisionsCaduques(), 0, 'une seule fois');
});

test('une décision reposée après la reprise reste ouverte, et la carte le dit', () => {
  const c = carte({ scheduling: { asap: false, attempts: 1, restarts: 1, waitingReason: 'Une erreur a arrêté le travail : tranchez-la d’abord.' } });
  const a = agent('agent-reprise-ratee', { cardId: c.id });
  store.saveCard({ ...c, agentId: a.id });
  const m = echecOuvert(a.id);
  assert.equal(runtime.fermerLesDecisionsCaduques(), 0);
  assert.equal(store.getMessage(m.id)!.erreurDeTour?.choix, undefined);
});

/* ------------------------------------------------------------------ */
/* 4. Le redémarrage forcé rend la demande en préparation à la file     */
/* ------------------------------------------------------------------ */

test('une demande relevée en préparation revient en tête de file, une seule fois', () => {
  const a = agent('agent-cadrage-coupe', { role: 'cadrage', status: 'stopped' });
  store.enqueuePrompt(a.id, 'une demande déjà en file', []);
  const demande = store.saveMessage(
    Message.parse({ id: store.newId(), agentId: a.id, role: 'user', content: 'le message du cadrage coupé', createdAt: Date.now() }),
  );
  assert.equal(runtime.remettreEnFileLesDemandes([{ agentId: a.id, demandeId: demande.id }]), 1);
  const file = store.listQueue(a.id);
  assert.equal(file[0].messageId, demande.id, 'en tête, avec sa bulle');
  assert.equal(file[0].text, 'le message du cadrage coupé');
  assert.equal(runtime.remettreEnFileLesDemandes([{ agentId: a.id, demandeId: demande.id }]), 0, 'jamais doublée');

  const reponse = store.saveMessage(
    Message.parse({ id: store.newId(), agentId: a.id, role: 'assistant', content: 'une réponse', createdAt: Date.now() }),
  );
  assert.equal(runtime.remettreEnFileLesDemandes([{ agentId: a.id, demandeId: reponse.id }]), 0, 'seule une bulle humaine repart');
  assert.equal(runtime.remettreEnFileLesDemandes([{ agentId: a.id, demandeId: 'disparue' }]), 0, 'une bulle disparue ne repart pas');
});
