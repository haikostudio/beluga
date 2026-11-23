/**
 * LE SERVICE « SÉCURITÉ » — les projets suivis, leurs audits et l'agent de chaque projet (carte « Service Sécurité des
 * projets », 15/11/2026). Les règles pures vivent dans `shared/src/service-securite.ts` ; le contrôle lui-même est
 * celui de la commande « /securite » (`server/src/controle-securite.ts`), rejoué ici sans agent ni quota.
 *
 * CINQ PRINCIPES.
 *
 *  1. **UN AUDIT À LA FOIS.** `npm audit` et la lecture des fichiers prennent jusqu'à deux minutes : la file est
 *     sérielle, et un projet déjà en file n'y entre pas deux fois (ses cartes mises en ligne s'ajoutent à l'audit qui
 *     attend). Rien ne bloque la boucle du démon : chaque relevé est un processus à part.
 *  2. **LE RYTHME SE RECALCULE.** Une tournée horaire lance les projets DUS (sept jours après leur dernier audit) ; un
 *     minuteur de sept jours sauterait au moindre redémarrage.
 *  3. **SEUL LE GRAVE NOUVEAU DÉPENSE.** Un audit hebdomadaire qui trouve un point critique ou élevé NOUVEAU réveille
 *     l'agent du projet, qui prépare la carte de correction (une proposition « Créer la carte ») et l'utilisateur est
 *     prévenu (décision attendue, MEM-0490). Tout autre audit est silencieux.
 *  4. **LA PREUVE APRÈS LA MISE EN LIGNE.** La mise en ligne d'une carte de correction relance un audit ; les points
 *     disparus passent « corrigé », ceux qui résistent reviennent « à traiter ». Ce contrôle est lancé HORS du chemin
 *     de la publication : une erreur se journalise, elle ne fait jamais échouer une mise en ligne.
 *  5. **AUCUNE VALEUR SECRÈTE.** Le rapport ne porte que des chemins (DEC-501) ; l'agent reçoit ce rapport-là, rien
 *     d'autre.
 *
 * Les commandes `securite.*` et l'événement `securite` restent FERMÉS aux collaborateurs (listes blanches de
 * `shared/src/droits-commandes.ts`, refus par défaut), comme la Surveillance.
 */
import {
  DECLENCHEURS_D_AUDIT,
  ETATS_DU_POINT_DE_SECURITE,
  LABEL_SECURITE,
  RETENTION_AUDITS_MS,
  auditDu,
  auditsAPurger,
  carteDeCorrectionGroupee,
  compteParGravite,
  compteurVide,
  empreinteDuConstat,
  empreintesDuRapport,
  etatsApresControle,
  niveauDeLaCorrection,
  nouveauxPointsGraves,
  pointsACorriger,
  pointsDeLaCorrectionGroupee,
  precedentDeComparaison,
  prochainPassage,
  rapportDepuisEtude,
  rapportPourLAgent,
  reglagesDuNiveau,
  type Agent,
  type AuditDeSecurite,
  type ConstatSecurite,
  type DeclencheurDAudit,
  type EtatDuPointDeSecurite,
  type PointSuivi,
  type ProjetSuiviSecurite,
  type RapportDeSecurite,
  type ResumeDAudit,
  type VueDAudit,
} from '@beluga/shared';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { ROOT } from './config.js';
import { log } from './logger.js';
import * as store from './store.js';

/* ------------------------------------------------------------------ */
/* Lignes de base                                                      */
/* ------------------------------------------------------------------ */

interface LigneProjet {
  project_id: string;
  ajoute_le: number;
  agent_id: string | null;
  card_id: string | null;
}

interface LigneAudit {
  id: string;
  project_id: string;
  lance: number;
  fini: number | null;
  declencheur: string;
  rapport: string | null;
  erreur: string | null;
  cartes: string | null;
}

interface LignePoint {
  project_id: string;
  empreinte: string;
  etat: string;
  card_id: string | null;
  premier_audit_id: string;
  mis_a_jour_le: number;
}

function rapportDeLigne(brut: string | null): RapportDeSecurite | null {
  if (!brut) return null;
  try {
    return JSON.parse(brut) as RapportDeSecurite;
  } catch {
    return null;
  }
}

function resumeDeLigne(l: LigneAudit): ResumeDAudit {
  const rapport = rapportDeLigne(l.rapport);
  return {
    id: l.id,
    lance: l.lance,
    fini: l.fini,
    // Un déclencheur inconnu (base écrite par une version plus récente) se lit « à la demande », jamais un trou.
    declencheur: DECLENCHEURS_D_AUDIT.includes(l.declencheur as DeclencheurDAudit) ? (l.declencheur as DeclencheurDAudit) : 'manuel',
    ...(l.erreur ? { erreur: l.erreur } : {}),
    ...(rapport ? { compte: compteParGravite(rapport.constats) } : {}),
  };
}

function auditDeLigne(l: LigneAudit): AuditDeSecurite {
  return { ...resumeDeLigne(l), projectId: l.project_id, rapport: rapportDeLigne(l.rapport) };
}

