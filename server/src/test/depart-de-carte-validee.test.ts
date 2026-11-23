/**
 * UNE CARTE VALIDÉE PART À L'HEURE DITE, MÊME SANS PLAN.
 *
 * Le 04.10.2026, la carte « Vraies images de la page d'accueil » a été validée
 * avec une heure de départ depuis le tiroir de programmation, puis a attendu
 * six heures : l'ordonnanceur la tenait pour « encore en cadrage » tant
 * qu'aucun plan n'existait, alors que le plan est facultatif et qu'elle n'en
 * portait aucun. Ce fichier rejoue ce cas, d'abord par la règle seule, puis
 * sur une vraie carte écrite en base par les mêmes portes que l'écran
 * (`validerLaComprehension`, `programmerLeDepart`, `agentDeCadrage`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Agent,
  TITRE_CARTE_DE_CADRAGE,
  carteLibreDePartirSeule,
  cartePrisonniereDuCadrage,
  comprehensionValideePourLaVersionCourante,
  departDeRelanceAccorde,
  programmerLeDepart,
  relanceRetenueAvantLancement,
} from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'depart-de-carte-validee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { validerLaComprehension } = await import('../scheduler.js');
const { agentDeCadrage } = await import('../cadrage.js');

const MAINTENANT = new Date(2026, 9, 4, 17, 13, 0).getTime();
const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

/* ------------------------------------------------------------------ */
/* La règle du cadrage, seule                                          */
/* ------------------------------------------------------------------ */

test('un cadrage sans plan ET sans validation retient la carte', () => {
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 0 }), true);
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 0, comprehensionValidee: false }), true);
});

test('une compréhension validée ferme le cadrage, sans plan', () => {
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 0, comprehensionValidee: true }), false);
});

test('un plan rendu le ferme toujours, et une carte sans cadrage n’est jamais retenue', () => {
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 1 }), false);
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: false, plansRendus: 0 }), false);
});

test('un lancement demandé puis refusé par une porte qui se rouvre le ferme aussi', () => {
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 0, lancementDemande: true }), false);
});

/* ------------------------------------------------------------------ */
/* Les refus de la boucle, réunis                                      */
/* ------------------------------------------------------------------ */

/** La carte du 04.10.2026 : cadrée, sans plan, validée, datée, jamais lancée. */
const VALIDEE_ET_DATEE = {
  column: 'planned',
  scheduling: { asap: false, attempts: 0, restarts: 0, departPrevu: MAINTENANT - MINUTE },
  parcours: { plans: [], comprehensionValidee: { at: MAINTENANT - 6 * HEURE, comprehensionAt: 10 } },
};

test('validée et datée, l’heure venue : la carte part, plan ou pas', () => {
  assert.equal(carteLibreDePartirSeule(VALIDEE_ET_DATEE, true, MAINTENANT), true);
});

test('la même carte attend tant que son heure n’est pas venue', () => {
  const aVenir = { ...VALIDEE_ET_DATEE, scheduling: { ...VALIDEE_ET_DATEE.scheduling, departPrevu: MAINTENANT + HEURE } };
  assert.equal(carteLibreDePartirSeule(aVenir, true, MAINTENANT), false);
});

test('une carte datée que PERSONNE n’a validée reste retenue', () => {
  const nonValidee = { ...VALIDEE_ET_DATEE, parcours: { plans: [] } };
  assert.equal(carteLibreDePartirSeule(nonValidee, true, MAINTENANT), false);
  /* Sans agent de cadrage — carte du chef, carte écrite à la main —, la date
     suffit, comme avant : sa description est déjà sa demande. */
  assert.equal(carteLibreDePartirSeule(nonValidee, false, MAINTENANT), true);
});

test('« Dès que possible » suit la même règle : validée elle part, sinon elle attend', () => {
  const enFile = { asap: true, attempts: 0, restarts: 0 };
  assert.equal(
    carteLibreDePartirSeule({ ...VALIDEE_ET_DATEE, scheduling: enFile }, true, MAINTENANT),
    true,
  );
  assert.equal(carteLibreDePartirSeule({ column: 'planned', scheduling: enFile, parcours: { plans: [] } }, true, MAINTENANT), false);
});

