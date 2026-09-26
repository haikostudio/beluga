/**
 * L'ESPACE CLIENT, CÔTÉ BASE.
 *
 * Trois tables neuves (`demandes`, `demande_messages`, `demande_fichiers`) plus
 * le fil de discussion (`fil_messages`), indépendantes de `cards` : une demande
 * de client n'est pas une carte, et rien de ce qui touche aux agents, aux
 * moteurs ou aux branches ne la concerne.
 *
 * RÈGLE DE TOUTE ÉCRITURE : l'AUTEUR est réécrit depuis la SESSION, jamais pris
 * dans ce que le navigateur envoie. Un client ne peut donc pas signer du nom
 * d'un autre, même en fabriquant sa requête à la main.
 */
import {
  ActiviteDemande,
  ColonneDemande,
  Demande,
  ImportanceDemande,
  TITRES_IMPORTANCE,
  changementDImportance,
  MessageDemande,
  MessageFil,
  TacheDemande,
  demandesDeLaColonne,
  etiquettesNettoyees,
  galerieDeLaDemande,
  genreDuFichier,
  jugerTitreDeDemande,
  rangEntre,
  roleDEnFace,
  demandeJamaisOuverte,
  type DemandeAffichee,
  type GenreActivite,
  type PieceDeGalerie,
  type RoleCompte,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

interface LigneDemande {
  id: string;
  project_id: string;
  auteur_id: string;
  colonne: string;
  rang: number;
  titre: string;
  carte_id: string | null;
  data: string;
  creee_le: number;
  derniere_activite: number;
  echeance: number | null;
  archivee_le: number | null;
}

function enDemande(ligne: LigneDemande): Demande {
  const bloc = JSON.parse(ligne.data) as Record<string, unknown>;
  return Demande.parse({
    ...bloc,
    id: ligne.id,
    projectId: ligne.project_id,
    auteurId: ligne.auteur_id,
    colonne: ligne.colonne,
    rang: ligne.rang,
    titre: ligne.titre,
    carteId: ligne.carte_id ?? undefined,
    creeeLe: ligne.creee_le,
    derniereActivite: ligne.derniere_activite,
    echeance: ligne.echeance ?? undefined,
    archiveeLe: ligne.archivee_le ?? undefined,
  });
}

/**
 * TOUTES LES DEMANDES D'UN PROJET — LA PORTÉE EST LE PROJET, PLUS L'AUTEUR.
 *
 * Auparavant un client ne voyait que ce qu'il avait écrit lui-même : une
 * demande déposée par Haiko sur SON projet lui restait invisible, et son espace
 * paraissait vide alors que le travail avait commencé. Le filtre par auteur a
 * donc disparu ; ce qui garde la porte, c'est `peutVoirProjet`, vérifié à
 * chaque commande.
 */
export function listerDemandes(projectId: string): Demande[] {
  const rows = getDb()
    .prepare('SELECT * FROM demandes WHERE project_id = ? ORDER BY colonne, rang')
    .all(projectId) as LigneDemande[];
  return rows.map(enDemande);
}

export function laDemande(id: string): Demande | null {
  const ligne = getDb().prepare('SELECT * FROM demandes WHERE id = ?').get(id) as LigneDemande | undefined;
  return ligne ? enDemande(ligne) : null;
}

export function messagesDeLaDemande(demandeId: string): MessageDemande[] {
  const rows = getDb()
    .prepare('SELECT id, demande_id, auteur_id, data, cree_le FROM demande_messages WHERE demande_id = ? ORDER BY cree_le')
    .all(demandeId) as { id: string; demande_id: string; auteur_id: string; data: string; cree_le: number }[];
  return rows.map((r) =>
    MessageDemande.parse({
      ...(JSON.parse(r.data) as Record<string, unknown>),
      id: r.id,
      demandeId: r.demande_id,
      auteurId: r.auteur_id,
      creeLe: r.cree_le,
    }),
  );
}

/**
 * LA GALERIE D'UNE FICHE : toutes ses pièces jointes, celles de la demande ET
 * celles de ses commentaires. Le rapprochement avec le stockage central se fait
 * ici ; la règle d'assemblage, elle, est pure (`galerieDeLaDemande`).
 */
export function galerie(demande: Demande, messages: readonly MessageDemande[]): PieceDeGalerie[] {
  const ids = new Set<string>([...demande.fichiers, ...messages.flatMap((m) => m.fichiers)]);
  const pieces = [...ids]
    .map((id) => store.getAttachment(id))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => ({ id: p.id, name: p.name, mime: p.mime, size: p.size, apercuSeconde: p.apercuSeconde }));
  return galerieDeLaDemande(demande, messages, pieces);
}

