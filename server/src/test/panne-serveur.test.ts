import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alerteServeurInjoignable,
  DELAI_CANAL_COUPE,
  RAISON_SANS_REPONSE,
  messageDuCanal,
  etatDuCanal,
  gestesGeles,
  DELAI_CANAL_MUET,
  DELAI_AVANT_MESSAGE_DU_CANAL,
  RAISON_CANAL_COUPE,
  MOT_GESTE_NON_PARTI,
  MOT_GESTE_NOMME_NON_PARTI,
  type EtatDuLien,
  type LectureDuCanal,
} from '@beluga/shared';

const MAINTENANT = 1_700_000_000_000;

/** Le cas du symptôme : un lancement qui répond après le délai, canal ouvert. */
const REQUETE_LENTE: EtatDuLien = { connecte: true, echecsConsecutifs: 1 };

test('une requête isolée sans réponse n’allume aucune alerte', () => {
  assert.equal(alerteServeurInjoignable(REQUETE_LENTE, MAINTENANT), false);
});

test('deux requêtes de suite sans réponse : là, on le dit', () => {
  assert.equal(alerteServeurInjoignable({ ...REQUETE_LENTE, echecsConsecutifs: 2 }, MAINTENANT), true);
});

test('un canal coupé depuis moins de quinze secondes est une reconnexion, pas une panne', () => {
  const lien: EtatDuLien = {
    connecte: false,
    coupeDepuis: MAINTENANT - (DELAI_CANAL_COUPE - 1),
    echecsConsecutifs: 0,
  };
  assert.equal(alerteServeurInjoignable(lien, MAINTENANT), false);
});

test('un canal coupé qui dure est une vraie panne : on ne la masque pas', () => {
  const lien: EtatDuLien = {
    connecte: false,
    coupeDepuis: MAINTENANT - DELAI_CANAL_COUPE,
    echecsConsecutifs: 0,
  };
  assert.equal(alerteServeurInjoignable(lien, MAINTENANT), true);
});

test('canal coupé sans date connue : on se tait plutôt que d’inventer', () => {
  assert.equal(alerteServeurInjoignable({ connecte: false, echecsConsecutifs: 0 }, MAINTENANT), false);
});

test('le texte rendu à l’appelant reste celui que le bilan d’un lot sait traduire', () => {
  assert.match(RAISON_SANS_REPONSE, /le serveur ne répond pas/i);
});

/* ------------------------------------------------------------------ */
/* L'ÉTAT DU CANAL — un seul état, lu partout                          */
/* ------------------------------------------------------------------ */

const EN_LIGNE: LectureDuCanal = {
  connecte: true,
  resynchronise: true,
  dernierEvenementA: MAINTENANT - 1_000,
};

test('canal ouvert, état frais : tout est permis', () => {
  assert.equal(etatDuCanal(EN_LIGNE, MAINTENANT), 'en-ligne');
  assert.equal(gestesGeles('en-ligne'), false);
  assert.equal(messageDuCanal('en-ligne', undefined, MAINTENANT), null);
});

test('canal coupé : reconnexion, gestes gelés', () => {
  const coupe: LectureDuCanal = { connecte: false, resynchronise: false, coupeDepuis: MAINTENANT - 5_000 };
  assert.equal(etatDuCanal(coupe, MAINTENANT), 'reconnexion');
  assert.equal(gestesGeles('reconnexion'), true);
});

test('un redémarrage annoncé se dit autrement qu’une perte de lien', () => {
  const redemarre: LectureDuCanal = {
    connecte: false,
    resynchronise: false,
    coupeDepuis: MAINTENANT - 5_000,
    redemarrageEnCours: true,
  };
  assert.equal(etatDuCanal(redemarre, MAINTENANT), 'redemarrage');
  assert.match(messageDuCanal('redemarrage', MAINTENANT - 5_000, MAINTENANT)!.texte, /redémarre/i);
});

