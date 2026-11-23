import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JALON_TOUR_ARRETE,
  JALON_TOUR_EN_PAUSE,
  JALON_TOUR_NON_PARTI,
  JALON_TOUR_SUSPENDU,
  TEXTE_TOUR_SUSPENDU,
  RAPPORT_MINIMAL,
  genreDAction,
  jalonDeFinDeTour,
  motifDePannePassagere,
  rapportDejaEcrit,
} from '@beluga/shared';

/* La bannière exacte relevée 38 fois dans la base réellement servie. */
const CREDITS =
  'Fable 5.1 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage to continue.';

test('un tour réussi rend sa réponse, et rien d’autre', () => {
  const issue = jalonDeFinDeTour({ failed: false, texte: 'Voilà le travail.' });
  assert.equal(issue.libelle, 'Réponse rendue');
  assert.equal(issue.resultat, 'Voilà le travail.');
  assert.equal(issue.reussie, true);
  assert.equal(issue.incident, false);
  assert.equal(issue.cause, undefined);
});

test('UN ARRÊT DE QUOTA EST UNE PAUSE, PAS UN INCIDENT — et il ne rougit plus le « Rapport »', () => {
  const issue = jalonDeFinDeTour({ failed: true, reprise: true, cause: CREDITS });
  assert.equal(issue.libelle, JALON_TOUR_EN_PAUSE);
  assert.equal(issue.incident, false);
  assert.equal(issue.cause, CREDITS);
  /* Le jalon ne compte pas comme une panne dans la ligne de temps de la carte. */
  assert.notEqual(genreDAction({ nature: 'jalon', libelle: JALON_TOUR_EN_PAUSE, reussie: false }), 'incident');
});

test('un moteur jamais parti et un arrêt à la main ne sont pas des pannes non plus', () => {
  assert.equal(jalonDeFinDeTour({ failed: true, moteurMuet: true, cause: 'x' }).libelle, JALON_TOUR_NON_PARTI);
  assert.equal(jalonDeFinDeTour({ failed: true, moteurMuet: true, cause: 'x' }).incident, false);
  assert.equal(jalonDeFinDeTour({ failed: true, arretDemande: true, cause: 'x' }).libelle, JALON_TOUR_ARRETE);
  assert.equal(jalonDeFinDeTour({ failed: true, arretDemande: true, cause: 'x' }).incident, false);
  /* Le geste humain passe DEVANT la relève de quota. */
  assert.equal(
    jalonDeFinDeTour({ failed: true, arretDemande: true, reprise: true, cause: CREDITS }).libelle,
    JALON_TOUR_ARRETE,
  );
});

test('UN COMPTE RENDU DÉJÀ ÉCRIT N’EST PLUS PERDU quand le tour tombe après lui', () => {
  const rapport = 'Analyse'.padEnd(RAPPORT_MINIMAL + 10, ' et suite');
  const issue = jalonDeFinDeTour({ failed: true, texte: rapport, cause: "Le moteur s'est arrêté (code null)." });
  assert.equal(issue.libelle, 'Réponse rendue');
  assert.equal(issue.resultat, rapport.trim());
  assert.equal(issue.incident, false);
  /* La cause reste DITE à côté : un tour tombé doit expliquer pourquoi. */
  assert.equal(issue.cause, "Le moteur s'est arrêté (code null).");
});

test('un gabarit tenu prouve le compte rendu, même court ; trois mots ne prouvent rien', () => {
  assert.equal(rapportDejaEcrit({ failed: true, texte: 'Court mais complet.', rapportEntier: true }), true);
  assert.equal(rapportDejaEcrit({ failed: true, texte: 'Court mais complet.' }), false);
  assert.equal(rapportDejaEcrit({ failed: true, texte: '   ', rapportEntier: true }), false);
});

test('un vrai plantage reste un incident, et lui seul', () => {
  const issue = jalonDeFinDeTour({ failed: true, cause: 'API Error: 400 bad request' });
  assert.equal(issue.libelle, 'Tour interrompu');
  assert.equal(issue.incident, true);
  assert.equal(genreDAction({ nature: 'jalon', libelle: 'Tour interrompu', reussie: false }), 'incident');
});

test('UN MOTEUR MORT SANS UN MOT SE RETENTE TOUT SEUL, sans clic', () => {
  /* Deuxième cause d'interruption relevée en base : 7 des 61 « Tour interrompu ». */
  assert.equal(motifDePannePassagere({ ok: false, erreur: "Le moteur s'est arrêté (code null)." }), 'lien-coupe');
  assert.equal(motifDePannePassagere({ ok: false, erreur: "Le moteur s'est arrêté (code 137)." }), 'lien-coupe');
  assert.equal(motifDePannePassagere({ ok: false, erreur: 'write EPIPE' }), 'lien-coupe');
  /*
   * ET LE CODE 143 AUSSI. On le tenait pour « celui de NOTRE bouton d'arrêt »,
   * donc jamais retenté. C'était faux : 143 = 128 + 15, la signature de
   * SIGTERM, quelle qu'en soit la main — et `systemctl restart` l'envoie à TOUT
   * le groupe de contrôle. Relevé le 30/08/2026 à 23:08:58 : le démon RETIENT
   * l'arrêt (« une publication est en cours »), et cinq secondes plus tard
   * trois de ses moteurs sortent en 143. Trois tours perdus, sans un essai.
   */
  assert.equal(motifDePannePassagere({ ok: false, erreur: "Le moteur s'est arrêté (code 143)." }), 'lien-coupe');
  /*
   * Un arrêt demandé à la main n'est jamais une panne — et c'est CE drapeau qui
   * en décide, jamais un code de sortie que le démon ne contrôle pas.
   */
  assert.equal(motifDePannePassagere({ ok: false, arretDemande: true, erreur: "Le moteur s'est arrêté (code 143)." }), null);
  assert.equal(
    motifDePannePassagere({ ok: false, arretDemande: true, erreur: "Le moteur s'est arrêté (code null)." }),
    null,
  );
});

test('UNE SUSPENSION À LA MAIN EST UNE LIGNE NEUTRE DU TRAVAIL — jamais le « Rapport », jamais « code 143 »', () => {
  const longue = 'x'.repeat(RAPPORT_MINIMAL + 10);
  const issue = jalonDeFinDeTour({
    failed: true,
    arretDemande: true,
    suspendu: true,
    texte: longue,
    cause: "Le moteur s'est arrêté (code 143)",
  });
  assert.equal(issue.libelle, JALON_TOUR_SUSPENDU);
  assert.equal(issue.phase, 'execution');
  assert.equal(issue.reussie, null, 'ni vert ni rouge');
  assert.equal(issue.incident, false);
  assert.equal(issue.resultat, TEXTE_TOUR_SUSPENDU);
  assert.notEqual(genreDAction({ nature: 'jalon', libelle: JALON_TOUR_SUSPENDU }), 'incident');
});

test('…mais un ARRÊT complet (« Arrêter ») et une vraie panne restent sous le « Rapport »', () => {
  assert.equal(jalonDeFinDeTour({ failed: true, arretDemande: true, cause: 'x' }).phase, 'rapport');
  const panne = jalonDeFinDeTour({ failed: true, cause: 'x' });
  assert.equal(panne.phase, 'rapport');
  assert.equal(panne.incident, true);
  /* Une marque de pause sans arrêt demandé ne fait pas une suspension. */
  assert.equal(jalonDeFinDeTour({ failed: true, suspendu: true, cause: 'x' }).libelle, 'Tour interrompu');
});