/**
 * LES PIÈCES D'UN FIL DE DISCUSSION. La discussion générale n'est pas une fiche
 * de demande : elle n'a pas de galerie. Mais ses messages portent des fichiers,
 * et l'écran doit pouvoir en dire le NOM et le POIDS — sans quoi il n'affiche
 * qu'un lien « Pièce jointe » qui n'apprend rien.
 */
export function piecesDuFil(messages: readonly MessageFil[]): PieceDeGalerie[] {
  const sortie: PieceDeGalerie[] = [];
  const vues = new Set<string>();
  for (const message of messages) {
    for (const id of message.fichiers) {
      if (vues.has(id)) continue;
      const piece = store.getAttachment(id);
      if (!piece) continue;
      vues.add(id);
      sortie.push({
        id: piece.id,
        nom: piece.name,
        mime: piece.mime,
        taille: piece.size,
        genre: genreDuFichier(piece.mime),
        apercuSeconde: piece.apercuSeconde,
        provenance: 'commentaire',
        deposeeLe: message.creeLe,
      });
    }
  }
  return sortie;
}

/**
 * LE RÉSUMÉ PORTÉ PAR LA VIGNETTE : combien de pièces, combien de commentaires,
 * et combien de commentaires ARRIVÉS DEPUIS que ce compte-là a ouvert la fiche.
 * Le compteur de non-lus est PAR COMPTE : le même chiffre ne peut pas servir à
 * Haiko et au client.
 */
export function resumeDeLaDemande(demande: Demande, pourCompte?: string): {
  pieces: number;
  commentaires: number;
  nonLus: number;
  jamaisOuverte: boolean;
} {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM demande_messages WHERE demande_id = ?')
    .get(demande.id) as { n: number };
  const pieces = db
    .prepare('SELECT COUNT(*) AS n FROM demande_fichiers WHERE demande_id = ?')
    .get(demande.id) as { n: number };
  return {
    pieces: pieces.n,
    commentaires: row.n,
    nonLus: pourCompte ? nonLusDeLaDemande(demande.id, pourCompte) : 0,
    // La MÊME règle que le compteur de la Messagerie : la vignette ne peut plus le contredire.
    jamaisOuverte: pourCompte
      ? demandeJamaisOuverte(pourCompte, { ...demande, ouverte: luJusquA(demande.id, pourCompte) > 0 })
      : false,
  };
}

/**
 * COMBIEN DE DEMANDES VIVANTES D'UN PROJET ONT DU NOUVEAU POUR CE COMPTE : un
 * commentaire ou une activité d'un autre depuis sa dernière ouverture. C'est la
 * pastille d'un projet dans le sélecteur, quand un client en a plusieurs.
 */
