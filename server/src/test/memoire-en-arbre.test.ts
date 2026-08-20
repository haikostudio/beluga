import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA MÉMOIRE EN ARBRE : un projet hérite de ce que sait HaikoDev.
 *
 * Deux moitiés à éprouver, et elles ne se prouvent pas au même endroit :
 *  — les RÈGLES PURES (le recul, la part maximale, le rappel) se testent sans
 *    disque ni base, comme tout `shared/` ;
 *  — la JONCTION (la documentation de HaikoDev jointe au corpus d'un autre
 *    projet, et jamais au sien) demande une vraie base, posée dans un dossier
 *    jetable — jamais celle du serveur.
 *
 * Aucun appel réseau : on retire la clé du modèle de sens pour éprouver le
 * repli par les mots, exactement comme `recherche-passages.test.ts`.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-base-'));
process.env.HAIKODEV_DATA = bacASable;
delete process.env.HAIKODEV_EMBED_API_KEY;
delete process.env.OPENROUTER_API_KEY;
process.env.HAIKODEV_ENV_FILE = path.join(bacASable, 'aucun-environnement');

/*
 * LE DÉPÔT AMONT DE L'ESSAI : un faux HaikoDev à nous, jamais le vrai dépôt. La
 * racine amont est un PARAMÈTRE de la recherche — c'est précisément ce qui rend
 * la couche rejouable ici sans toucher à la configuration du serveur.
 */
const amont = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-amont-'));

const {
  FACTEUR_SEUIL_AMONT,
  MALUS_AMONT,
  PART_MAX_DE_L_AMONT,
  PREFIXE_SOURCE_AMONT,
  amontApplicable,
  cheminDepuisLAmont,
  estPassageAmont,
  plafondDeLAmont,
  rappelDeLAmont,
  reculerLAmont,
  seuilDeLAmont,
  sourceAmont,
  choisirPassages,
} = await import('@haikodev/shared');

const { PROJET_AMONT, estFichierHerite, fichiersDeLAmont, indexerLAmont, passagesIndexes, rechercherPourLaTache } =
  await import('../passages.js');
const { detailProjet } = await import('../memory.js');

/* ------------------------------------------------------------------ */
/* 1. Les règles pures                                                 */
/* ------------------------------------------------------------------ */

test('une source amont se reconnaît, se préfixe et se déprefixe', () => {
  const source = sourceAmont('docs/regles/cartes.md');
  assert.equal(source, `${PREFIXE_SOURCE_AMONT}docs/regles/cartes.md`);
  assert.ok(estPassageAmont(source));
  assert.equal(cheminDepuisLAmont(source), 'docs/regles/cartes.md');
  // Une page du projet courant n'est jamais prise pour un héritage.
  assert.ok(!estPassageAmont('docs/regles/cartes.md'));
  assert.equal(cheminDepuisLAmont('docs/regles/cartes.md'), undefined);
});

test('la couche amont ne s’applique pas à HaikoDev lui-même, ni sans dépôt amont', () => {
  assert.ok(amontApplicable({ projet: '/root/site-vitrine', amont: '/root/haikodev' }));
  assert.ok(!amontApplicable({ projet: '/root/haikodev', amont: '/root/haikodev' }));
  // La barre finale ne doit pas faire croire à deux dossiers différents.
  assert.ok(!amontApplicable({ projet: '/root/haikodev/', amont: '/root/haikodev' }));
  assert.ok(!amontApplicable({ projet: '/root/site-vitrine', amont: '' }));
  assert.ok(!amontApplicable({ projet: '', amont: '/root/haikodev' }));
});

test('l’amont RECULE : à score voisin, la page du projet courant gagne', () => {
  const classes = [
    { source: sourceAmont('docs/regles/cartes.md'), score: 0.5 },
    { source: 'docs/regles/local.md', score: 0.48 },
  ];
  const recule = reculerLAmont(classes);
  assert.equal(recule[0].source, 'docs/regles/local.md', 'le projet passe devant');
  assert.equal(recule[1].score, 0.5 - MALUS_AMONT);
  // Mais un héritage qui répond NETTEMENT mieux passe quand même.
  const franc = reculerLAmont([
    { source: sourceAmont('docs/regles/cartes.md'), score: 0.7 },
    { source: 'docs/regles/local.md', score: 0.3 },
  ]);
  assert.ok(estPassageAmont(franc[0].source));
});

test('sans passage amont, le classement est rendu tel quel', () => {
  const classes = [
    { source: 'a.md', score: 0.2 },
    { source: 'b.md', score: 0.9 },
  ];
  assert.equal(reculerLAmont(classes), classes, 'ni copie ni tri sur un projet qui n’hérite de rien');
});

