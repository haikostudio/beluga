/*
 * LES ORDINATEURS NOMMÉS, CÔTÉ DÉMON (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026) — règles
 * pures dans `shared/src/ordinateurs.ts`.
 *
 * Table `ordinateurs` (id, compte, nom, création, révocation). Un navigateur relié (`chrome_appareils`) porte son
 * `ordinateur_id` ; le programme du Mac (relais, table `meta`) porte son `ordinateurId`. Une carte retient son
 * ordinateur dans `chrome_cartes.ordinateur_id` ; le DERNIER ordinateur choisi par un compte sert de défaut
 * (`meta` « ordinateurs.dernier:<compte> »).
 *
 * PÉRIMÈTRE : tout se lit et s'écrit PAR COMPTE. Un ordinateur d'un autre compte n'est jamais vu, jamais visé.
 */
import crypto from 'node:crypto';
import {
  ORDINATEURS_MAX,
  nomGenerique,
  nomProposeDepuisLaPlateforme,
  normaliserLeNomDOrdinateur,
  repereDOrdinateur,
  type GenreDeNavigateur,
  type Ordinateur,
  type ProgrammeDuMac,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';

interface LigneOrdinateur {
  id: string;
  compte_id: string;
  nom: string;
  cree_le: number;
}

function lignesDuCompte(compteId: string): LigneOrdinateur[] {
  return getDb()
    .prepare('SELECT id, compte_id, nom, cree_le FROM ordinateurs WHERE compte_id = ? AND revoque_le IS NULL ORDER BY cree_le')
    .all(compteId) as LigneOrdinateur[];
}

/** L'ordinateur d'un compte, ou rien : jamais celui d'un autre compte. */
export function ligneDOrdinateur(compteId: string, id: string | null | undefined): LigneOrdinateur | null {
  if (!id) return null;
  return (
    (getDb().prepare('SELECT id, compte_id, nom, cree_le FROM ordinateurs WHERE id = ? AND compte_id = ? AND revoque_le IS NULL').get(id, compteId) as
      | LigneOrdinateur
      | undefined) ?? null
  );
}

/** Un ordinateur neuf, au nom donné. Refusé au-delà de `ORDINATEURS_MAX` par compte. */
export function creerUnOrdinateur(compteId: string, nom: unknown, maintenant = Date.now()): { id: string; nom: string } {
  if (lignesDuCompte(compteId).length >= ORDINATEURS_MAX) throw new Error(`Déjà ${ORDINATEURS_MAX} ordinateurs : déliez-en un dans Réglages → Extension.`);
  const id = `o${crypto.randomBytes(9).toString('base64url')}`;
  const propre = normaliserLeNomDOrdinateur(nom);
  getDb().prepare('INSERT INTO ordinateurs (id, compte_id, nom, cree_le) VALUES (?, ?, ?, ?)').run(id, compteId, propre, maintenant);
  bus.emit({ type: 'extension.change' });
  return { id, nom: propre };
}

export function renommerUnOrdinateur(compteId: string, id: string, nom: unknown): boolean {
  const fait = getDb()
    .prepare('UPDATE ordinateurs SET nom = ? WHERE id = ? AND compte_id = ? AND revoque_le IS NULL')
    .run(normaliserLeNomDOrdinateur(nom), id, compteId);
  if (fait.changes) bus.emit({ type: 'extension.change' });
  return fait.changes > 0;
}

/** Délier un ordinateur : ses navigateurs et son programme du Mac sont déliés avec lui. */
export async function delierUnOrdinateur(compteId: string, id: string): Promise<boolean> {
  if (!ligneDOrdinateur(compteId, id)) return false;
  const { delierUnChrome } = await import('./extension-chrome.js');
  const { delierLeMac } = await import('./relais-mac.js');
  const appareils = getDb()
    .prepare('SELECT id FROM chrome_appareils WHERE compte_id = ? AND ordinateur_id = ? AND revoque_le IS NULL')
    .all(compteId, id) as { id: string }[];
  for (const a of appareils) delierUnChrome(compteId, a.id);
  delierLeMac(compteId, id);
  getDb().prepare('UPDATE ordinateurs SET revoque_le = ? WHERE id = ? AND compte_id = ?').run(Date.now(), id, compteId);
  bus.emit({ type: 'extension.change' });
  return true;
}

/** Le nom d'un ordinateur change quand le vrai nom du Mac arrive et que l'actuel n'était qu'un nom par défaut. */
export function proposerLeVraiNom(compteId: string, id: string, vraiNom: string): void {
  const ligne = ligneDOrdinateur(compteId, id);
  if (!ligne || !vraiNom.trim()) return;
  if (nomGenerique(ligne.nom)) renommerUnOrdinateur(compteId, id, vraiNom);
}

/* ------------------------------------------------------------------ */
/* La liste lue par l'écran et par les agents                           */
/* ------------------------------------------------------------------ */

/**
 * LES ORDINATEURS D'UN COMPTE, avec leurs navigateurs et leur programme du Mac. Un navigateur relié sans ordinateur
 * (base pas encore migrée, liaison d'avant) en reçoit un : rien ne se perd.
 */
export async function ordinateursDuCompte(compteId: string): Promise<Ordinateur[]> {
  const { chromesDuCompte } = await import('./extension-chrome.js');
  const { programmesDuCompte } = await import('./relais-mac.js');
  return ordinateursAssembles(compteId, chromesDuCompte(compteId), programmesDuCompte(compteId));
}

interface NavigateurRelie {
  id: string;
  nom: string;
  ordinateurId: string | null;
  genre: GenreDeNavigateur;
  enLigne: boolean;
  version: string | null;
  vuLe: number | null;
  agentsAuTravail: number;
}

export function ordinateursAssembles(
  compteId: string,
  navigateurs: readonly NavigateurRelie[],
  programmes: readonly (ProgrammeDuMac & { ordinateurId: string })[],
): Ordinateur[] {
  /* Un navigateur sans ordinateur en reçoit un, à son nom de plateforme. */
  for (const n of navigateurs) {
    if (n.ordinateurId && ligneDOrdinateur(compteId, n.ordinateurId)) continue;
    const cree = creerUnOrdinateur(compteId, nomProposeDepuisLaPlateforme(n.nom));
    getDb().prepare('UPDATE chrome_appareils SET ordinateur_id = ? WHERE id = ? AND compte_id = ?').run(cree.id, n.id, compteId);
    (n as { ordinateurId: string | null }).ordinateurId = cree.id;
  }
  return lignesDuCompte(compteId).map((l) => {
    const p = programmes.find((x) => x.ordinateurId === l.id);
    return {
      id: l.id,
      nom: l.nom,
      repere: repereDOrdinateur(l.nom),
      creeLe: l.cree_le,
      navigateurs: navigateurs
        .filter((n) => n.ordinateurId === l.id)
        .map((n) => ({ id: n.id, genre: n.genre, enLigne: n.enLigne, version: n.version, vuLe: n.vuLe, agentsAuTravail: n.agentsAuTravail })),
      programme: p ? { id: p.id, etat: p.etat, vuLe: p.vuLe, autorisations: p.autorisations ?? null } : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* L'ordinateur retenu (carte, ou agent sans carte) et le dernier choisi */
/* ------------------------------------------------------------------ */

function cleDeTravail(agentId: string, cardId?: string | null): string {
  return cardId ? `carte:${cardId}` : `agent:${agentId}`;
}

const cleDuDernier = (compteId: string) => `ordinateurs.dernier:${compteId}`;

export function dernierOrdinateur(compteId: string): string | null {
  return getMeta(cleDuDernier(compteId)) || null;
}

/**
 * L'ORDINATEUR RETENU POUR UNE CARTE : celui choisi (bouton, « /ordinateur:… », réponse à la question de l'agent),
 * sinon celui du navigateur déjà retenu pour la carte (une carte née dans un Chrome).
 */
export function ordinateurRetenu(agentId: string, cardId?: string | null): string | null {
  const ligne = getDb()
    .prepare(
      `SELECT c.ordinateur_id AS ordinateur, a.ordinateur_id AS duNavigateur
         FROM chrome_cartes c LEFT JOIN chrome_appareils a ON a.id = c.appareil_id
        WHERE c.cle = ?`,
    )
    .get(cleDeTravail(agentId, cardId)) as { ordinateur: string | null; duNavigateur: string | null } | undefined;
  return ligne?.ordinateur ?? ligne?.duNavigateur ?? null;
}

/**
 * RETENIR UN ORDINATEUR (ou l'oublier : `null`) pour une carte. Le navigateur retenu qui n'est pas sur cet ordinateur
 * est oublié, pour que l'agent reprenne celui du bon ordinateur. Le choix devient aussi le DERNIER du compte.
 */
export function retenirLOrdinateur(compteId: string, agentId: string, cardId: string | null | undefined, ordinateurId: string | null): boolean {
  if (ordinateurId && !ligneDOrdinateur(compteId, ordinateurId)) return false;
  getDb()
    .prepare(
      `INSERT INTO chrome_cartes (cle, appareil_id, ordinateur_id, maj_le) VALUES (?, NULL, ?, ?)
       ON CONFLICT(cle) DO UPDATE SET ordinateur_id = excluded.ordinateur_id, maj_le = excluded.maj_le,
         appareil_id = CASE WHEN excluded.ordinateur_id IS NULL
                              OR chrome_cartes.appareil_id IN (SELECT id FROM chrome_appareils WHERE ordinateur_id = excluded.ordinateur_id)
                            THEN chrome_cartes.appareil_id ELSE NULL END`,
    )
    .run(cleDeTravail(agentId, cardId), ordinateurId, Date.now());
  if (ordinateurId) setMeta(cleDuDernier(compteId), ordinateurId);
  bus.emit({ type: 'extension.change' });
  return true;
}
