/**
 * LES COMPTES : UN RÔLE, UNE PORTÉE.
 *
 * Ce que ces essais verrouillent : la forme d'un identifiant, la force d'un mot
 * de passe, la portée d'un compte — un administrateur voit tout, un client ne
 * voit que ce qu'on lui a coché, et un client SANS portée ne voit rien —, le
 * nettoyage d'une portée qui nomme un projet disparu, et le nom montré d'un
 * compte qui n'en a pas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTIFIANT_MAX,
  MOT_DE_PASSE_MIN,
  courrielNettoye,
  decouperPourLaLecture,
  jugerCourriel,
  jugerIdentifiant,
  jugerMotDePasse,
  nomDuCompte,
  normaliserIdentifiant,
  peutVoirProjet,
  porteeNettoyee,
} from '@beluga/shared';

test('un identifiant est rangé en minuscules, sans espaces autour', () => {
  assert.equal(normaliserIdentifiant('  Marc.Dupont '), 'marc.dupont');
});

test('les accents sont ÔTÉS plutôt que refusés — « Cyprès » devient « cypres »', () => {
  assert.equal(normaliserIdentifiant('Cyprès'), 'cypres');
  assert.equal(jugerIdentifiant('Cyprès').ok, true);
});

test('un identifiant trop court, trop long ou mal formé est refusé en le disant', () => {
  assert.equal(jugerIdentifiant('ab').ok, false);
  assert.equal(jugerIdentifiant('a'.repeat(IDENTIFIANT_MAX + 1)).ok, false);
  assert.equal(jugerIdentifiant('marc dupont').ok, false);
  assert.equal(jugerIdentifiant('marc@exemple.fr').ok, false);
  assert.equal(jugerIdentifiant('-marc').ok, false);
  assert.match(jugerIdentifiant('marc dupont').raison ?? '', /lettres/);
});

test('un identifiant simple passe, majuscules comprises', () => {
  assert.equal(jugerIdentifiant('Marc_Dupont-2').ok, true);
});

test('la LONGUEUR fait la force du mot de passe, pas la ponctuation', () => {
  assert.equal(jugerMotDePasse('a'.repeat(MOT_DE_PASSE_MIN - 1)).ok, false);
  assert.equal(jugerMotDePasse('a'.repeat(MOT_DE_PASSE_MIN)).ok, true);
  assert.equal(jugerMotDePasse(` ${'a'.repeat(MOT_DE_PASSE_MIN)}`).ok, false);
});

test('un administrateur voit tous les projets, un client seulement les siens', () => {
  const admin = { role: 'admin' as const, projets: [] };
  const client = { role: 'client' as const, projets: ['p1'] };
  assert.equal(peutVoirProjet(admin, 'p9'), true);
  assert.equal(peutVoirProjet(client, 'p1'), true);
  assert.equal(peutVoirProjet(client, 'p2'), false);
});

test('un client SANS portée ne voit rien : c’est le bon défaut', () => {
  assert.equal(peutVoirProjet({ role: 'client', projets: [] }, 'p1'), false);
});

test('une portée ne garde que des projets connus, sans doublon', () => {
  assert.deepEqual(porteeNettoyee('client', ['p1', 'p1', 'parti'], ['p1', 'p2']), ['p1']);
});

test('un administrateur ne porte aucune portée, même si on lui en donne une', () => {
  assert.deepEqual(porteeNettoyee('admin', ['p1'], ['p1']), []);
});

test('un compte sans nom affiché se présente par son identifiant', () => {
  assert.equal(nomDuCompte({ identifiant: 'marc', nomAffiche: '  ' }), 'marc');
  assert.equal(nomDuCompte({ identifiant: 'marc', nomAffiche: 'Marc Dupont' }), 'Marc Dupont');
});

test('un mot de passe tiré au hasard se coupe pour se recopier', () => {
  assert.equal(decouperPourLaLecture('abcdefghij', 5), 'abcde-fghij');
});

test('une adresse de courriel est jugée sans zèle, et l’absence est un choix', () => {
  assert.equal(jugerCourriel('').ok, true);
  assert.equal(jugerCourriel('  ').ok, true);
  assert.equal(jugerCourriel('marco@exemple.fr').ok, true);
  assert.equal(jugerCourriel('marco+devis@sous.exemple.co.uk').ok, true);
  assert.equal(jugerCourriel('marco').ok, false);
  assert.equal(jugerCourriel('marco@exemple').ok, false);
  assert.equal(jugerCourriel('a b@exemple.fr').ok, false);
});

test('l’adresse est rangée en minuscules, et une adresse vide vaut « aucune »', () => {
  assert.equal(courrielNettoye('  Marco@Exemple.FR '), 'marco@exemple.fr');
  assert.equal(courrielNettoye('   '), undefined);
  assert.equal(courrielNettoye(undefined), undefined);
});
