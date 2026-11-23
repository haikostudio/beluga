import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * UNE CRÉATION DE MÉDIA PARLE SON PROPRE LANGAGE (26/10/2026) : quatre étapes
 * fixes communes à tous les médias — Brief, Esquisses, Montage, Téléchargement —,
 * un bouton du bas qui fait passer à la suivante et dit ce qui manque, jamais
 * de déploiement. Règles pures (`shared/src/etapes-du-media.ts`).
 */
const {
  etapesDuMedia,
  elementsAVerserDuMedia,
  etapeCouranteDuMedia,
  etapeDuMediaLue,
  voletDuMedia,
  boutonDuMedia,
  passageAEcrire,
  passagesDuMedia,
  phaseDesEsquisses,
  animationPermise,
  decoupageDuMedia,
  planDuMedia,
  enFabricationDuPlan,
  etatDesPlans,
  placementDansUnPlan,
  dureeDuPlan,
  prevuAuBrief,
  sonDuBrief,
  sectionsDuTelechargement,
  nomDeFichierLisible,
  remplir,
  carteDeMedia,
  horsDuLotDeDeploiement,
  RAISONS_DU_BOUTON_DU_MEDIA,
} = await import('@beluga/shared');

const parcours = { realisationSouhaitee: true };
const video = { medias: ['video' as const] };
const image = { medias: ['image' as const] };
const musique = { medias: ['musique' as const] };
const etats = (ctx: Parameters<typeof etapesDuMedia>[0]) => etapesDuMedia(ctx).map((s) => s.etat);

let n = 0;
const element = (cle: string, genre: string, contenu: string, etat = 'propose', version = 1) =>
  ({ id: `e${++n}`, cardId: 'c', projectId: 'p', cle, genre, titre: cle, contenu, version, etat, parent: null, creeLe: n }) as never;
const media = (id: string, plan: string, genre: 'image' | 'video' | 'son', o: Record<string, unknown> = {}) =>
  ({ id, plan, genre, capacite: genre === 'son' ? 'voix' : genre === 'video' ? 'animation' : 'image', etat: 'fini', retenuLe: null, creeLe: ++n, sourceId: null, attachmentId: `a-${id}`, version: 1, ...o }) as never;

test('les quatre étapes suivent les passages écrits sur la carte, les mêmes pour tous les médias', () => {
  // Au départ, le brief est en cours, le reste à venir.
  assert.deepEqual(etats({ carte: { column: 'planned', parcours, realisation: image } }), ['encours', 'avenir', 'avenir', 'avenir']);
  // « Passer aux esquisses » : le brief est fait ; une génération qui attend son clic met les esquisses « à voir ».
  const esquisses = { column: 'planned', parcours, realisation: { ...musique, esquissesA: 1 } };
  assert.deepEqual(etats({ carte: esquisses }), ['fait', 'encours', 'avenir', 'avenir']);
  assert.equal(etats({ carte: esquisses, lots: [{ etat: 'propose' }] })[1], 'question');
  // Le montage attend l'utilisateur dans son studio, puis le téléchargement attend « Terminer ».
  assert.deepEqual(etats({ carte: { ...esquisses, realisation: { ...video, esquissesA: 1, montageA: 2 } } }), ['fait', 'fait', 'question', 'avenir']);
  const telechargement = etapesDuMedia({ carte: { ...esquisses, realisation: { ...video, esquissesA: 1, montageA: 2, telechargementA: 3 } } });
  assert.deepEqual(telechargement.map((s) => s.etat), ['fait', 'fait', 'fait', 'question']);
  assert.equal(etapeCouranteDuMedia(telechargement), 'telechargement');
  // Rangée, tout est fait.
  const rangee = etapesDuMedia({ carte: { column: 'archived', parcours, realisation: video } });
  assert.ok(rangee.every((s) => s.etat === 'fait'));
});