test('le canal revient, mais l’état n’est pas encore là : rien ne se rallume', () => {
  const revenu: LectureDuCanal = { connecte: true, resynchronise: false };
  assert.equal(etatDuCanal(revenu, MAINTENANT), 'resynchronisation');
  assert.equal(gestesGeles('resynchronisation'), true);
});

test('canal ouvert mais muet depuis une demi-minute : on ne décide plus dessus', () => {
  const muet: LectureDuCanal = {
    connecte: true,
    resynchronise: true,
    dernierEvenementA: MAINTENANT - DELAI_CANAL_MUET - 1,
  };
  assert.equal(etatDuCanal(muet, MAINTENANT), 'muet');
  assert.equal(gestesGeles('muet'), true);
});

test('une coupure d’une demi-seconde ne fait pas clignoter le message du lien', () => {
  assert.equal(messageDuCanal('reconnexion', MAINTENANT - 500, MAINTENANT), null);
  assert.ok(messageDuCanal('reconnexion', MAINTENANT - DELAI_AVANT_MESSAGE_DU_CANAL, MAINTENANT));
});

test('un bouton éteint par la coupure dit toujours pourquoi', () => {
  assert.match(RAISON_CANAL_COUPE, /ne répond pas/i);
});

/* ------------------------------------------------------------------ */
/* UN GESTE QUI N'A PAS PU PARTIR                                      */
/* ------------------------------------------------------------------ */

test('une coupure trop brève pour un message reste trop longue pour avaler un clic', () => {
  /* Le même instant, la même coupure d’une demi-seconde : muette tant que
     personne n’a cliqué, parlante dès qu’un geste a été refusé. */
  assert.equal(messageDuCanal('reconnexion', MAINTENANT - 500, MAINTENANT), null);
  const dit = messageDuCanal('reconnexion', MAINTENANT - 500, MAINTENANT, true);
  assert.ok(dit);
  assert.match(dit!.texte, /ne répond pas/i);
});

test('un geste refusé ne fait rien dire d’un canal en ligne', () => {
  assert.equal(messageDuCanal('en-ligne', undefined, MAINTENANT, true), null);
});

test('la plainte d’un geste perdu nomme le geste, ou reste générale', () => {
  assert.match(MOT_GESTE_NON_PARTI, /n’a pas pu partir/);
  assert.match(MOT_GESTE_NOMME_NON_PARTI, /\{geste\}/);
});

/*
 * LE BATTEMENT NE COUPE PLUS LE LIEN SUR UN SEUL SILENCE (12/10/2026) : le
 * serveur se fige réellement par moments (17 s mesurées), l'écran concluait à
 * un canal mort après 8 s et se reconnectait en redemandant tout.
 */
test('un battement manqué ne coupe pas le lien : il en faut deux, ou un long silence complet', async () => {
  const { canalAAbandonner, DELAI_PING_SANS_REPONSE, SILENCE_AVANT_ABANDON } = await import('@beluga/shared');
  assert.equal(canalAAbandonner({ battementsManques: 1, silence: 20_000 }), false);
  assert.equal(canalAAbandonner({ battementsManques: 1, silence: 30_000 }), false);
  assert.equal(canalAAbandonner({ battementsManques: 2, silence: 40_000 }), true);
  assert.equal(canalAAbandonner({ battementsManques: 1, silence: SILENCE_AVANT_ABANDON }), true);
  /* Un gel de 17 s (le pire mesuré) tient largement dans un seul battement. */
  assert.ok(DELAI_PING_SANS_REPONSE > 17_000);
});

/*
 * LE LIEN MOBILE : une ouverture qui traîne est abandonnée, un canal muet est
 * mis à l'épreuve au retour à l'écran — sans jamais conclure plus vite que le
 * battement ne le permet sur un simple silence court.
 */