export function demandesAvecDuNouveau(projectId: string, compteId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM demandes d
       LEFT JOIN demande_lectures l ON l.demande_id = d.id AND l.user_id = ?
       WHERE d.project_id = ? AND d.archivee_le IS NULL
         AND (
           EXISTS (SELECT 1 FROM demande_messages m
                   WHERE m.demande_id = d.id AND m.auteur_id <> ? AND m.cree_le > COALESCE(l.lu_jusqu_a, 0))
           OR EXISTS (SELECT 1 FROM demande_activite a
                   WHERE a.demande_id = d.id AND a.auteur_id <> ? AND a.cree_le > COALESCE(l.lu_jusqu_a, 0))
         )`,
    )
    .get(compteId, projectId, compteId, compteId) as { n: number };
  return row.n;
}

/**
 * LES DEMANDES TELLES QUE LES COMPTEURS DE LA MESSAGERIE LES LISENT : qui les a
 * écrites, où elles sont, et si CE compte les a déjà ouvertes. `null` = tous
 * les projets (administrateur).
 */
export function demandesPourLesCompteurs(
  projectIds: readonly string[] | null,
  compteId: string,
): { auteurId: string; colonne: string; carteId: string | null; archiveeLe: number | null; ouverte: boolean }[] {
  if (projectIds !== null && !projectIds.length) return [];
  const filtre = projectIds === null ? '' : ` WHERE d.project_id IN (${projectIds.map(() => '?').join(',')})`;
  const rows = getDb()
    .prepare(
      `SELECT d.auteur_id, d.colonne, d.carte_id, d.archivee_le, l.lu_jusqu_a
       FROM demandes d
       LEFT JOIN demande_lectures l ON l.demande_id = d.id AND l.user_id = ?${filtre}`,
    )
    .all(compteId, ...(projectIds ?? [])) as {
    auteur_id: string;
    colonne: string;
    carte_id: string | null;
    archivee_le: number | null;
    lu_jusqu_a: number | null;
  }[];
  return rows.map((r) => ({
    auteurId: r.auteur_id,
    colonne: r.colonne,
    carteId: r.carte_id,
    archiveeLe: r.archivee_le,
    ouverte: r.lu_jusqu_a !== null,
  }));
}

/** Les demandes portées par une carte Beluga — d'ordinaire une seule. */
export function demandesDeLaCarte(carteId: string): Demande[] {
  const rows = getDb().prepare('SELECT * FROM demandes WHERE carte_id = ?').all(carteId) as LigneDemande[];
  return rows.map(enDemande);
}

/** Les demandes d'un projet, prêtes pour l'écran : résumé compris. */
export function demandesAffichees(projectId: string, pourCompte?: string): DemandeAffichee[] {
  return listerDemandes(projectId).map((demande) => {
    const carte = demande.carteId ? store.getCard(demande.carteId) : null;
    return { ...demande, resume: resumeDeLaDemande(demande, pourCompte), carteTitre: carte?.title };
  });
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

/**
 * DEUX COLONNES RÉELLES, LE RESTE DANS LE BLOC JSON.
 *
 * `echeance` et `archivee_le` sortent du bloc parce que ce sont les SEULES sur
 * lesquelles on trie et on filtre en SQL. Les étiquettes, les cases à cocher et
 * la livraison annoncée voyagent en JSON : une colonne de plus par
 * champ neuf transformerait chaque idée en migration.
 */
function ecrireDemande(demande: Demande): Demande {
  const bloc = {
    description: demande.description,
    importance: demande.importance,
    auteurNom: demande.auteurNom,
    fichiers: demande.fichiers,
    etiquettes: demande.etiquettes,
    taches: demande.taches,
    livraisonAnnoncee: demande.livraisonAnnoncee,
  };
  getDb()
    .prepare(
      `INSERT INTO demandes (id, project_id, auteur_id, colonne, rang, titre, carte_id, data, creee_le, derniere_activite, echeance, archivee_le)
       VALUES (@id, @projectId, @auteurId, @colonne, @rang, @titre, @carteId, @data, @creeeLe, @derniereActivite, @echeance, @archiveeLe)
       ON CONFLICT(id) DO UPDATE SET
         colonne = excluded.colonne,
         rang = excluded.rang,
         titre = excluded.titre,
         carte_id = excluded.carte_id,
         data = excluded.data,
         derniere_activite = excluded.derniere_activite,
         echeance = excluded.echeance,
         archivee_le = excluded.archivee_le`,
    )
    .run({
      id: demande.id,
      projectId: demande.projectId,
      auteurId: demande.auteurId,
      colonne: demande.colonne,
      rang: demande.rang,
      titre: demande.titre,
      carteId: demande.carteId ?? null,
      data: JSON.stringify(bloc),
      creeeLe: demande.creeeLe,
      derniereActivite: demande.derniereActivite,
      echeance: demande.echeance ?? null,
      archiveeLe: demande.archiveeLe ?? null,
    });
  return demande;
}

/* ------------------------------------------------------------------ */
/* Le journal d'activité                                               */
/* ------------------------------------------------------------------ */

/**
 * UNE SEULE SOURCE POUR TROIS USAGES : l'historique du tiroir, le compteur de
 * non-lus, et les courriels du matin. Écrire trois fois la même chose
 * dans trois tables, c'est se garantir qu'elles finiront par se contredire.
 */
export function noterActivite(
  auteur: AuteurDeLEcriture,
  demande: Pick<Demande, 'id' | 'projectId'>,
  genre: GenreActivite,
  detail = '',
  /** Les deux bouts d'un changement d'importance, que l'écran rédige et traduit. */
  importance?: { importanceAvant: ImportanceDemande; importanceApres: ImportanceDemande } | null,
): ActiviteDemande {
  const activite = ActiviteDemande.parse({
    id: store.newId(),
    demandeId: demande.id,
    projectId: demande.projectId,
    auteurId: auteur.id,
    auteurNom: auteur.nom,
    auteurRole: auteur.role,
    genre,
    detail,
    ...(importance ?? {}),
    creeLe: Date.now(),
  });
  getDb()
    .prepare(
      `INSERT INTO demande_activite (id, demande_id, project_id, auteur_id, genre, data, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      activite.id,
      activite.demandeId,
      activite.projectId,
      activite.auteurId,
      activite.genre,
      JSON.stringify({
        auteurNom: activite.auteurNom,
        auteurRole: activite.auteurRole,
        detail: activite.detail,
        importanceAvant: activite.importanceAvant,
        importanceApres: activite.importanceApres,
      }),
      activite.creeLe,
    );
  return activite;
}

