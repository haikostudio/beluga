import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARTES_NOMMEES_MAX,
  ETAPES_CONFIEES,
  RECIT_MAX,
  mentionEtapeConfiee,
  phraseDEchecConfie,
  planDeMiseEnLigne,
  promptDeLAgentDeProduction,
  promptDeMiseEnProduction,
  recitDeLAgent,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Confier la mise en production à un agent qui suit le prompt réglé    */
/* ------------------------------------------------------------------ */

/*
 * Le DÉPLOIEMENT ne se règle plus : il fusionne le lot, l'enregistre, l'envoie
 * sur le dépôt et rafraîchit l'instance de dev constatée sur ce serveur. La
 * MISE EN PRODUCTION, elle, ne se devine pas — d'où un prompt réglé dans les
 * paramètres du projet, confié à un agent.
 *
 * Deux cas se vérifient ici :
 * — prompt ABSENT : le déroulé constaté tient mot pour mot ;
 * — prompt PRÉSENT : la mise en ligne est confiée à un agent, qui reçoit le
 *   prompt tel quel et le lot de cartes.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

const PROMPT = [
  'Pousse la branche principale sur le dépôt du client (remote « client »),',
  'puis relance le conteneur : `ssh client "cd /srv/app && docker compose up -d --build"`.',
].join('\n');

const CONTEXTE = {
  projet: 'Boutique Durand',
  dossier: '/root/boutique-durand',
  branche: 'main',
  url: 'https://boutique.example.com',
  prompt: PROMPT,
  cartes: [
    { titre: 'Corriger le panier vide', branche: 'tache/panier-vide-1234' },
    { titre: 'Ajouter la TVA', branche: 'tache/tva-5678' },
  ],
  enregistrement: 'a1b2c3d4',
  clot: true,
};

/* --- Cas 1 : aucun prompt, rien ne bouge ----------------------------- */

test('sans prompt, le plan de mise en ligne ne change pas d’un pouce', () => {
  assert.equal(promptDeMiseEnProduction(undefined), '');
  assert.equal(promptDeMiseEnProduction({}), '');
  assert.equal(
    promptDeMiseEnProduction({ miseEnProduction: { prompt: '   ' } }),
    '',
    'des espaces ne sont pas un prompt',
  );

  // Les trois constats répondent exactement comme avant.
  assert.equal(planDeMiseEnLigne({ estHaikoDev: true }).installation, 'haikodev');
  assert.equal(planDeMiseEnLigne({ service: 'x.service' }).redemarrage, 'service');
  assert.equal(planDeMiseEnLigne({ dossierServi: true }).installation, 'dossier-servi');
  assert.equal(planDeMiseEnLigne({}).installation, 'aucune');
  assert.equal(
    planDeMiseEnLigne({ prompt: '  ', service: 'x.service' }).installation,
    'service',
    'un prompt vide ne prend la main sur rien',
  );
});

