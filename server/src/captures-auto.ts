/**
 * LES CAPTURES D'UN TOUR SE RANGENT TOUTES SEULES, EN PIÈCES JOINTES.
 *
 * Avant, une image n'entrait dans le fil que si l'agent la relisait (`Read`) ou
 * la joignait lui-même : le PNG écrit par un script d'essai qu'il ne rouvre
 * jamais n'apparaissait nulle part, et celles qui apparaissaient n'étaient pas
 * conservées (fichiers temporaires). À la FIN de chaque étape, deux recherches :
 *
 *  1. les chemins d'image cités dans la commande, le détail ou le résultat
 *     (`cheminsDImages`, règle pure) ;
 *  2. un balayage du DOSSIER DE TRAVAIL de l'agent, pour l'image qu'un script a
 *     écrite sans que son chemin figure dans la commande (le script a été écrit
 *     avant, par une autre étape). Seul le dossier de travail est balayé : le
 *     dossier temporaire du système est partagé avec tous les autres agents.
 *
 * Avant ces deux recherches, l'IMAGE QUE L'ÉTAPE A REGARDÉE (`RunStep.capture`)
 * se range TOUJOURS, sans plafond et quelle que soit sa date : c'est elle que
 * la bande montre, et elle dort souvent dans le dossier temporaire du système,
 * vidé tôt ou tard. Sur une carte, 12 captures avaient été perdues parce que le
 * plafond du tour était déjà rempli par des copies d'icônes.
 *
 * Un fichier n'est retenu que s'il existe, tombe dans les racines autorisées
 * (les mêmes que `/api/capture`), a été écrit PENDANT ce tour (date de
 * modification), n'est pas une copie d'icône faite par une construction
 * d'application (`estUneCopieDeConstruction`) et n'est pas déjà rangé. Il part alors en pièce jointe
 * (`joindreUnFichier`) et rejoint le message du tour, d'où la bande l'affiche en
 * direct. Tout se fait hors du flux d'événements du moteur : une erreur est
 * journalisée, jamais remontée.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cheminsDImages, estUneCopieDeConstruction, nomDeCaptureRangee, type Attachment } from '@beluga/shared';
import { CONFIG, PATHS } from './config.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { log } from './logger.js';

/**
 * DES PLAFONDS DE SÛRETÉ, CHACUN À SON COMPTE. Les images citées dans le texte
 * des étapes et celles du balayage ont chacune le leur : l'un ne peut plus
 * manger la place de l'autre. Les captures d'étape (`RunStep.capture`) n'en ont
 * AUCUN. Les copies d'icônes d'une construction étant écartées, ces plafonds ne
 * servent qu'à borner un script qui écrirait des milliers d'images.
 */
export const PLAFOND_DU_TEXTE = 200;
export const PLAFOND_DU_BALAYAGE = 200;
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const DOSSIERS_IGNORES = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__', '.venv', 'venv']);
/** Le balayage reste borné : un gros dépôt ne ralentit pas la fin d'une étape. */
const PROFONDEUR_MAX = 6;
const ENTREES_MAX = 6000;
/** L'horloge et le système de fichiers n'ont pas la même finesse. */
const TOLERANCE_MS = 2000;
const PAUSE_ENTRE_BALAYAGES_MS = 1000;

export interface ContexteDeCaptures {
  projectId: string;
  /** Le dépôt du projet. */
  projectPath: string;
  /** Le dossier de travail de l'agent (sa copie de carte), s'il en a un. */
  workdir?: string;
  cardId?: string;
  agentId: string;
  /** Début du tour : en deçà, un fichier est ancien, pas une capture de ce tour. */
  debutDuTour: number;
  /** Le titre de la carte : il préfixe le nom d'une capture au nom vague (« image.png »). */
  titreDeCarte?: string;
  /**
   * Appelée pour chaque pièce rangée, dans l'ordre de prise : elle rejoint le
   * message du tour. `fichier` est le chemin absolu d'où elle vient, pour relier
   * la pièce à l'étape qui l'a regardée (`RunStep.capturePiece`).
   */
  surJointe: (piece: Attachment, fichier: string) => void;
  /** Le tour est-il toujours celui qui tourne ? Un tour refermé ne reçoit plus rien. */
  vivant: () => boolean;
}

