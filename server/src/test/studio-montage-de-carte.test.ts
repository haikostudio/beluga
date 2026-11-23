import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LE GRAND VOLET DE MONTAGE D'UNE CARTE — ce qui ne doit jamais casser.
 *
 *  - la création de montage est LIÉE à la carte, une seule, en trois formats ;
 *  - un plan vidéo livré par la carte entre séparé : image MUETTE sur les
 *    visuels, son à part, au même instant — une version, annulable ;
 *  - une seconde ouverture ne reverse pas le même plan ;
 *  - l'agent de la carte reçoit l'outil « studio » sur CE montage, ses plans
 *    numérotés ; une retouche en mots est une opération (une version), et
 *    « Annuler » la défait ; recomposer tout est refusé ;
 *  - aucun agent du Studio ne s'ouvre sur un montage de carte.
 *
 * Le bac à sable est posé AVANT le premier import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-montage-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Agent, Project, Card } = shared;
const store = await import('../store.js');
const studio = await import('../studio.js');
const { outilServiA, callTool } = await import('../tools.js');
const { joindreUnFichier } = await import('../joindre-fichier.js');
const { enregistrerUnMediaLivre } = await import('../medias-livres.js');
const { ouvrirLeMontageDeLaCarte } = await import('../studio-montage-de-carte.js');
const { lancerAgentStudio } = await import('../assistant-studio.js');

const dossierProjet = path.join(bacASable, 'projet');
fs.mkdirSync(dossierProjet, { recursive: true });
const projet = store.saveProject(Project.parse({ id: 'projet-montage', name: 'Montage', path: dossierProjet, createdAt: store.now(), updatedAt: store.now() }));
const carte = store.saveCard(
  Card.parse({ id: 'carte-montage', projectId: projet.id, title: 'Spot de rentrée', column: 'running', position: 0, run: { engine: 'claude' }, createdAt: store.now(), updatedAt: store.now() }),
);
const agent = store.saveAgent(
  Agent.parse({ id: 'agent-montage', projectId: projet.id, role: 'task', title: 'Spot', cardId: carte.id, run: { engine: 'claude' }, status: 'idle', createdAt: store.now(), updatedAt: store.now() }),
);

async function livrerUnPlan(sujet: string, secondes: number) {
  const fichier = path.join(bacASable, `${sujet.replace(/\W+/g, '-')}.mp4`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=160x284:d=${secondes}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secondes}`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fichier]);
  const jointe = await joindreUnFichier({ projectId: projet.id, cardId: carte.id, agentId: agent.id, fichier, nom: path.basename(fichier) });
  assert.ok(jointe.ok);
  enregistrerUnMediaLivre({ id: sujet, projectId: projet.id, cardId: carte.id, agentId: agent.id, genre: 'video', sujet, outil: 'realiser', etat: 'fini', attachmentId: (jointe as any).attachment.id, debut: Date.now(), fin: Date.now() } as any);
}

test('les plans de la carte entrent dans SON montage : image muette et son séparé, une fois', async () => {
  assert.equal(outilServiA('studio', agent.id), false, 'sans montage, l’outil reste fermé');
  await livrerUnPlan('Plan 1', 2);
  await livrerUnPlan('Plan 2', 3);

  const premier = await ouvrirLeMontageDeLaCarte(carte.id);
  assert.equal(premier.aVerser, 2);
  assert.deepEqual(premier.creation.formats, ['9:16', '1:1', '16:9']);
  assert.equal(premier.creation.cardId, carte.id);
  assert.equal(await premier.versement, 2);

  const c = studio.compositionCourante(premier.creation.id)!;
  assert.equal(c.dureeVoulue, undefined, 'un montage dure ce que durent ses plans');
  const plans = shared.plansDuMontage(c);
  assert.equal(plans.length, 2);
  assert.ok(plans[0]!.sonId && plans[1]!.sonId, 'chaque plan a son son séparé');
  assert.equal(plans[1]!.debut, plans[0]!.fin, 'le plan 2 suit le plan 1');
  const image = shared.tousLesSegments(c).find((s) => s.id === plans[0]!.segmentId) as any;
  assert.equal(image.volume, 0, 'l’image est muette');

  const second = await ouvrirLeMontageDeLaCarte(carte.id);
  assert.equal(second.creation.id, premier.creation.id, 'une seule création par carte');
  assert.equal(second.aVerser, 0, 'un plan versé ne se reverse pas');
});

test('une retouche en mots de l’agent de la carte est un geste, que « Annuler » défait', async () => {
  const creation = studio.creationDeMontage(carte.id)!;
  assert.equal(outilServiA('studio', agent.id), true);
  const ctx = { agentId: agent.id, projectId: projet.id, role: 'task' as const, cardId: carte.id };
  const lu = await callTool(ctx, 'studio', { action: 'lire' });
  assert.ok(lu.ok, lu.text);
  assert.match(lu.text, /MONTAGE DE TA CARTE/);
  assert.match(lu.text, /PLANS \(numérotés/);

  const plan2 = shared.plansDuMontage(studio.compositionCourante(creation.id)!)[1]!;
  const avant = studio.lireCreation(creation.id)!.version;
  // « Coupe les deux premières secondes du plan 2 » : l'image ET son son, d'un seul geste.
  const r = await callTool(ctx, 'studio', {
    action: 'operation',
    operation: { op: 'lot', operations: [{ op: 'rogner', segmentId: plan2.segmentId, debut: plan2.debut + 2 }, { op: 'rogner', segmentId: plan2.sonId, debut: plan2.debut + 2 }] },
  });
  assert.ok(r.ok, r.text);
  assert.equal(studio.lireCreation(creation.id)!.version, avant + 1, 'une version par geste');
  const coupe = shared.plansDuMontage(studio.compositionCourante(creation.id)!)[1]!;
  assert.ok(Math.abs(coupe.debut - (plan2.debut + 2)) < 0.01);

  assert.ok(studio.annuler(creation.id).ok);
  assert.deepEqual(shared.plansDuMontage(studio.compositionCourante(creation.id)!)[1], plan2, 'Annuler rend le plan entier');

  const refus = await callTool(ctx, 'studio', { action: 'composer', composition: shared.compositionVide('9:16') });
  assert.equal(refus.ok, false, 'un montage qui a ses plans ne se recompose pas d’un bloc');
});

test('aucun agent du Studio ne s’ouvre sur le montage d’une carte', async () => {
  const creation = studio.creationDeMontage(carte.id)!;
  await assert.rejects(() => lancerAgentStudio({ creationId: creation.id, demande: 'Coupe le plan 2' }), /conversation de la carte/);
  assert.equal(studio.creationDeMontage(carte.id)!.agentId, undefined);
});

test('seule la dernière version de chaque plan se verse, dans l’ordre de première livraison', () => {
  const m = (attachmentId: string, groupe: string, version: number, livreLe: number) => ({ attachmentId, groupe, version, livreLe, genre: 'video' as const });
  const liste = [m('a1', 'plan 1', 1, 10), m('b1', 'plan 2', 1, 20), m('a2', 'plan 1', 2, 30)];
  assert.deepEqual(shared.plansAVerser(liste, new Set()).map((x) => x.attachmentId), ['a2', 'b1']);
  assert.deepEqual(shared.plansAVerser(liste, new Set(['a2'])).map((x) => x.attachmentId), ['b1']);
});
