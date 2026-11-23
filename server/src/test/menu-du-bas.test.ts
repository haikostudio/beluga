import test from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@beluga/shared';

/*
 * LE BAS DE L'ÉCRAN DU TÉLÉPHONE, ÉCRAN PAR ÉCRAN (03/11/2026, carte « Refonte de la navigation mobile ») — ce qui
 * ne doit jamais casser :
 *  - trois formes seulement : aucun, un bouton pleine largeur, des boutons répartis ;
 *  - aucun geste inconnu, aucun doublon ;
 *  - les écrans que l'utilisateur a voulus SANS bas n'en ont pas (Messagerie, Backup, Surveillance, Marketing) ;
 *  - un projet : plus rien en bas (« Publier » est dans le haut, 13/11/2026) ;
 *  - une marque de Communication : Accueil, Campagnes | chevron (Médias, Canaux, Stratégie) | Publications, Messages.
 */

/** Les gestes qu'un bas montre, dans l'ordre de l'écran (gauche, centre, droite, puis la feuille du chevron). */
function gestesDuMenu(menu: shared.MenuDuBas): shared.GesteDuMenuDuBas[] {
  if (menu.forme === 'aucun') return [];
  if (menu.forme === 'pleine-largeur') return menu.geste === 'page' ? [] : [menu.geste];
  const centre = !menu.centre ? [] : menu.centre.genre === 'action' ? [menu.centre.geste] : [...menu.centre.gestes];
  return [...menu.gauche, ...centre, ...menu.droite];
}

const ECRANS: shared.EcranDuBas[] = [...shared.VUES_CENTRALES, 'tableaux-de-bord', ...shared.NIVEAUX_DECLARES];

test('chaque écran a une forme connue, sans geste inconnu ni doublon', () => {
  for (const ecran of ECRANS) {
    const menu = shared.menuDuBas(ecran);
    assert.ok(['aucun', 'pleine-largeur', 'repartis'].includes(menu.forme), ecran);
    const gestes = gestesDuMenu(menu);
    assert.equal(new Set(gestes).size, gestes.length, `${ecran} : pas de doublon`);
    for (const geste of gestes) assert.ok(shared.GESTES_DU_MENU_DU_BAS.includes(geste), `${ecran} : ${geste}`);
    if (menu.forme === 'repartis') assert.ok(menu.gauche.length + menu.droite.length + (menu.centre ? 1 : 0) <= 5, `${ecran} : cinq places au plus`);
  }
});

test('aucun menu inutile : Messagerie, Backup, Surveillance, Coffre-fort, Tâches récurrentes, Marketing', () => {
  for (const ecran of ['espace-client', 'backups', 'surveillance', 'coffre', 'taches-recurrentes', 'strategie'] as shared.EcranDuBas[]) {
    assert.equal(shared.menuDuBas(ecran).forme, 'aucun', ecran);
  }
});

test('un projet ouvert : plus rien en bas, « Publier » est dans le haut (13/11/2026)', () => {
  const ecran = shared.ecranDuBas('projet', { projetActif: true });
  assert.equal(ecran, 'projet');
  assert.deepEqual(shared.menuDuBas(ecran), { forme: 'aucun', ecran: 'projet' });
  assert.equal(shared.ecranDuBas('projet', { projetActif: false }), 'tableaux-de-bord');
});

test('un seul bouton pleine largeur : Mémoire, l’accueil du Studio', () => {
  assert.deepEqual(shared.menuDuBas('memoire'), { forme: 'pleine-largeur', ecran: 'memoire', geste: 'vue-d-ensemble' });
  assert.deepEqual(shared.menuDuBas('studio'), { forme: 'pleine-largeur', ecran: 'studio', geste: 'page' });
});

test('le niveau déclaré par la page l’emporte sur la vue', () => {
  assert.equal(shared.ecranDuBas('communication2', { projetActif: true, niveau: 'communication2-marque' }), 'communication2-marque');
  const creation = shared.menuDuBas('studio-creation');
  assert.deepEqual(gestesDuMenu(creation), ['medias-studio', 'telechargements', 'mise-en-production', 'style', 'archives']);
  /* LE ROND VIOLET DU CENTRE : la « Construction » du Studio sur téléphone (12/11/2026). */
  assert.deepEqual(creation.forme === 'repartis' && creation.centre, { genre: 'action', geste: 'mise-en-production' });
});