interface Etat {
  vues: Set<string>;
  rangeesDuTexte: number;
  rangeesDuBalayage: number;
  chaine: Promise<void>;
  balayageEnCours: boolean;
  balayageDemande: boolean;
  dernierBalayage: number;
}

const etats = new WeakMap<object, Etat>();

function etatDuTour(cle: object): Etat {
  let etat = etats.get(cle);
  if (!etat) {
    etat = {
      vues: new Set(),
      rangeesDuTexte: 0,
      rangeesDuBalayage: 0,
      chaine: Promise.resolve(),
      balayageEnCours: false,
      balayageDemande: false,
      dernierBalayage: 0,
    };
    etats.set(cle, etat);
  }
  return etat;
}

function racinesAutorisees(ctx: ContexteDeCaptures): string[] {
  return [ctx.workdir, ctx.projectPath, CONFIG.dataDir, os.tmpdir()].filter(Boolean).map((r) => path.resolve(r as string));
}

function dansUneRacine(full: string, racines: string[]): boolean {
  return racines.some((racine) => full === racine || full.startsWith(racine + path.sep));
}

/** Les pièces jointes déjà rangées ne se re-rangent pas depuis leur dossier de stockage. */
function dansLeStockage(full: string): boolean {
  return [PATHS.attachments, PATHS.attachmentsStockage]
    .filter(Boolean)
    .map((d) => path.resolve(d as string))
    .some((d) => full.startsWith(d + path.sep));
}

/**
 * Le fichier à ranger, ou null : existe, est une image, dans une racine
 * autorisée, hors stockage et hors dossiers écartés, écrit pendant le tour.
 */
export function imageDeCeTour(
  full: string,
  ctx: Pick<ContexteDeCaptures, 'workdir' | 'projectPath' | 'debutDuTour'>,
): { full: string; cle: string } | null {
  if (!EXTENSIONS.has(path.extname(full).toLowerCase())) return null;
  const racines = racinesAutorisees(ctx as ContexteDeCaptures);
  if (!dansUneRacine(full, racines) || dansLeStockage(full)) return null;
  if (full.split(path.sep).some((segment) => DOSSIERS_IGNORES.has(segment))) return null;
  if (estUneCopieDeConstruction(full)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;
  if (stat.mtimeMs < ctx.debutDuTour - TOLERANCE_MS) return null;
  // Même chemin récrit (boucle d'essai) = nouvelle capture : la date fait partie de la clé.
  return { full, cle: `${full}:${Math.round(stat.mtimeMs)}:${stat.size}` };
}

function resoudre(chemin: string, ctx: ContexteDeCaptures): string[] {
  if (path.isAbsolute(chemin)) return [path.resolve(chemin)];
  const bases = [ctx.workdir, ctx.projectPath].filter(Boolean) as string[];
  return bases.map((base) => path.resolve(base, chemin));
}

type Compteur = 'rangeesDuTexte' | 'rangeesDuBalayage';
const PLAFONDS: Record<Compteur, number> = { rangeesDuTexte: PLAFOND_DU_TEXTE, rangeesDuBalayage: PLAFOND_DU_BALAYAGE };

/** `compteur` absent : sans plafond (la capture d'étape). */
async function ranger(
  etat: Etat,
  ctx: ContexteDeCaptures,
  candidats: Array<{ full: string; cle: string }>,
  compteur?: Compteur,
): Promise<void> {
  for (const candidat of candidats) {
    if (!ctx.vivant()) return;
    if (compteur && etat[compteur] >= PLAFONDS[compteur]) return;
    if (etat.vues.has(candidat.cle)) continue;
    etat.vues.add(candidat.cle);
    try {
      const jointure = await joindreUnFichier({
        projectId: ctx.projectId,
        agentId: ctx.agentId,
        cardId: ctx.cardId,
        fichier: candidat.full,
        nom: nomDeCaptureRangee(path.basename(candidat.full), ctx.titreDeCarte),
        attendreStable: true,
      });
      if (!jointure.ok) {
        log.info('captures-auto', `capture non rangée (${path.basename(candidat.full)}) : ${jointure.refus}`);
        continue;
      }
      if (compteur) etat[compteur] += 1;
      if (ctx.vivant()) ctx.surJointe(jointure.attachment, candidat.full);
    } catch (err: any) {
      log.warn('captures-auto', `capture non rangée (${candidat.full}) : ${err?.message ?? err}`);
    }
  }
}

/**
 * L'IMAGE QUE L'ÉTAPE A REGARDÉE, quelle que soit sa date : l'agent l'a ouverte
 * pendant ce tour, même si elle a été écrite avant. Les autres garde-fous
 * (racines autorisées, stockage, extension, fichier non vide) tiennent.
 */
export function candidatDeLaCapture(chemin: string | undefined, ctx: ContexteDeCaptures): { full: string; cle: string } | null {
  if (!chemin?.trim()) return null;
  for (const full of resoudre(chemin.trim(), ctx)) {
    const image = imageDeCeTour(full, { ...ctx, debutDuTour: 0 });
    if (image) return image;
  }
  return null;
}

/** Les images retrouvées dans le texte d'une étape (commande, détail, résultat). */
export function candidatsDuTexte(textes: Array<string | undefined>, ctx: ContexteDeCaptures): Array<{ full: string; cle: string }> {
  const trouves: Array<{ full: string; cle: string }> = [];
  for (const chemin of cheminsDImages(...textes.map((t) => t?.slice(0, 20_000)))) {
    for (const full of resoudre(chemin, ctx)) {
      const image = imageDeCeTour(full, ctx);
      if (image) {
        trouves.push(image);
        break;
      }
    }
  }
  return trouves;
}

function balayer(dossier: string, ctx: ContexteDeCaptures, sortie: Array<{ full: string; cle: string }>, compte: { n: number }, profondeur = 0): void {
  if (profondeur > PROFONDEUR_MAX || compte.n > ENTREES_MAX) return;
  let entrees: fs.Dirent[];
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entree of entrees) {
    if (++compte.n > ENTREES_MAX) return;
    const full = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (!DOSSIERS_IGNORES.has(entree.name)) balayer(full, ctx, sortie, compte, profondeur + 1);
    } else if (entree.isFile() && EXTENSIONS.has(path.extname(entree.name).toLowerCase())) {
      const image = imageDeCeTour(full, ctx);
      if (image) sortie.push(image);
    }
  }
}

