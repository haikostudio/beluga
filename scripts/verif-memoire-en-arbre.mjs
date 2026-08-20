#!/usr/bin/env node
/*
 * LA MÉMOIRE EN ARBRE, MESURÉE. Un projet hébergé par HaikoDev hérite-t-il de ce
 * que la plateforme a appris — et le fait-il SANS gonfler ce qui part au moteur ?
 *
 * Six constats, sur un faux HaikoDev et un faux projet, tous deux jetables :
 *
 *  1. la couche amont n'emporte QUE les documents hérités — jamais le code de
 *     HaikoDev, jamais ses plans de chef d'orchestre ;
 *  2. une règle de plateforme que le projet n'a pas remonte quand même, et le
 *     bloc envoyé DIT d'où elle vient ;
 *  3. la documentation du projet garde la tête quand elle répond : l'héritage
 *     recule, il ne double pas ;
 *  4. sur HaikoDev lui-même, RIEN n'est joint — sinon chaque règle remonterait
 *     deux fois ;
 *  5. ce qui part au moteur reste sous le plafond : l'héritage n'a jamais plus
 *     d'un cinquième de la place, premier passage mis à part ;
 *  6. `project_memory` monte d'un cran, mais seulement quand le projet n'a rien
 *     à dire sur le sujet demandé.
 *
 * Aucun moteur, aucun démon, aucun quota dépensé : le mécanisme tout seul, donc
 * rejouable partout.
 *
 *   node scripts/verif-memoire-en-arbre.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* La base est une VRAIE base, mais posée dans un dossier jetable : un contrôle
   qui indexe ne doit jamais écrire dans celle du serveur. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-arbre-base-'));
process.env.HAIKODEV_DATA = bacASable;

/* AUCUN APPEL RÉSEAU : on éprouve le repli par les mots, qui doit suffire. */
delete process.env.HAIKODEV_EMBED_API_KEY;
delete process.env.OPENROUTER_API_KEY;
process.env.HAIKODEV_ENV_FILE = path.join(bacASable, 'aucun-environnement');

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const passages = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/* ------------------------------------------------------------------ */
/* Un faux HaikoDev, et un projet qui en hérite                        */
/* ------------------------------------------------------------------ */

const REGLE_AMONT =
  "- **Une carte NAÎT dans « Planifié »** : rien ne part au moteur avant le lancement, et un agent n'est " +
  "jamais démarré par le seul fait qu'une carte ait été écrite. Le premier jeton se paie au clic, pas à la " +
  'rédaction.';
const FAIT_AMONT =
  "Le déploiement automatique est un interrupteur du projet, éteint par défaut, posé en tête de la colonne " +
  '« Terminé » : une carte qui attend une réponse ne le franchit jamais.';
const REGLE_LOCALE =
  '- **Le panier du visiteur garde ses articles trente jours** : il est rangé sur le compte, pas dans le ' +
  "navigateur, et un article épuisé y reste barré au lieu de disparaître sans rien dire au client.";

const amont = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-arbre-amont-'));
fs.mkdirSync(path.join(amont, 'docs', 'regles'), { recursive: true });
fs.mkdirSync(path.join(amont, 'docs', 'memoire'), { recursive: true });
fs.mkdirSync(path.join(amont, 'docs', 'plans'), { recursive: true });
fs.mkdirSync(path.join(amont, 'server', 'src'), { recursive: true });
fs.writeFileSync(
  path.join(amont, 'docs', 'regles', 'cartes.md'),
  `# Cartes — règles du moteur\n\n## Naissance d'une carte\n\n${REGLE_AMONT}\n`,
);
fs.writeFileSync(
  path.join(amont, 'docs', 'memoire', 'publication.md'),
  `# Mémoire du projet — Publication\n\n- ${FAIT_AMONT}\n`,
);
fs.writeFileSync(
  path.join(amont, 'docs', 'plans', 'un-plan.md'),
  "# Plan — la naissance d'une carte\n\nLes étapes que le chef d'orchestre avait prévues pour cette carte-là.\n",
);
fs.writeFileSync(
  path.join(amont, 'server', 'src', 'cartes.ts'),
  'export function carteNaitDansPlanifie() {\n  return true;\n}\n',
);