test('une carte de l’ancien parcours se relit sans planter ni relancer : accord de fabrication = esquisses, film soumis = montage, film validé = téléchargement', () => {
  assert.equal(passagesDuMedia({ column: 'planned', parcours: { ...parcours, fabricationAccordeeA: 1 }, realisation: video }).esquisses, true);
  assert.equal(passagesDuMedia({ column: 'running', parcours, realisation: video }).esquisses, true);
  assert.equal(passagesDuMedia({ column: 'planned', parcours, realisation: { ...video, filmSoumisA: 1 } }).montage, true);
  assert.equal(passagesDuMedia({ column: 'to_deploy', parcours, realisation: { ...video, filmValideA: 2 } }).telechargement, true);
  // Les anciens noms d'étape se relisent.
  assert.equal(etapeDuMediaLue('images-cles'), 'esquisses');
  assert.equal(etapeDuMediaLue('Idée'), 'esquisses');
  assert.equal(etapeDuMediaLue('film'), 'montage');
  assert.equal(etapeDuMediaLue('livre'), 'telechargement');
  assert.equal(etapeDuMediaLue('type'), 'brief');
  assert.equal(etapeDuMediaLue('n’importe quoi'), null);
});

test('le découpage d’une vidéo : les plans dans l’ordre de leur numéro, leur durée et leur capacité ; le plan d’un média se lit par sa clé ou son titre', () => {
  const elements = [
    element('plan-10', 'plan', 'Durée : 4 s\nCapacité : animation'),
    element('plan-2', 'plan', 'Durée : 5,5 s\nCapacité : image'),
    element('plan-3', 'plan', 'Titre final\nCapacité : montage'),
    element('plan-4', 'plan', 'vieux', 'remplace'),
  ];
  const plans = decoupageDuMedia(elements);
  assert.deepEqual(plans.map((p) => p.cle), ['plan-2', 'plan-3', 'plan-10']);
  assert.deepEqual(plans.map((p) => p.duree), [5.5, null, 4]);
  assert.deepEqual(plans.map((p) => p.visuel), [true, false, true]);
  assert.equal(dureeDuPlan('durée : 7 secondes'), 7);
  assert.equal(planDuMedia('plan-2', plans), 'plan-2');
  assert.equal(planDuMedia('Plan 2', plans), 'plan-2');
  assert.equal(planDuMedia('plan-2 — variante', plans), 'plan-2');
  assert.equal(planDuMedia('plan-20', plans), null, 'jamais un autre numéro');
  assert.equal(planDuMedia('plan-10', plans), 'plan-10');
});

test('ce qui est validé pour chaque plan : l’image, la séquence, et la séquence à refaire quand son image a changé', () => {
  const plans = decoupageDuMedia([element('plan-1', 'plan', 'Durée : 5 s'), element('plan-2', 'plan', 'Durée : 5 s')]);
  const i1 = media('i1', 'plan-1', 'image', { retenuLe: 1 });
  const i1b = media('i1b', 'plan-1', 'image', { retenuLe: 5 });
  const s1 = media('s1', 'plan-1', 'video', { retenuLe: 6, sourceId: 'i1' });
  const brouillon = media('i2', 'plan-2', 'image');
  const etat = etatDesPlans(plans, [i1, i1b, s1, brouillon]);
  assert.equal(etat[0]!.images[0]!.id, 'i1b', 'la plus récente d’abord');
  assert.equal(etat[0]!.sequence!.id, 's1');
  assert.equal(etat[0]!.aRefaire, false);
  assert.equal(etat[1]!.images.length, 0, 'un brouillon non validé ne compte pas');
  // L'image d'origine retirée : la séquence est à refaire.
  const apres = etatDesPlans(plans, [{ ...(i1 as object), retenuLe: null } as never, i1b, s1]);
  assert.equal(apres[0]!.aRefaire, true);
});

