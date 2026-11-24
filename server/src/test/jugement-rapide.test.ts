import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  FICHES_DES_USAGES,
  SEUILS,
  USAGES_JUGE,
  avisSurLUrgence,
  basculerUsage,
  basculerUsageAllume,
  bilanDesTraces,
  questionUrgence,
  questionsProposition,
  rangDUneProposition,
  tronquer,
  trierParInteret,
  usageAllume,
  verdictInteret,
  verdictUrgence,
} from '@beluga/shared';

/*
 * UNE BASE À SOI, POSÉE AVANT LE PREMIER IMPORT DU DÉMON (MEM-2544). Elle
 * reçoit les traces et le coffre-fort d'essai : la fiche TypeSafe y vise un
 * FAUX SERVEUR local, jamais le service réel.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'juge-rapide-'));
process.env.BELUGA_DATA = bacASable;

/**
 * LE JUGE RAPIDE — Jev, par son API, et lui seul.
 *
 * Ces essais verrouillent ce qui ne doit jamais changer par accident :
 *  - SANS CLÉ AU COFFRE = AUCUN APPEL, et aucune exception : l'appelant reçoit
 *    `undefined` et retombe sur le comportement d'avant ;
 *  - UN USAGE ÉTEINT N'INTERROGE PAS Jev du tout ;
 *  - UN VERDICT EST CONSULTATIF : il allume un signal, il ne retire, ne refuse
 *    et ne réordonne jamais rien au point d'en perdre un élément ;
 *  - LA TRACE reste un JSON valide, même sur un état énorme.
 */

/* ------------------------------------------------------------------ */
/* LES INTERRUPTEURS : des usages indépendants, un défaut par fiche   */
/* ------------------------------------------------------------------ */

test('sans geste, chaque usage suit sa fiche ; un geste l’emporte toujours', () => {
  for (const fiche of FICHES_DES_USAGES) assert.equal(usageAllume(fiche.cle, []), fiche.parDefaut, fiche.cle);
  assert.equal(usageAllume('tri-propositions', ['tri-propositions']), false);
  assert.equal(usageAllume('tri-propositions', undefined), usageAllume('tri-propositions', []));
  for (const usage of USAGES_JUGE) {
    assert.equal(usageAllume(usage, [], [usage]), true, `${usage} rallumé à la main`);
    assert.equal(usageAllume(usage, [usage], [usage]), false, 'éteint à la main l’emporte');
  }
});

test('éteindre un usage ne touche jamais aux autres', () => {
  const eteints = basculerUsage('tri-propositions', false, []);
  assert.deepEqual(eteints, ['tri-propositions']);
  for (const usage of USAGES_JUGE) {
    if (usage !== 'tri-propositions') assert.equal(usageAllume(usage, eteints), usageAllume(usage, []));
  }
  assert.deepEqual(basculerUsage('tri-propositions', true, eteints), [], 'rallumer retire la ligne');
  assert.deepEqual(basculerUsageAllume('pertinence-memoire', true, []), ['pertinence-memoire']);
  assert.deepEqual(basculerUsageAllume('pertinence-memoire', false, ['pertinence-memoire']), []);
});

/*
 * LES USAGES RETIRÉS NE LAISSENT AUCUNE CLÉ ORPHELINE. Les réglages déjà
 * écrits peuvent porter « description-carte », « fond-du-plan » ou
 * « comprehension-carte » (la jauge retirée le 24/11/2026) : ils ne font rien
 * planter, et la première bascule les balaie.
 */
test('un usage inconnu ou retiré ne s’écrit jamais dans les réglages', () => {
  assert.deepEqual(basculerUsage('tri-propositions', false, ['inventé']), ['tri-propositions']);
  assert.deepEqual(
    basculerUsage('tri-propositions', false, ['description-carte', 'fond-du-plan', 'coherence-rapport', 'comprehension-carte']),
    ['tri-propositions'],
  );
  assert.deepEqual(basculerUsageAllume('urgence-demande', true, ['comprehension-carte']), ['urgence-demande']);
  assert.equal((USAGES_JUGE as readonly string[]).includes('comprehension-carte'), false, 'la jauge n’a plus d’usage');
  assert.deepEqual(basculerUsageAllume('doublon-carte', true, ['inventé']), ['doublon-carte']);
  assert.equal(usageAllume('tri-propositions', ['coherence-rapport']), usageAllume('tri-propositions', []));
});

test('éteindre deux fois le même usage ne l’écrit pas deux fois', () => {
  const une = basculerUsage('urgence-demande', false, []);
  assert.deepEqual(basculerUsage('urgence-demande', false, une), ['urgence-demande']);
});

