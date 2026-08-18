/**
 * Le CRÉNEAU CONSEILLÉ d'une carte : quand serait-il opportun de la lancer ?
 *
 * La règle est pure — elle recoupe des heures creuses réglées, un profil de
 * consommation mesuré et l'état des comptes, à un instant donné —, donc elle se
 * rejoue ici sans base, sans démon, sans moteur et sans attendre l'heure.
 *
 * Ce que ces contrôles verrouillent, dans l'ordre :
 *   - le creux MESURÉ l'emporte sur la plage réglée, et une journée plate
 *     retombe sur la plage réglée plutôt que d'inventer un creux ;
 *   - rien de ce qui est GARDÉ sur la carte ne dépend de l'heure du calcul —
 *     c'est le point qui fait vivre une suggestion plusieurs jours ;
 *   - un quota à sec repousse le conseil, et cesse de le faire une fois passé ;
 *   - la mention se tait partout où le conseil n'a plus de sens.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  creneauDeLancement,
  creneauOuvert,
  dansLaPlage,
  mentionCreneauApplique,
  mentionCreneauConseille,
  momentDuCreneau,
  phraseDuCreneau,
  plageLaPlusCalme,
  type CreneauConseille,
} from '@haikodev/shared';

/** Un mardi 11 août 2026, 14 h 30 — heure locale, comme la lit un humain. */
const APRES_MIDI = new Date(2026, 7, 11, 14, 30, 0).getTime();
/** Le même mardi, 2 h 30 du matin : en plein creux. */
const NUIT = new Date(2026, 7, 11, 2, 30, 0).getTime();
const HEURE = 60 * 60 * 1000;

const REGLAGES = { heuresCreuses: { debut: 22, fin: 7 }, seuilLourdSecondes: 900 };

/**
 * Un profil de journée type creusé la nuit : les heures 0 à 4 très calmes, le
 * reste au-dessus. C'est la forme qu'un vrai historique donne à ce serveur.
 */
function profilCreuseLaNuit(): number[] {
  return Array.from({ length: 24 }, (_, h) => (h < 5 ? 0.2 : 1.3));
}

/* ------------------------------------------------------------------ */
/* La plage la plus calme                                              */
/* ------------------------------------------------------------------ */

test('le creux mesuré est reconnu, bornes comprises', () => {
  assert.deepEqual(plageLaPlusCalme(profilCreuseLaNuit()), { debut: 0, fin: 5 });
});

test('une plage calme qui enjambe minuit reste une seule plage', () => {
  const profil = Array.from({ length: 24 }, (_, h) => (h >= 22 || h < 3 ? 0.2 : 1.3));
  assert.deepEqual(plageLaPlusCalme(profil), { debut: 22, fin: 3 });
});

test('une journée plate n’a pas de creux à nommer', () => {
  assert.equal(plageLaPlusCalme(new Array(24).fill(1)), null);
});

test('sans profil, rien du tout — jamais un creux inventé', () => {
  assert.equal(plageLaPlusCalme(null), null);
  assert.equal(plageLaPlusCalme(undefined), null);
  // Un profil de SEMAINE (48 poids) mêlerait deux régimes : il est refusé.
  assert.equal(plageLaPlusCalme(new Array(48).fill(0.2)), null);
});

test('une plage vide n’est jamais une plage pleine', () => {
  assert.equal(dansLaPlage(3, 7, 7), false);
  assert.equal(dansLaPlage(23, 22, 7), true);
  assert.equal(dansLaPlage(12, 22, 7), false);
});

/* ------------------------------------------------------------------ */
/* Le calcul                                                           */
/* ------------------------------------------------------------------ */

test('le creux mesuré l’emporte sur la plage réglée', () => {
  const creneau = creneauDeLancement({
    ...REGLAGES,
    maintenant: APRES_MIDI,
    profil: profilCreuseLaNuit(),
  });
  assert.equal(creneau.source, 'creux-mesure');
  assert.equal(creneau.heureDebut, 0);
  assert.equal(creneau.heureFin, 5);
});

