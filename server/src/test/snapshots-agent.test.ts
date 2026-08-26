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
  PointDeSauvegarde,
  demandeDeRelecture,
  descriptionDuProjetSansFiche,
  echecsDeSuite,
  essaisConcluants,
  phraseDesEssais,
  raisonDemandeRefusee,
  resumeDeFiche,
  siteARelire,
  siteVierge,
  titreDeLAssistantSnapshot,
  titreDeLaRelecture,
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


/* ------------------------------------------------------------------ */
/* Essayer les accès, et relire une fiche qui échoue                    */
/* ------------------------------------------------------------------ */

function point(debut: number, statut: 'reussi' | 'partiel' | 'echec', detail = ''): PointDeSauvegarde {
  return {
    id: `p${debut}`,
    siteId: 's1',
    debut,
    fin: debut + 1,
    statut,
    octetsBase: 0,
    octetsFichiers: 0,
    chemin: '',
    detail,
    origine: 'automatique',
  };
}

test('un essai n’est concluant que si tout ce qui a été essayé répond', () => {
  assert.equal(
    essaisConcluants([
      { cible: 'base', essaye: true, ok: true, detail: 'ouverte' },
      { cible: 'fichiers', essaye: false, ok: true, detail: 'rien à essayer' },
    ]),
    true,
  );
  assert.equal(
    essaisConcluants([
      { cible: 'base', essaye: true, ok: false, detail: 'accès refusé' },
      { cible: 'fichiers', essaye: true, ok: true, detail: 'listé' },
    ]),
    false,
  );
});

test('l’essai rend la raison de la machine, pas seulement un refus', () => {
  const phrase = phraseDesEssais([
    { cible: 'base', essaye: true, ok: false, detail: 'Access denied for user « web »' },
    { cible: 'fichiers', essaye: false, ok: true, detail: 'cette fiche n’en prend pas' },
  ]);
  assert.match(phrase, /NE RÉPOND PAS/);
  assert.match(phrase, /Access denied/);
  assert.match(phrase, /rien à essayer/);
});

test('les échecs se comptent DE SUITE : un succès remet le compteur à zéro', () => {
  assert.equal(echecsDeSuite([point(3, 'echec'), point(2, 'echec'), point(1, 'reussi')]), 2);
  assert.equal(echecsDeSuite([point(3, 'reussi'), point(2, 'echec'), point(1, 'echec')]), 0);
  assert.equal(echecsDeSuite([]), 0);
});

test('une fiche est relue après trois échecs, jamais deux fois le même jour', () => {
  const site = { ...siteVierge(null, 'Boutique'), id: 's1' };
  const echecs = [point(3, 'echec'), point(2, 'echec'), point(1, 'echec')];
  assert.equal(siteARelire(site, echecs, 10), true);
  assert.equal(siteARelire(site, [point(2, 'echec'), point(1, 'echec')], 10), false);
  assert.equal(siteARelire({ ...site, actif: false }, echecs, 10), false);
  const relueHier = { ...site, relueLe: 10 - 3600 * 1000 };
  assert.equal(siteARelire(relueHier, echecs, 10), false);
  const relueIlYALongtemps = { ...site, relueLe: 10 };
  assert.equal(siteARelire(relueIlYALongtemps, echecs, 10 + 21 * 3600 * 1000), true);
});

test('la demande de relecture porte la fiche et les messages de la machine', () => {
  const site: SiteASauvegarder = {
    ...siteVierge('p1', 'Boutique'),
    id: 's1',
    base: { moteur: 'mysql', hote: '', port: '', nom: 'boutique', utilisateur: 'web', motDePasse: 'secret' },
  };
  const demande = demandeDeRelecture({ site, echecs: [point(3, 'echec', 'Access denied for user')] });
  assert.match(demande, /s1/);
  assert.match(demande, /Access denied/);
  assert.match(demande, /snapshot_essai/);
  // Le mot de passe reste en base : il n'a rien à faire dans la demande.
  assert.equal(demande.includes('secret'), false);
  assert.equal(resumeDeFiche(site).includes('secret'), false);
});

test('un projet sans fiche part avec une phrase déjà écrite', () => {
  const phrase = descriptionDuProjetSansFiche({ nom: 'Maestria', chemin: '/root/maestria' });
  assert.match(phrase, /Maestria/);
  assert.match(phrase, /\/root\/maestria/);
  assert.match(descriptionDuProjetSansFiche({ nom: 'Maestria' }), /Maestria/);
});

test('le titre d’une relecture dit qu’on répare, et reste court', () => {
  assert.equal(titreDeLaRelecture('Boutique'), 'Snapshots — réparer Boutique');
  assert.ok(titreDeLaRelecture('x'.repeat(200)).length < 70);
});
