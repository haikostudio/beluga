import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DepotDuCompte,
  DepotVise,
  REFUS_ACCES_GITHUB,
  REFUS_DEPOT_INTROUVABLE,
  REFUS_DEPOT_VIDE,
  REFUS_PAS_DE_COMPTE,
  adresseDeClone,
  dossierPourDepot,
  refusAvantMontage,
  refusDossierOccupe,
} from '@haikodev/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { EtapeCreation, etapeAdressePublique, registerProject } from './projects.js';
import * as store from './store.js';
import { jetonGithub } from './github.js';

const execFileAsync = promisify(execFile);

/**
 * AJOUTER UN PROJET DEPUIS GITHUB.
 *
 * Deux chemins, un seul montage. Le premier part du compte GitHub DÉJÀ connecté
 * au serveur : on liste ses dépôts et on en choisit un. Le second part d'un LIEN
 * collé, pour un dépôt qui n'appartient pas à ce compte. Dans les deux cas, le
 * dépôt est récupéré sur le serveur, l'ADRESSE PUBLIQUE demandée AVANT le
 * montage est créée, puis le projet est inscrit dans la colonne de gauche —
 * exactement les mêmes étapes, dites de la même façon, que pour un projet neuf.
 *
 * Rien n'est publié ni mis en ligne au passage : ajouter un projet n'est pas le
 * déployer.
 */

async function gh(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const { stdout } = await execFileAsync('gh', args, { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: stdout, err: '' };
  } catch (err: any) {
    return { ok: false, out: '', err: (err?.stderr ?? err?.message ?? '').toString() };
  }
}

/* ------------------------------------------------------------------ */
/* Les dépôts du compte connecté                                       */
/* ------------------------------------------------------------------ */

export interface ListeDeDepots {
  depots: DepotDuCompte[];
  /** Le compte GitHub du serveur, pour le dire à l'écran. */
  compte?: string;
  /** Ce qui empêche de lister, en français simple. */
  erreur?: string;
}

/**
 * Les dépôts du compte GitHub du serveur. Lecture seule : rien n'est créé, rien
 * n'est cloné. Sans compte identifié, on le DIT — l'autre chemin (le lien collé)
 * reste alors le seul ouvert.
 */
export async function depotsDuCompte(limite = 200): Promise<ListeDeDepots> {
  if (!(await jetonGithub())) return { depots: [], erreur: REFUS_PAS_DE_COMPTE };

  const qui = await gh(['api', 'user', '--jq', '.login']);
  const compte = qui.ok ? qui.out.trim() || undefined : undefined;

  const resultat = await gh([
    'repo',
    'list',
    '--limit',
    String(limite),
    '--json',
    'nameWithOwner,name,owner,description,isPrivate,isEmpty,updatedAt',
  ]);
  if (!resultat.ok) {
    return { depots: [], compte, erreur: messageGithub(resultat.err) };
  }

  let brut: any[] = [];
  try {
    brut = JSON.parse(resultat.out || '[]');
  } catch {
    return { depots: [], compte, erreur: "la réponse de GitHub n'a pas pu être lue" };
  }

  const depots: DepotDuCompte[] = brut.map((entree) => ({
    slug: String(entree.nameWithOwner ?? ''),
    nom: String(entree.name ?? ''),
    proprietaire: String(entree.owner?.login ?? entree.nameWithOwner?.split('/')[0] ?? ''),
    description: entree.description ? String(entree.description) : undefined,
    prive: entree.isPrivate === true,
    vide: entree.isEmpty === true,
    majLe: entree.updatedAt ? String(entree.updatedAt) : undefined,
  }));

  // Le plus récemment remué d'abord : c'est celui qu'on cherche neuf fois sur dix.
  depots.sort((a, b) => (b.majLe ?? '').localeCompare(a.majLe ?? ''));
  return { depots, compte };
}

/* ------------------------------------------------------------------ */
/* Monter un projet à partir d'un dépôt                                */
/* ------------------------------------------------------------------ */

/** Ce que GitHub sait dire d'un dépôt avant qu'on le récupère. */
interface FicheDepot {
  ok: boolean;
  vide?: boolean;
  description?: string;
  erreur?: string;
}

async function ficheDuDepot(depot: DepotVise): Promise<FicheDepot> {
  const resultat = await gh(['repo', 'view', depot.slug, '--json', 'isEmpty,description,defaultBranchRef']);
  if (!resultat.ok) return { ok: false, erreur: messageGithub(resultat.err) };
  try {
    const lu = JSON.parse(resultat.out || '{}');
    return {
      ok: true,
      // Un dépôt sans branche par défaut est un dépôt vide, même quand GitHub
      // ne le dit pas : il n'y a rien à récupérer.
      vide: lu.isEmpty === true || !lu.defaultBranchRef,
      description: lu.description ? String(lu.description) : undefined,
    };
  } catch {
    return { ok: false, erreur: "la réponse de GitHub n'a pas pu être lue" };
  }
}

