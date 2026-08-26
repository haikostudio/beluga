/**
 * Une carte peut porter une DATE de départ : elle attend dans « Planifié » et
 * part à l'heure dite, sans qu'on ait à cliquer.
 *
 * Les règles sont pures — elles comparent une date à un instant donné — donc
 * elles se rejouent ici sans base, sans démon et sans attendre l'heure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RAISON_ATTENTE_LANCEMENT,
  RAISON_SUSPENDU,
  demarrageAutomatiqueAutorise,
  etatDuDepart,
  lireDateDeDepart,
  mentionDepartProgramme,
  momentDeDepart,
  raisonDattente,
} from '@haikodev/shared';

/** Un mardi 11 août 2026, 14 h 30 — heure locale, comme la lit un humain. */
const MAINTENANT = new Date(2026, 7, 11, 14, 30, 0).getTime();
const MINUTE = 60 * 1000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/* ------------------------------------------------------------------ */
/* La règle de départ                                                  */
/* ------------------------------------------------------------------ */

test('date future : rien ne part', () => {
  const carte = { asap: false, attempts: 0, restarts: 0, departPrevu: MAINTENANT + 2 * HEURE };
  assert.equal(etatDuDepart(carte, MAINTENANT), 'attend');
  assert.equal(demarrageAutomatiqueAutorise(carte, MAINTENANT), false);
});

test('date passée : la carte part', () => {
  const carte = { asap: false, attempts: 0, restarts: 0, departPrevu: MAINTENANT - MINUTE };
  assert.equal(etatDuDepart(carte, MAINTENANT), 'venu');
  assert.equal(demarrageAutomatiqueAutorise(carte, MAINTENANT), true);
});

test('carte suspendue : rien ne part, même l’heure venue', () => {
  const carte = { asap: true, attempts: 3, restarts: 1, departPrevu: MAINTENANT - JOUR, suspendu: true };
  assert.equal(demarrageAutomatiqueAutorise(carte, MAINTENANT), false);
});

test('une heure manquée pendant l’arrêt du démon est RATTRAPÉE, jamais oubliée', () => {
  // Le démon était éteint depuis trois jours : au retour, la carte part.
  const carte = { asap: false, attempts: 0, restarts: 0, departPrevu: MAINTENANT - 3 * JOUR };
  assert.equal(demarrageAutomatiqueAutorise(carte, MAINTENANT), true);
});

test('une date à venir retient la carte même marquée « dès que possible »', () => {
  const carte = { asap: true, attempts: 0, restarts: 0, departPrevu: MAINTENANT + HEURE };
  assert.equal(demarrageAutomatiqueAutorise(carte, MAINTENANT), false);
});

test('sans date, rien ne change : les anciennes règles tiennent', () => {
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 0 }, MAINTENANT), false);
  assert.equal(demarrageAutomatiqueAutorise({ asap: true, attempts: 0, restarts: 0 }, MAINTENANT), true);
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 1, restarts: 0 }, MAINTENANT), true);
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 1 }, MAINTENANT), true);
  assert.equal(demarrageAutomatiqueAutorise(undefined, MAINTENANT), false);
});

/* ------------------------------------------------------------------ */
/* Ce que la carte DIT en attendant                                    */
/* ------------------------------------------------------------------ */

test('la phrase d’attente dépend de ce qui retient vraiment la carte', () => {
  assert.equal(raisonDattente({ asap: false, attempts: 0, restarts: 0 }, MAINTENANT), RAISON_ATTENTE_LANCEMENT);
  assert.equal(raisonDattente({ asap: false, attempts: 0, restarts: 0, suspendu: true }, MAINTENANT), RAISON_SUSPENDU);
  // Une carte datée ne dit pas « elle attend votre lancement » : c'est faux,
  // elle partira seule. La date parle à sa place, recalculée à l'affichage.
  assert.equal(
    raisonDattente({ asap: false, attempts: 0, restarts: 0, departPrevu: MAINTENANT + HEURE }, MAINTENANT),
    undefined,
  );
  assert.equal(raisonDattente({ asap: true, attempts: 0, restarts: 0 }, MAINTENANT), undefined);
});

