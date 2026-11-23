import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUREE_RESULTAT_CONNEXION_MS,
  decisionDeRenouvellement,
  enUnSeulVol,
  etatDeConnexion,
  instantDuRenouvellementPreventif,
  renouvellementPreventif,
  texteDeConnexionEnAttente,
  ligneDeRenouvellement,
  phaseDeLigneCompte,
  raisonDeSortie,
} from '@beluga/shared';

test('la raison d’un code refusé ne reprend pas l’invite du moteur', () => {
  const fin = raisonDeSortie({ code: 1, texte: 'Opening browser…\nPaste code here if prompted > OAuth error: Invalid code\n' });
  assert.equal(fin.ok, false);
  assert.match(fin.message, /: OAuth error: Invalid code$/);
  assert.doesNotMatch(fin.message, /Paste code/);
});

/* ------------------------------------------------------------------ */
/* Un seul renouvellement à la fois par compte                         */
/* ------------------------------------------------------------------ */

test('deux renouvellements lancés au même instant sur un compte : un seul part', async () => {
  const vols = new Map<string, Promise<boolean>>();
  let lancements = 0;
  let poser!: (ok: boolean) => void;
  const lancer = () => {
    lancements += 1;
    return new Promise<boolean>((resolve) => {
      poser = resolve;
    });
  };
  const premier = enUnSeulVol(vols, 'claude-secondary', lancer);
  const second = enUnSeulVol(vols, 'claude-secondary', lancer);
  assert.equal(lancements, 1, 'le second attend le premier au lieu de relancer le moteur');
  poser(true);
  assert.deepEqual(await Promise.all([premier, second]), [true, true]);
  assert.equal(vols.size, 0, 'la place se libère une fois le vol posé');
});

test('deux comptes différents se renouvellent chacun de leur côté', async () => {
  const vols = new Map<string, Promise<string>>();
  let lancements = 0;
  const lancer = async () => {
    lancements += 1;
    return 'ok';
  };
  await Promise.all([enUnSeulVol(vols, 'a', lancer), enUnSeulVol(vols, 'b', lancer)]);
  assert.equal(lancements, 2);
});

test('un renouvellement qui échoue libère sa place : le suivant repart', async () => {
  const vols = new Map<string, Promise<boolean>>();
  await assert.rejects(enUnSeulVol(vols, 'a', async () => Promise.reject(new Error('moteur absent'))));
  assert.equal(vols.size, 0);
  assert.equal(await enUnSeulVol(vols, 'a', async () => true), true);
});

/* ------------------------------------------------------------------ */
/* Le relevé de quota laisse un compte au travail se renouveler seul   */
/* ------------------------------------------------------------------ */

test('le relevé de quota ne force aucun renouvellement quand un agent tourne sur le compte', () => {
  assert.equal(decisionDeRenouvellement({ peutRenouveler: true, agentsAuTravail: 2 }), 'laisser-aux-agents');
});

test('un compte au repos est renouvelé par le relevé, un coffre sans jeton ne l’est jamais', () => {
  assert.equal(decisionDeRenouvellement({ peutRenouveler: true, agentsAuTravail: 0 }), 'forcer');
  assert.equal(decisionDeRenouvellement({ peutRenouveler: false, agentsAuTravail: 0 }), 'impossible');
  assert.equal(decisionDeRenouvellement({ peutRenouveler: false, agentsAuTravail: 3 }), 'impossible');
});

/* ------------------------------------------------------------------ */
/* Le renouvellement n'ouvre jamais une fenêtre hors de son créneau    */
/* ------------------------------------------------------------------ */

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 25, 4, 25);

test('fenêtre fermée et créneau à venir : le relevé attend le créneau (cas du 25/10, Claude Pro)', () => {
  assert.equal(
    decisionDeRenouvellement({
      peutRenouveler: true,
      agentsAuTravail: 0,
      fenetreOuverte: false,
      prochainCreneau: T0 + 2.5 * H,
      renouvellementExpireA: T0 + 20 * 24 * H,
      maintenant: T0,
    }),
    'attendre-le-creneau',
  );
});

test('fenêtre ouverte, compte repère ou créneau arrivé : on renouvelle tout de suite', () => {
  const commun = { peutRenouveler: true, agentsAuTravail: 0, maintenant: T0 };
  assert.equal(decisionDeRenouvellement({ ...commun, fenetreOuverte: true, prochainCreneau: T0 + H }), 'forcer');
  assert.equal(decisionDeRenouvellement({ ...commun, fenetreOuverte: false }), 'forcer');
  assert.equal(decisionDeRenouvellement({ ...commun, fenetreOuverte: false, prochainCreneau: T0 + 30_000 }), 'forcer');
});

