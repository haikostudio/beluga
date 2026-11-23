/**
 * LES PIÈCES JOINTES VOLUMINEUSES.
 *
 * Ce que ces essais verrouillent : le plafond de 2 Go se juge sur la taille
 * annoncée ET au fil de la lecture, la lecture partielle se découpe comme le
 * veut l'entête `Range`, un envoi reçu au fil de l'eau garde la bonne empreinte,
 * et un envoi refusé ou coupé ne laisse aucun fichier provisoire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type http from 'node:http';
import {
  TAILLE_MAX_PIECE_JOINTE,
  jugerTaillePieceJointe,
  plageDemandee,
  tailleAnnoncee,
  tailleLisible,
} from '@beluga/shared';
import { effacerProvisoiresOublies, recevoirAuFilDeLEau } from '../envoi-piece-jointe.js';

test('le plafond est de 2 Go, et une taille inconnue passe', () => {
  assert.equal(TAILLE_MAX_PIECE_JOINTE, 2 * 1024 ** 3);
  assert.equal(jugerTaillePieceJointe(TAILLE_MAX_PIECE_JOINTE).ok, true);
  const refus = jugerTaillePieceJointe(TAILLE_MAX_PIECE_JOINTE + 1);
  assert.equal(refus.ok, false);
  assert.match((refus as { raison: string }).raison, /2 Go/);
  assert.equal(jugerTaillePieceJointe(undefined).ok, true);
});

test('taille lisible et entête de taille', () => {
  assert.equal(tailleLisible(512), '512 o');
  assert.equal(tailleLisible(1536), '1,5 Ko');
  assert.equal(tailleLisible(2 * 1024 ** 3), '2 Go');
  assert.equal(tailleAnnoncee('1234'), 1234);
  assert.equal(tailleAnnoncee('abc'), undefined);
  assert.equal(tailleAnnoncee(undefined), undefined);
});

test('la lecture partielle suit l’entête Range', () => {
  assert.deepEqual(plageDemandee(undefined, 1000), { genre: 'entier' });
  assert.deepEqual(plageDemandee('bytes=0-', 1000), { genre: 'partiel', debut: 0, fin: 999 });
  assert.deepEqual(plageDemandee('bytes=100-199', 1000), { genre: 'partiel', debut: 100, fin: 199 });
  assert.deepEqual(plageDemandee('bytes=900-5000', 1000), { genre: 'partiel', debut: 900, fin: 999 });
  assert.deepEqual(plageDemandee('bytes=-100', 1000), { genre: 'partiel', debut: 900, fin: 999 });
  assert.deepEqual(plageDemandee('bytes=1000-', 1000), { genre: 'impossible' });
  assert.deepEqual(plageDemandee('bytes=5-2', 1000), { genre: 'impossible' });
  // Plusieurs plages ou unité inconnue : le fichier entier.
  assert.deepEqual(plageDemandee('bytes=0-1,5-6', 1000), { genre: 'entier' });
  assert.deepEqual(plageDemandee('items=0-1', 1000), { genre: 'entier' });
});

function requete(morceaux: Buffer[], longueur?: number): http.IncomingMessage {
  const flux = Readable.from(morceaux) as unknown as http.IncomingMessage;
  (flux as any).headers = longueur === undefined ? {} : { 'content-length': String(longueur) };
  return flux;
}

function dossierNeuf(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-envoi-'));
}

test('un envoi reçu au fil de l’eau garde sa taille et son empreinte', async () => {
  const dossier = dossierNeuf();
  const morceaux = [Buffer.alloc(70_000, 1), Buffer.alloc(50_000, 2)];
  const recu = await recevoirAuFilDeLEau(requete(morceaux, 120_000), dossier, 'x1');
  assert.equal(recu.ok, true);
  if (!recu.ok) return;
  assert.equal(recu.taille, 120_000);
  assert.equal(recu.sha, crypto.createHash('sha256').update(Buffer.concat(morceaux)).digest('hex'));
  assert.equal(fs.statSync(recu.provisoire).size, 120_000);
});

test('une taille annoncée trop grosse est refusée avant toute écriture', async () => {
  const dossier = dossierNeuf();
  const recu = await recevoirAuFilDeLEau(requete([Buffer.alloc(10)], 5000), dossier, 'x2', 1000);
  assert.deepEqual({ ok: recu.ok, statut: (recu as any).statut }, { ok: false, statut: 413 });
  assert.deepEqual(fs.readdirSync(dossier), []);
});

test('un envoi qui ment sur sa taille est coupé au dépassement, sans provisoire', async () => {
  const dossier = dossierNeuf();
  const recu = await recevoirAuFilDeLEau(requete([Buffer.alloc(800), Buffer.alloc(800)]), dossier, 'x3', 1000);
  assert.equal(recu.ok, false);
  assert.equal((recu as any).statut, 413);
  assert.deepEqual(fs.readdirSync(dossier), []);
});

test('un envoi coupé en route ne laisse aucun provisoire', async () => {
  const dossier = dossierNeuf();
  const flux = new Readable({ read() {} }) as unknown as http.IncomingMessage;
  (flux as any).headers = {};
  const attente = recevoirAuFilDeLEau(flux, dossier, 'x4');
  (flux as unknown as Readable).push(Buffer.alloc(100));
  setTimeout(() => (flux as unknown as Readable).destroy(new Error('aborted')), 20);
  const recu = await attente;
  assert.equal(recu.ok, false);
  assert.equal((recu as any).statut, 499);
  assert.deepEqual(fs.readdirSync(dossier), []);
});

test('les provisoires de plus d’un jour sont effacés, les récents gardés', () => {
  const dossier = dossierNeuf();
  const vieux = path.join(dossier, '.envoi-vieux.part');
  const recent = path.join(dossier, '.envoi-recent.part');
  const piece = path.join(dossier, 'abcd-video.mp4');
  for (const f of [vieux, recent, piece]) fs.writeFileSync(f, 'x');
  const avant = new Date(Date.now() - 2 * 24 * 3600_000);
  fs.utimesSync(vieux, avant, avant);
  fs.utimesSync(piece, avant, avant);
  assert.equal(effacerProvisoiresOublies([dossier, path.join(dossier, 'absent')]), 1);
  assert.deepEqual(fs.readdirSync(dossier).sort(), ['.envoi-recent.part', 'abcd-video.mp4']);
});

/*
 * LE DISQUE DE STOCKAGE. `PATHS` se fige au chargement : chaque cas tourne
 * dans un Node à part, avec son propre environnement.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pieces-jointes.js');

function choixDuDossier(env: Record<string, string | undefined>): { ecriture: string; lecture: string[] } {
  const script = `import(${JSON.stringify(MODULE)}).then((m) => console.log(JSON.stringify({ ecriture: m.dossierDEcriture(), lecture: m.dossiersDeLecture() })))`;
  const propre = { ...process.env };
  delete propre.BELUGA_PIECES_JOINTES;
  delete propre.BELUGA_PIECES_JOINTES_EN_ESSAI;
  const sortie = execFileSync(process.execPath, ['-e', script], { env: { ...propre, ...env } as NodeJS.ProcessEnv });
  return JSON.parse(sortie.toString().trim().split('\n').pop()!);
}

test('le disque de stockage sert à l’écriture dès qu’il porte son témoin, l’ancien dossier restant lu', () => {
  const donnees = dossierNeuf();
  const disque = dossierNeuf();
  const ancien = path.join(donnees, 'attachments');
  fs.writeFileSync(path.join(disque, '.beluga-pieces-jointes'), '');
  const essai = { BELUGA_DATA: donnees, BELUGA_PIECES_JOINTES: disque, BELUGA_PIECES_JOINTES_EN_ESSAI: '1' };
  assert.deepEqual(choixDuDossier(essai), { ecriture: disque, lecture: [disque, ancien] });
});

test('un bac à sable ignore le vrai disque, même porteur de son témoin', () => {
  const donnees = dossierNeuf();
  const disque = dossierNeuf();
  const ancien = path.join(donnees, 'attachments');
  fs.writeFileSync(path.join(disque, '.beluga-pieces-jointes'), '');
  assert.deepEqual(choixDuDossier({ BELUGA_DATA: donnees, BELUGA_PIECES_JOINTES: disque }), {
    ecriture: ancien,
    lecture: [ancien],
  });
});

test('un disque sans témoin (montage tombé) n’est jamais écrit', () => {
  const donnees = dossierNeuf();
  const disque = dossierNeuf();
  const choix = choixDuDossier({ BELUGA_DATA: donnees, BELUGA_PIECES_JOINTES: disque, BELUGA_PIECES_JOINTES_EN_ESSAI: '1' });
  assert.equal(choix.ecriture, path.join(donnees, 'attachments'));
  assert.deepEqual(fs.readdirSync(disque), []);
});
