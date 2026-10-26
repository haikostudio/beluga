import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  AccesCoffre,
  ChampLibre,
  DossierCoffre,
  NOM_ACCES_MAX,
  PROJET_DU_COFFRE,
  TypeAcces,
  SEPARATEUR_CHEMIN,
  archivePurgeable,
  cheminDuDossier,
  cheminTexte,
  creeUnCycle,
  descendantsDuDossier,
  imagesApresEnregistrement,
  jugerAcces,
  jugerDossier,
  mimeDuFichier,
  normaliserRecherche,
  refusDuFichierDuCoffre,
  refusDuPoidsDeLaFiche,
  trierAcces,
  type Attachment,
} from '@beluga/shared';
import { getDb } from './db.js';
import { fichierPermis, joindreUnFichier } from './joindre-fichier.js';
import { log } from './logger.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import * as store from './store.js';

/**
 * LE COFFRE-FORT — le rangement sur le disque.
 *
 * Les règles qui se décident sans base vivent dans `shared/src/coffre-fort.ts`.
 * Ici : lire, écrire, effacer. La fiche « accès SSH de la machine », reflet des
 * anciens réglages du VPS, a disparu avec eux : toutes les fiches viennent du
 * coffre lui-même.
 */

interface LigneAcces {
  id: string;
  nom: string;
  type: string;
  project_id: string | null;
  champs: string;
  note: string;
  cree_le: number;
  modifie_le: number;
  archive_le?: number | null;
  images?: string | null;
  dossier_id?: string | null;
  champs_libres?: string | null;
}

interface LigneDossier {
  id: string;
  nom: string;
  project_id: string | null;
  parent_id?: string | null;
  cree_le: number;
  modifie_le: number;
  archive_le: number | null;
}

/** La liste d'images d'une ligne : un JSON abîmé vaut « aucune image ». */
function imagesDeLaLigne(brut: string | null | undefined): string[] {
  try {
    const lu = JSON.parse(brut ?? '[]');
    return Array.isArray(lu) ? lu.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  } catch {
    return [];
  }
}

/** Les cases en plus d'une ligne : un JSON abîmé vaut « aucune case ». */
function champsLibresDeLaLigne(brut: string | null | undefined): ChampLibre[] {
  try {
    const lu = JSON.parse(brut ?? '[]');
    if (!Array.isArray(lu)) return [];
    return lu
      .filter((c) => c && typeof c.libelle === 'string' && typeof c.valeur === 'string')
      .map((c) => ({ libelle: c.libelle, valeur: c.valeur, ...(c.secret === true ? { secret: true } : {}) }));
  } catch {
    return [];
  }
}

function depuisLigne(ligne: LigneAcces): AccesCoffre {
  let champs: Record<string, string> = {};
  try {
    const lu = JSON.parse(ligne.champs ?? '{}');
    if (lu && typeof lu === 'object') champs = lu as Record<string, string>;
  } catch {
    // Une fiche au JSON abîmé se montre vide plutôt que de faire tomber la liste.
  }
  return {
    id: ligne.id,
    nom: ligne.nom,
    type: ligne.type as TypeAcces,
    projectId: ligne.project_id,
    champs,
    note: ligne.note ?? '',
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    origine: 'coffre',
    archiveLe: ligne.archive_le ?? null,
    images: imagesDeLaLigne(ligne.images),
    dossierId: ligne.dossier_id ?? null,
    champsLibres: champsLibresDeLaLigne(ligne.champs_libres),
  };
}

function dossierDepuisLigne(ligne: LigneDossier): DossierCoffre {
  return {
    id: ligne.id,
    nom: ligne.nom,
    parentId: ligne.parent_id ?? null,
    projectId: ligne.project_id,
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    archiveLe: ligne.archive_le ?? null,
  };
}

/** TOUS les dossiers, actifs et archivés : de quoi remonter la chaîne des parents d'un chemin. */
function tousLesDossiers(): DossierCoffre[] {
  const lignes = getDb().prepare('SELECT * FROM dossiers_coffre').all() as LigneDossier[];
  return lignes.map(dossierDepuisLigne);
}

/** Les fiches avec le CHEMIN de leur dossier (calculé, jamais stocké). */
function avecChemins(acces: AccesCoffre[]): AccesCoffre[] {
  if (!acces.some((a) => a.dossierId)) return acces;
  const tous = tousLesDossiers();
  return acces.map((a) => {
    const chemin = a.dossierId ? cheminTexte(tous, a.dossierId) : '';
    return { ...a, dossierChemin: chemin || null };
  });
}

/** Le chemin complet (« Clients/Acme/Prod ») d'un dossier, actif ou archivé. */
export function cheminDeDossier(id: string | null | undefined): string {
  return id ? cheminTexte(tousLesDossiers(), id) : '';
}

/** Les chemins de TOUS les dossiers, par identifiant — pour afficher ou chercher sans relire la base à chaque fiche. */
export function cheminsDesDossiers(): Map<string, string> {
  const tous = tousLesDossiers();
  return new Map(tous.map((d) => [d.id, cheminTexte(tous, d.id)]));
}

/** Les dossiers ACTIFS, par ordre alphabétique. Jamais mêlés aux fiches : `listerAcces` ne les voit pas. */
export function listerDossiers(): DossierCoffre[] {
  const lignes = getDb()
    .prepare('SELECT * FROM dossiers_coffre WHERE archive_le IS NULL ORDER BY nom COLLATE NOCASE ASC')
    .all() as LigneDossier[];
  return lignes.map(dossierDepuisLigne);
}