test('validée mais sans date ni file : elle attend son clic', () => {
  const sansGeste = { ...VALIDEE_ET_DATEE, scheduling: { asap: false, attempts: 0, restarts: 0 } };
  assert.equal(carteLibreDePartirSeule(sansGeste, true, MAINTENANT), false);
});

test('la suspension à la main l’emporte sur tout', () => {
  const suspendue = { ...VALIDEE_ET_DATEE, scheduling: { ...VALIDEE_ET_DATEE.scheduling, suspendu: true } };
  assert.equal(carteLibreDePartirSeule(suspendue, true, MAINTENANT), false);
});

test('un lancement refusé faute de quota se rejoue, même sur une carte en cadrage sans plan', () => {
  const armee = {
    column: 'planned',
    scheduling: { asap: false, attempts: 0, restarts: 0, reprendreDesQuePossible: true },
    parcours: { plans: [] },
  };
  assert.equal(carteLibreDePartirSeule(armee, true, MAINTENANT), true);
});

/* ------------------------------------------------------------------ */
/* La carte RELANCÉE : seule une validation d'après la réouverture     */
/* ------------------------------------------------------------------ */

const ROUVERT_A = MAINTENANT - 2 * HEURE;
const RELANCEE = {
  column: 'planned',
  scheduling: { asap: false, attempts: 1, restarts: 0, departPrevu: MAINTENANT - MINUTE },
  parcours: { plans: [], cadrageRouvertA: ROUVERT_A, comprehensionValidee: { at: ROUVERT_A - HEURE } },
};

test('une relance datée dont la validation DATE D’AVANT la réouverture reste retenue', () => {
  assert.equal(departDeRelanceAccorde(RELANCEE, MAINTENANT), false);
  assert.equal(relanceRetenueAvantLancement(RELANCEE, MAINTENANT), true);
  assert.equal(carteLibreDePartirSeule(RELANCEE, true, MAINTENANT), false);
});

test('validée depuis la réouverture, l’heure venue : la relance part', () => {
  const accordee = {
    ...RELANCEE,
    parcours: { ...RELANCEE.parcours, comprehensionValidee: { at: ROUVERT_A + MINUTE } },
  };
  assert.equal(departDeRelanceAccorde(accordee, MAINTENANT), true);
  assert.equal(relanceRetenueAvantLancement(accordee, MAINTENANT), false);
  assert.equal(carteLibreDePartirSeule(accordee, true, MAINTENANT), true);
  /* …et pas avant son heure. */
  const aVenir = { ...accordee, scheduling: { ...accordee.scheduling, departPrevu: MAINTENANT + HEURE } };
  assert.equal(carteLibreDePartirSeule(aVenir, true, MAINTENANT), false);
});

test('une relance validée SANS date ne part pas sur ses seuls essais passés', () => {
  const sansDate = {
    ...RELANCEE,
    scheduling: { asap: true, attempts: 1, restarts: 0, departPrevu: undefined },
    parcours: { ...RELANCEE.parcours, comprehensionValidee: { at: ROUVERT_A + MINUTE } },
  };
  /* `asap` survit au premier départ : il ne prouve pas un geste d'après la relance. */
  assert.equal(relanceRetenueAvantLancement(sansDate, MAINTENANT), true);
  assert.equal(carteLibreDePartirSeule(sansDate, true, MAINTENANT), false);
});

/* ------------------------------------------------------------------ */
/* Sur une vraie carte, par les portes de l'écran                      */
/* ------------------------------------------------------------------ */

const projet = store.saveProject({
  id: store.newId(),
  name: 'Départ de carte validée',
  path: bacASable,
  createdAt: Date.now(),
} as any);

/** Une carte née du « + », avec son agent de cadrage et sa compréhension rendue. */
function carteCadree(titre: string, comprehensionAt: number) {
  const nee = createCard(projet.id, { title: TITRE_CARTE_DE_CADRAGE, origin: 'user', cadrage: true });
  store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: projet.id,
      cardId: nee.id,
      role: 'cadrage',
      title: titre,
      run: { engine: 'claude', thinking: 'medium' },
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return store.saveCard({
    ...store.getCard(nee.id)!,
    title: titre,
    parcours: { plans: [], comprehension: { texte: 'Ce que j’ai compris.', hypotheses: [], sujets: [], at: comprehensionAt } },
  });
}

