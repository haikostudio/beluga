import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demandeDeReparation, relectureDuBrouillon } from '@beluga/shared';

/*
 * TROIS MÉTHODES PSTACK RÉÉCRITES DANS LES CONSIGNES (carte db89f57f) : la
 * preuve dans la vraie application et le carnet des décisions pour l'agent de
 * TÂCHE seul, le règlement des conflits pour l'agent de réparation du
 * déploiement. Les fiches pstack restent archivées : seule la méthode voyage.
 */

const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'preuve-reelle-carnet-'));
process.env.BELUGA_DATA = DONNEES;
const { CONSIGNE_DE_PREUVE_REELLE, CONSIGNE_DU_CARNET, rolePrompt } = await import('../runtime.js');
const k = await import('../connaissances.js');

test('la preuve réelle et le carnet partent à l’agent de tâche, quel que soit le moteur', () => {
  for (const moteur of ['claude', 'codex', 'cursor'] as const) {
    const tache = rolePrompt('task', false, moteur);
    assert.ok(tache.includes(CONSIGNE_DE_PREUVE_REELLE), moteur);
    assert.ok(tache.includes(CONSIGNE_DU_CARNET), moteur);
  }
});

test('ni l’analyse, ni la publication, ni le cadrage ne reçoivent ces deux consignes', () => {
  for (const role of ['analysis', 'deploy', 'cadrage'] as const) {
    const consigne = rolePrompt(role, false);
    assert.ok(!consigne.includes(CONSIGNE_DE_PREUVE_REELLE), role);
    assert.ok(!consigne.includes(CONSIGNE_DU_CARNET), role);
  }
});

test('la preuve réelle : essai à l’écran, capture, notice du projet née à la première carte, issue sans écran', () => {
  assert.match(CONSIGNE_DE_PREUVE_REELLE, /application réelle/);
  assert.match(CONSIGNE_DE_PREUVE_REELLE, /« capture »/);
  assert.match(CONSIGNE_DE_PREUVE_REELLE, /tester-<projet>-dans-l-application/);
  assert.match(CONSIGNE_DE_PREUVE_REELLE, /complète-la ENTIÈRE/);
  assert.match(CONSIGNE_DE_PREUVE_REELLE, /Essai réel impossible/);
  // Aucune aide par fonction : c'est l'agent seul qui prouve.
  assert.doesNotMatch(CONSIGNE_DE_PREUVE_REELLE, /aide|parallèle/i);
  // Courtes : chaque tour de chaque agent de tâche les paie.
  assert.ok(CONSIGNE_DE_PREUVE_REELLE.length < 800, `${CONSIGNE_DE_PREUVE_REELLE.length} signes`);
  assert.ok(CONSIGNE_DU_CARNET.length < 600, `${CONSIGNE_DU_CARNET.length} signes`);
});

test('le carnet se tient au brouillon, se relit avant le compte rendu, et reste à l’agent', () => {
  assert.match(CONSIGNE_DU_CARNET, /geste « brouillon »/);
  assert.match(CONSIGNE_DU_CARNET, /sans « texte »/);
  assert.match(CONSIGNE_DU_CARNET, /jamais servi comme mémoire/);
  assert.match(CONSIGNE_DU_CARNET, /résumés/);
});

test('la relecture rend les notes dans l’ordre d’écriture, numérotées, et dit un brouillon vide', () => {
  assert.match(relectureDuBrouillon([]), /vide/);
  assert.match(relectureDuBrouillon([{ texte: '   ', at: 1 }]), /vide/);
  const r = relectureDuBrouillon([
    { texte: 'B — parce que — test', at: 20 },
    { texte: 'A — parce que — lecture', at: 10 },
  ]);
  assert.match(r, /2 notes/);
  assert.ok(r.indexOf('1. A') < r.indexOf('2. B'), r);
});

test('le brouillon relu est celui de SA carte seule, et la fermeture l’efface', () => {
  assert.ok(k.noterAuBrouillon({ cardId: 'carte-a', projectId: 'p', texte: 'garder l’ancien bouton — compatibilité — capture' }).ok);
  assert.ok(k.noterAuBrouillon({ cardId: 'carte-b', projectId: 'p', texte: 'note d’une autre carte' }).ok);
  const a = k.lireLeBrouillon('carte-a');
  assert.equal(a.length, 1);
  assert.match(relectureDuBrouillon(a), /ancien bouton/);
  assert.doesNotMatch(relectureDuBrouillon(a), /autre carte/);
  assert.deepEqual(k.lireLeBrouillon('carte-sans-note'), []);
  k.purgerLeBrouillon('carte-a');
  assert.deepEqual(k.lireLeBrouillon('carte-a'), []);
  assert.equal(k.lireLeBrouillon('carte-b').length, 1);
});

test('le règlement d’un heurt : au plus juste, verrous régénérés, contrôles ciblés, résumé — et le reste intact', () => {
  const heurt = demandeDeReparation({
    projet: 'Essai',
    dossier: '/tmp/e',
    cible: 'dev',
    etape: 'Fusion des branches',
    essai: 1,
    journal: '',
    heurt: { branche: 'tache/a', brancheDAccueil: 'dev', titre: 'Outil', fichiers: ['package-lock.json'] },
  });
  assert.match(heurt, /AU PLUS JUSTE/);
  assert.match(heurt, /appel sans sa définition/);
  assert.match(heurt, /RÉGÉNÈRE-le avec le gestionnaire de paquets/);
  assert.match(heurt, /jamais la suite complète/);
  assert.match(heurt, /Ne pousse pas/);
  assert.match(heurt, /une ligne par fichier/);
  // Ce qui tenait déjà ne bouge pas.
  assert.match(heurt, /GARDANT LES DEUX INTENTIONS/);
  assert.match(heurt, /jamais `git add -A`/);
  assert.match(heurt, /`git commit --no-edit`/);
  assert.match(heurt, /rendre_reparation/);
  // La panne ordinaire (sans heurt) ne reçoit pas cette méthode.
  const simple = demandeDeReparation({ projet: 'Essai', dossier: '/tmp/e', cible: 'dev', etape: 'Mise à jour', essai: 1, journal: 'x' });
  assert.doesNotMatch(simple, /AU PLUS JUSTE/);
});
