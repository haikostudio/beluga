import {
  EntreeJournal,
  JournalDeCarte,
  PLAFOND_RESULTAT,
  PhaseJournal,
  bornerTexte,
  ordonnerJournal,
  paramsLisibles,
  phaseDuTour,
} from '@beluga/shared';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { log } from './logger.js';

/**
 * LE JOURNAL D'UNE CARTE, CÔTÉ DÉMON — écriture qui n'ajoute qu'à la fin.
 *
 * Les règles vivent dans `shared/src/journal-carte.ts` ; ici le travail réel :
 * une table `card_journal`, une écriture qui ne peut ni casser un tour ni le
 * ralentir, et une lecture qui rend le document ENTIER d'un bloc.
 *
 * POURQUOI UNE TABLE ET NON UN FICHIER JSON RÉÉCRIT À CHAQUE APPEL : le journal
 * grossit à chaque outil appelé, et deux agents peuvent travailler sur la même
 * carte (le cadrage qui répond pendant qu'une exécution tourne). Réécrire un
 * gros fichier à chaque ligne, c'est une course perdue d'avance et un fichier
 * corrompu au premier arrêt brutal. La table AJOUTE une ligne ; la lecture, elle,
 * rend bien UN SEUL document JSON — c'est la forme servie à l'écran et exportée.
 *
 * RIEN ICI NE PEUT FAIRE TOMBER UN TOUR : toute écriture est enveloppée, et un
 * échec se journalise sans être relancé. Perdre une ligne de trace est ennuyeux ;
 * couper le travail d'un agent pour cette raison serait pire.
 */

/** Le rang suivant à poser sur cette carte : le maximum connu, plus un. */
function prochainRang(cardId: string): number {
  const ligne = getDb()
    .prepare('SELECT MAX(rang) AS max FROM card_journal WHERE card_id = ?')
    .get(cardId) as { max: number | null } | undefined;
  return (ligne?.max ?? -1) + 1;
}

type Ligne = {
  id: string;
  card_id: string;
  rang: number;
  phase: string;
  nature: string;
  at: number;
  agent_id: string | null;
  agent_role: string | null;
  tour_id: string | null;
  libelle: string;
  outil: string | null;
  params: string | null;
  resultat: string | null;
  reussie: number | null;
  duree_ms: number | null;
  etat: string | null;
  donnees: string | null;
};

function versEntree(ligne: Ligne): EntreeJournal {
  return EntreeJournal.parse({
    id: ligne.id,
    cardId: ligne.card_id,
    rang: ligne.rang,
    phase: ligne.phase,
    nature: ligne.nature,
    at: ligne.at,
    agentId: ligne.agent_id ?? undefined,
    agentRole: ligne.agent_role ?? undefined,
    tourId: ligne.tour_id ?? undefined,
    libelle: ligne.libelle ?? '',
    outil: ligne.outil ?? undefined,
    params: ligne.params ?? undefined,
    resultat: ligne.resultat ?? undefined,
    reussie: ligne.reussie === null ? undefined : ligne.reussie === 1,
    dureeMs: ligne.duree_ms ?? undefined,
    etat: ligne.etat ?? undefined,
    donnees: ligne.donnees ?? undefined,
  });
}

/** Ce qu'on demande à écrire : le rang et l'identifiant sont posés ici. */
export type AjoutJournal = {
  cardId: string;
  phase: PhaseJournal;
  nature: EntreeJournal['nature'];
  libelle?: string;
  agentId?: string;
  agentRole?: string;
  tourId?: string;
  outil?: string;
  params?: unknown;
  resultat?: string;
  reussie?: boolean;
  dureeMs?: number;
  etat?: string;
  donnees?: unknown;
  at?: number;
};

/**
 * AJOUTE UNE ENTRÉE À LA FIN DU JOURNAL. Rend l'entrée écrite, ou `null` si
 * rien n'a pu l'être (carte absente, base indisponible) — jamais une exception.
 */
