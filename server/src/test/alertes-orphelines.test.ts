import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRACE_ANNONCE_MS,
  annonceSansPorteur,
  attentionParProjet,
  decisionOrpheline,
  decisionSansIssue,
  decisionsAvecIssue,
  journalDesNotifications,
  lieuAtteignable,
  premiereDecision,
  reconnaitreErreur,
  sansDecisionsOrphelines,
  sourceSansGeste,
  type DecisionAttendue,
} from '@beluga/shared';

/*
 * LES ALERTES QUI NE MÈNENT NULLE PART.
 *
 * Supprimer une carte laissait derrière elle ses questions ouvertes : un
 * triangle sur le projet, un chiffre sur la cloche, et un clic qui n'ouvrait
 * plus rien. Ces tests tiennent les deux promesses de la carte : l'alerte
 * orpheline disparaît, et l'alerte d'erreur dit quoi faire.
 */

const CARTES = new Set(['c1']);
const PROJETS = new Set(['p1']);
const AGENTS = new Set(['a', 'b', 'chef']);
/** Ce qu'un navigateur connaît : les cartes et les conversations chargées. */
const PORTEURS = { cartes: CARTES, agents: AGENTS };

test('une décision dont la carte a été supprimée est orpheline', () => {
  const morte: DecisionAttendue = { projectId: 'p1', agentId: 'a', cardId: 'disparue', genre: 'question' };
  assert.equal(decisionOrpheline(morte, { cartes: CARTES, projets: PROJETS }), true);
});

test('une décision de conversation, sans carte, n’est jamais orpheline', () => {
  const chef: DecisionAttendue = { projectId: 'p1', agentId: 'chef', genre: 'validation' };
  assert.equal(decisionOrpheline(chef, { cartes: CARTES, projets: PROJETS }), false);
});

test('une décision d’un projet supprimé est orpheline, carte ou pas', () => {
  const ailleurs: DecisionAttendue = { projectId: 'parti', agentId: 'chef', genre: 'question' };
  assert.equal(decisionOrpheline(ailleurs, { cartes: CARTES, projets: PROJETS }), true);
});

test('le compte annoncé sur le projet ne retient plus les orphelines', () => {
  const decisions: DecisionAttendue[] = [
    { projectId: 'p1', agentId: 'a', cardId: 'c1', genre: 'question' },
    { projectId: 'p1', agentId: 'b', cardId: 'disparue', genre: 'question' },
    { projectId: 'p1', agentId: 'chef', genre: 'validation' },
  ];
  const gardees = sansDecisionsOrphelines(decisions, { cartes: CARTES, projets: PROJETS });
  assert.equal(gardees.length, 2);
  assert.deepEqual(attentionParProjet(gardees), { p1: 2 });
});

/* ------------------------------------------------------------------ */
/* Une erreur qui dit ce qu'elle est                                    */
/* ------------------------------------------------------------------ */

test('un dossier absent est reconnu, et il ne partira pas tout seul', () => {
  const lue = reconnaitreErreur("ENOENT: no such file or directory, chdir '/root/beluga/.worktrees/x'");
  assert.equal(lue?.genre, 'dossier');
  assert.equal(lue?.passagere, false);
});

test('une coupure de réseau est reconnue comme passagère', () => {
  assert.deepEqual(reconnaitreErreur('fetch failed: ECONNRESET'), { genre: 'reseau', passagere: true });
  assert.deepEqual(reconnaitreErreur('Error: socket hang up'), { genre: 'reseau', passagere: true });
});

test('un moteur absent passe devant le dossier absent', () => {
  assert.equal(reconnaitreErreur('spawn claude ENOENT')?.genre, 'moteur');
});

test('une limite de compte est reconnue, et elle est passagère', () => {
  assert.deepEqual(reconnaitreErreur('429 rate limit exceeded'), { genre: 'quota', passagere: true });
});

test('un accès refusé parle d’identifiant, pas de droits de fichier', () => {
  assert.equal(reconnaitreErreur('401 Unauthorized: invalid api key')?.genre, 'identifiant');
  assert.equal(reconnaitreErreur('EACCES: permission denied')?.genre, 'droits');
});

test('une erreur inconnue n’invente aucune explication', () => {
  assert.equal(reconnaitreErreur('quelque chose s’est mal passé'), null);
  assert.equal(reconnaitreErreur(''), null);
  assert.equal(reconnaitreErreur(undefined), null);
});

/* ------------------------------------------------------------------ */
/* La conversation disparue, et la décision annoncée qu'on peut suivre  */
/* ------------------------------------------------------------------ */