test('l’amont a sa part, et elle est plafonnée', () => {
  assert.equal(plafondDeLAmont(1000), Math.floor(1000 * PART_MAX_DE_L_AMONT));
  assert.equal(plafondDeLAmont(-5), 0);

  const passage = (source: string, jetons: number, score: number) => ({
    source,
    titre: source,
    sujet: 'x',
    priorite: 1,
    texte: 'x'.repeat(jetons * 3),
    score,
    sens: score,
    mots: 0,
    jetons,
  });
  const { gardes } = choisirPassages(
    [
      passage(sourceAmont('docs/regles/a.md'), 100, 0.9),
      passage(sourceAmont('docs/regles/b.md'), 100, 0.85),
      passage(sourceAmont('docs/regles/c.md'), 100, 0.8),
      passage('docs/regles/local.md', 100, 0.75),
    ],
    { plafond: 1000, partDuPremier: 0 },
  );
  const amonts = gardes.filter((p) => estPassageAmont(p.source));
  assert.equal(amonts.length, 2, 'le premier échappe à la part, le second l’épuise, le troisième est écarté');
  assert.ok(
    gardes.some((p) => p.source === 'docs/regles/local.md'),
    'la place refusée à l’héritage revient au projet',
  );
});

test('le rappel de premier niveau ne part QUE si l’amont a servi', () => {
  assert.equal(rappelDeLAmont([{ source: 'docs/regles/local.md' }]), '');
  const rappel = rappelDeLAmont([{ source: sourceAmont('docs/regles/cartes.md') }]);
  assert.match(rappel, /HaikoDev/);
  assert.match(rappel, /project_memory/);
});

/* ------------------------------------------------------------------ */
/* 2. La jonction, sur une vraie base                                  */
/* ------------------------------------------------------------------ */

const REGLE_AMONT =
  "- **Une carte NAÎT dans « Planifié »** : rien ne part au moteur avant le lancement, et un agent " +
  "n'est jamais démarré par le seul fait qu'une carte ait été écrite.";
const REGLE_LOCALE =
  '- **Le panier du visiteur garde ses articles trente jours** : il est rangé sur le compte, pas dans ' +
  "le navigateur, et un article épuisé y reste barré au lieu de disparaître sans rien dire.";

function amontDEssai(): void {
  fs.mkdirSync(path.join(amont, 'docs', 'regles'), { recursive: true });
  fs.mkdirSync(path.join(amont, 'docs', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(amont, 'server', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(amont, 'docs', 'regles', 'cartes.md'),
    `# Cartes — règles du moteur\n\n## Naissance d'une carte\n\n${REGLE_AMONT}\n`,
  );
  // Ni le CODE ni les PLANS de HaikoDev ne s'héritent : c'est ce refus qui
  // empêche la couche de gonfler le prompt.
  fs.writeFileSync(
    path.join(amont, 'docs', 'plans', 'un-plan.md'),
    '# Plan — une carte naît dans planifié\n\nÉtapes du chef d’orchestre pour cette carte de HaikoDev.\n',
  );
  fs.writeFileSync(
    path.join(amont, 'server', 'src', 'cartes.ts'),
    'export function carteNaitDansPlanifie() { return true; }\n',
  );
}

function projetHeritier(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-projet-'));
  fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, 'docs', 'regles', 'panier.md'),
    `# Panier — règles du projet\n\n## Durée de garde\n\n${REGLE_LOCALE}\n`,
  );
  return dossier;
}

function indexDEssai(faits = 40): { texte: string; faits: number } {
  return {
    texte: Array.from(
      { length: faits },
      (_, i) => `  ${i + 1}. Une ligne d'index qui résume un fait durable du projet, tronquée comme il se doit.`,
    ).join('\n'),
    faits,
  };
}

test('la couche amont n’indexe que les documents hérités, jamais le code ni les plans', () => {
  amontDEssai();
  assert.ok(estFichierHerite('docs/regles/cartes.md'));
  assert.ok(estFichierHerite('docs/memoire/quotas.md'));
  assert.ok(estFichierHerite('docs/mecaniques/ajouter-un-outil.md'));
  assert.ok(estFichierHerite('docs/verifications.md'));
  assert.ok(!estFichierHerite('docs/plans/un-plan.md'));
  assert.ok(!estFichierHerite('server/src/cartes.ts'));
  assert.ok(!estFichierHerite('README.md'));

  const fichiers = fichiersDeLAmont(amont);
  assert.equal(fichiers.length, 1, 'seule la règle est héritée');
  assert.equal(fichiers[0].source, `${PREFIXE_SOURCE_AMONT}docs/regles/cartes.md`);
  assert.match(fichiers[0].sujet, /^amont-/, 'le sujet est préfixé, il ne se confond pas avec celui du projet');

  indexerLAmont(amont);
  const indexes = passagesIndexes(PROJET_AMONT);
  assert.ok(indexes.length > 0);
  assert.ok(indexes.every((p) => estPassageAmont(p.source)));
  assert.ok(!indexes.some((p) => p.texte.includes('carteNaitDansPlanifie')), 'le code de HaikoDev ne part jamais');
});

