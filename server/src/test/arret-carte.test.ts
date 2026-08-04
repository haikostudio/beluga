import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAISON_ARRETE_A_LA_MAIN,
  RAISON_ARRET_ETRANGER,
  RAISON_ARRET_SANS_AGENT,
  ClientCommand,
  arretDeCarteAutorise,
  boutonsBarreEcriture,
} from '@haikodev/shared';

test("l'agent de la carte s'arrête sans discuter", () => {
  const verdict = arretDeCarteAutorise({ carte: 'carte-1', agent: { id: 'a1', cardId: 'carte-1' } });
  assert.equal(verdict.possible, true);
  assert.equal(verdict.raison, undefined);
});

test("un agent étranger à la carte NE s'arrête pas depuis son tiroir", () => {
  const verdict = arretDeCarteAutorise({ carte: 'carte-1', agent: { id: 'a2', cardId: 'carte-2' } });
  assert.equal(verdict.possible, false);
  assert.equal(verdict.raison, RAISON_ARRET_ETRANGER);
});

test("un agent sans carte du tout est étranger à n'importe quelle carte", () => {
  const verdict = arretDeCarteAutorise({ carte: 'carte-1', agent: { id: 'chef' } });
  assert.equal(verdict.possible, false);
  assert.equal(verdict.raison, RAISON_ARRET_ETRANGER);
});

test('sans carte annoncée, le geste vaut pour l’agent regardé', () => {
  // Conversation du chef, arrêt groupé de la barre de quota : pas de carte en jeu.
  assert.equal(arretDeCarteAutorise({ agent: { id: 'chef' } }).possible, true);
  assert.equal(arretDeCarteAutorise({ carte: null, agent: { id: 'a1', cardId: 'carte-9' } }).possible, true);
});

test("sans agent, il n'y a rien à arrêter", () => {
  const verdict = arretDeCarteAutorise({ carte: 'carte-1', agent: null });
  assert.equal(verdict.possible, false);
  assert.equal(verdict.raison, RAISON_ARRET_SANS_AGENT);
});

test('la commande d’arrêt accepte la carte d’où part le geste, et s’en passe', () => {
  const avecCarte = ClientCommand.parse({ type: 'agent.stop', agentId: 'a1', cardId: 'carte-1' });
  assert.equal((avecCarte as any).cardId, 'carte-1');
  const sansCarte = ClientCommand.parse({ type: 'agent.stop', agentId: 'a1' });
  assert.equal((sansCarte as any).cardId, undefined);
});

test("au repos, la barre d'écriture ne montre que la flèche d'envoi", () => {
  const boutons = boutonsBarreEcriture({ occupe: false, arretPossible: true, aDuTexte: false, enEdition: false });
  assert.deepEqual(boutons, { arret: false, envoi: true });
});

test("pendant que l'agent travaille, la flèche laisse la place au carré d'arrêt", () => {
  const boutons = boutonsBarreEcriture({ occupe: true, arretPossible: true, aDuTexte: false, enEdition: false });
  assert.deepEqual(boutons, { arret: true, envoi: false });
});

test("du texte en cours de saisie garde son envoi : l'arrêt se pose à côté", () => {
  const boutons = boutonsBarreEcriture({ occupe: true, arretPossible: true, aDuTexte: true, enEdition: false });
  assert.deepEqual(boutons, { arret: true, envoi: true });
});

test("un arrêt non permis n'affiche pas de bouton : la flèche reste", () => {
  const boutons = boutonsBarreEcriture({ occupe: true, arretPossible: false, aDuTexte: false, enEdition: false });
  assert.deepEqual(boutons, { arret: false, envoi: true });
});

test("la modification d'un message en attente garde son bouton pour elle", () => {
  const boutons = boutonsBarreEcriture({ occupe: true, arretPossible: true, aDuTexte: true, enEdition: true });
  assert.deepEqual(boutons, { arret: false, envoi: true });
});

test('la carte arrêtée dit qu’elle ne repartira pas toute seule', () => {
  assert.match(RAISON_ARRETE_A_LA_MAIN, /file/);
  assert.match(RAISON_ARRETE_A_LA_MAIN, /geste/);
});
