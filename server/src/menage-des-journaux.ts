/**
 * LE MÉNAGE QUOTIDIEN DES VIEUX JOURNAUX DE CARTES ET DES TRACES DU JUGE.
 *
 * Au-delà de `CONSERVATION_JOURNAUX_MS` (7 jours) :
 *   1. ce qui va partir est COPIÉ sur le disque externe (jamais sur le disque
 *      du serveur) — si la copie échoue, RIEN n'est vidé ce jour-là ;
 *   2. les traces du juge sont RÉSUMÉES dans une base évolutive (compteurs
 *      cumulés, jamais recalculés) ;
 *   3. le texte du journal est vidé, la LIGNE reste (rangs contigus, MEM-0307) ;
 *   4. les traces du juge sont effacées.
 *
 * Pas de VACUUM : SQLite réutilise l'espace libéré. Une erreur se note, elle ne
 * fait jamais tomber la boucle de fond.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { CONSERVATION_JOURNAUX_MS } from '@beluga/shared';
import { CONFIG } from './config.js';
import { getDb } from './db.js';
import { purgerLesCopiesAnciennes } from './fichiers-conserves.js';
import { allegerUnLotDeJournaux } from './journal-carte.js';
import { purgerLesTracesAnciennes } from './jugement-rapide.js';
import { log } from './logger.js';

const RACINE_EXTERNE = '/mnt/sauvegardes';
const DOSSIER_EXTERNE = path.join(RACINE_EXTERNE, 'beluga-archives-journaux');
const TAILLE_DE_PAGE = 5000;
const UNE_JOURNEE = 24 * 60 * 60 * 1000;
/** La base évolutive du juge ne dépasse jamais ce nombre de motifs par rubrique. */
export const PLAFOND_DES_MOTIFS = 40;

/** Où vont les archives. `BELUGA_ARCHIVES_JOURNAUX` sert aux essais (aucun contrôle de montage). */
function dossierDesArchives(): string | undefined {
  const force = process.env.BELUGA_ARCHIVES_JOURNAUX;
  if (force) return force;
  // Un disque non monté laisserait mkdir écrire sur le disque du serveur : on vérifie le montage.
  try {
    const montages = fs.readFileSync('/proc/mounts', 'utf8');
    const monte = montages.split('\n').some((l) => l.split(' ')[1] === RACINE_EXTERNE);
    return monte ? DOSSIER_EXTERNE : undefined;
  } catch {
    return undefined;
  }
}

const dossierDeLaBase = (): string => path.join(CONFIG.dataDir, 'juge');

/* ------------------------------------------------------------------ */
/* L'ARCHIVE                                                           */
/* ------------------------------------------------------------------ */

/**
 * Copie les lignes d'une requête paginée (curseur sur rowid) dans un fichier
 * jsonl.gz écrit sous un nom temporaire puis renommé. Rend le nombre de lignes
 * écrites (0 = aucun fichier créé). Lève si l'écriture échoue.
 */
