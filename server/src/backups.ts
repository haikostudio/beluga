import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  DELAI_ETAPE_MS,
  DOSSIER_BACKUPS_PAR_DEFAUT,
  EssaiDAcces,
  InventaireDArchive,
  PointDeSauvegarde,
  RecetteDeBackup,
  siteARelire,
  SiteASauvegarder,
  StatutDePoint,
  commandeMenaceLeDemon,
  dossierDeSite,
  etapesARemettre,
  horodatageDePoint,
  inventaireDesEntrees,
  jugerRecette,
  jugerSite,
  lireManifeste,
  manifesteDArchive,
  nettoyerSite,
  nomDArchive,
  normaliserCadence,
  pointsAPurger,
  raisonDestinationRefusee,
  recetteEffective,
  refusDeSupprimerLAgent,
  refusDuGarde,
  siteEstDu,
  siteVierge,
  variablesDeLaFiche,
  verdictDeLArchive,
  sansRegroupements,
} from '@beluga/shared';
import { getDb } from './db.js';
import { CONFIG, ROOT } from './config.js';
import { ecrireArchive, extraireArchive, lireArchive } from './archive-zip.js';
import { deleteAgent, getAgent, getSettings, listProjects } from './store.js';
import { fermerLesQuestionsDeLAgent } from './fermeture-questions.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * LES BACKUPS DES SITES EN PRODUCTION — le travail réel.
 *
 * Les règles qui se décident sans base ni disque vivent dans
 * `shared/src/backups.ts` et `shared/src/backups-recette.ts`. Ici : le
 * rangement en base, la prise d'un point (la RECETTE du site rejouée vers une
 * archive zip, jugée sur son inventaire), sa restauration, le passage
 * automatique et le ménage.
 *
 * LA DESTINATION NE SE DEVINE PAS. Le disque de stockage est monté sur la
 * machine ; son dossier se règle dans « Système ». Tant qu'il n'est pas
 * renseigné, rien ne part et la raison est DITE — mieux qu'un échec par site,
 * chaque nuit, sans que personne ne sache pourquoi.
 *
 * AUCUN MOT DE PASSE NE PASSE PAR LA LIGNE DE COMMANDE : les commandes d'une
 * recette reçoivent les accès de la fiche par leur environnement
 * (`variablesDeLaFiche`), `mysqldump` par `MYSQL_PWD`, `pg_dump` par
 * `PGPASSWORD`. La liste des processus de la machine ne les montre donc jamais.
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
  recette?: string | null;
  recette_validee_le?: number | null;
  recette_agent_id?: string | null;
}

/** Une colonne JSON relue : `null` quand elle est vide, abîmée ou ne tient pas debout. */
function recetteDepuisColonne(texte: string | null | undefined): RecetteDeBackup | null {
  if (!texte) return null;
  try {
    const lue = JSON.parse(texte) as RecetteDeBackup;
    return jugerRecette(lue).ok ? lue : null;
  } catch {
    return null;
  }
}

function inventaireDepuisColonne(texte: string | null | undefined): InventaireDArchive | null {
  if (!texte) return null;
  try {
    const lu = JSON.parse(texte);
    return lu && Array.isArray(lu.etapes) ? (lu as InventaireDArchive) : null;
  } catch {
    return null;
  }
}

/**
 * LE BLOC JSON D'UNE FICHE : tout, SAUF ce qui a sa colonne à soi. La recette
 * vit dans la sienne ; la recopier dans le bloc ferait deux vérités, et la
 * seconde vieillirait sans que rien ne la relise.
 */
function blocDuSite(site: SiteASauvegarder): string {
  const bloc: Partial<SiteASauvegarder> = { ...site };
  delete bloc.recette;
  delete bloc.recetteValideeLe;
  delete bloc.recetteAgentId;
  return JSON.stringify(bloc);
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
  return normaliserCadence({
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
    // La cadence est reprise du BLOC, jamais du modèle vierge : sans cela, une
    // fiche d'avant (qui ne porte que des jours) se verrait imposer la valeur
    // par défaut au lieu de sa vraie cadence.
    frequenceMinutes: Number(bloc.frequenceMinutes ?? 0),
    recette: recetteDepuisColonne(ligne.recette),
    recetteValideeLe: ligne.recette_validee_le ?? 0,
    recetteAgentId: ligne.recette_agent_id ?? '',
  });
}

export function listerSites(): SiteASauvegarder[] {
  const lignes = getDb()
    .prepare('SELECT * FROM backup_sites ORDER BY nom COLLATE NOCASE ASC')
    .all() as LigneSite[];
  return lignes.map(siteDepuisLigne);
}

export function lireSite(id: string): SiteASauvegarder | null {
  const ligne = getDb().prepare('SELECT * FROM backup_sites WHERE id = ?').get(id) as LigneSite | undefined;
  return ligne ? siteDepuisLigne(ligne) : null;
}

