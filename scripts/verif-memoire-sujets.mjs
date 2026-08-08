#!/usr/bin/env node
/*
 * LA MÉMOIRE PAR SUJET, MESURÉE. Ce que reçoit vraiment un agent, en signes :
 *
 *  1. au lancement, l'INDEX général seul — jamais le texte entier d'un sujet ;
 *  2. quand il demande SON sujet, ce sujet-là et rien d'autre ;
 *  3. s'il le redemande dans la même session, un rappel d'une ligne, pas le
 *     fichier une deuxième fois ;
 *  4. après compression, une reprise qui ne recharge que les sujets utiles à
 *     la carte, nomme les autres, et ne recopie pas tout l'historique.
 *
 * Aucun moteur, aucun démon : le mécanisme tout seul, donc rejouable partout.
 *
 *   node scripts/verif-memoire-sujets.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/* ------------------------------------------------------------------ */
/* Un projet d'essai, chargé comme un vrai                             */
/* ------------------------------------------------------------------ */

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-memoire-sujets-'));

/* Un détail par sujet : c'est lui qui prouve d'où vient le texte reçu. */
const DÉTAILS = {
  mobile: 'quatre-vingt-treize millisecondes',
  publication: 'onze secondes de battement',
  voix: 'sept dixièmes de seconde',
  quotas: 'vingt-trois pour cent',
};

/* Le fait PIÉGÉ d'un sujet : son détail est écrit LOIN dans la ligne, là où
   l'index coupe — le retrouver prouve qu'on a lu le fichier, pas l'index. */
const PIÉGÉS = {
  mobile: `Le tiroir des réglages se referme en tirant sa poignée vers le bas, et le geste n'est pris en compte par le doigt qu'au-delà de ${DÉTAILS.mobile}, sinon un simple appui refermait le tiroir.`,
  publication: `La publication fusionne les branches du lot dans la principale, construit, installe la copie servie, puis laisse ${DÉTAILS.publication} avant de rendre la main, le temps que le service reparte.`,
  voix: `La voix se tait dès que le bouton Muet est allumé, et les ondes de son module retombent au repos après ${DÉTAILS.voix} de silence complet.`,
  quotas: `L'alerte d'emballement du quota d'un compte ne part que si la consommation mesurée dépasse de ${DÉTAILS.quotas} la pente attendue, sur deux relevés au moins.`,
};

/* Du remplissage crédible : un projet chargé, pas quatre lignes. */
const REMPLISSAGE = {
  mobile: "Sur téléphone, tout menu déroulant devient un tiroir posé en bas de l'écran et les formulaires passent pleine largeur, parce que le pouce n'atteint pas le haut de l'écran.",
  publication: "Une branche poussée n'est pas livrée, le travail d'une carte finit sur la branche principale, et le déploiement rafraîchit ensuite l'instance de développement.",
  voix: "La voix de l'assistant tutoie l'utilisateur et l'appelle par son prénom, raccourcit ses annonces le soir, et garde son historique dans le navigateur.",
  quotas: "Le catalogue des modèles interroge les comptes l'un après l'autre, si bien qu'un jeton périmé ne fait plus retomber la liste entière.",
};

const FAITS = {};
for (const sujet of Object.keys(PIÉGÉS)) {
  FAITS[sujet] = [PIÉGÉS[sujet], ...Array.from({ length: 5 }, (_, i) => `${REMPLISSAGE[sujet]} Règle ${i + 1}.`)];
  for (const fait of FAITS[sujet]) memory.appendMemory(dossier, fait);
}

console.log(`Projet d'essai : ${dossier}`);
console.log(`Mémoire : ${memory.memoryFacts(dossier).length} faits, ${memory.readMemory(dossier).length} signes en tout.\n`);

/* ------------------------------------------------------------------ */
/* 1. Le découpage sur le disque                                       */
/* ------------------------------------------------------------------ */

console.log('1. Un fichier par sujet, et un sommaire qui ne porte aucun fait');
for (const sujet of Object.keys(FAITS)) {
  const chemin = path.join(dossier, ...partage.fichierDuSujet(sujet).split('/'));
  verifier(fs.existsSync(chemin), `le fichier du sujet « ${sujet} » existe`);
}
const sommaire = fs.readFileSync(path.join(dossier, 'MEMOIRE.md'), 'utf8');
verifier(
  !Object.values(DÉTAILS).some((detail) => sommaire.includes(detail)),
  'le sommaire MEMOIRE.md ne porte plus aucun fait',
);

/* ------------------------------------------------------------------ */
/* 2. Le briefing : l'index général, rien de plus                      */
/* ------------------------------------------------------------------ */

