/**
 * LES COMPÉTENCES QUI PARTENT AU PUBLIC : par thème, et seulement après contrôle.
 *
 * Un pool PIÉGÉ — nom de client, adresse IP, clé, chemin personnel, bibliothèque
 * tierce, thème privé — doit tout retenir, avec sa raison, et ne laisser partir
 * que la fiche d'interface propre, sans ses lignes de provenance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const { competencesAPublier, recitDesCompetences, chemInterdit, importsRelatifs } = await import(path.join(RACINE, 'scripts/synchroniser-miroir-public.mjs'));
const { reglesDeFiltre } = await import(path.join(RACINE, 'shared/dist/filtre-contenu.js'));
const { jugerCompetence, texteAPublier } = await import(path.join(RACINE, 'shared/dist/publication-competences.js'));

const fiche = (nom, tete, corps = 'Un mode d’emploi générique.') =>
  `---\nname: ${nom}\ndescription: À utiliser dès que…\n${tete}\n---\n\n# ${nom}\n\n## Vérification\n\n${corps}\n`;

function poolPiege() {
  const pool = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-piege-'));
  const poser = (nom, texte, annexes = {}) => {
    fs.mkdirSync(path.join(pool, nom, 'references'), { recursive: true });
    fs.writeFileSync(path.join(pool, nom, 'SKILL.md'), texte);
    for (const [relatif, contenu] of Object.entries(annexes)) fs.writeFileSync(path.join(pool, nom, relatif), contenu);
  };
  poser('bouton-propre', fiche('bouton-propre', 'etat: active\nthemes: interface, composants\nprovenance-projet: Beluga\nprovenance-carte: 1234'), {
    'references/exemple.md': 'Voir https://example.com et 192.0.2.4.',
  });
  // Les fiches du fonctionnement de Beluga et les sujets sensibles PARTENT (23/11/2026).
  poser('beluga-interne', fiche('beluga-interne', 'themes: cartes, publication\nprojets: Beluga'));
  poser('securite-ui', fiche('securite-ui', 'themes: interface, securite'));
  // Une fiche propre à un projet client : son nom devient un nom PRIVÉ pour tout le pool.
  poser('client-ecran', fiche('client-ecran', 'projets: Clientissime\nthemes: interface'));
  poser('nee-chez-un-client', fiche('nee-chez-un-client', 'themes: interface\nprovenance-projet: Clientissime'));
  poser('nomme-un-client', fiche('nomme-un-client', 'themes: interface', 'Comme sur Clientissime, le tiroir…'));
  poser('porte-une-ip', fiche('porte-une-ip', 'themes: design', 'Le serveur 91.98.12.34 répond.'));
  poser('porte-une-cle', fiche('porte-une-cle', 'themes: interface', 'export OPENAI=sk-abcdefghijklmnopqrstuv1234'));
  poser('chemin-perso', fiche('chemin-perso', 'themes: interface', 'Lancer /root/projet/outil.sh'));
  poser('annexe-piegee', fiche('annexe-piegee', 'themes: interface'), { 'references/notes.md': 'mot de passe : Tr0ub4dor&3xyz' });
  poser('importee', fiche('importee', 'themes: interface\nprovenance-bibliotheque: autrui'));
  poser('cerveau', fiche('cerveau', 'themes: design'), { 'brain.manifest.json': '{}' });
  poser('archivee', fiche('archivee', 'etat: archivee\nthemes: interface'));
  return pool;
}

test('toute fiche générique part ; Philippe, les projets et les licences inconnues restent', async () => {
  const pool = poolPiege();
  try {
    const bilan = await competencesAPublier(pool, reglesDeFiltre({}), {});
    assert.deepEqual(bilan.publiees.map((p) => p.nom), ['beluga-interne', 'bouton-propre', 'securite-ui']);
    const raisons = Object.fromEntries(bilan.retenues.map((r) => [r.nom, r.raison]));
    assert.match(raisons['client-ecran'], /propre à un projet/);
    assert.match(raisons['nee-chez-un-client'], /née d’un projet/);
    assert.match(raisons['nomme-un-client'], /nomme un projet ou un client/);
    assert.match(raisons['porte-une-ip'], /adresse IP/);
    assert.match(raisons['porte-une-cle'], /clé d’API/);
    assert.match(raisons['chemin-perso'], /chemin personnel/);
    assert.match(raisons['annexe-piegee'], /references\/notes\.md porte un mot de passe écrit/);
    assert.match(raisons.importee, /bibliothèque tierce \(autrui\) : licence non relevée/);
    assert.match(raisons.cerveau, /Philippe Pitton/);
    assert.match(raisons.archivee, /état « archivee »/);
    assert.doesNotMatch(JSON.stringify(bilan.retenues), /91\.98\.12\.34|sk-abcdefghijklmnop|Tr0ub4dor/);

    const publie = bilan.fichiers.get('competences/bouton-propre/SKILL.md');
    assert.ok(publie);
    assert.doesNotMatch(publie, /provenance-/);
    assert.ok(bilan.fichiers.has('competences/bouton-propre/references/exemple.md'));
    assert.match(recitDesCompetences(bilan), /3 publiée\(s\), 10 retenue\(s\)/);
  } finally {
    fs.rmSync(pool, { recursive: true, force: true });
  }
});

test('licences : libre et relevée part, non libre reste, Digital Tales jamais', () => {
  const t = (b) => fiche('x', `provenance-bibliotheque: ${b}`);
  const licences = { libre: { licence: 'MIT' }, fermee: { licence: 'NOASSERTION' }, 'digital-tales-ui': { licence: 'MIT' } };
  assert.equal(jugerCompetence({ nom: 'x', texte: t('libre') }, [], { licences }).publiee, true);
  assert.match(jugerCompetence({ nom: 'x', texte: t('fermee') }, [], { licences }).raison, /NOASSERTION, lien seulement/);
  assert.match(jugerCompetence({ nom: 'x', texte: t('digital-tales-ui') }, [], { licences }).raison, /Philippe Pitton/);
  assert.match(
    jugerCompetence({ nom: 'x', texte: fiche('x', ''), annexes: { LICENSE: 'Copyright Philippe Pitton' } }, []).raison,
    /Philippe Pitton/,
  );
});

test('contrôles, mesures et tests : sous condition ; scripts de la machine : jamais', () => {
  assert.equal(chemInterdit('scripts/verif-themes.mjs'), null);
  assert.equal(chemInterdit('scripts/mesure-jetons.mjs'), null);
  assert.equal(chemInterdit('scripts/cas-competences-par-le-sens.json'), null);
  assert.equal(chemInterdit('server/src/test/cartes.test.ts'), null);
  assert.equal(chemInterdit('scripts/verif-coffre-des-comptes.mjs'), 'hors de la liste publiée');
  assert.equal(chemInterdit('scripts/claude-haiko.sh'), 'hors de la liste publiée');
  assert.equal(chemInterdit('scripts/licences-des-bibliotheques.json'), 'hors de la liste publiée');
  assert.deepEqual(importsRelatifs("import { a } from './lib/x.mjs';\nawait import('../shared/y.js');", 'scripts/verif-a.mjs'), [
    'scripts/lib/x.mjs',
    'shared/y.js',
  ]);
});

test('une fiche que le filtre de contenu aurait réécrite reste privée', async () => {
  const pool = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-filtre-'));
  try {
    fs.mkdirSync(path.join(pool, 'compte-maison'));
    fs.writeFileSync(path.join(pool, 'compte-maison', 'SKILL.md'), fiche('compte-maison', '', 'Le compte compte-secret-maison ouvre tout.'));
    const regles = reglesDeFiltre({ remplacements: [{ valeur: 'compte-secret-maison', neutre: 'compte' }] });
    const bilan = await competencesAPublier(pool, regles, {});
    assert.equal(bilan.publiees.length, 0);
    assert.match(bilan.retenues[0].raison, /filtre de contenu/);
  } finally {
    fs.rmSync(pool, { recursive: true, force: true });
  }
});

test('le verdict seul : un nom privé passé par l’appelant retient la fiche, une adresse d’exemple non', () => {
  const texte = fiche('carte', 'themes: interface', 'Écrire à contact@example.com ; voir aussi app.monclient.fr.');
  assert.equal(jugerCompetence({ nom: 'carte', texte }, []).publiee, true);
  assert.equal(jugerCompetence({ nom: 'carte', texte }, ['monclient.fr']).publiee, false);
  assert.doesNotMatch(texteAPublier(`---\nname: x\nprovenance-carte: 1\n---\ncorps`), /provenance/);
});