export function enregistrerSite(
  brut: SiteASauvegarder,
): { ok: true; site: SiteASauvegarder } | { ok: false; raison: string } {
  /*
   * LA RECETTE N'EST RÉÉCRITE QUE SI ON LA DONNE. Le formulaire renvoie la
   * fiche telle qu'il l'a lue (recette comprise), l'outil de l'agent la pose ;
   * un appel qui ne la porte pas du tout garde celle qui est en base — corriger
   * un mot de passe n'efface pas l'analyse du site.
   */
  const ancien = brut.id ? lireSite(brut.id) : null;
  const recetteDonnee = brut.recette !== undefined;
  const recette = recetteDonnee ? (brut.recette ?? null) : (ancien?.recette ?? null);
  if (recette) {
    const avis = jugerRecette(recette);
    if (!avis.ok) return { ok: false, raison: `recette refusée : ${avis.raison}` };
  }

  const propre = nettoyerSite({ ...siteVierge(), ...brut, recette });
  const jugement = jugerSite(propre);
  if (!jugement.ok) return { ok: false, raison: jugement.raison ?? 'fiche refusée' };

  const maintenant = Date.now();
  const id = propre.id || crypto.randomUUID();
  const site: SiteASauvegarder = {
    ...propre,
    id,
    recetteValideeLe: recetteDonnee ? Number(brut.recetteValideeLe ?? 0) : (ancien?.recetteValideeLe ?? 0),
    recetteAgentId: recetteDonnee ? String(brut.recetteAgentId ?? '') : (ancien?.recetteAgentId ?? ''),
    creeLe: ancien?.creeLe || maintenant,
    modifieLe: maintenant,
  };

  getDb()
    .prepare(
      `INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le, recette, recette_validee_le, recette_agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         nom = excluded.nom,
         actif = excluded.actif,
         data = excluded.data,
         modifie_le = excluded.modifie_le,
         recette = excluded.recette,
         recette_validee_le = excluded.recette_validee_le,
         recette_agent_id = excluded.recette_agent_id`,
    )
    .run(
      site.id,
      site.projectId,
      site.nom,
      site.actif ? 1 : 0,
      blocDuSite(site),
      site.creeLe,
      site.modifieLe,
      site.recette ? JSON.stringify(site.recette) : null,
      site.recetteValideeLe || null,
      site.recetteAgentId || null,
    );
  return { ok: true, site };
}

export function supprimerSite(id: string): { ok: boolean; raison?: string } {
  const site = lireSite(id);
  if (!site) return { ok: false, raison: 'site introuvable' };

  /*
   * LA FICHE PART AVEC SES CONVERSATIONS. Une fiche traîne derrière elle
   * l'assistant qui l'a configurée et celui qui l'a relue après trois échecs :
   * des agents SANS carte, dont les questions ouvertes ne sont donc rattrapées
   * par aucun filet de carte. Retirer la seule fiche laissait ces questions
   * allumer un chiffre sur la cloche et un triangle sur un projet, pour une
   * fiche qui n'existait plus — l'alerte à vie.
   *
   * On ferme d'abord (le tour suspendu sur `ask_user` repart), on supprime
   * ensuite. Un incident sur une conversation ne doit jamais empêcher le
   * retrait demandé : il se dit dans le journal, et la fiche part quand même.
   *
   * `assistantId` porte TOUJOURS la dernière conversation en date, celle de la
   * configuration comme celle de la relecture (`marquerRelecture` l'écrase) :
   * c'est donc le seul fil à retirer.
   *
   * MAIS CE FIL N'EST PAS TOUJOURS UN ASSISTANT JETABLE. `assistantId` est
   * simplement l'agent QUI A APPELÉ L'OUTIL (`tools.ts`) : quand une carte
   * demande à son agent de tâche de corriger une fiche, cet agent devient le
   * fil de la fiche. Le 09.09.2026, un tel agent a retiré une fiche en double —
   * le travail même qu'on lui avait demandé — et s'est effacé lui-même, en
   * plein tour, avec tous ses messages : plus rien ne pouvait alors refermer ce
   * tour, et l'écran a affiché « Réflexion en cours » pendant 47 minutes sous
   * un compte rendu déjà rendu. La règle vit dans `shared`
   * (`refusDeSupprimerLAgent`), et le REFUS NE RETIENT JAMAIS LE RETRAIT DE LA
   * FICHE : seul le fil reste en place.
   */
  if (site.assistantId) {
    const agentId = site.assistantId;
    try {
      const agent = getAgent(agentId);
      const refus = agent ? refusDeSupprimerLAgent(agent) : null;
      if (refus) {
        log.warn(`fiche de sauvegarde ${id} : conversation ${agentId} GARDÉE — ${refus.raison}`);
      } else {
        fermerLesQuestionsDeLAgent(agentId);
        deleteAgent(agentId);
        /*
         * ET LA SUPPRESSION SE DIT À L'ÉCRAN. Sans cet événement, le client
         * gardait dans son magasin un agent qui n'existe plus : son statut et
         * sa marque de tour vivant continuaient d'allumer le témoin et le
         * chronomètre, sans qu'aucun `agent.upsert` ne puisse jamais venir les
         * éteindre. Seul un rechargement de page effaçait le fantôme.
         */
        bus.emit({ type: 'agent.delete', id: agentId });
      }
    } catch (err) {
      log.warn(`fiche de sauvegarde ${id} : conversation ${agentId} non retirée`, err);
    }
  }

  // Les points sont retirés NOMMÉMENT : `ON DELETE CASCADE` ne mord que si
  // `PRAGMA foreign_keys` est actif dans la connexion qui écrit. Les fichiers
  // déjà posés sur le disque de stockage, eux, RESTENT — effacer des
  // sauvegardes est un geste qu'on ne fait pas dans le dos de celui qui retire
  // une fiche.
  getDb().prepare('DELETE FROM backup_points WHERE site_id = ?').run(id);
  getDb().prepare('DELETE FROM backup_sites WHERE id = ?').run(id);
  return { ok: true };
}

interface LignePoint {
  id: string;
  site_id: string;
  debut: number;
  statut: string;
  data: string;
  chemin_archive?: string | null;
  taille?: number | null;
  inventaire?: string | null;
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
    cheminArchive: ligne.chemin_archive ?? '',
    taille: ligne.taille ?? 0,
    inventaire: inventaireDepuisColonne(ligne.inventaire),
  };
}