test('sans prompt, la publication garde ses sept étapes, dans le même ordre', () => {
  const ordre = SOURCE.match(/const STEP_ORDER: DeployStepKey\[\] = \[([^\]]*)\]/);
  assert.ok(ordre, 'l’ordre des étapes doit rester écrit noir sur blanc');
  assert.equal(
    ordre[1].replace(/['\s]/g, ''),
    'merge,commit,push,verify,build,publish,restart',
    'aucune étape renommée, supprimée ni déplacée',
  );
  // Le chemin d'avant est toujours là, juste derrière la cible et le prompt.
  const cible = SOURCE.indexOf("if (etape.cible === 'production' && typeCible !== 'consigne') {");
  const prompt = SOURCE.indexOf('} else if (prompt) {');
  const soi = SOURCE.indexOf('} else if (project.isSelf) {');
  assert.ok(
    cible !== -1 && prompt !== -1 && soi !== -1 && cible < prompt && prompt < soi,
    'cible SSH/FTP/Aucune, puis prompt, puis HaikoDev, puis projet ordinaire',
  );
});

/* --- Cas 2 : un prompt de mise en production est réglé ---------------- */

test('un prompt réglé devient le premier moyen de mise en ligne', () => {
  const plan = planDeMiseEnLigne({ prompt: PROMPT });
  assert.equal(plan.construction, 'agent');
  assert.equal(plan.installation, 'agent');
  assert.equal(plan.redemarrage, 'agent');
  assert.match(plan.raison, /agent de mise en production/);
});

test('le prompt passe DEVANT HaikoDev, le service et le dossier servi', () => {
  const plan = planDeMiseEnLigne({
    prompt: PROMPT,
    estHaikoDev: true,
    service: 'x.service',
    dossierServi: true,
  });
  assert.equal(plan.installation, 'agent', 'le prompt décrit ce qu’aucun constat ne sait dire');
});

test('le prompt se lit sur le PROJET, jamais sur un environnement', () => {
  const projet = { miseEnProduction: { prompt: `  ${PROMPT}  ` } };
  assert.equal(promptDeMiseEnProduction(projet), PROMPT, 'les bords sont retirés, le texte reste entier');
});

test('sans prompt ni instance constatée, le plan renvoie au bloc « Mise en production »', () => {
  const plan = planDeMiseEnLigne({});
  assert.match(plan.raison, /Mise en production/);
  assert.match(plan.raison, /Aucune instance de dev/);
});

test('l’agent reçoit le prompt TEL QUEL, sans reformulation', () => {
  const texte = promptDeLAgentDeProduction(CONTEXTE);
  assert.ok(texte.includes(PROMPT), 'le prompt réglé est recopié mot pour mot');
  assert.match(texte, /début du prompt/);
  assert.match(texte, /fin du prompt/);
});

test('l’agent reçoit le projet, son dossier, sa branche et l’adresse à contrôler', () => {
  const texte = promptDeLAgentDeProduction(CONTEXTE);
  assert.match(texte, /« Boutique Durand »/);
  assert.match(texte, /https:\/\/boutique\.example\.com/);
  assert.match(texte, /Branche installée : main/);
  assert.match(texte, /\/root\/boutique-durand/);
  assert.match(texte, /a1b2c3d4/, 'l’enregistrement mis en ligne est nommé');
});

test('sans branche ni adresse réglées, l’agent le sait — jamais un blanc', () => {
  const texte = promptDeLAgentDeProduction({
    ...CONTEXTE,
    branche: undefined,
    url: undefined,
    enregistrement: undefined,
  });
  assert.match(texte, /Branche installée : la branche principale du dépôt/);
  assert.match(texte, /Aucune adresse à contrôler/);
  assert.doesNotMatch(texte, /Enregistrement mis en ligne/);
  assert.doesNotMatch(texte, /\n\n\n/, 'une ligne absente ne laisse pas de trou');
});

test('l’agent reçoit le LOT de cartes embarquées, par leur titre et leur branche', () => {
  const texte = promptDeLAgentDeProduction(CONTEXTE);
  assert.match(texte, /2 carte\(s\)/);
  assert.match(texte, /- Corriger le panier vide \(branche tache\/panier-vide-1234\)/);
  assert.match(texte, /- Ajouter la TVA \(branche tache\/tva-5678\)/);
});

test('un lot énorme est compté au lieu d’être déroulé sans fin', () => {
  const cartes = Array.from({ length: CARTES_NOMMEES_MAX + 5 }, (_, i) => ({ titre: `Carte ${i}` }));
  const texte = promptDeLAgentDeProduction({ ...CONTEXTE, cartes });
  assert.match(texte, /et 5 autre\(s\)/);
});

test('un lot sans carte le dit, plutôt que de laisser une liste vide', () => {
  const texte = promptDeLAgentDeProduction({ ...CONTEXTE, cartes: [] });
  assert.match(texte, /aucune carte/);
});

test('l’agent sait si cette mise en ligne clôt les cartes', () => {
  assert.match(promptDeLAgentDeProduction(CONTEXTE), /DERNIÈRE étape/);
  assert.match(promptDeLAgentDeProduction({ ...CONTEXTE, clot: false }), /étape intermédiaire/);
});

test('les garde-fous du travail d’agent sont dans le prompt envoyé', () => {
  const texte = promptDeLAgentDeProduction(CONTEXTE);
  assert.match(texte, /jamais `git add -A`/, 'le dossier du projet est partagé');
  assert.match(texte, /ne crée pas de branche/);
  assert.match(texte, /n’archive, ne déplace et ne clôture aucune carte/, 'le tableau reste à HaikoDev');
  assert.match(texte, /Ne supprime, ne désactive et ne mets en commentaire AUCUN test/);
  assert.match(texte, /une publication annoncée sans rien en ligne est une faute/);
});

test('le prompt envoyé ne nomme aucun outil propre à un moteur', () => {
  const texte = promptDeLAgentDeProduction(CONTEXTE);
  assert.doesNotMatch(texte, /TaskCreate|TaskUpdate|update_plan|TodoWrite/);
});

/* --- Ce que les étapes affichent ------------------------------------ */

test('les quatre étapes confiées parlent toutes — jamais une étape muette', () => {
  assert.deepEqual([...ETAPES_CONFIEES], ['verify', 'build', 'publish', 'restart']);
  for (const etape of ETAPES_CONFIEES) {
    const mention = mentionEtapeConfiee(etape);
    assert.ok(mention.length > 20, `l’étape ${etape} doit dire quelque chose`);
    assert.match(mention, /mise en production/, 'chaque étape dit d’où vient le travail');
  }
});

test('un agent muet ne passe pas pour un agent content', () => {
  assert.match(recitDeLAgent(undefined), /aucun compte rendu/);
  assert.match(recitDeLAgent('   '), /aucun compte rendu/);
  assert.equal(recitDeLAgent('  Tout est en ligne.  '), 'Tout est en ligne.');
});

test('un compte rendu à rallonge est coupé, et la coupe se voit', () => {
  const recit = recitDeLAgent('x'.repeat(RECIT_MAX + 500));
  assert.ok(recit.length <= RECIT_MAX + 2);
  assert.match(recit, /…$/);
});

test('un échec reste un échec, et il dit ce qui n’a pas bougé', () => {
  const phrase = phraseDEchecConfie('le conteneur n’a pas redémarré');
  assert.match(phrase, /le conteneur n’a pas redémarré/);
  assert.match(phrase, /Rien n’est mis en ligne/);
  assert.match(phrase, /les cartes ne bougent pas/);
  // Sans raison connue, la phrase tient debout quand même.
  assert.match(phraseDEchecConfie(), /Rien n’est mis en ligne/);
});

/* --- Le branchement dans la publication ------------------------------ */

test('la publication confie la mise en production à un agent de rôle « deploy »', () => {
  const debut = SOURCE.indexOf('async function confierLaMiseEnLigne');
  assert.notEqual(debut, -1, 'la fonction qui confie doit exister');
  const corps = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut));
  assert.match(corps, /role: 'deploy'/);
  assert.match(corps, /promptDeLAgentDeProduction\(ctx\)/, 'le prompt pur est celui qui part');
  // Les options peuvent tenir sur une ligne ou plusieurs (le motif d'appel s'y
  // est ajouté) : c'est leur CONTENU qui compte, pas leur mise en page.
  assert.match(corps, /template: 'free',?\s/);
  assert.match(corps, /silent: true,?\s/);
});

