import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAISON_DEPLACEMENT_AGENT_AU_TRAVAIL,
  RAISON_DEPLACEMENT_DEJA_TRAVAILLEE,
  RAISON_DEPLACEMENT_DEMANDE_CLIENT,
  RAISON_DEPLACEMENT_MEME_PROJET,
  RAISON_DEPLACEMENT_PROJET_INCONNU,
  RAISON_DEPLACEMENT_PROJET_RANGE,
  candidatDepuisLaCarte,
  carteDejaTravaillee,
  deplacementVersProjetPossible,
  phraseDeDeplacement,
  type CarteCandidateAuDeplacement,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Une carte ne change de projet QU'AVANT tout travail                  */
/* ------------------------------------------------------------------ */

const neuve: CarteCandidateAuDeplacement = { colonne: 'planned', projetId: 'p-source' };
const ailleurs = { id: 'p-cible' };

test('une carte en « Demande », jamais travaillée, peut changer de projet', () => {
  assert.deepEqual(deplacementVersProjetPossible(neuve, ailleurs), { possible: true });
});

test('sans destination nommée, la question est « peut-elle partir tout court »', () => {
  assert.equal(deplacementVersProjetPossible(neuve).possible, true);
  assert.equal(deplacementVersProjetPossible({ ...neuve, codeDejaEnregistre: true }).possible, false);
});

test('une carte plus loin que le cadrage est refusée, et le motif nomme sa colonne', () => {
  for (const colonne of ['running', 'to_deploy', 'archived'] as const) {
    const verdict = deplacementVersProjetPossible({ ...neuve, colonne }, ailleurs);
    assert.equal(verdict.possible, false, `colonne ${colonne}`);
    assert.match(verdict.raison ?? '', /Demande|Plan/);
  }
});

test('un agent au travail bloque le déplacement, même en « Demande »', () => {
  const verdict = deplacementVersProjetPossible({ ...neuve, agentActif: true }, ailleurs);
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_AGENT_AU_TRAVAIL });
});

/*
 * LE PIÈGE CENTRAL : « planned » ne prouve RIEN. Une carte interrompue revient
 * en « Planifié » avec sa branche et sa copie de travail — elle ne peut pas
 * changer de dépôt.
 */
test('une carte revenue en « Planifié » avec sa branche reste sur place', () => {
  const interrompue = { ...neuve, branche: 'tache/quelque-chose-ab12' };
  assert.equal(carteDejaTravaillee(interrompue), true);
  assert.deepEqual(deplacementVersProjetPossible(interrompue, ailleurs), {
    possible: false,
    raison: RAISON_DEPLACEMENT_DEJA_TRAVAILLEE,
  });
});

test('chaque trace de travail passé suffit à refuser', () => {
  const traces: Partial<CarteCandidateAuDeplacement>[] = [
    { codeDejaEnregistre: true },
    { agentDeTache: true },
    { branche: 'tache/x-1' },
    { doneAt: 1 },
    { deployedAt: 1 },
    { archivedAt: 1 },
  ];
  for (const trace of traces) {
    const verdict = deplacementVersProjetPossible({ ...neuve, ...trace }, ailleurs);
    assert.equal(verdict.possible, false, JSON.stringify(trace));
    assert.equal(verdict.raison, RAISON_DEPLACEMENT_DEJA_TRAVAILLEE);
  }
});

test('une carte sans aucune trace n’est pas dite « déjà travaillée »', () => {
  assert.equal(carteDejaTravaillee(neuve), false);
  assert.equal(carteDejaTravaillee({ ...neuve, branche: '' }), false);
});

test('une carte née d’une demande client reste dans l’espace de son projet', () => {
  const verdict = deplacementVersProjetPossible({ ...neuve, neeDUneDemandeClient: true }, ailleurs);
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_DEMANDE_CLIENT });
});

/* ------------------------------------------------------------------ */
/* Le projet d'accueil                                                  */
/* ------------------------------------------------------------------ */

