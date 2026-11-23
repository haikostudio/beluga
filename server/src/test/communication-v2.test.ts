import test from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@beluga/shared';
import {
  DUREE_DES_COULISSES,
  REFUS_DE_QUESTION_EN_COULISSES,
  REFUS_D_ETUDE_EN_COULISSES,
  cheminCommunicationV2,
  consigneDeCoulisses,
  pasDeLaBarreV2,
  estGenreDeCoulisses,
  construireFragment,
  coulissesValables,
  etapesDeLaMarqueV2,
  lireCheminCommunicationV2,
  lireFragment,
  menuDuBas,
  PAGE_D_OUVERTURE_V2,
  campagnePrete,
  statutAfficheDeCampagne,
  visuelsDeLaCampagne,
} from '@beluga/shared';

test('l’adresse de Communication 2 se lit et s’écrit dans les deux sens', () => {
  assert.equal(cheminCommunicationV2({ marqueId: 'm1' }), 'm1');
  assert.equal(cheminCommunicationV2({ marqueId: 'm1', page: 'campagnes', element: ['nouvelle', 'dates'] }), 'm1/campagnes/nouvelle/dates');
  assert.deepEqual(lireCheminCommunicationV2('m1/campagnes/c9'), { marqueId: 'm1', page: 'campagnes', element: ['c9'] });
  assert.deepEqual(lireCheminCommunicationV2('m1/inconnue/x'), { marqueId: 'm1' });
  assert.deepEqual(lireCheminCommunicationV2(''), {});
  /* L'ANCIENNE PAGE « PLAN MARKETING » et l'ancienne étape « Réseaux » nue s'ouvrent sur les campagnes (12/11/2026). */
  assert.deepEqual(lireCheminCommunicationV2('m1/plan'), { marqueId: 'm1', page: 'campagnes' });
  assert.deepEqual(lireCheminCommunicationV2('m1/plan/objectifs'), { marqueId: 'm1', page: 'campagnes' });
  assert.deepEqual(lireCheminCommunicationV2('m1/canaux'), { marqueId: 'm1', page: 'campagnes' });
  assert.deepEqual(lireCheminCommunicationV2('m1/canaux/reglages/facebook'), { marqueId: 'm1', page: 'canaux', element: ['reglages', 'facebook'] }, 'les réglages avancés des réseaux restent');
  assert.equal(PAGE_D_OUVERTURE_V2, 'campagnes', 'une marque sans adresse précise s’ouvre TOUJOURS sur ses campagnes');
  const fragment = construireFragment({ vue: 'communication2', chemin: 'm1/calendrier' });
  assert.equal(fragment, 'communication/m1/calendrier');
  assert.deepEqual(lireFragment(fragment), { vue: 'communication2', chemin: 'm1/calendrier' });
  assert.deepEqual(lireFragment('communication2'), { vue: 'communication2' });
});

test('trois étapes, cochées sur ce qui est fait : Campagnes ne se coche qu’avec une campagne PRÊTE', () => {
  const vide = etapesDeLaMarqueV2({ reseauxChoisis: 0, comptesRelies: 0, campagnes: 0, publicationsPlanifiees: 0 });
  assert.equal(vide.suivante, 'campagnes');
  assert.deepEqual(vide.etapes.map((e) => e.id), ['campagnes', 'connexion', 'calendrier'], 'Campagnes, Connexion, Calendrier — plus de Réseaux');
  assert.deepEqual(vide.etapes.map((e) => e.etat), ['en_cours', 'a_faire', 'a_faire']);
  const commencee = etapesDeLaMarqueV2({ reseauxChoisis: 2, comptesRelies: 0, campagnes: 2, campagnesPretes: 0, publicationsPlanifiees: 0 });
  assert.equal(commencee.suivante, 'campagnes', 'une campagne sans tous ses visuels ne coche pas l’étape');
  const prete = etapesDeLaMarqueV2({ reseauxChoisis: 1, comptesRelies: 0, campagnes: 2, campagnesPretes: 1, publicationsPlanifiees: 0 });
  assert.equal(prete.suivante, 'connexion');
  assert.deepEqual(prete.etapes.map((e) => e.etat), ['fait', 'en_cours', 'a_faire']);
  const tout = etapesDeLaMarqueV2({ reseauxChoisis: 1, comptesRelies: 1, campagnes: 1, campagnesPretes: 1, publicationsPlanifiees: 3 });
  assert.equal(tout.suivante, null);
  assert.ok(tout.etapes.every((e) => e.etat === 'fait'));
  assert.deepEqual(tout.etapes.map((e) => e.rang), [1, 2, 3]);
});

