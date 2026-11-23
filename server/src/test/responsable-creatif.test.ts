import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE RESPONSABLE CRÉATIF (studio créatif, carte 2 sur 5, 24/10/2026).
 *
 *  - les règles pures : la chaîne d'écriture et ses accords, l'aval invalidé,
 *    le brief relisible, le formulaire qui ne repose jamais une question déjà
 *    répondue, les réponses rendues ensemble, le retour à une version ;
 *  - le démon : depuis une phrase, brief → formulaire groupé → trois
 *    directions → choix → scénario → storyboard → plans, un accord à chaque
 *    étape, AUCUN appel réseau ; une retouche garde la version d'avant et
 *    revenir à v1 écrit une v3 ; l'outil n'est servi qu'au cadrage et à la
 *    tâche d'une carte caméra, et le cadrage ne reçoit jamais « realiser ».
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'responsable-creatif-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const shared = await import('@beluga/shared');
const {
  Agent,
  Card,
  Project,
  chaineDEcriture,
  etapeSuivantePermise,
  etapesEnAval,
  etatDeLEtapeDEcriture,
  briefEnMarkdown,
  champsDuBrief,
  fusionnerLeBrief,
  questionsDuFormulaire,
  reponseDuFormulaire,
  retourAVersion,
  directionChoisie,
  etapeValideeParLaReponse,
  etapesDuSuivi,
  cheminDeLaRealisation,
  roleDuJalon,
  ROLES_DE_REALISATION,
  ROLE_DE_LA_PHASE,
  PHASES_DE_REALISATION,
  AgentQuestion,
  arretAMener,
  plansSurCapaciteAbsente,
  piecesAFournirManquantes,
  decisionDuLot,
  plafondDeFabrication,
  issueDePanne,
  questionDAccordDArret,
} = shared;
type El = import('@beluga/shared').ElementDeProduction;
const store = await import('../store.js');
const rc = await import('../responsable-creatif.js');
const { toolsFor, outilServiA, REALISATION_TOOLS } = await import('../tools.js');
const { refusDeQuestionSimultanee } = await import('../attente-question.js');

/* ------------------------------------------------------------------ */
/* Les règles pures                                                     */
/* ------------------------------------------------------------------ */

let n = 0;
const el = (genre: El['genre'], cle: string, etat: El['etat'], version = 1, contenu = 'x'): El => ({
  id: `e${++n}`,
  cardId: 'c',
  projectId: 'p',
  genre,
  cle,
  version,
  titre: cle,
  contenu,
  etat,
  parent: null,
  creeLe: n,
});

test('sept rôles : le directeur créatif ouvre, chacun mène sa rubrique, le producteur tient le budget', () => {
  assert.equal(ROLES_DE_REALISATION.length, 7);
  for (const p of PHASES_DE_REALISATION) assert.ok(ROLES_DE_REALISATION.includes(ROLE_DE_LA_PHASE[p]), p);
  assert.equal(ROLE_DE_LA_PHASE.intention, 'directeur-createur');
  assert.equal(ROLE_DE_LA_PHASE.scenario, 'scenariste');
  assert.equal(ROLE_DE_LA_PHASE.son, 'ingenieur-son');
  assert.equal(roleDuJalon('scenario'), 'scenariste');
  assert.equal(roleDuJalon('budget'), 'producteur');
  // Une carte d'avant (quatre rôles) se relit : le rôle se calcule, il n'est jamais écrit.
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: { medias: [], phase: 'intention' } }).role, 'directeur-createur');
  assert.equal(cheminDeLaRealisation({ column: 'running', realisation: { medias: ['video'], termineA: 1 } }).role, 'realisateur');
});

test('la chaîne : cinq étapes pour une vidéo, trois pour une image ou un son', () => {
  assert.deepEqual(chaineDEcriture(['video']), ['brief', 'direction', 'scenario', 'storyboard', 'plans']);
  assert.deepEqual(chaineDEcriture([]), ['brief', 'direction', 'scenario', 'storyboard', 'plans']);
  assert.deepEqual(chaineDEcriture(['image']), ['brief', 'direction', 'plans']);
  assert.deepEqual(chaineDEcriture(['musique', 'voix']), ['brief', 'scenario', 'plans']);
  assert.deepEqual(etapesEnAval('direction', ['video']), ['scenario', 'storyboard', 'plans']);
});

