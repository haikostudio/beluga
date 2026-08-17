#!/usr/bin/env node
/*
 * LA RECHERCHE DE PASSAGES, MESURÉE SUR LA VRAIE DOCUMENTATION.
 *
 * Au lancement d'une carte, la demande sert de QUESTION : le démon remonte
 * quelques passages de `docs/` à la place de l'INDEX de la mémoire. Ce contrôle
 * le rejoue sur le dépôt d'où il part, sans moteur et sans démon :
 *
 *  1. l'indexation lit la documentation ET les fichiers du projet, les découpe,
 *     et se rejoue sans rien recalculer ;
 *  2. une demande réelle retrouve le bon fichier — le sens ET les noms exacts ;
 *  3. ce qui part tient sous le plafond et pèse MOINS que l'index remplacé ;
 *  4. une fiche de mécanique passe devant une règle sur la tâche qu'elle décrit ;
 *  5. sans passage assez pertinent, l'index reprend sa place — le repli est dit ;
 *  6. LA RECHERCHE PAR LE SENS (façon RAG) retrouve une règle REFORMULÉE, avec
 *     d'autres mots que les siens — ce que le repli sur les mots ne sait pas faire.
 *
 * Les cinq premières parties tournent SANS MOTEUR DE SENS, sur le repli par les
 * mots : c'est l'ancien comportement, qui doit rester intact. La sixième fait
 * tourner le VRAI moteur — BAAI/bge-m3, en local sur ce serveur — sur un petit
 * corpus fabriqué pour l'occasion : quelques textes, quelques secondes, pas les
 * milliers de passages du dépôt. Moteur absent, elle le DIT et se passe : un
 * contrôle ne se tait jamais.
 *
 *   node scripts/verif-recherche-passages.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* La base se pose dans un dossier JETABLE, AVANT tout import du serveur : un
   contrôle qui indexe ne doit pas écrire dans la base du démon. */
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-recherche-'));
process.env.HAIKODEV_DATA = BASE;
process.on('exit', () => fs.rmSync(BASE, { recursive: true, force: true }));

/* LES CINQ PREMIÈRES PARTIES ÉPROUVENT LE REPLI : on écarte tout moteur de sens
   — le local en pointant le dossier de données ailleurs, l'externe en oubliant
   sa clé — et on rend le moteur local à la sixième. */
const DONNEES_REELLES = process.env.HAIKODEV_DATA_REELLES || '/root/haikodev/data';
delete process.env.HAIKODEV_EMBED_API_KEY;
delete process.env.OPENROUTER_API_KEY;
process.env.HAIKODEV_ENV_FILE = path.join(BASE, 'aucun-environnement');

const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const vecteurs = await import(path.join(RACINE, 'server/dist/vecteurs.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    echecs.push(message);
  }
}

/* ------------------------------------------------------------------ */
/* 1. L'indexation                                                     */
/* ------------------------------------------------------------------ */

console.log("1. L'indexation de la documentation");
const premier = passages.indexerDocumentation('verif', RACINE);
verifier(premier.fichiers > 0, 'des fichiers de documentation ont été trouvés', `${premier.fichiers} fichiers`);
verifier(premier.passages > premier.fichiers, 'un fichier rend plusieurs passages', `${premier.passages} passages`);

const second = passages.indexerDocumentation('verif', RACINE);
verifier(second.modifies === 0, 'rejouée, elle ne recalcule rien', 'indexation incrémentale');
verifier(second.passages === premier.passages, 'et le compte de passages ne bouge pas');

const indexes = passages.passagesIndexes('verif');
const plusGros = Math.max(...indexes.map((p) => p.texte.length));
verifier(
  plusGros <= partage.PLAFOND_PASSAGE_SIGNES,
  'aucun passage ne dépasse le plafond de découpage',
  `${plusGros} signes au plus`,
);
verifier(
  indexes.some((p) => p.source.startsWith('docs/mecaniques/')),
  'les fiches de mécaniques sont indexées',
);

/* ------------------------------------------------------------------ */
/* 2. Ce que la recherche rend, sur des demandes réelles               */
/* ------------------------------------------------------------------ */

