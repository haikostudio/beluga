import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fichierDuSujet, resumeContinuite, sujetsUtiles } from '@haikodev/shared';
import {
  appendMemory,
  blocMemoire,
  briefing,
  detailProjet,
  empreintesDesFaits,
  faitsDuSujet,
  memoryFacts,
  migrerParSujet,
  newFactsSince,
  readMemory,
  replaceMemory,
} from '../memory.js';

/*
 * LA MÉMOIRE PAR SUJET. Les faits ne vivent plus dans un seul fichier plat :
 * ils sont rangés par sujet, comme les règles. Un agent reçoit l'index, ouvre le
 * SEUL fichier de son sujet, et ne le repaie pas une deuxième fois dans la même
 * session. Après compression, la reprise ne recharge que les sujets utiles.
 */

function dossierDEssai(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-sujets-'));
}

const FAIT_MOBILE =
  "Sur téléphone, tout menu déroulant devient un tiroir posé en bas de l'écran : le doigt n'atteint pas le haut.";
const FAIT_PUBLI =
  'La publication fusionne les branches du lot dans la principale, construit, puis installe la copie servie.';
const FAIT_VOIX = "La voix de l'assistant se tait dès que le bouton Muet est allumé, sans couper la réécoute.";

/* ------------------------------------------------------------------ */
/* Le découpage                                                        */
/* ------------------------------------------------------------------ */

