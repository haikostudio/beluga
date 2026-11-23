/**
 * LE SEMIS DES COMPÉTENCES PUBLIÉES : ajouter ce qui manque, suivre ce qui n'a
 * pas bougé, ne jamais écraser ce que l'installation a modifié ou retiré.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { semerLesCompetencesPubliees } from '../semis-competences.js';

function poser(racine: string, nom: string, texte: string) {
  fs.mkdirSync(path.join(racine, nom), { recursive: true });
  fs.writeFileSync(path.join(racine, nom, 'SKILL.md'), texte);
}

test('semer, suivre, garder ce qui a été modifié ou retiré', () => {
  const atelier = fs.mkdtempSync(path.join(os.tmpdir(), 'semis-'));
  const source = path.join(atelier, 'competences');
  const pool = path.join(atelier, 'pool');
  try {
    poser(source, 'bouton', 'v1');
    poser(source, 'tableau', 'v1');
    poser(source, 'carte', 'v1');
    poser(pool, 'carte', 'la mienne'); // une fiche d'ici, du même nom
    assert.deepEqual(semerLesCompetencesPubliees(pool, source).ajoutees, ['bouton', 'tableau']);
    assert.equal(fs.readFileSync(path.join(pool, 'carte', 'SKILL.md'), 'utf8'), 'la mienne');

    // Nouvelle version publiée : la fiche intacte suit, la fiche modifiée ici reste.
    poser(source, 'bouton', 'v2');
    poser(source, 'tableau', 'v2');
    fs.writeFileSync(path.join(pool, 'tableau', 'SKILL.md'), 'retouchée ici');
    const deuxieme = semerLesCompetencesPubliees(pool, source);
    assert.deepEqual(deuxieme.misesAJour, ['bouton']);
    assert.deepEqual(deuxieme.gardees, ['tableau']);
    assert.equal(fs.readFileSync(path.join(pool, 'bouton', 'SKILL.md'), 'utf8'), 'v2');

    // Retirée à la main : elle ne revient pas.
    fs.rmSync(path.join(pool, 'bouton'), { recursive: true });
    assert.deepEqual(semerLesCompetencesPubliees(pool, source).ajoutees, []);
    assert.equal(fs.existsSync(path.join(pool, 'bouton')), false);
  } finally {
    fs.rmSync(atelier, { recursive: true, force: true });
  }
});

test('sans dossier publié (installation d’origine), rien ne bouge', () => {
  const pool = fs.mkdtempSync(path.join(os.tmpdir(), 'semis-vide-'));
  try {
    const bilan = semerLesCompetencesPubliees(pool, path.join(pool, 'nulle-part'));
    assert.deepEqual(bilan, { ajoutees: [], misesAJour: [], gardees: [] });
    assert.deepEqual(fs.readdirSync(pool), []);
  } finally {
    fs.rmSync(pool, { recursive: true, force: true });
  }
});
