import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LES AGENTS PERSONNALISÉS CÔTÉ DÉMON (carte « Agents personnalisés dans les projets », 24/11/2026), sur une base
 * jetable et un envoi factice — aucun moteur, aucun réseau :
 *
 *  - un nouvel agent naît en brouillon, avec sa conversation sur une carte d'agent de volet rangée (aucun tour) ;
 *  - l'outil écrit la fiche rubrique par rubrique, refuse un geste verrouillé et le note au journal ;
 *  - « Allumer » est refusé tant que la fiche est incomplète ; éteint, aucun événement ne le réveille ;
 *  - DIX événements d'affilée ne font que DEUX passages (le premier, puis une suite fusionnée) ;
 *  - la limite met l'agent en pause et ne le dit qu'une fois ;
 *  - sans compte disponible, le passage attend en file et repart à la tournée ;
 *  - la tournée horaire lance un passage dû une seule fois, même rejouée ;
 *  - l'agent qui produit un événement ne se relance pas lui-même ;
 *  - une réponse préparée sur sa carte RANGÉE reste ouverte et compte dans la cloche ;
 *  - sa carte ramène à sa page.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-perso-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project, Message, AgentQuestion } = shared;
const store = await import('../store.js');
const { getDb } = await import('../db.js');
const perso = await import('../agents-personnalises.js');
const { rangerLaCarte } = await import('../deplacement-carte.js');
const { lieuDuServiceDeLaCarte } = await import('../service-de-carte.js');

