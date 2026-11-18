/**
 * LA MACHINE ET CE QUI OCCUPE SES DISQUES — la page « Serveur » des réglages.
 *
 *  - LA FICHE : adresses publiques, cœurs, mémoire, disques (stockage externe
 *    compris). `df` passe sous un délai court : un stockage réseau (sshfs) qui
 *    fige ne bloque jamais la fiche, il est dit « injoignable ».
 *  - L'HISTORIQUE DES DISQUES : un relevé par heure, gardé 31 jours, pour la
 *    courbe sur 30 jours (la mémoire et le processeur ont déjà le leur, 26 h,
 *    dans `capacity_samples`).
 *  - LES DIX PLUS LOURDS : un relevé EN ARRIÈRE-PLAN (`du -x` + `find -size`),
 *    sous `nice`/`ionice`, un seul à la fois, avec un délai par disque — le
 *    disque principal toutes les 6 h, le stockage externe (7 min de relevé
 *    mesurées le 06/11/2026 sur 360 Go en sshfs) une fois par jour. JAMAIS à
 *    l'ouverture de la page : la page lit le dernier résultat.
 *  - L'EXPLORATEUR : un dossier à la fois, en LECTURE SEULE. Le listage est
 *    immédiat (tailles connues : relevé ou mesures récentes) ; la mesure d'un
 *    dossier (`du -d 1`) se demande à part et se met à jour à l'écran.
 *  - LE MÉNAGE : une carte posée dans « Planifié » du projet de l'application,
 *    rien ne part au moteur (MEM-2607).
 *
 * Tout passe par `execFile` sans shell : un chemin venu de l'écran n'est
 * jamais interpolé. Rien de tout cela (hors fiche et historique) n'existe sur
 * l'offre hébergée : le refus est ICI, pas seulement à l'écran.
 *
 * Les règles pures (filtrage des adresses et des disques, choix des dix sans
 * doublon, variation de la veille) vivent dans `shared/src/serveur-machine.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  adressesPubliques,
  descriptionDeMenage,
  lesPlusLourds,
  lireDu,
  lireGrosFichiers,
  lireLeDossier,
  lireLesDisques,
  fusionnerLesTailles,
  marquerLesPointsDeMontage,
  montageDuChemin,
  trierLesEntrees,
  normaliserChemin,
  projetQuiPorteLeChemin,
  releveDeLaVeille,
  titreDeMenage,
  variationDepuis,
  type CandidatDOccupation,
  type DisqueDeLaMachine,
  type ElementLourd,
  type EntreeDeDossier,
  type FicheDeLaMachine,
} from '@beluga/shared';
import { CONFIG, DEMON_D_ESSAI } from './config.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { machineHebergee } from './offre-hebergee.js';

/* ------------------------------------------------------------------ */
/* Réglages fixes                                                       */
/* ------------------------------------------------------------------ */

const DELAI_DF_MS = 5_000;
/** Un dossier relevé à partir de cette taille (les plus petits ne font pas les dix plus lourds). */
const SEUIL_DOSSIER = 100 * 1024 * 1024;
/** Les tailles de dossiers gardées pour l'explorateur. */
const SEUIL_TAILLE_CONNUE = 10 * 1024 * 1024;
const PROFONDEUR_DU = 4;
const INTERVALLE_PRINCIPAL_MS = 6 * 3_600_000;
const INTERVALLE_EXTERNE_MS = 24 * 3_600_000;
const DELAI_RELEVE_PRINCIPAL_MS = 20 * 60_000;
const DELAI_RELEVE_EXTERNE_MS = 40 * 60_000;
const GARDE_DES_RELEVES_MS = 8 * 24 * 3_600_000;
const GARDE_HISTORIQUE_DISQUES_MS = 31 * 24 * 3_600_000;
const CANDIDATS_GARDES = 400;
const ENTREES_MAX_DOSSIER = 2_000;
const DELAI_DOSSIER_MS = 10_000;
const DELAI_TAILLES_DOSSIER_MS = 15_000;

const REFUS_HEBERGEE = 'Cette fonction n’existe pas sur l’offre hébergée.';

function dossierDesReleves(): string {
  return path.join(CONFIG.dataDir, 'occupation-disque');
}

