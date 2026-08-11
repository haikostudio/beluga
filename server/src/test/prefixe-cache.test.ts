import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURS_DE_CACHE, consigneEnTeteDeSession, enteteDuTour, partRelueAuCache } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LE PRÉFIXE D'UNE SESSION NE BOUGE PAS                                */
/* ------------------------------------------------------------------ */

/*
 * Le cache d'un moteur ne se relit que par PRÉFIXE : le premier signe qui change
 * fait réécrire tout ce qui suit. Sous Claude, la consigne système EST ce
 * préfixe (`--append-system-prompt`, reposé devant à chaque invocation) ; sous
 * Codex elle est collée devant la DEMANDE, donc derrière l'historique du fil.
 * D'où deux comportements opposés, tenus par une seule règle.
 */

const ENTIER = 'CONSIGNE ENTIÈRE, quatre mille signes.';
const RAPPEL = 'RAPPEL COURT.';

test('sous Claude, la reprise renvoie EXACTEMENT le même entête que le premier tour', () => {
  const premier = enteteDuTour({ engine: 'claude', reprise: false, systemPrompt: ENTIER, systemPromptRappel: RAPPEL });
  const reprise = enteteDuTour({ engine: 'claude', reprise: true, systemPrompt: ENTIER, systemPromptRappel: RAPPEL });
  assert.equal(premier, ENTIER);
  assert.equal(reprise, ENTIER);
});

test('sous Codex, la reprise garde le rappel court : rien à perdre, sa consigne suit l’historique', () => {
  const premier = enteteDuTour({ engine: 'codex', reprise: false, systemPrompt: ENTIER, systemPromptRappel: RAPPEL });
  const reprise = enteteDuTour({ engine: 'codex', reprise: true, systemPrompt: ENTIER, systemPromptRappel: RAPPEL });
  assert.equal(premier, ENTIER);
  assert.equal(reprise, RAPPEL);
});

test('un moteur inconnu est traité comme Claude : au pire on renvoie du déjà caché', () => {
  assert.equal(consigneEnTeteDeSession(undefined), true);
  assert.equal(consigneEnTeteDeSession('claude'), true);
  assert.equal(consigneEnTeteDeSession('codex'), false);
  assert.equal(enteteDuTour({ reprise: true, systemPrompt: ENTIER, systemPromptRappel: RAPPEL }), ENTIER);
});

test('sans consigne entière, la reprise se rabat sur le rappel plutôt que sur rien', () => {
  assert.equal(enteteDuTour({ engine: 'claude', reprise: true, systemPromptRappel: RAPPEL }), RAPPEL);
  assert.equal(enteteDuTour({ engine: 'claude', reprise: false }), undefined);
});

/* ------------------------------------------------------------------ */
/* LA PART RELUE AU CACHE                                               */
/* ------------------------------------------------------------------ */

test('la part relue additionne les moteurs et se lit en fraction', () => {
  const releve = partRelueAuCache([
    { engine: 'claude', frais: 200, relu: 800, tours: 10 },
    { engine: 'codex', frais: 800, relu: 200, tours: 5 },
  ]);
  assert.equal(releve.frais, 1000);
  assert.equal(releve.relu, 1000);
  assert.equal(releve.entree, 2000);
  assert.equal(releve.part, 0.5);
  assert.equal(releve.tours, 15);
});

test('une fenêtre sans mesure ne vaut PAS zéro pour cent : elle vaut « pas de mesure »', () => {
  assert.equal(partRelueAuCache([]).part, undefined);
  assert.equal(partRelueAuCache([{ frais: 0, relu: 0, tours: 0 }]).part, undefined);
});

test('la fenêtre affichée est de sept jours', () => {
  assert.equal(JOURS_DE_CACHE, 7);
});
