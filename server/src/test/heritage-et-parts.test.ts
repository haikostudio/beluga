import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HERITAGE_AUCUN,
  Project,
  amontApplicable,
  cibleDHeritage,
  origineDuBloc,
  partagePourLOeil,
  partsDuContexte,
  type SentContextBlock,
} from '@haikodev/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'heritage-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { sourceDHeritageDuProjet } = await import('../projects.js');
const { appendMemory, briefingSepare, detailProjet } = await import('../memory.js');

/* ------------------------------------------------------------------ */
/* Le réglage, lu                                                      */
/* ------------------------------------------------------------------ */

test('sans réglage, la source est la plateforme — un champ vide ne coupe rien', () => {
  assert.deepEqual(cibleDHeritage(undefined), { genre: 'plateforme' });
  // Un formulaire qu'on n'a pas touché rend '' : cela ne doit surtout pas être
  // lu comme « ce projet n'hérite de rien ».
  assert.deepEqual(cibleDHeritage(''), { genre: 'plateforme' });
  assert.deepEqual(cibleDHeritage('   '), { genre: 'plateforme' });
});

test('« aucun » coupe l’héritage, un identifiant désigne un projet', () => {
  assert.deepEqual(cibleDHeritage(HERITAGE_AUCUN), { genre: 'aucun' });
  assert.deepEqual(cibleDHeritage('p-socle'), { genre: 'projet', id: 'p-socle' });
});

test('un projet ne s’hérite jamais lui-même, quel que soit le réglage', () => {
  assert.equal(amontApplicable({ projet: '/tmp/a', amont: '/tmp/a' }), false);
  // Une barre finale ne fait pas de deux fois le même dossier deux dossiers.
  assert.equal(amontApplicable({ projet: '/tmp/a', amont: '/tmp/a/' }), false);
  assert.equal(amontApplicable({ projet: '/tmp/a', amont: '/tmp/b' }), true);
});

/* ------------------------------------------------------------------ */
/* La source, résolue                                                  */
/* ------------------------------------------------------------------ */