export function listerPoints(siteId?: string): PointDeSauvegarde[] {
  const db = getDb();
  const lignes = (
    siteId
      ? db.prepare('SELECT * FROM backup_points WHERE site_id = ? ORDER BY debut DESC').all(siteId)
      : db.prepare('SELECT * FROM backup_points ORDER BY debut DESC').all()
  ) as LignePoint[];
  return lignes.map(pointDepuisLigne);
}

export function lirePoint(id: string): PointDeSauvegarde | null {
  const ligne = getDb().prepare('SELECT * FROM backup_points WHERE id = ?').get(id) as LignePoint | undefined;
  return ligne ? pointDepuisLigne(ligne) : null;
}

/** Un point enregistré : l'archive, son poids et son inventaire ont leurs colonnes, le reste va au bloc. */
function enregistrerPoint(point: PointDeSauvegarde): PointDeSauvegarde {
  const bloc: Partial<PointDeSauvegarde> = { ...point };
  delete bloc.cheminArchive;
  delete bloc.taille;
  delete bloc.inventaire;
  getDb()
    .prepare(
      `INSERT INTO backup_points (id, site_id, debut, statut, data, chemin_archive, taille, inventaire)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      point.id,
      point.siteId,
      point.debut,
      point.statut,
      JSON.stringify(bloc),
      point.cheminArchive || null,
      point.taille ?? 0,
      point.inventaire ? JSON.stringify(point.inventaire) : null,
    );
  return point;
}

function oublierPoint(id: string): void {
  getDb().prepare('DELETE FROM backup_points WHERE id = ?').run(id);
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
export function projetsSansFiche(): { id: string; nom: string; chemin: string }[] {
  const dejaLa = new Set(listerSites().map((site) => site.projectId).filter(Boolean));
  return sansRegroupements(listProjects())
    .filter((projet) => !dejaLa.has(projet.id))
    .map((projet) => ({ id: projet.id, nom: projet.name, chemin: projet.path ?? '' }));
}

/* ------------------------------------------------------------------ */
/* Rejouer une recette                                                  */
/* ------------------------------------------------------------------ */

/** Les sites dont un backup tourne EN CE MOMENT : on ne le double jamais. */
const enCours = new Set<string>();

export function backupsEnCours(): string[] {
  return [...enCours];
}

/**
 * LE DOSSIER DE TRAVAIL, SUR LE DISQUE LOCAL. Les étapes y posent leur part
 * avant la mise en archive : écrire des milliers de petits fichiers sur le
 * disque de stockage (monté par le réseau) puis les y relire pour les zipper
 * ferait deux allers-retours pour rien. Seule l'archive voyage.
 */
function dossierDeTravail(nom: string): string {
  return path.join(CONFIG.dataDir, 'backups-travail', `${nom}-${crypto.randomUUID().slice(0, 8)}`);
}

/**
 * UNE COMMANDE DE RECETTE. Elle tourne dans `bash`, arrêtée à la première
 * erreur (`set -eo pipefail`), avec les accès de la fiche dans son
 * environnement — jamais dans sa ligne de commande. Son groupe de processus
 * entier est tué au délai : une commande qui ne rend pas la main est une
 * panne, pas un travail lent. La garde du démon passe AVANT le départ : une
 * recette ne peut pas plus couper Beluga Build qu'un agent.
 */
export function lancerCommandeDeRecette(
  commande: string,
  variables: Record<string, string>,
  dossier: string,
  delaiMs = DELAI_ETAPE_MS,
): Promise<void> {
  const garde = commandeMenaceLeDemon(commande, { pidDuDemon: process.pid, racineDuDemon: ROOT });
  if (garde.refusee) return Promise.reject(new Error(refusDuGarde(garde)));

  return new Promise((resolve, reject) => {
    const processus = spawn('bash', ['-c', `set -eo pipefail\n${commande}`], {
      cwd: dossier,
      env: { ...process.env, ...variables },
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    const plaintes: Buffer[] = [];
    let poids = 0;
    processus.stderr?.on('data', (bloc: Buffer) => {
      plaintes.push(bloc);
      poids += bloc.length;
      while (poids > 16 * 1024 && plaintes.length > 1) poids -= plaintes.shift()!.length;
    });
    let rendu = false;
    const rendre = (err?: Error) => {
      if (rendu) return;
      rendu = true;
      clearTimeout(minuteur);
      err ? reject(err) : resolve();
    };
    const minuteur = setTimeout(() => {
      try {
        if (processus.pid) process.kill(-processus.pid, 'SIGKILL');
      } catch {
        /* déjà parti */
      }
      rendre(new Error(`la commande n’a pas rendu la main en ${Math.round(delaiMs / 60000)} min`));
    }, delaiMs);
    processus.on('error', (err: any) =>
      rendre(new Error(err?.code === 'ENOENT' ? 'bash n’est pas installé sur cette machine' : String(err?.message ?? err))),
    );
    processus.on('close', (code) => {
      if (code === 0) return rendre();
      const texte = Buffer.concat(plaintes).toString().trim().split('\n').slice(-3).join(' ');
      rendre(new Error((texte || `la commande a rendu ${code}`).slice(0, 400)));
    });
  });
}

/** Ce qu'un passage de recette a donné. */
export interface IssueDeRecette {
  statut: StatutDePoint;
  detail: string;
  inventaire: InventaireDArchive | null;
  /** Le poids de l'archive gardée — 0 quand rien n'est gardé. */
  taille: number;
  /** Le chemin de l'archive gardée — vide sur un échec. */
  archive: string;
  dureeMs: number;
}

/**
 * REJOUER UNE RECETTE. Chaque étape pose sa part dans SON dossier (une étape
 * qui tombe n'emporte pas les autres), tout part dans UNE archive avec le
 * manifeste, puis l'archive est RELUE : c'est son inventaire qui décide du
 * statut, jamais le code de retour des commandes. Le dossier de travail
 * disparaît dans tous les cas, et l'archive d'un échec aussi — il n'y a rien à
 * restaurer d'un échec.
 */
export async function rejouerLaRecette(
  site: SiteASauvegarder,
  recette: RecetteDeBackup,
  archive: string,
): Promise<IssueDeRecette> {
  const debut = Date.now();
  const travail = dossierDeTravail(path.basename(archive, '.zip'));
  const erreurs: Record<string, string> = {};
  const variables = variablesDeLaFiche(site);
  const echec = (detail: string): IssueDeRecette => ({
    statut: 'echec',
    detail,
    inventaire: null,
    taille: 0,
    archive: '',
    dureeMs: Date.now() - debut,
  });

  try {
    for (const etape of recette.etapes) {
      const sortie = path.join(travail, etape.id);
      await fs.promises.mkdir(sortie, { recursive: true });
      try {
        await lancerCommandeDeRecette(etape.prendre, { ...variables, SORTIE: sortie }, sortie);
      } catch (err: any) {
        erreurs[etape.id] = err?.message ?? String(err);
      }
    }

    let taille = 0;
    try {
      taille = await ecrireArchive(travail, archive, manifesteDArchive(site, recette, debut));
    } catch (err: any) {
      return echec(`archive non écrite : ${err?.message ?? err}`);
    }

    const lue = await lireArchive(archive);
    const inventaire = lue ? inventaireDesEntrees(lue.entrees, recette, erreurs) : null;
    const verdict = verdictDeLArchive(inventaire);
    if (verdict.statut === 'echec') {
      await fs.promises.rm(archive, { force: true });
      return { ...echec(verdict.detail), inventaire };
    }
    return { statut: verdict.statut, detail: verdict.detail, inventaire, taille, archive, dureeMs: Date.now() - debut };
  } finally {
    await fs.promises.rm(travail, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * ESSAYER UNE RECETTE POUR DE VRAI, SANS RIEN GARDER. L'agent d'analyse ne
 * rend une recette qu'après l'avoir vue produire une archive : chaque étape
 * est jouée, l'archive écrite puis relue et jugée, et elle disparaît aussitôt.
 * Aucun point n'est enregistré, rien n'est posé sur le disque de stockage.
 */
export async function essayerLaRecette(site: SiteASauvegarder, recette: RecetteDeBackup): Promise<IssueDeRecette> {
  const archive = path.join(
    CONFIG.dataDir,
    'backups-travail',
    'essais',
    nomDArchive(`${dossierDeSite({ ...site, id: site.id || 'essai' })}-${horodatageDePoint(Date.now())}`),
  );
  try {
    return await rejouerLaRecette(site, recette, archive);
  } finally {
    await fs.promises.rm(archive, { force: true }).catch(() => undefined);
  }
}

/** Le poids pris par genre, pour les colonnes d'avant qui séparaient base et fichiers. */
function poidsParGenre(inventaire: InventaireDArchive | null): { octetsBase: number; octetsFichiers: number } {
  let octetsBase = 0;
  let octetsFichiers = 0;
  for (const etape of inventaire?.etapes ?? []) {
    if (etape.genre === 'base') octetsBase += etape.octets;
    else octetsFichiers += etape.octets;
  }
  return { octetsBase, octetsFichiers };
}

/** Rejoue la recette d'un site vers le disque de stockage et enregistre le point, quelle que soit l'issue. */
async function prendreEtEnregistrer(
  site: SiteASauvegarder,
  destination: string,
  origine: 'automatique' | 'manuel',
  prefixe = '',
): Promise<PointDeSauvegarde> {
  const debut = Date.now();
  const recette = recetteEffective(site);
  const dossier = path.join(destination, dossierDeSite(site));
  // Deux prises dans la même seconde ne s'écrasent jamais : la seconde prend un rang.
  let rang = 1;
  let archive = path.join(dossier, nomDArchive(horodatageDePoint(debut)));
  while (fs.existsSync(archive) || fs.existsSync(`${archive}.partiel`)) {
    rang += 1;
    archive = path.join(dossier, nomDArchive(horodatageDePoint(debut), rang));
  }
  const issue = await rejouerLaRecette(site, recette, archive);
  return enregistrerPoint({
    id: crypto.randomUUID(),
    siteId: site.id,
    debut,
    fin: Date.now(),
    statut: issue.statut,
    ...poidsParGenre(issue.inventaire),
    chemin: '',
    detail: `${prefixe}${issue.detail}`,
    origine,
    cheminArchive: issue.archive,
    taille: issue.taille,
    inventaire: issue.inventaire,
  });
}

/**
 * PRENDRE UN POINT : rejouer la recette du site (celle de l'agent, sinon celle
 * déduite de la fiche) vers une archive du disque de stockage. Le point est
 * enregistré dans TOUS les cas, y compris l'échec : une sauvegarde qui n'a pas
 * eu lieu doit se voir dans l'historique, pas disparaître.
 */
export async function prendreUnBackup(
  siteId: string,
  origine: 'automatique' | 'manuel' = 'manuel',
): Promise<{ ok: boolean; point?: PointDeSauvegarde; raison?: string }> {
  const site = lireSite(siteId);
  if (!site) return { ok: false, raison: 'site introuvable' };

  const destination = dossierDeStockage();
  const refus = raisonDestinationRefusee(destination);
  if (refus) return { ok: false, raison: refus };

  const jugement = jugerRecette(recetteEffective(site));
  if (!jugement.ok) {
    return { ok: false, raison: `« ${site.nom} » n’a pas encore de recette : lancez son analyse (${jugement.raison})` };
  }

  if (enCours.has(siteId)) return { ok: false, raison: `un backup de « ${site.nom} » tourne déjà` };
  enCours.add(siteId);

  const debut = Date.now();
  try {
    const point = await prendreEtEnregistrer(site, destination, origine);
    await menageDuSite(site);

    if (point.statut === 'echec') {
      log.warn(`backup de « ${site.nom} » impossible : ${point.detail}`);
      bus.toast('error', `Backup de « ${site.nom} » impossible : ${point.detail}`, undefined, 'backup');
    } else {
      log.info(`backup de « ${site.nom} » (${point.statut}) : ${point.cheminArchive}`);
      if (origine === 'manuel') {
        bus.toast('success', `Backup de « ${site.nom} » terminé`, undefined, 'backup');
      }
    }
    return { ok: point.statut !== 'echec', point, raison: point.statut === 'echec' ? point.detail : undefined };
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
    log.error(`backup de « ${site.nom} » interrompu`, err);
    return { ok: false, raison };
  } finally {
    enCours.delete(siteId);
  }
}

/* ------------------------------------------------------------------ */
/* Restaurer un point                                                   */
/* ------------------------------------------------------------------ */

/** Les points dont la restauration tourne EN CE MOMENT. */
const enRestauration = new Set<string>();

export function restaurationsEnCours(): string[] {
  return [...enRestauration];
}

/**
 * REMETTRE UNE ARCHIVE. L'archive est relue et extraite (jamais hors de son
 * dossier), puis chaque étape présente rejoue sa commande « remettre » — celle
 * de la recette ENREGISTRÉE DANS L'ARCHIVE : ce qui a pris ces données sait les
 * reposer, même si la fiche a changé depuis. La première étape qui tombe
 * arrête tout, et son nom est dit.
 */
async function remettreLArchive(site: SiteASauvegarder, archive: string, pointId: string): Promise<number> {
  const lue = await lireArchive(archive);
  if (!lue) throw new Error('l’archive de ce point ne s’ouvre plus');
  const manifeste = lireManifeste(lue.manifeste);
  if (!manifeste) throw new Error('l’archive de ce point n’a pas de manifeste lisible');
  const etapes = etapesARemettre(manifeste, inventaireDesEntrees(lue.entrees, manifeste.recette));
  if (!etapes.length) throw new Error('rien à remettre dans cette archive');

  const extrait = dossierDeTravail(`restauration-${pointId.slice(0, 8)}`);
  try {
    await extraireArchive(archive, extrait);
    const variables = variablesDeLaFiche(site);
    for (const etape of etapes) {
      const entree = path.join(extrait, etape.id);
      try {
        await lancerCommandeDeRecette(etape.remettre, { ...variables, ENTREE: entree }, entree);
      } catch (err: any) {
        throw new Error(`${etape.libelle} : ${err?.message ?? err}`);
      }
    }
    return etapes.length;
  } finally {
    await fs.promises.rm(extrait, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * RESTAURER UN POINT, D'UN CLIC (l'écran a déjà demandé confirmation). Le site
 * vivant va être écrasé : UN FILET est pris juste avant, par la même recette,
 * et rangé dans l'historique comme un point à la main — une restauration
 * choisie trop vite se défait en restaurant ce filet. Un filet qui échoue
 * (site déjà cassé, c'est souvent pourquoi on restaure) n'empêche pas la
 * restauration : il se dit. Un site qu'un backup prend ne se restaure pas en
 * même temps, et réciproquement — même verrou que la prise.
 */
export async function restaurerUnBackup(
  pointId: string,
): Promise<{ ok: boolean; raison?: string; filet?: PointDeSauvegarde }> {
  const point = lirePoint(pointId);
  if (!point) return { ok: false, raison: 'point introuvable' };
  if (point.statut === 'echec') return { ok: false, raison: 'ce point n’a rien à restaurer' };
  const archive = point.cheminArchive ?? '';
  if (archive ? !fs.existsSync(archive) : !point.chemin || !fs.existsSync(point.chemin)) {
    return { ok: false, raison: 'ce point n’est plus sur le disque de stockage' };
  }

  const site = lireSite(point.siteId);
  if (!site) return { ok: false, raison: 'site introuvable' };

  if (enCours.has(site.id)) return { ok: false, raison: `un backup de « ${site.nom} » tourne déjà` };
  if (enRestauration.has(pointId)) return { ok: false, raison: 'cette restauration tourne déjà' };

  enCours.add(site.id);
  enRestauration.add(pointId);
  let filet: PointDeSauvegarde | undefined;
  try {
    const destination = dossierDeStockage();
    if (!raisonDestinationRefusee(destination) && jugerRecette(recetteEffective(site)).ok) {
      filet = await prendreEtEnregistrer(site, destination, 'manuel', `filet avant la restauration du ${new Date(point.debut).toLocaleString('fr-FR')} — `);
    }
    if (archive) {
      await remettreLArchive(site, archive, pointId);
    } else {
      await restaurerLaBase(site, point.chemin);
      await restaurerLesFichiers(site, point.chemin);
    }
    log.info(`restauration de « ${site.nom} » (point du ${new Date(point.debut).toISOString()}) terminée`);
    bus.toast(
      filet && filet.statut === 'echec' ? 'warning' : 'success',
      filet && filet.statut === 'echec'
        ? `Restauration de « ${site.nom} » terminée — le filet pris juste avant a échoué : ${filet.detail}`
        : `Restauration de « ${site.nom} » terminée`,
      undefined,
      'backup',
    );
    return { ok: true, filet };
  } catch (err: any) {
    const raison = err?.message ?? String(err);
    log.error(`restauration de « ${site.nom} » interrompue`, err);
    bus.toast('error', `Restauration de « ${site.nom} » impossible : ${raison}`, undefined, 'backup');
    return { ok: false, raison, filet };
  } finally {
    enCours.delete(site.id);
    enRestauration.delete(pointId);
  }
}

/*
 * L'ANCIEN FORMAT : un dossier par point, avec `base.sql.gz` (ou
 * `base.sqlite.gz`) et `fichiers/`. Plus rien ne l'écrit ; ces deux fonctions
 * remettent les points d'avant les archives, et partiront avec eux quand la
 * conservation les aura tous jetés.
 */

/** La base d'un point d'ancien format, reposée à l'endroit que la fiche du site donne. */
async function restaurerLaBase(site: SiteASauvegarder, dossier: string): Promise<void> {
  const base = site.base;
  if (base.moteur === 'aucune') return;

  if (base.moteur === 'sqlite') {
    const source = path.join(dossier, 'base.sqlite.gz');
    if (!fs.existsSync(source)) throw new Error('ce point n’a pas de base sqlite');
    await pipeline(fs.createReadStream(source), zlib.createGunzip(), fs.createWriteStream(base.nom));
    return;
  }

  const source = path.join(dossier, 'base.sql.gz');
  if (!fs.existsSync(source)) throw new Error('ce point n’a pas de base');

  const args =
    base.moteur === 'mysql'
      ? [
          ...(base.hote.trim() ? ['-h', base.hote.trim()] : []),
          ...(base.port.trim() ? ['-P', base.port.trim()] : []),
          '-u',
          base.utilisateur,
          base.nom,
        ]
      : [
          ...(base.hote.trim() ? ['-h', base.hote.trim()] : []),
          ...(base.port.trim() ? ['-p', base.port.trim()] : []),
          '-U',
          base.utilisateur,
          '-v',
          'ON_ERROR_STOP=1',
          base.nom,
        ];
  const programme = base.moteur === 'mysql' ? 'mysql' : 'psql';
  const env = base.moteur === 'mysql' ? { MYSQL_PWD: base.motDePasse } : { PGPASSWORD: base.motDePasse };

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
  await Promise.all([pipeline(fs.createReadStream(source), zlib.createGunzip(), processus.stdin), fini]);
}

/** Les fichiers d'un point d'ancien format, reposés à l'endroit que la fiche du site donne. */
async function restaurerLesFichiers(site: SiteASauvegarder, dossier: string): Promise<void> {
  const fichiers = site.fichiers;
  if (fichiers.moyen === 'aucun') return;

  const source = path.join(dossier, 'fichiers');
  if (!fs.existsSync(source)) throw new Error('ce point n’a pas de fichiers');

  if (fichiers.moyen === 'local') {
    await fs.promises.rm(fichiers.chemin, { recursive: true, force: true });
    await fs.promises.cp(source, fichiers.chemin, { recursive: true });
    return;
  }

  if (fichiers.moyen === 'ssh') {
    const port = fichiers.port.trim() || '22';
    const distant = `${fichiers.utilisateur}@${fichiers.hote}:${fichiers.chemin.replace(/\/*$/, '/')}`;
    await execFileAsync(
      'rsync',
      ['-a', '--delete', '--timeout=600', '-e', `ssh -p ${port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`, `${source}/`, distant],
      { timeout: 3_600_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return;
  }

  // FTP : `lftp` en miroir inversé, le mot de passe par l'entrée standard.
  const port = fichiers.port.trim() || '21';
  const script = [
    `open -u ${fichiers.utilisateur},${fichiers.motDePasse} -p ${port} ${fichiers.hote}`,
    'set ssl:verify-certificate no',
    `mirror --reverse --delete --verbose=0 --parallel=2 ${source} ${fichiers.chemin}`,
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
}

/* ------------------------------------------------------------------ */
/* Essayer les accès, sans rien sauvegarder                             */
/* ------------------------------------------------------------------ */

/**
 * ESSAYER AVANT D'ENREGISTRER. Une fiche acceptée par `jugerSite` est
 * COMPLÈTE ; elle n'est pas pour autant JUSTE : le mot de passe peut être
 * refusé, le dossier avoir été déplacé, la base ne pas porter ce nom. On ne
 * l'apprenait qu'à la première nuit, dans un échec silencieux.
 *
 * L'essai ouvre POUR DE VRAI la base (son schéma, jeté aussitôt) et le dossier
 * des fichiers (une simple liste). Rien n'est écrit sur le disque de stockage,
 * rien n'est enregistré : c'est un coup de sonde, borné dans le temps.
 */
const DELAI_ESSAI_MS = 30_000;

/** Une commande d'essai : sa sortie est JETÉE, seules comptent son issue et sa plainte. */
function essaiDeCommande(
  programme: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  entree?: string,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const processus = spawn(programme, args, {
      env: { ...process.env, ...env },
      stdio: [entree === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
    });
    const plaintes: Buffer[] = [];
    let repondu = false;
    const rendre = (ok: boolean, detail: string) => {
      if (repondu) return;
      repondu = true;
      clearTimeout(minuteur);
      resolve({ ok, detail: detail.slice(0, 300) });
    };
    const minuteur = setTimeout(() => {
      processus.kill('SIGKILL');
      rendre(false, `${programme} n’a pas répondu en ${Math.round(DELAI_ESSAI_MS / 1000)} secondes`);
    }, DELAI_ESSAI_MS);

    processus.stderr?.on('data', (bloc) => plaintes.push(bloc));
    processus.on('error', (err: any) =>
      rendre(false, err?.code === 'ENOENT' ? `${programme} n’est pas installé sur cette machine` : String(err?.message ?? err)),
    );
    processus.on('close', (code) =>
      code === 0
        ? rendre(true, 'accès accepté')
        : rendre(false, Buffer.concat(plaintes).toString().trim() || `${programme} a rendu ${code}`),
    );
    if (entree !== undefined) processus.stdin?.end(entree);
  });
}

async function essayerLaBase(site: SiteASauvegarder): Promise<EssaiDAcces> {
  const base = site.base;
  if (base.moteur === 'aucune') {
    return { cible: 'base', essaye: false, ok: true, detail: 'cette fiche ne prend aucune base' };
  }

  if (base.moteur === 'sqlite') {
    try {
      fs.accessSync(base.nom, fs.constants.R_OK);
      return { cible: 'base', essaye: true, ok: true, detail: `fichier ${base.nom} lisible` };
    } catch (err: any) {
      return { cible: 'base', essaye: true, ok: false, detail: `fichier de base illisible : ${err?.message ?? err}` };
    }
  }

  if (base.moteur === 'mysql') {
    const args = ['--no-data', '--skip-triggers', '--skip-lock-tables'];
    if (base.hote.trim()) args.push('-h', base.hote.trim());
    if (base.port.trim()) args.push('-P', base.port.trim());
    args.push('-u', base.utilisateur, base.nom);
    const issue = await essaiDeCommande('mysqldump', args, { MYSQL_PWD: base.motDePasse });
    return { cible: 'base', essaye: true, ok: issue.ok, detail: issue.ok ? `base « ${base.nom} » ouverte` : issue.detail };
  }

  const args = ['--schema-only', '--no-owner', '--no-privileges'];
  if (base.hote.trim()) args.push('-h', base.hote.trim());
  if (base.port.trim()) args.push('-p', base.port.trim());
  args.push('-U', base.utilisateur, base.nom);
  const issue = await essaiDeCommande('pg_dump', args, { PGPASSWORD: base.motDePasse });
  return { cible: 'base', essaye: true, ok: issue.ok, detail: issue.ok ? `base « ${base.nom} » ouverte` : issue.detail };
}

async function essayerLesFichiers(site: SiteASauvegarder): Promise<EssaiDAcces> {
  const fichiers = site.fichiers;
  if (fichiers.moyen === 'aucun') {
    return { cible: 'fichiers', essaye: false, ok: true, detail: 'cette fiche ne prend aucun fichier' };
  }

  if (fichiers.moyen === 'local') {
    try {
      const etat = fs.statSync(fichiers.chemin);
      if (!etat.isDirectory()) {
        return { cible: 'fichiers', essaye: true, ok: false, detail: `${fichiers.chemin} n’est pas un dossier` };
      }
      fs.accessSync(fichiers.chemin, fs.constants.R_OK);
      return { cible: 'fichiers', essaye: true, ok: true, detail: `dossier ${fichiers.chemin} lisible` };
    } catch (err: any) {
      return { cible: 'fichiers', essaye: true, ok: false, detail: `dossier inaccessible : ${err?.message ?? err}` };
    }
  }

  if (fichiers.moyen === 'ssh') {
    const port = fichiers.port.trim() || '22';
    const issue = await essaiDeCommande('ssh', [
      '-p',
      port,
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=15',
      `${fichiers.utilisateur}@${fichiers.hote}`,
      `test -d ${JSON.stringify(fichiers.chemin)}`,
    ]);
    return {
      cible: 'fichiers',
      essaye: true,
      ok: issue.ok,
      detail: issue.ok
        ? `dossier ${fichiers.chemin} atteint sur ${fichiers.hote}`
        : issue.detail || `dossier ${fichiers.chemin} introuvable sur ${fichiers.hote}`,
    };
  }

  // FTP : `cls` liste le dossier sans rien rapatrier ; le mot de passe passe par
  // l'entrée standard, jamais par la ligne de commande.
  const port = fichiers.port.trim() || '21';
  const script = [
    `open -u ${fichiers.utilisateur},${fichiers.motDePasse} -p ${port} ${fichiers.hote}`,
    'set ssl:verify-certificate no',
    'set net:timeout 20',
    `cls -1 ${fichiers.chemin}`,
    'bye',
  ].join('\n');
  const issue = await essaiDeCommande('lftp', ['-f', '/dev/stdin'], {}, script);
  return {
    cible: 'fichiers',
    essaye: true,
    ok: issue.ok,
    detail: issue.ok ? `dossier ${fichiers.chemin} listé sur ${fichiers.hote}` : issue.detail,
  };
}

/** Les deux essais d'une fiche, menés l'un après l'autre. */
export async function essayerLesAcces(site: SiteASauvegarder): Promise<EssaiDAcces[]> {
  return [await essayerLaBase(site), await essayerLesFichiers(site)];
}

/* ------------------------------------------------------------------ */
/* Le ménage et le passage de nuit                                      */
/* ------------------------------------------------------------------ */

/*
 * Ce qui dépasse la conservation du site quitte la base ET le disque.
 *
 * L'effacement est asynchrone pour la même raison que la copie : un point de
 * sauvegarde porte autant de fichiers que le projet qu'il garde, et le retirer
 * d'un bloc gelait le démon aussi sûrement que de l'écrire.
 */
export async function menageDuSite(site: SiteASauvegarder, maintenant = Date.now()): Promise<number> {
  const aJeter = pointsAPurger(listerPoints(site.id), site.conservationJours, maintenant);
  for (const point of aJeter) {
    // Une archive pour les points d'aujourd'hui, un dossier pour ceux d'avant.
    for (const chemin of [point.cheminArchive, point.chemin].filter(Boolean) as string[]) {
      try {
        await fs.promises.rm(chemin, { recursive: true, force: true });
      } catch (err: any) {
        log.warn(`point de sauvegarde non retiré (${chemin})`, err?.message ?? err);
      }
    }
    oublierPoint(point.id);
  }
  return aJeter.length;
}

/* ------------------------------------------------------------------ */
/* Faire relire une fiche qui échoue nuit après nuit                    */
/* ------------------------------------------------------------------ */

/**
 * LES FICHES QUE L'ASSISTANT DOIT RELIRE. Trois échecs de suite ne sont plus un
 * incident : c'est la fiche qui est fausse. On ne la relit qu'une fois par jour
 * — une relecture par nuit d'échec suffit, et chacune coûte un tour de moteur.
 */
export function sitesARelire(maintenant = Date.now()): SiteASauvegarder[] {
  const parSite = new Map<string, PointDeSauvegarde[]>();
  for (const point of listerPoints()) {
    const liste = parSite.get(point.siteId) ?? [];
    liste.push(point);
    parSite.set(point.siteId, liste);
  }
  return listerSites().filter((site) => siteARelire(site, parSite.get(site.id) ?? [], maintenant));
}

/**
 * LA DATE DE RELECTURE, POSÉE SANS PASSER PAR LE JUGEMENT. Une fiche déjà en
 * base peut être incomplète (c'est justement pour cela qu'elle échoue) :
 * la faire repasser par `enregistrerSite` la ferait refuser. Seul ce champ bouge.
 */
export function marquerRelecture(
  siteId: string,
  conversation?: { agentId: string; projectId: string; cardId?: string },
  at = Date.now(),
): void {
  const site = lireSite(siteId);
  if (!site) return;
  const data = blocDuSite({
    ...site,
    relueLe: at,
    ...(conversation
      ? {
          assistantId: conversation.agentId,
          assistantProjectId: conversation.projectId,
          // La carte de l'agent voyage avec sa conversation : la fenêtre y mène.
          assistantCardId: conversation.cardId ?? '',
        }
      : {}),
  });
  getDb().prepare('UPDATE backup_sites SET data = ? WHERE id = ?').run(data, siteId);
}

/** Les échecs d'un site, du plus récent au plus ancien. */
export function echecsDuSite(siteId: string): PointDeSauvegarde[] {
  return listerPoints(siteId).filter((point) => point.statut === 'echec');
}

/**
 * LE PASSAGE DE NUIT. Les sites dus passent UN PAR UN : deux vidages de base en
 * parallèle se disputeraient le disque et le réseau pour rien.
 */
export async function passageDesBackups(origine: 'automatique' | 'manuel' = 'automatique'): Promise<number> {
  const reglages = getSettings();
  const refus = raisonDestinationRefusee(dossierDeStockage());
  if (refus) {
    log.warn(`backups : ${refus}`);
    return 0;
  }

  const maintenant = Date.now();
  const derniers = derniersPoints();
  const sites = listerSites();
  // UN PASSAGE MANUEL PREND CE QU'ON LUI DEMANDE, SANS RENDEZ-VOUS DE NUIT :
  // l'heure réglée ne s'impose qu'au passage automatique.
  const heureDeNuit = origine === 'automatique' ? (reglages.backupHeure ?? 4) : undefined;
  const dus = sites.filter((site) => siteEstDu(site, derniers.get(site.id) ?? null, maintenant, heureDeNuit));
  for (const site of dus) {
    await prendreUnBackup(site.id, origine);
  }
  if (dus.length) log.info(`backups : ${dus.length} site(s) sauvegardé(s)`);

  // LE MÉNAGE PASSE SUR TOUS LES SITES, PAS SEULEMENT SUR CEUX QUI VIENNENT
  // D'ÊTRE PRIS : une rétention d'un jour doit expirer même si le site est
  // éteint ou que sa prochaine prise est encore loin.
  for (const site of sites) await menageDuSite(site, maintenant);

  // CE QUI ÉCHOUE ENCORE ET ENCORE PART CHEZ L'ASSISTANT. L'import est fait ici
  // et pas en tête de fichier : le module de l'assistant tire tout le moteur,
  // que la sauvegarde n'a aucune raison de charger pour prendre un point.
  for (const site of sitesARelire()) {
    try {
      const { lancerRelectureDeBackup } = await import('./assistant-backup.js');
      await lancerRelectureDeBackup(site.id);
    } catch (err: any) {
      log.warn(`backups : relecture de « ${site.nom} » impossible`, err?.message ?? err);
    }
  }

  return dus.length;
}

/**
 * LA CADENCE SE JUGE À LA MINUTE. Le passage tourne chaque minute et ne prend
 * que les sites DUS (`siteEstDu`) : un site réglé sur un quart d'heure est
 * repris toutes les quinze minutes, un site réglé sur un jour garde son
 * rendez-vous à l'heure de nuit. Un passage qui tourne encore n'est jamais
 * doublé — le suivant attend.
 */
export function planifierLesBackups(): NodeJS.Timeout {
  let passageEnCours = false;
  return setInterval(() => {
    if (passageEnCours) return;
    if (!getSettings().backupAuto) return;
    passageEnCours = true;
    void passageDesBackups('automatique').finally(() => {
      passageEnCours = false;
    });
  }, 60 * 1000);
}

/**
 * LE DOSSIER DE STOCKAGE, ET SON REPLI CRÉÉ TOUT SEUL. Tant qu'aucun dossier
 * n'est réglé dans « Système », les backups vont dans un dossier
 * « Backups » posé à côté des données du démon — au lieu de ne rien prendre
 * du tout. Un dossier réglé à la main l'emporte toujours.
 */
export function dossierDeStockage(): string {
  const regle = (getSettings().backupDossier ?? '').trim();
  if (regle) return regle;
  const repli = path.join(CONFIG.dataDir, DOSSIER_BACKUPS_PAR_DEFAUT);
  try {
    fs.mkdirSync(repli, { recursive: true });
  } catch (err: any) {
    log.warn(`backups : dossier « ${repli} » non créé`, err?.message ?? err);
  }
  return repli;
}
