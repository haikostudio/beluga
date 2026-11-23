import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARTONS_MONTRES_D_OFFICE,
  GENRES_DE_BLOC,
  MOTIFS_DE_PHRASE,
  MOTIFS_PAR_OUTIL,
  phraseDAgentLisible,
  phraseDuBloc,
  recitDuPoint,
  estUnIdentifiantDUnite,
  titreDuSujetLu,
  titreTechniqueLu,
  type EntreeJournal,
} from '@beluga/shared';

/**
 * LE FIL SE RACONTE À LA PREMIÈRE PERSONNE.
 *
 * `phraseDuBloc` décide ce qu'on LIT au premier niveau d'un passage : une
 * phrase de l'agent quand il en a écrit une, sinon un motif du démon. Deux
 * choses se figent ici : la PRIORITÉ (l'agent d'abord) et le SILENCE sur le
 * technique (aucun chemin, aucune commande, aucun nom d'outil au premier
 * niveau).
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

/** La phrase d'un passage fait d'une seule liste d'entrées. */
function phrases(entrees: EntreeJournal[]) {
  return recitDuPoint(entrees).blocs.map((bloc) => phraseDuBloc(bloc));
}

test('chaque genre a son motif au singulier et au pluriel', () => {
  for (const genre of GENRES_DE_BLOC) {
    const motifs = MOTIFS_DE_PHRASE[genre];
    assert.ok(motifs, `le genre ${genre} n’a pas de motif`);
    assert.ok(motifs.un.length > 5, `${genre} : singulier trop court`);
    assert.ok(motifs.plusieurs.includes('{v0}'), `${genre} : le pluriel doit porter son nombre`);
    /* LA PREMIÈRE PERSONNE, PARTOUT : c'est tout l'objet de ces motifs. */
    assert.match(motifs.un, /^J(?:e |’)/u, `${genre} : le singulier ne parle pas à la première personne`);
    assert.match(motifs.plusieurs, /^J(?:e |’)/u, `${genre} : le pluriel ne parle pas à la première personne`);
  }
});

test('une lecture seule et un paquet de lectures se disent au bon nombre', () => {
  const [seule] = phrases([requete('Read', { file_path: '/root/x/app.tsx' }, 'const a = 1')]);
  assert.deepEqual(seule, { dit: 'demon', motif: 'Je lis un fichier du projet.' });

  const [paquet] = phrases([
    requete('Read', { file_path: '/root/x/a.ts' }, ''),
    requete('Read', { file_path: '/root/x/b.ts' }, ''),
    requete('Read', { file_path: '/root/x/c.ts' }, ''),
  ]);
  assert.deepEqual(paquet, { dit: 'demon', motif: 'Je lis {v0} fichiers du projet.', valeurs: { v0: 3 } });
});

test('aucun chemin de fichier ni ligne de commande ne sort au premier niveau', () => {
  const dites = phrases([
    requete('Read', { file_path: '/root/beluga/web/src/components/flux-en-points.tsx' }, ''),
    requete('Edit', { file_path: '/root/beluga/shared/src/recit-du-tour.ts', old_string: 'a', new_string: 'b' }),
    requete('Bash', { command: 'npm run build --workspace shared' }, 'ok'),
    requete('Grep', { pattern: 'mcp__beluga__ask_user' }, 'x'),
  ]);
  for (const phrase of dites) {
    const texte = phrase.dit === 'agent' ? phrase.texte : `${phrase.motif} ${JSON.stringify(phrase.valeurs ?? {})}`;
    assert.doesNotMatch(texte, /\//, `un chemin s’affiche : ${texte}`);
    assert.doesNotMatch(texte, /npm |\.tsx|\.ts\b|mcp__/, `du technique s’affiche : ${texte}`);
  }
});

test('la phrase de l’agent l’emporte sur le motif du démon', () => {
  const [phrase] = phrases([
    requete('Bash', { command: 'npm test', description: 'vérifier que les tests du démon passent' }, 'ok'),
  ]);
  /* LES MOTS DE L'AGENT, ENCHÂSSÉS DANS UN CADRE À LA PREMIÈRE PERSONNE : on
     ne les réécrit pas, on les fait entrer dans le récit. */
  assert.deepEqual(phrase, {
    dit: 'demon',
    motif: 'Je lance une commande pour {v0}.',
    valeurs: { v0: 'vérifier que les tests du démon passent' },
  });
});

test('deux intentions différentes ne se fondent pas en « 2 commandes »', () => {
  const dites = phrases([
    requete('Bash', { command: 'npm run build', description: 'construire le projet' }, 'ok'),
    requete('Bash', { command: 'npm test', description: 'lancer les tests' }, 'ok'),
  ]);
  assert.equal(dites.length, 2);
  assert.deepEqual(
    dites.map((p) => (p.dit === 'agent' ? p.texte : p.valeurs?.v0)),
    ['construire le projet', 'lancer les tests'],
  );
});

test('la même intention deux fois de suite ne se redit pas', () => {
  const { blocs } = recitDuPoint([
    requete('Bash', { command: 'npm test', description: 'lancer les tests' }, 'ok'),
    requete('Bash', { command: 'npm test -- --watch', description: 'lancer les tests' }, 'ok'),
  ]);
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].compte, 2);
  assert.deepEqual(phraseDuBloc(blocs[0]), {
    dit: 'demon',
    motif: 'Je lance une commande pour {v0}.',
    valeurs: { v0: 'lancer les tests' },
  });
});

