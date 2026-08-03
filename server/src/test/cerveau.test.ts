import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RATTRAPAGE_MS,
  decisionEnvoi,
  doitEnvoyerMaintenant,
  faitPartir,
  fichiersACerveau,
  identifiantEnvoi,
  projetsACerveau,
  texteEnvoi,
} from '@haikodev/shared';

/*
 * La base est une VRAIE base, mais posée dans un dossier jetable : un test qui
 * journalise ses tentatives ne doit pas écrire dans celle du serveur. Le
 * dossier se pose AVANT de charger le module, qui lit sa configuration au
 * chargement.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'cerveau-base-'));
process.env.HAIKODEV_DATA = bacASable;
delete process.env.CERVEAU_API_KEY;

const { empreinte, envoyerAuCerveau, envoyerProjets, etatCerveau, recolterProjet } = await import('../cerveau.js');

/* ------------------------------------------------------------------ */
/* Les règles pures : ce qui part, et quand ça repart                   */
/* ------------------------------------------------------------------ */

const T = 1_700_000_000_000;

test("l'identifiant d'un envoi est stable par projet ET par fichier", () => {
  assert.equal(identifiantEnvoi('p1', 'MEMOIRE.md'), 'haikodev:p1:memoire.md');
  assert.notEqual(identifiantEnvoi('p1', 'CLAUDE.md'), identifiantEnvoi('p1', 'MEMOIRE.md'));
  assert.notEqual(identifiantEnvoi('p2', 'CLAUDE.md'), identifiantEnvoi('p1', 'CLAUDE.md'));
  // Deux appels le même jour ou six mois plus tard donnent la MÊME clé : c'est
  // ce qui fait remplacer au lieu d'empiler.
  assert.equal(identifiantEnvoi('p1', 'MEMOIRE.md'), identifiantEnvoi('p1', 'MEMOIRE.md'));
});

test('le texte envoyé dit de quel projet il vient', () => {
  const texte = texteEnvoi(
    { id: 'p1', nom: 'HaikoDev', chemin: '/root/haikodev', depot: 'git@github.com:x/y.git' },
    'MEMOIRE.md',
    'Un fait durable.',
    new Date(T),
  );
  assert.match(texte, /Projet HaikoDev/);
  assert.match(texte, /MEMOIRE\.md/);
  assert.match(texte, /git@github\.com:x\/y\.git/);
  assert.match(texte, /Un fait durable\./);
});

test("l'historique et les fichiers vides ne partent jamais", () => {
  const gardes = fichiersACerveau([
    { nom: 'MEMOIRE.md', contenu: 'des faits' },
    { nom: 'HISTORIQUE.md', contenu: 'des livraisons datées' },
    { nom: 'CLAUDE.md', contenu: '   ' },
    { nom: 'AGENTS.md', contenu: null },
  ]);
  assert.deepEqual(
    gardes.map((f) => f.nom),
    ['MEMOIRE.md'],
  );
});

test("un AGENTS.md identique à CLAUDE.md n'est pas envoyé deux fois, un AGENTS.md différent si", () => {
  const memes = fichiersACerveau([
    { nom: 'CLAUDE.md', contenu: 'les règles' },
    { nom: 'AGENTS.md', contenu: 'les règles' },
  ]);
  assert.deepEqual(
    memes.map((f) => f.nom),
    ['CLAUDE.md'],
  );
  const differents = fichiersACerveau([
    { nom: 'CLAUDE.md', contenu: 'les règles' },
    { nom: 'AGENTS.md', contenu: 'des règles à part' },
  ]);
  assert.equal(differents.length, 2);
});

test('un fichier ne repart que changé, ou une fois par semaine', () => {
  assert.equal(decisionEnvoi('abc', undefined, T), 'jamais-envoye');
  assert.equal(decisionEnvoi('abc', { sha: 'def', at: T - 1000 }, T), 'change');
  assert.equal(decisionEnvoi('abc', { sha: 'abc', at: T - 1000 }, T), 'inchange');
  assert.equal(decisionEnvoi('abc', { sha: 'abc', at: T - RATTRAPAGE_MS }, T), 'rattrapage');
  assert.equal(faitPartir('inchange'), false);
  assert.equal(faitPartir('rattrapage'), true);
});

