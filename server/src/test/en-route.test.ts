import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLONNES_EN_ROUTE,
  agentsDeLaBande,
  curseurApres,
  debutDeLaDemande,
  debutsDesDemandes,
  ONGLETS_EN_ROUTE,
  estRangee,
  estATerminer,
  estDeployee,
  peutEtreRangee,
  rangementApresDeplacement,
  estEnRoute,
  projetsADecharger,
  cleDeFamille,
  curseurApresPile,
  pilesEnRoute,
  placeDeLaFamille,
  repartirLaFamille,
} from '@beluga/shared';

const carte = (id: string, column: string, updatedAt: number) => ({ id, column, updatedAt });

test('trois colonnes : Actifs (Demande, Travail), Terminer (tout ce qui est fini), Archiver (rangé à la main)', () => {
  assert.deepEqual([...ONGLETS_EN_ROUTE], ['actif', 'terminer', 'archive']);
  assert.deepEqual([...COLONNES_EN_ROUTE], ['planned', 'running']);
  assert.equal(estEnRoute({ column: 'archived' }), false);
  assert.equal(estEnRoute({ column: 'to_deploy' }), false, '« À déployer » a sa propre colonne');
  assert.equal(estATerminer({ column: 'to_deploy' }), true);
  assert.equal(estATerminer({ column: 'archived' }), true, 'archivée dans son projet, elle reste dans « Terminer »');
  assert.equal(estRangee({ column: 'archived' }), false, 'rien n’entre seul dans « Archiver »');
  assert.equal(estRangee({ column: 'archived', rangeeTableauDeBordAt: 5 }), true);
  assert.equal(estRangee({ column: 'to_deploy', rangeeTableauDeBordAt: 5 }), true, 'rangée ici, elle reste à publier dans son projet');
  assert.equal(estATerminer({ column: 'to_deploy', rangeeTableauDeBordAt: 5 }), false);
  assert.equal(estRangee({ column: 'running', rangeeTableauDeBordAt: 5 }), false, 'une carte rouverte n’est plus rangée');
});

test('le curseur reprend la clé du démon : dernière action, puis identifiant', () => {
  assert.deepEqual(curseurApres(carte('x', 'planned', 42)), { updatedAt: 42, id: 'x' });
});

test('la bande ne montre que ce qu’aucune carte ne porte, affichée ou non', () => {
  const maintenant = 100_000_000;
  const agents = [
    { id: 'publication', role: 'deploy', status: 'running', startedAt: 3 },
    { id: 'sur-sa-carte', role: 'task', cardId: 'c1', status: 'running', startedAt: 5 },
    { id: 'carte-hors-page', role: 'task', cardId: 'c9', status: 'starting', startedAt: 4 },
    { id: 'fini-a-l-instant', role: 'cadrage', status: 'done', endedAt: maintenant - 10_000, startedAt: 1 },
    { id: 'analyse-finie', role: 'analysis', status: 'done', endedAt: maintenant - 10_000, startedAt: 2 },
    { id: 'fini-ce-matin', role: 'task', status: 'done', endedAt: maintenant - 3_600_000, startedAt: -1 },
    /* FINI DEPUIS PLUS DE 24 HEURES : il a quitté « Archiver ». */
    { id: 'fini-avant-hier', role: 'chief', status: 'done', endedAt: maintenant - 90_000_000, startedAt: -2 },
    { id: 'rangement', role: 'task', status: 'done', tourVivantDepuis: maintenant - 5_000, startedAt: 0 },
    /* ARRÊTÉ SUR SA QUESTION : encore actif. */
    { id: 'question', role: 'chief', status: 'idle', attendReponse: true, endedAt: maintenant - 1_000, startedAt: -3 },
  ];
  // « Actifs » : au travail ou en attente d'une réponse.
  assert.deepEqual(agentsDeLaBande(agents).map((a) => a.id), ['publication', 'rangement', 'question']);
});

test('l’Assistant Beluga (rôle « deploy » stocké) n’est jamais une carte Système', () => {
  const maintenant = 100_000_000;
  const agents = [
    { id: 'assistant-actif', role: 'deploy', assistantGlobal: true, status: 'running', startedAt: 9 },
    { id: 'assistant-fini', role: 'deploy', assistantGlobal: true, status: 'done', endedAt: maintenant - 10_000, startedAt: 8 },
    { id: 'vraie-mise-en-ligne', role: 'deploy', status: 'running', startedAt: 7 },
    { id: 'mise-en-ligne-finie', role: 'deploy', status: 'done', endedAt: maintenant - 10_000, startedAt: 6 },
  ];
  assert.deepEqual(agentsDeLaBande(agents).map((a) => a.id), ['vraie-mise-en-ligne']);
});

