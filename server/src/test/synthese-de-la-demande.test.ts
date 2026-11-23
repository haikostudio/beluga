import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resumesDuJalon } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA SYNTHÈSE ÉCRITE AU DÉBUT DU TOUR REJOINT LE JALON DE SA DEMANDE   */
/*                                                                      */
/* Le résumé du point « Demande » était emprunté à la compréhension de   */
/* fin de tour : le fil restait sur « Votre demande est notée. » pendant */
/* tout le travail. L'agent l'écrit maintenant juste après le titre, et  */
/* le démon l'ajoute au jalon « Demande » du tour SANS perdre ce que ce  */
/* jalon portait déjà — le message et ses pièces jointes.                */
/* ------------------------------------------------------------------ */

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthese-demande-'));

const { ajouterAuJournal, completerDonneesDuJournal, dernierJalonDeDemande, entreesDuJournal } = await import(
  '../journal-carte.js'
);

const jalonDeDemande = (cardId: string, agentId: string, messageId: string, texte: string) =>
  ajouterAuJournal({
    cardId,
    phase: 'cadrage',
    nature: 'jalon',
    libelle: 'Demande',
    agentId,
    agentRole: 'cadrage',
    resultat: texte,
    donnees: { messageId, ecriteLe: 1, pieces: ['/data/attachments/capture.png'] },
  });

test('la synthèse s’ajoute au jalon sans effacer le message ni ses pièces jointes', () => {
  const ecrit = jalonDeDemande('carte-1', 'agent-1', 'm1', 'Je veux un bouton');
  assert.ok(ecrit);
  const enrichi = completerDonneesDuJournal(ecrit.id, { resumeDemande: 'Un bouton est demandé.' });
  assert.ok(enrichi);
  assert.equal(resumesDuJalon(enrichi).resumeDemande, 'Un bouton est demandé.');
  const donnees = JSON.parse(enrichi.donnees ?? '{}');
  assert.equal(donnees.messageId, 'm1', 'le message reste rattaché');
  assert.deepEqual(donnees.pieces, ['/data/attachments/capture.png'], 'la capture ne disparaît pas du point');
  /* RELU DEPUIS LA BASE : l'enrichissement est bien écrit, pas seulement rendu. */
  const relu = entreesDuJournal('carte-1').find((e) => e.id === ecrit.id);
  assert.equal(resumesDuJalon(relu).resumeDemande, 'Un bouton est demandé.');
  /* AUCUNE LIGNE DE PLUS : on enrichit, on n'ajoute pas. */
  assert.equal(entreesDuJournal('carte-1').length, 1);
});

test('une demande à 54 images garde toutes ses pièces, avant comme après la synthèse', () => {
  /* LE CAS DES CARTES #ea04d227 ET #819dd425 : la liste, bornée à 2000 signes,
     était coupée en plein tableau ; la synthèse repartait alors de zéro et le
     point « Demande » n'affichait plus une seule vignette. */
  const pieces = Array.from({ length: 54 }, (_, i) => `978141b5-525a-4db0-8721-${String(i).padStart(12, '0')}`);
  const ecrit = ajouterAuJournal({
    cardId: 'carte-54',
    phase: 'cadrage',
    nature: 'jalon',
    libelle: 'Demande',
    agentId: 'agent-54',
    resultat: 'Refais toute l’apparence',
    donnees: { messageId: 'm54', ecriteLe: 1, pieces },
  });
  assert.ok(ecrit);
  assert.deepEqual(JSON.parse(ecrit.donnees ?? '{}').pieces, pieces, 'écrites entières');
  const enrichi = completerDonneesDuJournal(ecrit.id, { resumeDemande: 'Une refonte complète.' });
  assert.ok(enrichi);
  const relu = JSON.parse(entreesDuJournal('carte-54')[0].donnees ?? '{}');
  assert.deepEqual(relu.pieces, pieces, 'la synthèse n’efface aucune pièce');
  assert.equal(relu.messageId, 'm54');
  assert.equal(relu.resumeDemande, 'Une refonte complète.');
});

test('des données déjà illisibles ne sont pas écrasées par la synthèse', async () => {
  const ecrit = jalonDeDemande('carte-abimee', 'agent-abime', 'm1', 'Je veux un bouton');
  assert.ok(ecrit);
  const { getDb } = await import('../db.js');
  const coupe = '{\n  "messageId": "m1",\n  "pieces": [\n    "a",\n    "b';
  getDb().prepare('UPDATE card_journal SET donnees = ? WHERE id = ?').run(coupe, ecrit.id);
  assert.equal(completerDonneesDuJournal(ecrit.id, { resumeDemande: 'Un bouton.' }), null);
  assert.equal(entreesDuJournal('carte-abimee')[0].donnees, coupe, 'la ligne reste telle quelle');
});

