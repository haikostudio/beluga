/**
 * LE MÉNAGE DE NUIT : ce qui ne sert plus repart, ce qui compte ne bouge pas.
 *
 * Les dossiers de projets vivaient sur un stockage distant d'un téraoctet :
 * la place locale n'intéressait personne, et rien n'a jamais été nettoyé.
 * Mesuré le 21.09.2026 sur les 150 Go du serveur : 13 Go de fichiers
 * temporaires, 4 Go de caches d'outils, 762 Mo de paquets téléchargés, des
 * emplacements de copies déjà refermées. Les
 * projets étant maintenant ICI, cette accumulation se paie.
 *
 * Ce module EXÉCUTE ce que `shared/src/menage-du-disque.ts` autorise, et rien
 * d'autre : chaque suppression repasse par `estProtege` et par l'âge minimal
 * de sa cible. Un dossier de carte OUVERT n'est jamais touché, une branche
 * dont le travail n'existe nulle part ailleurs n'est jamais supprimée, et le
 * premier passage se fait À BLANC.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  assezVieux,
  brancheSupprimable,
  cheminDossierDeCarte,
  ciblesDeMenage,
  doitPasserLaNuit,
  estProtege,
  branchesDIntegration,
  phraseDeMenage,
  tailleLisible,
  type BilanDeMenage,
  type BrancheLocale,
  type CibleDeMenage,
} from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { CONFIG } from './config.js';
import { agentsActifs } from './runtime.js';
import { racinesDesCopiesDuProjet } from './copies-de-cartes.js';
import * as store from './store.js';

const execFileAsync = promisify(execFile);

const CLE_DERNIER_PASSAGE = 'menage.nuit';
/** Tant que cette clé vaut « fait », le ménage efface pour de bon ; sinon il simule. */
const CLE_PREMIER_PASSAGE = 'menage.premier-passage';
const VEILLE_MS = 10 * 60 * 1000;

function dossierPersonnel(): string {
  return process.env.HOME?.trim() || os.homedir() || '/root';
}

/** La taille d'une entrée, dossier compris — sans jamais suivre un lien. */
async function tailleDe(chemin: string): Promise<number> {
  let total = 0;
  const pile = [chemin];
  while (pile.length) {
    const courant = pile.pop()!;
    let infos: fs.Stats;
    try {
      infos = await fsp.lstat(courant);
    } catch {
      continue;
    }
    if (infos.isSymbolicLink()) continue;
    if (infos.isDirectory()) {
      let entrees: string[] = [];
      try {
        entrees = await fsp.readdir(courant);
      } catch {
        continue;
      }
      for (const entree of entrees) pile.push(path.join(courant, entree));
      continue;
    }
    total += infos.size;
  }
  return total;
}

/**
 * LES DOSSIERS QU'UN AGENT OCCUPE EN CE MOMENT.
 *
 * Une copie de carte vivante ressemble, vue du disque, à n'importe quel
 * dossier de travail. La seule différence tient à ce qui s'y passe : on croise
 * donc avec les agents réellement actifs, jamais avec l'allure du dossier.
 */
function dossiersOccupes(): string[] {
  const occupes: string[] = [];
  for (const id of agentsActifs()) {
    const agent = store.getAgent(id);
    if (!agent) continue;
    const projet = store.getProject(agent.projectId);
    if (!projet?.path) continue;
    const carte = agent.cardId ? store.getCard(agent.cardId) : undefined;
    if (!carte) continue;
    for (const racineDesCopies of racinesDesCopiesDuProjet(projet.path)) {
      occupes.push(path.resolve(cheminDossierDeCarte(projet.path, carte.title, carte.id, racineDesCopies)));
    }
  }
  return occupes;
}

/** Cette entrée peut-elle partir, au vu de sa cible, de son âge et des protections ? */
async function peutPartir(
  chemin: string,
  cible: CibleDeMenage,
  maintenant: number,
  proteges: readonly string[],
): Promise<{ ok: boolean; octets: number }> {
  if (estProtege(chemin, proteges)) return { ok: false, octets: 0 };
  let infos: fs.Stats;
  try {
    infos = await fsp.lstat(chemin);
  } catch {
    return { ok: false, octets: 0 };
  }
  if (!assezVieux(infos.mtimeMs, maintenant, cible.ageMinJours)) return { ok: false, octets: 0 };
  if (cible.genre === 'motif') {
    const nom = path.basename(chemin);
    if (!(cible.suffixes ?? []).some((suffixe) => nom.endsWith(suffixe))) return { ok: false, octets: 0 };
  }
  if (cible.genre === 'videSeulement') {
    if (!infos.isDirectory()) return { ok: false, octets: 0 };
    let entrees: string[] = [];
    try {
      entrees = await fsp.readdir(chemin);
    } catch {
      return { ok: false, octets: 0 };
    }
    if (entrees.length > 0) return { ok: false, octets: 0 };
    return { ok: true, octets: 0 };
  }
  return { ok: true, octets: await tailleDe(chemin) };
}