function pointDeLigne(l: LignePoint): PointSuivi {
  return {
    empreinte: l.empreinte,
    etat: ETATS_DU_POINT_DE_SECURITE.includes(l.etat as EtatDuPointDeSecurite) ? (l.etat as EtatDuPointDeSecurite) : 'a-traiter',
    ...(l.card_id ? { cardId: l.card_id } : {}),
    premierAuditId: l.premier_audit_id,
    misAJourLe: l.mis_a_jour_le,
  };
}

function ligneProjet(projectId: string): LigneProjet | null {
  return (getDb().prepare('SELECT * FROM securite_projets WHERE project_id = ?').get(projectId) as LigneProjet | undefined) ?? null;
}

function pointsDuProjet(projectId: string): PointSuivi[] {
  return (getDb().prepare('SELECT * FROM securite_points WHERE project_id = ?').all(projectId) as LignePoint[]).map(pointDeLigne);
}

/** Le dernier audit TERMINÉ et RÉUSSI d'un projet (avant `avant`, s'il est donné). */
function dernierAuditReussi(projectId: string, avant?: number): AuditDeSecurite | null {
  const l = getDb()
    .prepare(
      `SELECT * FROM securite_audits WHERE project_id = ? AND fini IS NOT NULL AND rapport IS NOT NULL ${avant ? 'AND lance < ?' : ''}
       ORDER BY lance DESC LIMIT 1`,
    )
    .get(...(avant ? [projectId, avant] : [projectId])) as LigneAudit | undefined;
  return l ? auditDeLigne(l) : null;
}

/** Prévenir les écrans ouverts : ils relisent ce qu'ils montrent (aucune donnée ne voyage dans l'événement). */
function diffuser(projectId: string): void {
  bus.emit({ type: 'securite', projectId });
}

/* ------------------------------------------------------------------ */
/* Projets suivis                                                      */
/* ------------------------------------------------------------------ */

export function estSuivi(projectId: string): boolean {
  return ligneProjet(projectId) !== null;
}

/** Les projets suivis, dans l'ordre d'ajout, avec leur dernier audit et leurs compteurs. */
export function listerProjetsSuivis(): ProjetSuiviSecurite[] {
  const db = getDb();
  const lignes = db.prepare('SELECT * FROM securite_projets ORDER BY ajoute_le ASC').all() as LigneProjet[];
  return lignes
    .filter((l) => store.getProject(l.project_id))
    .map((l) => {
      const dernier = db
        .prepare('SELECT * FROM securite_audits WHERE project_id = ? AND fini IS NOT NULL ORDER BY lance DESC LIMIT 1')
        .get(l.project_id) as LigneAudit | undefined;
      const dernierLance = (db.prepare('SELECT MAX(lance) AS m FROM securite_audits WHERE project_id = ?').get(l.project_id) as { m: number | null }).m;
      const reussi = dernierAuditReussi(l.project_id);
      const etats = new Map(pointsDuProjet(l.project_id).map((p) => [p.empreinte, p.etat]));
      const aTraiter = compteurVide();
      let enCorrection = 0;
      for (const c of reussi?.rapport?.constats ?? []) {
        const etat = etats.get(empreinteDuConstat(c)) ?? 'a-traiter';
        if (etat === 'a-traiter') aTraiter[c.gravite]++;
        else if (etat === 'en-correction') enCorrection++;
      }
      return {
        projectId: l.project_id,
        ajouteLe: l.ajoute_le,
        ...(l.agent_id ? { agentId: l.agent_id } : {}),
        ...(l.card_id ? { cardId: l.card_id } : {}),
        ...(dernier ? { dernierAudit: resumeDeLigne(dernier) } : {}),
        enCours: enFile.has(l.project_id) || enCoursDAudit === l.project_id,
        prochainPassage: prochainPassage(dernierLance, l.ajoute_le),
        aTraiter,
        enCorrection,
      };
    });
}

/** Ajouter un projet de Beluga : son premier audit part aussitôt. Son agent naît à l'ouverture de sa page. */
export function ajouterProjet(projectId: string, maintenant = Date.now()): ProjetSuiviSecurite[] {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  if (projet.archived) throw new Error('un projet archivé ne se suit pas');
  if (estSuivi(projectId)) throw new Error('ce projet est déjà suivi');
  getDb().prepare('INSERT INTO securite_projets (project_id, ajoute_le) VALUES (?, ?)').run(projectId, maintenant);
  lancerAudit(projectId, 'ajout');
  log.info(`sécurité : « ${projet.name} » est suivi`);
  return listerProjetsSuivis();
}

/** Un regroupement (dossier sans code propre) ne se contrôle pas : il n'a rien à auditer. */
function estUnRegroupement(data: string): boolean {
  try {
    return (JSON.parse(data) as { regroupement?: boolean } | null)?.regroupement === true;
  } catch {
    return false;
  }
}

/**
 * TOUT PROJET ACTIF EST SUIVI (décision du cadrage, 16/11/2026) : chaque projet non archivé et non regroupement entre
 * dans le suivi, une seule fois (INSERT OR IGNORE). Un projet archivé n'est jamais retiré de la table. Rend le nombre
 * de projets nouvellement suivis. Son premier audit part à la tournée suivante, sans alerte.
 */
