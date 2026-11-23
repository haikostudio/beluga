/**
 * LE MÉNAGE AUTOMATIQUE DE LA MÉMOIRE : indicateur de flou, plan qui ne touche
 * jamais une unité vitale, essai avant / après et ANNULATION d'un lot qui fait
 * baisser le rappel (`shared/src/menage-memoire.ts`, `server/src/menage-memoire.ts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SEUIL_PART_VITALE,
  casDEssaiDeLaMemoire,
  indicateurDeFlou,
  planDeMenage,
  scoreDeRappel,
  verdictDeLEssai,
  type UniteDuMenage,
} from '@beluga/shared';

const JOUR = 24 * 3600 * 1000;
const MAINTENANT = Date.UTC(2026, 10, 5);
const vieille = MAINTENANT - 200 * JOUR;

const u = (id: string, e: Partial<UniteDuMenage> = {}): UniteDuMenage => ({
  id,
  type: 'convention',
  importance: 'P1',
  jamaisSupposer: false,
  titreNorme: id.toLowerCase(),
  creeLe: vieille,
  modifieLe: vieille,
  ...e,
});

test('une mémoire où tout est vital est floue ; une mémoire triée ne l’est pas', () => {
  const floue = [...Array.from({ length: 8 }, (_, i) => u(`MEM-${i}`)), u('MEM-90', { importance: 'P2' }), u('MEM-91', { importance: 'P3' })];
  const i = indicateurDeFlou(floue, MAINTENANT);
  assert.ok(i.flou);
  assert.ok(i.partVitale > SEUIL_PART_VITALE);
  const triee = [u('MEM-1'), ...Array.from({ length: 8 }, (_, k) => u(`MEM-2${k}`, { importance: 'P2' }))];
  assert.equal(indicateurDeFlou(triee, MAINTENANT).flou, false);
});

test('le plan ne touche jamais une unité vitale, récente ou lue', () => {
  const unites = [
    u('MEM-1'),
    u('MEM-2'),
    u('MEM-3'),
    u('MEM-P0', { importance: 'P0' }),
    u('MEM-JS', { jamaisSupposer: true }),
    u('DEC-1', { type: 'decision' }),
    u('MEM-NEUVE', { creeLe: MAINTENANT - 3 * JOUR, modifieLe: MAINTENANT - 3 * JOUR }),
    u('MEM-LUE', { derniereLecture: MAINTENANT - 2 * JOUR }),
    u('MEM-9', { importance: 'P3' }),
  ];
  const plan = planDeMenage(unites, { maintenant: MAINTENANT });
  const touchees = new Set(plan.map((a) => a.id));
  for (const intouchable of ['MEM-P0', 'MEM-JS', 'DEC-1', 'MEM-NEUVE', 'MEM-LUE']) assert.ok(!touchees.has(intouchable), intouchable);
  assert.ok(plan.length > 0 && plan.every((a) => a.geste === 'reclasser' && a.vers === 'P2'));
  assert.ok(planDeMenage(unites, { maintenant: MAINTENANT, max: 1 }).length <= 1, 'le lot est borné');
});

test('un doublon exact est déprécié au profit du plus important', () => {
  const plan = planDeMenage(
    [u('MEM-A', { titreNorme: 'meme titre', importance: 'P2' }), u('MEM-B', { titreNorme: 'meme titre', importance: 'P1' }), u('MEM-C', { importance: 'P3' })],
    { maintenant: MAINTENANT },
  );
  assert.deepEqual(plan[0], { geste: 'deprecier', id: 'MEM-A', auProfitDe: 'MEM-B' });
});

test('l’essai : rappel, et verdict qui annule toute baisse', () => {
  assert.equal(scoreDeRappel([{ attendu: ['A'], trouves: ['x', 'a'] }, { attendu: ['B'], trouves: ['c'] }]), 0.5);
  assert.equal(verdictDeLEssai({ rappel: 0.9, rang: 2 }, { rappel: 0.9, rang: 2.2 }), 'garder');
  assert.equal(verdictDeLEssai({ rappel: 0.9, rang: 2 }, { rappel: 0.85, rang: 2 }), 'annuler');
  assert.equal(verdictDeLEssai({ rappel: 0.9, rang: 2 }, { rappel: 0.9, rang: 3 }), 'annuler');
  const cas = casDEssaiDeLaMemoire([
    { id: 'DEC-2', type: 'decision', importance: 'P1', jamaisSupposer: false, titre: 'Décision' },
    { id: 'MEM-5', type: 'convention', importance: 'P1', jamaisSupposer: false, titre: 'Convention' },
    { id: 'MEM-6', type: 'convention', importance: 'P0', jamaisSupposer: false, titre: 'Vitale', titreHumain: 'Vitale en clair' },
  ]);
  assert.deepEqual(cas, [
    { demande: 'Décision', attendu: ['DEC-2'] },
    { demande: 'Vitale en clair', attendu: ['MEM-6'] },
  ]);
});

/* ------------------------------------------------------------------ */
/* Sur une vraie base jetable : la porte d'écriture et l'annulation      */
/* ------------------------------------------------------------------ */