function projetEnBase(nom: string, dossier: string, heriteDe?: string) {
  return store.saveProject(
    Project.parse({
      id: store.newId(),
      name: nom,
      path: dossier,
      heriteDe,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
}

test('la source résolue porte le NOM du projet dont on hérite, pas seulement son dossier', () => {
  const dossierSocle = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-'));
  const dossierAval = fs.mkdtempSync(path.join(os.tmpdir(), 'aval-'));
  try {
    const socle = projetEnBase('Socle Agence', dossierSocle);
    const aval = projetEnBase('Site client', dossierAval, socle.id);

    const source = sourceDHeritageDuProjet(aval);
    assert.deepEqual(source, { nom: 'Socle Agence', chemin: dossierSocle });

    // Sans réglage : la plateforme, comme avant que ce réglage existe.
    const sansReglage = projetEnBase('Sans réglage', fs.mkdtempSync(path.join(os.tmpdir(), 'nu-')));
    assert.equal(sourceDHeritageDuProjet(sansReglage)?.nom, 'HaikoDev');

    // « aucun » : rien du tout.
    const orphelin = projetEnBase(
      'Orphelin',
      fs.mkdtempSync(path.join(os.tmpdir(), 'orph-')),
      HERITAGE_AUCUN,
    );
    assert.equal(sourceDHeritageDuProjet(orphelin), undefined);
  } finally {
    fs.rmSync(dossierSocle, { recursive: true, force: true });
    fs.rmSync(dossierAval, { recursive: true, force: true });
  }
});

test('une source SUPPRIMÉE depuis son réglage ne fait pas tomber le projet en panne', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'aval-perdu-'));
  try {
    const aval = projetEnBase('Aval', dossier, 'projet-qui-n-existe-plus');
    assert.equal(sourceDHeritageDuProjet(aval), undefined);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* La règle héritée, servie et DITE                                    */
/* ------------------------------------------------------------------ */

test('un sujet sans règle locale est servi depuis la source, qui est NOMMÉE', () => {
  const socle = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-regles-'));
  const aval = fs.mkdtempSync(path.join(os.tmpdir(), 'aval-regles-'));
  try {
    fs.mkdirSync(path.join(socle, 'docs', 'regles'), { recursive: true });
    fs.writeFileSync(
      path.join(socle, 'docs', 'regles', 'publication.md'),
      '# Publication\n\n- **ON NE PUBLIE PAS SANS L’ACCORD DU CLIENT** : la mise en ligne est un geste humain.\n',
      'utf8',
    );
    fs.mkdirSync(path.join(aval, 'docs', 'regles'), { recursive: true });

    const servi = detailProjet(aval, 'publication', [], { nom: 'Socle Agence', chemin: socle });
    assert.match(servi.texte, /HÉRITÉ DE SOCLE AGENCE/);
    assert.match(servi.texte, /Socle Agence/);
    assert.match(servi.texte, /ACCORD DU CLIENT/);
    // Le nom de la plateforme n'a plus à apparaître quand la source est ailleurs.
    assert.doesNotMatch(servi.texte, /HaikoDev/);
  } finally {
    fs.rmSync(socle, { recursive: true, force: true });
    fs.rmSync(aval, { recursive: true, force: true });
  }
});

test('quand le projet A sa règle, rien ne monte d’un cran', () => {
  const socle = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-2-'));
  const aval = fs.mkdtempSync(path.join(os.tmpdir(), 'aval-2-'));
  try {
    fs.mkdirSync(path.join(socle, 'docs', 'regles'), { recursive: true });
    fs.writeFileSync(
      path.join(socle, 'docs', 'regles', 'publication.md'),
      '# Publication\n\n- **LA RÈGLE DU SOCLE** : elle ne doit pas venir ici.\n',
      'utf8',
    );
    fs.mkdirSync(path.join(aval, 'docs', 'regles'), { recursive: true });
    fs.writeFileSync(
      path.join(aval, 'docs', 'regles', 'publication.md'),
      '# Publication\n\n- **LA RÈGLE DU PROJET** : c’est elle qui fait foi.\n',
      'utf8',
    );

    const servi = detailProjet(aval, 'publication', [], { nom: 'Socle Agence', chemin: socle });
    assert.match(servi.texte, /RÈGLE DU PROJET/);
    assert.doesNotMatch(servi.texte, /RÈGLE DU SOCLE/);
  } finally {
    fs.rmSync(socle, { recursive: true, force: true });
    fs.rmSync(aval, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* La part plateforme et la part projet                                */
/* ------------------------------------------------------------------ */

test('le briefing sépare ce qui vient du projet de ce qui vient de la plateforme', () => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-parts-'));
  try {
    appendMemory(projet, 'Quota : la place restante n’est pas 100 %.');
    const { sansMemoire, socle, memoire } = briefingSepare(projet, 'Essai', true);

    // Le PROJET : son dossier. La PLATEFORME : l'accès GitHub et la façon
    // d'écrire une règle durable — identiques sur tous les projets.
    assert.match(sansMemoire, /Projet : Essai/);
    assert.ok(socle, 'le socle de la plateforme doit être isolé');
    assert.match(socle as string, /GITHUB EST DIRECTEMENT ACCESSIBLE/);
    assert.match(socle as string, /RÈGLE DURABLE APPRISE/);
    // …et il ne doit surtout plus être compté du côté du projet.
    assert.doesNotMatch(sansMemoire, /RÈGLE DURABLE APPRISE/);
    assert.match(memoire as string, /CARTE de l'arbre/);
    assert.doesNotMatch(memoire as string, /RÈGLE DURABLE APPRISE/);
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

function bloc(kind: SentContextBlock['kind'], characters: number, origine?: SentContextBlock['origine']) {
  return { kind, label: kind, characters, origine } as SentContextBlock;
}

test('le partage additionne chaque origine, et les pourcentages font 100', () => {
  const parts = partsDuContexte([
    bloc('briefing', 300, 'projet'),
    bloc('briefing', 600, 'plateforme'),
    bloc('memory', 100, 'projet'),
    bloc('request', 100, 'demande'),
  ]);
  assert.deepEqual(parts, { plateforme: 600, projet: 400, demande: 100, total: 1100 });

  const lignes = partagePourLOeil(parts);
  assert.equal(
    lignes.reduce((n, l) => n + l.part, 0),
    100,
    'trois arrondis ne doivent jamais donner 99 % ou 101 %',
  );
  assert.equal(lignes.find((l) => l.cle === 'plateforme')?.part, 55);
});

test('une origine à zéro ne s’affiche pas, et un tour vide ne rend rien', () => {
  const sansDemande = partagePourLOeil(partsDuContexte([bloc('briefing', 10, 'plateforme')]));
  assert.deepEqual(
    sansDemande.map((l) => l.cle),
    ['plateforme'],
  );
  assert.deepEqual(partagePourLOeil(partsDuContexte([])), []);
});

test('un tour enregistré AVANT ce partage se range sur son genre, sans rien inventer', () => {
  // Aucun `origine` : ce sont les tours d'avant. On ne réécrit pas leur histoire,
  // on les range grossièrement — et le gabarit reste du côté de la plateforme.
  assert.equal(origineDuBloc({ kind: 'format' } as SentContextBlock), 'plateforme');
  assert.equal(origineDuBloc({ kind: 'request' } as SentContextBlock), 'demande');
  assert.equal(origineDuBloc({ kind: 'memory' } as SentContextBlock), 'projet');
  // Une étiquette POSÉE l'emporte toujours sur la déduction.
  assert.equal(origineDuBloc({ kind: 'briefing', origine: 'plateforme' } as SentContextBlock), 'plateforme');
});