test('tout l’écrit se fait au brief, librement : plus d’arrêt d’accord entre les pièces (26/10/2026)', () => {
  assert.ok(etapeSuivantePermise('brief', [], ['video']).ok);
  assert.ok(etapeSuivantePermise('direction', [el('brief', 'brief', 'a-valider')], ['video']).ok);
  const brief = el('brief', 'brief', 'valide');
  /* Le scénario et les plans d'une vidéo s'écrivent au brief, sans attendre une direction : c'est « Passer aux esquisses » qui vaut accord. */
  assert.ok(etapeSuivantePermise('scenario', [brief], ['video']).ok);
  // La direction est validée dès qu'UNE piste est retenue, les autres écartées.
  const dirs = [el('concept', 'direction-1', 'refuse'), el('concept', 'direction-2', 'valide'), el('concept', 'direction-3', 'refuse')];
  assert.equal(etatDeLEtapeDEcriture(dirs, 'direction'), 'valide');
  assert.ok(etapeSuivantePermise('scenario', [brief, ...dirs], ['video']).ok);
  // Scénario, storyboard et plans s'écrivent sans accord entre eux.
  assert.ok(etapeSuivantePermise('plans', [brief, ...dirs, el('script', 'scenario', 'propose')], ['video']).ok);
  assert.equal(arretAMener([brief, ...dirs], ['video']), 'images-cles');
  assert.equal(arretAMener([brief], ['video']), 'idee');
  // Une pièce retouchée (nouvelle version proposée) défait l'accord de son étape.
  const retouche = [el('scene', 'scene-1', 'valide'), el('scene', 'scene-2', 'remplace'), el('scene', 'scene-2', 'propose', 2)];
  assert.equal(etatDeLEtapeDEcriture(retouche, 'storyboard'), 'propose');
  assert.ok(!etapeSuivantePermise('storyboard', [brief], ['image']).ok, 'une image n’a pas de storyboard');
});

test('le directeur ne prévoit rien qu’il ne sait pas fabriquer, et attend les pièces à fournir', () => {
  const plans = [
    { titre: 'Plan 1', contenu: 'Plan large.\nCapacité : animation' },
    { titre: 'Plan 2', contenu: 'Présentateur face caméra.\nCapacité : avatar' },
    { titre: 'Plan 3', contenu: 'Capture réelle incrustée.\nCapacité : montage' },
    { titre: 'Plan 4', contenu: 'Sans capacité dite.' },
  ];
  assert.deepEqual(
    plansSurCapaciteAbsente(plans, ['image', 'animation', 'voix']).map((p) => [p.titre, p.capacite]),
    [
      ['Plan 2', 'avatar'],
      ['Plan 4', null],
    ],
  );
  const champs = [{ champ: 'pieces' as const, valeur: 'Photo du présentateur ; logo', source: 'demande' as const }];
  assert.deepEqual(piecesAFournirManquantes(champs, []), ['Photo du présentateur', 'logo']);
  const recue = { ...el('reference', 'piece-photo-du-presentateur', 'valide'), titre: 'Photo du présentateur' };
  assert.deepEqual(piecesAFournirManquantes(champs, [recue]), ['logo']);
  assert.deepEqual(piecesAFournirManquantes([{ champ: 'pieces', valeur: 'aucune', source: 'deduit' }], []), []);
});

test('la dépense : prix accordé + 30 %, lots d’office dans la marge, question au-delà ou sans prix publié', () => {
  assert.equal(plafondDeFabrication(10), 13);
  assert.equal(plafondDeFabrication(2.5), 3.25);
  assert.equal(decisionDuLot({ total: 4, budget: 13, depense: 8, accordDeFabrication: true }).verdict, 'auto');
  assert.equal(decisionDuLot({ total: 6, budget: 13, depense: 8, accordDeFabrication: true }).verdict, 'a-valider', 'au-delà du plafond : on redemande');
  assert.equal(decisionDuLot({ total: 1, sansPrix: 1, budget: 13, depense: 0, accordDeFabrication: true }).verdict, 'a-valider', 'prix non publié : question (DEC-385)');
  assert.equal(decisionDuLot({ total: 1, budget: 13, depense: 0 }).verdict, 'a-valider', 'sans accord de l’arrêt 2 : clic comme avant');
  assert.equal(decisionDuLot({ total: 6, budget: 13, depense: 8 }).verdict, 'refus');
  // Une panne : réessayer, puis un autre modèle, puis demander (plafond ou trois échecs).
  assert.equal(issueDePanne({ echecsDuPlan: 1, prix: 0.5, reste: 3 }), 'reessayer');
  assert.equal(issueDePanne({ echecsDuPlan: 2, prix: 0.5, reste: 3 }), 'autre-modele');
  assert.equal(issueDePanne({ echecsDuPlan: 3, prix: 0.5, reste: 3 }), 'demander');
  assert.equal(issueDePanne({ echecsDuPlan: 1, prix: 4, reste: 3 }), 'demander');
  assert.equal(issueDePanne({ echecsDuPlan: 1, prix: null, reste: 3 }), 'demander');
  // La question de l'arrêt 2 dit le prix et le plafond.
  const q = questionDAccordDArret({ arret: 'images-cles', prix: 10, plafond: 13, pieces: [] });
  assert.match(q.question, /10 \$/);
  assert.match(q.description, /13 \$/);
  assert.equal(q.options[0]!.label, 'Valider et lancer la fabrication');
});

