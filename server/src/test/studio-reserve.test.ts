/**
 * LE SUPER ADMINISTRATEUR EST DÉSIGNÉ PAR LE DÉMON.
 * Liste vide : personne. Client, compte désactivé, autre administrateur : jamais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIABLE_SUPER_ADMIN,
  estSuperAdministrateur,
  identifiantsSuperAdmin,
} from '@beluga/shared';
import { compteEstSuperAdministrateur } from '../super-admin.js';

const admin: { role: 'admin' | 'client'; actif: boolean; identifiant: string } = { role: 'admin', actif: true, identifiant: 'Haiko' };

test('une liste vide ne désigne personne', () => {
  assert.deepEqual(identifiantsSuperAdmin(undefined), []);
  assert.deepEqual(identifiantsSuperAdmin('  '), []);
  assert.equal(estSuperAdministrateur(admin, []), false);
});

test('seul un administrateur actif de la liste est super administrateur', () => {
  const liste = identifiantsSuperAdmin('haiko, autre');
  assert.equal(estSuperAdministrateur(admin, liste), true);
  assert.equal(estSuperAdministrateur({ ...admin, identifiant: 'quelquun' }, liste), false);
  assert.equal(estSuperAdministrateur({ ...admin, role: 'client' }, liste), false);
  assert.equal(estSuperAdministrateur({ ...admin, actif: false }, liste), false);
  assert.equal(estSuperAdministrateur(null, liste), false);
});

test('la désignation se lit dans l\'environnement du démon, à chaque appel', () => {
  const avant = process.env[VARIABLE_SUPER_ADMIN];
  try {
    delete process.env[VARIABLE_SUPER_ADMIN];
    assert.equal(compteEstSuperAdministrateur(admin), false);
    process.env[VARIABLE_SUPER_ADMIN] = 'haiko';
    assert.equal(compteEstSuperAdministrateur(admin), true);
    assert.equal(compteEstSuperAdministrateur({ ...admin, identifiant: 'autre' }), false);
  } finally {
    if (avant === undefined) delete process.env[VARIABLE_SUPER_ADMIN];
    else process.env[VARIABLE_SUPER_ADMIN] = avant;
  }
});

