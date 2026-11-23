import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classerComptesPourLeTravail,
  comptesDeReprise,
  compteQuiRecoitLeTravail,
  deplacerUnCran,
  groupesDeComptes,
  groupeQuotaReplie,
  raisonDuChoix,
  type CompteConnu,
} from '@beluga/shared';

/*
 * L'ORDRE DES COMPTES ET DES MOTEURS, RÉGLÉ PAR L'UTILISATEUR.
 *
 * Trois choses : le geste qui réécrit les rangs d'un moteur (avec la base), la
 * mise en forme de la liste (règle pure), et le choix du compte qui suit cet
 * ordre — le plus haut de la liste reçoit le travail, même s'il a MOINS de
 * place, et le suivant ne sert qu'une fois le premier épuisé.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'ordre-des-comptes-'));
process.env.BELUGA_DATA = bacASable;

const accounts = await import('../accounts.js');
const { saveAccountRecord, listAllAccountRecords, ordonnerComptes, prioriteEnBas } = accounts;

const compte = (id: string, engine: string, priority: number, extra: Record<string, unknown> = {}) =>
  saveAccountRecord({ id, engine, label: id, priority, configDir: `/tmp/${id}`, ...extra } as any);

compte('claude-perso', 'claude', 10);
compte('claude-pro', 'claude', 20);
compte('claude-vieux', 'claude', 50, { disabled: true });
compte('codex-principal', 'codex', 10);

const rangs = (engine: string) =>
  Object.fromEntries(listAllAccountRecords().filter((a) => a.engine === engine).map((a) => [a.id, a.priority]));

test('ordonnerComptes réécrit les rangs en 10, 20, 30… dans l’ordre reçu', () => {
  const rendu = ordonnerComptes('claude', ['claude-pro', 'claude-vieux', 'claude-perso']);
  assert.deepEqual(rendu, { ok: true });
  assert.deepEqual(rangs('claude'), { 'claude-pro': 10, 'claude-vieux': 20, 'claude-perso': 30 });
});

test('l’ordre survit : relire la base rend les mêmes rangs, et un compte coupé garde le sien', () => {
  const vieux = listAllAccountRecords().find((a) => a.id === 'claude-vieux');
  assert.equal(vieux?.priority, 20);
  assert.equal(vieux?.disabled, true);
});

test('les autres moteurs ne bougent pas', () => {
  assert.deepEqual(rangs('codex'), { 'codex-principal': 10 });
});

test('un lot incomplet, périmé ou en double est refusé sans rien écrire', () => {
  const avant = rangs('claude');
  for (const lot of [['claude-pro', 'claude-perso'], ['claude-pro', 'claude-vieux', 'claude-perso', 'claude-fantome'], ['claude-pro', 'claude-pro', 'claude-perso'], ['claude-pro', 'claude-vieux', 'codex-principal']]) {
    const rendu = ordonnerComptes('claude', lot);
    assert.equal(rendu.ok, false);
  }
  assert.deepEqual(rangs('claude'), avant);
});

test('un compte neuf tombe en bas de la liste de son moteur', () => {
  assert.equal(prioriteEnBas('claude'), 40);
  assert.equal(prioriteEnBas('codex'), 20);
  assert.equal(prioriteEnBas('moteur-vide'), 10);
});

test('Pro au-dessus de Perso : Pro reçoit le travail même avec moins de place', () => {
  const perso = { id: 'claude-perso', plan: 'Max x5', priority: 20, sessionPct: 5, weeklyPct: 5 };
  const pro = { id: 'claude-pro', plan: 'Pro', priority: 10, sessionPct: 80, weeklyPct: 60 };
  assert.equal(compteQuiRecoitLeTravail([perso, pro])?.id, 'claude-pro');
  assert.deepEqual(classerComptesPourLeTravail([perso, pro]).map((c) => c.id), ['claude-pro', 'claude-perso']);
  // Pro épuisé : Perso prend le relais.
  assert.equal(compteQuiRecoitLeTravail([perso, { ...pro, sessionPct: 100 }])?.id, 'claude-perso');
});

test('le journal du choix dit la place dans la liste de l’utilisateur', () => {
  const premier = { id: 'a', priority: 10 };
  const second = { id: 'b', priority: 20 };
  assert.match(raisonDuChoix(premier, [second, premier]), /^n° 1 de votre liste/);
  assert.match(raisonDuChoix(second, [second, premier]), /^n° 2 de votre liste/);
  assert.match(raisonDuChoix(second), /^n° 1 de votre liste/);
});

test('la liste se range par moteur, dans l’ordre réglé, les moteurs payés au crédit en dernier', () => {
  const lignes = [
    { id: 'cursor-1', engine: 'cursor', priority: 10, label: 'Cursor' },
    { id: 'claude-b', engine: 'claude', priority: 20, label: 'B' },
    { id: 'codex-1', engine: 'codex', priority: 10, label: 'Codex' },
    { id: 'claude-a', engine: 'claude', priority: 10, label: 'A' },
  ];
  const parDefaut = groupesDeComptes(lignes);
  assert.deepEqual(parDefaut.map((g) => g.engine), ['claude', 'codex', 'cursor']);
  assert.deepEqual(parDefaut[0].comptes.map((c) => c.id), ['claude-a', 'claude-b']);
  assert.deepEqual(parDefaut.map((g) => g.reglable), [true, true, false]);
  const regle = groupesDeComptes(lignes, ['codex', 'claude']);
  assert.deepEqual(regle.map((g) => g.engine), ['codex', 'claude', 'cursor']);
});

test('un déplacement d’un cran échange deux voisins, et refuse les butées', () => {
  assert.deepEqual(deplacerUnCran(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(deplacerUnCran(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.equal(deplacerUnCran(['a', 'b', 'c'], 'a', -1), null);
  assert.equal(deplacerUnCran(['a', 'b', 'c'], 'c', 1), null);
  assert.equal(deplacerUnCran(['a', 'b', 'c'], 'z', 1), null);
});

test('la reprise propose d’abord le même moteur, puis les autres selon l’ordre réglé, puis le rang des comptes', () => {
  const base = { disponible: true, coupe: false } as const;
  const comptes: CompteConnu[] = [
    { ...base, id: 'cursor-1', label: 'Cursor', engine: 'cursor', priority: 10 },
    { ...base, id: 'codex-1', label: 'Codex', engine: 'codex', priority: 10, sessionPct: 90 },
    { ...base, id: 'claude-pro', label: 'Pro', engine: 'claude', priority: 20 },
    { ...base, id: 'claude-perso', label: 'Perso', engine: 'claude', priority: 10, sessionPct: 70 },
    { ...base, id: 'claude-tombe', label: 'Tombé', engine: 'claude', priority: 5 },
  ];
  const choix = comptesDeReprise('claude', 'claude-tombe', comptes, { tousMoteurs: true, ordreDesMoteurs: ['codex', 'claude'] });
  assert.deepEqual(choix.map((c) => c.id), ['claude-perso', 'claude-pro', 'codex-1', 'cursor-1']);
  const sansMoteur = comptesDeReprise('codex', 'codex-1', comptes, { tousMoteurs: true, ordreDesMoteurs: ['claude', 'codex'] });
  assert.deepEqual(sansMoteur.map((c) => c.id).slice(0, 3), ['claude-tombe', 'claude-perso', 'claude-pro']);
});

test('un groupe du panneau des quotas se replie d’office quand aucun de ses comptes ne sert, et le choix de l’utilisateur l’emporte', () => {
  const coupes = { engine: 'mimo', comptes: [{ disabled: true }] };
  const suivi = { engine: 'ext-google-gemini', comptes: [{ suivi: true }] };
  const actif = { engine: 'claude', comptes: [{ disabled: true }, { disabled: false }] };
  assert.equal(groupeQuotaReplie(coupes), true);
  assert.equal(groupeQuotaReplie(suivi), true);
  assert.equal(groupeQuotaReplie(actif), false);
  assert.equal(groupeQuotaReplie({ engine: 'vide', comptes: [] }), false);
  assert.equal(groupeQuotaReplie(coupes, { mimo: false }), false);
  assert.equal(groupeQuotaReplie(actif, { claude: true }), true);
  assert.equal(groupeQuotaReplie(actif, { mimo: true }), false);
});
