import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BRANCHES_MINIMUM,
  MARQUE_ARBRE,
  brancheDemandee,
  carteDeLArbre,
  construireLArbre,
  dossierDuSujet,
  fichierDeBranche,
  rappelDuSujet,
  rendreRacine,
  repartirEnBranches,
  slug,
  titreDuFait,
} from '@haikodev/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-memoire-'));
process.env.HAIKODEV_DATA = bacASable;

const { appendMemory, arbreDuProjet, blocMemoire, detailMemoire, memoryFacts, migrerParSujet } =
  await import('../memory.js');

function projetDEssai(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'projet-arbre-'));
}

/* ------------------------------------------------------------------ */
/* Nommer : le nom du parent se lit dans celui de l'enfant             */
/* ------------------------------------------------------------------ */

test('un nom de fichier est sans accent, sans majuscule et sans ponctuation', () => {
  assert.equal(slug('Capacité'), 'capacite');
  assert.equal(slug('Poignée tiroir'), 'poignee-tiroir');
  assert.equal(slug('« Repartir de zéro »'), 'repartir-de-zero');
});

test('la branche porte le titre que le fait s’est donné', () => {
  assert.equal(titreDuFait('Catalogue : 3 récents par moteur, défaut medium.'), 'Catalogue');
  // Une phrase entière n'est pas un titre : le fait rejoint la branche générale.
  assert.equal(
    titreDuFait(
      'Une carte lancée a toujours sa branche et sa copie de travail à elle, sans exception aucune : voilà.',
    ),
    undefined,
  );
  // Pas de « : » du tout, rien à nommer.
  assert.equal(titreDuFait('Le démon est la source de vérité.'), undefined);
});

test('le chemin d’une branche répète le nom de son parent, à chaque étage', () => {
  assert.equal(dossierDuSujet('quotas'), 'docs/memoire/quotas');
  assert.equal(fichierDeBranche('quotas', 'catalogue'), 'docs/memoire/quotas/quotas-catalogue.md');
  // C'est le geste que le système existe pour rendre possible : le mot lu dans
  // le fichier racine donne le chemin exact, sans rien chercher.
  assert.ok(fichierDeBranche('interface', 'Tiroir').endsWith('/interface/interface-tiroir.md'));
});

/* ------------------------------------------------------------------ */
/* Répartir                                                            */
/* ------------------------------------------------------------------ */

test('deux faits de même titre tombent dans la même branche', () => {
  const branches = repartirEnBranches('tableau', [
    'Cartes : elles naissent dans « Planifié ».',
    'Cartes : un rapport rendu ferme la carte.',
    'Cloche : elle liste toutes les décisions attendues.',
  ]);
  assert.equal(branches.length, 2);
  assert.equal(branches[0].nom, 'cartes');
  assert.equal(branches[0].faits.length, 2);
  assert.equal(branches[1].nom, 'cloche');
});

test('un sujet d’une seule branche garde son mot, mais pas de dossier enfant', () => {
  const arbre = construireLArbre(new Map([['mobile', ['Poignée tiroir : trois lieux, un seul style.']]]));
  assert.equal(arbre.length, 1);
  assert.equal(arbre[0].eclate, false);
  assert.equal(arbre[0].dossier, undefined);
  // Le mot reste NOMMÉ : le cacher parce qu'il est seul rendrait introuvable
  // exactement ce qu'on vient chercher.
  assert.equal(arbre[0].branches[0].nom, 'poignee-tiroir');
  assert.equal(arbre[0].branches[0].fichier, 'docs/memoire/mobile.md');
});

test('à partir de deux branches, le sujet prend son dossier enfant', () => {
  const arbre = construireLArbre(
    new Map([['quotas', ['Quota : la place restante.', 'Chef : il trie seul.']]]),
  );
  assert.equal(BRANCHES_MINIMUM, 2);
  assert.equal(arbre[0].eclate, true);
  assert.equal(arbre[0].dossier, 'docs/memoire/quotas');
  assert.equal(arbre[0].branches[1].fichier, 'docs/memoire/quotas/quotas-chef.md');
});

/* ------------------------------------------------------------------ */
/* La carte : ce qui part au moteur                                    */
/* ------------------------------------------------------------------ */