const INDEX = { texte: memory.blocMemoire(RACINE), faits: memory.memoryFacts(RACINE).length };
const jetonsIndex = Math.round(INDEX.texte.length / 4);

/*
 * UN CONTRÔLE NE SE MESURE PAS LUI-MÊME.
 *
 * Les quatre demandes ci-dessous sont écrites EN TOUTES LETTRES dans ce
 * fichier, et le même quatuor est recopié dans `scripts/mesure-jetons.mjs`. Or
 * le CODE du projet est indexé depuis qu'on ne se limite plus à `docs/` : ces
 * deux scripts contiennent donc, mot pour mot, la question posée, et sortent en
 * tête. Ils ne répondent à rien — ils la CITENT —, mais ils prennent une des
 * deux places réservées au code (`PASSAGES_CODE_MAX`) et une bonne part du
 * plafond de jetons, si bien que la page de documentation qui répond vraiment
 * ne rentre plus. Constaté sur « Reprendre un déploiement interrompu par un
 * conflit de fusion » : `docs/regles/publication.md` (« Une CONSTRUCTION qui
 * échoue est réparée sur place, comme un conflit ou un contrôle tombé »)
 * arrivait derrière deux citations de la question par ces deux scripts.
 *
 * Même piège, même remède que `scripts/audit-memoire-rag.mjs`, qui retire du
 * corpus tout passage venu de lui-même. Ici on ne peut pas filtrer l'index —
 * `rechercherPourLaTache` le relit lui-même — alors on lui donne un corpus
 * PROPRE : le dépôt tel quel, ses deux miroirs en moins. Rien d'autre ne
 * change : mêmes fichiers, mêmes chemins, même documentation.
 */
const MIROIRS = new Set(['scripts/verif-recherche-passages.mjs', 'scripts/mesure-jetons.mjs']);
const SANS_COPIE = new Set(['node_modules', '.git', '.worktrees', 'dist', 'data', 'coverage']);
const CORPUS_REEL = path.join(BASE, 'corpus-sans-miroir');
fs.cpSync(RACINE, CORPUS_REEL, {
  recursive: true,
  filter: (source) => {
    const relatif = path.relative(RACINE, source);
    if (!relatif) return true;
    if (relatif.split(path.sep).some((part) => SANS_COPIE.has(part))) return false;
    return !MIROIRS.has(relatif.split(path.sep).join('/'));
  },
});

const DEMANDES = [
  { question: "Changer le mot de réveil de l'écoute vocale", attendu: /voix/ },
  { question: 'Reprendre un déploiement interrompu par un conflit de fusion', attendu: /publication|memoire/ },
  { question: 'Ajouter une colonne au tableau des cartes', attendu: /cartes|mecaniques|tableau/ },
  { question: 'Ajouter un outil au démon pour les agents', attendu: /mecaniques|methode/ },
];

console.log('\n2. Une demande réelle retrouve les passages qui y répondent');
let total = 0;
for (const { question, attendu } of DEMANDES) {
  const trouve = await passages.rechercherPourLaTache('verif-sans-miroir', CORPUS_REEL, question, INDEX);
  if (!trouve) {
    verifier(false, `« ${question} » — aucun passage retrouvé`);
    continue;
  }
  total += trouve.jetons;
  const sources = trouve.passages.map((p) => p.source).join(' ');
  verifier(attendu.test(sources), `« ${question} »`, `${trouve.passages.length} passages, ${trouve.jetons} jetons`);
  verifier(
    trouve.jetons < jetonsIndex,
    '  … et cela pèse moins que l’index remplacé',
    `${trouve.jetons} contre ${jetonsIndex}`,
  );
  verifier(trouve.texte.includes('project_memory'), '  … en disant que le reste de la mémoire reste demandable');
}
console.log(
  `\n  → ${Math.round((1 - total / (jetonsIndex * DEMANDES.length)) * 100)} % de moins qu'un index envoyé à chaque lancement.`,
);

/* ------------------------------------------------------------------ */
/* 3. Les mécaniques passent devant                                    */
/* ------------------------------------------------------------------ */