/* ------------------------------------------------------------------ */
/* Exécution bornée, sans shell                                         */
/* ------------------------------------------------------------------ */

interface Sortie {
  stdout: string;
  /** Le délai a coupé la commande. */
  coupee: boolean;
  code: number;
}

function lancer(commande: string, args: string[], delaiMs: number, maxBuffer = 64 * 1024 * 1024): Promise<Sortie> {
  return new Promise((resolve) => {
    execFile(commande, args, { timeout: delaiMs, maxBuffer, killSignal: 'SIGKILL', encoding: 'utf8' }, (err, stdout) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string; signal?: string }) | null;
      resolve({
        stdout: stdout ?? '',
        coupee: !!e && (e.killed === true || e.signal === 'SIGKILL'),
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
      });
    });
  });
}

/**
 * LIRE TOUT LE DISQUE demande les droits de l'administrateur de la machine
 * (`/var/lib/docker`, les dossiers d'autres comptes). Le démon tourne sous un
 * compte ordinaire : on passe par `sudo -n` quand il est permis sans mot de
 * passe, sinon on lit ce qu'on peut — `du` dit alors ses refus et on garde sa
 * sortie.
 */
let sudoPermis: Promise<boolean> | undefined;
function avecSudo(): Promise<boolean> {
  if (process.getuid?.() === 0) return Promise.resolve(false);
  sudoPermis ??= lancer('sudo', ['-n', 'true'], 5_000).then((s) => s.code === 0 && !s.coupee);
  return sudoPermis;
}

/** Une lecture du disque, douce pour la machine : priorité minimale, entrées-sorties au repos. */
async function lectureDouce(commande: string, args: string[], delaiMs: number): Promise<Sortie> {
  const douce = ['nice', '-n', '19', 'ionice', '-c3', commande, ...args];
  return (await avecSudo()) ? lancer('sudo', ['-n', ...douce], delaiMs) : lancer(douce[0], douce.slice(1), delaiMs);
}

/* ------------------------------------------------------------------ */
/* La fiche                                                             */
/* ------------------------------------------------------------------ */

function memoireDisponible(): number {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const m = info.match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) return Number(m[1]) * 1024;
  } catch {
    /* pas de /proc : on retombe sur Node */
  }
  return os.freemem();
}

function nomDuSysteme(): string {
  try {
    const texte = fs.readFileSync('/etc/os-release', 'utf8');
    const m = texte.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (m) return m[1];
  } catch {
    /* rien */
  }
  return `${os.type()} ${os.release()}`;
}

const ARGS_DF = ['-B1', '--output=source,fstype,size,used,avail,pcent,target'];

export async function lireLesDisquesDeLaMachine(): Promise<{ disques: DisqueDeLaMachine[]; injoignables: boolean }> {
  const complet = await lancer('df', ARGS_DF, DELAI_DF_MS, 4 * 1024 * 1024);
  if (!complet.coupee && complet.stdout) return { disques: lireLesDisques(complet.stdout), injoignables: false };
  // Un stockage réseau figé bloque `df` entier : on relit les disques LOCAUX seuls.
  const locaux = await lancer('df', ['-l', ...ARGS_DF], DELAI_DF_MS, 4 * 1024 * 1024);
  return { disques: lireLesDisques(locaux.stdout), injoignables: true };
}

export async function ficheDeLaMachine(): Promise<FicheDeLaMachine> {
  const { ipv4, ipv6 } = adressesPubliques(os.networkInterfaces() as any);
  const coeurs = os.cpus();
  const { disques, injoignables } = await lireLesDisquesDeLaMachine();
  return {
    nom: os.hostname(),
    systeme: nomDuSysteme(),
    ipv4,
    ipv6,
    coeurs: coeurs.length,
    processeur: (coeurs[0]?.model ?? '').replace(/\s+/g, ' ').trim(),
    memoireTotale: os.totalmem(),
    memoireDisponible: memoireDisponible(),
    demarreeDepuis: Math.round(os.uptime()),
    disques,
    ...(injoignables ? { disquesInjoignables: true } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Fichiers JSON du relevé                                              */
/* ------------------------------------------------------------------ */

function lireJson<T>(nom: string, defaut: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dossierDesReleves(), nom), 'utf8')) as T;
  } catch {
    return defaut;
  }
}