/** Les dossiers ARCHIVÉS (avec leurs fiches, archivées du même geste), le plus récemment retiré d'abord. */
export function listerDossiersArchives(): DossierCoffre[] {
  const lignes = getDb()
    .prepare('SELECT * FROM dossiers_coffre WHERE archive_le IS NOT NULL ORDER BY archive_le DESC, nom ASC')
    .all() as LigneDossier[];
  return lignes.map(dossierDepuisLigne);
}

function ligneDeDossier(id: string): LigneDossier | undefined {
  return getDb().prepare('SELECT * FROM dossiers_coffre WHERE id = ?').get(id) as LigneDossier | undefined;
}

/**
 * Toutes les fiches ACTIVES, la plus récemment touchée d'abord. Les fiches archivées n'y sont JAMAIS : ni les agents, ni les surveillances,
 * ni les relais ne s'appuient sur un accès retiré. Elles se lisent à part,
 * par `listerArchives`.
 */
export function listerAcces(): AccesCoffre[] {
  const lignes = getDb().prepare('SELECT * FROM secrets WHERE archive_le IS NULL').all() as LigneAcces[];
  return avecChemins(trierAcces(lignes.map(depuisLigne)));
}

/** Les fiches archivées, la plus récemment retirée d'abord. */
export function listerArchives(): AccesCoffre[] {
  const lignes = getDb()
    .prepare('SELECT * FROM secrets WHERE archive_le IS NOT NULL ORDER BY archive_le DESC, nom ASC')
    .all() as LigneAcces[];
  return avecChemins(lignes.map(depuisLigne));
}

export type EnregistrementAcces = { ok: true; acces: AccesCoffre } | { ok: false; raison: string };

/**
 * Écrit une fiche : nouvelle si `id` est vide, remplacée sinon. Le retour est
 * la fiche telle qu'elle est désormais rangée — l'interface s'en sert plutôt
 * que de recopier ce qu'elle croyait avoir envoyé.
 */
