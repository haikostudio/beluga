/**
 * LES ACCÈS CLIENTS — le compte administrateur de chaque version d'un site client, noté dans Beluga.
 *
 * Décision de l'utilisateur (cadrage du 25/11/2026, carte « Connexion Haiko pour les sites clients ») : un client
 * ouvre l'administration de son site depuis « Voir mon site », dans une fenêtre qui lui donne l'adresse de connexion,
 * l'identifiant et le mot de passe. UN compte par version, PARTAGÉ par les clients du projet, créé par l'agent du
 * projet et noté avec l'outil `coffre_fort` (paramètre `accesClient`).
 *
 * LE STOCKAGE est le coffre lui-même : une fiche ORDINAIRE de type « mot-de-passe » (adresse, identifiant, mot de
 * passe), marquée par sa version (`secrets.acces_client`, migration 191), rangée dans
 * « <Projet>/<Production|Développement et essai>/Accès clients ». Une version sans administration est déclarée dans
 * `acces_clients_sans_administration` : aucune fiche sans secret dans le coffre.
 *
 * LA CARTE POSÉE D'OFFICE (« Créer les accès administrateur du client ») : JAMAIS lancée (ni départ immédiat, ni
 * date — DEC-034, MEM-2607), une seule ouverte par projet, posée au démarrage (différé), chaque jour, et quand un
 * client, une adresse de site ou un accès noté change. Un projet où elle a déjà été posée une fois n'en reçoit plus
 * au passage quotidien tant que rien ne change : une carte écartée à la main ne revient pas chaque matin.
 *
 * Règles pures : `shared/src/acces-clients.ts`.
 */
import {
  COLONNES_DU_TRAVAIL_FAIT,
  LABEL_ACCES_CLIENTS,
  NOTE_DE_LA_FICHE_D_ACCES_CLIENT,
  TITRE_CARTE_ACCES_CLIENTS,
  VERSIONS_D_ACCES,
  accesNotesDuSite,
  adresseDeLaVersion,
  consigneDeLaCarteDAccesClients,
  descriptionDeLaCarteDAccesClients,
  estVersionDAcces,
  etatDeLaVersion,
  jugerAccesClient,
  libelleDeLaVersion,
  nomDeLaFicheDAccesClient,
  normaliserRecherche,
  sousDossierDesAccesClients,
  versionsAPourvoir,
  versionsDuProjet,
  type AccesClient,
  type AccesNotesDuSite,
  type Card,
  type CompteUtilisateur,
  type EtatDAccesClient,
  type Project,
  type VersionDAcces,
} from '@beluga/shared';
import { bus } from './bus.js';
import { assurerCheminDeDossiers, enregistrerAcces, enregistrerDossier, listerDossiers } from './coffre-fort.js';
import { listerComptes } from './comptes.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

interface LigneAccesClient {
  id: string;
  project_id: string;
  acces_client: string;
  champs: string;
  acces_note_par: string | null;
  acces_note_carte: string | null;
  cree_le: number;
  modifie_le: number;
}

/** Un accès noté, tel que la rubrique des réglages le lit (l'administrateur seul). */
export interface AccesClientNote extends AccesClient {
  ficheId: string;
  noteLe: number;
  notePar: string | null;
  noteCarte: string | null;
}