function ecrireJson(nom: string, valeur: unknown): void {
  const dossier = dossierDesReleves();
  fs.mkdirSync(dossier, { recursive: true });
  const cible = path.join(dossier, nom);
  const provisoire = `${cible}.${process.pid}.tmp`;
  fs.writeFileSync(provisoire, JSON.stringify(valeur));
  fs.renameSync(provisoire, cible);
}

/* ------------------------------------------------------------------ */
/* L'historique des disques (30 jours)                                   */
/* ------------------------------------------------------------------ */

export interface PointDesDisques {
  at: number;
  disques: { montage: string; utilise: number; taille: number }[];
}

const FICHIER_HISTORIQUE = 'historique-disques.json';

export function historiqueDesDisques(): PointDesDisques[] {
  return lireJson<{ points: PointDesDisques[] }>(FICHIER_HISTORIQUE, { points: [] }).points ?? [];
}

/** Un point par heure : appelé à chaque passage de la boucle de capacité, il n'écrit qu'une fois l'heure passée. */
export async function noterLesDisques(maintenant = Date.now()): Promise<void> {
  const points = historiqueDesDisques();
  const dernier = points[points.length - 1];
  if (dernier && maintenant - dernier.at < 3_600_000 - 60_000) return;
  const { disques, injoignables } = await lireLesDisquesDeLaMachine();
  if (!disques.length) return;
  const precedents = new Map((dernier?.disques ?? []).map((d) => [d.montage, d]));
  const point: PointDesDisques = {
    at: maintenant,
    disques: disques.map((d) => ({ montage: d.montage, utilise: d.utilise, taille: d.taille })),
  };
  // Un disque externe muet garde sa dernière valeur plutôt qu'un trou dans la courbe.
  if (injoignables) for (const [montage, d] of precedents) if (!point.disques.some((x) => x.montage === montage)) point.disques.push(d);
  ecrireJson(FICHIER_HISTORIQUE, {
    points: [...points.filter((p) => maintenant - p.at < GARDE_HISTORIQUE_DISQUES_MS), point],
  });
}

/* ------------------------------------------------------------------ */
/* Le relevé des plus lourds                                             */
/* ------------------------------------------------------------------ */

interface ReleveDUnDisque {
  montage: string;
  faitLe: number;
  dureeMs: number;
  /** Les plus gros candidats (dossiers et fichiers), pour les dix et la variation. */
  candidats: CandidatDOccupation[];
  /** Le relevé a été coupé par son délai : ce qu'il contient est partiel. */
  partiel?: boolean;
}

const FICHIER_RELEVES = 'releves-lourds.json';
/**
 * `du --time` : la date de l'écriture la plus récente DANS chaque dossier, lue
 * dans la même passe que sa taille (aucun parcours de plus). L'explorateur la
 * montre sous le dossier à la place de la date du dossier lui-même.
 */
const DU_AVEC_LA_DATE = ['--time', '--time-style=+%s'];
const fichierDesTailles = (montage: string) => `tailles-${montage === '/' ? 'racine' : montage.replace(/[^a-zA-Z0-9]+/g, '_')}.json`;

function relevesEnregistres(): ReleveDUnDisque[] {
  return lireJson<{ releves: ReleveDUnDisque[] }>(FICHIER_RELEVES, { releves: [] }).releves ?? [];
}

const enCours = new Set<string>();
let fileDAttente: Promise<void> = Promise.resolve();
const dernieresErreurs = new Map<string, string>();

