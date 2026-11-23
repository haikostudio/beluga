import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSIGNE_CADRAGE,
  REFUS_AVANT_LE_TITRE,
  ecritureDeCarteAutoriseeAuCadrage,
  gesteAutoriseAvantLeTitreDeCadrage,
} from '@beluga/shared';

/**
 * LE DÉROULÉ DU CADRAGE EST SYNCHRONE : LE TEMPS 2 FERME LA PORTE DU TEMPS 3.
 *
 * L'écran montrait « Définition du titre » encore ouverte pendant que
 * « Lecture des pièces jointes » travaillait déjà : le déroulé n'était demandé
 * qu'au modèle, jamais tenu par le démon.
 */

test('avant le titre, seul « board_update_card » avec « title » (et la synthèse) passe', () => {
  const avant = { titreDonne: false };
  assert.ok(
    gesteAutoriseAvantLeTitreDeCadrage({ ...avant, outil: 'board_update_card', champs: ['cardId', 'title'] }),
  );
  /* LA SYNTHÈSE DE LA DEMANDE VOYAGE AVEC LE TITRE : elle se tire de la même
     phrase, et le fil doit l'afficher dès les premières secondes du tour. */
  assert.ok(
    gesteAutoriseAvantLeTitreDeCadrage({
      ...avant,
      outil: 'board_update_card',
      champs: ['cardId', 'title', 'resumeDemande'],
    }),
  );
  /* MAIS LE TITRE RESTE DÛ : la synthèse seule ne lève pas le verrou. */
  assert.ok(
    !gesteAutoriseAvantLeTitreDeCadrage({
      ...avant,
      outil: 'board_update_card',
      champs: ['cardId', 'resumeDemande'],
    }),
  );
  assert.ok(
    !gesteAutoriseAvantLeTitreDeCadrage({
      ...avant,
      outil: 'board_update_card',
      champs: ['cardId', 'title', 'description'],
    }),
  );
  for (const outil of ['project_memory', 'competences', 'ask_user', 'board_create_card', 'board_move_card']) {
    assert.ok(!gesteAutoriseAvantLeTitreDeCadrage({ ...avant, outil, champs: [] }), outil);
  }
});

test('le titre posé rouvre tous les gestes, et pour toujours', () => {
  for (const outil of ['project_memory', 'competences', 'ask_user', 'board_update_card']) {
    assert.ok(gesteAutoriseAvantLeTitreDeCadrage({ outil, champs: ['cardId', 'niveau'], titreDonne: true }), outil);
  }
});

test('le refus dit quel appel rouvre la suite', () => {
  assert.ok(REFUS_AVANT_LE_TITRE.includes('board_update_card'));
  assert.ok(REFUS_AVANT_LE_TITRE.includes('title'));
  assert.ok(REFUS_AVANT_LE_TITRE.includes('resumeDemande'));
});

test('la consigne titre au geste 1, avant la mémoire et les questions', () => {
  const titre = CONSIGNE_CADRAGE.indexOf('TITRER LA CARTE');
  const memoire = CONSIGNE_CADRAGE.indexOf('OUVRIR LA MÉMOIRE');
  const question = CONSIGNE_CADRAGE.indexOf('POSER CE QUI CHANGE');
  const comprehension = CONSIGNE_CADRAGE.indexOf('RENDRE CE QUE TU AS COMPRIS');
  assert.ok(titre > 0 && titre < memoire && memoire < question && question < comprehension);
});

/* ------------------------------------------------------------------ */
/* LA PORTE D'AVANT-MÉMOIRE : LE TITRE ET LA SYNTHÈSE, ET RIEN D'AUTRE  */
/* ------------------------------------------------------------------ */

test('avant la mémoire, le titre et la synthèse passent — seuls, ou ensemble', () => {
  const avant = { analyseFaite: false };
  assert.ok(ecritureDeCarteAutoriseeAuCadrage({ ...avant, champs: ['cardId', 'title'] }));
  assert.ok(ecritureDeCarteAutoriseeAuCadrage({ ...avant, champs: ['cardId', 'resumeDemande'] }));
  assert.ok(ecritureDeCarteAutoriseeAuCadrage({ ...avant, champs: ['cardId', 'title', 'resumeDemande'] }));
});

test('avant la mémoire, tout le reste reste refusé', () => {
  const avant = { analyseFaite: false };
  for (const champ of ['description', 'niveau', 'labels', 'depart']) {
    assert.ok(!ecritureDeCarteAutoriseeAuCadrage({ ...avant, champs: ['cardId', champ] }), champ);
    assert.ok(
      !ecritureDeCarteAutoriseeAuCadrage({ ...avant, champs: ['cardId', 'title', 'resumeDemande', champ] }),
      `${champ} glissé avec le titre`,
    );
  }
  /* Un appel qui ne porte QUE la carte n'écrit rien : il ne passe pas non plus. */
  assert.ok(!ecritureDeCarteAutoriseeAuCadrage({ ...avant, champs: ['cardId'] }));
  /* La mémoire ouverte rouvre tout, comme avant. */
  assert.ok(ecritureDeCarteAutoriseeAuCadrage({ analyseFaite: true, champs: ['cardId', 'description'] }));
});

test('la consigne demande la synthèse au geste 1, et la redemande à chaque nouveau message', () => {
  assert.ok(CONSIGNE_CADRAGE.includes('resumeDemande'));
  const geste1 = CONSIGNE_CADRAGE.indexOf('TITRER LA CARTE');
  const memoire = CONSIGNE_CADRAGE.indexOf('OUVRIR LA MÉMOIRE');
  assert.ok(CONSIGNE_CADRAGE.slice(geste1, memoire).includes('resumeDemande'), 'la synthèse est dans le geste 1');
  assert.ok(CONSIGNE_CADRAGE.includes('UN NOUVEAU MESSAGE NE REFAIT PAS LE TITRE, mais il refait la synthèse'), 'chaque message refait la synthèse');
});