test('une décision dont la conversation a disparu est orpheline', () => {
  const morte: DecisionAttendue = { projectId: 'p1', agentId: 'parti', genre: 'question' };
  assert.equal(decisionOrpheline(morte, { cartes: CARTES, projets: PROJETS, agents: AGENTS }), true);
});

test('sans liste de conversations, aucune décision n’est perdue', () => {
  const chef: DecisionAttendue = { projectId: 'p1', agentId: 'parti', genre: 'question' };
  assert.equal(decisionOrpheline(chef, { cartes: CARTES, projets: PROJETS }), false);
});

test('la conversation encore là garde sa décision', () => {
  const vivante: DecisionAttendue = { projectId: 'p1', agentId: 'chef', genre: 'validation' };
  assert.equal(decisionOrpheline(vivante, { cartes: CARTES, projets: PROJETS, agents: AGENTS }), false);
});

test('une ligne est atteignable dès qu’elle nomme une conversation, sans projet ni carte', () => {
  assert.equal(lieuAtteignable({ agentId: 'a' }), true);
  assert.equal(lieuAtteignable({ cardId: 'c1' }), true);
  assert.equal(lieuAtteignable({ projectId: 'p1' }), true);
  assert.equal(lieuAtteignable({}), false);
});

test('une décision annoncée sans porteur quitte la liste, passé le délai de grâce', () => {
  const annonce = {
    id: 'n1',
    titre: 'Une réponse est attendue',
    corps: 'Où vit la base de ce site ?',
    motif: 'decision-attendue',
    a: 1_000,
    agentId: 'parti',
  };
  const lignes = journalDesNotifications([], [annonce], undefined, 1_000 + GRACE_ANNONCE_MS + 1, PORTEURS);
  assert.equal(lignes.length, 0);
});

test('sans liste de porteurs, une annonce réglée reste lisible', () => {
  const annonce = {
    id: 'n1',
    titre: 'Une réponse est attendue',
    corps: 'Question réglée depuis.',
    motif: 'decision-attendue',
    a: 1_000,
    agentId: 'parti',
  };
  assert.equal(journalDesNotifications([], [annonce], undefined, 1_000 + GRACE_ANNONCE_MS + 1).length, 1);
});

test('une annonce dont le porteur est encore là ne bouge pas', () => {
  const annonce = {
    id: 'n1',
    titre: 'Une réponse est attendue',
    corps: 'Question réglée depuis.',
    motif: 'decision-attendue',
    a: 1_000,
    agentId: 'chef',
  };
  assert.equal(
    journalDesNotifications([], [annonce], undefined, 1_000 + GRACE_ANNONCE_MS + 1, PORTEURS).length,
    1,
  );
});

test('la même annonce reste tant que sa décision est ouverte', () => {
  const annonce = {
    id: 'n1',
    titre: 'Une réponse est attendue',
    corps: 'Où vit la base de ce site ?',
    motif: 'decision-attendue',
    a: 1_000,
    agentId: 'chef',
  };
  const ouverte: DecisionAttendue = { projectId: 'p1', agentId: 'chef', genre: 'question' };
  const lignes = journalDesNotifications([ouverte], [annonce], undefined, 1_000 + GRACE_ANNONCE_MS + 1, PORTEURS);
  // La demande passe devant, et l'annonce ne la double pas.
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].source, 'demande');
});

test('une annonce toute fraîche n’est jamais jugée sans porteur', () => {
  const annonce = {
    id: 'n1',
    titre: 'Une réponse est attendue',
    corps: '…',
    motif: 'decision-attendue',
    a: 1_000,
    agentId: 'parti',
  };
  assert.equal(annonceSansPorteur(annonce, [], 1_000 + 1_000, PORTEURS), false);
});

test('une tâche terminée annoncée n’est pas concernée par la règle', () => {
  const annonce = { id: 'n2', titre: 'Tâche finie', corps: '…', motif: 'tache-terminee', a: 1_000, agentId: 'parti' };
  assert.equal(annonceSansPorteur(annonce, [], 1_000 + GRACE_ANNONCE_MS + 1, PORTEURS), false);
});

/* ------------------------------------------------------------------ */
/* Le critère d'ISSUE RÉELLE : le lieu existe, mais y a-t-il un geste ? */
/* ------------------------------------------------------------------ */

/*
 * `decisionOrpheline` répond « le lieu existe-t-il ? ». Ces tests-ci tiennent
 * la promesse suivante : une alerte ne reste allumée que si elle mène à un
 * BOUTON. Une décision qui ne nomme pas le message où sa question se tranche
 * n'a rien à afficher, et le clic n'aurait nulle part où conduire.
 */

const AVEC_ISSUE: DecisionAttendue = {
  projectId: 'p1',
  agentId: 'a',
  cardId: 'c1',
  genre: 'question',
  messageId: 'm1',
  source: 'question-outil',
};