export async function releverUnDisque(disque: DisqueDeLaMachine): Promise<void> {
  const debut = Date.now();
  const delai = disque.externe ? DELAI_RELEVE_EXTERNE_MS : DELAI_RELEVE_PRINCIPAL_MS;
  enCours.add(disque.montage);
  try {
    // `-x` : on reste sur CE disque — le stockage externe monté sous « / » n'est jamais compté deux fois.
    const du = await lectureDouce('du', ['-x', '-k', '-d', String(PROFONDEUR_DU), ...DU_AVEC_LA_DATE, disque.montage], delai);
    const reste = Math.max(60_000, delai - (Date.now() - debut));
    const find = await lectureDouce(
      'find',
      [disque.montage, '-xdev', '-type', 'f', '-size', '+100M', '-printf', '%s\\t%p\\n'],
      reste,
    );
    const dossiers = lireDu(du.stdout);
    if (!dossiers.length) {
      dernieresErreurs.set(disque.montage, du.coupee ? 'Le relevé a dépassé son délai.' : 'Le relevé n’a rien rendu.');
      return;
    }
    const fichiers = lireGrosFichiers(find.stdout);
    const candidats = [...dossiers.filter((d) => d.octets >= SEUIL_DOSSIER), ...fichiers]
      .sort((a, b) => b.octets - a.octets)
      .slice(0, CANDIDATS_GARDES);
    const releve: ReleveDUnDisque = {
      montage: disque.montage,
      faitLe: Date.now(),
      dureeMs: Date.now() - debut,
      candidats,
      ...(du.coupee || find.coupee ? { partiel: true } : {}),
    };
    const maintenant = Date.now();
    ecrireJson(FICHIER_RELEVES, {
      releves: [...relevesEnregistres().filter((r) => maintenant - r.faitLe < GARDE_DES_RELEVES_MS), releve],
    });
    ecrireJson(fichierDesTailles(disque.montage), {
      faitLe: releve.faitLe,
      tailles: dossiers
        .filter((d) => d.octets >= SEUIL_TAILLE_CONNUE)
        .map((d) => (d.dernierLe ? [d.chemin, d.octets, d.dernierLe] : [d.chemin, d.octets])),
    });
    dernieresErreurs.delete(disque.montage);
    log.info(`occupation du disque ${disque.montage} relevée en ${Math.round(releve.dureeMs / 1000)} s (${candidats.length} candidats${releve.partiel ? ', partiel' : ''})`);
  } catch (err) {
    dernieresErreurs.set(disque.montage, String((err as Error)?.message ?? err));
    log.warn(`relevé d’occupation de ${disque.montage} tombé`, err);
  } finally {
    enCours.delete(disque.montage);
  }
}

/**
 * UN SEUL RELEVÉ À LA FOIS : les demandes s'enfilent, un disque déjà en cours
 * ou déjà en file n'est pas redemandé. Rend tout de suite ; le relevé tourne
 * en arrière-plan.
 */
function enfilerLeReleve(disques: DisqueDeLaMachine[]): void {
  const attendus = new Set<string>();
  for (const disque of disques) {
    if (enCours.has(disque.montage) || attendus.has(disque.montage)) continue;
    attendus.add(disque.montage);
    enAttente.add(disque.montage);
    fileDAttente = fileDAttente.then(async () => {
      enAttente.delete(disque.montage);
      await releverUnDisque(disque);
    });
  }
}
const enAttente = new Set<string>();

export interface EtatDesPlusLourds {
  elements: ElementLourd[];
  /** Les disques en cours de relevé (ou en file). */
  enCours: string[];
  /** Le relevé le plus récent, tous disques confondus. */
  releveLe?: number;
  /** Le relevé de comparaison « veille », s'il existe. */
  veilleLe?: number;
  partiel?: boolean;
  erreurs?: { montage: string; message: string }[];
}