test('chaque usage a sa fiche, et chaque fiche son usage', () => {
  assert.equal(FICHES_DES_USAGES.length, USAGES_JUGE.length);
  for (const usage of USAGES_JUGE) {
    const fiche = FICHES_DES_USAGES.find((f) => f.cle === usage);
    assert.ok(fiche, `l’usage « ${usage} » doit avoir sa fiche`);
    assert.ok(fiche!.titre.length > 2 && fiche!.explication.length > 30, 'une fiche dit ce que l’usage fait');
  }
});

/* ------------------------------------------------------------------ */
/* LES VERDICTS : un signal, jamais un verrou                           */
/* ------------------------------------------------------------------ */

test('une réponse du mauvais type ne rend aucun verdict', () => {
  const mauvaise = { type: 'choice', choice: 'leger', probabilities: {}, confidence: 1 } as const;
  assert.equal(verdictUrgence(undefined, 1), undefined);
  assert.equal(verdictUrgence(mauvaise, 1), undefined);
});

test('l’urgence s’allume en HAUT du seuil', () => {
  assert.equal(verdictUrgence({ type: 'noul', noul: SEUILS.demandeUrgente + 0.05 }, 1)?.signal, true);
  assert.equal(verdictUrgence({ type: 'noul', noul: SEUILS.demandeUrgente - 0.05 }, 1)?.signal, false);
});

/* ------------------------------------------------------------------ */
/* LE TRI DES PROPOSITIONS : ordonner sans jamais en perdre une         */
/* ------------------------------------------------------------------ */

test('le gain pèse double : une grosse amélioration passe devant une bricole', () => {
  assert.ok(rangDUneProposition(3, 3) > rangDUneProposition(1, 0));
  assert.ok(rangDUneProposition(2, 0) > rangDUneProposition(2, 3));
});

test('les deux notes de tri sont des échelles décrites niveau par niveau', () => {
  const questions = questionsProposition();
  assert.equal(questions.gain.type, 'score');
  assert.equal(questions.ampleur.type, 'score');
  assert.equal((questions.gain as { criteria: string[] }).criteria.length, 4);
});

test('trier ne perd AUCUNE proposition, même sans note', () => {
  const elements = [
    { id: 'a', rang: undefined as number | undefined },
    { id: 'b', rang: 1 },
    { id: 'c', rang: undefined as number | undefined },
    { id: 'd', rang: 5 },
  ];
  const trie = trierParInteret(elements, (e) => e.rang);
  assert.equal(trie.length, elements.length, 'rien ne disparaît');
  assert.deepEqual(
    trie.map((e) => e.id),
    ['d', 'b', 'a', 'c'],
    'les notées d’abord, les autres dans leur ordre d’écriture',
  );
});

test('aucune note du tout : l’ordre d’écriture tient à l’identique', () => {
  const elements = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(
    trierParInteret(elements, () => undefined).map((e) => e.id),
    ['a', 'b', 'c'],
  );
});

test('les deux notes rendent un rang ; une seule ne rend rien', () => {
  const score = (n: number) => ({ type: 'score', score: n, legend: {}, probabilities: {}, confidence: 1 }) as const;
  assert.deepEqual(verdictInteret(score(3), score(1), 9), { gain: 3, ampleur: 1, rang: 5, at: 9 });
  assert.equal(verdictInteret(score(3), undefined, 9), undefined);
});

/* ------------------------------------------------------------------ */
/* CE QUI S'AFFICHE, ET OÙ                                              */
/* ------------------------------------------------------------------ */

test('sans jugement sur la carte, aucun avis ne s’écrit ; une ancienne note de compréhension ne fait rien', () => {
  assert.equal(avisSurLUrgence({ jugements: undefined }), undefined);
  /* La jauge est retirée : une carte d'avant peut encore porter sa note dans son JSON. */
  const ancienne = { jugements: { comprehension: { barres: 2, confiance: 0.9, at: 1 } } } as never;
  assert.equal(avisSurLUrgence(ancienne), undefined);
  const pressante = avisSurLUrgence({ jugements: { urgence: { valeur: 0.9, signal: true, at: 1 } } });
  assert.equal(pressante?.cle, 'urgence');
});

/* ------------------------------------------------------------------ */
/* CE QUI PART : borné, toujours                                        */
/* ------------------------------------------------------------------ */

test('un texte trop long est coupé, et il le dit', () => {
  const coupe = tronquer('x'.repeat(5000), 100);
  assert.ok(coupe.length < 200);
  assert.match(coupe, /coupé : 4900 signes de plus/);
});

