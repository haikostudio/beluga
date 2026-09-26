/**
 * L'ESPACE « ACCÈS » ET LES BACKUPS DE L'ESPACE CLIENT — les règles pures.
 *
 * DEUX PORTES NEUVES DANS L'ESPACE CLIENT, et elles ne s'ouvrent pas pareil.
 *
 * LES BACKUPS se LISENT et se TÉLÉCHARGENT : un client récupère à tout moment
 * l'une des archives réussies de SON projet. Rien ne se restaure depuis
 * l'espace — une remise en place écrase ce que le site porte, c'est un geste
 * de Haiko. Le chemin disque d'une archive ne sort jamais du serveur.
 *
 * L'ESPACE « ACCÈS » garde les informations d'accès libres d'un projet hébergé
 * (serveur, base, panneau d'administration). Il est VERROUILLÉ par défaut, et ne
 * s'ouvre au client qu'après une PRISE DE RESPONSABILITÉ explicite : case
 * cochée, version du texte accepté, journal jamais réécrit. Une fois ouvert,
 * l'espace le DIT en permanence — Haiko n'est plus responsable de la sûreté
 * des données, l'accès va à l'encontre du contrat de maintenance, et aucun
 * problème survenu ensuite ne peut lui être imputé. Seul Haiko écrit le
 * contenu, et seul Haiko peut reverrouiller.
 *
 * Rien ici ne touche la base : testable seul
 * (`server/src/test/espace-acces.test.ts`).
 */

import { z } from 'zod';
import type { PointDeSauvegarde, SiteASauvegarder } from './backups.js';
import type { RoleCompte } from './comptes-clients.js';

/* ------------------------------------------------------------------ */
/* Les backups vus par le client                                        */
/* ------------------------------------------------------------------ */

/** Une archive telle que l'espace la montre : jamais son chemin sur le disque. */
export interface ArchiveVisible {
  pointId: string;
  debut: number;
  fin: number;
  taille: number;
  origine: 'automatique' | 'manuel';
}

export interface BackupsDuSiteVisibles {
  siteId: string;
  nom: string;
  archives: ArchiveVisible[];
}

/**
 * CE POINT SE TÉLÉCHARGE-T-IL ? Réussi, et porteur d'une archive. Un point
 * partiel ou en échec n'est pas une copie sur laquelle on peut compter ; un
 * point d'avant les archives n'a rien à envoyer d'un seul fichier.
 */
export function archiveTelechargeable(point: Pick<PointDeSauvegarde, 'statut' | 'cheminArchive'>): boolean {
  return point.statut === 'reussi' && Boolean(point.cheminArchive?.trim());
}

/**
 * LES ARCHIVES D'UN PROJET, site par site, de la plus récente à la plus
 * ancienne. Seuls les sites RATTACHÉS à ce projet comptent : un site extérieur
 * n'appartient à aucun client.
 */
