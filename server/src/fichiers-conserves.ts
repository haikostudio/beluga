/**
 * LES FICHIERS CITÉS OU ÉCRITS PAR UN AGENT RESTENT OUVRABLES.
 *
 * Un fichier cité vit souvent dans la copie de travail d'une carte (refermée
 * après la fusion) ou dans le dossier temporaire du système (vidé). Pour qu'un
 * lien du fil s'ouvre encore, on garde une copie à l'écriture (fin d'étape) et à
 * la citation (fin de tour), sur le DISQUE DE STOCKAGE uniquement : `fichiers-conserves/`,
 * un fichier par contenu (`sha`), décrit par la table `fichiers_conserves`.
 *
 * À LA LECTURE, dans cet ordre (`resoudreFichierCite`) : le fichier vivant, la
 * copie gardée (celle de la carte d'abord, puis la plus récente du projet),
 * l'historique git du dépôt. Sinon un MOTIF dit la vraie raison à l'écran.
 *
 * DÉCISION DE L'UTILISATEUR : une copie s'efface 3 mois après sa création
 * (`purgerLesCopiesAnciennes`, passe du ménage quotidien). Sa ligne reste, pour
 * dire « supprimée le… » au lieu de « introuvable ».
 *
 * Rien ici ne retient un tour ni ne le fait tomber : la lecture du fichier part
 * tout de suite (il peut disparaître avec sa copie de travail, d'où
 * `attendreLesLectures` avant la fermeture), l'écriture sur le disque réseau, lent,
 * se fait derrière, à la queue leu leu.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CONSERVATION_DES_COPIES_MS,
  EXTENSIONS_RANGEES_D_OFFICE,
  PLAFOND_D_UNE_COPIE,
  cheminsCitesDansLeTexte,
  fichierSensible,
  mimeDuFichier,
  relatifDUneCopieDeCarte,
  type MotifDeFichierAbsent,
} from '@beluga/shared';
import { CONFIG, PATHS } from './config.js';
import { racinesDesCopiesDuProjet } from './copies-de-cartes.js';
import { getDb } from './db.js';
import { fichierCite } from './files.js';
import { log } from './logger.js';
import { disqueDeStockage, dossiersDeLecture } from './pieces-jointes.js';
import { listProjects } from './store.js';

const executer = promisify(execFile);
const DELAI_GIT_MS = 5000;
/** Ce que les copies en attente peuvent occuper en mémoire : au-delà, on saute plutôt que d'étouffer le démon. */
const PLAFOND_EN_ATTENTE = 200 * 1024 * 1024;

export interface ContexteDeConservation {
  projectId: string;
  projectPath: string;
  workdir?: string | null;
  cardId?: string | null;
  agentId?: string | null;
}

interface LigneConservee {
  id: number;
  sha: string;
  nom: string;
  mime: string;
  taille: number;
  expire_le: number | null;
}

/** Où vivent les copies, ou `null` : sans disque de stockage, jamais d'écriture sur celui du serveur. */
function dossierDesCopies(): string | null {
  const disque = disqueDeStockage();
  return disque ? path.join(disque, 'fichiers-conserves') : null;
}

function fichierDeLaCopie(dossier: string, sha: string): string {
  return path.join(dossier, sha.slice(0, 2), sha);
}

/**
 * LES DOSSIERS OÙ UN FICHIER CITÉ PEUT TOMBER. Tous les projets déclarés et leurs
 * copies : le fil de Beluga cite les fichiers des autres projets. Réservé à
 * l'administrateur, comme la route ; le chemin RÉEL y est contrôlé (`fichierCite`).
 */
export function racinesDesFichiersCites(ctx: Pick<ContexteDeConservation, 'projectPath' | 'workdir'>): string[] {
  const depots = [ctx.projectPath, ...listProjects(true).map((p) => p.path)].filter(Boolean);
  return [
    ...(ctx.workdir ? [ctx.workdir] : []),
    CONFIG.dataDir,
    os.tmpdir(),
    /* Les médias fabriqués (disque de stockage) : un agent cite les visuels qu'il y range. */
    PATHS.medias,
    ...dossiersDeLecture(),
    ...depots.flatMap((depot) => [depot, ...racinesDesCopiesDuProjet(depot)]),
  ];
}