test('placer un média dans un plan : la case d’image ou de séquence, remplacée depuis le fil, échangée depuis un autre plan', () => {
  const plans = decoupageDuMedia([element('plan-1', 'plan', 'Durée : 5 s'), element('plan-2', 'plan', 'Durée : 5 s'), element('plan-3', 'plan', 'Durée : 4 s')]);
  const a = media('a', 'plan-1', 'image', { retenuLe: 10 });
  const b = media('b', 'plan-2', 'image', { retenuLe: 11 });
  const fil = media('fil', 'Pièce du fil', 'image');
  const seq = media('seq', 'plan-1', 'video', { retenuLe: 12, sourceId: 'a' });
  const voix = media('voix', 'voix off', 'son');
  const appliquer = (liste: unknown[], r: ReturnType<typeof placementDansUnPlan>) => {
    assert.ok(r.ok);
    return liste.map((x: any) => {
      const c = r.changements.find((ch) => ch.id === x.id);
      return c ? { ...x, retenuLe: c.retenuLe, planPlace: c.planPlace } : x;
    });
  };

  // Une image du fil, pas encore validée, posée sur le plan 2 : elle y entre, l'ancienne perd sa validation.
  const depuisLeFil = placementDansUnPlan(plans, [a, b, fil, seq], { mediaId: 'fil', planCle: 'plan-2', maintenant: 100 });
  assert.ok(depuisLeFil.ok);
  assert.equal(depuisLeFil.echange, null);
  assert.deepEqual(depuisLeFil.changements, [
    { id: 'fil', retenuLe: 100, planPlace: 'plan-2' },
    { id: 'b', retenuLe: null, planPlace: null },
  ]);
  const apresFil = etatDesPlans(plans, appliquer([a, b, fil, seq], depuisLeFil) as never);
  assert.equal(apresFil[1]!.images[0]!.id, 'fil', 'la case montre l’image placée, malgré son nom de pièce');
  assert.equal(apresFil[1]!.images.length, 1);

  // D'un plan à l'autre : les deux images échangent leurs cases, toutes deux restent validées.
  const deplace = placementDansUnPlan(plans, [a, b, seq], { mediaId: 'a', planCle: 'plan-2', maintenant: 200 });
  assert.ok(deplace.ok);
  assert.equal(deplace.echange, 'b');
  const apres = etatDesPlans(plans, appliquer([a, b, seq], deplace) as never);
  assert.deepEqual([apres[0]!.images[0]!.id, apres[1]!.images[0]!.id], ['b', 'a']);
  assert.equal(apres[0]!.aRefaire, true, 'la séquence animée de l’ancienne image du plan 1 est à refaire');

  // Vers une case vide : rien à échanger, la case d'origine se vide.
  const versLeVide = placementDansUnPlan(plans, [a, b], { mediaId: 'a', planCle: 'plan-3', maintenant: 300 });
  assert.ok(versLeVide.ok);
  assert.deepEqual(versLeVide.changements, [{ id: 'a', retenuLe: 300, planPlace: 'plan-3' }]);
  const vide = etatDesPlans(plans, appliquer([a, b], versLeVide) as never);
  assert.deepEqual(vide.map((p) => p.images.length), [0, 1, 1]);

  // Une vidéo va dans la case de séquence, jamais dans celle de l'image ; un son n'a pas de case.
  const video2 = media('v2', 'Séquence du fil', 'video');
  const sequence = placementDansUnPlan(plans, [a, b, seq, video2], { mediaId: 'v2', planCle: 'plan-1', maintenant: 400 });
  assert.ok(sequence.ok);
  assert.deepEqual(sequence.changements, [
    { id: 'v2', retenuLe: 400, planPlace: 'plan-1' },
    { id: 'seq', retenuLe: null, planPlace: null },
  ]);
  assert.equal(etatDesPlans(plans, appliquer([a, b, seq, video2], sequence) as never)[0]!.images[0]!.id, 'a', 'l’image du plan ne bouge pas');
  assert.equal(placementDansUnPlan(plans, [voix], { mediaId: 'voix', planCle: 'plan-1', maintenant: 1 }).ok, false);
  assert.equal(placementDansUnPlan(plans, [a], { mediaId: 'a', planCle: 'plan-9', maintenant: 1 }).ok, false);
  assert.equal(placementDansUnPlan(plans, [media('x', 'plan-1', 'image', { etat: 'en-cours' })], { mediaId: 'x', planCle: 'plan-1', maintenant: 1 }).ok, false);

  // Un plan placé qui a quitté le découpage retombe sur le plan du devis.
  const orphelin = media('o', 'plan-2', 'image', { retenuLe: 50, planPlace: 'plan-7' });
  assert.equal(etatDesPlans(plans, [orphelin])[1]!.images[0]!.id, 'o');
});

