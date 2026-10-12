/**
 * SUPPRIMER UN PROJET POUR DE BON — LE GESTE UNIQUE.
 *
 * Seule la commande `project.supprimerDefinitivement` arrive ici, jamais
 * `project.delete` (qui met de côté). Les règles de refus pures vivent dans
 * `shared/src/suppression-projet.ts` ; ce fichier les applique et défait le
 * montage d'un projet À L'ENVERS (MEM-1094), dans un ordre qui ne laisse
 * jamais un projet à moitié effacé :
 *
 *   1. les refus (nom, agent au travail, mise en ligne, dossier hors zone) ET
 *      la preuve que le dossier pourra être effacé — un dossier né par
 *      `sudo mkdir` sous `/root` exige la même élévation. Tout refus tombe ICI,
 *      avant le moindre geste irréversible (Lukyspot, 08/10/2026 : GitHub et
 *      l'adresse effacés, puis EACCES sur le dossier → projet à moitié supprimé) ;
 *   2. la COPIE DE SECOURS du projet seul : ses lignes et ses fichiers
 *      (`copie-de-projet-supprime.ts`, gardée 15 jours) — plus la sauvegarde
 *      complète du démon, qui figeait tout ~90 s ;
 *   3. le dépôt GitHub — s'il échoue, on s'ARRÊTE : rien d'autre n'est touché ;
 *   4. l'adresse publique (reverse-proxy), sans bloquer ;
 *   5. le dossier du serveur et les copies de travail de ses cartes, avec
 *      élévation si le démon n'en a pas le droit ;
 *   6. les fichiers des pièces jointes du projet — les SIENS seulement ;
 *   7. les lignes en base, en une seule transaction, puis la diffusion.
 *
 * Les effets sur le monde (GitHub, disque, sauvegarde, adresse) passent par des
 * `Dependances` : les tests en posent de factices, jamais un vrai dépôt.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DOSSIER_ABSENT,
  depotGithubDeLAdresse,
  refusDeSuppressionDeProjet,
  refusDeSupprimerLeDossier,
  refusDEffacerEnElevation,
  type Attachment,
  type DepotGithubCible,
  type Project,
} from '@beluga/shared';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { getDb } from './db.js';
import { retirerSousDomaine } from './dns.js';
import { log } from './logger.js';
import { ecrireCopieDuProjet, fichiersDeLaPieceJointe } from './copie-de-projet-supprime.js';
import { supprimerLaCarte } from './suppression-carte.js';
import * as store from './store.js';

const execFileAsync = promisify(execFile);

export interface EtapeDeSuppression {
  titre: string;
  fait: boolean;
  detail?: string;
}

export interface ApercuDeSuppression {
  projet: { id: string; name: string };
  /** « proprietaire/nom » du dépôt GitHub qui serait effacé, s'il y en a un. */
  depot?: string;
  dossier: string;
  dossierExiste: boolean;
  cartes: number;
  conversations: number;
  piecesJointes: number;
  miseEnLigne: number;
  /** Pourquoi ce projet ne peut pas être supprimé maintenant, sinon absent. */
  refus?: string;
}

export interface ResultatDeSuppression {
  ok: boolean;
  /** Ce qui a empêché, en français simple. */
  erreur?: string;
  etapes: EtapeDeSuppression[];
}

