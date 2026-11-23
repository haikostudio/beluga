import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDES_CLIENT,
  COMMANDES_FERMEES_AU_CLIENT,
  EVENEMENTS_CLIENT,
  MENTIONS_ACCES_OUVERT,
  ROUTES_API_CLIENT,
  VERSION_TEXTE_ACCES,
  TEXTE_ACCES_MAX,
  archiveTelechargeable,
  backupsDuProjet,
  contenuDAccesVisible,
  etatDeLAcces,
  lireTexteDAcces,
  nomDeLArchive,
  refusDeDeverrouiller,
  siteVierge,
  type PointDeSauvegarde,
} from '@beluga/shared';

const point = (champs: Partial<PointDeSauvegarde>): PointDeSauvegarde => ({
  id: 'p',
  siteId: 's1',
  debut: 1,
  fin: 2,
  statut: 'reussi',
  octetsBase: 0,
  octetsFichiers: 0,
  chemin: '/stockage/p',
  detail: '',
  origine: 'automatique',
  cheminArchive: '/stockage/p.zip',
  taille: 10,
  ...champs,
});

test('backups du client : seules les archives réussies de SON projet, de la plus récente à la plus ancienne', () => {
  const siteDuProjet = { ...siteVierge('projet-a', 'Boutique'), id: 's1' };
  const siteVoisin = { ...siteVierge('projet-b', 'Voisin'), id: 's2' };
  const siteExterieur = { ...siteVierge(null, 'Extérieur'), id: 's3' };
  const points = [
    point({ id: 'ancien', debut: 100 }),
    point({ id: 'recent', debut: 300 }),
    point({ id: 'echec', debut: 400, statut: 'echec', cheminArchive: '' }),
    point({ id: 'partiel', debut: 500, statut: 'partiel' }),
    point({ id: 'sans-archive', debut: 600, cheminArchive: '' }),
    point({ id: 'voisin', siteId: 's2', debut: 700 }),
    point({ id: 'exterieur', siteId: 's3', debut: 800 }),
  ];
  const vus = backupsDuProjet('projet-a', [siteDuProjet, siteVoisin, siteExterieur], points);
  assert.equal(vus.length, 1);
  assert.deepEqual(
    vus[0]!.archives.map((a) => a.pointId),
    ['recent', 'ancien'],
  );
  // Le chemin disque ne sort jamais du serveur.
  assert.ok(!JSON.stringify(vus).includes('/stockage'));
  assert.equal(archiveTelechargeable({ statut: 'partiel', cheminArchive: '/x.zip' }), false);
});

test('le nom d’une archive téléchargée est lisible et sans caractère piégé', () => {
  const nom = nomDeLArchive('Café « Été » / prod', Date.UTC(2026, 8, 11, 5, 35));
  assert.equal(nom, 'backup-cafe-ete-prod-2026-09-11-05-35.zip');
});

test('espace « Accès » : verrouillé par défaut, le journal décide, Haiko seul referme', () => {
  assert.deepEqual(etatDeLAcces([]), { ouvert: false });
  const ouvert = etatDeLAcces([{ geste: 'deverrouillage', nom: 'Client Un', le: 10, version: 1 }]);
  assert.equal(ouvert.ouvert, true);
  assert.equal(ouvert.ouvertPar, 'Client Un');
  assert.equal(ouvert.ouvertLe, 10);
  const referme = etatDeLAcces([
    { geste: 'reverrouillage', nom: 'Haiko', le: 20, version: 1 },
    { geste: 'deverrouillage', nom: 'Client Un', le: 10, version: 1 },
  ]);
  assert.equal(referme.ouvert, false, 'le dernier geste EN DATE décide, pas l’ordre reçu');

  assert.equal(contenuDAccesVisible('client', { ouvert: false }), false);
  assert.equal(contenuDAccesVisible('client', { ouvert: true }), true);
  assert.equal(contenuDAccesVisible('admin', { ouvert: false }), true);
});

test('espace « Accès » : l’ouverture exige la case cochée, sur le texte en vigueur', () => {
  assert.ok(refusDeDeverrouiller({ confirme: false, version: VERSION_TEXTE_ACCES }));
  assert.ok(refusDeDeverrouiller({ confirme: 'true', version: VERSION_TEXTE_ACCES }), 'une chaîne n’est pas une confirmation');
  assert.ok(refusDeDeverrouiller({ confirme: true, version: VERSION_TEXTE_ACCES - 1 }));
  assert.equal(refusDeDeverrouiller({ confirme: true, version: VERSION_TEXTE_ACCES }), null);
  assert.equal(MENTIONS_ACCES_OUVERT.length, 3);
  assert.ok(MENTIONS_ACCES_OUVERT.some((m) => m.includes('contrat de maintenance')));
});

test('espace « Accès » : un texte trop long est refusé, jamais coupé', () => {
  const lu = lireTexteDAcces('  hôte : exemple\r\nutilisateur : x  ');
  assert.ok(lu.ok && lu.texte === 'hôte : exemple\nutilisateur : x');
  const trop = lireTexteDAcces('a'.repeat(TEXTE_ACCES_MAX + 5));
  assert.ok(!trop.ok && trop.raison.includes('5'));
});

test('la cloison : lire et ouvrir sont ouverts au client, écrire et refermer restent à Haiko', () => {
  for (const commande of ['espace.backups.lister', 'espace.backups.telecharger', 'espace.acces.lire', 'espace.acces.deverrouiller']) {
    assert.ok(COMMANDES_CLIENT.includes(commande), commande);
  }
  for (const commande of ['espace.acces.ecrire', 'espace.acces.reverrouiller']) {
    assert.ok(!COMMANDES_CLIENT.includes(commande), commande);
    assert.ok(COMMANDES_FERMEES_AU_CLIENT.includes(commande), commande);
  }
  assert.ok(EVENEMENTS_CLIENT.includes('espace.acces'));
  assert.ok(ROUTES_API_CLIENT.includes('/api/download'));
});
