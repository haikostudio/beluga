#!/usr/bin/env node
/**
 * OÙ PASSENT LES SECONDES ENTRE LE CLIC « LANCER » ET LE PREMIER MOT DU MOTEUR.
 *
 * Le lancement d'une carte traverse quatre étapes (`shared/src/lancement-en-cours.ts`)
 * et l'écran ne disait que leur NOM, jamais leur PRIX. Ce script mesure les deux
 * postes qu'on soupçonnait, sur les vrais comptes et le vrai dépôt :
 *
 *   1. le RELEVÉ DES QUOTAS, tel que la porte dure le paie — tous les comptes,
 *      tous moteurs confondus, l'un après l'autre avec 1,5 s de souffle ;
 *   2. le même relevé CIBLÉ sur le seul moteur de la carte ;
 *   3. l'état du dépôt du projet (`etatDuDossierDuProjet`), lu à chaque
 *      lancement ;
 *   4. l'ouverture d'une copie de travail (`git worktree add`), la seule étape
 *      que personne ne prétend raccourcir.
 *
 * IL NE TOUCHE PAS À LA BASE DU DÉMON : il tourne dans un bac à sable
 * (`BELUGA_DATA`) dont seul le dossier des comptes est emprunté au vrai
 * stockage, en lecture. La copie de travail d'essai est retirée à la fin.
 *
 *   node scripts/mesure-lancement.mjs [--dossier /root/beluga]
 */
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ICI = path.dirname(fileURLToPath(import.meta.url));
const DEPOT = path.resolve(ICI, '..');

const args = process.argv.slice(2);
const projet = args.includes('--dossier') ? args[args.indexOf('--dossier') + 1] : DEPOT;

/* Le bac à sable : base neuve, comptes empruntés au vrai stockage. */
const donneesReelles = process.env.BELUGA_DATA_REEL || '/root/beluga/data';
const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-lancement-'));
fs.mkdirSync(path.join(bac, 'logs'), { recursive: true });
try {
  fs.symlinkSync(path.join(donneesReelles, 'accounts'), path.join(bac, 'accounts'));
} catch {
  console.error(`comptes introuvables dans ${donneesReelles} : la mesure des quotas sera vide`);
}
process.env.BELUGA_DATA = bac;

/*
 * LES COMPTES VIVENT DANS LA BASE, pas dans le dossier `accounts/` (qui ne
 * porte que leurs coffres). On recopie donc la seule table `accounts` du vrai
 * stockage vers le bac à sable, une fois les migrations passées : la mesure
 * porte sur les VRAIS comptes, sans jamais écrire dans la base du démon.
 */
function comptesReels() {
  const candidats = fs
    .readdirSync(donneesReelles)
    .filter((nom) => nom.endsWith('.db'))
    .map((nom) => path.join(donneesReelles, nom))
    .filter((chemin) => fs.statSync(chemin).size > 0)
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  if (!candidats.length) return [];
  const brut = spawnSync('sqlite3', ['-json', candidats[0], 'select id, engine, data, updated_at from accounts;'], {
    encoding: 'utf8',
  });
  if (brut.status !== 0) return [];
  try {
    return JSON.parse(brut.stdout || '[]');
  } catch {
    return [];
  }
}

const chrono = async (nom, geste) => {
  const debut = Date.now();
  let detail = '';
  try {
    detail = (await geste()) ?? '';
  } catch (err) {
    detail = `échec : ${err?.message ?? err}`;
  }
  const ms = Date.now() - debut;
  mesures.push({ nom, ms, detail });
  console.log(`  ${String(ms).padStart(6)} ms  ${nom}${detail ? ` — ${detail}` : ''}`);
  return ms;
};

const mesures = [];

const { getDb } = await import('../server/dist/db.js');
const base = getDb();
for (const compte of comptesReels()) {
  base.prepare('INSERT OR REPLACE INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    compte.id,
    compte.engine,
    compte.data,
    compte.updated_at,
  );
}

const { listAccountRecords, refreshQuotas } = await import('../server/dist/accounts.js');
const { etatDuDossierDuProjet } = await import('../server/dist/scheduler.js');

const comptes = listAccountRecords();
console.log(`\nComptes déclarés : ${comptes.map((c) => `${c.label} (${c.engine})`).join(', ') || 'aucun'}\n`);

console.log('RELEVÉ DES QUOTAS');
await chrono('relevé NU, tous les comptes (ce que la porte dure paie aujourd’hui)', async () => {
  const quotas = await refreshQuotas(true);
  return `${quotas.length} comptes lus`;
});

const moteur = comptes[0]?.engine ?? 'claude';
const duMoteur = comptes.filter((c) => c.engine === moteur).map((c) => c.id);
await chrono(`relevé CIBLÉ sur le moteur « ${moteur} » (${duMoteur.length} compte(s))`, async () => {
  const quotas = await refreshQuotas(true, duMoteur);
  return `${quotas.length} comptes lus`;
});

console.log('\nDÉPÔT DU PROJET');
await chrono(`état du dossier ${projet}`, async () => await etatDuDossierDuProjet(projet));

console.log('\nCOPIE DE TRAVAIL');
const essai = path.join(os.tmpdir(), `mesure-worktree-${Date.now()}`);
const branche = `essai/mesure-lancement-${Date.now()}`;
await chrono('git worktree add (branche neuve)', async () => {
  await run('git', ['worktree', 'add', '--quiet', '-b', branche, essai, 'HEAD'], { cwd: projet });
  return essai;
});
await run('git', ['worktree', 'remove', '--force', essai], { cwd: projet }).catch(() => undefined);
await run('git', ['branch', '-D', branche], { cwd: projet }).catch(() => undefined);

const total = mesures.reduce((somme, m) => somme + m.ms, 0);
console.log(`\nTOTAL des postes mesurés : ${(total / 1000).toFixed(1)} s`);
fs.rmSync(bac, { recursive: true, force: true });
process.exit(0);
