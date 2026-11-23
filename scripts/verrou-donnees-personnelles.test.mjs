/**
 * LE VERROU DES DONNÉES PERSONNELLES DU DÉPÔT PUBLIC (logiciel libre, 23/11/2026).
 *
 * Le dépôt public est rouvert à tous : une base, une mémoire, un coffre, un fil de moteur, ou l'adresse / le dépôt d'un
 * projet de l'auteur dans un fichier publié REFUSE l'envoi. On le prouve sur un dépôt jetable : un arbre propre passe,
 * le même arbre avec UNE fuite est refusé, fuite nommée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const miroir = await import(path.join(RACINE, 'scripts/synchroniser-miroir-public.mjs'));
const { cheminPersonnel, nomsPrecisAVerrouiller, restesPersonnels, construireLArbreAttendu, NOMS_PUBLICS } = miroir;

test('les formes de chemins personnels sont reconnues, le code ordinaire passe', () => {
  for (const chemin of [
    'server/beluga.sqlite',
    'web/src/donnees.db-wal',
    'server/MEMORY.md',
    'shared/memory/notes.md',
    'web/MEMOIRE.avant.md',
    'server/coffre-export.json',
    'server/credentials.yml',
    'web/.env.production',
    'server/fil.jsonl',
    'server/.claude-accounts/a/x.json',
  ]) {
    assert.ok(cheminPersonnel(chemin), `${chemin} devrait être refusé`);
  }
  for (const chemin of ['server/src/memoire.ts', 'web/src/components/coffre-fort.tsx', 'shared/src/secrets.ts', 'README.md', 'LICENSE']) {
    assert.equal(cheminPersonnel(chemin), null, `${chemin} est du code ordinaire`);
  }
});

test('seuls les noms PRÉCIS sont verrouillés, les noms publics sont admis', () => {
  const noms = nomsPrecisAVerrouiller(['Projet', 'client.example.ch', 'auteur/depot-prive', 'belugabuild.com', 'haikostudio/beluga', 'a.b'], []);
  assert.deepEqual(noms.sort(), ['auteur/depot-prive', 'client.example.ch']);
  for (const publique of NOMS_PUBLICS) assert.ok(!noms.includes(publique));
});

test('un nom de projet est cherché en mot entier', () => {
  const noms = ['client.example.ch', 'auteur/depot'];
  assert.equal(restesPersonnels('voir https://client.example.ch/page', 'a.ts', noms).length, 1);
  assert.equal(restesPersonnels('git@github.com:auteur/depot.git', 'a.ts', noms).length, 1);
  assert.equal(restesPersonnels('sous-client.example.chose et auteur/depot-public', 'a.ts', noms).length, 0);
  const [reste] = restesPersonnels('a\nb client.example.ch', 'x.ts', noms);
  assert.equal(reste.ligne, 2);
});

test('l’arbre attendu est REFUSÉ au moindre reste personnel, accepté sans', async () => {
  const dossier = mkdtempSync(path.join(tmpdir(), 'verrou-public-'));
  try {
    const git = (...a) => execFileSync('git', ['-C', dossier, ...a], { encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 'essai@exemple.invalid');
    git('config', 'user.name', 'essai');
    mkdirSync(path.join(dossier, 'server'));
    writeFileSync(path.join(dossier, 'server', 'a.ts'), 'export const x = 1;\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'propre');
    const regles = { remplacements: [], refus: [], listeBlanche: [] };
    const noms = ['client.example.ch'];
    const propre = await construireLArbreAttendu(dossier, 'HEAD', regles, [], new Map(), noms);
    assert.equal(propre.restes.filter((r) => /personnel|projet/.test(r.motif)).length, 0, JSON.stringify(propre.restes));

    writeFileSync(path.join(dossier, 'server', 'a.ts'), 'export const site = "https://client.example.ch";\n');
    writeFileSync(path.join(dossier, 'server', 'base.sqlite'), 'x');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'fuite');
    const fuite = await construireLArbreAttendu(dossier, 'HEAD', regles, [], new Map(), noms);
    const motifs = fuite.restes.map((r) => `${r.chemin} ${r.motif}`);
    assert.ok(motifs.some((m) => m.startsWith('server/a.ts') && /projet/.test(m)), motifs.join(' | '));
    assert.ok(motifs.some((m) => m.startsWith('server/base.sqlite') && /base de données/.test(m)), motifs.join(' | '));

    // Une compétence publiée qui nomme un projet est refusée elle aussi.
    const ajout = new Map([['competences/x/SKILL.md', 'Vu sur client.example.ch']]);
    const parCompetence = await construireLArbreAttendu(dossier, 'HEAD~1', regles, [], ajout, noms);
    assert.ok(parCompetence.restes.some((r) => r.chemin === 'competences/x/SKILL.md'));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