export function synchroniserLesProjets(maintenant = Date.now()): number {
  const db = getDb();
  const actifs = db.prepare('SELECT id, data FROM projects WHERE archived = 0').all() as { id: string; data: string }[];
  const inscrire = db.prepare('INSERT OR IGNORE INTO securite_projets (project_id, ajoute_le) VALUES (?, ?)');
  let ajoutes = 0;
  for (const p of actifs) {
    if (estUnRegroupement(p.data)) continue;
    ajoutes += inscrire.run(p.id, maintenant).changes;
  }
  if (ajoutes) log.info(`sécurité : ${ajoutes} projet(s) actif(s) ajouté(s) au suivi`);
  return ajoutes;
}

/**
 * UN PROJET VIENT D'ÊTRE CRÉÉ (ou réinscrit) : il entre dans le suivi tout de suite, et son premier audit part sans
 * alerte. Jamais d'exception : la création du projet ne doit pas échouer à cause du suivi.
 */
export function suivreLeProjetCree(projectId: string): void {
  try {
    const ligne = getDb().prepare('SELECT data, archived FROM projects WHERE id = ?').get(projectId) as { data: string; archived: number } | undefined;
    if (!ligne || ligne.archived || estUnRegroupement(ligne.data) || estSuivi(projectId)) return;
    ajouterProjet(projectId);
  } catch (err) {
    log.warn(`sécurité : « ${projectId} » n’a pas pu être suivi à sa création`, err);
  }
}

/** Ne plus suivre un projet : ses audits et ses points s'en vont, sa conversation reste. */
export function retirerProjet(projectId: string): ProjetSuiviSecurite[] {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM securite_projets WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM securite_audits WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM securite_points WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM securite_propositions WHERE project_id = ?').run(projectId);
  })();
  enFile.delete(projectId);
  diffuser(projectId);
  return listerProjetsSuivis();
}

/* ------------------------------------------------------------------ */
/* Audits : la file                                                    */
/* ------------------------------------------------------------------ */

/** Les projets qui attendent leur tour, et l'audit qu'ils attendent. */
const enFile = new Map<string, string>();
let enCoursDAudit: string | null = null;
let fileEnMarche = false;

/** Lance (ou rejoint) l'audit d'un projet. Rend l'identifiant de l'audit. */
export function lancerAudit(projectId: string, declencheur: DeclencheurDAudit, cartesMisesEnLigne: readonly string[] = []): string {
  const db = getDb();
  const attente = enFile.get(projectId);
  if (attente) {
    if (cartesMisesEnLigne.length) {
      const l = db.prepare('SELECT cartes, declencheur FROM securite_audits WHERE id = ?').get(attente) as { cartes: string | null; declencheur: string } | undefined;
      const cartes = new Set<string>([...(l?.cartes ? (JSON.parse(l.cartes) as string[]) : []), ...cartesMisesEnLigne]);
      db.prepare('UPDATE securite_audits SET cartes = ?, declencheur = ? WHERE id = ?').run(
        JSON.stringify([...cartes]),
        l?.declencheur === 'hebdo' ? 'apres-mise-en-ligne' : (l?.declencheur ?? declencheur),
        attente,
      );
    }
    return attente;
  }
  const id = store.newId();
  // L'heure de lancement est STRICTEMENT croissante par projet : deux audits lancés dans la même milliseconde se
  // confondraient (« l'audit précédent » se lit par `lance < ?`), et un point grave réveillerait l'agent deux fois.
  const dernier = (db.prepare('SELECT MAX(lance) AS m FROM securite_audits WHERE project_id = ?').get(projectId) as { m: number | null }).m;
  db.prepare('INSERT INTO securite_audits (id, project_id, lance, fini, declencheur, cartes) VALUES (?, ?, ?, NULL, ?, ?)').run(
    id,
    projectId,
    Math.max(Date.now(), (dernier ?? 0) + 1),
    declencheur,
    cartesMisesEnLigne.length ? JSON.stringify([...cartesMisesEnLigne]) : null,
  );
  enFile.set(projectId, id);
  diffuser(projectId);
  void tournerLaFile();
  return id;
}

/** Le relevé, remplaçable par les contrôles (un vrai relevé lit le disque et le réseau). */
type Releve = (options: { dossier: string; nom: string; adresse?: string; reglageRobots?: import('@beluga/shared').ReglageRobots | null }) => Promise<{ rapport: RapportDeSecurite }>;
let releve: Releve = async (options) => (await import('./controle-securite.js')).controlerLaSecurite(options);
/** Pour les contrôles seulement : un relevé factice, rendu à la fin. */
export function remplacerLeReleve(autre: Releve | null): void {
  releve = autre ?? (async (options) => (await import('./controle-securite.js')).controlerLaSecurite(options));
}

let finDeFile: Promise<void> = Promise.resolve();
/** Pour les contrôles : attendre que la file soit vide. */
export function attendreLaFile(): Promise<void> {
  return finDeFile;
}

function tournerLaFile(): Promise<void> {
  if (fileEnMarche) return finDeFile;
  fileEnMarche = true;
  finDeFile = viderLaFile();
  return finDeFile;
}

async function viderLaFile(): Promise<void> {
  try {
    while (enFile.size) {
      const [projectId, auditId] = enFile.entries().next().value as [string, string];
      enFile.delete(projectId);
      enCoursDAudit = projectId;
      try {
        await executerAudit(projectId, auditId);
      } catch (err) {
        log.warn(`sécurité : audit ${auditId} impossible`, err);
      } finally {
        enCoursDAudit = null;
        diffuser(projectId);
      }
    }
  } finally {
    fileEnMarche = false;
  }
}

