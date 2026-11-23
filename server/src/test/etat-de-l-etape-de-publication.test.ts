import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIBELLE_REPERE_D_AVANCEMENT,
  PHRASES_DU_POURQUOI_MAX,
  essaiReussiConnu,
  etatDeLEtapeDePublication,
  etatDuBoutonDeConfiguration,
  pourquoiCeProcessus,
  reperesDAvancement,
  type SituationDeLEtape,
} from '@beluga/shared';

/**
 * OÙ EN EST UNE ÉTAPE DE PUBLICATION (11/10/2026).
 *
 * Les rubriques « Déploiement » et « Mise en production » des réglages d'un
 * projet s'ouvraient sur des champs, un journal d'étude et un processus déplié :
 * « on ne comprend rien, trop d'informations ; je veux comprendre où j'en suis ».
 * Elles s'ouvrent désormais sur une phrase d'état et trois repères, dictés par
 * des règles pures — celles-ci.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (relatif: string) => fs.readFileSync(path.resolve(ICI, '../../../', relatif), 'utf8');

const AU_REPOS: SituationDeLEtape = { enPlace: false, auTravail: false, question: false, reglagesChanges: false };
const etat = (situation: Partial<SituationDeLEtape>) => etatDeLEtapeDePublication({ ...AU_REPOS, ...situation });
const reperes = (situation: Partial<SituationDeLEtape> & { processus?: boolean; essaiReussi?: boolean }) =>
  reperesDAvancement({ ...AU_REPOS, processus: false, essaiReussi: false, ...situation })
    .map((repere) => `${repere.cle}:${repere.etat}`)
    .join(' ');

test('l’état d’une étape : à configurer, prête, ou à revérifier', () => {
  assert.equal(etat({}), 'a-configurer');
  assert.equal(etat({ enPlace: true }), 'pret');
  assert.equal(etat({ enPlace: true, reglagesChanges: true }), 'a-reverifier');
});

test('rien n’est « à revérifier » tant que rien ne peut partir', () => {
  assert.equal(etat({ enPlace: false, reglagesChanges: true }), 'a-configurer');
});

test('l’agent passe avant ce qui est en place, et sa question avant son travail', () => {
  assert.equal(etat({ auTravail: true }), 'etude');
  assert.equal(etat({ enPlace: true, reglagesChanges: true, auTravail: true }), 'etude');
  assert.equal(etat({ question: true }), 'question');
  /* Un agent arrêté sur sa question n'est en travail pour personne. */
  assert.equal(etat({ enPlace: true, auTravail: true, question: true }), 'question');
});

test('la phrase d’état et le bouton posé à côté ne se contredisent jamais', () => {
  for (const processus of [false, true]) {
    for (const auTravail of [false, true]) {
      for (const question of [false, true]) {
        const bouton = etatDuBoutonDeConfiguration({ processus, auTravail, question });
        const rubrique = etat({ enPlace: processus, auTravail, question });
        assert.equal(rubrique === 'question', bouton === 'question');
        assert.equal(rubrique === 'etude', bouton === 'travail');
        if (bouton === 'initialiser') assert.equal(rubrique, 'a-configurer');
        if (bouton === 'reconfigurer') assert.equal(rubrique, 'pret');
      }
    }
  }
});

test('les trois repères : rien de fait tant que rien n’est en place', () => {
  assert.equal(reperes({}), 'etude:a-faire processus:a-faire essai:a-faire');
  assert.equal(reperes({ auTravail: true }), 'etude:en-cours processus:a-faire essai:a-faire');
  assert.equal(reperes({ question: true }), 'etude:en-cours processus:a-faire essai:a-faire');
});

test('le dernier repère ne dit « Essai réussi » que sur preuve, « Prêt à partir » sinon', () => {
  assert.equal(reperes({ enPlace: true, processus: true }), 'etude:fait processus:fait pret:fait');
  assert.equal(reperes({ enPlace: true, processus: true, essaiReussi: true }), 'etude:fait processus:fait essai:fait');
  assert.equal(LIBELLE_REPERE_D_AVANCEMENT.pret, 'Prêt à partir');
  assert.equal(LIBELLE_REPERE_D_AVANCEMENT.essai, 'Essai réussi');
  /* Une preuve ne vaut rien tant que l'étape ne peut pas partir. */
  assert.equal(reperes({ essaiReussi: true }), 'etude:a-faire processus:a-faire essai:a-faire');
});

test('un réglage changé remet le dernier repère en cause, même après un essai réussi', () => {
  assert.equal(
    reperes({ enPlace: true, processus: true, essaiReussi: true, reglagesChanges: true }),
    'etude:fait processus:fait a-reverifier:a-revoir',
  );
  assert.equal(LIBELLE_REPERE_D_AVANCEMENT['a-reverifier'], 'À revérifier');
});

