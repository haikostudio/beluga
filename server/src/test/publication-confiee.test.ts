import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARTES_NOMMEES_MAX,
  ETAPES_CONFIEES,
  RECIT_MAX,
  consigneDeDeploiement,
  consigneDeLAgentDePublication,
  environnementsDuProjet,
  mentionEtapeConfiee,
  phraseDEchecConfie,
  planDeMiseEnLigne,
  publicationConfiee,
  recitDeLAgent,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Confier la mise en ligne à un agent qui suit la consigne réglée      */
/* ------------------------------------------------------------------ */

/*
 * La publication enchaînait sept étapes figées, identiques pour tous les
 * projets. Un agent de rôle « deploy » n'entrait qu'en secours (conflit,
 * construction cassée, contrôle tombé) et rien ne permettait de décrire un
 * déploiement propre à un projet.
 *
 * Deux cas se vérifient ici, et un seul est neuf :
 * — consigne ABSENTE : le déroulé d'avant tient mot pour mot ;
 * — consigne PRÉSENTE : la mise en ligne est confiée à un agent, qui reçoit la
 *   consigne telle quelle, l'environnement visé et le lot de cartes.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

const CONSIGNE = [
  'Pousse la branche principale sur le dépôt du client (remote « client »),',
  'puis relance le conteneur : `ssh client "cd /srv/app && docker compose up -d --build"`.',
].join('\n');

const CONTEXTE = {
  projet: 'Boutique Durand',
  dossier: '/root/boutique-durand',
  environnement: {
    nom: 'Prod client',
    role: 'production',
    url: 'https://boutique.example.com',
    branche: 'livraison',
  },
  consigne: CONSIGNE,
  cartes: [
    { titre: 'Corriger le panier vide', branche: 'tache/panier-vide-1234' },
    { titre: 'Ajouter la TVA', branche: 'tache/tva-5678' },
  ],
  enregistrement: 'a1b2c3d4',
  clot: true,
};

/* --- Cas 1 : aucune consigne, rien ne bouge -------------------------- */

test('sans consigne, le plan de mise en ligne ne change pas d’un pouce', () => {
  assert.equal(publicationConfiee(undefined), false);
  assert.equal(publicationConfiee({}), false);
  assert.equal(publicationConfiee({ consigne: '   ' }), false, 'des espaces ne sont pas une consigne');

  // Les quatre moyens d'avant répondent exactement comme avant.
  assert.equal(planDeMiseEnLigne({ commande: 'bash deploy.sh' }).installation, 'commande');
  assert.equal(planDeMiseEnLigne({ estHaikoDev: true }).installation, 'haikodev');
  assert.equal(planDeMiseEnLigne({ service: 'x.service' }).redemarrage, 'service');
  assert.equal(planDeMiseEnLigne({ dossierServi: true }).installation, 'dossier-servi');
  assert.equal(planDeMiseEnLigne({}).possible, false);
  assert.equal(planDeMiseEnLigne({ consigne: '  ' }).possible, false, 'une consigne vide ne sauve rien');
});