console.log('\n3. Une fiche de mécanique passe devant sur la tâche qu’elle décrit');
for (const fiche of fs.readdirSync(path.join(RACINE, 'docs', 'mecaniques'))) {
  const question = fiche.replace(/\.md$/, '').replace(/-/g, ' ');
  const trouve = await passages.rechercherPourLaTache('verif', RACINE, question, INDEX);
  verifier(
    !!trouve && trouve.passages.some((p) => p.source === `docs/mecaniques/${fiche}`),
    `« ${question} » retrouve sa fiche`,
  );
}

/* ------------------------------------------------------------------ */
/* 4. Le repli : l'index reprend sa place                              */
/* ------------------------------------------------------------------ */

console.log('\n4. Le repli sur l’index, quand la recherche ne vaut pas le coup');
/* Un dossier VRAIMENT vide : depuis que le code est indexé, `os.tmpdir()` n'en
   est plus un — il porte les fichiers d'essai de toute la machine. */
const DOSSIER_VIDE = fs.mkdtempSync(path.join(BASE, 'projet-vide-'));
verifier(
  (await passages.rechercherPourLaTache('verif', RACINE, '   ', INDEX)) === undefined,
  'sans question, la recherche se tait',
);
verifier(
  (await passages.rechercherPourLaTache('verif', RACINE, 'un déploiement', { texte: '  1. Un fait.', faits: 1 })) === undefined,
  'sur une mémoire minuscule, l’index reste le moins cher',
);
verifier(
  (await passages.rechercherPourLaTache('verif', DOSSIER_VIDE, 'un déploiement', INDEX)) === undefined,
  'sur un projet sans documentation ni code, la recherche se tait',
);

/* ------------------------------------------------------------------ */
/* 5. Les fichiers du projet, pas seulement la documentation           */
/* ------------------------------------------------------------------ */

console.log('\n5. Les fichiers du projet entrent aussi dans l’index');
const code = indexes.filter((p) => p.priorite === partage.PRIORITE.code);
verifier(code.length > 0, 'des fichiers de code sont indexés', `${code.length} passages de code`);
verifier(
  !code.some((p) => /node_modules|\/dist\/|\.worktrees/.test(p.source)),
  'les dossiers de machine et les copies de travail restent dehors',
);
const surCode = await passages.rechercherPourLaTache(
  'verif',
  RACINE,
  'la fonction rechercherPourLaTache du fichier server/src/passages.ts',
  INDEX,
);
verifier(
  !!surCode && surCode.passages.some((p) => p.priorite === partage.PRIORITE.code),
  'une demande qui nomme un fichier remonte ce fichier',
  surCode ? surCode.passages.map((p) => p.source).join(', ') : 'aucun passage',
);
verifier(
  !surCode || surCode.passages.filter((p) => p.priorite === partage.PRIORITE.code).length <= partage.PASSAGES_CODE_MAX,
  'le code ne prend jamais toute la place',
  `${partage.PASSAGES_CODE_MAX} au plus`,
);

/* ------------------------------------------------------------------ */
/* 6. La recherche par le SENS : une règle reformulée se retrouve      */
/* ------------------------------------------------------------------ */

console.log('\n6. La recherche par le sens (façon RAG), sur un petit corpus');
/* Le moteur local vit dans le dossier de données RÉEL (`data/vectoriseur`), pas
   dans la base jetable de ce contrôle : on l'y pointe le temps de la partie 6. */