export function backupsDuProjet(
  projectId: string,
  sites: readonly SiteASauvegarder[],
  points: readonly PointDeSauvegarde[],
): BackupsDuSiteVisibles[] {
  return sites
    .filter((site) => site.projectId === projectId)
    .map((site) => ({
      siteId: site.id,
      nom: site.nom,
      archives: points
        .filter((point) => point.siteId === site.id && archiveTelechargeable(point))
        .sort((a, b) => b.debut - a.debut)
        .map((point) => ({
          pointId: point.id,
          debut: point.debut,
          fin: point.fin,
          taille: point.taille ?? 0,
          origine: point.origine,
        })),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Le nom du fichier téléchargé : le site et la date, lisibles, sans caractère piégé. */
export function nomDeLArchive(nomDuSite: string, debut: number): string {
  const propre =
    (nomDuSite ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'site';
  const date = new Date(debut).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `backup-${propre}-${date}.zip`;
}

/* ------------------------------------------------------------------ */
/* L'espace « Accès »                                                   */
/* ------------------------------------------------------------------ */

/**
 * LA VERSION DU TEXTE DE RESPONSABILITÉ. Elle est inscrite au journal à chaque
 * déverrouillage : le jour où le texte change, on sait ce que chacun a accepté.
 * Changer une phrase de `TEXTE_DE_RESPONSABILITE` ou des mentions, c'est
 * monter ce numéro.
 */
export const VERSION_TEXTE_ACCES = 1;

/** Le plafond du contenu libre, en signes. */
export const TEXTE_ACCES_MAX = 20_000;

/**
 * Ce que le client lit AVANT d'ouvrir. D'UN SEUL TENANT, jamais recollé en
 * morceaux : c'est la clé du dictionnaire, et `verif-langues.mjs` la cherche
 * telle quelle dans les sources.
 */
export const TEXTE_DE_RESPONSABILITE =
  'Cet espace contient les informations d’accès direct à votre hébergement : serveur, base de données, administration. Tant qu’il reste fermé, Haiko garde seul la main sur ces accès et répond de leur sûreté. En l’ouvrant, vous prenez la responsabilité de tout ce qui sera fait avec ces informations, par vous ou par quiconque les recevra de vous. L’ouverture est enregistrée avec votre nom et la date, et ne peut pas être annulée de votre côté.';

/** La case à cocher : la confirmation explicite. */
export const CONFIRMATION_ACCES = 'J’ai lu ces conditions et j’en prends la responsabilité.';

/** Le bouton qui ouvre. */
export const BOUTON_OUVRIR_ACCES = 'J’assume et j’ouvre l’accès';

/**
 * LES TROIS MENTIONS DU BANDEAU PERMANENT, une fois l'espace ouvert. Elles sont
 * affichées TOUJOURS, au-dessus du contenu : ce n'est pas un avertissement
 * qu'on ferme.
 */
export const MENTIONS_ACCES_OUVERT = [
  'Haiko n’est plus responsable de la sûreté des données sur le serveur : la boîte de Pandore est ouverte.',
  'Cet accès va à l’encontre du contrat de maintenance, s’il y en a un.',
  'Haiko ne peut plus être tenu responsable des problèmes survenus sur le site ou l’application.',
] as const;

export const GesteDAcces = z.enum(['deverrouillage', 'reverrouillage']);
export type GesteDAcces = z.infer<typeof GesteDAcces>;

/** Une ligne du journal des ouvertures : écrite une fois, jamais réécrite. */
export const EntreeJournalAcces = z.object({
  id: z.string(),
  projectId: z.string(),
  geste: GesteDAcces,
  compteId: z.string(),
  nom: z.string(),
  role: z.enum(['admin', 'client']),
  /** La version du texte de responsabilité en vigueur au moment du geste. */
  version: z.number(),
  le: z.number(),
});
export type EntreeJournalAcces = z.infer<typeof EntreeJournalAcces>;

export interface EtatDeLAcces {
  ouvert: boolean;
  /** Qui a ouvert, et quand — seulement quand c'est ouvert. */
  ouvertPar?: string;
  ouvertLe?: number;
  version?: number;
}

/**
 * L'ÉTAT DE L'ESPACE SE LIT DANS LE JOURNAL, ET NULLE PART AILLEURS. Le dernier
 * geste en date décide : un déverrouillage ouvre, un reverrouillage de Haiko
 * referme. Aucun drapeau à tenir en double — il ne pourrait que dériver du
 * journal.
 */
export function etatDeLAcces(journal: readonly Pick<EntreeJournalAcces, 'geste' | 'nom' | 'le' | 'version'>[]): EtatDeLAcces {
  const dernier = [...journal].sort((a, b) => a.le - b.le).at(-1);
  if (!dernier || dernier.geste !== 'deverrouillage') return { ouvert: false };
  return { ouvert: true, ouvertPar: dernier.nom, ouvertLe: dernier.le, version: dernier.version };
}

/**
 * LE DÉVERROUILLAGE EXIGE UNE CONFIRMATION EXPLICITE, SUR LE TEXTE EN VIGUEUR.
 * Rend la raison du refus, ou `null`. Une version ancienne est refusée : le
 * client doit relire ce qui a changé avant de l'accepter.
 */
export function refusDeDeverrouiller(demande: { confirme?: unknown; version?: unknown }): string | null {
  if (demande.confirme !== true) {
    return 'L’accès ne s’ouvre qu’après avoir coché la prise de responsabilité.';
  }
  if (demande.version !== VERSION_TEXTE_ACCES) {
    return 'Le texte de responsabilité a changé : relisez-le avant de l’accepter.';
  }
  return null;
}

/** LE CONTENU SE MONTRE-T-IL ? Toujours à Haiko ; au client, seulement une fois ouvert. */
export function contenuDAccesVisible(role: RoleCompte, etat: Pick<EtatDeLAcces, 'ouvert'>): boolean {
  return role === 'admin' || etat.ouvert;
}

/** Le contenu libre, nettoyé et borné. Un texte trop long est REFUSÉ, jamais coupé. */
export function lireTexteDAcces(texte: unknown): { ok: true; texte: string } | { ok: false; raison: string } {
  const brut = typeof texte === 'string' ? texte.replace(/\r\n/g, '\n') : '';
  if (brut.length > TEXTE_ACCES_MAX) {
    return { ok: false, raison: `Le texte dépasse ${TEXTE_ACCES_MAX} signes : retirez-en ${brut.length - TEXTE_ACCES_MAX}.` };
  }
  return { ok: true, texte: brut.trim() };
}