test('une campagne est PRÊTE quand chaque date prévue a son visuel', () => {
  const aucune = visuelsDeLaCampagne(null, []);
  assert.deepEqual(aucune, { prevus: 0, faits: 0 });
  assert.equal(campagnePrete(aucune), false, 'une campagne vide n’est jamais prête');
  const partielle = visuelsDeLaCampagne(null, [
    { datePrevue: '2026-11-20', aUnVisuel: true },
    { datePrevue: '2026-11-22', aUnVisuel: false },
    { datePrevue: null, aUnVisuel: false },
  ]);
  assert.deepEqual(partielle, { prevus: 2, faits: 1 }, 'une publication sans date n’est pas encore au programme');
  assert.equal(statutAfficheDeCampagne('preparation', partielle), 'preparation');
  const complete = visuelsDeLaCampagne(2, [
    { datePrevue: '2026-11-20', aUnVisuel: true },
    { datePrevue: '2026-11-22', aUnVisuel: true },
  ]);
  assert.equal(statutAfficheDeCampagne('preparation', complete), 'prete');
  assert.equal(statutAfficheDeCampagne('preparation', visuelsDeLaCampagne(5, [{ datePrevue: '2026-11-20', aUnVisuel: true }])), 'preparation', 'le nombre de médias prévu relève le compte');
  assert.equal(statutAfficheDeCampagne('en_cours', partielle), 'en_cours', 'une campagne lancée garde son état');
  assert.equal(statutAfficheDeCampagne('terminee', complete), 'terminee');
});

test('la consigne des coulisses interdit la question et donne tout d’un coup', () => {
  const texte = consigneDeCoulisses({
    genre: 'programme',
    marque: 'Kipou',
    texte: 'Une campagne pour Noël',
    campagne: { id: 'c1', titre: 'Noël', debut: '2026-12-01', fin: '2026-12-24', reseaux: ['instagram', 'tiktok'], quantite: 10, projet: 'p1' },
  });
  assert.match(texte, /n’appelles JAMAIS « ask_user »/);
  assert.match(texte, /HUIT POINTS/);
  assert.match(texte, /id « c1 »/);
  assert.match(texte, /instagram, tiktok/);
  assert.match(texte, /Une campagne pour Noël/);
  assert.match(texte, /BROUILLON/);
  assert.match(consigneDeCoulisses({ genre: 'visuels', marque: 'Kipou', campagne: { id: 'c1', titre: 'Noël' } }), /VERSION GRATUITE/);
  assert.match(REFUS_DE_QUESTION_EN_COULISSES, /personne ne répondra/);
});

test('le drapeau des coulisses ne tient que bien formé et récent', () => {
  const maintenant = 1_800_000_000_000;
  const bon = JSON.stringify({ genre: 'programme', marqueId: 'm', campagneId: 'c', depuis: maintenant - 1000 });
  assert.deepEqual(coulissesValables(bon, maintenant), { genre: 'programme', marqueId: 'm', campagneId: 'c', depuis: maintenant - 1000 });
  assert.equal(coulissesValables(JSON.stringify({ genre: 'programme', marqueId: 'm', depuis: maintenant - DUREE_DES_COULISSES - 1 }), maintenant), null);
  assert.equal(coulissesValables(JSON.stringify({ genre: 'inconnu', marqueId: 'm', depuis: maintenant }), maintenant), null);
  assert.equal(coulissesValables('{abîmé', maintenant), null);
  assert.equal(coulissesValables(null, maintenant), null);
});

test('le bas du téléphone de Communication 2 mène aux quatre pages de la marque, sans « Plan » ni « Réseaux »', () => {
  const bas = menuDuBas('communication2-marque' as never);
  assert.equal(bas.forme, 'repartis');
  const tout = JSON.stringify(bas);
  for (const geste of ['v2-campagnes', 'v2-connexion', 'v2-calendrier', 'v2-reponses']) assert.ok(tout.includes(geste), geste);
  assert.ok(!tout.includes('v2-plan'), 'plus de geste « Plan »');
  assert.ok(!tout.includes('v2-canaux'), 'plus de geste « Réseaux »');
});

test('le chef en coulisses ne prépare plus de plan ni d’étude marketing', () => {
  assert.equal(estGenreDeCoulisses('plan'), false);
  assert.equal(estGenreDeCoulisses('plan-corriger'), false);
  const texte = consigneDeCoulisses({ genre: 'campagnes', marque: 'Kipou', texte: 'Une campagne pour Noël' });
  assert.match(texte, /tirés de la demande, sans/);
  assert.doesNotMatch(texte, /de la demande et du plan/);
  assert.match(texte, /jamais les actions « analyse » ni « preparer_analyse »/);
  assert.match(REFUS_D_ETUDE_EN_COULISSES, /outil Marketing ne fait plus partie/);
});

