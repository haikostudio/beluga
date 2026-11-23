import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JALON_NOTE_DE_L_AGENT,
  JALON_TOUR_LANCE,
  PLAFOND_DE_BLOCS,
  CARTONS_MONTRES_D_OFFICE,
  estDePlomberie,
  estUneImage,
  recitDeLEntree,
  recitDuPoint,
  sujetLisible,
  type EntreeJournal,
} from '@beluga/shared';

/**
 * LE RÉCIT D'UN PASSAGE — ÉPROUVÉ SUR LES ONZE SORTES D'ENTRÉES.
 *
 * `recitDuPoint` remplace les lignes techniques du flux : c'est lui qui décide
 * ce qu'un carton raconte. Ses titres sont des clés du dictionnaire, donc des
 * textes que cinq langues traduisent ; son regroupement décide si un tour de
 * cinquante actions se lit ou devient un mur. Les deux se figent ici.
 */

let rang = 0;
function entree(partiel: Partial<EntreeJournal>): EntreeJournal {
  rang += 1;
  return {
    id: `e${rang}`,
    cardId: 'c1',
    phase: 'execution',
    nature: 'requete',
    at: 1_000 + rang,
    rang,
    libelle: '',
    ...partiel,
  } as EntreeJournal;
}

function requete(outil: string, params: unknown, resultat = ''): EntreeJournal {
  return entree({ outil, libelle: outil, params: JSON.stringify(params), resultat });
}

test('une image se reconnaît à son extension, jamais à son dossier', () => {
  assert.equal(estUneImage('/root/beluga/data/attachments/image (2).png'), true);
  assert.equal(estUneImage('/tmp/CAPTURE.JPG'), true);
  assert.equal(estUneImage('/a/b.webp'), true);
  assert.equal(estUneImage('/a/b.ts'), false);
  assert.equal(estUneImage(''), false);
});

test('chaque sorte d’entrée a son genre de bloc et son sujet lisible', () => {
  const cas: [EntreeJournal, string, string | undefined][] = [
    [requete('Read', { file_path: '/root/x/app.tsx' }, 'const a = 1'), 'lecture', 'app.tsx'],
    [requete('Read', { file_path: '/root/data/attachments/image.png' }, ''), 'capture', 'image.png'],
    [requete('Edit', { file_path: '/root/x/chat.tsx', old_string: 'a', new_string: 'b' }), 'ecriture', 'chat.tsx'],
    [requete('Bash', { command: 'npm test', description: 'Lancer les tests' }, 'ok'), 'commande', 'Lancer les tests'],
    [requete('Grep', { pattern: 'BlocsRacontes' }, 'a\nb'), 'recherche', 'BlocsRacontes'],
    [requete('mcp__beluga__project_memory', { sujet: 'interface' }, 'des faits'), 'memoire', 'interface'],
    [requete('mcp__beluga__ask_user', { question: 'Quelle couleur ?' }, ''), 'question', 'Quelle couleur ?'],
    [requete('WebFetch', { url: 'https://exemple.test' }, 'page'), 'web', 'https://exemple.test'],
    [requete('TodoWrite', { todos: [] }), 'tache', undefined],
    [requete('mcp__beluga__board_update_card', { id: 'c1' }, 'fait'), 'outil', 'c1'],
  ];
  for (const [entreeLue, genre, sujet] of cas) {
    const recit = recitDeLEntree(entreeLue);
    assert.equal(recit.genre, genre, `${entreeLue.outil} devrait se raconter en « ${genre} »`);
    if (sujet !== undefined) assert.equal(recit.sujet, sujet, `${entreeLue.outil} devrait citer « ${sujet} »`);
  }
  /* UN POINT DE LA LISTE DE TÂCHES et un texte rendu se racontent aussi. */
  assert.equal(recitDeLEntree(entree({ nature: 'point', libelle: '2. Dessiner les blocs' })).genre, 'tache');
  assert.equal(
    recitDeLEntree(entree({ nature: 'jalon', libelle: 'Réponse rendue', resultat: '## 1. Analyse\nvoilà' })).genre,
    'note',
  );
});

test('un outil inconnu garde son nom français, jamais son identifiant d’appel', () => {
  const recit = recitDeLEntree(requete('mcp__beluga__coffre_fort', { action: 'lister' }, 'ok'));
  assert.equal(recit.genre, 'outil');
  assert.equal(recit.variante, 'Ouverture du coffre-fort');
  assert.ok(!/mcp__/.test(recit.variante ?? ''));
});

