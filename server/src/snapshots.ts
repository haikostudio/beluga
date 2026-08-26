import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  PointDeSauvegarde,
  SiteASauvegarder,
  StatutDePoint,
  dossierDeSite,
  horodatageDePoint,
  jugerSite,
  nettoyerSite,
  pointsAPurger,
  raisonDestinationRefusee,
  siteEstDu,
  siteVierge,
} from '@haikodev/shared';
import { getDb } from './db.js';
import { getSettings, listProjects } from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * LES SNAPSHOTS DES SITES EN PRODUCTION — le travail réel.
 *
 * Les règles qui se décident sans base ni disque vivent dans
 * `shared/src/snapshots.ts`. Ici : le rangement en base, la prise d'un point
 * (base de données puis fichiers), le passage automatique de nuit et le ménage.
 *
 * LA DESTINATION NE SE DEVINE PAS. Le disque de stockage est monté sur la
 * machine ; son dossier se règle dans « Système ». Tant qu'il n'est pas
 * renseigné, rien ne part et la raison est DITE — mieux qu'un échec par site,
 * chaque nuit, sans que personne ne sache pourquoi.
 *
 * AUCUN MOT DE PASSE NE PASSE PAR LA LIGNE DE COMMANDE : `mysqldump` le reçoit
 * par `MYSQL_PWD`, `pg_dump` par `PGPASSWORD`, `lftp` par son entrée standard.
 * La liste des processus de la machine ne les montre donc jamais.
 */

/* ------------------------------------------------------------------ */
/* Le rangement en base                                                 */
/* ------------------------------------------------------------------ */

interface LigneSite {
  id: string;
  project_id: string | null;
  nom: string;
  actif: number;
  data: string;
  cree_le: number;
  modifie_le: number;
}

function siteDepuisLigne(ligne: LigneSite): SiteASauvegarder {
  let bloc: Partial<SiteASauvegarder> = {};
  try {
    const lu = JSON.parse(ligne.data ?? '{}');
    if (lu && typeof lu === 'object') bloc = lu as Partial<SiteASauvegarder>;
  } catch {
    // Un bloc abîmé rend une fiche vide plutôt que de faire tomber la liste.
  }
  const vierge = siteVierge(ligne.project_id, ligne.nom);
  return {
    ...vierge,
    ...bloc,
    base: { ...vierge.base, ...(bloc.base ?? {}) },
    fichiers: { ...vierge.fichiers, ...(bloc.fichiers ?? {}) },
    id: ligne.id,
    nom: ligne.nom,
    projectId: ligne.project_id,
    actif: ligne.actif === 1,
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
  };
}

export function listerSites(): SiteASauvegarder[] {
  const lignes = getDb()
    .prepare('SELECT * FROM snapshot_sites ORDER BY nom COLLATE NOCASE ASC')
    .all() as LigneSite[];
  return lignes.map(siteDepuisLigne);
}

export function lireSite(id: string): SiteASauvegarder | null {
  const ligne = getDb().prepare('SELECT * FROM snapshot_sites WHERE id = ?').get(id) as LigneSite | undefined;
  return ligne ? siteDepuisLigne(ligne) : null;
}

export function enregistrerSite(
  brut: SiteASauvegarder,
): { ok: true; site: SiteASauvegarder } | { ok: false; raison: string } {
  const propre = nettoyerSite({ ...siteVierge(), ...brut });
  const jugement = jugerSite(propre);
  if (!jugement.ok) return { ok: false, raison: jugement.raison ?? 'fiche refusée' };

  const maintenant = Date.now();
  const id = propre.id || crypto.randomUUID();
  const ancien = propre.id ? lireSite(propre.id) : null;
  const site: SiteASauvegarder = {
    ...propre,
    id,
    creeLe: ancien?.creeLe || maintenant,
    modifieLe: maintenant,
  };

  getDb()
    .prepare(
      `INSERT INTO snapshot_sites (id, project_id, nom, actif, data, cree_le, modifie_le)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         nom = excluded.nom,
         actif = excluded.actif,
         data = excluded.data,
         modifie_le = excluded.modifie_le`,
    )
    .run(site.id, site.projectId, site.nom, site.actif ? 1 : 0, JSON.stringify(site), site.creeLe, site.modifieLe);
  return { ok: true, site };
}