test('le champ d’une campagne agit sur toute la campagne, repasse à valider et ne publie rien', () => {
  assert.ok(estGenreDeCoulisses('campagne'));
  assert.ok(estGenreDeCoulisses('calendrier'));
  const texte = consigneDeCoulisses({ genre: 'campagne', marque: 'Kipou', texte: 'Mets un fond bleu partout', campagne: { id: 'c1', titre: 'Noël' } });
  assert.match(texte, /ENSEMBLE de ses publications/);
  assert.match(texte, /REPASSE À L’ÉTAPE « a_valider »/);
  assert.match(texte, /Ne programme rien et ne publie rien/);
  assert.match(texte, /fond bleu partout/);
  assert.match(texte, /« c1 »/, 'l’identifiant de la campagne arrive tel quel, jamais en majuscules');
  assert.match(consigneDeCoulisses({ genre: 'visuels', marque: 'Kipou', campagne: { id: 'c1', titre: 'Noël' } }), /« c1 »/);
  assert.match(consigneDeCoulisses({ genre: 'calendrier', marque: 'Kipou', texte: 'Décale tout d’une semaine' }), /REPASSE À L’ÉTAPE « a_valider »/);
});

test('la barre des étapes : pas de Précédent au début, pas de Suivant à la fin, Suivant bloqué tant que l’étape n’est pas faite', () => {
  const neuve = { reseauxChoisis: 0, comptesRelies: 0, campagnes: 0, publicationsPlanifiees: 0 };
  assert.deepEqual(pasDeLaBarreV2('campagnes', neuve), { precedente: null, suivante: 'connexion', bloque: 'Terminez une campagne — tous ses visuels faits — pour passer à la connexion.' }, 'Campagnes est la première étape : pas de Précédent');
  assert.equal(pasDeLaBarreV2('campagnes', { ...neuve, campagnes: 1, campagnesPretes: 1 }).bloque, null);
  assert.equal(pasDeLaBarreV2('connexion', { ...neuve, campagnes: 1, campagnesPretes: 1 }).bloque, 'Connectez au moins un réseau pour passer au calendrier.');
  const fin = pasDeLaBarreV2('calendrier', neuve);
  assert.equal(fin.suivante, null);
  assert.equal(fin.bloque, null);
  assert.equal(fin.precedente, 'connexion');
});

test('les étapes s’ouvrent dans l’ordre : la connexion attend une campagne prête, rien de ce qui existe ne se verrouille', async () => {
  const { etapeQuiBloqueV2, pageAccessibleV2 } = await import('@beluga/shared');
  const etapeOuverteV2 = (id: Parameters<typeof etapeQuiBloqueV2>[0], e: Parameters<typeof etapeQuiBloqueV2>[1]) => etapeQuiBloqueV2(id, e) === null;
  const neuf = { reseauxChoisis: 0, comptesRelies: 0, campagnes: 0, publicationsPlanifiees: 0 };
  assert.equal(etapeOuverteV2('campagnes', neuf), true, 'la première étape est toujours ouverte');
  assert.equal(etapeQuiBloqueV2('calendrier', neuf), 'campagnes', 'la première étape non faite bloque');
  const commencee = { ...neuf, campagnes: 1, campagnesPretes: 0 };
  assert.equal(etapeQuiBloqueV2('connexion', commencee), 'campagnes', 'une campagne pas encore prête n’ouvre pas la connexion');
  assert.equal(pageAccessibleV2('connexion', commencee), 'campagnes', 'une adresse verrouillée renvoie sur l’étape à faire');
  assert.equal(etapeOuverteV2('connexion', { ...commencee, campagnesPretes: 1 }), true);
  assert.equal(pageAccessibleV2('reponses', neuf), 'reponses', 'Réponses n’est pas une étape');
  assert.equal(pageAccessibleV2('canaux', neuf), 'canaux', 'les réglages avancés des réseaux restent joignables');
  assert.equal(etapeOuverteV2('connexion', { ...neuf, comptesRelies: 1 }), true, 'un compte déjà relié garde sa page');
  const dejaPlanifiee = { ...neuf, campagnes: 1, publicationsPlanifiees: 2 };
  assert.equal(etapeOuverteV2('calendrier', dejaPlanifiee), true, 'un calendrier qui vit déjà reste ouvert');
});

test('le parcours d’une campagne : la première étape pas faite est « ici », avec ses comptes', () => {
  const base = { briefComplet: true, visuels: { prevus: 9, faits: 2 }, comptesRelies: 0, programmees: 0, publiees: 0, statut: 'preparation' };
  const p = shared.parcoursDeLaCampagne(base);
  assert.deepEqual(p.map((x) => x.etat), ['fait', 'fait', 'ici', 'a_faire', 'a_faire', 'a_faire']);
  assert.deepEqual(p[2].compte, { faits: 2, total: 9 });
  const sansBrief = shared.parcoursDeLaCampagne({ ...base, briefComplet: false, visuels: { prevus: 0, faits: 0 } });
  assert.equal(sansBrief[0].etat, 'ici');
  assert.equal(sansBrief[2].compte, undefined);
  const programmee = shared.parcoursDeLaCampagne({ ...base, visuels: { prevus: 9, faits: 9 }, comptesRelies: 2, programmees: 9, statut: 'en_cours' });
  assert.deepEqual(programmee.map((x) => x.etat), ['fait', 'fait', 'fait', 'fait', 'fait', 'ici']);
  assert.ok(shared.parcoursDeLaCampagne({ ...base, statut: 'terminee' }).every((x) => x.etat === 'fait'));
});