test('le bouton du bas : chaque passage, ou ce qui manque, dit en mots', () => {
  const brief = element('brief', 'brief', '- Objectif : vendre (réponse)\n- Pièces à fournir : aucune (réponse)\n- Voix off : oui, le texte du script (réponse)\n- Musique : non (réponse)');
  const plans = [element('plan-1', 'plan', 'Durée : 5 s\nCapacité : animation'), element('plan-2', 'plan', 'Durée : 4 s\nCapacité : animation')];
  const carte = (r: Record<string, unknown>) => ({ column: 'planned', parcours, realisation: { ...video, ...r } });

  // Brief : sans brief, puis sans découpage pour une vidéo, puis permis.
  assert.equal(boutonDuMedia({ carte: carte({}), elements: [] })!.raison!.texte, RAISONS_DU_BOUTON_DU_MEDIA.brief);
  assert.equal(boutonDuMedia({ carte: carte({}), elements: [brief] })!.raison!.texte, RAISONS_DU_BOUTON_DU_MEDIA.decoupage);
  const ok = boutonDuMedia({ carte: carte({}), elements: [brief, ...plans] })!;
  assert.deepEqual([ok.geste, ok.libelle, ok.possible], ['passer-esquisses', 'Passer aux esquisses', true]);
  // Une pièce à fournir manque : le bouton la nomme.
  const avecPiece = element('brief', 'brief', '- Pièces à fournir : photo du présentateur (réponse)', 'propose', 2);
  const piece = boutonDuMedia({ carte: carte({}), elements: [avecPiece, ...plans] })!;
  assert.equal(piece.possible, false);
  assert.equal(remplir(piece.raison!), 'Il manque encore : photo du présentateur.');

  // Esquisses, premier temps : « Passer aux séquences vidéo » attend l'image validée de chaque plan.
  const i1 = media('i1', 'plan-1', 'image', { retenuLe: 1 });
  const premier = boutonDuMedia({ carte: carte({ esquissesA: 1 }), elements: [brief, ...plans], medias: [i1] })!;
  assert.equal(premier.geste, 'passer-sequences');
  assert.equal(premier.possible, false);
  assert.equal(remplir(premier.raison!), 'Il manque l’image validée du plan « plan-2 ».');
  const i2 = media('i2', 'plan-2', 'image', { retenuLe: 2 });
  assert.equal(boutonDuMedia({ carte: carte({ esquissesA: 1 }), elements: [brief, ...plans], medias: [i1, i2] })!.possible, true);

  // Second temps : chaque plan sa séquence, puis la voix off prévue au brief.
  const seq = { esquissesA: 1, sequencesA: 2 };
  const s1 = media('s1', 'plan-1', 'video', { retenuLe: 3, sourceId: 'i1' });
  const sansSequence = boutonDuMedia({ carte: carte(seq), elements: [brief, ...plans], medias: [i1, i2, s1] })!;
  assert.equal(sansSequence.geste, 'passer-montage');
  assert.equal(remplir(sansSequence.raison!), 'Il manque la séquence validée du plan « plan-2 ».');
  const s2 = media('s2', 'plan-2', 'video', { retenuLe: 4, sourceId: 'i2' });
  assert.equal(boutonDuMedia({ carte: carte(seq), elements: [brief, ...plans], medias: [i1, i2, s1, s2] })!.raison!.texte, RAISONS_DU_BOUTON_DU_MEDIA.voix);
  const voix = media('v', 'voix off', 'son', { retenuLe: 5 });
  assert.equal(boutonDuMedia({ carte: carte(seq), elements: [brief, ...plans], medias: [i1, i2, s1, s2, voix] })!.possible, true, 'la musique n’est pas prévue (« non »)');
  // Une génération en cours bloque le passage.
  const enCours = media('x', 'plan-2', 'video', { etat: 'en-cours' });
  assert.equal(boutonDuMedia({ carte: carte(seq), elements: [brief, ...plans], medias: [i1, i2, s1, s2, voix, enCours] })!.raison!.texte, RAISONS_DU_BOUTON_DU_MEDIA.enFabrication);

  // Montage d'une vidéo : il faut un film final ; « Revenir aux esquisses » se tient à côté.
  const montage = boutonDuMedia({ carte: carte({ ...seq, montageA: 3 }), elements: [brief, ...plans], medias: [] })!;
  assert.deepEqual([montage.geste, montage.possible, montage.secondaire?.geste], ['passer-telechargement', false, 'revenir-esquisses']);
  assert.equal(boutonDuMedia({ carte: carte({ ...seq, montageA: 3, finaux: [{ piece: 'film', genre: 'video', nom: 'film' }] }) })!.possible, true);
  // Téléchargement : « Terminer » ; rangée : plus de bouton.
  assert.equal(boutonDuMedia({ carte: carte({ ...seq, montageA: 3, telechargementA: 4 }) })!.geste, 'terminer');
  assert.equal(boutonDuMedia({ carte: { ...carte({}), column: 'archived' } }), null);
});