test('le déroulé commun en service vaut un processus établi, sans étude à son actif', () => {
  /* Beluga, ou un projet hérité : l'étape part, mais aucun agent n'a étudié. */
  assert.equal(reperes({ enPlace: true, processus: false }), 'etude:a-faire processus:fait pret:fait');
});

test('une étude qui reprend laisse en service le processus déjà établi', () => {
  assert.equal(reperes({ enPlace: true, processus: true, auTravail: true }), 'etude:en-cours processus:fait pret:fait');
});

test('la dernière réussite dite par le serveur tient le repère, même après une publication de l’autre étape', () => {
  /* L'écran ne garde que la dernière publication du projet : ici, une mise en
     production — qui effaçait la preuve du déploiement réussi juste avant. */
  const autreEtape = { state: 'success', cible: 'production' as const, startedAt: 5_000, endedAt: 6_000 };
  assert.equal(essaiReussiConnu(autreEtape, 'dev', 1_500), false);
  assert.equal(essaiReussiConnu(autreEtape, 'dev', 1_500, 4_000), true);
  /* Sans publication connue de l'écran du tout (page ouverte à froid). */
  assert.equal(essaiReussiConnu(undefined, 'dev', 1_500, 4_000), true);
  assert.equal(essaiReussiConnu(undefined, 'dev', undefined, 4_000), true);
  /* Une réussite d'avant le processus actuel ne prouve rien pour lui. */
  assert.equal(essaiReussiConnu(undefined, 'dev', 4_500, 4_000), false);
  assert.equal(essaiReussiConnu(undefined, 'dev', 1_500, null), false);
  /* …mais la preuve de l'écran, plus fraîche, reste reçue. */
  const fraiche = { state: 'success', cible: 'dev' as const, startedAt: 5_000, endedAt: 6_000 };
  assert.equal(essaiReussiConnu(fraiche, 'dev', 4_500, 4_000), true);
});

test('un essai réussi n’est connu que pour la bonne étape, réussi, et pas plus vieux que le processus', () => {
  const reussie = { state: 'success', cible: 'production' as const, startedAt: 1_000, endedAt: 2_000 };
  assert.equal(essaiReussiConnu(reussie, 'production', 1_500), true);
  assert.equal(essaiReussiConnu(reussie, 'production'), true);
  /* L'autre étape : la preuve n'est pas pour celle-ci. */
  assert.equal(essaiReussiConnu(reussie, 'dev', 1_500), false);
  /* Le processus a été réécrit depuis : cet essai-là ne prouve plus rien. */
  assert.equal(essaiReussiConnu(reussie, 'production', 2_500), false);
  /* Tombée, arrêtée, en cours : pas une réussite. */
  for (const state of ['failed', 'stopped', 'running']) {
    assert.equal(essaiReussiConnu({ ...reussie, state }, 'production', 1_500), false);
  }
  assert.equal(essaiReussiConnu(undefined, 'production'), false);
});

test('une publication sans étape est un déploiement, celui du lot de « À déployer »', () => {
  const ancienne = { state: 'success', startedAt: 10, endedAt: 20 };
  assert.equal(essaiReussiConnu(ancienne, 'dev'), true);
  assert.equal(essaiReussiConnu(ancienne, 'production'), false);
});

test('le pourquoi tient en deux phrases au plus', () => {
  assert.equal(PHRASES_DU_POURQUOI_MAX, 2);
  const resume =
    'La production tourne sur le serveur Clients (46.224.231.253), à https://kipou.app, dans un conteneur. Publier, c’est fabriquer la nouvelle version puis vérifier les deux adresses. Un retour arrière est prévu.';
  assert.equal(
    pourquoiCeProcessus({ resume }),
    'La production tourne sur le serveur Clients (46.224.231.253), à https://kipou.app, dans un conteneur. Publier, c’est fabriquer la nouvelle version puis vérifier les deux adresses.',
  );
  /* Deux phrases ou moins : le texte passe entier. */
  assert.equal(pourquoiCeProcessus({ resume: 'Le site est chez Vercel.' }), 'Le site est chez Vercel.');
  assert.equal(pourquoiCeProcessus({ resume: 'Une phrase sans point final' }), 'Une phrase sans point final');
  assert.equal(pourquoiCeProcessus(undefined), '');
  assert.equal(pourquoiCeProcessus({}), '');
});

