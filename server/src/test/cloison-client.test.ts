/**
 * LE CLOISONNEMENT REFUSE PAR DÉFAUT.
 *
 * Ce que ces essais verrouillent : une commande, un événement ou une route qui
 * n'est pas NOMMÉE dans la grille est fermée à un client — y compris une
 * commande qui n'existe pas encore. C'est le seul vrai risque de sécurité de
 * l'espace client, et il se ferme par un refus par défaut plutôt que par une
 * liste d'interdictions qu'on oublierait de tenir à jour.
 *
 * Le contrôle qui passe en revue le protocole ENTIER vit à part
 * (`scripts/verif-cloison-client.mjs`) : il lit les commandes réelles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDES_CLIENT,
  COMMANDES_FERMEES_AU_CLIENT,
  EVENEMENTS_CLIENT,
  REFUS_HORS_PORTEE,
  ROUTES_API_CLIENT,
  champsModifiables,
  commandeAutorisee,
  evenementAutorise,
  patchAutorise,
  refusDePortee,
  routeApiAutorisee,
} from '@beluga/shared';

test('un administrateur passe partout', () => {
  assert.equal(commandeAutorisee('admin', 'card.delete'), true);
  assert.equal(evenementAutorise('admin', 'agent.upsert'), true);
  assert.equal(routeApiAutorisee('admin', '/api/terminal'), true);
});

test('une commande neuve est FERMÉE à un client, sans que personne y pense', () => {
  assert.equal(commandeAutorisee('client', 'commande.inventee.demain'), false);
  assert.equal(commandeAutorisee('client', 'card.delete'), false);
  assert.equal(commandeAutorisee('client', 'project.list'), false);
  assert.equal(commandeAutorisee('client', 'comptes.creer'), false);
});

test('seules les commandes nommées sont ouvertes à un client', () => {
  for (const type of COMMANDES_CLIENT) assert.equal(commandeAutorisee('client', type), true);
  assert.equal(COMMANDES_CLIENT.includes('espace.demande.enCarte'), false);
  assert.equal(COMMANDES_CLIENT.includes('espace.clients'), false);
  assert.equal(COMMANDES_CLIENT.includes('espace.tableauDeBord'), false);
});

test('les commandes de l’espace ajoutées au chantier sont explicitement tranchées', () => {
  // OUVERTES : ranger une demande, dire qu'on l'a lue, relire son historique.
  for (const type of ['espace.demande.archiver', 'espace.demande.marquerLu', 'espace.demande.activite']) {
    assert.equal(commandeAutorisee('client', type), true, type);
  }
  // FERMÉES, et nommées comme telles pour que l'oubli se voie.
  for (const type of COMMANDES_FERMEES_AU_CLIENT) {
    assert.equal(commandeAutorisee('client', type), false, type);
    assert.equal(COMMANDES_CLIENT.includes(type), false, type);
  }
  assert.equal(commandeAutorisee('client', 'comptes.courriel'), false);
});

test('les événements de l’espace ajoutés au chantier sont explicitement tranchés', () => {
  for (const type of ['espace.activite', 'espace.nonLus']) {
    assert.equal(evenementAutorise('client', type), true, type);
  }
  // Le chiffre de la pastille est un événement CLIENT : il ne remplace pas
  // `notify`, qui reste fermé et ne part qu'aux administrateurs.
  assert.equal(evenementAutorise('client', 'notify'), false);
});

test('VOIR n’est pas RÉÉCRIRE : ce qu’un client peut modifier est borné', () => {
  // Sur SA demande : tout sauf la date de livraison annoncée par Haiko.
  const siennes = champsModifiables('client', true);
  assert.equal(siennes.includes('titre'), true);
  assert.equal(siennes.includes('livraisonAnnoncee'), false);

  // Sur celle d'un autre : cocher, étiqueter, dire quand il en aurait besoin
  // et changer l'importance — la priorité de son projet lui appartient aussi.
  // Plus de « réponse attendue » : ce champ n'existe plus, ce qui attend
  // quelqu'un se LIT dans ses messages non lus.
  const autres = champsModifiables('client', false);
  assert.deepEqual([...autres].sort(), ['echeance', 'etiquettes', 'importance', 'taches']);

  // Un administrateur écrit tout.
  assert.equal(champsModifiables('admin', false).includes('livraisonAnnoncee'), true);

  // Et le tamis JETTE ce qui n'est pas permis, au lieu de refuser tout le patch.
  const tamise = patchAutorise({ titre: 'volé', echeance: 42, livraisonAnnoncee: 99 }, 'client', false);
  assert.deepEqual(tamise, { echeance: 42 });
});

test('un client ne reçoit aucun événement d’agent, de carte, de quota ou de publication', () => {
  for (const type of ['agent.upsert', 'card.upsert', 'quotas', 'deploy', 'ready', 'toast']) {
    assert.equal(evenementAutorise('client', type), false, type);
  }
  for (const type of EVENEMENTS_CLIENT) assert.equal(evenementAutorise('client', type), true);
});

test('une route /api/ non nommée est refusée à un client', () => {
  assert.equal(routeApiAutorisee('client', '/api/terminal'), false);
  assert.equal(routeApiAutorisee('client', '/api/file'), false);
  assert.equal(routeApiAutorisee('client', '/api/digest'), false);
  for (const route of ROUTES_API_CLIENT) assert.equal(routeApiAutorisee('client', route), true);
});

test('la portée se vérifie au serveur, et un projet non coché est refusé', () => {
  assert.equal(refusDePortee('client', ['p1'], 'p1'), null);
  assert.equal(refusDePortee('client', ['p1'], 'p2'), REFUS_HORS_PORTEE);
  assert.equal(refusDePortee('client', ['p1'], undefined), REFUS_HORS_PORTEE);
  assert.equal(refusDePortee('admin', [], 'p9'), null);
});

test('le refus ne dit jamais ce qui existe derrière', () => {
  assert.equal(REFUS_HORS_PORTEE.includes('projet'), false);
  assert.equal(REFUS_HORS_PORTEE.includes('droit'), false);
});
