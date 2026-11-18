/**
 * L'ESPACE COMMUNICATION, CÔTÉ DÉMON : les marques, et ce que chaque lieu lit.
 *
 * RIEN N'EST REFAIT : ce module ne fait que regarder ensemble, par marque, ce que les services
 * réunis rangent déjà par projet (`marketing.ts`, `publication-sociale.ts`, `medias-livres.ts`,
 * Studio). Toute lecture passe par la liste des projets de la marque ; une écriture vise le projet
 * d'origine de l'élément, ou le projet principal de la marque.
 *
 * Les droits : un accès tiers ne voit que les marques dont il voit un projet, et de ces marques
 * seulement ses projets (`projetsVisibles`). L'analyse approfondie reste au propriétaire.
 *
 * Chargé à la demande par `ws.ts` et `tools.ts` : il dépend de modules qui dépendent d'eux.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SANS_CAMPAGNE,
  campagneDuMedia,
  SERVICE_DU_DIRECTEUR,
  pieceVenueDUneConstruction,
  CANAUX_SANS_PUBLICATION,
  FICHES_RESEAUX,
  RESEAUX_SOCIAUX,
  estReseauSocial,
  envoiParChromeDuContenu,
  instantPrevu,
  MESURES_D_OBJECTIF,
  STATUTS_D_OBJECTIF,
  avancementDObjectif,
  baseDeCampagneVerrouillee,
  CHAMPS_LIBRES_SOUS_VERROU,
  datesDeCampagneValides,
  pointsManquantsDeCampagne,
  refusFicheIncomplete,
  LIBELLES_DES_POINTS,
  lireStrategie as lireStrategieDeCampagne,
  fusionnerStrategie,
  rubriquesManquantes,
  refusStrategieIncomplete,
  lireSuppression,
  publicationARetablir,
  publicationAAnnuler,
  cleDuChefDeCampagne,
  DUREE_DE_LA_CORBEILLE_DES_CAMPAGNES_MS,
  type StrategieDeCampagne,
  type FabricationDeCampagne,
  type PointDeCampagne,
  cleDeRegroupement,
  demarcheDeLaMarque,
  droitsDuCompte,
  contenusDuCircuit,
  etatDeMedia,
  jourLePlusRegarde,
  mediaInterne,
  peutVoirProjet,
  regrouperLesMedias,
  reparationsDesLiens,
  declinaisonsAPoser,
  cleDesVersions,
  trierLesMedias,
  regroupementsAProposer,
  resumerLeRapport,
  tempsDeReponseMedian,
  type CompteUtilisateur,
  type ContenuMarketing,
  type DemarcheDeMarque,
  type EtapeDeDemarcheId,
  type MesureDObjectif,
  type ObjectifDeMarque,
  type StatutDObjectif,
  type LigneDeMedia,
  type MarqueCommunication,
  type MediaRegroupe,
  type OrigineDeMarque,
  type RegroupementPropose,
  Project,
  type EntreeDesEtapesV2,
  campagnePrete,
  statutAfficheDeCampagne,
  visuelsDeLaCampagne,
  apercuDeCampagne,
  pieceDeConception,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { assurerEspace, diffuser, ecrireActif, ecrireConfiguration, ecrireFiche, listerActions, listerContenus, lireContenu, lireEspace, listerEspaces } from './marketing.js';
import { ciblesDuProjet, listerApplications, listerComptes, listerMessages, vueDAudienceDuProjet as audienceDuProjet } from './publication-sociale.js';
import { visuelsDuContenu } from './visuels-marketing.js';
import { importerPieceJointe } from './studio.js';

type Compte = Pick<CompteUtilisateur, 'id' | 'role' | 'projets'>;

const CLE_REGROUPEMENTS_REFUSES = 'communication.regroupements.refuses';

interface LigneMarque {
  id: string;
  nom: string;
  origine: string;
  adresse: string | null;
  description: string | null;
  projet_principal: string | null;
  niveau: number;
  quetes: string;
  cree_le: number;
  maj_le: number;
}

function projetsDeLaMarque(marqueId: string, principal?: string | null): string[] {
  const lignes = getDb().prepare('SELECT project_id FROM communication_marque_projets WHERE marque_id = ?').all(marqueId) as { project_id: string }[];
  const ids = lignes.map((l) => l.project_id).filter((id) => !!store.getProject(id));
  return principal ? [...ids.filter((i) => i === principal), ...ids.filter((i) => i !== principal)] : ids;
}

function versMarque(l: LigneMarque): MarqueCommunication {
  let quetes: string[] = [];
  try {
    const lu = JSON.parse(l.quetes);
    if (Array.isArray(lu)) quetes = lu.filter((q) => typeof q === 'string');
  } catch {
    /* une mémoire illisible repart de ce qui se vérifie */
  }
  return {
    id: l.id,
    nom: l.nom,
    origine: l.origine as OrigineDeMarque,
    ...(l.adresse ? { adresse: l.adresse } : {}),
    ...(l.description ? { description: l.description } : {}),
    projets: projetsDeLaMarque(l.id, l.projet_principal),
    projetPrincipal: l.projet_principal,
    niveau: l.niveau,
    quetes,
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

/** Le projet principal d'un groupe : l'espace actif avec un rapport, à défaut l'espace le plus rempli. */
function projetPrincipal(ids: readonly string[]): string | null {
  const notes = ids.map((id) => {
    const espace = lireEspace(id);
    const contenus = (getDb().prepare('SELECT COUNT(*) AS n FROM marketing_contenus WHERE project_id = ?').get(id) as { n: number }).n;
    return { id, note: (espace?.actif ? 1000 : 0) + (espace?.rapport ? 500 : 0) + contenus };
  });
  return notes.sort((a, b) => b.note - a.note)[0]?.id ?? null;
}

function diffuserMarques(): void {
  bus.emit({ type: 'communication.marques' });
}

/** La même diffusion, pour Communication 2 : la fin d'un travail en coulisses fait relire les pages ouvertes. */
export const diffuserLesMarques = diffuserMarques;

/**
 * LES MARQUES DE DÉPART : chaque projet déjà suivi par les réseaux sociaux en fait une, à lui seul. Les
 * regroupements se PROPOSENT, ils ne s'appliquent jamais seuls (`regroupementsAProposer`).
 */
export function assurerLesMarques(maintenant = Date.now()): void {
  const db = getDb();
  const dejaDansUneMarque = new Set((db.prepare('SELECT project_id FROM communication_marque_projets').all() as { project_id: string }[]).map((l) => l.project_id));
  for (const espace of listerEspaces()) {
    if (!espace.actif || dejaDansUneMarque.has(espace.projectId)) continue;
    const projet = store.getProject(espace.projectId);
    if (!projet || projet.archived) continue;
    const id = store.newId();
    db.prepare(
      'INSERT INTO communication_marques (id, nom, origine, adresse, projet_principal, niveau, quetes, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
    ).run(id, projet.name, 'projets', espace.configuration.adresse ?? null, projet.id, '[]', maintenant, maintenant);
    db.prepare('INSERT OR IGNORE INTO communication_marque_projets (project_id, marque_id) VALUES (?, ?)').run(projet.id, id);
  }
  suivreLeNomDesProjets(maintenant);
}

/**
 * UNE MARQUE NÉE D'UN SEUL PROJET PORTE SON NOM, ET LE GARDE À JOUR. Le nom (et l'adresse) étaient COPIÉS à la
 * création : renommer le projet laissait l'ancien nom dans tout Communication (Justcrazy → Wogo, 08/11/2026).
 * Seules les marques « projets » à UN projet suivent — une marque qui en réunit plusieurs a un nom choisi.
 */
function suivreLeNomDesProjets(maintenant: number): void {
  const db = getDb();
  const seules = db
    .prepare(
      `SELECT m.id, m.nom, m.adresse, mp.project_id FROM communication_marques m
         JOIN communication_marque_projets mp ON mp.marque_id = m.id
        WHERE m.origine = 'projets'
          AND (SELECT COUNT(*) FROM communication_marque_projets x WHERE x.marque_id = m.id) = 1`,
    )
    .all() as { id: string; nom: string; adresse: string | null; project_id: string }[];
  for (const m of seules) {
    const projet = store.getProject(m.project_id);
    if (!projet) continue;
    const adresse = lireEspace(m.project_id)?.configuration.adresse ?? m.adresse;
    if (projet.name === m.nom && adresse === m.adresse) continue;
    db.prepare('UPDATE communication_marques SET nom = ?, adresse = ?, maj_le = ? WHERE id = ?').run(projet.name, adresse ?? null, maintenant, m.id);
  }
}

export function lireMarque(id: string): MarqueCommunication | null {
  const l = getDb().prepare('SELECT * FROM communication_marques WHERE id = ?').get(id) as LigneMarque | undefined;
  return l ? versMarque(l) : null;
}

export function marqueDuProjet(projectId: string): MarqueCommunication | null {
  const l = getDb().prepare('SELECT marque_id FROM communication_marque_projets WHERE project_id = ?').get(projectId) as { marque_id: string } | undefined;
  return l ? lireMarque(l.marque_id) : null;
}

export function listerToutesLesMarques(): MarqueCommunication[] {
  assurerLesMarques();
  return (getDb().prepare('SELECT * FROM communication_marques ORDER BY nom COLLATE NOCASE').all() as LigneMarque[]).map(versMarque);
}

const compteVoitTout = (compte: Compte) => compte.role === 'admin';

/** Les projets de la marque que ce compte voit : c'est CETTE liste qui borne toutes les lectures. */
export function projetsVisibles(marque: MarqueCommunication, compte: Compte): string[] {
  return compteVoitTout(compte) ? marque.projets : marque.projets.filter((id) => peutVoirProjet(compte, id));
}

function marquePourLeCompte(id: string, compte: Compte): { marque: MarqueCommunication; projets: string[] } {
  const marque = lireMarque(id);
  if (!marque) throw new Error('marque introuvable');
  const projets = projetsVisibles(marque, compte);
  if (!projets.length && !compteVoitTout(compte)) throw new Error('marque introuvable');
  return { marque, projets };
}

/**
 * COMMUNICATION 2 : une demande au chef en coulisses se refuse à qui ne fait que « voir » tous les projets de la
 * marque — elle engage du travail, comme un geste.
 */
export function marqueEnTravail(marqueId: string, compte: Compte): { marque: MarqueCommunication; projets: string[] } {
  const r = marquePourLeCompte(marqueId, compte);
  if (compteVoitTout(compte)) return r;
  const droits = droitsDuCompte(compte as CompteUtilisateur);
  if (!r.projets.some((p) => droits.projets[p] && droits.projets[p] !== 'voir')) throw new Error('Votre accès ne permet pas ce geste sur cette marque.');
  return r;
}

function projetDansLaMarque(projectId: string, compte: Compte): void {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  if (!compteVoitTout(compte) && !peutVoirProjet(compte, projectId)) throw new Error('projet introuvable');
}

/* ------------------------------------------------------------------ */
/* Créer, réunir                                                        */
/* ------------------------------------------------------------------ */

/**
 * LE SUPPORT D'UNE MARQUE SANS PROJET. Une entreprise ou une idée range sa fiche, ses contenus et ses médias
 * dans les mêmes tables que les autres : un projet « mis de côté », sans dépôt (`marqueSansDepot`). Ce choix
 * évite une seconde clé dans dix tables ; il ne paraît dans aucune liste, et sans dépôt aucune carte de code
 * ne peut y naître (`scheduler.ts` les refuse).
 */
function projetSansDepot(nom: string): string {
  const id = store.newId();
  const dossier = path.join(CONFIG.dataDir, 'marques', id);
  fs.mkdirSync(dossier, { recursive: true });
  store.saveProject(Project.parse({ id, name: nom, path: dossier, archived: true, marqueSansDepot: true, createdAt: store.now(), updatedAt: store.now() }));
  return id;
}

export function creerMarque(
  entree: { nom?: unknown; origine?: unknown; projets?: unknown; adresse?: unknown; description?: unknown },
  compte: Compte,
  maintenant = Date.now(),
): MarqueCommunication {
  const nom = String(entree.nom ?? '').trim().slice(0, 80);
  if (!nom) throw new Error('Donnez un nom à cette marque.');
  const origine = (['projets', 'entreprise', 'idee'] as const).find((o) => o === entree.origine) ?? 'projets';
  const demandes = Array.isArray(entree.projets) ? entree.projets.filter((p): p is string => typeof p === 'string') : [];
  for (const id of demandes) projetDansLaMarque(id, compte);
  if (origine === 'projets' && !demandes.length) throw new Error('Choisissez au moins un projet.');
  const adresse = String(entree.adresse ?? '').trim().slice(0, 300);
  const description = String(entree.description ?? '').trim().slice(0, 4000);
  if (origine === 'entreprise' && !adresse) throw new Error('Donnez l’adresse de l’entreprise.');
  if (origine === 'idee' && !description) throw new Error('Décrivez l’idée en quelques phrases.');
  const projets = demandes.length ? demandes : [projetSansDepot(nom)];
  const id = store.newId();
  const principal = projetPrincipal(projets);
  const db = getDb();
  /* UNE MARQUE SE SUIT : son projet principal rejoint la mesure des réseaux, sans rien lancer. */
  if (principal) {
    assurerEspace(principal);
    ecrireActif(principal, true);
  }
  db.transaction(() => {
    db.prepare(
      'INSERT INTO communication_marques (id, nom, origine, adresse, description, projet_principal, niveau, quetes, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
    ).run(id, nom, origine, adresse || null, description || null, principal, '[]', maintenant, maintenant);
    for (const projet of projets) deplacerLeProjet(projet, id);
  })();
  retirerLesMarquesVides();
  if (description && principal) ecrireFiche(principal, { probleme: description });
  diffuserMarques();
  return lireMarque(id)!;
}

/** Un projet appartient à UNE marque au plus : le ranger ailleurs le retire de la précédente. */
function deplacerLeProjet(projectId: string, marqueId: string): void {
  getDb()
    .prepare('INSERT INTO communication_marque_projets (project_id, marque_id) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET marque_id = excluded.marque_id')
    .run(projectId, marqueId);
}

/** Une marque qu'un regroupement vient de vider n'a plus lieu d'être, sauf si elle a une vie à elle (campagnes). */
function retirerLesMarquesVides(): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM communication_marques WHERE origine = 'projets'
       AND id NOT IN (SELECT marque_id FROM communication_marque_projets)
       AND id NOT IN (SELECT marque_id FROM communication_campagnes)`,
  ).run();
}

/** RÉUNIR : valider un regroupement proposé. Rien ne bouge dans les projets ; le plus haut niveau atteint est gardé. */
export function reunirLesProjets(entree: { nom?: unknown; projets?: unknown }, compte: Compte, maintenant = Date.now()): MarqueCommunication {
  const nom = String(entree.nom ?? '').trim().slice(0, 80);
  const projets = Array.isArray(entree.projets) ? [...new Set(entree.projets.filter((p): p is string => typeof p === 'string'))] : [];
  if (!nom) throw new Error('Donnez un nom à cette marque.');
  if (projets.length < 2) throw new Error('Il faut au moins deux projets pour les réunir.');
  for (const id of projets) projetDansLaMarque(id, compte);
  const anciennes = projets.map((p) => marqueDuProjet(p)).filter((m): m is MarqueCommunication => !!m);
  const niveau = Math.max(1, ...anciennes.map((m) => m.niveau));
  const quetes = [...new Set(anciennes.flatMap((m) => m.quetes))];
  const db = getDb();
  /* LA MARQUE QUI PORTE DÉJÀ DES CAMPAGNES RESTE LA MÊME : on y ajoute les autres projets. */
  const garde = anciennes.find((m) => (db.prepare('SELECT 1 FROM communication_campagnes WHERE marque_id = ? LIMIT 1').get(m.id) as unknown) != null) ?? anciennes[0];
  const id = garde?.id ?? store.newId();
  const principal = projetPrincipal(projets);
  db.transaction(() => {
    if (garde) {
      db.prepare('UPDATE communication_marques SET nom = ?, projet_principal = ?, niveau = ?, quetes = ?, maj_le = ? WHERE id = ?').run(nom, principal, niveau, JSON.stringify(quetes), maintenant, id);
    } else {
      db.prepare('INSERT INTO communication_marques (id, nom, origine, projet_principal, niveau, quetes, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, nom, 'projets', principal, niveau, JSON.stringify(quetes), maintenant, maintenant);
    }
    for (const projet of projets) deplacerLeProjet(projet, id);
  })();
  retirerLesMarquesVides();
  diffuserMarques();
  return lireMarque(id)!;
}

/** Sortir un projet d'une marque : il redevient une marque à lui seul à la prochaine lecture s'il est suivi. */
export function retirerUnProjet(marqueId: string, projectId: string, compte: Compte): MarqueCommunication {
  const { marque } = marquePourLeCompte(marqueId, compte);
  if (marque.projets.length < 2) throw new Error('Cette marque n’a que ce projet.');
  getDb().prepare('DELETE FROM communication_marque_projets WHERE project_id = ? AND marque_id = ?').run(projectId, marqueId);
  if (marque.projetPrincipal === projectId) getDb().prepare('UPDATE communication_marques SET projet_principal = ? WHERE id = ?').run(projetPrincipal(marque.projets.filter((p) => p !== projectId)), marqueId);
  diffuserMarques();
  return lireMarque(marqueId)!;
}

export function renommerMarque(marqueId: string, nom: unknown, compte: Compte): MarqueCommunication {
  marquePourLeCompte(marqueId, compte);
  const propre = String(nom ?? '').trim().slice(0, 80);
  if (!propre) throw new Error('Donnez un nom à cette marque.');
  getDb().prepare('UPDATE communication_marques SET nom = ?, maj_le = ? WHERE id = ?').run(propre, Date.now(), marqueId);
  diffuserMarques();
  return lireMarque(marqueId)!;
}

function regroupementsRefuses(): Set<string> {
  try {
    const lu = JSON.parse(getMeta(CLE_REGROUPEMENTS_REFUSES) ?? '[]');
    return new Set(Array.isArray(lu) ? lu : []);
  } catch {
    return new Set();
  }
}

export function refuserRegroupement(nom: unknown): void {
  const refuses = regroupementsRefuses();
  refuses.add(cleDeRegroupement(String(nom ?? '')));
  setMeta(CLE_REGROUPEMENTS_REFUSES, JSON.stringify([...refuses]));
  diffuserMarques();
}

export function propositionsDeRegroupement(compte: Compte): RegroupementPropose[] {
  const db = getDb();
  /* UN PROJET DÉJÀ RÉUNI À D'AUTRES n'est plus proposé ; celui qui est seul dans sa marque peut l'être. */
  const lignes = db.prepare('SELECT marque_id, COUNT(*) AS n FROM communication_marque_projets GROUP BY marque_id HAVING n > 1').all() as { marque_id: string }[];
  const reunis = new Set(lignes.flatMap((l) => projetsDeLaMarque(l.marque_id)));
  const projets = store.listProjects().filter((p) => compteVoitTout(compte) || peutVoirProjet(compte, p.id));
  return regroupementsAProposer(projets, { projetsReunis: reunis, refuses: regroupementsRefuses() });
}

/* ------------------------------------------------------------------ */
/* Les chiffres d'une marque                                            */
/* ------------------------------------------------------------------ */

const JOUR_MS = 86_400_000;

const jourLocal = (instant: number) => {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const marques = (projets: readonly string[]) => projets.map(() => '?').join(',');

/** Les visites de la période, jour par jour : une visite comptée une fois, le jour de sa première page. */
export function visitesParJour(projets: readonly string[], depuis: number, jusqua = Number.MAX_SAFE_INTEGER): Map<string, number> {
  const parJour = new Map<string, Set<string>>();
  if (!projets.length) return new Map();
  const lignes = getDb()
    .prepare(`SELECT instant, visite FROM marketing_evenements WHERE project_id IN (${marques(projets)}) AND instant >= ? AND instant < ? AND type = 'vue'`)
    .all(...projets, depuis, jusqua) as { instant: number; visite: string | null }[];
  const vues = new Set<string>();
  for (const l of lignes) {
    const cle = l.visite ?? `${l.instant}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    const jour = jourLocal(l.instant);
    const ensemble = parJour.get(jour) ?? new Set<string>();
    ensemble.add(cle);
    parJour.set(jour, ensemble);
  }
  return new Map([...parJour].map(([j, s]) => [j, s.size]));
}