export function supprimerSite(id: string): { ok: boolean; raison?: string } {
  const site = lireSite(id);
  if (!site) return { ok: false, raison: 'site introuvable' };
  // Les points s'en vont avec le site (ON DELETE CASCADE) ; les fichiers déjà
  // posés sur le disque de stockage RESTENT. Effacer des sauvegardes est un
  // geste qu'on ne fait pas dans le dos de celui qui retire une fiche.
  getDb().prepare('DELETE FROM snapshot_sites WHERE id = ?').run(id);
  return { ok: true };
}

interface LignePoint {
  id: string;
  site_id: string;
  debut: number;
  statut: string;
  data: string;
}

function pointDepuisLigne(ligne: LignePoint): PointDeSauvegarde {
  let bloc: Partial<PointDeSauvegarde> = {};
  try {
    const lu = JSON.parse(ligne.data ?? '{}');
    if (lu && typeof lu === 'object') bloc = lu as Partial<PointDeSauvegarde>;
  } catch {
    /* bloc abîmé : les colonnes suffisent à l'afficher */
  }
  return {
    id: ligne.id,
    siteId: ligne.site_id,
    debut: ligne.debut,
    fin: bloc.fin ?? ligne.debut,
    statut: (ligne.statut as StatutDePoint) ?? 'echec',
    octetsBase: bloc.octetsBase ?? 0,
    octetsFichiers: bloc.octetsFichiers ?? 0,
    chemin: bloc.chemin ?? '',
    detail: bloc.detail ?? '',
    origine: bloc.origine === 'manuel' ? 'manuel' : 'automatique',
  };
}

export function listerPoints(siteId?: string): PointDeSauvegarde[] {
  const db = getDb();
  const lignes = (
    siteId
      ? db.prepare('SELECT * FROM snapshot_points WHERE site_id = ? ORDER BY debut DESC').all(siteId)
      : db.prepare('SELECT * FROM snapshot_points ORDER BY debut DESC').all()
  ) as LignePoint[];
  return lignes.map(pointDepuisLigne);
}

function enregistrerPoint(point: PointDeSauvegarde): PointDeSauvegarde {
  getDb()
    .prepare('INSERT INTO snapshot_points (id, site_id, debut, statut, data) VALUES (?, ?, ?, ?, ?)')
    .run(point.id, point.siteId, point.debut, point.statut, JSON.stringify(point));
  return point;
}

function oublierPoint(id: string): void {
  getDb().prepare('DELETE FROM snapshot_points WHERE id = ?').run(id);
}

/** Le dernier point de chaque site, tel que le passage de nuit le consulte. */
export function derniersPoints(): Map<string, PointDeSauvegarde> {
  const derniers = new Map<string, PointDeSauvegarde>();
  for (const point of listerPoints()) {
    if (!derniers.has(point.siteId)) derniers.set(point.siteId, point);
  }
  return derniers;
}

/**
 * LES PROJETS DE CE SERVEUR QUI N'ONT PAS ENCORE DE FICHE. La fenêtre les
 * propose d'un clic : on ne resaisit pas un nom que le tableau connaît déjà.
 */
export function projetsSansFiche(): { id: string; nom: string }[] {
  const dejaLa = new Set(listerSites().map((site) => site.projectId).filter(Boolean));
  return listProjects()
    .filter((projet) => !dejaLa.has(projet.id))
    .map((projet) => ({ id: projet.id, nom: projet.name }));
}