test('une note de l’agent garde ses mots, sans cadre autour', () => {
  const [phrase] = phrases([
    entree({
      nature: 'jalon',
      libelle: 'Tour interrompu',
      resultat: 'Je repars du constat : la base servie n’est pas celle du dépôt.',
    }),
  ]);
  assert.equal(phrase.dit, 'agent');
});

test('un tour très long garde ses phrases : elles ne se fondent pas par genre', () => {
  const entrees: EntreeJournal[] = [];
  for (let i = 0; i < 30; i += 1) {
    entrees.push(requete('Bash', { command: `echo ${i}`, description: `étape numéro ${i}` }, 'ok'));
  }
  const recit = recitDuPoint(entrees);
  assert.equal(recit.blocs.length, 30, 'les phrases de l’agent ont été fondues');
  /* LES PLUS ANCIENS ATTENDENT DERRIÈRE « voir les N précédentes » : la
     règle dit où couper, elle n'efface rien. */
  assert.equal(recit.montresDOffice, CARTONS_MONTRES_D_OFFICE);
});

test('une commande sans intention retombe sur le motif du démon', () => {
  const [phrase] = phrases([requete('Bash', { command: 'git status' }, 'ok')]);
  assert.deepEqual(phrase, { dit: 'demon', motif: 'Je lance une commande.' });
});

test('une intention illisible ne devient pas une phrase', () => {
  assert.equal(phraseDAgentLisible('npm run build'), false);
  assert.equal(phraseDAgentLisible('mcp__beluga__ask_user'), false);
  assert.equal(phraseDAgentLisible('e412b95a-23ad-4f31-9c11-8a7d5e2f0011'), false);
  assert.equal(phraseDAgentLisible('300000'), false);
  assert.equal(phraseDAgentLisible('/root/beluga/web/src/app.tsx'), false);
  assert.equal(phraseDAgentLisible('ok'), false);
  assert.equal(phraseDAgentLisible('Relire la fiche du client avant de trancher'), true);
});

test('la mémoire et la recherche citent leur sujet quand il se lit', () => {
  const [memoire] = phrases([requete('mcp__beluga__project_memory', { sujet: 'publication' }, 'des faits')]);
  assert.deepEqual(memoire, {
    dit: 'demon',
    motif: 'J’ouvre la mémoire du projet sur « {v0} ».',
    valeurs: { v0: 'publication' },
  });

  const [recherche] = phrases([requete('Grep', { pattern: 'tiroir de publication' }, 'une ligne')]);
  assert.deepEqual(recherche, {
    dit: 'demon',
    motif: 'Je cherche « {v0} » dans le projet.',
    valeurs: { v0: 'tiroir de publication' },
  });
});

test('une unité lue par son code : la règle cite le code, l’écran y met le titre (carte 79083bc5)', () => {
  const texte = '## DEC-346 — Le fil en cinq points\n\ndecision · P1 · interface\n\nUn résumé.';
  const [lue] = phrases([requete('mcp__beluga__memoire', { geste: 'lire', id: 'DEC-346' }, texte)]);
  /* Le texte de la règle ne change pas : c'est l'écran qui reformule. */
  assert.deepEqual(lue, { dit: 'demon', motif: 'J’ouvre la mémoire du projet sur « {v0} ».', valeurs: { v0: 'DEC-346' } });
  assert.equal(estUnIdentifiantDUnite('DEC-346'), true);
  assert.equal(estUnIdentifiantDUnite('MEM-1304'), true);
  assert.equal(estUnIdentifiantDUnite('publication'), false);
  assert.equal(titreTechniqueLu(texte, 'DEC-346'), 'Le fil en cinq points');
  assert.equal(titreTechniqueLu(texte, 'DEC-347'), undefined);
  /* Le titre clair d'abord, sinon le titre technique, à défaut rien (le code seul). */
  assert.equal(titreDuSujetLu('Titre clair', 'Titre technique'), 'Titre clair');
  assert.equal(titreDuSujetLu(undefined, 'Titre technique'), 'Titre technique');
  assert.equal(titreDuSujetLu('  ', undefined), undefined);
});

