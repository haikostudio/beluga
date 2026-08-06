import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENV_HERITE,
  ajouterEnvironnement,
  deplacerEnvironnement,
  derniersResultats,
  environnementVise,
  environnementsDuProjet,
  identifiantEnvironnement,
  libelleRole,
  mentionResultat,
  modifierEnvironnement,
  planDeMiseEnLigne,
  retirerEnvironnement,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Reprise d'un projet réglé à l'ancien format                          */
/* ------------------------------------------------------------------ */

test('un projet réglé à l’ancienne se relit comme un environnement « interne »', () => {
  const liste = environnementsDuProjet({
    deployCommand: 'bash deploy.sh',
    deployUrl: 'https://mon-site.example',
  });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].id, ENV_HERITE);
  assert.equal(liste[0].role, 'interne');
  assert.equal(liste[0].commande, 'bash deploy.sh');
  assert.equal(liste[0].url, 'https://mon-site.example');
});

test('un projet sans aucun réglage a quand même un environnement, vide', () => {
  const liste = environnementsDuProjet({});
  assert.equal(liste.length, 1);
  assert.equal(liste[0].commande, undefined);
  assert.equal(liste[0].url, undefined);
});

test('une liste d’environnements l’emporte sur les anciens champs', () => {
  const liste = environnementsDuProjet({
    deployCommand: 'bash vieux.sh',
    environments: [{ id: 'prod', nom: 'Production', role: 'production', commande: 'bash prod.sh' }],
  });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].commande, 'bash prod.sh');
});

test('les valeurs vides ou faites d’espaces ne comptent pas', () => {
  const liste = environnementsDuProjet({ deployCommand: '   ', deployUrl: '' });
  assert.equal(liste[0].commande, undefined);
  assert.equal(liste[0].url, undefined);
});

test('un environnement au rôle inconnu retombe sur « interne »', () => {
  const liste = environnementsDuProjet({
    environments: [{ id: 'x', nom: 'X', role: 'peu-importe' as any }],
  });
  assert.equal(liste[0].role, 'interne');
});

/* ------------------------------------------------------------------ */
/* Quel environnement une publication vise                              */
/* ------------------------------------------------------------------ */

const TROIS = {
  environments: [
    { id: 'interne', nom: 'Interne', role: 'interne' as const, commande: 'bash interne.sh' },
    { id: 'dev-client', nom: 'Dev client', role: 'dev-client' as const, commande: 'bash dev.sh' },
    { id: 'prod', nom: 'Production', role: 'production' as const },
  ],
};

test('sans choix, c’est le PREMIER de la liste qui est visé', () => {
  assert.equal(environnementVise(TROIS).id, 'interne');
});

test('un environnement nommé est visé tel quel', () => {
  assert.equal(environnementVise(TROIS, 'prod').nom, 'Production');
});

test('un environnement disparu retombe sur le premier, jamais sur rien', () => {
  assert.equal(environnementVise(TROIS, 'jamais-vu').id, 'interne');
});

/* ------------------------------------------------------------------ */
/* Un environnement sans moyen d'agir est refusé EN LE NOMMANT          */
/* ------------------------------------------------------------------ */

test('un environnement sans aucun moyen est refusé, et le refus le NOMME', () => {
  const env = environnementVise(TROIS, 'prod');
  const plan = planDeMiseEnLigne({ commande: env.commande, environnement: env.nom });
  assert.equal(plan.possible, false);
  assert.match(plan.raison, /Production/);
  assert.match(plan.raison, /aucun moyen d’être mis en ligne/);
  assert.equal(plan.environnement, 'Production');
});

test('un environnement qui a sa commande passe, et le plan porte son nom', () => {
  const env = environnementVise(TROIS, 'dev-client');
  const plan = planDeMiseEnLigne({ commande: env.commande, environnement: env.nom });
  assert.equal(plan.possible, true);
  assert.equal(plan.installation, 'commande');
  assert.equal(plan.environnement, 'Dev client');
});

test('sans environnement nommé, le refus garde exactement sa phrase d’avant', () => {
  const plan = planDeMiseEnLigne({});
  assert.equal(plan.environnement, undefined);
  assert.match(plan.raison, /Ce projet n’a aucun moyen d’être mis en ligne/);
});

test('un service système sur le dossier vaut pour l’environnement visé', () => {
  const plan = planDeMiseEnLigne({ service: 'client.service', environnement: 'Dev client' });
  assert.equal(plan.possible, true);
  assert.equal(plan.redemarrage, 'service');
  assert.equal(plan.environnement, 'Dev client');
});