test('un projet hérite des règles de HaikoDev, et le bloc envoyé dit d’où elles viennent', async () => {
  amontDEssai();
  const dossier = projetHeritier();
  const trouve = await rechercherPourLaTache(
    'heritier-1',
    dossier,
    'une carte naît-elle dans planifié, et rien ne part-il au moteur avant son lancement ?',
    indexDEssai(),
    '',
    amont,
  );
  assert.ok(trouve, 'la recherche répond');
  assert.ok(
    trouve!.passages.some((p) => estPassageAmont(p.source)),
    'la règle de plateforme remonte alors que le projet ne l’a pas',
  );
  assert.match(trouve!.texte, /Planifié/);
  assert.match(trouve!.texte, /viennent de HaikoDev/, 'le rappel de premier niveau accompagne le passage');
});

test('la documentation du projet reste chez elle : elle n’est pas noyée par l’héritage', async () => {
  amontDEssai();
  const dossier = projetHeritier();
  const trouve = await rechercherPourLaTache(
    'heritier-2',
    dossier,
    'combien de temps le panier du visiteur garde ses articles',
    indexDEssai(),
    '',
    amont,
  );
  assert.ok(trouve);
  assert.equal(trouve!.passages[0].source, 'docs/regles/panier.md', 'la règle du projet passe en tête');
});

test('sur HaikoDev lui-même, rien n’est joint : une règle ne remonte pas deux fois', async () => {
  amontDEssai();
  indexerLAmont(amont);
  assert.ok(!amontApplicable({ projet: amont, amont }));
  const trouve = await rechercherPourLaTache(
    'soi-meme',
    amont,
    'une carte naît-elle dans planifié, et rien ne part-il au moteur avant son lancement ?',
    indexDEssai(),
    '',
    amont,
  );
  if (trouve) {
    assert.ok(
      !trouve.passages.some((p) => estPassageAmont(p.source)),
      'sur son propre dépôt, HaikoDev ne s’hérite pas lui-même',
    );
  }
});

test('un héritage à peu près pertinent n’entre pas : le repli sur l’index reste possible', async () => {
  amontDEssai();
  const dossier = projetHeritier();
  /*
   * LE CŒUR DU SEUIL PROPRE À L'AMONT. La documentation de HaikoDev est vaste :
   * sans barre plus haute, une question naturelle sans un mot du corpus y
   * trouvait quand même une règle, et l'index de la mémoire ne pouvait plus
   * jamais reprendre sa place (`FACTEUR_SEUIL_AMONT`).
   */
  const horsSujet = await rechercherPourLaTache(
    'heritier-3',
    dossier,
    'dis-moi, est-ce que quelqu’un peut de lui-même envoyer le résultat au client sans mon accord ?',
    indexDEssai(),
    '',
    amont,
  );
  assert.ok(
    !horsSujet?.passages.some((p) => estPassageAmont(p.source)),
    'aucune règle de plateforme n’est traînée par une question qui ne l’appelle pas',
  );
  assert.equal(seuilDeLAmont(0.14), 0.14 * FACTEUR_SEUIL_AMONT);
});

test('project_memory monte d’un cran quand le projet n’a pas de règle sur le sujet', () => {
  amontDEssai();
  const dossier = projetHeritier();

  // Le projet a SA règle sur son sujet : on ne monte pas.
  const local = detailProjet(dossier, 'panier', [], amont);
  assert.ok(!/HÉRITÉ DE HAIKODEV/.test(local.texte), 'la règle du projet fait foi');

  // Il n'a rien sur « cartes » : la règle de la plateforme est servie, dite comme telle.
  const herite = detailProjet(dossier, 'cartes', [], amont);
  assert.match(herite.texte, /HÉRITÉ DE HAIKODEV/);
  assert.match(herite.texte, /Planifié/);

  // Sans dépôt amont, l'outil se comporte exactement comme avant.
  const sansAmont = detailProjet(dossier, 'cartes', []);
  assert.ok(!/HÉRITÉ DE HAIKODEV/.test(sansAmont.texte));
});
