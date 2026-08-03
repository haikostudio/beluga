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

test('une question se répond dans la conversation, sans carte', () => {
  assert.match(chef, /RÉPONDS DANS LA CONVERSATION, aucune carte/);
});

test('le chef ne valide pas et ne fait pas le travail lui-même', () => {
  assert.match(chef, /ni à la valider, ni à faire le travail toi-même/);
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