const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-arbre-projet-'));
fs.mkdirSync(path.join(projet, 'docs', 'regles'), { recursive: true });
fs.writeFileSync(
  path.join(projet, 'docs', 'regles', 'panier.md'),
  `# Panier — règles du projet\n\n## Durée de garde\n\n${REGLE_LOCALE}\n`,
);

/** Un index de mémoire assez gros pour que la recherche ait quelque chose à gagner. */
function indexDEssai(faits = 40) {
  return {
    texte: Array.from(
      { length: faits },
      (_, i) => `  ${i + 1}. Une ligne d'index qui résume un fait durable du projet, tronquée comme il se doit.`,
    ).join('\n'),
    faits,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Ce qui s'hérite, et ce qui reste dehors                          */
/* ------------------------------------------------------------------ */

console.log('\n1. Ce qui s’hérite de HaikoDev');

const fichiers = passages.fichiersDeLAmont(amont);
const sources = fichiers.map((f) => f.source);
verifier(
  sources.includes(`${partage.PREFIXE_SOURCE_AMONT}docs/regles/cartes.md`),
  'les RÈGLES de HaikoDev s’héritent',
);
verifier(
  sources.includes(`${partage.PREFIXE_SOURCE_AMONT}docs/memoire/publication.md`),
  'ses FAITS durables aussi',
);
verifier(
  !sources.some((s) => s.includes('docs/plans/')),
  'ses PLANS de chef d’orchestre restent chez lui — ils sont écrits pour UNE carte de HaikoDev',
);
verifier(
  !sources.some((s) => s.endsWith('.ts')),
  'son CODE ne part jamais : il n’apprend rien à un agent qui travaille ailleurs',
);
verifier(
  fichiers.every((f) => f.sujet.startsWith('amont-')),
  'chaque sujet hérité est préfixé : il ne se confond pas avec celui du projet',
);

/* ------------------------------------------------------------------ */
/* 2. L'héritage remonte, et il se dit                                 */
/* ------------------------------------------------------------------ */

console.log('\n2. Ce qu’un projet reçoit quand il n’a pas la règle');

const herite = await passages.rechercherPourLaTache(
  'arbre-heritier',
  projet,
  'à quel moment une carte est-elle lancée, et quand le premier jeton part-il au moteur ?',
  indexDEssai(),
  '',
  amont,
);
verifier(Boolean(herite), 'la recherche répond');
verifier(
  Boolean(herite?.passages.some((p) => partage.estPassageAmont(p.source))),
  'la règle de plateforme remonte alors que le projet ne l’a pas',
);
verifier(/Planifié/.test(herite?.texte ?? ''), 'et c’est bien SON texte qui part, pas un renvoi');
verifier(
  /viennent de HaikoDev/.test(herite?.texte ?? ''),
  'le rappel de premier niveau accompagne le passage : l’agent sait que ce fichier n’est pas chez lui',
);

/* ------------------------------------------------------------------ */
/* 3. Le projet garde la tête quand il répond                          */
/* ------------------------------------------------------------------ */

console.log('\n3. La documentation du projet reste chez elle');

const local = await passages.rechercherPourLaTache(
  'arbre-local',
  projet,
  'combien de temps le panier du visiteur garde-t-il ses articles ?',
  indexDEssai(),
  '',
  amont,
);
verifier(
  local?.passages[0]?.source === 'docs/regles/panier.md',
  'la règle du projet passe en tête : l’héritage recule, il ne double pas',
);

/* ------------------------------------------------------------------ */
/* 4. Sur HaikoDev lui-même, rien n'est joint                          */
/* ------------------------------------------------------------------ */

console.log('\n4. Sur HaikoDev lui-même');

verifier(!partage.amontApplicable({ projet: amont, amont }), 'la couche ne s’applique pas à son propre dépôt');
const soi = await passages.rechercherPourLaTache(
  'arbre-soi',
  amont,
  'à quel moment une carte est-elle lancée ?',
  indexDEssai(),
  '',
  amont,
);
verifier(
  !soi?.passages.some((p) => partage.estPassageAmont(p.source)),
  'aucune règle ne remonte deux fois, sous deux noms',
);

/* Le SEUIL propre à l'amont : sans lui, la vaste documentation de HaikoDev
   répondrait à tout, et l'index de la mémoire ne pourrait plus jamais reprendre
   sa place — la mort du repli, déjà constatée une fois par l'audit du
   16/08/2026. */
const horsSujet = await passages.rechercherPourLaTache(
  'arbre-hors-sujet',
  projet,
  'dis-moi, est-ce que quelqu’un peut de lui-même envoyer le résultat au client sans mon accord ?',
  indexDEssai(),
  '',
  amont,
);
verifier(
  !horsSujet?.passages.some((p) => partage.estPassageAmont(p.source)),
  'une question qui n’appelle pas de règle de plateforme n’en traîne aucune',
  `seuil de l’amont : ${partage.seuilDeLAmont(partage.SCORE_MINIMUM).toFixed(2)} contre ${partage.SCORE_MINIMUM} pour une page du projet`,
);

/* ------------------------------------------------------------------ */
/* 5. Ce qui part au moteur ne gonfle pas                              */
/* ------------------------------------------------------------------ */

console.log('\n5. Le poids de ce qui part au moteur');

const jetonsHerite = herite?.jetons ?? 0;
verifier(
  jetonsHerite > 0 && jetonsHerite < (herite?.jetonsIndex ?? 0),
  `le bloc envoyé (${jetonsHerite} jetons) reste plus léger que l’index qu’il remplace (${herite?.jetonsIndex ?? 0})`,
);

const jetonsDeLAmont = (herite?.passages ?? [])
  .filter((p) => partage.estPassageAmont(p.source))
  .reduce((somme, p) => somme + p.jetons, 0);
const suivants = (herite?.passages ?? [])
  .filter((p) => partage.estPassageAmont(p.source))
  .slice(1)
  .reduce((somme, p) => somme + p.jetons, 0);
const plafond = partage.plafondDeLAmont(partage.plafondDeRecherche(herite?.jetonsIndex ?? 0));
verifier(
  suivants <= plafond,
  `l’héritage tient dans sa part (${suivants} jetons après le premier passage, plafond ${plafond})`,
);
console.log(
  `    (dont ${jetonsDeLAmont} jetons hérités sur ${jetonsHerite} envoyés — premier passage compris)`,
);

/* ------------------------------------------------------------------ */
/* 6. Le cran au-dessus, à la demande                                  */
/* ------------------------------------------------------------------ */

console.log('\n6. Redemander le détail d’un sujet');

const surSonSujet = memory.detailProjet(projet, 'panier', [], amont);
verifier(
  !/HÉRITÉ DE HAIKODEV/.test(surSonSujet.texte),
  'sur un sujet que le projet a écrit, sa règle à lui fait foi',
);

const surLAutre = memory.detailProjet(projet, 'cartes', [], amont);
verifier(/HÉRITÉ DE HAIKODEV/.test(surLAutre.texte), 'sur un sujet qu’il n’a pas, la plateforme répond à sa place');
verifier(/Planifié/.test(surLAutre.texte), 'et elle rend la règle entière, pas un renvoi');

const sansAmont = memory.detailProjet(projet, 'cartes', []);
verifier(
  !/HÉRITÉ DE HAIKODEV/.test(sansAmont.texte),
  'sans dépôt amont, l’outil se comporte exactement comme avant',
);

/* ------------------------------------------------------------------ */

fs.rmSync(bacASable, { recursive: true, force: true });
fs.rmSync(amont, { recursive: true, force: true });
fs.rmSync(projet, { recursive: true, force: true });

if (echecs.length) {
  console.error(`\n${echecs.length} constat(s) en échec.`);
  process.exit(1);
}
console.log('\nLa mémoire en arbre tient : un projet hérite de HaikoDev, sans que le prompt gonfle.');
