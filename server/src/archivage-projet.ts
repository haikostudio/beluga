/**
 * ARCHIVER UN PROJET SUR LE DISQUE EXTERNE — et l'en ramener.
 *
 * Les règles (gardes, lecture des services, vérification) sont dans
 * `shared/src/archivage-projet.ts`. Ici, le travail réel, dans cet ordre :
 *
 *  ARCHIVER
 *   1. contrôles : agent au travail, mise en ligne, site public / conteneur /
 *      racine Caddy servis depuis le dossier, copies de cartes hors du
 *      dossier, dossier protégé — refus AVANT tout geste ;
 *   2. arrêt (et désactivation) des versions de travail `autoproject-*` ;
 *   3. UNE archive `tar` compressée (zstd) écrite DIRECTEMENT sur le disque
 *      externe, sous un nom `.partiel` — jamais de fichier temporaire sur le
 *      disque du serveur ;
 *   4. vérification : l'archive relue en entier (entrées et octets) doit
 *      égaler le dossier ; elle prend alors son vrai nom ;
 *   5. SEULEMENT ALORS le dossier est effacé, et le projet marqué archivé.
 *   Un échec avant 5 n'efface rien et relance ce qui a été arrêté.
 *
 *  DÉSARCHIVER
 *   extraction dans un dossier d'attente VOISIN (même disque), vérification,
 *   renommage à la place d'origine, relance des versions de travail, puis
 *   suppression de l'archive externe. Un projet archivé SANS archive (mis de
 *   côté avant ce module, dossier déjà absent) ne fait que perdre son badge.
 *
 * Le démon tourne sous un compte qui n'a pas tous les droits sur `/root` :
 * lecture, effacement et extraction passent par `sudo -n` quand il répond.
 * Un redémarrage du démon en plein transfert ne laisse jamais de dossier
 * effacé sans archive vérifiée : au démarrage, un transfert trouvé « en
 * cours » passe en échec, et rien n'est touché.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DOSSIER_DES_ARCHIVES_DE_PROJETS,
  ETAPES_D_ARCHIVAGE,
  bilanDUnDossier,
  bilanDUneListeTar,
  conteneursDuDossier,
  copiesHorsDuDossier,
  ecartDeVerification,
  estUneVersionDeTravail,
  nomDeLArchiveDuProjet,
  racinesCaddyDuDossier,
  refusDArchivage,
  refusDeDesarchivage,
  refusDeSupprimerLeDossier,
  tailleLisible,
  unitesDuDossier,
  type MouvementDArchivage,
  type Project,
  type SensDArchivage,
} from '@beluga/shared';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import * as store from './store.js';
import { dependancesReelles, dossiersProtegesDuDemon } from './suppression-projet.js';

const execFileAsync = promisify(execFile);

/** Le dossier des archives : réglable pour les essais (`BELUGA_ARCHIVES_PROJETS`). */
export function dossierDesArchives(): string {
  return process.env.BELUGA_ARCHIVES_PROJETS?.trim() || DOSSIER_DES_ARCHIVES_DE_PROJETS;
}

/* ------------------------------------------------------------------ */
/* Commandes, avec élévation quand il le faut                          */
/* ------------------------------------------------------------------ */

let elevation: boolean | null = null;
async function avecElevation(): Promise<boolean> {
  if (process.getuid?.() === 0) return false;
  if (elevation !== null) return elevation;
  try {
    await execFileAsync('sudo', ['-n', 'true'], { timeout: 10_000 });
    elevation = true;
  } catch {
    elevation = false;
  }
  return elevation;
}

/** La commande, précédée de `sudo -n` quand il répond (lecture et effacement dans `/root`). */
async function commande(args: string[]): Promise<string[]> {
  return (await avecElevation()) ? ['sudo', '-n', ...args] : args;
}

async function lancer(args: string[], timeout = 120_000): Promise<{ ok: boolean; out: string; err: string }> {
  const [bin, ...reste] = await commande(args);
  try {
    const { stdout, stderr } = await execFileAsync(bin, reste, { timeout, maxBuffer: 512 * 1024 * 1024 });
    return { ok: true, out: stdout.toString(), err: stderr.toString() };
  } catch (err: any) {
    return { ok: false, out: (err?.stdout ?? '').toString(), err: (err?.stderr ?? err?.message ?? '').toString() };
  }
}

/** Une commande SANS élévation (systemctl lit en lecture seule, docker passe par sudo s'il le faut). */
async function lire(bin: string, args: string[], timeout = 30_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024 });
    return stdout.toString();
  } catch (err: any) {
    return (err?.stdout ?? '').toString();
  }
}

/* ------------------------------------------------------------------ */
/* Ce qui tourne depuis le dossier                                     */
/* ------------------------------------------------------------------ */

