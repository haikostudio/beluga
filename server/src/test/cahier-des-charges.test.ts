import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  Card,
  DOCUMENT_DU_CAHIER,
  Project,
  cadrageJamaisParti,
  cahierNeuf,
  cheminDuCahier,
  caseCahierCocheeParDefaut,
  CAHIER_OBLIGATOIRE_POUR_UN_PROJET_NEUF,
  refusDeFinDuCahier,
  consigneDuCahier,
  barreDuCahier,
  demandeDeLaCarteDeSuite,
  demandeDeRepriseDuCahier,
  demandeDuPremierTour,
  estVoletDuCahier,
  etapeCouranteDuCahier,
  htmlDuCahier,
  nomDuCahierExporte,
  titreDeLaCarteDeSuite,
  etatDuCahier,
  lireAvancement,
  lireGesteProjet,
  partiesDuCahier,
  pausePossible,
  reprisePossible,
} from '@beluga/shared';

/*
 * LE CAHIER DES CHARGES D'UN NOUVEAU PROJET (décision du 08.10.2026) : une case
 * au montage, une carte dont l'agent pose les questions une à une, le document
 * réécrit après chaque réponse, une pause qui coupe l'agent et une reprise
 * exacte. La règle pure d'abord, puis sur une vraie base jetable.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'cahier-des-charges-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard, callTool, toolsFor, outilServiA } = await import('../tools.js');
const {
  estAgentDuCahier,
  consigneSystemeDuCahier,
  mettreEnPause,
  leverLaPauseSurMessage,
  lireLeDocument,
  completerLesDemandesDesSuites,
} = await import('../cahier-des-charges.js');
const { entreesDuJournal } = await import('../journal-carte.js');

/** Les jalons « Demande » du journal d'une carte. */
function demandesDuJournal(cardId: string) {
  return entreesDuJournal(cardId).filter((e) => e.nature === 'jalon' && e.libelle === 'Demande');
}

/* ------------------------------------------------------------------ */
/* LA RÈGLE PURE                                                       */
/* ------------------------------------------------------------------ */

test('la case est cochée d’office pour un projet vide, décochée pour un dépôt importé', () => {
  assert.equal(caseCahierCocheeParDefaut('vide'), true);
  assert.equal(caseCahierCocheeParDefaut('github'), false);
});

test('la création par outil démarre TOUJOURS par un cahier des charges, même sur un refus (18/11/2026)', () => {
  const base = { geste: 'creer', nom: 'Neuf', sansAdresse: true };
  const parDefaut = lireGesteProjet(base);
  assert.ok(parDefaut.ok && parDefaut.demande.geste === 'creer' && parDefaut.demande.cahierDesCharges === true);
  const refuse = lireGesteProjet({ ...base, cahierDesCharges: false });
  assert.ok(refuse.ok && refuse.demande.geste === 'creer' && refuse.demande.cahierDesCharges === true, 'le refus est ignoré : le cahier est obligatoire');
  assert.equal(CAHIER_OBLIGATOIRE_POUR_UN_PROJET_NEUF, true);
});

test('le premier tour pose TOUJOURS le type de produit en première question, description ou pas', () => {
  for (const description of [undefined, 'Une boutique de vêtements pour enfants']) {
    const tour = demandeDuPremierTour({ name: 'Neuf', description });
    assert.match(tour, /LA PREMIÈRE QUESTION, TOUJOURS LA MÊME : « Quel type de produit voulez-vous créer \? »/);
    assert.match(tour, /Jamais sautée/);
    assert.doesNotMatch(tour, /a demandé à démarrer par un cahier des charges/);
  }
  const consigne = consigneDuCahier('/c/SKILL.md', '/p');
  assert.match(consigne, /LA TOUTE PREMIÈRE QUESTION EST LE TYPE DE PRODUIT/);
  assert.match(consigne, /Approfondissement du produit/);
  assert.match(consigne, /questions-par-type\.md/);
  assert.doesNotMatch(consigneDuCahier('/c/SKILL.md', '/p', true), /LA TOUTE PREMIÈRE QUESTION EST LE TYPE DE PRODUIT/, 'le clonage garde son parcours');
});