test('chaque fait est écrit dans le fichier de son sujet, jamais dans un fichier plat', () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, FAIT_MOBILE);
  appendMemory(dossier, FAIT_PUBLI);

  assert.deepEqual(faitsDuSujet(dossier, 'mobile'), [FAIT_MOBILE]);
  assert.deepEqual(faitsDuSujet(dossier, 'publication'), [FAIT_PUBLI]);
  assert.equal(faitsDuSujet(dossier, 'voix').length, 0);

  // Le vieux fichier ne porte plus que le sommaire : aucun fait dedans.
  const sommaire = fs.readFileSync(path.join(dossier, 'MEMOIRE.md'), 'utf8');
  assert.doesNotMatch(sommaire, /tiroir posé en bas/);
  assert.match(sommaire, /docs\/memoire\/mobile\.md/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('un projet resté au fichier plat est découpé sans rien perdre, et une seule fois', () => {
  const dossier = dossierDEssai();
  fs.writeFileSync(
    path.join(dossier, 'MEMOIRE.md'),
    `# Mémoire du projet\n\n- ${FAIT_MOBILE}\n- ${FAIT_PUBLI}\n- ${FAIT_VOIX}\n`,
  );

  assert.equal(migrerParSujet(dossier), 3);
  assert.equal(memoryFacts(dossier).length, 3);
  assert.ok(fs.existsSync(path.join(dossier, ...fichierDuSujet('voix').split('/'))));
  // Deuxième passage : plus rien à déplacer, et toujours trois faits.
  assert.equal(migrerParSujet(dossier), 0);
  assert.equal(memoryFacts(dossier).length, 3);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('une synthèse acceptée réécrit les fichiers de sujet et retire ceux devenus vides', () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, FAIT_MOBILE);
  appendMemory(dossier, FAIT_PUBLI);
  replaceMemory(dossier, [FAIT_PUBLI]);

  assert.deepEqual(memoryFacts(dossier), [FAIT_PUBLI]);
  assert.equal(fs.existsSync(path.join(dossier, ...fichierDuSujet('mobile').split('/'))), false);
  fs.rmSync(dossier, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Ce que reçoit l'agent                                               */
/* ------------------------------------------------------------------ */

test("le briefing porte l'index seul : jamais le texte entier d'un sujet", () => {
  const dossier = dossierDEssai();
  for (let i = 0; i < 6; i++) {
    appendMemory(dossier, `${FAIT_MOBILE} Règle ${i}, avec sa raison longue et le piège rencontré ce jour-là.`);
  }
  appendMemory(dossier, FAIT_PUBLI);

  const ouverture = briefing(dossier, 'Essai', true);
  assert.match(ouverture, /la CARTE de l'arbre \(7 faits\)/);
  assert.doesNotMatch(ouverture, /piège rencontré ce jour-là/);
  assert.ok(blocMemoire(dossier).length < readMemory(dossier).length);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test("un sujet demandé rend SES faits, jamais ceux des autres sujets", () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, FAIT_MOBILE);
  appendMemory(dossier, FAIT_PUBLI);
  appendMemory(dossier, FAIT_VOIX);

  const { texte, servis } = detailProjet(dossier, 'mobile');
  assert.match(texte, /tiroir posé en bas/);
  assert.doesNotMatch(texte, /fusionne les branches/);
  assert.doesNotMatch(texte, /bouton Muet/);
  assert.equal(servis.length, 1);
  assert.match(servis[0], /^faits:mobile:/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test("un sujet déjà servi n'est pas resservi ; le même sujet MODIFIÉ repart", () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, FAIT_MOBILE);
  for (let i = 0; i < 5; i++) {
    appendMemory(
      dossier,
      `${FAIT_MOBILE} Variante ${i} : la raison longue de cette règle, le piège rencontré, et la parade retenue.`,
    );
  }
  appendMemory(dossier, FAIT_PUBLI);

  const premier = detailProjet(dossier, 'mobile');
  const second = detailProjet(dossier, 'mobile', premier.servis);
  assert.match(second.texte, /DÉJÀ DANS TON CONTEXTE/);
  assert.doesNotMatch(second.texte, /tiroir posé en bas/);
  assert.ok(second.texte.length < premier.texte.length, 'la deuxième réponse doit être plus courte');
  assert.deepEqual(second.servis, []);

  // Un fait ajouté depuis change la clé du sujet : il repart, lui.
  appendMemory(dossier, "Sur téléphone, la liste des tâches s'ouvre repliée et se déplie d'un appui.");
  const troisieme = detailProjet(dossier, 'mobile', premier.servis);
  assert.match(troisieme.texte, /liste des tâches/);
  assert.equal(troisieme.servis.length, 1);

  // Un autre sujet, lui, n'a jamais été servi.
  assert.match(detailProjet(dossier, 'publication', premier.servis).texte, /fusionne les branches/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('un fait ajouté sous un autre sujet reste un fait NEUF pour la session', () => {
  const dossier = dossierDEssai();
  appendMemory(dossier, FAIT_VOIX);
  const vus = empreintesDesFaits(dossier);

  // Rangé sous « Téléphone », donc AVANT « Voix » dans l'ordre des sujets :
  // un simple décompte l'aurait manqué.
  appendMemory(dossier, FAIT_MOBILE);
  const nouveaux = newFactsSince(dossier, vus);
  assert.deepEqual(nouveaux, [FAIT_MOBILE]);
  fs.rmSync(dossier, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* La reprise après compression                                        */
/* ------------------------------------------------------------------ */

test('les sujets utiles se déduisent du travail en cours, la même règle pour tous les rôles', () => {
  const carte = 'Publication : le déploiement fusionne la branche du lot puis pousse.';
  assert.deepEqual(sujetsUtiles(carte), ['publication']);
  // Le rôle entre dans le même texte, il ne change pas le traitement.
  assert.deepEqual(sujetsUtiles(`${carte}\norchestrator`), ['publication']);
  // Jamais toute la mémoire : trois sujets au plus.
  assert.ok(sujetsUtiles('carte publication quota voix tiroir conversation thème').length <= 3);
  assert.deepEqual(sujetsUtiles('zzz'), []);
});

test('la reprise recharge les sujets utiles, nomme les autres et ne recopie pas tout', () => {
  const resume = resumeContinuite({
    project: 'Essai',
    workdir: '/tmp/essai',
    role: 'task',
    title: 'Déploiement',
    card: { title: 'Publier le lot', description: 'Fusionner la branche du lot.', column: 'running' },
    exchanges: [{ role: 'user', content: 'Vas-y.' }],
    memoire: {
      sujets: [{ id: 'publication', libelle: 'Publication et branches', faits: [FAIT_PUBLI] }],
      autres: ['Téléphone', 'Voix et point du jour'],
    },
  });

  assert.match(resume, /les seuls sujets utiles à cette carte/);
  assert.match(resume, /fusionne les branches/);
  // Les autres sujets sont NOMMÉS, pas rechargés.
  assert.doesNotMatch(resume, /bouton Muet/);
  assert.match(resume, /Téléphone, Voix et point du jour/);
});

test('une reprise sans sujet retenu ne parle pas de mémoire du tout', () => {
  const resume = resumeContinuite({
    project: 'Essai',
    workdir: '/tmp/essai',
    role: 'cadrage',
    title: "Chef d'orchestre",
    exchanges: [],
  });
  assert.doesNotMatch(resume, /sujets utiles/);
});
