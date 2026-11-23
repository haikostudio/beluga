import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClientCommand,
  PropositionDuCentral,
  TAILLE_D_UN_MORCEAU,
  dossierDuProjetDansLePaquet,
  dossiersDeProjetsAEmporter,
  filtreDePaiementLu,
  nombreDeMorceaux,
  volumeLisible,
} from '@beluga/shared';

test('les dossiers de projets du paquet : hors des données, sans doublon ni dossier contenu dans un autre', () => {
  const projets = [
    { id: 'a', chemin: '/home/beluga/projets/site' },
    { id: 'b', chemin: '/home/beluga/projets/site/sous-dossier' },
    { id: 'c', chemin: '/opt/beluga/data/projets/interne' },
    { id: 'd', chemin: '/home/beluga/projets/app/' },
    { id: 'e', chemin: '' },
    { id: 'f', chemin: 'relatif/ailleurs' },
  ];
  assert.deepEqual(
    dossiersDeProjetsAEmporter(projets, '/opt/beluga/data').map((p) => p.id).sort(),
    ['a', 'd'],
  );
});

test('un projet a un dossier lisible et unique dans le paquet', () => {
  assert.equal(dossierDuProjetDansLePaquet({ id: 'f3a9-1c2d-77', nom: 'Site Éloïse & Co' }), 'site-eloise-co-f3a91c2d');
  assert.equal(dossierDuProjetDansLePaquet({ id: 'x', nom: '***' }), 'projet-x');
});

test('le paquet part en morceaux de 8 Mio, au moins un', () => {
  assert.equal(nombreDeMorceaux(0), 1);
  assert.equal(nombreDeMorceaux(TAILLE_D_UN_MORCEAU), 1);
  assert.equal(nombreDeMorceaux(TAILLE_D_UN_MORCEAU + 1), 2);
});

test('le volume se lit en Go ou en Mo', () => {
  assert.equal(volumeLisible(2_500_000_000, 'fr-FR'), '2,5 Go');
  assert.equal(volumeLisible(340_000_000, 'fr-FR'), '340 Mo');
});

test('la proposition du central est vérifiée avant d’être affichée', () => {
  const bonne = { formule: { id: 'freelance', nom: 'Freelance', prixMensuel: 47, projets: 7, go: 80 }, lien: 'https://compte.exemple.com/abonnement?j=x', jeton: 'j'.repeat(32) };
  assert.equal(PropositionDuCentral.safeParse(bonne).success, true);
  assert.equal(PropositionDuCentral.safeParse({ ...bonne, lien: 'pas une adresse' }).success, false);
  assert.equal(PropositionDuCentral.safeParse({ ...bonne, jeton: 'court' }).success, false);
});

test('les commandes de l’offre et du transfert existent, le jeton est exigé', () => {
  assert.equal(ClientCommand.safeParse({ type: 'installation.offre' }).success, true);
  assert.equal(ClientCommand.safeParse({ type: 'installation.transfert', jeton: 'j'.repeat(32) }).success, true);
  assert.equal(ClientCommand.safeParse({ type: 'installation.transfert' }).success, false);
});

test('le filtre des installations : l’ancien nom « open-source » vaut « gratuites »', () => {
  assert.equal(filtreDePaiementLu('open-source'), 'gratuites');
  assert.equal(filtreDePaiementLu('gratuites'), 'gratuites');
  assert.equal(filtreDePaiementLu('payants'), 'payants');
  assert.equal(filtreDePaiementLu('n’importe quoi'), 'tous');
});
