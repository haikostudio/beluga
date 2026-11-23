import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETENTION_AUDITS_MS,
  RYTHME_DES_AUDITS_MS,
  auditDu,
  auditsAPurger,
  construireFragment,
  empreinteDuConstat,
  estAgentDeVolet,
  etatsApresControle,
  lireFragment,
  nouveauxPointsGraves,
  pointsACorriger,
  pointsNouveaux,
  prochainPassage,
  rapportPourLAgent,
  serviceDeLaCarte,
  texteDuPointPourLeChamp,
  LABEL_SECURITE,
  type ConstatSecurite,
  type RapportDeSecurite,
} from '@beluga/shared';

function constat(id: string, gravite: ConstatSecurite['gravite'], ou: string[] = [], titre = `Point ${id}`): ConstatSecurite {
  return { id, categorie: 'entetes', gravite, titre, risque: 'r', proposition: 'p', ou };
}

function rapport(constats: ConstatSecurite[]): RapportDeSecurite {
  return { projet: 'P', date: '1 janvier', depotPublic: false, constats, etapes: [{ nom: 'Lecture', etat: 'fait' }] };
}

test('l’empreinte ignore le titre et les lieux : deux audits identiques à lignes décalées n’ont rien de nouveau', () => {
  const avant = rapport([constat('entete-csp', 'moyenne', ['a.ts:10'], '3 adresses sans CSP'), constat('injection-sql', 'critique', ['b.ts:4'])]);
  const apres = rapport([constat('entete-csp', 'moyenne', ['a.ts:42'], '4 adresses sans CSP'), constat('injection-sql', 'critique', ['b.ts:90'])]);
  assert.equal(empreinteDuConstat(avant.constats[0]), empreinteDuConstat(apres.constats[0]));
  assert.deepEqual(pointsNouveaux(avant, apres), []);
  assert.deepEqual(nouveauxPointsGraves(avant, apres), []);
});

test('seul un point critique ou élevé NOUVEAU d’un audit est signalé (dans le tableau, sans réveiller d’agent)', () => {
  const avant = rapport([constat('entete-csp', 'moyenne')]);
  const apres = rapport([constat('entete-csp', 'moyenne'), constat('secrets-navigateur', 'elevee'), constat('entete-cadre', 'faible')]);
  const graves = nouveauxPointsGraves(avant, apres);
  assert.deepEqual(graves.map((c) => c.id), ['secrets-navigateur']);
  // Le premier audit d'un projet (son ajout) n'alerte jamais.
  assert.deepEqual(nouveauxPointsGraves(null, apres), []);
});

test('les états suivent l’audit : naissance, correction prouvée, réapparition', () => {
  const r = rapport([constat('a', 'critique'), constat('b', 'moyenne')]);
  // Tout est neuf.
  assert.deepEqual(etatsApresControle([], r), [
    { empreinte: 'entetes:a', etat: 'a-traiter', nouveau: true },
    { empreinte: 'entetes:b', etat: 'a-traiter', nouveau: true },
  ]);
  const points = [
    { empreinte: 'entetes:a', etat: 'en-correction' as const, cardId: 'c1' },
    { empreinte: 'entetes:b', etat: 'en-correction' as const, cardId: 'c1' },
    { empreinte: 'entetes:z', etat: 'corrige' as const },
  ];
  // Un audit hebdomadaire avant la mise en ligne : rien ne bouge.
  assert.deepEqual(etatsApresControle(points, r), []);
  // Après la mise en ligne de c1 : « a » a disparu (corrigé, carte gardée), « b » résiste et revient à traiter.
  const apres = rapport([constat('b', 'moyenne'), constat('z', 'faible')]);
  assert.deepEqual(etatsApresControle(points, apres, ['c1']), [
    { empreinte: 'entetes:b', etat: 'a-traiter' },
    { empreinte: 'entetes:z', etat: 'a-traiter' },
    { empreinte: 'entetes:a', etat: 'corrige', cardId: 'c1' },
  ]);
});

