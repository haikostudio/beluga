import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENREGISTREMENTS_NOMMES_MAX,
  attentionParProjet,
  decisionsDePublication,
  decisionsHorsCarte,
  decisionsParCarte,
  decisionsParConversation,
  enregistrementsAEnvoyer,
  envoiDemandeAccord,
  estMentionDEnvoi,
  mentionDAttenteSurCarte,
  mentionDeRefusSurCarte,
  premiereDecision,
  raisonDuRefus,
  reperesParProjet,
  texteDeLAttente,
  titreDeLAttente,
  type DecisionAttendue,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Prévenir avant tout envoi qui met la production à jour              */
/* ------------------------------------------------------------------ */

/*
 * La publication envoyait sur GitHub avant de mettre en ligne, sans jamais
 * demander. Sur un projet client dont le serveur se redéploie tout seul à
 * chaque envoi, ce simple envoi mettait la production à jour pendant que
 * HaikoDev annonçait « publication en cours ».
 */

test('un projet qui n’a rien déclaré part sans qu’on lui demande rien', () => {
  assert.equal(envoiDemandeAccord({}), false);
  assert.equal(envoiDemandeAccord({ deployeSurEnvoi: false, estUnDepot: true, aUnDepotDistant: true }), false);
});

test('un projet marqué « se déploie sur envoi » fait attendre', () => {
  assert.equal(envoiDemandeAccord({ deployeSurEnvoi: true, estUnDepot: true, aUnDepotDistant: true }), true);
});

test('l’accord déjà donné ne redemande pas : la publication repart', () => {
  assert.equal(
    envoiDemandeAccord({ deployeSurEnvoi: true, estUnDepot: true, aUnDepotDistant: true, accord: true }),
    false,
  );
});

test('sans dépôt, ou sans dépôt distant, rien ne peut partir : aucune attente', () => {
  assert.equal(envoiDemandeAccord({ deployeSurEnvoi: true, estUnDepot: false }), false);
  assert.equal(envoiDemandeAccord({ deployeSurEnvoi: true, estUnDepot: true, aUnDepotDistant: false }), false);
});

/* ------------------------------------------------------------------ */
/* Ce que la décision annonce                                          */
/* ------------------------------------------------------------------ */

test('un même enregistrement présent dans deux branches n’est compté qu’une fois', () => {
  const titres = enregistrementsAEnvoyer(['Corrige le pied\nAjoute le tri', 'Ajoute le tri\n\nRefait la barre  ']);
  assert.deepEqual(titres, ['Corrige le pied', 'Ajoute le tri', 'Refait la barre']);
});

test('la décision nomme le projet, la branche, ce qui part et ce que ça remplace', () => {
  const texte = texteDeLAttente({
    projet: 'Site du client',
    branche: 'main',
    enregistrements: ['Corrige le pied', 'Ajoute le tri'],
    cartes: 2,
    adresse: 'https://client.example',
  });
  assert.match(texte, /Site du client/);
  assert.match(texte, /« main »/);
  assert.match(texte, /2 enregistrements/);
  assert.match(texte, /- Corrige le pied/);
  assert.match(texte, /2 cartes du lot/);
  assert.match(texte, /https:\/\/client\.example/);
  assert.match(texte, /Rien n’est parti/);
});

test('au-delà de cinq enregistrements, le reste est compté et non énuméré', () => {
  const enregistrements = Array.from({ length: 9 }, (_, i) => `Travail ${i + 1}`);
  const texte = texteDeLAttente({ projet: 'P', branche: 'main', enregistrements });
  const nommes = texte.split('\n').filter((l) => l.startsWith('- ') && !l.includes('… et'));
  assert.equal(nommes.length, ENREGISTREMENTS_NOMMES_MAX);
  assert.match(texte, /… et 4 autres/);
});

test('aucun enregistrement neuf : la décision le dit au lieu de se taire', () => {
  const texte = texteDeLAttente({ projet: 'P', branche: 'main', enregistrements: [] });
  assert.match(texte, /Aucun enregistrement nouveau/);
  assert.doesNotMatch(texte, /0 enregistrement/);
});

test('des travaux non enregistrés sont annoncés : ils partiraient aussi', () => {
  const texte = texteDeLAttente({ projet: 'P', branche: 'main', enregistrements: [], travauxEnCours: true });
  assert.match(texte, /travaux en cours/);
});

test('le titre de la décision nomme le projet', () => {
  assert.match(titreDeLAttente('Site du client'), /Site du client/);
});

/* ------------------------------------------------------------------ */
/* Un refus laisse le lot intact, et l’écrit                            */
/* ------------------------------------------------------------------ */

test('le refus nomme le projet, la branche, et dit que le lot reste entier', () => {
  const raison = raisonDuRefus('Site du client', 'main');
  assert.match(raison, /Site du client/);
  assert.match(raison, /« main »/);
  assert.match(raison, /reste entier/);
});