test('une décision qui nomme sa carte et son message garde son issue', () => {
  assert.equal(decisionSansIssue(AVEC_ISSUE), false);
});

test('une décision qui ne nomme aucun message n’a plus d’issue', () => {
  assert.equal(decisionSansIssue({ ...AVEC_ISSUE, messageId: undefined }), true);
  assert.equal(decisionSansIssue({ ...AVEC_ISSUE, messageId: '   ' }), true);
});

test('un message porteur effacé éteint la décision', () => {
  assert.equal(decisionSansIssue(AVEC_ISSUE, { messages: new Set(['m1']) }), false);
  assert.equal(decisionSansIssue(AVEC_ISSUE, { messages: new Set(['autre']) }), true);
});

test('sans liste de messages, on ne présume rien', () => {
  assert.equal(decisionSansIssue(AVEC_ISSUE, {}), false);
});

test('une décision qui ne nomme ni carte ni conversation n’a nulle part où aller', () => {
  assert.equal(
    decisionSansIssue({ projectId: 'p1', genre: 'question', messageId: 'm1', source: 'question-outil' }),
    true,
  );
});

test('une décision de conversation, sans carte, garde son issue', () => {
  const publication: DecisionAttendue = {
    projectId: 'p1',
    agentId: 'deploy',
    genre: 'question',
    messageId: 'm9',
    source: 'erreur-de-tour',
  };
  assert.equal(decisionSansIssue(publication), false);
});

test('une décision RÉGLÉE n’est pas « sans issue » : elle garde sa trace', () => {
  assert.equal(decisionSansIssue({ ...AVEC_ISSUE, reglee: true }), false);
});

test('les cinq sources rendent toutes un geste aujourd’hui', () => {
  assert.equal(sourceSansGeste('question-outil'), false);
  assert.equal(sourceSansGeste('reprise-de-compte'), false);
  assert.equal(sourceSansGeste('erreur-de-tour'), false);
  assert.equal(sourceSansGeste('question-en-texte'), false);
  assert.equal(sourceSansGeste('carte-proposee'), false);
  // Une source inconnue de la table ne fait rien disparaître.
  assert.equal(sourceSansGeste(undefined), false);
});

test('le compte annoncé ne retient que les décisions qui mènent à un geste', () => {
  const decisions: DecisionAttendue[] = [
    AVEC_ISSUE,
    { projectId: 'p1', agentId: 'b', cardId: 'c1', genre: 'question', source: 'question-outil' },
    { projectId: 'p1', genre: 'validation', messageId: 'm2', source: 'carte-proposee' },
  ];
  const gardees = decisionsAvecIssue(decisions);
  assert.equal(gardees.length, 1);
  assert.deepEqual(attentionParProjet(gardees), { p1: 1 });
});

test('le lieu d’une décision emporte le message où le geste se prend', () => {
  const lieu = premiereDecision([AVEC_ISSUE], 'p1');
  assert.equal(lieu?.messageId, 'm1');
  assert.equal(lieu?.cardId, 'c1');
});

test('la ligne de la cloche emporte, elle aussi, ce message', () => {
  const lignes = journalDesNotifications([AVEC_ISSUE], []);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].lieu.messageId, 'm1');
});

/* ------------------------------------------------------------------ */
/* …et le risque symétrique : effacer une annonce qui comptait encore   */
/* ------------------------------------------------------------------ */

test('une annonce d’un projet jamais consulté n’est pas jugée sans porteur', () => {
  const annonce = {
    id: 'n2',
    titre: 'Une réponse est attendue',
    corps: 'Question posée sur un projet qu’on n’a pas ouvert.',
    motif: 'decision-attendue',
    a: 1_000,
    projectId: 'p2',
    cardId: 'jamais-chargee',
  };
  const porteurs = { cartes: CARTES, agents: AGENTS, projetsCharges: new Set(['p1']) };
  assert.equal(
    journalDesNotifications([], [annonce], undefined, 1_000 + GRACE_ANNONCE_MS + 1, porteurs).length,
    1,
  );
});

test('sur un projet bien chargé, l’annonce sans porteur s’efface toujours', () => {
  const annonce = {
    id: 'n3',
    titre: 'Une réponse est attendue',
    corps: 'Carte supprimée depuis.',
    motif: 'decision-attendue',
    a: 1_000,
    projectId: 'p1',
    cardId: 'disparue',
  };
  const porteurs = { cartes: CARTES, agents: AGENTS, projetsCharges: new Set(['p1']) };
  assert.equal(
    journalDesNotifications([], [annonce], undefined, 1_000 + GRACE_ANNONCE_MS + 1, porteurs).length,
    0,
  );
});