/** Le chemin dans le dépôt, ou `null` (un fichier de /tmp n'en a pas). */
function relatifDansLeProjet(chemin: string, depots: string[]): string | null {
  if (!path.isAbsolute(chemin)) return chemin;
  const copie = relatifDUneCopieDeCarte(chemin);
  if (copie) return copie.relatif;
  for (const depot of depots) {
    if (chemin.startsWith(`${path.resolve(depot)}/`)) return chemin.slice(path.resolve(depot).length + 1);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Garder                                                              */
/* ------------------------------------------------------------------ */

/** Écrit le contenu s'il n'y est pas déjà, et sa ligne. Rend son fichier. */
async function rangerLaCopie(
  ctx: ContexteDeConservation,
  dossier: string,
  contenu: Buffer,
  cheminOrigine: string,
  maintenant = Date.now(),
): Promise<{ file: string; sha: string }> {
  const sha = crypto.createHash('sha256').update(contenu).digest('hex');
  const file = fichierDeLaCopie(dossier, sha);
  if (!fs.existsSync(file)) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const provisoire = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(provisoire, contenu);
    await fs.promises.rename(provisoire, file);
  }
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO fichiers_conserves
         (project_id, card_id, agent_id, chemin_origine, relatif, sha, nom, mime, taille, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.projectId,
      ctx.cardId ?? null,
      ctx.agentId ?? null,
      cheminOrigine,
      relatifDansLeProjet(cheminOrigine, [ctx.workdir, ctx.projectPath].filter(Boolean) as string[]),
      sha,
      path.basename(cheminOrigine),
      mimeDuFichier(cheminOrigine),
      contenu.length,
      maintenant,
    );
  return { file, sha };
}

const lectures = new Set<Promise<unknown>>();
let fileDEcriture: Promise<unknown> = Promise.resolve();
let enAttente = 0;

/**
 * Garde une copie de ce fichier. Rend la main tout de suite et ne lève jamais.
 * `depotDAbord` : le fichier a été écrit dans le dépôt, pas dans la copie de travail.
 */
export function conserverUnFichier(ctx: ContexteDeConservation, chemin: string, opts: { depotDAbord?: boolean } = {}): void {
  try {
    const dossier = dossierDesCopies();
    if (!dossier) {
      log.info('fichiers-conserves', `disque de stockage absent : pas de copie de ${chemin}`);
      return;
    }
    const bases = opts.depotDAbord ? [ctx.projectPath, ctx.workdir] : [ctx.workdir, ctx.projectPath];
    const trouve = fichierCite(chemin, racinesDesFichiersCites(ctx), bases);
    if (!trouve) return;
    const garde = !fichierSensible(trouve.file) && !fichierSensible(chemin);
    const dejaRange = EXTENSIONS_RANGEES_D_OFFICE.some((fin) => trouve.file.toLowerCase().endsWith(fin));
    if (!garde || dejaRange || trouve.taille > PLAFOND_D_UNE_COPIE) return;
    if (enAttente + trouve.taille > PLAFOND_EN_ATTENTE) {
      log.warn('fichiers-conserves', `trop de copies en attente : ${chemin} attendra sa prochaine citation`);
      return;
    }
    enAttente += trouve.taille;
    const origine = path.isAbsolute(chemin) ? path.resolve(chemin) : trouve.file;
    const lecture = fs.promises.readFile(trouve.file).then(
      (contenu) => {
        fileDEcriture = fileDEcriture
          .then(() => rangerLaCopie(ctx, dossier, contenu, origine))
          .catch((err) => log.warn('fichiers-conserves', `copie de ${chemin} impossible : ${err?.message ?? err}`))
          .finally(() => {
            enAttente -= trouve.taille;
          });
      },
      (err) => {
        enAttente -= trouve.taille;
        log.warn('fichiers-conserves', `lecture de ${chemin} impossible : ${err?.message ?? err}`);
      },
    );
    lectures.add(lecture);
    void lecture.finally(() => lectures.delete(lecture));
  } catch (err: any) {
    log.warn('fichiers-conserves', `copie de ${chemin} impossible : ${err?.message ?? err}`);
  }
}

/** Fin de tour : garde tout ce que la réponse cite. */
export function conserverLesFichiersCites(ctx: ContexteDeConservation, texte: string | null | undefined): void {
  for (const chemin of cheminsCitesDansLeTexte(texte)) conserverUnFichier(ctx, chemin);
}

/**
 * Avant de refermer une copie de travail : ses fichiers doivent être LUS. Borné,
 * car une fermeture ne dépend pas d'une copie. L'écriture, elle, suit derrière.
 */
export async function attendreLesLectures(plafondMs = 3000): Promise<void> {
  if (!lectures.size) return;
  let minuteur: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...lectures]),
    new Promise((resolve) => {
      minuteur = setTimeout(resolve, plafondMs);
    }),
  ]);
  if (minuteur) clearTimeout(minuteur);
}