test('chaque tour vise SA demande, jamais celle du tour d’avant', () => {
  const premier = jalonDeDemande('carte-2', 'agent-2', 'm1', 'Je veux un bouton');
  assert.ok(premier);
  completerDonneesDuJournal(premier.id, { resumeDemande: 'Premier message.' });
  const second = jalonDeDemande('carte-2', 'agent-2', 'm2', 'Et un PDF');
  assert.ok(second);
  /* Le jalon visé est le DERNIER écrit pour cet agent : celui du tour en cours. */
  assert.equal(dernierJalonDeDemande('carte-2', 'agent-2')?.id, second.id);
  completerDonneesDuJournal(second.id, { resumeDemande: 'Second message.' });
  const entrees = entreesDuJournal('carte-2');
  assert.equal(resumesDuJalon(entrees[0]).resumeDemande, 'Premier message.');
  assert.equal(resumesDuJalon(entrees[1]).resumeDemande, 'Second message.');
});

test('le jalon d’un autre agent sur la même carte n’est jamais touché', () => {
  const cadrage = jalonDeDemande('carte-3', 'agent-cadrage', 'm1', 'Je veux un bouton');
  const execution = jalonDeDemande('carte-3', 'agent-tache', 'm2', 'Fais-le');
  assert.ok(cadrage && execution);
  assert.equal(dernierJalonDeDemande('carte-3', 'agent-cadrage')?.id, cadrage.id);
  assert.equal(dernierJalonDeDemande('carte-3', 'agent-tache')?.id, execution.id);
  /* Un agent qui n'a rien reçu sur cette carte ne se voit rien attribuer. */
  assert.equal(dernierJalonDeDemande('carte-3', 'agent-inconnu'), null);
});

test('une entrée inconnue ne fait pas tomber le tour', () => {
  assert.equal(completerDonneesDuJournal('entree-fantome', { resumeDemande: 'Rien.' }), null);
  assert.equal(completerDonneesDuJournal('', { resumeDemande: 'Rien.' }), null);
});

/* ------------------------------------------------------------------ */
/* L'ÉCRAN PREND L'ENRICHISSEMENT, IL NE L'ÉCARTE PLUS                  */
/* ------------------------------------------------------------------ */

test('une ligne enrichie remplace celle qui est affichée, sans doublon ni désordre', async () => {
  const { fusionnerEntreeJournal } = await import('@beluga/shared');
  const l = (id: string, rang: number, donnees?: string) => ({ id, rang, donnees });
  const liste = [l('a', 0), l('b', 1)];
  /* UNE LIGNE NEUVE s'ajoute, à sa place de rang. */
  const avecC = fusionnerEntreeJournal(liste, l('c', 2));
  assert.deepEqual(avecC.map((e) => e.id), ['a', 'b', 'c']);
  /* UNE LIGNE CONNUE, ENRICHIE, remplace la sienne : pas de doublon. */
  const enrichie = fusionnerEntreeJournal(avecC, l('a', 0, '{"resumeDemande":"Un bouton est demandé."}'));
  assert.deepEqual(enrichie.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(enrichie[0].donnees, '{"resumeDemande":"Un bouton est demandé."}');
  /* La liste reçue n'est jamais modifiée sur place. */
  assert.equal(avecC[0].donnees, undefined);
});

/* ------------------------------------------------------------------ */
/* L'OUTIL DE L'AGENT PORTE LE GESTE, ET LE DIFFUSE                     */
/* ------------------------------------------------------------------ */

test('« board_update_card » écrit la synthèse sur le jalon et la diffuse aussitôt', async () => {
  const { fileURLToPath } = await import('node:url');
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(ici, '../../../server/src/tools.ts'), 'utf8');
  const debut = source.indexOf("case 'board_update_card'");
  assert.ok(debut > 0);
  const extrait = source.slice(debut, source.indexOf("case 'board_move_card'", debut));
  assert.ok(extrait.includes('dernierJalonDeDemande'), 'la synthèse vise le jalon du tour');
  assert.ok(extrait.includes('completerDonneesDuJournal'), 'elle enrichit, elle ne réécrit pas');
  assert.ok(extrait.includes("bus.emit({ type: 'journal.entree'"), 'l’écran la reçoit sans rechargement');
  /* LE CHAMP EST OFFERT AU MODÈLE : sans lui, l'agent ne peut pas le remplir. */
  assert.ok(source.includes('resumeDemande: CHAMP_RESUME_DEMANDE'));
});