test('le prompt est jugé AVANT le déroulé constaté', () => {
  const prompt = SOURCE.indexOf('const prompt = promptProduction;');
  const siPrompt = SOURCE.indexOf('if (prompt) {', prompt);
  const siSoi = SOURCE.indexOf('} else if (project.isSelf) {', prompt);
  assert.ok(prompt !== -1 && siPrompt !== -1 && siSoi !== -1);
  assert.ok(siPrompt < siSoi, 'le prompt l’emporte, comme dans le plan');
});

test('les quatre étapes sont posées, et l’échec de l’agent arrête tout', () => {
  const debut = SOURCE.indexOf('} else if (prompt) {');
  const corps = SOURCE.slice(debut, SOURCE.indexOf('} else if (project.isSelf) {', debut));
  for (const etape of ETAPES_CONFIEES) {
    assert.match(corps, new RegExp(`setStep\\(current, '${etape}'`), `l’étape ${etape} doit être posée`);
  }
  assert.match(corps, /if \(!menee\.ok\) throw new Error\(phraseDEchecConfie\(/);
  assert.match(corps, /cartes: cards\.map\(/, 'le lot embarqué part avec le prompt');
  assert.match(corps, /enregistrement: current\.targetCommit/);
});

test('les garde-fous d’avant restent entiers autour de la bifurcation', () => {
  // Réparation d'une construction et d'un contrôle tombé : intactes.
  assert.match(SOURCE, /async function reparerLaConstruction\(/);
  assert.match(SOURCE, /async function reparerLesControles\(/);
  // Rien n'est annoncé « publié » sans mise en ligne réelle.
  assert.match(SOURCE, /!miseEnLigneReelle\(\{/);
  // Les notifications de fin et d'échec ne bougent pas.
  assert.match(SOURCE, /motif: 'publication-terminee'/);
  assert.match(SOURCE, /motif: 'publication-echec'/);
});
