import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ETAPES_DE_LANCEMENT,
  PEREMPTION_LANCEMENT_MS,
  avancementDuLancement,
  lancementEncoreCredible,
  libelleEtapeDeLancement,
  mentionDeLancement,
  preparationAAfficher,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE PRÉPARATION DE LANCEMENT SE VOIT, ET NE S'ANNONCE PAS COMME UNE  */
/* PANNE.                                                              */
/*                                                                     */
/* Constat : sur un gros dépôt, l'ouverture de la copie de travail      */
/* (`git worktree add`) tient plusieurs minutes. Pendant tout ce temps  */
/* la carte restait dans « Planifié », et au bout de dix secondes un    */
/* message d'avertissement — le même que pour un bouton en panne —      */
/* annonçait que « ça prend plus de temps que prévu ».                  */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULER = path.resolve(ICI, '../../../server/src/scheduler.ts');
const CLIENT = path.resolve(ICI, '../../../web/src/lib/client.ts');
const BOARD = path.resolve(ICI, '../../../web/src/components/board.tsx');
const CHAT = path.resolve(ICI, '../../../web/src/components/chat.tsx');
const FLUX = path.resolve(ICI, '../../../web/src/components/flux-en-points.tsx');
const BARRE = path.resolve(ICI, '../../../web/src/components/barre-etapes.tsx');
const PROTOCOLE = path.resolve(ICI, '../../../shared/src/protocol.ts');

/* -------- La règle pure -------- */

test('les étapes du lancement avancent, sans jamais atteindre le bout', () => {
  let precedent = 0;
  for (const etape of ETAPES_DE_LANCEMENT) {
    const part = avancementDuLancement(etape);
    // Une étape qui commence n'est jamais à zéro : le geste est bel et bien parti.
    assert.ok(part > 0, `${etape} doit montrer un départ`);
    assert.ok(part > precedent, `${etape} doit avancer sur la précédente`);
    // …et la dernière ne termine pas : c'est le moteur qui termine.
    assert.ok(part < 1, `${etape} ne doit pas annoncer la fin`);
    precedent = part;
    assert.ok(libelleEtapeDeLancement(etape).length > 3);
  }
});

test('la phrase de préparation est neutre : elle ne crie ni au retard ni à la panne', () => {
  for (const etape of ETAPES_DE_LANCEMENT) {
    const phrase = mentionDeLancement(etape);
    assert.match(phrase, /Préparation en cours/);
    assert.ok(!/prend plus de temps|panne|erreur|ne répond pas/i.test(phrase), phrase);
  }
});

test('une préparation trop vieille est oubliée', () => {
  const depuis = 1_000_000;
  assert.ok(lancementEncoreCredible(depuis, depuis + 60_000));
  assert.ok(!lancementEncoreCredible(depuis, depuis + PEREMPTION_LANCEMENT_MS + 1));
});

/* -------- Le démon la diffuse, et déplace la carte au clic -------- */

test('la carte passe en « En cours » AVANT l’ouverture de la copie de travail', () => {
  const source = fs.readFileSync(SCHEDULER, 'utf8');
  const move = source.indexOf('const colonneAvant = card.column;');
  const prepa = source.indexOf('const prepa = await prepareBranch(');
  assert.ok(move > 0, 'le déplacement au clic doit exister');
  assert.match(source.slice(move, move + 1600), /column: 'running',\n\s+position: positionEnCours,/);
  assert.ok(prepa > move, 'la carte doit bouger avant l’ouverture du dossier');
});

test('un refus ramène la carte dans sa colonne de départ', () => {
  const source = fs.readFileSync(SCHEDULER, 'utf8');
  assert.match(source, /colonneAvant\?: Card\['column'\]/);
  // Les deux refus qui suivent le déplacement la rendent à sa colonne.
  assert.match(source, /portes\.reprisePossible, colonneAvant\)/);
  assert.match(source, /refus\(card, prepa\.raison, false, colonneAvant\)/);
});

test('chaque étape du lancement est diffusée, et la préparation se referme', () => {
  const source = fs.readFileSync(SCHEDULER, 'utf8');
  for (const etape of ETAPES_DE_LANCEMENT) {
    assert.ok(source.includes(`'${etape}')`), `l’étape ${etape} doit être diffusée`);
  }
  assert.ok(source.includes('const finDeLaPreparation = () => etapeDeLancement(running)'));
  const protocole = fs.readFileSync(PROTOCOLE, 'utf8');
  assert.ok(protocole.includes("z.literal('card.lancement')"));
});

/* -------- L'écran s'en sert -------- */

