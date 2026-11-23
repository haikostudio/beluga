/**
 * L'ESPACE CLIENT PAR COLONNE : FILTRE, RECHERCHE, COMPTE DES MASQUÉES — ET
 * L'IMPORTANCE OUVERTE AU CLIENT, AVEC SA TRACE.
 *
 * Ce que ces essais verrouillent : filtrer une colonne ne touche pas les
 * autres ; la recherche regarde le titre, la description et les étiquettes ; la
 * pastille compte exactement ce que le filtre ET la recherche cachent ; un
 * réglage gardé sous l'ANCIENNE forme est ignoré sans erreur ; un client change
 * l'importance d'une demande de Haiko, jamais sa livraison annoncée ; et le
 * changement garde ses deux bouts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Demande,
  changementDImportance,
  champsModifiables,
  correspondALaRecherche,
  ecrireReglagesDesColonnes,
  filtresActifs,
  lireReglagesDesColonnes,
  patchAutorise,
  reglagesDeDepart,
  vueDeLaColonne,
} from '@beluga/shared';

function demandeDEssai(patch: Record<string, unknown> = {}) {
  return Demande.parse({
    id: 'd', projectId: 'p', auteurId: 'haiko', auteurNom: 'Haiko', titre: 'T',
    rang: 1000, creeeLe: 1, derniereActivite: 1, ...patch,
  });
}

const LOT = [
  demandeDEssai({ id: 'a', colonne: 'a-faire', titre: 'Page de contact', etiquettes: ['site'], rang: 1 }),
  demandeDEssai({ id: 'b', colonne: 'a-faire', titre: 'Facture de mai', importance: 'haute', rang: 2 }),
  demandeDEssai({ id: 'c', colonne: 'a-faire', titre: 'Logo', etiquettes: ['site'], archiveeLe: 9, rang: 3 }),
  demandeDEssai({ id: 'd', colonne: 'termine', titre: 'Menu', etiquettes: ['site'], rang: 1 }),
];

test('filtrer une colonne ne touche pas les autres', () => {
  const aFaire = vueDeLaColonne(LOT, 'a-faire', { filtre: { importance: 'haute' } });
  const termine = vueDeLaColonne(LOT, 'termine', {});
  assert.deepEqual(aFaire.cartes.map((d) => d.id), ['b']);
  assert.deepEqual(termine.cartes.map((d) => d.id), ['d']);
});

test('les demandes archivées sont un filtre de COLONNE, chacune indépendante', () => {
  /*
   * LE DÉFAUT QU'ON VERROUILLE : la bascule vivait dans le menu burger et
   * retournait le TABLEAU ENTIER — relire une demande rangée de « Terminé »
   * vidait les trois autres colonnes. Chaque colonne porte donc le sien.
   */
  const archivesDeAFaire = vueDeLaColonne(LOT, 'a-faire', { filtre: { archivees: true } });
  assert.deepEqual(archivesDeAFaire.cartes.map((d) => d.id), ['c']);
  // Aucune masquée : ce n'est pas un filtre qui cache, c'est une AUTRE liste.
  assert.equal(archivesDeAFaire.masquees, 0);

  // Et « Terminé », qui n'a rien demandé, garde ses demandes vivantes.
  assert.deepEqual(vueDeLaColonne(LOT, 'termine', {}).cartes.map((d) => d.id), ['d']);
  assert.deepEqual(vueDeLaColonne(LOT, 'termine', { filtre: { archivees: true } }).cartes, []);

  // Sans le filtre, une demande rangée n'apparaît nulle part.
  assert.deepEqual(vueDeLaColonne(LOT, 'a-faire', {}).cartes.map((d) => d.id), ['a', 'b']);
});