async function executerAudit(projectId: string, auditId: string): Promise<void> {
  const db = getDb();
  const projet = store.getProject(projectId);
  const ligne = db.prepare('SELECT * FROM securite_audits WHERE id = ?').get(auditId) as LigneAudit | undefined;
  if (!ligne) return;
  if (!projet) {
    db.prepare('UPDATE securite_audits SET fini = ?, erreur = ? WHERE id = ?').run(Date.now(), 'projet introuvable', auditId);
    return;
  }
  const precedent = dernierAuditReussi(projectId, ligne.lance);
  let rapport: RapportDeSecurite;
  try {
    const adresse = projet.adresseProduction || projet.devUrl || undefined;
    /* JUGÉ D'APRÈS LE RÉGLAGE « ACCÈS DES ROBOTS » DU SITE, s'il en a un à lui (22/11/2026). */
    const { reglageParticulierDuProjet } = await import('./garde-des-robots.js');
    const reglageRobots = await reglageParticulierDuProjet(projectId).catch(() => null);
    ({ rapport } = await releve({ dossier: projet.path, nom: projet.name, ...(adresse ? { adresse } : {}), reglageRobots }));
  } catch (err) {
    db.prepare('UPDATE securite_audits SET fini = ?, erreur = ? WHERE id = ?').run(Date.now(), (err as Error)?.message ?? String(err), auditId);
    return;
  }
  // Les cartes mises en ligne relues APRÈS le relevé : une mise en ligne arrivée pendant l'audit s'y est ajoutée.
  const cartesBrut = (db.prepare('SELECT cartes, declencheur FROM securite_audits WHERE id = ?').get(auditId) as { cartes: string | null; declencheur: string } | undefined) ?? null;
  const cartes = cartesBrut?.cartes ? (JSON.parse(cartesBrut.cartes) as string[]) : [];
  const declencheur = (cartesBrut?.declencheur ?? ligne.declencheur) as DeclencheurDAudit;
  const maintenant = Date.now();
  const changements = etatsApresControle(pointsDuProjet(projectId), rapport, cartes);
  db.transaction(() => {
    db.prepare('UPDATE securite_audits SET fini = ?, rapport = ? WHERE id = ?').run(maintenant, JSON.stringify(rapport), auditId);
    for (const c of changements) {
      if (c.nouveau) {
        db.prepare(
          'INSERT INTO securite_points (project_id, empreinte, etat, card_id, premier_audit_id, mis_a_jour_le) VALUES (?, ?, ?, NULL, ?, ?)',
        ).run(projectId, c.empreinte, c.etat, auditId, maintenant);
      } else {
        db.prepare('UPDATE securite_points SET etat = ?, card_id = ?, mis_a_jour_le = ? WHERE project_id = ? AND empreinte = ?').run(
          c.etat,
          c.etat === 'a-traiter' ? null : (c.cardId ?? null),
          maintenant,
          projectId,
          c.empreinte,
        );
      }
    }
  })();
  // Après une étude rédigée, ce contrôle est une base : rien n'y est « nouveau » (empreintes d'une autre famille).
  const graves = nouveauxPointsGraves(precedentDeComparaison(precedent)?.rapport ?? null, rapport);
  // Décision de l'utilisateur : l'alerte se lit dans le tableau seulement. Aucun agent n'est réveillé ici.
  log.info(
    `sécurité : audit de « ${projet.name} » (${declencheur}) — ${rapport.constats.length} point(s), ${changements.length} changement(s), ${graves.length} grave(s) nouveau(x)`,
  );
}

/** Les audits du projet sur douze mois, du plus récent au plus ancien. */
export function listerAudits(projectId: string, maintenant = Date.now()): ResumeDAudit[] {
  return (
    getDb()
      .prepare('SELECT * FROM securite_audits WHERE project_id = ? AND lance >= ? ORDER BY lance DESC')
      .all(projectId, maintenant - RETENTION_AUDITS_MS) as LigneAudit[]
  ).map(resumeDeLigne);
}

/** Un audit (le dernier réussi par défaut), ses points suivis et ce qu'il a de nouveau. */
export function lireVueDAudit(projectId: string, auditId?: string | null): VueDAudit | null {
  const db = getDb();
  const l = auditId
    ? (db.prepare('SELECT * FROM securite_audits WHERE id = ? AND project_id = ?').get(auditId, projectId) as LigneAudit | undefined)
    : ((db
        .prepare('SELECT * FROM securite_audits WHERE project_id = ? AND fini IS NOT NULL AND rapport IS NOT NULL ORDER BY lance DESC LIMIT 1')
        .get(projectId) as LigneAudit | undefined) ??
      (db.prepare('SELECT * FROM securite_audits WHERE project_id = ? ORDER BY lance DESC LIMIT 1').get(projectId) as LigneAudit | undefined));
  if (!l) return null;
  const audit = auditDeLigne(l);
  const precedent = precedentDeComparaison(dernierAuditReussi(projectId, l.lance));
  const avant = new Set(empreintesDuRapport(precedent?.rapport ?? null));
  const nouveaux = precedent && audit.rapport ? empreintesDuRapport(audit.rapport).filter((e) => !avant.has(e)) : [];
  const points = pointsDuProjet(projectId);
  const cartes: VueDAudit['cartes'] = {};
  for (const p of points) {
    if (!p.cardId || cartes[p.cardId]) continue;
    const carte = store.getCard(p.cardId);
    if (carte) cartes[p.cardId] = { titre: carte.title, projectId: carte.projectId };
  }
  return { audit, points, nouveaux, cartes };
}