export function etatDesPlusLourds(): EtatDesPlusLourds {
  const releves = relevesEnregistres();
  const montages = [...new Set(releves.map((r) => r.montage))];
  const projets = store.listProjects().map((p) => ({ nom: p.name, dossier: p.path }));
  const candidats: (CandidatDOccupation & { montage: string; variation?: number })[] = [];
  let releveLe: number | undefined;
  let veilleLe: number | undefined;
  let partiel = false;
  for (const montage of montages) {
    const duDisque = releves.filter((r) => r.montage === montage).sort((a, b) => b.faitLe - a.faitLe);
    const dernier = duDisque[0];
    if (!dernier) continue;
    releveLe = Math.max(releveLe ?? 0, dernier.faitLe);
    if (dernier.partiel) partiel = true;
    const veille = releveDeLaVeille(duDisque, dernier.faitLe);
    if (veille) veilleLe = Math.max(veilleLe ?? 0, veille.faitLe);
    const tailles = veille ? new Map(veille.candidats.map((c) => [c.chemin, c.octets])) : undefined;
    for (const c of dernier.candidats) candidats.push({ ...c, montage, variation: variationDepuis(c.chemin, c.octets, tailles) });
  }
  const retenus = lesPlusLourds(candidats, { montages });
  const parChemin = new Map(candidats.map((c) => [c.chemin, c]));
  const elements: ElementLourd[] = retenus.map((r) => {
    const c = parChemin.get(r.chemin)!;
    const projet = projetQuiPorteLeChemin(r.chemin, projets);
    return {
      chemin: r.chemin,
      genre: r.genre,
      octets: r.octets,
      montage: c.montage,
      ...(c.variation !== undefined ? { variation: c.variation } : {}),
      ...(projet ? { projet } : {}),
    };
  });
  const erreurs = [...dernieresErreurs].map(([montage, message]) => ({ montage, message }));
  return {
    elements,
    enCours: [...new Set([...enCours, ...enAttente])],
    ...(releveLe ? { releveLe } : {}),
    ...(veilleLe ? { veilleLe } : {}),
    ...(partiel ? { partiel } : {}),
    ...(erreurs.length ? { erreurs } : {}),
  };
}

/** Le bouton « Relancer le relevé » : tous les disques, dans la file. */
export async function relancerLeReleve(): Promise<EtatDesPlusLourds> {
  if (machineHebergee()) throw new Error(REFUS_HEBERGEE);
  const { disques } = await lireLesDisquesDeLaMachine();
  enfilerLeReleve(disques);
  return etatDesPlusLourds();
}

/**
 * LE CALENDRIER DES RELEVÉS : vérifié toutes les 30 minutes, il enfile chaque
 * disque dont le dernier relevé est plus vieux que son intervalle. Le premier
 * passage attend dix minutes après le démarrage du démon : un redémarrage ne
 * se double jamais d'un `du` sur tout le disque.
 */
export function demarrerLeSuiviDesDisques(): () => void {
  const minuteries: NodeJS.Timeout[] = [];
  // L'historique horaire existe partout (offre hébergée comprise) : c'est la fiche.
  const noter = () => void noterLesDisques().catch((err) => log.warn('historique des disques', err));
  minuteries.push(setTimeout(noter, 30_000));
  minuteries.push(setInterval(noter, 5 * 60_000));
  if (!machineHebergee() && !DEMON_D_ESSAI) {
    const verifier = async () => {
      try {
        const { disques } = await lireLesDisquesDeLaMachine();
        const releves = relevesEnregistres();
        const maintenant = Date.now();
        const dus = disques.filter((d) => {
          const dernier = Math.max(0, ...releves.filter((r) => r.montage === d.montage).map((r) => r.faitLe));
          return maintenant - dernier >= (d.externe ? INTERVALLE_EXTERNE_MS : INTERVALLE_PRINCIPAL_MS);
        });
        if (dus.length) enfilerLeReleve(dus);
      } catch (err) {
        log.warn('calendrier des relevés d’occupation', err);
      }
    };
    minuteries.push(setTimeout(() => void verifier(), 10 * 60_000));
    minuteries.push(setInterval(() => void verifier(), 30 * 60_000));
  }
  for (const m of minuteries) m.unref?.();
  return () => minuteries.forEach((m) => clearTimeout(m));
}

/* ------------------------------------------------------------------ */
/* L'explorateur                                                         */
/* ------------------------------------------------------------------ */

/** Un disque tel que l'explorateur le montre : une racine de l'arbre, avec sa jauge. */
export interface RacineDeLExplorateur {
  montage: string;
  externe: boolean;
  taille: number;
  utilise: number;
  /** Le disque n'a pas répondu à la dernière lecture (sshfs figé) : on garde ses derniers chiffres. */
  injoignable?: boolean;
}