test("un projet archivé ne fait plus partie de ce qu'on envoie", () => {
  const projets = [
    { id: 'a', nom: 'Vivant', chemin: '/a' },
    { id: 'b', nom: 'Rangé', chemin: '/b', archive: true },
  ];
  assert.deepEqual(
    projetsACerveau(projets).map((p) => p.id),
    ['a'],
  );
});

test('un envoi par jour, à heure creuse — rattrapé au démarrage', () => {
  // Jamais envoyé : ça part, quelle que soit l'heure d'un démarrage.
  assert.equal(doitEnvoyerMaintenant(undefined, T, 14, true), true);
  // Déjà envoyé il y a une heure : rien, même à l'heure creuse.
  assert.equal(doitEnvoyerMaintenant(T - 3600_000, T, 4, false), false);
  // Vingt-cinq heures plus tard, mais en plein après-midi : on attend la nuit.
  assert.equal(doitEnvoyerMaintenant(T - 25 * 3600_000, T, 14, false), false);
  // La même chose à l'heure creuse : ça part.
  assert.equal(doitEnvoyerMaintenant(T - 25 * 3600_000, T, 4, false), true);
  // Au démarrage, on ne fait pas attendre la nuit.
  assert.equal(doitEnvoyerMaintenant(T - 25 * 3600_000, T, 14, true), true);
});

/* ------------------------------------------------------------------ */
/* Le passage complet, sans réseau                                     */
/* ------------------------------------------------------------------ */

function projetSurDisque(nom: string, fichiers: Record<string, string>): { id: string; nom: string; chemin: string } {
  const chemin = fs.mkdtempSync(path.join(os.tmpdir(), 'cerveau-'));
  for (const [fichier, contenu] of Object.entries(fichiers)) {
    fs.writeFileSync(path.join(chemin, fichier), contenu, 'utf8');
  }
  return { id: nom.toLowerCase(), nom, chemin };
}

/** Un posteur qui note ce qu'il reçoit au lieu d'appeler le cerveau. */
function posteurDEssai(refuser: (fichier: string) => boolean = () => false) {
  const recus: { projet: string; fichier: string; identifiant: string; texte: string }[] = [];
  return {
    recus,
    poster: async (envoi: { identifiant: string; projet: string; fichier: string; texte: string }) => {
      if (refuser(envoi.fichier)) return { ok: false, error: 'refus simulé' };
      recus.push(envoi);
      return { ok: true };
    },
  };
}

test('un projet archivé ne part pas, un projet vivant part', async () => {
  const vivant = projetSurDisque('Vivant', { 'MEMOIRE.md': 'un fait' });
  const range = { ...projetSurDisque('Range', { 'MEMOIRE.md': 'un autre fait' }), archive: true };
  const essai = posteurDEssai();

  const resultat = await envoyerProjets([vivant, range], { poster: essai.poster, maintenant: T });
  assert.equal(resultat.projets, 1);
  assert.deepEqual(
    essai.recus.map((r) => r.projet),
    ['Vivant'],
  );
});

test("un fichier absent n'empêche pas les autres de partir", async () => {
  const projet = projetSurDisque('Partiel', { 'CLAUDE.md': 'les règles' });
  const essai = posteurDEssai();
  const resultat = await envoyerProjets([projet], { poster: essai.poster, maintenant: T });
  assert.equal(resultat.fichiers, 1);
  assert.equal(resultat.erreurs.length, 0);
  assert.deepEqual(
    essai.recus.map((r) => r.fichier),
    ['CLAUDE.md'],
  );
});