test('sans consigne, la publication garde ses sept étapes, dans le même ordre', () => {
  const ordre = SOURCE.match(/const STEP_ORDER: DeployStepKey\[\] = \[([^\]]*)\]/);
  assert.ok(ordre, 'l’ordre des étapes doit rester écrit noir sur blanc');
  assert.equal(
    ordre[1].replace(/['\s]/g, ''),
    'merge,commit,push,verify,build,publish,restart',
    'aucune étape renommée, supprimée ni déplacée',
  );
  // Les trois branches d'avant sont toujours là, dans le même ordre.
  const commande = SOURCE.indexOf('} else if (deployCommand) {');
  const soi = SOURCE.indexOf('} else if (project.isSelf) {');
  assert.ok(commande !== -1 && soi !== -1 && commande < soi, 'commande, puis HaikoDev, puis projet ordinaire');
});

test('un environnement se relit sans consigne exactement comme avant', () => {
  const [env] = environnementsDuProjet({ deployCommand: 'make ship', deployUrl: 'https://x.test' });
  assert.equal(env.id, 'interne');
  assert.equal(env.commande, 'make ship');
  assert.equal(env.consigne, undefined, 'aucune consigne inventée pour un projet à l’ancien format');
});

/* --- Cas 2 : une consigne est réglée --------------------------------- */

test('une consigne réglée devient un cinquième moyen de mise en ligne', () => {
  const plan = planDeMiseEnLigne({ consigne: CONSIGNE, environnement: 'Prod client' });
  assert.equal(plan.possible, true);
  assert.equal(plan.construction, 'agent');
  assert.equal(plan.installation, 'agent');
  assert.equal(plan.redemarrage, 'agent');
  assert.match(plan.raison, /agent de publication/);
  assert.equal(plan.environnement, 'Prod client');
});

test('la consigne passe DEVANT la commande, le service et le dossier servi', () => {
  const plan = planDeMiseEnLigne({
    consigne: CONSIGNE,
    commande: 'make ship',
    estHaikoDev: true,
    service: 'x.service',
    dossierServi: true,
  });
  assert.equal(plan.installation, 'agent', 'la consigne décrit ce qu’aucun autre moyen ne sait dire');
});

test('la consigne se lit sur l’environnement, et survit à la relecture', () => {
  const [env] = environnementsDuProjet({
    environments: [{ id: 'prod', nom: 'Prod client', role: 'production', consigne: `  ${CONSIGNE}  ` }],
  });
  assert.equal(env.consigne, CONSIGNE, 'les espaces de bord sont retirés, le texte reste entier');
  assert.equal(consigneDeDeploiement(env), CONSIGNE);
  assert.equal(publicationConfiee(env), true);
});

test('l’agent reçoit la consigne TELLE QUELLE, sans reformulation', () => {
  const texte = consigneDeLAgentDePublication(CONTEXTE);
  assert.ok(texte.includes(CONSIGNE), 'la consigne réglée est recopiée mot pour mot');
  assert.match(texte, /début de la consigne/);
  assert.match(texte, /fin de la consigne/);
});

test('l’agent reçoit l’environnement visé : nom, rôle, adresse et branche', () => {
  const texte = consigneDeLAgentDePublication(CONTEXTE);
  assert.match(texte, /« Prod client »/);
  assert.match(texte, /production/);
  assert.match(texte, /https:\/\/boutique\.example\.com/);
  assert.match(texte, /Branche installée : livraison/);
  assert.match(texte, /\/root\/boutique-durand/);
  assert.match(texte, /a1b2c3d4/, 'l’enregistrement mis en ligne est nommé');
});

test('sans branche ni adresse réglées, l’agent le sait — jamais un blanc', () => {
  const texte = consigneDeLAgentDePublication({
    ...CONTEXTE,
    environnement: { nom: 'Interne' },
    enregistrement: undefined,
  });
  assert.match(texte, /Branche installée : la branche principale du dépôt/);
  assert.match(texte, /Aucune adresse à contrôler/);
  assert.doesNotMatch(texte, /Enregistrement mis en ligne/);
  assert.doesNotMatch(texte, /\n\n\n/, 'une ligne absente ne laisse pas de trou');
});

test('l’agent reçoit le LOT de cartes embarquées, par leur titre et leur branche', () => {
  const texte = consigneDeLAgentDePublication(CONTEXTE);
  assert.match(texte, /2 carte\(s\)/);
  assert.match(texte, /- Corriger le panier vide \(branche tache\/panier-vide-1234\)/);
  assert.match(texte, /- Ajouter la TVA \(branche tache\/tva-5678\)/);
});

test('un lot énorme est compté au lieu d’être déroulé sans fin', () => {
  const cartes = Array.from({ length: CARTES_NOMMEES_MAX + 5 }, (_, i) => ({ titre: `Carte ${i}` }));
  const texte = consigneDeLAgentDePublication({ ...CONTEXTE, cartes });
  assert.match(texte, /et 5 autre\(s\)/);
});

test('un lot sans carte le dit, plutôt que de laisser une liste vide', () => {
  const texte = consigneDeLAgentDePublication({ ...CONTEXTE, cartes: [] });
  assert.match(texte, /aucune carte/);
});

test('l’agent sait si cette mise en ligne clôt les cartes', () => {
  assert.match(consigneDeLAgentDePublication(CONTEXTE), /DERNIÈRE étape/);
  assert.match(consigneDeLAgentDePublication({ ...CONTEXTE, clot: false }), /étape intermédiaire/);
});

test('les garde-fous du travail d’agent sont dans la consigne envoyée', () => {
  const texte = consigneDeLAgentDePublication(CONTEXTE);
  assert.match(texte, /jamais `git add -A`/, 'le dossier du projet est partagé');
  assert.match(texte, /ne crée pas de branche/);
  assert.match(texte, /n’archive, ne déplace et ne clôture aucune carte/, 'le tableau reste à HaikoDev');
  assert.match(texte, /Ne supprime, ne désactive et ne mets en commentaire AUCUN test/);
  assert.match(texte, /une publication annoncée sans rien en ligne est une faute/);
});

test('la consigne envoyée ne nomme aucun outil propre à un moteur', () => {
  const texte = consigneDeLAgentDePublication(CONTEXTE);
  assert.doesNotMatch(texte, /TaskCreate|TaskUpdate|update_plan|TodoWrite/);
});

/* --- Ce que les étapes affichent ------------------------------------ */

test('les quatre étapes confiées parlent toutes — jamais une étape muette', () => {
  assert.deepEqual([...ETAPES_CONFIEES], ['verify', 'build', 'publish', 'restart']);
  for (const etape of ETAPES_CONFIEES) {
    const mention = mentionEtapeConfiee(etape, 'Prod client');
    assert.ok(mention.length > 20, `l’étape ${etape} doit dire quelque chose`);
    assert.match(mention, /Prod client/, 'chaque étape nomme l’environnement');
  }
});

test('un agent muet ne passe pas pour un agent content', () => {
  assert.match(recitDeLAgent(undefined, 'Prod client'), /aucun compte rendu/);
  assert.match(recitDeLAgent('   ', 'Prod client'), /aucun compte rendu/);
  assert.equal(recitDeLAgent('  Tout est en ligne.  ', 'Prod client'), 'Tout est en ligne.');
});

test('un compte rendu à rallonge est coupé, et la coupe se voit', () => {
  const recit = recitDeLAgent('x'.repeat(RECIT_MAX + 500), 'Prod client');
  assert.ok(recit.length <= RECIT_MAX + 2);
  assert.match(recit, /…$/);
});

test('un échec reste un échec, et il NOMME l’environnement', () => {
  const phrase = phraseDEchecConfie('Prod client', 'le conteneur n’a pas redémarré');
  assert.match(phrase, /« Prod client »/);
  assert.match(phrase, /le conteneur n’a pas redémarré/);
  assert.match(phrase, /Rien n’est mis en ligne/);
  assert.match(phrase, /restent à déployer/);
  // Sans raison connue, la phrase tient debout quand même.
  assert.match(phraseDEchecConfie('Prod client'), /« Prod client »/);
});

/* --- Le branchement dans la publication ------------------------------ */

test('la publication confie la mise en ligne à un agent de rôle « deploy »', () => {
  const debut = SOURCE.indexOf('async function confierLaMiseEnLigne');
  assert.notEqual(debut, -1, 'la fonction qui confie doit exister');
  const corps = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut));
  assert.match(corps, /role: 'deploy'/);
  assert.match(corps, /consigneDeLAgentDePublication\(ctx\)/, 'la consigne pure est celle qui part');
  assert.match(corps, /template: 'free', silent: true/);
});

