/**
 * NE RIEN PERDRE DU TRAVAIL EN COURS QUAND ON REPART SUR UN AUTRE COMPTE.
 *
 * Reconnaître la limite et proposer les comptes ne suffisait pas : le tour de
 * reprise repartait avec l'identifiant du fil ouvert sur le compte à sec, que le
 * coffre du compte choisi n'a jamais vu — le moteur refusait le `--resume`, et
 * le travail en cours était perdu au lieu d'être poursuivi. Sa liste de tâches
 * disparaissait du même coup, puisqu'elle vit sur le message du tour.
 *
 * Les règles rejouées ici sont pures : ni base, ni démon, ni compte réel touché.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { TacheEnCours, resumeContinuite, tachesAPoursuivre } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* 1. La liste de tâches traverse la coupure                           */
/* ------------------------------------------------------------------ */

const LISTE: TacheEnCours[] = [
  { label: 'Lire les règles du moteur', state: 'done', startedAt: 100, endedAt: 200 },
  { label: 'Corriger la clé de session', state: 'running', startedAt: 200, endedAt: 900 },
  { label: 'Rejouer les contrôles', state: 'todo' },
];

test('la liste reste ENTIÈRE : rien de coché ne se décoche, rien à faire ne disparaît', () => {
  const reprise = tachesAPoursuivre(LISTE);
  assert.equal(reprise.length, 3);
  assert.deepEqual(
    reprise.map((tache) => tache.state),
    ['done', 'running', 'todo'],
  );
  assert.deepEqual(
    reprise.map((tache) => tache.label),
    LISTE.map((tache) => tache.label),
  );
});

test('une ligne cochée garde sa durée : on ne refait pas courir son chronomètre', () => {
  const [faite] = tachesAPoursuivre(LISTE);
  assert.equal(faite.startedAt, 100);
  assert.equal(faite.endedAt, 200);
});

test('la ligne coupée en plein vol repart SANS fin : plus personne ne travaillait dessus', () => {
  const [, encours] = tachesAPoursuivre(LISTE);
  assert.equal(encours.state, 'running');
  assert.equal(encours.startedAt, 200);
  assert.equal(encours.endedAt, undefined);
});

test('une liste vide reste vide : on n’invente pas d’étapes', () => {
  assert.deepEqual(tachesAPoursuivre([]), []);
});

test('la liste d’origine n’est jamais modifiée sur place', () => {
  tachesAPoursuivre(LISTE);
  assert.equal(LISTE[1].endedAt, 900);
});

/* ------------------------------------------------------------------ */
/* 2. Le résumé qui évite de tout redécouvrir                          */
/* ------------------------------------------------------------------ */

const ENTREE = {
  project: 'HaikoDev',
  workdir: '/root/haikodev/.worktrees/exemple',
  role: 'task',
  title: 'Reprise avec un autre compte',
  card: { title: 'Ne rien perdre du travail en cours', description: 'Poursuivre sans redécouvrir.', column: 'running' },
  exchanges: [{ role: 'assistant', content: 'La clé de session ignore le compte porteur.' }],
  decisions: ['Faut-il changer la clé ? → oui'],
  todos: ['done : Lire les règles', 'running : Corriger la clé'],
};

test('le résumé d’un changement de compte dit qu’il ne s’agit PAS d’un oubli', () => {
  const texte = resumeContinuite({ ...ENTREE, motif: 'changement-de-compte' });
  assert.match(texte, /TU REPARS SUR UN AUTRE COMPTE/);
  assert.match(texte, /POURSUIS EXACTEMENT OÙ TU T'ES ARRÊTÉ/);
  assert.match(texte, /n'a pas bougé/);
  assert.match(texte, /ne repose pas une question déjà tranchée/);
});

test('le résumé emporte la carte, les décisions et la liste de tâches', () => {
  const texte = resumeContinuite({ ...ENTREE, motif: 'changement-de-compte' });
  assert.match(texte, /Ne rien perdre du travail en cours/);
  assert.match(texte, /Dossier de travail : \/root\/haikodev/);
  assert.match(texte, /Faut-il changer la clé \? → oui/);
  assert.match(texte, /running : Corriger la clé/);
});

test('la compression garde SON texte : les deux causes ne se disent pas pareil', () => {
  const compression = resumeContinuite({ ...ENTREE, motif: 'compression' });
  assert.match(compression, /APRÈS COMPRESSION/);
  assert.doesNotMatch(compression, /AUTRE COMPTE/);
  // Sans motif, c'est la compression : le comportement d'avant, intact.
  assert.equal(resumeContinuite(ENTREE), compression);
});