/* ------------------------------------------------------------------ */
/* La tournée                                                          */
/* ------------------------------------------------------------------ */

/** Lance les projets dus et range les audits de plus de douze mois. */
export function tourneeSecurite(maintenant = Date.now()): number {
  const db = getDb();
  synchroniserLesProjets(maintenant);
  let lances = 0;
  for (const l of db.prepare('SELECT * FROM securite_projets').all() as LigneProjet[]) {
    // Un projet archivé reste dans la table, mais la tournée le saute : à sa réactivation, il reprend son cycle.
    const projet = store.getProject(l.project_id);
    if (!projet || projet.archived || enFile.has(l.project_id) || enCoursDAudit === l.project_id) continue;
    const dernier = (db.prepare('SELECT MAX(lance) AS m FROM securite_audits WHERE project_id = ?').get(l.project_id) as { m: number | null }).m;
    if (!auditDu(dernier, l.ajoute_le, maintenant)) continue;
    lancerAudit(l.project_id, 'hebdo');
    lances++;
  }
  purgerLesAudits(maintenant);
  return lances;
}

/** Les audits de plus de douze mois s'en vont, sauf ceux qui portent encore un point suivi par une carte. */
export function purgerLesAudits(maintenant = Date.now()): number {
  const db = getDb();
  const audits = (db.prepare('SELECT id, project_id, lance FROM securite_audits').all() as { id: string; project_id: string; lance: number }[]).map((a) => ({
    id: a.id,
    projectId: a.project_id,
    lance: a.lance,
  }));
  const gardes = new Set(
    (db.prepare("SELECT DISTINCT audit_id FROM securite_propositions WHERE audit_id IS NOT NULL").all() as { audit_id: string }[]).map((l) => l.audit_id),
  );
  const aPurger = auditsAPurger(audits, maintenant, gardes);
  const suppr = db.prepare('DELETE FROM securite_audits WHERE id = ?');
  db.transaction(() => aPurger.forEach((id) => suppr.run(id)))();
  return aPurger.length;
}

/* ------------------------------------------------------------------ */
/* Les études rédigées, rattachées comme premier rapport               */
/* ------------------------------------------------------------------ */

/** Les études figées dans le dépôt : un fichier markdown par projet, son en-tête dit la carte, le projet et les dates. */
export const DOSSIER_DES_ETUDES = path.join(ROOT, 'docs', 'securite', 'etudes-2026-11-15');

interface EnteteDEtude {
  carte: string;
  projet: string;
  nom: string;
  lance: number;
  fini: number;
}

/** L'en-tête « --- clé: valeur --- » d'un fichier d'étude, et son corps. */
export function lireFichierDEtude(texte: string): { entete: EnteteDEtude; corps: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(texte.replace(/\r\n/g, '\n'));
  if (!m) return null;
  const champs = Object.fromEntries(
    m[1]!.split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  const lance = Number(champs.lance);
  const fini = Number(champs.fini);
  if (!champs.carte || !champs.projet || !Number.isFinite(lance) || !Number.isFinite(fini)) return null;
  return { entete: { carte: champs.carte, projet: champs.projet, nom: champs.nom ?? champs.projet, lance, fini }, corps: m[2]! };
}

/**
 * RATTACHER LES ÉTUDES RÉDIGÉES (décision de l'utilisateur, 15/11/2026) : chaque projet étudié entre dans le suivi et
 * son étude devient son PREMIER rapport — déclencheur `etude`, la carte d'étude dans `cartes`, ses points « à
 * traiter ». AUCUN audit n'est mis en file et aucun agent n'est réveillé : on passe à côté de `ajouterProjet`. Le
 * contrôle automatique prend le relais sept jours après l'étude (`prochainPassage` part de son `lance`).
 *
 * Une fois par étude, à vie : `securite_etudes_importees` retient la carte, si bien qu'un projet retiré du suivi ne
 * revient pas au redémarrage. Un rapport vide n'est jamais importé. Un projet inconnu (base d'essai) est passé.
 */
export function importerLesEtudes(dossier = DOSSIER_DES_ETUDES, maintenant = Date.now()): { importees: string[]; passees: string[] } {
  const importees: string[] = [];
  const passees: string[] = [];
  let fichiers: string[] = [];
  try {
    fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return { importees, passees };
  }
  const db = getDb();
  for (const f of fichiers) {
    const lu = lireFichierDEtude(fs.readFileSync(path.join(dossier, f), 'utf8'));
    if (!lu) {
      passees.push(`${f} (en-tête illisible)`);
      continue;
    }
    const { entete, corps } = lu;
    if (db.prepare('SELECT 1 FROM securite_etudes_importees WHERE card_id = ?').get(entete.carte)) continue;
    const projet = store.getProject(entete.projet);
    if (!projet) {
      passees.push(`${f} (projet absent)`);
      continue;
    }
    const rapport = rapportDepuisEtude(corps, {
      projet: projet.name,
      date: new Date(entete.fini).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }),
      ...(projet.adresseProduction || projet.devUrl ? { adresse: projet.adresseProduction || projet.devUrl } : {}),
    });
    if (!rapport.constats.length) {
      passees.push(`${f} (aucun point lu)`);
      continue;
    }
    const auditId = store.newId();
    db.transaction(() => {
      // Un projet déjà suivi garde sa date d'ajout ; sinon il entre à la date de l'étude.
      db.prepare('INSERT OR IGNORE INTO securite_projets (project_id, ajoute_le) VALUES (?, ?)').run(entete.projet, entete.fini);
      db.prepare('INSERT INTO securite_audits (id, project_id, lance, fini, declencheur, rapport, cartes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        auditId,
        entete.projet,
        entete.lance,
        entete.fini,
        'etude',
        JSON.stringify(rapport),
        JSON.stringify([entete.carte]),
      );
      const point = db.prepare(
        "INSERT OR IGNORE INTO securite_points (project_id, empreinte, etat, card_id, premier_audit_id, mis_a_jour_le) VALUES (?, ?, 'a-traiter', NULL, ?, ?)",
      );
      for (const e of empreintesDuRapport(rapport)) point.run(entete.projet, e, auditId, maintenant);
      db.prepare('INSERT INTO securite_etudes_importees (card_id, project_id, audit_id, importee_le) VALUES (?, ?, ?, ?)').run(
        entete.carte,
        entete.projet,
        auditId,
        maintenant,
      );
    })();
    importees.push(entete.nom);
    diffuser(entete.projet);
  }
  if (importees.length) log.info(`sécurité : ${importees.length} étude(s) rattachée(s) au suivi — ${importees.join(', ')}`);
  if (passees.length) log.info(`sécurité : ${passees.length} étude(s) non rattachée(s) — ${passees.join(', ')}`);
  return { importees, passees };
}

