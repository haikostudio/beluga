import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chargeRetenue,
  detailDesAgents,
  freinDeCharge,
  pressionMemoire,
  pressionDeProcessus,
  etatDeLEchange,
  phraseDeLEchange,
  SEUIL_ALERTE_MEM_PCT,
  SEUIL_ALERTE_TACHES_PCT,
  SEUIL_ALERTE_FILS_PCT,
  SEUIL_PAUSE_TACHES_PCT,
  SEUIL_PAUSE_FILS_PCT,
  partDesTaches,
  partMemoire,
  phraseCapacite,
  placesSelonLesTaches,
  pressionDesTaches,
  tauxOccupation,
  tonCapacite,
} from '@beluga/shared';

test('le cas vécu : un agent en cours, quatorze places libres', () => {
  const etat = { runningAgents: 1, slotsFree: 14 };
  // La barre montrait cent (charge processeur plafonnée) : elle doit montrer sept.
  assert.equal(tauxOccupation(etat), 7);
  assert.equal(tonCapacite(etat), 'libre');
  assert.equal(phraseCapacite(etat), '14 agents peuvent encore démarrer');
});

test('plus aucune place : la barre est pleine et rouge', () => {
  const etat = { runningAgents: 15, slotsFree: 0 };
  assert.equal(tauxOccupation(etat), 100);
  assert.equal(tonCapacite(etat), 'sature');
  assert.equal(phraseCapacite(etat), 'Plus aucun agent ne peut démarrer');
});

test('départs suspendus : plein, quoi qu’en dise le compte des places', () => {
  const etat = { runningAgents: 0, slotsFree: 5, paused: true };
  assert.equal(tauxOccupation(etat), 100);
  assert.equal(tonCapacite(etat), 'sature');
  assert.equal(phraseCapacite(etat), 'Départs suspendus');
});

test('presque plus de place : le ton se tend avant la saturation', () => {
  assert.equal(tonCapacite({ runningAgents: 13, slotsFree: 2 }), 'tendu');
  assert.equal(tonCapacite({ runningAgents: 12, slotsFree: 3 }), 'libre');
});

test('une seule place restante s’écrit en toutes lettres', () => {
  assert.equal(phraseCapacite({ runningAgents: 14, slotsFree: 1 }), 'Un agent peut encore démarrer');
});

test('machine au repos : rien d’occupé', () => {
  assert.equal(tauxOccupation({ runningAgents: 0, slotsFree: 15 }), 0);
});

test('la part de mémoire ne divise jamais par zéro', () => {
  assert.equal(partMemoire(4000, 16000), 25);
  assert.equal(partMemoire(4000, 0), 0);
});

/* ------------------------------------------------------------------ */
/* Le cas de la capture : « saturé » avec 3 en cours sur 15            */
/* ------------------------------------------------------------------ */

test('une pointe de charge d’une minute ne freine rien', () => {
  // Le cas vécu : 216 % sur la minute, mais la machine tourne à 105 % de fond.
  assert.equal(freinDeCharge({ instantPct: 216, soutenuePct: 105 }).placesMax, null);
  assert.equal(chargeRetenue({ instantPct: 216, soutenuePct: 105 }), 105);
});

test('une charge qui DURE freine, sans jamais tout bloquer', () => {
  const frein = freinDeCharge({ instantPct: 250, soutenuePct: 180 });
  assert.equal(frein.placesMax, 3);
  assert.match(frein.raison ?? '', /chargée/);

  assert.equal(freinDeCharge({ instantPct: 260, soutenuePct: 250 }).placesMax, 1);
});

test('seule une surcharge réelle et durable arrête les départs', () => {
  const frein = freinDeCharge({ instantPct: 400, soutenuePct: 340 });
  assert.equal(frein.placesMax, 0);
  assert.match(frein.raison ?? '', /surchargée/);
});

test('un frein de charge ne se déguise jamais en manque de place', () => {
  const etat = { runningAgents: 3, slotsFree: 12, freinCharge: 'Machine chargée (180 %).' };
  assert.equal(phraseCapacite(etat), 'Départs ralentis : la machine est chargée');
  assert.equal(tonCapacite(etat), 'tendu');
  // La barre continue de dire la place occupée, pas cent.
  assert.equal(tauxOccupation(etat), 20);
});