test('une photo : un seul temps d’esquisses, et un validé suffit pour passer au montage puis au téléchargement', () => {
  const brief = element('brief', 'brief', '- Objectif : affiche (réponse)');
  const carte = (r: Record<string, unknown>) => ({ column: 'planned', parcours, realisation: { ...image, ...r } });
  assert.equal(phaseDesEsquisses(['image'], { esquissesA: 1 }), 'medias');
  const rien = boutonDuMedia({ carte: carte({ esquissesA: 1 }), elements: [brief], medias: [media('i', 'affiche', 'image')] })!;
  assert.deepEqual([rien.geste, rien.possible, rien.raison?.texte], ['passer-montage', false, RAISONS_DU_BOUTON_DU_MEDIA.unElement]);
  const valide = media('i', 'affiche', 'image', { retenuLe: 1 });
  assert.equal(boutonDuMedia({ carte: carte({ esquissesA: 1 }), elements: [brief], medias: [valide] })!.possible, true);
  assert.equal(boutonDuMedia({ carte: carte({ esquissesA: 1, montageA: 2 }), elements: [brief], medias: [valide] })!.possible, true, 'un validé devient final tel quel');
});

test('l’animation attend le second temps d’une vidéo, et rien ne se fabrique au brief', () => {
  const carte = (r: Record<string, unknown>) => ({ column: 'planned', parcours, realisation: { ...video, ...r } });
  assert.equal(animationPermise({ types: ['video'], carte: carte({}) }).ok, false);
  assert.equal(animationPermise({ types: ['video'], carte: carte({ esquissesA: 1 }) }).ok, false);
  assert.equal(animationPermise({ types: ['video'], carte: carte({ esquissesA: 1, sequencesA: 2 }) }).ok, true);
  assert.equal(phaseDesEsquisses(['video'], { esquissesA: 1 }), 'images');
  assert.equal(phaseDesEsquisses(['video'], { esquissesA: 1, sequencesA: 2 }), 'sequences');
});