const BATTEMENT_MS = 60 * 60 * 1000;

/** Au démarrage : un audit coupé par l'arrêt se dit interrompu, puis la tournée horaire part (première après 2 min). */
export function demarrerSecurite(): NodeJS.Timeout {
  try {
    getDb()
      .prepare("UPDATE securite_audits SET fini = ?, erreur = 'interrompu par un redémarrage du serveur' WHERE fini IS NULL")
      .run(Date.now());
  } catch (err) {
    log.warn('sécurité : remise en ordre des audits interrompus impossible', err);
  }
  try {
    synchroniserLesProjets();
  } catch (err) {
    log.warn('sécurité : synchronisation des projets impossible', err);
  }
  try {
    importerLesEtudes();
  } catch (err) {
    log.warn('sécurité : rattachement des études impossible', err);
  }
  const tour = () => {
    try {
      tourneeSecurite();
    } catch (err) {
      log.warn('sécurité : tournée impossible', err);
    }
  };
  setTimeout(tour, 120_000).unref?.();
  const minuteur = setInterval(tour, BATTEMENT_MS);
  minuteur.unref?.();
  return minuteur;
}

/* ------------------------------------------------------------------ */
/* La preuve après la mise en ligne                                    */
/* ------------------------------------------------------------------ */

/**
 * DES CARTES VIENNENT D'ÊTRE MISES EN LIGNE : celles qui portent des points en correction relancent l'audit de leur
 * projet. Jamais d'exception : la publication appelle ceci après coup, et rien ne doit la faire échouer.
 */