export interface ContenuDuDossier {
  chemin: string;
  /** Le disque qui porte ce dossier (sa racine dans l'arbre). */
  montage: string;
  /** Les disques de la machine : les racines de l'arbre. */
  disques: RacineDeLExplorateur[];
  entrees: EntreeDeDossier[];
  /** D'où viennent les tailles des sous-dossiers. */
  tailles: 'mesurees' | 'releve' | 'aucune';
  /** La date de cette source (relevé ou mesure). */
  taillesLe?: number;
  /** Une mesure de ce dossier tourne en ce moment. */
  mesureEnCours?: boolean;
  /** Le dossier a plus d'entrées que la liste n'en montre. */
  tronque?: number;
  /** Le dossier n'a pas pu être lu (absent, refusé, délai). */
  erreur?: string;
}

export interface MesureDuDossier extends ContenuDuDossier {
  /** « differee » : la mesure n'est pas partie (relevé du même disque en cours, trop de mesures à la fois). */
  mesure: 'faite' | 'partielle' | 'differee' | 'recente';
}

/* LES DISQUES, GARDÉS UNE MINUTE : un clic dans l'explorateur ne relance pas
   `df` (5 s de délai si le disque externe fige). Un disque externe qui ne
   répond plus garde ses derniers chiffres, marqué « injoignable ». */
const DUREE_DES_DISQUES_MS = 60_000;
let disquesGardes: { at: number; racines: RacineDeLExplorateur[] } | undefined;
let lectureDesDisques: Promise<RacineDeLExplorateur[]> | undefined;

async function racinesDeLExplorateur(): Promise<RacineDeLExplorateur[]> {
  if (disquesGardes && Date.now() - disquesGardes.at < DUREE_DES_DISQUES_MS) return disquesGardes.racines;
  lectureDesDisques ??= lireLesDisquesDeLaMachine()
    .then(({ disques, injoignables }) => {
      const racines: RacineDeLExplorateur[] = disques.map((d) => ({ montage: d.montage, externe: d.externe, taille: d.taille, utilise: d.utilise }));
      if (injoignables) {
        for (const ancien of disquesGardes?.racines ?? []) {
          if (ancien.externe && !racines.some((r) => r.montage === ancien.montage)) racines.push({ ...ancien, injoignable: true });
        }
      }
      disquesGardes = { at: Date.now(), racines };
      return racines;
    })
    .finally(() => {
      lectureDesDisques = undefined;
    });
  return lectureDesDisques;
}

function taillesDuReleve(montage: string | undefined): { faitLe: number; tailles: Map<string, number>; dates: Map<string, number> } | undefined {
  if (!montage) return undefined;
  const lu = lireJson<{ faitLe?: number; tailles?: [string, number, number?][] }>(fichierDesTailles(montage), {});
  if (!lu.faitLe || !lu.tailles?.length) return undefined;
  const dates = new Map<string, number>();
  for (const [chemin, , date] of lu.tailles) if (date) dates.set(chemin, date);
  return { faitLe: lu.faitLe, tailles: new Map(lu.tailles.map(([chemin, octets]) => [chemin, octets])), dates };
}

/* LES MESURES FAITES DEPUIS L'EXPLORATEUR, gardées en mémoire (bornées, la plus
   ancienne s'en va d'abord) : chaque ligne de `du -d 1` donne la taille d'un
   enfant ET celle du dossier lui-même, réutilisées par le parent à l'ouverture
   suivante. Le relevé de fond, plus récent, les remplace naturellement. */
const MESURES_GARDEES = 20_000;
const DOSSIERS_MESURES_GARDES = 500;
const taillesMesurees = new Map<string, { octets: number; at: number; dernierLe?: number }>();
const dossiersMesures = new Map<string, { at: number; complete: boolean }>();
const mesuresEnVol = new Map<string, Promise<void>>();
/** Au-delà, une mesure automatique attend : trois `du` à la fois suffisent à charger la machine. */
const MESURES_SIMULTANEES = 3;
/** Une mesure plus jeune que ceci n'est pas refaite à l'ouverture (le bouton « Recalculer » la force). */
const FRAICHEUR_D_UNE_MESURE_MS = 15 * 60_000;
const DELAI_MESURE_PRINCIPAL_MS = 3 * 60_000;
const DELAI_MESURE_EXTERNE_MS = 10 * 60_000;

function garder<K, V>(table: Map<K, V>, cle: K, valeur: V, plafond: number): void {
  table.delete(cle);
  table.set(cle, valeur);
  while (table.size > plafond) table.delete(table.keys().next().value as K);
}