/* ------------------------------------------------------------------ */
/* Prendre un point                                                     */
/* ------------------------------------------------------------------ */

/** Les sites dont un snapshot tourne EN CE MOMENT : on ne le double jamais. */
const enCours = new Set<string>();

export function snapshotsEnCours(): string[] {
  return [...enCours];
}

function poidsDuDossier(cible: string): number {
  let total = 0;
  const parcourir = (dossier: string) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (entree.isFile()) total += fs.statSync(chemin).size;
    }
  };
  try {
    parcourir(cible);
  } catch {
    /* dossier parti : ce qui a été compté suffit */
  }
  return total;
}

/**
 * Un vidage de base écrit DIRECTEMENT dans un fichier compressé : la sortie du
 * programme passe par le compresseur sans jamais tenir en mémoire, une base de
 * plusieurs gigaoctets ne fait donc pas tomber le démon.
 */
async function versFichierCompresse(
  programme: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  destination: string,
): Promise<void> {
  const processus = spawn(programme, args, { env: { ...process.env, ...env } });
  const erreurs: Buffer[] = [];
  processus.stderr.on('data', (bloc) => erreurs.push(bloc));

  const fini = new Promise<void>((resolve, reject) => {
    processus.on('error', (err: any) =>
      reject(new Error(err?.code === 'ENOENT' ? `${programme} n’est pas installé sur cette machine` : err.message)),
    );
    processus.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(erreurs).toString().trim().slice(0, 400) || `${programme} a rendu ${code}`));
    });
  });

  await Promise.all([
    pipeline(processus.stdout, zlib.createGzip(), fs.createWriteStream(destination)),
    fini,
  ]);
}

/** La base du site, posée dans le dossier du point. Rend le poids obtenu. */
async function prendreLaBase(site: SiteASauvegarder, dossier: string): Promise<number> {
  const base = site.base;
  if (base.moteur === 'aucune') return 0;

  if (base.moteur === 'sqlite') {
    const source = base.nom;
    if (!fs.existsSync(source)) throw new Error(`fichier de base introuvable : ${source}`);
    const cible = path.join(dossier, 'base.sqlite.gz');
    await pipeline(fs.createReadStream(source), zlib.createGzip(), fs.createWriteStream(cible));
    return fs.statSync(cible).size;
  }

  const cible = path.join(dossier, 'base.sql.gz');
  if (base.moteur === 'mysql') {
    const args = ['--single-transaction', '--quick', '--routines'];
    if (base.hote.trim()) args.push('-h', base.hote.trim());
    if (base.port.trim()) args.push('-P', base.port.trim());
    args.push('-u', base.utilisateur, base.nom);
    await versFichierCompresse('mysqldump', args, { MYSQL_PWD: base.motDePasse }, cible);
  } else {
    const args = ['--no-owner', '--no-privileges'];
    if (base.hote.trim()) args.push('-h', base.hote.trim());
    if (base.port.trim()) args.push('-p', base.port.trim());
    args.push('-U', base.utilisateur, base.nom);
    await versFichierCompresse('pg_dump', args, { PGPASSWORD: base.motDePasse }, cible);
  }
  return fs.statSync(cible).size;
}

