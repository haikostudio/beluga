/**
 * L'OFFRE HÉBERGÉE SE DÉCLARE PAR L'ENVIRONNEMENT DU DÉMON, ET RIEN D'AUTRE.
 * Absente : la machine est sur son propre serveur (le cas de toute installation
 * faite par son propriétaire). Relue à chaque appel, comme le super administrateur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VARIABLE_HEBERGE, VARIABLE_OFFRE, estMachineHebergee, estOffreHebergee } from '@beluga/shared';
import { machineHebergee } from '../offre-hebergee.js';

test('rien de déclaré : la machine est sur son propre serveur', () => {
  assert.equal(estOffreHebergee(undefined), false);
  assert.equal(estOffreHebergee(''), false);
  assert.equal(estOffreHebergee('   '), false);
  assert.equal(estOffreHebergee('serveur-propre'), false);
});

test('« hébergée » se reconnaît sans souci de casse ni d’accent', () => {
  for (const valeur of ['hebergee', 'Hébergée', ' HOSTED ', 'heberge']) {
    assert.equal(estOffreHebergee(valeur), true, valeur);
  }
});

test('la déclaration se lit dans l’environnement du démon, à chaque appel', () => {
  const avant = process.env[VARIABLE_OFFRE];
  const avantHeberge = process.env[VARIABLE_HEBERGE];
  try {
    delete process.env[VARIABLE_OFFRE];
    delete process.env[VARIABLE_HEBERGE];
    assert.equal(machineHebergee(), false);
    process.env[VARIABLE_OFFRE] = 'hebergee';
    assert.equal(machineHebergee(), true);
    process.env[VARIABLE_OFFRE] = 'autre';
    assert.equal(machineHebergee(), false);
    process.env[VARIABLE_HEBERGE] = '1';
    assert.equal(machineHebergee(), true, 'la marque de l’agent d’hôte suffit');
  } finally {
    if (avant === undefined) delete process.env[VARIABLE_OFFRE];
    else process.env[VARIABLE_OFFRE] = avant;
    if (avantHeberge === undefined) delete process.env[VARIABLE_HEBERGE];
    else process.env[VARIABLE_HEBERGE] = avantHeberge;
  }
});

/**
 * CONTRAT AVEC L'AGENT D'HÔTE DU CENTRAL (dépôt belugabuild, `central/src/hote/agent.py`,
 * `installer_version`) : il écrit la ligne `BELUGA_HEBERGE=1` dans `/etc/beluga.env`,
 * que systemd charge tel quel dans l'environnement du démon. On rejoue cette ligne.
 */
test('la ligne écrite par l’agent d’hôte du central déclare Beluga Cloud', () => {
  const ligneDeLAgent = 'BELUGA_HEBERGE=1';
  const [nom, valeur] = ligneDeLAgent.split('=');
  assert.equal(nom, VARIABLE_HEBERGE);
  assert.equal(estMachineHebergee({ [nom]: valeur }), true);
});

test('les deux noms sont acceptés, l’un sans l’autre', () => {
  assert.equal(estMachineHebergee({}), false);
  assert.equal(estMachineHebergee({ BELUGA_OFFRE: 'hebergee' }), true);
  assert.equal(estMachineHebergee({ BELUGA_OFFRE: 'Hébergée' }), true);
  for (const oui of ['1', 'true', 'TRUE', ' oui ', 'yes']) {
    assert.equal(estMachineHebergee({ BELUGA_HEBERGE: oui }), true, oui);
  }
  for (const non of ['', '  ', '0', 'false', 'non', undefined]) {
    assert.equal(estMachineHebergee({ BELUGA_HEBERGE: non }), false, String(non));
  }
  assert.equal(estMachineHebergee({ BELUGA_OFFRE: 'serveur-propre', BELUGA_HEBERGE: '0' }), false);
});
