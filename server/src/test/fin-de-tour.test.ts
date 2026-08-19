import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  DELAI_AVANT_PROCESSUS_DISPARU_MS,
  PLAFOND_FERMETURE_MS,
  PLAFOND_PREPARATION_MS,
  PLAFOND_SILENCE_MOTEUR_MS,
  statutDeFermetureForcee,
  tourBloque,
} from '@haikodev/shared';
import { finDuProcessus } from '../engines/fin-de-processus.js';

/* ------------------------------------------------------------------ */
/* Le jugement : quand un tour est-il bloqué ?                         */
/* ------------------------------------------------------------------ */

test('un agent au repos n’est jamais jugé bloqué', () => {
  for (const statut of ['idle', 'stopped', 'failed', 'done'] as const) {
    assert.equal(tourBloque({ statut, suivi: false, partiDepuisMs: 10 * 3_600_000 }), null, statut);
  }
});

test('un tour qui réfléchit longtemps travaille : on ne le referme pas', () => {
  const verdict = tourBloque({
    statut: 'running',
    suivi: true,
    processusVivant: true,
    partiDepuisMs: 3 * 3_600_000,
  });
  assert.equal(verdict, null);
});

test('un tour que le serveur ne suit plus est refermé aussitôt', () => {
  const verdict = tourBloque({ statut: 'running', suivi: false, partiDepuisMs: 5_000 });
  assert.match(verdict?.raison ?? '', /plus suivi/);
});

test('un moteur disparu sans rendre la main est refermé, mais pas avant la minute de grâce', () => {
  const commun = { statut: 'running' as const, suivi: true, processusVivant: false };
  assert.equal(tourBloque({ ...commun, partiDepuisMs: DELAI_AVANT_PROCESSUS_DISPARU_MS - 1 }), null);
  assert.match(
    tourBloque({ ...commun, partiDepuisMs: DELAI_AVANT_PROCESSUS_DISPARU_MS + 1 })?.raison ?? '',
    /sans rendre la main/,
  );
});

test('la compression qui suit la réponse n’est pas prise pour un moteur disparu', () => {
  // Le processus du tour est fini — c'est normal à ce moment-là : c'est un
  // appel de service qui court. Seul le plafond de fermeture tranche.
  const verdict = tourBloque({
    statut: 'running',
    suivi: true,
    processusVivant: false,
    reponseFigeeDepuisMs: 30_000,
    partiDepuisMs: 600_000,
  });
  assert.equal(verdict, null);
});

test('une réponse rendue depuis trop longtemps referme le tour', () => {
  const commun = { statut: 'running' as const, suivi: true, partiDepuisMs: 3_600_000 };
  assert.equal(tourBloque({ ...commun, reponseFigeeDepuisMs: PLAFOND_FERMETURE_MS - 1 }), null);
  assert.match(
    tourBloque({ ...commun, reponseFigeeDepuisMs: PLAFOND_FERMETURE_MS + 60_000 })?.raison ?? '',
    /réponse était rendue/,
  );
});

/* ------------------------------------------------------------------ */
/* La PRÉPARATION : le cul-de-sac qui obligeait à redémarrer le serveur */
/* ------------------------------------------------------------------ */

test('une préparation ordinaire n’est pas jugée bloquée', () => {
  const verdict = tourBloque({
    statut: 'starting',
    suivi: true,
    enPreparation: true,
    partiDepuisMs: 20_000,
  });
  assert.equal(verdict, null);
});

test('une préparation qui ne finit jamais est refermée à son plafond', () => {
  const commun = { statut: 'starting' as const, suivi: true, enPreparation: true };
  assert.equal(
    tourBloque({ ...commun, partiDepuisMs: PLAFOND_PREPARATION_MS - 1 }),
    null,
    'sous le plafond, on laisse préparer',
  );
  assert.match(
    tourBloque({ ...commun, partiDepuisMs: PLAFOND_PREPARATION_MS + 1 })?.raison ?? '',
    /préparation/,
  );
});

test('une préparation trop longue est refermée même sans aucun moteur connu', () => {
  // Le cas réel : aucun processus n'a été lancé, donc `processusVivant` ne dit
  // rien, et aucune réponse n'a été figée. Avant ce plafond, RIEN ne le voyait.
  const verdict = tourBloque({
    statut: 'starting',
    suivi: true,
    enPreparation: true,
    processusVivant: undefined,
    reponseFigeeDepuisMs: undefined,
    partiDepuisMs: 3 * 3_600_000,
  });
  assert.ok(verdict, 'un agent ne reste plus bloqué jusqu’au redémarrage');
});

/* ------------------------------------------------------------------ */
/* Le SILENCE d'un moteur pourtant vivant                              */
/* ------------------------------------------------------------------ */

test('un moteur qui parle encore n’est jamais jugé silencieux', () => {
  const verdict = tourBloque({
    statut: 'running',
    suivi: true,
    processusVivant: true,
    partiDepuisMs: 5 * 3_600_000,
    silenceDepuisMs: 60_000,
  });
  assert.equal(verdict, null);
});