/** La série de visites sur `periode` jours, sans trou, du plus ancien au plus récent. */
function serieDeVisites(projets: readonly string[], periode: number, maintenant: number): { jour: string; valeur: number }[] {
  const parJour = visitesParJour(projets, maintenant - periode * JOUR_MS, maintenant + JOUR_MS);
  return Array.from({ length: periode }, (_, i) => {
    const jour = jourLocal(maintenant - (periode - 1 - i) * JOUR_MS);
    return { jour, valeur: parJour.get(jour) ?? 0 };
  });
}

const somme = (lignes: readonly { valeur: number }[]) => lignes.reduce((t, l) => t + l.valeur, 0);

export interface TuilesDeMarque {
  vues: number | null;
  vuesCroissance: number | null;
  abonnes: number | null;
  abonnesEcart: number | null;
  reactions: number | null;
  visites: number;
  visitesAvant: number;
  serieVues: number[];
  serieVisites: number[];
  /** Un compte relié au moins, qui ouvre ses chiffres ? Sinon l'écran dit pourquoi c'est vide. */
  chiffresOuverts: boolean;
  /**
   * LES COMMENTAIRES REÇUS SUR LA PÉRIODE (tableau de bord, 04/11/2026). `null` sans aucun compte relié : l'écran
   * dit « Non communiqué », jamais un zéro qu'on n'a pas mesuré.
   */
  commentaires: number | null;
  /** LA CROISSANCE DES ABONNÉS SUR SEPT JOURS, en pour cent ; `null` quand aucun réseau ne la donne. */
  croissance7j: number | null;
}

async function tuilesDeMarque(projets: readonly string[], periode: number, maintenant: number): Promise<TuilesDeMarque> {
  const { vueDAudienceDuProjet } = await import('./publication-sociale.js');
  const vues = projets.map((p) => vueDAudienceDuProjet(p, periode, maintenant));
  const nombres = (f: (b: (typeof vues)[number]['bilan']) => number | null) => {
    const lus = vues.map((v) => f(v.bilan)).filter((n): n is number => n !== null);
    return lus.length ? lus.reduce((a, b) => a + b, 0) : null;
  };
  const longueur = vues[0]?.bilan.serieVues.length ?? 0;
  const serieVues = Array.from({ length: longueur }, (_, i) => vues.reduce((t, v) => t + (v.bilan.serieVues[i]?.vues ?? 0), 0));
  const serie = serieDeVisites(projets, periode, maintenant);
  const avant = visitesParJour(projets, maintenant - 2 * periode * JOUR_MS, maintenant - periode * JOUR_MS);
  const ecartVues = nombres((b) => b.croissanceVues?.ecart ?? null);
  const totalVues = nombres((b) => b.vues);
  return {
    vues: totalVues,
    vuesCroissance: totalVues !== null && ecartVues !== null && totalVues - ecartVues > 0 ? Math.round((ecartVues / (totalVues - ecartVues)) * 100) : null,
    abonnes: nombres((b) => b.abonnes),
    abonnesEcart: nombres((b) => b.croissanceAbonnes?.ecart ?? null),
    reactions: nombres((b) => b.reactions),
    visites: somme(serie),
    visitesAvant: [...avant.values()].reduce((a, b) => a + b, 0),
    serieVues,
    serieVisites: serie.map((s) => s.valeur),
    chiffresOuverts: vues.some((v) => v.reseaux.some((r) => r.ouvert)),
    commentaires: commentairesRecus(projets, periode, maintenant),
    croissance7j: croissanceSurSeptJours(projets.map((p) => vueDAudienceDuProjet(p, 7, maintenant).bilan)),
  };
}

/** Les commentaires reçus sur la période, sur tous les comptes reliés de la marque ; `null` sans compte relié. */
function commentairesRecus(projets: readonly string[], periode: number, maintenant: number): number | null {
  if (!projets.some((p) => listerComptes(p).some((c) => c.etat === 'relie'))) return null;
  const depuis = maintenant - periode * JOUR_MS;
  return projets.flatMap((p) => listerMessages(p)).filter((m) => m.genre === 'commentaire' && !m.sortant && m.instant >= depuis).length;
}

/** L'évolution des abonnés sur sept jours, en pour cent, d'après les réseaux qui la donnent. */
function croissanceSurSeptJours(bilans: readonly { abonnes: number | null; croissanceAbonnes?: { ecart: number } | null }[]): number | null {
  let total = 0;
  let ecart = 0;
  let lus = 0;
  for (const b of bilans) {
    if (b.abonnes === null || !b.croissanceAbonnes) continue;
    total += b.abonnes;
    ecart += b.croissanceAbonnes.ecart;
    lus += 1;
  }
  if (!lus || total - ecart <= 0) return null;
  return Math.round((ecart / (total - ecart)) * 1000) / 10;
}

/* ------------------------------------------------------------------ */
/* Les publications et leurs chiffres                                   */
/* ------------------------------------------------------------------ */

export interface ChiffresDePublication {
  vues: number | null;
  reactions: number | null;
  commentaires: number | null;
  clics: number;
  visites: number;
  serie: number[];
  publieLe: number | null;
  reseauxPublies: string[];
  url: string | null;
}

/** Les chiffres de chaque contenu : le dernier relevé de ses publications, ses clics et ses visites. */
function chiffresDesContenus(projets: readonly string[], depuis = 0): Map<string, ChiffresDePublication> {
  const parContenu = new Map<string, ChiffresDePublication>();
  if (!projets.length) return parContenu;
  const db = getDb();
  const assurer = (id: string) => {
    let c = parContenu.get(id);
    if (!c) {
      c = { vues: null, reactions: null, commentaires: null, clics: 0, visites: 0, serie: [], publieLe: null, reseauxPublies: [], url: null };
      parContenu.set(id, c);
    }
    return c;
  };
  const publications = db
    .prepare(
      `SELECT p.contenu_id, p.compte_id, p.reseau, p.distant_id, p.url, p.publie_le FROM marketing_publications p
        JOIN marketing_contenus c ON c.id = p.contenu_id WHERE c.project_id IN (${marques(projets)}) AND p.etat = 'publie'`,
    )
    .all(...projets) as { contenu_id: string; compte_id: string; reseau: string; distant_id: string | null; url: string | null; publie_le: number | null }[];
  const releves = db
    .prepare(`SELECT compte_id, publication, jour, vues, commentaires, reactions FROM marketing_audience WHERE project_id IN (${marques(projets)}) AND publication <> '' ORDER BY jour`)
    .all(...projets) as { compte_id: string; publication: string; jour: string; vues: number | null; commentaires: number | null; reactions: number | null }[];
  const parPublication = new Map<string, typeof releves>();
  for (const r of releves) {
    const cle = `${r.compte_id}\n${r.publication}`;
    parPublication.set(cle, [...(parPublication.get(cle) ?? []), r]);
  }
  for (const p of publications) {
    const c = assurer(p.contenu_id);
    c.reseauxPublies.push(p.reseau);
    c.url ??= p.url;
    c.publieLe = Math.max(c.publieLe ?? 0, p.publie_le ?? 0) || null;
    const serie = p.distant_id ? parPublication.get(`${p.compte_id}\n${p.distant_id}`) : undefined;
    const dernier = serie?.[serie.length - 1];
    if (!dernier) continue;
    if (dernier.vues !== null) c.vues = (c.vues ?? 0) + dernier.vues;
    if (dernier.reactions !== null) c.reactions = (c.reactions ?? 0) + dernier.reactions;
    if (dernier.commentaires !== null) c.commentaires = (c.commentaires ?? 0) + dernier.commentaires;
    if (serie && (!c.serie.length || serie.length > c.serie.length)) c.serie = serie.map((r) => r.vues ?? 0);
  }
  const evenements = db
    .prepare(
      `SELECT contenu_id, type, COUNT(*) AS n, COUNT(DISTINCT visite) AS visites FROM marketing_evenements
        WHERE project_id IN (${marques(projets)}) AND contenu_id IS NOT NULL AND instant >= ? AND type IN ('clic', 'vue') GROUP BY contenu_id, type`,
    )
    .all(...projets, depuis) as { contenu_id: string; type: string; n: number; visites: number }[];
  for (const e of evenements) {
    const c = assurer(e.contenu_id);
    if (e.type === 'clic') c.clics = e.n;
    else c.visites = e.visites;
  }
  return parContenu;
}

export type ContenuLu = ContenuMarketing & { apercu: { attachmentId: string; genre: string } | null };

/** Les contenus d'une marque avec leurs cibles et leur aperçu : le visuel du contenu, ou le média qu'on lui a lié. */
function contenusDeLaMarque(projets: readonly string[]): ContenuLu[] {
  const db = getDb();
  const lies = new Map<string, string>();
  if (projets.length) {
    for (const l of db
      .prepare(`SELECT l.contenu_id, l.attachment_id FROM communication_media_contenu l JOIN marketing_contenus c ON c.id = l.contenu_id WHERE c.project_id IN (${marques(projets)}) ORDER BY l.cree_le`)
      .all(...projets) as { contenu_id: string; attachment_id: string }[]) {
      lies.set(l.contenu_id, l.attachment_id);
    }
  }
  return projets.flatMap((p) => {
    const cibles = ciblesDuProjet(p);
    /* SEULS LES CONTENUS QUI ONT UNE CARTE OU UNE CRÉATION CHERCHENT LEUR VISUEL : le chercher pour tous relisait toutes les cartes du projet autant de fois. */
    const avecVisuel = new Set<string>();
    for (const carte of store.listCards(p)) if (carte.realisation?.contenuMarketingId) avecVisuel.add(carte.realisation.contenuMarketingId);
    for (const l of db.prepare('SELECT contenu_marketing_id AS id FROM studio_creations WHERE project_id = ? AND contenu_marketing_id IS NOT NULL').all(p) as { id: string }[]) avecVisuel.add(l.id);
    return listerContenus(p).map((c): ContenuLu => {
      const lie = lies.get(c.id);
      const piece = lie ? store.getAttachment(lie) : null;
      const visuel = piece || !avecVisuel.has(c.id) ? null : visuelsDuContenu(p, c.id)[0] ?? null;
      const apercu = piece
        ? { attachmentId: piece.id, genre: piece.mime.startsWith('video') ? 'video' : 'image' }
        : visuel
          ? { attachmentId: visuel.attachmentId, genre: (visuel as { genre?: string }).genre ?? 'image' }
          : null;
      return { ...c, cibles: cibles.get(c.id) ?? [], apercu };
    });
  });
}

/* ------------------------------------------------------------------ */
/* Les médias                                                           */
/* ------------------------------------------------------------------ */

const genreDeLaPiece = (mime: string | undefined, genre?: string): 'image' | 'video' | 'son' => {
  if (genre === 'audio' || genre === 'son' || mime?.startsWith('audio')) return 'son';
  if (genre === 'video' || mime?.startsWith('video')) return 'video';
  return 'image';
};

/** Toutes les lignes de média d'une marque : les exports du Studio, les médias livrés, les pièces importées au Studio. */
function lignesDeMedia(projets: readonly string[]): LigneDeMedia[] {
  if (!projets.length) return [];
  const db = getDb();
  const lignes: LigneDeMedia[] = [];
  const pieces = new Set<string>();
  const exports_ = db
    .prepare(
      `SELECT e.id, e.project_id, e.creation_id, e.format, e.attachment_id, e.affiche_id, e.duree, e.version, e.cree_le, c.titre, c.card_id
         FROM studio_exports e JOIN studio_creations c ON c.id = e.creation_id
        WHERE e.project_id IN (${marques(projets)}) AND e.etat = 'pret' AND e.attachment_id IS NOT NULL`,
    )
    .all(...projets) as { id: string; project_id: string; creation_id: string; format: string | null; attachment_id: string; affiche_id: string | null; duree: number | null; version: number | null; cree_le: number; titre: string; card_id: string | null }[];
  for (const e of exports_) {
    pieces.add(e.attachment_id);
    lignes.push({
      cle: `export:${e.id}`,
      projectId: e.project_id,
      nom: e.titre,
      genre: 'video',
      origine: 'studio',
      attachmentId: e.attachment_id,
      afficheId: e.affiche_id,
      format: e.format,
      duree: e.duree,
      version: e.version,
      groupe: `creation:${e.creation_id}:${e.format ?? ''}`,
      creationId: e.creation_id,
      cardId: e.card_id,
      creeLe: e.cree_le,
    });
  }
  /* UNE CRÉATION ENCORE EN MONTAGE, SANS RIEN DE PRÊT, SE RETROUVE AUSSI : c'est d'ici qu'on rouvre le Studio. */
  const avecExport = new Set(exports_.map((e) => e.creation_id));
  const creations = db
    .prepare(`SELECT id, project_id, titre, formats, affiche_id, version, card_id, maj_le FROM studio_creations WHERE project_id IN (${marques(projets)})`)
    .all(...projets) as { id: string; project_id: string; titre: string; formats: string; affiche_id: string | null; version: number; card_id: string | null; maj_le: number }[];
  for (const c of creations) {
    if (avecExport.has(c.id)) continue;
    let format: string | null = null;
    try {
      format = (JSON.parse(c.formats) as string[]).join(' · ') || null;
    } catch {
      /* un format illisible ne cache pas la création */
    }
    lignes.push({ cle: `creation:${c.id}`, projectId: c.project_id, nom: c.titre, genre: 'video', origine: 'studio', attachmentId: null, afficheId: c.affiche_id, format, version: c.version, groupe: `creation:${c.id}`, creationId: c.id, cardId: c.card_id, enMontage: true, creeLe: c.maj_le });
  }
  const livres = db
    .prepare(`SELECT id, project_id, card_id, attachment_id, genre, groupe, version, sujet, outil, livre_le FROM medias_livres WHERE project_id IN (${marques(projets)})`)
    .all(...projets) as { id: string; project_id: string; card_id: string | null; attachment_id: string; genre: string; groupe: string; version: number; sujet: string; outil: string; livre_le: number }[];
  const retenus = new Set(
    (db.prepare(`SELECT attachment_id FROM medias_realisation WHERE project_id IN (${marques(projets)}) AND retenu_le IS NOT NULL AND attachment_id IS NOT NULL`).all(...projets) as { attachment_id: string }[]).map((l) => l.attachment_id),
  );
  const couts = new Map(
    (db.prepare(`SELECT attachment_id, COALESCE(cout_reel, prix) AS cout FROM medias_realisation WHERE project_id IN (${marques(projets)}) AND attachment_id IS NOT NULL`).all(...projets) as { attachment_id: string; cout: number | null }[]).map((l) => [l.attachment_id, l.cout]),
  );
  for (const l of livres) {
    if (pieces.has(l.attachment_id)) continue;
    /* LES PIÈCES DE CONCEPTION — maquettes d'un choix, esquisses d'une campagne — ne sont pas des médias de marque. */
    if (pieceDeConception({ outil: l.outil })) continue;
    pieces.add(l.attachment_id);
    lignes.push({
      cle: `livre:${l.id}`,
      projectId: l.project_id,
      nom: l.sujet,
      genre: genreDeLaPiece(undefined, l.genre),
      origine: 'genere',
      attachmentId: l.attachment_id,
      outil: l.outil,
      version: l.version,
      groupe: `livre:${l.card_id ?? ''}:${l.groupe}`,
      cardId: l.card_id,
      cout: couts.get(l.attachment_id) ?? null,
      retenu: retenus.has(l.attachment_id),
      creeLe: l.livre_le,
    });
  }
  const importes = db
    .prepare(`SELECT id, project_id, creation_id, genre, provenance, nom, attachment_id, mime, duree, largeur, hauteur, usage, cout, cree_le FROM studio_medias WHERE project_id IN (${marques(projets)}) AND attachment_id IS NOT NULL`)
    .all(...projets) as { id: string; project_id: string; creation_id: string | null; genre: string; provenance: string | null; nom: string; attachment_id: string; mime: string | null; duree: number | null; largeur: number | null; hauteur: number | null; usage: string | null; cout: number | null; cree_le: number }[];
  for (const m of importes) {
    if (pieces.has(m.attachment_id) || mediaInterne(m)) continue;
    pieces.add(m.attachment_id);
    lignes.push({
      cle: `piece:${m.id}`,
      projectId: m.project_id,
      nom: m.nom,
      genre: genreDeLaPiece(m.mime ?? undefined, m.genre),
      origine: 'importe',
      attachmentId: m.attachment_id,
      format: m.largeur && m.hauteur ? formatLisible(m.largeur, m.hauteur) : null,
      duree: m.duree,
      cout: m.cout,
      creationId: m.creation_id,
      creeLe: m.cree_le,
    });
  }
  return lignes;
}