test('le brief s’écrit lisible et se relit ; une valeur nouvelle remplace l’ancienne', () => {
  const md = briefEnMarkdown([
    { champ: 'objectif', valeur: 'Faire installer l’appli', source: 'demande' },
    { champ: 'duree', valeur: '20 s', source: 'reponse' },
  ]);
  assert.match(md, /^- Objectif : Faire installer l’appli \(tiré de la demande\)$/m);
  const relus = champsDuBrief(md);
  assert.deepEqual(relus.map((c) => [c.champ, c.valeur, c.source]), [
    ['objectif', 'Faire installer l’appli', 'demande'],
    ['duree', '20 s', 'reponse'],
  ]);
  const fusion = fusionnerLeBrief(relus, [{ champ: 'duree', valeur: '30 s', source: 'reponse' }, { champ: 'ton', valeur: '', source: 'reponse' }]);
  assert.equal(fusion.find((c) => c.champ === 'duree')!.valeur, '30 s');
  assert.ok(!fusion.some((c) => c.champ === 'ton'), 'une valeur vide ne remplit rien');
});

test('le formulaire n’emporte jamais une question dont le brief a la réponse, et rend tout ensemble', () => {
  const connus = [{ champ: 'public' as const, valeur: 'Indépendants', source: 'demande' as const }];
  const { posees, ecartees } = questionsDuFormulaire(
    [
      { champ: 'public', question: 'À qui parle la vidéo ?', kind: 'single', options: [] },
      { champ: 'duree', question: 'Quelle durée ?', kind: 'single', options: [{ label: '15 s (recommandé)' }, { label: '30 s' }] },
      { champ: 'ton', question: 'Quel ton ?', kind: 'single', options: [{ label: 'Drôle' }] },
      { champ: 'ton', question: 'Quel ton, encore ?', kind: 'single', options: [] },
      { champ: 'format', question: 'Quels formats ?', kind: 'multiple', options: [{ label: '9:16' }, { label: '16:9' }] },
    ],
    connus,
  );
  assert.deepEqual(posees.map((q) => q.champ), ['duree', 'ton', 'format']);
  assert.deepEqual(ecartees.map((q) => q.champ), ['public']);
  const texte = reponseDuFormulaire(posees, { q0: { choix: ['15 s (recommandé)'], texte: '' }, q2: { choix: ['9:16', '16:9'], texte: 'surtout vertical' } });
  assert.equal(texte, '1. Quelle durée ? [duree] → 15 s (recommandé)\n2. Quel ton ? [ton] → (sans réponse)\n3. Quels formats ? [format] → 9:16 — 16:9 — surtout vertical');
});

test('les réponses d’accord : « Valider » valide, la direction se reconnaît à son titre', () => {
  assert.ok(etapeValideeParLaReponse('Valider'));
  assert.ok(etapeValideeParLaReponse('Valider — parfait'));
  assert.ok(!etapeValideeParLaReponse('Retoucher — plus court'));
  const dirs = [{ id: 'a', titre: 'Néon nocturne' }, { id: 'b', titre: 'Néon' }, { id: 'c', titre: 'Plein soleil' }];
  assert.equal(directionChoisie('Néon nocturne — avec un peu de pluie', dirs)!.id, 'a');
  assert.equal(directionChoisie('Plein soleil', dirs)!.id, 'c');
  assert.equal(directionChoisie('Aucune : proposer d’autres directions', dirs), null);
});

test('revenir à une version en écrit une nouvelle, et un double clic n’en écrit qu’une', () => {
  const v1 = el('plan', 'plan-1', 'remplace', 1, 'Plan large');
  const v2 = el('plan', 'plan-1', 'propose', 2, 'Plan serré');
  const r = retourAVersion([v1, v2], 1);
  assert.equal(r.verdict, 'ecrire');
  const v3 = el('plan', 'plan-1', 'propose', 3, 'Plan large');
  assert.equal(retourAVersion([v1, { ...v2, etat: 'remplace' }, v3], 1).verdict, 'deja', 'la v3 a déjà le contenu de la v1');
  assert.equal(retourAVersion([v1, v2], 9).verdict, 'introuvable');
});

test('le suivi range les plans sous « Plans » avec toutes leurs versions', () => {
  const v1 = { ...el('plan', 'plan-1', 'remplace', 1, 'Plan large'), auteur: 'agent' };
  const v2 = { ...el('plan', 'plan-1', 'a-valider', 2, 'Plan serré'), auteur: 'agent' };
  const volet = etapesDuSuivi({ column: 'planned', realisation: { medias: ['video'], phase: 'plans' }, elements: [v1, v2] });
  const plans = volet.find((x) => x.etape === 'plans')!;
  assert.equal(plans.etat, 'a-valider');
  assert.equal(plans.elements.length, 1);
  assert.deepEqual(plans.elements[0]!.versions.map((v) => v.version), [2, 1]);
  assert.equal(volet.find((x) => x.etape === 'storyboard')!.elements.length, 0, 'un plan ne se range plus sous le storyboard');
});

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

