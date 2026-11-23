import test from 'node:test';
import assert from 'node:assert/strict';
import { etatDuDossierDuProjet, type SondesDuDossier } from '../scheduler.js';

/*
 * LE STOCKAGE COUPÉ N'EST JAMAIS UN « PROJET NON DÉCLARÉ ».
 *
 * Constat du 21.09.2026 : trois lancements refusés avec « ce projet n'est pas
 * déclaré sur un dépôt » alors que le montage distant du dossier était mort —
 * `stat` du dossier réussissait encore, `ls` rendait ENOTCONN. Ces sondes
 * simulées rejouent les deux sens : bind mort → injoignable (après une
 * tentative de remontage), dossier vivant sans .git → sans-depot.
 */

function sondes(partiel: Partial<SondesDuDossier> & { lisible?: SondesDuDossier['lisible'] }): SondesDuDossier & {
  remontages: number;
} {
  const s = {
    remontages: 0,
    git: async () => '',
    lisible: async () => true,
    remonter: async () => false,
    declarerSur: async () => {},
    ...partiel,
  };
  const remonter = s.remonter;
  s.remonter = async (d: string) => {
    s.remontages += 1;
    return remonter(d);
  };
  return s;
}

test('ENOTCONN au lancement de git = injoignable, même si les attributs du dossier se lisent', async () => {
  const s = sondes({ git: async () => 'spawn git ENOTCONN', lisible: async () => true });
  assert.equal(await etatDuDossierDuProjet('/p', s), 'injoignable');
  assert.equal(s.remontages, 1, 'un remontage est tenté avant de refuser');
});

test('bind mort réparé par le remontage : le dépôt est reconnu', async () => {
  let remonte = false;
  const s = sondes({
    git: async () => (remonte ? '' : 'Transport endpoint is not connected'),
    remonter: async () => {
      remonte = true;
      return true;
    },
  });
  assert.equal(await etatDuDossierDuProjet('/p', s), 'depot');
});

test('dossier vivant sans .git = sans-depot, sans remontage', async () => {
  const s = sondes({ git: async () => 'fatal: not a git repository (or any of the parent directories): .git' });
  assert.equal(await etatDuDossierDuProjet('/p', s), 'sans-depot');
  assert.equal(s.remontages, 0);
});

test('git refuse pour une autre raison mais le dossier ne se liste pas = injoignable', async () => {
  const s = sondes({ git: async () => 'fatal: not a git repository', lisible: async () => false });
  assert.equal(await etatDuDossierDuProjet('/p', s), 'injoignable');
});

test('ENOENT avec un dossier illisible déclenche le remontage', async () => {
  const s = sondes({ git: async () => 'spawn git ENOENT', lisible: async () => false });
  assert.equal(await etatDuDossierDuProjet('/p', s), 'injoignable');
  assert.equal(s.remontages, 1);
});
