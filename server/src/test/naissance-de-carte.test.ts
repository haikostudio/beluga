import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  CONSIGNE_CADRAGE,
  Project,
  appelantPeutDeplacerLaCarte,
  cadrageJamaisParti,
  carteSansDemande,
  consigneDArretApresDeplacement,
  demandeDeCadrageApresDeplacement,
  demandeDeCadrageDeNaissance,
  demandeDeNaissance,
  phraseDeDeplacementParLeCadrage,
} from '@beluga/shared';

/*
 * TOUTE CARTE NAÎT AVEC SA DEMANDE, ET SEUL SON CADRAGE PEUT L'ENVOYER DANS LE
 * BON PROJET (MEM-3555, décision du 26.09.2026).
 *
 * La règle pure d'abord, puis sur une vraie base jetable : `createCard` pose la
 * demande, l'outil de déplacement ne sert que le cadrage et ne tolère que
 * l'agent qui l'appelle.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'naissance-carte-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard, callTool, toolsFor } = await import('../tools.js');
const { deplacerLaCarteVersProjet } = await import('../deplacement-vers-projet.js');
const { completerLesDemandesManquantes, cadrageDeLaCarteJamaisParti } = await import('../naissance-de-carte.js');

/* ------------------------------------------------------------------ */
/* LA RÈGLE PURE                                                       */
/* ------------------------------------------------------------------ */

test('la demande rédigée par l’auteur passe telle quelle', () => {
  assert.equal(demandeDeNaissance({ title: 'T', description: 'D', briefing: '  Le besoin.  ', origin: 'agent' }), 'Le besoin.');
});

test('sans demande rédigée, elle se compose et nomme l’auteur', () => {
  const texte = demandeDeNaissance({ title: 'Installer le suivi', description: 'Poser le script.', origin: 'agent' }, 'marketing');
  assert.ok(texte);
  assert.match(texte!, /atelier marketing/);
  assert.match(texte!, /Installer le suivi/);
  assert.match(texte!, /Poser le script\./);
});

test('une carte d’agent sans description reçoit quand même une demande', () => {
  const texte = demandeDeNaissance({ title: 'Vérifier les sauvegardes', origin: 'agent' });
  assert.ok(texte);
  assert.match(texte!, /Vérifier les sauvegardes/);
});

test('la carte vide du « + » n’en reçoit pas : le premier message de l’utilisateur la sera', () => {
  assert.equal(demandeDeNaissance({ title: 'Nouvelle tâche', origin: 'user' }), undefined);
  assert.equal(carteSansDemande({ title: 'Nouvelle tâche', origin: 'user' }), false);
});

test('une carte d’agent sans demande est repérée, plus une fois complétée', () => {
  assert.equal(carteSansDemande({ title: 'X', description: 'Y', origin: 'agent' }), true);
  assert.equal(carteSansDemande({ title: 'X', description: 'Y', origin: 'agent', briefing: 'Z' }), false);
});

test('le premier tour s’arrête à la compréhension et rappelle de vérifier le projet', () => {
  const texte = demandeDeCadrageDeNaissance({ title: 'T', briefing: 'Le besoin.' }, 'marketing');
  assert.match(texte, /ATELIER MARKETING/);
  assert.match(texte, /rendre_comprehension/);
  assert.match(texte, /ARRÊTE-TOI LÀ/);
  assert.match(texte, /deplacer_vers_projet/);
});

test('seul l’agent de cadrage de LA carte peut la déplacer', () => {
  assert.equal(appelantPeutDeplacerLaCarte({ role: 'cadrage', cardId: 'c1', cardIdVise: 'c1' }), true);
  assert.equal(appelantPeutDeplacerLaCarte({ role: 'task', cardId: 'c1', cardIdVise: 'c1' }), false);
  assert.equal(appelantPeutDeplacerLaCarte({ role: 'cadrage', cardId: 'c2', cardIdVise: 'c1' }), false);
  assert.equal(appelantPeutDeplacerLaCarte({ role: 'cadrage', cardIdVise: 'c1' }), false);
});