test('un cahier ne se termine que complet : rien « à voir », et les spécificités de chaque type écrites', () => {
  const complet = '# Cahier\n\n## Vision\nRéserver.\n\n## Spécificités par type\n### Boutique\nPaiement par carte.';
  assert.equal(refusDeFinDuCahier(complet, false), null);
  assert.match(refusDeFinDuCahier('# Cahier\n\n## Vision\nRéserver.', false) ?? '', /Spécificités par type/);
  assert.match(refusDeFinDuCahier(`${complet}\n\n## Hébergement\nà voir`, false) ?? '', /Hébergement/);
  assert.equal(refusDeFinDuCahier('# Cahier\n\n## Source\nAnalysée.', true), null, 'un clonage n’a pas cette partie');
});

test('l’avancement se lit, se borne, et lève la pause', () => {
  const avant = { ...cahierNeuf(), enPauseA: 1 };
  const lu = lireAvancement({ faites: 12, total: 30, phase: 'mecanismes', restants: ['Paiement', ' ', 'Langues'] }, avant, 5);
  assert.ok(lu.ok);
  if (!lu.ok) return;
  assert.equal(lu.cahier.faites, 12);
  assert.equal(lu.cahier.total, 30);
  assert.equal(lu.cahier.phase, 'mecanismes');
  assert.deepEqual(lu.cahier.restants, ['Paiement', 'Langues']);
  assert.equal(lu.cahier.enPauseA, undefined);
  assert.equal(lu.cahier.majA, 5);
});

test('plus de questions faites que prévues relève le total, une phase inconnue est refusée', () => {
  const lu = lireAvancement({ faites: 8, total: 5, phase: 'vision' }, cahierNeuf(), 1);
  assert.ok(lu.ok && lu.cahier.total === 8);
  assert.equal(lireAvancement({ faites: 1, phase: 'dessert' }, cahierNeuf(), 1).ok, false);
});

test('« termine » vide les restants et date la fin', () => {
  const lu = lireAvancement({ faites: 30, total: 30, phase: 'relecture', restants: ['x'], termine: true }, cahierNeuf(), 9);
  assert.ok(lu.ok);
  if (!lu.ok) return;
  assert.deepEqual(lu.cahier.restants, []);
  assert.equal(lu.cahier.termineA, 9);
  assert.equal(etatDuCahier(lu.cahier), 'termine');
});


test('pause et reprise se répondent, et disent pourquoi elles sont éteintes', () => {
  const neuf = cahierNeuf();
  assert.equal(pausePossible(neuf).possible, true);
  assert.equal(reprisePossible(neuf).possible, false);
  const pause = { ...neuf, enPauseA: 1 };
  assert.equal(etatDuCahier(pause), 'en-pause');
  assert.equal(pausePossible(pause).possible, false);
  assert.ok(pausePossible(pause).raison);
  assert.equal(reprisePossible(pause).possible, true);
  assert.equal(pausePossible(undefined).possible, false);
  assert.equal(pausePossible({ ...neuf, termineA: 2 }).possible, false);
});

test('le document se découpe en parties, et « à voir » se repère', () => {
  const parties = partiesDuCahier(
    '# Cahier des charges\n\nChapeau.\n\n## Vision\nUne app de réservation.\n\n## Interfaces\nÀ voir.\n\n## Paiement\n',
  );
  assert.deepEqual(
    parties.map((p) => [p.titre, p.aVoir]),
    [
      ['', false],
      ['Vision', false],
      ['Interfaces', true],
      ['Paiement', true],
    ],
  );
});

