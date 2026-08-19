#!/usr/bin/env node
/*
 * L'AUDIT CHIFFRÉ DE LA MÉMOIRE — LA RECHERCHE DE PASSAGES VAUT-ELLE CE QU'ELLE COÛTE ?
 *
 * Les contrôles existants disent que la recherche MARCHE : `verif-recherche-passages.mjs`
 * éprouve les règles sur un corpus fabriqué, `verif-recherche-par-le-sens.mjs` pose
 * quelques demandes écrites à la main et regarde si la bonne page remonte. Aucun des
 * deux ne répond à la question de l'utilisateur : sur les VRAIES demandes, combien
 * économise-t-on, et remonte-t-on VRAIMENT ce qu'il fallait ?
 *
 * D'où ce relevé. Il ne juge rien à l'œil : il rejoue les cartes RÉELLEMENT exécutées
 * sur ce projet et se donne une VÉRITÉ DE TERRAIN objective — les fichiers que chaque
 * carte a effectivement modifiés, lus dans git sur le commit de fusion de sa branche.
 * Une recherche est « juste » quand elle a remonté au moins un passage venu d'un
 * fichier que la carte allait toucher. Personne ne décide après coup si le résultat
 * lui plaît.
 *
 *   node scripts/audit-memoire-rag.mjs               # 60 cartes
 *   node scripts/audit-memoire-rag.mjs --cartes=150  # plus large, plus lent
 *   node scripts/audit-memoire-rag.mjs --json=/tmp/audit.json
 *
 * IL N'ÉCRIT RIEN DANS LA BASE DU DÉMON : la base est d'abord COPIÉE (`VACUUM INTO`)
 * dans un dossier jetable, et tout le relevé travaille sur la copie. Le démon peut
 * tourner pendant ce temps.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valeur = (nom, defaut) => {
  const trouve = args.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : defaut;
};
const CARTES_VOULUES = Number(valeur('cartes', 60));
/*
 * Les MESSAGES DE CONVERSATION rejoués à côté des cartes : l'autre terrain, celui
 * des questions écrites comme on parle. `--messages=0` s'en tient aux cartes.
 */
const MESSAGES_VOULUS = Number(valeur('messages', 100));
/** En deçà, un message n'est qu'un « ok » ou un « vas-y » : rien à chercher dedans. */
const SIGNES_MIN_MESSAGE = 15;
const SORTIE_JSON = valeur('json', '');
/*
 * La base du DÉMON est la source : c'est elle qui porte l'index et les vecteurs
 * réellement servis aux agents. On n'en lit qu'une COPIE.
 */
const DONNEES_REELLES = valeur('donnees', '/root/haikodev/data');

/* ------------------------------------------------------------------ */
/* La copie de la base : rien n'est écrit chez le démon                */
/* ------------------------------------------------------------------ */

const JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-memoire-'));
process.on('exit', () => fs.rmSync(JETABLE, { recursive: true, force: true }));

const source = path.join(DONNEES_REELLES, 'haikodev.db');
if (!fs.existsSync(source)) {
  console.error(`Aucune base à ${source}. Passe --donnees=<dossier> si elle vit ailleurs.`);
  process.exit(1);
}
{
  // `VACUUM INTO` prend un instantané cohérent d'une base EN COURS D'USAGE, journal
  // compris — une simple copie de fichier prendrait la base au milieu d'une écriture.
  const lecture = new Database(source, { readonly: true });
  lecture.exec(`VACUUM INTO '${path.join(JETABLE, 'haikodev.db').replace(/'/g, "''")}'`);
  lecture.close();
}

process.env.HAIKODEV_DATA = JETABLE;
// Les compétences partagées et le moteur de vectorisation vivent HORS de la base :
// on les laisse pointer sur les vrais dossiers, en lecture.
process.env.HAIKODEV_COMPETENCES ??= path.join(DONNEES_REELLES, 'competences');
process.env.HAIKODEV_VECTORISEUR ??= path.join(DONNEES_REELLES, 'vectoriseur');

