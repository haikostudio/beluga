/*
 * CARTE « Mémoire, bulles, publication et marketing » (19/11/2026) : Jarvis attend la mémoire jusqu'au bout, et donne
 * des nouvelles utiles pendant un long silence — une phrase après 15 s, puis au plus toutes les 30 s s'il y a du neuf.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointDAvancement, PREMIERE_NOUVELLE_MS, NOUVELLE_SUIVANTE_MS, consigneDeLaVoix, consigneDuDirect, type EtapeDuCerveau } from '@beluga/shared';
import { PLAFOND_DE_SECURITE_DU_DOSSIER_MS, DELAI_DU_SENS_POUR_LA_VOIX_MS } from '../voix-directe.js';

const T0 = 1_000_000;

test('rien avant 15 s de silence : une réponse rapide ne reçoit aucune nouvelle', () => {
  const etapes: EtapeDuCerveau[] = [{ libelle: 'Je cherche dans la mémoire', etat: 'en-cours' }];
  assert.equal(pointDAvancement(etapes, { derniereParoleLe: T0, dernierPointLe: null }, T0 + PREMIERE_NOUVELLE_MS - 1), null);
});

test('après 15 s : ce qu’il fait et ce qu’il a trouvé, jamais la liste des endroits consultés', () => {
  const etapes: EtapeDuCerveau[] = [
    { libelle: 'Je cherche dans la mémoire : GEO', etat: 'finie', resultat: '3 éléments trouvés', finieLe: T0 + 4000 },
    { libelle: 'Je regarde les tâches du tableau', etat: 'en-cours' },
  ];
  const texte = pointDAvancement(etapes, { derniereParoleLe: T0, dernierPointLe: null }, T0 + PREMIERE_NOUVELLE_MS);
  assert.ok(texte);
  assert.match(texte!, /POINT D’AVANCEMENT/);
  assert.match(texte!, /en ce moment : Je regarde les tâches du tableau/);
  assert.match(texte!, /3 éléments trouvés/);
  assert.match(texte!, /UNE phrase/);
});

test('sans aucune étape, une seule phrase dit que le travail continue, puis plus rien sans nouveauté', () => {
  const premier = pointDAvancement([], { derniereParoleLe: T0, dernierPointLe: null }, T0 + 16_000);
  assert.match(premier ?? '', /le travail continue/);
  // 30 s plus tard, rien de nouveau : silence.
  assert.equal(pointDAvancement([], { derniereParoleLe: T0, dernierPointLe: T0 + 16_000 }, T0 + 16_000 + NOUVELLE_SUIVANTE_MS + 5000), null);
});

test('ensuite : au plus toutes les 30 s, et seulement s’il y a du nouveau', () => {
  const dit = T0 + 15_000;
  const etapes: EtapeDuCerveau[] = [
    { libelle: 'Je lis la mémoire', etat: 'finie', resultat: 'lu', finieLe: T0 + 5000 },
    { libelle: 'Je cherche la tâche', etat: 'finie', resultat: '2 tâches trouvées', finieLe: dit + 10_000 },
  ];
  // Du neuf, mais trop tôt.
  assert.equal(pointDAvancement(etapes, { derniereParoleLe: T0, dernierPointLe: dit }, dit + NOUVELLE_SUIVANTE_MS - 1), null);
  const second = pointDAvancement(etapes, { derniereParoleLe: T0, dernierPointLe: dit }, dit + NOUVELLE_SUIVANTE_MS);
  assert.match(second ?? '', /2 tâches trouvées/);
  // L'ancienne trouvaille, déjà dite, ne revient pas.
  assert.doesNotMatch(second ?? '', /Je lis la mémoire/);
});

test('une parole de la voix remet l’horloge à zéro', () => {
  const etapes: EtapeDuCerveau[] = [{ libelle: 'Je cherche', etat: 'finie', resultat: 'rien trouvé', finieLe: T0 + 20_000 }];
  assert.equal(pointDAvancement(etapes, { derniereParoleLe: T0 + 30_000, dernierPointLe: T0 + 15_000 }, T0 + 50_000), null);
});

test('le dossier attend le retour complet : plafond de sécurité seul, sens à 15 s', () => {
  assert.ok(PLAFOND_DE_SECURITE_DU_DOSSIER_MS >= 30_000);
  assert.equal(DELAI_DU_SENS_POUR_LA_VOIX_MS, 15_000);
  assert.match(consigneDuDirect(), /ATTENDS son retour complet/);
  assert.match(consigneDeLaVoix('Jarvis'), /POINT D’AVANCEMENT/);
  // La règle du silence reste : ni « je cherche », ni la liste des sources.
  assert.match(consigneDeLaVoix('Jarvis'), /TU NE RACONTES RIEN/);
});
