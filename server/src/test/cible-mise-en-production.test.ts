import test from 'node:test';
import assert from 'node:assert/strict';
import {
  champsManquants,
  mentionCibleMiseEnProduction,
  raisonCibleMiseEnProduction,
  refusCibleMiseEnProduction,
  typeCibleReglee,
} from '@haikodev/shared';

/*
 * LE TYPE DE CIBLE DE LA MISE EN PRODUCTION (`shared/src/cible-mise-en-production.ts`).
 *
 * Type absent = « consigne » : le comportement d'avant ce réglage doit rester
 * intact, au signe près — c'est l'état de tous les projets existants.
 */

/* ------------------------------------------------------------------ */
/* Type retenu                                                          */
/* ------------------------------------------------------------------ */

test('sans réglage, le type retenu est « consigne » (le comportement d’avant)', () => {
  assert.equal(typeCibleReglee(undefined), 'consigne');
  assert.equal(typeCibleReglee({}), 'consigne');
});

test('un type réglé est repris tel quel', () => {
  assert.equal(typeCibleReglee({ type: 'ssh' }), 'ssh');
  assert.equal(typeCibleReglee({ type: 'ftp' }), 'ftp');
  assert.equal(typeCibleReglee({ type: 'aucune' }), 'aucune');
});

/* ------------------------------------------------------------------ */
/* Type « consigne » : le fonctionnement d'avant, intact                */
/* ------------------------------------------------------------------ */

test('« consigne » sans prompt refuse, exactement comme avant ce réglage', () => {
  assert.ok(refusCibleMiseEnProduction({ prompt: '' }));
  assert.ok(refusCibleMiseEnProduction({ prompt: '   ' }));
  assert.ok(refusCibleMiseEnProduction(undefined));
});

test('« consigne » avec un prompt écrit ne refuse rien', () => {
  assert.equal(refusCibleMiseEnProduction({ prompt: 'fais ceci' }), null);
  assert.equal(refusCibleMiseEnProduction({ type: 'consigne', prompt: 'fais ceci' }), null);
});

/* ------------------------------------------------------------------ */
/* Type « aucune » : jamais refusé                                     */
/* ------------------------------------------------------------------ */

test('« aucune » n’est jamais refusé, même sans rien de réglé', () => {
  assert.equal(refusCibleMiseEnProduction({ type: 'aucune' }), null);
});

/* ------------------------------------------------------------------ */
/* Types SSH / FTP : refusés tant que les champs manquent               */
/* ------------------------------------------------------------------ */

test('SSH incomplet liste les champs manquants', () => {
  const manquants = champsManquants('ssh', {});
  assert.ok(manquants.includes('adresse du serveur'));
  assert.ok(manquants.includes('identifiant'));
  assert.ok(manquants.includes('dossier de destination'));
  assert.ok(manquants.includes('mot de passe ou clé'));
});

test('SSH avec une clé (sans mot de passe) n’exige pas de mot de passe', () => {
  const manquants = champsManquants('ssh', {
    hote: 'serveur.exemple.com',
    utilisateur: 'deploy',
    dossierDistant: '/var/www/site',
    cle: '-----BEGIN KEY-----',
  });
  assert.deepEqual(manquants, []);
});

test('un projet SSH incomplet refuse la mise en production, en nommant les champs', () => {
  const refus = refusCibleMiseEnProduction({ type: 'ssh', ssh: { hote: 'serveur.exemple.com' } });
  assert.ok(refus);
  assert.match(refus!, /SSH/);
  assert.match(refus!, /identifiant/);
});

test('un projet SSH complet ne refuse rien', () => {
  const refus = refusCibleMiseEnProduction({
    type: 'ssh',
    ssh: { hote: 'serveur.exemple.com', utilisateur: 'deploy', motDePasse: 'secret', dossierDistant: '/var/www/site' },
  });
  assert.equal(refus, null);
});

test('FTP incomplet exige un mot de passe (pas de clé possible en FTP)', () => {
  const manquants = champsManquants('ftp', { hote: 'ftp.exemple.com', utilisateur: 'deploy', dossierDistant: '/www' });
  assert.deepEqual(manquants, ['mot de passe']);
});

test('un projet FTP complet ne refuse rien', () => {
  const refus = refusCibleMiseEnProduction({
    type: 'ftp',
    ftp: { hote: 'ftp.exemple.com', utilisateur: 'deploy', motDePasse: 'secret', dossierDistant: '/www' },
  });
  assert.equal(refus, null);
});

/* ------------------------------------------------------------------ */
/* Les mentions et raisons affichées                                   */
/* ------------------------------------------------------------------ */

test('la mention dit le projet local pour « aucune »', () => {
  assert.match(mentionCibleMiseEnProduction({ type: 'aucune' }), /local/);
});

test('la mention nomme les champs manquants pour un SSH incomplet', () => {
  assert.match(mentionCibleMiseEnProduction({ type: 'ssh', ssh: {} }), /incomplète/);
});

test('la mention dit l’hôte et le dossier pour un SSH complet', () => {
  const mention = mentionCibleMiseEnProduction({
    type: 'ssh',
    ssh: { hote: 'serveur.exemple.com', utilisateur: 'deploy', motDePasse: 'secret', dossierDistant: '/var/www/site' },
  });
  assert.match(mention, /serveur\.exemple\.com/);
  assert.match(mention, /var\/www\/site/);
});

test('la raison d’annonce nomme le protocole et le serveur', () => {
  const raison = raisonCibleMiseEnProduction({ type: 'ssh', ssh: { hote: 'serveur.exemple.com', dossierDistant: '/var/www/site' } });
  assert.match(raison, /SSH/);
  assert.match(raison, /serveur\.exemple\.com/);
});

test('la raison d’annonce pour « aucune » dit qu’il n’y a rien à transférer', () => {
  assert.match(raisonCibleMiseEnProduction({ type: 'aucune' }), /local/);
});
