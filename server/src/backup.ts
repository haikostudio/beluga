import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PAGES_MIN_PAR_PAS, pagesDuPasSuivant } from '@beluga/shared';
import { getDb } from './db.js';
import { PATHS, CONFIG } from './config.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Sauvegarde et restauration (PLAN §23). La base est copiée À CHAUD, sans
 * arrêter le service. Les secrets restent dehors : ils se recréent.
 */

/*
 * L'ARCHIVE NE DORT PAS SUR LE DISQUE QU'ELLE PROTÈGE (04/11/2026). Elle
 * s'écrivait dans `data/backups`, et le nettoyage du serveur ne l'emportait
 * sur le grand disque qu'au bout de 24 h : 1,5 Go restait donc en permanence
 * sur le disque du serveur. Elle s'écrit désormais DIRECTEMENT sur le grand
 * disque, dans le dossier où le nettoyage la rangeait déjà. Seule la copie de
 * la base, le temps de l'archiver, reste sur ce disque (quelques minutes) :
 * SQLite ne copie pas de façon fiable vers un montage réseau. Grand disque
 * absent : repli sur `data/backups`, que le nettoyage videra ensuite.
 */
const RACINE_GRAND_DISQUE = '/mnt/sauvegardes';
// « backups-beluga » jusqu'au 08/11/2026 : renommé au démarrage (`passage-backups.ts`), avant toute archive.
const DOSSIER_GRAND_DISQUE = path.join(RACINE_GRAND_DISQUE, 'sauvegardes-service-beluga', 'copies-locales-archivees');

/** Le dossier des archives sur le grand disque, s'il est vraiment monté. `BELUGA_SAUVEGARDES_DISTANTES` sert aux essais. */
function dossierSurLeGrandDisque(): string | undefined {
  const force = process.env.BELUGA_SAUVEGARDES_DISTANTES?.trim();
  if (force) return force;
  // Un disque non monté laisserait mkdir écrire sur le disque du serveur : on vérifie le montage.
  try {
    const montages = fs.readFileSync('/proc/mounts', 'utf8');
    return montages.split('\n').some((l) => l.split(' ')[1] === RACINE_GRAND_DISQUE) ? DOSSIER_GRAND_DISQUE : undefined;
  } catch {
    return undefined;
  }
}

/** Les dossiers où vivent les archives de Beluga : le local (repli, anciennes) puis le grand disque. */
function dossiersDesArchives(): string[] {
  const distant = dossierSurLeGrandDisque();
  return distant ? [PATHS.backups, distant] : [PATHS.backups];
}

export interface BackupEntry {
  name: string;
  size: number;
  at: number;
}