test('un texte court n’est pas touché', () => {
  assert.equal(tronquer('  bonjour  ', 100), 'bonjour');
  assert.equal(tronquer(undefined), '');
});

/* ------------------------------------------------------------------ */
/* LA TRACE : de quoi juger le juge                                     */
/* ------------------------------------------------------------------ */

test('le bilan compte les ratés à part et rend une latence médiane', () => {
  const ligne = (issue: 'repondu' | 'echec', latenceMs: number, entree = 0, sortie = 0) => ({
    id: 0,
    usage: 'description-carte',
    question: '{}',
    reponse: '{}',
    latenceMs,
    suite: '',
    issue,
    jetonsEntree: entree,
    jetonsSortie: sortie,
    at: 0,
  });
  const bilan = bilanDesTraces([
    ligne('repondu', 400, 1_000_000, 0),
    ligne('repondu', 600),
    ligne('repondu', 1000),
    ligne('echec', 4000),
  ]);
  assert.equal(bilan.rendus, 3);
  assert.equal(bilan.echecs, 1);
  assert.equal(bilan.latenceMedianeMs, 600);
  assert.equal('cout' in bilan, false, 'plus aucun coût : le juge tourne sur cette machine');
});

test('aucune trace : un bilan à zéro, pas une division par zéro', () => {
  const bilan = bilanDesTraces([]);
  assert.deepEqual(bilan, { rendus: 0, echecs: 0, latenceMedianeMs: 0 });
});

/* ------------------------------------------------------------------ */
/* L'APPEL : Jev, ou rien — jamais une exception                        */
/* ------------------------------------------------------------------ */

const store = await import('../store.js');
const juge = await import('../jugement-rapide.js');
const coffre = await import('../coffre-fort.js');

/*
 * UN FAUX JEV, qui compte ses appels. Il parle le protocole de TypeSafe : un
 * POST avec la clé en « Bearer », toutes les questions en un corps, et rend
 * la DERNIÈRE valeur offerte pour un choix ou une note, « non » pour un
 * oui/non, toujours sûr de lui. `mode` le fait refuser la clé ou traîner.
 */
let appelsRecus = 0;
let mode: 'normal' | 'refus' | 'lent' | 'panne' = 'normal';
const faux = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (bout) => (corps += bout));
  req.on('end', () => {
    appelsRecus += 1;
    if (req.headers.authorization !== 'Bearer cle-essai' || mode === 'refus') {
      res.writeHead(401).end('{"error":"invalid key"}');
      return;
    }
    if (mode === 'panne') {
      res.writeHead(503).end('indisponible');
      return;
    }
    if (mode === 'lent') return; // ne répond jamais : le délai doit mordre
    const demande = JSON.parse(corps);
    const answers: Record<string, unknown> = {};
    for (const [cle, q] of Object.entries<any>(demande.questions)) {
      if (q.type === 'noul') answers[cle] = { type: 'noul', noul: 0.05 };
      else if (q.type === 'choice') {
        const cles = Object.keys(q.criteria);
        answers[cle] = { type: 'choice', choice: cles[cles.length - 1], probabilities: {}, confidence: 0.95 };
      } else answers[cle] = { type: 'score', score: q.criteria.length - 1, confidence: 0.95 };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-essai', answers, usage: { input_tokens: 120, output_tokens: 8 } }));
  });
});
await new Promise<void>((resolve) => faux.listen(0, '127.0.0.1', resolve));
const adresse = `http://127.0.0.1:${(faux.address() as { port: number }).port}/v1/systemone`;
test.after(() => {
  faux.closeAllConnections();
  faux.close();
});

let ficheId = '';
function rangerLaCle(cle = 'cle-essai'): void {
  const r = coffre.enregistrerAcces({
    ...(ficheId ? { id: ficheId } : {}),
    nom: 'TypeSafe — clé d’essai',
    type: 'cle-api',
    champs: { service: 'TypeSafe', cle, adresse },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) ficheId = r.acces.id;
}

test('sans clé au coffre : aucun appel, chaque jugement rend « rien » sans lever', async () => {
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  assert.equal(juge.jugeAllume(), false);
  assert.equal(juge.etatDuJuge().allume, false);
  const avant = appelsRecus;
  assert.equal(await juge.noterUneProposition({ titre: 'T', description: 'D' }, {}), undefined);
  assert.equal(await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {}), undefined);
  assert.equal(appelsRecus, avant, 'aucune requête ne part sans clé');
  assert.deepEqual(await juge.testerLaCle(), { etat: 'absente' });
  const traces = juge.listerLesTraces(10);
  assert.ok(traces.length >= 2, 'chaque échec laisse sa trace');
  for (const trace of traces) {
    assert.equal(trace.issue, 'echec');
    assert.match(trace.reponse, /aucune clé/);
  }
});

