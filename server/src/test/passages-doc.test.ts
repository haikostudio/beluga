import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PART_MAX_DE_L_INDEX,
  PLAFOND_PASSAGES_JETONS,
  PRIORITE,
  choisirPassages,
  classerPassages,
  cosinus,
  decouperBlocs,
  decouperEnPassages,
  empreinteSemantique,
  partDesMotsExacts,
  plafondDeRecherche,
  rechercheConvaincante,
  rechercheRentable,
  termesRares,
  texteDesPassages,
} from '@haikodev/shared';

/*
 * LA RECHERCHE DANS LA DOCUMENTATION, CÔTÉ RÈGLES. Ce fichier verrouille les
 * quatre décisions du module : découper, calculer une empreinte sur place,
 * mêler le sens et les mots exacts, tenir sous plafond sans jamais coûter plus
 * cher que l'index qu'on remplace.
 */

const REGLES = `# Cartes — règles du moteur

Un chapeau qui présente le fichier, assez long pour ne pas passer sous le plancher des passages et
pour qu'on vérifie qu'il n'est pas collé aux règles qui suivent.

## Colonnes

- **Une carte NAÎT dans « Planifié »** (\`createCard\`, \`server/src/tools.ts\`) : ni « Validé » ni
  « À faire » n'existent, le tableau compte SEPT colonnes (\`COLUMN_KEYS\`).

  Valider une carte autorise la dépense sans la déplacer, et le lancement reste un geste humain.

- **« Archivé » ne se rouvre que sur GESTE HUMAIN** : un projet qu'on retire est MIS DE CÔTÉ, jamais
  supprimé, et sa dernière colonne est gardée telle quelle pour le jour où on le rouvre.
`;

const MEMOIRE = `# Mémoire du projet — Voix et point du jour

- La voix se tait dès que le bouton Muet est allumé, et les ondes du module retombent au repos après
  sept dixièmes de seconde de silence complet, sinon elles clignotaient sans fin.
- Le mot de réveil de l'écoute permanente se règle dans les réglages de la voix et se compare sans
  accent ni ponctuation, pour qu'une dictée approximative le reconnaisse quand même.
`;

/* ------------------------------------------------------------------ */
/* 1. Le découpage                                                     */
/* ------------------------------------------------------------------ */

test('une règle en puce fait UN passage, jamais le fichier entier', () => {
  const passages = decouperEnPassages('docs/regles/cartes.md', REGLES, { sujet: 'cartes', priorite: PRIORITE.regle });

  assert.ok(passages.length >= 3, 'le chapeau et les deux règles font au moins trois passages');
  assert.ok(
    passages.every((p) => p.texte.length < REGLES.length),
    'aucun passage ne reprend le fichier entier',
  );

  const naissance = passages.find((p) => p.texte.includes('NAÎT dans'));
  assert.ok(naissance, 'la règle de naissance est un passage à elle');
  assert.match(naissance!.titre, /Colonnes/, 'le titre porte le fil des sections');
  assert.match(naissance!.titre, /Planifié/, 'le titre porte aussi l’amorce de la règle');
  assert.ok(
    naissance!.texte.includes('geste humain'),
    'la suite indentée de la puce reste avec elle, paragraphe vide compris',
  );
  assert.ok(!naissance!.texte.includes('Archivé'), 'la règle suivante ne déborde pas dans celle-ci');
  assert.equal(naissance!.sujet, 'cartes');
  assert.equal(naissance!.priorite, PRIORITE.regle);
});

test('les faits de la mémoire sont découpés eux aussi, pas servis en bloc', () => {
  const passages = decouperEnPassages('docs/memoire/voix.md', MEMOIRE, { sujet: 'voix' });
  assert.ok(passages.length >= 2, 'chaque fait long fait son passage');
  assert.ok(passages.some((p) => p.texte.includes('sept dixièmes')));
  assert.ok(passages.some((p) => p.texte.includes('mot de réveil')));
});

test('les puces courtes se groupent au lieu de disparaître', () => {
  const liste = `## Contrôles

- \`node scripts/un.mjs\` — le premier contrôle
- \`node scripts/deux.mjs\` — le deuxième contrôle
- \`node scripts/trois.mjs\` — le troisième contrôle
`;
  const passages = decouperEnPassages('docs/verifications.md', liste);
  assert.equal(passages.length, 1, 'trois lignes courtes font un seul passage');
  assert.match(passages[0].texte, /un\.mjs[\s\S]*trois\.mjs/, 'aucune ligne n’est perdue');
});