test('la carte de l’arbre ne porte aucun fait — rien que des chemins', () => {
  const arbre = construireLArbre(
    new Map([['quotas', ['Quota : la place restante n’est pas 100 %.', 'Chef : il trie seul.']]]),
  );
  const carte = carteDeLArbre(arbre);
  assert.match(carte, /« quotas »/);
  assert.match(carte, /quota, chef/);
  // LE POINT DE TOUT LE CHANGEMENT : le texte des faits ne part plus d'office.
  assert.doesNotMatch(carte, /100 %/);
  assert.doesNotMatch(carte, /trie seul/);
});

test('le rappel d’un sujet dit ses branches, jamais leurs faits', () => {
  const arbre = construireLArbre(
    new Map([['quotas', ['Quota : la place restante n’est pas 100 %.', 'Chef : il trie seul.']]]),
  );
  const rappel = rappelDuSujet(arbre[0]);
  assert.match(rappel, /quota \(1\)/);
  assert.doesNotMatch(rappel, /100 %/);
});

test('le fichier racine porte sa marque et le mode d’emploi de la descente', () => {
  const racine = rendreRacine(
    construireLArbre(new Map([['quotas', ['Quota : la place restante.', 'Chef : il trie seul.']]])),
  );
  assert.match(racine, new RegExp(MARQUE_ARBRE.replace(/[-[\]{}()*+?.\\^$|]/g, '\\$&')));
  assert.match(racine, /Comment retrouver un détail/);
  assert.match(racine, /docs\/memoire\/quotas\/quotas-chef\.md/);
});

/* ------------------------------------------------------------------ */
/* Sur le disque : écrire, relire, ne rien perdre                      */
/* ------------------------------------------------------------------ */