test('le compte sépare les tâches du tableau des agents de service', () => {
  // La capture disait « 3 en cours » quand l'utilisateur ne voyait que 2 tâches.
  assert.equal(detailDesAgents({ runningAgents: 3, runningTasks: 2 }), '2 tâches en cours · 1 agent de service');
  assert.equal(detailDesAgents({ runningAgents: 1, runningTasks: 1 }), '1 tâche en cours');
  assert.equal(detailDesAgents({ runningAgents: 5, runningTasks: 2 }), '2 tâches en cours · 3 agents de service');
  // Un serveur d'avant, qui n'envoie pas le détail : on ne raconte rien de plus.
  assert.equal(detailDesAgents({ runningAgents: 3 }), '3 en cours');
});

test('la mémoire vive presque pleine suspend les départs', () => {
  const p = pressionMemoire(96, 10);
  assert.equal(p.suspendre, true);
  assert.match(String(p.raison), /Mémoire presque pleine/);
});

test('un fichier d’échange saturé AVEC la mémoire vive tendue suspend', () => {
  const p = pressionMemoire(90, 100);
  assert.equal(p.suspendre, true);
  assert.match(String(p.raison), /échange presque plein/);
});

test('un fichier d’échange plein ne suspend RIEN si la mémoire vive va bien', () => {
  // Le swap est un réservoir de pages froides : plein tout seul, il ne dit rien.
  assert.equal(pressionMemoire(66, 100).suspendre, false);
  assert.equal(pressionMemoire(76, 100).suspendre, false);
});

test('sans fichier d’échange, la mémoire vive décide seule', () => {
  assert.equal(pressionMemoire(80).suspendre, false);
  assert.equal(pressionMemoire(96).suspendre, true);
});

test('une machine au calme ne suspend rien', () => {
  assert.equal(pressionMemoire(60, 20).suspendre, false);
});

test('l’état du fichier d’échange se lit au DÉBIT, pas au remplissage', () => {
  // Plein mais silencieux : des pages froides rangées, rien de plus.
  assert.equal(etatDeLEchange(100, 0), 'range');
  assert.equal(etatDeLEchange(100, 200), 'range');
  // Le va-et-vient, lui, dit une machine qui rame — même à moitié rempli.
  assert.equal(etatDeLEchange(50, 4000), 'actif');
  assert.equal(etatDeLEchange(5, 0), 'repos');
  assert.equal(etatDeLEchange(undefined), 'absent');
});

test('chaque état du fichier d’échange se dit en clair', () => {
  assert.match(phraseDeLEchange('actif'), /rame/);
  assert.match(phraseDeLEchange('range'), /froides/);
  assert.equal(phraseDeLEchange('absent'), 'aucun fichier d’échange');
});

test('on prévient sur la mémoire vive AVANT de suspendre', () => {
  // Le seuil d'alerte est bien en dessous de celui qui suspend.
  assert.ok(SEUIL_ALERTE_MEM_PCT < 94);
  assert.equal(pressionMemoire(SEUIL_ALERTE_MEM_PCT + 1, 10).suspendre, false);
});

/* ------------------------------------------------------------------ */
/* Le plafond de TÂCHES : le verrou qui ne se comptait pas en octets   */
/* ------------------------------------------------------------------ */

test('un plafond de tâches presque atteint suspend les départs, même avec de la mémoire à revendre', () => {
  /* LE CAS DU 08.09.2026 : la jauge annonçait de la place — la mémoire vive en
     avait — pendant que le service, à 286 tâches sur 512, refusait déjà tout
     `fork`. Ce verrou-là n'était lu nulle part. */
  const pression = pressionDesTaches(490, 512);
  assert.equal(pression.suspendre, true);
  assert.match(pression.raison ?? '', /plafond de tâches/, 'la cause est écrite en clair');
  assert.match(pression.raison ?? '', /490 sur 512/, 'les chiffres réels sont dits');
  assert.doesNotMatch(pression.raison ?? '', /fork|cgroup|pids/i, 'aucun jargon dans une phrase lue par l’utilisateur');
});