/** Les images écrites pendant le tour dans le dossier de travail, anciennes d'abord. */
export function imagesEcritesDansLeDossier(ctx: ContexteDeCaptures): Array<{ full: string; cle: string }> {
  const racine = ctx.workdir;
  if (!racine) return [];
  const sortie: Array<{ full: string; cle: string }> = [];
  balayer(racine, ctx, sortie, { n: 0 });
  return sortie.sort((a, b) => fs.statSync(a.full).mtimeMs - fs.statSync(b.full).mtimeMs);
}

/**
 * À appeler à la fin d'une étape. Rend la main tout de suite : le travail se
 * fait derrière, à la queue leu leu (deux étapes rapprochées ne rangent pas la
 * même image deux fois). `cle` identifie le tour (l'objet qui le porte).
 */
export function repererLesCaptures(
  cle: object,
  ctx: ContexteDeCaptures,
  etape: { textes: Array<string | undefined>; balayer: boolean; capture?: string },
): void {
  const etat = etatDuTour(cle);
  etat.chaine = etat.chaine
    .then(async () => {
      if (!ctx.vivant()) return;
      const capture = candidatDeLaCapture(etape.capture, ctx);
      if (capture) await ranger(etat, ctx, [capture]);
      await ranger(etat, ctx, candidatsDuTexte(etape.textes, ctx), 'rangeesDuTexte');
      if (etape.balayer) await balayerEtRanger(etat, ctx);
    })
    .catch((err) => log.warn('captures-auto', `repérage interrompu : ${err?.message ?? err}`));
}

async function balayerEtRanger(etat: Etat, ctx: ContexteDeCaptures): Promise<void> {
  // Un seul balayage à la fois ; une demande arrivée pendant l'un en rejoue un dernier.
  if (etat.balayageEnCours) {
    etat.balayageDemande = true;
    return;
  }
  if (Date.now() - etat.dernierBalayage < PAUSE_ENTRE_BALAYAGES_MS) {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_ENTRE_BALAYAGES_MS));
  }
  etat.balayageEnCours = true;
  try {
    do {
      etat.balayageDemande = false;
      etat.dernierBalayage = Date.now();
      await ranger(etat, ctx, imagesEcritesDansLeDossier(ctx), 'rangeesDuBalayage');
    } while (etat.balayageDemande && etat.rangeesDuBalayage < PLAFOND_DU_BALAYAGE && ctx.vivant());
  } finally {
    etat.balayageEnCours = false;
  }
}