test('le projet de la carte ouverte dans le tiroir n’est jamais déchargé', () => {
  const oublies = projetsADecharger({
    vuA: { a: 0, b: 0 },
    projetAffiche: null,
    projetsRetenus: ['a'],
    maintenant: 60 * 60 * 1000,
  });
  assert.deepEqual(oublies, ['b']);
});

/* Le badge « en ligne » d'« Archiver » : ce qui est déjà publié. */

test('« en ligne » ne vaut que pour les cartes archivées ET mises en ligne', () => {
  const cartes = [
    { id: 'abandonnee', column: 'archived', updatedAt: 1 },
    { id: 'a-deployer', column: 'to_deploy', deployedAt: 5, updatedAt: 1 },
    { id: 'en-ligne-hier', column: 'archived', deployedAt: 1_000, updatedAt: 1_000 },
    { id: 'en-ligne-a-l-instant', column: 'archived', deployedAt: 9_000, updatedAt: 9_000 },
    { id: 'en-ligne-puis-retouchee', column: 'archived', deployedAt: 500, updatedAt: 12_000 },
    { id: 'en-travail', column: 'running', updatedAt: 1 },
  ];
  assert.equal(estDeployee(cartes[0]), false, 'une carte archivée à la main n’est pas en ligne');
  assert.equal(estATerminer(cartes[0]), true, '… elle est dans « Terminer » tant qu’on ne l’a pas rangée');
  assert.equal(estDeployee(cartes[1]), false, '« À déployer » n’est pas en ligne');
  assert.deepEqual(
    cartes.filter(estDeployee).map((c) => c.id),
    ['en-ligne-hier', 'en-ligne-a-l-instant', 'en-ligne-puis-retouchee'],
  );
});

test('chaque carte seule a exactement une colonne', () => {
  for (const column of ['planned', 'running', 'to_deploy', 'archived']) {
    for (const deployedAt of [undefined, 1_000]) {
      for (const rangeeTableauDeBordAt of [undefined, 7]) {
        const c = { id: 'x', column, deployedAt, rangeeTableauDeBordAt, updatedAt: 1 };
        const attendu = column === 'planned' || column === 'running' ? 'actif' : rangeeTableauDeBordAt ? 'archive' : 'terminer';
        const cas = `${column} / ${deployedAt} / ${rangeeTableauDeBordAt}`;
        assert.equal([estEnRoute(c), estATerminer(c), estRangee(c)].filter(Boolean).length, 1, cas);
        assert.equal(placeDeLaFamille([c]), attendu, cas);
      }
    }
  }
});

test('le curseur d’« Archiver » suit la dernière action, puis l’identifiant', () => {
  const a = { id: 'a', column: 'archived', deployedAt: 100, updatedAt: 500 };
  assert.deepEqual(curseurApres(a), { updatedAt: 500, id: 'a' });
});

test('le début de la demande : sans pastille de fichier, aplati, coupé', () => {
  assert.equal(debutDeLaDemande('[fichier: image.png]pourquoi je ne vois pas\nde description ?'), 'pourquoi je ne vois pas de description ?');
  assert.equal(debutDeLaDemande('[fichier: a.png] [fichier: b.png]'), '');
  assert.equal(debutDeLaDemande(null), '');
  const long = debutDeLaDemande('x'.repeat(400));
  assert.equal(long.length, 280);
  assert.ok(long.endsWith('…'));
});

test('par carte, le PREMIER message écrit, jamais un vide ni le dernier', () => {
  const debuts = debutsDesDemandes([
    { carte: 'a', creeA: 300, contenu: 'tu peux lancer le travail' },
    { carte: 'a', creeA: 100, contenu: 'J’ai plus accès au site, page blanche' },
    { carte: 'b', creeA: 50, contenu: '[fichier: image.png]' },
    { carte: 'b', creeA: 80, contenu: 'déplace ce bouton' },
    { carte: 'c', creeA: 10, contenu: null },
  ]);
  assert.deepEqual(debuts, { a: 'J’ai plus accès au site, page blanche', b: 'déplace ce bouton' });
});