/** Pour les essais : que tout ce qui est parti soit écrit. */
export async function attendreLesCopies(): Promise<void> {
  await Promise.allSettled([...lectures]);
  await fileDEcriture;
}

/* ------------------------------------------------------------------ */
/* Retrouver                                                           */
/* ------------------------------------------------------------------ */

export type ResolutionDeFichierCite =
  | { trouve: true; file: string; nom: string; mime: string; taille: number; origine: 'vivant' | 'copie' | 'git' }
  | { trouve: false; motif: MotifDeFichierAbsent; date?: number };

function lignesDuChemin(projectId: string, chemin: string, relatif: string | null, cardId?: string | null): LigneConservee[] {
  return getDb()
    .prepare(
      `SELECT id, sha, nom, mime, taille, expire_le FROM fichiers_conserves
       WHERE project_id = ? AND (chemin_origine = ? OR relatif = ?)
       ORDER BY expire_le IS NOT NULL, card_id IS ? DESC, at DESC, id DESC LIMIT 50`,
    )
    .all(projectId, chemin, relatif, cardId ?? null) as LigneConservee[];
}

/** Le dernier contenu du fichier dans l'historique, suppressions écartées. `absent` : git ne l'a jamais vu. */
async function contenuDansGit(depot: string, relatif: string): Promise<Buffer | 'absent' | 'illisible'> {
  if (!fs.existsSync(depot)) return 'absent';
  // `--literal-pathspecs` : un chemin écrit par un agent n'est jamais un motif.
  const git = ['--literal-pathspecs', '-C', depot];
  try {
    const { stdout } = await executer('git', [...git, 'log', '--all', '-1', '--diff-filter=AM', '--format=%H', '--', relatif], {
      timeout: DELAI_GIT_MS,
    });
    const sha = stdout.trim();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) return 'absent';
    const { stdout: contenu } = await executer('git', [...git, 'show', `${sha}:${relatif}`], {
      timeout: DELAI_GIT_MS,
      encoding: 'buffer',
      maxBuffer: PLAFOND_D_UNE_COPIE,
    });
    return contenu;
  } catch (err: any) {
    log.info('fichiers-conserves', `historique illisible pour ${relatif} : ${String(err?.message ?? err).split('\n')[0]}`);
    return 'illisible';
  }
}

/** Le dépôt déclaré qui contient ce chemin absolu, pour y lire l'historique. */
function depotsPour(chemin: string, ctx: ContexteDeConservation): string[] {
  const nomme = path.isAbsolute(chemin) ? relatifDUneCopieDeCarte(chemin)?.depot : undefined;
  const declares = listProjects(true).map((p) => path.resolve(p.path));
  const contenant = path.isAbsolute(chemin) ? declares.filter((d) => chemin.startsWith(`${d}/`)).sort((a, b) => b.length - a.length) : [];
  const connus = nomme && declares.includes(path.resolve(nomme)) ? [path.resolve(nomme)] : [];
  return [...new Set([...connus, ...contenant, path.resolve(ctx.projectPath)])];
}