export function ajouterAuJournal(ajout: AjoutJournal): EntreeJournal | null {
  if (!ajout.cardId) return null;
  try {
    const entree = EntreeJournal.parse({
      id: randomUUID(),
      cardId: ajout.cardId,
      rang: prochainRang(ajout.cardId),
      phase: ajout.phase,
      nature: ajout.nature,
      at: ajout.at ?? Date.now(),
      agentId: ajout.agentId,
      agentRole: ajout.agentRole,
      tourId: ajout.tourId,
      libelle: (ajout.libelle ?? '').slice(0, 400),
      outil: ajout.outil,
      params: ajout.params === undefined ? undefined : paramsLisibles(ajout.params),
      resultat: ajout.resultat === undefined ? undefined : bornerTexte(ajout.resultat, PLAFOND_RESULTAT),
      reussie: ajout.reussie,
      dureeMs: ajout.dureeMs,
      etat: ajout.etat,
      donnees: ajout.donnees === undefined ? undefined : paramsLisibles(ajout.donnees),
    });
    getDb()
      .prepare(
        `INSERT INTO card_journal
           (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle,
            outil, params, resultat, reussie, duree_ms, etat, donnees)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entree.id,
        entree.cardId,
        entree.rang,
        entree.phase,
        entree.nature,
        entree.at,
        entree.agentId ?? null,
        entree.agentRole ?? null,
        entree.tourId ?? null,
        entree.libelle,
        entree.outil ?? null,
        entree.params ?? null,
        entree.resultat ?? null,
        entree.reussie === undefined ? null : entree.reussie ? 1 : 0,
        entree.dureeMs ?? null,
        entree.etat ?? null,
        entree.donnees ?? null,
      );
    return entree;
  } catch (err: any) {
    log.warn(`journal de carte : entrée non écrite (${err?.message ?? err})`);
    return null;
  }
}

/**
 * LE JALON « DEMANDE » DU TOUR EN COURS, celui qu'un agent vient de recevoir.
 *
 * Ce jalon est écrit AVANT que le tour n'existe (`journaliserLaDemande`) : il
 * n'a donc pas d'identifiant de tour, et on ne peut pas le retrouver par là. Ce
 * qui l'identifie, c'est l'agent qui l'a reçu et son RANG : le dernier écrit
 * pour cet agent est celui du message qu'il traite en ce moment.
 */
export function dernierJalonDeDemande(cardId: string, agentId: string): EntreeJournal | null {
  if (!cardId || !agentId) return null;
  try {
    const ligne = getDb()
      .prepare(
        `SELECT * FROM card_journal
          WHERE card_id = ? AND agent_id = ? AND nature = 'jalon' AND libelle = 'Demande'
          ORDER BY rang DESC LIMIT 1`,
      )
      .get(cardId, agentId) as Ligne | undefined;
    return ligne ? versEntree(ligne) : null;
  } catch (err: any) {
    log.warn(`journal de carte : jalon de demande introuvable (${err?.message ?? err})`);
    return null;
  }
}

/**
 * COMPLÈTE LES DONNÉES D'UNE ENTRÉE DÉJÀ ÉCRITE, sans rien perdre de ce qu'elle
 * portait. Le journal n'ajoute qu'à la fin — c'est sa règle et elle tient : ici
 * on n'ajoute pas de ligne, on ENRICHIT la sienne, pour qu'une synthèse écrite
 * pendant le tour rejoigne le jalon qui la porte.
 *
 * LA FUSION RELIT LE JSON EXISTANT, elle ne l'écrase pas : `messageId`,
 * `ecriteLe` et les pièces jointes doivent survivre, faute de quoi une capture
 * déposée avec la phrase disparaît du point « Demande ».
 *
 * Rend l'entrée relue, ou `null` si rien n'a pu être écrit — jamais une
 * exception : perdre un enrichissement de trace ne coupe pas un tour.
 */
export function completerDonneesDuJournal(entreeId: string, ajout: Record<string, unknown>): EntreeJournal | null {
  if (!entreeId) return null;
  try {
    const ligne = getDb().prepare('SELECT * FROM card_journal WHERE id = ?').get(entreeId) as Ligne | undefined;
    if (!ligne) return null;
    let existant: Record<string, unknown> = {};
    if (ligne.donnees) {
      try {
        const lu = JSON.parse(ligne.donnees);
        if (lu && typeof lu === 'object' && !Array.isArray(lu)) existant = lu as Record<string, unknown>;
      } catch {
        /* Données illisibles : on repart de ce qu'on sait écrire, sans casser. */
      }
    }
    const donnees = paramsLisibles({ ...existant, ...ajout });
    getDb().prepare('UPDATE card_journal SET donnees = ? WHERE id = ?').run(donnees, entreeId);
    return versEntree({ ...ligne, donnees });
  } catch (err: any) {
    log.warn(`journal de carte : entrée non complétée (${err?.message ?? err})`);
    return null;
  }
}

/** Les entrées d'une carte, dans l'ordre de leur rang. */
export function entreesDuJournal(cardId: string): EntreeJournal[] {
  if (!cardId) return [];
  try {
    const lignes = getDb()
      .prepare('SELECT * FROM card_journal WHERE card_id = ? ORDER BY rang ASC')
      .all(cardId) as Ligne[];
    return ordonnerJournal(lignes.map(versEntree));
  } catch (err: any) {
    log.warn(`journal de carte : lecture impossible (${err?.message ?? err})`);
    return [];
  }
}

/** LE DOCUMENT ENTIER d'une carte — un seul JSON, du cadrage au rapport. */
export function journalDeLaCarte(cardId: string): JournalDeCarte {
  const entrees = entreesDuJournal(cardId);
  const signes = entrees.reduce(
    (total, e) => total + (e.resultat?.length ?? 0) + (e.params?.length ?? 0) + (e.donnees?.length ?? 0),
    0,
  );
  return JournalDeCarte.parse({ cardId, entrees, signes });
}

/**
 * DE QUELLE PHASE RELÈVE LE TOUR QUI COMMENCE. On regarde ce que le journal
 * porte déjà — un cadrage qui reprend une carte ayant travaillé est un
 * RECADRAGE — sans jamais interroger la colonne de la carte, qu'un geste
 * humain peut avoir déplacée entre-temps.
 */
export function phaseDeLaCarte(cardId: string, role: string | undefined): PhaseJournal {
  try {
    const lignes = getDb()
      .prepare("SELECT 1 FROM card_journal WHERE card_id = ? AND phase IN ('execution', 'rapport') LIMIT 1")
      .all(cardId) as unknown[];
    return phaseDuTour(role, lignes.length > 0);
  } catch {
    return phaseDuTour(role, false);
  }
}

/**
 * ALLÈGE LES VIEUX JOURNAUX SANS TROUER LA LIGNE DE TEMPS. Le texte rendu par
 * les outils est vidé, la LIGNE reste — une ligne de temps trouée ment plus
 * qu'une ligne dont le texte est dit retiré (l'écran affiche « texte non
 * conservé »). Rend le nombre d'entrées allégées.
 */
export function allegerLesJournaux(avant: number): number {
  try {
    const res = getDb()
      .prepare(
        `UPDATE card_journal SET resultat = '', params = NULL
         WHERE at < ? AND (resultat IS NOT NULL AND resultat != '')`,
      )
      .run(avant);
    return res.changes ?? 0;
  } catch (err: any) {
    log.warn(`journal de carte : allègement impossible (${err?.message ?? err})`);
    return 0;
  }
}