test('le projet d’accueil ne peut pas être celui de départ', () => {
  const verdict = deplacementVersProjetPossible(neuve, { id: 'p-source' });
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_MEME_PROJET });
});

test('un projet archivé ne reçoit rien', () => {
  const verdict = deplacementVersProjetPossible(neuve, { id: 'p-cible', archived: true });
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_PROJET_RANGE });
});

/*
 * L'ESPACE DE DÉVELOPPEMENT REÇOIT UNE CARTE COMME TOUT AUTRE PROJET. Il était
 * le SEUL refus tenant à l'identité du projet d'accueil : une carte ouverte au
 * mauvais endroit ne pouvait plus y être ramenée. Sa marque `isSelf` ne change
 * plus rien au verdict — ni dans un sens, ni dans l'autre.
 */
test('l’espace de développement de Beluga Build est une destination comme une autre', () => {
  assert.deepEqual(deplacementVersProjetPossible(neuve, { id: 'p-self', isSelf: true }), { possible: true });
  /* Et l'on en SORT : une carte qui y vit part ailleurs sans motif de refus. */
  const depuisLEspaceDev = { ...neuve, projetId: 'p-self' };
  assert.deepEqual(deplacementVersProjetPossible(depuisLEspaceDev, { id: 'p-cible' }), { possible: true });
});

/* Les autres protections ne bougent pas, même vers cet espace-là. */
test('une carte déjà travaillée reste refusée, y compris vers l’espace de développement', () => {
  const travaillee = { ...neuve, codeDejaEnregistre: true };
  const verdict = deplacementVersProjetPossible(travaillee, { id: 'p-self', isSelf: true });
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_DEJA_TRAVAILLEE });
});

test('un agent au travail reste refusé, y compris vers l’espace de développement', () => {
  const occupee = { ...neuve, agentActif: true };
  const verdict = deplacementVersProjetPossible(occupee, { id: 'p-self', isSelf: true });
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_AGENT_AU_TRAVAIL });
});

test('un projet introuvable est refusé, il n’est pas ignoré', () => {
  const verdict = deplacementVersProjetPossible(neuve, null);
  assert.deepEqual(verdict, { possible: false, raison: RAISON_DEPLACEMENT_PROJET_INCONNU });
});

/*
 * L'ORDRE DES REFUS COMPTE : une carte qui travaille encore le dit AVANT tout
 * reproche de colonne — c'est l'information la plus fraîche et la plus utile.
 */
test('le travail en cours l’emporte sur le reproche de colonne', () => {
  const verdict = deplacementVersProjetPossible({ ...neuve, colonne: 'running', agentActif: true }, ailleurs);
  assert.equal(verdict.raison, RAISON_DEPLACEMENT_AGENT_AU_TRAVAIL);
});

/* ------------------------------------------------------------------ */
/* L'écran lit la MÊME règle que le serveur                             */
/* ------------------------------------------------------------------ */

test('l’adaptateur de l’écran traduit la carte sans rien perdre', () => {
  const candidat = candidatDepuisLaCarte(
    {
      column: 'planned',
      projectId: 'p-source',
      github: { branch: 'tache/deja-la-1' },
      codeDejaEnregistre: false,
      demandeClientId: 'dem-1',
    },
    { agentActif: true, agentDeTache: true },
  );
  assert.equal(candidat.colonne, 'planned');
  assert.equal(candidat.projetId, 'p-source');
  assert.equal(candidat.branche, 'tache/deja-la-1');
  assert.equal(candidat.agentActif, true);
  assert.equal(candidat.agentDeTache, true);
  assert.equal(candidat.neeDUneDemandeClient, true);
});

test('une carte d’écran neuve passe, exactement comme côté serveur', () => {
  const candidat = candidatDepuisLaCarte({ column: 'planned', projectId: 'p-source' });
  assert.equal(deplacementVersProjetPossible(candidat, ailleurs).possible, true);
});

test('la ligne déposée dans l’historique nomme le projet quitté', () => {
  assert.match(phraseDeDeplacement('Site vitrine'), /Site vitrine/);
});