/** Les effets sur le monde : posés tels quels en production, factices en test. */
export interface Dependances {
  /** Les titres des agents au travail sur ce projet, tours vivants compris. */
  agentsAuTravail(projectId: string): Promise<string[]>;
  publicationEnCours(projectId: string): Promise<boolean>;
  /** La copie de secours du projet seul (lignes + fichiers). Rend son nom, ou lève. */
  sauvegarder(projet: Project): Promise<string>;
  /** Efface le dépôt GitHub. `absent` : il n'existait déjà plus. */
  supprimerDepot(depot: DepotGithubCible): Promise<{ ok: boolean; absent?: boolean; erreur?: string }>;
  /** Retire l'adresse publique posée au montage. N'arrête jamais la suppression. */
  retirerAdresse(devUrl: string): Promise<{ ok: boolean; detail: string }>;
  /** Les dossiers qu'on ne touche JAMAIS, quelle que soit la demande. */
  dossiersProteges(): string[];
  /** Les dossiers des copies de travail des cartes de ce dossier. */
  copiesDeTravail(dossier: string): Promise<string[]>;
  estUnDepotGit(dossier: string): boolean;
  /**
   * Ces dossiers pourront-ils être effacés ? `null` : oui. Sinon la raison, dite
   * AVANT tout geste irréversible.
   */
  effacementPossible(dossiers: string[]): Promise<string | null>;
  effacerDossier(dossier: string): Promise<void>;
  /** Efface les fichiers des pièces jointes données. Un fichier déjà absent n'est pas une erreur. */
  effacerPiecesJointes(pieces: Attachment[]): Promise<{ effaces: number; erreurs: string[] }>;
}

/* ------------------------------------------------------------------ */
/* Les dépendances réelles                                              */
/* ------------------------------------------------------------------ */

async function gh(args: string[]): Promise<{ ok: boolean; err: string }> {
  try {
    await execFileAsync('gh', args, { timeout: 60000 });
    return { ok: true, err: '' };
  } catch (err: any) {
    return { ok: false, err: (err?.stderr ?? err?.message ?? '').toString() };
  }
}

export function dependancesReelles(): Dependances {
  return {
    // Imports tardifs : le moteur de publication ne se charge pas pour un simple test.
    async agentsAuTravail(projectId) {
      const { agentsOccupes } = await import('./deploy.js');
      const { runningAgentIds } = await import('./runtime.js');
      const enTour = new Set(runningAgentIds());
      const titres = agentsOccupes(projectId).map((a) => a.title);
      for (const agent of store.listAgents(projectId)) {
        if (enTour.has(agent.id) && !titres.includes(agent.title || 'agent sans titre')) titres.push(agent.title || 'agent sans titre');
      }
      return titres;
    },
    async publicationEnCours(projectId) {
      const { publicationEnCours } = await import('./deploy.js');
      return publicationEnCours(projectId);
    },
    async sauvegarder(projet) {
      const archive = await ecrireCopieDuProjet({ projet, tables: lignesDuProjet(projet.id), pieces: store.listAttachments(projet.id) });
      return path.basename(archive);
    },
    async supprimerDepot(depot) {
      const nom = `${depot.proprietaire}/${depot.nom}`;
      const vu = await gh(['repo', 'view', nom]);
      if (!vu.ok && /could not resolve|not found|404/i.test(vu.err)) return { ok: true, absent: true };
      const res = await gh(['repo', 'delete', nom, '--yes']);
      if (res.ok) return { ok: true };
      if (/not found|404|could not resolve/i.test(res.err)) return { ok: true, absent: true };
      return { ok: false, erreur: res.err.trim().split('\n').slice(-2).join(' ').slice(0, 300) };
    },
    async retirerAdresse(devUrl) {
      return retirerSousDomaine(devUrl);
    },
    dossiersProteges() {
      return dossiersProtegesDuDemon();
    },
    async copiesDeTravail(dossier) {
      const { racinesDesCopiesDuProjet } = await import('./copies-de-cartes.js');
      return racinesDesCopiesDuProjet(dossier);
    },
    estUnDepotGit(dossier) {
      return fs.existsSync(path.join(dossier, '.git'));
    },
    async effacementPossible(dossiers) {
      for (const dossier of dossiers) {
        if (!fs.existsSync(dossier) || appartientAuDemon(dossier)) continue;
        if (await elevationDisponible()) continue;
        return `Le dossier ${dossier} appartient au système et l’élévation nécessaire pour l’effacer n’est pas disponible : rien n’a été touché.`;
      }
      return null;
    },
    async effacerDossier(dossier) {
      try {
        await fs.promises.rm(dossier, { recursive: true, force: true });
      } catch (err: any) {
        if (!['EACCES', 'EPERM', 'ENOTEMPTY'].includes(err?.code)) throw err;
        // Né par `sudo -n mkdir -p` (projects.ts, depots-github.ts) : il part de la même façon.
        const refus = refusDEffacerEnElevation(dossier, protegesResolus(dossiersProtegesDuDemon()));
        if (refus) throw new Error(refus);
        await execFileAsync('sudo', ['-n', 'rm', '-rf', '--', dossier], { timeout: 5 * 60 * 1000 });
      }
      if (fs.existsSync(dossier)) throw new Error(`le dossier ${dossier} existe encore`);
    },
    async effacerPiecesJointes(pieces) {
      let effaces = 0;
      const erreurs: string[] = [];
      for (const piece of pieces) {
        for (const chemin of fichiersDeLaPieceJointe(piece)) {
          try {
            await fs.promises.rm(chemin, { force: true });
            effaces += 1;
          } catch (err: any) {
            erreurs.push(`${path.basename(chemin)} : ${err?.code ?? err?.message ?? err}`);
          }
        }
      }
      return { effaces, erreurs };
    },
  };
}