test('un moteur muet depuis trop longtemps est refermé', () => {
  const commun = { statut: 'running' as const, suivi: true, processusVivant: true, partiDepuisMs: 5 * 3_600_000 };
  assert.equal(tourBloque({ ...commun, silenceDepuisMs: PLAFOND_SILENCE_MOTEUR_MS - 1 }), null);
  assert.match(
    tourBloque({ ...commun, silenceDepuisMs: PLAFOND_SILENCE_MOTEUR_MS + 60_000 })?.raison ?? '',
    /signe de vie/,
  );
});

test('un tour arrêté sur une question n’est jamais pris pour un moteur muet', () => {
  // `ask_user` suspend le tour jusqu'à trente minutes : ce silence-là est voulu.
  const verdict = tourBloque({
    statut: 'running',
    suivi: true,
    processusVivant: true,
    partiDepuisMs: 5 * 3_600_000,
    silenceDepuisMs: PLAFOND_SILENCE_MOTEUR_MS + 3_600_000,
    attendUneReponse: true,
  });
  assert.equal(verdict, null);
});

test('une réponse rendue reste un travail fini, un silence reste un échec', () => {
  assert.equal(statutDeFermetureForcee({ reponseRendue: true }), 'done');
  assert.equal(statutDeFermetureForcee({ reponseRendue: false }), 'failed');
});

/* ------------------------------------------------------------------ */
/* La fin du processus, pour de vrai                                   */
/* ------------------------------------------------------------------ */

test('un moteur fini rend la main même si un petit-fils garde la sortie ouverte', async () => {
  // Le cas exact du blocage : le programme se termine, mais un enfant qu'il a
  // lancé hérite de sa sortie standard et la garde ouverte. « close » n'arrive
  // alors jamais — « exit », si.
  const child = spawn('bash', ['-c', 'sleep 120 & echo fini; exit 0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  child.stdout.on('data', (chunk: Buffer) => {
    sortie += chunk.toString('utf8');
  });

  const depart = Date.now();
  const resultat = await finDuProcessus(child, {
    moteur: 'essai',
    cloturer: (code) => ({ ok: code === 0 }),
    surErreur: () => {},
  });
  const duree = Date.now() - depart;

  assert.equal(resultat.ok, true);
  assert.match(sortie, /fini/);
  assert.ok(duree < 15_000, `la main a été rendue en ${duree} ms`);
});

test('un moteur qui ne finit pas est arrêté à son plafond', async () => {
  const child = spawn('bash', ['-c', 'sleep 120'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const depart = Date.now();
  const resultat = await finDuProcessus(child, {
    moteur: 'essai',
    plafondMs: 500,
    cloturer: (code, depassement) => ({
      ok: code === 0 && !depassement,
      error: depassement ? 'plafond atteint' : undefined,
    }),
    surErreur: () => {},
  });
  const duree = Date.now() - depart;

  assert.equal(resultat.ok, false);
  assert.equal(resultat.error, 'plafond atteint');
  assert.ok(duree < 10_000, `le plafond a joué en ${duree} ms`);
});

test('un moteur introuvable rend la main sans attendre', async () => {
  const child = spawn('cette-commande-nexiste-pas-haikodev', [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let dit = '';
  const resultat = await finDuProcessus(child, {
    moteur: 'essai',
    cloturer: () => ({ ok: true }),
    surErreur: (message) => {
      dit = message;
    },
  });
  assert.equal(resultat.ok, false);
  assert.ok(dit.length > 0);
});

/* ------------------------------------------------------------------ */
/* Le rangement d'après-réponse : le statut n'est plus le seul portier  */
/* ------------------------------------------------------------------ */

test('un tour encore suivi dont la réponse est figée depuis trop longtemps est refermé, même si le statut est déjà retombé', () => {
  for (const statut of ['done', 'stopped', 'failed'] as const) {
    const verdict = tourBloque({
      statut,
      suivi: true,
      reponseFigeeDepuisMs: PLAFOND_FERMETURE_MS + 60_000,
      partiDepuisMs: PLAFOND_FERMETURE_MS + 120_000,
    });
    assert.match(verdict?.raison ?? '', /La réponse était rendue depuis/, statut);
  }
});

test('un rangement d’après-réponse encore dans son plafond n’est pas refermé', () => {
  const verdict = tourBloque({
    statut: 'done',
    suivi: true,
    reponseFigeeDepuisMs: 30_000,
    partiDepuisMs: 300_000,
  });
  assert.equal(verdict, null);
});

test('un agent au repos que le démon ne suit plus reste hors de tout jugement', () => {
  const verdict = tourBloque({
    statut: 'done',
    suivi: false,
    reponseFigeeDepuisMs: PLAFOND_FERMETURE_MS * 10,
    partiDepuisMs: PLAFOND_FERMETURE_MS * 10,
  });
  assert.equal(verdict, null);
});

test('un agent au repos suivi mais sans réponse figée n’est pas jugé non plus', () => {
  const verdict = tourBloque({ statut: 'done', suivi: true, partiDepuisMs: 10 * 3_600_000 });
  assert.equal(verdict, null);
});
