import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Base isolée AVANT le premier import de la base : les autres tests de la
 * base de données font pareil (voir limites-connues.test.ts), pour qu'un
 * `npm test` lancé en parallèle ne se marche jamais dessus.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-a-jour-moteurs-'));
process.env.BELUGA_DATA = bacASable;

const { passageDeMiseAJourDesMoteurs } = await import('../mise-a-jour-moteurs.js');
const { setMeta } = await import('../db.js');

/** Oublie la dernière tentative d'un outil, pour qu'un test ne dépende jamais de l'ordre des autres. */
function oublierLaDerniereTentative(id: 'claude' | 'codex' | 'cursor'): void {
  setMeta(`moteurs:derniere-tentative-maj:${id}`, '0');
}

/**
 * UN EXÉCUTABLE FACTICE, sans réseau ni vrai CLI : il répond à `update` en
 * faisant passer sa « version » de 1.0.0 à 2.0.0 dans un fichier à lui, et
 * note chaque appel dans un journal — pour que le test lise ce qui a
 * vraiment été lancé, sans dépendre d'aucun outil réel installé.
 */
function fabriquerMoteurFactice(id: 'claude' | 'codex' | 'cursor', label: string) {
  const dossier = fs.mkdtempSync(path.join(bacASable, `${id}-`));
  const script = path.join(dossier, 'outil.sh');
  const journal = path.join(dossier, 'journal.txt');
  const versionFichier = path.join(dossier, 'version.txt');
  fs.writeFileSync(versionFichier, '1.0.0');
  fs.writeFileSync(
    script,
    `#!/bin/sh\nif [ "$1" = "update" ]; then\n  echo "update" >> "${journal}"\n  echo "2.0.0" > "${versionFichier}"\n  exit 0\nfi\nexit 1\n`,
  );
  fs.chmodSync(script, 0o755);
  return {
    id,
    label,
    binary: script,
    journal,
    detect: async () => ({ installed: true, version: fs.readFileSync(versionFichier, 'utf8').trim() }),
  };
}

test('un passage met à jour chacun des trois outils dus, et le journal le montre', async () => {
  const claude = fabriquerMoteurFactice('claude', 'Faux Claude');
  const codex = fabriquerMoteurFactice('codex', 'Faux Codex');
  const cursor = fabriquerMoteurFactice('cursor', 'Faux Cursor');

  const bilan = await passageDeMiseAJourDesMoteurs(Date.now(), [claude, codex, cursor]);

  assert.deepEqual(bilan.traites.sort(), ['claude', 'codex', 'cursor']);
  assert.deepEqual(bilan.sautes, []);
  for (const moteur of [claude, codex, cursor]) {
    assert.equal(fs.readFileSync(moteur.journal, 'utf8').trim(), 'update', `${moteur.label} n'a pas reçu sa commande « update »`);
    assert.equal((await moteur.detect()).version, '2.0.0', `${moteur.label} n'a pas changé de version`);
  }
});

test('un outil déjà tenté aujourd’hui ne repart pas une seconde fois', async () => {
  oublierLaDerniereTentative('claude');
  const claude = fabriquerMoteurFactice('claude', 'Faux Claude 2');
  const maintenant = Date.now();

  const premier = await passageDeMiseAJourDesMoteurs(maintenant, [claude]);
  assert.deepEqual(premier.traites, ['claude']);

  fs.writeFileSync(claude.journal, ''); // on vide le journal pour voir si un second appel arrive
  const second = await passageDeMiseAJourDesMoteurs(maintenant + 60_000, [claude]);
  assert.deepEqual(second.traites, []);
  assert.equal(fs.readFileSync(claude.journal, 'utf8').trim(), '', 'aucun second appel avant le lendemain');
});

test('un outil dont la commande échoue est journalisé, sans faire tomber le passage', async () => {
  oublierLaDerniereTentative('codex');
  const dossier = fs.mkdtempSync(path.join(bacASable, 'en-panne-'));
  const script = path.join(dossier, 'outil.sh');
  fs.writeFileSync(script, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(script, 0o755);
  const enPanne = { id: 'codex' as const, label: 'Codex en panne', binary: script, detect: async () => ({ installed: true, version: '1.0.0' }) };

  const bilan = await passageDeMiseAJourDesMoteurs(Date.now(), [enPanne]);
  assert.deepEqual(bilan.traites, ['codex']);
});