async function archiver(
  dossier: string,
  prefixe: string,
  lire: (apres: number, limite: number) => { rowid: number }[],
): Promise<number> {
  let apres = 0;
  let total = 0;
  let sortie: fs.WriteStream | undefined;
  let gz: zlib.Gzip | undefined;
  let fini: Promise<void> | undefined;
  const tmp = path.join(dossier, `${prefixe}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl.gz.tmp`);
  try {
    for (;;) {
      const page = lire(apres, TAILLE_DE_PAGE);
      if (page.length === 0) break;
      if (!gz) {
        fs.mkdirSync(dossier, { recursive: true });
        sortie = fs.createWriteStream(tmp);
        gz = zlib.createGzip();
        gz.pipe(sortie);
        fini = once(sortie, 'close').then(() => undefined);
      }
      const texte = page.map((l) => JSON.stringify(l)).join('\n') + '\n';
      if (!gz.write(texte)) await once(gz, 'drain');
      apres = page[page.length - 1].rowid;
      total += page.length;
    }
    if (!gz) return 0;
    gz.end();
    await fini;
    if (fs.statSync(tmp).size <= 0) throw new Error('archive vide');
    fs.renameSync(tmp, tmp.replace(/\.tmp$/, ''));
    return total;
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* rien */
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* LA BASE ÉVOLUTIVE DU JUGE                                           */
/* ------------------------------------------------------------------ */

export interface BaseDuJuge {
  /** Dernière trace résumée : une trace n'est jamais comptée deux fois. */
  dernierId: number;
  total: number;
  repondu: number;
  echecs: number;
  usages: Record<string, { total: number; echecs: number; latenceMs: number; jetons: number; confiance: number; avecConfiance: number }>;
  /** Ce que l'application a décidé après le jugement (`suite`), par fréquence. */
  suites: Record<string, number>;
  /** Pourquoi les appels ont échoué (`reponse` d'un échec, tronquée), par fréquence. */
  motifsDEchec: Record<string, number>;
  premiere: number;
  derniere: number;
}

export function baseVide(): BaseDuJuge {
  return { dernierId: 0, total: 0, repondu: 0, echecs: 0, usages: {}, suites: {}, motifsDEchec: {}, premiere: 0, derniere: 0 };
}

/** Garde les motifs les plus fréquents ; le reste se fond dans « (autres) ». */
export function plafonner(motifs: Record<string, number>, max = PLAFOND_DES_MOTIFS): Record<string, number> {
  const entrees = Object.entries(motifs).sort((a, b) => b[1] - a[1]);
  if (entrees.length <= max) return motifs;
  const gardes = entrees.filter(([k]) => k !== '(autres)').slice(0, max - 1);
  const reste = entrees.reduce((n, [k, v]) => n + v, 0) - gardes.reduce((n, [, v]) => n + v, 0);
  return { ...Object.fromEntries(gardes), '(autres)': reste };
}

interface TraceBrute {
  id: number;
  usage_cle: string;
  reponse: string;
  confiance: number | null;
  latence_ms: number;
  suite: string;
  issue: string;
  jetons_entree: number;
  jetons_sortie: number;
  at: number;
}

/** Ajoute des traces à la base : on INCRÉMENTE, on ne recalcule jamais ce qui est déjà compté. */
export function fusionner(base: BaseDuJuge, traces: readonly TraceBrute[]): BaseDuJuge {
  const b: BaseDuJuge = JSON.parse(JSON.stringify(base));
  for (const t of traces) {
    if (t.id <= b.dernierId) continue;
    b.dernierId = t.id;
    b.total += 1;
    if (t.issue === 'repondu') b.repondu += 1;
    else b.echecs += 1;
    const u = (b.usages[t.usage_cle] ??= { total: 0, echecs: 0, latenceMs: 0, jetons: 0, confiance: 0, avecConfiance: 0 });
    u.total += 1;
    if (t.issue !== 'repondu') u.echecs += 1;
    u.latenceMs += t.latence_ms;
    u.jetons += t.jetons_entree + t.jetons_sortie;
    if (t.confiance != null) {
      u.confiance += t.confiance;
      u.avecConfiance += 1;
    }
    const suite = (t.suite || '(aucune)').slice(0, 80);
    b.suites[suite] = (b.suites[suite] ?? 0) + 1;
    if (t.issue !== 'repondu') {
      const motif = (t.reponse || '(sans motif)').slice(0, 100);
      b.motifsDEchec[motif] = (b.motifsDEchec[motif] ?? 0) + 1;
    }
    b.premiere = b.premiere ? Math.min(b.premiere, t.at) : t.at;
    b.derniere = Math.max(b.derniere, t.at);
  }
  b.suites = plafonner(b.suites);
  b.motifsDEchec = plafonner(b.motifsDEchec);
  return b;
}

/** Le document lisible, rendu depuis les compteurs. Court par construction (plafond des motifs). */
export function rendreLaBase(b: BaseDuJuge): string {
  const jour = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '—');
  const lignes = [
    '# Base évolutive du juge rapide',
    '',
    `Synthèse cumulée des traces de plus de 7 jours (avant leur effacement) : ${b.total} jugements du ${jour(b.premiere)} au ${jour(b.derniere)}, ${pct(b.repondu, b.total)} répondus, ${b.echecs} échecs. Mise à jour par ajout, jamais recalculée.`,
    '',
    '## Par usage',
    '',
    ...Object.entries(b.usages)
      .sort((a, c) => c[1].total - a[1].total)
      .map(
        ([k, u]) =>
          `- ${k} : ${u.total} jugements, ${u.echecs} échecs, latence moyenne ${Math.round(u.latenceMs / u.total)} ms, confiance moyenne ${u.avecConfiance ? (u.confiance / u.avecConfiance).toFixed(2) : '—'}, ${u.jetons} jetons`,
      ),
    '',
    '## Ce que l’application a décidé ensuite (les plus fréquents)',
    '',
    ...Object.entries(b.suites)
      .sort((a, c) => c[1] - a[1])
      .map(([k, n]) => `- ${n} × ${k}`),
    '',
    '## Motifs d’échec récurrents',
    '',
    ...(Object.keys(b.motifsDEchec).length
      ? Object.entries(b.motifsDEchec)
          .sort((a, c) => c[1] - a[1])
          .map(([k, n]) => `- ${n} × ${k}`)
      : ['- aucun']),
    '',
  ];
  return lignes.join('\n');
}

function lireLaBase(): BaseDuJuge {
  try {
    return { ...baseVide(), ...JSON.parse(fs.readFileSync(path.join(dossierDeLaBase(), 'base-evolutive.json'), 'utf8')) };
  } catch {
    return baseVide();
  }
}

function ecrireLaBase(b: BaseDuJuge): void {
  const dossier = dossierDeLaBase();
  fs.mkdirSync(dossier, { recursive: true });
  for (const [nom, contenu] of [
    ['base-evolutive.json', JSON.stringify(b, null, 1)],
    ['base-evolutive.md', rendreLaBase(b)],
  ] as const) {
    const tmp = path.join(dossier, `${nom}.tmp`);
    fs.writeFileSync(tmp, contenu);
    fs.renameSync(tmp, path.join(dossier, nom));
  }
}

/** Résume dans la base les traces d'avant `avant` pas encore comptées. Rend le nombre ajouté. */
export function synthetiserLesTraces(avant: number): number {
  const base = lireLaBase();
  const traces = getDb()
    .prepare('SELECT * FROM jugement_traces WHERE at < ? AND id > ? ORDER BY id')
    .all(avant, base.dernierId) as TraceBrute[];
  if (traces.length === 0) return 0;
  const apres = fusionner(base, traces);
  ecrireLaBase(apres);
  return apres.total - base.total;
}

/* ------------------------------------------------------------------ */
/* LA PASSE                                                            */
/* ------------------------------------------------------------------ */

export interface BilanDuMenage {
  archiveesJournal: number;
  archiveesTraces: number;
  resumees: number;
  allegees: number;
  traceesEffacees: number;
  ignore?: string;
}

/**
 * Une passe complète. Ne lève JAMAIS. Rend ce qui a été fait ; `ignore` dit
 * pourquoi rien n'a été vidé (disque externe absent, copie impossible).
 */
export async function menageDesJournaux(maintenant = Date.now()): Promise<BilanDuMenage> {
  const bilan: BilanDuMenage = { archiveesJournal: 0, archiveesTraces: 0, resumees: 0, allegees: 0, traceesEffacees: 0 };
  const avant = maintenant - CONSERVATION_JOURNAUX_MS;
  const dossier = dossierDesArchives();
  if (!dossier) {
    bilan.ignore = 'disque externe non monté : rien n’est vidé';
    log.warn(`ménage des journaux : ${bilan.ignore}`);
    return bilan;
  }
  const db = getDb;
  try {
    const jour = new Date(maintenant).toISOString().slice(0, 10);
    bilan.archiveesJournal = await archiver(dossier, `journal-${jour}`, (apres, limite) =>
      db()
        .prepare(
          `SELECT rowid AS rowid, id, card_id, rang, at, phase, nature, outil, params, resultat
           FROM card_journal
           WHERE rowid > ? AND at < ? AND ((resultat IS NOT NULL AND resultat != '') OR params IS NOT NULL)
           ORDER BY rowid LIMIT ?`,
        )
        .all(apres, avant, limite) as { rowid: number }[],
    );
    bilan.archiveesTraces = await archiver(dossier, `traces-juge-${jour}`, (apres, limite) =>
      db()
        .prepare('SELECT rowid AS rowid, * FROM jugement_traces WHERE rowid > ? AND at < ? ORDER BY rowid LIMIT ?')
        .all(apres, avant, limite) as { rowid: number }[],
    );
  } catch (err: any) {
    bilan.ignore = `copie sur le disque externe impossible (${err?.message ?? err}) : rien n’est vidé`;
    log.warn(`ménage des journaux : ${bilan.ignore}`);
    return bilan;
  }

  try {
    bilan.resumees = synthetiserLesTraces(avant);
  } catch (err: any) {
    // Sans résumé, les traces ne s'effacent pas : on ne perd pas ce qu'elles ont appris.
    bilan.ignore = `synthèse du juge impossible (${err?.message ?? err}) : traces gardées`;
    log.warn(`ménage des journaux : ${bilan.ignore}`);
  }

  try {
    for (;;) {
      const n = allegerUnLotDeJournaux(avant, TAILLE_DE_PAGE);
      bilan.allegees += n;
      if (n < TAILLE_DE_PAGE) break;
      await new Promise((r) => setImmediate(r)); // laisse la base aux autres
    }
  } catch (err: any) {
    log.warn(`ménage des journaux : allègement interrompu (${err?.message ?? err})`);
  }

  if (!bilan.ignore) bilan.traceesEffacees = purgerLesTracesAnciennes(avant);
  if (bilan.allegees || bilan.traceesEffacees || bilan.archiveesJournal) {
    log.info(
      `ménage des journaux : ${bilan.allegees} lignes allégées, ${bilan.traceesEffacees} traces du juge effacées, ${bilan.archiveesJournal + bilan.archiveesTraces} lignes copiées sur le disque externe`,
    );
  }
  return bilan;
}

let derniereFois = 0;
let enCours = false;

/** Appelée à chaque tour de la boucle de fond : n'agit qu'une fois par 24 h. */
export async function menageQuotidienDesJournaux(maintenant = Date.now()): Promise<void> {
  if (enCours || maintenant - derniereFois < UNE_JOURNEE) return;
  enCours = true;
  try {
    // Passe indépendante des journaux : leur disque d'archives n'est pas celui des copies.
    purgerLesCopiesAnciennes(maintenant);
    const bilan = await menageDesJournaux(maintenant);
    // Un disque absent ne compte pas comme un passage : on réessaie au tour suivant.
    if (!bilan.ignore) derniereFois = maintenant;
  } catch (err: any) {
    log.warn(`ménage des journaux : ${err?.message ?? err}`);
  } finally {
    enCours = false;
  }
}
