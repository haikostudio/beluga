/**
 * LE SOCLE D'UNE PRODUCTION DU STUDIO CRÉATIF, CÔTÉ DÉMON (carte 1 sur 5 du
 * chantier « Beluga Creative Studio », 24/10/2026). Les règles sont PURES et
 * vivent dans `shared/src/production.ts` ; ici, on les écrit en base :
 *
 *  - les ÉLÉMENTS versionnés d'une production (`production_elements`) ;
 *  - les LOTS de devis et leurs OPÉRATIONS (`production_lots`,
 *    `production_operations`), la liste fermée de ce qu'un clic a autorisé ;
 *  - les APPROBATIONS et le JOURNAL (`production_approbations`,
 *    `production_evenements`), qui préviennent l'écran (`production.maj`) ;
 *  - le VERROU PAR CARTE, qui sérialise les gestes de dépense d'une même carte.
 *
 * Les médias eux-mêmes (devis, génération, fichier) restent dans
 * `medias_realisation` (`server/src/realisation.ts`), qui seule dit la dépense :
 * une réservation y passe le média « en cours », un débit « fini », une
 * libération « échec », DANS LA MÊME TRANSACTION que l'opération.
 */

import {
  ElementDeProduction,
  LotDeDevis,
  OperationDeLot,
  cleDElement,
  cleDIdempotence,
  type EtatDElement,
  type EtatDOperation,
  type GenreDElement,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getDb } from './db.js';
import * as store from './store.js';

/* ------------------------------------------------------------------ */
/* Le verrou par carte                                                  */
/* ------------------------------------------------------------------ */

const verrous = new Map<string, Promise<unknown>>();

/**
 * UN SEUL GESTE DE DÉPENSE À LA FOIS PAR CARTE. Deux appels de « generer »
 * arrivés ensemble (deux tours, une reprise réseau) s'attendent : le second
 * relit l'état laissé par le premier, et ne réserve pas une seconde fois.
 * La réservation elle-même est une transaction SQLite, atomique en soi.
 */
export async function avecLeVerrouDeLaCarte<T>(cardId: string, travail: () => Promise<T>): Promise<T> {
  const avant = verrous.get(cardId) ?? Promise.resolve();
  let liberer!: () => void;
  const tenu = new Promise<void>((r) => (liberer = r));
  const suite = avant.then(() => tenu);
  verrous.set(cardId, suite);
  try {
    await avant.catch(() => undefined);
    return await travail();
  } finally {
    liberer();
    if (verrous.get(cardId) === suite) verrous.delete(cardId);
  }
}

/* ------------------------------------------------------------------ */
/* Le journal                                                           */
/* ------------------------------------------------------------------ */

/** Note un événement de la production et prévient les écrans : le volet de suivi relit. */
export function noterUnEvenement(cardId: string, genre: string, details: Record<string, unknown> = {}): void {
  const at = Date.now();
  getDb()
    .prepare('INSERT INTO production_evenements (id, card_id, genre, details, at) VALUES (?, ?, ?, ?, ?)')
    .run(store.newId(), cardId, genre, JSON.stringify(details).slice(0, 4000), at);
  prevenirLesEcrans(cardId);
}

/** Un changement de la production (média compris) : l'écran relit `production.lire`. */
export function prevenirLesEcrans(cardId: string): void {
  bus.emit({ type: 'production.maj', cardId, at: Date.now() });
}

export function evenementsDeLaCarte(cardId: string, limite = 50): { genre: string; details: Record<string, unknown>; at: number }[] {
  return (
    getDb().prepare('SELECT genre, details, at FROM production_evenements WHERE card_id = ? ORDER BY at DESC LIMIT ?').all(cardId, limite) as {
      genre: string;
      details: string;
      at: number;
    }[]
  ).map((l) => {
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse(l.details);
    } catch {
      /* un détail illisible reste vide */
    }
    return { genre: l.genre, details, at: l.at };
  });
}

/* ------------------------------------------------------------------ */
/* Les éléments versionnés                                              */
/* ------------------------------------------------------------------ */

function lireElement(l: any, auteur: string | null = null): ElementDeProduction {
  return ElementDeProduction.parse({
    id: l.id,
    cardId: l.card_id,
    projectId: l.project_id,
    genre: l.genre,
    cle: l.cle,
    version: l.version,
    titre: l.titre,
    contenu: l.contenu,
    etat: l.etat,
    parent: l.parent ?? null,
    creeLe: l.cree_le,
    auteur,
  });
}

/**
 * QUI A ÉCRIT CHAQUE VERSION, relu dans le journal : `noterUnElement` y note
 * l'auteur avec la clé et la version (carte 2 : « revenir à cette version »
 * depuis le suivi est signé de l'utilisateur). Une version sans trace : l'agent.
 */