test('un passage s’écrit seulement s’il est le suivant et permis ; un double clic ne change rien ; revenir aux esquisses défait le montage', () => {
  const brief = element('brief', 'brief', '- Objectif : son (réponse)');
  const carte = (r: Record<string, unknown>) => ({ column: 'planned', parcours, realisation: { ...musique, ...r } });
  const ok = passageAEcrire({ carte: carte({}), elements: [brief], geste: 'passer-esquisses', maintenant: 10 });
  assert.deepEqual(ok, { ok: true, realisation: { esquissesA: 10 } });
  const refus = passageAEcrire({ carte: carte({}), elements: [brief], geste: 'passer-montage', maintenant: 10 });
  assert.equal(refus.ok, false);
  const deja = passageAEcrire({ carte: carte({ esquissesA: 5 }), elements: [brief], geste: 'passer-esquisses', maintenant: 10 });
  assert.deepEqual(deja, { ok: true, realisation: {}, deja: true });
  const sansValide = passageAEcrire({ carte: carte({ esquissesA: 5 }), elements: [brief], geste: 'passer-montage', maintenant: 10 });
  assert.equal(sansValide.ok, false);
  const retour = passageAEcrire({ carte: carte({ esquissesA: 5, montageA: 6, telechargementA: 7 }), geste: 'revenir-esquisses', maintenant: 10 });
  assert.ok(retour.ok && retour.realisation.montageA === undefined && 'montageA' in retour.realisation);
});

test('le brief d’une vidéo dit ce qu’on entend : « non », « aucune » ou « sans » ne prévoient rien', () => {
  assert.equal(prevuAuBrief('oui, une voix chaude'), true);
  assert.equal(prevuAuBrief('Non'), false);
  assert.equal(prevuAuBrief('aucune'), false);
  assert.equal(prevuAuBrief('sans musique'), false);
  assert.equal(prevuAuBrief(''), false);
  assert.deepEqual(sonDuBrief('- Voix off : texte du script (réponse)\n- Musique : électro douce (déduit)'), { voix: true, musique: true });
});

test('le volet ne garde que le validé, rangé sous les quatre étapes : l’écrit au brief, les médias validés aux esquisses', () => {
  const vide = { elements: [], medias: [], enConception: [], ambiance: [], lotEnAttente: false };
  const el = (id: string, genre = 'plan') => ({ id, cle: id, genre, titre: id, contenu: id, version: 1, etat: 'propose', versions: [] });
  const m = (id: string, retenuLe: number | null) => ({ id, plan: id, version: 1, capacite: 'image', genre: 'image', service: 'kie', etape: null, etat: 'fini', attachmentId: id, prix: 1, creeLe: 1, retenuLe });
  const volet = [
    { ...vide, etape: 'brief', etat: 'validee', elements: [el('brief', 'brief')] },
    { ...vide, etape: 'plans', etat: 'en-cours', elements: [el('plan-1')], medias: [m('m1', 2), m('m2', null)] },
    { ...vide, etape: 'montage', etat: 'a-definir' },
  ] as never;
  const segments = etapesDuMedia({ carte: { column: 'planned', parcours, realisation: { ...video, esquissesA: 1 } } });
  const groupes = voletDuMedia(volet, segments);
  assert.deepEqual(groupes.map((g) => g.etape), ['brief', 'esquisses', 'montage', 'telechargement']);
  const de = (etape: string) => groupes.find((g) => g.etape === etape)!;
  assert.deepEqual(de('brief').blocs.map((b) => b.etape), ['brief', 'plans'], 'les plans écrits au brief');
  assert.equal(de('brief').blocs.find((b) => b.etape === 'plans')!.medias.length, 0);
  const plans = de('esquisses').blocs.find((b) => b.etape === 'plans')!;
  assert.deepEqual(plans.medias.map((x) => x.id), ['m1'], 'seulement le validé');
  assert.equal(plans.elements.length, 0);
});

test('le téléchargement : finaux, validés, esquisses ; une photo validée devient finale si le studio ne l’a pas retouchée', () => {
  const v1 = media('v1', 'Affiche', 'image', { retenuLe: 1, version: 2 });
  const v2 = media('v2', 'Affiche bis', 'image', { retenuLe: 2 });
  const b = media('b', 'Brouillon', 'image');
  const rate = media('r', 'Raté', 'image', { etat: 'echec', attachmentId: null });
  const s = sectionsDuTelechargement({ titre: 'Ma Carte', types: ['image'], medias: [v1, v2, b, rate], finaux: [{ piece: 'retouche-v1', genre: 'image', nom: 'affiche-retouche', source: 'v1' }] });
  assert.deepEqual(s.finaux.map((f) => f.piece), ['retouche-v1', 'a-v2']);
  assert.deepEqual(s.valides.map((f) => f.piece), ['a-v1', 'a-v2']);
  assert.deepEqual(s.esquisses.map((f) => f.piece), ['a-v1', 'a-v2', 'a-b'], 'tout ce qui est fini, rien de raté');
  assert.equal(s.valides[0]!.nom, 'ma-carte-affiche-v2');
  // Une vidéo : seuls les finaux rendus (exports) sont finaux.
  const film = sectionsDuTelechargement({ titre: 'Film', types: ['video'], medias: [media('s', 'plan-1', 'video', { retenuLe: 1 })], finaux: [] });
  assert.equal(film.finaux.length, 0);
  assert.equal(nomDeFichierLisible(['Été à Paris !', 'plan 1', 'v2']), 'ete-a-paris-plan-1-v2');
});