/* ------------------------------------------------------------------ */
/* Ajouter, renommer, ranger, retirer                                   */
/* ------------------------------------------------------------------ */

test('un identifiant se déduit du nom, sans accent ni espace', () => {
  assert.equal(identifiantEnvironnement('Dév chez le client', []), 'dev-chez-le-client');
});

test('deux environnements du même nom ne partagent pas leur identifiant', () => {
  const un = ajouterEnvironnement([], { nom: 'Production' });
  const deux = ajouterEnvironnement(un, { nom: 'Production' });
  assert.equal(deux[0].id, 'production');
  assert.equal(deux[1].id, 'production-2');
});

test('ajouter pose l’environnement EN FIN de liste : le premier ne change pas', () => {
  const liste = ajouterEnvironnement(environnementsDuProjet(TROIS), { nom: 'Recette' });
  assert.equal(liste.length, 4);
  assert.equal(liste[0].id, 'interne');
  assert.equal(liste[3].nom, 'Recette');
});

test('modifier n’écrit que sur l’environnement visé', () => {
  const liste = modifierEnvironnement(environnementsDuProjet(TROIS), 'prod', {
    nom: 'Prod client',
    commande: 'bash prod.sh',
  });
  assert.equal(liste[2].nom, 'Prod client');
  assert.equal(liste[2].commande, 'bash prod.sh');
  assert.equal(liste[0].nom, 'Interne');
});

test('monter et descendre échangent deux voisins', () => {
  const liste = deplacerEnvironnement(environnementsDuProjet(TROIS), 'prod', 'haut');
  assert.deepEqual(
    liste.map((env) => env.id),
    ['interne', 'prod', 'dev-client'],
  );
});

test('aux deux bouts, rien ne bouge', () => {
  const liste = environnementsDuProjet(TROIS);
  assert.deepEqual(deplacerEnvironnement(liste, 'interne', 'haut'), liste);
  assert.deepEqual(deplacerEnvironnement(liste, 'prod', 'bas'), liste);
});

test('retirer enlève le bon environnement', () => {
  const liste = retirerEnvironnement(environnementsDuProjet(TROIS), 'dev-client');
  assert.deepEqual(
    liste.map((env) => env.id),
    ['interne', 'prod'],
  );
});

test('le DERNIER environnement ne se retire pas', () => {
  const seul = environnementsDuProjet({ deployCommand: 'bash x.sh' });
  assert.deepEqual(retirerEnvironnement(seul, seul[0].id), seul);
});

/* ------------------------------------------------------------------ */
/* Le dernier résultat de chaque environnement                          */
/* ------------------------------------------------------------------ */

const ENVS = environnementsDuProjet(TROIS);

test('chaque environnement garde sa dernière publication, la plus récente', () => {
  const derniers = derniersResultats(ENVS, [
    { environmentId: 'prod', state: 'failed', startedAt: 100, error: 'adresse injoignable' },
    { environmentId: 'prod', state: 'success', startedAt: 300 },
    { environmentId: 'dev-client', state: 'success', startedAt: 200 },
  ]);
  assert.equal(derniers.get('prod')?.state, 'success');
  assert.equal(derniers.get('dev-client')?.state, 'success');
  assert.equal(derniers.get('interne'), undefined);
});

test('une publication d’AVANT les environnements compte pour le premier', () => {
  const derniers = derniersResultats(ENVS, [{ state: 'success', startedAt: 50 }]);
  assert.equal(derniers.get('interne')?.state, 'success');
});

test('une publication d’un environnement supprimé retombe sur le premier', () => {
  const derniers = derniersResultats(ENVS, [{ environmentId: 'efface', state: 'failed', startedAt: 70 }]);
  assert.equal(derniers.get('interne')?.state, 'failed');
});

test('ce qui n’a jamais été publié le dit, sans chiffre inventé', () => {
  assert.equal(mentionResultat(undefined), 'jamais publié');
  assert.equal(mentionResultat({ state: 'success', startedAt: 1 }), 'dernière publication réussie');
  assert.match(mentionResultat({ state: 'failed', startedAt: 1, error: 'build' }), /échec : build/);
  assert.equal(mentionResultat({ state: 'running', startedAt: 1 }), 'publication en cours');
});

test('chaque rôle a son nom en français simple', () => {
  assert.equal(libelleRole('interne'), 'interne');
  assert.equal(libelleRole('dev-client'), 'dev chez le client');
  assert.equal(libelleRole('production'), 'production');
});
