import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSERVATION_MAX,
  CONSERVATION_PAR_DEFAUT,
  SiteASauvegarder,
  conservationDemandee,
  demandeDeConfiguration,
  ficheProposee,
  jugerSite,
  moteurDemande,
  moyenDemande,
  raisonDemandeRefusee,
  siteVierge,
  titreDeLAssistantSnapshot,
} from '@haikodev/shared';

/**
 * L'ASSISTANT DE CONFIGURATION DES SNAPSHOTS — ce qui se juge sans moteur.
 *
 * Ce que ces tests verrouillent : un modèle qui écrit « MariaDB » ou « ftps »
 * est compris, ce qu'il oublie ne s'invente pas, une correction ne perd pas le
 * mot de passe déjà enregistré, la fiche reste jugée comme celle du formulaire,
 * et une demande vide n'ouvre aucun tour payant.
 */

test('les mots d’un moteur de base sont compris, quelle que soit la tournure', () => {
  assert.equal(moteurDemande('MariaDB'), 'mysql');
  assert.equal(moteurDemande('PostgreSQL 16'), 'postgres');
  assert.equal(moteurDemande('SQLite (fichier)'), 'sqlite');
  assert.equal(moteurDemande('aucune base'), 'aucune');
  assert.equal(moteurDemande('oracle'), undefined);
});

test('les moyens d’atteindre les fichiers acceptent les synonymes', () => {
  assert.equal(moyenDemande('SFTP'), 'ssh');
  assert.equal(moyenDemande('FTPS'), 'ftp');
  assert.equal(moyenDemande('dossier de cette machine'), 'local');
  assert.equal(moyenDemande('aucun'), 'aucun');
  assert.equal(moyenDemande('pigeon voyageur'), undefined);
});

test('une conservation écrite « 30 jours » devient un nombre, et reste dans ses bornes', () => {
  assert.equal(conservationDemandee('30 jours'), 30);
  assert.equal(conservationDemandee(9999), CONSERVATION_MAX);
  assert.equal(conservationDemandee('bientôt'), undefined);
});

test('une fiche proposée sans conservation garde le défaut, et son moteur est traduit', () => {
  const fiche = ficheProposee({
    nom: 'Boutique',
    base: { moteur: 'MariaDB', nom: 'boutique', utilisateur: 'root', motDePasse: 'secret' },
  });
  assert.equal(fiche.base.moteur, 'mysql');
  assert.equal(fiche.conservationJours, CONSERVATION_PAR_DEFAUT);
  assert.equal(jugerSite(fiche).ok, true);
});

test('ce que l’agent n’a pas dit n’est pas inventé : la fiche est refusée en le disant', () => {
  const fiche = ficheProposee({ nom: 'Site nu' });
  const jugement = jugerSite(fiche);
  assert.equal(jugement.ok, false);
  assert.match(jugement.raison ?? '', /ne sauvegarderait rien/);
});

test('corriger une fiche existante ne perd pas le mot de passe déjà enregistré', () => {
  const ancienne: SiteASauvegarder = {
    ...siteVierge(null, 'Boutique'),
    id: 's1',
    base: { moteur: 'mysql', hote: 'db', port: '3306', nom: 'prod', utilisateur: 'root', motDePasse: 'secret' },
    conservationJours: 30,
  };
  const fiche = ficheProposee({ id: 's1', note: 'la boutique du client' }, ancienne);
  assert.equal(fiche.base.motDePasse, 'secret');
  assert.equal(fiche.conservationJours, 30);
  assert.equal(fiche.note, 'la boutique du client');
});

test('changer de moteur ne traîne pas les identifiants de l’ancien', () => {
  const ancienne: SiteASauvegarder = {
    ...siteVierge(null, 'Boutique'),
    id: 's1',
    base: { moteur: 'mysql', hote: 'db', port: '3306', nom: 'prod', utilisateur: 'root', motDePasse: 'secret' },
  };
  const fiche = ficheProposee({ base: { moteur: 'sqlite', nom: '/var/www/base.sqlite' } }, ancienne);
  assert.equal(fiche.base.moteur, 'sqlite');
  assert.equal(fiche.base.motDePasse, '');
  assert.equal(fiche.base.nom, '/var/www/base.sqlite');
});

test('la demande envoyée à l’agent nomme le projet et les valeurs acceptées', () => {
  const demande = demandeDeConfiguration({
    description: 'Maestria60+, le site du client',
    projet: { id: 'p1', nom: 'Maestria', chemin: '/root/maestria' },
  });
  assert.match(demande, /Maestria60\+/);
  assert.match(demande, /p1/);
  assert.match(demande, /\/root\/maestria/);
  assert.match(demande, /postgres/);
  assert.match(demande, /snapshot_site/);
});

test('un site extérieur n’hérite d’aucun projet, et on le dit à l’agent', () => {
  const demande = demandeDeConfiguration({ description: 'un site chez un hébergeur', projet: null });
  assert.match(demande, /aucun projet/);
});

test('une demande vide est refusée avant tout appel au moteur', () => {
  assert.ok(raisonDemandeRefusee('  '));
  assert.equal(raisonDemandeRefusee('la boutique du client'), null);
});

test('le titre de la conversation reprend la demande, raccourcie', () => {
  assert.equal(titreDeLAssistantSnapshot('Boutique'), 'Snapshots — Boutique');
  assert.ok(titreDeLAssistantSnapshot('x'.repeat(200)).length < 70);
});