test('une création de média ne rejoint jamais le lot de déploiement', () => {
  assert.equal(carteDeMedia({ parcours }), true);
  assert.equal(carteDeMedia({ parcours, cahierDesCharges: {} }), false);
  assert.equal(carteDeMedia({ parcours: {} }), false);
  assert.equal(horsDuLotDeDeploiement({ parcours }), true);
  assert.equal(horsDuLotDeDeploiement({ parcours: null }), false);
  assert.equal(horsDuLotDeDeploiement({ parcours: null, excludedFromDeploy: true }), true);
});

test('la case d’un plan sait ce qui s’y fabrique encore, du bon genre et du bon plan seulement', () => {
  const plans = [
    { cle: 'plan-1', titre: 'Ouverture' },
    { cle: 'plan-2', titre: 'Le produit' },
    { cle: 'plan-20', titre: 'Fin' },
  ];
  const medias = [
    { id: 'a', plan: 'plan-2', genre: 'image' as const, etat: 'en-cours' as const },
    { id: 'b', plan: 'Le produit', genre: 'image' as const, etat: 'en-cours' as const },
    { id: 'c', plan: 'plan-2', genre: 'image' as const, etat: 'fini' as const },
    { id: 'd', plan: 'plan-2', genre: 'video' as const, etat: 'en-cours' as const },
    { id: 'e', plan: 'plan-20', genre: 'image' as const, etat: 'en-cours' as const },
  ];
  assert.equal(enFabricationDuPlan('plan-2', plans, medias, 'image'), 2, 'par sa clé ou par son titre ; un média fini ne compte plus');
  assert.equal(enFabricationDuPlan('plan-2', plans, medias, 'video'), 1, 'la séquence a sa propre case');
  assert.equal(enFabricationDuPlan('plan-1', plans, medias, 'image'), 0);
  assert.equal(enFabricationDuPlan('plan-20', plans, medias, 'image'), 1, '« plan-20 » n’est pas « plan-2 »');
});

test('le montage vidéo reçoit les séquences validées dans l’ordre du découpage, puis la voix et la musique ; les images vont à la bibliothèque', () => {
  const plans = [element('plan-1', 'plan', 'Durée : 5 s'), element('plan-2', 'plan', 'Durée : 5 s')];
  const s2 = media('s2', 'plan-2', 'video', { retenuLe: 1 });
  const s1 = media('s1', 'plan-1', 'video', { retenuLe: 2 });
  const brouillon = media('s3', 'plan-1', 'video');
  const voix = media('v', 'voix off', 'son', { retenuLe: 3, capacite: 'voix' });
  const musiqueValidee = media('mu', 'musique', 'son', { retenuLe: 4, capacite: 'musique' });
  const img = media('i', 'plan-1', 'image', { retenuLe: 5 });
  const a = elementsAVerserDuMedia({ elements: plans, medias: [s2, s1, brouillon, voix, musiqueValidee, img], deja: new Set(['a-mu']) });
  assert.deepEqual(a.map((x) => x.attachmentId), ['a-s1', 'a-s2', 'a-v', 'a-i'], 'ordre du découpage, rien de non validé ni de déjà versé');
  assert.deepEqual(a.map((x) => x.poser), [true, true, true, false]);
});