export function apresMiseEnLigne(cardIds: readonly string[]): number {
  if (!cardIds.length) return 0;
  try {
    const marques = cardIds.map(() => '?').join(',');
    const lignes = getDb()
      .prepare(`SELECT DISTINCT project_id, card_id FROM securite_points WHERE etat = 'en-correction' AND card_id IN (${marques})`)
      .all(...cardIds) as { project_id: string; card_id: string }[];
    const parProjet = new Map<string, string[]>();
    for (const l of lignes) parProjet.set(l.project_id, [...(parProjet.get(l.project_id) ?? []), l.card_id]);
    for (const [projectId, cartes] of parProjet) lancerAudit(projectId, 'apres-mise-en-ligne', cartes);
    return parProjet.size;
  } catch (err) {
    log.warn('sécurité : contrôle après mise en ligne impossible', err);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* La carte de correction                                              */
/* ------------------------------------------------------------------ */

/** L'agent de sécurité de ce projet ? Rend le projet suivi, sinon `null`. */
export function projetDeLAgentDeSecurite(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  try {
    const l = getDb().prepare('SELECT project_id FROM securite_projets WHERE agent_id = ?').get(agentId) as { project_id: string } | undefined;
    return l?.project_id ?? null;
  } catch {
    return null;
  }
}

/**
 * L'AGENT PROPOSE UNE CARTE QUI EMPORTE DES POINTS (outil `board_create_card`, champ `points_securite`). Rend les
 * empreintes retenues (celles qui sont à traiter), ou un refus en clair.
 */
export function noterPropositionDeCorrection(
  agentId: string,
  proposalId: string,
  demandes: readonly string[],
): { ok: true; empreintes: string[] } | { ok: false; raison: string } {
  const projectId = projetDeLAgentDeSecurite(agentId);
  if (!projectId) return { ok: false, raison: 'Seul l’agent de sécurité d’un projet suivi peut lier une carte à un audit.' };
  const empreintes = pointsACorriger(pointsDuProjet(projectId), demandes);
  if (!empreintes.length)
    return { ok: false, raison: 'Aucun de ces points n’est « à traiter » dans le dernier audit : reprends les empreintes entre crochets du rapport.' };
  const audit = dernierAuditReussi(projectId);
  getDb()
    .prepare('INSERT OR REPLACE INTO securite_propositions (proposal_id, project_id, audit_id, empreintes, cree_le) VALUES (?, ?, ?, ?, ?)')
    .run(proposalId, projectId, audit?.id ?? null, JSON.stringify(empreintes), Date.now());
  return { ok: true, empreintes };
}

/** La proposition est acceptée : ses points passent « en correction », liés à la carte née. */
export function apresDecisionDeProposition(proposalId: string, cardId: string | undefined): void {
  try {
    const db = getDb();
    const l = db.prepare('SELECT * FROM securite_propositions WHERE proposal_id = ?').get(proposalId) as
      | { project_id: string; empreintes: string }
      | undefined;
    if (!l) return;
    if (!cardId) {
      db.prepare('DELETE FROM securite_propositions WHERE proposal_id = ?').run(proposalId);
      return;
    }
    const empreintes = JSON.parse(l.empreintes) as string[];
    const maj = db.prepare(
      "UPDATE securite_points SET etat = 'en-correction', card_id = ?, mis_a_jour_le = ? WHERE project_id = ? AND empreinte = ? AND etat = 'a-traiter'",
    );
    db.transaction(() => empreintes.forEach((e) => maj.run(cardId, Date.now(), l.project_id, e)))();
    diffuser(l.project_id);
  } catch (err) {
    log.warn('sécurité : liaison de la carte de correction impossible', err);
  }
}

/* ------------------------------------------------------------------ */
/* La correction groupée (« Corriger la sélection »)                   */
/* ------------------------------------------------------------------ */

export interface ResultatDeCorrectionGroupee {
  /** Les cartes créées ET lancées, une par projet retenu. */
  cartes: { projectId: string; cardId: string; points: number }[];
  /** Les projets écartés, avec leur raison en mots courants. */
  ecartes: { projectId: string; raison: string }[];
}

type Lanceur = (cardId: string) => Promise<{ ok: boolean; error?: string }>;
let lanceur: Lanceur | null = null;
/** Pour les contrôles seulement : compter les lancements au lieu de lancer un moteur. */
export function remplacerLeLanceur(autre: Lanceur | null): void {
  lanceur = autre;
}

/**
 * « CORRIGER LA SÉLECTION » (carte « Fil d'Ariane et corrections sécurité », 16/11/2026) : pour chaque projet coché
 * dans la liste, UNE carte de correction qui emporte TOUS ses points encore « à traiter », du plus grave au plus
 * léger, CRÉÉE PUIS LANCÉE AUSSITÔT — le clic de l'utilisateur sur le bouton vaut le geste de création et de
 * lancement (décision du cadrage). C'est le démon qui orchestre, sans moteur : la carte est rédigée depuis le rapport
 * (`carteDeCorrectionGroupee`), ses points passent « en correction » liés à elle, et sa mise en ligne relance l'audit.
 * Un projet sans point à traiter (rien relevé, ou tout déjà « en correction ») est écarté et dit pourquoi : aucune
 * carte en double. Les lancements partent l'un après l'autre en tâche de fond, par le chemin commun (`startCard`) :
 * la file et les quotas s'appliquent comme à un clic « Lancer ».
 */
export async function corrigerLaSelection(projets: readonly string[]): Promise<ResultatDeCorrectionGroupee> {
  const resultat: ResultatDeCorrectionGroupee = { cartes: [], ecartes: [] };
  const [{ createCard }, { catalogueMoteurs }] = await Promise.all([import('./tools.js'), import('./catalogue-moteurs.js')]);
  const catalogue = await catalogueMoteurs().catch(() => []);
  const db = getDb();
  for (const projectId of [...new Set(projets)]) {
    const projet = store.getProject(projectId);
    if (!projet) {
      resultat.ecartes.push({ projectId, raison: 'projet introuvable' });
      continue;
    }
    if (!estSuivi(projectId)) {
      resultat.ecartes.push({ projectId, raison: 'projet non suivi' });
      continue;
    }
    const audit = dernierAuditReussi(projectId);
    if (!audit?.rapport) {
      resultat.ecartes.push({ projectId, raison: 'aucun audit terminé' });
      continue;
    }
    const constats = pointsDeLaCorrectionGroupee(audit.rapport, pointsDuProjet(projectId));
    if (!constats.length) {
      resultat.ecartes.push({ projectId, raison: 'rien à traiter' });
      continue;
    }
    const { titre, description } = carteDeCorrectionGroupee(projet.name, constats);
    const moteur = projet.defaultEngine ?? 'claude';
    const fiche = catalogue.find((m) => m.id === moteur);
    const reglages = fiche ? reglagesDuNiveau(fiche, niveauDeLaCorrection(constats)) : null;
    const card = createCard(projectId, {
      title: titre,
      description,
      origin: 'user',
      ...(reglages ? { run: { engine: moteur as any, model: reglages.model, thinking: reglages.thinking as any } } : {}),
    });
    bus.emit({ type: 'card.upsert', card });
    const maj = db.prepare(
      "UPDATE securite_points SET etat = 'en-correction', card_id = ?, mis_a_jour_le = ? WHERE project_id = ? AND empreinte = ? AND etat = 'a-traiter'",
    );
    db.transaction(() => constats.forEach((c) => maj.run(card.id, Date.now(), projectId, empreinteDuConstat(c))))();
    diffuser(projectId);
    resultat.cartes.push({ projectId, cardId: card.id, points: constats.length });
  }
  if (resultat.cartes.length) {
    const lancer: Lanceur = lanceur ?? (async (id) => (await import('./scheduler.js')).startCard(id));
    const ids = resultat.cartes.map((c) => c.cardId);
    void (async () => {
      for (const id of ids) {
        const r = await lancer(id).catch((err: any) => ({ ok: false, error: String(err?.message ?? err) }));
        if (!r.ok) log.warn(`sécurité : la carte de correction ${id} n'a pas pu partir — ${r.error ?? 'raison inconnue'}`);
      }
      bus.emit({ type: 'attention', ...store.signalAttention() });
    })();
  }
  log.info(`sécurité : correction groupée — ${resultat.cartes.length} carte(s), ${resultat.ecartes.length} projet(s) écarté(s)`);
  return resultat;
}

/* ------------------------------------------------------------------ */
/* L'agent du projet                                                   */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DE L'AGENT DE SÉCURITÉ, redite à CHAQUE message avec le dernier rapport (le contexte du tour, jamais une
 * bulle) : l'agent lit toujours l'audit à jour, même au fil d'une longue conversation.
 */
export function contexteDeLAgentSecurite(agent: Pick<Agent, 'id'>): string | undefined {
  const projectId = projetDeLAgentDeSecurite(agent.id);
  if (!projectId) return undefined;
  const projet = store.getProject(projectId);
  const audit = dernierAuditReussi(projectId);
  const quand = audit ? new Date(audit.lance).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '';
  return [
    `TU ES L'AGENT DE SÉCURITÉ DU PROJET « ${projet?.name ?? projectId} » (service « Sécurité » de Beluga). Dossier : ${projet?.path ?? '?'}.`,
    'Ton rôle : expliquer le rapport d’audit ci-dessous en mots simples, mener à la demande une étude approfondie (compétence « beluga-controle-de-securite-d-un-projet », section « Étude complète », et la relecture statique « security-audit-static »), puis PRÉPARER LA CORRECTION.',
    'TU NE MODIFIES AUCUN FICHIER DU PROJET : tu lis, tu expliques, tu proposes. La correction se fait dans une carte, lancée par l’utilisateur.',
    'CARTE DE CORRECTION : quand l’utilisateur demande de corriger des points (ses lignes « Corriger : … »), regroupe-les en UNE SEULE carte avec l’outil board_create_card — champ « projet » = ce projet, champ « points_securite » = la liste des empreintes entre crochets de ces points (ex. ["entetes:entete-csp"]). La description reprend pour chaque point ce qui risque, ce qu’on propose, où regarder, et une ligne **Vérification** : « le contrôle de sécurité relancé ne remonte plus ce point ». La carte se crée d’un clic de l’utilisateur ; une fois mise en ligne, un audit repasse seul et prouve la correction.',
    'Ne recopie JAMAIS la valeur d’une clé, d’un mot de passe ou d’un jeton : nomme seulement le fichier.',
    '',
    'RAPPORT D’AUDIT (empreinte entre crochets · gravité · état · titre) :',
    rapportPourLAgent(audit?.rapport ?? null, pointsDuProjet(projectId), quand),
  ].join('\n');
}

/** L'agent du projet : créé une fois (sa carte d'abord — MEM-0448 —, rangée aussitôt : aucun tour ne part). */
export async function assurerLAgent(projectId: string): Promise<string> {
  const l = ligneProjet(projectId);
  if (!l) throw new Error('projet non suivi');
  if (l.agent_id && store.getAgent(l.agent_id)) return l.agent_id;
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  const [{ ouvrirCarteDAgent, rangerCarteDAgent }, { catalogueMoteurs }] = await Promise.all([
    import('./carte-d-agent-demon.js'),
    import('./catalogue-moteurs.js'),
  ]);
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  const reglages = claude ? reglagesDuNiveau(claude, 'standard') : { model: undefined, thinking: 'none' };
  // Relu après l'attente du catalogue : deux appels rapprochés ne font qu'un agent.
  const relue = ligneProjet(projectId);
  if (!relue) throw new Error('projet non suivi');
  if (relue.agent_id && store.getAgent(relue.agent_id)) return relue.agent_id;
  const { card, agentId } = ouvrirCarteDAgent({
    projectId,
    titre: `Sécurité de ${projet.name}`,
    description: `L’agent de sécurité de « ${projet.name} » : il lit l’audit de chaque semaine, mène une étude approfondie sur demande et prépare la carte de correction.`,
    labels: [LABEL_SECURITE],
    role: 'task',
    run: { engine: 'claude', model: reglages.model, thinking: reglages.thinking as any },
  });
  rangerCarteDAgent(card.id, agentId, 'archived', null);
  getDb().prepare('UPDATE securite_projets SET agent_id = ?, card_id = ? WHERE project_id = ?').run(agentId, card.id, projectId);
  diffuser(projectId);
  return agentId;
}

