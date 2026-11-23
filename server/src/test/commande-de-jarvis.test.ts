import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClientCommand,
  catalogueDesCommandes,
  outilServiALaVoix,
  verdictDeLaCommande,
  resumeDeLaCommande,
} from '@beluga/shared';

/*
 * LA COMMANDE GÉNÉRALE DE JARVIS (17/11/2026) : tout ce qu'un clic fait, sauf une liste fermée minimale ; ce qui ne se
 * défait pas attend le « oui » dit à voix haute.
 */

test('la session, la voix et le redémarrage du démon sont fermés à Jarvis', () => {
  for (const type of ['hello', 'ping', 'voix.direct.demarrer', 'jarvis.geste.fait', 'comptes.motDePasse', 'espace.moi.motDePasse', 'daemon.restart']) {
    const v = verdictDeLaCommande(type);
    assert.equal(v.ok, false, type);
  }
  assert.equal(verdictDeLaCommande('').ok, false);
});

test('ce qui ne se défait pas demande la confirmation ; le reste passe sans question', () => {
  const confirmer = (type: string, donnees: Record<string, unknown> = {}) => {
    const v = verdictDeLaCommande(type, donnees);
    return v.ok ? v.aConfirmer ?? null : 'fermee';
  };
  assert.equal(confirmer('card.delete'), 'une suppression');
  assert.equal(confirmer('project.supprimerDefinitivement'), 'une suppression');
  assert.equal(confirmer('espace.fil.envoyer'), 'un message à un client');
  assert.equal(confirmer('billing.push'), 'un paiement');
  assert.equal(confirmer('production.placer'), 'une mise en production');
  assert.equal(confirmer('deploy.start', { cible: 'production' }), 'une mise en production');
  // Décision du 17/11/2026 : déployer sur ce serveur, lancer, créer, modifier — sans question.
  assert.equal(confirmer('deploy.start', { cible: 'dev' }), null);
  assert.equal(confirmer('card.start'), null);
  assert.equal(confirmer('card.update'), null);
  assert.equal(confirmer('agent.prompt'), null);
  assert.equal(confirmer('settings.update'), null);
});

test('le catalogue est lu sur le protocole réel, rangé par famille, filtrable', () => {
  const options = (ClientCommand as unknown as { options: { shape: Record<string, any> }[] }).options;
  const commandes = options.map((o) => ({ type: String(o.shape.type.value), champs: Object.keys(o.shape).filter((k) => k !== 'type') }));
  assert.ok(commandes.length > 200, `${commandes.length} commandes`);
  const tout = catalogueDesCommandes(commandes);
  assert.match(tout, /## card — /);
  assert.match(tout, /- card\.update\(/);
  assert.match(tout, /- card\.delete\(.*À CONFIRMER/);
  assert.doesNotMatch(tout, /voix\.direct\.demarrer|daemon\.restart|- hello\(/);
  const cartes = catalogueDesCommandes(commandes, 'deploy');
  assert.match(cartes, /deploy\.start/);
  assert.doesNotMatch(cartes, /studio\./);
  assert.match(catalogueDesCommandes(commandes, 'zzzz-rien'), /Aucune commande/);
  assert.match(resumeDeLaCommande('card.start'), /lancer/);
});

test('la voix reçoit tous les outils, sauf ceux propres au tour d’une carte', () => {
  for (const nom of ['services', 'chrome', 'ordinateur', 'capture', 'write_document', 'exemple_de_choix', 'veille_poser', 'remember', 'board_create_card']) {
    assert.equal(outilServiALaVoix(nom), true, nom);
  }
  for (const nom of ['rendre_comprehension', 'rendre_plan', 'rendre_reparation', 'bilan_du_travail', 'cahier_rendre']) {
    assert.equal(outilServiALaVoix(nom), false, nom);
  }
});
