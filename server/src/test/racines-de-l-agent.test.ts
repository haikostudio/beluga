import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UN PDF PRODUIT SUR LE DISQUE DE STOCKAGE SE JOINT.
 *
 * `attach_file` refusait « Fichier introuvable » un fichier bien réel posé sur
 * le disque des pièces jointes : ses racines s'arrêtaient au dossier de travail,
 * au projet et aux données. Le disque (factice ici) en fait désormais partie,
 * et un refus distingue « absent » de « hors des dossiers permis ».
 */

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'racines-agent-'));
const disque = path.join(bac, 'disque');
fs.mkdirSync(disque, { recursive: true });
fs.writeFileSync(path.join(disque, '.beluga-pieces-jointes'), '');
process.env.BELUGA_DATA = path.join(bac, 'data');
process.env.BELUGA_PIECES_JOINTES = disque;
process.env.BELUGA_PIECES_JOINTES_EN_ESSAI = '1';

const { fichierPermis, racinesDeLAgent, refusDeChemin } = await import('../joindre-fichier.js');

const projet = { path: fs.mkdtempSync(path.join(os.tmpdir(), 'racines-projet-')) };

test('un fichier du disque de stockage est accepté', () => {
  const pdf = path.join(disque, 'controle', 'rapport.pdf');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  fs.writeFileSync(pdf, '%PDF-1.4');
  const racines = racinesDeLAgent('agent-inconnu', projet);
  assert.ok(racines.includes(disque));
  assert.equal(fichierPermis(pdf, racines), pdf);
});

test('un préfixe trompeur et un fichier hors racines restent refusés', () => {
  const voisin = `${disque}2`;
  fs.mkdirSync(voisin, { recursive: true });
  fs.writeFileSync(path.join(voisin, 'x.pdf'), '%PDF');
  const racines = racinesDeLAgent('agent-inconnu', projet);
  assert.equal(fichierPermis(path.join(voisin, 'x.pdf'), racines), null);
  assert.equal(fichierPermis('../../etc/passwd', racines), null);
});

test('le refus dit « hors des dossiers permis » quand le fichier existe', () => {
  const racines = racinesDeLAgent('agent-inconnu', projet);
  assert.match(refusDeChemin(path.join(`${disque}2`, 'x.pdf'), racines), /hors des dossiers permis/);
  assert.match(refusDeChemin(path.join(disque, 'absent.pdf'), racines), /^Fichier introuvable/);
});