test('les actions voisines de même genre se réunissent en un seul bloc', () => {
  const lectures = ['a.ts', 'b.ts', 'c.ts'].map((nom) => requete('Read', { file_path: `/x/${nom}` }, ''));
  const { blocs } = recitDuPoint([...lectures, requete('Bash', { command: 'npm test' }, 'ok')]);
  assert.equal(blocs.length, 2);
  assert.equal(blocs[0].genre, 'lecture');
  assert.equal(blocs[0].compte, 3);
  assert.equal(blocs[0].titre.motif, '{v0} fichiers lus');
  assert.deepEqual(blocs[0].titre.valeurs, { v0: 3 });
  assert.deepEqual(blocs[0].sujets, ['a.ts', 'b.ts', 'c.ts']);
  assert.equal(blocs[1].genre, 'commande');
  assert.equal(blocs[1].titre.motif, 'Commande lancée');
});

test('le bloc rend la LISTE de ses sujets, entière et sans doublon', () => {
  const noms = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const lectures = [...noms, 'a'].map((n) => requete('Read', { file_path: `/x/${n}.ts` }, ''));
  const { blocs } = recitDuPoint(lectures);
  const [bloc] = blocs;
  /* RIEN N'EST COUPÉ ICI : c'est l'écran qui décide où poser son « voir les N
     de plus ». La règle ne rend qu'une liste, sans doublon. */
  assert.deepEqual(
    bloc.sujets,
    noms.map((n) => `${n}.ts`),
  );
  assert.equal(bloc.compte, 9);
});

test('un passage trop long réunit ses genres, même à distance, sous le plafond', () => {
  const entrees: EntreeJournal[] = [];
  for (let i = 0; i < 30; i += 1) {
    entrees.push(requete('Read', { file_path: `/x/f${i}.ts` }, ''));
    entrees.push(requete('Bash', { command: `echo ${i}` }, 'ok'));
  }
  const recit = recitDuPoint(entrees);
  assert.ok(recit.blocs.length <= PLAFOND_DE_BLOCS, `${recit.blocs.length} blocs : le plafond n'est pas tenu`);
  assert.deepEqual(
    recit.blocs.map((b) => b.genre),
    ['lecture', 'commande'],
  );
  assert.equal(recit.blocs[0].compte, 30);
});

test('une capture regardée garde le chemin de sa vignette', () => {
  const { blocs } = recitDuPoint([requete('Read', { file_path: '/root/beluga/data/attachments/image (2).png' }, '')]);
  const [bloc] = blocs;
  assert.equal(bloc.genre, 'capture');
  assert.equal(bloc.vignette, '/root/beluga/data/attachments/image (2).png');
  assert.equal(bloc.titre.motif, 'Capture d’écran regardée');
});

test('une question répondue raconte la question ET la réponse', () => {
  const { blocs } = recitDuPoint([
    requete('mcp__beluga__ask_user', { question: 'On garde le bandeau ?' }, 'Réponse : non'),
  ]);
  const [bloc] = blocs;
  assert.equal(bloc.genre, 'question');
  assert.equal(bloc.question?.intitule, 'On garde le bandeau ?');
  assert.match(String(bloc.question?.reponse ?? ''), /non/);
});

test('le bloc d’une question dit si plusieurs choix étaient permis', () => {
  /* L'entête lisait « Un seul choix » sous une question qui en permettait
     plusieurs : le genre de choix n'allait pas jusqu'au bloc raconté. */
  const options = [{ label: 'Le montant' }, { label: 'La date' }];
  const { blocs } = recitDuPoint([
    requete('mcp__beluga__ask_user', { question: 'Quels champs ?', kind: 'multiple', options }, 'Réponse : Le montant'),
    requete('mcp__beluga__ask_user', { question: 'Lequel d’abord ?', options }, 'Réponse : La date'),
  ]);
  assert.equal(blocs[0].question?.choix, 'multiple');
  assert.equal(blocs[1].question?.choix, 'single');
});

test('deux questions ne se réunissent JAMAIS en un seul bloc', () => {
  const { blocs } = recitDuPoint([
    requete('mcp__beluga__ask_user', { question: 'Première ?' }, 'Réponse : oui'),
    requete('mcp__beluga__ask_user', { question: 'Seconde ?' }, 'Réponse : non'),
  ]);
  assert.equal(blocs.length, 2);
  assert.equal(blocs[0].question?.intitule, 'Première ?');
  assert.equal(blocs[1].question?.intitule, 'Seconde ?');
});