function auteursDesVersions(cardId: string): Map<string, string> {
  const auteurs = new Map<string, string>();
  const lignes = getDb().prepare(`SELECT details FROM production_evenements WHERE card_id = ? AND genre = 'element'`).all(cardId) as { details: string }[];
  for (const l of lignes) {
    try {
      const d = JSON.parse(l.details) as { cle?: string; version?: number; auteur?: string };
      if (d.cle && d.version && d.auteur) auteurs.set(`${d.cle}#${d.version}`, d.auteur);
    } catch {
      /* un détail illisible ne signe rien */
    }
  }
  return auteurs;
}

export function elementsDeLaCarte(cardId: string): ElementDeProduction[] {
  const auteurs = auteursDesVersions(cardId);
  return (getDb().prepare('SELECT * FROM production_elements WHERE card_id = ? ORDER BY cree_le, version').all(cardId) as any[]).map((l) =>
    lireElement(l, auteurs.get(`${l.cle}#${l.version}`) ?? 'agent'),
  );
}

/**
 * CHANGE L'ÉTAT DE VERSIONS PRÉCISES (accord, retouche, aval invalidé). Une
 * version déjà remplacée n'est jamais rouverte : seules celles qui sont encore
 * dans l'un des états `depuis` changent. Rend le nombre de lignes touchées.
 */
export function changerLEtatDesElements(ids: readonly string[], etat: EtatDElement, depuis: readonly EtatDElement[]): number {
  if (!ids.length || !depuis.length) return 0;
  const r = getDb()
    .prepare(`UPDATE production_elements SET etat = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND etat IN (${depuis.map(() => '?').join(',')})`)
    .run(etat, ...ids, ...depuis);
  return r.changes;
}

/** Garde une réponse de l'utilisateur (un lot, une étape d'écriture) : la trace de qui a dit oui à quoi. */
export function noterUneApprobation(cardId: string, sujet: string, sujetId: string, decision: 'valide' | 'refuse', reponse: string): void {
  getDb()
    .prepare('INSERT INTO production_approbations (id, card_id, sujet, sujet_id, decision, reponse, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(store.newId(), cardId, sujet, sujetId, decision, reponse.slice(0, 400), Date.now());
}

/**
 * ÉCRIT UNE PIÈCE DE LA PRODUCTION : la version suivante de sa clé. La version
 * courante d'avant passe « remplace » et reste lisible — retoucher un plan
 * n'efface jamais le précédent.
 */
export function noterUnElement(e: {
  cardId: string;
  projectId: string;
  genre: GenreDElement;
  cle?: string;
  titre: string;
  contenu: string;
  etat?: EtatDElement;
  parent?: string | null;
  /** Qui écrit cette version : « agent » par défaut, « utilisateur » pour un retour à une version depuis le suivi. */
  auteur?: string;
}): ElementDeProduction {
  const cle = cleDElement(e.cle || e.titre, e.genre);
  const db = getDb();
  const ecrire = db.transaction(() => {
    const derniere = db.prepare('SELECT MAX(version) AS v FROM production_elements WHERE card_id = ? AND cle = ?').get(e.cardId, cle) as { v: number | null };
    const version = (derniere?.v ?? 0) + 1;
    db.prepare(`UPDATE production_elements SET etat = 'remplace' WHERE card_id = ? AND cle = ? AND etat != 'remplace'`).run(e.cardId, cle);
    const id = store.newId();
    db.prepare(
      'INSERT INTO production_elements (id, project_id, card_id, genre, cle, version, titre, contenu, etat, parent, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, e.projectId, e.cardId, e.genre, cle, version, e.titre.slice(0, 200), e.contenu.slice(0, 20_000), e.etat ?? 'propose', e.parent ?? null, Date.now());
    return id;
  });
  const id = ecrire();
  const auteur = e.auteur ?? 'agent';
  const element = lireElement(db.prepare('SELECT * FROM production_elements WHERE id = ?').get(id), auteur);
  noterUnEvenement(e.cardId, 'element', { cle: element.cle, genre: element.genre, version: element.version, etat: element.etat, auteur });
  return element;
}

/* ------------------------------------------------------------------ */
/* Les lots de devis                                                    */
/* ------------------------------------------------------------------ */

function lireOperation(l: any): OperationDeLot {
  return OperationDeLot.parse({
    id: l.id,
    lotId: l.lot_id,
    mediaId: l.media_id,
    plan: l.plan,
    service: l.service,
    modeleNom: l.modele_nom,
    capacite: l.capacite,
    prix: l.prix ?? null,
    etat: l.etat,
    montantReserve: l.montant_reserve ?? 0,
    montantDebite: l.montant_debite ?? null,
    cle: l.cle,
    majLe: l.maj_le,
  });
}

function lireLot(l: any): LotDeDevis {
  const operations = (getDb().prepare('SELECT * FROM production_operations WHERE lot_id = ? ORDER BY rowid').all(l.id) as any[]).map(lireOperation);
  return LotDeDevis.parse({
    id: l.id,
    cardId: l.card_id,
    projectId: l.project_id,
    titre: l.titre,
    etape: l.etape ?? null,
    etat: l.etat,
    questionId: l.question_id ?? null,
    creeLe: l.cree_le,
    decideLe: l.decide_le ?? null,
    operations,
  });
}

export function lotParId(id: string): LotDeDevis | null {
  const l = getDb().prepare('SELECT * FROM production_lots WHERE id = ?').get(id);
  return l ? lireLot(l) : null;
}

export function lotsDeLaCarte(cardId: string): LotDeDevis[] {
  return (getDb().prepare('SELECT * FROM production_lots WHERE card_id = ? ORDER BY cree_le').all(cardId) as any[]).map(lireLot);
}

/** L'opération qui autorise un devis, dans le lot le plus récent qui le porte. */
export function operationDuMedia(mediaId: string): OperationDeLot | null {
  const l = getDb().prepare('SELECT o.* FROM production_operations o JOIN production_lots p ON p.id = o.lot_id WHERE o.media_id = ? ORDER BY p.cree_le DESC LIMIT 1').get(mediaId);
  return l ? lireOperation(l) : null;
}

/** Pose un lot « proposé » et une opération « prévue » par devis. */
export function creerUnLot(e: {
  cardId: string;
  projectId: string;
  titre: string;
  etape: string | null;
  lignes: { mediaId: string; plan: string; service: string; modeleNom: string; capacite: string; prix: number | null }[];
}): LotDeDevis {
  const db = getDb();
  const id = store.newId();
  const maintenant = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO production_lots (id, project_id, card_id, titre, etape, etat, question_id, cree_le, decide_le) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)').run(
      id,
      e.projectId,
      e.cardId,
      e.titre.slice(0, 120),
      e.etape,
      'propose',
      maintenant,
    );
    const inserer = db.prepare(
      'INSERT INTO production_operations (id, lot_id, card_id, media_id, plan, service, modele_nom, capacite, prix, etat, montant_reserve, montant_debite, cle, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)',
    );
    for (const l of e.lignes) {
      inserer.run(store.newId(), id, e.cardId, l.mediaId, l.plan, l.service, l.modeleNom, l.capacite, l.prix, 'prevue', cleDIdempotence(id, l.mediaId), maintenant);
    }
    db.prepare(`UPDATE medias_realisation SET lot_id = ? WHERE id IN (${e.lignes.map(() => '?').join(',') || "''"})`).run(id, ...e.lignes.map((l) => l.mediaId));
  })();
  noterUnEvenement(e.cardId, 'lot.propose', { lot: id, lignes: e.lignes.length });
  return lotParId(id)!;
}

