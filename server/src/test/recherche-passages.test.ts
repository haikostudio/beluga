import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * L'INDEX DE RECHERCHE, CÔTÉ DISQUE ET BASE. La base est une VRAIE base, mais
 * posée dans un dossier jetable : un test qui indexe ne doit pas écrire dans
 * celle du serveur. Le dossier se pose AVANT de charger le module, qui lit sa
 * configuration au chargement.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'passages-base-'));
process.env.HAIKODEV_DATA = bacASable;

const { indexerDocumentation, passagesIndexes, rechercherPourLaTache } = await import('../passages.js');

const FAIT_VOIX =
  "Le mot de réveil de l'écoute permanente se compare sans accent ni ponctuation, et il ne " +
  "déclenche l'enregistrement qu'après quatre-vingt-treize millisecondes de parole continue.";
const REGLE_PUBLICATION =
  "- **Un conflit de FUSION arrête le déploiement** : la branche du lot n'est jamais forcée dans la " +
  'principale, un agent de dépannage est appelé et la carte reste dans « À déployer » tant que le ' +
  "conflit n'est pas résolu à la main.";

function projetDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'passages-projet-'));
  fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'docs', 'memoire'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'docs', 'mecaniques'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, 'docs', 'regles', 'publication.md'),
    `# Publication — règles du moteur\n\n## Déploiement\n\n${REGLE_PUBLICATION}\n`,
  );
  fs.writeFileSync(
    path.join(dossier, 'docs', 'memoire', 'voix.md'),
    `# Mémoire du projet — Voix\n\n- ${FAIT_VOIX}\n`,
  );
  fs.writeFileSync(
    path.join(dossier, 'docs', 'mecaniques', 'ajouter-un-outil.md'),
    '# Mécanique — ajouter un outil\n\n## Déclarer\n\nDéclarer l’outil dans TOOL_DEFS, écrire son ' +
      'traitement dans le switch de callTool, poser l’interdit au niveau de l’outil, puis le ' +
      'verrouiller par un test. Quatre gestes, toujours les mêmes, quel que soit l’outil ajouté.\n',
  );
  return dossier;
}

/** Un index de mémoire assez gros pour que la recherche ait quelque chose à gagner. */
function indexDEssai(faits = 40): { texte: string; faits: number } {
  return {
    texte: Array.from(
      { length: faits },
      (_, i) => `  ${i + 1}. Une ligne d'index qui résume un fait durable du projet, tronquée comme il se doit.`,
    ).join('\n'),
    faits,
  };
}

test('l’indexation découpe la documentation et se rejoue sans rien recalculer', () => {
  const dossier = projetDEssai();
  const premier = indexerDocumentation('p1', dossier);
  assert.ok(premier.fichiers >= 3, 'les trois fichiers sont vus');
  assert.ok(premier.modifies >= 3, 'ils sont tous indexés la première fois');
  assert.ok(premier.passages >= 3, 'chacun rend au moins un passage');

  const second = indexerDocumentation('p1', dossier);
  assert.equal(second.modifies, 0, 'rien n’a changé : rien n’est recalculé');
  assert.equal(second.passages, premier.passages);

  // Un fichier MODIFIÉ voit ses seuls passages remplacés.
  fs.appendFileSync(
    path.join(dossier, 'docs', 'memoire', 'voix.md'),
    "- La voix se tait dès que le bouton Muet est allumé, et les ondes du module retombent au repos.\n",
  );
  const troisieme = indexerDocumentation('p1', dossier);
  assert.equal(troisieme.modifies, 1, 'un seul fichier a bougé');
  assert.ok(
    passagesIndexes('p1').some((p) => p.texte.includes('bouton Muet')),
    'le fait ajouté est indexé',
  );

  // Un fichier DISPARU emporte ses passages : une règle effacée ne doit plus
  // pouvoir être servie.
  fs.rmSync(path.join(dossier, 'docs', 'regles', 'publication.md'));
  indexerDocumentation('p1', dossier);
  assert.ok(!passagesIndexes('p1').some((p) => p.source.includes('publication')));
});

test('la recherche remonte le passage qui répond, pas le fichier entier', () => {
  const dossier = projetDEssai();
  const trouve = rechercherPourLaTache('p2', dossier, 'conflit de fusion pendant un déploiement', indexDEssai());
  assert.ok(trouve, 'la recherche répond');
  assert.match(trouve!.texte, /conflit de FUSION/);
  assert.ok(
    trouve!.passages.every((p) => p.source !== 'docs/memoire/voix.md'),
    'le sujet qui ne répond pas ne part pas',
  );
  assert.match(trouve!.texte, /project_memory/, 'le reste de la mémoire reste annoncé');
});

test('une fiche de mécanique est retrouvée pour la tâche qu’elle décrit', () => {
  const dossier = projetDEssai();
  const trouve = rechercherPourLaTache('p3', dossier, 'ajouter un outil au démon', indexDEssai());
  assert.ok(trouve);
  assert.equal(trouve!.passages[0].source, 'docs/mecaniques/ajouter-un-outil.md');
});

test('la recherche ne coûte JAMAIS plus cher que l’index qu’elle remplace', () => {
  const dossier = projetDEssai();
  const gros = indexDEssai(60);
  const trouve = rechercherPourLaTache('p4', dossier, 'le mot de réveil de l’écoute', gros);
  assert.ok(trouve);
  assert.ok(trouve!.jetons < trouve!.jetonsIndex, 'le bloc envoyé est plus léger que l’index');
});

test('un index minuscule fait renoncer la recherche : l’index reste le moins cher', () => {
  const dossier = projetDEssai();
  const maigre = { texte: '  1. Un seul fait.', faits: 1 };
  assert.equal(rechercherPourLaTache('p5', dossier, 'conflit de fusion', maigre), undefined);
});

test('sans question, et sans documentation, la recherche se tait', () => {
  const dossier = projetDEssai();
  assert.equal(rechercherPourLaTache('p6', dossier, '   ', indexDEssai()), undefined);
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'passages-vide-'));
  assert.equal(rechercherPourLaTache('p7', vide, 'conflit de fusion', indexDEssai()), undefined);
});

test('deux projets ne se mélangent pas', () => {
  const dossier = projetDEssai();
  indexerDocumentation('p8', dossier);
  assert.ok(passagesIndexes('p8').length > 0);
  assert.equal(passagesIndexes('p9-jamais-indexe').length, 0);
});