/**
 * LE LISTAGE, SANS AUCUN CALCUL DE TAILLE : `find -maxdepth 1` (10 s au plus),
 * puis les tailles déjà connues — mesures récentes de l'explorateur et dernier
 * relevé du disque, la plus récente gagnant. Rend en une fraction de seconde ;
 * la mesure du dossier se demande à part (`mesurerLeDossier`).
 */
export async function contenuDuDossier(brut: unknown): Promise<ContenuDuDossier> {
  if (machineHebergee()) throw new Error(REFUS_HEBERGEE);
  const chemin = normaliserChemin(brut);
  if (!chemin) throw new Error('Chemin refusé : il doit être absolu.');
  const [listage, disques] = await Promise.all([
    lectureDouce('find', [chemin, '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\t%s\\t%T@\\t%f\\n'], DELAI_DOSSIER_MS),
    racinesDeLExplorateur(),
  ]);
  const montages = disques.map((d) => d.montage);
  const montage = montageDuChemin(chemin, montages) ?? '/';
  const base = { chemin, montage, disques, ...(mesuresEnVol.has(chemin) ? { mesureEnCours: true } : {}) };
  if (!listage.stdout.trim()) {
    return {
      ...base,
      entrees: [],
      tailles: 'aucune',
      ...(listage.code !== 0 || listage.coupee ? { erreur: listage.coupee ? 'Le dossier a mis trop de temps à répondre.' : 'Ce dossier ne peut pas être lu.' } : {}),
    };
  }
  const brutes = lireLeDossier(chemin, listage.stdout);
  const { connues, dates, tailles, taillesLe } = fusionnerLesTailles({
    enfants: brutes.filter((e) => e.genre === 'dossier').map((e) => e.chemin),
    releve: taillesDuReleve(montage),
    mesurees: taillesMesurees,
    mesureDuDossier: dossiersMesures.get(chemin),
  });
  const toutes = trierLesEntrees(marquerLesPointsDeMontage(chemin, lireLeDossier(chemin, listage.stdout, connues, dates), montages));
  const entrees = toutes.slice(0, ENTREES_MAX_DOSSIER);
  return {
    ...base,
    entrees,
    tailles,
    ...(taillesLe ? { taillesLe } : {}),
    ...(toutes.length > entrees.length ? { tronque: toutes.length - entrees.length } : {}),
  };
}

/**
 * LA MESURE D'UN DOSSIER : `du -x -k -d 1` sur CE dossier seulement (ses
 * entrées directes, jamais tout le disque), en douceur, sous un délai long.
 * UNE seule mesure par chemin : une seconde demande rejoint la première. Une
 * mesure coupée par son délai garde ce qu'elle a lu (`du` écrit chaque enfant
 * dès qu'il l'a fini). Rend le contenu du dossier, tailles à jour.
 *
 * Automatique (à l'ouverture d'un dossier), elle s'abstient si le dossier vient
 * d'être mesuré, si le relevé de fond de ce disque tourne (il apportera mieux)
 * ou si trois mesures tournent déjà. `force` (le bouton « Recalculer ce
 * dossier ») passe outre la fraîcheur et le relevé.
 */
