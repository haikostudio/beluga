import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AgentQuestion,
  Card,
  ECART_DE_SAILLANCE,
  PROPOSITIONS_PAR_CARTE_MAX,
  Project,
  RANG_MELE_MAX,
  RANG_MELE_MAX_BIBLIOTHEQUE,
  REPONSE_PAS_UTILE,
  REPONSE_UTILISER,
  competencesValidees,
  correspondanceDeLaCompetence,
  etatApresReponse,
  ficheProposableAuCadrage,
  questionDeCompetence,
  retenirLesPropositions,
  texteDIssueDesPropositions,
  texteDesCompetencesValidees,
  titreLisibleDeCompetence,
} from '@beluga/shared';

/**
 * LES COMPÉTENCES PROPOSÉES PAR BELUGA AU CADRAGE.
 *
 * Verrouillé ici, côté règles : on ne propose que ce qui SE DÉTACHE de la foule
 * des fiches et que les deux recherches classent en tête, trois au plus, jamais
 * deux fois la même fiche sur une carte. Côté démon : les fiches trouvées sont
 * RETENUES d'office et la recherche de mémoire répond AUSSITÔT (aucune
 * attente) ; une croix en écarte une tant que la carte n'est pas lancée ;
 * seules les compétences retenues partent, en entier, au lancement ; un
 * cadrage sans personne devant l'écran ne pose rien ; le mode d'emploi ne se
 * lit que par un nom du pool.
 */

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'proposition-competences-'));
const POOL = path.join(RACINE, 'competences');
fs.mkdirSync(POOL, { recursive: true });
process.env.BELUGA_COMPETENCES = POOL;
process.env.BELUGA_DATA = path.join(RACINE, 'donnees');

function poserCompetence(nom: string, corps: string): string {
  const dossier = path.join(POOL, nom);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, 'SKILL.md');
  fs.writeFileSync(
    fichier,
    `---\nname: ${nom}\ndescription: La fiche ${nom}. À utiliser dès qu'on touche à ${nom}.\nthemes: essai\n---\n\n# ${nom}\n\n${corps}\n\n## Vérification\n\nOn relance.\n`,
    'utf8',
  );
  return fichier;
}
const FICHIER_CLAVIER = poserCompetence('clavier-ios', 'ÉTAPE SECRÈTE DU CLAVIER : fermer à l’appui hors champ.');
poserCompetence('bandeau-version', 'ÉTAPE SECRÈTE DU BANDEAU : comparer la version chargée.');
poserCompetence('arbre-de-liste', 'ÉTAPE SECRÈTE DE L’ARBRE.');

const store = await import('../store.js');
const { agentEnAttente } = await import('../attente-question.js');
const propositions = await import('../proposition-competences.js');
const { getDb } = await import('../db.js');

/* ------------------------------------------------------------------ */
/* Les règles                                                           */
/* ------------------------------------------------------------------ */

/** Une foule de fiches qui se suivent de près, sous les candidates données. */
function foule(tetes: { nom: string; proximite: number; rang: number; bibliotheque?: boolean }[]) {
  const reste = Array.from({ length: 12 }, (_, i) => ({ nom: `foule-${i}`, proximite: 0.84 - i * 0.002, rang: 10 + i }));
  return [...tetes, ...reste];
}

test('une fiche pstack n’est jamais proposée au cadrage : c’est l’agent d’exécution qui juge', () => {
  assert.equal(ficheProposableAuCadrage({ bibliotheque: 'pstack' }), false);
  assert.equal(ficheProposableAuCadrage({ provenance: { bibliotheque: 'pstack' } }), false);
  assert.equal(ficheProposableAuCadrage({ bibliotheque: 'mattpocock-tdd' }), true);
  assert.equal(ficheProposableAuCadrage({}), true);
});

test('une fiche qui se détache de la foule est proposée, seule', () => {
  const gardees = retenirLesPropositions(foule([{ nom: 'clavier-ios', proximite: 0.871, rang: 0 }]), []);
  assert.deepEqual(gardees.map((g) => g.nom), ['clavier-ios']);
});

test('deux fiches au-dessus de la marche partent ensemble', () => {
  const gardees = retenirLesPropositions(
    foule([
      { nom: 'arbre-a', proximite: 0.869, rang: 0 },
      { nom: 'arbre-b', proximite: 0.858, rang: 1 },
    ]),
    [],
  );
  assert.deepEqual(gardees.map((g) => g.nom), ['arbre-a', 'arbre-b']);
});