/** Un format lisible : « 9:16 » plutôt que « 1000×1960 », et jamais des pixels à lire. */
export function formatLisible(largeur: number, hauteur: number): string {
  const r = largeur / hauteur;
  const connus: [string, number][] = [['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]];
  const proche = connus.find(([, v]) => Math.abs(v - r) < 0.07);
  if (proche) return proche[0];
  return r < 1 ? 'Portrait' : 'Paysage';
}

function etatsDesMedias(): Map<string, { etat: string | null; campagneId: string | null; retenueLe: number | null; supprimeLe: number | null }> {
  return new Map(
    (getDb().prepare('SELECT cle, etat, campagne_id, retenue_le, supprime_le FROM communication_medias').all() as { cle: string; etat: string | null; campagne_id: string | null; retenue_le: number | null; supprime_le: number | null }[]).map((l) => [
      l.cle,
      { etat: l.etat, campagneId: l.campagne_id, retenueLe: l.retenue_le, supprimeLe: l.supprime_le },
    ]),
  );
}

/** La version remise en tête par l'utilisateur fait la ligne, tant qu'aucune version plus récente n'est venue depuis. */
function avecVersionRetenue(media: MediaRegroupe, etats: ReturnType<typeof etatsDesMedias>): MediaRegroupe {
  const retenue = media.versions
    .map((v) => ({ v, le: etats.get(v.cle)?.retenueLe ?? 0 }))
    .filter((x) => x.le && x.le > Math.max(...media.versions.map((v) => v.creeLe)))
    .sort((a, b) => b.le - a.le)[0]?.v;
  if (!retenue || retenue.cle === media.cle) return media;
  const rang = media.versions.findIndex((v) => v.cle === retenue.cle);
  return { ...media, ...retenue, versions: media.versions, numeroDeVersion: retenue.version ?? media.versions.length - rang };
}

/** Où chaque pièce est utilisée : les contenus qui l'ont pour visuel. */
/** Une publication qui se sert d'un média : son état, ses dates et — une fois en ligne — ses chiffres. */
export interface UsageDUnMedia {
  contenuId: string;
  /** La publication d'origine du post (ses déclinaisons sur d'autres réseaux la partagent), ou lui-même. */
  famille: string;
  titre: string;
  canal: string;
  etape: string;
  datePrevue: string | null;
  publieLe: number | null;
  vues: number | null;
  reactions: number | null;
  clics: number | null;
}

/**
 * OÙ CHAQUE PIÈCE EST UTILISÉE, avec le FLUX DE PUBLICATION de chaque usage (03/11/2026 : « dans la fiche on doit voir
 * le média, les stats, les flux de publication ») — l'étape du contenu, sa date prévue, et ses chiffres réels une fois
 * publié (`chiffresDesContenus`, lu tel quel, jamais recopié). Aucun chiffre avant la mise en ligne : `null`.
 */
function usagesDesPieces(projets: readonly string[], chiffres?: Map<string, ChiffresDePublication>): Map<string, UsageDUnMedia[]> {
  const usages = new Map<string, UsageDUnMedia[]>();
  if (!projets.length) return usages;
  const lignes = getDb()
    .prepare(
      `SELECT l.attachment_id, c.id, c.titre, c.canal, c.etape, c.date_prevue, COALESCE(c.declinaison_de, c.id) AS famille FROM communication_media_contenu l JOIN marketing_contenus c ON c.id = l.contenu_id WHERE c.project_id IN (${marques(projets)})`,
    )
    .all(...projets) as { attachment_id: string; id: string; titre: string; canal: string; etape: string; date_prevue: string | null; famille: string }[];
  for (const l of lignes) {
    const ch = chiffres?.get(l.id);
    const publie = !!ch?.publieLe;
    usages.set(l.attachment_id, [
      ...(usages.get(l.attachment_id) ?? []),
      {
        contenuId: l.id,
        /* LA FAMILLE DU POST : la publication d'origine de ses déclinaisons (`declinaison_de`), ou lui-même. */
        famille: l.famille,
        titre: l.titre,
        canal: l.canal,
        etape: l.etape,
        datePrevue: l.date_prevue,
        publieLe: ch?.publieLe ?? null,
        vues: publie ? (ch?.vues ?? null) : null,
        reactions: publie ? (ch?.reactions ?? null) : null,
        clics: publie ? (ch?.clics ?? 0) : null,
      },
    ]);
  }
  return usages;
}

/**
 * LES MÉDIAS FINIS D'UNE MARQUE, regroupés par versions, et les SOURCES de chaque création du Studio
 * (`trierLesMedias`) : les rushs et les imports ne font plus de ligne, ils se lisent dans la fiche du
 * média qu'ils ont servi à faire.
 */
function mediasFinisDeLaMarque(
  projets: readonly string[],
  usages = usagesDesPieces(projets),
  lignes = lignesDeMedia(projets),
  /* Les pièces sur lesquelles l'utilisateur a DÉCIDÉ (retirée d'une campagne, rangée, mise à la corbeille) : elles restent
     des médias de la marque même sans publication — sinon un média importé « gardé sans image » disparaissait. */
  decidees: ReadonlySet<string> = new Set(),
): { medias: MediaRegroupe[]; sources: Map<string, LigneDeMedia[]> } {
  if (!lignes.length) return { medias: [], sources: new Map() };
  const creationDeLaPiece = new Map(
    (getDb().prepare(`SELECT attachment_id, creation_id FROM studio_medias WHERE project_id IN (${marques(projets)}) AND attachment_id IS NOT NULL AND creation_id IS NOT NULL`).all(...projets) as { attachment_id: string; creation_id: string }[]).map((l) => [l.attachment_id, l.creation_id]),
  );
  const creationsFinies = new Set(lignes.filter((l) => l.origine === 'studio' && !l.enMontage && l.creationId).map((l) => l.creationId!));
  const { finis, sources } = trierLesMedias(lignes, { utilisees: new Set([...usages.keys(), ...decidees]), creationDeLaPiece, creationsFinies });
  return { medias: regrouperLesMedias(finis), sources };
}

/**
 * TOUT MÉDIA DE COMMUNICATION PASSE PAR LE STUDIO (décision de l'utilisateur, 03/11/2026 : « chaque média doit être
 * généré dans le Studio et visible dans l'outil communication s'il a été construit depuis là » ; l'existant, « les
 * ranger dans le Studio »). Les images, vidéos et sons qu'un CHEF de Communication a joints à ses réponses — fabriqués
 * hors du Studio, comme les neuf posts d'une campagne — entrent dans la bibliothèque du Studio de leur projet
 * (`importerPieceJointe`, provenance « import ») : ils paraissent alors dans Médias, avec leur fiche.
 *
 * Reprise ET filet à la fois : rejoué à chaque lecture des médias d'une marque, il ne fait rien la seconde fois (un
 * import ne se double jamais, `mediaDejaImporte`), ne déplace ni ne copie aucun fichier (on référence la pièce),
 * et laisse de côté les copies d'icônes d'une construction. Rend le nombre de médias rangés.
 */
export function rangerLesMediasDesChefsDansLeStudio(projets: readonly string[]): number {
  if (!projets.length) return 0;
  const lignes = getDb()
    .prepare(
      `SELECT a.id AS id, a.project_id AS projet, json_extract(a.data, '$.name') AS nom FROM attachments a
         JOIN agents g ON g.id = json_extract(a.data, '$.agentId')
        WHERE a.project_id IN (${marques(projets)})
          AND json_extract(g.data, '$.service.id') = ?
          AND (json_extract(a.data, '$.mime') LIKE 'image/%' OR json_extract(a.data, '$.mime') LIKE 'video/%' OR json_extract(a.data, '$.mime') LIKE 'audio/%')
          AND NOT EXISTS (SELECT 1 FROM studio_medias m WHERE m.attachment_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM medias_livres l WHERE l.attachment_id = a.id)`,
    )
    .all(...projets, SERVICE_DU_DIRECTEUR) as { id: string; projet: string; nom: string | null }[];
  let ranges = 0;
  for (const l of lignes) {
    if (l.nom && pieceVenueDUneConstruction(l.nom)) continue;
    /* UNE ESQUISSE OU UNE MAQUETTE DE CHOIX reste dans la discussion : jamais dans le Studio ni dans Médias (10/11/2026). */
    if (pieceDeConception({ nom: l.nom })) continue;
    const r = importerPieceJointe(l.projet, l.id);
    if (r.ok && r.nouveau) ranges += 1;
  }
  if (ranges) log.info('communication', `${ranges} média(s) d'un chef rangé(s) dans le Studio`);
  return ranges;
}

/** Les pièces des médias, de quoi réparer leurs liens (`reparationsDesLiens`). */
function piecesDeMedia(lignes: readonly LigneDeMedia[]) {
  return lignes.filter((l) => !!l.attachmentId).map((l) => ({ piece: l.attachmentId!, projet: l.projectId, nom: l.nom, versions: cleDesVersions(l), version: l.version ?? null, creeLe: l.creeLe }));
}

/** Les liens publication ↔ pièce des projets, dans l'ordre où ils ont été posés. */
function liensDesPosts(projets: readonly string[]) {
  if (!projets.length) return [];
  return (
    getDb()
      .prepare(`SELECT l.contenu_id AS contenu, l.attachment_id AS piece, l.cree_le AS creeLe FROM communication_media_contenu l JOIN marketing_contenus c ON c.id = l.contenu_id WHERE c.project_id IN (${marques(projets)}) ORDER BY l.cree_le`)
      .all(...projets) as { contenu: string; piece: string; creeLe: number }[]
  );
}

/** Applique des réparations de liens en une transaction ; rend le nombre de liens touchés. */
function appliquerLesReparations(r: ReturnType<typeof reparationsDesLiens>): number {
  if (!r.retirer.length && !r.poser.length) return 0;
  const db = getDb();
  const retirer = db.prepare('DELETE FROM communication_media_contenu WHERE contenu_id = ? AND attachment_id = ?');
  const poser = db.prepare('INSERT OR REPLACE INTO communication_media_contenu (contenu_id, attachment_id, cree_le) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const l of r.retirer) retirer.run(l.contenu, l.piece);
    for (const l of r.poser) poser.run(l.contenu, l.piece, l.creeLe);
  })();
  return r.retirer.length + r.poser.length;
}

/**
 * LES LIENS DES PUBLICATIONS, RÉPARÉS À LA LECTURE (carte du 04/11/2026) — reprise ET filet, comme le rangement
 * ci-dessus : une version liée en plus de l'ancienne la remplace, un carrousel lié par sa seule première image
 * retrouve les autres. Idempotent ; la règle vit dans `reparationsDesLiens` (shared, testée).
 */
export function reparerLesLiensDesPosts(projets: readonly string[], lignes = lignesDeMedia(projets)): number {
  const touches = appliquerLesReparations(reparationsDesLiens(liensDesPosts(projets), piecesDeMedia(lignes)));
  if (touches) {
    log.info('communication', `${touches} lien(s) de publication réparé(s) (versions remplacées, carrousels complétés)`);
    for (const p of projets) diffuser(p);
  }
  return touches;
}

/**
 * LES DÉCLINAISONS D'UN MÊME POST, RELIÉES À LA LECTURE (carte « Fiche publication et médias regroupés ») — reprise
 * des publications d'avant ET filet pour celles que le chef écrit ensuite : la version TikTok d'un post écrit aussi
 * pour Instagram (même campagne, même jour, même titre) pointe vers celle d'origine. Idempotent, jamais deux
 * publications du même réseau ; la règle vit dans `declinaisonsAPoser` (shared, testée). Rend le nombre de liens posés.
 */
export function rattraperLesDeclinaisons(projets: readonly string[]): number {
  if (!projets.length) return 0;
  const db = getDb();
  const posts = db
    .prepare(
      `SELECT id, project_id AS projet, canal, campagne_id AS campagneId, date_prevue AS datePrevue, titre, cree_le AS creeLe, declinaison_de AS declinaisonDe
         FROM marketing_contenus WHERE project_id IN (${marques(projets)}) AND campagne_id IS NOT NULL AND etape != 'abandonne'`,
    )
    .all(...projets) as Parameters<typeof declinaisonsAPoser>[0][number][];
  const liens = declinaisonsAPoser(posts);
  if (!liens.length) return 0;
  const poser = db.prepare('UPDATE marketing_contenus SET declinaison_de = ? WHERE id = ? AND declinaison_de IS NULL');
  db.transaction(() => {
    for (const l of liens) poser.run(l.declinaisonDe, l.id);
  })();
  log.info('communication', `${liens.length} déclinaison(s) de post reliée(s) à leur publication d'origine`);
  for (const p of projets) diffuser(p);
  return liens.length;
}

export function lireMedias(marqueId: string, compte: Compte) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  rangerLesMediasDesChefsDansLeStudio(projets);
  rattraperLesDeclinaisons(projets);
  const lignesDesMedias = lignesDeMedia(projets);
  reparerLesLiensDesPosts(projets, lignesDesMedias);
  const etats = etatsDesMedias();
  const usages = usagesDesPieces(projets, chiffresDesContenus(projets));
  const decidees = new Set(lignesDesMedias.flatMap((l) => {
    const e = etats.get(l.cle);
    return l.attachmentId && e ? [l.attachmentId] : [];
  }));
  const { medias: finis, sources } = mediasFinisDeLaMarque(projets, usages, lignesDesMedias, decidees);
  /* LES VISUELS D'UNE MÊME PUBLICATION, DANS L'ORDRE OÙ ILS ONT ÉTÉ JOINTS (refonte du 04/11/2026) : les images d'un
     carrousel. La fiche d'un média les fait défiler avec ses versions et ses sources — seulement ce qui lui est
     réellement associé, jamais un fichier copié. */
  const piecesParContenu = new Map<string, { id: string; genre: string }[]>();
  if (projets.length) {
    const lignesDeContenu = getDb()
      .prepare(
        `SELECT l.contenu_id AS contenu, l.attachment_id AS piece, json_extract(a.data, '$.mime') AS mime FROM communication_media_contenu l
           JOIN marketing_contenus c ON c.id = l.contenu_id LEFT JOIN attachments a ON a.id = l.attachment_id
          WHERE c.project_id IN (${marques(projets)}) ORDER BY l.cree_le`,
      )
      .all(...projets) as { contenu: string; piece: string; mime: string | null }[];
    for (const l of lignesDeContenu) {
      const genre = l.mime?.startsWith('video/') ? 'video' : l.mime?.startsWith('audio/') ? 'son' : 'image';
      piecesParContenu.set(l.contenu, [...(piecesParContenu.get(l.contenu) ?? []), { id: l.piece, genre }]);
    }
  }
  /* LA CAMPAGNE DE CHAQUE PUBLICATION, et celles de la marque : de quoi rattacher d'office chaque média (`campagneDuMedia`). */
  const campagneDesContenus = new Map(
    projets.length
      ? (getDb().prepare(`SELECT id, campagne_id FROM marketing_contenus WHERE project_id IN (${marques(projets)}) AND campagne_id IS NOT NULL`).all(...projets) as { id: string; campagne_id: string }[]).map((l) => [l.id, l.campagne_id])
      : [],
  );
  const campagnesDeLaMarque = lireCampagnesBrutes(marqueId);
  const rattachements = new Map([...etats].map(([cle, e]) => [cle, e.campagneId]));
  const aRattacher: { cle: string; campagneId: string }[] = [];
  const tous = finis.map((brut) => {
    const m = avecVersionRetenue(brut, etats);
    const decide = etats.get(m.cle);
    const utilise = m.versions.flatMap((v) => (v.attachmentId ? usages.get(v.attachmentId) ?? [] : []));
    const campagne = campagneDuMedia({
      versions: [m.cle, ...m.versions.map((v) => v.cle)],
      creationId: m.creationId ?? null,
      rattachements,
      campagnesDesPublications: utilise.map((u) => campagneDesContenus.get(u.contenuId)),
      campagnesDeLaMarque: campagnesDeLaMarque.map((c) => c.id),
    });
    if (campagne.campagneId && campagne.source === 'seule') aRattacher.push({ cle: m.cle, campagneId: campagne.campagneId });
    return {
      ...m,
      etat: etatDeMedia(m, decide?.etat),
      campagneId: campagne.campagneId,
      utilise,
      /* Les autres visuels des publications où il sert (un carrousel), une fois chacun, dans l'ordre. */
      carrousel: [
        ...new Map(
          m.versions
            .flatMap((v) => (v.attachmentId ? usages.get(v.attachmentId) ?? [] : []))
            .flatMap((u) => piecesParContenu.get(u.contenuId) ?? [])
            .filter((x) => !m.versions.some((v) => v.attachmentId === x.id))
            .map((x) => [x.id, x]),
        ).values(),
      ],
      /* SA PLACE DANS LE POST (1re image d'un carrousel = 0) : la vignette d'un carrousel est sa PREMIÈRE image. */
      rangDansLePost: Math.min(
        Infinity,
        ...m.versions.flatMap((v) => (v.attachmentId ? (usages.get(v.attachmentId) ?? []).map((u) => (piecesParContenu.get(u.contenuId) ?? []).findIndex((x) => x.id === v.attachmentId)).filter((i) => i >= 0) : [])),
      ),
      /* CE DONT IL EST FAIT : les pièces de sa création du Studio, une fois chacune. */
      sources: m.creationId
        ? [...new Map((sources.get(m.creationId) ?? []).map((x) => [x.attachmentId ?? x.cle, { cle: x.cle, nom: x.nom, genre: x.genre, attachmentId: x.attachmentId, afficheId: x.afficheId ?? null, origine: x.origine, duree: x.duree ?? null }])).values()]
        : [],
    };
  });
  /* LA REPRISE NE FIGE RIEN : elle ne s'enregistre que si la base de la campagne est DÉJÀ figée (la fabrication a
     commencé, cas des médias hérités). Une première campagne neuve garde sa base modifiable : ses médias d'avant lui
     sont rattachés à la lecture seulement. */
  const seule = campagnesDeLaMarque.length === 1 ? campagnesDeLaMarque[0]! : null;
  if (aRattacher.length && seule && baseDeCampagneVerrouillee(fabricationDeCampagne(seule.id))) enregistrerLesRattachements(aRattacher);
  /* LA CORBEILLE (carte du 06/11/2026) : un média mis à la corbeille sort de TOUTES les listes (campagne, médiathèque,
     calendrier) ; pendant 30 jours il se lit dans la corbeille et se restaure, puis la tournée l'efface pour de bon. */
  const miseALaCorbeille = (m: (typeof tous)[number]) => Math.max(0, ...[m.cle, ...m.versions.map((v) => v.cle)].map((cle) => etats.get(cle)?.supprimeLe ?? 0));
  const effaceDeBon = (m: (typeof tous)[number]) => [m.cle, ...m.versions.map((v) => v.cle)].some((cle) => etats.get(cle)?.etat === 'efface');
  const medias = tous.filter((m) => !miseALaCorbeille(m) && !effaceDeBon(m));
  const corbeille = tous
    .filter((m) => miseALaCorbeille(m) && !effaceDeBon(m))
    .map((m) => ({ ...m, supprimeLe: miseALaCorbeille(m), effaceLe: miseALaCorbeille(m) + DUREE_DE_LA_CORBEILLE_MS }))
    .sort((a, b) => b.supprimeLe - a.supprimeLe);
  const compter = (genre: string) => medias.filter((m) => m.genre === genre).length;
  return {
    medias,
    corbeille,
    pieces: piecesDesMedias(medias),
    /* LES VISUELS DE CHAQUE PUBLICATION, DANS L'ORDRE DU POST (carte du 04/11/2026) : l'aperçu réaliste feuillette le
       carrousel 1 → N, quel que soit le média par lequel on l'ouvre. */
    visuelsDesPosts: Object.fromEntries(piecesParContenu),
    totaux: { image: compter('image'), video: compter('video'), son: compter('son'), aValider: medias.filter((m) => m.etat === 'a_valider').length },
    manquants: mediasManquants(contenusDuCircuit(contenusDeLaMarque(projets)).circuit),
    depense: medias.flatMap((m) => m.versions).reduce((t, v) => t + (v.cout ?? 0), 0),
    campagnes: campagnesDeLaMarque.map((c) => ({ id: c.id, titre: c.titre, debut: c.debut, fin: c.fin })),
  };
}

/**
 * LA REPRISE DES MÉDIAS SANS CAMPAGNE (bogue hérité de l'ancienne interface) : un média sans aucun indice, dans une
 * marque à une seule campagne, y est rangé et ce rattachement s'ENREGISTRE, une fois. Idempotente : un rattachement
 * déjà posé n'est jamais remplacé, la rejouer ne change rien.
 */
function enregistrerLesRattachements(liste: readonly { cle: string; campagneId: string }[]): void {
  if (!liste.length) return;
  const db = getDb();
  const poser = db.prepare(
    'INSERT INTO communication_medias (cle, campagne_id, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET campagne_id = COALESCE(communication_medias.campagne_id, excluded.campagne_id), maj_le = excluded.maj_le WHERE communication_medias.campagne_id IS NULL',
  );
  const maintenant = Date.now();
  db.transaction(() => {
    for (const l of liste) poser.run(l.cle, l.campagneId, maintenant);
  })();
  log.info('communication', `${liste.length} média(s) rattaché(s) d'office à leur campagne`);
}

/** Ce qu'il faut d'une pièce pour la citer dans le champ du chef : son nom de fichier, son alias, son type, son projet. */
export interface PieceCitable {
  nom: string;
  alias: string | null;
  mime: string;
  projet: string;
}