/** Les fichiers du site, posés dans le dossier du point. Rend le poids obtenu. */
async function prendreLesFichiers(site: SiteASauvegarder, dossier: string): Promise<number> {
  const fichiers = site.fichiers;
  if (fichiers.moyen === 'aucun') return 0;

  const cible = path.join(dossier, 'fichiers');
  fs.mkdirSync(cible, { recursive: true });

  if (fichiers.moyen === 'local') {
    if (!fs.existsSync(fichiers.chemin)) throw new Error(`dossier introuvable : ${fichiers.chemin}`);
    fs.cpSync(fichiers.chemin, cible, { recursive: true });
    return poidsDuDossier(cible);
  }

  if (fichiers.moyen === 'ssh') {
    const port = fichiers.port.trim() || '22';
    const distant = `${fichiers.utilisateur}@${fichiers.hote}:${fichiers.chemin.replace(/\/*$/, '/')}`;
    await execFileAsync(
      'rsync',
      ['-a', '--delete', '--timeout=600', '-e', `ssh -p ${port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`, distant, `${cible}/`],
      { timeout: 3_600_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return poidsDuDossier(cible);
  }

  // FTP : `lftp` sait miroiter un site entier, et reçoit le mot de passe par son
  // entrée standard — jamais dans la ligne de commande.
  const port = fichiers.port.trim() || '21';
  const script = [
    `open -u ${fichiers.utilisateur},${fichiers.motDePasse} -p ${port} ${fichiers.hote}`,
    'set ssl:verify-certificate no',
    `mirror --verbose=0 --parallel=2 ${fichiers.chemin} ${cible}`,
    'bye',
  ].join('\n');
  await new Promise<void>((resolve, reject) => {
    const processus = spawn('lftp', ['-f', '/dev/stdin']);
    const erreurs: Buffer[] = [];
    processus.stderr.on('data', (bloc) => erreurs.push(bloc));
    processus.on('error', (err: any) =>
      reject(new Error(err?.code === 'ENOENT' ? 'lftp n’est pas installé sur cette machine' : err.message)),
    );
    processus.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(Buffer.concat(erreurs).toString().trim().slice(0, 400) || `lftp a rendu ${code}`)),
    );
    processus.stdin.end(script);
  });
  return poidsDuDossier(cible);
}

/**
 * PRENDRE UN POINT. Base d'abord, fichiers ensuite : chacun peut tomber sans
 * emporter l'autre — c'est ce qui distingue un point PARTIEL d'un ÉCHEC. Le
 * point est enregistré dans TOUS les cas, y compris l'échec : une sauvegarde
 * qui n'a pas eu lieu doit se voir dans l'historique, pas disparaître.
 */
export async function prendreUnSnapshot(
  siteId: string,
  origine: 'automatique' | 'manuel' = 'manuel',
): Promise<{ ok: boolean; point?: PointDeSauvegarde; raison?: string }> {
  const site = lireSite(siteId);
  if (!site) return { ok: false, raison: 'site introuvable' };

  const destination = (getSettings().snapshotDossier ?? '').trim();
  const refus = raisonDestinationRefusee(destination);
  if (refus) return { ok: false, raison: refus };

  if (enCours.has(siteId)) return { ok: false, raison: `un snapshot de « ${site.nom} » tourne déjà` };
  enCours.add(siteId);

  const debut = Date.now();
  const dossier = path.join(destination, dossierDeSite(site), horodatageDePoint(debut));
  const soucis: string[] = [];
  let octetsBase = 0;
  let octetsFichiers = 0;
  let pris = 0;
  let attendus = 0;

  try {
    fs.mkdirSync(dossier, { recursive: true });

    if (site.base.moteur !== 'aucune') {
      attendus += 1;
      try {
        octetsBase = await prendreLaBase(site, dossier);
        pris += 1;
      } catch (err: any) {
        soucis.push(`base : ${err?.message ?? err}`);
      }
    }

    if (site.fichiers.moyen !== 'aucun') {
      attendus += 1;
      try {
        octetsFichiers = await prendreLesFichiers(site, dossier);
        pris += 1;
      } catch (err: any) {
        soucis.push(`fichiers : ${err?.message ?? err}`);
      }
    }

    const statut: StatutDePoint = pris === 0 ? 'echec' : pris === attendus ? 'reussi' : 'partiel';
    if (statut === 'echec') {
      // Rien n'a été pris : le dossier vide ne reste pas sur le disque.
      fs.rmSync(dossier, { recursive: true, force: true });
    }

    const point = enregistrerPoint({
      id: crypto.randomUUID(),
      siteId,
      debut,
      fin: Date.now(),
      statut,
      octetsBase,
      octetsFichiers,
      chemin: statut === 'echec' ? '' : dossier,
      detail: soucis.length ? soucis.join(' ; ') : 'base et fichiers pris sans incident',
      origine,
    });

    menageDuSite(site);

    if (statut === 'echec') {
      log.warn(`snapshot de « ${site.nom} » impossible : ${point.detail}`);
      bus.toast('error', `Snapshot de « ${site.nom} » impossible : ${point.detail}`, undefined, 'snapshot');
    } else {
      log.info(`snapshot de « ${site.nom} » (${statut}) : ${dossier}`);
      if (origine === 'manuel') {
        bus.toast('success', `Snapshot de « ${site.nom} » terminé`, undefined, 'snapshot');
      }
    }
    return { ok: statut !== 'echec', point, raison: statut === 'echec' ? point.detail : undefined };
  } catch (err: any) {
    const raison = err?.message ?? String(err);
    enregistrerPoint({
      id: crypto.randomUUID(),
      siteId,
      debut,
      fin: Date.now(),
      statut: 'echec',
      octetsBase: 0,
      octetsFichiers: 0,
      chemin: '',
      detail: raison,
      origine,
    });
    log.error(`snapshot de « ${site.nom} » interrompu`, err);
    return { ok: false, raison };
  } finally {
    enCours.delete(siteId);
  }
}

