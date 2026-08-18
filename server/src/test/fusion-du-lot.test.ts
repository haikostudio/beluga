import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETAIL_ETAPE_MAX,
  LIBELLE_ETAT_TACHE,
  REFLEXION_DE_FUSION,
  annonceDeHeurts,
  avecEtatDeTache,
  conflitPurementDocumentaire,
  detailDeLEtape,
  documentRecollable,
  lignesNouvelles,
  lotMisEnLigne,
  mentionDeLOrdre,
  mentionDuRecollage,
  natureDeLEtat,
  ordreDeFusion,
  passesDeResolution,
  recollerLesDeuxIntentions,
  resumeDuLot,
  runDeFusionLegere,
  selectionSansHeurts,
  type MoteurCatalogue,
  type TacheDuLot,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LA FUSION DU LOT : qui résout, dans quel ordre, ce qui s'écrit       */
/* ------------------------------------------------------------------ */

/*
 * Les quatre règles nées de l'audit du 18/08/2026
 * (`docs/audit-fusion-deploiement.md`). Toutes PURES : ni base, ni disque, ni
 * git — un catalogue de moteurs et des listes, rien d'autre.
 */

function modele(id: string, appetite?: 'light' | 'medium' | 'heavy', thinking = ['none', 'medium', 'high']) {
  return { id, label: id.replaceAll('-', ' '), thinking: thinking.map((t) => ({ id: t })), appetite };
}

const CLAUDE: MoteurCatalogue = {
  id: 'claude',
  label: 'Claude',
  installed: true,
  comptesDisponibles: 2,
  models: [modele('claude-opus-5', 'heavy'), modele('claude-sonnet-5', 'medium'), modele('claude-haiku-4-5', 'light')],
};

const CODEX: MoteurCatalogue = {
  id: 'codex',
  label: 'Codex',
  installed: true,
  comptesDisponibles: 1,
  models: [modele('gpt-5.6-sol', 'heavy'), modele('gpt-5.4-mini')],
};

/* 1. Le modèle qui résout un conflit --------------------------------- */

test('la première passe descend sur le modèle léger du MÊME moteur', () => {
  const leger = runDeFusionLegere({ engine: 'claude', model: 'claude-opus-5', thinking: 'high' }, [CLAUDE, CODEX]);
  assert.equal(leger?.engine, 'claude');
  assert.equal(leger?.model, 'claude-haiku-4-5');
  assert.equal(leger?.thinking, REFLEXION_DE_FUSION);
});

test('sans appétit annoncé, la famille légère du moteur suffit', () => {
  const leger = runDeFusionLegere({ engine: 'codex', model: 'gpt-5.6-sol', thinking: 'xhigh' }, [CLAUDE, CODEX]);
  assert.equal(leger?.model, 'gpt-5.4-mini');
});

test('la réflexion voulue est ramenée à ce que le modèle propose vraiment', () => {
  const sansMedium: MoteurCatalogue = { ...CLAUDE, models: [modele('claude-haiku-4-5', 'light', ['none'])] };
  assert.equal(runDeFusionLegere({ engine: 'claude', model: 'claude-opus-5' }, [sansMedium])?.thinking, 'none');
});

test('rien à alléger : moteur inconnu, aucun modèle léger, ou carte déjà légère', () => {
  assert.equal(runDeFusionLegere({ engine: 'cursor', model: 'x' }, [CLAUDE]), undefined);
  const lourdSeul: MoteurCatalogue = { ...CLAUDE, models: [modele('claude-opus-5', 'heavy')] };
  assert.equal(runDeFusionLegere({ engine: 'claude', model: 'claude-opus-5' }, [lourdSeul]), undefined);
  assert.equal(runDeFusionLegere({ engine: 'claude', model: 'claude-haiku-4-5' }, [CLAUDE]), undefined);
});

test('deux passes quand il y a de quoi alléger, la légère D’ABORD', () => {
  const passes = passesDeResolution({ engine: 'claude', model: 'claude-opus-5', thinking: 'high' }, [CLAUDE]);
  assert.deepEqual(
    passes.map((p) => p.nom),
    ['legere', 'carte'],
  );
  assert.equal(passes[0].run?.model, 'claude-haiku-4-5');
  assert.equal(passes[1].run?.model, 'claude-opus-5');
});

test('une seule passe quand il n’y a rien à alléger : jamais deux fois le même modèle', () => {
  const passes = passesDeResolution({ engine: 'claude', model: 'claude-haiku-4-5' }, [CLAUDE]);
  assert.deepEqual(
    passes.map((p) => p.nom),
    ['carte'],
  );
});

/* 2. L'ordre de fusion ------------------------------------------------ */

test('les branches sans heurt passent devant, chacune gardant sa place', () => {
  const lot = [
    { cardId: 'a', heurte: true },
    { cardId: 'b', heurte: false },
    { cardId: 'c', heurte: true },
    { cardId: 'd', heurte: false },
  ];
  assert.deepEqual(
    ordreDeFusion(lot).map((b) => b.cardId),
    ['b', 'd', 'a', 'c'],
  );
});