test('une action refusée marque son bloc, sans qu’on le déplie', () => {
  const refusee = requete('Bash', { command: 'npm test' }, 'ko');
  refusee.reussie = false;
  const { blocs } = recitDuPoint([requete('Bash', { command: 'npm run build' }, 'ok'), refusee]);
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].enEchec, true);
});

test('un passage sans aucune action ne raconte rien', () => {
  const _tmp = recitDuPoint([]); assert.deepEqual(_tmp.blocs, []);
});

/* ------------------------------------------------------------------ */
/* LE TAMIS : CE QUI N'EST PAS DU TRAVAIL NE SE RACONTE PAS             */
/* ------------------------------------------------------------------ */

test('le jalon de lancement ne forme aucun bloc, mais reste au journal', () => {
  const lancement = entree({
    nature: 'jalon',
    libelle: JALON_TOUR_LANCE,
    donnees: JSON.stringify({ moteur: 'claude', modele: 'opus' }),
  });
  assert.equal(estDePlomberie(lancement), true);
  const _tmp = recitDuPoint([lancement]); assert.deepEqual(_tmp.blocs, []);
  /* L'entrée elle-même n'est pas touchée : le parcours continue de la lire. */
  assert.equal(lancement.libelle, JALON_TOUR_LANCE);
});

test('le chargement d’un outil ne se raconte pas, sous aucune de ses écritures', () => {
  const ecritures = [
    requete('ToolSearch', { query: 'select:mcp__beluga__rendre_plan' }, 'ok'),
    entree({ outil: 'ToolSearch', libelle: 'Recherche d’un outil', params: '{"query":"select:Read"}' }),
    entree({ outil: '', libelle: 'Outil ToolSearch', params: '{"query":"select:Read"}' }),
    entree({ outil: 'mcp__beluga__rendre_plan', libelle: 'rendre_plan', params: '{"version":1}' }),
    requete('rendre_comprehension', { texte: 'compris' }, 'ok'),
  ];
  for (const lue of ecritures) {
    assert.equal(estDePlomberie(lue), true, `${lue.libelle} devrait être de la plomberie`);
  }
  const _tmp = recitDuPoint(ecritures); assert.deepEqual(_tmp.blocs, []);
});

test('un passage entièrement fait de plomberie ne rend aucun bloc', () => {
  const { blocs } = recitDuPoint([
    entree({ nature: 'jalon', libelle: JALON_TOUR_LANCE, donnees: '{"moteur":"claude"}' }),
    requete('ToolSearch', { query: 'select:TaskCreate,TaskUpdate' }, 'ok'),
  ]);
  assert.deepEqual(blocs, []);
});

test('le tamis ne coupe pas l’amas qu’il traverse', () => {
  const { blocs } = recitDuPoint([
    requete('Read', { file_path: '/x/a.ts' }, ''),
    entree({ nature: 'jalon', libelle: JALON_TOUR_LANCE, donnees: '{"moteur":"claude"}' }),
    requete('Read', { file_path: '/x/b.ts' }, ''),
  ]);
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].compte, 2);
});

test('le travail réel traverse le tamis, lui', () => {
  const { blocs } = recitDuPoint([
    requete('Read', { file_path: '/x/a.ts' }, ''),
    requete('Bash', { command: 'npm test' }, 'ok'),
    requete('Edit', { file_path: '/x/b.ts', old_string: 'a', new_string: 'b' }),
    requete('Grep', { pattern: 'BlocsRacontes' }, 'a'),
    requete('mcp__beluga__project_memory', { sujet: 'interface' }, 'des faits'),
  ]);
  assert.deepEqual(
    blocs.map((b) => b.genre),
    ['lecture', 'commande', 'ecriture', 'recherche', 'memoire'],
  );
});

