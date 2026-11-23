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
  droitsDeLOrdinateur,
  type DroitDOrdinateur,
  type DroitsDOrdinateur,
  nomGenerique,
  nomProposeDepuisLaPlateforme,
  normaliserLeNomDOrdinateur,
  repereDOrdinateur,
  type GenreDeNavigateur,
  type MarqueDeNavigateur,
  type Ordinateur,
  type ProgrammeDuMac,
  choixEffectif,
  choixValable,
  genreDeNavigateur,
  marqueDuNavigateur,
  marqueValable,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';

interface LigneOrdinateur {
  id: string;
  compte_id: string;
  nom: string;
  cree_le: number;
  droits: string | null;
  navigateurs?: string | null;
}

function lignesDuCompte(compteId: string): LigneOrdinateur[] {
  return getDb()
    .prepare('SELECT id, compte_id, nom, cree_le, droits, navigateurs FROM ordinateurs WHERE compte_id = ? AND revoque_le IS NULL ORDER BY cree_le')
    .all(compteId) as LigneOrdinateur[];
}

/** L'ordinateur d'un compte, ou rien : jamais celui d'un autre compte. */
export function ligneDOrdinateur(compteId: string, id: string | null | undefined): LigneOrdinateur | null {
  if (!id) return null;
  return (
    (getDb().prepare('SELECT id, compte_id, nom, cree_le, droits, navigateurs FROM ordinateurs WHERE id = ? AND compte_id = ? AND revoque_le IS NULL').get(id, compteId) as
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

/**
 * LES DROITS DE BELUGA SUR UN ORDINATEUR (carte « Piloter le Mac depuis Beluga ») : relus en base à CHAQUE geste
 * (`outil-ordinateur.ts`), si bien qu'un droit coupé dans Beluga ferme la porte aussitôt.
 */
export function droitsDUnOrdinateur(compteId: string, id: string): DroitsDOrdinateur | null {
  const ligne = ligneDOrdinateur(compteId, id);
  return ligne ? droitsDeLOrdinateur(ligne.droits) : null;
}

/** Allumer ou éteindre un droit, sur l'ordinateur d'un compte seulement. */
export function changerUnDroit(compteId: string, id: string, droit: DroitDOrdinateur, actif: boolean): DroitsDOrdinateur | null {
  const ligne = ligneDOrdinateur(compteId, id);
  if (!ligne) return null;
  const droits = { ...droitsDeLOrdinateur(ligne.droits), [droit]: actif };
  getDb().prepare('UPDATE ordinateurs SET droits = ? WHERE id = ? AND compte_id = ? AND revoque_le IS NULL').run(JSON.stringify(droits), id, compteId);
  bus.emit({ type: 'extension.change' });
  return droits;
}

/**
 * LES NAVIGATEURS CHOISIS D'UN ORDINATEUR (carte « Navigateurs facultatifs à la liaison », 22/11/2026) : `null` tant
 * que rien n'est choisi, `[]` pour « sans navigateur ». Relus à chaque attente de Beluga Connect : l'automatisme
 * n'équipe et ne répare que ceux-là.
 */
export function navigateursChoisisDe(ligne: Pick<LigneOrdinateur, 'navigateurs'> | null | undefined): MarqueDeNavigateur[] | null {
  if (!ligne?.navigateurs) return null;
  try {
    const brut = JSON.parse(ligne.navigateurs);
    return Array.isArray(brut) ? choixValable(brut) : null;
  } catch {
    return null;
  }
}

/**
 * CHOISIR LES NAVIGATEURS : enregistre le choix et rend ce qui change — les marques AJOUTÉES (Beluga Connect les
 * équipe) et RETIRÉES (Beluga Connect retire leur module, leurs fiches sont déliées). Un premier choix (`avant` nul)
 * ne retire rien : les navigateurs reliés avant le choix et laissés décochés le sont aussi.
 */
export function choisirLesNavigateurs(
  compteId: string,
  id: string,
  brut: unknown,
): { choisis: MarqueDeNavigateur[]; ajoutes: MarqueDeNavigateur[]; retires: MarqueDeNavigateur[] } | null {
  const ligne = ligneDOrdinateur(compteId, id);
  if (!ligne) return null;
  const choisis = choixValable(brut);
  const relies = (
    getDb().prepare('SELECT navigateur, marque FROM chrome_appareils WHERE compte_id = ? AND ordinateur_id = ? AND revoque_le IS NULL').all(compteId, id) as {
      navigateur: string | null;
      marque: string | null;
    }[]
  ).map((r) => ({ genre: genreDeNavigateur(r.navigateur), marque: marqueValable(r.marque) }));
  const avant = choixEffectif(navigateursChoisisDe(ligne), relies) ?? [];
  getDb().prepare('UPDATE ordinateurs SET navigateurs = ? WHERE id = ? AND compte_id = ? AND revoque_le IS NULL').run(JSON.stringify(choisis), id, compteId);
  bus.emit({ type: 'extension.change' });
  const reliees = new Set(relies.map((r) => marqueDuNavigateur(r)));
  return {
    choisis,
    ajoutes: choisis.filter((m) => !avant.includes(m)),
    retires: [...new Set([...avant, ...reliees])].filter((m) => !choisis.includes(m)),
  };
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
  marque?: MarqueDeNavigateur | null;
  enLigne: boolean;
  version: string | null;
  incognito?: boolean | null;
  vuLe: number | null;
  agentsAuTravail: number;
  creeLe?: number;
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
      droits: droitsDeLOrdinateur(l.droits),
      navigateursChoisis: navigateursChoisisDe(l),
      navigateurs: navigateurs
        .filter((n) => n.ordinateurId === l.id)
        .map((n) => ({
          id: n.id,
          genre: n.genre,
          marque: n.marque ?? null,
          enLigne: n.enLigne,
          version: n.version,
          incognito: n.incognito ?? null,
          vuLe: n.vuLe,
          agentsAuTravail: n.agentsAuTravail,
          creeLe: n.creeLe,
        })),
      programme: p
        ? {
            id: p.id,
            etat: p.etat,
            vuLe: p.vuLe,
            autorisations: p.autorisations ?? null,
            connect: p.connect ?? null,
            preparation: p.preparation ?? null,
            safari: p.safari ?? null,
            installes: p.installes ?? null,
            autres: p.autres ?? null,
            systeme: p.systeme ?? 'mac',
            relieLe: p.relieLe ?? null,
          }
        : null,
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
