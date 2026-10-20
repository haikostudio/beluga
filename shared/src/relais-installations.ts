/*
 * LE RELAIS DES INSTALLATIONS — chaque copie de Beluga Build installée depuis le
 * dépôt public se signale à l'auteur, et ses administrateurs peuvent lui écrire.
 *
 * Décisions de l'utilisateur du 20/10/2026 :
 *  - chaque installation envoie un SIGNE DE VIE par jour : un numéro à elle, sa
 *    version et si elle est payante (offre hébergée). Le PAYS se déduit à la
 *    réception, et l'adresse de la machine n'est jamais gardée ;
 *  - l'adresse de courriel de l'administrateur ne part QUE s'il l'a acceptée
 *    (`partageDuCourriel` = « oui ») ; un refus laisse l'installation anonyme ;
 *  - les TICKETS arrivent chez l'auteur comme des demandes de son espace client,
 *    marquées « Open source », et ses réponses reviennent dans l'installation ;
 *  - tickets et statistiques se filtrent entre payants et non payants.
 *
 * L'adresse du relais n'est JAMAIS celle de l'application de l'auteur : elle
 * vit sous le domaine public de Beluga Build et ne relaie que `/relais/*`.
 */

import { z } from 'zod';

/** Où les installations se signalent et écrivent. */
export const ADRESSE_DU_RELAIS = 'https://relais.belugabuild.com';

export const ROUTES_DU_RELAIS = {
  signeDeVie: '/relais/signe-de-vie',
  ticket: '/relais/ticket',
  reponses: '/relais/reponses',
} as const;

/** Un signe de vie par jour : c'est lui qui dit si l'installation sert encore. */
export const PERIODE_DU_SIGNE_DE_VIE_MS = 24 * 60 * 60 * 1000;

/** Le compte (client, suspendu, sans mot de passe connu) qui signe les tickets reçus. */
export const COMPTE_DES_TICKETS = { identifiant: 'relais-open-source', nomAffiche: 'Open source' } as const;

/** L'étiquette posée sur chaque demande venue d'une installation. */
export const ETIQUETTE_OPEN_SOURCE = 'Open source';

/** Un compte qui n'est que le porte-voix du relais : jamais une personne. */
export function estLeCompteDesTickets(identifiant: string | null | undefined): boolean {
  return identifiant === COMPTE_DES_TICKETS.identifiant;
}

const NumeroDInstallation = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const SecretDInstallation = z.string().regex(/^[0-9a-f]{64}$/);

export const SigneDeVie = z.object({
  installation: NumeroDInstallation,
  /** Absent au tout premier signe : le relais en rend un, que l'installation garde. */
  secret: SecretDInstallation.optional(),
  version: z.string().max(80).default(''),
  payant: z.boolean().default(false),
  /** Seulement si l'administrateur a accepté de la partager. */
  courriel: z.string().trim().max(200).optional(),
});
export type SigneDeVie = z.infer<typeof SigneDeVie>;

export const TicketDuRelais = z.object({
  installation: NumeroDInstallation,
  secret: SecretDInstallation,
  titre: z.string().trim().min(1).max(140),
  message: z.string().trim().min(1).max(8000),
});
export type TicketDuRelais = z.infer<typeof TicketDuRelais>;

export const LectureDesReponses = z.object({
  installation: NumeroDInstallation,
  secret: SecretDInstallation,
});

/** Un ticket tel que l'installation qui l'a écrit le relit. */
export interface TicketRendu {
  id: string;
  titre: string;
  creeLe: number;
  /** « traite » dès que la demande est close chez l'auteur. */
  etat: 'ouvert' | 'traite';
  messages: { de: 'vous' | 'equipe'; texte: string; creeLe: number }[];
}

/** Une adresse de courriel plausible : sinon elle ne part pas. */
function courrielPlausible(courriel: string | undefined): courriel is string {
  return !!courriel && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel) && courriel.length <= 200;
}

/**
 * LE COURRIEL QUI PART AVEC LE SIGNE DE VIE : seulement après un « oui »
 * explicite. Un réglage vide (jamais répondu) vaut un refus.
 */
export function courrielAPartager(accord: string | null | undefined, courriel: string | null | undefined): string | undefined {
  if (accord !== 'oui') return undefined;
  const propre = courriel?.trim();
  return courrielPlausible(propre) ? propre : undefined;
}