export async function mesurerLeDossier(brut: unknown, force = false): Promise<MesureDuDossier> {
  if (machineHebergee()) throw new Error(REFUS_HEBERGEE);
  const chemin = normaliserChemin(brut);
  if (!chemin) throw new Error('Chemin refusé : il doit être absolu.');
  const enVol = mesuresEnVol.get(chemin);
  if (enVol) {
    await enVol;
    return { ...(await contenuDuDossier(chemin)), mesure: dossiersMesures.get(chemin)?.complete === false ? 'partielle' : 'faite' };
  }
  const disques = await racinesDeLExplorateur();
  const montage = montageDuChemin(chemin, disques.map((d) => d.montage)) ?? '/';
  const disque = disques.find((d) => d.montage === montage);
  const derniere = dossiersMesures.get(chemin);
  if (!force) {
    if (derniere?.complete && Date.now() - derniere.at < FRAICHEUR_D_UNE_MESURE_MS) return { ...(await contenuDuDossier(chemin)), mesure: 'recente' };
    if (enCours.has(montage) || mesuresEnVol.size >= MESURES_SIMULTANEES || disque?.injoignable) {
      return { ...(await contenuDuDossier(chemin)), mesure: 'differee' };
    }
  } else if (mesuresEnVol.size >= MESURES_SIMULTANEES * 2) {
    throw new Error('Plusieurs mesures tournent déjà : réessayez dans un instant.');
  }
  const delai = disque?.externe ? DELAI_MESURE_EXTERNE_MS : DELAI_MESURE_PRINCIPAL_MS;
  const travail = (async () => {
    const debut = Date.now();
    const sortie = await lectureDouce('du', ['-x', '-k', '-d', '1', ...DU_AVEC_LA_DATE, chemin], delai);
    const at = Date.now();
    const lues = lireDu(sortie.stdout);
    for (const d of lues) garder(taillesMesurees, d.chemin, { octets: d.octets, at, ...(d.dernierLe ? { dernierLe: d.dernierLe } : {}) }, MESURES_GARDEES);
    // Le dossier lui-même n'est écrit par `du` qu'à la toute fin : sa présence prouve une mesure complète.
    const complete = !sortie.coupee && lues.some((d) => d.chemin === chemin);
    if (lues.length || complete) garder(dossiersMesures, chemin, { at, complete }, DOSSIERS_MESURES_GARDES);
    log.info(`explorateur : ${chemin} mesuré en ${Math.round((at - debut) / 1000)} s (${lues.length} lignes${complete ? '' : ', partiel'})`);
  })().finally(() => mesuresEnVol.delete(chemin));
  mesuresEnVol.set(chemin, travail);
  await travail;
  return { ...(await contenuDuDossier(chemin)), mesure: dossiersMesures.get(chemin)?.complete ? 'faite' : 'partielle' };
}

/* ------------------------------------------------------------------ */
/* Le ménage confié à un agent                                           */
/* ------------------------------------------------------------------ */

/**
 * « DEMANDER À UN AGENT DE FAIRE LE MÉNAGE » : une carte posée dans
 * « Planifié » du projet de l'application, avec le chemin, sa taille, sa
 * variation et la prudence exigée. Rien ne part au moteur : c'est l'utilisateur
 * qui la lance (« Une carte NAÎT dans « Planifié » », MEM-2607).
 */
export async function demanderLeMenage(brut: unknown): Promise<{ cardId: string; projectId: string; title: string }> {
  if (machineHebergee()) throw new Error(REFUS_HEBERGEE);
  const chemin = normaliserChemin(brut);
  if (!chemin || chemin === '/') throw new Error('Chemin refusé.');
  const projet = store.listProjects().find((p) => p.isSelf);
  if (!projet) throw new Error('Aucun projet de l’application pour y poser la carte.');
  const connu = etatDesPlusLourds().elements.find((e) => e.chemin === chemin);
  let octets = connu?.octets;
  let genre = connu?.genre;
  if (octets === undefined) {
    const stat = await fs.promises.lstat(chemin).catch(() => undefined);
    genre = stat?.isFile() ? 'fichier' : 'dossier';
    if (genre === 'fichier') octets = stat?.size;
    else {
      const mesure = await lectureDouce('du', ['-x', '-s', '-k', chemin], DELAI_TAILLES_DOSSIER_MS);
      octets = lireDu(mesure.stdout)[0]?.octets;
    }
  }
  const projets = store.listProjects().map((p) => ({ nom: p.name, dossier: p.path }));
  const { createCard } = await import('./tools.js');
  const card = createCard(projet.id, {
    title: titreDeMenage(chemin),
    description: descriptionDeMenage({
      chemin,
      genre: genre ?? 'dossier',
      octets: octets ?? 0,
      variation: connu?.variation,
      projet: projetQuiPorteLeChemin(chemin, projets),
    }),
    origin: 'user',
    auteur: 'utilisateur',
    // Aucun départ programmé : la carte attend qu'on la lance (elle porte
    // seulement le créneau CONSEILLÉ, comme toute carte posée).
  });
  bus.emit({ type: 'card.upsert', card });
  return { cardId: card.id, projectId: projet.id, title: card.title };
}
