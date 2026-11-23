/**
 * LE MODE « AUTO » D'UNE CARTE (carte « Services homogènes et centrés », 14/11/2026) : la réponse conseillée, les
 * questions qu'Auto ne tranche jamais, les relances bornées d'un travail inachevé, et le lancement qui attend la file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPONSE_AUTO_OUVERTE,
  RELANCES_AUTO_MAX,
  optionRecommandee,
  questionPourAuto,
  raisonDAttendreLeLancement,
  reponseConseillee,
  suiteDuBilan,
} from '@beluga/shared';

test('la réponse conseillée est l’option marquée « (recommandé) », sinon la première', () => {
  assert.equal(reponseConseillee({ kind: 'single', options: [{ label: 'Non' }, { label: 'Oui, ajouter (recommandé)' }] }), 'Oui, ajouter (recommandé)');
  assert.equal(reponseConseillee({ kind: 'single', options: [{ label: 'A' }, { label: 'B' }] }), 'A');
  assert.equal(reponseConseillee({ kind: 'single', options: [{ label: 'Rester ici' }, { label: 'Monter un projet (Recommandée)' }] }), 'Monter un projet (Recommandée)');
  assert.ok(optionRecommandee('Carte à part (conseillé)'));
  assert.ok(!optionRecommandee('Un choix recommandable plus tard ?'));
});

test('un choix multiple prend toutes les options recommandées, une question ouverte reçoit la consigne d’Auto', () => {
  assert.equal(reponseConseillee({ kind: 'multiple', options: [{ label: 'X (recommandé)' }, { label: 'Y' }, { label: 'Z (recommandé)' }] }), 'X (recommandé), Z (recommandé)');
  assert.equal(reponseConseillee({ kind: 'multiple', options: [{ label: 'X' }, { label: 'Y' }] }), 'X');
  assert.equal(reponseConseillee({ kind: 'text', options: [] }), REPONSE_AUTO_OUVERTE);
  assert.equal(reponseConseillee({ kind: 'single', options: [] }), REPONSE_AUTO_OUVERTE);
});

test('Auto ne tranche jamais un geste qui engage (prix, publication, envoi client), ni une question déjà répondue', () => {
  assert.ok(questionPourAuto({ id: 'q', question: 'Quel ton ?', options: [] }));
  assert.ok(!questionPourAuto({ id: 'q', question: 'Générer ?', devis: { total: 3 } }));
  assert.ok(!questionPourAuto({ id: 'q', question: 'Programmer ?', gesteAValider: { genre: 'programmer' } }));
  assert.ok(!questionPourAuto({ id: 'q', question: 'Quelle version ?', choixDeVersion: { plan: 'p' } }));
  assert.ok(!questionPourAuto({ id: 'q', question: 'Quel ton ?', answer: 'Doux' }));
  assert.ok(!questionPourAuto({ id: 'q', question: 'Quel ton ?', cancelled: true }));
});

test('un travail inachevé est relancé deux fois au plus, puis Auto s’arrête et dit ce qui reste', () => {
  const debut = 1000;
  assert.deepEqual(suiteDuBilan(null, debut, 0), { geste: 'rien' });
  assert.deepEqual(suiteDuBilan({ abouti: true, restes: [], at: 2000 }, debut, 0), { geste: 'rien' });
  /* Un bilan d'un tour précédent ne compte pas. */
  assert.deepEqual(suiteDuBilan({ abouti: false, restes: ['tests'], at: 500 }, debut, 0), { geste: 'rien' });
  const premiere = suiteDuBilan({ abouti: false, restes: ['les tests échouent'], at: 2000 }, debut, 0);
  assert.equal(premiere.geste, 'relancer');
  assert.equal(premiere.geste === 'relancer' && premiere.relance, 1);
  assert.match(premiere.geste === 'relancer' ? premiere.consigne : '', /les tests échouent/);
  const seconde = suiteDuBilan({ abouti: false, restes: ['les tests échouent'], at: 3000 }, debut, 1);
  assert.equal(seconde.geste === 'relancer' && seconde.relance, 2);
  const arret = suiteDuBilan({ abouti: false, restes: ['les tests échouent'], at: 4000 }, debut, RELANCES_AUTO_MAX);
  assert.equal(arret.geste, 'arreter');
  assert.match(arret.geste === 'arreter' ? arret.raison : '', /les tests échouent/);
  /* « Abouti » mais avec des restes : ce n'est pas fini. */
  assert.equal(suiteDuBilan({ abouti: true, restes: ['le changelog'], at: 2000 }, debut, 0).geste, 'relancer');
});

test('le lancement automatique attend qu’un message de la file soit passé', () => {
  const pret = { actif: true, tourReussi: true, comprehensionAt: 1, questionEnAttente: false, planSouhaite: false, planDemande: false, plansRendusA: [] };
  assert.equal(raisonDAttendreLeLancement(pret), null);
  assert.equal(raisonDAttendreLeLancement({ ...pret, fileNonVide: true }), 'un message attend son tour');
});

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lire = (fichier: string) => fs.readFileSync(path.join(RACINE, fichier), 'utf8');

test('la réponse d’Auto passe par le même chemin qu’un clic, et l’outil de bilan n’est servi qu’en Auto', () => {
  const auto = lire('server/src/mode-auto.ts');
  assert.match(auto, /type: 'question\.answer'[^}]*parAuto: true/);
  const outils = lire('server/src/tools.ts');
  assert.match(outils, /if \(nom === 'bilan_du_travail'\) \{[\s\S]{0,300}lancementAutomatique/);
  /* L'interrupteur vit dans les réglages de la carte, jamais dans la rangée de lancement (refonte du 13/11/2026). */
  assert.match(lire('web/src/components/chat.tsx'), /data-interrupteur-auto/);
});