/** Le geste du tiroir de programmation : la date, posée par la règle de `card.schedule`. */
function dater(cardId: string, date: number) {
  const carte = store.getCard(cardId)!;
  return store.saveCard({
    ...carte,
    scheduling: programmerLeDepart(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }, date),
  });
}

test('validée puis datée depuis le tiroir : l’ordonnanceur la tient pour libre, sans aucun plan', () => {
  const carte = carteCadree('Vraies images de la page d’accueil', 10);
  assert.ok(agentDeCadrage(carte.id), 'la carte a bien son agent de cadrage');
  assert.equal(validerLaComprehension(carte.id).ok, true);
  const datee = dater(carte.id, Date.now() - MINUTE);

  assert.equal((datee.parcours?.plans ?? []).length, 0, 'aucun plan, et il n’en faut pas');
  assert.equal(carteLibreDePartirSeule(datee, !!agentDeCadrage(datee.id)), true);
});

test('la discussion continue après la validation : la carte part quand même, avec la dernière compréhension', () => {
  const carte = carteCadree('Compréhension affinée après coup', 10);
  assert.equal(validerLaComprehension(carte.id).ok, true);
  dater(carte.id, Date.now() - MINUTE);
  const validee = store.getCard(carte.id)!;
  const affinee = store.saveCard({
    ...validee,
    parcours: { ...validee.parcours!, comprehension: { ...validee.parcours!.comprehension!, texte: 'Affinée.', at: 20 } },
  });

  /* La décision est périmée pour l'ÉCRAN (le bouton redemande un accord)… */
  assert.equal(comprehensionValideePourLaVersionCourante(affinee.parcours), false);
  /* …mais l'heure donnée tient : la carte part, et c'est la compréhension
     courante que le lancement emporte (`card.parcours.comprehension`). */
  assert.equal(carteLibreDePartirSeule(affinee, !!agentDeCadrage(affinee.id)), true);
  assert.equal(store.getCard(affinee.id)!.parcours?.comprehension?.at, 20);
});

test('datée sans jamais avoir été validée : elle reste dans « Demande »', () => {
  const carte = carteCadree('Jamais validée', 10);
  const datee = dater(carte.id, Date.now() - MINUTE);
  assert.equal(carteLibreDePartirSeule(datee, !!agentDeCadrage(datee.id)), false);
});

/* ------------------------------------------------------------------ */
/* Le branchement dans le démon                                        */
/* ------------------------------------------------------------------ */

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lire = (fichier: string) => fs.readFileSync(path.join(RACINE, fichier), 'utf8');

test('la boucle de l’ordonnanceur passe par cette règle, et par elle seule', () => {
  const boucle = lire('server/src/scheduler.ts').split('export async function tick(')[1].split('\nasync function ')[0];
  assert.match(boucle, /if \(!carteLibreDePartirSeule\(card, !!agentDeCadrage\(card\.id\)\)\) continue;/);
  /* Aucun refus de cadrage écrit à côté, qui ne lirait que les plans. */
  assert.doesNotMatch(boucle, /cartePrisonniereDuCadrage\(/);
});

test('le lancement emporte la compréhension COURANTE de la carte, pas celle de la validation', () => {
  const lancer = lire('server/src/scheduler.ts').split('async function lancerLaCarte(')[1];
  assert.match(lancer, /card\.parcours\?\.comprehension\?\.partieTechnique/);
  assert.doesNotMatch(lancer, /comprehensionValideePourLaVersionCourante/);
});

test('« Auto » et l’horloge de programmation ont quitté la rangée de lancement (refonte du 13/11/2026)', () => {
  /* Le départ programmé vit toujours côté serveur (`card.schedule`, créneau conseillé) ; seul le geste à l'écran
     a disparu : aucun bouton ne date plus le départ depuis la rangée de lancement. */
  const ecran = lire('web/src/components/parcours-carte.tsx');
  assert.doesNotMatch(ecran, /SousBoutonProgrammation|TiroirDeProgrammation|InterrupteurLancementAutomatique/);
});
