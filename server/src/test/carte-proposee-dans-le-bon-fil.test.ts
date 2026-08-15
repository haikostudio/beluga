/**
 * UNE CARTE PROPOSÉE S'AFFICHE DANS LE FIL DE LA CONVERSATION QUI L'A DEMANDÉE.
 *
 * Le défaut constaté le 14/08/2026 : sous Cursor, le chef d'un projet proposait
 * une carte et rien n'apparaissait dans son fil — la carte s'écrivait dans la
 * conversation d'un agent d'un AUTRE projet, terminé deux heures plus tôt, et
 * l'utilisateur ne la retrouvait qu'en suivant la cloche.
 *
 * Deux causes, deux verrous ici :
 *  1. Cursor ne lit PAS `.cursor/mcp.json` dans le dossier du tour, mais à la
 *     RACINE DU DÉPÔT qui le contient. Le bac du chef bridé étant un
 *     sous-dossier du dépôt d'HaikoDev, il lisait la configuration d'un voisin,
 *     donc l'identifiant d'un autre agent.
 *  2. Rien ne vérifiait qu'un appel d'outil venait bien du tour en cours.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DOSSIER_CONFIGURATION,
  FICHIER_CONFIGURATION,
  MARQUE_DE_RACINE,
  TOUR_ETRANGER,
  TOUR_TERMINE,
  appelDuPontRecevable,
  dossiersRemontes,
  poseDeConfigurationCursor,
  racineLueParCursor,
} from '@haikodev/shared';
import { poserLaConfigurationMcp } from '../engines/cursor.js';

/* ------------------------------------------------------------------ */
/* 1. Où Cursor va lire ses outils                                      */
/* ------------------------------------------------------------------ */

test('la remontée passe par le dossier puis chacun de ses parents', () => {
  assert.deepEqual(dossiersRemontes('/root/haikodev/data/chef-scratch/x'), [
    '/root/haikodev/data/chef-scratch/x',
    '/root/haikodev/data/chef-scratch',
    '/root/haikodev/data',
    '/root/haikodev',
    '/root',
    '/',
  ]);
});

test('la racine retenue est le premier dépôt rencontré en remontant', () => {
  const racine = racineLueParCursor(
    '/root/haikodev/data/chef-scratch/rezideo',
    (dossier) => dossier === '/root/haikodev',
  );
  assert.equal(racine, '/root/haikodev');
});

test('aucun dépôt au-dessus : le dossier du tour est sa propre racine', () => {
  const racine = racineLueParCursor('/tmp/ailleurs/tour', () => false);
  assert.equal(racine, '/tmp/ailleurs/tour');
});

test('un dossier enterré dans le dépôt d’un autre doit être ISOLÉ, jamais écrit chez le voisin', () => {
  const pose = poseDeConfigurationCursor('/root/haikodev/data/chef-scratch/rezideo', '/root/haikodev');
  assert.equal(pose.isoler, true);
  assert.equal(pose.depotVoisin, '/root/haikodev');
  // La cible ne bouge JAMAIS : écrire dans le dépôt voisin referait le dégât.
  assert.equal(pose.dossier, '/root/haikodev/data/chef-scratch/rezideo');
});

test('un dossier déjà racine n’est pas isolé', () => {
  const pose = poseDeConfigurationCursor('/root/projet', '/root/projet');
  assert.equal(pose.isoler, false);
  assert.equal(pose.dossier, '/root/projet');
});

/* ------------------------------------------------------------------ */
/* 2. La pose réelle sur le disque                                      */
/* ------------------------------------------------------------------ */

test('la configuration posée dans un sous-dossier d’un dépôt y devient LISIBLE', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-racine-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: base, stdio: 'ignore' });
    const bac = path.join(base, 'data', 'chef-scratch', 'projet');
    fs.mkdirSync(bac, { recursive: true });

    const source = path.join(base, 'mcp-agent.json');
    fs.writeFileSync(source, JSON.stringify({ mcpServers: { haikodev: { command: 'node' } } }), 'utf8');

    poserLaConfigurationMcp(bac, source);

    // Le bac est devenu une racine à lui : la remontée de Cursor s'arrête ici.
    assert.ok(fs.existsSync(path.join(bac, MARQUE_DE_RACINE)), 'le dossier du tour doit être une racine');
    assert.ok(fs.existsSync(path.join(bac, DOSSIER_CONFIGURATION, FICHIER_CONFIGURATION)));
    // …et rien n'a été écrit dans le dépôt du voisin.
    assert.equal(fs.existsSync(path.join(base, DOSSIER_CONFIGURATION)), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('un dossier qui est déjà sa propre racine reçoit sa configuration sans être touché autrement', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-racine-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: base, stdio: 'ignore' });
    const source = path.join(os.tmpdir(), `mcp-${path.basename(base)}.json`);
    fs.writeFileSync(source, JSON.stringify({ mcpServers: {} }), 'utf8');

    poserLaConfigurationMcp(base, source);

    assert.ok(fs.existsSync(path.join(base, DOSSIER_CONFIGURATION, FICHIER_CONFIGURATION)));
    fs.rmSync(source, { force: true });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* 3. Un appel d'outil appartient au tour qui tourne                    */
/* ------------------------------------------------------------------ */

test('aucun tour en cours : l’appel est refusé, rien n’est écrit', () => {
  const verdict = appelDuPontRecevable({ tourAnnonce: 'tour-1', tourEnCours: undefined });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.raison, TOUR_TERMINE);
});

test('un tour annoncé qui n’est pas celui qui tourne est refusé', () => {
  const verdict = appelDuPontRecevable({ tourAnnonce: 'tour-1', tourEnCours: 'tour-2' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.raison, TOUR_ETRANGER);
});

test('le tour du moment passe', () => {
  assert.equal(appelDuPontRecevable({ tourAnnonce: 'tour-2', tourEnCours: 'tour-2' }).ok, true);
});

test('une configuration écrite AVANT cette règle ne coupe pas un tour déjà parti', () => {
  assert.equal(appelDuPontRecevable({ tourAnnonce: undefined, tourEnCours: 'tour-2' }).ok, true);
});