test('sans prévision de heurt, l’ordre d’origine ne bouge pas', () => {
  const lot = [
    { cardId: 'a', heurte: false },
    { cardId: 'b', heurte: false },
  ];
  assert.deepEqual(
    ordreDeFusion(lot).map((b) => b.cardId),
    ['a', 'b'],
  );
  assert.equal(mentionDeLOrdre(0, 2), null);
  // Tout se heurte : réordonner n'apprend rien, on ne dit rien.
  assert.equal(mentionDeLOrdre(2, 2), null);
  assert.match(mentionDeLOrdre(1, 3) ?? '', /2 branche\(s\) sans heurt/);
});

/* 3. Le détail d'une étape -------------------------------------------- */

test('le détail s’ajoute, sans recopier ce qui y est déjà', () => {
  assert.equal(detailDeLEtape('', 'a'), 'a');
  assert.equal(detailDeLEtape('a', 'b'), 'a\nb');
  assert.equal(detailDeLEtape('a\nb', ''), 'a\nb');
});

test('un détail trop long garde ses DEUX bouts et dit ce qui manque', () => {
  const tete = 'PREMIÈRE BRANCHE';
  const queue = 'DERNIÈRE BRANCHE';
  const long = `${tete}${'x'.repeat(DETAIL_ETAPE_MAX * 2)}${queue}`;
  const rendu = detailDeLEtape('', long);
  assert.ok(rendu.length <= DETAIL_ETAPE_MAX);
  assert.ok(rendu.startsWith(tete), 'la tête du détail est perdue');
  assert.ok(rendu.endsWith(queue), 'la fin du détail est perdue');
  assert.match(rendu, /milieu a été retiré/);
});

test('seule la SUITE part au détail : c’est ce qui recopiait le journal', () => {
  const lignes = ['un', 'deux', 'trois'];
  assert.equal(lignesNouvelles(lignes, 0), 'un\ndeux\ntrois');
  assert.equal(lignesNouvelles(lignes, 2), 'trois');
  assert.equal(lignesNouvelles(lignes, 3), '');
});

/* 4. Prévenir avant de lancer un gros lot ------------------------------ */

test('l’annonce ne paraît que si elle apprend quelque chose', () => {
  assert.equal(annonceDeHeurts(0, 10), null);
  assert.equal(annonceDeHeurts(1, 1), null);
  assert.match(annonceDeHeurts(3, 10) ?? '', /3 tâches sur 10 se heurtent/);
  assert.match(annonceDeHeurts(1, 4) ?? '', /1 tâche sur 4 se heurte/);
});

test('publier en deux fois ne garde que les tâches qui ne heurtent rien', () => {
  const lot = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual([...selectionSansHeurts(lot, ['b'])], ['a', 'c']);
  assert.deepEqual([...selectionSansHeurts(lot, [])], ['a', 'b', 'c']);
  assert.equal(selectionSansHeurts(lot, ['a', 'b', 'c']).size, 0);
});

/* 5. Les heurts de DOCUMENTATION se recollent sans moteur -------------- */

test('la liste des documents recollables est FERMÉE : jamais du code', () => {
  assert.ok(documentRecollable('CLAUDE.md'));
  assert.ok(documentRecollable('MEMOIRE.md'));
  assert.ok(documentRecollable('docs/memoire/quotas.md'));
  assert.ok(documentRecollable('docs/regles/publication.md'));
  assert.ok(documentRecollable('./docs/instructions-en-attente.md'));
  // Du code, un réglage, une prose dont l'ordre a un sens : l'agent tranche.
  assert.equal(documentRecollable('server/src/ws.ts'), false);
  assert.equal(documentRecollable('web/src/styles.css'), false);
  assert.equal(documentRecollable('README.md'), false);
  assert.equal(documentRecollable('docs/plans/plan.md'), false);
  assert.equal(documentRecollable('package.json'), false);
});

test('un conflit MIXTE (documentation + code) part chez l’agent, entier', () => {
  assert.equal(conflitPurementDocumentaire(['CLAUDE.md', 'MEMOIRE.md']), true);
  assert.equal(conflitPurementDocumentaire(['CLAUDE.md', 'server/src/ws.ts']), false);
  assert.equal(conflitPurementDocumentaire([]), false);
});

test('recoller garde les DEUX intentions, celle d’accueil d’abord', () => {
  const texte = [
    '# Sommaire',
    '<<<<<<< HEAD',
    '- carte A',
    '=======',
    '- carte B',
    '>>>>>>> tache/b',
    'fin',
  ].join('\n');
  assert.equal(recollerLesDeuxIntentions(texte), '# Sommaire\n- carte A\n- carte B\nfin');
});