/** Passe une cible en revue : ce qui peut partir part (ou serait parti, en simulation). */
async function nettoyerUneCible(
  cible: CibleDeMenage,
  simulation: boolean,
  maintenant: number,
  proteges: readonly string[],
): Promise<{ entrees: number; octets: number }> {
  let entrees = 0;
  let octets = 0;
  let contenu: string[] = [];
  try {
    contenu = await fsp.readdir(cible.dossier);
  } catch {
    return { entrees: 0, octets: 0 };
  }
  for (const nom of contenu) {
    const chemin = path.join(cible.dossier, nom);
    const verdict = await peutPartir(chemin, cible, maintenant, proteges);
    if (!verdict.ok) continue;
    entrees += 1;
    octets += verdict.octets;
    if (simulation) continue;
    try {
      await fsp.rm(chemin, { recursive: true, force: true });
    } catch (err) {
      log.warn(`ménage : « ${chemin} » n’a pas pu être retiré — ${(err as Error).message}`);
      entrees -= 1;
      octets -= verdict.octets;
    }
  }
  return { entrees, octets };
}

/* ------------------------------------------------------------------ */
/* Les branches de travail déjà envoyées                               */
/* ------------------------------------------------------------------ */

async function git(racine: string, args: string[], timeoutMs = 60_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', racine, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

/** L'état des branches « tache/… » d'un dépôt : fusionnées, envoyées, occupées. */
export async function brancheslocales(racine: string, integrations: readonly string[]): Promise<BrancheLocale[]> {
  const locales = (await git(racine, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/tache']))
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean)
    .map((ligne) => {
      const [nom, sha] = ligne.split(/\s+/);
      return { nom, sha };
    });
  if (locales.length === 0) return [];

  /* Le travail peut avoir atterri sur l'une OU l'autre des branches
     d'intégration du dépôt : on prend l'union, jamais une seule. */
  const fusionnees = new Set<string>();
  for (const integration of integrations) {
    for (const nom of (await git(racine, ['branch', '--merged', integration, '--format=%(refname:short)']))
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)) {
      fusionnees.add(nom);
    }
  }
  const distantes = new Map<string, string>();
  for (const ligne of (await git(racine, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/remotes/origin/tache']))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const [nom, sha] = ligne.split(/\s+/);
    distantes.set(nom.replace(/^origin\//, ''), sha);
  }
  /* Une branche SORTIE (worktree) est occupée par définition : git refuserait
     de la supprimer, et nous n'avons pas à le lui demander. */
  const sorties = new Set(
    (await git(racine, ['worktree', 'list', '--porcelain']))
      .split('\n')
      .filter((ligne) => ligne.startsWith('branch '))
      .map((ligne) => ligne.replace('branch refs/heads/', '').trim()),
  );

  return locales.map((branche) => ({
    nom: branche.nom,
    fusionnee: fusionnees.has(branche.nom),
    surOriginAuMemeSha: distantes.get(branche.nom) === branche.sha,
    occupee: sorties.has(branche.nom),
  }));
}

/**
 * LES BRANCHES D'INTÉGRATION D'UN DÉPÔT, DEMANDÉES AU DÉPÔT LUI-MÊME.
 *
 * Rend une liste VIDE quand le dossier n'est pas un dépôt, ou qu'aucune
 * branche d'intégration n'y existe : l'appelant passe alors son chemin sans
 * rien toucher plutôt que de comparer à un nom qui n'existe pas.
 */
export async function branchesDIntegrationDe(racine: string): Promise<string[]> {
  const locales = (await git(racine, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .split('\n')
    .map((nom) => nom.trim())
    .filter(Boolean);
  if (locales.length === 0) return [];
  const teteDistante = (await git(racine, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']))
    .trim()
    .replace(/^refs\/remotes\//, '');
  const teteCourante = (await git(racine, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  return branchesDIntegration(teteDistante, teteCourante, locales);
}

/**
 * LES DÉPÔTS QUE LE MÉNAGE ÉLAGUE : celui du démon ET ceux des projets.
 *
 * Jusqu'au 22.09.2026, seul le dépôt du démon était traité : 427 branches de
 * tâche s'étaient accumulées sur les vingt dépôts de la machine, dont 325
 * déjà fusionnées. Les projets ARCHIVÉS sont écartés — leur dossier n'est
 * plus suivi, et leurs branches ne coûtent plus rien à personne.
 */
export function depotsAElaguer(): string[] {
  const racines = new Set<string>([CONFIG.depotDuDemon]);
  for (const projet of store.listProjects()) {
    const chemin = projet?.path?.trim();
    if (!chemin) continue;
    if (!fs.existsSync(path.join(chemin, '.git'))) continue;
    racines.add(chemin);
  }
  return [...racines];
}

/** Supprime les branches locales dont le travail existe ailleurs ; garde et nomme les autres. */
export async function purgerLesBranches(
  racine: string,
  integrations: readonly string[],
  simulation: boolean,
): Promise<{ supprimees: string[]; gardees: string[] }> {
  const branches = await brancheslocales(racine, integrations);
  const supprimees: string[] = [];
  const gardees: string[] = [];
  for (const branche of branches) {
    if (!brancheSupprimable(branche)) {
      gardees.push(branche.nom);
      continue;
    }
    if (!simulation) {
      /* `-d` d'abord : le filet de git, qui refuse une branche dont le
         travail n'est ni dans HEAD ni chez son amont. Onze dépôts sont
         posés sur « dev » alors qu'ils intègrent dans « main » : là, `-d`
         refuserait à tort, et `brancheSupprimable` a DÉJÀ prouvé que le
         travail existe ailleurs (fusionné, ou sur origin au même sha). On
         insiste alors, et seulement alors. */
      let avant = await git(racine, ['branch', '-d', branche.nom]);
      if (!avant.includes('Deleted branch') && !avant.includes('supprimée')) {
        avant = await git(racine, ['branch', '-D', branche.nom]);
      }
      if (!avant.includes('Deleted branch') && !avant.includes('supprimée')) {
        gardees.push(branche.nom);
        continue;
      }
    }
    supprimees.push(branche.nom);
  }
  if (!simulation && supprimees.length > 0) {
    await git(racine, ['worktree', 'prune']);
    /* COMPACTER, SINON RIEN N'EST RENDU. Supprimer une branche ne libère pas
       un octet : ses objets restent dans le dépôt jusqu'au ramassage. Mesuré
       le 22.09.2026 : le dépôt de projetc portait 515 Mo pour 155 branches. */
    await git(racine, ['gc', '--prune=now', '--quiet'], 10 * 60_000);
  }
  return { supprimees, gardees };
}

/* ------------------------------------------------------------------ */
/* Le passage                                                          */
/* ------------------------------------------------------------------ */

/**
 * UN PASSAGE DE MÉNAGE. Le tout premier se fait À BLANC : il écrit ce qu'il
 * AURAIT retiré, et rien de plus. Les suivants effacent.
 */
export async function passageDeMenage(options: { simulation?: boolean; maintenant?: number } = {}): Promise<BilanDeMenage> {
  const premierFait = getMeta(CLE_PREMIER_PASSAGE) === 'fait';
  const simulation = options.simulation ?? !premierFait;
  const maintenant = options.maintenant ?? Date.now();
  const proteges = dossiersOccupes();

  const lignes: BilanDeMenage['lignes'] = [];
  let octetsLiberes = 0;
  for (const cible of ciblesDeMenage(CONFIG.depotDuDemon, dossierPersonnel())) {
    const bilan = await nettoyerUneCible(cible, simulation, maintenant, proteges);
    if (bilan.entrees === 0) continue;
    lignes.push({ cible: cible.nom, entrees: bilan.entrees, octets: bilan.octets });
    octetsLiberes += bilan.octets;
  }

  /* CHAQUE DÉPÔT DE LA MACHINE, AVEC SA PROPRE BRANCHE PRINCIPALE. Le nom du
     dépôt est collé devant chaque branche : sans lui, « tache/… » retirée
     quatre fois dans le journal ne dit pas de quel projet il s'agit. */
  const supprimees: string[] = [];
  const gardees: string[] = [];
  for (const racine of depotsAElaguer()) {
    const integrations = await branchesDIntegrationDe(racine);
    if (integrations.length === 0) {
      log.warn(`ménage : « ${racine} » n’a aucune branche d’intégration reconnue — branches laissées en place`);
      continue;
    }
    const bilanDuDepot = await purgerLesBranches(racine, integrations, simulation);
    const nom = path.basename(racine);
    supprimees.push(...bilanDuDepot.supprimees.map((branche) => `${nom} · ${branche}`));
    gardees.push(...bilanDuDepot.gardees.map((branche) => `${nom} · ${branche}`));
  }

  const bilan: BilanDeMenage = {
    simulation,
    lignes,
    branchesSupprimees: supprimees,
    branchesGardees: gardees,
    octetsLiberes,
  };
  for (const ligne of bilan.lignes) {
    log.info(`ménage${simulation ? ' (à blanc)' : ''} : ${ligne.cible} — ${ligne.entrees} élément(s), ${tailleLisible(ligne.octets)}`);
  }
  log.info(`ménage${simulation ? ' (à blanc)' : ''} : ${phraseDeMenage(bilan)}`);
  if (simulation) setMeta(CLE_PREMIER_PASSAGE, 'fait');
  return bilan;
}

/** Le passage de nuit : une fois par nuit, dans la même fenêtre que les autres travaux lourds. */
export async function passageDeNuitDuMenage(maintenant = new Date()): Promise<boolean> {
  const dernier = Number(getMeta(CLE_DERNIER_PASSAGE) ?? 0) || undefined;
  if (!doitPasserLaNuit(maintenant, dernier)) return false;
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant.getTime()));
  await passageDeMenage({ maintenant: maintenant.getTime() });
  return true;
}

export function planifierLeMenage(): NodeJS.Timeout {
  const veille = setInterval(() => {
    passageDeNuitDuMenage().catch((err) => log.warn(`ménage : passage sauté — ${(err as Error).message}`));
  }, VEILLE_MS);
  return veille;
}