test('le pourquoi prend le résumé de l’agent, jamais le journal de son étude', () => {
  const processus = {
    resume: 'Le site est hébergé chez o2switch, alimenté par GitHub.',
    explication: 'J’étudie comment le site part en ligne. Je vérifie le serveur. Je pose ma question.',
  };
  assert.equal(pourquoiCeProcessus(processus), 'Le site est hébergé chez o2switch, alimenté par GitHub.');
});

test('sans résumé, le pourquoi retombe sur le début de l’explication, sans sa mise en forme', () => {
  const explication = [
    '## Où vit la production',
    '',
    'Votre site est **hébergé chez o2switch**. Le bouton lance `gh workflow run`, puis vérifie que le site répond.',
    '',
    '- Troisième phrase, dans une liste. Quatrième phrase.',
  ].join('\n');
  assert.equal(
    pourquoiCeProcessus({ explication }),
    'Votre site est hébergé chez o2switch. Le bouton lance gh workflow run, puis vérifie que le site répond.',
  );
});

/* ------------------------------------------------------------------ */
/* Ce que les deux rubriques doivent garder, lu dans leur source        */
/* ------------------------------------------------------------------ */

const DEPLOIEMENT = lire('web/src/components/config-projet/page-deploiement.tsx');
const PRODUCTION = lire('web/src/components/config-projet/page-production.tsx');
const TROIS_TEMPS = lire('web/src/components/config-projet/processus-en-place.tsx');

test('les deux rubriques ont la même forme : où j’en suis, puis les réglages — plus de « ce qui se passera » (13/11/2026)', () => {
  for (const [nom, source] of [['déploiement', DEPLOIEMENT], ['mise en production', PRODUCTION]] as const) {
    const ou = source.indexOf('<OuJEnSuis');
    const reglages = source.indexOf('data-reglages-de-l-etape');
    assert.ok(ou > 0 && reglages > ou, `${nom} : les deux temps ne sont pas dans l’ordre`);
    assert.equal(source.includes('<ProcessusEnPlace'), false, `${nom} : « ce qui se passera au clic » est revenu`);
    assert.match(source, /repere="reglages-avances"/, `${nom} : pas de repli « Réglages avancés »`);
  }
});

test('le bouton de l’agent est le seul, et il vit dans le premier temps', () => {
  assert.equal(DEPLOIEMENT.includes('BoutonAgentDeConfiguration'), false);
  assert.equal(PRODUCTION.includes('BoutonAgentDeConfiguration'), false);
  assert.equal(TROIS_TEMPS.split('<BoutonAgentDeConfiguration').length - 1, 1);
});

test('seule l’adresse du site reste hors du repli « Réglages avancés »', () => {
  const avantLeRepli = (source: string) => source.slice(0, source.indexOf('<Repli'));
  const dansLeRepli = (source: string) => source.slice(source.indexOf('<Repli'));
  assert.match(avantLeRepli(DEPLOIEMENT), /data-url-dev/);
  for (const repere of ['data-port-projet-champ', 'data-branche-dev', 'data-commande-deploiement-champ', 'data-service-deploiement-champ']) {
    assert.equal(avantLeRepli(DEPLOIEMENT).includes(repere), false, `${repere} est resté à vue`);
    assert.equal(dansLeRepli(DEPLOIEMENT).includes(repere), true, `${repere} a disparu`);
  }
  assert.match(avantLeRepli(PRODUCTION), /data-champ-adresse-production/);
  assert.equal(avantLeRepli(PRODUCTION).includes('data-branche-production'), false);
  assert.equal(dansLeRepli(PRODUCTION).includes('data-branche-production'), true);
});

test('un avertissement ne se range pas : le conflit de port se lit sous le repli fermé', () => {
  assert.match(DEPLOIEMENT, /data-port-conflit/);
  assert.match(DEPLOIEMENT, /avertissements=\{\s*conflitDePort \|\| brancheHorsSchema/);
  assert.match(PRODUCTION, /avertissements=\{brancheHorsSchema/);
  /* Et « à revérifier » se lit dans la phrase d'état, pas derrière un repli. */
  assert.match(TROIS_TEMPS, /data-avertissement-processus=\{aRevoir/);
});

test('le journal brut « Étude de l’agent » et les doublons ont quitté la rubrique', () => {
  assert.equal(fs.existsSync(path.resolve(ICI, '../../../web/src/components/config-projet/etude-repliee.tsx')), false);
  for (const disparu of ['EtudeRepliee', 'Adresse visée', 'data-processus-branche', 'explicationDuProcessus']) {
    assert.equal(TROIS_TEMPS.includes(disparu), false, `${disparu} est encore dans la rubrique`);
  }
  assert.match(TROIS_TEMPS, /pourquoiCeProcessus\(joue\)/);
});