test('un fichier refusé laisse partir les suivants et repassera demain', async () => {
  const projet = projetSurDisque('Deux', { 'MEMOIRE.md': 'un fait', 'CLAUDE.md': 'les règles' });
  const essai = posteurDEssai((fichier) => fichier === 'MEMOIRE.md');
  const resultat = await envoyerProjets([projet], { poster: essai.poster, maintenant: T });

  assert.equal(resultat.fichiers, 1);
  assert.equal(resultat.erreurs.length, 1);
  // Le refusé n'a PAS d'empreinte retenue : il repartira au prochain passage.
  assert.equal(resultat.empreintes[identifiantEnvoi(projet.id, 'MEMOIRE.md')], undefined);
  assert.ok(resultat.empreintes[identifiantEnvoi(projet.id, 'CLAUDE.md')]);
});

test("deux passages sans changement : le second n'envoie rien", async () => {
  const projet = projetSurDisque('Stable', { 'MEMOIRE.md': 'un fait', 'CLAUDE.md': 'les règles' });
  const premier = posteurDEssai();
  const un = await envoyerProjets([projet], { poster: premier.poster, maintenant: T });
  assert.equal(un.fichiers, 2);

  const second = posteurDEssai();
  const deux = await envoyerProjets([projet], {
    poster: second.poster,
    empreintes: un.empreintes,
    maintenant: T + 24 * 3600_000,
  });
  assert.equal(deux.fichiers, 0);
  assert.equal(second.recus.length, 0);

  // Un fichier modifié repart, lui seul.
  fs.writeFileSync(path.join(projet.chemin, 'MEMOIRE.md'), 'un fait de plus', 'utf8');
  const troisieme = posteurDEssai();
  const trois = await envoyerProjets([projet], {
    poster: troisieme.poster,
    empreintes: deux.empreintes,
    maintenant: T + 48 * 3600_000,
  });
  assert.equal(trois.fichiers, 1);
  assert.deepEqual(
    troisieme.recus.map((r) => r.fichier),
    ['MEMOIRE.md'],
  );

  // Une semaine plus tard, tout repart même sans changement.
  const quatrieme = posteurDEssai();
  const quatre = await envoyerProjets([projet], {
    poster: quatrieme.poster,
    empreintes: trois.empreintes,
    maintenant: T + 48 * 3600_000 + RATTRAPAGE_MS,
  });
  assert.equal(quatre.fichiers, 2);
});

test("l'historique du projet ne quitte jamais le dossier", async () => {
  const projet = projetSurDisque('Journal', {
    'MEMOIRE.md': 'un fait',
    'HISTORIQUE.md': 'livraison du 3 août',
  });
  const essai = posteurDEssai();
  await envoyerProjets([projet], { poster: essai.poster, maintenant: T });
  assert.equal(
    essai.recus.some((r) => r.fichier === 'HISTORIQUE.md' || /livraison du 3 août/.test(r.texte)),
    false,
  );
});

test('un fichier écarté par le dépôt ne part pas', async (t) => {
  const projet = projetSurDisque('Prive', { 'MEMOIRE.md': 'un fait', 'CLAUDE.md': 'des accès privés' });
  fs.writeFileSync(path.join(projet.chemin, '.gitignore'), 'CLAUDE.md\n', 'utf8');
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('git', ['init', '-q'], { cwd: projet.chemin });
  } catch {
    return t.skip('git absent de cette machine');
  }
  const recoltes = await recolterProjet({ id: projet.id, nom: projet.nom, chemin: projet.chemin });
  assert.equal(recoltes.find((r) => r.nom === 'CLAUDE.md')?.contenu, null);
  assert.equal(recoltes.find((r) => r.nom === 'MEMOIRE.md')?.contenu, 'un fait');
});

test('sans clé, la boucle se tait proprement et le dit dans les réglages', async () => {
  const resultat = await envoyerAuCerveau({ force: true });
  assert.equal(resultat.envoye, false);
  assert.equal(resultat.raison, 'aucune clé');

  const etat = etatCerveau();
  assert.equal(etat.clePosee, false);
  assert.equal(etat.dernierSucces, undefined);
  assert.match(etat.erreurs[0]?.message ?? '', /clé/);
});

test('une même mémoire donne toujours la même empreinte', () => {
  assert.equal(empreinte('abc'), empreinte('abc'));
  assert.notEqual(empreinte('abc'), empreinte('abd'));
});
