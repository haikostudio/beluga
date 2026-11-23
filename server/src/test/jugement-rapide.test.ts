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
  DOSSIER_MAX,
  MOTIFS_DE_COMPREHENSION,
  NIVEAUX_DE_COMPREHENSION,
  avisSurLUrgence,
  basculerUsage,
  basculerUsageAllume,
  bilanDesTraces,
  comprehensionParRegles,
  dossierAJuger,
  indicateurDeComprehension,
  PHRASE_JAUGE_VIDE,
  phraseDuMotif,
  questionComprehension,
  questionUrgence,
  questionsProposition,
  rangDUneProposition,
  signatureDuDossier,
  tronquer,
  trierParInteret,
  usageAllume,
  verdictComprehension,
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
 *    `undefined` et retombe sur le comportement d'avant — sauf la jauge, notée
 *    par les règles ;
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
  assert.equal(usageAllume('comprehension-carte', ['comprehension-carte']), false);
  assert.equal(usageAllume('comprehension-carte', undefined), usageAllume('comprehension-carte', []));
  for (const usage of USAGES_JUGE) {
    assert.equal(usageAllume(usage, [], [usage]), true, `${usage} rallumé à la main`);
    assert.equal(usageAllume(usage, [usage], [usage]), false, 'éteint à la main l’emporte');
  }
});

test('éteindre un usage ne touche jamais aux autres', () => {
  const eteints = basculerUsage('comprehension-carte', false, []);
  assert.deepEqual(eteints, ['comprehension-carte']);
  for (const usage of USAGES_JUGE) {
    if (usage !== 'comprehension-carte') assert.equal(usageAllume(usage, eteints), usageAllume(usage, []));
  }
  assert.deepEqual(basculerUsage('comprehension-carte', true, eteints), [], 'rallumer retire la ligne');
  assert.deepEqual(basculerUsageAllume('pertinence-memoire', true, []), ['pertinence-memoire']);
  assert.deepEqual(basculerUsageAllume('pertinence-memoire', false, ['pertinence-memoire']), []);
});

/*
 * LES USAGES RETIRÉS NE LAISSENT AUCUNE CLÉ ORPHELINE. Les réglages déjà
 * écrits peuvent porter « description-carte » ou « fond-du-plan » : ils ne
 * font rien planter, et la première bascule les balaie.
 */