test('la carte n’emporte que des points à traiter', () => {
  const points = [
    { empreinte: 'x', etat: 'a-traiter' as const },
    { empreinte: 'y', etat: 'en-correction' as const },
    { empreinte: 'z', etat: 'corrige' as const },
  ];
  assert.deepEqual(pointsACorriger(points, ['x', 'y', 'z', 'x', 'inconnu']), ['x']);
});

test('le passage hebdomadaire se recalcule d’après le dernier audit', () => {
  assert.equal(prochainPassage(null, 1000), 1000);
  assert.equal(prochainPassage(5000, 1000), 5000 + RYTHME_DES_AUDITS_MS);
  assert.equal(auditDu(5000, 1000, 5000 + RYTHME_DES_AUDITS_MS - 1), false);
  assert.equal(auditDu(5000, 1000, 5000 + RYTHME_DES_AUDITS_MS), true);
});

test('l’historique garde douze mois, le dernier audit de chaque projet et ceux qu’une carte suivie désigne', () => {
  const maintenant = 10 * RETENTION_AUDITS_MS;
  const vieux = maintenant - RETENTION_AUDITS_MS - 1;
  const audits = [
    { id: 'a1', projectId: 'p', lance: vieux - 10 },
    { id: 'a2', projectId: 'p', lance: vieux },
    { id: 'a3', projectId: 'p', lance: maintenant - 1000 },
    { id: 'b1', projectId: 'q', lance: vieux },
  ];
  assert.deepEqual(auditsAPurger(audits, maintenant, new Set(['a2'])), ['a1']);
});

test('le contexte de l’agent porte les empreintes et jamais de valeur', () => {
  const texte = rapportPourLAgent(rapport([constat('secrets-navigateur', 'elevee', ['web/app.ts:3'])]), [], '1 janvier');
  assert.match(texte, /\[entetes:secrets-navigateur\] elevee · a-traiter/);
  assert.match(texte, /✓ Lecture/);
  assert.equal(texteDuPointPourLeChamp({ titre: '  Une   clé  ', gravite: 'elevee' }), 'Corriger : Une clé');
});

test('l’agent de sécurité est un agent de volet, qui ramène au service', () => {
  const agent = { role: 'task', workdir: null };
  const carte = { labels: [LABEL_SECURITE] };
  assert.equal(estAgentDeVolet(agent, carte), true);
  assert.equal(serviceDeLaCarte(agent, carte), 'securite');
  // Une carte ordinaire étiquetée « securite » n'en est pas une.
  assert.equal(estAgentDeVolet(agent, { labels: ['securite'] }), false);
});

test('l’adresse du service fait l’aller-retour', () => {
  assert.equal(construireFragment({ vue: 'securite' }), 'securite');
  assert.equal(construireFragment({ vue: 'securite', projetId: 'abc' }), 'securite/abc');
  assert.deepEqual(lireFragment('securite/abc'), { vue: 'securite', projetId: 'abc' });
  assert.deepEqual(lireFragment('securite'), { vue: 'securite' });
});

test('la correction groupée : points à traiter seulement, du plus grave au plus léger, niveau selon le pire', async () => {
  const { pointsDeLaCorrectionGroupee, niveauDeLaCorrection, carteDeCorrectionGroupee } = await import('@beluga/shared');
  type C = import('@beluga/shared').ConstatSecurite;
  const c = (id: string, gravite: C['gravite']): C => ({ id, categorie: 'entetes', gravite, titre: id, risque: 'r', proposition: 'p', ou: [] });
  const rapport = { constats: [c('a', 'faible'), c('b', 'critique'), c('d', 'moyenne'), c('e', 'critique'), c('f', 'elevee')] };
  const liste = pointsDeLaCorrectionGroupee(rapport, [{ empreinte: 'entetes:e', etat: 'en-correction' }]);
  assert.deepEqual(liste.map((x) => x.id), ['b', 'f', 'd', 'a']);
  assert.equal(niveauDeLaCorrection(liste), 'approfondi');
  assert.equal(niveauDeLaCorrection([c('x', 'elevee')]), 'standard');
  const carte = carteDeCorrectionGroupee('Boutique', liste);
  assert.equal(carte.titre, 'Sécurité : corriger 4 points de Boutique');
  assert.ok(carte.description.indexOf('[Critique] b') < carte.description.indexOf('[Faible] a'));
});