test('les textes envoyés à l’agent portent le parcours, la reprise et la fin', () => {
  const consigne = consigneDuCahier('/comp/SKILL.md', '/root/neuf');
  assert.match(consigne, /\/comp\/SKILL\.md/);
  assert.match(consigne, /cahier_des_charges/);
  /* La fin ne rend plus ni compréhension ni plan : une carte de suite s'en charge. */
  assert.doesNotMatch(consigne, /« rendre_plan »|« rendre_comprehension »/);
  assert.match(consigne, /NI compréhension NI plan/);
  assert.match(consigne, /\/root\/neuf\/docs\/inspiration\//);
  assert.match(consigne, /## Inspiration/);
  assert.match(consigne, /UNE question par couche/);
  assert.match(consigne, /panneau de décision/i);
  /* La finition se demande (ambiance, animation, densité, thème), le socle ne se demande pas. */
  assert.match(consigne, /NIVEAU D'ANIMATION/);
  assert.match(consigne, /## Finition/);
  /* Les animations au défilement ont leur propre question, distincte du niveau d'animation. */
  assert.match(consigne, /ANIMATIONS AU DÉFILEMENT/);
  assert.match(consigne, /socle-de-finition\.md/);
  const suite = demandeDeLaCarteDeSuite({ name: 'Neuf' }, '/root/neuf', '/comp/SKILL.md');
  assert.match(suite, /\/root\/neuf\/docs\/cahier-des-charges\.md/);
  assert.match(suite, /\/root\/neuf\/docs\/inspiration\//);
  /* La carte de construction n'a plus ni compréhension ni plan : elle construit. */
  assert.doesNotMatch(suite, /rendre_comprehension|rendre_plan|ARRÊTE-TOI/);
  assert.match(suite, /Construis/);
  assert.match(suite, /creer-une-application-complete/);
  /* Le socle de finition est imposé, ses compétences citées, son contrôle exigé avant le rapport. */
  assert.match(suite, /\/comp\/socle-de-finition\.md/);
  assert.match(suite, /\/comp\/controle-finition\.mjs/);
  assert.match(suite, /liste-deroulante-avec-recherche/);
  assert.match(suite, /barre-de-defilement-fine-qui-parait-au-defilement/);
  /* Les compétences d'animation au défilement sont citées par nom, jamais recopiées. */
  assert.match(suite, /animation-au-defilement-en-css-pur-avec-repli/);
  assert.match(suite, /gsap-scrolltrigger-avec-lenis-defilement-doux/);
  assert.match(suite, /animation-au-defilement-accessible-et-fluide/);
  assert.match(suite, /directeur artistique/);
  assert.match(suite, /JUSQU'AU VERT/);
  assert.match(demandeDuPremierTour({ name: 'Neuf', description: 'Réserver des courts' }), /Réserver des courts/);
  const reprise = demandeDeRepriseDuCahier(
    { ...cahierNeuf(), faites: 4, total: 20, phase: 'interfaces', restants: ['App mobile'] },
    '# Doc\n## Vision\nOK',
  );
  assert.match(reprise, /4 question\(s\) tranchée\(s\) sur 20/);
  assert.match(reprise, /App mobile/);
  assert.match(reprise, /## Vision/);
});

test('le volet du cahier a ses trois étapes, et seul le cahier est un volet à part', () => {
  assert.equal(estVoletDuCahier({ cahierDesCharges: cahierNeuf() }), true);
  assert.equal(estVoletDuCahier({}), false);
  assert.equal(estVoletDuCahier(null), false);
  const enCours = barreDuCahier(cahierNeuf());
  assert.deepEqual(enCours.map((s) => s.etape), ['creation', 'cahier', 'termine']);
  assert.deepEqual(enCours.map((s) => s.etat), ['fait', 'encours', 'avenir']);
  assert.equal(etapeCouranteDuCahier(cahierNeuf()), 'cahier');
  assert.equal(barreDuCahier({ enPauseA: 1 })[1]!.etat, 'question');
  assert.deepEqual(barreDuCahier({ termineA: 2 }).map((s) => s.etat), ['fait', 'fait', 'fait']);
  assert.equal(etapeCouranteDuCahier({ termineA: 2 }), 'termine');
});

test('l’avancement garde la carte de suite déjà née', () => {
  const lu = lireAvancement({ termine: true, phase: 'relecture' }, { ...cahierNeuf(), suiteId: 'c-suite' }, 5);
  assert.ok(lu.ok);
  assert.equal(lu.cahier.suiteId, 'c-suite');
});

test('l’export : un nom de fichier propre, et un HTML fidèle et échappé', () => {
  assert.equal(nomDuCahierExporte('Mon/App', 'pdf'), 'Cahier des charges — Mon App.pdf');
  assert.equal(nomDuCahierExporte('', 'md'), 'Cahier des charges — projet.md');
  const html = htmlDuCahier(
    '# Titre\n\n## Vision\nUn **outil** <b>sûr</b>, voir https://exemple.ch\n\n- un\n- deux\n\n| Couche | Choix |\n| --- | --- |\n| Base | PostgreSQL |',
    'Cahier',
  );
  assert.match(html, /<h1>Titre<\/h1>/);
  assert.match(html, /<h2>Vision<\/h2>/);
  assert.match(html, /<strong>outil<\/strong>/);
  assert.match(html, /&lt;b&gt;sûr&lt;\/b&gt;/);
  assert.match(html, /<a href="https:\/\/exemple\.ch">/);
  assert.match(html, /<ul><li>un<\/li><li>deux<\/li><\/ul>|<ul>\n<li>un<\/li>\n<li>deux<\/li>\n<\/ul>/);
  assert.match(html, /<th>Couche<\/th>/);
  assert.match(html, /<td>PostgreSQL<\/td>/);
  assert.doesNotMatch(html, /<td>---<\/td>/);
});

test('un cahier en pause n’est jamais relancé par le rattrapage du démarrage', () => {
  const etat = {
    carte: { column: 'planned', origin: 'agent', briefing: 'Cahier.', parcours: null, cahierDesCharges: { enPauseA: 1 } },
    agent: { role: 'cadrage' },
    auRepos: true,
    messages: 0,
    enFile: 0,
    aUneSession: false,
    dejaRelance: false,
  };
  assert.equal(cadrageJamaisParti(etat), false);
  assert.equal(cadrageJamaisParti({ ...etat, carte: { ...etat.carte, cahierDesCharges: null } }), true);
});

/* ------------------------------------------------------------------ */
/* SUR UNE VRAIE BASE                                                  */
/* ------------------------------------------------------------------ */

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-cahier-'));
const projet = store.saveProject(
  Project.parse({ id: 'p-cahier', name: 'Projet neuf', path: dossier, createdAt: Date.now(), updatedAt: Date.now() }),
);

function carteDuCahier(): Card {
  const card = createCard(projet.id, { title: 'Cahier des charges', origin: 'user', cadrage: true });
  return store.saveCard({ ...card, cahierDesCharges: cahierNeuf() });
}

function cadrageDe(cardId: string): Agent {
  return store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: projet.id,
      cardId,
      role: 'cadrage',
      title: 'cadrage',
      run: { engine: 'claude', thinking: 'medium' },
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

test('l’outil n’est servi qu’au cadrage d’une carte « cahier des charges »', () => {
  assert.ok(toolsFor('cadrage').some((t) => t.name === 'cahier_des_charges'));
  assert.ok(!toolsFor('task').some((t) => t.name === 'cahier_des_charges'));

  const cahier = carteDuCahier();
  const agent = cadrageDe(cahier.id);
  assert.equal(estAgentDuCahier(agent.id), true);
  assert.equal(outilServiA('cahier_des_charges', agent.id), true);
  assert.match(consigneSystemeDuCahier(agent.id), /PARCOURS DU CAHIER DES CHARGES/);

  const ordinaire = createCard(projet.id, { title: 'Carte ordinaire', origin: 'user', cadrage: true });
  const autre = cadrageDe(ordinaire.id);
  assert.equal(estAgentDuCahier(autre.id), false);
  assert.equal(outilServiA('cahier_des_charges', autre.id), false);
  assert.equal(consigneSystemeDuCahier(autre.id), '');
});

test('l’outil écrit le document dans le projet et l’avancement sur la carte', async () => {
  const cahier = carteDuCahier();
  const agent = cadrageDe(cahier.id);
  const ctx = { agentId: agent.id, projectId: projet.id, role: 'cadrage' as const, cardId: cahier.id };

  const sansDocument = await callTool(ctx, 'cahier_des_charges', { faites: 1, phase: 'vision' });
  assert.equal(sansDocument.ok, false);

  const r = await callTool(ctx, 'cahier_des_charges', {
    document: '# Cahier des charges\n\n## Vision\nRéserver des courts.\n\n## Interfaces\nÀ voir.',
    faites: 3,
    total: 25,
    phase: 'interfaces',
    restants: ['Interfaces', 'Paiement'],
  });
  assert.equal(r.ok, true, r.text);
  assert.match(fs.readFileSync(path.join(dossier, DOCUMENT_DU_CAHIER), 'utf8'), /Réserver des courts/);
  const lue = store.getCard(cahier.id)!;
  assert.equal(lue.cahierDesCharges?.faites, 3);
  assert.equal(lue.cahierDesCharges?.phase, 'interfaces');
  assert.match(lireLeDocument(lue)?.texte ?? '', /## Interfaces/);

  const refus = await callTool({ ...ctx, role: 'task' as const }, 'cahier_des_charges', { document: 'x', faites: 1, phase: 'vision' });
  assert.equal(refus.ok, false);
});

test('la pause se pose sans bouger la carte, un message de l’utilisateur la lève', async () => {
  const cahier = carteDuCahier();
  cadrageDe(cahier.id);
  const pausee = await mettreEnPause(cahier.id);
  assert.ok(pausee.cahierDesCharges?.enPauseA);
  assert.equal(pausee.column, cahier.column);
  await assert.rejects(() => mettreEnPause(cahier.id), /déjà en pause/);

  leverLaPauseSurMessage(cahier.id);
  assert.equal(store.getCard(cahier.id)?.cahierDesCharges?.enPauseA, undefined);
});

test('la fin du cahier archive la carte et fait naître UNE carte de construction', async () => {
  const cahier = carteDuCahier();
  const agent = cadrageDe(cahier.id);
  const ctx = { agentId: agent.id, projectId: projet.id, role: 'cadrage' as const, cardId: cahier.id };
  const incomplet = { document: '# Cahier des charges\n\n## Vision\nRéserver des courts.', faites: 30, total: 30, phase: 'relecture', termine: true };
  const refus = await callTool(ctx, 'cahier_des_charges', incomplet);
  assert.equal(refus.ok, false, 'sans spécificités du type, le cahier ne se termine pas');
  assert.match(refus.text, /Spécificités par type/);
  assert.equal(store.getCard(cahier.id)?.cahierDesCharges?.termineA, undefined);
  const fin = { ...incomplet, document: `${incomplet.document}\n\n## Spécificités par type\n### Site de réservation\nCréneaux d’une heure, paiement sur place.` };

  const r = await callTool(ctx, 'cahier_des_charges', fin);
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /Archivé/);
  assert.match(r.text, /Ne rends ni compréhension ni plan/);
  const suiteId = store.getCard(cahier.id)?.cahierDesCharges?.suiteId;
  assert.ok(suiteId, 'la carte du cahier retient sa carte de suite');
  const suite = store.getCard(suiteId!)!;
  assert.equal(suite.title, titreDeLaCarteDeSuite(projet.name));
  assert.equal(suite.column, 'planned');
  assert.equal(suite.cahierDesCharges, undefined, 'la suite est une carte ordinaire');
  /* Prête à partir : sa demande d'exécution est écrite, et « Lancer » ouvrira la validation des réglages. */
  assert.deepEqual(suite.suiteDuCahier, { cahierId: cahier.id });
  assert.match(suite.briefing ?? '', /Construis/);
  /* Elle NAÎT avec sa demande écrite au fil, et le cahier joint (copie figée en .md). */
  const demandes = demandesDuJournal(suite.id);
  assert.equal(demandes.length, 1, 'un seul jalon « Demande »');
  assert.equal(demandes[0].resultat, suite.briefing, 'la demande entière, jamais tronquée');
  assert.equal(demandes[0].agentId, undefined, 'aucun agent avant le lancement');
  assert.notEqual(demandes[0].phase, 'execution', 'la demande ne fait pas croire la carte partie');
  const donnees = JSON.parse(demandes[0].donnees ?? '{}');
  assert.match(donnees.resumeDemande ?? '', /cahier des charges/);
  assert.equal(donnees.pieces?.length, 1);
  const piece = store.listAttachments(projet.id).find((a) => a.id === donnees.pieces[0]);
  assert.ok(piece, 'la pièce jointe existe');
  assert.equal(piece!.name, nomDuCahierExporte(projet.name, 'md'));
  assert.equal(piece!.cardId, suite.id);
  assert.deepEqual(suite.attachments, [piece!.id], 'la pièce part à l’agent au lancement');

  /* Un second « termine » ne fait pas naître une seconde carte. */
  await callTool(ctx, 'cahier_des_charges', fin);
  const suites = store.listCards(projet.id).filter((c) => c.title === titreDeLaCarteDeSuite(projet.name));
  assert.equal(suites.length, 1);

  /* Le tour du cahier n'étant pas vivant, le rangement suit aussitôt. */
  for (let i = 0; i < 50 && store.getCard(cahier.id)?.column !== 'archived'; i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(store.getCard(cahier.id)?.column, 'archived');
  assert.equal(store.getCard(suiteId!)?.column, 'planned');
  /* Aucun cadrage ne s'ouvre sur la carte de construction : rien ne part avant le clic. */
  assert.equal(
    store.listAgents().filter((a) => a.cardId === suiteId).length,
    0,
    'la carte de construction n’ouvre aucun agent avant sa validation',
  );
});

test('le déroulé du cahier : phases faites, en cours, à venir, et le compte des questions', () => {
  const debut = cheminDuCahier(cahierNeuf());
  assert.equal(debut.etapes[0]!.phase, 'vision');
  assert.equal(debut.etapes[0]!.etat, 'encours');
  assert.equal(debut.suivante, 'approfondissement');
  assert.equal(debut.etapes.some((e) => e.phase === 'source'), false);
  const milieu = cheminDuCahier({ ...cahierNeuf(), phase: 'technologies', faites: 9, total: 6 });
  assert.deepEqual(
    milieu.etapes.map((e) => e.etat),
    ['fait', 'fait', 'fait', 'fait', 'encours', 'avenir', 'avenir', 'avenir'],
  );
  assert.equal(milieu.total, 9, 'le total ne descend jamais sous les questions faites');
  const fini = cheminDuCahier({ ...cahierNeuf(), phase: 'relecture', faites: 20, total: 20, termineA: 1 });
  assert.ok(fini.termine && !fini.suivante && fini.etapes.every((e) => e.etat === 'fait'));
});

test('les cartes de construction nées sans demande la reçoivent au démarrage, une seule fois', async () => {
  /* Une carte d'avant la règle : briefing, suiteDuCahier, aucun jalon, aucun agent. */
  const ancienne = store.saveCard({
    ...createCard(projet.id, {
      title: titreDeLaCarteDeSuite(projet.name),
      briefing: demandeDeLaCarteDeSuite({ name: projet.name }, dossier, '/x/SKILL.md'),
      origin: 'user',
      cadrage: true,
    }),
    suiteDuCahier: { cahierId: 'cahier-ancien' },
  });
  assert.equal(demandesDuJournal(ancienne.id).length, 0);
  /* Une carte de suite déjà confiée à un agent n'est pas touchée. */
  const confiee = store.saveCard({
    ...createCard(projet.id, { title: 'Déjà lancée', briefing: 'x', origin: 'user', cadrage: true }),
    suiteDuCahier: { cahierId: 'cahier-autre' },
  });
  cadrageDe(confiee.id);

  assert.ok((await completerLesDemandesDesSuites()) >= 1);
  const demandes = demandesDuJournal(ancienne.id);
  assert.equal(demandes.length, 1);
  assert.equal(demandes[0].resultat, ancienne.briefing);
  assert.equal(JSON.parse(demandes[0].donnees ?? '{}').pieces?.length, 1, 'le cahier joint, même déjà connu du projet');
  assert.equal(store.getCard(ancienne.id)?.attachments.length, 1);
  assert.equal(demandesDuJournal(confiee.id).length, 0);
  assert.equal(store.listAgents().filter((a) => a.cardId === ancienne.id).length, 0, 'aucun moteur ni agent');

  /* Rejoué : rien de plus. */
  assert.equal(await completerLesDemandesDesSuites(), 0);
  assert.equal(demandesDuJournal(ancienne.id).length, 1);
});