export function activiteDeLaDemande(demandeId: string, limite = 100): ActiviteDemande[] {
  const rows = getDb()
    .prepare(
      `SELECT id, demande_id, project_id, auteur_id, genre, data, cree_le
       FROM demande_activite WHERE demande_id = ? ORDER BY cree_le DESC LIMIT ?`,
    )
    .all(demandeId, limite) as {
    id: string;
    demande_id: string;
    project_id: string;
    auteur_id: string;
    genre: string;
    data: string;
    cree_le: number;
  }[];
  return rows.map((r) =>
    ActiviteDemande.parse({
      ...(JSON.parse(r.data) as Record<string, unknown>),
      id: r.id,
      demandeId: r.demande_id,
      projectId: r.project_id,
      auteurId: r.auteur_id,
      genre: r.genre,
      creeLe: r.cree_le,
    }),
  );
}

/** L'activité d'une période sur un lot de projets — la matière des courriels. */
export function activiteDepuis(projectIds: readonly string[], depuis: number): ActiviteDemande[] {
  if (!projectIds.length) return [];
  const trous = projectIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.demande_id, a.project_id, a.auteur_id, a.genre, a.data, a.cree_le
       FROM demande_activite a
       JOIN demandes d ON d.id = a.demande_id
       WHERE a.project_id IN (${trous}) AND a.cree_le >= ? AND d.archivee_le IS NULL
       ORDER BY a.cree_le`,
    )
    .all(...projectIds, depuis) as {
    id: string;
    demande_id: string;
    project_id: string;
    auteur_id: string;
    genre: string;
    data: string;
    cree_le: number;
  }[];
  return rows.map((r) =>
    ActiviteDemande.parse({
      ...(JSON.parse(r.data) as Record<string, unknown>),
      id: r.id,
      demandeId: r.demande_id,
      projectId: r.project_id,
      auteurId: r.auteur_id,
      genre: r.genre,
      creeLe: r.cree_le,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Jusqu'où chacun a lu                                                */
/* ------------------------------------------------------------------ */

/** Combien de commentaires des AUTRES sont arrivés depuis la dernière ouverture. */
/**
 * JUSQU'OÙ CE COMPTE A LU CETTE FICHE. Zéro quand il ne l'a jamais ouverte.
 * Écrit ici une fois pour toutes : le compteur de non-lus et la LISTE des
 * messages non lus doivent regarder exactement le même repère, sans quoi le
 * courriel dirait « 2 messages non lus » et n'en montrerait qu'un.
 */
export function luJusquA(demandeId: string, compteId: string): number {
  const vu = getDb()
    .prepare('SELECT lu_jusqu_a FROM demande_lectures WHERE demande_id = ? AND user_id = ?')
    .get(demandeId, compteId) as { lu_jusqu_a: number } | undefined;
  return vu?.lu_jusqu_a ?? 0;
}

export function nonLusDeLaDemande(demandeId: string, compteId: string): number {
  const db = getDb();
  const vu = db
    .prepare('SELECT lu_jusqu_a FROM demande_lectures WHERE demande_id = ? AND user_id = ?')
    .get(demandeId, compteId) as { lu_jusqu_a: number } | undefined;
  const depuis = vu?.lu_jusqu_a ?? 0;
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM demande_messages WHERE demande_id = ? AND cree_le > ? AND auteur_id <> ?')
    .get(demandeId, depuis, compteId) as { n: number };
  return row.n;
}

/** OUVRIR, C'EST AVOIR LU : le compteur de ce compte-là retombe à zéro. */
export function marquerDemandeLue(demandeId: string, compteId: string, quand = Date.now()): void {
  getDb()
    .prepare(
      `INSERT INTO demande_lectures (demande_id, user_id, lu_jusqu_a) VALUES (?, ?, ?)
       ON CONFLICT(demande_id, user_id) DO UPDATE SET lu_jusqu_a = MAX(lu_jusqu_a, excluded.lu_jusqu_a)`,
    )
    .run(demandeId, compteId, quand);
}

/** Le total des commentaires non lus d'un compte, sur les projets qu'il voit. */
export function nonLusDesDemandes(projectIds: readonly string[], compteId: string): number {
  if (!projectIds.length) return 0;
  const trous = projectIds.map(() => '?').join(',');
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM demande_messages m
       JOIN demandes d ON d.id = m.demande_id
       LEFT JOIN demande_lectures l ON l.demande_id = m.demande_id AND l.user_id = ?
       WHERE d.project_id IN (${trous})
         AND d.archivee_le IS NULL
         AND m.auteur_id <> ?
         AND m.cree_le > COALESCE(l.lu_jusqu_a, 0)`,
    )
    .get(compteId, ...projectIds, compteId) as { n: number };
  return row.n;
}

