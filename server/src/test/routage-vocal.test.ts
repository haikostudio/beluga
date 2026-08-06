import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELAI_REPONSE_DICTEE_MS,
  lieuDeLaQuestion,
  projetNomme,
  reponseEncoreAttendue,
  routerLaDemande,
  suiteDuRoutage,
  type DicteeEnAttente,
  type ProjetJoignable,
} from '@haikodev/shared';

/**
 * Une phrase dictée n'a pas de destinataire. La règle en trouve un — ou pose
 * la question. Ce qu'elle ne fait JAMAIS, c'est parier.
 */

const HAIKO = { id: 'p-haiko', name: 'HaikoDev' };
const ROOT = { id: 'p-root', name: 'Root' };
const DUPONT = { id: 'p-dupont', name: 'Site du client Dupont' };
const PROJETS: ProjetJoignable[] = [HAIKO, ROOT, DUPONT];

/* ------------------------------------------------------------------ */
/* Le nom est cité                                                     */
/* ------------------------------------------------------------------ */

test('un projet nommé dans la phrase reçoit la demande', () => {
  const routage = routerLaDemande('ajoute un bouton de partage sur HaikoDev', PROJETS);
  assert.equal(routage.projectId, 'p-haiko');
  assert.equal(routage.motif, 'nom-cite');
  assert.equal(routage.question, undefined);
});

test('la casse, les accents et la ponctuation ne changent rien', () => {
  const routage = routerLaDemande('sur ROOT, redémarre le service de sauvegarde.', PROJETS);
  assert.equal(routage.projectId, 'p-root');
});

test('un projet dont le nom tient en plusieurs mots se reconnaît par son mot distinctif', () => {
  const routage = routerLaDemande('chez Dupont, refais la page d’accueil', PROJETS);
  assert.equal(routage.projectId, 'p-dupont');
});

/* ------------------------------------------------------------------ */
/* Le nom est approchant : la dictée écorche les noms propres          */
/* ------------------------------------------------------------------ */

test('un nom écorché par la dictée retrouve son projet', () => {
  const routage = routerLaDemande('sur aïko dev, corrige le menu de navigation', PROJETS);
  assert.equal(routage.projectId, 'p-haiko');
  assert.equal(routage.motif, 'nom-approchant');
});

test('deux projets aussi proches l’un que l’autre font poser la question', () => {
  const proches: ProjetJoignable[] = [HAIKO, { id: 'p-compta', name: 'Compta Haiko' }, ROOT];
  const routage = routerLaDemande('sur aïko dev, corrige le menu de navigation', proches);
  assert.equal(routage.projectId, undefined);
  assert.ok(routage.question);
  assert.equal(routage.motif, 'plusieurs-projets');
  assert.deepEqual(
    routage.candidats.map((projet) => projet.id).sort(),
    ['p-compta', 'p-haiko'],
  );
});

/* ------------------------------------------------------------------ */
/* Aucun nom : on demande, on ne devine pas                            */
/* ------------------------------------------------------------------ */

test('une phrase qui ne nomme aucun projet fait poser la question', () => {
  const routage = routerLaDemande('il faudrait corriger le menu de navigation', PROJETS);
  assert.equal(routage.projectId, undefined);
  assert.equal(routage.motif, 'aucun-nom');
  assert.match(routage.question ?? '', /pour quel projet/i);
  // Tous les projets ouverts sont proposés : la réponse tient en un clic.
  assert.deepEqual(routage.candidats.map((projet) => projet.id), ['p-haiko', 'p-root', 'p-dupont']);
});

test('la question cite la phrase entendue, raccourcie', () => {
  const longue = `corrige ${'le menu de navigation '.repeat(12)}`;
  const routage = routerLaDemande(longue, PROJETS);
  assert.ok((routage.question ?? '').includes('…'));
  assert.ok((routage.question ?? '').length < 200);
});

test('deux projets nommés dans la même phrase font poser la question', () => {
  const routage = routerLaDemande('compare HaikoDev et Root', PROJETS);
  assert.equal(routage.projectId, undefined);
  assert.equal(routage.motif, 'plusieurs-projets');
  assert.deepEqual(routage.candidats.map((projet) => projet.id), ['p-haiko', 'p-root']);
});

test('une phrase vide ne part nulle part', () => {
  const routage = routerLaDemande('   ', PROJETS);
  assert.equal(routage.projectId, undefined);
  assert.equal(routage.motif, 'phrase-vide');
  assert.ok(routage.question);
});

/* ------------------------------------------------------------------ */
/* Le projet est clair, l'action ne l'est pas                          */
/* ------------------------------------------------------------------ */

test('un nom de projet sans action fait demander ce qu’il faut faire', () => {
  const routage = routerLaDemande('HaikoDev', PROJETS);
  assert.equal(routage.projectId, undefined, 'rien n’est déposé tant que l’action manque');
  assert.equal(routage.projetRetenu, 'p-haiko', 'la destination, elle, est acquise');
  assert.equal(routage.motif, 'action-floue');
  assert.match(routage.question ?? '', /HaikoDev/);
});