/**
 * LES PIÈCES DES MÉDIAS, CITABLES (carte du 04/11/2026, « Faire des modifications ») : la fiche d'un média prépare
 * « Modifie l'image [fichier: <nom> #<alias>] : » chez le chef — avec l'ALIAS ENREGISTRÉ de la pièce, jamais un alias
 * recalculé (il s'allonge en cas de collision, `alias-piece-jointe.ts`). Versions et images de carrousel, une fois.
 */
function piecesDesMedias(medias: readonly { versions: readonly { attachmentId?: string | null }[]; carrousel?: readonly { id: string }[] }[]): Record<string, PieceCitable> {
  const ids = [...new Set(medias.flatMap((m) => [...m.versions.map((v) => v.attachmentId), ...(m.carrousel ?? []).map((x) => x.id)]).filter((x): x is string => !!x))];
  const pieces: Record<string, PieceCitable> = {};
  for (let i = 0; i < ids.length; i += 400) {
    const paquet = ids.slice(i, i + 400);
    const lignes = getDb()
      .prepare(`SELECT id, project_id AS projet, json_extract(data, '$.name') AS nom, json_extract(data, '$.alias') AS alias, json_extract(data, '$.mime') AS mime FROM attachments WHERE id IN (${paquet.map(() => '?').join(',')})`)
      .all(...paquet) as { id: string; projet: string; nom: string | null; alias: string | null; mime: string | null }[];
    for (const l of lignes) pieces[l.id] = { nom: l.nom ?? l.id, alias: l.alias, mime: l.mime ?? 'application/octet-stream', projet: l.projet };
  }
  return pieces;
}

export function ecrireEtatDuMedia(cle: unknown, etat: unknown, compte: Compte): void {
  const id = String(cle ?? '');
  if (!/^(export|livre|piece|creation):/.test(id)) throw new Error('média inconnu');
  verifierLePorteurDuMedia(id, compte);
  const voulu = ['valide', 'a_valider', 'brouillon'].find((e) => e === etat);
  if (!voulu) throw new Error('état inconnu');
  getDb().prepare('INSERT INTO communication_medias (cle, etat, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET etat = excluded.etat, maj_le = excluded.maj_le').run(id, voulu, Date.now());
  diffuserMarques();
}

/** REVENIR À UNE VERSION : elle redevient la tête de ligne, et aucune autre n'est effacée. */
export function revenirAUneVersion(cle: unknown, compte: Compte, maintenant = Date.now()): void {
  const id = String(cle ?? '');
  if (!/^(export|livre|piece):/.test(id)) throw new Error('média inconnu');
  verifierLePorteurDuMedia(id, compte);
  getDb().prepare('INSERT INTO communication_medias (cle, retenue_le, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET retenue_le = excluded.retenue_le, maj_le = excluded.maj_le').run(id, maintenant, maintenant);
  diffuserMarques();
}

/**
 * RANGER UN MÉDIA DANS UNE CAMPAGNE, OU L'EN RETIRER (menu au clic droit, carte du 06/11/2026). Sans campagne, le média
 * est RETIRÉ : on enregistre `SANS_CAMPAGNE`, jamais un vide — un vide se faisait recoller d'office par la lecture
 * (`campagneDuMedia`, `enregistrerLesRattachements`) et le média revenait tout seul. `publications` : ce que
 * l'utilisateur a choisi pour les publications PRÉVUES qui se servent du média (`traiterLesPublicationsDuMedia`).
 */
export function rattacherMediaACampagne(cle: unknown, campagneId: unknown, compte: Compte, publications?: unknown): void {
  const id = String(cle ?? '');
  verifierLePorteurDuMedia(id, compte);
  const campagne = typeof campagneId === 'string' && campagneId && campagneId !== SANS_CAMPAGNE ? campagneId : SANS_CAMPAGNE;
  traiterLesPublicationsDuMedia(publications, compte, campagne === SANS_CAMPAGNE ? null : campagne);
  getDb().prepare('INSERT INTO communication_medias (cle, campagne_id, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET campagne_id = excluded.campagne_id, maj_le = excluded.maj_le').run(id, campagne, Date.now());
  diffuserMarques();
}

/** Combien de temps un média reste dans la corbeille avant d'être effacé pour de bon (décision de l'utilisateur). */
export const DUREE_DE_LA_CORBEILLE_MS = 30 * 24 * 3600_000;

/**
 * LES PUBLICATIONS PRÉVUES D'UN MÉDIA QU'ON DÉPLACE, RETIRE OU SUPPRIME (décision de l'utilisateur, 06/11/2026 :
 * « prévenir et laisser choisir »). L'écran a montré la date et l'utilisateur a choisi, pour TOUTES ces publications :
 *   - `retirer` : la publication est abandonnée (elle ne partira pas) — ou, quand on DÉPLACE le média, elle le suit
 *     dans la nouvelle campagne ;
 *   - `garder` : la publication reste, sans ce visuel — le lien est défait, et elle se lit alors dans « ce qui manque »
 *     (`mediasManquants`) jusqu'à ce qu'on lui en donne un autre.
 * Une publication DÉJÀ en ligne n'est jamais touchée : son visuel reste dans l'historique.
 */
function traiterLesPublicationsDuMedia(entree: unknown, compte: Compte, versCampagne: string | null): void {
  if (!entree || typeof entree !== 'object') return;
  const { choix, contenus, pieces } = entree as { choix?: unknown; contenus?: unknown; pieces?: unknown };
  if (choix !== 'retirer' && choix !== 'garder') return;
  const ids = (Array.isArray(contenus) ? contenus : []).map((x) => String(x ?? '')).filter(Boolean);
  const lesPieces = (Array.isArray(pieces) ? pieces : []).map((x) => String(x ?? '')).filter(Boolean);
  const db = getDb();
  for (const contenuId of ids) {
    const contenu = lireContenu(contenuId);
    if (!contenu || contenu.etape === 'publie' || contenu.etape === 'abandonne') continue;
    projetDansLaMarque(contenu.projectId, compte);
    if (choix === 'garder') {
      for (const piece of lesPieces) db.prepare('DELETE FROM communication_media_contenu WHERE contenu_id = ? AND attachment_id = ?').run(contenu.id, piece);
      diffuser(contenu.projectId);
    } else if (versCampagne) {
      rattacherContenuACampagne(contenu.id, versCampagne, compte);
    } else {
      /* Abandonner, c'est le geste de l'utilisateur : on l'écrit directement, même depuis « programmé ». */
      db.prepare("UPDATE marketing_contenus SET etape = 'abandonne', maj_le = ? WHERE id = ?").run(Date.now(), contenu.id);
      diffuser(contenu.projectId);
    }
  }
}

/** METTRE UN MÉDIA À LA CORBEILLE : il sort des listes, se restaure 30 jours, puis s'efface (`purgerLaCorbeilleDesMedias`). */
export function mettreMediaALaCorbeille(cle: unknown, compte: Compte, publications?: unknown, maintenant = Date.now(), campagneId?: unknown): void {
  const id = String(cle ?? '');
  verifierLePorteurDuMedia(id, compte);
  traiterLesPublicationsDuMedia(publications, compte, null);
  /* SA CAMPAGNE DU MOMENT S'ENREGISTRE (si aucune ne l'est) : déduite de ses publications, elle se perdrait avec le lien
     défait, et le média restauré ne retrouverait pas sa campagne. */
  const campagne = typeof campagneId === 'string' && campagneId && campagneId !== SANS_CAMPAGNE ? campagneId : null;
  getDb()
    .prepare('INSERT INTO communication_medias (cle, campagne_id, supprime_le, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT(cle) DO UPDATE SET campagne_id = COALESCE(communication_medias.campagne_id, excluded.campagne_id), supprime_le = excluded.supprime_le, maj_le = excluded.maj_le')
    .run(id, campagne, maintenant, maintenant);
  diffuserMarques();
}

/** RESTAURER UN MÉDIA DE LA CORBEILLE : toutes ses versions en sortent, il retrouve sa campagne. */
export function restaurerMedia(cle: unknown, versions: unknown, compte: Compte): void {
  const id = String(cle ?? '');
  verifierLePorteurDuMedia(id, compte);
  const cles = [id, ...(Array.isArray(versions) ? versions.map((v) => String(v ?? '')).filter((v) => /^(export|livre|piece|creation):/.test(v)) : [])];
  const remettre = getDb().prepare("UPDATE communication_medias SET supprime_le = NULL, maj_le = ? WHERE cle = ? AND COALESCE(etat, '') != 'efface'");
  for (const c of cles) remettre.run(Date.now(), c);
  diffuserMarques();
}

/** La pièce d'un média, d'après sa clé — de quoi défaire ses liens aux publications quand il est effacé. */
function pieceDuMedia(cle: string): string | null {
  const [genre, id] = cle.split(':');
  const table = genre === 'export' ? 'studio_exports' : genre === 'livre' ? 'medias_livres' : genre === 'piece' ? 'studio_medias' : null;
  if (!table) return null;
  return (getDb().prepare(`SELECT attachment_id FROM ${table} WHERE id = ?`).get(id) as { attachment_id: string | null } | undefined)?.attachment_id ?? null;
}

/**
 * L'EFFACEMENT DÉFINITIF, après 30 jours de corbeille : le média ne se montre plus nulle part dans Communication (ni
 * listes, ni corbeille) et ses liens aux publications non publiées sont défaits. Le fichier lui-même reste rangé dans
 * le Studio de son projet, qui en est la bibliothèque (une création peut s'en servir) : effacer le fichier y casserait
 * un montage. Rend le nombre de médias effacés.
 */
export function purgerLaCorbeilleDesMedias(maintenant = Date.now()): number {
  const db = getDb();
  const echus = db.prepare("SELECT cle FROM communication_medias WHERE supprime_le IS NOT NULL AND supprime_le <= ? AND COALESCE(etat, '') != 'efface'").all(maintenant - DUREE_DE_LA_CORBEILLE_MS) as { cle: string }[];
  if (!echus.length) return 0;
  db.transaction(() => {
    for (const { cle } of echus) {
      const piece = pieceDuMedia(cle);
      if (piece) db.prepare("DELETE FROM communication_media_contenu WHERE attachment_id = ? AND contenu_id IN (SELECT id FROM marketing_contenus WHERE etape != 'publie')").run(piece);
      db.prepare("UPDATE communication_medias SET etat = 'efface', maj_le = ? WHERE cle = ?").run(maintenant, cle);
    }
  })();
  log.info('communication', `${echus.length} média(s) effacé(s) de la corbeille`);
  diffuserMarques();
  return echus.length;
}

/** La tournée de la corbeille : quelques minutes après le démarrage, puis chaque jour. */
export function planifierPurgeDeLaCorbeilleDesMedias(): NodeJS.Timeout[] {
  const passer = () => {
    try {
      purgerLaCorbeilleDesMedias();
    } catch (err) {
      log.warn('communication', 'purge de la corbeille des médias impossible', err);
    }
    /* La corbeille des campagnes passe le même jour (10/11/2026). */
    try {
      purgerLaCorbeilleDesCampagnes();
    } catch (err) {
      log.warn('communication', 'purge de la corbeille des campagnes impossible', err);
    }
  };
  const premiere = setTimeout(passer, 6 * 60_000);
  premiere.unref();
  const chaqueJour = setInterval(passer, 24 * 3600_000);
  chaqueJour.unref();
  return [premiere, chaqueJour];
}

function verifierLePorteurDuMedia(cle: string, compte: Compte): void {
  if (compteVoitTout(compte)) return;
  const [genre, id] = cle.split(':');
  const table = genre === 'export' ? 'studio_exports' : genre === 'livre' ? 'medias_livres' : genre === 'creation' ? 'studio_creations' : 'studio_medias';
  const ligne = getDb().prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(id) as { project_id: string } | undefined;
  if (!ligne || !peutVoirProjet(compte, ligne.project_id)) throw new Error('média inconnu');
}

/** Ce qui manque pour partir : un contenu à venir sur un réseau qui exige un visuel, et qui n'en a pas. */
function mediasManquants(contenus: readonly ContenuLu[]): { contenuId: string; titre: string; reseau: string; exige: string; datePrevue?: string; campagneId?: string }[] {
  const manquants: { contenuId: string; titre: string; reseau: string; exige: string; datePrevue?: string; campagneId?: string }[] = [];
  for (const c of contenus) {
    if (c.apercu || c.etape === 'publie') continue;
    const reseau = c.canaux.find((r) => (RESEAUX_SOCIAUX as readonly string[]).includes(r)) as keyof typeof FICHES_RESEAUX | undefined;
    if (!reseau) continue;
    const exige = FICHES_RESEAUX[reseau].media;
    if (exige === 'aucun') continue;
    manquants.push({ contenuId: c.id, titre: c.titre, reseau, exige, ...(c.datePrevue ? { datePrevue: c.datePrevue } : {}), ...(c.campagneId ? { campagneId: c.campagneId } : {}) });
  }
  return manquants;
}

/**
 * LIER DES VISUELS À UNE PUBLICATION (outil « lier_media » du chef, geste « contenu.media »). `attachmentIds` : une
 * pièce, ou TOUTES les images d'un carrousel dans l'ordre (carte du 04/11/2026 : le chef n'en liait que la première).
 * Une pièce qui est une NOUVELLE VERSION d'un média déjà lié le REMPLACE, à sa place dans le carrousel — jamais une
 * image de plus dans le post.
 */
export function lierMediaAuContenu(contenuId: unknown, attachmentIds: unknown, compte: Compte, maintenant = Date.now()): void {
  const contenu = lireContenu(String(contenuId ?? ''));
  if (!contenu) throw new Error('contenu introuvable');
  projetDansLaMarque(contenu.projectId, compte);
  const ids = (Array.isArray(attachmentIds) ? attachmentIds : [attachmentIds]).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (!ids.length) throw new Error('média introuvable');
  const marque = marqueDuProjet(contenu.projectId);
  const permis = marque?.projets ?? [contenu.projectId];
  for (const id of ids) {
    const piece = store.getAttachment(id);
    if (!piece) throw new Error('média introuvable');
    /* LE MÉDIA D'UNE AUTRE MARQUE NE S'Y GLISSE PAS. */
    if (!permis.includes(piece.projectId)) throw new Error('Ce média n’appartient pas à cette marque.');
  }
  const pieces = piecesDeMedia(lignesDeMedia(permis));
  const versionsDe = new Map(pieces.map((p) => [p.piece, p.versions]));
  const db = getDb();
  const liees = db.prepare('SELECT attachment_id AS piece, cree_le AS creeLe FROM communication_media_contenu WHERE contenu_id = ?').all(contenu.id) as { piece: string; creeLe: number }[];
  const retirer = db.prepare('DELETE FROM communication_media_contenu WHERE contenu_id = ? AND attachment_id = ?');
  const poser = db.prepare('INSERT OR IGNORE INTO communication_media_contenu (contenu_id, attachment_id, cree_le) VALUES (?, ?, ?)');
  db.transaction(() => {
    ids.forEach((id, rang) => {
      const cle = versionsDe.get(id);
      const remplacees = cle ? liees.filter((l) => l.piece !== id && versionsDe.get(l.piece) === cle) : [];
      for (const l of remplacees) retirer.run(contenu.id, l.piece);
      poser.run(contenu.id, id, remplacees.length ? Math.min(...remplacees.map((l) => l.creeLe)) : maintenant + rang);
    });
  })();
  diffuser(contenu.projectId);
}

/* ------------------------------------------------------------------ */
/* Les campagnes                                                        */
/* ------------------------------------------------------------------ */

interface LigneCampagne {
  id: string;
  marque_id: string;
  titre: string;
  objectif: string | null;
  objectif_chiffre: number | null;
  mesure: string;
  reseaux: string;
  debut: string | null;
  fin: string | null;
  statut: string;
  image: string | null;
  objectif_id: string | null;
  types_medias: string | null;
  quantite_medias: number | null;
  rythme: string | null;
  cible: string | null;
  message: string | null;
  ton: string | null;
  appel_action: string | null;
  supprime_le?: number | null;
  suppression?: string | null;
  strategie?: string | null;
  cree_le: number;
  maj_le: number;
}

export interface CampagneLue {
  id: string;
  marqueId: string;
  titre: string;
  objectif: string | null;
  objectifChiffre: number | null;
  mesure: string;
  reseaux: string[];
  debut: string | null;
  fin: string | null;
  statut: string;
  image: string | null;
  /** L'objectif de la marque que cette campagne sert. */
  objectifId: string | null;
  /* LES HUIT POINTS (`shared/src/fiche-de-campagne.ts`) : réseaux, dates et objectif chiffré ci-dessus, plus : */
  typesMedias: string[];
  quantiteMedias: number | null;
  rythme: string | null;
  cible: string | null;
  message: string | null;
  ton: string | null;
  appelAction: string | null;
  /** La stratégie bâtie avec l'agent de la campagne (`shared/src/strategie-de-campagne.ts`). */
  strategie: StrategieDeCampagne;
  /** Sa date de mise à la corbeille, `null` hors corbeille. */
  supprimeLe: number | null;
}