test('une ligne écrite des DEUX côtés n’apparaît pas deux fois', () => {
  const texte = ['<<<<<<< HEAD', '- commun', '- carte A', '=======', '- commun', '- carte B', '>>>>>>> tache/b'].join(
    '\n',
  );
  assert.equal(recollerLesDeuxIntentions(texte), '- commun\n- carte A\n- carte B');
});

test('le style « diff3 » : l’ancêtre commun est jeté, il n’est l’intention de personne', () => {
  const texte = [
    '<<<<<<< HEAD',
    '- carte A',
    '||||||| base',
    '- ancien',
    '=======',
    '- carte B',
    '>>>>>>> tache/b',
  ].join('\n');
  assert.equal(recollerLesDeuxIntentions(texte), '- carte A\n- carte B');
});

test('plusieurs blocs dans le même fichier se recollent tous', () => {
  const texte = [
    '<<<<<<< HEAD',
    'a1',
    '=======',
    'b1',
    '>>>>>>> t',
    'milieu',
    '<<<<<<< HEAD',
    'a2',
    '=======',
    'b2',
    '>>>>>>> t',
  ].join('\n');
  assert.equal(recollerLesDeuxIntentions(texte), 'a1\nb1\nmilieu\na2\nb2');
});

test('on ne bricole JAMAIS un texte qu’on ne comprend pas', () => {
  // Rien à recoller : aucun marqueur.
  assert.equal(recollerLesDeuxIntentions('# Sommaire\n- carte A'), null);
  // Un marqueur ouvert et jamais refermé.
  assert.equal(recollerLesDeuxIntentions('<<<<<<< HEAD\n- carte A\n=======\n- carte B'), null);
  // Un conflit dans un conflit.
  assert.equal(
    recollerLesDeuxIntentions('<<<<<<< HEAD\na\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> t\n=======\nd\n>>>>>>> t'),
    null,
  );
  // Une fin sans début.
  assert.equal(recollerLesDeuxIntentions('- carte A\n>>>>>>> tache/b'), null);
});

test('le recollage se DIT au fil, et il dit qu’aucun agent n’a été appelé', () => {
  assert.match(mentionDuRecollage(['CLAUDE.md']), /CLAUDE\.md/);
  assert.match(mentionDuRecollage(['CLAUDE.md']), /sans agent/);
  assert.match(mentionDuRecollage(['CLAUDE.md', 'MEMOIRE.md']), /2 fichiers de documentation/);
});

/* 6. Où en est chaque tâche du lot ------------------------------------- */

const LOT: TacheDuLot[] = [
  { cardId: 'a', titre: 'Carte A', etat: 'fusionnee' },
  { cardId: 'b', titre: 'Carte B', etat: 'conflit' },
  { cardId: 'c', titre: 'Carte C', etat: 'attente' },
  { cardId: 'd', titre: 'Carte D', etat: 'ecartee' },
];

test('chaque état a son libellé en français simple, et sa nature', () => {
  for (const etat of Object.keys(LIBELLE_ETAT_TACHE) as (keyof typeof LIBELLE_ETAT_TACHE)[]) {
    assert.ok(LIBELLE_ETAT_TACHE[etat].length > 2, `l’état ${etat} n’a pas de libellé`);
  }
  assert.equal(natureDeLEtat('attente'), 'attente');
  assert.equal(natureDeLEtat('conflit'), 'encours');
  assert.equal(natureDeLEtat('fusion'), 'encours');
  assert.equal(natureDeLEtat('recollee'), 'fait');
  assert.equal(natureDeLEtat('en-ligne'), 'fait');
  assert.equal(natureDeLEtat('ecartee'), 'ecart');
  assert.equal(natureDeLEtat('absente'), 'ecart');
});

test('le résumé du lot compte ce que la liste montre', () => {
  assert.equal(resumeDuLot(LOT), '1 passée · 1 en cours · 1 en attente · 1 écartée');
  // Un lot d'une tâche se lit tout seul dans la liste juste dessous.
  assert.equal(resumeDuLot([LOT[0]]), '');
});

test('poser un état ne touche QUE sa tâche', () => {
  const apres = avecEtatDeTache(LOT, 'c', 'fusionnee');
  assert.equal(apres[2].etat, 'fusionnee');
  assert.equal(apres[0].etat, 'fusionnee');
  assert.equal(apres[1].etat, 'conflit');
  // Une carte inconnue ne casse rien : la fusion ne s'arrête pas pour ça.
  assert.deepEqual(avecEtatDeTache(LOT, 'inconnue', 'fusionnee'), LOT);
});

test('la mise en ligne ne ment pas sur ce qui a été écarté', () => {
  const apres = lotMisEnLigne(LOT);
  assert.equal(apres[0].etat, 'en-ligne');
  assert.equal(apres[1].etat, 'en-ligne');
  assert.equal(apres[2].etat, 'en-ligne');
  assert.equal(apres[3].etat, 'ecartee', 'une carte écartée est restée dans « À déployer »');
});