/** Ce chemin mène-t-il à un vrai fichier que les racines ont refusé ? */
function existeHorsDesRacines(chemin: string, bases: Array<string | null | undefined>): boolean {
  const candidats = path.isAbsolute(chemin)
    ? [chemin]
    : (bases.filter(Boolean) as string[]).map((base) => path.resolve(base, chemin));
  return candidats.some((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
}

/** Fichier vivant, puis copie gardée, puis historique git ; sinon le motif de l'absence. */
export async function resoudreFichierCite(ctx: ContexteDeConservation, chemin: string): Promise<ResolutionDeFichierCite> {
  const bases = [ctx.workdir, ctx.projectPath];
  const vivant = fichierCite(chemin, racinesDesFichiersCites(ctx), bases);
  if (vivant) return { trouve: true, file: vivant.file, nom: path.basename(vivant.file), mime: vivant.mime, taille: vivant.taille, origine: 'vivant' };
  if (!chemin || chemin.includes('\0') || chemin.split(/[/\\]/).includes('..')) return { trouve: false, motif: 'hors-dossiers' };
  if (existeHorsDesRacines(chemin, bases)) return { trouve: false, motif: 'hors-dossiers' };

  const absolu = path.isAbsolute(chemin) ? path.resolve(chemin) : chemin;
  const depots = depotsPour(absolu, ctx);
  const relatif = relatifDansLeProjet(absolu, [ctx.workdir, ...depots].filter(Boolean) as string[]);
  const lignes = lignesDuChemin(ctx.projectId, absolu, relatif, ctx.cardId);
  const dossier = dossierDesCopies();
  let copieInjoignable = false;
  for (const ligne of lignes) {
    if (ligne.expire_le !== null) continue;
    if (!dossier) {
      copieInjoignable = true;
      break;
    }
    const file = fichierDeLaCopie(dossier, ligne.sha);
    if (fs.existsSync(file)) return { trouve: true, file, nom: ligne.nom, mime: ligne.mime, taille: ligne.taille, origine: 'copie' };
  }

  if (relatif && !path.isAbsolute(relatif) && !fichierSensible(relatif)) {
    for (const depot of depots) {
      const contenu = await contenuDansGit(depot, relatif);
      if (!Buffer.isBuffer(contenu)) continue;
      if (!dossier) return { trouve: false, motif: 'stockage-absent' };
      try {
        const { file } = await rangerLaCopie(ctx, dossier, contenu, absolu);
        return { trouve: true, file, nom: path.basename(relatif), mime: mimeDuFichier(relatif), taille: contenu.length, origine: 'git' };
      } catch (err: any) {
        log.warn('fichiers-conserves', `copie reprise de l'historique impossible (${relatif}) : ${err?.message ?? err}`);
        return { trouve: false, motif: 'stockage-absent' };
      }
    }
  }

  if (copieInjoignable) return { trouve: false, motif: 'stockage-absent' };
  const expiree = lignes.find((l) => l.expire_le !== null);
  if (expiree) return { trouve: false, motif: 'expire', date: expiree.expire_le ?? undefined };
  return { trouve: false, motif: 'pas-encore-cree' };
}

/* ------------------------------------------------------------------ */
/* Effacer                                                             */
/* ------------------------------------------------------------------ */

/**
 * LES COPIES DE PLUS DE 3 MOIS S'EFFACENT. Un contenu partagé ne part que si plus
 * aucune ligne vivante ne le vise. Disque absent : rien ne bouge ce jour-là. Un
 * effacement refusé laisse ses lignes vivantes : on réessaie à la passe suivante.
 * Ne touche ni aux pièces jointes ni aux conversations. Ne lève jamais.
 */
export function purgerLesCopiesAnciennes(maintenant = Date.now()): { expirees: number; effaces: number; ignore?: string } {
  const bilan = { expirees: 0, effaces: 0 };
  const dossier = dossierDesCopies();
  if (!dossier) return { ...bilan, ignore: 'disque de stockage absent' };
  try {
    const db = getDb();
    const limite = maintenant - CONSERVATION_DES_COPIES_MS;
    const lignes = db
      .prepare('SELECT id, sha FROM fichiers_conserves WHERE expire_le IS NULL AND at < ?')
      .all(limite) as Array<{ id: number; sha: string }>;
    const parContenu = new Map<string, number[]>();
    for (const l of lignes) parContenu.set(l.sha, [...(parContenu.get(l.sha) ?? []), l.id]);
    const encoreVise = db.prepare('SELECT 1 FROM fichiers_conserves WHERE sha = ? AND expire_le IS NULL AND at >= ? LIMIT 1');
    const marquer = db.prepare('UPDATE fichiers_conserves SET expire_le = ? WHERE id = ?');
    for (const [sha, ids] of parContenu) {
      if (!encoreVise.get(sha, limite)) {
        try {
          fs.rmSync(fichierDeLaCopie(dossier, sha), { force: true });
          bilan.effaces += 1;
        } catch (err: any) {
          log.warn('fichiers-conserves', `copie ${sha} non effacée : ${err?.message ?? err}`);
          continue;
        }
      }
      for (const id of ids) marquer.run(maintenant, id);
      bilan.expirees += ids.length;
    }
    if (bilan.expirees) log.info('fichiers-conserves', `${bilan.expirees} copies expirées, ${bilan.effaces} fichiers effacés`);
  } catch (err: any) {
    log.warn('fichiers-conserves', `purge interrompue : ${err?.message ?? err}`);
  }
  return bilan;
}
