import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * LA SONDE DE BLOCAGE relève, dans un fichier, la pile d'appels d'un fil
 * principal figé — la seule façon de savoir QUI fige le démon.
 *
 * La base d'essai est posée AVANT le premier import du démon (MEM-2544).
 */
const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'sonde-blocage-'));
process.env.BELUGA_DATA = bac;

const { demarrerLaSondeDeBlocage, phraseDeBlocage, SEUIL_DU_RELEVE_MS } = await import('../sonde-de-blocage.js');

function bloquerLeFilPrincipalPendant(ms: number): void {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    /* occupé : c'est exactement ce que fait un appel synchrone trop long */
  }
}

test('un blocage se dit en une phrase, avec la durée, la mémoire et la charge', () => {
  const phrase = phraseDeBlocage(8424, { rssMo: 680, charge: 6.4, coeurs: 4 });
  assert.match(phrase, /8\.4 s/);
  assert.match(phrase, /680 Mo/);
  assert.match(phrase, /6\.4 sur 4 cœurs/);
  assert.match(phrase, /blocages\.log/);
});

test('un blocage dit aussi le tas et la part du démon rangée dans l’échange', () => {
  const phrase = phraseDeBlocage(1600, { rssMo: 940, charge: 5.8, coeurs: 4, tasMo: 610, echangeMo: 676 });
  assert.match(phrase, /mémoire 940 Mo, tas 610 Mo, dans l'échange 676 Mo, charge machine/);
});

test('un fil principal figé : le gardien consigne la pile d’appels de ce qui le fige', async () => {
  const fichier = path.join(bac, 'blocages.log');
  const arreter = demarrerLaSondeDeBlocage({ fichier, seuilDuReleveMs: 600 });
  // Le temps que le gardien démarre et que le premier battement passe.
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(SEUIL_DU_RELEVE_MS >= 1000, 'le seuil de production reste au-dessus du bruit ordinaire');
  bloquerLeFilPrincipalPendant(2500);
  await new Promise((r) => setTimeout(r, 800));
  arreter();
  const lignes = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8').trim().split('\n').filter(Boolean) : [];
  assert.ok(lignes.length >= 1, 'un relevé est consigné');
  const releve = JSON.parse(lignes[0]!) as { silenceMs: number; pile?: string[]; erreur?: string };
  assert.ok(!releve.erreur, `relevé sans erreur : ${releve.erreur ?? ''}`);
  assert.ok(releve.silenceMs >= 600, 'la durée du silence est consignée');
  assert.ok(
    (releve.pile ?? []).some((image) => image.includes('bloquerLeFilPrincipalPendant')),
    `la pile nomme la fonction qui fige : ${JSON.stringify(releve.pile)}`,
  );
});

test('une sonde coupée par l’environnement ne fait rien', () => {
  process.env.BELUGA_SONDE_BLOCAGE = '0';
  try {
    const arreter = demarrerLaSondeDeBlocage({ fichier: path.join(bac, 'jamais.log') });
    arreter();
    assert.equal(fs.existsSync(path.join(bac, 'jamais.log')), false);
  } finally {
    delete process.env.BELUGA_SONDE_BLOCAGE;
  }
});