function listeLue(brut: string | null | undefined): string[] {
  try {
    const v = JSON.parse(brut ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function versCampagne(l: LigneCampagne): CampagneLue {
  return {
    id: l.id,
    marqueId: l.marque_id,
    titre: l.titre,
    objectif: l.objectif,
    objectifChiffre: l.objectif_chiffre,
    mesure: l.mesure,
    reseaux: listeLue(l.reseaux),
    debut: l.debut,
    fin: l.fin,
    statut: l.statut,
    image: l.image,
    objectifId: l.objectif_id ?? null,
    typesMedias: listeLue(l.types_medias),
    quantiteMedias: l.quantite_medias ?? null,
    rythme: l.rythme ?? null,
    cible: l.cible ?? null,
    message: l.message ?? null,
    ton: l.ton ?? null,
    appelAction: l.appel_action ?? null,
    strategie: lireStrategieDeCampagne(l.strategie),
    supprimeLe: l.supprime_le ?? null,
  };
}

/**
 * CE QUI DIT QUE LA FABRICATION A COMMENCÉ : un média rattaché à la campagne (une création du Studio lancée pour elle
 * se rattache dès son lancement, `rattacherCreationACampagne`), ou une de ses publications qui a déjà son média.
 */
export function fabricationDeCampagne(campagneId: string): FabricationDeCampagne {
  const db = getDb();
  const medias = (db.prepare('SELECT COUNT(*) AS n FROM communication_medias WHERE campagne_id = ?').get(campagneId) as { n: number }).n;
  const publications = (
    db
      .prepare('SELECT COUNT(DISTINCT m.contenu_id) AS n FROM communication_media_contenu m JOIN marketing_contenus c ON c.id = m.contenu_id WHERE c.campagne_id = ?')
      .get(campagneId) as { n: number }
  ).n;
  return { mediasRattaches: medias, publicationsAvecMedia: publications };
}

/** La fiche d'une campagne lue, ses points manquants et son verrou : ce que lisent la page, le chef et la garde. */
export function etatDeLaFiche(c: CampagneLue): { manquants: PointDeCampagne[]; verrouillee: boolean } {
  return { manquants: pointsManquantsDeCampagne(c), verrouillee: baseDeCampagneVerrouillee(fabricationDeCampagne(c.id)) };
}

/**
 * LA GARDE DE L'OUTIL (décision du 04/11/2026) : tant que la fiche d'une campagne n'a pas ses huit points, rien ne se
 * prépare pour elle — l'outil répond par un refus qui nomme les points manquants, et le chef pose ses questions.
 * `null` : la voie est libre (ou aucune campagne en jeu).
 */
export function refusTantQueLaFicheManque(campagneId: unknown): string | null {
  if (typeof campagneId !== 'string' || !campagneId) return null;
  const ligne = getDb().prepare('SELECT * FROM communication_campagnes WHERE id = ?').get(campagneId) as LigneCampagne | undefined;
  if (!ligne) return null;
  const c = versCampagne(ligne);
  if (c.supprimeLe) return `La campagne « ${c.titre} » est à la corbeille : rien ne se prépare pour elle tant que la personne ne l'a pas restaurée.`;
  const manquants = pointsManquantsDeCampagne(c);
  if (manquants.length) return refusFicheIncomplete(c.titre, manquants);
  /* UNE CAMPAGNE MENÉE PAR SON AGENT (10/11/2026) veut aussi sa STRATÉGIE complète avant la moindre publication. */
  if (campagneMeneeParSonAgent(c.id)) {
    const rubriques = rubriquesManquantes(c.strategie);
    if (rubriques.length) return refusStrategieIncomplete(c.titre, rubriques);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Les esquisses d'une campagne (10/11/2026)                            */
/* ------------------------------------------------------------------ */

const cleDeLEsquisse = (campagneId: string) => `communication.esquisse.${campagneId}`;

/** La DERNIÈRE esquisse dessinée pour une campagne (sa pièce jointe), s'il y en a une. */
export function esquisseDeCampagne(campagneId: string): string | null {
  return getMeta(cleDeLEsquisse(campagneId)) || null;
}

/** Une esquisse neuve devient la dernière : elle sert d'image à la campagne tant qu'aucun vrai visuel ne la remplace. */
export function retenirLEsquisse(campagneId: string, attachmentId: string): void {
  setMeta(cleDeLEsquisse(campagneId), attachmentId);
  diffuserMarques();
}

/** La campagne a-t-elle son agent de conversation (`chefDeCampagne`) ? */
export function campagneMeneeParSonAgent(campagneId: string): boolean {
  return !!getMeta(cleDuChefDeCampagne(campagneId));
}

/** La campagne d'une publication, s'il y en a une. */
export function campagneDuContenu(contenuId: unknown): string | null {
  const ligne = getDb().prepare('SELECT campagne_id FROM marketing_contenus WHERE id = ?').get(String(contenuId ?? '')) as { campagne_id: string | null } | undefined;
  return ligne?.campagne_id ?? null;
}

/** L'AGENT DE LA CAMPAGNE qu'une création du Studio sert (`creation:<id>` dans `communication_medias`), ou `null`. */
export function agentDeCampagneDeLaCreation(creationId: string): string | null {
  const ligne = getDb().prepare('SELECT campagne_id FROM communication_medias WHERE cle = ?').get(`creation:${creationId}`) as { campagne_id: string | null } | undefined;
  return ligne?.campagne_id ? (getMeta(cleDuChefDeCampagne(ligne.campagne_id)) ?? null) : null;
}

/**
 * LES CRÉATIONS DU STUDIO DÉJÀ RATTACHÉES À UNE CAMPAGNE (non supprimées), la plus récente d'abord : une campagne qui en a
 * déjà une se RETOUCHE, on n'en crée pas une seconde sans l'accord de la personne (12/11/2026, captures #8adf, #40a2).
 */
export function creationsDeLaCampagne(campagneId: string): string[] {
  const lignes = getDb().prepare("SELECT cle FROM communication_medias WHERE campagne_id = ? AND cle LIKE 'creation:%' AND supprime_le IS NULL ORDER BY maj_le DESC").all(campagneId) as { cle: string }[];
  return lignes.map((l) => l.cle.slice('creation:'.length));
}

/** UNE CRÉATION DU STUDIO LANCÉE POUR UNE CAMPAGNE s'y rattache tout de suite : la base se fige dès le lancement. */
export function rattacherCreationACampagne(creationId: string, campagneId: string): boolean {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM communication_campagnes WHERE id = ? AND supprime_le IS NULL').get(campagneId)) return false;
  db.prepare('INSERT INTO communication_medias (cle, campagne_id, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET campagne_id = excluded.campagne_id, maj_le = excluded.maj_le').run(
    `creation:${creationId}`,
    campagneId,
    Date.now(),
  );
  diffuserMarques();
  return true;
}

function lireCampagnesBrutes(marqueId: string): CampagneLue[] {
  return (getDb().prepare('SELECT * FROM communication_campagnes WHERE marque_id = ? AND supprime_le IS NULL ORDER BY cree_le DESC').all(marqueId) as LigneCampagne[]).map(versCampagne);
}

/** LA CORBEILLE DES CAMPAGNES d'une marque : la plus récemment supprimée d'abord. */
function lireCorbeilleDesCampagnes(marqueId: string): CampagneLue[] {
  return (getDb().prepare('SELECT * FROM communication_campagnes WHERE marque_id = ? AND supprime_le IS NOT NULL ORDER BY supprime_le DESC').all(marqueId) as LigneCampagne[]).map(versCampagne);
}

export const STATUTS_DE_CAMPAGNE = ['preparation', 'en_cours', 'terminee'] as const;

/** Les champs de la BASE d'une campagne : ceux qui se figent quand la fabrication a commencé. */
const CHAMPS_DE_LA_BASE = ['titre', 'objectif', 'chiffre', 'mesure', 'reseaux', 'debut', 'fin', 'typesMedias', 'quantite', 'rythme', 'cible', 'message', 'ton', 'appel'] as const;

export interface EntreeDeCampagne {
  id?: unknown;
  marqueId?: unknown;
  titre?: unknown;
  objectif?: unknown;
  objectifChiffre?: unknown;
  mesure?: unknown;
  reseaux?: unknown;
  debut?: unknown;
  fin?: unknown;
  statut?: unknown;
  image?: unknown;
  objectifId?: unknown;
  typesMedias?: unknown;
  quantiteMedias?: unknown;
  rythme?: unknown;
  cible?: unknown;
  message?: unknown;
  ton?: unknown;
  appelAction?: unknown;
  /** Des rubriques de stratégie à écrire (`fusionnerStrategie`) : chacune remplace l'ancienne. */
  strategie?: unknown;
}

export function ecrireCampagne(entree: EntreeDeCampagne, compte: Compte, maintenant = Date.now()): CampagneLue {
  const db = getDb();
  const existante = typeof entree.id === 'string' && entree.id ? (db.prepare('SELECT * FROM communication_campagnes WHERE id = ?').get(entree.id) as LigneCampagne | undefined) : undefined;
  const marqueId = existante?.marque_id ?? String(entree.marqueId ?? '');
  marquePourLeCompte(marqueId, compte);
  if (existante?.supprime_le) throw new Error('Cette campagne est à la corbeille : restaurez-la avant de la modifier.');
  const titre = entree.titre === undefined ? existante?.titre ?? '' : String(entree.titre).trim().slice(0, 120);
  if (!titre) throw new Error('Donnez un titre à cette campagne.');
  const jour = (v: unknown, repli: string | null | undefined) => (v === undefined ? repli ?? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const texte = (v: unknown, repli: string | null | undefined, max = 400) => (v === undefined ? repli ?? null : v === null ? null : String(v).trim().slice(0, max) || null);
  const entier = (v: unknown, repli: number | null | undefined) =>
    v === undefined ? repli ?? null : v !== null && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null;
  const champs = {
    titre,
    objectif: entree.objectif === undefined ? existante?.objectif ?? null : String(entree.objectif).trim().slice(0, 400) || null,
    chiffre: entree.objectifChiffre === undefined ? existante?.objectif_chiffre ?? null : Number.isFinite(Number(entree.objectifChiffre)) && Number(entree.objectifChiffre) > 0 ? Math.round(Number(entree.objectifChiffre)) : null,
    mesure: (['visites', 'clics', 'vues', 'abonnes'] as const).find((m) => m === entree.mesure) ?? existante?.mesure ?? 'visites',
    reseaux: Array.isArray(entree.reseaux) ? JSON.stringify(entree.reseaux.filter((r) => typeof r === 'string')) : existante?.reseaux ?? '[]',
    typesMedias: Array.isArray(entree.typesMedias)
      ? JSON.stringify([...new Set(entree.typesMedias.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim().toLowerCase().slice(0, 30)))])
      : existante?.types_medias ?? '[]',
    quantite: entier(entree.quantiteMedias, existante?.quantite_medias),
    rythme: texte(entree.rythme, existante?.rythme, 120),
    cible: texte(entree.cible, existante?.cible),
    message: texte(entree.message, existante?.message),
    ton: texte(entree.ton, existante?.ton, 120),
    appel: texte(entree.appelAction, existante?.appel_action, 200),
    debut: jour(entree.debut, existante?.debut),
    fin: jour(entree.fin, existante?.fin),
    /* UNE CAMPAGNE NEUVE NAÎT « EN PRÉPARATION » (03/11/2026) : son fil d'étapes (`filDeCampagne`) attend ses contenus,
       puis le geste « Lancer la campagne » de l'utilisateur. */
    statut: (STATUTS_DE_CAMPAGNE as readonly unknown[]).includes(entree.statut) ? String(entree.statut) : existante?.statut ?? 'preparation',
    image: entree.image === undefined ? existante?.image ?? null : typeof entree.image === 'string' && entree.image ? entree.image : null,
    /* L'OBJECTIF SERVI : seulement un objectif de la même marque. */
    objectifId:
      entree.objectifId === undefined
        ? existante?.objectif_id ?? null
        : typeof entree.objectifId === 'string' && entree.objectifId && db.prepare('SELECT 1 FROM communication_objectifs WHERE id = ? AND marque_id = ?').get(entree.objectifId, marqueId)
          ? entree.objectifId
          : null,
    /* LA STRATÉGIE n'est pas dans la base figée : l'agent l'affine même après le premier média. */
    strategie: JSON.stringify(fusionnerStrategie(lireStrategieDeCampagne(existante?.strategie), entree.strategie)),
  };
  /* LA BASE FIGÉE SE REFUSE AU DÉMON, PAS SEULEMENT À L'ÉCRAN : ni le chef ni un vieil onglet ne la changent après le
     premier média. Le statut, l'image et l'objectif servi restent libres (lancer, terminer, illustrer). */
  if (existante) {
    const avant = versCampagne(existante);
    const anciens: Record<(typeof CHAMPS_DE_LA_BASE)[number], unknown> = {
      titre: avant.titre,
      objectif: avant.objectif,
      chiffre: avant.objectifChiffre,
      mesure: avant.mesure,
      reseaux: existante.reseaux,
      debut: avant.debut,
      fin: avant.fin,
      typesMedias: existante.types_medias ?? '[]',
      quantite: avant.quantiteMedias,
      rythme: avant.rythme,
      cible: avant.cible,
      message: avant.message,
      ton: avant.ton,
      appel: avant.appelAction,
    };
    /* DATES ET OBJECTIF CHIFFRÉ RESTENT LIBRES SOUS LE VERROU (carte « Planification des publications ») : seuls les
       six autres points se figent. Aucun post n'est déplacé : ceux qui sortent des dates sont signalés à l'écran. */
    const change = CHAMPS_DE_LA_BASE.filter((k) => !(CHAMPS_LIBRES_SOUS_VERROU as readonly string[]).includes(k)).some((k) => (anciens[k] ?? null) !== (champs[k] ?? null));
    if (change && baseDeCampagneVerrouillee(fabricationDeCampagne(existante.id))) {
      throw new Error('La base de cette campagne est figée : la fabrication des médias a commencé.');
    }
  }
  if (!datesDeCampagneValides(champs.debut, champs.fin)) throw new Error('La fin de la campagne ne peut pas précéder son début.');
  const id = existante?.id ?? store.newId();
  db.prepare(
    `INSERT INTO communication_campagnes (id, marque_id, titre, objectif, objectif_chiffre, mesure, reseaux, debut, fin, statut, image, objectif_id,
       types_medias, quantite_medias, rythme, cible, message, ton, appel_action, strategie, cree_le, maj_le)
     VALUES (@id, @marqueId, @titre, @objectif, @chiffre, @mesure, @reseaux, @debut, @fin, @statut, @image, @objectifId,
       @typesMedias, @quantite, @rythme, @cible, @message, @ton, @appel, @strategie, @maintenant, @maintenant)
     ON CONFLICT(id) DO UPDATE SET titre = excluded.titre, objectif = excluded.objectif, objectif_chiffre = excluded.objectif_chiffre, mesure = excluded.mesure,
       reseaux = excluded.reseaux, debut = excluded.debut, fin = excluded.fin, statut = excluded.statut, image = excluded.image, objectif_id = excluded.objectif_id,
       types_medias = excluded.types_medias, quantite_medias = excluded.quantite_medias, rythme = excluded.rythme, cible = excluded.cible,
       message = excluded.message, ton = excluded.ton, appel_action = excluded.appel_action, strategie = excluded.strategie, maj_le = excluded.maj_le`,
  ).run({ id, marqueId, ...champs, maintenant });
  diffuserMarques();
  return versCampagne(db.prepare('SELECT * FROM communication_campagnes WHERE id = ?').get(id) as LigneCampagne);
}

export function rattacherContenuACampagne(contenuId: unknown, campagneId: unknown, compte: Compte, declinaisonDe?: unknown): void {
  const contenu = lireContenu(String(contenuId ?? ''));
  if (!contenu) throw new Error('contenu introuvable');
  projetDansLaMarque(contenu.projectId, compte);
  getDb().prepare('UPDATE marketing_contenus SET campagne_id = ?, maj_le = ? WHERE id = ?').run(typeof campagneId === 'string' && campagneId ? campagneId : null, Date.now(), contenu.id);
  /* UNE DÉCLINAISON NOMMÉE PAR LE CHEF (« declinaisonDe ») : la même publication pour un autre réseau. L'origine se
     prend à la racine (jamais une chaîne) ; le même réseau, ou un autre projet, est refusé. */
  if (typeof declinaisonDe === 'string' && declinaisonDe.trim()) {
    const origine = lireContenu(declinaisonDe.trim());
    if (!origine || origine.projectId !== contenu.projectId) throw new Error(`aucune publication « ${declinaisonDe} » dans ce projet`);
    const racine = (getDb().prepare('SELECT COALESCE(declinaison_de, id) AS r FROM marketing_contenus WHERE id = ?').get(origine.id) as { r: string }).r;
    const memeReseau = getDb().prepare('SELECT 1 FROM marketing_contenus WHERE (id = ? OR declinaison_de = ?) AND canal = ? AND id != ?').get(racine, racine, contenu.canal, contenu.id);
    if (racine === contenu.id) throw new Error('une publication ne peut pas être sa propre déclinaison');
    if (memeReseau) throw new Error(`ce post a déjà sa version ${contenu.canal} : une déclinaison est pour un AUTRE réseau`);
    getDb().prepare('UPDATE marketing_contenus SET declinaison_de = ? WHERE id = ?').run(racine, contenu.id);
  } else {
    rattraperLesDeclinaisons([contenu.projectId]);
  }
  diffuser(contenu.projectId);
}

/** La valeur atteinte par une campagne, selon ce qu'elle mesure. */
function avancementDeCampagne(c: CampagneLue, contenus: readonly ContenuLu[], chiffres: Map<string, ChiffresDePublication>): number {
  return contenus.reduce((t, contenu) => {
    const ch = chiffres.get(contenu.id);
    if (!ch) return t;
    if (c.mesure === 'clics') return t + ch.clics;
    if (c.mesure === 'vues') return t + (ch.vues ?? 0);
    return t + ch.visites;
  }, 0);
}

export function lireCampagnes(marqueId: string, compte: Compte) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const contenus = contenusDeLaMarque(projets);
  const chiffres = chiffresDesContenus(projets);
  return {
    campagnes: lireCampagnesBrutes(marqueId).map((c) => {
      const siens = contenus.filter((x) => x.campagneId === c.id);
      /* PRÊTE QUAND CHAQUE DATE PRÉVUE A SON VISUEL (12/11/2026) : l'état affiché se calcule ici, jamais stocké. */
      const visuels = visuelsDeLaCampagne(c.quantiteMedias, siens.map((x) => ({ datePrevue: x.datePrevue, aUnVisuel: !!x.apercu })));
      return {
        ...c,
        statut: statutAfficheDeCampagne(c.statut, visuels),
        visuels,
        atteint: avancementDeCampagne(c, siens, chiffres),
        publications: siens.length,
        /* La liste dit ce qui est prévu et ce qui est parti, et combien de médias la campagne a (refonte du 04/11/2026). */
        publiees: siens.filter((x) => x.etape === 'publie').length,
        medias: (getDb().prepare('SELECT COUNT(*) AS n FROM communication_medias WHERE campagne_id = ?').get(c.id) as { n: number }).n,
        aAccepter: siens.filter((x) => x.etape === 'a_valider').length,
        /* Ce que la suppression annulerait : la confirmation le dit avant le geste. */
        aAnnuler: siens.filter((x) => publicationAAnnuler(x.etape)).length,
        /* L'IMAGE DE LA CAMPAGNE : la sienne, puis son premier vrai visuel, et à défaut sa DERNIÈRE ESQUISSE (10/11/2026). */
        apercu: apercuDeCampagne(c.image, siens.find((x) => x.apercu)?.apercu?.attachmentId, esquisseDeCampagne(c.id)),
        agentAuTravail: agentDeCampagneAuTravail(c.id),
        ...etatDeLaFiche(c),
      };
    }),
    /* LA CORBEILLE (10/11/2026) : 30 jours pour restaurer, puis la tournée quotidienne efface. */
    corbeille: lireCorbeilleDesCampagnes(marqueId).map((c) => ({
      id: c.id,
      titre: c.titre,
      debut: c.debut,
      fin: c.fin,
      reseaux: c.reseaux,
      supprimeLe: c.supprimeLe!,
      effaceLe: c.supprimeLe! + DUREE_DE_LA_CORBEILLE_DES_CAMPAGNES_MS,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* La corbeille des campagnes (10/11/2026)                              */
/* ------------------------------------------------------------------ */

/** L'agent de la campagne, s'il en a un. */
function agentDeLaCampagne(campagneId: string) {
  const id = getMeta(cleDuChefDeCampagne(campagneId));
  return id ? store.getAgent(id) : null;
}

/** L'agent de la campagne travaille-t-il en ce moment ? Une suppression ne touche jamais un agent au travail. */
export function agentDeCampagneAuTravail(campagneId: string): boolean {
  const a = agentDeLaCampagne(campagneId);
  return !!a && (a.status === 'running' || a.status === 'starting');
}

export const RAISON_AGENT_DE_CAMPAGNE_AU_TRAVAIL = 'L’agent de cette campagne travaille : attendez qu’il ait fini pour la supprimer.';

/**
 * METTRE UNE CAMPAGNE À LA CORBEILLE (décision de l'utilisateur, 10/11/2026) : elle sort de toutes les listes ; ses
 * médias vont à la corbeille des médias (leur campagne gardée) ; ses publications PRÉVUES sont annulées — jamais une
 * publication partie. Ce qui est emporté s'enregistre sur la campagne, pour tout rendre à la restauration. Refusée
 * quand l'agent de la campagne travaille.
 */
export function supprimerCampagne(campagneId: unknown, compte: Compte, maintenant = Date.now()): { medias: number; publications: number } {
  const id = String(campagneId ?? '');
  const db = getDb();
  const ligne = db.prepare('SELECT * FROM communication_campagnes WHERE id = ?').get(id) as LigneCampagne | undefined;
  if (!ligne) throw new Error('campagne introuvable');
  const { projets } = marquePourLeCompte(ligne.marque_id, compte);
  if (ligne.supprime_le) return { medias: 0, publications: 0 };
  if (agentDeCampagneAuTravail(id)) throw new Error(RAISON_AGENT_DE_CAMPAGNE_AU_TRAVAIL);
  /* SES MÉDIAS : ceux que la médiathèque lui rattache (enregistrés ou déduits de ses publications), lus AVANT. */
  const medias = lireMedias(ligne.marque_id, compte)
    .medias.filter((m) => m.campagneId === id)
    .map((m) => m.cle);
  const contenus = (db.prepare('SELECT id, etape FROM marketing_contenus WHERE campagne_id = ?').all(id) as { id: string; etape: string }[]).filter((c) => publicationAAnnuler(c.etape));
  db.transaction(() => {
    /* La campagne du média s'ENREGISTRE (jamais un vide) : restauré, il revient dans SA campagne. */
    const poser = db.prepare(
      'INSERT INTO communication_medias (cle, campagne_id, supprime_le, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT(cle) DO UPDATE SET campagne_id = COALESCE(communication_medias.campagne_id, excluded.campagne_id), supprime_le = excluded.supprime_le, maj_le = excluded.maj_le',
    );
    for (const cle of medias) poser.run(cle, id, maintenant, maintenant);
    const abandonner = db.prepare("UPDATE marketing_contenus SET etape = 'abandonne', maj_le = ? WHERE id = ?");
    for (const c of contenus) abandonner.run(maintenant, c.id);
    db.prepare('UPDATE communication_campagnes SET supprime_le = ?, suppression = ?, maj_le = ? WHERE id = ?').run(maintenant, JSON.stringify({ medias, contenus }), maintenant, id);
  })();
  log.info('communication', `campagne ${id} à la corbeille (${medias.length} média(s), ${contenus.length} publication(s) annulée(s))`);
  for (const p of projets) diffuser(p);
  diffuserMarques();
  return { medias: medias.length, publications: contenus.length };
}

/**
 * RESTAURER UNE CAMPAGNE : elle revient dans les listes avec ses médias ; ses publications annulées par la suppression
 * se rétablissent dans leur étape d'avant si elles sont encore à venir — une date passée reste annulée.
 */
export function restaurerCampagne(campagneId: unknown, compte: Compte, maintenant = Date.now()): { medias: number; publications: number } {
  const id = String(campagneId ?? '');
  const db = getDb();
  const ligne = db.prepare('SELECT * FROM communication_campagnes WHERE id = ?').get(id) as LigneCampagne | undefined;
  if (!ligne) throw new Error('campagne introuvable');
  const { projets } = marquePourLeCompte(ligne.marque_id, compte);
  if (!ligne.supprime_le) return { medias: 0, publications: 0 };
  const emporte = lireSuppression(ligne.suppression);
  const aujourdhui = jourLocal(maintenant);
  let publications = 0;
  db.transaction(() => {
    const remettre = db.prepare("UPDATE communication_medias SET supprime_le = NULL, maj_le = ? WHERE cle = ? AND COALESCE(etat, '') != 'efface'");
    for (const cle of emporte.medias) remettre.run(maintenant, cle);
    const lire = db.prepare('SELECT etape, date_prevue AS datePrevue FROM marketing_contenus WHERE id = ?');
    const retablir = db.prepare('UPDATE marketing_contenus SET etape = ?, maj_le = ? WHERE id = ?');
    for (const c of emporte.contenus) {
      const actuel = lire.get(c.id) as { etape: string; datePrevue: string | null } | undefined;
      if (!actuel || !publicationARetablir(actuel, aujourdhui)) continue;
      retablir.run(c.etape, maintenant, c.id);
      publications += 1;
    }
    db.prepare('UPDATE communication_campagnes SET supprime_le = NULL, suppression = NULL, maj_le = ? WHERE id = ?').run(maintenant, id);
  })();
  for (const p of projets) diffuser(p);
  diffuserMarques();
  return { medias: emporte.medias.length, publications };
}

/**
 * L'EFFACEMENT DÉFINITIF DES CAMPAGNES, après 30 jours de corbeille : la ligne disparaît, son agent aussi (jamais un
 * agent au travail : il attend le passage suivant). Ses médias suivent la purge des médias (même date de corbeille) ;
 * ses publications abandonnées restent dans l'historique des projets, sans campagne. Rend le nombre effacé.
 */
/**
 * CE QUE L'AGENT D'UNE CAMPAGNE REÇOIT À CHAQUE MESSAGE (10/11/2026) : sa campagne telle qu'elle est en base — fiche,
 * stratégie, ce qui manque encore, ses publications et ses médias. Jamais une bulle : le contexte du tour.
 */
export function contexteDeLaCampagnePourSonAgent(campagneId: string, maintenant = Date.now()): string | undefined {
  const db = getDb();
  const ligne = db.prepare('SELECT * FROM communication_campagnes WHERE id = ?').get(campagneId) as LigneCampagne | undefined;
  if (!ligne) return undefined;
  const c = versCampagne(ligne);
  const marque = db.prepare('SELECT nom FROM communication_marques WHERE id = ?').get(c.marqueId) as { nom: string } | undefined;
  const projets = (db.prepare('SELECT p.project_id AS id FROM communication_marque_projets p WHERE p.marque_id = ?').all(c.marqueId) as { id: string }[]).map((p) => ({ id: p.id, nom: store.getProject(p.id)?.name ?? p.id }));
  const contenus = db
    .prepare("SELECT id, titre, canal, etape, date_prevue AS datePrevue FROM marketing_contenus WHERE campagne_id = ? AND etape != 'abandonne' ORDER BY COALESCE(date_prevue, '9999'), cree_le")
    .all(c.id) as { id: string; titre: string; canal: string; etape: string; datePrevue: string | null }[];
  const medias = (db.prepare('SELECT COUNT(*) AS n FROM communication_medias WHERE campagne_id = ? AND supprime_le IS NULL').get(c.id) as { n: number }).n;
  const manquants = pointsManquantsDeCampagne(c);
  const rubriques = rubriquesManquantes(c.strategie);
  const fiche = {
    typesMedias: c.typesMedias,
    quantiteMedias: c.quantiteMedias,
    rythme: c.rythme,
    public: c.cible,
    reseaux: c.reseaux,
    debut: c.debut,
    fin: c.fin,
    objectifChiffre: c.objectifChiffre,
    mesure: c.mesure,
    message: c.message,
    ton: c.ton,
    appelAction: c.appelAction,
  };
  return [
    `TA CAMPAGNE : « ${c.titre} » (id « ${c.id} »), marque « ${marque?.nom ?? c.marqueId} » (id « ${c.marqueId} »), statut ${c.statut}${c.supprimeLe ? ', À LA CORBEILLE' : ''}. Aujourd'hui : ${jourLocal(maintenant)}.`,
    projets.length ? `Projets de la marque (une publication se crée sur l'un d'eux, outil « marketing » avec « projet ») : ${projets.map((p) => `${p.nom} (${p.id})`).join(', ')}.` : '',
    `Fiche : ${JSON.stringify(fiche)}.`,
    manquants.length ? `Points de la fiche encore à trancher, dans l'ordre : ${manquants.map((p) => LIBELLES_DES_POINTS[p].toLowerCase()).join(', ')}.` : 'La fiche a ses huit points.',
    `Stratégie : ${JSON.stringify(c.strategie)}.`,
    rubriques.length ? `Rubriques de la stratégie encore à trancher : ${rubriques.join(', ')}.` : 'La stratégie est complète.',
    contenus.length
      ? `Publications (${contenus.length}) : ${contenus
          .slice(0, 60)
          .map((x) => `${x.datePrevue ?? 'sans date'} · ${x.canal} · ${x.etape} · « ${x.titre} » (${x.id})`)
          .join(' ; ')}.`
      : 'Aucune publication encore : le programme vient une fois la fiche et la stratégie complètes.',
    `Médias rattachés : ${medias}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function purgerLaCorbeilleDesCampagnes(maintenant = Date.now()): number {
  const db = getDb();
  const echues = db.prepare('SELECT id FROM communication_campagnes WHERE supprime_le IS NOT NULL AND supprime_le <= ?').all(maintenant - DUREE_DE_LA_CORBEILLE_DES_CAMPAGNES_MS) as { id: string }[];
  let effacees = 0;
  for (const { id } of echues) {
    if (agentDeCampagneAuTravail(id)) continue;
    const agent = agentDeLaCampagne(id);
    db.transaction(() => {
      db.prepare("UPDATE marketing_contenus SET campagne_id = NULL WHERE campagne_id = ? AND etape != 'publie'").run(id);
      db.prepare('DELETE FROM communication_campagnes WHERE id = ?').run(id);
      db.prepare('DELETE FROM meta WHERE key = ?').run(cleDuChefDeCampagne(id));
    })();
    if (agent) {
      try {
        store.deleteAgent(agent.id);
      } catch (err) {
        log.warn('communication', `agent de la campagne ${id} non effacé`, err);
      }
    }
    effacees += 1;
  }
  if (effacees) {
    log.info('communication', `${effacees} campagne(s) effacée(s) de la corbeille`);
    diffuserMarques();
  }
  return effacees;
}


export function lireCampagne(marqueId: string, campagneId: string, compte: Compte, maintenant = Date.now()) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const ligne = getDb().prepare('SELECT * FROM communication_campagnes WHERE id = ? AND marque_id = ? AND supprime_le IS NULL').get(campagneId, marqueId) as LigneCampagne | undefined;
  if (!ligne) throw new Error('campagne introuvable');
  const campagne = versCampagne(ligne);
  const siens = contenusDeLaMarque(projets).filter((c) => c.campagneId === campagneId);
  const chiffres = chiffresDesContenus(projets);
  const parReseau = new Map<string, number>();
  for (const c of siens) {
    const ch = chiffres.get(c.id);
    const valeur = (ch?.vues ?? 0) + (ch?.clics ?? 0) + (ch?.visites ?? 0);
    parReseau.set(c.canal, (parReseau.get(c.canal) ?? 0) + valeur);
  }
  /* LA COURBE, JOUR PAR JOUR : les clics et visites venus de ses publications, cumulés, depuis son début. */
  const debut = campagne.debut ? new Date(`${campagne.debut}T00:00:00`).getTime() : ligne.cree_le;
  const fin = campagne.fin ? new Date(`${campagne.fin}T23:59:59`).getTime() : maintenant;
  const ids = siens.map((c) => c.id);
  const parJour = new Map<string, number>();
  if (ids.length) {
    const lignes = getDb()
      .prepare(`SELECT instant FROM marketing_evenements WHERE contenu_id IN (${marques(ids)}) AND instant >= ? AND instant <= ?`)
      .all(...ids, debut, fin) as { instant: number }[];
    for (const l of lignes) {
      const j = jourLocal(l.instant);
      parJour.set(j, (parJour.get(j) ?? 0) + 1);
    }
  }
  const familles = new Map<string, string>(
    ids.length
      ? (getDb().prepare(`SELECT id, COALESCE(declinaison_de, id) AS famille FROM marketing_contenus WHERE id IN (${marques(ids)})`).all(...ids) as { id: string; famille: string }[]).map((l) => [l.id, l.famille])
      : [],
  );
  const duree = Math.max(1, Math.round((fin - debut) / JOUR_MS));
  const ecoules = Math.max(1, Math.min(duree, Math.round((Math.min(maintenant, fin) - debut) / JOUR_MS) + 1));
  let cumul = 0;
  const courbe = Array.from({ length: ecoules }, (_, i) => {
    cumul += parJour.get(jourLocal(debut + i * JOUR_MS)) ?? 0;
    return cumul;
  });
  return {
    campagne,
    fiche: etatDeLaFiche(campagne),
    /* SON AGENT (10/11/2026) : la page de la campagne EST sa conversation ; ce qui reste à trancher remplit le volet. */
    strategieManquante: rubriquesManquantes(campagne.strategie),
    agentId: getMeta(cleDuChefDeCampagne(campagne.id)),
    agentAuTravail: agentDeCampagneAuTravail(campagne.id),
    atteint: avancementDeCampagne(campagne, siens, chiffres),
    jourEcoule: ecoules,
    duree,
    courbe,
    /* LA FAMILLE DE CHAQUE PUBLICATION (DEC-487) : la publication d'origine de ses déclinaisons par réseau, ou elle-même
       — Communication 2 montre un post décliné en UNE ligne. */
    publications: siens.map((c) => ({ ...c, chiffres: chiffres.get(c.id) ?? null, famille: familles.get(c.id) ?? c.id })),
    parReseau: [...parReseau].map(([reseau, valeur]) => ({ reseau, valeur })).sort((a, b) => b.valeur - a.valeur),
  };
}

/* ------------------------------------------------------------------ */
/* Les objectifs                                                        */
/* ------------------------------------------------------------------ */

interface LigneObjectif {
  id: string;
  marque_id: string;
  titre: string;
  mesure: string;
  cible: number | null;
  echeance: string | null;
  pourquoi: string | null;
  statut: string;
  cree_le: number;
  maj_le: number;
}

function versObjectif(l: LigneObjectif): ObjectifDeMarque {
  return {
    id: l.id,
    marqueId: l.marque_id,
    titre: l.titre,
    mesure: ((MESURES_D_OBJECTIF as readonly string[]).includes(l.mesure) ? l.mesure : 'visites') as MesureDObjectif,
    cible: l.cible,
    echeance: l.echeance,
    pourquoi: l.pourquoi,
    statut: ((STATUTS_D_OBJECTIF as readonly string[]).includes(l.statut) ? l.statut : 'propose') as StatutDObjectif,
    creeLe: l.cree_le,
  };
}

function lireObjectifsBruts(marqueId: string): ObjectifDeMarque[] {
  return (getDb().prepare("SELECT * FROM communication_objectifs WHERE marque_id = ? AND statut != 'abandonne' ORDER BY cree_le").all(marqueId) as LigneObjectif[]).map(versObjectif);
}

/**
 * ÉCRIRE UN OBJECTIF : le directeur le PROPOSE (statut par défaut), l'utilisateur le retient d'un clic
 * (`objectif.valider`). Un objectif chiffré se mesure sur ce que Beluga lit, depuis sa création.
 */
export function ecrireObjectif(
  entree: { id?: unknown; marqueId?: unknown; titre?: unknown; mesure?: unknown; cible?: unknown; echeance?: unknown; pourquoi?: unknown; statut?: unknown },
  compte: Compte,
  maintenant = Date.now(),
): ObjectifDeMarque {
  const db = getDb();
  const existant = typeof entree.id === 'string' && entree.id ? (db.prepare('SELECT * FROM communication_objectifs WHERE id = ?').get(entree.id) as LigneObjectif | undefined) : undefined;
  const marqueId = existant?.marque_id ?? String(entree.marqueId ?? '');
  marquePourLeCompte(marqueId, compte);
  const titre = entree.titre === undefined ? existant?.titre ?? '' : String(entree.titre).trim().slice(0, 140);
  if (!titre) throw new Error('Donnez un titre à cet objectif.');
  const champs = {
    titre,
    mesure: (MESURES_D_OBJECTIF as readonly unknown[]).includes(entree.mesure) ? String(entree.mesure) : existant?.mesure ?? 'visites',
    cible: entree.cible === undefined ? existant?.cible ?? null : Number.isFinite(Number(entree.cible)) && Number(entree.cible) > 0 ? Math.round(Number(entree.cible)) : null,
    echeance: entree.echeance === undefined ? existant?.echeance ?? null : typeof entree.echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entree.echeance) ? entree.echeance : null,
    pourquoi: entree.pourquoi === undefined ? existant?.pourquoi ?? null : String(entree.pourquoi).trim().slice(0, 400) || null,
    statut: (STATUTS_D_OBJECTIF as readonly unknown[]).includes(entree.statut) ? String(entree.statut) : existant?.statut ?? 'propose',
  };
  const id = existant?.id ?? store.newId();
  db.prepare(
    `INSERT INTO communication_objectifs (id, marque_id, titre, mesure, cible, echeance, pourquoi, statut, cree_le, maj_le)
     VALUES (@id, @marqueId, @titre, @mesure, @cible, @echeance, @pourquoi, @statut, @maintenant, @maintenant)
     ON CONFLICT(id) DO UPDATE SET titre = excluded.titre, mesure = excluded.mesure, cible = excluded.cible, echeance = excluded.echeance,
       pourquoi = excluded.pourquoi, statut = excluded.statut, maj_le = excluded.maj_le`,
  ).run({ id, marqueId, ...champs, maintenant });
  diffuserMarques();
  return versObjectif(db.prepare('SELECT * FROM communication_objectifs WHERE id = ?').get(id) as LigneObjectif);
}

/** Le geste de l'utilisateur : retenir (ou écarter) un objectif proposé. */
export function deciderDUnObjectif(id: unknown, statut: 'actif' | 'abandonne', compte: Compte): ObjectifDeMarque {
  const ligne = getDb().prepare('SELECT * FROM communication_objectifs WHERE id = ?').get(String(id ?? '')) as LigneObjectif | undefined;
  if (!ligne) throw new Error('objectif introuvable');
  return ecrireObjectif({ id: ligne.id, statut }, compte);
}

/** La valeur atteinte par un objectif depuis sa création, sur ce qu'il mesure. */
function valeurDObjectif(o: ObjectifDeMarque, projets: readonly string[]): number {
  if (!projets.length) return 0;
  if (o.mesure === 'visites') return [...visitesParJour(projets, o.creeLe).values()].reduce((a, b) => a + b, 0);
  if (o.mesure === 'clics' || o.mesure === 'vues') return [...chiffresDesContenus(projets, o.creeLe).values()].reduce((t, c) => t + (o.mesure === 'clics' ? c.clics : c.vues ?? 0), 0);
  const db = getDb();
  if (o.mesure === 'publications') {
    return (db
      .prepare(`SELECT COUNT(*) AS n FROM marketing_publications p JOIN marketing_contenus c ON c.id = p.contenu_id WHERE c.project_id IN (${marques(projets)}) AND p.etat = 'publie' AND p.publie_le >= ?`)
      .get(...projets, o.creeLe) as { n: number }).n;
  }
  /* LES ABONNÉS GAGNÉS : le dernier relevé de chaque compte moins son premier relevé depuis la création. */
  const lignes = db
    .prepare(`SELECT compte_id, abonnes FROM marketing_audience WHERE project_id IN (${marques(projets)}) AND publication = '' AND abonnes IS NOT NULL AND jour >= ? ORDER BY jour`)
    .all(...projets, jourLocal(o.creeLe)) as { compte_id: string; abonnes: number }[];
  const premiers = new Map<string, number>();
  const derniers = new Map<string, number>();
  for (const l of lignes) {
    if (!premiers.has(l.compte_id)) premiers.set(l.compte_id, l.abonnes);
    derniers.set(l.compte_id, l.abonnes);
  }
  return [...derniers].reduce((t, [c, d]) => t + Math.max(0, d - (premiers.get(c) ?? d)), 0);
}

export function lireObjectifs(marqueId: string, compte: Compte) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const campagnes = lireCampagnesBrutes(marqueId);
  return {
    objectifs: lireObjectifsBruts(marqueId).map((o) => {
      const atteint = valeurDObjectif(o, projets);
      return {
        ...o,
        atteint,
        avancement: avancementDObjectif(o, atteint),
        campagnes: campagnes.filter((c) => c.objectifId === o.id).map((c) => ({ id: c.id, titre: c.titre, statut: c.statut })),
      };
    }),
    /* LES CAMPAGNES QUI NE SERVENT AUCUN OBJECTIF : montrées à part, pour qu'on les rattache. */
    campagnesSansObjectif: campagnes.filter((c) => !c.objectifId).map((c) => ({ id: c.id, titre: c.titre, statut: c.statut })),
  };
}

/* ------------------------------------------------------------------ */
/* La démarche                                                          */
/* ------------------------------------------------------------------ */

/** L'avancement de l'analyse approfondie (propriétaire) : 100 close, 50 en cours, 25 dossier préparé ; `null` sans dossier. */
function avancementDeLAnalyse(projets: readonly string[]): number | null {
  let avancement: number | null = null;
  return avancement;
}

/** LA DÉMARCHE D'UNE MARQUE, lue en base : compte relié, analyse, objectifs, campagnes. */
export function demarcheDUneMarque(marqueId: string, projets: readonly string[]): DemarcheDeMarque {
  const espaces = projets.map((p) => lireEspace(p)).filter((e): e is NonNullable<typeof e> => !!e);
  const objectifs = lireObjectifsBruts(marqueId);
  const retenus = objectifs.filter((o) => o.statut === 'actif' || o.statut === 'atteint');
  const campagnes = lireCampagnesBrutes(marqueId);
  return demarcheDeLaMarque({
    comptesRelies: projets.reduce((t, p) => t + listerComptes(p).filter((c) => c.etat === 'relie').length, 0),
    reseauxChoisis: Math.max(0, ...espaces.map((e) => e.configuration.canaux.filter((c) => (RESEAUX_SOCIAUX as readonly string[]).includes(c)).length)),
    bilan: espaces.some((e) => !!e.rapport),
    analyseApprofondie: avancementDeLAnalyse(projets),
    objectifs: retenus.length,
    objectifsProposes: objectifs.filter((o) => o.statut === 'propose').length,
    objectifsAtteints: objectifs.filter((o) => o.statut === 'atteint').length,
    objectifsCouverts: retenus.filter((o) => campagnes.some((c) => c.objectifId === o.id)).length,
    campagnesEnCours: campagnes.filter((c) => c.statut === 'en_cours').length,
    campagnesEnPreparation: campagnes.filter((c) => c.statut === 'preparation').length,
    campagnesTerminees: campagnes.filter((c) => c.statut === 'terminee').length,
  });
}

/* ------------------------------------------------------------------ */
/* Ce que chaque lieu lit                                               */
/* ------------------------------------------------------------------ */

export function compteDesAccords(projets: readonly string[]): number {
  if (!projets.length) return 0;
  const lignes = getDb()
    .prepare(`SELECT source_ref, sorti_de_reserve_le, etape FROM marketing_contenus WHERE project_id IN (${marques(projets)}) AND etape = 'a_valider'`)
    .all(...projets) as { source_ref: string | null; sorti_de_reserve_le: number | null; etape: string }[];
  return lignes.filter((l) => !(l.source_ref?.startsWith('changelog:') && !l.sorti_de_reserve_le)).length;
}

function messagesNonLus(projets: readonly string[]): number {
  if (!projets.length) return 0;
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM marketing_messages WHERE project_id IN (${marques(projets)}) AND lu = 0 AND sortant = 0`).get(...projets) as { n: number }).n;
}

export interface LigneDeMarque {
  id: string;
  nom: string;
  origine: OrigineDeMarque;
  projets: { id: string; nom: string; favicon: string | null }[];
  /** L'étape de la démarche en cours (compte, analyse, objectifs, campagnes) ; `null` quand tout est fait. */
  etape: EtapeDeDemarcheId | null;
  /** L'avancement de la démarche, de 0 à 100. */
  avancement: number;
  accords: number;
  messages: number;
  favicon: string | null;
  /** COMMUNICATION 2 : ce qui coche ses quatre étapes (`etapesDeLaMarqueV2`), lu en base. */
  v2: EntreeDesEtapesV2;
}

/** Les publications validées, programmées ou parties d'une marque : le calendrier de Communication 2 a commencé à vivre. */
function publicationsPlanifiees(projets: readonly string[]): number {
  if (!projets.length) return 0;
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM marketing_contenus WHERE project_id IN (${marques(projets)}) AND etape IN ('pret', 'programme', 'publie')`).get(...projets) as { n: number }).n;
}

/** Les réseaux sociaux CHOISIS d'une marque (étape Réseaux de Communication 2) : le plus grand nombre parmi ses projets. */
function reseauxChoisisDeLaMarque(projets: readonly string[]): number {
  return Math.max(
    0,
    ...projets.map((p) => lireEspace(p)?.configuration.canaux.filter((c) => (RESEAUX_SOCIAUX as readonly string[]).includes(c)).length ?? 0),
  );
}

/**
 * LES CAMPAGNES PRÊTES D'UNE MARQUE (étape « Campagnes » de Communication 2, 12/11/2026) : chaque date prévue a son
 * visuel. Les publications ne se relisent que si la marque a des campagnes.
 */
function campagnesPretesDeLaMarque(marqueId: string, projets: readonly string[]): number {
  const campagnes = lireCampagnesBrutes(marqueId);
  if (!campagnes.length) return 0;
  const contenus = contenusDeLaMarque(projets);
  return campagnes.filter((c) =>
    campagnePrete(visuelsDeLaCampagne(c.quantiteMedias, contenus.filter((x) => x.campagneId === c.id).map((x) => ({ datePrevue: x.datePrevue, aUnVisuel: !!x.apercu })))),
  ).length;
}

/** La colonne : une ligne par marque, avec l'étape de sa démarche et ce qui attend. */
export function listerLesMarques(compte: Compte, maintenant = Date.now()): { marques: LigneDeMarque[]; propositions: RegroupementPropose[]; comptesRelies: number } {
  const lignes: LigneDeMarque[] = [];
  for (const marque of listerToutesLesMarques()) {
    const projets = projetsVisibles(marque, compte);
    if (!projets.length) continue;
    const demarche = demarcheDUneMarque(marque.id, projets);
    const descriptions = projets.map((id) => store.getProject(id)).filter((p): p is NonNullable<typeof p> => !!p);
    lignes.push({
      id: marque.id,
      nom: marque.nom,
      origine: marque.origine,
      projets: descriptions.map((p) => ({ id: p.id, nom: p.name, favicon: p.favicon ?? null })),
      etape: demarche.enCours,
      avancement: demarche.avancement,
      accords: compteDesAccords(projets),
      messages: messagesNonLus(projets),
      favicon: descriptions.find((p) => p.favicon)?.favicon ?? null,
      v2: {
        reseauxChoisis: reseauxChoisisDeLaMarque(projets),
        comptesRelies: projets.reduce((t, p) => t + listerComptes(p).filter((c) => c.etat === 'relie').length, 0),
        campagnes: lireCampagnesBrutes(marque.id).length,
        campagnesPretes: campagnesPretesDeLaMarque(marque.id, projets),
        publicationsPlanifiees: publicationsPlanifiees(projets),
      },
    });
  }
  const comptesRelies = lignes.flatMap((l) => l.projets).reduce((t, p) => t + listerComptes(p.id).filter((c) => c.etat === 'relie').length, 0);
  return { marques: lignes, propositions: propositionsDeRegroupement(compte), comptesRelies };
}

/** LA VUE D'ENSEMBLE : les chiffres réunis, puis une ligne par marque. */
export async function lireVueGlobale(compte: Compte, periode: number, maintenant = Date.now()) {
  const base = listerLesMarques(compte, maintenant);
  const lignes = await Promise.all(
    base.marques.map(async (m) => {
      const ids = m.projets.map((p) => p.id);
      const tuiles = await tuilesDeMarque(ids, periode, maintenant);
      return { ...m, tuiles, medias: mediasFinisDeLaMarque(ids).medias.length };
    }),
  );
  return {
    periode,
    lignes: lignes.sort((a, b) => b.tuiles.visites - a.tuiles.visites),
    propositions: base.propositions,
    comptesRelies: base.comptesRelies,
    totaux: {
      visites: lignes.reduce((t, l) => t + l.tuiles.visites, 0),
      visitesAvant: lignes.reduce((t, l) => t + l.tuiles.visitesAvant, 0),
      accords: lignes.reduce((t, l) => t + l.accords, 0),
      marquesEnAttente: lignes.filter((l) => l.accords > 0).length,
      medias: lignes.reduce((t, l) => t + l.medias, 0),
    },
  };
}

/** L'ACCUEIL D'UNE MARQUE : où elle en est, ce qui attend, ce qui est parti. */
export async function lireAccueil(marqueId: string, compte: Compte, periode: number, maintenant = Date.now()) {
  const { marque, projets } = marquePourLeCompte(marqueId, compte);
  const demarche = demarcheDUneMarque(marque.id, projets);
  const tuiles = await tuilesDeMarque(projets, periode, maintenant);
  const { circuit } = contenusDuCircuit(contenusDeLaMarque(projets));
  const chiffres = chiffresDesContenus(projets);
  const attente = circuit
    .filter((c) => c.etape === 'a_valider')
    .sort((a, b) => (a.datePrevue ?? '9999').localeCompare(b.datePrevue ?? '9999'));
  const parties = circuit
    .filter((c) => c.etape === 'publie')
    .map((c) => ({ ...c, chiffres: chiffres.get(c.id) ?? null }))
    .sort((a, b) => (b.chiffres?.publieLe ?? b.majLe) - (a.chiffres?.publieLe ?? a.majLe))
    .slice(0, 5);
  const etats = etatsDesMedias();
  const mediasEnAttente = mediasFinisDeLaMarque(projets).medias
    .filter((m) => etatDeMedia(m, etats.get(m.cle)?.etat) === 'a_valider')
    .slice(0, 5);
  return {
    marque: { ...marque, projets, projetsNoms: projets.map((p) => ({ id: p, nom: store.getProject(p)?.name ?? p })) },
    demarche,
    /* « NOUVELLE CAMPAGNE » ACQUISE : déjà montrée une fois, ou une campagne existe — le bouton ne cède plus sa place. */
    campagneAcquise: campagneAcquise(marque.id),
    objectifs: lireObjectifsBruts(marque.id).filter((o) => o.statut !== 'atteint').length,
    objectifsProposes: lireObjectifsBruts(marque.id).filter((o) => o.statut === 'propose').length,
    campagnes: lireCampagnesBrutes(marque.id).filter((c) => c.statut !== 'terminee').length,
    tuiles,
    periode,
    attente: attente.slice(0, 8),
    attenteTotal: attente.length,
    manquants: mediasManquants(attente),
    mediasEnAttente,
    publications: parties,
    comptesRelies: projets.reduce((t, p) => t + listerComptes(p).filter((c) => c.etat === 'relie').length, 0),
    aUnBilan: projets.some((p) => !!lireEspace(p)?.rapport),
  };
}

/** PUBLICATIONS : le calendrier et la liste lisent les mêmes contenus, hors réserve. */
export async function lirePublications(marqueId: string, compte: Compte, periode: number, maintenant = Date.now()) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const { circuit, reserve } = contenusDuCircuit(contenusDeLaMarque(projets));
  const chiffres = chiffresDesContenus(projets, maintenant - periode * JOUR_MS);
  const comptes = projets.flatMap((p) => listerComptes(p));
  const serie = serieDeVisites(projets, 90, maintenant);
  const principal = projets[0];
  const espace = principal ? lireEspace(principal) : null;
  /* UN POST QUI PASSE PAR CHROME (09/11/2026) : « attend Chrome » quand son heure est passée et Chrome fermé, « publié
     en retard » quand il est parti au rattrapage. */
  const parChrome = new Set(comptes.filter((c) => c.mode === 'chrome').map((c) => c.id));
  const ciblesParContenu = new Map(projets.flatMap((p) => [...ciblesDuProjet(p)]));
  return {
    periode,
    contenus: circuit.map((c) => ({
      ...c,
      chiffres: chiffres.get(c.id) ?? null,
      envoiChrome: envoiParChromeDuContenu({
        prevuLe: instantPrevu(c.datePrevue, c.heurePrevue),
        etape: c.etape,
        cibles: (ciblesParContenu.get(c.id) ?? []).map((x) => ({ etat: x.etat, chrome: parChrome.has(x.compteId), publieLe: x.publieLe })),
        maintenant,
      }),
    })),
    reserve: reserve.length,
    actions: projets.flatMap((p) => listerActions(p)),
    comptes,
    canauxChoisis: espace?.configuration.canaux ?? [],
    tuiles: await tuilesDeMarque(projets, periode, maintenant),
    jourLePlusRegarde: jourLePlusRegarde(serie),
    manquants: mediasManquants(circuit.filter((c) => (c.datePrevue ?? '') >= jourLocal(maintenant))),
    campagnes: lireCampagnesBrutes(marqueId).map((c) => ({ id: c.id, titre: c.titre, debut: c.debut, fin: c.fin })),
    canauxSansPublication: CANAUX_SANS_PUBLICATION,
  };
}

/** Combien de contenus partent dans les `jours` prochains : ce qui dit si le calendrier a des créneaux à remplir. */
export function contenusAVenir(projets: readonly string[], jours: number, maintenant = Date.now()): number {
  if (!projets.length) return 0;
  return (getDb()
    .prepare(`SELECT COUNT(*) AS n FROM marketing_contenus WHERE project_id IN (${marques(projets)}) AND date_prevue >= ? AND date_prevue <= ? AND etape IN ('a_valider', 'pret', 'programme')`)
    .get(...projets, jourLocal(maintenant), jourLocal(maintenant + jours * JOUR_MS)) as { n: number }).n;
}

/** LA RÉSERVE D'IDÉES : les annonces écrites à chaque livraison, les plus récentes d'abord. */
export function lireReserve(marqueId: string, compte: Compte) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const { reserve } = contenusDuCircuit(contenusDeLaMarque(projets));
  return { contenus: [...reserve].sort((a, b) => b.creeLe - a.creeLe).map((c) => ({ id: c.id, titre: c.titre, texte: c.texte, canal: c.canal, creeLe: c.creeLe, projectId: c.projectId, etape: c.etape })) };
}

export function sortirDeLaReserve(contenuId: unknown, compte: Compte, maintenant = Date.now()): void {
  const contenu = lireContenu(String(contenuId ?? ''));
  if (!contenu) throw new Error('contenu introuvable');
  projetDansLaMarque(contenu.projectId, compte);
  getDb().prepare("UPDATE marketing_contenus SET sorti_de_reserve_le = ?, etape = CASE WHEN etape = 'brouillon' THEN 'a_valider' ELSE etape END, maj_le = ? WHERE id = ?").run(maintenant, maintenant, contenu.id);
  diffuser(contenu.projectId);
}

/** MESSAGES : tout ce qui est reçu, fil par fil, avec la publication d'origine. */
export function lireMessages(marqueId: string, compte: Compte, maintenant = Date.now()) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const messages = projets.flatMap((p) => listerMessages(p));
  const contenus = new Map(contenusDeLaMarque(projets).map((c) => [c.id, c]));
  const chiffres = chiffresDesContenus(projets);
  const parFil = new Map<string, typeof messages>();
  for (const m of messages) {
    const cle = `${m.compteId}\n${m.genre === 'commentaire' ? m.id : m.fil}`;
    parFil.set(cle, [...(parFil.get(cle) ?? []), m]);
  }
  /* UN COMMENTAIRE EST SA PROPRE LIGNE ; ses réponses se rattachent par le fil de sa publication. */
  const lignes = [...parFil.values()]
    .map((liste) => {
      const tries = [...liste].sort((a, b) => a.instant - b.instant);
      const dernierRecu = [...tries].reverse().find((m) => !m.sortant) ?? tries[tries.length - 1]!;
      const reponse = messages.some((r) => r.sortant && r.fil === dernierRecu.fil && r.instant > dernierRecu.instant);
      const contenu = dernierRecu.contenuId ? contenus.get(dernierRecu.contenuId) : undefined;
      return {
        id: dernierRecu.id,
        genre: dernierRecu.genre,
        reseau: dernierRecu.reseau,
        auteur: dernierRecu.auteur,
        texte: dernierRecu.texte,
        instant: dernierRecu.instant,
        lu: dernierRecu.lu,
        brouillon: dernierRecu.brouillon ?? null,
        repondu: reponse,
        masqueLe: dernierRecu.masqueLe ?? null,
        fil: dernierRecu.fil,
        contenu: contenu ? { id: contenu.id, titre: contenu.titre, apercu: contenu.apercu } : null,
      };
    })
    .filter((l) => l.auteur)
    .sort((a, b) => b.instant - a.instant);
  const recus = messages.filter((m) => !m.sortant && m.instant >= maintenant - 30 * JOUR_MS);
  return {
    lignes,
    tuiles: {
      aTraiter: lignes.filter((l) => !l.repondu).length,
      pretes: lignes.filter((l) => !l.repondu && !!l.brouillon).length,
      tempsMedian: tempsDeReponseMedian(messages),
      recus: recus.length,
      commentaires: recus.filter((m) => m.genre === 'commentaire').length,
      prives: recus.filter((m) => m.genre !== 'commentaire').length,
    },
    comptes: projets.flatMap((p) => listerComptes(p)).length,
    chiffresDesContenus: Object.fromEntries([...chiffres].filter(([id]) => lignes.some((l) => l.contenu?.id === id))),
  };
}

/** UN FIL OUVERT : tous ses échanges, la réponse préparée et la publication d'origine. */
export function lireFilDeMessage(marqueId: string, messageId: string, compte: Compte) {
  const { projets } = marquePourLeCompte(marqueId, compte);
  const messages = projets.flatMap((p) => listerMessages(p));
  const message = messages.find((m) => m.id === messageId);
  if (!message) throw new Error('message introuvable');
  const fil = messages
    .filter((m) => m.compteId === message.compteId && m.fil === message.fil && (message.genre !== 'commentaire' || m.sortant || m.auteur === message.auteur))
    .sort((a, b) => a.instant - b.instant);
  const contenu = message.contenuId ? contenusDeLaMarque(projets).find((c) => c.id === message.contenuId) ?? null : null;
  const chiffres = contenu ? chiffresDesContenus(projets).get(contenu.id) ?? null : null;
  const fiche = FICHES_RESEAUX[message.reseau];
  const dernierRecu = [...fil].reverse().find((m) => !m.sortant);
  return {
    message,
    fil,
    contenu,
    chiffres,
    limite: message.genre !== 'commentaire' && fiche.fenetreMessagesH && dernierRecu ? dernierRecu.instant + fiche.fenetreMessagesH * 3_600_000 : null,
    auteur: {
      messages: fil.filter((m) => !m.sortant).length,
      depuis: fil[0]?.instant ?? null,
    },
  };
}

/**
 * CONNEXION (étape 3 de Communication 2, 09/11/2026) : une ligne par réseau CHOISI — son état (connecté par la voie
 * officielle ou par Chrome, en cours, bloqué, à connecter), ce que l'agent en a dit, et si un Chrome de la personne est
 * ouvert (sans lui, l'agent ne peut rien faire).
 */
export async function lireConnexion(marqueId: string, compte: Compte) {
  const { marque, projets } = marquePourLeCompte(marqueId, compte);
  const principal = marque.projetPrincipal ?? projets[0] ?? null;
  const { lireConnexionsDuProjet, carteDeConnexionEnCours } = await import('./connexion-des-reseaux.js');
  const { chromesDuCompte } = await import('./extension-chrome.js');
  const { etatDeLaLigneDeConnexion } = await import('@beluga/shared');
  const espaces = projets.map((p) => lireEspace(p)).filter((e): e is NonNullable<typeof e> => !!e);
  const comptes = projets.flatMap((p) => listerComptes(p));
  const choisis = new Set([...espaces.flatMap((e) => e.configuration.canaux), ...comptes.map((c) => c.reseau)]);
  const connexions = Object.assign({}, ...projets.map((p) => lireConnexionsDuProjet(p))) as ReturnType<typeof lireConnexionsDuProjet>;
  const agent = principal ? carteDeConnexionEnCours(principal) : null;
  const chromes = compte.id ? chromesDuCompte(compte.id) : [];
  return {
    principal,
    chrome: { relies: chromes.length, ouverts: chromes.filter((c) => c.enLigne).length },
    agent,
    reseaux: RESEAUX_SOCIAUX.filter((r) => choisis.has(r) && FICHES_RESEAUX[r].publier).map((reseau) => {
      const siens = comptes.filter((c) => c.reseau === reseau);
      const connexion = connexions[reseau] ?? null;
      return {
        reseau,
        libelle: FICHES_RESEAUX[reseau].libelle,
        comptes: siens,
        connexion,
        etat: etatDeLaLigneDeConnexion({ comptes: siens, connexion, agentAuTravail: !!agent && connexion?.etat === 'en_cours' }),
      };
    }),
  };
}

/** CANAUX : une ligne par réseau, ce qu'il permet, le compte relié et l'avis sur cette marque. */
export function lireCanaux(marqueId: string, compte: Compte) {
  const { marque, projets } = marquePourLeCompte(marqueId, compte);
  const espaces = projets.map((p) => lireEspace(p)).filter((e): e is NonNullable<typeof e> => !!e);
  const comptes = projets.flatMap((p) => listerComptes(p));
  const applications = listerApplications();
  const recommandations = espaces.flatMap((e) => e.configuration.recommandations);
  const choisis = new Set(espaces.flatMap((e) => e.configuration.canaux));
  /* LES CHIFFRES PAR RÉSEAU (panneau Canaux, 04/11/2026) : abonnés, vues et réactions des 30 derniers jours, d'après
     les relevés réels. Un réseau qui ne les donne pas, ou pas encore relevé, n'a pas de chiffres — jamais un zéro. */
  const tuiles = comptes.length ? projets.flatMap((p) => audienceDuProjet(p, 30).reseaux) : [];
  const chiffresDu = (reseau: string) => {
    const lues = tuiles.filter((t) => t.reseau === reseau && t.ouvert && t.releve);
    if (!lues.length) return null;
    const total = (f: (b: (typeof lues)[number]['bilan']) => number | null) => {
      const n = lues.map((l) => f(l.bilan)).filter((v): v is number => v !== null);
      return n.length ? n.reduce((a, b) => a + b, 0) : null;
    };
    return { abonnes: total((b) => b.abonnes), vues: total((b) => b.vues), reactions: total((b) => b.reactions) };
  };
  return {
    principal: marque.projetPrincipal ?? projets[0] ?? null,
    reseaux: RESEAUX_SOCIAUX.map((reseau) => {
      const fiche = FICHES_RESEAUX[reseau];
      const avis = recommandations.find((r) => r.canal === reseau) ?? null;
      const siens = comptes.filter((c) => c.reseau === reseau);
      return {
        reseau,
        libelle: fiche.libelle,
        publier: fiche.publier,
        commentaires: fiche.commentaires,
        messages: fiche.messages,
        chiffres: fiche.chiffres,
        note: fiche.note,
        comptes: siens,
        application: applications.find((a) => a.application === fiche.application) ?? null,
        choisi: choisis.has(reseau) || siens.length > 0,
        avis: avis ? { pertinence: avis.pertinence, raison: avis.raison, premierPas: avis.premierPas } : null,
        chiffres30j: siens.length ? chiffresDu(reseau) : null,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* La stratégie                                                         */
/* ------------------------------------------------------------------ */

/** Ce que l'écran lit d'une analyse approfondie. La forme est publique, le calcul reste au propriétaire. */
export interface AnalyseApprofondie {
  dossierId: string;
  /** Où elle se lit : donnée par le démon, pour que l'écran ne nomme jamais le service réservé. */
  adresse: string;
  missionId: string;
  indice: number | null;
  axes: { axe: string; note: number | null }[];
  appreciation: string | null;
  forces: string[];
  faiblesses: string[];
  actions: string[];
  version: number;
  rapports: { id: string; genre: string; version: number; nom: string; pages: number | null }[];
}


/** STRATÉGIE : le rapport résumé, puis les rapports complets. Le même gabarit, avec ou sans analyse approfondie. */
export async function lireStrategie(marqueId: string, compte: Compte) {
  const { marque, projets } = marquePourLeCompte(marqueId, compte);
  const espaces = projets.map((p) => lireEspace(p)).filter((e): e is NonNullable<typeof e> => !!e);
  const avecRapport = espaces.find((e) => e.rapport) ?? espaces[0] ?? null;
  const fiche = (avecRapport?.fiche ?? {}) as Record<string, unknown>;
  const resume = resumerLeRapport(avecRapport?.rapport, { promesse: typeof fiche.promesse === 'string' ? fiche.promesse : null });
  let approfondie: AnalyseApprofondie | null = null;
  let adresseDesDossiers: string | null = null;
  /* L'OUTIL MARKETING VU D'ICI (03/11/2026) : avancement, prochaine étape payante et résultats, lus sans recalcul. */
  let outil: unknown = null;
  let peutLancer = false;
  const { objectifs, campagnesSansObjectif } = lireObjectifs(marque.id, compte);
  return {
    marque: { id: marque.id, nom: marque.nom, projetPrincipal: avecRapport?.projectId ?? marque.projetPrincipal ?? null },
    /* LA PAGE SE LIT DE HAUT EN BAS (décision du 03/11/2026) : l'analyse, puis les objectifs, puis les campagnes de chacun. */
    objectifs,
    campagnesSansObjectif,
    popularite: { tuiles: await tuilesDeMarque(projets, 30, Date.now()), comptes: projets.flatMap((p) => listerComptes(p)).filter((c) => c.etat === 'relie').map((c) => ({ reseau: c.reseau, nom: c.nom ?? null })) },
    resume,
    rapport: avecRapport?.rapport ?? null,
    rapportLe: avecRapport?.rapportLe ?? null,
    fiche,
    concurrents: typeof fiche.concurrents === 'string' ? fiche.concurrents : null,
    approfondie,
    adresseDesDossiers,
    outil,
    peutLancer,
  };
}

/** « Nouvelle campagne » est-elle acquise pour cette marque (montrée une fois, ou une campagne existe) ? */
function campagneAcquise(marqueId: string): boolean {
  const db = getDb();
  const ligne = db.prepare('SELECT campagne_montree_le AS le FROM communication_marques WHERE id = ?').get(marqueId) as { le: number | null } | undefined;
  return !!ligne?.le || !!db.prepare('SELECT 1 FROM communication_campagnes WHERE marque_id = ? LIMIT 1').get(marqueId);
}

/** LES GESTES DE L'UTILISATEUR, joués à son clic et avec ses droits. Aucun agent ne passe par ici. */
export async function jouerUnGeste(entree: Record<string, unknown>, compte: Compte): Promise<Record<string, unknown>> {
  const geste = String(entree.geste ?? '');
  const id = String(entree.id ?? '');
  const contenuAutorise = () => {
    const contenu = lireContenu(id);
    if (!contenu) throw new Error('contenu introuvable');
    projetEnTravail(contenu.projectId, compte);
    return contenu;
  };
  switch (geste) {
    case 'contenu.valider':
    case 'contenu.etape': {
      contenuAutorise();
      const { changerEtape } = await import('./marketing.js');
      const r = changerEtape(id, geste === 'contenu.valider' ? 'pret' : entree.etape, 'humain');
      if (!r.ok) throw new Error(r.raison);
      return { contenu: r.contenu };
    }
    case 'contenu.date': {
      /* REPORTER (bloc « Planification » d'un média, carte « Planification des publications ») : le jour ET, s'il est
         donné, l'heure — de CE post seulement. Une date passée se refuse : on reporte vers l'avenir. */
      const contenu = contenuAutorise();
      if (contenu.etape === 'publie') throw new Error('Une publication partie ne bouge plus.');
      if (typeof entree.datePrevue === 'string' && entree.datePrevue && entree.datePrevue < jourLocal(Date.now())) throw new Error('Choisissez une date à venir.');
      const { modifierContenu } = await import('./marketing.js');
      const r = modifierContenu(id, { datePrevue: entree.datePrevue, ...(entree.heurePrevue !== undefined ? { heurePrevue: entree.heurePrevue } : {}) }, 'humain');
      if (!r.ok) throw new Error(r.raison);
      return { contenu: r.contenu };
    }
    case 'publication.valider': {
      /* « VALIDER » DU BLOC PLANIFICATION : d'un seul geste, la publication du réseau regardé (prête à partir) ET son
         média (validé). Les autres déclinaisons du post gardent leur état : chacune se valide sur son réseau. */
      const contenu = contenuAutorise();
      const cle = String(entree.media ?? '');
      if (cle) verifierLePorteurDuMedia(cle, compte);
      if (contenu.etape === 'brouillon' || contenu.etape === 'a_valider') {
        const { changerEtape } = await import('./marketing.js');
        const r = changerEtape(id, 'pret', 'humain');
        if (!r.ok) throw new Error(r.raison);
      }
      if (cle) ecrireEtatDuMedia(cle, 'valide', compte);
      return { contenu: lireContenu(id) };
    }
    case 'contenu.publier': {
      contenuAutorise();
      const { publierContenu } = await import('./publication-sociale.js');
      const r = await publierContenu(id, 'maintenant');
      if (!r.ok) throw new Error(r.raison);
      return { bilan: r.bilan };
    }
    case 'contenu.campagne':
      rattacherContenuACampagne(id, entree.campagneId, compte);
      return {};
    case 'contenu.media':
      lierMediaAuContenu(id, entree.attachmentIds ?? entree.attachmentId, compte);
      return {};
    case 'media.valider':
      ecrireEtatDuMedia(id, 'valide', compte);
      return {};
    case 'marque.campagne_montree': {
      /* Posé par l'écran au premier affichage de « Nouvelle campagne » : une fois, jamais retiré. */
      const { marque } = marquePourLeCompte(id, compte);
      getDb().prepare('UPDATE communication_marques SET campagne_montree_le = COALESCE(campagne_montree_le, ?) WHERE id = ?').run(Date.now(), marque.id);
      return {};
    }
    case 'media.etat':
      ecrireEtatDuMedia(id, entree.etat, compte);
      return {};
    case 'media.version':
      revenirAUneVersion(id, compte);
      return {};
    case 'media.campagne':
      rattacherMediaACampagne(id, entree.campagneId, compte, entree.publications);
      return {};
    case 'media.supprimer':
      mettreMediaALaCorbeille(id, compte, entree.publications, Date.now(), entree.campagneId);
      return {};
    case 'media.restaurer':
      restaurerMedia(id, entree.versions, compte);
      return {};
    case 'campagne.creer': {
      /* « NOUVELLE CAMPAGNE » = UNE CONVERSATION (10/11/2026) : la campagne et son agent naissent au premier message. */
      marqueEnTravail(id, compte);
      const { creerCampagneAvecSonAgent } = await import('./directeur-marketing.js');
      return creerCampagneAvecSonAgent(compte, id, entree.texte, entree.pieces, entree.reseaux);
    }
    case 'campagne.agent': {
      /* L'AGENT D'UNE CAMPAGNE déjà là, ou né à sa première ouverture (mot d'accueil sans moteur). */
      const ligne = getDb().prepare('SELECT marque_id FROM communication_campagnes WHERE id = ? AND supprime_le IS NULL').get(id) as { marque_id: string } | undefined;
      if (!ligne) throw new Error('campagne introuvable');
      marquePourLeCompte(ligne.marque_id, compte);
      const { chefDeCampagne } = await import('./directeur-marketing.js');
      const agent = await chefDeCampagne(compte, ligne.marque_id, id);
      return { agentId: agent.id };
    }
    case 'campagne.supprimer':
      return supprimerCampagne(id, compte);
    case 'campagne.restaurer':
      return restaurerCampagne(id, compte);
    case 'reserve.sortir':
      contenuAutorise();
      sortirDeLaReserve(id, compte);
      return {};
    case 'regroupement.valider':
      return { marque: reunirLesProjets({ nom: entree.nom, projets: entree.projets }, compte) };
    case 'objectif.valider':
      return { objectif: deciderDUnObjectif(id, 'actif', compte) };
    case 'objectif.ecarter':
      return { objectif: deciderDUnObjectif(id, 'abandonne', compte) };
    case 'message.repondre': {
      const message = getDb().prepare('SELECT project_id FROM marketing_messages WHERE id = ?').get(id) as { project_id: string } | undefined;
      if (!message) throw new Error('message introuvable');
      projetEnTravail(message.project_id, compte);
      const { repondre } = await import('./publication-sociale.js');
      const r = await repondre(id, entree.texte);
      if (!r.ok) throw new Error(r.raison);
      return { message: r.message };
    }
    case 'commentaire.masquer':
    case 'commentaire.supprimer': {
      /* RIEN NE PART SANS CLIC : ce geste n'est joué que par un bouton de la page Commentaires, avec les droits du
         compte qui clique ; le réseau dit lui-même s'il le permet (`raisonModerationImpossible`). */
      const message = getDb().prepare('SELECT project_id FROM marketing_messages WHERE id = ?').get(id) as { project_id: string } | undefined;
      if (!message) throw new Error('commentaire introuvable');
      projetEnTravail(message.project_id, compte);
      const { modererCommentaire } = await import('./publication-sociale.js');
      const r = await modererCommentaire(id, geste === 'commentaire.masquer' ? 'masquer' : 'supprimer');
      if (!r.ok) throw new Error(r.raison);
      return {};
    }
    case 'message.brouillon': {
      const message = getDb().prepare('SELECT project_id FROM marketing_messages WHERE id = ?').get(id) as { project_id: string } | undefined;
      if (!message) throw new Error('message introuvable');
      projetEnTravail(message.project_id, compte);
      const { proposerReponse } = await import('./publication-sociale.js');
      const r = proposerReponse(id, entree.texte, message.project_id);
      if (!r.ok) throw new Error(r.raison);
      return { message: r.message };
    }
    case 'messages.lus': {
      const projectId = String(entree.projectId ?? '');
      projetEnTravail(projectId, compte);
      const { marquerMessagesLus } = await import('./publication-sociale.js');
      return { lus: marquerMessagesLus(projectId, entree.ids) };
    }
    case 'action.faite': {
      const { lireAction, marquerActionFaite } = await import('./marketing.js');
      const action = lireAction(id);
      if (!action) throw new Error('action introuvable');
      projetEnTravail(action.projectId, compte);
      const r = marquerActionFaite(id, entree.fait === true);
      if (!r.ok) throw new Error(r.raison);
      return { action: r.action };
    }
    case 'action.date': {
      const { lireAction, ecrireAction } = await import('./marketing.js');
      const action = lireAction(id);
      if (!action) throw new Error('action introuvable');
      projetEnTravail(action.projectId, compte);
      const r = ecrireAction(action.projectId, { id, datePrevue: entree.datePrevue as string });
      if (!r.ok) throw new Error(r.raison);
      return { action: r.action };
    }
    case 'canal.choisir': {
      /* L'ÉTAPE RÉSEAUX (09/11/2026) : on CHOISIT un réseau, sans rien relier — la connexion vient après les campagnes. */
      const [projectId, reseau] = id.split('/');
      projetEnTravail(projectId ?? '', compte);
      if (!estReseauSocial(reseau)) throw new Error('réseau inconnu');
      const espace = assurerEspace(projectId!);
      const avant = espace.configuration.canaux.filter((c) => c !== reseau);
      const e = ecrireConfiguration(projectId!, { canaux: entree.choisi === false ? avant : [...avant, reseau] });
      return { canaux: e.configuration.canaux };
    }
    case 'compte.connecter': {
      /* L'ÉTAPE CONNEXION (09/11/2026) : un agent par projet, dans le Chrome de la personne qui clique. */
      const projectId = id;
      projetEnTravail(projectId, compte);
      const { lancerConnexionDesReseaux } = await import('./connexion-des-reseaux.js');
      const reseaux = Array.isArray(entree.reseaux) ? entree.reseaux : [];
      return { ...(await lancerConnexionDesReseaux({ projectId, reseaux, compte })) };
    }
    case 'compte.relier': {
      const [projectId, reseau] = id.split('/');
      projetEnTravail(projectId ?? '', compte);
      const { commencerConnexion } = await import('./publication-sociale.js');
      return commencerConnexion(projectId!, reseau);
    }
    case 'compte.creer': {
      const [projectId, reseau] = id.split('/');
      projetEnTravail(projectId ?? '', compte);
      const { lancerCreationDeCompte } = await import('./assistant-marketing.js');
      return { ...(await lancerCreationDeCompte({ projectId: projectId!, reseau })) };
    }
    default:
      throw new Error(`Geste inconnu : ${geste || '(vide)'}.`);
  }
}

/** Un geste exige de TRAVAILLER sur le projet : voir ne suffit pas. */
function projetEnTravail(projectId: string, compte: Compte): void {
  projetDansLaMarque(projectId, compte);
  if (compteVoitTout(compte)) return;
  const droits = droitsDuCompte(compte as CompteUtilisateur);
  if (droits.projets[projectId] === 'voir' || !droits.projets[projectId]) throw new Error('Votre accès ne permet pas ce geste sur ce projet.');
}

/** LE RAPPORT MARKETING EN PDF, fabriqué à la demande par le Chrome du système. */
export async function rapportEnFichier(marqueId: string, compte: Compte, documentId?: string): Promise<{ nom: string; chemin: string } | null> {
  const { marque, projets } = marquePourLeCompte(marqueId, compte);
  if (documentId) return null;
  const espace = projets.map((p) => lireEspace(p)).find((e) => !!e?.rapport);
  if (!espace?.rapport) return null;
  const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const enLigne = (t: string) => echapper(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const html: string[] = [];
  let liste = false;
  for (const brut of espace.rapport.split('\n')) {
    const ligne = brut.trim();
    const puce = /^[-*•]\s+(.+)$/.exec(ligne);
    if (puce) {
      if (!liste) html.push('<ul>');
      liste = true;
      html.push(`<li>${enLigne(puce[1]!)}</li>`);
      continue;
    }
    if (liste) {
      html.push('</ul>');
      liste = false;
    }
    const titre = /^(#{1,4})\s+(.+)$/.exec(ligne);
    if (titre) html.push(`<h${Math.min(titre[1]!.length + 0, 3)}>${enLigne(titre[2]!)}</h${Math.min(titre[1]!.length + 0, 3)}>`);
    else if (ligne) html.push(`<p>${enLigne(ligne)}</p>`);
  }
  if (liste) html.push('</ul>');
  const page = `<!doctype html><meta charset="utf-8"><title>${echapper(marque.nom)}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;font-size:11.5pt;line-height:1.5;color:#1c1c1c}
    h1{font-family:system-ui,sans-serif;font-size:22pt;margin:0 0 14pt}h2{font-family:system-ui,sans-serif;font-size:14pt;margin:18pt 0 6pt;break-after:avoid}h3{font-family:system-ui,sans-serif;font-size:12pt;margin:12pt 0 4pt;break-after:avoid}
    p{margin:0 0 7pt}ul{margin:0 0 8pt 16pt;padding:0}li{margin:0 0 3pt}
  </style>${html.join('\n')}`;
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const onglet = await navigateur.newPage();
    await onglet.setContent(page, { waitUntil: 'load' });
    const pdf = await onglet.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' } });
    const nom = `${marque.nom.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'marque'}-rapport.pdf`;
    const chemin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-rapport-')), nom);
    fs.writeFileSync(chemin, pdf);
    return { nom, chemin };
  } finally {
    await navigateur.close().catch(() => undefined);
  }
}