test('un usage inconnu ou retiré ne s’écrit jamais dans les réglages', () => {
  assert.deepEqual(basculerUsage('comprehension-carte', false, ['inventé']), ['comprehension-carte']);
  assert.deepEqual(
    basculerUsage('comprehension-carte', false, ['description-carte', 'fond-du-plan', 'coherence-rapport']),
    ['comprehension-carte'],
  );
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

test('la note de compréhension va de une à trois barres', () => {
  const note = (score: number) =>
    verdictComprehension(
      { type: 'score', score, legend: {}, probabilities: {}, confidence: 0.9 },
      { type: 'choice', choice: 'objectif-flou', probabilities: {}, confidence: 0.9 },
      1,
    );
  assert.equal(note(0)?.barres, 1);
  assert.equal(note(1)?.barres, 2);
  assert.equal(note(2)?.barres, 3);
  assert.equal(note(0)?.motif, 'objectif-flou');
});

test('un score hors échelle est ramené dans la fourchette, jamais jeté', () => {
  const note = (score: number) =>
    verdictComprehension({ type: 'score', score, legend: {}, probabilities: {}, confidence: 0.9 }, undefined, 1);
  assert.equal(note(-3)?.barres, 1);
  assert.equal(note(9)?.barres, 3);
  assert.equal(note(1.4)?.barres, 2, 'une note fractionnaire se lit au plus proche');
});

test('une confiance sous le palier ne rend AUCUNE note : le hasard ne s’affiche pas', () => {
  const faible = verdictComprehension(
    { type: 'score', score: 2, legend: {}, probabilities: {}, confidence: SEUILS.confianceDeLaComprehension - 0.01 },
    undefined,
    1,
  );
  assert.equal(faible, undefined);
  const sure = verdictComprehension(
    { type: 'score', score: 2, legend: {}, probabilities: {}, confidence: SEUILS.confianceDeLaComprehension },
    undefined,
    1,
  );
  assert.equal(sure?.barres, 3);
});

test('une réponse du mauvais type ne rend aucun verdict', () => {
  const mauvaise = { type: 'choice', choice: 'leger', probabilities: {}, confidence: 1 } as const;
  assert.equal(verdictComprehension(mauvaise, undefined, 1), undefined);
  assert.equal(verdictComprehension(undefined, mauvaise, 1), undefined);
  assert.equal(verdictUrgence(undefined, 1), undefined);
  assert.equal(verdictUrgence(mauvaise, 1), undefined);
});

test('l’urgence s’allume en HAUT du seuil', () => {
  assert.equal(verdictUrgence({ type: 'noul', noul: SEUILS.demandeUrgente + 0.05 }, 1)?.signal, true);
  assert.equal(verdictUrgence({ type: 'noul', noul: SEUILS.demandeUrgente - 0.05 }, 1)?.signal, false);
});

/*
 * LE JUGE NE REND AUCUN TEXTE LIBRE : la phrase du survol se compose ICI,
 * depuis un motif d'une liste fermée. Un mot inventé par le modèle retombe sur
 * une phrase générale plutôt que de s'afficher tel quel.
 */
test('la phrase du survol se compose depuis un motif fermé', () => {
  for (const motif of Object.keys(MOTIFS_DE_COMPREHENSION)) {
    assert.ok(phraseDuMotif(motif).length > 30, `le motif « ${motif} » a sa phrase`);
  }
  assert.ok(phraseDuMotif('inventé').length > 20, 'un motif inconnu retombe sur une phrase générale');
  assert.ok(phraseDuMotif(undefined).length > 20);
  const inventé = verdictComprehension(
    { type: 'score', score: 1, legend: {}, probabilities: {}, confidence: 0.9 },
    { type: 'choice', choice: 'inventé', probabilities: {}, confidence: 0.9 },
    1,
  );
  assert.equal(inventé?.motif, undefined, 'un motif hors liste n’est pas rangé');
});

test('la question porte trois niveaux décrits et une liste fermée de motifs', () => {
  const question = questionComprehension();
  assert.equal(question.score.type, 'score');
  assert.equal((question.score as { criteria: string[] }).criteria.length, 3);
  assert.deepEqual(NIVEAUX_DE_COMPREHENSION.length, 3);
  assert.equal(question.motif.type, 'choice');
  assert.deepEqual(
    Object.keys(question.motif.criteria!),
    Object.keys(MOTIFS_DE_COMPREHENSION),
  );
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

const COMPRISE = { parcours: { comprehension: { texte: 'Ce qu’il faut faire, dit en clair.' } } };

test('sans jugement sur la carte, la jauge est là, vide, et aucun avis ne s’écrit', () => {
  const nue = { column: 'planned', run: {}, jugements: undefined, ...COMPRISE };
  assert.deepEqual(indicateurDeComprehension(nue), { barres: 0, phrase: PHRASE_JAUGE_VIDE });
  assert.equal(avisSurLUrgence(nue), undefined);
});

test('l’indicateur ne paraît qu’avant le travail', () => {
  const juge = { comprehension: { barres: 2 as const, confiance: 0.8, at: 1 } };
  assert.ok(indicateurDeComprehension({ column: 'planned', jugements: juge, ...COMPRISE }));
  for (const colonne of ['running', 'done', 'to_deploy', 'archived']) {
    assert.equal(
      indicateurDeComprehension({ column: colonne, jugements: juge, ...COMPRISE }),
      undefined,
      `plus d’indicateur en « ${colonne} » : le lancement est passé`,
    );
  }
});


/*
 * LA JAUGE EST TOUJOURS LÀ TANT QUE LA CARTE SE DISCUTE : elle ne disparaît
 * plus faute de compréhension rendue, elle attend la note, barres éteintes.
 */
test('sans compréhension ni note, la jauge reste affichée, vide', () => {
  assert.equal(indicateurDeComprehension({ column: 'planned' })?.barres, 0);
  const juge = { comprehension: { barres: 1 as const, confiance: 0.9, at: 1 } };
  assert.equal(
    indicateurDeComprehension({ column: 'planned', jugements: juge })?.barres,
    1,
    'une note donnée avant la compréhension se lit aussi',
  );
});

test('l’indicateur porte sa phrase de survol, jamais un blocage', () => {
  const lu = indicateurDeComprehension({
    column: 'planned',
    jugements: { comprehension: { barres: 1 as const, confiance: 0.9, motif: 'resultat-non-dit', at: 1 } },
    ...COMPRISE,
  });
  assert.equal(lu?.barres, 1);
  assert.equal(lu?.phrase, MOTIFS_DE_COMPREHENSION['resultat-non-dit']);
  assert.equal(lu?.confiance, 0.9);
});

/* ------------------------------------------------------------------ */
/* LE DOSSIER JUGÉ : la compréhension, pas le champ « description »     */
/* ------------------------------------------------------------------ */

const CARTE_CADREE = {
  title: 'Revoir le machin',
  parcours: {
    comprehension: {
      texte: 'Il faut que le bouton range la carte au lieu de la laisser ouverte.',
      hypotheses: ['Je suppose que le raccourci clavier suit le même chemin.'],
      partieTechnique: {
        taches: [{ titre: 'Ranger la carte', description: 'au clic comme à la sortie' }],
        faits: ['Un arrêt à la main ramène la carte en « Planifié ».'],
        risques: 'Le balayage de nuit pourrait la reprendre.',
      },
    },
  },
};

test('le dossier jugé est la compréhension, pas la description de la carte', () => {
  const dossier = dossierAJuger(CARTE_CADREE);
  assert.ok(dossier);
  assert.match(dossier!.comprehension, /le bouton range la carte/);
  assert.equal(dossier!.hypotheses.length, 1);
  assert.equal(dossier!.taches.length, 1);
  assert.equal(dossier!.faits.length, 1);
  assert.ok(dossier!.risques.length > 10);
});

test('sans compréhension ni demande, il n’y a rien à juger', () => {
  assert.equal(dossierAJuger({ title: 'Nouvelle tâche' }), undefined);
  assert.equal(dossierAJuger({ title: 'x', parcours: { comprehension: { texte: '' } } }), undefined);
  assert.equal(dossierAJuger({ title: 'x' }, { demandes: ['   '] }), undefined);
});

test('la première demande suffit à juger : la jauge se remplit dès le début', () => {
  const dossier = dossierAJuger({ title: 'x' }, { demandes: ['Ajoute un bouton.'] });
  assert.ok(dossier);
  assert.deepEqual(dossier!.demandes, ['Ajoute un bouton.']);
  assert.ok(dossier!.reperes.includes('Compréhension rendue : non'));
  assert.ok(dossier!.reperes.includes('Messages de l’utilisateur : 1'));
});

test('les repères écrits sont ceux que portent les niveaux : le juge n’a qu’à les rapprocher', () => {
  const dossier = dossierAJuger(CARTE_CADREE, {
    demandes: ['Range la carte.'],
    questions: [
      { question: 'Au clic seulement ?', reponse: 'Aussi au clavier.' },
      { question: 'Sans réponse ?', reponse: '  ' },
    ],
  })!;
  assert.deepEqual(dossier.questions, ['Au clic seulement ? → Aussi au clavier.'], 'une question sans réponse ne compte pas');
  assert.ok(dossier.reperes.includes('Compréhension rendue : oui'));
  assert.ok(dossier.reperes.includes('Risques identifiés : oui'));
  const niveaux = (questionComprehension().score as { criteria: string[] }).criteria;
  assert.ok(niveaux[0].includes('Compréhension rendue : non'));
  assert.ok(niveaux[2].includes('Risques identifiés : oui') || niveaux[2].includes('risques identifiés : oui'));
  assert.equal(Object.keys(dossier)[0], 'reperes', 'les repères passent en tête : jamais coupés par le plafond');
});

test('un nouvel échange change la signature, donc redonne une note', () => {
  const avant = signatureDuDossier(dossierAJuger(CARTE_CADREE, { demandes: ['a'] })!);
  const apres = signatureDuDossier(dossierAJuger(CARTE_CADREE, { demandes: ['a', 'b'] })!);
  assert.notEqual(avant, apres);
});

test('une compréhension sans partie technique se juge quand même', () => {
  const dossier = dossierAJuger({ title: 'x', parcours: { comprehension: { texte: 'Compris.' } } });
  assert.deepEqual(dossier?.hypotheses, []);
  assert.deepEqual(dossier?.taches, []);
  assert.equal(dossier?.risques, '');
});

test('ce qui part reste borné, rubrique par rubrique', () => {
  const beaucoup = (n: number) => Array.from({ length: n }, (_, i) => `ligne ${i}`);
  const dossier = dossierAJuger({
    title: 'x',
    parcours: {
      comprehension: {
        texte: 'y'.repeat(20_000),
        hypotheses: beaucoup(200),
        partieTechnique: {
          taches: beaucoup(200).map((titre) => ({ titre, description: '' })),
          faits: beaucoup(200),
          risques: 'z'.repeat(20_000),
        },
      },
    },
  });
  assert.equal(dossier!.hypotheses.length, DOSSIER_MAX.hypotheses);
  assert.equal(dossier!.taches.length, DOSSIER_MAX.taches);
  assert.equal(dossier!.faits.length, DOSSIER_MAX.faits);
  assert.ok(dossier!.comprehension.length < 5000);
  assert.ok(dossier!.risques.length < 2200);
});

/*
 * LA SIGNATURE DÉCIDE QU'ON REJUGE : elle couvre tout ce qui part et RIEN de
 * volatil. Un horodatage dedans relancerait un jugement à chaque écriture de
 * la carte, sans fin.
 */
test('la signature change à chaque version, et pas autrement', () => {
  const avant = signatureDuDossier(dossierAJuger(CARTE_CADREE)!);
  assert.equal(signatureDuDossier(dossierAJuger(CARTE_CADREE)!), avant, 'le même dossier a la même signature');
  const ailleurs = {
    ...CARTE_CADREE,
    parcours: {
      comprehension: {
        ...CARTE_CADREE.parcours.comprehension,
        at: 999,
        tourId: 'msg-1',
      },
    },
  };
  assert.equal(signatureDuDossier(dossierAJuger(ailleurs)!), avant, 'un horodatage ne rejuge rien');
  const revu = {
    ...CARTE_CADREE,
    parcours: {
      comprehension: {
        ...CARTE_CADREE.parcours.comprehension,
        hypotheses: ['Je suppose autre chose.'],
      },
    },
  };
  assert.notEqual(signatureDuDossier(dossierAJuger(revu)!), avant, 'une nouvelle version redonne une note');
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

const DOSSIER = dossierAJuger(CARTE_CADREE)!;
const CARTE = { id: 'carte-essai', projectId: 'projet-essai' };

test('sans clé au coffre : aucun appel, chaque jugement rend « rien » sans lever, la jauge vient des règles', async () => {
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  assert.equal(juge.jugeAllume(), false);
  assert.equal(juge.etatDuJuge().allume, false);
  const avant = appelsRecus;
  const note = await juge.jugerLaComprehension(CARTE, DOSSIER);
  assert.equal(note?.source, 'regles', 'une compréhension rendue n’est jamais laissée sans barres');
  assert.equal(await juge.noterUneProposition({ titre: 'T', description: 'D' }, {}), undefined);
  assert.equal(await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {}), undefined);
  assert.equal(appelsRecus, avant, 'aucune requête ne part sans clé');
  assert.deepEqual(await juge.testerLaCle(), { etat: 'absente' });
  const traces = juge.listerLesTraces(10);
  assert.ok(traces.length >= 3, 'chaque échec laisse sa trace');
  for (const trace of traces) {
    assert.equal(trace.issue, 'echec');
    assert.match(trace.reponse, /aucune clé/);
  }
});

test('un usage éteint n’interroge pas Jev du tout', async () => {
  rangerLaCle();
  store.saveSettings({ jugeEteints: [...USAGES_JUGE], jugeAllumes: [] });
  const avant = appelsRecus;
  assert.equal(await juge.jugerLaComprehension(CARTE, DOSSIER), undefined);
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
  const note = await juge.jugerLaComprehension(CARTE, DOSSIER);
  assert.equal(appelsRecus, avant + 1, 'la note et son motif partent en UN appel');
  assert.equal(note?.barres, 3);
  assert.equal(note?.motif, 'rien-ne-manque');
  assert.equal(note?.source, 'jev');
  const interet = await juge.noterUneProposition({ titre: 'T', description: 'D' }, {});
  assert.deepEqual([interet?.gain, interet?.ampleur], [3, 3]);
  const urgence = await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {});
  assert.equal(urgence?.signal, false, 'le faux Jev répond « non »');
  assert.equal(await juge.classerLeGenreDeLaCarte('T', 'D'), 'administratif', 'la dernière valeur offerte');
  assert.equal(await juge.proposerUnNiveau({ titre: 'T', description: 'D' }, {}), 'approfondi');
  assert.equal(await juge.classerLaFamilleDeLErreur('Error: bizarre'), 'bug-interne');
  const [derniere] = juge.listerLesTraces(1, 'comprehension-carte');
  assert.equal(derniere.issue, 'repondu');
  assert.equal(derniere.jetonsEntree, 120);
  assert.equal(derniere.jetonsSortie, 8);
  const question = JSON.parse(derniere.question);
  assert.deepEqual(Object.keys(question).sort(), ['model', 'questions', 'state']);
  assert.equal(question.model, 'jev-latest');
  assert.deepEqual(await juge.testerLaCle(), { etat: 'acceptee' });
});

test('clé refusée, service en panne ou muet : « rien », jamais une exception — et la jauge reste notée', async () => {
  rangerLaCle();
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  try {
    mode = 'refus';
    let avant = appelsRecus;
    assert.equal(await juge.jugerLUrgence({ titre: 'T', description: 'D', origine: 'essai' }, {}), undefined);
    assert.equal(appelsRecus, avant + 1, 'une clé refusée ne se retente pas');
    assert.equal((await juge.testerLaCle()).etat, 'refusee');
    assert.equal((await juge.jugerLaComprehension(CARTE, DOSSIER))?.source, 'regles');

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

/* ------------------------------------------------------------------ */
/* LA NOTE PAR RÈGLES, QUAND JEV SE TAIT                                */
/* ------------------------------------------------------------------ */

test('les règles notent toujours, dans la liste fermée des motifs', () => {
  const at = 1;
  const vide = { ...DOSSIER, comprehension: '', taches: [], risques: '' };
  assert.deepEqual(
    [comprehensionParRegles(vide, at).barres, comprehensionParRegles(vide, at).motif],
    [1, 'discussion-naissante'],
  );
  const court = { ...DOSSIER, comprehension: 'Refaire le bouton.', taches: [] };
  assert.equal(comprehensionParRegles(court, at).motif, 'objectif-flou');
  const sansRisques = { ...DOSSIER, risques: '', criteresDeReussite: true, questionsOuvertes: 0 };
  assert.deepEqual([comprehensionParRegles(sansRisques, at).barres, comprehensionParRegles(sansRisques, at).motif], [2, 'contraintes-absentes']);
  const ouvertes = { ...DOSSIER, questionsOuvertes: 2 };
  assert.equal(comprehensionParRegles(ouvertes, at).barres, 2);
  const suppositions = { ...DOSSIER, hypotheses: Array.from({ length: 7 }, (_, i) => `h${i}`), questions: [], criteresDeReussite: true };
  assert.equal(comprehensionParRegles(suppositions, at).motif, 'hypotheses-trop-nombreuses');
  const sansCriteres = { ...DOSSIER, criteresDeReussite: false, questionsOuvertes: 0 };
  assert.equal(comprehensionParRegles(sansCriteres, at).motif, 'resultat-non-dit');
  const complet = { ...DOSSIER, criteresDeReussite: true, questionsOuvertes: 0 };
  assert.deepEqual([comprehensionParRegles(complet, at).barres, comprehensionParRegles(complet, at).motif], [3, 'rien-ne-manque']);
  for (const d of [vide, court, sansRisques, ouvertes, suppositions, sansCriteres, complet]) {
    const n = comprehensionParRegles(d, at);
    assert.ok(n.motif! in MOTIFS_DE_COMPREHENSION);
    assert.equal(n.source, 'regles');
  }
});

test('le dossier lit les critères de réussite du cahier et les questions restées ouvertes', () => {
  const carte = {
    ...CARTE_CADREE,
    parcours: {
      comprehension: {
        ...CARTE_CADREE.parcours!.comprehension!,
        cahierDesCharges: [{ titre: 'Critères de réussite', contenu: 'Le bouton répond.' }],
        questionsEnAttente: [{ reponse: '' }, { reponse: 'oui' }],
      },
    },
  };
  const dossier = dossierAJuger(carte as typeof CARTE_CADREE)!;
  assert.equal(dossier.criteresDeReussite, true);
  assert.equal(dossier.questionsOuvertes, 1);
  assert.equal(signatureDuDossier(dossier), signatureDuDossier(dossierAJuger(CARTE_CADREE)!), 'hors signature : pas de rejugement en masse');
});