function champsDe(ligne: LigneAccesClient): Record<string, string> {
  try {
    const lu = JSON.parse(ligne.champs ?? '{}');
    return lu && typeof lu === 'object' ? (lu as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function lignesActives(projectId: string): LigneAccesClient[] {
  return getDb()
    .prepare(
      `SELECT id, project_id, acces_client, champs, acces_note_par, acces_note_carte, cree_le, modifie_le
         FROM secrets WHERE project_id = ? AND acces_client IS NOT NULL AND archive_le IS NULL`,
    )
    .all(projectId) as LigneAccesClient[];
}

/**
 * L'ACCÈS NOTÉ d'une version, ou rien. Une fiche corrigée à la main dans le coffre qui aurait perdu une de ses trois
 * valeurs ne compte plus comme notée : le client verrait une fenêtre où il ne peut rien faire.
 */
export function accesClientDe(projectId: string, version: VersionDAcces): AccesClientNote | null {
  const ligne = lignesActives(projectId).find((l) => l.acces_client === version);
  if (!ligne) return null;
  const champs = champsDe(ligne);
  const juge = jugerAccesClient({ adresse: champs.adresse, identifiant: champs.identifiant, motDePasse: champs.motDePasse });
  if (!juge.ok) return null;
  return {
    ...juge.acces,
    ficheId: ligne.id,
    noteLe: ligne.modifie_le,
    notePar: ligne.acces_note_par,
    noteCarte: ligne.acces_note_carte,
  };
}

/** Les versions dont l'accès est noté (et complet). */
export function versionsNotees(projectId: string): VersionDAcces[] {
  return VERSIONS_D_ACCES.filter((v) => accesClientDe(projectId, v) !== null);
}

/** Les versions déclarées « pas d'administration ». */
export function versionsSansAdministration(projectId: string): VersionDAcces[] {
  const lignes = getDb()
    .prepare('SELECT version FROM acces_clients_sans_administration WHERE project_id = ?')
    .all(projectId) as { version: string }[];
  return lignes.map((l) => l.version).filter(estVersionDAcces);
}

/** Ce que `espace.etat` envoie au client : des booléens, jamais un secret. */
export function accesNotesDuProjet(project: Project | null | undefined): AccesNotesDuSite {
  if (!project) return {};
  return accesNotesDuSite(versionsNotees(project.id).filter((v) => Boolean(adresseDeLaVersion(project, v))));
}

/** Les comptes clients ACTIFS d'un projet — ceux qui voient ces accès. */
export function clientsDuProjet(projectId: string, comptes: readonly CompteUtilisateur[] = listerComptes()): CompteUtilisateur[] {
  return comptes.filter((c) => c.role === 'client' && c.actif && c.projets.includes(projectId));
}

/** Les versions de ce projet qui attendent leur accès (projet actif, au moins un client, ni noté ni sans administration). */
export function versionsAPourvoirDuProjet(project: Project, comptes?: readonly CompteUtilisateur[]): VersionDAcces[] {
  return versionsAPourvoir(
    project,
    clientsDuProjet(project.id, comptes).length > 0,
    versionsNotees(project.id),
    versionsSansAdministration(project.id),
  );
}

/* ------------------------------------------------------------------ */
/* Le dossier du coffre                                                  */
/* ------------------------------------------------------------------ */

/**
 * LE DOSSIER DE LA FICHE : « <Projet>/<Production|Développement et essai>/Accès clients », sous la racine du coffre
 * QUI APPARTIENT À CE PROJET. Une fiche rangée prend le projet de son dossier : une racine du même nom mais d'un autre
 * projet ferait changer la fiche de projet — on la laisse alors à la racine du coffre, rattachée au bon projet.
 */
function dossierDesAccesClients(project: Project, version: VersionDAcces): string | null {
  const racines = listerDossiers().filter((d) => !d.parentId);
  const memeNom = (nom: string) => normaliserRecherche(nom) === normaliserRecherche(project.name);
  let racine =
    racines.find((d) => d.projectId === project.id && memeNom(d.nom)) ?? racines.find((d) => d.projectId === project.id);
  if (!racine) {
    if (racines.some((d) => memeNom(d.nom))) return null;
    const cree = enregistrerDossier({ nom: project.name, projectId: project.id, parentId: null });
    if (!cree.ok) return null;
    racine = cree.dossier;
  }
  if (racines.filter((d) => normaliserRecherche(d.nom) === normaliserRecherche(racine!.nom)).length > 1) return null;
  const chemin = assurerCheminDeDossiers(`${racine.nom}/${sousDossierDesAccesClients(version)}`, project.id);
  if (!chemin.ok || chemin.dossier.projectId !== project.id) return null;
  return chemin.dossier.id;
}

/* ------------------------------------------------------------------ */
/* Noter, déclarer                                                       */
/* ------------------------------------------------------------------ */

export type ResultatDAccesClient = { ok: true; ficheId: string; cree: boolean } | { ok: false; raison: string };

/**
 * NOTE (ou remplace) l'accès d'une version. Une valeur tue garde celle déjà notée : un agent qui ne change que le mot
 * de passe ne redonne pas l'adresse. Jamais de doublon : la fiche active de cette version est CORRIGÉE sur place.
 */
export function noterAccesClient(
  entree: {
    projectId: string;
    version: VersionDAcces;
    adresse?: string;
    identifiant?: string;
    motDePasse?: string;
    par: string;
    carteId?: string | null;
  },
  maintenant = Date.now(),
): ResultatDAccesClient {
  const project = store.getProject(entree.projectId);
  if (!project) return { ok: false, raison: 'Ce projet n’existe pas.' };
  if (!adresseDeLaVersion(project, entree.version)) {
    return {
      ok: false,
      raison: `Le projet « ${project.name} » n’a pas d’adresse pour la « ${libelleDeLaVersion(entree.version)} » : réglez-la d’abord dans ses réglages (${entree.version === 'production' ? 'Mise en production' : 'Déploiement'}).`,
    };
  }
  const ligne = lignesActives(project.id).find((l) => l.acces_client === entree.version);
  const avant = ligne ? champsDe(ligne) : {};
  const juge = jugerAccesClient({
    adresse: entree.adresse ?? avant.adresse,
    identifiant: entree.identifiant ?? avant.identifiant,
    motDePasse: entree.motDePasse ?? avant.motDePasse,
  });
  if (!juge.ok) return juge;

  // Écrit dans la transaction : le transtypage garde le type entier (sans lui, TypeScript le fige sur le refus).
  let resultat = { ok: false, raison: 'Accès non enregistré.' } as ResultatDAccesClient;
  getDb().transaction(() => {
    const dossierId = ligne ? undefined : dossierDesAccesClients(project, entree.version);
    const ecrit = enregistrerAcces(
      {
        id: ligne?.id ?? '',
        nom: nomDeLaFicheDAccesClient(project.name, entree.version),
        type: 'mot-de-passe',
        projectId: project.id,
        champs: { ...avant, adresse: juge.acces.adresse, identifiant: juge.acces.identifiant, motDePasse: juge.acces.motDePasse },
        note: NOTE_DE_LA_FICHE_D_ACCES_CLIENT,
        ...(dossierId ? { dossierId } : {}),
      },
      maintenant,
    );
    if (!ecrit.ok) {
      resultat = { ok: false, raison: ecrit.raison };
      return;
    }
    getDb()
      .prepare('UPDATE secrets SET project_id = ?, acces_client = ?, acces_note_par = ?, acces_note_carte = ? WHERE id = ?')
      .run(project.id, entree.version, entree.par, entree.carteId ?? null, ecrit.acces.id);
    getDb()
      .prepare('DELETE FROM acces_clients_sans_administration WHERE project_id = ? AND version = ?')
      .run(project.id, entree.version);
    resultat = { ok: true, ficheId: ecrit.acces.id, cree: !ligne };
  })();
  // Le journal ne porte jamais le secret : le projet, la version, l'auteur.
  if (resultat.ok) log.info(`accès clients : « ${libelleDeLaVersion(entree.version)} » de « ${project.name} » ${resultat.cree ? 'noté' : 'mis à jour'} par ${entree.par}`);
  return resultat;
}

/** Déclare qu'une version n'a PAS d'administration : la carte ne revient plus pour elle. */
export function declarerSansAdministration(
  entree: { projectId: string; version: VersionDAcces; par: string; carteId?: string | null },
  maintenant = Date.now(),
): { ok: true } | { ok: false; raison: string } {
  const project = store.getProject(entree.projectId);
  if (!project) return { ok: false, raison: 'Ce projet n’existe pas.' };
  const note = accesClientDe(project.id, entree.version);
  if (note) {
    return {
      ok: false,
      raison: `Un accès est déjà noté pour la « ${libelleDeLaVersion(entree.version)} » (fiche ${note.ficheId}) : retire-le d’abord (« supprimer ») si cette version n’a vraiment pas d’administration.`,
    };
  }
  getDb()
    .prepare(
      `INSERT INTO acces_clients_sans_administration (project_id, version, declare_le, par, carte_id) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, version) DO UPDATE SET declare_le = excluded.declare_le, par = excluded.par, carte_id = excluded.carte_id`,
    )
    .run(project.id, entree.version, maintenant, entree.par, entree.carteId ?? null);
  log.info(`accès clients : « ${libelleDeLaVersion(entree.version)} » de « ${project.name} » déclarée sans administration par ${entree.par}`);
  return { ok: true };
}

/** Retire la déclaration « pas d'administration » : la version redevient « à créer ». */
export function retirerSansAdministration(projectId: string, version: VersionDAcces): void {
  getDb().prepare('DELETE FROM acces_clients_sans_administration WHERE project_id = ? AND version = ?').run(projectId, version);
  reexaminerLesAccesClients(projectId);
}

/* ------------------------------------------------------------------ */
/* La rubrique « Accès clients » des réglages du projet                  */
/* ------------------------------------------------------------------ */

export interface VersionDeLaRubrique {
  version: VersionDAcces;
  adresseDuSite: string;
  etat: EtatDAccesClient;
  acces?: AccesClient;
  note?: { le: number; par: string | null; carte?: { id: string; titre: string } };
  sansAdministration?: { le: number; par: string | null };
}

export interface AccesClientsDuProjet {
  clients: { id: string; nom: string }[];
  versions: VersionDeLaRubrique[];
  /** La carte « Créer les accès administrateur du client » encore ouverte, s'il y en a une. */
  carte?: { id: string; titre: string };
}

/** Tout ce que montre la rubrique — mots de passe compris : elle est réservée à l'administrateur. */
export function accesClientsDuProjet(projectId: string): AccesClientsDuProjet {
  const project = store.getProject(projectId);
  if (!project) throw new Error('projet introuvable');
  const sansAdmin = getDb()
    .prepare('SELECT version, declare_le, par FROM acces_clients_sans_administration WHERE project_id = ?')
    .all(projectId) as { version: string; declare_le: number; par: string | null }[];
  const versions: VersionDeLaRubrique[] = versionsDuProjet(project).map((version) => {
    const note = accesClientDe(projectId, version);
    const declaree = sansAdmin.find((l) => l.version === version);
    const carteDeLaNote = note?.noteCarte ? store.getCard(note.noteCarte) : null;
    return {
      version,
      adresseDuSite: adresseDeLaVersion(project, version)!,
      etat: etatDeLaVersion({ adresseDuSite: adresseDeLaVersion(project, version), note: Boolean(note), sansAdministration: Boolean(declaree) }),
      ...(note
        ? {
            acces: { adresse: note.adresse, identifiant: note.identifiant, motDePasse: note.motDePasse },
            note: {
              le: note.noteLe,
              par: note.notePar,
              ...(carteDeLaNote ? { carte: { id: carteDeLaNote.id, titre: carteDeLaNote.title } } : {}),
            },
          }
        : {}),
      ...(declaree && !note ? { sansAdministration: { le: declaree.declare_le, par: declaree.par } } : {}),
    };
  });
  const ouverte = carteDAccesClientsOuverte(projectId);
  return {
    clients: clientsDuProjet(projectId).map((c) => ({ id: c.id, nom: c.nomAffiche || c.identifiant })),
    versions,
    ...(ouverte ? { carte: { id: ouverte.id, titre: ouverte.title } } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* La carte posée d'office                                               */
/* ------------------------------------------------------------------ */

type CreerCarte = (projectId: string, input: Parameters<typeof import('./tools.js').createCard>[1]) => Card;

const COLONNES_RANGEES = [...COLONNES_DU_TRAVAIL_FAIT];
const clePosee = (projectId: string) => `acces-clients.carte.${projectId}`;

/** La carte « Créer les accès administrateur du client » encore ouverte d'un projet (lue en SQL, sans charger toutes les cartes). */
export function carteDAccesClientsOuverte(projectId: string): Card | undefined {
  const ligne = getDb()
    .prepare(
      `SELECT c.id FROM cards c JOIN card_labels l ON l.card_id = c.id
        WHERE c.project_id = ? AND l.label = ? AND c.column_key NOT IN (${COLONNES_RANGEES.map(() => '?').join(', ')})
        ORDER BY c.created_at DESC LIMIT 1`,
    )
    .get(projectId, LABEL_ACCES_CLIENTS, ...COLONNES_RANGEES) as { id: string } | undefined;
  return ligne ? (store.getCard(ligne.id) ?? undefined) : undefined;
}

/**
 * POSE LA CARTE, SANS JAMAIS LA LANCER : elle naît dans « Planifié », sans départ immédiat ni date. Une carte déjà
 * ouverte est rendue telle quelle.
 */
export function poserLaCarteDesAccesClients(project: Project, versions: readonly VersionDAcces[], createCard: CreerCarte): Card {
  const ouverte = carteDAccesClientsOuverte(project.id);
  if (ouverte) return ouverte;
  const aPourvoir = versions
    .map((version) => ({ version, adresse: adresseDeLaVersion(project, version) }))
    .filter((v): v is { version: VersionDAcces; adresse: string } => Boolean(v.adresse));
  const carte = createCard(project.id, {
    title: TITRE_CARTE_ACCES_CLIENTS,
    description: descriptionDeLaCarteDAccesClients(project.name, aPourvoir),
    briefing: consigneDeLaCarteDAccesClients(project.name, aPourvoir),
    labels: [LABEL_ACCES_CLIENTS],
    origin: 'agent',
    auteur: 'agent',
  });
  // Le palier est une intention notée sur la carte : « standard » (créer un compte, le vérifier, le noter).
  const notee = store.saveCard({ ...carte, run: { ...carte.run, niveau: 'standard' } });
  setMeta(clePosee(project.id), String(Date.now()));
  bus.emit({ type: 'card.upsert', card: notee });
  log.info(`accès clients : carte « ${TITRE_CARTE_ACCES_CLIENTS} » posée dans « ${project.name} » (${aPourvoir.map((v) => v.version).join(', ')})`);
  return notee;
}

/** Ce qui, s'il change, RÉARME la pose de la carte pour un projet. */
const signatures = new Map<string, string>();
const aReexaminer = new Set<string>();

function signatureDuProjet(project: Project, clients: readonly CompteUtilisateur[]): string {
  return JSON.stringify({
    versions: versionsDuProjet(project).map((v) => [v, adresseDeLaVersion(project, v)]),
    clients: clients.map((c) => c.id).sort(),
    notees: versionsNotees(project.id),
    sansAdmin: versionsSansAdministration(project.id),
  });
}

/**
 * LE PASSAGE EN REVUE : pose la carte dans chaque projet qui en manque. Un projet où la carte a déjà été posée une
 * fois n'en reçoit une nouvelle que si quelque chose a changé depuis (un client, une adresse, un accès retiré).
 * Entièrement synchrone une fois `createCard` chargé : deux passages simultanés se suivent, ils ne se doublent pas.
 */
export async function passerEnRevueLesAccesClients(opts: { createCard?: CreerCarte } = {}): Promise<Card[]> {
  const createCard = opts.createCard ?? (await import('./tools.js')).createCard;
  const comptes = listerComptes();
  const posees: Card[] = [];
  for (const project of store.listProjects()) {
    try {
      const clients = clientsDuProjet(project.id, comptes);
      const signature = signatureDuProjet(project, clients);
      const avant = signatures.get(project.id);
      signatures.set(project.id, signature);
      const rearme = aReexaminer.delete(project.id) || (avant !== undefined && avant !== signature);
      const versions = versionsAPourvoirDuProjet(project, comptes);
      if (!versions.length) continue;
      if (carteDAccesClientsOuverte(project.id)) continue;
      if (getMeta(clePosee(project.id)) && !rearme) continue;
      posees.push(poserLaCarteDesAccesClients(project, versions, createCard));
    } catch (err) {
      log.error(`accès clients : passage en revue de « ${project.name} »`, err);
    }
  }
  return posees;
}

/** Demande un passage pour ce projet, réarmé (un accès retiré, une déclaration annulée). */
export function reexaminerLesAccesClients(projectId: string): void {
  aReexaminer.add(projectId);
  void passerEnRevueLesAccesClients().catch((err) => log.error('accès clients : passage en revue', err));
}

/** Pour les tests : oublier ce que le passage a retenu. */
export function oublierLesSignaturesDesAccesClients(): void {
  signatures.clear();
  aReexaminer.clear();
}

const DELAI_AU_DEMARRAGE_MS = 90_000;
const PERIODE_MS = 24 * 3600_000;
const DELAI_APRES_CHANGEMENT_MS = 5_000;

/**
 * Le démarrage (différé), un passage par jour, et un passage peu après un changement de comptes ou de projet.
 * `BELUGA_ACCES_CLIENTS_AUTO=off` coupe la pose automatique (démons d'essai qui comptent leurs cartes).
 */
export function planifierLesAccesClients(): () => void {
  if (process.env.BELUGA_ACCES_CLIENTS_AUTO === 'off') return () => {};
  const passer = () => void passerEnRevueLesAccesClients().catch((err) => log.error('accès clients : passage en revue', err));
  const premier = setTimeout(passer, DELAI_AU_DEMARRAGE_MS);
  const quotidien = setInterval(passer, PERIODE_MS);
  let attente: NodeJS.Timeout | undefined;
  const desabonner = bus.subscribe((event) => {
    if (event.type !== 'comptes' && event.type !== 'project.upsert') return;
    if (attente) clearTimeout(attente);
    attente = setTimeout(passer, DELAI_APRES_CHANGEMENT_MS);
  });
  return () => {
    clearTimeout(premier);
    clearInterval(quotidien);
    if (attente) clearTimeout(attente);
    desabonner();
  };
}
