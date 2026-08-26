import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RAISON_ARRETE_A_LA_MAIN,
  colonneApresArretALaMain,
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

/* ------------------------------------------------------------------ */
/* LA COLONNE SUIT LE BOUTON D'ARRÊT                                   */
/*                                                                     */
/* Le bouton ne changeait que la PHRASE : la carte restait en « En     */
/* cours », sans agent au travail, et le balayage de l'ordonnanceur    */
/* s'interdit d'y toucher après un tour arrêté. Elle retombe désormais  */
/* en « Planifié », comme la sortie à la souris le faisait déjà.       */
/* ------------------------------------------------------------------ */

test('une carte arrêtée à la main retombe en « Planifié »', () => {
  assert.equal(colonneApresArretALaMain('running'), 'planned');
});

test('une carte qui n’était pas « En cours » ne bouge pas', () => {
  for (const colonne of ['notes', 'planned', 'done', 'to_deploy', 'archived']) {
    assert.equal(colonneApresArretALaMain(colonne), null, colonne);
  }
});

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SERVEUR = (fichier: string) => fs.readFileSync(path.resolve(ICI, `../../src/${fichier}`), 'utf8');

test('les trois gestes d’arrêt passent par le MÊME rangement', () => {
  const ws = SERVEUR('ws.ts');
  // Sortie à la souris, bouton d'une carte, « tout arrêter » : trois appels,
  // aucune écriture de carte suspendue en direct.
  assert.equal(ws.split('suspendreLaCarte(').length - 1, 3, 'trois gestes, trois appels');
  assert.doesNotMatch(ws, /suspendu: true/, 'plus aucune suspension écrite à la main dans ws.ts');
});

test('le rangement d’un arrêt retire la marque de vol et désarme la reprise', () => {
  const corps = SERVEUR('deplacement-carte.ts').split('export function suspendreLaCarte(')[1];
  assert.match(corps, /colonneApresArretALaMain\(card\.column\)/);
  assert.match(corps, /suspendu: true/);
  assert.match(corps, /tourEnVolDepuis: undefined/);
  assert.match(corps, /reprendreDesQuePossible: undefined/);
});

test('l’arrêt vide la file AVANT de couper, jamais après', () => {
  /*
   * Refermer un tour d'autorité relance la file en partant
   * (`refermerLeTour` → `enchainerLaFile`) : vidée après coup, la demande en
   * attente était déjà dépilée et repartait quatre dixièmes de seconde plus
   * tard, replaçant la carte en « En cours » par-dessus la suspension. Le clic
   * « Arrêter » relançait donc la tâche qu'il devait arrêter.
   */
  const ws = SERVEUR('ws.ts');
  const bloc = ws.split("case 'agent.stop': {")[1].split("case 'agents.stop-all'")[0];
  const file = bloc.indexOf('store.clearQueue(cmd.agentId)');
  const coupe = bloc.indexOf('arreterLAgent(cmd.agentId)');
  assert.ok(file > 0 && coupe > 0, 'les deux gestes doivent être là');
  assert.ok(file < coupe, 'la file se vide AVANT la coupe');

  const tous = ws.split("case 'agents.stop-all': {")[1];
  assert.ok(
    tous.indexOf('store.clearQueue(agent.id)') < tous.indexOf('stopAllAgents()'),
    '« tout arrêter » suit la même règle',
  );
});

/* ------------------------------------------------------------------ */
/* UN REDÉMARRAGE DU SERVEUR N'EST PAS UN ARRÊT À LA MAIN              */
/*                                                                     */
/* Depuis que l'arrêt à la main range la carte en « Planifié » et la   */
/* marque « suspendu », il faut que le redémarrage du démon NE prenne  */
/* PAS ce chemin : une carte coupée par un arrêt du serveur doit       */
/* revenir INTERROMPUE, garder sa marque de vol et repartir d'elle-    */
/* même. Marquée « suspendu », elle attendrait un clic que personne ne */
/* saurait devoir donner — la reprise automatique serait morte.        */
/* ------------------------------------------------------------------ */

test('le redémarrage forcé coupe les agents SANS suspendre les cartes', () => {
  const demon = SERVEUR('demon.ts');
  assert.match(demon, /runtime\.stopAllAgents\(\)/, 'il coupe bien tout ce qui tourne');
  assert.doesNotMatch(
    demon,
    /suspendreLaCarte|suspendu: true/,
    'mais il ne pose aucune suspension : la carte doit repartir toute seule',
  );
});

test('seul le navigateur suspend une carte : le rangement d’arrêt ne vit que dans ws.ts', () => {
  const appelants = ['runtime.ts', 'scheduler.ts', 'demon.ts', 'deploy.ts', 'orchestrator.ts'];
  for (const fichier of appelants) {
    assert.doesNotMatch(
      SERVEUR(fichier),
      /suspendreLaCarte\(/,
      `${fichier} ne doit pas suspendre une carte : ce n'est pas un geste humain`,
    );
  }
});