test('sans marche, rien n’est proposé — même si la première est « la meilleure »', () => {
  const serrees = foule([
    { nom: 'a', proximite: 0.869, rang: 0 },
    { nom: 'b', proximite: 0.866, rang: 1 },
    { nom: 'c', proximite: 0.861, rang: 2 },
    { nom: 'd', proximite: 0.859, rang: 3 },
  ]);
  assert.ok(0.866 - 0.861 < ECART_DE_SAILLANCE && 0.861 - 0.859 < ECART_DE_SAILLANCE);
  assert.deepEqual(retenirLesPropositions(serrees, []), []);
});

test('les deux recherches doivent être d’accord : saillante par le sens mais mal classée par les mots, écartée', () => {
  const gardees = retenirLesPropositions(foule([{ nom: 'hors-sujet', proximite: 0.88, rang: 9 }]), []);
  assert.deepEqual(gardees, []);
  const absente = retenirLesPropositions(foule([{ nom: 'absente', proximite: 0.88, rang: Number.POSITIVE_INFINITY }]), []);
  assert.deepEqual(absente, []);
});

test('une fiche de bibliothèque saillante par le sens n’est pas écartée par le seul handicap de sa P3 dans la mêlée', () => {
  // Huitième compétence de la mêlée : une fiche maison serait écartée, une fiche de bibliothèque passe.
  const maison = retenirLesPropositions(foule([{ nom: 'devis-maison', proximite: 0.884, rang: 7 }]), []);
  assert.deepEqual(maison, []);
  const bib = retenirLesPropositions(foule([{ nom: 'devis-brain', proximite: 0.884, rang: 7, bibliotheque: true }]), []);
  assert.deepEqual(bib.map((g) => g.nom), ['devis-brain']);
  // …mais il faut toujours les deux signaux : absente de la mêlée, ou sans marche, rien.
  assert.equal(RANG_MELE_MAX_BIBLIOTHEQUE > RANG_MELE_MAX, true);
  assert.deepEqual(retenirLesPropositions(foule([{ nom: 'loin', proximite: 0.884, rang: RANG_MELE_MAX_BIBLIOTHEQUE, bibliotheque: true }]), []), []);
  assert.deepEqual(retenirLesPropositions(foule([{ nom: 'absente', proximite: 0.884, rang: Number.POSITIVE_INFINITY, bibliotheque: true }]), []), []);
  assert.deepEqual(retenirLesPropositions(foule([{ nom: 'collee', proximite: 0.842, rang: 0, bibliotheque: true }]), []), []);
});

test('jamais plus de trois, jamais deux fois la même fiche, jamais plus de six sur une carte', () => {
  const quatre = foule([
    { nom: 'a', proximite: 0.9, rang: 0 },
    { nom: 'b', proximite: 0.899, rang: 1 },
    { nom: 'c', proximite: 0.898, rang: 2 },
    { nom: 'd', proximite: 0.897, rang: 3 },
  ]);
  // La marche est après la quatrième : au-delà des trois premières places, on ne la cherche pas.
  assert.deepEqual(retenirLesPropositions(quatre, []), []);

  const trois = foule([
    { nom: 'a', proximite: 0.9, rang: 0 },
    { nom: 'b', proximite: 0.899, rang: 1 },
    { nom: 'c', proximite: 0.898, rang: 2 },
  ]);
  assert.deepEqual(retenirLesPropositions(trois, []).map((g) => g.nom), ['a', 'b', 'c']);
  // Déjà proposée (quelle qu'ait été la réponse) : jamais reproposée.
  assert.deepEqual(retenirLesPropositions(trois, ['b']).map((g) => g.nom), ['a', 'c']);
  // Le plafond de la carte.
  const cinq = ['v', 'w', 'x', 'y', 'z'];
  assert.equal(PROPOSITIONS_PAR_CARTE_MAX, 6);
  assert.deepEqual(retenirLesPropositions(trois, cinq).map((g) => g.nom), ['a']);
  assert.deepEqual(retenirLesPropositions(trois, [...cinq, 'u']), []);
});

test('une foule trop petite ne dit rien', () => {
  const petite = [
    { nom: 'a', proximite: 0.9, rang: 0 },
    { nom: 'b', proximite: 0.8, rang: 1 },
  ];
  assert.deepEqual(retenirLesPropositions(petite, []), []);
});