test('la consigne est jugée AVANT la commande de publication', () => {
  const consigne = SOURCE.indexOf('const consigne = consigneDeDeploiement(environnement);');
  const siConsigne = SOURCE.indexOf('if (consigne) {', consigne);
  const siCommande = SOURCE.indexOf('} else if (deployCommand) {', consigne);
  assert.ok(consigne !== -1 && siConsigne !== -1 && siCommande !== -1);
  assert.ok(siConsigne < siCommande, 'la consigne l’emporte, comme dans le plan');
});

test('les quatre étapes sont posées, et l’échec de l’agent arrête tout', () => {
  const debut = SOURCE.indexOf('if (consigne) {');
  const corps = SOURCE.slice(debut, SOURCE.indexOf('} else if (deployCommand) {', debut));
  for (const etape of ETAPES_CONFIEES) {
    assert.match(corps, new RegExp(`setStep\\(current, '${etape}'`), `l’étape ${etape} doit être posée`);
  }
  assert.match(corps, /if \(!menee\.ok\) throw new Error\(phraseDEchecConfie\(/);
  assert.match(corps, /cartes: cards\.map\(/, 'le lot embarqué part avec la consigne');
  assert.match(corps, /enregistrement: current\.targetCommit/);
});

test('les garde-fous d’avant restent entiers autour de la bifurcation', () => {
  // Refus quand aucun moyen n'existe : toujours avant de toucher au dépôt.
  assert.match(SOURCE, /if \(!plan\.possible\) return \{ ok: false, error: plan\.raison \};/);
  // Attente d'accord pour un projet « se déploie sur envoi ».
  assert.match(SOURCE, /if \(project\.deployeSurEnvoi && !options\.accordEnvoi\)/);
  // Réparation d'une construction et d'un contrôle tombé : intactes.
  assert.match(SOURCE, /async function reparerLaConstruction\(/);
  assert.match(SOURCE, /async function reparerLesControles\(/);
  // Rien n'est annoncé « publié » sans mise en ligne réelle.
  assert.match(SOURCE, /if \(!miseEnLigneReelle\(/);
  // Les notifications de fin et d'échec ne bougent pas.
  assert.match(SOURCE, /motif: 'publication-terminee'/);
  assert.match(SOURCE, /motif: 'publication-echec'/);
});