export async function runBackup(reason = 'automatique'): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    fs.mkdirSync(PATHS.backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(PATHS.backups, `beluga-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });

    /*
     * COPIE À CHAUD DE LA BASE, PAR MORCEAUX, SANS FIGER LE DÉMON. `VACUUM INTO`
     * recopiait les 2 Go d'un seul tenant sur le fil principal : ~32 s sans
     * répondre à personne, chaque nuit vers 3 h (enquête des décrochages,
     * 28/10/2026). L'API de sauvegarde de SQLite copie un pas de pages à la
     * fois et rend la main entre deux pas ; chaque pas est réglé pour durer
     * ~50 ms (`pagesDuPasSuivant`). La copie reste cohérente — une écriture
     * faite pendant la copie y est reportée, ou la fait reprendre.
     */
    // Départ prudent : le premier pas ne sait encore rien du disque, les suivants doublent tant qu'ils restent sous la cible.
    let pages = PAGES_MIN_PAR_PAS;
    let depuis = Date.now();
    await getDb().backup(path.join(dir, 'beluga.db'), {
      progress: () => {
        const maintenant = Date.now();
        pages = pagesDuPasSuivant(pages, maintenant - depuis);
        depuis = maintenant;
        return pages;
      },
    });

    // Archive compressée : la base depuis le dossier temporaire, les données volumineuses lues directement.
    // Écrite sur le grand disque quand il est là, jamais posée ici pour y attendre.
    const distant = dossierSurLeGrandDisque();
    if (distant) fs.mkdirSync(distant, { recursive: true });
    else log.warn('grand disque absent : la sauvegarde reste sur le disque du serveur jusqu’au prochain nettoyage');
    const archive = path.join(distant ?? PATHS.backups, `${path.basename(dir)}.tar.gz`);
    const tarArgs = [
      'czf', archive,
      '-C', dir, 'beluga.db',
      '-C', CONFIG.dataDir,
    ];

    for (const folder of ['attachments', 'documents']) {
      const source = path.join(CONFIG.dataDir, folder);
      if (fs.existsSync(source)) {
        tarArgs.push(folder);
      }
    }

    tarArgs.push('--transform', `s,^,${path.basename(dir)}/,`);
    try {
      // Vers le grand disque, l'écriture passe par le réseau : plus de temps qu'en local.
      await execFileAsync('tar', tarArgs, { timeout: distant ? 1_800_000 : 300_000 });
    } catch (err) {
      fs.rmSync(archive, { force: true });
      throw err;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    await copyOffSite(archive);
    prune();
    log.info(`sauvegarde ${reason} : ${path.basename(archive)}`);
    bus.toast('success', 'Sauvegarde effectuée');
    return { ok: true, file: archive };
  } catch (err: any) {
    log.error('sauvegarde impossible', err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Copie hors du serveur, chiffrée (PLAN §23). La destination se déclare dans
 * BELUGA_OFFSITE (une cible rsync/scp, ex. « sauvegardes@ailleurs:/beluga »)
 * et la phrase secrète dans BELUGA_OFFSITE_KEY. Sans ces deux réglages, la
 * copie distante est simplement sautée : la sauvegarde locale reste faite.
 * Les secrets du serveur ne partent JAMAIS dans la copie : ils se recréent.
 */
async function copyOffSite(archive: string): Promise<void> {
  const target = process.env.BELUGA_OFFSITE?.trim();
  const passphrase = process.env.BELUGA_OFFSITE_KEY?.trim();
  if (!target || !passphrase) return;

  const encrypted = `${archive}.enc`;
  try {
    // Chiffrement à clé symétrique : le fichier est illisible sans la phrase.
    const key = crypto.scryptSync(passphrase, 'beluga-sauvegarde', 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const input = fs.readFileSync(archive);
    const body = Buffer.concat([cipher.update(input), cipher.final()]);
    fs.writeFileSync(encrypted, Buffer.concat([iv, cipher.getAuthTag(), body]));

    await execFileAsync('rsync', ['-a', '--timeout=300', encrypted, target], { timeout: 900000 });
    log.info(`copie hors serveur envoyée : ${path.basename(encrypted)}`);
  } catch (err: any) {
    log.warn('copie hors serveur impossible', err?.message ?? err);
  } finally {
    fs.rmSync(encrypted, { force: true });
  }
}

/** Conservation dégressive : chaque jour de la semaine, chaque semaine du mois, chaque mois de l'année. */
function prune(): void {
  // Le grand disque n'est pas élagué ici (il ne l'était pas non plus quand le nettoyage y rangeait les archives).
  const files = listBackups().filter((f) => f.dir === PATHS.backups);
  const keep = new Set<string>();
  const byDay = new Map<string, BackupEntry>();
  const byWeek = new Map<string, BackupEntry>();
  const byMonth = new Map<string, BackupEntry>();

  for (const file of files) {
    const date = new Date(file.at);
    const day = date.toISOString().slice(0, 10);
    const week = `${date.getUTCFullYear()}-S${Math.floor(date.getUTCDate() / 7)}-${date.getUTCMonth()}`;
    const month = date.toISOString().slice(0, 7);
    if (!byDay.has(day)) byDay.set(day, file);
    if (!byWeek.has(week)) byWeek.set(week, file);
    if (!byMonth.has(month)) byMonth.set(month, file);
  }

  const now = Date.now();
  for (const [day, file] of byDay) if (now - new Date(day).getTime() < 8 * 24 * 3600 * 1000) keep.add(file.name);
  for (const file of byWeek.values()) if (now - file.at < 35 * 24 * 3600 * 1000) keep.add(file.name);
  for (const file of byMonth.values()) if (now - file.at < 400 * 24 * 3600 * 1000) keep.add(file.name);

  for (const file of files) {
    if (!keep.has(file.name)) {
      try {
        fs.unlinkSync(path.join(file.dir, file.name));
      } catch {
        /* déjà parti */
      }
    }
  }
}

export function listBackups(): Array<BackupEntry & { dir: string }> {
  const entrees: Array<BackupEntry & { dir: string }> = [];
  for (const dir of dossiersDesArchives()) {
    try {
      for (const name of fs.readdirSync(dir)) {
        // Le dossier du grand disque reçoit aussi d'autres copies : seules les archives de Beluga comptent.
        if (!name.endsWith('.tar.gz') || !name.startsWith('beluga-')) continue;
        const stat = fs.statSync(path.join(dir, name));
        entrees.push({ name, size: stat.size, at: stat.mtimeMs, dir });
      }
    } catch {
      /* dossier absent */
    }
  }
  return entrees.sort((a, b) => b.at - a.at);
}

/** Restauration testée pour de vrai : une sauvegarde jamais remontée n'existe pas. */
export async function verifyBackup(file: string): Promise<{ ok: boolean; detail: string }> {
  const nom = path.basename(file);
  const archive = dossiersDesArchives()
    .map((dir) => path.join(dir, nom))
    .find((chemin) => fs.existsSync(chemin));
  if (!archive) return { ok: false, detail: 'archive introuvable' };
  // Extraite à côté de l'archive : sur le grand disque quand elle y est.
  const temp = fs.mkdtempSync(path.join(path.dirname(archive), 'verif-'));
  try {
    await execFileAsync('tar', ['xzf', archive, '-C', temp], { timeout: 300000 });
    const inner = fs.readdirSync(temp)[0];
    const dbFile = path.join(temp, inner, 'beluga.db');
    if (!fs.existsSync(dbFile)) return { ok: false, detail: 'base absente de la sauvegarde' };

    const Database = (await import('better-sqlite3')).default;
    const restored = new Database(dbFile, { readonly: true });
    const projects = restored.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
    const cards = restored.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number };
    const integrity = restored.pragma('integrity_check', { simple: true });
    restored.close();

    const ok = integrity === 'ok';
    return {
      ok,
      detail: ok
        ? `Restauration vérifiée : ${projects.n} projet(s), ${cards.n} carte(s) relus depuis la sauvegarde.`
        : `Base corrompue : ${integrity}`,
    };
  } catch (err: any) {
    return { ok: false, detail: err?.message ?? String(err) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function scheduleNightlyBackup(hourGetter: () => number): NodeJS.Timeout {
  let lastDay = -1;
  return setInterval(
    () => {
      const now = new Date();
      if (now.getHours() === hourGetter() && now.getDate() !== lastDay) {
        lastDay = now.getDate();
        void runBackup('nocturne');
      }
    },
    5 * 60 * 1000,
  );
}
