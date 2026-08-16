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
  PASSAGES_CODE_MAX,
  POIDS_MOTS_VECTEUR,
  POIDS_SENS_VECTEUR,
  SCORE_MINIMUM_VECTEUR,
  choisirPassages,
  classerPassages,
  jetonsApproches,
  plafondDeRecherche,
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
    `SELECT title, description, data FROM cards
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
const cartes = toutes.slice(0, CARTES_VOULUES);
for (const carte of cartes) {
  carte.propres = new Set([...carte.fichiers].filter((f) => !omnipresents.has(f)));
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
const tousLesPassages = passagesMod.passagesIndexes(projet.id);
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
  return choisirPassages(classes, { plafond, minimum, maxCode: PASSAGES_CODE_MAX });
}
/** Le rang (1 = premier) du premier passage venu d'un fichier attendu, 0 si aucun. */
function rangDuBon(classes, attendus) {
  const rang = classes.findIndex((p) => attendus.has(p.source));
  return rang < 0 ? 0 : rang + 1;
}

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
};
for (const carte of cartes) {
  const t0 = Date.now();
  const vecteurQuestion = await vecteursMod.vectoriserLaQuestion(carte.question);
  if (!vecteurQuestion) continue;
  duel.msVecteur.push(Date.now() - t0);

  const t1 = Date.now();
  const classesSens = classerPassages(tousLesPassages, carte.question, {
    vecteurQuestion,
    poids: { sens: POIDS_SENS_VECTEUR, mots: POIDS_MOTS_VECTEUR },
  });
  duel.msClassement.push(Date.now() - t1);
  const classesMots = classerPassages(tousLesPassages, carte.question);
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
}

const part = (n) => `${Math.round((n / Math.max(1, duel.total)) * 100)} %`;
console.log(`   un fichier réellement modifié remonte — par le SENS : ${part(duel.sens)} · par les MOTS : ${part(duel.mots)}`);
console.log(`   en vérité STRICTE (fichiers propres à la carte) — par le SENS : ${part(duel.sensStrict)} · par les MOTS : ${part(duel.motsStrict)}`);
console.log(`   recherches qui ne rendent RIEN — par le SENS : ${part(duel.sensVides)} · par les MOTS : ${part(duel.motsVides)}`);
console.log(`   cartes où UN SEUL des deux réussit — le SENS : ${duel.sensSeul} · les MOTS : ${duel.motsSeul} · aucun des deux : ${duel.aucunDesDeux}`);
console.log(`   fichiers communs aux deux réponses : ${Math.round((duel.communs / Math.max(1, duel.total)) * 100)} % — le reste est ce que le sens change`);
console.log(`   fichiers jugés omniprésents, donc neutralisés en vérité stricte : ${[...omnipresents].join(', ') || 'aucun'}\n`);

const auRang = (rangs, k) => `${Math.round((rangs.filter((r) => r > 0 && r <= k).length / Math.max(1, rangs.length)) * 100)} %`;
console.log('4. LE PLAFOND OU LE CLASSEMENT ? — à quel rang la bonne page arrive dans le classement entier');
console.log(`   vérité large  — dans les 7 servis : ${auRang(duel.rangs, 7)} · dans les 20 premiers : ${auRang(duel.rangs, 20)} · dans les 100 premiers : ${auRang(duel.rangs, 100)}`);
console.log(`   vérité stricte — dans les 7 servis : ${auRang(duel.rangsStricts, 7)} · dans les 20 premiers : ${auRang(duel.rangsStricts, 20)} · dans les 100 premiers : ${auRang(duel.rangsStricts, 100)}`);
console.log(`   rang médian de la première bonne page (vérité large) : ${mediane(duel.rangs.filter((r) => r > 0))} sur ${tousLesPassages.length} passages\n`);

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
}
console.log('');

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
  echantillon: { cartes: cartes.length, ecartees: sansFusion },
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
  releves,
};

if (SORTIE_JSON) {
  fs.writeFileSync(SORTIE_JSON, JSON.stringify(bilan, null, 2));
  console.log(`Relevé complet écrit dans ${SORTIE_JSON}`);
}

console.log('Ce relevé MESURE, il ne juge pas : aucun seuil n’est posé ici, et il ne fait échouer aucune construction.');
process.exit(0);