test('un bloc de code ne fabrique pas de faux titres', () => {
  const avecCode = `## Lancer

\`\`\`bash
# ceci est un commentaire, pas un titre
npm run build
\`\`\`

Le texte qui suit appartient encore à la section « Lancer », et il est assez long pour être indexé.
`;
  const passages = decouperEnPassages('CLAUDE.md', avecCode);
  assert.ok(passages.every((p) => !p.titre.includes('ceci est un commentaire')));
});

test('decouperBlocs sépare les puces et les paragraphes', () => {
  const blocs = decouperBlocs('Un paragraphe.\n\nUn autre.\n\n- une puce\n  sa suite\n- une autre puce');
  assert.deepEqual(blocs.length, 4);
  assert.match(blocs[2], /^- une puce/);
  assert.match(blocs[2], /sa suite/);
});

/* ------------------------------------------------------------------ */
/* 2. L'empreinte, calculée sur place                                  */
/* ------------------------------------------------------------------ */

test('une empreinte est de longueur 1 et rapproche les textes du même sujet', () => {
  const voix = empreinteSemantique('le mot de réveil de la voix et son écoute permanente');
  const voisin = empreinteSemantique('régler le mot de réveil de l’écoute vocale');
  const etranger = empreinteSemantique('la publication fusionne la branche du lot dans la principale');

  const norme = Math.sqrt(voix.reduce((total, v) => total + v * v, 0));
  assert.ok(Math.abs(norme - 1) < 1e-9, 'le vecteur est normalisé');
  assert.ok(cosinus(voix, voisin) > cosinus(voix, etranger), 'le même sujet est plus proche');
});

test('le singulier et le pluriel se retrouvent', () => {
  const singulier = empreinteSemantique('la carte du tableau');
  const pluriel = empreinteSemantique('les cartes du tableau');
  assert.ok(cosinus(singulier, pluriel) > 0.9);
});

test('un texte vide ne fait pas planter le calcul', () => {
  const vide = empreinteSemantique('   ');
  assert.equal(cosinus(vide, empreinteSemantique('quelque chose')), 0);
});

/* ------------------------------------------------------------------ */
/* 3. Le score mixte : les noms exacts ne se perdent pas               */
/* ------------------------------------------------------------------ */

test('un identifiant de la question pèse double', () => {
  const termes = termesRares('la colonne analyseDemandee de carte-sql.ts');
  const identifiants = termes.filter((t) => t.poids === 2).map((t) => t.terme);
  assert.ok(identifiants.some((t) => t.includes('analysedemandee')));
  assert.ok(identifiants.some((t) => t.includes('carte-sql.ts')));
});

test('les mots exacts remontent un passage que le sens seul raterait', () => {
  const passages = [
    {
      source: 'docs/regles/cartes.md',
      titre: 'Colonnes',
      sujet: 'cartes',
      priorite: PRIORITE.regle,
      texte: 'Le drapeau analyseDemandee autorise la dépense sans déplacer la carte.',
      empreinte: empreinteSemantique('Le drapeau analyseDemandee autorise la dépense sans déplacer la carte.'),
    },
    {
      source: 'docs/regles/voix.md',
      titre: 'Écoute',
      sujet: 'voix',
      priorite: PRIORITE.regle,
      texte: "La voix se tait dès que le bouton Muet est allumé, sans couper la réécoute d'un message.",
      empreinte: empreinteSemantique("La voix se tait dès que le bouton Muet est allumé, sans couper la réécoute."),
    },
  ];
  const classes = classerPassages(passages, 'où est posé analyseDemandee ?');
  assert.equal(classes[0].source, 'docs/regles/cartes.md');
  assert.ok(classes[0].mots > 0, 'la part de mots exacts est bien ce qui l’a fait gagner');
});

test('la part de mots exacts se compte sur les termes rares seulement', () => {
  const termes = termesRares('conflit de fusion pendant un déploiement');
  assert.equal(partDesMotsExacts('un conflit de fusion arrête le déploiement', termes), 1);
  assert.equal(partDesMotsExacts('la voix se tait', termes), 0);
});

test('à pertinence égale, une fiche de mécanique passe devant une règle', () => {
  const texte = 'Ajouter un outil au démon : déclarer TOOL_DEFS, écrire le traitement, verrouiller.';
  const [mecanique, regle] = classerPassages(
    [
      {
        source: 'docs/regles/methode.md',
        titre: 'Outils',
        sujet: 'methode',
        priorite: PRIORITE.regle,
        texte,
        empreinte: empreinteSemantique(texte),
      },
      {
        source: 'docs/mecaniques/ajouter-un-outil.md',
        titre: 'Ajouter un outil',
        sujet: 'ajouter-un-outil',
        priorite: PRIORITE.mecanique,
        texte,
        empreinte: empreinteSemantique(texte),
      },
    ],
    'ajouter un outil au démon',
  );
  assert.equal(mecanique.source, 'docs/mecaniques/ajouter-un-outil.md');
  assert.ok(mecanique.score > regle.score);
});