test('la mention affichée dit QUAND la carte partira', () => {
  const mention = mentionDepartProgramme(
    { column: 'planned', scheduling: { departPrevu: MAINTENANT + 2 * HEURE } },
    MAINTENANT,
  );
  assert.ok(mention);
  assert.match(mention, /Départ programmé/);
  assert.match(mention, /aujourd'hui à 16:30/);
  assert.match(mention, /toute seule/);
});

test('l’heure atteinte, la mention annonce le départ imminent', () => {
  const mention = mentionDepartProgramme(
    { column: 'planned', scheduling: { departPrevu: MAINTENANT - MINUTE } },
    MAINTENANT,
  );
  assert.match(mention ?? '', /Heure de départ atteinte/);
});

test('la mention se tait là où la date n’a plus de sens', () => {
  const datee = { departPrevu: MAINTENANT + HEURE };
  for (const column of ['running', 'done', 'to_deploy', 'archived', 'notes']) {
    assert.equal(mentionDepartProgramme({ column, scheduling: datee }, MAINTENANT), null);
  }
  assert.equal(mentionDepartProgramme({ column: 'planned', scheduling: {} }, MAINTENANT), null);
  assert.equal(
    mentionDepartProgramme({ column: 'planned', scheduling: { ...datee, suspendu: true } }, MAINTENANT),
    null,
  );
});

test('le moment se lit en français, sans année inutile', () => {
  assert.equal(momentDeDepart(new Date(2026, 7, 11, 6, 5).getTime(), MAINTENANT), "aujourd'hui à 06:05");
  assert.equal(momentDeDepart(new Date(2026, 7, 12, 6, 0).getTime(), MAINTENANT), 'demain à 06:00');
  assert.equal(momentDeDepart(new Date(2026, 7, 18, 22, 15).getTime(), MAINTENANT), 'le 18.08 à 22:15');
  assert.equal(momentDeDepart(new Date(2027, 0, 3, 9, 0).getTime(), MAINTENANT), 'le 03.01.2027 à 09:00');
});

/* ------------------------------------------------------------------ */
/* Lire une date écrite par un humain ou par un agent                  */
/* ------------------------------------------------------------------ */

test('une date se lit en texte comme en millisecondes', () => {
  assert.equal(lireDateDeDepart(new Date(2026, 7, 12, 6, 0).toISOString()), new Date(2026, 7, 12, 6, 0).getTime());
  assert.equal(lireDateDeDepart('2026-08-12T06:00'), new Date(2026, 7, 12, 6, 0).getTime());
  assert.equal(lireDateDeDepart(MAINTENANT), MAINTENANT);
});

test('une date sans heure commence à minuit CHEZ SOI, pas à Greenwich', () => {
  assert.equal(lireDateDeDepart('2026-08-12'), new Date(2026, 7, 12, 0, 0, 0, 0).getTime());
});

test('ce qui n’est pas une date est REFUSÉ, jamais deviné', () => {
  for (const valeur of ['', '   ', 'mardi prochain', 'bientôt', null, undefined, {}, -1, 0, NaN]) {
    assert.equal(lireDateDeDepart(valeur), null, `refusé : ${String(valeur)}`);
  }
});

/* ------------------------------------------------------------------ */
/* Le branchement dans le démon                                        */
/* ------------------------------------------------------------------ */

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scheduler = fs.readFileSync(path.join(RACINE, 'server/src/scheduler.ts'), 'utf8');

test('le départ CONSOMME la date : une date, une fois', () => {
  // `startCard` efface `departPrevu` en lançant la carte, comme il efface la
  // suspension : sans cela, une carte relancée repartirait sur une date morte.
  assert.match(scheduler, /departPrevu: undefined/);
});

test('l’heure dite passe la porte des heures creuses', () => {
  // Sans cela, une tâche lourde programmée à 14 h attendrait 22 h : la promesse
  // « elle part à l'heure dite » serait fausse.
  assert.match(scheduler, /etatDuDepart\(card\.scheduling, Date\.now\(\)\) !== 'venu'/);
});