console.log("\n2. Au lancement : l'index général seul");
const bloc = memory.blocMemoire(dossier);
const memoireEntiere = memory.readMemory(dossier);
for (const [sujet, detail] of Object.entries(DÉTAILS)) {
  verifier(!bloc.includes(detail), `le détail du sujet « ${sujet} » n'est PAS dans le briefing`);
}
verifier(bloc.length < memoireEntiere.length, 'le bloc de mémoire est plus court que la mémoire entière');
console.log(`  → index : ${bloc.length} signes contre ${memoireEntiere.length} pour la mémoire entière.`);

/* ------------------------------------------------------------------ */
/* 3. Un sujet demandé : celui-là, et pas les autres                   */
/* ------------------------------------------------------------------ */

console.log('\n3. Le sujet demandé, et rien que lui');
const premier = memory.detailProjet(dossier, 'mobile');
verifier(premier.texte.includes(DÉTAILS.mobile), 'le sujet demandé arrive avec son texte entier');
for (const [sujet, detail] of Object.entries(DÉTAILS)) {
  if (sujet === 'mobile') continue;
  verifier(!premier.texte.includes(detail), `le sujet « ${sujet} », lui, n'est pas servi`);
}

/* ------------------------------------------------------------------ */
/* 4. Le même sujet redemandé : un rappel, pas un second envoi         */
/* ------------------------------------------------------------------ */

console.log('\n4. Le même sujet redemandé dans la même session');
const second = memory.detailProjet(dossier, 'mobile', premier.servis);
verifier(!second.texte.includes(DÉTAILS.mobile), 'le fichier n’est pas renvoyé une deuxième fois');
verifier(second.texte.length < premier.texte.length, 'la réponse est un rappel, plus courte que le sujet');
console.log(`  → ${premier.texte.length} signes la première fois, ${second.texte.length} la seconde ` +
  `(${premier.texte.length - second.texte.length} économisés, environ ${Math.round((premier.texte.length - second.texte.length) / 4)} tokens).`);

memory.appendMemory(dossier, "Sur téléphone, la liste des tâches s'ouvre repliée et se déplie d'un appui.");
const apresChangement = memory.detailProjet(dossier, 'mobile', premier.servis);
verifier(apresChangement.texte.includes('se déplie'), 'un sujet qui a CHANGÉ depuis repart, lui');

/* ------------------------------------------------------------------ */
/* 5. La reprise après compression                                     */
/* ------------------------------------------------------------------ */

console.log('\n5. Après compression : la reprise ne recharge que les sujets utiles');
const CARTE = {
  title: 'Publication : reprendre un déploiement interrompu',
  description: 'Le déploiement fusionne la branche du lot dans la principale, puis pousse et rafraîchit le dev.',
  column: 'running',
};

const retenus = partage.sujetsUtiles([CARTE.title, CARTE.description, 'task'].join('\n'));
verifier(retenus.includes('publication'), 'le sujet de la carte est reconnu');
verifier(retenus.length <= partage.SUJETS_UTILES_MAX, `au plus ${partage.SUJETS_UTILES_MAX} sujets rechargés`);

const HISTORIQUE_LONG = Array.from({ length: 40 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: `Échange numéro ${i} : ${'du texte qui ne dit plus rien à ce stade de la tâche. '.repeat(30)}`,
}));

const resume = partage.resumeContinuite({
  project: "Projet d'essai",
  workdir: dossier,
  role: 'task',
  title: 'Déploiement',
  card: CARTE,
  exchanges: HISTORIQUE_LONG,
  memoire: {
    sujets: retenus.map((id) => ({ id, libelle: partage.libelleSujet(id), faits: memory.faitsDuSujet(dossier, id) })),
    autres: partage.SUJETS_MEMOIRE.filter((s) => !retenus.includes(s.id) && memory.faitsDuSujet(dossier, s.id).length).map(
      (s) => s.libelle,
    ),
  },
});

verifier(resume.includes(DÉTAILS.publication), 'la reprise retrouve les faits du sujet de la carte');
for (const [sujet, detail] of Object.entries(DÉTAILS)) {
  if (retenus.includes(sujet)) continue;
  verifier(!resume.includes(detail), `la reprise ne recharge pas le sujet « ${sujet} »`);
}
verifier(/Téléphone|Voix|Quotas/.test(resume), 'les autres sujets sont NOMMÉS, à demander si besoin');

const historiqueEntier = HISTORIQUE_LONG.map((e) => e.content).join('\n').length;
verifier(resume.length < historiqueEntier, "la reprise ne recopie pas tout l'historique");
console.log(`  → reprise : ${resume.length} signes contre ${historiqueEntier} pour le seul historique des échanges.`);

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`✗ ÉCHEC : ${echecs.length} contrôle(s) tombé(s).\nLe projet d'essai reste dans ${dossier}.`);
  process.exit(1);
}
console.log('✓ La mémoire part par sujet : index au lancement, un sujet à la demande, une seule fois par session,');
console.log('  et une reprise qui ne recharge que ce que la carte touche.');
fs.rmSync(dossier, { recursive: true, force: true });