test('la pastille compte ce que le filtre ET la recherche cachent, archivées écartées', () => {
  assert.equal(vueDeLaColonne(LOT, 'a-faire', {}).masquees, 0);
  assert.equal(vueDeLaColonne(LOT, 'a-faire', { recherche: 'facture' }).masquees, 1);
  assert.equal(vueDeLaColonne(LOT, 'a-faire', { recherche: 'site', filtre: { importance: 'haute' } }).masquees, 2);
  // La demande archivée n'est ni montrée ni comptée parmi les masquées.
  assert.equal(vueDeLaColonne(LOT, 'a-faire', { recherche: 'zzz' }).masquees, 2);
});

test('la recherche regarde le titre, la description et les étiquettes', () => {
  const d = demandeDEssai({ titre: 'Titre', description: 'Le corps', etiquettes: ['Compta'] });
  assert.equal(correspondALaRecherche(d, 'titre'), true);
  assert.equal(correspondALaRecherche(d, 'corps'), true);
  assert.equal(correspondALaRecherche(d, 'compta'), true);
  assert.equal(correspondALaRecherche(d, 'absent'), false);
  assert.equal(correspondALaRecherche(d, '   '), true);
});

test('les réglages gardés se relisent, et l’ancienne forme est ignorée sans erreur', () => {
  const reglages = reglagesDeDepart();
  reglages.filtres['a-faire'] = { etiquette: 'site', nonLues: true };
  reglages.tris.termine = 'echeance';
  const relus = lireReglagesDesColonnes(ecrireReglagesDesColonnes(reglages));
  assert.deepEqual(relus.filtres['a-faire'], {
    etiquette: 'site',
    importance: undefined,
    nonLues: true,
    archivees: undefined,
  });
  assert.equal(relus.tris.termine, 'echeance');
  assert.equal(filtresActifs(relus.filtres['a-faire']), 2);

  /* LES DEMANDES ARCHIVÉES SONT UN FILTRE DE COLONNE, gardé comme les autres —
     et il compte, lui aussi, parmi les réglages posés. */
  const avecArchives = reglagesDeDepart();
  avecArchives.filtres.termine = { archivees: true };
  const relusArchives = lireReglagesDesColonnes(ecrireReglagesDesColonnes(avecArchives));
  assert.equal(relusArchives.filtres.termine.archivees, true);
  assert.equal(relusArchives.filtres['a-faire'].archivees, undefined);
  assert.equal(filtresActifs(relusArchives.filtres.termine), 1);

  // L'ancien filtre unique du tableau, sans version : on repart du départ.
  assert.deepEqual(lireReglagesDesColonnes(JSON.stringify({ texte: 'x', etiquette: 'site' })), reglagesDeDepart());
  assert.deepEqual(lireReglagesDesColonnes('{pas du json'), reglagesDeDepart());
  // Une valeur inconnue retombe, champ par champ.
  const bancal = lireReglagesDesColonnes(JSON.stringify({ version: 2, tris: { 'a-faire': 'hasard' }, filtres: { 'a-faire': { importance: 'folle' } } }));
  assert.equal(bancal.tris['a-faire'], 'rang');
  assert.equal(bancal.filtres['a-faire'].importance, undefined);
});

test('un client change l’importance d’une demande de Haiko, jamais sa livraison annoncée', () => {
  assert.equal(champsModifiables('client', false).includes('importance'), true);
  assert.equal(champsModifiables('client', false).includes('livraisonAnnoncee'), false);
  const tamise = patchAutorise({ importance: 'urgente', echeance: 5, etiquettes: ['x'], livraisonAnnoncee: 9 }, 'client', false);
  assert.deepEqual(tamise, { importance: 'urgente', echeance: 5, etiquettes: ['x'] });
});

test('un changement d’importance garde ses deux bouts', () => {
  assert.deepEqual(changementDImportance({ importance: 'normale' }, { importance: 'haute' }), {
    importanceAvant: 'normale',
    importanceApres: 'haute',
  });
  assert.equal(changementDImportance({ importance: 'basse' }, { importance: 'basse' }), null);
});