test('un champ technique ne devient jamais une phrase de détail', () => {
  for (const valeur of [
    'select:mcp__beluga__rendre_plan',
    'mcp__beluga__project_memory',
    'e412b95a-23ad-4be4-a7db-2e52cb24e4c3',
    '300000, 480000, 560000',
    'rendre_comprehension',
    'claude',
    'Opus',
  ]) {
    assert.equal(sujetLisible(valeur), false, `« ${valeur} » ne devrait pas se citer`);
  }
  for (const valeur of ['lister', 'app.tsx', 'npm test', 'interface', 'Quelle couleur ?']) {
    assert.equal(sujetLisible(valeur), true, `« ${valeur} » devrait se citer`);
  }
  /* Le refuge se tait alors, mais garde son titre. */
  const { blocs } = recitDuPoint([
    entree({ outil: 'TaskOutput', libelle: 'Lecture du travail d’une tâche', params: '{"timeout":300000}' }),
  ]);
  const [bloc] = blocs;
  assert.equal(bloc.genre, 'outil');
  assert.equal(bloc.titre.valeurs?.v0, 'Lecture du travail d’une tâche');
  assert.deepEqual(bloc.sujets, []);
});

/**
 * L'HEURE ET LA DURÉE DE CHAQUE GESTE — ce que l'écran pose à droite d'une
 * phrase du fil. Sans ces deux champs, l'affichage devrait relire les entrées
 * du journal lui-même, et deux règles de calcul finiraient par diverger.
 */
test('un bloc raconté porte son instant de départ et son enveloppe de durée', () => {
  const a = entree({ outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: '/a.ts' }), at: 10_000, dureeMs: 500 });
  const b = entree({ outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: '/b.ts' }), at: 11_000, dureeMs: 1_500 });
  const recit = recitDuPoint([a, b]);
  assert.equal(recit.blocs.length, 1);
  assert.equal(recit.blocs[0].debutAt, 10_000);
  /* L'ENVELOPPE, PAS LA SOMME : de 10 000 à 12 500, la réflexion entre les
     deux lectures comprise — c'est du temps réellement passé. */
  assert.equal(recit.blocs[0].dureeMs, 2_500);
  assert.equal(recit.debutAt, 10_000);
  assert.equal(recit.dureeMs, 2_500);
});

test('un geste jamais chronométré ne dit aucune durée, seulement son heure', () => {
  const seul = entree({ outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: '/a.ts' }), at: 20_000 });
  const recit = recitDuPoint([seul]);
  assert.equal(recit.blocs[0].debutAt, 20_000);
  assert.equal(recit.blocs[0].dureeMs, undefined);
  assert.equal(recit.dureeMs, undefined);
});

test('le total du passage compte AUSSI les gestes cachés derrière le repli', () => {
  const entrees: EntreeJournal[] = [];
  /* Un genre différent par bloc, pour dépasser le plafond sans fusionner. */
  for (let i = 0; i < CARTONS_MONTRES_D_OFFICE + 4; i += 1) {
    entrees.push(
      entree({
        outil: 'Bash',
        libelle: 'Bash',
        params: JSON.stringify({ command: `echo ${i}`, description: `geste ${i}` }),
        at: 100_000 + i * 1_000,
        dureeMs: 200,
      }),
    );
  }
  const recit = recitDuPoint(entrees);
  assert.ok(recit.blocs.length > recit.montresDOffice);
  assert.equal(recit.debutAt, 100_000);
  /* Du premier geste à la fin du DERNIER, même hors du repli. */
  assert.equal(recit.dureeMs, (CARTONS_MONTRES_D_OFFICE + 3) * 1_000 + 200);
});

test('un long passage montre ses QUINZE DERNIERS cartons, et replie les plus anciens', () => {
  const entrees: EntreeJournal[] = [];
  /* Une phrase d'agent par geste : rien ne se fond, vingt gestes font vingt cartons. */
  for (let i = 0; i < 20; i += 1) {
    entrees.push(requete('Bash', { command: `echo ${i}`, description: `étape numéro ${i}` }, 'ok'));
  }
  const recit = recitDuPoint(entrees);
  assert.equal(CARTONS_MONTRES_D_OFFICE, 15);
  assert.equal(recit.blocs.length, 20);
  assert.equal(recit.montresDOffice, 15);
  /* L'écran montre `blocs.slice(blocs.length - montresDOffice)` : les cinq
     premiers sont repliés, le DERNIER geste est toujours à l'écran. */
  const montres = recit.blocs.slice(recit.blocs.length - recit.montresDOffice);
  assert.equal(montres[0].cle, recit.blocs[5].cle);
  assert.equal(montres[montres.length - 1].cle, recit.blocs[19].cle);
});

/**
 * LA DISCUSSION SE LIT DANS LE FIL (demande du 19/10/2026) : les questions
 * répondues et les notes de l'agent ne passent ni derrière « Réflexions » ni
 * sous le plafond ; les lectures, commandes et outils si.
 */