async function unitesQuiTournentDepuis(dossier: string): Promise<string[]> {
  const liste = await lire('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--plain']);
  const unites = liste
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((u) => u && u.endsWith('.service'));
  if (!unites.length) return [];
  const show = await lire('systemctl', ['show', ...unites, '-p', 'Id', '-p', 'WorkingDirectory', '-p', 'ExecStart', '-p', 'ActiveState']);
  // On ne garde que les unités ACTIVES, plus les versions de travail même arrêtées (à désactiver aussi).
  const actives = new Set(
    show
      .split(/\n\s*\n/)
      .filter((b) => /^ActiveState=(active|activating|reloading)$/m.test(b))
      .map((b) => b.match(/^Id=(.+)$/m)?.[1]?.trim())
      .filter(Boolean) as string[],
  );
  return unitesDuDossier(show, dossier).filter((u) => actives.has(u) || estUneVersionDeTravail(u));
}

async function conteneursDepuis(dossier: string): Promise<string[]> {
  const ids = (await lancer(['docker', 'ps', '-q'], 20_000)).out.split('\n').filter(Boolean);
  if (!ids.length) return [];
  const sortie = (await lancer(['docker', 'inspect', '--format', '{{.Name}}|{{range .Mounts}}{{.Source}};{{end}}', ...ids], 30_000)).out;
  return conteneursDuDossier(sortie, dossier);
}

function racinesCaddyDepuis(dossier: string): string[] {
  const fichiers: string[] = ['/etc/caddy/Caddyfile'];
  try {
    for (const nom of fs.readdirSync('/etc/caddy')) if (nom.endsWith('.caddy')) fichiers.push(path.join('/etc/caddy', nom));
  } catch {
    /* pas de Caddy ici */
  }
  const trouvees: string[] = [];
  for (const fichier of fichiers) {
    try {
      for (const r of racinesCaddyDuDossier(fs.readFileSync(fichier, 'utf8'), dossier)) if (!trouvees.includes(r)) trouvees.push(r);
    } catch {
      /* illisible : ignoré */
    }
  }
  return trouvees;
}

async function copiesDeCartesHorsDuDossier(dossier: string): Promise<string[]> {
  if (!fs.existsSync(path.join(dossier, '.git'))) return [];
  const sortie = await lire('git', ['-C', dossier, 'worktree', 'list', '--porcelain']);
  return copiesHorsDuDossier(sortie, dossier).filter((c) => fs.existsSync(c));
}

/* ------------------------------------------------------------------ */
/* L'avancement, partagé avec tous les écrans                          */
/* ------------------------------------------------------------------ */

interface Transfert {
  projectId: string;
  sens: SensDArchivage;
  faites: string[];
  enCours?: string;
  octets: number;
  total: number;
  debutA: number;
  fini: boolean;
  erreur?: string;
  bilan?: string;
}

const transferts = new Map<string, Transfert>();
let dernierEnvoi = 0;

function diffuser(t: Transfert, force = true): void {
  const maintenant = Date.now();
  if (!force && maintenant - dernierEnvoi < 400) return;
  dernierEnvoi = maintenant;
  bus.emit({ type: 'project.archivage', ...t });
}

/** Les transferts en cours ou finis récemment : renvoyés à un écran qui se reconnecte. */
export function transfertsConnus(): Transfert[] {
  return [...transferts.values()];
}

function commencer(t: Transfert, cle: string): void {
  t.enCours = cle;
  diffuser(t);
}

function finirEtape(t: Transfert, cle: string): void {
  if (!t.faites.includes(cle)) t.faites.push(cle);
  if (t.enCours === cle) t.enCours = undefined;
  diffuser(t);
}

function majProjet(id: string, patch: (p: Project) => Project): Project | null {
  const actuel = store.getProject(id);
  if (!actuel) return null;
  const suite = store.saveProject(patch(actuel));
  bus.emit({ type: 'project.upsert', project: suite });
  return suite;
}

/* ------------------------------------------------------------------ */
/* Estimer                                                              */
/* ------------------------------------------------------------------ */

export interface Estimation {
  octets: number | null;
  refus: string | null;
  /** Les versions de travail qui seront arrêtées puis relancées au retour. */
  versionsDeTravail: string[];
  /** Pour le désarchivage : rien à ramener (dossier déjà absent à l'époque). */
  rienARamener?: boolean;
}

