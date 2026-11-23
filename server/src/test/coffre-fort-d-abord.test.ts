import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSIGNE_ASSISTANT_BACKUP } from '@beluga/shared';
import { rolePrompt, rappelDeMethode } from '../runtime.js';
import { toolsFor } from '../tools.js';

/* ------------------------------------------------------------------ */
/* Le coffre-fort D'ABORD, jamais « je n'ai pas accès »                */
/* ------------------------------------------------------------------ */

/*
 * L'utilisateur a rangé TOUS les accès dans un coffre-fort central, ouvert en
 * lecture et en écriture à chaque agent. Les agents continuaient pourtant à
 * répondre « je n'ai pas accès » ou à renvoyer la balle (« fournis-moi la
 * clé », « débrouille-toi ») sans l'avoir seulement listé : un refus FAUX, sur
 * un accès qui était là. La consigne dit donc un CONTRAT POSITIF — chercher est
 * le travail de l'agent — et nomme le vocabulaire interdit.
 */

const ROLES = ['cadrage', 'analysis', 'deploy', 'task'] as const;
const MOTEURS = ['claude', 'codex'] as const;

test('chaque rôle et chaque moteur reçoit l’ordre de chercher au coffre-fort en premier', () => {
  for (const engine of MOTEURS) {
    for (const role of ROLES) {
      const p = rolePrompt(role, false, engine);
      assert.match(p, /coffre_fort/, `${role} / ${engine}`);
      assert.match(p, /TON PREMIER GESTE EST « lister »/, `${role} / ${engine}`);
      assert.match(p, /LECTURE ET EN ÉCRITURE/, `${role} / ${engine}`);
      assert.match(p, /Chercher est TON travail/, `${role} / ${engine}`);
    }
  }
});

test('le vocabulaire du refus est nommé et interdit à tous les rôles', () => {
  for (const engine of MOTEURS) {
    for (const role of ROLES) {
      const p = rolePrompt(role, false, engine);
      assert.match(p, /TU NE DIS JAMAIS « je n'ai pas accès »/, `${role} / ${engine}`);
      assert.match(p, /je n'ai pas les droits/, `${role} / ${engine}`);
      // Ne pas renvoyer la balle : l'autre moitié de la demande.
      assert.match(p, /Tu ne renvoies pas non plus la balle/, `${role} / ${engine}`);
      assert.match(p, /débrouille-toi/, `${role} / ${engine}`);
    }
  }
});

test('la panne se dit toujours, mais APRÈS avoir cherché', () => {
  for (const engine of MOTEURS) {
    const p = rolePrompt('task', false, engine);
    assert.match(p, /Une PANNE se dit toujours, mais APRÈS avoir cherché/, engine);
    assert.match(p, /absent du coffre/, engine);
  }
});

test('la consigne du coffre-fort est EXACTEMENT la même pour les deux moteurs', () => {
  for (const role of ROLES) {
    const extrait = (engine: (typeof MOTEURS)[number]) =>
      rolePrompt(role, false, engine).split('LE COFFRE-FORT (outil')[1];
    assert.equal(extrait('codex'), extrait('claude'), `Rôle « ${role} »`);
  }
});

/*
 * Les deux accueils RÉDUITS — un dépannage de publication, l'assistant des
 * sauvegardes — ne portent pas la méthode générale. Ils demandent pourtant des
 * accès : la règle leur est donc redite en une phrase, jamais oubliée.
 */
test('le dépannage de publication cherche au coffre-fort, malgré son accueil réduit', () => {
  const consigne = rolePrompt('deploy', false, 'claude', 'minimal');
  assert.match(consigne, /coffre_fort/);
  assert.match(consigne, /CHERCHE-LE D'ABORD DANS LE COFFRE-FORT/);
  assert.match(consigne, /Ne dis JAMAIS « je n'ai pas accès »/);
  // Il reste court : la règle tient en une phrase, pas en un déroulé.
  assert.doesNotMatch(consigne, /MÉTHODE DE TRAVAIL IMPOSÉE/);
});

test('l’assistant des sauvegardes liste le coffre avant de demander un mot de passe', () => {
  assert.match(CONSIGNE_ASSISTANT_BACKUP, /LE COFFRE-FORT AVANT LA QUESTION/);
  assert.match(CONSIGNE_ASSISTANT_BACKUP, /coffre_fort/);
  assert.match(CONSIGNE_ASSISTANT_BACKUP, /Ne dis jamais « je n'ai pas accès »/);
});

test('le rappel envoyé aux tours suivants porte aussi la règle', () => {
  for (const engine of MOTEURS) {
    const rappel = rappelDeMethode(engine);
    assert.match(rappel, /coffre_fort/, engine);
    assert.match(rappel, /ne renvoie jamais la balle/, engine);
  }
});

/*
 * La consigne ne vaut que si l'outil est RÉELLEMENT servi. Un rôle privé de
 * `coffre_fort` s'entendrait ordonner de chercher là où il ne peut pas aller.
 */
test('l’outil du coffre-fort est servi à tous les rôles, cadrage compris', () => {
  for (const role of ROLES) {
    const noms = toolsFor(role).map((t) => t.name);
    assert.ok(noms.includes('coffre_fort'), `Rôle « ${role} » doit avoir « coffre_fort »`);
  }
});