const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'menage-memoire-'));
process.env.BELUGA_DATA = DONNEES;
const k = await import('../connaissances.js');
const { getDb } = await import('../db.js');
const { menageDeLaPortee } = await import('../menage-memoire.js');

const PROJET = 'p-menage';
getDb()
  .prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
  .run(PROJET, 'Ménage', DONNEES, '{}', Date.now(), Date.now());

function poserDesUnites(prefixe: string): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = k.proposerUnite(
      PROJET,
      {
        type: 'convention',
        importance: i < 8 ? 'P1' : 'P2',
        titre: `${prefixe} règle numéro ${i} des écrans de réglage`,
        resume: `La règle ${i} du ${prefixe} dit comment poser un champ de réglage numéro ${i} dans une page.`,
        sujets: ['interface'],
      },
      { auteur: 'essai', sansQuatreQuestions: true },
    );
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) ids.push(r.unite.id);
  }
  // Des unités anciennes que personne n'a lues : candidates au ménage.
  getDb().prepare('UPDATE connaissances SET cree_le = ?, modifie_le = ? WHERE portee = ?').run(vieille, vieille, PROJET);
  return ids;
}

test('un ménage qui fait baisser l’essai est annulé, unité par unité', () => {
  const ids = poserDesUnites('lot-annule');
  let appel = 0;
  const bilan = menageDeLaPortee(PROJET, {
    maintenant: MAINTENANT,
    // Avant : tout est retrouvé ; après : la moitié est perdue — une dégradation simulée.
    essai: () => (appel++ === 0 ? { rappel: 1, rang: 1 } : { rappel: 0.5, rang: 6 }),
  });
  assert.equal(bilan.issue, 'annule');
  assert.ok(bilan.gestes > 0);
  for (const id of ids.slice(0, 8)) assert.equal(k.lireUnite(id)?.importance, 'P1', `${id} restaurée`);
  const versions = k.versionsDeLUnite(ids[0]);
  assert.ok(versions.some((v) => /annulé/.test(v.motif)), 'l’annulation laisse sa trace');
});

test('un ménage qui ne dégrade pas est gardé, et passe par la porte (version gardée)', () => {
  getDb().prepare("UPDATE connaissances SET statut = 'deprecated' WHERE portee = ?").run(PROJET);
  const ids = poserDesUnites('lot-garde');
  const bilan = menageDeLaPortee(PROJET, { maintenant: MAINTENANT, essai: () => ({ rappel: 1, rang: 1 }) });
  assert.equal(bilan.issue, 'garde');
  const reclassees = ids.filter((id) => k.lireUnite(id)?.importance === 'P2');
  assert.ok(reclassees.length >= bilan.reclassees && bilan.reclassees > 0);
  assert.ok(k.versionsDeLUnite(reclassees[0]).some((v) => /ménage de nuit/.test(v.motif)));
});