test('la mémoire écrite en arbre se relit à l’identique, et la migration est rejouable', () => {
  const projet = projetDEssai();
  try {
    for (const fait of [
      'Quota : la place restante n’est pas 100 %.',
      'Jetons : la facturation les compte à part.',
      'Catalogue : trois modèles récents par moteur.',
      'Poignée tiroir : trois lieux, un seul style.',
    ]) {
      appendMemory(projet, fait);
    }

    // Les trois étages sont sur le disque, et le dossier porte le nom du parent.
    assert.ok(fs.existsSync(path.join(projet, 'MEMOIRE.md')));
    assert.ok(fs.existsSync(path.join(projet, 'docs', 'memoire', 'quotas.md')));
    assert.ok(fs.existsSync(path.join(projet, 'docs', 'memoire', 'quotas', 'quotas-catalogue.md')));
    // Un sujet d'une seule branche n'ouvre pas de dossier pour rien.
    assert.equal(fs.existsSync(path.join(projet, 'docs', 'memoire', 'mobile')), false);

    // RIEN N'EST PERDU À L'ALLER-RETOUR : c'est ce qui compte le plus ici.
    assert.equal(memoryFacts(projet).length, 4);
    assert.equal(migrerParSujet(projet), 0);
    assert.equal(memoryFacts(projet).length, 4);
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

test('la table des matières d’un sujet n’est jamais relue comme un fait', () => {
  const projet = projetDEssai();
  try {
    appendMemory(projet, 'Quota : la place restante n’est pas 100 %.');
    appendMemory(projet, 'Catalogue : trois modèles récents.');
    // Trois passages : si le rappel était relu comme des faits, la mémoire
    // grossirait de sa propre table des matières à chaque écriture.
    appendMemory(projet, 'Jetons : la facturation les compte à part.');
    assert.equal(memoryFacts(projet).length, 3);
    assert.equal(
      memoryFacts(projet).filter((f) => f.includes('docs/memoire')).length,
      0,
      'aucun chemin ne doit avoir été pris pour un fait',
    );
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

test('une vieille mémoire à plat monte dans l’arbre sans rien perdre', () => {
  const projet = projetDEssai();
  try {
    fs.writeFileSync(
      path.join(projet, 'MEMOIRE.md'),
      '# Mémoire du projet\n\n- Quota : la place restante.\n- Chef : il trie seul.\n- Cloche : les décisions attendues.\n',
      'utf8',
    );
    assert.equal(migrerParSujet(projet), 3);
    assert.equal(memoryFacts(projet).length, 3);
    assert.match(fs.readFileSync(path.join(projet, 'MEMOIRE.md'), 'utf8'), new RegExp(MARQUE_ARBRE.replace(/[-[\]{}()*+?.\\^$|]/g, '\\$&')));
    assert.equal(migrerParSujet(projet), 0);
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

test('une branche vidée ne laisse pas son fichier derrière elle', () => {
  const projet = projetDEssai();
  try {
    appendMemory(projet, 'Quota : la place restante.');
    appendMemory(projet, 'Catalogue : trois modèles récents par moteur.');
    const fichier = path.join(projet, 'docs', 'memoire', 'quotas', 'quotas-catalogue.md');
    assert.ok(fs.existsSync(fichier));

    // Le fait change de titre : l'ancienne branche n'a plus rien à porter.
    appendMemory(
      projet,
      'Modèles : le catalogue garde trois modèles récents par moteur.',
      'Catalogue : trois modèles récents',
    );
    assert.equal(
      fs.existsSync(fichier),
      false,
      'un fichier orphelin continuerait d’être LU, et ressusciterait un fait effacé',
    );
    assert.equal(memoryFacts(projet).length, 2);
    assert.ok(memoryFacts(projet).some((f) => f.startsWith('Modèles :')));
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Naviguer : un mot ouvre son fichier, et rien d'autre                */
/* ------------------------------------------------------------------ */

test('un mot de la carte ouvre le fichier de détail qui porte ce mot', () => {
  const projet = projetDEssai();
  try {
    appendMemory(projet, 'Quota : la place restante n’est pas 100 %.');
    appendMemory(projet, 'Jetons : la facturation les compte à part.');
    appendMemory(projet, 'Catalogue : trois modèles récents par moteur.');

    const arbre = arbreDuProjet(projet);
    const trouve = brancheDemandee(arbre, 'catalogue');
    assert.equal(trouve.length, 1);
    assert.equal(trouve[0].branche.fichier, 'docs/memoire/quotas/quotas-catalogue.md');

    const detail = detailMemoire(projet, 'catalogue');
    assert.match(detail, /quotas-catalogue\.md/);
    assert.match(detail, /trois modèles récents/);
    // On n'a ouvert QUE cette branche : les deux autres ne sont pas venues avec.
    assert.doesNotMatch(detail, /les compte à part/);
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

test('un mot qui ne nomme rien rend un silence honnête, jamais un extrait au hasard', () => {
  const projet = projetDEssai();
  try {
    appendMemory(projet, 'Quota : la place restante.');
    appendMemory(projet, 'Catalogue : trois modèles récents.');
    const reponse = detailMemoire(projet, 'photosynthese');
    assert.match(reponse, /Aucun fait ne correspond/);
    // …et on rend la CARTE, pour que l'agent sache où chercher ensuite.
    assert.match(reponse, /CARTE de l'arbre/);
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

test('un sujet court part en entier, un sujet fourni rend d’abord ses branches', () => {
  const projet = projetDEssai();
  try {
    appendMemory(projet, 'Quota : la place restante.');
    appendMemory(projet, 'Catalogue : trois modèles récents par moteur.');
    // Court : deux faits, on ne fait pas faire un aller-retour de plus.
    assert.match(detailMemoire(projet, 'quotas'), /trois modèles récents/);

    for (let i = 0; i < 12; i++) {
      appendMemory(
        projet,
        `Règle ${i} : une règle de quota assez longue pour peser, écrite comme on les écrit vraiment dans ce projet, avec sa raison.`,
      );
    }
    const fourni = detailMemoire(projet, 'quotas');
    assert.match(fourni, /ses branches/);
    assert.doesNotMatch(fourni, /trois modèles récents/, 'un sujet fourni ne déballe pas ses faits d’un coup');
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Ce qui part au moteur — le but même du changement                   */
/* ------------------------------------------------------------------ */

test('la carte envoyée au moteur pèse une fraction de la mémoire entière', () => {
  const projet = projetDEssai();
  try {
    for (let i = 0; i < 40; i++) {
      appendMemory(
        projet,
        `Sujet ${i} : un fait durable écrit comme ils le sont vraiment sur ce projet, avec sa règle, sa raison et le fichier qui la porte.`,
      );
    }
    const carte = blocMemoire(projet);
    const entiere = memoryFacts(projet).join('\n');
    assert.ok(
      carte.length < entiere.length / 2,
      `la carte pèse ${carte.length} signes contre ${entiere.length} pour la mémoire entière`,
    );
    assert.doesNotMatch(carte, /sa règle, sa raison/, 'aucun fait ne part avec la carte');
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});