/* ------------------------------------------------------------------ */
/* 4. Le plafond et le garde-fou                                       */
/* ------------------------------------------------------------------ */

let rangDEssai = 0;
function faux(source: string, score: number, jetons: number) {
  rangDEssai++;
  return {
    source,
    titre: `titre ${rangDEssai} de ${source}`,
    sujet: 'x',
    priorite: 0,
    texte: `passage ${rangDEssai} — ${'x'.repeat(Math.max(0, jetons * 4 - 20))}`,
    score,
    sens: score,
    mots: 0,
    jetons,
  };
}

test('le choix tient sous le plafond et dit ce qu’il a écarté', () => {
  const choix = choisirPassages(
    [faux('a.md', 0.9, 300), faux('b.md', 0.8, 300), faux('c.md', 0.7, 300)],
    { plafond: 650 },
  );
  assert.equal(choix.gardes.length, 2);
  assert.ok(choix.jetons <= 650);
  assert.equal(choix.ecartes, 1, 'le passage qui ne tenait pas est compté, jamais tu');
});

test('un seul fichier ne prend pas toute la place', () => {
  const choix = choisirPassages(
    [
      faux('a.md', 0.9, 50),
      faux('a.md', 0.85, 50),
      faux('a.md', 0.8, 50),
      faux('a.md', 0.75, 50),
      faux('b.md', 0.5, 50),
    ],
    { plafond: 5000 },
  );
  assert.equal(choix.gardes.filter((p) => p.source === 'a.md').length, 3);
  assert.ok(choix.gardes.some((p) => p.source === 'b.md'));
});

test('un passage sous le seuil n’entre pas, même s’il reste de la place', () => {
  const choix = choisirPassages([faux('a.md', 0.05, 10)], { plafond: 5000 });
  assert.equal(choix.gardes.length, 0);
});

test('le plafond est borné par l’index qu’il remplace', () => {
  assert.equal(plafondDeRecherche(1000), Math.floor(1000 * PART_MAX_DE_L_INDEX));
  assert.equal(plafondDeRecherche(100_000), PLAFOND_PASSAGES_JETONS);
  assert.equal(plafondDeRecherche(0), 0);
});

test('une recherche plus lourde que l’index est refusée', () => {
  assert.equal(rechercheRentable(900, 1200), true);
  assert.equal(rechercheRentable(1300, 1200), false);
  assert.equal(rechercheRentable(0, 1200), false, 'ne rien trouver n’est pas une recherche rentable');
});

test('le bloc envoyé nomme ses sources et DIT qu’il ne montre pas tout', () => {
  const texte = texteDesPassages([faux('docs/regles/cartes.md', 0.9, 20)], 45);
  assert.match(texte, /docs\/regles\/cartes\.md/);
  assert.match(texte, /project_memory/);
  assert.match(texte, /45 faits/);
});

/*
 * LA RECHERCHE A-T-ELLE TROUVÉ QUELQUE CHOSE DE CONVAINCANT ? Ce signal ne
 * change ni le classement ni le seuil : il compare le mieux placé à la
 * moyenne du reste du corpus classé pour cette question.
 */

test('un passage nettement au-dessus du reste du corpus est dit convaincant', () => {
  const classes = [faux('docs/regles/cartes.md', 0.7, 20), faux('docs/regles/quotas.md', 0.2, 20), faux('docs/regles/voix.md', 0.18, 20)];
  assert.equal(rechercheConvaincante(classes), true);
});

test('un lot où tout se vaut à peu près n’est pas dit convaincant', () => {
  const classes = [faux('docs/regles/cartes.md', 0.33, 20), faux('docs/regles/quotas.md', 0.31, 20), faux('docs/regles/voix.md', 0.32, 20)];
  assert.equal(rechercheConvaincante(classes), false);
});

test('sans aucun passage classé, la question ne se pose pas', () => {
  assert.equal(rechercheConvaincante([]), undefined);
});

test('un seul passage dans tout le corpus est dit convaincant, faute de comparaison', () => {
  assert.equal(rechercheConvaincante([faux('docs/regles/cartes.md', 0.15, 20)]), true);
});