const projet = store.saveProject(Project.parse({ id: 'projet-rc', name: 'Atelier RC', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

function carte(id: string, role: 'cadrage' | 'task', camera = true, medias: string[] = ['video']) {
  const c = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: role === 'task' ? 'running' : 'planned',
      position: 1,
      title: `RC ${id}`,
      run: { engine: 'claude', model: 'opus' },
      agentId: `agent-${id}`,
      parcours: { plans: [], realisationSouhaitee: camera },
      realisation: { medias, faites: 1, total: 10, phase: 'intention', restants: [], majA: 1 },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({ id: `agent-${id}`, projectId: projet.id, cardId: c.id, role, title: 'Agent', run: { engine: 'claude', model: 'opus' }, status: 'running', createdAt: store.now(), updatedAt: store.now() }),
  );
  return c;
}
const ctx = (id: string) => ({ agentId: `agent-${id}`, projectId: projet.id, cardId: `carte-${id}` });

/** Une pièce jointe de la carte (photo reçue, film monté), sans fichier : seul son identifiant compte ici. */
function pieceJointe(id: string, name: string, mime: string): string {
  store.saveAttachment(shared.Attachment.parse({ id, projectId: projet.id, name, mime, size: 3, sha: `sha-${id}`, createdAt: store.now() }));
  return id;
}

/** Le réseau est piégé : écrire, scénariser et storyboarder ne doit rien appeler. */
function reseauInterdit() {
  const vrai = globalThis.fetch;
  const appels: string[] = [];
  globalThis.fetch = (async (adresse: any) => {
    appels.push(String(adresse));
    throw new Error(`appel réseau inattendu : ${String(adresse)}`);
  }) as typeof fetch;
  return { appels, rendre: () => (globalThis.fetch = vrai) };
}

async function repondre(question: import("@beluga/shared").AgentQuestion | undefined, reponse: string) {
  assert.ok(question, 'une question était attendue');
  rc.trancherLAccordDEtape(question!, reponse);
}

test('l’outil n’est servi qu’au cadrage et à la tâche d’une carte caméra ; le directeur a aussi « realiser » au cadrage (26/10/2026)', () => {
  carte('serv-cadrage', 'cadrage');
  carte('serv-tache', 'task');
  carte('serv-eteinte', 'cadrage', false);
  assert.ok(outilServiA('production', 'agent-serv-cadrage'));
  assert.ok(outilServiA('production', 'agent-serv-tache'));
  assert.ok(!outilServiA('production', 'agent-serv-eteinte'));
  const cadrage = toolsFor('cadrage', { realisation: true }).map((t) => t.name);
  assert.ok(cadrage.includes('production'));
  for (const t of REALISATION_TOOLS) assert.ok(cadrage.includes(t), `le directeur reçoit ${t} au cadrage`);
  assert.ok(toolsFor('task', { realisation: true }).some((t) => t.name === 'production'));
  assert.ok(refusDeQuestionSimultanee('agent-inconnu', 'production') === undefined);
});

rc.remplacerLesCapacitesBranchees(async () => ['image', 'animation', 'voix', 'musique']);

test('depuis une phrase : brief, formulaire, directions, scénario, storyboard et plans au brief — plus d’arrêt de prix ni de film, aucune dépense', async () => {
  const faux = reseauInterdit();
  try {
    const c = carte('parcours', 'cadrage');
    const x = ctx('parcours');

    // 1. Ce que la phrase dit déjà, puis UN formulaire qui n'en repose rien.
    let r = await rc.production(x, { action: 'brief', champs: [{ champ: 'objectif', valeur: 'Faire installer l’application', source: 'demande' }, { champ: 'public', valeur: 'Indépendants', source: 'demande' }, { champ: 'pieces', valeur: 'Logo', source: 'demande' }] });
    assert.ok(r.ok, r.text);
    r = await rc.production(x, {
      action: 'formulaire',
      questions: [
        { champ: 'public', question: 'À qui parle-t-on ?', options: [{ label: 'Indépendants' }] },
        { champ: 'duree', question: 'Quelle durée ?', options: [{ label: '15 s (recommandé)' }, { label: '30 s' }] },
        { champ: 'ton', question: 'Quel ton ?', options: [{ label: 'Complice (recommandé)' }, { label: 'Sérieux' }] },
        { champ: 'format', question: 'Quels formats ?', kind: 'multiple', options: [{ label: '9:16' }, { label: '16:9' }] },
      ],
    });
    assert.ok(r.ok && r.question?.formulaire, r.text);
    assert.deepEqual(r.question!.formulaire!.questions.map((q) => q.champ), ['duree', 'ton', 'format'], 'la question déjà répondue est écartée');
    assert.match(r.text, /Écartées.*public/);
    r = await rc.production(x, { action: 'brief', champs: [{ champ: 'duree', valeur: '15 s', source: 'reponse' }, { champ: 'ton', valeur: 'Complice', source: 'reponse' }, { champ: 'format', valeur: '9:16', source: 'reponse' }] });
    assert.ok(r.ok, r.text);

    // 2. Les directions, facultatives : le choix se fait par « soumettre » (étape « idee »).
    r = await rc.production(x, { action: 'concept', directions: [{ titre: 'Néon nocturne', contenu: 'Ville la nuit' }, { titre: 'Plein soleil', contenu: 'Terrasse' }, { titre: 'Papier découpé', contenu: 'Animation' }] });
    assert.ok(r.ok, r.text);
    r = await rc.production(x, { action: 'soumettre', etape: 'idee' });
    assert.equal(r.question?.accord?.etape, 'idee');
    assert.equal(r.question!.options.length, 4, 'trois directions et « proposer d’autres »');
    await repondre(r.question, 'Plein soleil');
    r = await rc.production(x, { action: 'soumettre', etape: 'idee' });
    assert.match(r.text, /DÉJÀ accordée/, 'un accord donné ne se redemande pas');

    // 3. Scénario, storyboard, plans : sans arrêt entre eux ; un plan sur un outil absent est refusé.
    assert.ok((await rc.production(x, { action: 'script', titre: 'Scénario', contenu: '0-2 s : le bénéfice. …' })).ok);
    assert.ok((await rc.production(x, { action: 'storyboard', scenes: [{ titre: 'Scène 1', contenu: 'Terrasse' }, { titre: 'Scène 2', contenu: 'Téléphone' }] })).ok);
    r = await rc.production(x, { action: 'plans', plans: [{ titre: 'Plan 1', contenu: 'Présentateur\nCapacité : avatar', scene: 'scene-1' }] });
    assert.ok(!r.ok && /avatar/.test(r.text) && /image, animation, voix, musique/.test(r.text), r.text);
    r = await rc.production(x, { action: 'plans', plans: [{ titre: 'Plan 1', contenu: 'Plan large, terrasse\nCapacité : animation', scene: 'scene-1' }, { titre: 'Plan 2', contenu: 'Gros plan, écran vide\nCapacité : montage', scene: 'scene-2' }] });
    assert.ok(r.ok, r.text);

    // 4. PLUS D'ARRÊT DE PRIX : « images-cles » est refusé, chaque génération a son bouton à prix.
    r = await rc.production(x, { action: 'soumettre', etape: 'images-cles', prix: 10 });
    assert.ok(!r.ok && /plus d’arrêt « images clés et prix »/.test(r.text), r.text);
    // La pièce à fournir se note par son alias ; le bouton « Passer aux esquisses » l'attend.
    const manque = shared.boutonDuMedia({ carte: store.getCard(c.id)!, elements: (await import("../production.js")).elementsDeLaCarte(c.id) });
    assert.ok(manque && !manque.possible && /Logo/.test(shared.remplir(manque.raison!)), 'la pièce à fournir manque');
    /* LA PIÈCE SE DÉSIGNE PAR SON ALIAS (« #10a0 »), comme l'écran l'affiche :
       l'agent la note lui-même, sans redemander à l'utilisateur de la rejoindre. */
    store.saveAttachment(shared.Attachment.parse({ id: 'piece-logo', projectId: projet.id, alias: '10a0', name: 'logo.png', mime: 'image/png', size: 3, sha: 'sha-piece-logo', createdAt: store.now() }));
    r = await rc.production(x, { action: 'piece_recue', nom: 'Logo', piece: '#ffff' });
    assert.ok(!r.ok && /alias/.test(r.text) && !/doit la joindre/.test(r.text), r.text);
    r = await rc.production(x, { action: 'piece_recue', nom: 'Logo', piece: '#10a0' });
    assert.ok(r.ok && /Toutes les pièces/.test(r.text), r.text);
    assert.ok(shared.boutonDuMedia({ carte: store.getCard(c.id)!, elements: (await import("../production.js")).elementsDeLaCarte(c.id) })!.possible, 'le brief complet ouvre les esquisses');
    const apres = store.getCard(c.id)!;
    assert.equal(apres.parcours?.fabricationAccordeeA, undefined, 'plus aucun accord global posé');

    // L'état se relit sans la conversation.
    const etat = await rc.production(x, { action: 'etat' });
    assert.match(etat.text, /ÉCRIT : /);
    assert.match(etat.text, /Durée : 15 s \(réponse\)/);
    assert.match(etat.text, /concept « Plein soleil » \(clé « direction-2 », v1, valide\)/);
    assert.match(etat.text, /concept « Néon nocturne » .*refuse/);

    // 5. Retoucher un plan : v2, la v1 gardée ; revenir à la v1 écrit une v3 ; un double clic n'écrit rien.
    r = await rc.production(x, { action: 'modifier', cle: 'plan-1', contenu: 'Plan serré, terrasse\nCapacité : animation' });
    assert.ok(r.ok && /v2 écrite, v1 gardée/.test(r.text), r.text);
    assert.match((await rc.production(x, { action: 'etat' })).text, /Plans — écrite/);
    const retour = rc.revenirAVersionDeLaCarte(c.id, 'plan-1', 1, 'utilisateur');
    assert.ok(retour.ok && !retour.deja && retour.element.version === 3 && retour.element.contenu === 'Plan large, terrasse\nCapacité : animation');
    const double = rc.revenirAVersionDeLaCarte(c.id, 'plan-1', 1, 'utilisateur');
    assert.ok(double.ok && double.deja && double.element.version === 3);
    const versions = await rc.production(x, { action: 'versions', cle: 'plan-1' });
    assert.match(versions.text, /v3 \(en cours\) — propose, par utilisateur/);
    assert.match(versions.text, /v2 — remplace, par agent/);
    assert.match(versions.text, /v1 — remplace, par agent/);

    // 6. « Passer aux esquisses » valide l'écrit ; le retoucher ensuite invalide l'aval.
    assert.ok(rc.validerLEcritDuBrief(c.id) > 0);
    r = await rc.production(x, { action: 'modifier', cle: 'scenario', contenu: 'Nouveau scénario' });
    assert.match(r.text, /invalide « Storyboard »/);
    assert.match((await rc.production(x, { action: 'etat' })).text, /Storyboard — écrite/);

    // 7. PLUS D'ARRÊT « film monté » : le montage est le studio de l'utilisateur.
    const rendu = await rc.production(x, { action: 'soumettre', etape: 'rendu', film: pieceJointe('film-monte', 'film.mp4', 'video/mp4') });
    assert.ok(!rendu.ok && /plus d’arrêt « film monté »/.test(rendu.text), rendu.text);

    assert.deepEqual(faux.appels, [], 'aucun appel réseau : écrire ne coûte rien');
  } finally {
    faux.rendre();
  }
});

test('« proposer d’autres directions » écarte toutes les pistes ; une carte sans caméra est refusée', async () => {
  carte('autres', 'task');
  const x = ctx('autres');
  await rc.production(x, { action: 'brief', champs: [{ champ: 'objectif', valeur: 'Vendre', source: 'demande' }] });
  await rc.production(x, { action: 'concept', directions: [{ titre: 'A', contenu: 'a' }, { titre: 'B', contenu: 'b' }] });
  await repondre((await rc.production(x, { action: 'soumettre', etape: 'idee' })).question, 'Aucune : proposer d’autres directions');
  assert.ok(!(await rc.production(x, { action: 'soumettre', etape: 'idee' })).ok, 'aucune piste encore en lice');
  // Les anciennes questions (une par étape) restent lisibles : un ancien nom d'étape mène à son arrêt.
  assert.equal(shared.arretLu('direction'), 'idee');
  assert.equal(shared.arretLu('plans'), 'images-cles');
  assert.ok(shared.AccordDEtape.safeParse({ cardId: 'c', etape: 'storyboard', elements: [] }).success);
  carte('sans', 'cadrage', false);
  assert.equal((await rc.production(ctx('sans'), { action: 'etat' })).text, rc.REFUS_PRODUCTION_HORS_CAMERA);
});

test('corriger une pièce à la main : v+1 « par vous », brief relu par l’agent, aval à revalider, course détectée', async () => {
  carte('corrige', 'task');
  const x = ctx('corrige');
  await rc.production(x, { action: 'brief', champs: [{ champ: 'objectif', valeur: 'Vendre', source: 'demande' }, { champ: 'public', valeur: 'Grand public', source: 'deduit' }] });
  await rc.production(x, { action: 'concept', directions: [{ titre: 'A', contenu: 'a' }, { titre: 'B', contenu: 'b' }] });
  await repondre((await rc.production(x, { action: 'soumettre', etape: 'idee' })).question, 'A');

  // L'utilisateur corrige le public et glisse une ligne hors format au milieu.
  const avant = (await rc.production(x, { action: 'lire', cle: 'brief' })).text;
  assert.match(avant, /Grand public/);
  const corrige = rc.modifierUnePieceDeLaCarte('carte-corrige', 'brief', {
    contenu: '- Objectif : Vendre (tiré de la demande)\nAttention : pas de musique\n- Public : Artisans (déduit)',
    depuisVersion: 1,
  });
  assert.ok(corrige.ok && !corrige.deja && corrige.element.version === 2, JSON.stringify(corrige));
  assert.equal(corrige.ok && corrige.element.auteur, 'utilisateur');
  assert.equal(corrige.ok && corrige.element.etat, 'valide', 'une pièce validée corrigée par l’utilisateur reste validée');
  assert.deepEqual(corrige.ok && corrige.aval, ['direction'], 'la direction est à revalider');
  assert.deepEqual(champsDuBrief(corrige.ok ? corrige.element.contenu : '').map((c) => c.valeur), ['Vendre', 'Artisans']);

  // L'agent complète le brief : la correction n'est pas écrasée, la note reste.
  await rc.production(x, { action: 'brief', champs: [{ champ: 'ton', valeur: 'Complice', source: 'reponse' }] });
  const relu = (await rc.production(x, { action: 'lire', cle: 'brief' })).text;
  assert.match(relu, /Public : Artisans/);
  assert.match(relu, /Attention : pas de musique/);
  assert.doesNotMatch(relu, /Grand public/);

  // Même texte : rien d'écrit. Version qui a bougé : refus nommé.
  const brief = (await rc.production(x, { action: 'versions', cle: 'brief' })).text;
  assert.match(brief, /v3 \(en cours\).*par agent/);
  assert.match(brief, /v2 — remplace, par utilisateur/);
  const conflit = rc.modifierUnePieceDeLaCarte('carte-corrige', 'brief', { contenu: 'x', depuisVersion: 2 });
  assert.ok(!conflit.ok && conflit.conflit === 3);
  const courant = (await rc.production(x, { action: 'lire', cle: 'brief' })).text.split('\n').slice(1).join('\n');
  const deja = rc.modifierUnePieceDeLaCarte('carte-corrige', 'brief', { contenu: courant });
  assert.ok(deja.ok && deja.deja);
  assert.ok(!rc.modifierUnePieceDeLaCarte('carte-corrige', 'inconnue', { contenu: 'x' }).ok);
});

test('une pièce désignée « [pièce: … · clé] » part au moteur en espaces ordinaires', () => {
  const e = '[pièce: Plan 2  large · plan-2]'.replace(/ /g, '\u00A0');
  assert.equal(shared.tagsEnEspacesOrdinaires(`Corrige ${e} stp`), 'Corrige [pièce: Plan 2  large · plan-2] stp');
  assert.match(shared.REGLE_DE_LA_PIECE_DESIGNEE, /« modifier »/);
  assert.match(shared.briefCorrige('- Durée : 15 s\n- Couleur : bleu'), /^- Durée : 15 s \(déduit\)\n\n- Couleur : bleu$/);
});

test('la mise en page d’une pièce : chaque intitulé en titre, son contenu dessous, aucun tiret, tableaux et heures intacts', () => {
  const b = shared.blocsDePiece;
  const titre = (t: string, x: string) => ({ genre: 'intitule', titre: t, texte: x });
  const texte = (x: string, numero?: string) => (numero ? { genre: 'texte', texte: x, numero } : { genre: 'texte', texte: x });
  // Le brief de la capture #2243 : « - Libellé : » devient un titre, son contenu dessous, plus de tiret ; « Correction : » aussi.
  assert.deepEqual(b('- Objectif : Vendre (tiré de la demande)\n- Message clé : Simple\n\nCorrection : le prix'), [
    titre('Objectif', 'Vendre (tiré de la demande)'),
    titre('Message clé', 'Simple'),
    titre('Correction', 'le prix'),
  ]);
  // Une direction : intitulés en capitales, précision entre parenthèses comprise, déjà en gras aussi.
  assert.deepEqual(b('IDÉE : le plus dépouillé\nACCROCHE (0-2 s) : « Je vais être franc : oui. »\n**TON** : confidence'), [
    titre('IDÉE', 'le plus dépouillé'),
    titre('ACCROCHE (0-2 s)', '« Je vais être franc : oui. »'),
    titre('TON', 'confidence'),
  ]);
  // Au fil de la ligne : un libellé en capitales après une fin de phrase ouvre son propre titre ; « 16:9 » ne bouge pas.
  assert.deepEqual(b('DURÉE : 65 s (165 mots). FORMAT : 16:9. CADRAGE : plan américain'), [
    titre('DURÉE', '65 s (165 mots).'),
    titre('FORMAT', '16:9.'),
    titre('CADRAGE', 'plan américain'),
  ]);
  // Le scénario : le tableau reste tel quel, en un bloc ; « 0 à 14 s : » n'est pas un intitulé.
  const tableau = '| Temps | Visuel |\n|---|---|\n| 0 à 14 s : début | Angle A |';
  assert.deepEqual(b(`RÈGLE : rien à l’écran\n${tableau}`), [titre('RÈGLE', 'rien à l’écran'), { genre: 'markdown', texte: tableau }]);
  assert.deepEqual(b('0 à 14 s : il parle'), [texte('0 à 14 s : il parle')]);
  // Une phrase ordinaire avec deux-points reste du texte ; un libellé court capitalisé devient un titre.
  assert.deepEqual(b('Moi, je dis : bonjour'), [texte('Moi, je dis : bonjour')]);
  assert.deepEqual(b('Chris dit vraiment : bonjour'), [texte('Chris dit vraiment : bonjour')]);
  assert.deepEqual(b('Attention : pas de musique'), [titre('Attention', 'pas de musique')]);
  // Plus aucun marqueur de liste ; le numéro d'une liste numérotée reste, sur la ligne ou dans le titre.
  assert.deepEqual(b('- un élément\n* un autre\n1. Ouverture : il entre\n2. il sourit'), [
    texte('un élément'),
    texte('un autre'),
    titre('1. Ouverture', 'il entre'),
    texte('il sourit', '2.'),
  ]);
  // Un intitulé seul en fin de ligne : un titre, et la ligne qui suit devient son contenu.
  assert.deepEqual(b('Objectif :\nVendre plus\nAutre ligne'), [titre('Objectif', 'Vendre plus\n\nAutre ligne')]);
  // Un bloc de code et un titre « # » restent tels quels.
  assert.deepEqual(b('```\nTON : x\n```'), [{ genre: 'markdown', texte: '```\nTON : x\n```' }]);
  assert.deepEqual(b('## Plan 1'), [{ genre: 'markdown', texte: '## Plan 1' }]);
});

test('le suivi : les pistes écartées quittent toujours la liste, direction retenue ou non', () => {
  const el = (cle: string, genre: string, etat: string) => ({ cle, genre, etat });
  const brief = el('brief', 'brief', 'valide');
  const a = el('direction-1', 'concept', 'valide');
  const b = el('direction-2', 'concept', 'refuse');
  const c = el('direction-3', 'concept', 'refuse');
  const r = shared.piecesAffichees([brief, a, b, c]);
  assert.deepEqual(r.affichees, [brief, a]);
  assert.deepEqual(r.ecartees, [b, c]);
  assert.equal(r.retenue, a);
  // Aucune retenue (le brief réécrit a remis la direction « à proposer ») : les écartées restent dehors.
  const d = el('direction-4', 'concept', 'propose');
  const sans = shared.piecesAffichees([brief, b, d, c]);
  assert.deepEqual(sans.affichees, [brief, d]);
  assert.deepEqual(sans.ecartees, [b, c]);
  assert.equal(sans.retenue, null);
  // Choix en attente, rien d'écarté : tout reste affiché.
  assert.equal(shared.piecesAffichees([brief, el('direction-5', 'concept', 'a-valider'), d]).affichees.length, 3);
});

const prod = await import('../production.js');
const { elementsCourants } = shared;

test('retenir une autre direction après coup : l’ancienne écartée, l’aval à revalider, un double clic n’écrit qu’une fois', async () => {
  carte('autre-direction', 'task');
  const x = ctx('autre-direction');
  // Avant tout choix : refusé, le choix se fait dans la question d'accord.
  await rc.production(x, { action: 'brief', champs: [{ champ: 'objectif', valeur: 'Vendre', source: 'demande' }] });
  await rc.production(x, { action: 'concept', directions: [{ titre: 'A', contenu: 'a' }, { titre: 'B', contenu: 'b' }] });
  const directions = () => elementsCourants(prod.elementsDeLaCarte('carte-autre-direction')).filter((e: El) => e.genre === 'concept');
  const cleDe = (titre: string) => directions().find((e: El) => e.titre === titre)!.cle;
  const question = (await rc.production(x, { action: 'soumettre', etape: 'idee' })).question;
  assert.ok(!rc.choisirUneAutreDirection('carte-autre-direction', cleDe('B')).ok, 'aucune direction retenue : refusé');
  await repondre(question, 'A');
  assert.ok((await rc.production(x, { action: 'script', titre: 'Scénario', contenu: 'Le scénario' })).ok);
  prod.changerLEtatDesElements(
    elementsCourants(prod.elementsDeLaCarte('carte-autre-direction')).filter((e: El) => e.genre === 'script').map((e: El) => e.id),
    'valide',
    ['propose', 'a-valider'],
  );

  const r = rc.choisirUneAutreDirection('carte-autre-direction', cleDe('B'));
  assert.ok(r.ok && !r.deja, JSON.stringify(r));
  assert.deepEqual(r.ok && r.aval.length > 0, true, 'le scénario est à revalider');
  const etats = Object.fromEntries(directions().map((e: El) => [e.titre, e.etat]));
  assert.deepEqual(etats, { A: 'refuse', B: 'valide' });
  assert.equal(elementsCourants(prod.elementsDeLaCarte('carte-autre-direction')).find((e: El) => e.genre === 'brief')!.etat, 'valide', 'le brief reste validé');
  const encore = rc.choisirUneAutreDirection('carte-autre-direction', cleDe('B'));
  assert.ok(encore.ok && encore.deja, 'un double clic n’écrit rien');
  assert.equal(prod.evenementsDeLaCarte('carte-autre-direction').filter((e: { genre: string }) => e.genre === 'direction.changee').length, 1);
  assert.ok(!rc.choisirUneAutreDirection('carte-autre-direction', 'inconnue').ok);
});

test('reprendre une piste écartée sans direction retenue : elle repasse à proposer, rien d’autre ne bouge, un double clic n’écrit qu’une fois', async () => {
  carte('piste-sans-retenue', 'task');
  const x = ctx('piste-sans-retenue');
  await rc.production(x, { action: 'brief', champs: [{ champ: 'objectif', valeur: 'Vendre', source: 'demande' }] });
  await rc.production(x, { action: 'concept', directions: [{ titre: 'A', contenu: 'a' }, { titre: 'B', contenu: 'b' }, { titre: 'C', contenu: 'c' }] });
  const directions = () => elementsCourants(prod.elementsDeLaCarte('carte-piste-sans-retenue')).filter((e: El) => e.genre === 'concept');
  const parTitre = (titre: string) => directions().find((e: El) => e.titre === titre)!;
  // Comme après un brief réécrit : A à proposer, B et C écartées, aucune retenue.
  prod.changerLEtatDesElements([parTitre('A').id], 'propose', ['propose', 'a-valider', 'valide']);
  prod.changerLEtatDesElements([parTitre('B').id, parTitre('C').id], 'refuse', ['propose', 'a-valider', 'valide']);
  const r = rc.choisirUneAutreDirection('carte-piste-sans-retenue', parTitre('B').cle);
  assert.ok(r.ok && !r.deja, JSON.stringify(r));
  assert.deepEqual(Object.fromEntries(directions().map((e: El) => [e.titre, e.etat])), { A: 'propose', B: 'propose', C: 'refuse' });
  const encore = rc.choisirUneAutreDirection('carte-piste-sans-retenue', parTitre('B').cle);
  assert.ok(encore.ok && encore.deja, 'un double clic n’écrit rien');
  assert.equal(prod.evenementsDeLaCarte('carte-piste-sans-retenue').filter((e: { genre: string }) => e.genre === 'direction.changee').length, 1);
});