async function tailleDuDossier(dossier: string): Promise<number | null> {
  const r = await lancer(['du', '-sb', dossier], 10 * 60_000);
  const n = Number(r.out.trim().split(/\s+/)[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function disqueExterneJoignable(): boolean {
  try {
    fs.mkdirSync(dossierDesArchives(), { recursive: true });
    fs.accessSync(dossierDesArchives(), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function autresDossiers(id: string): string[] {
  return store
    .listProjects(true)
    .filter((p) => p.id !== id)
    .map((p) => p.path)
    .filter(Boolean);
}

/** Le jugement complet d'un archivage : la même lecture pour la fenêtre et pour le geste. */
async function jugerLArchivage(project: Project): Promise<{ refus: string | null; versionsDeTravail: string[]; dossierPresent: boolean }> {
  const dossier = path.resolve(project.path);
  const dossierPresent = fs.existsSync(dossier);
  const dep = dependancesReelles();
  const unites = dossierPresent ? await unitesQuiTournentDepuis(dossier) : [];
  const sitesPublics = unites.filter((u) => !estUneVersionDeTravail(u));
  const versionsDeTravail = unites.filter(estUneVersionDeTravail);
  let refusDuDossier: string | null = null;
  if (dossierPresent && !project.regroupement) {
    const r = refusDeSupprimerLeDossier({
      dossier,
      dossierReel: fs.realpathSync(dossier),
      estUnDepotGit: fs.existsSync(path.join(dossier, '.git')),
      proteges: dossiersProtegesDuDemon(),
      autresProjets: autresDossiers(project.id),
    });
    refusDuDossier = r === 'absent' ? null : r;
    if (!refusDuDossier && !disqueExterneJoignable()) refusDuDossier = 'Le disque externe ne répond pas : rien n’a été tenté.';
  }
  const refus = refusDArchivage({
    isSelf: project.isSelf,
    archived: project.archived,
    transfertEnCours: transferts.get(project.id)?.fini === false,
    agentsAuTravail: await dep.agentsAuTravail(project.id),
    publicationEnCours: await dep.publicationEnCours(project.id),
    sitesPublics,
    conteneurs: dossierPresent && !project.regroupement ? await conteneursDepuis(dossier) : [],
    racinesCaddy: dossierPresent && !project.regroupement ? racinesCaddyDepuis(dossier) : [],
    copiesHorsDossier: dossierPresent && !project.regroupement ? await copiesDeCartesHorsDuDossier(dossier) : [],
    refusDuDossier,
  });
  return { refus, versionsDeTravail, dossierPresent };
}

function jugerLeDesarchivage(project: Project): { refus: string | null; rienARamener: boolean } {
  const chemin = project.archive?.chemin;
  const rienARamener = !chemin;
  const dossier = path.resolve(project.path);
  let dossierOccupe = false;
  try {
    dossierOccupe = fs.existsSync(dossier) && fs.readdirSync(dossier).length > 0;
  } catch {
    dossierOccupe = fs.existsSync(dossier);
  }
  const joignable = rienARamener ? true : disqueExterneJoignable();
  const refus = refusDeDesarchivage({
    archived: project.archived,
    transfertEnCours: transferts.get(project.id)?.fini === false,
    archiveTrouvee: rienARamener ? null : joignable && fs.existsSync(chemin!),
    dossierOccupe,
    disqueExterneJoignable: joignable,
  });
  return { refus, rienARamener };
}

export async function estimer(id: string, sens: SensDArchivage): Promise<Estimation> {
  const project = store.getProject(id);
  if (!project) throw new Error('projet introuvable');
  if (sens === 'desarchiver') {
    const { refus, rienARamener } = jugerLeDesarchivage(project);
    return {
      octets: project.archive?.octetsSource ?? null,
      refus,
      versionsDeTravail: (project.archive?.services ?? []).map((s) => s.unite),
      rienARamener,
    };
  }
  const jugement = await jugerLArchivage(project);
  const octets = jugement.refus || !jugement.dossierPresent || project.regroupement ? null : await tailleDuDossier(path.resolve(project.path));
  return { octets, refus: jugement.refus, versionsDeTravail: jugement.versionsDeTravail };
}

/* ------------------------------------------------------------------ */
/* Versions de travail : arrêter, relancer                             */
/* ------------------------------------------------------------------ */

async function etatDeLUnite(unite: string): Promise<{ active: boolean; activee: boolean }> {
  const active = (await lire('systemctl', ['is-active', unite])).trim() === 'active';
  const activee = (await lire('systemctl', ['is-enabled', unite])).trim() === 'enabled';
  return { active, activee };
}

async function arreterLesVersions(unites: string[]): Promise<{ unite: string; active: boolean; activee: boolean }[]> {
  const arretees: { unite: string; active: boolean; activee: boolean }[] = [];
  for (const unite of unites) {
    const etat = await etatDeLUnite(unite);
    arretees.push({ unite, ...etat });
    // Désactivée aussi : un redémarrage du serveur la relancerait sur un dossier parti.
    if (etat.activee) await lancer(['systemctl', 'disable', unite], 60_000);
    if (etat.active) {
      const r = await lancer(['systemctl', 'stop', unite], 90_000);
      if (!r.ok) throw new Error(`La version de travail « ${unite} » refuse de s’arrêter : ${r.err.trim().slice(0, 200)}`);
    }
  }
  return arretees;
}

async function relancerLesVersions(services: { unite: string; active: boolean; activee: boolean }[]): Promise<string[]> {
  const echecs: string[] = [];
  for (const s of services) {
    if (s.activee) await lancer(['systemctl', 'enable', s.unite], 60_000);
    if (s.active) {
      const r = await lancer(['systemctl', 'start', s.unite], 90_000);
      if (!r.ok) echecs.push(s.unite);
    }
  }
  return echecs;
}

/* ------------------------------------------------------------------ */
/* Le flux : tar → compteur → zstd → disque externe                    */
/* ------------------------------------------------------------------ */

function attendreFin(proc: ReturnType<typeof spawn>, nom: string, stderr: { texte: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    proc.on('error', (err) => reject(new Error(`${nom} : ${err.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${nom} s’est arrêté (code ${code}) ${stderr.texte.trim().slice(-300)}`))));
  });
}

async function empaqueter(dossier: string, cible: string, t: Transfert): Promise<void> {
  const [tarBin, ...tarArgs] = await commande(['tar', '-C', path.dirname(dossier), '--numeric-owner', '-cpf', '-', path.basename(dossier)]);
  const tar = spawn(tarBin, tarArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const zstd = spawn('zstd', ['-T0', '-3', '-q', '-c'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const sortie = fs.createWriteStream(cible);
  const errTar = { texte: '' };
  const errZstd = { texte: '' };
  tar.stderr!.on('data', (d) => (errTar.texte = (errTar.texte + d.toString()).slice(-4000)));
  zstd.stderr!.on('data', (d) => (errZstd.texte = (errZstd.texte + d.toString()).slice(-4000)));
  tar.stdout!.on('data', (morceau: Buffer) => {
    t.octets += morceau.length;
    diffuser(t, false);
  });
  tar.stdout!.pipe(zstd.stdin!);
  zstd.stdout!.pipe(sortie);
  const ecrit = new Promise<void>((resolve, reject) => {
    sortie.on('finish', () => resolve());
    sortie.on('error', (err) => reject(new Error(`écriture sur le disque externe : ${err.message}`)));
  });
  try {
    await Promise.all([attendreFin(tar, 'tar', errTar), attendreFin(zstd, 'zstd', errZstd), ecrit]);
  } catch (err) {
    tar.kill('SIGTERM');
    zstd.kill('SIGTERM');
    sortie.destroy();
    throw err;
  }
}

async function bilanDeLArchive(archive: string): Promise<{ entrees: number; octets: number }> {
  const zstd = spawn('zstd', ['-dc', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tar = spawn('tar', ['-tvf', '-', '--numeric-owner'], { stdio: ['pipe', 'pipe', 'pipe'] });
  zstd.stdout!.pipe(tar.stdin!);
  const errZ = { texte: '' };
  const errT = { texte: '' };
  zstd.stderr!.on('data', (d) => (errZ.texte += d.toString()));
  tar.stderr!.on('data', (d) => (errT.texte += d.toString()));
  let reste = '';
  const total = { entrees: 0, octets: 0 };
  tar.stdout!.on('data', (d: Buffer) => {
    const texte = reste + d.toString();
    const coupe = texte.lastIndexOf('\n');
    reste = texte.slice(coupe + 1);
    const b = bilanDUneListeTar(texte.slice(0, coupe + 1));
    total.entrees += b.entrees;
    total.octets += b.octets;
  });
  await Promise.all([attendreFin(zstd, 'lecture de l’archive', errZ), attendreFin(tar, 'liste de l’archive', errT)]);
  if (reste.trim()) {
    const b = bilanDUneListeTar(reste);
    total.entrees += b.entrees;
    total.octets += b.octets;
  }
  return total;
}

async function bilanDuDossier(dossier: string): Promise<{ entrees: number; octets: number }> {
  const r = await lancer(['find', dossier, '!', '-type', 's', '-printf', '%y %i %s\\n'], 30 * 60_000);
  if (!r.ok && !r.out) throw new Error(`lecture du dossier impossible : ${r.err.trim().slice(0, 200)}`);
  return bilanDUnDossier(r.out);
}

async function effacer(dossier: string): Promise<void> {
  // Rejugé JUSTE AVANT : jamais un dossier protégé ni un dossier qui contient un autre projet.
  const refus = refusDeSupprimerLeDossier({
    dossier,
    dossierReel: fs.existsSync(dossier) ? fs.realpathSync(dossier) : undefined,
    estUnDepotGit: true,
    proteges: dossiersProtegesDuDemon(),
    autresProjets: [],
  });
  if (refus && refus !== 'absent') throw new Error(refus);
  const r = await lancer(['rm', '-rf', '--', dossier], 30 * 60_000);
  if (!r.ok || fs.existsSync(dossier)) throw new Error(`le dossier n’a pas pu être effacé : ${r.err.trim().slice(0, 200)}`);
}

/* ------------------------------------------------------------------ */
/* L'historique des mouvements                                         */
/* ------------------------------------------------------------------ */

export type OrigineDArchivage = MouvementDArchivage['origine'];

/**
 * NOTE UN MOUVEMENT dans l'historique du projet (table `archivage_mouvements`, migration 183). Ne fait jamais
 * tomber le transfert : une base momentanément occupée coûte une ligne d'historique, pas l'archivage.
 */
export function noterMouvement(m: Omit<MouvementDArchivage, 'id' | 'quand'> & { quand?: number }): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO archivage_mouvements (project_id, quand, sens, origine, issue, detail, octets, octets_archive, chemin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.projectId, m.quand ?? Date.now(), m.sens, m.origine, m.issue, m.detail ?? null, m.octets ?? null, m.octetsArchive ?? null, m.chemin ?? null);
    bus.emit({ type: 'project.archivage.mouvement', projectId: m.projectId });
  } catch (err) {
    log.warn(`historique d'archivage : mouvement non noté — ${(err as Error).message}`);
  }
}

/** L'historique d'un projet, le plus récent d'abord. */
export function mouvementsDuProjet(projectId: string, limite = 200): MouvementDArchivage[] {
  const lignes = getDb()
    .prepare(
      `SELECT id, project_id, quand, sens, origine, issue, detail, octets, octets_archive, chemin
       FROM archivage_mouvements WHERE project_id = ? ORDER BY quand DESC, id DESC LIMIT ?`,
    )
    .all(projectId, limite) as any[];
  return lignes.map((l) => ({
    id: l.id,
    projectId: l.project_id,
    quand: l.quand,
    sens: l.sens,
    origine: l.origine,
    issue: l.issue,
    detail: l.detail,
    octets: l.octets,
    octetsArchive: l.octets_archive,
    chemin: l.chemin,
  }));
}

/** Le dernier désarchivage RÉUSSI de chaque projet : il compte comme une activité pour l'archivage automatique. */
export function derniersDesarchivages(): Map<string, number> {
  const lignes = getDb()
    .prepare(`SELECT project_id AS id, MAX(quand) AS quand FROM archivage_mouvements WHERE sens = 'desarchiver' AND issue = 'reussi' GROUP BY project_id`)
    .all() as { id: string; quand: number }[];
  return new Map(lignes.map((l) => [l.id, l.quand]));
}

/** L'interrupteur « Ne jamais archiver automatiquement ». */
export function exempter(id: string, exempte: boolean): Project {
  const suite = majProjet(id, (p) => ({ ...p, archivageAutoDesactive: exempte || undefined }));
  if (!suite) throw new Error('projet introuvable');
  return suite;
}

/* ------------------------------------------------------------------ */
/* Archiver                                                             */
/* ------------------------------------------------------------------ */

function nouveauTransfert(projectId: string, sens: SensDArchivage): Transfert {
  const t: Transfert = { projectId, sens, faites: [], octets: 0, total: 0, debutA: Date.now(), fini: false };
  transferts.set(projectId, t);
  return t;
}

function echouer(t: Transfert, message: string): void {
  t.erreur = message;
  t.fini = true;
  t.enCours = undefined;
  diffuser(t);
}

/** Lance l'archivage ; rend la main dès que les contrôles sont passés. */
export async function archiver(id: string, origine: OrigineDArchivage = 'main'): Promise<{ ok: true }> {
  const project = store.getProject(id);
  if (!project) throw new Error('projet introuvable');
  const t = nouveauTransfert(id, 'archiver');
  commencer(t, 'controles');
  let jugement: Awaited<ReturnType<typeof jugerLArchivage>>;
  try {
    // Ce transfert-ci ne compte pas comme « déjà en cours » pour son propre jugement.
    transferts.delete(id);
    jugement = await jugerLArchivage(project);
    transferts.set(id, t);
  } catch (err: any) {
    transferts.set(id, t);
    echouer(t, err?.message ?? String(err));
    noterMouvement({ projectId: id, sens: 'archiver', origine, issue: 'echec', detail: err?.message ?? String(err) });
    throw err;
  }
  if (jugement.refus) {
    echouer(t, jugement.refus);
    // La nuit note elle-même ses refus, une fois par raison (`refusDejaNote`).
    if (origine === 'main') noterMouvement({ projectId: id, sens: 'archiver', origine, issue: 'refus', detail: jugement.refus });
    const erreur = new Error(jugement.refus) as Error & { refus?: true };
    erreur.refus = true;
    throw erreur;
  }
  finirEtape(t, 'controles');
  void suiteDeLArchivage(project, t, jugement, origine).catch((err) => log.error('archivage', err));
  return { ok: true };
}

async function suiteDeLArchivage(
  project: Project,
  t: Transfert,
  jugement: { versionsDeTravail: string[]; dossierPresent: boolean },
  origine: OrigineDArchivage,
): Promise<void> {
  const dossier = path.resolve(project.path);
  // Rien à transférer (projet réuni, ou dossier déjà parti) : seul le drapeau change.
  if (!jugement.dossierPresent || project.regroupement) {
    for (const cle of ['services', 'copie', 'verification', 'liberation']) finirEtape(t, cle);
    majProjet(project.id, (p) => ({ ...p, archived: true, archive: { etat: 'archive', sens: 'archiver', at: Date.now() } }));
    t.bilan = 'Aucun fichier à déplacer : le projet est simplement marqué archivé.';
    t.fini = true;
    diffuser(t);
    noterMouvement({ projectId: project.id, sens: 'archiver', origine, issue: 'reussi', detail: t.bilan });
    bus.toast('info', `« ${project.name} » archivé`);
    return;
  }

  majProjet(project.id, (p) => ({ ...p, archive: { etat: 'archivage', sens: 'archiver', at: Date.now() } }));
  let services: { unite: string; active: boolean; activee: boolean }[] = [];
  const dossierArchives = dossierDesArchives();
  const nom = nomDeLArchiveDuProjet(dossier, Date.now());
  const definitive = path.join(dossierArchives, nom);
  const partielle = `${definitive}.partiel`;
  try {
    commencer(t, 'services');
    services = await arreterLesVersions(jugement.versionsDeTravail);
    finirEtape(t, 'services');

    t.total = (await tailleDuDossier(dossier)) ?? 0;
    commencer(t, 'copie');
    fs.mkdirSync(dossierArchives, { recursive: true });
    // Un essai précédent interrompu a pu laisser un morceau : il part avant.
    const prefixe = nom.replace(/-\d{8}-\d{6}\.tar\.zst$/, '-');
    for (const ancien of fs.readdirSync(dossierArchives)) if (ancien.startsWith(prefixe) && ancien.endsWith('.partiel')) fs.rmSync(path.join(dossierArchives, ancien), { force: true });
    await empaqueter(dossier, partielle, t);
    finirEtape(t, 'copie');

    commencer(t, 'verification');
    const [source, copie] = await Promise.all([bilanDuDossier(dossier), bilanDeLArchive(partielle)]);
    const ecart = ecartDeVerification(source, copie);
    if (ecart) throw new Error(`La copie ne correspond pas au dossier — ${ecart} Rien n’a été effacé.`);
    fs.renameSync(partielle, definitive);
    finirEtape(t, 'verification');

    const octetsArchive = fs.statSync(definitive).size;
    // L'archive vérifiée est notée AVANT l'effacement : un arrêt pendant `rm` laisse un projet qu'on sait ramener.
    majProjet(project.id, (p) => ({
      ...p,
      archive: { etat: 'archivage', sens: 'archiver', chemin: definitive, octetsSource: t.total, octetsArchive, entrees: source.entrees, services, at: Date.now() },
    }));

    commencer(t, 'liberation');
    await effacer(dossier);
    finirEtape(t, 'liberation');

    majProjet(project.id, (p) => ({ ...p, archived: true, archive: { ...(p.archive ?? { at: Date.now() }), etat: 'archive', sens: 'archiver', at: Date.now() } }));
    t.octets = t.total;
    t.bilan = `${tailleLisible(t.total)} libérés sur le serveur (archive de ${tailleLisible(octetsArchive)}).`;
    t.fini = true;
    diffuser(t);
    noterMouvement({ projectId: project.id, sens: 'archiver', origine, issue: 'reussi', detail: t.bilan, octets: t.total, octetsArchive, chemin: definitive });
    bus.toast('success', `« ${project.name} » archivé sur le disque externe`);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    log.warn(`archivage de ${project.name} : ${message}`);
    bus.toast('error', `Archivage de « ${project.name} » interrompu : ${message}`);
    if (fs.existsSync(dossier)) {
      // Le dossier est intact : l'archive inachevée part, les versions de travail repartent.
      fs.rmSync(partielle, { force: true });
      await relancerLesVersions(services).catch(() => []);
      majProjet(project.id, (p) => ({ ...p, archive: { etat: 'echec', sens: 'archiver', erreur: message, at: Date.now() } }));
    } else {
      // Le dossier est parti pendant l'effacement : l'archive vérifiée fait foi.
      majProjet(project.id, (p) => ({ ...p, archived: true, archive: { ...(p.archive ?? { at: Date.now() }), etat: 'archive', at: Date.now() } }));
    }
    noterMouvement({
      projectId: project.id,
      sens: 'archiver',
      origine,
      issue: fs.existsSync(dossier) ? 'echec' : 'reussi',
      detail: fs.existsSync(dossier) ? `${message} Rien n’a été effacé.` : `Archive vérifiée ; l’effacement a trébuché : ${message}`,
      chemin: fs.existsSync(dossier) ? null : definitive,
    });
    echouer(t, message);
  }
}

/* ------------------------------------------------------------------ */
/* Désarchiver                                                          */
/* ------------------------------------------------------------------ */

export async function desarchiver(id: string, origine: OrigineDArchivage = 'main'): Promise<{ ok: true }> {
  const project = store.getProject(id);
  if (!project) throw new Error('projet introuvable');
  const t = nouveauTransfert(id, 'desarchiver');
  commencer(t, 'controles');
  transferts.delete(id);
  const { refus, rienARamener } = jugerLeDesarchivage(project);
  transferts.set(id, t);
  if (refus) {
    echouer(t, refus);
    noterMouvement({ projectId: id, sens: 'desarchiver', origine, issue: 'refus', detail: refus });
    throw new Error(refus);
  }
  finirEtape(t, 'controles');
  if (rienARamener) {
    for (const cle of ETAPES_D_ARCHIVAGE.desarchiver.map((e) => e.cle)) finirEtape(t, cle);
    majProjet(id, (p) => ({ ...p, archived: false, archive: undefined }));
    t.bilan = 'Aucune archive à ramener : seul le badge est retiré.';
    t.fini = true;
    diffuser(t);
    noterMouvement({ projectId: id, sens: 'desarchiver', origine, issue: 'reussi', detail: t.bilan });
    bus.toast('info', `« ${project.name} » désarchivé`);
    return { ok: true };
  }
  void suiteDuDesarchivage(project, t, origine).catch((err) => log.error('désarchivage', err));
  return { ok: true };
}

async function extraire(archive: string, attente: string, t: Transfert): Promise<void> {
  const [tarBin, ...tarArgs] = await commande(['tar', '-C', attente, '--numeric-owner', '--same-owner', '-xpf', '-']);
  const zstd = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const tar = spawn(tarBin, tarArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
  const entree = fs.createReadStream(archive);
  const errZ = { texte: '' };
  const errT = { texte: '' };
  zstd.stderr!.on('data', (d) => (errZ.texte += d.toString()));
  tar.stderr!.on('data', (d) => (errT.texte += d.toString()));
  entree.on('data', (morceau: string | Buffer) => {
    t.octets += morceau.length;
    diffuser(t, false);
  });
  const lu = new Promise<void>((resolve, reject) => {
    entree.on('end', () => resolve());
    entree.on('error', (err) => reject(new Error(`lecture sur le disque externe : ${err.message}`)));
  });
  entree.pipe(zstd.stdin!);
  zstd.stdout!.pipe(tar.stdin!);
  try {
    await Promise.all([lu, attendreFin(zstd, 'zstd', errZ), attendreFin(tar, 'tar', errT)]);
  } catch (err) {
    entree.destroy();
    zstd.kill('SIGTERM');
    tar.kill('SIGTERM');
    throw err;
  }
}

async function suiteDuDesarchivage(project: Project, t: Transfert, origine: OrigineDArchivage): Promise<void> {
  const dossier = path.resolve(project.path);
  const archive = project.archive!.chemin!;
  const attente = path.join(path.dirname(dossier), `.beluga-desarchivage-${path.basename(dossier)}`);
  majProjet(project.id, (p) => ({ ...p, archive: { ...p.archive!, etat: 'desarchivage', sens: 'desarchiver', erreur: undefined, at: Date.now() } }));
  try {
    t.total = fs.statSync(archive).size;
    commencer(t, 'copie');
    // Un essai précédent interrompu a pu laisser son dossier d'attente : il part avant.
    await lancer(['rm', '-rf', '--', attente], 30 * 60_000);
    const mk = await lancer(['mkdir', '-p', attente]);
    if (!mk.ok) throw new Error(`dossier d’attente impossible à créer : ${mk.err.trim().slice(0, 200)}`);
    await extraire(archive, attente, t);
    finirEtape(t, 'copie');

    commencer(t, 'verification');
    const extrait = path.join(attente, path.basename(dossier));
    const bilan = await bilanDuDossier(extrait);
    const attendu = project.archive?.entrees;
    if (attendu !== undefined && bilan.entrees !== attendu) throw new Error(`Les fichiers ramenés comptent ${bilan.entrees} éléments, l’archive en annonçait ${attendu}.`);
    finirEtape(t, 'verification');

    commencer(t, 'remise');
    if (fs.existsSync(dossier)) {
      // Un dossier VIDE (créé entre-temps) peut céder sa place ; un dossier plein, jamais.
      if (fs.readdirSync(dossier).length) throw new Error('Un dossier non vide occupe déjà la place du projet : rien n’a été remplacé.');
      await lancer(['rmdir', dossier]);
    }
    const mv = await lancer(['mv', '--', extrait, dossier], 120_000);
    if (!mv.ok || !fs.existsSync(dossier)) throw new Error(`remise en place impossible : ${mv.err.trim().slice(0, 200)}`);
    await lancer(['rm', '-rf', '--', attente], 60_000);
    // Le projet est de retour : il n'est plus archivé, même si la suite trébuche.
    majProjet(project.id, (p) => ({ ...p, archived: false }));
    finirEtape(t, 'remise');

    commencer(t, 'services');
    const echecs = await relancerLesVersions(project.archive?.services ?? []);
    finirEtape(t, 'services');

    commencer(t, 'nettoyage');
    fs.rmSync(archive, { force: true });
    finirEtape(t, 'nettoyage');

    majProjet(project.id, (p) => ({ ...p, archived: false, archive: undefined }));
    t.octets = t.total;
    t.bilan = echecs.length
      ? `Fichiers remis en place, mais la version de travail n’a pas redémarré (${echecs.join(', ')}).`
      : `Fichiers remis en place (${tailleLisible(project.archive?.octetsSource ?? 0)}), copie externe supprimée.`;
    t.fini = true;
    diffuser(t);
    noterMouvement({ projectId: project.id, sens: 'desarchiver', origine, issue: 'reussi', detail: t.bilan, octets: project.archive?.octetsSource ?? null, octetsArchive: project.archive?.octetsArchive ?? null, chemin: archive });
    bus.toast('success', `« ${project.name} » désarchivé`);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    log.warn(`désarchivage de ${project.name} : ${message}`);
    bus.toast('error', `Désarchivage de « ${project.name} » interrompu : ${message}`);
    const revenu = !store.getProject(project.id)?.archived;
    if (!revenu) {
      // L'archive reste intacte sur le disque externe : seul le dossier d'attente part.
      await lancer(['rm', '-rf', '--', attente], 30 * 60_000).catch(() => null);
      majProjet(project.id, (p) => ({ ...p, archive: { ...p.archive!, etat: 'echec', sens: 'desarchiver', erreur: message, at: Date.now() } }));
    }
    noterMouvement({
      projectId: project.id,
      sens: 'desarchiver',
      origine,
      issue: revenu ? 'reussi' : 'echec',
      detail: revenu ? `Fichiers revenus ; la suite a trébuché : ${message}` : `${message} L’archive reste intacte sur le disque externe.`,
      chemin: archive,
    });
    echouer(t, message);
  }
}

/* ------------------------------------------------------------------ */
/* Au démarrage du démon                                                */
/* ------------------------------------------------------------------ */

/**
 * UN TRANSFERT COUPÉ PAR UN REDÉMARRAGE N'EFFACE RIEN. Un projet trouvé en
 * « archivage » ou « désarchivage » passe en échec, avec la raison ; son
 * dossier et son archive restent tels quels, et un nouvel essai repart
 * proprement (l'archive partielle et le dossier d'attente sont retirés au
 * début du geste suivant).
 */
export function reprendreAuDemarrage(): void {
  for (const projet of store.listProjects(true)) {
    const etat = projet.archive?.etat;
    if (etat !== 'archivage' && etat !== 'desarchivage') continue;
    const dossierLa = fs.existsSync(path.resolve(projet.path));
    const archiveVerifiee = !!projet.archive?.chemin && fs.existsSync(projet.archive.chemin);
    if (etat === 'archivage' && !dossierLa && archiveVerifiee) {
      // Coupé pendant l'effacement, après la vérification : l'archive fait foi.
      store.saveProject({ ...projet, archived: true, archive: { ...projet.archive!, etat: 'archive', at: Date.now() } });
      continue;
    }
    if (etat === 'archivage' && dossierLa && archiveVerifiee) {
      // Coupé AVANT l'effacement : le dossier est intact et fait foi, la copie externe en trop part.
      fs.rmSync(projet.archive!.chemin!, { force: true });
    }
    noterMouvement({ projectId: projet.id, sens: etat === 'archivage' ? 'archiver' : 'desarchiver', origine: 'main', issue: 'echec', detail: 'Transfert interrompu par un redémarrage du serveur : rien n’a été effacé.' });
    store.saveProject({
      ...projet,
      archive: { ...projet.archive!, etat: 'echec', chemin: etat === 'archivage' ? undefined : projet.archive!.chemin, erreur: 'Transfert interrompu par un redémarrage du serveur : rien n’a été effacé, vous pouvez réessayer.', at: Date.now() },
    });
    log.warn(`archivage de ${projet.name} interrompu par un redémarrage : passé en échec, rien effacé`);
  }
}

/** Attend qu'un transfert lancé soit fini (archivage de nuit : un projet à la fois). */
export async function attendreLaFinDuTransfert(id: string, delaiMax = 6 * 60 * 60 * 1000): Promise<Transfert | undefined> {
  const debut = Date.now();
  for (;;) {
    const t = transferts.get(id);
    if (!t || t.fini) return t;
    if (Date.now() - debut > delaiMax) return t;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