const projet = store.saveProject(
  Project.parse({ id: 'p-agents', name: 'Projet des agents', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

/** L'envoi factice : il retient les tours, et chaque tour se termine quand le test le décide. */
const envois: { agentId: string; texte: string; context: string; finir: (texte: string, ok?: boolean) => void }[] = [];
let compteLibre = true;
perso.remplacerLEnvoi(
  async (agentId, texte, options) => {
    envois.push({ agentId, texte, context: options.context, finir: (t, ok = true) => options.onComplete(t, ok, { usage: { inputTokens: 100, outputTokens: 20 } }) });
  },
  async () => compteLibre,
);

/** Attendre que les promesses lancées sans attente (`void`) aient tourné. */
const souffle = () => new Promise((r) => setTimeout(r, 20));

async function agentComplet(limite: unknown = 'aucune', quand: unknown = [{ genre: 'evenement', source: 'messagerie.demande' }]) {
  const agent = await perso.creerAgent(projet.id);
  const agentId = agent.agentId!;
  const ecrire = (rubrique: string, valeur: unknown) => {
    const r = perso.ecrireRubriqueDeLAgent(agentId, rubrique, valeur);
    assert.equal(r.ok, true, `${rubrique} : ${r.texte}`);
  };
  ecrire('nom', 'Veilleur');
  ecrire('mission', 'Lire chaque demande client et préparer une réponse.');
  ecrire('quand', quand);
  ecrire('seul', ['Lire la demande', 'Préparer une réponse au client']);
  ecrire('demande', ['Envoyer la réponse au client']);
  ecrire('jamais', []);
  ecrire('emporte', { competences: [], acces: ['Messagerie / Brevo'], memoire: true });
  ecrire('limite', limite);
  return perso.lireAgent(projet.id, agent.id);
}

function lignesDuJournal(id: string) {
  return perso.journalDeLAgent(id).reverse();
}

test('un nouvel agent naît en brouillon, sa conversation sur une carte d’agent de volet rangée', async () => {
  const agent = await perso.creerAgent(projet.id);
  assert.equal(agent.fiche.nom, shared.NOM_D_UN_NOUVEL_AGENT);
  assert.equal(shared.etatAffiche(agent), 'brouillon');
  assert.ok(agent.agentId && agent.cardId);
  const carte = store.getCard(agent.cardId!)!;
  assert.equal(carte.column, 'archived', 'aucun tour ne part à la naissance');
  assert.ok(carte.labels.includes(shared.LABEL_AGENT_PERSO));
  assert.equal(carte.github?.branch, undefined, 'ni branche ni copie');
  assert.equal(envois.length, 0);
  assert.deepEqual(lieuDuServiceDeLaCarte(carte.id), { vue: 'agents', elementId: agent.id, projectId: projet.id });
  // L'outil n'est servi qu'à lui.
  assert.equal(perso.estAgentPerso(agent.agentId), true);
  assert.equal(perso.estAgentPerso('un-autre'), false);
  assert.throws(() => perso.allumer(projet.id, agent.id), /pas complète/);
  assert.throws(() => perso.lireAgent('autre-projet', agent.id), /introuvable/);
  // Le nom suit sur la carte et la conversation.
  perso.ecrireRubriqueDeLAgent(agent.agentId!, 'nom', 'Gardien du formulaire');
  assert.equal(store.getCard(agent.cardId!)!.title, 'Gardien du formulaire');
  assert.equal(store.getAgent(agent.agentId!)!.title, 'Gardien du formulaire');
});

test('un geste verrouillé est refusé par l’outil, et le refus entre au journal', async () => {
  const agent = await perso.creerAgent(projet.id);
  const r = perso.ecrireRubriqueDeLAgent(agent.agentId!, 'seul', ['Publier le post du jour']);
  assert.equal(r.ok, false);
  assert.match(r.texte, /REFUSÉ/);
  assert.ok(lignesDuJournal(agent.id).some((l) => l.genre === 'refus'));
  assert.equal(perso.lireAgent(projet.id, agent.id).fiche.faitSeul, null, 'rien n’est écrit');
  const secret = perso.ecrireRubriqueDeLAgent(agent.agentId!, 'emporte', { competences: [], acces: ['ghp_AbCdEfGh1234567890AbCdEfGh12'], memoire: false });
  assert.equal(secret.ok, false, 'une valeur secrète n’entre jamais dans la fiche');
});

test('éteint, aucun événement ne le réveille ; allumé, un événement le fait passer et le journal le dit', async () => {
  const agent = await agentComplet();
  assert.equal(shared.etatAffiche(agent), 'eteint');
  assert.equal(await perso.declencherLesAgents(projet.id, 'messagerie.demande', 'demande 1'), 0);
  perso.allumer(projet.id, agent.id);
  const avant = envois.length;
  assert.equal(await perso.declencherLesAgents(projet.id, 'messagerie.demande', 'demande de Marie'), 1);
  assert.equal(envois.length, avant + 1);
  const tour = envois.at(-1)!;
  assert.match(tour.context, /NOM : Veilleur/);
  assert.match(tour.context, /demande de Marie/);
  assert.doesNotMatch(tour.context, /ghp_/);
  assert.equal(perso.lireAgent(projet.id, agent.id).enPassage, true);
  tour.finir('Fait : une demande lue, rien à répondre.');
  const apres = perso.lireAgent(projet.id, agent.id);
  assert.equal(apres.enPassage, false);
  assert.equal(apres.derniereAction?.resume, 'Fait : une demande lue, rien à répondre.');
  assert.equal(apres.derniereAction?.issue, 'fait');
  perso.eteindre(projet.id, agent.id);
});

test('dix événements d’affilée ne font que deux passages : le premier, puis une suite fusionnée', async () => {
  const agent = await agentComplet();
  perso.allumer(projet.id, agent.id);
  const avant = envois.length;
  for (let i = 0; i < 10; i++) await perso.declencherLesAgents(projet.id, 'messagerie.demande', `demande ${i}`);
  assert.equal(envois.length, avant + 1, 'un seul passage à la fois');
  envois.at(-1)!.finir('Fait : demande 0.');
  await souffle();
  assert.equal(envois.length, avant + 2, 'UNE suite reprend les neuf autres');
  const suite = envois.at(-1)!;
  assert.match(suite.context, /demande 1/);
  assert.match(suite.context, /demande 9/);
  // Pendant la suite, rien ne s'accumule : un agent ne se relance pas en chaîne.
  for (let i = 0; i < 5; i++) assert.equal(await perso.passer(agent.id, { genre: 'evenement', source: 'messagerie.demande', details: 'rebond' }), 'ecarte');
  suite.finir('Fait : neuf demandes lues.');
  await souffle();
  assert.equal(envois.length, avant + 2, 'aucune troisième vague');
  perso.eteindre(projet.id, agent.id);
});

test('l’agent qui produit l’événement ne se relance pas lui-même', async () => {
  const agent = await agentComplet();
  perso.allumer(projet.id, agent.id);
  const avant = envois.length;
  assert.equal(await perso.declencherLesAgents(projet.id, 'messagerie.demande', 'écrite par lui', agent.agentId), 0);
  assert.equal(envois.length, avant);
  perso.eteindre(projet.id, agent.id);
});

test('à la limite, l’agent se met en pause, et ne le dit qu’une fois', async () => {
  const agent = await agentComplet({ passages: 2, periode: 'jour' }, [{ genre: 'manuel' }]);
  perso.allumer(projet.id, agent.id);
  const avant = envois.length;
  for (let i = 0; i < 2; i++) {
    assert.equal(await perso.lancerMaintenant(projet.id, agent.id), 'parti');
    envois.at(-1)!.finir(`Fait : passage ${i}.`);
  }
  assert.equal(await perso.lancerMaintenant(projet.id, agent.id), 'limite');
  assert.equal(await perso.lancerMaintenant(projet.id, agent.id), 'limite');
  assert.equal(envois.length, avant + 2);
  const lu = perso.lireAgent(projet.id, agent.id);
  assert.equal(lu.enPauseLimite, true);
  assert.equal(shared.etatAffiche(lu), 'pause_limite');
  assert.equal(lignesDuJournal(agent.id).filter((l) => l.genre === 'limite').length, 1);
  const point = perso.pointDuMatinDuProjet(projet.id);
  assert.ok(point.enPause.some((p) => p.agentPersoId === agent.id), 'le point du matin le signale');
  perso.eteindre(projet.id, agent.id);
});

test('sans compte disponible, le passage attend en file et repart à la tournée', async () => {
  const agent = await agentComplet('aucune', [{ genre: 'manuel' }]);
  perso.allumer(projet.id, agent.id);
  const avant = envois.length;
  compteLibre = false;
  assert.equal(await perso.lancerMaintenant(projet.id, agent.id), 'attente-quota');
  assert.equal(envois.length, avant, 'rien ne part sans compte');
  assert.equal(perso.lireAgent(projet.id, agent.id).attendUnCompte, true, 'le passage n’est pas perdu');
  assert.equal(perso.lireAgent(projet.id, agent.id).enPassage, false, 'il ne se dit pas « au travail » pour autant');
  assert.equal(await perso.lancerMaintenant(projet.id, agent.id), 'fusionne', 'un second clic rejoint le passage qui attend');
  assert.equal(lignesDuJournal(agent.id).at(-1)?.resume, 'En attente d’un compte avec du quota.');
  compteLibre = true;
  await perso.tourneeDesAgents();
  assert.equal(envois.length, avant + 1, 'le compte revenu, il part');
  envois.at(-1)!.finir('Rien à faire : aucune demande.');
  assert.equal(perso.lireAgent(projet.id, agent.id).derniereAction?.issue, 'ignore');
  perso.eteindre(projet.id, agent.id);
});

test('la tournée lance un passage horaire dû une seule fois, même rejouée', async () => {
  const maintenant = Date.now();
  const heure = new Date(maintenant - 5 * 60_000);
  const hh = String(shared.heureLocale(heure.getTime())).padStart(2, '0');
  const mm = String(shared.minutesLocales(heure.getTime())).padStart(2, '0');
  const agent = await agentComplet('aucune', [{ genre: 'horaire', rythme: 'jour', heure: `${hh}:${mm}` }]);
  // Allumé hier : le créneau d'il y a cinq minutes est dû.
  perso.allumer(projet.id, agent.id, maintenant - 86_400_000);
  const avant = envois.length;
  await perso.tourneeDesAgents(maintenant);
  assert.equal(envois.length, avant + 1);
  envois.at(-1)!.finir('Fait : point du jour.');
  await perso.tourneeDesAgents(maintenant + 60_000);
  assert.equal(envois.length, avant + 1, 'la tournée suivante (ou un redémarrage) ne le refait pas');
  assert.ok(perso.lireAgent(projet.id, agent.id).prochainPassage! > maintenant, 'le prochain passage est demain');
  perso.eteindre(projet.id, agent.id);
});

test('une réponse préparée sur sa carte RANGÉE reste ouverte et compte dans la cloche', async () => {
  const agent = await agentComplet();
  const question = AgentQuestion.parse({
    id: store.newId(),
    question: 'Envoyer cette réponse au client (la demande « Formulaire ») ?',
    description: 'Bonjour Marie, …',
    kind: 'single',
    options: [
      { id: 'envoyer', label: 'Envoyer au client' },
      { id: 'non', label: 'Ne pas envoyer' },
    ],
    allowFreeText: false,
  });
  const message = store.saveMessage(
    Message.parse({ id: store.newId(), agentId: agent.agentId!, role: 'assistant', content: 'À valider : une réponse préparée.', questions: [question], createdAt: store.now() }),
  );
  // La carte passe « En cours » pendant le passage, puis se range « Archivé » : la question reste ouverte.
  const carte = store.getCard(agent.cardId!)!;
  store.saveCard({ ...carte, column: 'running' });
  rangerLaCarte(store.getCard(agent.cardId!)!, 'archived');
  const relu = store.listMessages(agent.agentId!).find((m) => m.id === message.id)!;
  assert.equal(relu.questions?.[0]?.cancelled ?? false, false, 'le rangement ne ferme pas sa demande d’accord');
  const decisions = store.decisionsEnAttente().filter((d) => d.agentId === agent.agentId);
  assert.equal(decisions.length, 1, 'elle compte dans la cloche alors que la carte est rangée');
  assert.equal(perso.lireAgent(projet.id, agent.id).attentes, 1);
  assert.equal(shared.etatAffiche(perso.lireAgent(projet.id, agent.id)), 'a_valider');
  // Une carte ORDINAIRE rangée ferme toujours les siennes.
  const ordinaire = store.getCard(agent.cardId!)!;
  assert.ok(getDb().prepare('SELECT 1 FROM agents_perso WHERE card_id = ?').get(ordinaire.id));
});

test('retirer un agent ferme ses demandes et efface sa ligne et son journal', async () => {
  const agent = await agentComplet();
  await perso.supprimer(projet.id, agent.id);
  assert.throws(() => perso.lireAgent(projet.id, agent.id), /introuvable/);
  assert.equal(perso.journalDeLAgent(agent.id).length, 0);
});

test.after(() => {
  perso.oublierLEtatEnMemoire();
  fs.rmSync(bacASable, { recursive: true, force: true });
});