test('une ouverture qui traîne est abandonnée après son délai, pas avant', async () => {
  const { DELAI_OUVERTURE_DU_CANAL, delaiRestantAvantAbandonDeLOuverture } = await import('@beluga/shared');
  assert.equal(delaiRestantAvantAbandonDeLOuverture(MAINTENANT - (DELAI_OUVERTURE_DU_CANAL - 1), MAINTENANT), 1);
  assert.equal(delaiRestantAvantAbandonDeLOuverture(MAINTENANT - DELAI_OUVERTURE_DU_CANAL, MAINTENANT), 0);
  assert.equal(delaiRestantAvantAbandonDeLOuverture(MAINTENANT - 3 * DELAI_OUVERTURE_DU_CANAL, MAINTENANT), 0);
  assert.equal(delaiRestantAvantAbandonDeLOuverture(MAINTENANT, MAINTENANT), DELAI_OUVERTURE_DU_CANAL);
  /* Plus large qu'un gel du démon d'environ deux secondes : jamais abandonnée pour une pause ordinaire. */
  assert.ok(DELAI_OUVERTURE_DU_CANAL >= 10_000);
});

test('au retour à l’écran, seul un canal resté muet est mis à l’épreuve', async () => {
  const { SILENCE_AVANT_SONDE_AU_RETOUR, DELAI_SONDE_DE_RESEAU, sondeAuRetourNecessaire } = await import('@beluga/shared');
  assert.equal(sondeAuRetourNecessaire(MAINTENANT - 1_000, MAINTENANT), false);
  assert.equal(sondeAuRetourNecessaire(MAINTENANT - SILENCE_AVANT_SONDE_AU_RETOUR, MAINTENANT), true);
  assert.equal(sondeAuRetourNecessaire(null, MAINTENANT), false);
  assert.equal(sondeAuRetourNecessaire(undefined, MAINTENANT), false);
  /* La preuve exigée reste plus courte que le battement : elle ne fait pas attendre davantage. */
  assert.ok(DELAI_SONDE_DE_RESEAU < 20_000);
});

test('le témoin du serveur : gris-vert en ligne, orange au redémarrage ou sur une coupure courte, rouge sur une coupure durable', async () => {
  const { teinteDuTemoinServeur, DELAI_REDEMARRAGE_TROP_LONG } = await import('@beluga/shared');
  assert.equal(teinteDuTemoinServeur('en-ligne', undefined, MAINTENANT), 'stable');
  /* Un rechargement, un changement de réseau : jamais rouge. */
  assert.equal(teinteDuTemoinServeur('reconnexion', MAINTENANT - 1_000, MAINTENANT), 'redemarrage');
  assert.equal(teinteDuTemoinServeur('reconnexion', MAINTENANT - (DELAI_CANAL_COUPE - 1), MAINTENANT), 'redemarrage');
  /* Le même seuil que l'alerte « le serveur ne répond pas ». */
  assert.equal(teinteDuTemoinServeur('reconnexion', MAINTENANT - DELAI_CANAL_COUPE, MAINTENANT), 'eteint');
  assert.equal(
    teinteDuTemoinServeur('reconnexion', MAINTENANT - DELAI_CANAL_COUPE, MAINTENANT),
    alerteServeurInjoignable({ connecte: false, coupeDepuis: MAINTENANT - DELAI_CANAL_COUPE, echecsConsecutifs: 0 }, MAINTENANT) ? 'eteint' : 'redemarrage',
  );
  /* Un redémarrage annoncé reste orange… tant qu'il ne s'éternise pas. */
  assert.equal(teinteDuTemoinServeur('redemarrage', MAINTENANT - 60_000, MAINTENANT), 'redemarrage');
  assert.equal(teinteDuTemoinServeur('redemarrage', MAINTENANT - DELAI_REDEMARRAGE_TROP_LONG, MAINTENANT), 'eteint');
  /* Lien retrouvé qui récupère son état, canal muet qu'on vérifie : passager, orange. */
  assert.equal(teinteDuTemoinServeur('resynchronisation', undefined, MAINTENANT), 'redemarrage');
  assert.equal(teinteDuTemoinServeur('muet', undefined, MAINTENANT), 'redemarrage');
});