const VECTORISEUR = path.join(DONNEES_REELLES, 'vectoriseur');
const moteurLocal = fs.existsSync(path.join(VECTORISEUR, 'node_modules'));
if (!moteurLocal) {
  console.log(`  … passée : aucun moteur local dans ${DONNEES_REELLES}/vectoriseur.`);
  console.log('    Lance « node scripts/installer-vectoriseur.mjs » pour l’installer.');
} else {
  process.env.HAIKODEV_VECTORISEUR = VECTORISEUR;

  /* Un corpus MINUSCULE et fabriqué : quelques règles écrites avec un
     vocabulaire, et une question posée avec un AUTRE. Le repli sur les mots ne
     peut pas les relier ; le sens, si. */
  const CORPUS = path.join(BASE, 'corpus');
  fs.mkdirSync(path.join(CORPUS, 'docs', 'regles'), { recursive: true });
  const REGLES = {
    'publication.md':
      '# Publication\n\n' +
      "- **La mise en ligne appartient à l'utilisateur** : le démon fusionne le lot, enregistre et " +
      "pousse la branche, mais il n'envoie jamais rien vers le serveur public de sa propre " +
      "initiative. Les deux étapes attendent un clic, et la colonne « En production » les sépare. " +
      "Personne d'autre que l'humain ne franchit la dernière porte : ce qui a été produit reste en " +
      "attente, visible, tant que la main n'a pas tranché. Une intelligence qui pousserait " +
      "d'elle-même jusqu'au bout priverait son propriétaire du seul pouvoir qui compte, celui de " +
      'choisir le moment.\n',
    'voix.md':
      '# Voix\n\n' +
      "- **Le mot de réveil de l'écoute permanente** se compare sans accent ni ponctuation, et " +
      "il ne déclenche l'enregistrement qu'après quatre-vingt-treize millisecondes de parole " +
      'continue, pour ne pas partir sur un raclement de gorge.\n',
    'quotas.md':
      '# Quotas\n\n' +
      "- **Chaque hausse mesurée sur un compte n'est attribuée qu'une fois** : les tours " +
      'simultanés cumulent leur part depuis un repère commun, remis à jour après chaque fin de ' +
      'tour, si bien que deux fins décalées ne repartent jamais du même ancien relevé.\n',
  };
  for (const [nom, texte] of Object.entries(REGLES)) {
    fs.writeFileSync(path.join(CORPUS, 'docs', 'regles', nom), texte);
  }

  /*
   * LA QUESTION NE PARTAGE AUCUN MOT PORTEUR avec la règle visée : ni
   * « publication », ni « mise en ligne », ni « déployer », ni « démon ». Sa
   * part de MOTS EXACTS est donc nulle par construction, et tout son score
   * vient du SENS — c'est exactement ce qu'on veut éprouver.
   *
   * ELLE EST AUSSI LONGUE QU'UN VRAI MESSAGE, et ce n'est pas un détail. La
   * version d'avant tenait en 81 signes ; mesurée sur 67 vrais messages
   * d'utilisateur, la longueur médiane sur ce terrain est de 174 signes
   * (`scripts/audit-memoire-rag.mjs`, section 4bis). Une question deux fois
   * plus courte que la vraie population n'éprouve pas le terrain qu'elle
   * prétend représenter : le cosinus d'un modèle de sens monte avec ce qu'on
   * lui donne à lire, et l'ancienne question sortait à 0,38 — sous le seuil,
   * donc « le sens ne retrouve pas sa règle », alors que le sens la classait
   * bien PREMIÈRE. Ce contrôle mesurait une question trop maigre, pas le moteur.
   *
   * CE QUE LE MODÈLE PERMET, ÉCRIT NOIR SUR BLANC : sans un seul mot commun, le
   * score plafonne à `POIDS_SENS_VECTEUR × cosinus + BONUS_PRIORITE`, et bge-m3
   * rend 0,55 à 0,59 sur une vraie reformulation — soit 0,42 à 0,45 au plus.
   * C'est la LIMITE du moteur, et c'est elle qui a fait remesurer le seuil de
   * ce terrain (`SEUIL_VECTEUR_CONVERSATION`, 0,42, balayé sur les messages).
   * Si ce contrôle tombe un jour ici, la question est donc « le corpus fabriqué
   * a-t-il changé ? » ou « le modèle a-t-il changé ? » — le seuil, lui, se
   * rejuge par le balayage de `scripts/audit-memoire-rag.mjs` (section 5 ter).
   */
  const REFORMULEE =
    'dis-moi, quand un agent a fini son travail, est-ce qu’il peut de lui-même faire passer le ' +
    'résultat chez le client, ou est-ce que ça reste bloqué tant que je n’ai pas donné mon accord ? ' +
    'je ne veux surtout pas d’une machine qui décide toute seule à ma place.';
  const INDEX_CORPUS = {
    texte: Array.from({ length: 40 }, (_, i) => `  ${i + 1}. Une ligne d’index qui résume un fait durable du projet.`).join('\n'),
    faits: 40,
  };

  /* LA VECTORISATION EST UN TRAVAIL DE FOND : elle ne se fait plus au
     lancement d'une carte, mais la nuit, pour tous les projets d'un coup. On la
     déclenche donc ici à la main, comme le fait `scripts/vectoriser-index.mjs`. */
  passages.indexerDocumentation('verif-rag', CORPUS);
  let tranches = 0;
  while (tranches < 10 && (await passages.vectoriserLIndex('verif-rag')).faits) tranches++;
  const couverture = passages.couvertureDesVecteurs('verif-rag');
  verifier(
    couverture.vectorises === couverture.total && couverture.total > 0,
    'tout l’index du corpus est vectorisé',
    `${couverture.vectorises}/${couverture.total} passages`,
  );

  /*
   * ON PASSE PAR LE CHEMIN DE LA CONVERSATION, car c'est là que le sens sert.
   * Une question REFORMULÉE est exactement ce qu'un humain tape dans un fil ;
   * au LANCEMENT d'une carte, mesuré sur 120 cartes réelles, les mots exacts
   * font aussi bien et le sens a été retiré (`SENS_PAR_TERRAIN`). Interroger le
   * lancement reviendrait à éprouver le sens là où il ne tourne plus.
   */
  const parLeSens = await passages.rechercherPourLaSuite('verif-rag', CORPUS, REFORMULEE, []);
  verifier(!!parLeSens, 'la recherche répond');
  verifier(
    !!parLeSens && parLeSens.mode.vecteurs,
    'elle a bien classé par le SENS RÉEL, pas par les mots',
    parLeSens ? `couverture ${Math.round(parLeSens.mode.couverture * 100)} %${parLeSens.mode.raison ? ` — ${parLeSens.mode.raison}` : ''}` : '',
  );
  /*
   * ET LE MÊME CORPUS PAR LE CHEMIN DU LANCEMENT : les mots exacts, annoncés
   * comme un CHOIX. La règle des deux terrains se verrouille ici sur un corpus
   * fabriqué, donc sans dépendre de l'état de la vraie base. La demande d'une
   * CARTE partage le vocabulaire du projet — c'est tout le raisonnement —, on la
   * pose donc comme une carte l'écrit, pas comme un humain la parle.
   */
  const COMME_UNE_CARTE = 'la mise en ligne appartient à l’utilisateur : le démon pousse la branche sans publier';
  const auLancement = await passages.rechercherPourLaTache('verif-rag', CORPUS, COMME_UNE_CARTE, INDEX_CORPUS);
  verifier(
    !!auLancement && !auLancement.mode.vecteurs && auLancement.mode.choisi === true,
    'au LANCEMENT, le même corpus est classé par les MOTS — et c’est dit comme un choix',
    auLancement ? auLancement.mode.raison ?? '' : 'aucune réponse',
  );
  verifier(
    !!auLancement && auLancement.passages[0]?.source === 'docs/regles/publication.md',
    'et une demande écrite avec les mots du projet retrouve bien sa règle',
    auLancement ? auLancement.passages.map((p) => `${p.source} (${p.score.toFixed(2)})`).join(', ') : '',
  );
  /*
   * LE REPLI SUR L'INDEX REDEVIENT POSSIBLE, et c'est un gain à part entière.
   * L'audit du 16/08/2026 l'avait constaté mort : en mode sens, 88 % du corpus
   * franchissait le seuil, donc AUCUNE question ne pouvait plus rendre la place à
   * l'index — pas même une question de cuisine. Par les mots, une demande sans
   * rapport ne trouve plus rien et l'index reprend sa place, comme la règle le dit.
   */
  const horsSujet = await passages.rechercherPourLaTache('verif-rag', CORPUS, REFORMULEE, INDEX_CORPUS);
  verifier(
    horsSujet === undefined,
    'au LANCEMENT, une demande sans un mot du corpus rend sa place à l’index',
    horsSujet ? horsSujet.passages.map((p) => p.source).join(', ') : 'repli sur l’index, comme prévu',
  );
  verifier(
    !!parLeSens && parLeSens.passages[0]?.source === 'docs/regles/publication.md',
    'une question REFORMULÉE retrouve quand même sa règle',
    parLeSens ? parLeSens.passages.map((p) => `${p.source} (${p.score.toFixed(2)})`).join(', ') : '',
  );

  console.log(`  → moteur : ${vecteurs.etatDesVecteurs().moteur}, modèle ${vecteurs.etatDesVecteurs().modele}`);
  /* LA MARGE SE LIT, elle ne se devine pas : sans un seul mot commun, tout le
     score vient du sens, et on veut voir de combien il dépasse la barre. */
  console.log(
    `  → la règle reformulée sort à ${(parLeSens?.passages[0]?.score ?? 0).toFixed(2)} ` +
      `pour un seuil de ${partage.SEUIL_VECTEUR_CONVERSATION} en conversation`,
  );

  /* Le même corpus, la même question, mais SANS moteur de sens : c'est là que se
     voit ce qu'il apporte. On ne juge pas le repli — il a le droit de rater —,
     on AFFICHE la différence. */
  delete process.env.HAIKODEV_VECTORISEUR;
  const parLesMots = await passages.rechercherPourLaSuite('verif-mots', CORPUS, REFORMULEE, []);
  console.log(
    `  → par les mots seuls : ${parLesMots ? parLesMots.passages.map((p) => p.source).join(', ') : 'aucun passage retrouvé'}`,
  );
}