test('sans mesure, la plage réglée prend le relais', () => {
  const creneau = creneauDeLancement({ ...REGLAGES, maintenant: APRES_MIDI, profil: null });
  assert.equal(creneau.source, 'heures-creuses');
  assert.equal(creneau.heureDebut, 22);
  assert.equal(creneau.heureFin, 7);
});

test('une carte lourde est marquée comme telle : l’ordonnanceur la retiendra', () => {
  const lourde = creneauDeLancement({ ...REGLAGES, maintenant: APRES_MIDI, ampleurSecondes: 3600 });
  const legere = creneauDeLancement({ ...REGLAGES, maintenant: APRES_MIDI, ampleurSecondes: 120 });
  assert.equal(lourde.lourde, true);
  assert.equal(legere.lourde, undefined);
});

test('RIEN DE GARDÉ NE DÉPEND DE L’HEURE DU CALCUL', () => {
  const entree = { ...REGLAGES, profil: profilCreuseLaNuit(), ampleurSecondes: 120 };
  assert.deepEqual(
    creneauDeLancement({ ...entree, maintenant: NUIT }),
    creneauDeLancement({ ...entree, maintenant: APRES_MIDI }),
  );
});

test('un moteur à sec repousse le conseil après sa reprise', () => {
  const reprise = APRES_MIDI + 3 * HEURE;
  const creneau = creneauDeLancement({
    ...REGLAGES,
    maintenant: APRES_MIDI,
    quotas: [
      { disponible: false, reprendA: reprise + HEURE },
      { disponible: false, reprendA: reprise },
    ],
  });
  // La plus PROCHE des reprises : c'est elle qui rouvre la porte.
  assert.equal(creneau.pasAvant, reprise);
});

test('un seul compte encore libre suffit : pas de quota à opposer', () => {
  const creneau = creneauDeLancement({
    ...REGLAGES,
    maintenant: APRES_MIDI,
    quotas: [{ disponible: false, reprendA: APRES_MIDI + HEURE }, { disponible: true }],
  });
  assert.equal(creneau.pasAvant, undefined);
});

test('aucun relevé n’est pas un refus : Cursor ne publie pas de quota', () => {
  const creneau = creneauDeLancement({ ...REGLAGES, maintenant: APRES_MIDI, quotas: [] });
  assert.equal(creneau.pasAvant, undefined);
});

/* ------------------------------------------------------------------ */
/* Le moment réel, recalculé à l'affichage                             */
/* ------------------------------------------------------------------ */

const CRENEAU_NUIT: CreneauConseille = { source: 'creux-mesure', heureDebut: 0, heureFin: 5 };

test('le prochain moment tombe à l’heure ronde, aujourd’hui ou demain', () => {
  // Mardi 14 h 30 : le prochain 0 h est celui de mercredi.
  assert.equal(momentDuCreneau(CRENEAU_NUIT, APRES_MIDI), new Date(2026, 7, 12, 0, 0, 0).getTime());
  // Mardi 2 h 30 : le 0 h du jour est passé, on vise mercredi 0 h.
  assert.equal(momentDuCreneau(CRENEAU_NUIT, NUIT), new Date(2026, 7, 12, 0, 0, 0).getTime());
});

test('un quota à sec repousse le moment, et cesse de le faire une fois passé', () => {
  const pasAvant = new Date(2026, 7, 12, 3, 0, 0).getTime();
  const avecQuota: CreneauConseille = { ...CRENEAU_NUIT, pasAvant };
  // Le 0 h de mercredi est AVANT la reprise : on passe au 0 h de jeudi.
  assert.equal(momentDuCreneau(avecQuota, APRES_MIDI), new Date(2026, 7, 13, 0, 0, 0).getTime());
  // Une semaine plus tard, la reprise est passée : elle ne retient plus rien.
  const plusTard = new Date(2026, 7, 18, 14, 30, 0).getTime();
  assert.equal(momentDuCreneau(avecQuota, plusTard), new Date(2026, 7, 19, 0, 0, 0).getTime());
});