/** Le démon peut-il effacer ce dossier seul : il en est propriétaire, et peut écrire dans son parent ? */
function appartientAuDemon(dossier: string): boolean {
  try {
    if (typeof process.getuid === 'function' && fs.statSync(dossier).uid !== process.getuid()) return false;
    fs.accessSync(path.dirname(dossier), fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `sudo -n` répond-il sans mot de passe ? Relu à chaque suppression : c'est rare, et une règle sudo peut changer. */
async function elevationDisponible(): Promise<boolean> {
  try {
    await execFileAsync('sudo', ['-n', 'true'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Un dossier protégé et sa forme réelle (liens résolus) : les deux se comparent. */
function protegesResolus(proteges: string[]): string[] {
  return proteges.flatMap((p) => (fs.existsSync(p) ? [p, fs.realpathSync(p)] : [p]));
}

/** Le dépôt du démon, ses données, le dossier personnel et leurs parents : jamais effacés. */
export function dossiersProtegesDuDemon(): string[] {
  const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  return [...new Set([racine, CONFIG.depotDuDemon, path.resolve(CONFIG.dataDir), os.homedir(), '/root', '/home', '/etc', '/var', '/usr', '/opt', '/srv', '/mnt', '/tmp'])];
}

/* ------------------------------------------------------------------ */
/* L'aperçu : ce qui serait effacé, et si c'est permis                  */
/* ------------------------------------------------------------------ */

function nombre(sql: string, ...params: unknown[]): number {
  return (getDb().prepare(sql).get(...params) as { n: number }).n;
}

function autresDossiers(id: string): string[] {
  return store
    .listProjects(true)
    .filter((p) => p.id !== id)
    .map((p) => p.path)
    .filter(Boolean);
}

async function motifDeRefus(project: Project, nomConfirme: string | undefined, dep: Dependances): Promise<string | null> {
  return refusDeSuppressionDeProjet({
    projet: project,
    nomConfirme,
    membres: store.listProjects(true).filter((p) => p.regroupementId === project.id).length,
    agentsAuTravail: await dep.agentsAuTravail(project.id),
    publicationEnCours: await dep.publicationEnCours(project.id),
  });
}

interface ConstatDuDossier {
  dossier: string;
  /** Le dossier existe-t-il encore (liens résolus) ? */
  dossierReel: string | undefined;
  /** Les copies de travail de ses cartes, à effacer avant lui. */
  copies: string[];
  refus: string | null;
}

/**
 * LE DOSSIER, JUGÉ EN ENTIER AVANT TOUTE ÉCRITURE : zone permise, dépôt git, et
 * PREUVE qu'on pourra l'effacer (lui et les copies de ses cartes). L'aperçu et
 * le geste lisent le même constat : un refus se voit dans la fenêtre avant
 * même le clic.
 */
async function constatDuDossier(project: Project, dep: Dependances): Promise<ConstatDuDossier> {
  const dossier = path.resolve(project.path);
  const dossierReel = fs.existsSync(dossier) ? fs.realpathSync(dossier) : undefined;
  const refusDossier = refusDeSupprimerLeDossier({
    dossier,
    dossierReel,
    estUnDepotGit: dossierReel ? dep.estUnDepotGit(dossierReel) : false,
    proteges: protegesResolus(dep.dossiersProteges()),
    autresProjets: autresDossiers(project.id),
  });
  if (refusDossier === DOSSIER_ABSENT) return { dossier, dossierReel: undefined, copies: [], refus: null };
  if (refusDossier) return { dossier, dossierReel, copies: [], refus: refusDossier };
  const copies = (await dep.copiesDeTravail(dossier)).filter((c) => c !== dossier && fs.existsSync(c));
  const refus = await dep.effacementPossible([...copies, dossier]);
  return { dossier, dossierReel, copies, refus };
}

export async function apercuDeSuppression(id: string, dep: Dependances = dependancesReelles()): Promise<ApercuDeSuppression> {
  const project = store.getProject(id);
  if (!project) throw new Error('projet introuvable');
  const depot = depotGithubDeLAdresse(project.gitRemote);
  // Le nom n'est pas encore saisi : on ne juge que ce qui bloque DÉJÀ.
  const refus = (await motifDeRefus(project, project.name, dep)) ?? (await constatDuDossier(project, dep)).refus;
  return {
    projet: { id: project.id, name: project.name },
    depot: depot ? `${depot.proprietaire}/${depot.nom}` : undefined,
    dossier: project.path,
    dossierExiste: fs.existsSync(project.path),
    cartes: nombre('SELECT count(*) n FROM cards WHERE project_id = ?', id),
    conversations: nombre('SELECT count(*) n FROM agents WHERE project_id = ?', id),
    piecesJointes: nombre('SELECT count(*) n FROM attachments WHERE project_id = ?', id),
    miseEnLigne: nombre('SELECT count(*) n FROM deploys WHERE project_id = ?', id),
    refus: refus ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Les lignes de la base                                                */
/* ------------------------------------------------------------------ */

/**
 * Ces tables gardent leur ligne : l'accès ou le site existait avant le projet et
 * lui survit. Seul le lien au projet est coupé.
 */
const LIEN_COUPE_SEULEMENT = ['secrets', 'backup_sites', 'sites_surveilles'];

/** Les colonnes d'une table, lues dans la base — jamais une liste écrite à la main qui vieillit. */
function tablesAvecColonne(colonne: string): string[] {
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as {
    name: string;
  }[];
  return tables
    .map((t) => t.name)
    .filter((nom) => (db.prepare(`PRAGMA table_info("${nom}")`).all() as { name: string }[]).some((c) => c.name === colonne));
}

function colonnes(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
}

/**
 * TOUTES LES LIGNES QUE `effacerLesLignesDuProjet` VA EFFACER OU DÉTACHER, table
 * par table — le contenu de la copie de secours. Même lecture de la base, même
 * périmètre : une table ajoutée demain avec un `project_id` y entre seule.
 */
export function lignesDuProjet(id: string): Record<string, unknown[]> {
  const db = getDb();
  const dansListe = (n: number) => Array(n).fill('?').join(',');
  const tables: Record<string, unknown[]> = {};
  const garder = (table: string, lignes: unknown[]) => {
    if (lignes.length) tables[table] = [...(tables[table] ?? []), ...lignes];
  };
  const cartes = (db.prepare('SELECT id FROM cards WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id);
  const agents = (db.prepare('SELECT id FROM agents WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id);
  const demandes = tablesAvecColonne('demande_id').includes('demande_messages')
    ? (db.prepare('SELECT id FROM demandes WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id)
    : [];
  for (const [colonne, ids] of [
    ['card_id', cartes],
    ['agent_id', agents],
    ['demande_id', demandes],
  ] as [string, string[]][]) {
    if (!ids.length) continue;
    for (const table of tablesAvecColonne(colonne)) {
      if (colonnes(table).includes('project_id')) continue;
      garder(table, db.prepare(`SELECT * FROM "${table}" WHERE ${colonne} IN (${dansListe(ids.length)})`).all(...ids));
    }
  }
  if (agents.length) {
    garder(
      'proposals',
      db.prepare(`SELECT * FROM proposals WHERE message_id IN (SELECT id FROM messages WHERE agent_id IN (${dansListe(agents.length)}))`).all(...agents),
    );
  }
  for (const table of tablesAvecColonne('project_id')) {
    if (table === 'projects') continue;
    garder(table, db.prepare(`SELECT * FROM "${table}" WHERE project_id = ?`).all(id));
  }
  garder('projects', db.prepare('SELECT * FROM projects WHERE id = ?').all(id));
  return tables;
}

/**
 * Efface toutes les lignes du projet, enfants d'abord. Les listes de cartes, de
 * conversations et de demandes sont relues dans la base, les tables à effacer
 * aussi : une table ajoutée demain avec un `project_id` part avec le projet.
 */
export function effacerLesLignesDuProjet(id: string): void {
  const db = getDb();
  const dansListe = (n: number) => Array(n).fill('?').join(',');
  db.transaction(() => {
    const cartes = (db.prepare('SELECT id FROM cards WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id);
    const agents = (db.prepare('SELECT id FROM agents WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id);
    const demandes = tablesAvecColonne('demande_id').includes('demande_messages')
      ? (db.prepare('SELECT id FROM demandes WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id)
      : [];

    // 1. Les tables qui n'ont pas de `project_id` mais pendent à une carte, un agent ou une demande.
    const pendentA: [string, string[]][] = [
      ['card_id', cartes],
      ['agent_id', agents],
      ['demande_id', demandes],
    ];
    for (const [colonne, ids] of pendentA) {
      if (!ids.length) continue;
      for (const table of tablesAvecColonne(colonne)) {
        if (colonnes(table).includes('project_id')) continue; // traité plus bas
        db.prepare(`DELETE FROM "${table}" WHERE ${colonne} IN (${dansListe(ids.length)})`).run(...ids);
      }
    }
    if (agents.length) {
      db.prepare(`DELETE FROM proposals WHERE message_id IN (SELECT id FROM messages WHERE agent_id IN (${dansListe(agents.length)}))`).run(...agents);
    }

    // 2. Les accès et sites qui survivent : on coupe leur lien, on garde la ligne.
    for (const table of LIEN_COUPE_SEULEMENT) {
      if (colonnes(table).includes('project_id')) db.prepare(`UPDATE "${table}" SET project_id = NULL WHERE project_id = ?`).run(id);
    }

    // 3. Tout le reste de ce qui porte `project_id`, puis le projet.
    for (const table of tablesAvecColonne('project_id')) {
      if (table === 'projects' || LIEN_COUPE_SEULEMENT.includes(table)) continue;
      db.prepare(`DELETE FROM "${table}" WHERE project_id = ?`).run(id);
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  })();
}

/* ------------------------------------------------------------------ */
/* Le geste                                                             */
/* ------------------------------------------------------------------ */

/** Les projets dont la suppression tourne : un second clic n'en lance pas une seconde. */
const suppressionsEnCours = new Set<string>();

export async function supprimerDefinitivementLeProjet(
  id: string,
  nomConfirme: string | undefined,
  dep: Dependances = dependancesReelles(),
): Promise<ResultatDeSuppression> {
  if (suppressionsEnCours.has(id)) {
    return { ok: false, erreur: 'La suppression de ce projet est déjà en cours : attendez sa réponse.', etapes: [] };
  }
  suppressionsEnCours.add(id);
  try {
    return await supprimerSansDoublon(id, nomConfirme, dep);
  } finally {
    suppressionsEnCours.delete(id);
  }
}

async function supprimerSansDoublon(id: string, nomConfirme: string | undefined, dep: Dependances): Promise<ResultatDeSuppression> {
  const etapes: EtapeDeSuppression[] = [];
  const echec = (erreur: string): ResultatDeSuppression => ({ ok: false, erreur, etapes });

  const project = store.getProject(id);
  if (!project) return echec('projet introuvable');

  // 1. Les refus — avant toute écriture.
  const refus = await motifDeRefus(project, nomConfirme, dep);
  if (refus) return echec(refus);

  const { dossier, dossierReel, copies, refus: refusDossier } = await constatDuDossier(project, dep);
  if (refusDossier) return echec(refusDossier);

  // 2. La copie de secours du projet — avant la première écriture.
  try {
    const nom = await dep.sauvegarder(project);
    etapes.push({ titre: 'Copie de secours du projet', fait: true, detail: nom });
  } catch (err: any) {
    return echec(`Copie de secours impossible, rien n’a été effacé : ${err?.message ?? err}`);
  }

  // 3. Le dépôt GitHub — au moindre échec, on s'arrête là.
  const depot = depotGithubDeLAdresse(project.gitRemote);
  if (depot) {
    const res = await dep.supprimerDepot(depot);
    if (!res.ok) {
      etapes.push({ titre: 'Dépôt GitHub', fait: false, detail: res.erreur });
      return echec(`Le dépôt GitHub n’a pas pu être effacé, rien d’autre n’a été touché : ${res.erreur ?? 'raison inconnue'}`);
    }
    etapes.push({ titre: 'Dépôt GitHub', fait: true, detail: res.absent ? 'déjà absent' : `${depot.proprietaire}/${depot.nom}` });
  } else {
    etapes.push({ titre: 'Dépôt GitHub', fait: true, detail: 'aucun dépôt GitHub déclaré' });
  }

  // 4. L'adresse publique : elle ne bloque jamais la suite.
  const adresseCommune = project.devUrl && store.listProjects(true).some((p) => p.id !== id && p.devUrl === project.devUrl);
  if (project.devUrl && adresseCommune) {
    etapes.push({ titre: 'Adresse publique', fait: true, detail: 'partagée avec un autre projet, laissée en place' });
  } else if (project.devUrl) {
    try {
      const res = await dep.retirerAdresse(project.devUrl);
      etapes.push({ titre: 'Adresse publique', fait: res.ok, detail: res.detail });
    } catch (err: any) {
      etapes.push({ titre: 'Adresse publique', fait: false, detail: err?.message ?? String(err) });
    }
  }

  // 5. Le dossier du serveur, et les copies de travail de ses cartes.
  if (dossierReel) {
    try {
      for (const copie of copies) {
        if (fs.existsSync(copie)) await dep.effacerDossier(copie);
      }
      await dep.effacerDossier(dossier);
      etapes.push({ titre: 'Dossier du serveur', fait: true, detail: dossier });
    } catch (err: any) {
      etapes.push({ titre: 'Dossier du serveur', fait: false, detail: err?.message ?? String(err) });
      return echec(`Le dossier n’a pas pu être effacé, le projet reste dans l’application : ${err?.message ?? err}`);
    }
  } else {
    etapes.push({ titre: 'Dossier du serveur', fait: true, detail: 'déjà absent' });
  }

  // 6. Les fichiers de SES pièces jointes — gardés dans la copie de secours. Un raté ne bloque pas.
  const pieces = store.listAttachments(id);
  if (pieces.length) {
    const res = await dep.effacerPiecesJointes(pieces);
    etapes.push({
      titre: 'Fichiers des pièces jointes',
      fait: !res.erreurs.length,
      detail: res.erreurs.length ? `${res.effaces} effacé(s) ; restés : ${res.erreurs.join(' ; ')}` : `${res.effaces} effacé(s)`,
    });
    if (res.erreurs.length) log.warn(`projet « ${project.name} » : fichiers de pièces jointes restés`, res.erreurs.join(' ; '));
  }

  // 7. L'application : les cartes par le chemin unique (MEM-0595), puis tout le reste.
  for (const carte of store.listCards(id)) supprimerLaCarte(carte.id);
  for (const agent of store.listAgents(id)) {
    store.deleteAgent(agent.id);
    bus.emit({ type: 'agent.delete', id: agent.id });
  }
  effacerLesLignesDuProjet(id);
  bus.emit({ type: 'project.delete', id });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  etapes.push({ titre: 'Projet, cartes et conversations', fait: true });
  log.warn(`projet « ${project.name} » (${id}) supprimé définitivement`);
  return { ok: true, etapes };
}
