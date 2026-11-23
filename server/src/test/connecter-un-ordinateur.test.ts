/**
 * CONNECTER CET ORDINATEUR : le système de l'appareil, la remorque des paquets Windows / Linux, la reconnaissance de
 * l'ordinateur sur lequel on est (carte « Beluga Connect : installation simplifiée »).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { autorisationsDonnees, lireLaRemorque, octetsDeRemorque, ordinateurReconnu, systemeDeLAppareil, type Ordinateur } from '@beluga/shared';

test('le système de l’appareil se lit sur le navigateur', () => {
  assert.equal(systemeDeLAppareil({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131', platform: 'MacIntel' }), 'mac');
  assert.equal(systemeDeLAppareil({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131', platform: 'Win32' }), 'windows');
  assert.equal(systemeDeLAppareil({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131', platform: 'Linux x86_64' }), 'linux');
  assert.equal(systemeDeLAppareil({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/131', platform: 'Linux armv8l' }), null);
  assert.equal(systemeDeLAppareil({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone' }), null);
  assert.equal(systemeDeLAppareil({ userAgent: '', plateformeUA: 'Windows' }), 'windows');
});

test('la remorque se relit telle qu’écrite, après n’importe quel exécutable', () => {
  const exe = new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4, 5]);
  const r = octetsDeRemorque({ base: 'https://beluga.exemple.fr/', code: '012345' });
  const fichier = new Uint8Array(exe.length + r.length);
  fichier.set(exe);
  fichier.set(r, exe.length);
  assert.deepEqual(lireLaRemorque(fichier), { base: 'https://beluga.exemple.fr', code: '012345' });
  assert.equal(lireLaRemorque(exe), null, 'un fichier sans remorque ne se lit pas comme tel');
  assert.throws(() => octetsDeRemorque({ base: 'javascript:alert(1)', code: '012345' }));
  assert.throws(() => octetsDeRemorque({ base: 'https://x.fr', code: '12' }));
});

const ordinateur = (id: string, p: Partial<Ordinateur> = {}): Ordinateur => ({ id, nom: id, repere: id, creeLe: 0, navigateurs: [], programme: null, ...p });

test('l’ordinateur courant se reconnaît par son navigateur, puis par la liaison faite après le code', () => {
  const a = ordinateur('a', { navigateurs: [{ id: 'chrome-a', genre: 'chrome', enLigne: true, version: '1.0.14', vuLe: 1, agentsAuTravail: 0, creeLe: 10 }] });
  const b = ordinateur('b', { programme: { id: 'p', etat: 'pret', vuLe: 1, autorisations: null, relieLe: 50_000, systeme: 'windows' } });
  assert.equal(ordinateurReconnu([a, b], { navigateurId: 'chrome-a' })?.id, 'a');
  assert.equal(ordinateurReconnu([a, b], { codeEmisLe: 52_000 })?.id, 'b', '5 s de marge d’horloge');
  assert.equal(ordinateurReconnu([a, b], { codeEmisLe: 90_000 }), null, 'une liaison d’avant le code n’est pas celle-ci');
  assert.equal(ordinateurReconnu([a, b], {}), null);
});

test('Windows et Linux n’ont aucune autorisation à donner', () => {
  assert.equal(autorisationsDonnees({ autorisations: null, systeme: 'windows' }), true);
  assert.equal(autorisationsDonnees({ autorisations: null, systeme: 'linux' }), true);
  assert.equal(autorisationsDonnees({ autorisations: null }), false);
  assert.equal(autorisationsDonnees({ autorisations: { accessibilite: true, ecran: true }, systeme: 'mac' }), true);
});

test('« Relier ce Mac ? » : l’adresse ouverte par Beluga Connect porte un jeton lisible par la page, et rien d’autre', async () => {
  const shared = await import('@beluga/shared');
  const jeton = 'abcdefghijklmnopqrstuvwxyz012345';
  /* L'adresse que Beluga Connect (Swift et Go) écrit lui-même. */
  const adresse = `https://beluga.exemple.fr/?${shared.PARAMETRE_DE_LIAISON}=${jeton}`;
  assert.equal(shared.jetonDeLiaisonDansLAdresse(new URL(adresse).search), jeton);
  assert.equal(shared.jetonDeLiaisonDansLAdresse('?liaison=court'), null);
  assert.equal(shared.jetonDeLiaisonDansLAdresse('?liaison=%3Cscript%3Eabcdefghijklmnop'), null);
  assert.equal(shared.jetonDeLiaisonDansLAdresse(''), null);
});