/* ------------------------------------------------------------------ */
/* Le ménage et le passage de nuit                                      */
/* ------------------------------------------------------------------ */

/** Ce qui dépasse la conservation du site quitte la base ET le disque. */
export function menageDuSite(site: SiteASauvegarder, maintenant = Date.now()): number {
  const aJeter = pointsAPurger(listerPoints(site.id), site.conservationJours, maintenant);
  for (const point of aJeter) {
    if (point.chemin) {
      try {
        fs.rmSync(point.chemin, { recursive: true, force: true });
      } catch (err: any) {
        log.warn(`point de sauvegarde non retiré (${point.chemin})`, err?.message ?? err);
      }
    }
    oublierPoint(point.id);
  }
  return aJeter.length;
}

/**
 * LE PASSAGE DE NUIT. Les sites dus passent UN PAR UN : deux vidages de base en
 * parallèle se disputeraient le disque et le réseau pour rien.
 */
export async function passageDesSnapshots(origine: 'automatique' | 'manuel' = 'automatique'): Promise<number> {
  const reglages = getSettings();
  const refus = raisonDestinationRefusee((reglages.snapshotDossier ?? '').trim());
  if (refus) {
    log.warn(`snapshots : ${refus}`);
    return 0;
  }

  const maintenant = Date.now();
  const derniers = derniersPoints();
  const dus = listerSites().filter((site) => siteEstDu(site, derniers.get(site.id) ?? null, maintenant));
  for (const site of dus) {
    await prendreUnSnapshot(site.id, origine);
  }
  if (dus.length) log.info(`snapshots : ${dus.length} site(s) sauvegardé(s)`);
  return dus.length;
}

/**
 * L'HEURE DITE, UNE FOIS PAR JOUR. Même mécanique que la sauvegarde du démon
 * (`backup.ts`) : un passage toutes les cinq minutes, qui ne fait rien tant que
 * l'heure n'est pas celle réglée, et jamais deux fois le même jour.
 */
export function planifierLesSnapshots(): NodeJS.Timeout {
  let dernierJour = -1;
  return setInterval(
    () => {
      const reglages = getSettings();
      if (!reglages.snapshotAuto) return;
      const maintenant = new Date();
      if (maintenant.getHours() !== (reglages.snapshotHeure ?? 4)) return;
      if (maintenant.getDate() === dernierJour) return;
      dernierJour = maintenant.getDate();
      void passageDesSnapshots('automatique');
    },
    5 * 60 * 1000,
  );
}