const passagesMod = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const vecteursMod = await import(path.join(RACINE, 'server/dist/vecteurs.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const shared = await import(path.join(RACINE, 'shared/dist/index.js'));

const {
  MARGE_SEUIL_SUITE,
  PASSAGES_CODE_MAX,
  PASSAGES_SUITE_MAX,
  PLAFOND_PASSAGES_SUITE_JETONS,
  POIDS_MOTS_VECTEUR,
  POIDS_SENS_VECTEUR,
  PART_MINIMALE_DU_PREMIER,
  SCORE_MINIMUM,
  SCORE_MINIMUM_VECTEUR,
  SEUIL_VECTEUR_CONVERSATION,
  choisirPassages,
  classerPassages,
  jetonsApproches,
  plafondDeRecherche,
  rebondSurLesFichiersCites,
  seuilDeSuite,
  texteDuSommaire,
} = shared;

/* ------------------------------------------------------------------ */
/* Le projet audité, et la vérité de terrain venue de git              */
/* ------------------------------------------------------------------ */

const projets = store.listProjects().filter((p) => !p.archived);
const projet = projets.find((p) => p.isSelf) ?? projets.find((p) => p.name === 'HaikoDev');
if (!projet) {
  console.error('Aucun projet HaikoDev dans cette base.');
  process.exit(1);
}
/*
 * ON INDEXE LE DÉPÔT D'OÙ LE SCRIPT PART, jamais un chemin écrit en dur : lancé
 * depuis une copie de travail, il doit juger CETTE copie. Les sources étant
 * relatives, l'index reste comparable à celui du démon.
 */
const CHEMIN_PROJET = RACINE;

function git(...arguments_) {
  return execFileSync('git', arguments_, {
    cwd: CHEMIN_PROJET,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Chaque branche de carte fusionnée, avec le commit qui l'a fusionnée. */
function fusionsParBranche() {
  const fusions = new Map();
  const journal = git('log', '--merges', '--format=%H%x09%P%x09%s', '-n', '1500');
  for (const ligne of journal.split('\n')) {
    const [commit, parents, sujet] = ligne.split('\t');
    const nom = sujet?.match(/Merge branch '([^']+)'/);
    if (!nom || fusions.has(nom[1])) continue;
    const [avant, apres] = (parents ?? '').split(' ');
    if (!avant || !apres) continue;
    fusions.set(nom[1], { commit, avant, apres });
  }
  return fusions;
}

/** Les fichiers qu'une branche a réellement modifiés, chemins relatifs au dépôt. */
function fichiersDeLaBranche(fusion) {
  try {
    return git('diff', '--name-only', `${fusion.avant}...${fusion.apres}`)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const baseCopiee = new Database(path.join(JETABLE, 'haikodev.db'), { readonly: true });
const fusions = fusionsParBranche();

/**
 * L'ÉCHANTILLON : de vraies cartes, avec leur demande telle qu'elle est partie et
 * les fichiers que leur travail a touchés. Une carte sans branche fusionnée n'a pas
 * de vérité de terrain : elle est écartée, et le compte le dit.
 */
const toutes = [];
let sansFusion = 0;
for (const ligne of baseCopiee
  .prepare(
    `SELECT id, title, description, data FROM cards
      WHERE project_id = ? AND column_key IN ('in_production', 'archived', 'to_deploy')
      ORDER BY created_at DESC LIMIT 400`,
  )
  .all(projet.id)) {
  const branche = JSON.parse(ligne.data || '{}').github?.branch;
  const fusion = branche ? fusions.get(branche) : undefined;
  if (!fusion) {
    sansFusion += 1;
    continue;
  }
  const fichiers = fichiersDeLaBranche(fusion).filter((f) => !f.startsWith('scripts/audit-memoire-rag'));
  if (!fichiers.length) {
    sansFusion += 1;
    continue;
  }
  toutes.push({
    id: ligne.id,
    titre: ligne.title,
    // La QUESTION est composée exactement comme le démon la compose au lancement
    // d'une carte (`preparerLeTour`, server/src/runtime.ts) : titre puis description.
    question: [ligne.title, ligne.description].filter(Boolean).join('\n'),
    fichiers: new Set(fichiers),
  });
}

if (!toutes.length) {
  console.error('Aucune carte fusionnée à rejouer : rien à mesurer.');
  process.exit(1);
}

/**
 * LES FICHIERS QU'UNE CARTE SUR QUATRE TOUCHE ne prouvent rien : `CLAUDE.md` est
 * réécrit par presque chaque carte, le remonter n'est pas une réussite de la
 * recherche. On garde donc DEUX vérités : la LARGE (tout fichier touché) et la
 * STRICTE (les fichiers propres à cette carte-là).
 *
 * L'omniprésence se compte sur TOUTES les cartes retrouvées, jamais sur le seul
 * échantillon rejoué : sur huit cartes, « touché deux fois » suffirait à écarter un
 * fichier, et la vérité stricte se viderait d'elle-même.
 */
const OMNIPRESENT = 0.25;
const compteParFichier = new Map();
for (const carte of toutes) {
  for (const fichier of carte.fichiers) compteParFichier.set(fichier, (compteParFichier.get(fichier) ?? 0) + 1);
}
const omnipresents = new Set(
  [...compteParFichier].filter(([, n]) => n / toutes.length >= OMNIPRESENT).map(([f]) => f),
);
for (const carte of toutes) {
  carte.propres = new Set([...carte.fichiers].filter((f) => !omnipresents.has(f)));
}
const cartes = toutes.slice(0, CARTES_VOULUES);

/* ------------------------------------------------------------------ */
/* Les MESSAGES DE CONVERSATION, et leur vérité de terrain             */
/* ------------------------------------------------------------------ */

/*
 * DEUX TERRAINS, PAS UN. La demande d'une carte est un titre et une description
 * ÉCRITS avec le vocabulaire du projet ; un message de conversation est tapé
 * comme on parle, souvent sans nommer un seul fichier. Ce sont deux populations
 * de questions différentes, et rien ne dit qu'elles appellent le même réglage —
 * c'est exactement ce que cette carte doit trancher.
 *
 * La vérité de terrain reste la MÊME et reste objective : le message a été écrit
 * à l'agent d'une carte, cette carte a fusionné une branche, et cette branche a
 * modifié des fichiers. Un message d'humeur (« ça marche toujours pas ») compte
 * donc comme un échec s'il ne remonte rien du bon endroit — c'est un plancher,
 * comme pour les cartes.
 */
const parCarte = new Map(toutes.map((c) => [c.id, c]));
const messages = [];
let messagesEcartes = 0;
for (const ligne of baseCopiee
  .prepare(
    `SELECT m.data AS data, a.card_id AS card_id
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
      WHERE m.role = 'user' AND a.role = 'task' AND a.project_id = ? AND a.card_id IS NOT NULL
      ORDER BY m.created_at DESC LIMIT 400`,
  )
  .all(projet.id)) {
  const carte = parCarte.get(ligne.card_id);
  let contenu = '';
  try {
    contenu = (JSON.parse(ligne.data || '{}').content || '').trim();
  } catch {
    contenu = '';
  }
  // Trop court, c'est un « ok » ou un « vas-y » : il n'y a rien à chercher dedans.
  if (!carte || contenu.length < SIGNES_MIN_MESSAGE) {
    messagesEcartes += 1;
    continue;
  }
  messages.push({ question: contenu, carte });
}

/* ------------------------------------------------------------------ */
/* Le corpus tel qu'il est indexé                                      */
/* ------------------------------------------------------------------ */

console.log('AUDIT DE LA MÉMOIRE — ce que la recherche de passages économise, et ce qu’elle retrouve\n');

const moteur = vecteursMod.etatDesVecteurs();
console.log('1. LE MOTEUR ET LE CORPUS');
console.log(`   moteur de sens : ${moteur.moteur === 'local' ? 'LOCAL, sur ce serveur' : 'EXTERNE, facturé'} · ${moteur.modele} · ${moteur.pret ? 'prêt' : 'INDISPONIBLE'}`);

// L'index de la copie est celui du démon ; on le remet à jour sur l'état du dépôt.
const indexation = passagesMod.indexerDocumentation(projet.id, CHEMIN_PROJET);
/*
 * CE RELEVÉ NE SE MESURE PAS LUI-MÊME. Ses questions « hors sujet » (la tarte,
 * le vol pour Tokyo) sont écrites en toutes lettres plus bas, et ce fichier est
 * indexé comme n'importe quel autre : sans cette exclusion, la question retrouve
 * SA PROPRE COPIE — mesuré le 16/08/2026, mots exacts à 0,67 — et le relevé
 * conclut que le seuil ne filtre plus rien alors qu'il n'a mesuré que sa trace.
 * Même piège que pour `scripts/verif-recherche-par-le-sens.mjs`, et il vaut pour
 * la vérité de terrain (déjà écartée plus haut) comme pour le corpus.
 *
 * LE RAPPORT COMPTE AUTANT QUE LE SCRIPT : `docs/audit-memoire-rag.md` cite ces
 * mêmes questions pour expliquer ce qu'elles ont montré, et il remontait à leur
 * place (0,52). D'où le filtre sur le NOM, script et rapport confondus.
 */
const tousLesPassages = passagesMod
  .passagesIndexes(projet.id)
  .filter((p) => !p.source.includes('audit-memoire-rag'));
const documents = tousLesPassages.filter((p) => p.priorite >= 0);
const code = tousLesPassages.filter((p) => p.priorite < 0);
const couverture = passagesMod.couvertureDesVecteurs(projet.id);
const signesMoyens = (liste) => (liste.length ? Math.round(liste.reduce((t, p) => t + p.texte.length, 0) / liste.length) : 0);

console.log(`   fichiers indexés : ${indexation.fichiers} · passages : ${tousLesPassages.length} (${documents.length} documentation, ${code.length} code)`);
console.log(`   taille moyenne d’un passage : ${signesMoyens(documents)} signes en documentation, ${signesMoyens(code)} en code`);
console.log(`   documentation vectorisée : ${couverture.vectorises} / ${couverture.total} — ${Math.round((couverture.vectorises / Math.max(1, couverture.total)) * 100)} %`);

const faits = memory.memoryFacts(CHEMIN_PROJET);
const blocIndex = memory.blocMemoire(CHEMIN_PROJET);
const sommaire = texteDuSommaire(faits);
const jetonsIndex = jetonsApproches(blocIndex.length);
console.log(`   l’index de mémoire qu’on remplace : ${faits.length} faits, ${jetonsIndex} jetons · plafond autorisé à la recherche : ${plafondDeRecherche(jetonsIndex)} jetons`);
console.log(`   échantillon : ${cartes.length} cartes rejouées, sur ${toutes.length} retrouvées avec leur vérité de terrain (${sansFusion} cartes lues sans branche fusionnée, donc sans preuve)\n`);

/* ------------------------------------------------------------------ */
/* 2. Ce qui part vraiment, carte par carte                            */
/* ------------------------------------------------------------------ */

const moyenne = (liste) => (liste.length ? liste.reduce((t, v) => t + v, 0) / liste.length : 0);
const mediane = (liste) => {
  if (!liste.length) return 0;
  const tri = [...liste].sort((a, b) => a - b);
  return tri[Math.floor(tri.length / 2)];
};

const releves = [];
console.log('2. CE QUI PART AU MOTEUR, SUR LES VRAIES DEMANDES');
const departChrono = Date.now();

for (const carte of cartes) {
  const debut = Date.now();
  const trouve = await passagesMod.rechercherPourLaTache(projet.id, CHEMIN_PROJET, carte.question, {
    texte: blocIndex,
    faits: faits.length,
    sommaire,
  });
  const ms = Date.now() - debut;
  if (!trouve) {
    releves.push({ carte: carte.titre, repli: true, ms });
    continue;
  }
  const gardes = trouve.passages;
  const sources = new Set(gardes.map((p) => p.source));
  releves.push({
    carte: carte.titre,
    repli: false,
    ms,
    mode: trouve.mode.vecteurs ? 'sens' : 'mots',
    jetons: trouve.jetons,
    jetonsIndex: trouve.jetonsIndex,
    passages: gardes.length,
    passagesCode: gardes.filter((p) => p.priorite < 0).length,
    jetonsCode: gardes.filter((p) => p.priorite < 0).reduce((t, p) => t + p.jetons, 0),
    ecartes: trouve.ecartes,
    scorePremier: gardes[0]?.score ?? 0,
    scoreDernier: gardes[gardes.length - 1]?.score ?? 0,
    touche: [...sources].some((s) => carte.fichiers.has(s)),
    toucheStrict: [...sources].some((s) => carte.propres.has(s)),
  });
}

const servis = releves.filter((r) => !r.repli);
const replis = releves.length - servis.length;
const economies = servis.map((r) => 1 - r.jetons / r.jetonsIndex);

console.log(`   recherches servies : ${servis.length} / ${releves.length}${replis ? ` · ${replis} repli(s) sur l’index complet` : ''}`);
console.log(`   mode retenu : ${servis.filter((r) => r.mode === 'sens').length} par le SENS, ${servis.filter((r) => r.mode === 'mots').length} par les MOTS`);
console.log(`   ce qui part : ${Math.round(moyenne(servis.map((r) => r.jetons)))} jetons en moyenne (médiane ${mediane(servis.map((r) => r.jetons))}) contre ${jetonsIndex} pour l’index`);
console.log(`   ÉCONOMIE MOYENNE : ${Math.round(moyenne(economies) * 100)} % · la plus faible ${Math.round(Math.min(...economies) * 100)} % · la plus forte ${Math.round(Math.max(...economies) * 100)} %`);
console.log(`   passages retenus : ${moyenne(servis.map((r) => r.passages)).toFixed(1)} en moyenne sur 7 possibles · dont ${moyenne(servis.map((r) => r.passagesCode)).toFixed(1)} de code`);
console.log(`   part du poids prise par le code : ${Math.round((moyenne(servis.map((r) => r.jetonsCode)) / Math.max(1, moyenne(servis.map((r) => r.jetons)))) * 100)} %`);
console.log(`   score du mieux placé : ${moyenne(servis.map((r) => r.scorePremier)).toFixed(2)} · du dernier retenu : ${moyenne(servis.map((r) => r.scoreDernier)).toFixed(2)}`);
console.log(`   temps d’une recherche : ${Math.round(moyenne(servis.map((r) => r.ms)))} ms en moyenne, ${Math.round((Date.now() - departChrono) / 1000)} s pour les ${releves.length} demandes`);
console.log(`   PERTINENCE — au moins un passage venu d’un fichier que la carte a réellement modifié : ${servis.filter((r) => r.touche).length} / ${servis.length} (${Math.round((servis.filter((r) => r.touche).length / Math.max(1, servis.length)) * 100)} %)`);
console.log(`   … et en écartant les fichiers que plus d’une carte sur quatre réécrit : ${servis.filter((r) => r.toucheStrict).length} / ${servis.length} (${Math.round((servis.filter((r) => r.toucheStrict).length / Math.max(1, servis.length)) * 100)} %)\n`);

/* ------------------------------------------------------------------ */
/* 3. Le SENS contre les MOTS, et le rang de la bonne page             */
/* ------------------------------------------------------------------ */

/*
 * LA SEULE COMPARAISON HONNÊTE. Tout est identique — mêmes passages, même plafond,
 * même choix sous plafond — sauf la façon de NOTER : d'un côté le vrai vecteur de
 * sens, de l'autre l'empreinte de mots d'avant (`empreinteSemantique`). C'est
 * exactement le « avant / après » que l'utilisateur demande.
 *
 * On en profite pour regarder PLUS LOIN que les sept places : à quel rang la
 * première bonne page arrive dans le classement entier. C'est ce qui départage
 * « la recherche classe mal » de « le plafond coupe trop tôt ».
 */
console.log('3. LE SENS CONTRE LES MOTS — même corpus, même plafond, seule la notation change');

const plafond = plafondDeRecherche(jetonsIndex);
function choisir(classes, minimum) {
  /*
   * `partDuPremier: 0` COUPE LE SECOND FILTRE. Les sections qui suivent balaient
   * le SEUIL : elles doivent le mesurer SEUL, sinon la part du mieux placé
   * écarterait des passages et on lirait son effet à elle sur la ligne du seuil.
   * La part a son propre balayage (« 5 quater » et « 5 quinquies »).
   */
  return choisirPassages(classes, { plafond, minimum, maxCode: PASSAGES_CODE_MAX, partDuPremier: 0 });
}
/** Le rang (1 = premier) du premier passage venu d'un fichier attendu, 0 si aucun. */
function rangDuBon(classes, attendus) {
  const rang = classes.findIndex((p) => attendus.has(p.source));
  return rang < 0 ? 0 : rang + 1;
}

/*
 * LES SEUILS QU'ON ESSAIE, sur les MÊMES cartes et les MÊMES classements.
 *
 * Le seuil de pertinence ne se choisit pas à l'intuition : il se BALAIE. Pour
 * chaque valeur, on regarde ce qu'elle coûte (des cartes qui perdent la bonne
 * page, des passages en moins) et ce qu'elle rapporte (une question hors sujet
 * qui repart les mains vides, donc le repli sur l'index qui reprend son rôle).
 * Le classement d'une carte est calculé UNE fois et jugé par tous les seuils :
 * le balayage ne coûte donc presque rien de plus que le duel.
 */
const SEUILS_ESSAYES = [
  0.24, 0.28, 0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.55, 0.6,
];
/*
 * LES DEUX GRILLES DU SEUIL DE LANCEMENT (section « 5 quater »), déclarées ici
 * parce que le balayage de la CONVERSATION, plus bas, s'en sert aussi : la part
 * du mieux placé n'a pas d'échelle, elle vaut donc sur les deux terrains et doit
 * être mesurée sur les deux.
 */
const PLANCHERS_ESSAYES = [0.14, 0.18, 0.2, 0.22, 0.24, 0.26, 0.28, 0.3, 0.34];
const PARTS_ESSAYEES = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75];

const balayage = new Map(
  SEUILS_ESSAYES.map((seuil) => [
    seuil,
    { touche: 0, toucheStrict: 0, vides: 0, passages: [], auDessus: [], horsSujet: [] },
  ]),
);

const duel = {
  total: 0,
  sens: 0,
  mots: 0,
  sensStrict: 0,
  motsStrict: 0,
  communs: 0,
  sensVides: 0,
  motsVides: 0,
  rangs: [],
  rangsStricts: [],
  auDessusDuSeuil: [],
  msVecteur: [],
  msClassement: [],
  /* Un match nul global peut cacher des victoires symétriques : on compte donc
     aussi les cartes où UN SEUL des deux modes retrouve la bonne page. */
  sensSeul: 0,
  motsSeul: 0,
  aucunDesDeux: 0,
  /* LE REBOND : le même classement, jugé avec et SANS son second pas. */
  motsSansRebond: 0,
  motsSansRebondStrict: 0,
  sensSansRebond: 0,
  sensSansRebondStrict: 0,
  rangsSansRebond: [],
};
for (const carte of cartes) {
  const t0 = Date.now();
  const vecteurQuestion = await vecteursMod.vectoriserLaQuestion(carte.question);
  if (!vecteurQuestion) continue;
  duel.msVecteur.push(Date.now() - t0);

  /*
   * LE REBOND EST UN SECOND PAS SUR LE MÊME CLASSEMENT : on note UNE fois, puis
   * on applique — ou non — le rebond. Rejouer `classerPassages` deux fois
   * doublerait le temps du relevé pour rendre exactement la même note.
   */
  const t1 = Date.now();
  const classesSensBrut = classerPassages(tousLesPassages, carte.question, {
    vecteurQuestion,
    poids: { sens: POIDS_SENS_VECTEUR, mots: POIDS_MOTS_VECTEUR },
    rebond: false,
  });
  duel.msClassement.push(Date.now() - t1);
  const classesSens = rebondSurLesFichiersCites(classesSensBrut, carte.question);
  const classesMotsBrut = classerPassages(tousLesPassages, carte.question, { rebond: false });
  const classesMots = rebondSurLesFichiersCites(classesMotsBrut, carte.question);

  for (const [brut, cle] of [
    [classesMotsBrut, 'motsSansRebond'],
    [classesSensBrut, 'sensSansRebond'],
  ]) {
    const sources = new Set(choisir(brut, cle === 'sensSansRebond' ? SCORE_MINIMUM_VECTEUR : undefined).gardes.map((p) => p.source));
    if ([...sources].some((s) => carte.fichiers.has(s))) duel[cle] += 1;
    if ([...sources].some((s) => carte.propres.has(s))) duel[`${cle}Strict`] += 1;
  }
  /* Le rang se compare à celui de `duel.rangs`, mesuré lui aussi sur le SENS. */
  duel.rangsSansRebond.push(rangDuBon(classesSensBrut, carte.fichiers));
  const parLeSens = choisir(classesSens, SCORE_MINIMUM_VECTEUR);
  const parLesMots = choisir(classesMots, undefined);

  const sourcesSens = new Set(parLeSens.gardes.map((p) => p.source));
  const sourcesMots = new Set(parLesMots.gardes.map((p) => p.source));
  duel.total += 1;
  if (!parLeSens.gardes.length) duel.sensVides += 1;
  if (!parLesMots.gardes.length) duel.motsVides += 1;
  const gagneSens = [...sourcesSens].some((s) => carte.fichiers.has(s));
  const gagneMots = [...sourcesMots].some((s) => carte.fichiers.has(s));
  if (gagneSens) duel.sens += 1;
  if (gagneMots) duel.mots += 1;
  if (gagneSens && !gagneMots) duel.sensSeul += 1;
  if (gagneMots && !gagneSens) duel.motsSeul += 1;
  if (!gagneSens && !gagneMots) duel.aucunDesDeux += 1;
  if ([...sourcesSens].some((s) => carte.propres.has(s))) duel.sensStrict += 1;
  if ([...sourcesMots].some((s) => carte.propres.has(s))) duel.motsStrict += 1;
  const communs = [...sourcesSens].filter((s) => sourcesMots.has(s)).length;
  duel.communs += sourcesSens.size ? communs / sourcesSens.size : 0;
  duel.rangs.push(rangDuBon(classesSens, carte.fichiers));
  duel.rangsStricts.push(rangDuBon(classesSens, carte.propres));
  duel.auDessusDuSeuil.push(classesSens.filter((p) => p.score >= SCORE_MINIMUM_VECTEUR).length);

  /* Le même classement, jugé par chaque seuil candidat. */
  for (const seuil of SEUILS_ESSAYES) {
    const essai = choisir(classesSens, seuil);
    const releve = balayage.get(seuil);
    const sources = new Set(essai.gardes.map((p) => p.source));
    if (!essai.gardes.length) releve.vides += 1;
    if ([...sources].some((s) => carte.fichiers.has(s))) releve.touche += 1;
    if ([...sources].some((s) => carte.propres.has(s))) releve.toucheStrict += 1;
    releve.passages.push(essai.gardes.length);
    releve.auDessus.push(classesSens.filter((p) => p.score >= seuil).length);
  }
}

const part = (n) => `${Math.round((n / Math.max(1, duel.total)) * 100)} %`;
console.log(`   un fichier réellement modifié remonte — par le SENS : ${part(duel.sens)} · par les MOTS : ${part(duel.mots)}`);
console.log(`   en vérité STRICTE (fichiers propres à la carte) — par le SENS : ${part(duel.sensStrict)} · par les MOTS : ${part(duel.motsStrict)}`);
console.log(`   recherches qui ne rendent RIEN — par le SENS : ${part(duel.sensVides)} · par les MOTS : ${part(duel.motsVides)}`);
console.log(`   cartes où UN SEUL des deux réussit — le SENS : ${duel.sensSeul} · les MOTS : ${duel.motsSeul} · aucun des deux : ${duel.aucunDesDeux}`);
console.log(`   fichiers communs aux deux réponses : ${Math.round((duel.communs / Math.max(1, duel.total)) * 100)} % — le reste est ce que le sens change`);
console.log(`   fichiers jugés omniprésents, donc neutralisés en vérité stricte : ${[...omnipresents].join(', ') || 'aucun'}\n`);

/*
 * LE REBOND, MESURÉ À PART. Tout est identique — mêmes passages, même note, même
 * plafond — sauf le SECOND PAS du classement : relever d'un cran les passages
 * venus d'un fichier que les meilleures pages de documentation NOMMENT.
 */
console.log('3 bis. LE REBOND SUR LES FICHIERS CITÉS — même note, second pas en plus');
console.log(
  `   par les MOTS (le réglage du lancement) — sans rebond : ${part(duel.motsSansRebond)} · avec : ${part(duel.mots)}` +
    ` · en vérité stricte ${part(duel.motsSansRebondStrict)} → ${part(duel.motsStrict)}`,
);
console.log(
  `   par le SENS — sans rebond : ${part(duel.sensSansRebond)} · avec : ${part(duel.sens)}` +
    ` · en vérité stricte ${part(duel.sensSansRebondStrict)} → ${part(duel.sensStrict)}`,
);

const auRang = (rangs, k) => `${Math.round((rangs.filter((r) => r > 0 && r <= k).length / Math.max(1, rangs.length)) * 100)} %`;
console.log(
  `   la bonne page arrive dans les 7 premiers rangs — sans rebond : ${auRang(duel.rangsSansRebond, 7)} · avec : ${auRang(duel.rangs, 7)}\n`,
);

console.log('4. LE PLAFOND OU LE CLASSEMENT ? — à quel rang la bonne page arrive dans le classement entier');
console.log(`   vérité large  — dans les 7 servis : ${auRang(duel.rangs, 7)} · dans les 20 premiers : ${auRang(duel.rangs, 20)} · dans les 100 premiers : ${auRang(duel.rangs, 100)}`);
console.log(`   vérité stricte — dans les 7 servis : ${auRang(duel.rangsStricts, 7)} · dans les 20 premiers : ${auRang(duel.rangsStricts, 20)} · dans les 100 premiers : ${auRang(duel.rangsStricts, 100)}`);
console.log(`   rang médian de la première bonne page (vérité large) : ${mediane(duel.rangs.filter((r) => r > 0))} sur ${tousLesPassages.length} passages\n`);

/* ------------------------------------------------------------------ */
/* 4bis. LE MÊME DUEL, SUR DE VRAIS MESSAGES DE CONVERSATION           */
/* ------------------------------------------------------------------ */

/*
 * L'AUTRE TERRAIN. Le duel du dessus juge des demandes de CARTE — un titre et une
 * description rédigés, déjà pleins du vocabulaire du projet. Celui-ci juge ce que
 * l'utilisateur TAPE dans une conversation : une phrase, une plainte, une question
 * posée comme on parle, qui ne nomme presque jamais un fichier. C'est le terrain
 * où un modèle de sens est censé servir, et c'est le seul moyen de savoir si le
 * lancement et la conversation appellent le même réglage.
 *
 * Le classement est le même ; ce qui change, ce sont les BORNES du tour de suite
 * (`rechercherPourLaSuite`) : trois passages, le tiers du plafond, le seuil relevé
 * d'un cran. On n'applique PAS la liste des passages déjà servis — on ne sait pas
 * ce que l'agent avait reçu ce jour-là — mais elle jouerait à l'identique pour les
 * deux modes : la comparaison reste honnête.
 */
const duelConv = {
  total: 0,
  sens: 0,
  mots: 0,
  sensStrict: 0,
  motsStrict: 0,
  sensSeul: 0,
  motsSeul: 0,
  aucunDesDeux: 0,
  communs: 0,
  sensVides: 0,
  motsVides: 0,
  rangs: [],
  signes: [],
  sensSansRebond: 0,
  sensSansRebondStrict: 0,
};

/*
 * LE BALAYAGE DES SEUILS, SUR CE TERRAIN-CI AUSSI.
 *
 * Le balayage de la section « 5 bis » juge chaque seuil candidat sur des
 * CARTES — et c'est de là que vient `SCORE_MINIMUM_VECTEUR`. Or le mode sens a
 * été retiré du lancement d'une carte : ce seuil ne s'applique plus, en
 * pratique, que sur le terrain de la CONVERSATION, relevé d'un cran
 * (`seuilDeSuite`). Une valeur mesurée là où elle ne sert plus, appliquée là
 * où elle n'a jamais été mesurée : c'est exactement ce qu'il faut refermer.
 *
 * On rejoue donc les mêmes messages, aux BORNES DU TOUR DE SUITE, à chaque
 * seuil candidat. `seuil` désigne ici le seuil RÉELLEMENT appliqué, marge
 * comprise — c'est lui qu'on lit dans le tableau, pas la valeur d'avant marge.
 */
const balayageConv = new Map(
  SEUILS_ESSAYES.map((seuil) => [seuil, { touche: 0, toucheStrict: 0, vides: 0, passages: [], horsSujet: [] }]),
);

/** Le même balayage, mais sur la PART DU MIEUX PLACÉ, seuil laissé en place. */
const balayagePartConv = new Map(
  PARTS_ESSAYEES.map((part) => [part, { touche: 0, toucheStrict: 0, vides: 0, passages: [] }]),
);

/**
 * ET LE PLANCHER ABSOLU (`SCORE_MINIMUM`) SUR CE TERRAIN AUSSI, par les MOTS.
 * Il est balayé au lancement en « 5 quater », mais il sert ICI également : c'est
 * lui, relevé de `MARGE_SEUIL_SUITE`, qui filtre un tour de suite quand la
 * recherche retombe sur les mots. Le monter sans l'avoir mesuré ici serait
 * refaire l'erreur que « 5 ter » a fermée.
 */
const balayagePlancherConv = new Map(
  PLANCHERS_ESSAYES.map((plancher) => [plancher, { touche: 0, toucheStrict: 0, vides: 0, passages: [] }]),
);

const messagesRejoues = messages.slice(0, Math.max(0, MESSAGES_VOULUS));
if (messagesRejoues.length) {
  for (const message of messagesRejoues) {
    const vecteurQuestion = await vecteursMod.vectoriserLaQuestion(message.question);
    if (!vecteurQuestion) continue;
    const classesSensBrut = classerPassages(tousLesPassages, message.question, {
      vecteurQuestion,
      poids: { sens: POIDS_SENS_VECTEUR, mots: POIDS_MOTS_VECTEUR },
      rebond: false,
    });
    const classesSens = rebondSurLesFichiersCites(classesSensBrut, message.question);
    const classesMots = classerPassages(tousLesPassages, message.question);
    /* `partDuPremier: 0` : même raison qu'en section 3 — ici on balaie le SEUIL. */
    const bornes = {
      plafond: PLAFOND_PASSAGES_SUITE_JETONS,
      max: PASSAGES_SUITE_MAX,
      maxCode: PASSAGES_CODE_MAX,
      partDuPremier: 0,
    };
    {
      /* LE REBOND EN CONVERSATION : il doit gagner là aussi, ou au moins ne rien coûter. */
      const brut = new Set(
        choisirPassages(classesSensBrut, { ...bornes, minimum: SEUIL_VECTEUR_CONVERSATION }).gardes.map((p) => p.source),
      );
      if ([...brut].some((s) => message.carte.fichiers.has(s))) duelConv.sensSansRebond += 1;
      if ([...brut].some((s) => message.carte.propres.has(s))) duelConv.sensSansRebondStrict += 1;
    }
    const parLeSens = choisirPassages(classesSens, { ...bornes, minimum: SEUIL_VECTEUR_CONVERSATION });
    const parLesMots = choisirPassages(classesMots, { ...bornes, minimum: seuilDeSuite(SCORE_MINIMUM) });

    const sourcesSens = new Set(parLeSens.gardes.map((p) => p.source));
    const sourcesMots = new Set(parLesMots.gardes.map((p) => p.source));
    duelConv.total += 1;
    duelConv.signes.push(message.question.length);
    if (!parLeSens.gardes.length) duelConv.sensVides += 1;
    if (!parLesMots.gardes.length) duelConv.motsVides += 1;
    const gagneSens = [...sourcesSens].some((s) => message.carte.fichiers.has(s));
    const gagneMots = [...sourcesMots].some((s) => message.carte.fichiers.has(s));
    if (gagneSens) duelConv.sens += 1;
    if (gagneMots) duelConv.mots += 1;
    if (gagneSens && !gagneMots) duelConv.sensSeul += 1;
    if (gagneMots && !gagneSens) duelConv.motsSeul += 1;
    if (!gagneSens && !gagneMots) duelConv.aucunDesDeux += 1;
    if ([...sourcesSens].some((s) => message.carte.propres.has(s))) duelConv.sensStrict += 1;
    if ([...sourcesMots].some((s) => message.carte.propres.has(s))) duelConv.motsStrict += 1;
    const communs = [...sourcesSens].filter((s) => sourcesMots.has(s)).length;
    duelConv.communs += sourcesSens.size ? communs / sourcesSens.size : 0;
    duelConv.rangs.push(rangDuBon(classesSens, message.carte.fichiers));

    /* Le PLANCHER ABSOLU, par les MOTS, aux bornes du tour de suite. */
    for (const plancher of PLANCHERS_ESSAYES) {
      const essai = choisirPassages(classesMots, {
        ...bornes,
        minimum: seuilDeSuite(plancher),
      });
      const releve = balayagePlancherConv.get(plancher);
      const sources = new Set(essai.gardes.map((p) => p.source));
      if (!essai.gardes.length) releve.vides += 1;
      if ([...sources].some((s) => message.carte.fichiers.has(s))) releve.touche += 1;
      if ([...sources].some((s) => message.carte.propres.has(s))) releve.toucheStrict += 1;
      releve.passages.push(essai.gardes.length);
    }

    /*
     * LA PART DU MIEUX PLACÉ, SUR CE TERRAIN AUSSI. Elle s'applique dans
     * `choisirPassages`, donc aux deux terrains : la mesurer sur le seul
     * lancement reviendrait à la poser en conversation sans l'avoir éprouvée.
     * Le seuil, lui, reste celui déjà retenu ici (`SEUIL_VECTEUR_CONVERSATION`).
     */
    for (const part of PARTS_ESSAYEES) {
      const essai = choisirPassages(classesSens, {
        ...bornes,
        minimum: SEUIL_VECTEUR_CONVERSATION,
        partDuPremier: part,
      });
      const releve = balayagePartConv.get(part);
      const sources = new Set(essai.gardes.map((p) => p.source));
      if (!essai.gardes.length) releve.vides += 1;
      if ([...sources].some((s) => message.carte.fichiers.has(s))) releve.touche += 1;
      if ([...sources].some((s) => message.carte.propres.has(s))) releve.toucheStrict += 1;
      releve.passages.push(essai.gardes.length);
    }

    /* Le même classement, aux bornes du tour de suite, jugé par chaque seuil. */
    for (const seuil of SEUILS_ESSAYES) {
      const essai = choisirPassages(classesSens, { ...bornes, minimum: seuil });
      const releve = balayageConv.get(seuil);
      const sources = new Set(essai.gardes.map((p) => p.source));
      if (!essai.gardes.length) releve.vides += 1;
      if ([...sources].some((s) => message.carte.fichiers.has(s))) releve.touche += 1;
      if ([...sources].some((s) => message.carte.propres.has(s))) releve.toucheStrict += 1;
      releve.passages.push(essai.gardes.length);
    }
  }
}

const partConv = (n) => `${Math.round((n / Math.max(1, duelConv.total)) * 100)} %`;
console.log('4bis. LE MÊME DUEL SUR DE VRAIS MESSAGES DE CONVERSATION — questions tapées, pas rédigées');
if (!duelConv.total) {
  console.log('   aucun message exploitable : rien à comparer sur ce terrain\n');
} else {
  console.log(`   messages rejoués : ${duelConv.total} (${messagesEcartes} écartés : trop courts, ou carte sans vérité de terrain) · longueur médiane ${mediane(duelConv.signes)} signes`);
  console.log(
    `   bornes appliquées : celles d’un tour de SUITE — ${PASSAGES_SUITE_MAX} passages au plus, ${PLAFOND_PASSAGES_SUITE_JETONS} jetons,` +
      ` seuil ${SEUIL_VECTEUR_CONVERSATION} par le SENS (mesuré ici même, section 5 ter) et ${seuilDeSuite(SCORE_MINIMUM).toFixed(2)} par les MOTS (relevé de ${MARGE_SEUIL_SUITE})`,
  );
  console.log(`   un fichier réellement modifié remonte — par le SENS : ${partConv(duelConv.sens)} · par les MOTS : ${partConv(duelConv.mots)}`);
  console.log(`   en vérité STRICTE — par le SENS : ${partConv(duelConv.sensStrict)} · par les MOTS : ${partConv(duelConv.motsStrict)}`);
  console.log(`   recherches qui ne rendent RIEN — par le SENS : ${partConv(duelConv.sensVides)} · par les MOTS : ${partConv(duelConv.motsVides)}`);
  console.log(`   messages où UN SEUL des deux réussit — le SENS : ${duelConv.sensSeul} · les MOTS : ${duelConv.motsSeul} · aucun des deux : ${duelConv.aucunDesDeux}`);
  console.log(`   le REBOND sur ce terrain — sans : ${partConv(duelConv.sensSansRebond)} · avec : ${partConv(duelConv.sens)} · en vérité stricte ${partConv(duelConv.sensSansRebondStrict)} → ${partConv(duelConv.sensStrict)}`);
  console.log(`   fichiers communs aux deux réponses : ${Math.round((duelConv.communs / Math.max(1, duelConv.total)) * 100)} %\n`);
}

/* ------------------------------------------------------------------ */
/* 5. Le seuil de pertinence filtre-t-il quelque chose ?               */
/* ------------------------------------------------------------------ */

/*
 * `SCORE_MINIMUM_VECTEUR` est présenté comme le garde-fou qui empêche la recherche
 * de « remonter sept passages pour n'importe quelle question ». On le vérifie de
 * deux façons : combien de passages du corpus le franchissent sur une vraie
 * demande, et ce qui remonte sur une question qui n'a RIEN à voir avec le projet.
 */
console.log('5. LE SEUIL DE PERTINENCE — filtre-t-il vraiment ?');
console.log(`   seuil en mode sens : ${SCORE_MINIMUM_VECTEUR} · passages du corpus au-dessus, sur une vraie demande : ${Math.round(moyenne(duel.auDessusDuSeuil))} sur ${tousLesPassages.length} (${Math.round((moyenne(duel.auDessusDuSeuil) / tousLesPassages.length) * 100)} %)`);

/*
 * CES DEUX QUESTIONS NE SE RECOPIENT NULLE PART. Elles sont indexées avec ce
 * fichier : les citer dans une page de documentation ferait remonter cette page, et
 * la mesure dirait « le seuil laisse passer six passages » alors qu'elle n'aurait
 * mesuré que sa propre trace. Même piège que pour `verif-recherche-par-le-sens.mjs`.
 */
const HORS_SUJET = [
  'quelle est la recette de la tarte aux pommes de ma grand-mère ?',
  'combien de temps faut-il pour aller de Genève à Tokyo en avion ?',
];
for (const question of HORS_SUJET) {
  const vecteurQuestion = await vecteursMod.vectoriserLaQuestion(question);
  const classes = classerPassages(tousLesPassages, question, {
    vecteurQuestion,
    poids: { sens: POIDS_SENS_VECTEUR, mots: POIDS_MOTS_VECTEUR },
  });
  const choix = choisir(classes, SCORE_MINIMUM_VECTEUR);
  console.log(
    `   « ${question.slice(0, 46)}… » → ${choix.gardes.length} passages retenus, ` +
      `le mieux placé à ${(classes[0]?.score ?? 0).toFixed(2)} : ${choix.gardes[0]?.source ?? '—'}`,
  );
  /* La même question, jugée par chaque seuil candidat — au LANCEMENT, puis aux
     bornes du tour de SUITE, qui sont les seules où le mode sens tourne encore. */
  for (const seuil of SEUILS_ESSAYES) {
    balayage.get(seuil).horsSujet.push(choisir(classes, seuil).gardes.length);
    balayageConv
      .get(seuil)
      .horsSujet.push(
        choisirPassages(classes, {
          plafond: PLAFOND_PASSAGES_SUITE_JETONS,
          max: PASSAGES_SUITE_MAX,
          maxCode: PASSAGES_CODE_MAX,
          minimum: seuil,
        }).gardes.length,
      );
  }
}
console.log('');

/* ------------------------------------------------------------------ */
/* 5 bis. Le BALAYAGE : quelle valeur de seuil, et pourquoi celle-là   */
/* ------------------------------------------------------------------ */

/*
 * LA VALEUR DU SEUIL SE MESURE, ELLE NE SE DEVINE PAS. On rejoue les mêmes
 * cartes et les mêmes questions hors sujet à chaque seuil candidat, et on
 * demande à chacun trois choses :
 *   - NE RIEN PERDRE : la part de cartes qui reçoivent encore au moins une page
 *     d'un fichier qu'elles allaient réellement modifier ne doit pas baisser ;
 *   - REFUSER LE HORS SUJET : une question étrangère au projet doit repartir les
 *     mains vides, sans quoi le repli sur l'index ne peut plus se déclencher ;
 *   - PRENDRE LA PLUS GRANDE MARGE à coût nul : entre le premier seuil qui
 *     refuse le hors sujet et le dernier qui ne perd aucune carte, la pertinence
 *     est IDENTIQUE — autant se tenir le plus loin possible du score qu'atteint
 *     une question étrangère, sinon la moindre dérive du corpus rouvre la porte.
 * La recommandation est donc CALCULÉE, pas choisie : c'est le PLUS HAUT seuil
 * qui ne coûte aucune carte, parmi ceux qui refusent le hors sujet.
 */
console.log('5 bis. LE BALAYAGE DES SEUILS — chaque valeur jugée sur les mêmes cartes');
const referenceTouche = balayage.get(SEUILS_ESSAYES[0]).touche;
const lignes = SEUILS_ESSAYES.map((seuil) => {
  const releve = balayage.get(seuil);
  return {
    seuil,
    pertinence: releve.touche / Math.max(1, duel.total),
    pertinenceStricte: releve.toucheStrict / Math.max(1, duel.total),
    perdues: referenceTouche - releve.touche,
    passages: moyenne(releve.passages),
    vides: releve.vides,
    partDuCorpus: moyenne(releve.auDessus) / Math.max(1, tousLesPassages.length),
    horsSujet: Math.max(0, ...releve.horsSujet),
  };
});
for (const ligne of lignes) {
  console.log(
    `   seuil ${ligne.seuil.toFixed(2)} · bonne page retrouvée ${Math.round(ligne.pertinence * 100)} %` +
      ` (stricte ${Math.round(ligne.pertinenceStricte * 100)} %, ${ligne.perdues >= 0 ? `${ligne.perdues} carte(s) perdue(s)` : `${-ligne.perdues} gagnée(s)`})` +
      ` · ${ligne.passages.toFixed(1)} passages servis · ${ligne.vides} repli(s) sur l’index` +
      ` · ${Math.round(ligne.partDuCorpus * 100)} % du corpus au-dessus` +
      ` · hors sujet : ${ligne.horsSujet} passage(s)`,
  );
}
const sansPerte = lignes.filter((l) => l.perdues <= 0 && l.horsSujet === 0);
const premier = sansPerte[0];
const recommande = sansPerte[sansPerte.length - 1];
console.log(
  recommande
    ? `   → sans perdre une seule carte, le seuil tient de ${premier.seuil.toFixed(2)} (premier à refuser le hors sujet)` +
        ` à ${recommande.seuil.toFixed(2)} · VALEUR RETENUE : ${recommande.seuil.toFixed(2)}, la plus haute à coût nul` +
        ` (seuil en place : ${SCORE_MINIMUM_VECTEUR})`
    : '   → aucun seuil essayé ne tient les deux conditions : la fourchette est à élargir.',
);
console.log('');

/* ------------------------------------------------------------------ */
/* 5 ter. LE MÊME BALAYAGE, SUR LE TERRAIN OÙ LE SEUIL SERT ENCORE     */
/* ------------------------------------------------------------------ */

/*
 * LE BALAYAGE DU DESSUS MESURE UN TERRAIN QUE LE MODE SENS A QUITTÉ.
 *
 * Depuis `SENS_PAR_TERRAIN`, le lancement d'une carte est classé par les MOTS :
 * `SCORE_MINIMUM_VECTEUR` n'y est plus jamais appliqué. Le seul endroit où il
 * décide encore de quelque chose, c'est la CONVERSATION — et il y arrive relevé
 * de `MARGE_SEUIL_SUITE`. Un seuil mesuré sur les cartes, appliqué aux messages,
 * avec une marge en plus : trois raisons de le remesurer ICI.
 *
 * Mêmes trois critères qu'en « 5 bis », mêmes seuils candidats, même vérité de
 * terrain — mais les messages, les bornes du tour de suite, et le seuil lu tel
 * qu'il s'applique (marge comprise).
 */
console.log('5 ter. LE BALAYAGE DES SEUILS EN CONVERSATION — le seul terrain où le mode sens tourne encore');
if (!duelConv.total) {
  console.log('   aucun message exploitable : rien à balayer sur ce terrain\n');
} else {
  const referenceConv = balayageConv.get(SEUILS_ESSAYES[0]).touche;
  const lignesConv = SEUILS_ESSAYES.map((seuil) => {
    const releve = balayageConv.get(seuil);
    return {
      seuil,
      pertinence: releve.touche / Math.max(1, duelConv.total),
      pertinenceStricte: releve.toucheStrict / Math.max(1, duelConv.total),
      perdus: referenceConv - releve.touche,
      passages: moyenne(releve.passages),
      vides: releve.vides,
      horsSujet: Math.max(0, ...releve.horsSujet),
    };
  });
  for (const ligne of lignesConv) {
    console.log(
      `   seuil appliqué ${ligne.seuil.toFixed(2)} · bonne page retrouvée ${Math.round(ligne.pertinence * 100)} %` +
        ` (stricte ${Math.round(ligne.pertinenceStricte * 100)} %, ${ligne.perdus >= 0 ? `${ligne.perdus} message(s) perdu(s)` : `${-ligne.perdus} gagné(s)`})` +
        ` · ${ligne.passages.toFixed(1)} passages servis · ${ligne.vides} tour(s) sans rien` +
        ` · hors sujet : ${ligne.horsSujet} passage(s)`,
    );
  }
  const tenables = lignesConv.filter((l) => l.perdus <= 0 && l.horsSujet === 0);
  const premierConv = tenables[0];
  const recommandeConv = tenables[tenables.length - 1];
  const enPlace = SEUIL_VECTEUR_CONVERSATION;
  console.log(
    recommandeConv
      ? `   → sans perdre un seul message, le seuil appliqué tient de ${premierConv.seuil.toFixed(2)}` +
          ` à ${recommandeConv.seuil.toFixed(2)} · VALEUR RETENUE : ${recommandeConv.seuil.toFixed(2)}, la plus haute à coût nul` +
          ` (seuil appliqué aujourd’hui : ${enPlace.toFixed(2)})`
      : `   → aucun seuil essayé ne tient les deux conditions sur ce terrain (seuil appliqué aujourd’hui : ${enPlace.toFixed(2)}).`,
  );
  console.log('');
}

/* ------------------------------------------------------------------ */
/* 5 quater. LE SEUIL DU LANCEMENT — celui qui décide vraiment          */
/* ------------------------------------------------------------------ */

/*
 * LE SEUIL QU'ON N'AVAIT JAMAIS BALAYÉ.
 *
 * « 5 bis » et « 5 ter » balaient `SCORE_MINIMUM_VECTEUR`, le seuil du mode
 * SENS. Or le LANCEMENT d'une carte est classé par les MOTS depuis
 * `SENS_PAR_TERRAIN` : ce qui y décide, c'est `SCORE_MINIMUM` (0,14), une
 * valeur d'origine que personne n'a jamais mesurée. C'est pourtant elle qui a
 * laissé passer, sur une carte réelle, un fait sans rapport avec la demande.
 *
 * Deux réglages sont balayés ENSEMBLE, parce qu'ils ne coupent pas la même
 * chose :
 *   - le PLANCHER ABSOLU (`SCORE_MINIMUM`) — un score en deçà duquel un passage
 *     ne répond à rien, quelle que soit la question ;
 *   - la PART DU MIEUX PLACÉ (`PART_MINIMALE_DU_PREMIER`) — sans échelle, donc
 *     capable de couper les traînards d'un bon classement sans vider un
 *     classement médiocre où les passages sont les meilleurs qu'on ait.
 *
 * Mêmes cartes, même vérité de terrain venue de git, même choix sous plafond.
 * Aucun vecteur n'est calculé : ce terrain n'en utilise pas, la boucle est donc
 * rapide et tourne même sans moteur de vectorisation installé.
 */
console.log('5 quater. LE SEUIL DU LANCEMENT — balayé par les MOTS, le mode que ce terrain utilise');

const balayageMots = new Map();
for (const plancher of PLANCHERS_ESSAYES) {
  for (const part of PARTS_ESSAYEES) {
    balayageMots.set(`${plancher}|${part}`, {
      plancher,
      part,
      touche: 0,
      toucheStrict: 0,
      vides: 0,
      passages: [],
      horsSujet: [],
    });
  }
}

for (const carte of cartes) {
  const classesMots = classerPassages(tousLesPassages, carte.question);
  for (const releve of balayageMots.values()) {
    const essai = choisirPassages(classesMots, {
      plafond,
      maxCode: PASSAGES_CODE_MAX,
      minimum: releve.plancher,
      partDuPremier: releve.part,
    });
    const sources = new Set(essai.gardes.map((p) => p.source));
    if (!essai.gardes.length) releve.vides += 1;
    if ([...sources].some((s) => carte.fichiers.has(s))) releve.touche += 1;
    if ([...sources].some((s) => carte.propres.has(s))) releve.toucheStrict += 1;
    releve.passages.push(essai.gardes.length);
  }
}

/* Les mêmes questions étrangères au projet, jugées par les MOTS cette fois. */
for (const question of HORS_SUJET) {
  const classesMots = classerPassages(tousLesPassages, question);
  console.log(
    `   hors sujet « ${question.slice(0, 40)}… » → mieux placé à ${(classesMots[0]?.score ?? 0).toFixed(2)} par les mots : ${classesMots[0]?.source ?? '—'}`,
  );
  for (const releve of balayageMots.values()) {
    releve.horsSujet.push(
      choisirPassages(classesMots, {
        plafond,
        maxCode: PASSAGES_CODE_MAX,
        minimum: releve.plancher,
        partDuPremier: releve.part,
      }).gardes.length,
    );
  }
}

const lignesMots = [...balayageMots.values()].map((releve) => ({
  plancher: releve.plancher,
  part: releve.part,
  pertinence: releve.touche / Math.max(1, cartes.length),
  pertinenceStricte: releve.toucheStrict / Math.max(1, cartes.length),
  perdues: balayageMots.get(`${PLANCHERS_ESSAYES[0]}|0`).touche - releve.touche,
  passages: moyenne(releve.passages),
  vides: releve.vides,
  horsSujet: Math.max(0, ...releve.horsSujet),
}));
for (const ligne of lignesMots) {
  console.log(
    `   plancher ${ligne.plancher.toFixed(2)} · part du premier ${ligne.part ? ligne.part.toFixed(2) : '—   '}` +
      ` · bonne page ${Math.round(ligne.pertinence * 100)} %` +
      ` (stricte ${Math.round(ligne.pertinenceStricte * 100)} %, ${ligne.perdues >= 0 ? `${ligne.perdues} perdue(s)` : `${-ligne.perdues} gagnée(s)`})` +
      ` · ${ligne.passages.toFixed(1)} passages servis · ${ligne.vides} repli(s)` +
      ` · hors sujet : ${ligne.horsSujet}`,
  );
}
/*
 * LA RECOMMANDATION EST CALCULÉE, PAS CHOISIE — mais le critère n'est pas celui
 * de « 5 bis ». Là-bas, on demandait qu'une question hors sujet reparte les
 * mains VIDES ; par les MOTS, c'est hors d'atteinte : une phrase française
 * quelconque partage toujours quelques mots courants avec 6 000 passages, et le
 * mieux placé d'une question étrangère sort déjà à 0,36-0,39 — au-dessus du
 * score de la moitié des vraies demandes. Un plancher qui refuserait le hors
 * sujet refuserait donc aussi les vraies cartes.
 *
 * Le critère de CE terrain est donc : NE PERDRE AUCUNE CARTE, et parmi les
 * couples qui n'en perdent aucune, servir le MOINS de passages — c'est-à-dire
 * écarter le plus de traînards à pertinence rigoureusement égale. À égalité, le
 * plus exigeant des deux réglages l'emporte. Le hors sujet reste affiché : il
 * dit ce que le réglage retenu laisse encore passer, il ne le décide pas.
 */
const tenablesMots = lignesMots.filter((l) => l.perdues <= 0);
const meilleurMots = tenablesMots
  .slice()
  .sort((a, b) => a.passages - b.passages || b.part - a.part || b.plancher - a.plancher)[0];
console.log(
  meilleurMots
    ? `   → COUPLE RETENU : plancher ${meilleurMots.plancher.toFixed(2)} · part du premier ${meilleurMots.part.toFixed(2)}` +
        ` — ${meilleurMots.passages.toFixed(1)} passages servis contre ${lignesMots[0].passages.toFixed(1)} sans rien couper,` +
        ` à pertinence identique (${Math.round(meilleurMots.pertinence * 100)} %, ${meilleurMots.horsSujet} passage(s) sur une question hors sujet)` +
        ` · en place : plancher ${SCORE_MINIMUM} · part ${PART_MINIMALE_DU_PREMIER}`
    : '   → aucun couple essayé ne tient la condition : la fourchette est à élargir.',
);
console.log('');

/* ------------------------------------------------------------------ */
/* 5 quinquies. LA MÊME PART, SUR LE TERRAIN DE LA CONVERSATION         */
/* ------------------------------------------------------------------ */

/*
 * LA PART S'APPLIQUE DANS `choisirPassages`, DONC AUX DEUX TERRAINS. La mesurer
 * sur le seul lancement reviendrait à la poser en conversation sans l'avoir
 * éprouvée — exactement le reproche fait au seuil du mode sens en « 5 ter ».
 * Mêmes messages, mêmes bornes de tour de suite, seuil laissé à la valeur déjà
 * retenue ici : seule la part change.
 */
console.log('5 quinquies. LA PART DU MIEUX PLACÉ EN CONVERSATION — le même filtre, sur l’autre terrain');
if (!duelConv.total) {
  console.log('   aucun message exploitable : rien à balayer sur ce terrain\n');
} else {
  const referencePart = balayagePartConv.get(0).touche;
  const lignesPartConv = PARTS_ESSAYEES.map((part) => {
    const releve = balayagePartConv.get(part);
    return {
      part,
      pertinence: releve.touche / Math.max(1, duelConv.total),
      pertinenceStricte: releve.toucheStrict / Math.max(1, duelConv.total),
      perdus: referencePart - releve.touche,
      passages: moyenne(releve.passages),
      vides: releve.vides,
    };
  });
  for (const ligne of lignesPartConv) {
    console.log(
      `   part du premier ${ligne.part ? ligne.part.toFixed(2) : '—   '}` +
        ` · bonne page ${Math.round(ligne.pertinence * 100)} %` +
        ` (stricte ${Math.round(ligne.pertinenceStricte * 100)} %, ${ligne.perdus >= 0 ? `${ligne.perdus} message(s) perdu(s)` : `${-ligne.perdus} gagné(s)`})` +
        ` · ${ligne.passages.toFixed(1)} passages servis · ${ligne.vides} tour(s) sans rien`,
    );
  }
  const referencePlancher = balayagePlancherConv.get(PLANCHERS_ESSAYES[0]).touche;
  for (const plancher of PLANCHERS_ESSAYES) {
    const releve = balayagePlancherConv.get(plancher);
    const perdus = referencePlancher - releve.touche;
    console.log(
      `   plancher ${plancher.toFixed(2)} (appliqué ${seuilDeSuite(plancher).toFixed(2)} par les MOTS)` +
        ` · bonne page ${Math.round((releve.touche / Math.max(1, duelConv.total)) * 100)} %` +
        ` (${perdus >= 0 ? `${perdus} message(s) perdu(s)` : `${-perdus} gagné(s)`})` +
        ` · ${moyenne(releve.passages).toFixed(1)} passages servis · ${releve.vides} tour(s) sans rien`,
    );
  }

  const tenablesPart = lignesPartConv.filter((l) => l.perdus <= 0);
  const meilleurPart = tenablesPart.slice().sort((a, b) => a.passages - b.passages || b.part - a.part)[0];
  console.log(
    meilleurPart
      ? `   → PART TENABLE SUR CE TERRAIN AUSSI : jusqu’à ${meilleurPart.part.toFixed(2)} sans perdre un message` +
          ` (${meilleurPart.passages.toFixed(1)} passages servis contre ${lignesPartConv[0].passages.toFixed(1)} sans filtre)` +
          ` · en place : ${PART_MINIMALE_DU_PREMIER}`
      : '   → la part coûte des messages sur ce terrain : elle doit être réservée au lancement.',
  );
  console.log('');
}

/* ------------------------------------------------------------------ */
/* 6. Ce que coûte la recherche elle-même                              */
/* ------------------------------------------------------------------ */

/*
 * LA QUESTION N'EST VECTORISÉE QU'UNE FOIS : le démon garde en mémoire le vecteur
 * des 200 dernières (`questionsVues`, server/src/vecteurs.ts). Mesurer la deuxième
 * fois ne mesurerait donc que le cache. On paie donc une question NEUVE.
 */
const questionNeuve = `mesure du coût à froid — ${cartes[0].titre} — ${tousLesPassages.length}`;
const froid = Date.now();
await vecteursMod.vectoriserLaQuestion(questionNeuve);
const msVecteurFroid = Date.now() - froid;

console.log('6. LE COÛT DE LA RECHERCHE, EN TEMPS D’ATTENTE');
console.log(`   vectoriser une question NEUVE : ${msVecteurFroid} ms · la même, déjà en mémoire : ${Math.round(moyenne(duel.msVecteur))} ms`);
console.log(`   classer ${tousLesPassages.length} passages : ${Math.round(moyenne(duel.msClassement))} ms`);
console.log(`   la recherche entière, telle que le démon la paie : ${Math.round(moyenne(servis.map((r) => r.ms)))} ms par demande\n`);

/* ------------------------------------------------------------------ */
/* Ce que le relevé rend, pour le rapport                              */
/* ------------------------------------------------------------------ */

const bilan = {
  corpus: {
    fichiers: indexation.fichiers,
    passages: tousLesPassages.length,
    documentation: documents.length,
    code: code.length,
    signesMoyensDoc: signesMoyens(documents),
    signesMoyensCode: signesMoyens(code),
    couverture: couverture.vectorises / Math.max(1, couverture.total),
    jetonsIndex,
    plafond,
  },
  echantillon: {
    cartes: cartes.length,
    ecartees: sansFusion,
    messages: duelConv.total,
    messagesEcartes,
  },
  envoi: {
    servies: servis.length,
    replis,
    parLeSens: servis.filter((r) => r.mode === 'sens').length,
    jetonsMoyens: moyenne(servis.map((r) => r.jetons)),
    economieMoyenne: moyenne(economies),
    passagesMoyens: moyenne(servis.map((r) => r.passages)),
    passagesCodeMoyens: moyenne(servis.map((r) => r.passagesCode)),
    ecartesMoyens: moyenne(servis.map((r) => r.ecartes)),
    msMoyens: moyenne(servis.map((r) => r.ms)),
  },
  pertinence: {
    large: servis.filter((r) => r.touche).length / Math.max(1, servis.length),
    strict: servis.filter((r) => r.toucheStrict).length / Math.max(1, servis.length),
    omnipresents: [...omnipresents],
  },
  duel,
  duelConversation: duelConv,
  seuils: {
    essayes: SEUILS_ESSAYES,
    enPlace: SCORE_MINIMUM_VECTEUR,
    plageSansPerte: sansPerte.length ? [premier.seuil, recommande.seuil] : null,
    recommande: recommande?.seuil ?? null,
    lignes,
  },
  seuilDuLancement: {
    planchersEssayes: PLANCHERS_ESSAYES,
    partsEssayees: PARTS_ESSAYEES,
    enPlace: { plancher: SCORE_MINIMUM, part: PART_MINIMALE_DU_PREMIER },
    retenu: meilleurMots ?? null,
    lignes: lignesMots,
  },
  releves,
};

if (SORTIE_JSON) {
  fs.writeFileSync(SORTIE_JSON, JSON.stringify(bilan, null, 2));
  console.log(`Relevé complet écrit dans ${SORTIE_JSON}`);
}

console.log('Ce relevé MESURE, il ne juge pas : aucun seuil n’est posé ici, et il ne fait échouer aucune construction.');
process.exit(0);