/* ------------------------------------------------------------------ */
/* 7. LE REBOND : la règle nomme son fichier, et il remonte avec elle  */
/* ------------------------------------------------------------------ */

/*
 * LE SECOND PAS DU CLASSEMENT, sur la VRAIE documentation du dépôt. Ici, toute
 * règle NOMME les fichiers qui la portent : une demande retrouve donc très bien
 * la règle, et ratait le fichier de code derrière elle, faute de partager un
 * seul mot avec la question. On vérifie le MÉCANISME, pas un classement précis
 * — celui-là bouge à chaque carte, et se mesure ailleurs
 * (`scripts/audit-memoire-rag.mjs`, 67 % → 78 % sur 120 cartes réelles).
 */
console.log('\n7. Le rebond : le fichier NOMMÉ par la meilleure règle remonte avec elle');
const DEMANDES_REBOND = [
  'empêcher un redémarrage du serveur pendant qu’une publication tourne',
  'une carte interrompue par une panne ne doit pas passer pour terminée',
  'reprendre un tour coupé par la limite d’un compte',
];
let rebondsUtiles = 0;
for (const question of DEMANDES_REBOND) {
  const sans = partage.classerPassages(indexes, question, { rebond: false });
  const avec = partage.rebondSurLesFichiersCites(sans, question);
  const cites = new Set(
    sans
      .filter((p) => p.priorite !== partage.PRIORITE.code)
      .slice(0, partage.GRAINES_DU_REBOND)
      .flatMap((p) => partage.cheminsCites(`${p.texte} ${p.titre}`)),
  );
  const monte = avec.filter(
    (p, rang) => cites.has(p.source) && rang < sans.findIndex((q) => q.source === p.source && q.titre === p.titre),
  );
  if (monte.length) rebondsUtiles += 1;
  verifier(
    avec[0].score >= sans[0].score,
    `« ${question.slice(0, 44)}… »`,
    `${cites.size} fichiers cités par les meilleures règles, ${monte.length} passages remontés`,
  );
}
verifier(rebondsUtiles > 0, 'au moins une demande gagne un fichier grâce au rebond', `${rebondsUtiles} sur ${DEMANDES_REBOND.length}`);

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`✗ ÉCHEC : ${echecs.length} contrôle(s) tombé(s).`);
  process.exit(1);
}
console.log('✓ La recherche remonte les passages qui répondent, sous plafond, sans jamais coûter plus que l’index.');