/* ------------------------------------------------------------------ */
/* Ce que l'auteur lit                                                  */
/* ------------------------------------------------------------------ */

/** Une installation telle que le relais la connaît. */
export interface InstallationRecue {
  id: string;
  premiereVue: number;
  derniereVue: number;
  version: string;
  payant: boolean;
  /** Le code ISO du pays, déduit à la réception. */
  pays?: string;
  courriel?: string;
  /** Les jours où elle s'est signalée, sur les trente derniers. */
  joursActifs30: number;
  tickets: number;
}

export const FILTRES_DE_PAIEMENT = ['tous', 'payants', 'open-source'] as const;
export type FiltreDePaiement = (typeof FILTRES_DE_PAIEMENT)[number];

/** Payants d'un côté, open source de l'autre — une seule règle pour les écrans. */
export function filtrerParPaiement<T extends { payant: boolean }>(lignes: readonly T[], filtre: FiltreDePaiement): T[] {
  if (filtre === 'payants') return lignes.filter((l) => l.payant);
  if (filtre === 'open-source') return lignes.filter((l) => !l.payant);
  return [...lignes];
}

export type UsageDUneInstallation = 'quotidien' | 'hebdomadaire' | 'occasionnel' | 'eteint';

const JOUR = 24 * 60 * 60 * 1000;

/**
 * LA FRÉQUENCE D'USAGE, LUE DANS LES SIGNES DE VIE. Une installation qui ne
 * s'est pas signalée depuis trente jours est éteinte ; sinon, ses jours actifs
 * sur trente disent si elle sert chaque jour, chaque semaine, ou de temps en temps.
 */
export function usageDUneInstallation(ligne: Pick<InstallationRecue, 'derniereVue' | 'joursActifs30'>, maintenant: number): UsageDUneInstallation {
  if (maintenant - ligne.derniereVue > 30 * JOUR) return 'eteint';
  if (ligne.joursActifs30 >= 20) return 'quotidien';
  if (ligne.joursActifs30 >= 4) return 'hebdomadaire';
  return 'occasionnel';
}

export interface ResumeDesInstallations {
  total: number;
  actives7: number;
  actives30: number;
  nouvelles30: number;
  courriels: number;
  pays: { code: string; n: number }[];
  versions: { version: string; n: number }[];
  usage: Record<UsageDUneInstallation, number>;
}

function compter(valeurs: readonly string[]): { cle: string; n: number }[] {
  const parCle = new Map<string, number>();
  for (const v of valeurs) parCle.set(v, (parCle.get(v) ?? 0) + 1);
  return [...parCle.entries()].map(([cle, n]) => ({ cle, n })).sort((a, b) => b.n - a.n || a.cle.localeCompare(b.cle));
}

/** Les chiffres de l'écran « Installations », sur les lignes déjà filtrées. */
export function resumerLesInstallations(lignes: readonly InstallationRecue[], maintenant: number): ResumeDesInstallations {
  const usage: Record<UsageDUneInstallation, number> = { quotidien: 0, hebdomadaire: 0, occasionnel: 0, eteint: 0 };
  for (const l of lignes) usage[usageDUneInstallation(l, maintenant)] += 1;
  return {
    total: lignes.length,
    actives7: lignes.filter((l) => maintenant - l.derniereVue <= 7 * JOUR).length,
    actives30: lignes.filter((l) => maintenant - l.derniereVue <= 30 * JOUR).length,
    nouvelles30: lignes.filter((l) => maintenant - l.premiereVue <= 30 * JOUR).length,
    courriels: lignes.filter((l) => !!l.courriel).length,
    pays: compter(lignes.map((l) => l.pays || '??')).map(({ cle, n }) => ({ code: cle, n })),
    versions: compter(lignes.map((l) => l.version || '?')).map(({ cle, n }) => ({ version: cle, n })),
    usage,
  };
}

/** Les téléchargements du dépôt public, jour par jour (ce que GitHub en dit : ni qui, ni d'où). */
export interface TelechargementsDuJour {
  jour: string;
  clones: number;
  clonesUniques: number;
  vues: number;
  vuesUniques: number;
}