test('l’encadré : un titre lisible, ce qui correspond, deux choix et aucun texte libre', () => {
  assert.equal(titreLisibleDeCompetence('clavier-ios-capacitor'), 'Clavier ios capacitor');
  const longue = `${'À utiliser dès qu’un formulaire reste coincé. '.repeat(20)}`;
  assert.ok(correspondanceDeLaCompetence(longue).length <= 321);
  assert.equal(correspondanceDeLaCompetence('  Courte   description. '), 'Courte description.');

  const q = AgentQuestion.parse(
    questionDeCompetence('q1', { nom: 'clavier-ios', titre: 'Clavier ios', correspondance: 'Quand le clavier reste ouvert.' }),
  );
  assert.equal(q.question, 'Utiliser la compétence « Clavier ios » ?');
  assert.equal(q.description, 'Quand le clavier reste ouvert.');
  assert.deepEqual(q.options.map((o) => o.label), [REPONSE_UTILISER, REPONSE_PAS_UTILE]);
  assert.equal(q.allowFreeText, false);
  assert.deepEqual(q.competence, { nom: 'clavier-ios', titre: 'Clavier ios' });

  assert.equal(etatApresReponse(REPONSE_UTILISER), 'utilisee');
  assert.equal(etatApresReponse(REPONSE_PAS_UTILE), 'ecartee');
  assert.equal(etatApresReponse(undefined), 'ecartee');
});

test('ce que la recherche rend à l’agent : sa mémoire, puis les décisions', () => {
  const texte = texteDIssueDesPropositions('RÉSULTAT DE MÉMOIRE', [
    { nom: 'clavier-ios', etat: 'utilisee', chemin: '/pool/clavier-ios/SKILL.md' },
    { nom: 'bandeau-version', etat: 'ecartee' },
  ]);
  assert.ok(texte.startsWith('RÉSULTAT DE MÉMOIRE'));
  assert.match(texte, /VALIDÉES[^\n]*\n- clavier-ios — \/pool\/clavier-ios\/SKILL\.md/);
  assert.match(texte, /ÉCARTÉES[^\n]*\n- bandeau-version/);
  assert.match(texte, /ne lui repose pas la question/);
  assert.match(texteDIssueDesPropositions('M', [{ nom: 'x', etat: 'proposee' }], { interrompue: true }), /son message t’arrive à la suite/);
});