export function poserLaQuestionDuLot(lotId: string, questionId: string): void {
  getDb().prepare('UPDATE production_lots SET question_id = ? WHERE id = ?').run(questionId, lotId);
}

/**
 * LA RÉPONSE DE L'UTILISATEUR AU DEVIS, écrite une fois : le lot passe
 * « validé » ou « refusé », l'approbation est gardée, et un lot refusé ferme
 * ses devis (rien n'y partira jamais).
 */
export function deciderDuLot(lotId: string, valide: boolean, reponse: string): LotDeDevis | null {
  const lot = lotParId(lotId);
  if (!lot || lot.etat !== 'propose') return lot;
  const db = getDb();
  const maintenant = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE production_lots SET etat = ?, decide_le = ? WHERE id = ?').run(valide ? 'valide' : 'refuse', maintenant, lotId);
    db.prepare('INSERT INTO production_approbations (id, card_id, sujet, sujet_id, decision, reponse, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      store.newId(),
      lot.cardId,
      'lot',
      lotId,
      valide ? 'valide' : 'refuse',
      reponse.slice(0, 400),
      maintenant,
    );
    if (!valide) {
      db.prepare(`UPDATE medias_realisation SET etat = 'refuse', modifie_le = ? WHERE lot_id = ? AND etat = 'devis'`).run(maintenant, lotId);
    }
  })();
  noterUnEvenement(lot.cardId, valide ? 'lot.valide' : 'lot.refuse', { lot: lotId });
  return lotParId(lotId);
}

/**
 * Marque une opération. À appeler DANS la transaction qui change son média :
 * réservée (le montant annoncé est engagé), débitée (le montant réel), libérée.
 */
export function marquerLOperation(operationId: string, etat: EtatDOperation, montant?: number | null): void {
  const db = getDb();
  if (etat === 'reservee') {
    db.prepare('UPDATE production_operations SET etat = ?, montant_reserve = ?, maj_le = ? WHERE id = ?').run(etat, montant ?? 0, Date.now(), operationId);
  } else if (etat === 'debitee') {
    db.prepare('UPDATE production_operations SET etat = ?, montant_debite = ?, maj_le = ? WHERE id = ?').run(etat, montant ?? null, Date.now(), operationId);
  } else {
    db.prepare('UPDATE production_operations SET etat = ?, maj_le = ? WHERE id = ?').run(etat, Date.now(), operationId);
  }
}