test('un plafond de tâches confortable ne suspend rien', () => {
  assert.equal(pressionDesTaches(300, 4096).suspendre, false);
  assert.equal(pressionDesTaches(0, 512).suspendre, false);
});

test('une machine sans cgroup lisible ne se voit imposer aucun verrou deviné', () => {
  assert.equal(pressionDesTaches(undefined, undefined).suspendre, false);
  assert.equal(pressionDesTaches(300, undefined).suspendre, false);
  // « max » (aucun plafond) arrive ici en `undefined` : rien ne se déduit.
  assert.equal(partDesTaches(300, undefined), undefined);
  assert.equal(placesSelonLesTaches(300, undefined), null);
});

test('la part occupée du plafond se compte comme un pourcentage ordinaire', () => {
  assert.equal(partDesTaches(256, 512), 50);
  assert.equal(partDesTaches(286, 512), 56);
  assert.equal(partDesTaches(10, 0), undefined, 'un plafond nul ne se divise pas');
});

test('les places restantes gardent la réserve du seuil devant elles', () => {
  /* On ne remplit JAMAIS le cgroup jusqu'à sa dernière tâche : au-delà du seuil
     de suspension, plus rien ne part. */
  const places = placesSelonLesTaches(100, 4096, 40);
  const utilisable = Math.floor((4096 * SEUIL_PAUSE_TACHES_PCT) / 100) - 100;
  assert.equal(places, Math.floor(utilisable / 40));
  assert.equal(placesSelonLesTaches(500, 512, 40), 0, 'plus une seule place sous un plafond au ras');
});

/*
 * Vécu le 08.09.2026 : la machine avait de la mémoire libre et refusait quand
 * même de lancer le moindre programme. Le pont d'outils mourait avant d'avoir
 * dit un mot, et le tour partait sans mémoire du projet — sans que rien ne dise
 * pourquoi.
 */

test('une table des processus presque pleine suspend les départs, avec sa cause', () => {
  const pression = pressionDeProcessus(29_000, 30_666);
  assert.equal(pression.suspendre, true);
  assert.match(pression.raison ?? '', /Table des processus/);
  // La phrase donne les nombres : sans eux, on ne sait pas quoi regarder.
  assert.match(pression.raison ?? '', /29000 fils/);
  assert.match(pression.raison ?? '', /30666/);
});

test('une machine au large ne suspend rien, et dit quand même sa part', () => {
  const pression = pressionDeProcessus(1_642, 30_666);
  assert.equal(pression.suspendre, false);
  assert.equal(pression.partPct, 5);
});

test('le seuil suspend juste au-dessus, jamais juste en dessous', () => {
  const max = 1_000;
  assert.equal(pressionDeProcessus(SEUIL_PAUSE_FILS_PCT * 10 - 10, max).suspendre, false);
  assert.equal(pressionDeProcessus(SEUIL_PAUSE_FILS_PCT * 10, max).suspendre, true);
});

test('une machine qui ne dit pas ses limites ne fait suspendre personne', () => {
  // Inventer un mur qu'on n'a pas mesuré serait pire que de ne pas en voir.
  assert.equal(pressionDeProcessus(5_000, 0).suspendre, false);
  assert.equal(pressionDeProcessus(5_000, Number.NaN).suspendre, false);
});

test("l'alerte de surcharge suit des seuils fixés par le système, plus un réglage", async () => {
  const shared = await import('@beluga/shared');
  assert.equal(shared.SEUIL_ALERTE_CHARGE_PCT, 90);
  assert.equal(shared.DUREE_ALERTE_MINUTES, 10);
  // Une vieille valeur restée en base ne casse pas la lecture des réglages :
  // le schéma l'ignore, et ne la rend plus.
  const lus = shared.Settings.parse({ alertThresholdPct: 50, alertMinutes: 2 }) as Record<string, unknown>;
  assert.equal('alertThresholdPct' in lus, false);
  assert.equal('alertMinutes' in lus, false);
});