test('pendant l’attente, chaque carte du lot dit pourquoi elle ne part pas', () => {
  const mention = mentionDAttenteSurCarte('main');
  assert.match(mention, /« main »/);
  assert.match(mention, /accord est attendu/);
  assert.match(mention, /rien n’est parti/);
});

test('les mentions d’envoi se reconnaissent, pour être effacées au départ suivant', () => {
  assert.equal(estMentionDEnvoi(mentionDAttenteSurCarte('main')), true);
  assert.equal(estMentionDEnvoi(mentionDeRefusSurCarte('main')), true);
  assert.equal(estMentionDEnvoi('Aucun compte disponible'), false, 'une autre attente n’est jamais effacée');
  assert.equal(estMentionDEnvoi(undefined), false);
});

/* ------------------------------------------------------------------ */
/* La décision passe par le triangle orange déjà en place              */
/* ------------------------------------------------------------------ */

/** Une décision d'envoi ne tient ni à une carte ni à une conversation. */
const DECISIONS: DecisionAttendue[] = [
  { projectId: 'p1', genre: 'envoi', poseeA: 10 },
  { projectId: 'p1', agentId: 'chef', genre: 'validation', poseeA: 20 },
  { projectId: 'p2', agentId: 'a', cardId: 'c1', genre: 'question', poseeA: 30 },
];

test('une attente d’envoi compte comme décision attendue sur son projet', () => {
  assert.deepEqual(attentionParProjet(DECISIONS), { p1: 2, p2: 1 });
  assert.equal(decisionsDePublication(DECISIONS, 'p1'), 1);
  assert.equal(decisionsDePublication(DECISIONS, 'p2'), 0);
});

test('elle ne se pose ni sur une carte ni sur une conversation', () => {
  assert.deepEqual(decisionsParCarte(DECISIONS), { c1: 1 });
  assert.deepEqual(decisionsParConversation(DECISIONS), { chef: 1 });
  assert.equal(decisionsHorsCarte(DECISIONS, 'p1'), 1, 'l’entrée « Chef » ne porte que la proposition');
});

test('le compte annoncé vaut toujours le nombre de repères posés', () => {
  const parCarte = decisionsParCarte(DECISIONS);
  const parConversation = decisionsParConversation(DECISIONS);
  const publication = { p1: decisionsDePublication(DECISIONS, 'p1'), p2: decisionsDePublication(DECISIONS, 'p2') };
  const total =
    Object.values(parCarte).reduce((a, b) => a + b, 0) +
    Object.values(parConversation).reduce((a, b) => a + b, 0) +
    publication.p1 +
    publication.p2;
  const annonce = Object.values(reperesParProjet(DECISIONS)).reduce((a, b) => a + b, 0);
  assert.equal(total, annonce);
});

test('le triangle emmène sur le projet, sans conversation à ouvrir', () => {
  assert.deepEqual(premiereDecision(DECISIONS, 'p1'), {
    projectId: 'p1',
    agentId: undefined,
    cardId: undefined,
  });
});

/* ------------------------------------------------------------------ */
/* L’attente est posée AVANT que git ne soit touché                     */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

test('la publication demande l’accord avant la première commande git du run', () => {
  const attente = SOURCE.indexOf('envoiDemandeAccord({');
  const fusion = SOURCE.indexOf("setStep(current, 'merge', 'running')");
  assert.notEqual(attente, -1, 'la publication doit passer par `envoiDemandeAccord`');
  assert.notEqual(fusion, -1);
  assert.ok(attente < fusion, 'l’attente se pose avant la fusion, qui pousse déjà la branche courante');
});

test('l’accord fait repartir LA MÊME publication, jamais une seconde ligne', () => {
  assert.match(SOURCE, /id: options\.reprendre\?\.id \?\? store\.newId\(\)/);
});

test('un refus n’archive rien et ne déplace aucune carte', () => {
  const debut = SOURCE.indexOf('export async function repondreEnvoi');
  const fin = SOURCE.indexOf('\nexport async function startDeploy');
  const corps = SOURCE.slice(debut, fin);
  assert.doesNotMatch(corps, /archiveCard|deployedAt|moveCard/);
  assert.match(corps, /marquerLesCartes\(run\.cardIds, mentionDeRefusSurCarte/, 'le refus s’écrit sur les cartes');
  assert.match(corps, /signalAttention/, 'la décision tranchée éteint le triangle');
});

test('la déclaration du projet est la SEULE porte : aucune lecture chez le client', () => {
  const debut = SOURCE.indexOf('if (project.deployeSurEnvoi && !options.accordEnvoi)');
  assert.notEqual(debut, -1);
  const corps = SOURCE.slice(debut, debut + 2000);
  assert.doesNotMatch(corps, /fetch\(/, 'rien n’est interrogé chez le client : c’est une déclaration');
});