test('une capture se raconte seule, jamais fondue avec ses voisines', () => {
  const { blocs } = recitDuPoint([
    requete('Read', { file_path: '/root/beluga/data/attachments/a.png' }, ''),
    requete('Read', { file_path: '/root/beluga/data/attachments/b.png' }, ''),
  ]);
  assert.equal(blocs.length, 2, 'les captures se sont fondues : une vignette serait perdue');
  assert.deepEqual(
    blocs.map((b) => b.vignette),
    ['/root/beluga/data/attachments/a.png', '/root/beluga/data/attachments/b.png'],
  );
  assert.deepEqual(phraseDuBloc(blocs[0]), { dit: 'demon', motif: 'Je regarde une capture d’écran.' });
});

test('une question se dit à la première personne, elle aussi', () => {
  const [phrase] = phrases([
    requete('mcp__beluga__ask_user', { question: 'On garde le bandeau ?' }, 'Réponse : non'),
  ]);
  assert.deepEqual(phrase, { dit: 'demon', motif: 'Je vous pose une question.' });
});

/**
 * UNE PHRASE PAR OUTIL, ET NON PLUS UNE PAR CATÉGORIE. Ce que l'agent fait AVEC
 * l'outil se lit au premier niveau : « Je modifie la carte « … » » plutôt que
 * « Je me sers d'un outil du projet ».
 */
test('un outil du pont dit ce qu’il fait, et cite sa valeur clé', () => {
  const [phrase] = phrases([
    requete('mcp__beluga__board_update_card', { title: 'Lisibilité du récit' }, 'ok'),
  ]);
  assert.deepEqual(phrase, {
    dit: 'demon',
    motif: 'Je modifie la carte « {v0} ».',
    valeurs: { v0: 'Lisibilité du récit' },
  });
});

test('…et retombe sur sa forme courte quand la valeur ne se lit pas', () => {
  const [phrase] = phrases([
    requete('mcp__beluga__board_update_card', { cardId: 'e412b95a-23ad-4a1f-9b02-1122' }, 'ok'),
  ]);
  assert.deepEqual(phrase, { dit: 'demon', motif: 'Je modifie une carte.' });
});

test('un outil sans phrase à lui est NOMMÉ, jamais « un outil du projet »', () => {
  const [phrase] = phrases([requete('mcp__beluga__outil_inconnu', { valeur: 'quelque chose' }, 'ok')]);
  assert.deepEqual(phrase, { dit: 'demon', motif: 'J’utilise l’outil « {v0} ».', valeurs: { v0: 'outil_inconnu' } });
});

test('chaque outil du pont exposé au cadrage a sa phrase à lui', () => {
  for (const outil of ['exemple_de_choix', 'rendre_comprehension', 'rendre_plan', 'services', 'capture', 'iphone', 'ordinateur', 'media_en_cours', 'proposer_suites', 'toolsearch']) {
    assert.ok(MOTIFS_PAR_OUTIL[outil], `« ${outil} » doit avoir sa phrase`);
  }
  const [phrase] = phrases([requete('mcp__beluga__exemple_de_choix', { question: 'x' }, 'ok')]);
  assert.deepEqual(phrase, { dit: 'demon', motif: 'Je fabrique une maquette pour illustrer un choix.' });
});

test('un outil sans forme au pluriel est nommé avec son nombre', () => {
  const [phrase] = phrases([
    requete('mcp__beluga__coffre_fort', { action: 'lister' }, 'ok'),
    requete('mcp__beluga__coffre_fort', { action: 'lister' }, 'ok'),
  ]);
  assert.deepEqual(phrase, {
    dit: 'demon',
    motif: 'J’utilise l’outil « {v0} » {v1} fois.',
    valeurs: { v0: 'Ouverture du coffre-fort', v1: 2 },
  });
});

test('aucune phrase par outil ne laisse échapper un nom technique', () => {
  for (const [outil, motifs] of Object.entries(MOTIFS_PAR_OUTIL)) {
    assert.equal(outil, outil.toLowerCase(), `la clé « ${outil} » doit être en minuscules`);
    for (const motif of [motifs.un, motifs.plusieurs, motifs.avecSujet].filter(Boolean) as string[]) {
      assert.match(motif, /^(?:Je|J’)/, `« ${motif} » ne parle pas à la première personne`);
      assert.doesNotMatch(motif, /mcp__|_[a-z]/, `« ${motif} » laisse passer un nom de fonction`);
    }
  }
});