test('un usage éteint n’interroge pas Jev du tout', async () => {
  rangerLaCle();
  store.saveSettings({ jugeEteints: [...USAGES_JUGE], jugeAllumes: [] });
  const avant = appelsRecus;
  assert.equal(await juge.noterUneProposition({ titre: 'T', description: 'D' }, {}), undefined);
  assert.equal(await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {}), undefined);
  assert.equal(await juge.classerLeGenreDeLaCarte('T', 'D'), 'indetermine');
  assert.equal(appelsRecus, avant, 'aucun appel à Jev');
  assert.ok(juge.etatDuJuge().usages.every((usage) => usage.allume === false));
});

test('clé rangée : les jugements rendent leur verdict en UN appel, et la trace compte les jetons', async () => {
  rangerLaCle();
  mode = 'normal';
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  const etat = juge.etatDuJuge();
  assert.equal(etat.allume, true);
  assert.equal(etat.fiche?.id, ficheId);
  const avant = appelsRecus;
  const interet = await juge.noterUneProposition({ titre: 'T', description: 'D' }, {});
  assert.equal(appelsRecus, avant + 1, 'le gain et l’ampleur partent en UN appel');
  assert.deepEqual([interet?.gain, interet?.ampleur], [3, 3]);
  const urgence = await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {});
  assert.equal(urgence?.signal, false, 'le faux Jev répond « non »');
  assert.equal(await juge.classerLeGenreDeLaCarte('T', 'D'), 'administratif', 'la dernière valeur offerte');
  assert.equal(await juge.proposerUnNiveau({ titre: 'T', description: 'D' }, {}), 'approfondi');
  assert.equal(await juge.classerLaFamilleDeLErreur('Error: bizarre'), 'bug-interne');
  const [derniere] = juge.listerLesTraces(1, 'tri-propositions');
  assert.equal(derniere.issue, 'repondu');
  assert.equal(derniere.jetonsEntree, 120);
  assert.equal(derniere.jetonsSortie, 8);
  const question = JSON.parse(derniere.question);
  assert.deepEqual(Object.keys(question).sort(), ['model', 'questions', 'state']);
  assert.equal(question.model, 'jev-latest');
  assert.deepEqual(await juge.testerLaCle(), { etat: 'acceptee' });
});

test('clé refusée, service en panne ou muet : « rien », jamais une exception', async () => {
  rangerLaCle();
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  try {
    mode = 'refus';
    let avant = appelsRecus;
    assert.equal(await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {}), undefined);
    assert.equal(appelsRecus, avant + 1, 'une clé refusée ne se retente pas');
    assert.equal((await juge.testerLaCle()).etat, 'refusee');

    mode = 'panne';
    avant = appelsRecus;
    assert.equal(await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {}), undefined);
    assert.equal(appelsRecus, avant + 2, 'un 5xx a droit à UNE reprise, pas plus');

    mode = 'lent';
    const depart = Date.now();
    /* Usage au délai court : la phrase « erreur inattendue » ne traîne pas. */
    assert.equal(await juge.classerLaFamilleDeLErreur('Error: lent'), undefined);
    assert.ok(Date.now() - depart < 4_000, `rendu en ${Date.now() - depart} ms`);
    const [trace] = juge.listerLesTraces(1, 'famille-erreur');
    assert.match(trace.reponse, /délai/);
  } finally {
    mode = 'normal';
  }
});

test('pertinence : un « non » franc écarte, et le reste est gardé', async () => {
  rangerLaCle();
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  const docs = [
    { cle: 'a', texte: 'A' },
    { cle: 'b', texte: 'B' },
  ];
  const gardees = await juge.documentsPertinents('une demande', docs, { usage: 'pertinence-memoire' });
  assert.deepEqual([...(gardees ?? [])], [], 'le faux Jev dit « non » à tout, sûr de lui');
  assert.equal(await juge.chercherUnDoublon({ titre: 'T', description: 'D' }, [{ id: 'c', title: 'T', description: 'D' }], {}), undefined);
});

test('un état énorme laisse une trace courte, et toujours un JSON valide', async () => {
  rangerLaCle();
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  await juge.interroger({ texte: 'x'.repeat(50_000), liste: Array.from({ length: 50 }, () => 'y'.repeat(2000)) }, questionUrgence(), {
    usage: 'urgence-demande',
  });
  const [trace] = juge.listerLesTraces(1, 'urgence-demande');
  assert.doesNotThrow(() => JSON.parse(trace.question));
  assert.ok(trace.question.length < 20_000, `trace de ${trace.question.length} signes`);
});