test('« on est dedans » se repose à chaque affichage', () => {
  assert.equal(creneauOuvert(CRENEAU_NUIT, NUIT), true);
  assert.equal(creneauOuvert(CRENEAU_NUIT, APRES_MIDI), false);
  // Même en pleine nuit, un quota encore à sec ferme le créneau.
  assert.equal(creneauOuvert({ ...CRENEAU_NUIT, pasAvant: NUIT + HEURE }, NUIT), false);
});

/* ------------------------------------------------------------------ */
/* Les phrases                                                         */
/* ------------------------------------------------------------------ */

test('la phrase dit le moment, la plage et la raison', () => {
  const texte = phraseDuCreneau(CRENEAU_NUIT, APRES_MIDI);
  assert.match(texte, /Lancement conseillé demain à 00:00/);
  assert.match(texte, /entre 0 h et 5 h/);
  assert.match(texte, /mesurée/);
});

test('dans le créneau, la phrase change de bord', () => {
  assert.match(phraseDuCreneau(CRENEAU_NUIT, NUIT), /Bon moment pour la lancer/);
});

test('une carte lourde annonce ce que l’ordonnanceur fera', () => {
  const texte = phraseDuCreneau({ ...CRENEAU_NUIT, lourde: true }, APRES_MIDI);
  assert.match(texte, /tâche lourde/);
});

test('un quota épuisé le dit, avec l’heure de reprise', () => {
  const texte = phraseDuCreneau({ ...CRENEAU_NUIT, pasAvant: APRES_MIDI + HEURE }, APRES_MIDI);
  assert.match(texte, /quota de ce moteur est épuisé/);
  assert.match(texte, /15:30/);
});

/* ------------------------------------------------------------------ */
/* La mention sur la carte                                             */
/* ------------------------------------------------------------------ */

const CARTE = { column: 'planned', scheduling: { creneauConseille: CRENEAU_NUIT } };

test('la mention paraît sur une carte planifiée', () => {
  assert.ok(mentionCreneauConseille(CARTE, APRES_MIDI));
});

test('la mention se tait dès qu’une DATE est posée : le conseil la contredirait', () => {
  const datee = { ...CARTE, scheduling: { ...CARTE.scheduling, departPrevu: APRES_MIDI + HEURE } };
  assert.equal(mentionCreneauConseille(datee, APRES_MIDI), null);
});

test('la mention se tait sur une carte suspendue et hors des colonnes d’avant le travail', () => {
  const suspendue = { ...CARTE, scheduling: { ...CARTE.scheduling, suspendu: true } };
  assert.equal(mentionCreneauConseille(suspendue, APRES_MIDI), null);
  assert.equal(mentionCreneauConseille({ ...CARTE, column: 'running' }, APRES_MIDI), null);
  assert.equal(mentionCreneauConseille({ ...CARTE, column: 'done' }, APRES_MIDI), null);
});

test('sans créneau, rien à dire — le tableau reste celui d’avant', () => {
  assert.equal(mentionCreneauConseille({ column: 'planned', scheduling: {} }, APRES_MIDI), null);
});

/* ------------------------------------------------------------------ */
/* La mention d'une date posée automatiquement                         */
/* ------------------------------------------------------------------ */

test('la mention d’origine paraît quand le créneau a posé la date tout seul', () => {
  const carte = {
    scheduling: { creneauAutomatique: true, creneauConseille: CRENEAU_NUIT, departPrevu: APRES_MIDI + HEURE },
  };
  const texte = mentionCreneauApplique(carte);
  assert.match(texte ?? '', /retenue automatiquement/);
  assert.match(texte ?? '', /entre 0 h et 5 h/);
});

test('la mention d’origine se tait sans le drapeau, sans date ou sans créneau', () => {
  assert.equal(
    mentionCreneauApplique({ scheduling: { creneauConseille: CRENEAU_NUIT, departPrevu: APRES_MIDI } }),
    null,
  );
  assert.equal(
    mentionCreneauApplique({ scheduling: { creneauAutomatique: true, creneauConseille: CRENEAU_NUIT } }),
    null,
  );
  assert.equal(
    mentionCreneauApplique({ scheduling: { creneauAutomatique: true, departPrevu: APRES_MIDI } }),
    null,
  );
});
