import test from 'node:test';
import assert from 'node:assert/strict';
import { rolePrompt } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Le tri du chef d'orchestre : rien de programmé hors du tableau       */
/* ------------------------------------------------------------------ */

/*
 * Ces contrôles portent sur un TEXTE, ce qui est inhabituel. Mais ce texte EST
 * la règle : c'est lui qui décide si une demande devient une carte ou du code
 * écrit à la volée. Une réécriture qui laisserait tomber la consigne casserait
 * le suivi sans casser un seul test — d'où ceux-ci.
 */

const chef = rolePrompt('orchestrator', false);
const chefIci = rolePrompt('orchestrator', true);

test('toute demande de programmation passe par une carte', () => {
  assert.match(chef, /TOUTE DEMANDE DE PROGRAMMATION/);
  assert.match(chef, /board_create_card/);
});

test('la définition de « programmation » est donnée en toutes lettres', () => {
  for (const mot of ['nouvelle fonctionnalité', 'correction', 'suppression', 'AUCUNE EXCEPTION']) {
    assert.ok(chef.includes(mot), `« ${mot} » manque au briefing`);
  }
});

test('des demandes complémentaires sont regroupées dans une seule carte ordonnée', () => {
  assert.match(chef, /MÊME résultat/);
  assert.match(chef, /MÊME chantier/);
  assert.match(chef, /ordre logique/);
  assert.match(chef, /UNE SEULE carte/);
  assert.match(chef, /étapes successives/);
});

test('des objectifs sans rapport restent dans des cartes indépendantes', () => {
  assert.match(chef, /objectifs réellement indépendants/);
  assert.match(chef, /menés et validés séparément/);
});

test('une question se répond dans la conversation, sans carte', () => {
  assert.match(chef, /RÉPONDS DANS LA CONVERSATION, aucune carte/);
});

test('la carte est PROPOSÉE et attend le clic, jamais créée d’office', () => {
  assert.match(chef, /tu PROPOSES UNE carte avec board_create_card/);
  assert.match(chef, /qu’après le clic de l’utilisateur|qu'après le clic de l'utilisateur/);
  assert.doesNotMatch(chef, /d’office|d'office/);
});

test('le chef ne fait pas le travail lui-même', () => {
  assert.match(chef, /Tu ne fais jamais le travail toi-même/);
});

test('le doute garde son clic : propose_task reste la voie des cas ambigus', () => {
  assert.match(chef, /propose_task/);
});

test('sur HaikoDev, les outils d’écriture ne dispensent PAS de la carte', () => {
  assert.match(chefIci, /HAIKODEV LUI-MÊME/);
  assert.match(chefIci, /NE SONT PAS UNE PERMISSION DE COURT-CIRCUITER LE TABLEAU/);
  assert.match(chefIci, /c'est l'agent de cette carte qui fait le travail/);
});

test('ailleurs, le chef n’a toujours pas le droit de modifier un fichier', () => {
  assert.match(chef, /INTERDITS ABSOLUS/);
});

/* ------------------------------------------------------------------ */
/* Le quatrième cas : une demande d'exécution devient une carte          */
/* ------------------------------------------------------------------ */

/*
 * Le chef bridé savait dire qu'il ne pouvait pas exécuter, il ne savait pas
 * quoi faire à la place : il expliquait sa limite et attendait un « oui ».
 * Le tri porte donc un cas de plus, et ces contrôles le retiennent.
 */

test('une demande d’exécution passe par une carte, comme la programmation', () => {
  assert.match(chef, /TOUTE DEMANDE D'EXÉCUTION SUR LA MACHINE/);
  assert.match(chef, /tu PROPOSES AUSSITÔT UNE carte avec board_create_card/);
});

test('les gestes qui comptent pour de l’exécution sont nommés', () => {
  for (const mot of ['Lancer une commande', 'tester une connexion', 'ouvrir un terminal']) {
    assert.ok(chef.includes(mot), `« ${mot} » manque au quatrième cas`);
  }
});

test('la carte proposée dit quoi lancer et ce qu’on attend', () => {
  assert.match(chef, /CE QU'IL FAUT LANCER et CE QU'ON ATTEND COMME RÉSULTAT/);
});

test('ni confirmation demandée, ni paragraphe sur ses propres limites', () => {
  assert.match(chef, /Tu ne demandes AUCUNE confirmation avant de proposer/);
  assert.match(chef, /n'écris PAS un paragraphe sur tes propres limites/);
  assert.match(chef, /un agent de tâche exécutera la commande/);
});

test('le bridage reste, mais il ne sert plus de fin de non-recevoir', () => {
  assert.match(chef, /CES INTERDITS NE SONT PAS UNE FIN DE NON-RECEVOIR/);
  assert.match(chef, /tu n'attends pas un « oui » avant de proposer/);
});

test('le quatrième cas voyage à l’identique sur les deux moteurs', () => {
  const codex = rolePrompt('orchestrator', false, 'codex');
  assert.match(codex, /TOUTE DEMANDE D'EXÉCUTION SUR LA MACHINE/);
  assert.match(codex, /tu PROPOSES AUSSITÔT UNE carte avec board_create_card/);
  assert.match(codex, /CES INTERDITS NE SONT PAS UNE FIN DE NON-RECEVOIR/);
});

test('le tri garde ses cinq entrées numérotées', () => {
  for (const ligne of [/\n1\. Question/, /\n2\. TOUTE DEMANDE DE PROGRAMMATION/, /\n3\. TOUTE DEMANDE D'EXÉCUTION/, /\n4\. Cas ambigu/, /\n5\. Gestion du tableau/]) {
    assert.match(chef, ligne);
  }
});