/** Traduit ce que `gh` renvoie en une phrase que l'utilisateur peut comprendre. */
function messageGithub(sortie: string): string {
  const texte = (sortie ?? '').toString();
  if (/could not resolve to a Repository|not found|404/i.test(texte)) return REFUS_DEPOT_INTROUVABLE;
  if (/403|permission|forbidden|access denied|saml/i.test(texte)) return REFUS_ACCES_GITHUB;
  if (/gh auth login|authentication|not logged/i.test(texte)) return REFUS_PAS_DE_COMPTE;
  if (/command not found|ENOENT/i.test(texte)) return "L'outil GitHub n'est pas installé sur ce serveur.";
  const court = texte.trim().split('\n').slice(-2).join(' ').slice(0, 220);
  return court || "GitHub n'a rien répondu.";
}

export interface MontageDepuisGithub {
  depot: DepotVise;
  /** Le nom voulu dans la colonne de gauche. Vide : le nom du dépôt. */
  nom?: string;
  /** Le nom du dossier sur le serveur. Vide : déduit du nom du dépôt. */
  dossier?: string;
  /** Le nom court de l'adresse publique. Vide : le projet naît sans adresse. */
  sousDomaine?: string;
  /** Le port sur lequel le projet écoute sur le serveur. */
  port?: number;
}

/**
 * Récupère le dépôt sur le serveur et inscrit le projet.
 *
 * TOUT REFUS SE DIT ET ARRÊTE AVANT DE TOUCHER AU DISQUE : dépôt introuvable,
 * accès refusé, dépôt vide, projet déjà inscrit, dossier occupé. Une fois le
 * clone fait, en revanche, une étape qui rate n'annule rien — le projet existe,
 * il lui manque seulement son adresse, et le déroulé le dit.
 */
export async function monterDepuisGithub(
  input: MontageDepuisGithub,
): Promise<{ project: ReturnType<typeof registerProject>; etapes: EtapeCreation[] }> {
  const { depot } = input;

  const dejaLa = refusAvantMontage(depot, store.listProjects(true));
  if (dejaLa) throw new Error(dejaLa);

  const fiche = await ficheDuDepot(depot);
  if (!fiche.ok) throw new Error(fiche.erreur ?? REFUS_DEPOT_INTROUVABLE);
  if (fiche.vide) throw new Error(REFUS_DEPOT_VIDE);

  const nom = input.nom?.trim() || depot.depot;
  const slug = dossierPourDepot(input.dossier?.trim() || depot.depot);
  const cible = path.resolve(CONFIG.projectsRoot, slug);
  if (!cible.startsWith(path.resolve(CONFIG.projectsRoot) + path.sep)) throw new Error('emplacement refusé');
  if (fs.existsSync(cible)) throw new Error(refusDossierOccupe(slug));

  const etapes: EtapeCreation[] = [];
  const noter = (titre: string, fait: boolean, detail?: string) => etapes.push({ titre, fait, detail });

  // Le dossier des projets appartient à l'administrateur : même convention que
  // pour un projet neuf, on crée avec élévation puis on se donne le dossier.
  const parent = path.dirname(cible);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    const user = process.env.USER?.trim() || os.userInfo().username;
    await execFileAsync('sudo', ['-n', 'mkdir', '-p', parent], { timeout: 20000 });
    await execFileAsync('sudo', ['-n', 'chown', '-R', `${user}:${user}`, parent], { timeout: 20000 });
  }

  /*
   * On clone avec le jeton du serveur DANS L'ENVIRONNEMENT, jamais dans
   * l'adresse : une adresse porteuse de jeton finirait écrite en clair dans le
   * fichier de configuration du dépôt.
   */
  const jeton = await jetonGithub();
  try {
    await execFileAsync('git', ['clone', adresseDeClone(depot), cible], {
      timeout: 600000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...(jeton ? { GH_TOKEN: jeton, GITHUB_TOKEN: jeton } : {}),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'credential.helper',
        GIT_CONFIG_VALUE_0: '!gh auth git-credential',
      },
    });
  } catch (err: any) {
    const detail = (err?.stderr ?? err?.message ?? '').toString();
    throw new Error(messageGithub(detail));
  }
  noter('Dépôt récupéré sur le serveur', true, `${depot.slug} → ${cible}`);

  /*
   * L'adresse publique, AVANT l'inscription : c'est elle que le projet garde et
   * que chaque déploiement contrôlera à la fin. Un échec n'arrête rien.
   */
  const adresse = await etapeAdressePublique({ sousDomaine: input.sousDomaine, port: input.port });
  if (adresse.etape) etapes.push(adresse.etape);

  log.info(`projet ajouté depuis GitHub : ${depot.slug} → ${cible}`);
  const project = registerProject({
    name: nom,
    path: cible,
    gitRemote: depot.url,
    devUrl: adresse.url,
    rank: 5,
  });
  noter('Projet inscrit dans la colonne de gauche', true);
  return { project, etapes };
}