/** Rattache une pièce jointe à une demande — et, s'il y a lieu, à son commentaire. */
function rattacherLesFichiers(demandeId: string, messageId: string | null, ids: readonly string[]): void {
  const db = getDb();
  for (const attachmentId of ids) {
    const piece = store.getAttachment(attachmentId);
    if (!piece) continue;
    db.prepare(
      `INSERT OR REPLACE INTO demande_fichiers (attachment_id, demande_id, message_id, genre, cree_le)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(attachmentId, demandeId, messageId, genreDuFichier(piece.mime), Date.now());
  }
}

export interface AuteurDeLEcriture {
  id: string;
  nom: string;
  role: RoleCompte;
}

export function creerDemande(
  auteur: AuteurDeLEcriture,
  demande: {
    projectId: string;
    titre: string;
    description?: string;
    importance?: ImportanceDemande;
    fichiers?: string[];
    etiquettes?: string[];
    taches?: TacheDemande[];
    echeance?: number;
  },
): Demande {
  const verdict = jugerTitreDeDemande(demande.titre);
  if (!verdict.ok) throw new Error(verdict.raison);

  const existantes = listerDemandes(demande.projectId);
  const colonne: ColonneDemande = 'a-faire';
  const derniere = demandesDeLaColonne(existantes, colonne).at(-1);
  const maintenant = Date.now();
  const fichiers = demande.fichiers ?? [];

  const neuve = Demande.parse({
    id: store.newId(),
    projectId: demande.projectId,
    auteurId: auteur.id,
    auteurNom: auteur.nom,
    titre: demande.titre.trim(),
    description: demande.description ?? '',
    importance: demande.importance ?? 'normale',
    colonne,
    rang: rangEntre(derniere?.rang, undefined),
    creeeLe: maintenant,
    derniereActivite: maintenant,
    fichiers,
    etiquettes: etiquettesNettoyees(demande.etiquettes ?? []),
    taches: demande.taches ?? [],
    echeance: demande.echeance,
  });
  ecrireDemande(neuve);
  rattacherLesFichiers(neuve.id, null, fichiers);
  noterActivite(auteur, neuve, 'creation', neuve.titre);
  // L'AUTEUR A LU SA PROPRE DEMANDE : elle ne s'ouvre pas avec une pastille.
  marquerDemandeLue(neuve.id, auteur.id, maintenant);
  return neuve;
}

export interface PatchDeDemande {
  titre?: string;
  description?: string;
  importance?: ImportanceDemande;
  fichiers?: string[];
  etiquettes?: string[];
  taches?: TacheDemande[];
  /** `null` efface la date, `undefined` la laisse telle quelle. */
  echeance?: number | null;
  livraisonAnnoncee?: number | null;
}

export function modifierDemande(id: string, patch: PatchDeDemande, auteur?: AuteurDeLEcriture): Demande {
  const demande = laDemande(id);
  if (!demande) throw new Error('Cette demande est introuvable.');
  if (patch.titre !== undefined) {
    const verdict = jugerTitreDeDemande(patch.titre);
    if (!verdict.ok) throw new Error(verdict.raison);
  }
  const dateOu = (patch: number | null | undefined, avant: number | undefined) =>
    patch === undefined ? avant : (patch ?? undefined);
  const suite = Demande.parse({
    ...demande,
    titre: patch.titre?.trim() ?? demande.titre,
    description: patch.description ?? demande.description,
    importance: patch.importance ?? demande.importance,
    fichiers: patch.fichiers ?? demande.fichiers,
    etiquettes: patch.etiquettes ? etiquettesNettoyees(patch.etiquettes) : demande.etiquettes,
    taches: patch.taches ?? demande.taches,
    echeance: dateOu(patch.echeance, demande.echeance),
    livraisonAnnoncee: dateOu(patch.livraisonAnnoncee, demande.livraisonAnnoncee),
    derniereActivite: Date.now(),
  });
  ecrireDemande(suite);
  if (patch.fichiers) rattacherLesFichiers(id, null, patch.fichiers);
  if (auteur) {
    noterActivite(auteur, suite, 'modification', resumeDuPatch(demande, suite), changementDImportance(demande, suite));
  }
  return suite;
}

/** Ce qui a bougé, en une phrase déjà écrite : l'historique se lit, il ne se décode pas. */
function resumeDuPatch(avant: Demande, apres: Demande): string {
  const bouges: string[] = [];
  if (avant.titre !== apres.titre) bouges.push('le titre');
  if (avant.description !== apres.description) bouges.push('la description');
  // Les DEUX bouts, avec leurs noms lisibles : cette phrase part aussi dans le
  // point quotidien de Haiko, qui doit voir qu'un client a changé une priorité.
  if (avant.importance !== apres.importance) {
    bouges.push(`l’importance (${TITRES_IMPORTANCE[avant.importance]} → ${TITRES_IMPORTANCE[apres.importance]})`);
  }
  if (avant.echeance !== apres.echeance) bouges.push('l’échéance');
  if (avant.livraisonAnnoncee !== apres.livraisonAnnoncee) bouges.push('la date de livraison annoncée');
  if (JSON.stringify(avant.etiquettes) !== JSON.stringify(apres.etiquettes)) bouges.push('les étiquettes');
  if (JSON.stringify(avant.taches) !== JSON.stringify(apres.taches)) bouges.push('les cases à cocher');
  if (JSON.stringify(avant.fichiers) !== JSON.stringify(apres.fichiers)) bouges.push('les pièces jointes');
  return bouges.length ? `a changé ${bouges.join(', ')}` : 'a enregistré la fiche';
}

/**
 * ARCHIVER, C'EST SORTIR DU TABLEAU SANS DISPARAÎTRE. Une demande rangée ne
 * compte plus dans les têtes de colonne, ne déclenche plus d'alerte et n'entre
 * plus dans le récapitulatif — mais elle se relit et se désarchive.
 */
export function archiverDemande(id: string, archivee: boolean, auteur?: AuteurDeLEcriture): Demande {
  const demande = laDemande(id);
  if (!demande) throw new Error('Cette demande est introuvable.');
  const suite = Demande.parse({
    ...demande,
    archiveeLe: archivee ? Date.now() : undefined,
    derniereActivite: Date.now(),
  });
  ecrireDemande(suite);
  if (auteur) noterActivite(auteur, suite, archivee ? 'archivage' : 'desarchivage', suite.titre);
  return suite;
}

/**
 * DÉPLACER UNE DEMANDE d'une colonne à l'autre, à une place donnée. La place
 * est décrite par les deux voisines d'arrivée : c'est ce que la souris connaît,
 * et le rang se calcule ici (`rangEntre`), jamais dans le navigateur.
 */
export function deplacerDemande(
  id: string,
  colonne: ColonneDemande,
  avantId?: string,
  apresId?: string,
  auteur?: AuteurDeLEcriture,
): Demande {
  const demande = laDemande(id);
  if (!demande) throw new Error('Cette demande est introuvable.');
  const voisines = listerDemandes(demande.projectId);
  const avant = avantId ? voisines.find((d) => d.id === avantId) : undefined;
  const apres = apresId ? voisines.find((d) => d.id === apresId) : undefined;
  const dansLaColonne = demandesDeLaColonne(voisines, colonne).filter((d) => d.id !== id);
  const rang =
    avant || apres ? rangEntre(avant?.rang, apres?.rang) : rangEntre(dansLaColonne.at(-1)?.rang, undefined);
  const suite = Demande.parse({ ...demande, colonne, rang, derniereActivite: Date.now() });
  ecrireDemande(suite);
  // Réordonner DANS une colonne n'est pas un changement d'état : on ne le note
  // pas, sinon l'historique se remplit de bruit et le récapitulatif ment.
  if (auteur && demande.colonne !== colonne) noterActivite(auteur, suite, 'deplacement', colonne);
  return suite;
}

export function commenterDemande(
  auteur: AuteurDeLEcriture,
  demandeId: string,
  texte: string,
  fichiers: readonly string[] = [],
): MessageDemande {
  const demande = laDemande(demandeId);
  if (!demande) throw new Error('Cette demande est introuvable.');
  if (!texte.trim() && fichiers.length === 0) throw new Error('Un commentaire vide ne s’envoie pas.');

  const message = MessageDemande.parse({
    id: store.newId(),
    demandeId,
    auteurId: auteur.id,
    auteurNom: auteur.nom,
    auteurRole: auteur.role,
    texte: texte.trim(),
    fichiers: [...fichiers],
    creeLe: Date.now(),
  });
  getDb()
    .prepare('INSERT INTO demande_messages (id, demande_id, auteur_id, data, cree_le) VALUES (?, ?, ?, ?, ?)')
    .run(
      message.id,
      demandeId,
      auteur.id,
      JSON.stringify({ auteurNom: message.auteurNom, auteurRole: message.auteurRole, texte: message.texte, fichiers: message.fichiers }),
      message.creeLe,
    );
  rattacherLesFichiers(demandeId, message.id, message.fichiers);
  /*
   * PLUS AUCUN DRAPEAU D'ATTENTE À TENIR ICI. Ce qui « attend une réponse » se
   * LIT : le message qu'on vient d'écrire est non lu pour l'autre côté tant
   * qu'il n'a pas ouvert la fiche (`demande_lectures`). Rien à poser, rien à
   * éteindre, et jamais de drapeau qui contredit le fil.
   */
  getDb().prepare('UPDATE demandes SET derniere_activite = ? WHERE id = ?').run(message.creeLe, demandeId);
  noterActivite(auteur, demande, 'commentaire', message.texte.slice(0, 120));
  // Qui écrit a lu : son propre commentaire ne lui fait pas une pastille.
  marquerDemandeLue(demandeId, auteur.id, message.creeLe);
  return message;
}

/** Le lien avec une carte Beluga, gardé dans les DEUX sens. */
export function lierACarte(demandeId: string, carteId: string | null): Demande {
  const demande = laDemande(demandeId);
  if (!demande) throw new Error('Cette demande est introuvable.');
  const suite = Demande.parse({ ...demande, carteId: carteId ?? undefined, derniereActivite: Date.now() });
  return ecrireDemande(suite);
}

/* ------------------------------------------------------------------ */
/* Le fil de discussion                                                */
/* ------------------------------------------------------------------ */

export function messagesDuFil(filId: string, depuis = 0): MessageFil[] {
  const rows = getDb()
    .prepare('SELECT id, fil_id, auteur_id, data, cree_le, lu_le FROM fil_messages WHERE fil_id = ? AND cree_le > ? ORDER BY cree_le')
    .all(filId, depuis) as {
    id: string;
    fil_id: string;
    auteur_id: string;
    data: string;
    cree_le: number;
    lu_le: number | null;
  }[];
  return rows.map((r) =>
    MessageFil.parse({
      ...(JSON.parse(r.data) as Record<string, unknown>),
      id: r.id,
      filId: r.fil_id,
      auteurId: r.auteur_id,
      creeLe: r.cree_le,
      luLe: r.lu_le ?? undefined,
    }),
  );
}

/**
 * LES HORODATAGES DES ÉCHANGES D'UN CLIENT, ET RIEN D'AUTRE.
 *
 * L'accueil de la messagerie n'a besoin que de DATES pour tracer sa courbe :
 * relire chaque message en entier — son texte, ses pièces — pour n'en garder
 * que l'instant serait payer dix fois le prix de ce qu'on affiche. Trois
 * sources, une seule requête : les demandes déposées, leurs commentaires, et
 * les messages du fil de discussion.
 */
export function horodatagesDesEchanges(
  projectIds: readonly string[],
  filId: string,
  depuis: number,
  jusqua: number = Number.MAX_SAFE_INTEGER,
): number[] {
  const db = getDb();
  const quand: number[] = [];
  if (projectIds.length) {
    const trous = projectIds.map(() => '?').join(',');
    /*
     * `creee_le`, AVEC TROIS « E » : c'est le nom de la colonne en base pour
     * une demande (`demandes.creee_le`), quand un message, lui, porte
     * `cree_le`. La confusion faisait lever « no such column » à CHAQUE appel
     * dès qu'un client avait un projet — l'accueil de la messagerie tombait
     * alors en entier et s'affichait vide, tous les chiffres à zéro.
     */
    const demandes = db
      .prepare(`SELECT creee_le FROM demandes WHERE project_id IN (${trous}) AND creee_le >= ? AND creee_le <= ?`)
      .all(...projectIds, depuis, jusqua) as { creee_le: number }[];
    const commentaires = db
      .prepare(
        `SELECT m.cree_le FROM demande_messages m
         JOIN demandes d ON d.id = m.demande_id
         WHERE d.project_id IN (${trous}) AND m.cree_le >= ? AND m.cree_le <= ?`,
      )
      .all(...projectIds, depuis, jusqua) as { cree_le: number }[];
    for (const ligne of demandes) quand.push(ligne.creee_le);
    for (const ligne of commentaires) quand.push(ligne.cree_le);
  }
  const fil = db
    .prepare('SELECT cree_le FROM fil_messages WHERE fil_id = ? AND cree_le >= ? AND cree_le <= ?')
    .all(filId, depuis, jusqua) as { cree_le: number }[];
  for (const ligne of fil) quand.push(ligne.cree_le);
  return quand;
}

export function envoyerAuFil(
  auteur: AuteurDeLEcriture,
  filId: string,
  texte: string,
  fichiers: readonly string[] = [],
): MessageFil {
  if (!texte.trim() && fichiers.length === 0) throw new Error('Un message vide ne s’envoie pas.');
  const message = MessageFil.parse({
    id: store.newId(),
    filId,
    auteurId: auteur.id,
    auteurNom: auteur.nom,
    auteurRole: auteur.role,
    texte: texte.trim(),
    fichiers: [...fichiers],
    creeLe: Date.now(),
  });
  getDb()
    .prepare('INSERT INTO fil_messages (id, fil_id, auteur_id, data, cree_le) VALUES (?, ?, ?, ?, ?)')
    .run(
      message.id,
      filId,
      auteur.id,
      JSON.stringify({ auteurNom: message.auteurNom, auteurRole: message.auteurRole, texte: message.texte, fichiers: message.fichiers }),
      message.creeLe,
    );
  return message;
}

/**
 * MARQUER LE FIL COMME LU : seuls les messages de l'AUTRE côté sont touchés.
 * Marquer les siens n'aurait aucun sens et fausserait la pastille d'en face.
 */
export function marquerLeFilLu(filId: string, monRole: RoleCompte): void {
  const messages = messagesDuFil(filId);
  const db = getDb();
  const maintenant = Date.now();
  for (const message of messages) {
    if (message.auteurRole === monRole || message.luLe) continue;
    db.prepare('UPDATE fil_messages SET lu_le = ? WHERE id = ?').run(maintenant, message.id);
  }
}

/** Les fils qui ont quelque chose à dire à Haiko : un par client, avec ses non-lus. */
export function filsDesClients(): { filId: string; dernier?: number; nonLus: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT fil_id, MAX(cree_le) AS dernier,
              SUM(CASE WHEN lu_le IS NULL AND json_extract(data, '$.auteurRole') = 'client' THEN 1 ELSE 0 END) AS non_lus
       FROM fil_messages GROUP BY fil_id`,
    )
    .all() as { fil_id: string; dernier: number; non_lus: number }[];
  return rows.map((r) => ({ filId: r.fil_id, dernier: r.dernier, nonLus: r.non_lus ?? 0 }));
}

/**
 * LES MESSAGES DE L'AUTRE CÔTÉ QUE CE RÔLE N'A PAS ENCORE LUS — le chiffre de
 * SA pastille.
 *
 * LE RÔLE QUI DEMANDE EST UN ARGUMENT, il n'est plus figé. La requête comptait
 * toujours les messages d'auteur « admin » : servie au client, elle disait
 * juste ; servie à Haiko sur le fil d'un client, elle lui rendait le compte de
 * SES PROPRES messages non encore ouverts d'en face. Chacun voyait donc sa
 * pastille grossir en écrivant. Le rôle d'en face se lit dans la règle partagée
 * (`roleDEnFace`), la même que l'écran.
 */
export function nonLusDuFilPour(filId: string, monRole: RoleCompte): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM fil_messages
       WHERE fil_id = ? AND lu_le IS NULL AND json_extract(data, '$.auteurRole') = ?`,
    )
    .get(filId, roleDEnFace(monRole)) as { n: number };
  return row.n;
}

/**
 * UNE PIÈCE JOINTE NE SE TÉLÉCHARGE QUE PAR QUI A LE DROIT DE LA LIRE.
 *
 * Le rapprochement se fait sur `demande_fichiers` : le fichier appartient à une
 * demande, la demande à un projet et à un auteur. Un client qui devine
 * l'identifiant d'une pièce d'un autre client se voit refuser la porte.
 */
export function demandeDUneePiece(attachmentId: string): Demande | null {
  const row = getDb()
    .prepare('SELECT demande_id FROM demande_fichiers WHERE attachment_id = ? LIMIT 1')
    .get(attachmentId) as { demande_id: string } | undefined;
  return row ? laDemande(row.demande_id) : null;
}

/** Le fil auquel appartient une pièce jointe envoyée dans la discussion. */
export function filDUnePiece(attachmentId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT fil_id FROM fil_messages WHERE EXISTS (
         SELECT 1 FROM json_each(json_extract(fil_messages.data, '$.fichiers')) WHERE value = ?
       ) LIMIT 1`,
    )
    .get(attachmentId) as { fil_id: string } | undefined;
  return row?.fil_id ?? null;
}