/* ------------------------------------------------------------------ */
/* Ce qui n'est pas au tableau ne reçoit rien                          */
/* ------------------------------------------------------------------ */

test('un projet archivé ne reçoit jamais de demande', () => {
  const avecArchive: ProjetJoignable[] = [ROOT, { ...HAIKO, archived: true }];
  const routage = routerLaDemande('ajoute un bouton de partage sur HaikoDev', avecArchive);
  assert.notEqual(routage.projectId, 'p-haiko');
});

test('sans aucun projet ouvert, rien n’est déposé et rien n’est demandé', () => {
  const routage = routerLaDemande('corrige le menu', [{ ...HAIKO, archived: true }]);
  assert.equal(routage.motif, 'aucun-projet');
  assert.equal(routage.question, undefined);
});

test('un seul projet ouvert : il n’y a rien à deviner', () => {
  const routage = routerLaDemande('corrige le menu de navigation', [HAIKO]);
  assert.equal(routage.projectId, 'p-haiko');
  assert.equal(routage.motif, 'projet-unique');
});

/* ------------------------------------------------------------------ */
/* Où la question se pose                                              */
/* ------------------------------------------------------------------ */

test('la question se pose chez le premier candidat plausible', () => {
  const routage = routerLaDemande('compare HaikoDev et Root', PROJETS);
  assert.equal(lieuDeLaQuestion(routage, PROJETS, 'p-dupont'), 'p-haiko');
});

test('quand l’action seule manque, la question se pose chez le projet retenu', () => {
  const routage = routerLaDemande('HaikoDev', PROJETS);
  assert.equal(lieuDeLaQuestion(routage, PROJETS, 'p-root'), 'p-haiko');
});

test('sans candidat, la question se pose là où l’utilisateur regarde', () => {
  const routage = { candidats: [], motif: 'aucun-nom' as const };
  assert.equal(lieuDeLaQuestion(routage, PROJETS, 'p-root'), 'p-root');
  assert.equal(lieuDeLaQuestion(routage, PROJETS, null), 'p-haiko');
  assert.equal(lieuDeLaQuestion(routage, [], null), null);
});

/* ------------------------------------------------------------------ */
/* La réponse                                                          */
/* ------------------------------------------------------------------ */

const ATTENTE_PROJET: DicteeEnAttente = {
  texte: 'corrige le menu de navigation',
  candidats: [HAIKO, ROOT],
  poseeA: 1000,
};

test('la réponse nomme le projet : c’est la phrase d’ORIGINE qui part', () => {
  const suite = suiteDuRoutage(ATTENTE_PROJET, 'HaikoDev', PROJETS);
  assert.equal(suite.projectId, 'p-haiko');
  assert.equal(suite.texte, 'corrige le menu de navigation');
});

test('la réponse peut être dite en toutes lettres', () => {
  const suite = suiteDuRoutage(ATTENTE_PROJET, 'c’est pour le site du client Dupont', PROJETS);
  assert.equal(suite.projectId, 'p-dupont');
  assert.equal(suite.texte, 'corrige le menu de navigation');
});

test('quand l’ACTION manquait, c’est la réponse elle-même qui part', () => {
  const attente: DicteeEnAttente = {
    texte: 'HaikoDev',
    projectId: 'p-haiko',
    candidats: [],
    poseeA: 1000,
  };
  const suite = suiteDuRoutage(attente, 'ajoute un bouton de partage', PROJETS);
  assert.equal(suite.projectId, 'p-haiko');
  assert.equal(suite.texte, 'ajoute un bouton de partage');
});

test('une réponse incomprise ne dépose rien, et le dit', () => {
  const suite = suiteDuRoutage(ATTENTE_PROJET, 'euh, je ne sais pas', PROJETS);
  assert.equal(suite.projectId, undefined);
  assert.ok(suite.raison);
});

test('une réponse vide ne dépose rien', () => {
  assert.ok(suiteDuRoutage(ATTENTE_PROJET, '   ', PROJETS).raison);
});

test('un projet retenu puis archivé ne reçoit rien', () => {
  const attente: DicteeEnAttente = {
    texte: 'HaikoDev',
    projectId: 'p-haiko',
    candidats: [],
    poseeA: 1000,
  };
  const suite = suiteDuRoutage(attente, 'ajoute un bouton', [{ ...HAIKO, archived: true }, ROOT]);
  assert.equal(suite.projectId, undefined);
  assert.ok(suite.raison);
});

/* ------------------------------------------------------------------ */
/* La réponse donnée à la voix                                         */
/* ------------------------------------------------------------------ */

test('une question fraîche attend encore la phrase suivante', () => {
  assert.equal(reponseEncoreAttendue(1000, 1000 + 60_000), true);
  assert.equal(reponseEncoreAttendue(1000, 1000 + DELAI_REPONSE_DICTEE_MS + 1), false);
});

/* ------------------------------------------------------------------ */
/* La destination seule, sans juger l'action                           */
/* ------------------------------------------------------------------ */

test('lire une réponse ne réclame aucune action : un nom de projet suffit', () => {
  assert.equal(projetNomme('Root', PROJETS).projectId, 'p-root');
  assert.equal(routerLaDemande('Root', PROJETS).projectId, undefined);
});