/* ---------------- Les piles d'une demande commune ---------------- */

const membre = (
  id: string,
  column: string,
  updatedAt: number,
  extra: { carteMereId?: string; deployedAt?: number; rangeeTableauDeBordAt?: number } = {},
) => ({
  id,
  column,
  updatedAt,
  ...extra,
});

test('une famille : la mère et ses filles, une carte seule est sa propre famille', () => {
  assert.equal(cleDeFamille({ id: 'f1', carteMereId: 'm' }), 'm');
  assert.equal(cleDeFamille({ id: 'm' }), 'm');
});

test('une fille en ligne reste dans « Actifs » tant qu’une sœur est en route', () => {
  const mere = membre('m', 'archived', 10);
  const enLigne = membre('f1', 'archived', 30, { carteMereId: 'm', deployedAt: 30 });
  const aDeployer = membre('f2', 'to_deploy', 20, { carteMereId: 'm' });
  const auTravail = membre('f3', 'running', 15, { carteMereId: 'm' });
  assert.equal(placeDeLaFamille([mere, enLigne, aDeployer, auTravail]), 'actif');
  const actifs = pilesEnRoute([mere, enLigne, aDeployer, auTravail, membre('seule', 'planned', 25)], 'actif');
  assert.deepEqual(actifs.map((p) => p.cle), ['m', 'seule'], 'la pile se range sur sa carte la plus récente');
  assert.deepEqual(actifs[0].cartes.map((c) => c.id), ['m', 'f1', 'f2', 'f3'], 'la mère au-dessus');
  assert.equal(pilesEnRoute([mere, enLigne, aDeployer, auTravail], 'terminer').length, 0, 'rien dans « Terminer »');
  assert.equal(pilesEnRoute([mere, enLigne, aDeployer, auTravail], 'archive').length, 0, 'rien dans « Archiver »');
  assert.deepEqual(curseurApresPile(actifs[0]), { updatedAt: 30, id: 'm' });
});

test('plus rien en route mais une fille à publier : la pile entière est dans « Terminer »', () => {
  const cartes = [
    membre('m', 'archived', 10),
    membre('f1', 'archived', 30, { carteMereId: 'm', deployedAt: 30 }),
    membre('f2', 'to_deploy', 20, { carteMereId: 'm' }),
  ];
  assert.equal(placeDeLaFamille(cartes), 'terminer');
  assert.deepEqual(pilesEnRoute(cartes, 'terminer')[0].cartes.map((c) => c.id), ['m', 'f1', 'f2']);
  assert.equal(pilesEnRoute(cartes, 'archive').length, 0);
});

test('toutes les filles rangées par l’utilisateur : la pile passe dans « Archiver », la fille abandonnée comprise', () => {
  const r = 99;
  const cartes = [
    membre('m', 'archived', 10, { rangeeTableauDeBordAt: r }),
    membre('f1', 'archived', 30, { carteMereId: 'm', deployedAt: 30, rangeeTableauDeBordAt: r }),
    membre('f2', 'archived', 20, { carteMereId: 'm', deployedAt: 20, rangeeTableauDeBordAt: r }),
    membre('f3', 'archived', 40, { carteMereId: 'm', rangeeTableauDeBordAt: r }),
  ];
  assert.equal(placeDeLaFamille(cartes), 'archive');
  assert.equal(
    placeDeLaFamille([...cartes.slice(0, 3), membre('f3', 'archived', 40, { carteMereId: 'm' })]),
    'terminer',
    'une seule carte pas encore rangée retient toute la pile dans « Terminer »',
  );
  const [pile] = pilesEnRoute(cartes, 'archive');
  assert.deepEqual(pile.cartes.map((c) => c.id), ['m', 'f3', 'f1', 'f2']);
  assert.equal(pile.updatedAt, 40);
  assert.equal(placeDeLaFamille([membre('x', 'archived', 1)]), 'terminer', 'archivée dans son projet : « Terminer » jusqu’au rangement');
  assert.equal(placeDeLaFamille([]), null);
});