export function enregistrerAcces(brut: unknown, maintenant = Date.now()): EnregistrementAcces {
  const id = String((brut as any)?.id ?? '').trim();
  /*
   * Une correction qui TAIT les cases en plus les garde : la note se juge alors
   * contre celles que la fiche porte déjà (une valeur rangée dans une case en
   * plus peut être redite dans la note).
   */
  const actuelle = id ? (getDb().prepare('SELECT champs_libres FROM secrets WHERE id = ?').get(id) as { champs_libres: string } | undefined) : undefined;
  const juge = jugerAcces({ ...(brut as object), champsLibresActuels: champsLibresDeLaLigne(actuelle?.champs_libres) });
  if (!juge.ok) return { ok: false, raison: juge.raison };

  // Un projet inconnu ne se range pas : la contrainte de la base refuserait la
  // ligne avec un message illisible.
  if (juge.projectId) {
    const existe = getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(juge.projectId);
    if (!existe) return { ok: false, raison: 'Ce projet n’existe pas.' };
  }

  const champs = JSON.stringify(juge.champs);

  /*
   * LE DOSSIER : une fiche rangée dans un dossier SUIT le projet du dossier
   * (c'est ce qui garde le dossier et ses fiches sous un même projet). Taire le
   * dossier ne déplace rien ; `null` sort la fiche du dossier.
   */
  let dossierDemande: LigneDossier | undefined;
  if (juge.dossierId) {
    dossierDemande = ligneDeDossier(juge.dossierId);
    if (!dossierDemande || dossierDemande.archive_le != null) return { ok: false, raison: 'Ce dossier n’existe pas.' };
  }

  if (id) {
    const ligne = getDb().prepare('SELECT * FROM secrets WHERE id = ?').get(id) as LigneAcces | undefined;
    if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
    if (ligne.archive_le != null)
      return { ok: false, raison: 'Cet accès est archivé : restaurez-le avant de le corriger.' };
    /*
     * UNE CORRECTION QUI NE DIT RIEN DES IMAGES LES GARDE. L'outil des agents
     * ne transporte pas d'images : sans cette règle, corriger un mot de passe
     * depuis une tâche aurait vidé la fiche de ses captures.
     */
    const { images, retirees } = imagesApresEnregistrement(imagesDeLaLigne(ligne.images), juge.images);
    const refus = imagesRefusees(images);
    if (refus) return { ok: false, raison: refus };
    const imagesEcrites = JSON.stringify(images);
    const dossierFinal =
      juge.dossierId === undefined ? ligneDossierActif(ligne.dossier_id) : dossierDemande;
    const projetFinal = dossierFinal ? dossierFinal.project_id : juge.projectId;
    const dossierIdFinal = dossierFinal ? dossierFinal.id : null;
    // Les cases en plus suivent la règle des images : les taire les garde.
    const libresEcrites = juge.champsLibres ? JSON.stringify(juge.champsLibres) : (ligne.champs_libres ?? '[]');
    getDb()
      .prepare(
        'UPDATE secrets SET nom = ?, type = ?, project_id = ?, champs = ?, note = ?, images = ?, dossier_id = ?, champs_libres = ?, modifie_le = ? WHERE id = ?',
      )
      .run(juge.nom, juge.type, projetFinal, champs, juge.note, imagesEcrites, dossierIdFinal, libresEcrites, maintenant, id);
    effacerLesImagesOrphelines(retirees);
    return { ok: true, acces: depuisLigne({ ...ligne, nom: juge.nom, type: juge.type, project_id: projetFinal, champs, note: juge.note, images: imagesEcrites, dossier_id: dossierIdFinal, champs_libres: libresEcrites, modifie_le: maintenant }) };
  }

  const refus = imagesRefusees(juge.images ?? []);
  if (refus) return { ok: false, raison: refus };

  const neuf: LigneAcces = {
    id: crypto.randomUUID(),
    nom: juge.nom,
    type: juge.type,
    project_id: juge.projectId,
    champs,
    note: juge.note,
    cree_le: maintenant,
    modifie_le: maintenant,
    images: JSON.stringify(juge.images ?? []),
    dossier_id: dossierDemande ? dossierDemande.id : null,
    champs_libres: JSON.stringify(juge.champsLibres ?? []),
  };
  if (dossierDemande) neuf.project_id = dossierDemande.project_id;
  getDb()
    .prepare(
      'INSERT INTO secrets (id, nom, type, project_id, champs, note, images, dossier_id, champs_libres, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(neuf.id, neuf.nom, neuf.type, neuf.project_id, neuf.champs, neuf.note, neuf.images, neuf.dossier_id, neuf.champs_libres, neuf.cree_le, neuf.modifie_le);
  log.info(`coffre-fort : accès « ${neuf.nom} » enregistré`);
  return { ok: true, acces: depuisLigne(neuf) };
}

/* ------------------------------------------------------------------ */
/* LES DOSSIERS                                                        */
/* ------------------------------------------------------------------ */

/** Le dossier ACTIF qui porte cet identifiant, ou `undefined`. */
function ligneDossierActif(id: string | null | undefined): LigneDossier | undefined {
  if (!id) return undefined;
  const ligne = ligneDeDossier(id);
  return ligne && ligne.archive_le == null ? ligne : undefined;
}

export type EnregistrementDossier = { ok: true; dossier: DossierCoffre } | { ok: false; raison: string };

/** Les dossiers (actifs) dont le parent est celui-ci ; `null` = ceux de la racine. */
function freresActifs(parentId: string | null): DossierCoffre[] {
  return listerDossiers().filter((d) => (d.parentId ?? null) === parentId);
}

/**
 * Une fiche `base-de-donnees` porte la protection de production de son projet
 * (`productionsProtegees`) : déménager un dossier ne la fait JAMAIS changer de
 * projet en douce. Rend la phrase de refus, ou rien.
 */
function baseDeDonneesQuiBougerait(idsDossiers: readonly string[], projet: string | null): string | undefined {
  if (!idsDossiers.length) return undefined;
  const marques = idsDossiers.map(() => '?').join(', ');
  const lignes = getDb()
    .prepare(
      `SELECT nom, project_id FROM secrets WHERE archive_le IS NULL AND type = 'base-de-donnees' AND dossier_id IN (${marques})`,
    )
    .all(...idsDossiers) as { nom: string; project_id: string | null }[];
  const touchee = lignes.find((l) => (l.project_id ?? null) !== (projet ?? null));
  return touchee
    ? `La fiche « ${touchee.nom} » est une base de données : elle porte la protection de production de son projet et ne change pas de projet par un dossier. Sortez-la de ce dossier d’abord.`
    : undefined;
}

/**
 * Crée un dossier (sans `id`) ou le corrige (renommer, changer de projet, changer
 * de parent). Un nom est unique parmi ses FRÈRES (les dossiers du même parent) :
 * deux dossiers « Prod » peuvent vivre sous deux parents différents. Un
 * sous-dossier prend toujours le projet de son parent ; changer le projet d'un
 * dossier, ou le déplacer sous un autre parent, déménage aussi ses fiches ET
 * tout ce qu'il contient, dans la même transaction.
 */
export function enregistrerDossier(brut: unknown, maintenant = Date.now()): EnregistrementDossier {
  const juge = jugerDossier(brut);
  if (!juge.ok) return { ok: false, raison: juge.raison };
  const id = String((brut as any)?.id ?? '').trim();

  if (juge.projectId) {
    const existe = getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(juge.projectId);
    if (!existe) return { ok: false, raison: 'Ce projet n’existe pas.' };
  }

  const ligne = id ? ligneDeDossier(id) : undefined;
  if (id) {
    if (!ligne) return { ok: false, raison: 'Dossier introuvable.' };
    if (ligne.archive_le != null) return { ok: false, raison: 'Ce dossier est archivé : restaurez-le avant de le corriger.' };
  }

  // Le parent : absent = on ne bouge pas ; un parent doit exister, être actif et ne pas créer de boucle.
  const parentFinal = juge.parentId === undefined ? (ligne?.parent_id ?? null) : juge.parentId;
  let parent: LigneDossier | undefined;
  if (parentFinal) {
    parent = ligneDossierActif(parentFinal);
    if (!parent) return { ok: false, raison: 'Le dossier parent n’existe pas.' };
    if (id && creeUnCycle(tousLesDossiers(), id, parentFinal))
      return { ok: false, raison: 'Un dossier ne peut pas être rangé dans lui-même ni dans l’un de ses sous-dossiers.' };
  }

  const nomNormalise = normaliserRecherche(juge.nom);
  const doublon = freresActifs(parentFinal).find((d) => d.id !== id && normaliserRecherche(d.nom) === nomNormalise);
  if (doublon) {
    return {
      ok: false,
      raison: parentFinal
        ? `Un dossier « ${doublon.nom} » existe déjà dans « ${cheminDeDossier(parentFinal)} ».`
        : `Un dossier « ${doublon.nom} » existe déjà à la racine du coffre.`,
    };
  }

  // Le projet : celui du parent s'il y en a un ; sinon celui demandé, ou celui d'avant si l'appelant n'en dit rien.
  const projetFinal = parent
    ? parent.project_id
    : juge.projectIdDit || !ligne
      ? juge.projectId
      : ligne.project_id;

  if (ligne) {
    const base = getDb();
    const projetChange = (ligne.project_id ?? null) !== (projetFinal ?? null);
    const tous = tousLesDossiers();
    const arbre = [id, ...descendantsDuDossier(tous, id).map((d) => d.id)];
    if (projetChange) {
      const refus = baseDeDonneesQuiBougerait(arbre, projetFinal);
      if (refus) return { ok: false, raison: refus };
    }
    base.transaction(() => {
      base
        .prepare('UPDATE dossiers_coffre SET nom = ?, project_id = ?, parent_id = ?, modifie_le = ? WHERE id = ?')
        .run(juge.nom, projetFinal, parentFinal, maintenant, id);
      if (projetChange) {
        const marques = arbre.map(() => '?').join(', ');
        base.prepare(`UPDATE dossiers_coffre SET project_id = ? WHERE id IN (${marques})`).run(projetFinal, ...arbre);
        base.prepare(`UPDATE secrets SET project_id = ? WHERE dossier_id IN (${marques})`).run(projetFinal, ...arbre);
      }
    })();
    return {
      ok: true,
      dossier: dossierDepuisLigne({ ...ligne, nom: juge.nom, project_id: projetFinal, parent_id: parentFinal, modifie_le: maintenant }),
    };
  }

  const neuf: LigneDossier = {
    id: crypto.randomUUID(),
    nom: juge.nom,
    project_id: projetFinal,
    parent_id: parentFinal,
    cree_le: maintenant,
    modifie_le: maintenant,
    archive_le: null,
  };
  getDb()
    .prepare('INSERT INTO dossiers_coffre (id, nom, project_id, parent_id, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?)')
    .run(neuf.id, neuf.nom, neuf.project_id, neuf.parent_id, neuf.cree_le, neuf.modifie_le);
  log.info(`coffre-fort : dossier « ${neuf.nom} » créé`);
  return { ok: true, dossier: dossierDepuisLigne(neuf) };
}

/**
 * Retrouve ou CRÉE un chemin de dossiers (« Clients/Acme/Prod »), niveau par
 * niveau. Un niveau qui existe déjà est réutilisé ; les autres naissent sous le
 * précédent, au projet de la racine (`projectId` ne sert qu'à la racine créée).
 * Rend le dossier du bout du chemin et si au moins un niveau a été créé.
 */
export function assurerCheminDeDossiers(
  chemin: string,
  projectId: string | null,
  maintenant = Date.now(),
): { ok: true; dossier: DossierCoffre; cree: boolean } | { ok: false; raison: string } {
  const noms = chemin
    .split(SEPARATEUR_CHEMIN)
    .map((n) => n.trim())
    .filter(Boolean);
  if (!noms.length) return { ok: false, raison: 'Le chemin du dossier est vide.' };
  let parent: DossierCoffre | null = null;
  let cree = false;
  for (const nom of noms) {
    const existant: DossierCoffre | undefined = freresActifs(parent ? parent.id : null).find(
      (d) => normaliserRecherche(d.nom) === normaliserRecherche(nom),
    );
    if (existant) {
      parent = existant;
      continue;
    }
    const r = enregistrerDossier({ nom, projectId, parentId: parent ? parent.id : null }, maintenant);
    if (!r.ok) return { ok: false, raison: r.raison };
    parent = r.dossier;
    cree = true;
  }
  return { ok: true, dossier: parent!, cree };
}

/**
 * Range une fiche dans un dossier (`idDossier`) ou la ressort (`null`). La fiche
 * prend le projet du dossier. Les fiches archivées ne se rangent pas.
 */
export function rangerAcces(
  idFiche: string,
  idDossier: string | null,
  maintenant = Date.now(),
): { ok: true; acces: AccesCoffre } | { ok: false; raison: string } {
  const ligne = getDb().prepare('SELECT * FROM secrets WHERE id = ?').get(idFiche) as LigneAcces | undefined;
  if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
  if (ligne.archive_le != null) return { ok: false, raison: 'Cet accès est archivé : restaurez-le avant de le ranger.' };
  let projet = ligne.project_id;
  if (idDossier) {
    const dossier = ligneDossierActif(idDossier);
    if (!dossier) return { ok: false, raison: 'Ce dossier n’existe pas.' };
    projet = dossier.project_id;
  }
  getDb()
    .prepare('UPDATE secrets SET dossier_id = ?, project_id = ?, modifie_le = ? WHERE id = ?')
    .run(idDossier, projet, maintenant, idFiche);
  return { ok: true, acces: depuisLigne({ ...ligne, dossier_id: idDossier, project_id: projet, modifie_le: maintenant }) };
}

/**
 * RECLASSE une fiche active sans toucher à ses valeurs : son nom, son projet,
 * son dossier. C'est le geste de la réorganisation du coffre — il ne repasse
 * pas par le garde « une fiche par secret », qui jugerait de nouveau des
 * champs que personne ne modifie. Un dossier donné impose son projet.
 */
export function reclasserAcces(
  id: string,
  changements: { nom?: string; projectId?: string | null; dossierId?: string | null },
  maintenant = Date.now(),
): { ok: true; acces: AccesCoffre } | { ok: false; raison: string } {
  const ligne = getDb().prepare('SELECT * FROM secrets WHERE id = ?').get(id) as LigneAcces | undefined;
  if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
  if (ligne.archive_le != null) return { ok: false, raison: 'Cet accès est archivé : restaurez-le avant de le reclasser.' };

  let nom = ligne.nom;
  if (changements.nom !== undefined) {
    nom = String(changements.nom).trim();
    if (!nom) return { ok: false, raison: 'Donnez un nom à cet accès.' };
    if (nom.length > NOM_ACCES_MAX) return { ok: false, raison: `Le nom ne peut pas dépasser ${NOM_ACCES_MAX} signes.` };
  }

  let dossierId = ligne.dossier_id ?? null;
  let projet = ligne.project_id;
  if (changements.projectId !== undefined) {
    projet = changements.projectId;
    if (projet && !getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(projet))
      return { ok: false, raison: 'Ce projet n’existe pas.' };
  }
  if (changements.dossierId !== undefined) {
    dossierId = changements.dossierId;
    if (dossierId && !ligneDossierActif(dossierId)) return { ok: false, raison: 'Ce dossier n’existe pas.' };
  }
  // Une fiche rangée suit toujours le projet de son dossier.
  const dossier = ligneDossierActif(dossierId);
  if (dossier) projet = dossier.project_id;
  else dossierId = null;

  getDb()
    .prepare('UPDATE secrets SET nom = ?, project_id = ?, dossier_id = ?, modifie_le = ? WHERE id = ?')
    .run(nom, projet, dossierId, maintenant, id);
  return { ok: true, acces: depuisLigne({ ...ligne, nom, project_id: projet, dossier_id: dossierId, modifie_le: maintenant }) };
}

/* ------------------------------------------------------------------ */
/* LES IMAGES D'UNE FICHE                                              */
/* ------------------------------------------------------------------ */

/**
 * Une fiche ne cite que des images DÉPOSÉES POUR LE COFFRE. Un identifiant de
 * pièce jointe se devine mal, mais s'il venait d'une carte ou d'une demande
 * client, la purge de la fiche effacerait un fichier qui ne lui appartient
 * pas. Rend la phrase de refus, ou rien.
 */
function imagesRefusees(ids: readonly string[]): string | undefined {
  let total = 0;
  for (const id of ids) {
    const piece = store.getAttachment(id);
    if (!piece) return 'Un fichier de cette fiche est introuvable : retirez-le et joignez-le de nouveau.';
    if (piece.projectId !== PROJET_DU_COFFRE) return 'Ce fichier n’a pas été déposé dans le coffre-fort.';
    total += piece.size;
  }
  // Aucune limite de nombre : seul le POIDS TOTAL de la fiche est plafonné (1 Go).
  return refusDuPoidsDeLaFiche(total) ?? undefined;
}

/**
 * LES IMAGES DE QUELQUES FICHES, retrouvées par leur identifiant — avec le
 * chemin du fichier, seule forme qu'un agent sache ouvrir. Une image disparue
 * du disque est simplement absente : la fiche reste lisible sans elle.
 */
export function imagesDesAcces(acces: readonly AccesCoffre[]): (Attachment & { chemin: string })[] {
  const vues = new Set<string>();
  const pieces: (Attachment & { chemin: string })[] = [];
  for (const fiche of acces) {
    for (const id of fiche.images ?? []) {
      if (vues.has(id)) continue;
      vues.add(id);
      const piece = store.getAttachment(id);
      if (piece) pieces.push({ ...piece, chemin: cheminDePieceJointe(piece) });
    }
  }
  return pieces;
}

/**
 * LES IMAGES QU'UN AGENT DEMANDE POUR UNE FICHE, résolues en pièces du projet
 * réservé du coffre. Chaque entrée est, dans cet ordre : l'identifiant (ou
 * l'alias) d'une image que la fiche porte déjà, l'alias d'une pièce jointe
 * d'une conversation (« 74ad » ou « #74ad »), ou le chemin d'un fichier dans
 * les racines permises. Une pièce d'ailleurs est RECOPIÉE sous le projet
 * réservé (jamais déplacée : la carte garde la sienne), et le dédoublonnage
 * par empreinte du coffre fait qu'un même contenu ne compte qu'une fois.
 *
 * Tout est jugé AVANT la moindre copie : un refus ne laisse aucun fichier.
 * Chaque refus dit sa vraie raison, jamais un manque de droit.
 */
export async function imagesDemandeesParUnAgent(opts: {
  entrees: readonly unknown[];
  /** Les images que la fiche porte déjà (vide pour une fiche neuve). */
  dejaPortees: readonly string[];
  racines: Array<string | undefined | null>;
}): Promise<{ ok: true; ids: string[] } | { ok: false; raison: string }> {
  const demandes = [...new Set(opts.entrees.map((e) => String(e ?? '').trim().replace(/^#/, '')).filter(Boolean))];
  const portees = opts.dejaPortees.map((id) => store.getAttachment(id)).filter((p): p is Attachment => !!p);
  const plan: Array<{ id: string } | { fichier: string; nom: string; demande: string }> = [];
  // Le poids TOTAL se juge avant toute copie, comme le reste : un refus ne laisse aucun fichier.
  let total = 0;
  for (const demande of demandes) {
    const deLaFiche = portees.find((p) => p.id === demande || p.alias === demande);
    if (deLaFiche) {
      plan.push({ id: deLaFiche.id });
      total += deLaFiche.size;
      continue;
    }
    // Un fichier déjà rangé au coffre (vu dans « lister » sur une autre fiche) se redonne par son id.
    const duCoffre = store.getAttachment(demande);
    if (duCoffre?.projectId === PROJET_DU_COFFRE) {
      plan.push({ id: duCoffre.id });
      total += duCoffre.size;
      continue;
    }
    const source = store.attachmentsParAlias([demande])[0];
    let fichier: string | null = null;
    let nom = '';
    if (source) {
      const chemin = cheminDePieceJointe(source);
      if (!fs.existsSync(chemin)) return { ok: false, raison: `Le fichier de la pièce jointe « ${demande} » n’est plus sur le disque.` };
      fichier = chemin;
      nom = source.name;
    } else {
      fichier = fichierPermis(demande, opts.racines);
      if (fichier) nom = fichier.split('/').pop() ?? demande;
    }
    if (!fichier) {
      return {
        ok: false,
        raison: `Aucune pièce jointe ni aucun fichier ne correspond à « ${demande} » : donne l’alias d’une pièce jointe (ex. 74ad), le chemin d’un fichier lisible, ou l’« id » d’un fichier déjà porté par la fiche.`,
      };
    }
    const refus = refusDuFichierDuCoffre(source?.mime || mimeDuFichier(fichier), nom || demande);
    if (refus) return { ok: false, raison: refus };
    total += fs.statSync(fichier).size;
    plan.push({ fichier, nom, demande });
  }
  const tropLourd = refusDuPoidsDeLaFiche(total);
  if (tropLourd) return { ok: false, raison: tropLourd };
  const ids: string[] = [];
  for (const etape of plan) {
    if ('id' in etape) {
      ids.push(etape.id);
      continue;
    }
    const jointure = await joindreUnFichier({ projectId: PROJET_DU_COFFRE, fichier: etape.fichier, nom: etape.nom });
    if (!jointure.ok) {
      effacerLesImagesOrphelines(ids);
      return { ok: false, raison: `${jointure.refus} (${etape.demande})` };
    }
    ids.push(jointure.attachment.id);
  }
  return { ok: true, ids: [...new Set(ids)] };
}

/** Une AUTRE fiche du coffre (active ou archivée) cite-t-elle encore cette image ? */
function imageEncoreCitee(imageId: string): boolean {
  const lignes = getDb()
    .prepare("SELECT images FROM secrets WHERE images LIKE '%' || ? || '%'")
    .all(imageId) as { images: string | null }[];
  if (lignes.some((l) => imagesDeLaLigne(l.images).includes(imageId))) return true;
  // Une note peut citer la même pièce (collée depuis le coffre) : on ne lui retire rien.
  try {
    const notes = getDb()
      .prepare("SELECT 1 FROM notes WHERE pieces_jointes LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%' LIMIT 1")
      .get(imageId, imageId);
    if (notes) return true;
  } catch {
    /* une base sans notes n'a rien à protéger */
  }
  return false;
}

/**
 * EFFACE LES IMAGES QUE PLUS AUCUNE FICHE NE CITE : la ligne de la pièce jointe
 * et son fichier. Deux fiches peuvent porter la MÊME image (le dépôt dédoublonne
 * par empreinte à l'intérieur du coffre) : tant que l'une la cite, elle reste.
 * Une pièce qui n'appartient pas au coffre n'est jamais touchée. Rend le nombre
 * de fichiers effacés.
 */
export function effacerLesImagesOrphelines(ids: readonly string[]): number {
  let effacees = 0;
  for (const id of new Set(ids)) {
    try {
      const piece = store.getAttachment(id);
      if (!piece || piece.projectId !== PROJET_DU_COFFRE) continue;
      if (imageEncoreCitee(id)) continue;
      const chemin = cheminDePieceJointe(piece);
      store.supprimerPieceJointe(id);
      fs.rmSync(chemin, { force: true });
      effacees += 1;
    } catch (err) {
      log.warn(`coffre-fort : image ${id} non effacée — ${(err as Error).message}`);
    }
  }
  return effacees;
}

/**
 * Les surveillances dont la recette lit cette fiche (`acces: { id, champ }`).
 * Une fiche qu'une surveillance utilise ne s'archive pas : la surveillance
 * tomberait en panne sans que rien ne dise pourquoi.
 */
function surveillancesQuiLisent(id: string): string[] {
  try {
    const lignes = getDb()
      .prepare(
        "SELECT url, recette FROM sites_surveilles WHERE recette LIKE '%' || ? || '%' OR wordpress LIKE '%' || ? || '%'",
      )
      .all(id, id) as { url: string; recette: string | null }[];
    return lignes.map((l) => l.url);
  } catch {
    return [];
  }
}

/**
 * RETIRE une fiche : elle n'est plus effacée mais ARCHIVÉE, avec l'instant du
 * retrait. Elle quitte la liste et tout ce que les agents consultent, reste
 * lisible dans les archives, se restaure, et n'est effacée pour de bon qu'au
 * bout de six mois (`purgerArchives`).
 */
export function supprimerAcces(id: string, maintenant = Date.now()): { ok: boolean; raison?: string } {
  const ligne = getDb().prepare('SELECT nom, archive_le FROM secrets WHERE id = ?').get(id) as
    | { nom: string; archive_le: number | null }
    | undefined;
  if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
  if (ligne.archive_le != null) return { ok: false, raison: 'Cet accès est déjà archivé.' };
  const sites = surveillancesQuiLisent(id);
  if (sites.length)
    return {
      ok: false,
      raison: `Une surveillance lit encore cet accès (${sites.join(', ')}) : faites-la pointer vers une autre fiche avant de le retirer.`,
    };
  getDb().prepare('UPDATE secrets SET archive_le = ? WHERE id = ?').run(maintenant, id);
  log.info(`coffre-fort : accès « ${ligne.nom} » archivé`);
  return { ok: true };
}

/**
 * Remet une fiche archivée parmi les accès actifs. Si son dossier est lui-même
 * archivé (ou n'existe plus), elle revient à la racine : elle ne se perd pas
 * dans un dossier que la liste ne montre pas.
 */
export function restaurerAcces(id: string): { ok: boolean; raison?: string } {
  const res = getDb().prepare('UPDATE secrets SET archive_le = NULL WHERE id = ? AND archive_le IS NOT NULL').run(id);
  if (!res.changes) return { ok: false, raison: 'Archive introuvable.' };
  getDb()
    .prepare(
      `UPDATE secrets SET dossier_id = NULL
        WHERE id = ? AND dossier_id IS NOT NULL
          AND dossier_id NOT IN (SELECT id FROM dossiers_coffre WHERE archive_le IS NULL)`,
    )
    .run(id);
  log.info(`coffre-fort : accès ${id} restauré depuis les archives`);
  return { ok: true };
}

/**
 * RETIRE un dossier, ses fiches ET tout ce qu'il contient (sous-dossiers à tous
 * les niveaux), d'un seul geste : tout reçoit le MÊME `archive_le`, c'est ce qui
 * permet de tout restaurer ensemble sans toucher à ce qui était archivé à la main
 * avant. Refusé si une surveillance lit encore UNE fiche de l'arbre. Les images
 * restent avec les fiches (effacées à la purge seulement).
 */
export function supprimerDossier(id: string, maintenant = Date.now()): { ok: boolean; raison?: string; fiches?: number; dossiers?: number } {
  const dossier = ligneDeDossier(id);
  if (!dossier) return { ok: false, raison: 'Dossier introuvable.' };
  if (dossier.archive_le != null) return { ok: false, raison: 'Ce dossier est déjà archivé.' };
  const actifs = listerDossiers();
  const arbre = [id, ...descendantsDuDossier(actifs, id).map((d) => d.id)];
  const marques = arbre.map(() => '?').join(', ');
  const fiches = getDb()
    .prepare(`SELECT id FROM secrets WHERE dossier_id IN (${marques}) AND archive_le IS NULL`)
    .all(...arbre) as { id: string }[];
  for (const fiche of fiches) {
    const sites = surveillancesQuiLisent(fiche.id);
    if (sites.length)
      return {
        ok: false,
        raison: `Une surveillance lit encore un accès de ce dossier (${sites.join(', ')}) : faites-la pointer vers une autre fiche avant de le retirer.`,
      };
  }
  const base = getDb();
  base.transaction(() => {
    base.prepare(`UPDATE dossiers_coffre SET archive_le = ? WHERE id IN (${marques}) AND archive_le IS NULL`).run(maintenant, ...arbre);
    base.prepare(`UPDATE secrets SET archive_le = ? WHERE dossier_id IN (${marques}) AND archive_le IS NULL`).run(maintenant, ...arbre);
  })();
  log.info(`coffre-fort : dossier « ${dossier.nom} » archivé avec ${arbre.length - 1} sous-dossier(s) et ${fiches.length} fiche(s)`);
  return { ok: true, fiches: fiches.length, dossiers: arbre.length - 1 };
}

/**
 * Remet un dossier archivé, ses sous-dossiers et leurs fiches archivés AVEC LUI
 * (même instant), pas ce qui avait été archivé à part. Si son parent est lui-même
 * archivé (à un autre instant) ou n'existe plus, le dossier remonte à la racine —
 * comme une fiche restaurée seule. Refusé si un frère porte déjà le même nom.
 */
export function restaurerDossier(id: string): { ok: boolean; raison?: string; fiches?: number; dossiers?: number } {
  const dossier = ligneDeDossier(id);
  if (!dossier || dossier.archive_le == null) return { ok: false, raison: 'Archive introuvable.' };
  const instant = dossier.archive_le;
  const tous = tousLesDossiers();
  const parentActif = dossier.parent_id ? ligneDossierActif(dossier.parent_id) : undefined;
  const parentFinal = parentActif ? parentActif.id : null;

  // Ce qui revient avec lui : ses descendants retirés au même instant, en ne descendant que par des
  // dossiers eux-mêmes du lot (un enfant archivé à part, sous un parent du lot, reste archivé).
  const dansLot = new Set<string>([dossier.id]);
  for (const d of descendantsDuDossier(tous, id)) {
    if (d.archiveLe === instant && d.parentId && dansLot.has(d.parentId)) dansLot.add(d.id);
  }
  const ids = [...dansLot];

  // Chaque dossier qui revient doit trouver sa place libre parmi ses frères actifs.
  const actifs = listerDossiers();
  for (const idLot of ids) {
    const d = tous.find((x) => x.id === idLot)!;
    const parentDeD = idLot === id ? parentFinal : d.parentId ?? null;
    const doublon = actifs.find(
      (a) => (a.parentId ?? null) === parentDeD && normaliserRecherche(a.nom) === normaliserRecherche(d.nom),
    );
    if (doublon)
      return {
        ok: false,
        raison: `Un dossier « ${doublon.nom} » existe déjà ${parentDeD ? `dans « ${cheminDeDossier(parentDeD)} »` : 'à la racine'} : renommez-le avant de restaurer « ${d.nom} ».`,
      };
  }

  const base = getDb();
  let fiches = 0;
  const marques = ids.map(() => '?').join(', ');
  base.transaction(() => {
    base.prepare(`UPDATE dossiers_coffre SET archive_le = NULL WHERE id IN (${marques})`).run(...ids);
    if ((dossier.parent_id ?? null) !== parentFinal) {
      base.prepare('UPDATE dossiers_coffre SET parent_id = ? WHERE id = ?').run(parentFinal, id);
    }
    fiches = base
      .prepare(`UPDATE secrets SET archive_le = NULL WHERE dossier_id IN (${marques}) AND archive_le = ?`)
      .run(...ids, instant).changes;
  })();
  log.info(`coffre-fort : dossier « ${dossier.nom} » restauré avec ${ids.length - 1} sous-dossier(s) et ${fiches} fiche(s)`);
  return { ok: true, fiches, dossiers: ids.length - 1 };
}

/**
 * EFFACE POUR DE BON les fiches archivées depuis plus de six mois, AVEC LEURS
 * IMAGES — et elles seules : la règle (`archivePurgeable`) ne rend jamais vrai pour une fiche
 * active. Chaque effacement laisse sa ligne au journal. Rend le nombre effacé.
 */
export function purgerArchives(maintenant = Date.now()): number {
  let effacees = 0;
  for (const acces of listerArchives()) {
    if (!archivePurgeable(acces, maintenant)) continue;
    getDb().prepare('DELETE FROM secrets WHERE id = ? AND archive_le IS NOT NULL').run(acces.id);
    // La ligne d'abord, les images ensuite : c'est une fois la fiche partie
    // qu'on sait si une AUTRE fiche cite encore la même image.
    effacerLesImagesOrphelines(acces.images ?? []);
    log.info(
      `coffre-fort : archive « ${acces.nom} » (${acces.id}) effacée, retirée le ${new Date(acces.archiveLe ?? 0).toISOString()}`,
    );
    effacees += 1;
  }
  // Un dossier archivé s'efface avec le dernier de ses jours : ses fiches
  // viennent de partir (même instant). Une fiche archivée plus tôt, à la main,
  // qui le citerait encore est simplement rendue à la racine.
  // Les plus profonds d'abord : un sous-dossier part avant le dossier qui le contient.
  const tous = tousLesDossiers();
  const profondeur = (d: DossierCoffre) => cheminDuDossier(tous, d.id).length;
  for (const dossier of listerDossiersArchives().sort((a, b) => profondeur(b) - profondeur(a))) {
    if (!archivePurgeable(dossier, maintenant)) continue;
    getDb().prepare('UPDATE secrets SET dossier_id = NULL WHERE dossier_id = ?').run(dossier.id);
    // Un sous-dossier qui reste (retiré plus tard) remonte à la racine plutôt que de pendre dans le vide.
    getDb().prepare('UPDATE dossiers_coffre SET parent_id = NULL WHERE parent_id = ?').run(dossier.id);
    getDb().prepare('DELETE FROM dossiers_coffre WHERE id = ? AND archive_le IS NOT NULL').run(dossier.id);
    log.info(`coffre-fort : dossier archivé « ${dossier.nom} » (${dossier.id}) effacé`);
  }
  return effacees;
}

/**
 * LES IMAGES ENVOYÉES PUIS JAMAIS RATTACHÉES. Une image part au coffre dès
 * qu'on la choisit, et n'est citée par sa fiche qu'à l'enregistrement : une
 * fiche refermée sans enregistrer laisse donc un fichier sans propriétaire.
 * Après un jour, plus personne ne viendra le réclamer.
 */
const DELAI_IMAGE_SANS_FICHE_MS = 24 * 3600_000;

export function balayerLesImagesSansFiche(maintenant = Date.now()): number {
  const anciennes = store
    .listAttachments(PROJET_DU_COFFRE)
    .filter((piece) => maintenant - piece.createdAt >= DELAI_IMAGE_SANS_FICHE_MS)
    .map((piece) => piece.id);
  return effacerLesImagesOrphelines(anciennes);
}

/** La purge des archives : cinq minutes après le démarrage, puis chaque jour. */
export function planifierPurgeDesArchives(): NodeJS.Timeout[] {
  const passer = () => {
    try {
      purgerArchives();
      balayerLesImagesSansFiche();
    } catch (err) {
      log.warn(`coffre-fort : purge des archives sautée — ${(err as Error).message}`);
    }
  };
  const premiere = setTimeout(passer, 5 * 60_000);
  premiere.unref();
  const chaqueJour = setInterval(passer, 24 * 3600_000);
  chaqueJour.unref();
  return [premiere, chaqueJour];
}