test('une session qui expirerait avant le créneau se renouvelle tout de suite', () => {
  assert.equal(
    decisionDeRenouvellement({
      peutRenouveler: true,
      agentsAuTravail: 0,
      fenetreOuverte: false,
      prochainCreneau: T0 + 3 * H,
      renouvellementExpireA: T0 + 3.5 * H,
      maintenant: T0,
    }),
    'forcer',
  );
});

test('les agents et l’absence de jeton gardent la priorité sur le créneau', () => {
  const attente = { fenetreOuverte: false, prochainCreneau: T0 + 2 * H, maintenant: T0 };
  assert.equal(decisionDeRenouvellement({ peutRenouveler: true, agentsAuTravail: 1, ...attente }), 'laisser-aux-agents');
  assert.equal(decisionDeRenouvellement({ peutRenouveler: false, agentsAuTravail: 0, ...attente }), 'impossible');
});

test('le renouvellement préventif ne part que fenêtre ouverte, dans les cinq dernières minutes du jeton', () => {
  const base = { peutRenouveler: true, agentsAuTravail: 0, maintenant: T0 };
  assert.equal(renouvellementPreventif({ ...base, fenetreOuverte: true, expireA: T0 + 4 * 60_000 }), true);
  assert.equal(renouvellementPreventif({ ...base, fenetreOuverte: false, expireA: T0 + 4 * 60_000 }), false);
  assert.equal(renouvellementPreventif({ ...base, fenetreOuverte: true, expireA: T0 + 30 * 60_000 }), false);
  assert.equal(renouvellementPreventif({ ...base, agentsAuTravail: 1, fenetreOuverte: true, expireA: T0 + 60_000 }), false);
  assert.equal(instantDuRenouvellementPreventif(T0 + H, T0), T0 + H - 4 * 60_000);
  assert.equal(instantDuRenouvellementPreventif(T0 + 60_000, T0), T0);
  assert.equal(instantDuRenouvellementPreventif(T0 - 1, T0), undefined);
});

test('un jeton en attente de son créneau ne se dit ni expiré ni à reconnecter', () => {
  const texte = texteDeConnexionEnAttente(T0 + 2 * H);
  assert.match(texte, /^connexion rafraîchie à son créneau de \d\d:\d\d$/);
  const etat = etatDeConnexion({ erreur: texte, expireA: T0 - 60_000, maintenant: T0 });
  assert.equal(etat.doitReconnecter, false);
  assert.equal(etat.libelle, texte);
});

/* ------------------------------------------------------------------ */
/* La trace de chaque renouvellement                                   */
/* ------------------------------------------------------------------ */

test('la ligne de journal dit le compte, le demandeur, l’issue et les deux échéances', () => {
  const ligne = ligneDeRenouvellement({
    compte: 'Claude Max x20',
    demandeur: 'le relevé de quota',
    ok: true,
    expireA: Date.UTC(2026, 8, 16, 0, 50),
    renouvellementExpireA: Date.UTC(2026, 9, 15, 11, 15),
  });
  assert.match(ligne, /Claude Max x20/);
  assert.match(ligne, /le relevé de quota/);
  assert.match(ligne, /réussi/);
  assert.match(ligne, /16\/09 00:50 UTC/);
  assert.match(ligne, /15\/10 11:15 UTC/);
});

test('un échec qui vide le coffre le dit en toutes lettres', () => {
  const ligne = ligneDeRenouvellement({
    compte: 'Claude Max x20',
    demandeur: 'le relevé de quota',
    ok: false,
    raison: 'code 1',
    coffreVide: true,
  });
  assert.match(ligne, /échoué \(code 1\)/);
  assert.match(ligne, /VIDÉ le coffre/);
});

/* ------------------------------------------------------------------ */
/* La ligne du compte pendant une reconnexion                          */
/* ------------------------------------------------------------------ */

test('la ligne du compte suit saisie, chargement, résultat, puis revient à la normale', () => {
  const t0 = 1_000_000;
  assert.equal(phaseDeLigneCompte(undefined, t0), 'aucune');
  assert.equal(phaseDeLigneCompte({ etape: 'attente' }, t0), 'saisie');
  assert.equal(phaseDeLigneCompte({ etape: 'attente', codeEnvoyeA: t0 }, t0), 'validation');
  assert.equal(phaseDeLigneCompte({ etape: 'reussie', codeEnvoyeA: t0, finieA: t0 }, t0 + 1000), 'resultat');
  assert.equal(phaseDeLigneCompte({ etape: 'echec', finieA: t0 }, t0 + 1000), 'resultat');
  assert.equal(phaseDeLigneCompte({ etape: 'reussie', finieA: t0 }, t0 + DUREE_RESULTAT_CONNEXION_MS), 'aucune');
});