test('une fille qui bouge emporte toute sa famille d’une réserve à l’autre', () => {
  type M = ReturnType<typeof membre>;
  const mere = membre('m', 'archived', 10);
  const f1 = membre('f1', 'archived', 30, { carteMereId: 'm', deployedAt: 30 });
  const f2 = membre('f2', 'running', 20, { carteMereId: 'm' });
  const actif = { m: mere, f1, f2, seule: membre('seule', 'planned', 5) };
  const rendue = { ...f2, column: 'to_deploy', updatedAt: 40 };
  const apres = repartirLaFamille<M>({ actif, terminer: {}, archive: {} }, rendue);
  assert.deepEqual(Object.keys(apres.actif!).sort(), ['seule']);
  assert.deepEqual(Object.keys(apres.terminer!).sort(), ['f1', 'f2', 'm'], 'rendue : « Terminer »');
  const publiee = repartirLaFamille(apres, { ...rendue, column: 'archived', deployedAt: 50, updatedAt: 50 });
  assert.deepEqual(Object.keys(publiee.terminer!).sort(), ['f1', 'f2', 'm'], 'publiée : toujours dans « Terminer »');
  assert.deepEqual(Object.keys(publiee.archive!), []);
  let rangee = publiee;
  for (const c of Object.values(publiee.terminer!)) rangee = repartirLaFamille(rangee, { ...c, rangeeTableauDeBordAt: 60 });
  assert.deepEqual(Object.keys(rangee.terminer!), []);
  assert.deepEqual(Object.keys(rangee.archive!).sort(), ['f1', 'f2', 'm'], 'rangée par l’utilisateur : « Archiver »');
  const rouverte = repartirLaFamille(rangee, { ...rangee.archive!.f1, column: 'running', deployedAt: undefined, rangeeTableauDeBordAt: undefined });
  assert.deepEqual(Object.keys(rouverte.actif!).sort(), ['f1', 'f2', 'm', 'seule']);
  assert.deepEqual(Object.keys(rouverte.archive!), []);
  assert.equal(repartirLaFamille<M>({ actif: null, terminer: null, archive: null }, f1).archive, null, 'une colonne jamais chargée le reste');
});

test('seule une carte déjà archivée dans son projet peut se ranger sur la page', () => {
  assert.equal(peutEtreRangee({ column: 'to_deploy' }), false);
  assert.equal(peutEtreRangee({ column: 'archived' }), true);
});

test('archivée à la main : rangée tout de suite ; archivée par la mise en ligne : « Terminer »', () => {
  const instant = 9_000;
  // Le geste humain (`rangeeA` donné) pose le rangement, et la carte est « Archiver ».
  for (const depart of ['to_deploy', 'running', 'planned']) {
    const rangee = rangementApresDeplacement({ column: depart }, 'archived', instant);
    assert.equal(rangee, instant, `${depart} → archived à la main`);
    assert.equal(estRangee({ column: 'archived', rangeeTableauDeBordAt: rangee }), true);
  }
  // Sans geste (publication, agent sans code) : rien n'est posé, elle reste dans « Terminer ».
  const auto = rangementApresDeplacement({ column: 'to_deploy' }, 'archived');
  assert.equal(auto, undefined);
  assert.equal(estATerminer({ column: 'archived', rangeeTableauDeBordAt: auto }), true);
  // Déjà rangée : la date d'origine est gardée.
  assert.equal(rangementApresDeplacement({ column: 'archived', rangeeTableauDeBordAt: 4 }, 'archived', instant), 4);
  // Un passage hors d'« Archivé » efface le rangement ; une carte « À déployer » n'est pas rangeable.
  for (const cible of ['to_deploy', 'planned', 'running']) {
    assert.equal(rangementApresDeplacement({ column: 'archived', rangeeTableauDeBordAt: 4 }, cible, instant), undefined, cible);
  }
  // Une carte qui ne passe pas par « Archivé » garde ce qu'elle avait.
  assert.equal(rangementApresDeplacement({ column: 'to_deploy', rangeeTableauDeBordAt: 7 }, 'to_deploy', instant), 7);
  assert.equal(rangementApresDeplacement({ column: 'planned' }, 'running', instant), undefined);
});

test('le début d’une demande ne montre plus les signes de mise en forme, et se coupe avec ses points de suite', () => {
  assert.equal(debutDeLaDemande('# Titre\n\nDu **gras**, une [adresse](https://x.test) et `du code`. [fichier: a.png #ab12]'), 'Titre Du gras, une adresse et du code.');
  const coupe = debutDeLaDemande('a'.repeat(300), 20);
  assert.equal(coupe.length, 20);
  assert.match(coupe, /…$/);
});