test('le navigateur retient l’étape et l’affiche en barre d’avancement', () => {
  const client = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(client.includes("case 'card.lancement':"));
  // La phrase neutre remplace l'avertissement orange sur le seul lancement.
  assert.ok(client.includes('mentionDeLancement(etape)'));
  assert.ok(!/EVENEMENT_ATTENTE_LONGUE, \{ detail: \{ geste: t\(BOUTON_LANCER_LA_TACHE\)/.test(client));

  const board = fs.readFileSync(BOARD, 'utf8');
  assert.ok(board.includes('data-lancement-en-cours'));
  assert.ok(board.includes('avancementDuLancement(preparation)'));
  // Un trait qui porte une information suit `--faint`, jamais `--border`.
  assert.ok(board.includes('bg-faint/30'));
});

test('le tiroir montre la MÊME barre que la carte en colonne, sous le plan', () => {
  const flux = fs.readFileSync(FLUX, 'utf8');
  /* La barre vit dans le point « Préparation », et seulement quand il tourne. */
  assert.match(flux, /point\.etape === 'preparation' && point\.etat === 'encours'/);
  assert.ok(flux.includes('data-lancement-avancement'));
  /* Un trait qui porte une information suit `--faint`, jamais `--border`. */
  assert.match(flux, /bg-faint\/\d+/);
  assert.ok(flux.includes('bg-en-cours'));
  /* Sans signal reçu, la barre part au minimum de son parcours, jamais vide. */
  assert.match(flux, /avancementDuLancement\(etape \?\? ETAPES_DE_LANCEMENT\[0\]\)/);
  /* Une étape non atteinte le DIT, au lieu de compter sur le seul gris. Depuis
     la refonte, la discussion ne montre plus ce qui n'est pas arrivé : c'est la
     barre d'étapes, en tête de la page, qui le dit. */
  const barre = fs.readFileSync(BARRE, 'utf8');
  assert.ok(barre.includes('data-point-avenir'));
  assert.ok(barre.includes("t('à venir')"));

  const chat = fs.readFileSync(CHAT, 'utf8');
  assert.ok(chat.includes('lancement={etapeDePreparation ?? undefined}'));
});

test('le fil transmis au parcours est DATÉ : un plan de cadrage ne ferme plus la préparation', () => {
  const chat = fs.readFileSync(CHAT, 'utf8');
  assert.match(chat, /messages\.map\(\(message\) => \(\{ \.\.\.message, at: message\.createdAt \}\)\)/);
});

test('la conversation de cadrage ne garde plus sa liste de tâches en surcharge', () => {
  const chat = fs.readFileSync(CHAT, 'utf8');
  /* Sauf le DIRECTEUR d'une création de média (barre d'étapes en tête du repère, 26/10/2026) :
     il tient la carte du brief au téléchargement, ses tâches se rangent sous l'étape en cours. */
  assert.match(chat, /listeRetiree = agent\?\.role === 'cadrage' && !entete/);
  assert.match(chat, /todosDisponibles = !!todos\?\.length && !listeRetiree/);
});

/* ------------------------------------------------------------------ */
/* UNE PRÉPARATION QUI MENT NE S'AFFICHE PAS.                          */
/*                                                                     */
/* Constat : des cartes DÉJÀ terminées, rangées en « Rapport », et des  */
/* cartes revenues en « Demande » portaient une barre jaune            */
/* « Préparation en cours — attente du moteur… ». Le signal est         */
/* diffusé, jamais enregistré : quand un tour meurt sans passer par sa  */
/* fin, personne ne le referme et l'écran le gardait une demi-heure.    */
/* ------------------------------------------------------------------ */

const PREPA_VIVANTE = {
  etape: 'moteur' as const,
  depuis: 1_000_000,
  colonne: 'running',
  agentAuTravail: false,
  maintenant: 1_060_000,
};

test('une préparation ne s’affiche que sur une carte en « Travail »', () => {
  assert.equal(preparationAAfficher(PREPA_VIVANTE), 'moteur');
  // Le cas rapporté : la carte est déjà rangée, plus rien ne prépare.
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, colonne: 'done' }), null);
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, colonne: 'planned' }), null);
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, colonne: 'to_deploy' }), null);
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, colonne: 'archived' }), null);
});

test('un agent qui parle, un signal périmé ou plus vieux que le démon éteignent la barre', () => {
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, agentAuTravail: true }), null);
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, etape: undefined }), null);
  assert.equal(
    preparationAAfficher({ ...PREPA_VIVANTE, maintenant: PREPA_VIVANTE.depuis + PEREMPTION_LANCEMENT_MS + 1 }),
    null,
  );
  // Aucune préparation ne survit à un redémarrage du démon.
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, demonDemarreA: PREPA_VIVANTE.depuis + 1 }), null);
  assert.equal(preparationAAfficher({ ...PREPA_VIVANTE, demonDemarreA: PREPA_VIVANTE.depuis - 1 }), 'moteur');
});

test('les deux écrans passent par la règle pure, jamais par la seule péremption', () => {
  const board = fs.readFileSync(BOARD, 'utf8');
  assert.ok(board.includes('preparationAAfficher({'));
  assert.ok(board.includes('colonne: card.column,'));
  assert.ok(!board.includes('lancementEncoreCredible('));
  const chat = fs.readFileSync(CHAT, 'utf8');
  assert.ok(chat.includes('preparationAAfficher({'));
  assert.ok(!chat.includes('lancementEncoreCredible('));
});

test('le démon referme la préparation à TOUTE fin de tour de carte', () => {
  const runtime = fs.readFileSync(path.resolve(ICI, '../../../server/src/runtime.ts'), 'utf8');
  const fin = runtime.indexOf("bus.emit({ type: 'card.lancement'");
  assert.ok(fin > 0, 'la fin de tour doit refermer la préparation');
  // Sans étape : c'est ce qui retire la ligne côté navigateur.
  assert.ok(!/card\.lancement'[^\n]*etape/.test(runtime.slice(fin, fin + 200)));
});