test('la phrase et la reprise disent d’où, vers où et pourquoi', () => {
  assert.equal(
    phraseDeDeplacementParLeCadrage('Beluga', 'Haiko Studio', 'parce que le site est celui du studio'),
    'Carte déplacée du projet « Beluga » vers « Haiko Studio » par l’agent de cadrage, parce que le site est celui du studio.',
  );
  const reprise = demandeDeCadrageApresDeplacement({
    depuis: 'Beluga',
    vers: 'Haiko Studio',
    title: 'T',
    briefing: 'Le besoin.',
    comprehension: 'Ce qui était compris.',
  });
  assert.match(reprise, /« Haiko Studio »/);
  assert.match(reprise, /Ce qui était compris\./);
});

/* ------------------------------------------------------------------ */
/* SUR UNE VRAIE BASE                                                  */
/* ------------------------------------------------------------------ */

function projet(id: string, nom: string): Project {
  return store.saveProject(
    Project.parse({ id, name: nom, path: `/tmp/${id}`, createdAt: Date.now(), updatedAt: Date.now() }),
  );
}

const source = projet('n-source', 'Projet de départ');
const cible = projet('n-cible', 'Projet d’accueil');

function agentDe(cardId: string, role: 'cadrage' | 'task', status: 'idle' | 'running') {
  return store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: source.id,
      cardId,
      role,
      title: 'agent',
      run: { engine: 'claude', thinking: 'medium' },
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

test('createCard : une carte posée par un agent naît avec sa demande', () => {
  const card = createCard(source.id, {
    title: 'Installer le suivi marketing anonyme',
    description: 'Ajouter le script.',
    origin: 'agent',
    auteur: 'marketing',
  });
  assert.match(card.briefing ?? '', /atelier marketing/);
  const vide = createCard(source.id, { title: 'Nouvelle tâche', origin: 'user', cadrage: true });
  assert.equal(vide.briefing, undefined);
});

test('le rattrapage du démarrage complète les anciennes cartes, une seule fois', () => {
  const ancienne = createCard(source.id, { title: 'Ancienne carte', description: 'Sans demande.', origin: 'agent' });
  store.saveCard({ ...ancienne, briefing: undefined });
  assert.ok(completerLesDemandesManquantes() >= 1);
  assert.match(store.getCard(ancienne.id)?.briefing ?? '', /Ancienne carte/);
  assert.equal(completerLesDemandesManquantes(), 0);
});

test('l’agent de cadrage qui travaille peut déplacer SA carte', () => {
  const card = createCard(source.id, { title: 'À déplacer', description: 'x' });
  const cadrage = agentDe(card.id, 'cadrage', 'running');
  store.saveCard({ ...card, agentId: cadrage.id });

  /* Sans l'exception : l'agent au travail bloque, comme avant. */
  assert.equal(deplacerLaCarteVersProjet(card.id, cible.id).ok, false);
  /* Avec l'appelant nommé : la carte part. */
  const r = deplacerLaCarteVersProjet(card.id, cible.id, { agentAppelantId: cadrage.id });
  assert.equal(r.ok, true, r.error);
  assert.equal(store.getCard(card.id)?.projectId, cible.id);
});

test('un AUTRE agent au travail bloque toujours, et un agent de tâche aussi', () => {
  const card = createCard(source.id, { title: 'Occupée', description: 'x' });
  const cadrage = agentDe(card.id, 'cadrage', 'idle');
  agentDe(card.id, 'cadrage', 'running');
  assert.equal(deplacerLaCarteVersProjet(card.id, cible.id, { agentAppelantId: cadrage.id }).ok, false);

  const lancee = createCard(source.id, { title: 'Lancée', description: 'x' });
  const tache = agentDe(lancee.id, 'task', 'running');
  assert.equal(deplacerLaCarteVersProjet(lancee.id, cible.id, { agentAppelantId: tache.id }).ok, false);
  assert.equal(store.getCard(lancee.id)?.projectId, source.id);
});

test('l’outil n’est servi qu’au cadrage, et refuse tout autre rôle', async () => {
  assert.ok(toolsFor('cadrage').some((t) => t.name === 'deplacer_vers_projet'));
  assert.ok(!toolsFor('task').some((t) => t.name === 'deplacer_vers_projet'));

  const card = createCard(source.id, { title: 'Carte de tâche', description: 'x' });
  const refus = await callTool(
    { agentId: 'a', projectId: source.id, role: 'task', cardId: card.id },
    'deplacer_vers_projet',
    { projet: cible.name, raison: 'test' },
  );
  assert.equal(refus.ok, false);
  assert.equal(store.getCard(card.id)?.projectId, source.id);
});

test('après un déplacement, l’agent ne reçoit plus aucune invitation à écrire une phrase', () => {
  const retour = consigneDArretApresDeplacement('Autre projet');
  assert.match(retour, /n'écris RIEN/);
  assert.doesNotMatch(retour, /une seule phrase|sur une phrase|en une phrase/i);
  /* La consigne de cadrage dit la même chose : on s'arrête sans rien écrire. */
  assert.match(CONSIGNE_CADRAGE, /deplacer_vers_projet[^]*arrête ton tour SANS RIEN ÉCRIRE/);
  assert.doesNotMatch(CONSIGNE_CADRAGE, /arrête ton tour sur une phrase/);
  const outil = toolsFor('cadrage').find((t) => t.name === 'deplacer_vers_projet');
  assert.match(outil?.description ?? '', /sans rien écrire/);
});

/* ------------------------------------------------------------------ */
/* LE CADRAGE JAMAIS PARTI (26.09.2026)                               */
/* ------------------------------------------------------------------ */

const CADRAGE_MUET = {
  carte: { column: 'planned', origin: 'agent', briefing: 'Poser le suivi des visites.', parcours: null },
  agent: { role: 'cadrage' },
  auRepos: true,
  messages: 0,
  enFile: 0,
  aUneSession: false,
  dejaRelance: false,
};

test('un agent de cadrage né sans jamais rien recevoir est repéré', () => {
  assert.equal(cadrageJamaisParti(CADRAGE_MUET), true);
});

test('le filet ne touche ni une carte de l’utilisateur, ni un agent qui a parlé, ni un tour vivant ou en file', () => {
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, carte: { ...CADRAGE_MUET.carte, origin: 'user' } }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, messages: 1 }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, auRepos: false }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, enFile: 1 }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, aUneSession: true }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, dejaRelance: true }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, agent: { role: 'task' } }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, agent: null }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, carte: { ...CADRAGE_MUET.carte, column: 'running' } }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, carte: { ...CADRAGE_MUET.carte, archivedAt: 1 } }), false);
  assert.equal(cadrageJamaisParti({ ...CADRAGE_MUET, carte: { ...CADRAGE_MUET.carte, briefing: '' } }), false);
  assert.equal(
    cadrageJamaisParti({ ...CADRAGE_MUET, carte: { ...CADRAGE_MUET.carte, parcours: { comprehension: { texte: 'compris' } } } }),
    false,
  );
});

test('le cadrage sans témoin interdit la question et le plan', () => {
  const texte = demandeDeCadrageDeNaissance({ title: 'T', briefing: 'Le besoin.' }, 'marketing', { sansTemoin: true });
  assert.match(texte, /NE POSE AUCUNE QUESTION/);
  assert.match(texte, /N'APPELLE JAMAIS « rendre_plan »/);
  assert.doesNotMatch(demandeDeCadrageDeNaissance({ title: 'T', briefing: 'Le besoin.' }, 'marketing'), /NE POSE AUCUNE QUESTION/);
});

test('sur la base : une carte d’agent avec son cadrage muet est repérée, plus une fois l’agent a parlé', async () => {
  const carte = createCard(source.id, { title: 'Poser le suivi des visites', description: 'Poser le script.', origin: 'agent' });
  const agent = agentDe(carte.id, 'cadrage', 'idle');
  assert.equal(cadrageDeLaCarteJamaisParti(store.getCard(carte.id)!)?.id, agent.id);
  store.saveMessage({ id: store.newId(), agentId: agent.id, role: 'assistant', content: 'Compris.', createdAt: store.now() } as any);
  assert.equal(cadrageDeLaCarteJamaisParti(store.getCard(carte.id)!), null);
});