test('le briefing porte le mode d’emploi ENTIER, borné fiche par fiche', () => {
  assert.equal(texteDesCompetencesValidees([]), '');
  const bloc = texteDesCompetencesValidees([{ nom: 'clavier-ios', chemin: '/p/SKILL.md', texte: 'TOUT LE MODE D’EMPLOI' }]);
  assert.match(bloc, /COMPÉTENCES VALIDÉES PAR L'UTILISATEUR AU CADRAGE \(1\)/);
  assert.match(bloc, /### clavier-ios\nFichier : \/p\/SKILL\.md\n\nTOUT LE MODE D’EMPLOI/);
  const enorme = texteDesCompetencesValidees([{ nom: 'g', chemin: '/g', texte: 'x'.repeat(40_000) }]);
  assert.ok(enorme.length < 16_000);
  assert.match(enorme, /la suite est dans le fichier/);
});

/* ------------------------------------------------------------------ */
/* Le va-et-vient                                                       */
/* ------------------------------------------------------------------ */

const projet = store.saveProject(
  Project.parse({ id: 'p-comp', name: 'Projet Compétences', path: RACINE, createdAt: Date.now(), updatedAt: Date.now() }),
);

let numero = 0;
/** Une carte, son agent de cadrage, et le message de son tour vivant. */
function decor() {
  numero += 1;
  const carte = store.saveCard(
    Card.parse({
      id: `carte-${numero}`,
      projectId: projet.id,
      title: 'Le clavier reste ouvert',
      description: 'Sur iPhone, impossible de quitter le champ.',
      column: 'planned',
      position: numero,
      run: { engine: 'claude' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const agent = store.saveAgent({
    id: store.newId(),
    projectId: projet.id,
    cardId: carte.id,
    role: 'cadrage',
    title: 'cadrage',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  const message = store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
  } as any);
  return { carte, agent, message };
}

const trouve = (...noms: string[]) => async () =>
  noms.map((nom) => ({
    nom,
    titre: titreLisibleDeCompetence(nom),
    correspondance: `Ce que ${nom} apporte.`,
    chemin: path.join(POOL, nom, 'SKILL.md'),
    score: 0.87,
  }));

/** Ce que fait `/internal/call` : les lignes s'attachent au message du tour. */
function poser(messageId: string, retenues: { questions: AgentQuestion[] }) {
  const message = store.getMessage(messageId)!;
  store.saveMessage({ ...message, questions: [...message.questions, ...retenues.questions] });
}

test('les compétences trouvées sont RETENUES d’office, et la recherche répond aussitôt', async () => {
  propositions.oublierToutesLesSeries();
  const { carte, agent, message } = decor();
  const retenues = await propositions.proposerAuCadrage({
    agent,
    tour: { messageId: message.id },
    mots: 'clavier iphone',
    texteMemoire: 'RÉSULTAT DE MÉMOIRE',
    chercher: trouve('clavier-ios', 'bandeau-version'),
  });
  assert.ok(retenues);
  assert.equal(retenues!.questions.length, 2);
  // Les lignes naissent répondues « Utiliser » : aucune décision en attente.
  assert.ok(retenues!.questions.every((q) => q.competence && q.answer === REPONSE_UTILISER));
  poser(message.id, retenues!);
  assert.equal(agentEnAttente(agent.id), false, 'le cadrage n’est pas arrêté');

  // La recherche rend sa mémoire, puis la liste des compétences retenues.
  assert.ok(retenues!.texte.startsWith('RÉSULTAT DE MÉMOIRE'));
  assert.ok(retenues!.texte.includes(`- clavier-ios — ${FICHIER_CLAVIER}`), retenues!.texte);
  assert.match(retenues!.texte, /VALIDÉES[^\n]*\n- clavier-ios/);

  const proposees = store.getCard(carte.id)!.parcours!.competencesProposees!;
  assert.deepEqual(proposees.map((p) => [p.nom, p.etat]), [['clavier-ios', 'utilisee'], ['bandeau-version', 'utilisee']]);

  // La croix écarte la seconde, tant que la carte est en cadrage.
  assert.deepEqual(propositions.ecarterLaCompetence({ messageId: message.id, questionId: retenues!.questions[1]!.id }), { ok: true });
  assert.deepEqual(propositions.ecarterLaCompetence({ messageId: message.id, questionId: retenues!.questions[1]!.id }), { already: true });
  const ligne = store.getMessage(message.id)!.questions.find((q) => q.id === retenues!.questions[1]!.id)!;
  assert.equal(ligne.answer, REPONSE_PAS_UTILE);

  const apres = store.getCard(carte.id)!.parcours!.competencesProposees!;
  assert.deepEqual(apres.map((p) => [p.nom, p.etat]), [['clavier-ios', 'utilisee'], ['bandeau-version', 'ecartee']]);
  assert.deepEqual(competencesValidees(apres).map((p) => p.nom), ['clavier-ios']);

  // Les compteurs disent ce qui s'est passé : proposées toutes deux, une écartée.
  const stats = getDb().prepare('SELECT nom, proposee, acceptee, refusee FROM competence_stats ORDER BY nom').all() as any[];
  assert.deepEqual(
    stats.map((s) => [s.nom, s.proposee, s.acceptee, s.refusee]),
    [['bandeau-version', 1, 0, 1], ['clavier-ios', 1, 0, 0]],
  );
});

test('seules les compétences validées partent, en entier, avec l’agent d’exécution', () => {
  const carte = store.getCard('carte-1')!;
  const bloc = propositions.briefingDesCompetencesValidees(carte);
  assert.match(bloc, /ÉTAPE SECRÈTE DU CLAVIER/);
  assert.ok(bloc.includes(`Fichier : ${FICHIER_CLAVIER}`));
  assert.doesNotMatch(bloc, /ÉTAPE SECRÈTE DU BANDEAU/, 'la compétence écartée ne part pas');
  // Remise à l'agent : elle compte comme servie.
  const servie = getDb().prepare("SELECT servie FROM competence_stats WHERE nom = 'clavier-ios'").get() as any;
  assert.equal(servie.servie, 1);
  // Une carte sans compétence validée n'ajoute rien au briefing.
  assert.equal(propositions.briefingDesCompetencesValidees({ parcours: undefined } as any), '');
});

test('une fiche déjà proposée n’est jamais reproposée, et une seule recherche par tour', async () => {
  propositions.oublierToutesLesSeries();
  const { carte, agent, message } = decor();
  let appels = 0;
  let dejaVues: readonly string[] = [];
  const chercher = async (_d: string, _p: unknown, _c: string, deja: readonly string[]) => {
    appels += 1;
    dejaVues = deja;
    return deja.includes('arbre-de-liste') ? [] : await trouve('arbre-de-liste')();
  };
  const premiere = await propositions.proposerAuCadrage({ agent, tour: { messageId: message.id }, mots: 'm', texteMemoire: 'M', chercher });
  assert.ok(premiere);
  poser(message.id, premiere!);

  // Même tour : on ne cherche pas une seconde fois.
  assert.equal(await propositions.proposerAuCadrage({ agent, tour: { messageId: message.id }, mots: 'm', texteMemoire: 'M', chercher }), null);
  assert.equal(appels, 1);

  // Tour suivant : la recherche reçoit ce qui a déjà été proposé sur la carte.
  const suivant = store.saveMessage({ id: store.newId(), agentId: agent.id, role: 'assistant', content: '', createdAt: Date.now() } as any);
  assert.equal(await propositions.proposerAuCadrage({ agent, tour: { messageId: suivant.id }, mots: 'm', texteMemoire: 'M', chercher }), null);
  assert.equal(appels, 2);
  assert.deepEqual(dejaVues, ['arbre-de-liste']);
  assert.equal(store.getCard(carte.id)!.parcours!.competencesProposees!.length, 1);
});

test('personne devant l’écran, ou pas un cadrage : aucun encadré, aucune recherche', async () => {
  propositions.oublierToutesLesSeries();
  const { agent, message } = decor();
  let appels = 0;
  const chercher = async () => {
    appels += 1;
    return trouve('clavier-ios')();
  };
  // Cadrage de nuit : les questions sont interdites.
  assert.equal(
    await propositions.proposerAuCadrage({ agent, tour: { messageId: message.id, questionsInterdites: true }, mots: 'm', texteMemoire: 'M', chercher }),
    null,
  );
  // Aucun tour vivant.
  assert.equal(await propositions.proposerAuCadrage({ agent, tour: undefined, mots: 'm', texteMemoire: 'M', chercher }), null);
  // Un agent d'exécution.
  assert.equal(
    await propositions.proposerAuCadrage({ agent: { ...agent, role: 'task' }, tour: { messageId: message.id }, mots: 'm', texteMemoire: 'M', chercher }),
    null,
  );
  assert.equal(appels, 0);
});

test('une recherche qui échoue ne propose rien et ne bloque rien', async () => {
  propositions.oublierToutesLesSeries();
  const { carte, agent, message } = decor();
  const serie = await propositions.proposerAuCadrage({
    agent,
    tour: { messageId: message.id },
    mots: 'm',
    texteMemoire: 'M',
    chercher: async () => [],
  });
  assert.equal(serie, null);
  assert.equal(agentEnAttente(agent.id), false);
  assert.equal(store.getCard(carte.id)!.parcours?.competencesProposees, undefined);
});

test('une carte lancée garde ses compétences : la croix est refusée par le démon', async () => {
  propositions.oublierToutesLesSeries();
  const { carte, agent, message } = decor();
  const retenues = await propositions.proposerAuCadrage({
    agent,
    tour: { messageId: message.id },
    mots: 'm',
    texteMemoire: 'M',
    chercher: trouve('arbre-de-liste'),
  });
  poser(message.id, retenues!);
  store.saveCard({ ...store.getCard(carte.id)!, column: 'running' });
  assert.throws(
    () => propositions.ecarterLaCompetence({ messageId: message.id, questionId: retenues!.questions[0]!.id }),
    /la carte est lancée/,
  );
  assert.equal(store.getCard(carte.id)!.parcours!.competencesProposees![0]!.etat, 'utilisee');
  assert.match(propositions.briefingDesCompetencesValidees(store.getCard(carte.id)!), /ÉTAPE SECRÈTE DE L’ARBRE/);
});

test('un ancien encadré resté ouvert se tranche encore sur la carte', () => {
  const { carte, agent, message } = decor();
  const question = questionDeCompetence(store.newId(), { nom: 'bandeau-version', titre: 'Bandeau version', correspondance: 'c' }) as AgentQuestion;
  store.saveMessage({ ...store.getMessage(message.id)!, questions: [question] });
  store.saveCard({
    ...store.getCard(carte.id)!,
    parcours: {
      plans: [],
      competencesProposees: [
        { nom: 'bandeau-version', titre: 'Bandeau version', correspondance: 'c', questionId: question.id, agentId: agent.id, etat: 'proposee', proposeeLe: Date.now() },
      ],
    },
  } as any);
  assert.equal(propositions.trancherLaCompetence({ agentId: agent.id, questionId: question.id, reponse: REPONSE_UTILISER }), true);
  assert.equal(store.getCard(carte.id)!.parcours!.competencesProposees![0]!.etat, 'utilisee');
});

test('le mode d’emploi ne se lit que par un nom du pool, sans son frontmatter', () => {
  const fiche = propositions.lireLaCompetence('clavier-ios');
  assert.equal(fiche.nom, 'clavier-ios');
  assert.match(fiche.corps, /ÉTAPE SECRÈTE DU CLAVIER/);
  assert.doesNotMatch(fiche.corps, /^---/);
  assert.throws(() => propositions.lireLaCompetence('../../etc/passwd'), /introuvable/);
  assert.throws(() => propositions.lireLaCompetence(''), /introuvable/);
});
