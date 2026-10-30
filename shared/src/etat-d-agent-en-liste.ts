/*
 * L'ÉTAT D'UN AGENT DANS LA LISTE DE GAUCHE (demande du 30/10/2026 : « plus de
 * kanban, je veux penser en agents »).
 *
 * Le tableau à colonnes a quitté les projets et la page « Tableaux de bord » :
 * chaque carte y est désormais un AGENT, une ligne d'une liste unique triée par
 * dernière activité. Ce que la colonne disait se lit sur la ligne, par une
 * icône monochrome et un badge — et c'est CETTE règle qui décide lequel. Le
 * modèle, lui, ne bouge pas d'une virgule : les quatre clés de colonne
 * (`columns.ts`) restent ce qu'elles sont, on ne fait que les LIRE autrement.
 *
 * Huit états, et un seul à la fois. L'ordre des tests est la priorité :
 *
 *   1. « Archivé » / « En ligne » — la carte est rangée (`archived`) ; publiée
 *      (`deployedAt`), elle est « En ligne ».
 *   2. « À vous » — quelqu'un attend l'utilisateur : une question ouverte ou une
 *      décision (relancer / ignorer / arrêter, plan à valider). Elle passe AVANT
 *      « Au travail » : un agent arrêté sur `ask_user` garde son tour vivant
 *      (DEC-026) mais ne travaille pour personne. Ouvrir la carte ne l'efface
 *      pas : seule la réponse le fait. Un rendu non lu n'en est PAS : il ne met
 *      que le titre en gras (`LigneDAgent.nonLue`, demande du 30/10/2026).
 *   3. « Au travail » — un agent tient son tour à l'écran (le même prédicat que
 *      le témoin violet d'une conversation, `agentAuTravailALEcran`).
 *   4. « En pause » — « Suspendre » a laissé la carte en « En cours »
 *      (DEC-372, `carteEnPause`).
 *   5. « À déployer » — le travail rendu, lu, attend sa publication.
 *   6. « Lancé » — le départ est demandé mais l'agent ne tient pas encore son
 *      tour : date de départ posée par un geste (DEC-034 : jamais le seul
 *      créneau conseillé), « dès que possible », file sans quota, ou carte en
 *      « En cours » sans tour vivant.
 *   7. « Brouillon » — tout le reste de « Demande » : la carte se discute.
 *
 * Tout est pur : l'écran rassemble les signaux (agents, décisions, files), la
 * règle tranche. Le tri, la recherche et le filtre de la liste vivent ici
 * aussi, pour que la colonne d'un projet et la page « Tableaux de bord » —
 * une seule pièce d'écran — lisent les mêmes.
 */
import { carteEnPause } from './arret-carte.js';
import { sansAccents } from './classeurs.js';
import { estDeployee } from './en-route.js';
import { brancheDeLaCarte } from './gestion-de-branche.js';
import { activiteDeLaMere } from './regroupements.js';
import type { Card } from './models.js';

export const ETATS_D_AGENT_EN_LISTE = [
  'brouillon',
  'lance',
  'travail',
  'en-pause',
  'a-vous',
  'a-deployer',
  'en-ligne',
  'archive',
] as const;
export type EtatDAgentEnListe = (typeof ETATS_D_AGENT_EN_LISTE)[number];

/** Le libellé du badge — une clé du dictionnaire (`traductions.ts`), traduite à l'affichage. */
export const LIBELLE_ETAT_D_AGENT: Record<EtatDAgentEnListe, string> = {
  brouillon: 'Brouillon',
  lance: 'Lancé',
  travail: 'Au travail',
  'en-pause': 'En pause',
  'a-vous': 'À vous',
  'a-deployer': 'À déployer',
  'en-ligne': 'En ligne',
  archive: 'Archivé',
};

/**
 * LA COULEUR DU BADGE, dans la charte de l'application : JAUNE pour le
 * brouillon (le jeton de la compréhension), VIOLET pour ce que l'agent fait à
 * l'instant, NOIR (le texte plein) pour ce qui attend l'utilisateur, GRIS pour
 * tout le reste. Les ICÔNES, elles, ne se colorent jamais.
 */
export type TonDEtatDAgent = 'comprehension' | 'travail' | 'fort' | 'neutre';
export const TON_ETAT_D_AGENT: Record<EtatDAgentEnListe, TonDEtatDAgent> = {
  brouillon: 'comprehension',
  lance: 'neutre',
  travail: 'travail',
  'en-pause': 'neutre',
  'a-vous': 'fort',
  'a-deployer': 'neutre',
  'en-ligne': 'neutre',
  archive: 'neutre',
};

/** Les états rangés sous « Voir les archivés » : la carte est dans `archived`. */
export function etatArchive(etat: EtatDAgentEnListe): boolean {
  return etat === 'archive' || etat === 'en-ligne';
}

/** Ce que la règle lit d'une carte. */
export type CarteEnListe = Pick<
  Card,
  'id' | 'column' | 'renduA' | 'lastReadAt' | 'deployedAt' | 'scheduling' | 'suiviDesFilles' | 'cartesFilles'
>;

/** Les signaux de l'écran, rassemblés pour UNE carte. */
export interface SignauxDeLAgent {
  /** Un agent de la carte tient son tour à l'écran (`agentAuTravailALEcran`). */
  auTravail?: boolean;
  /** Un agent de la carte a posé une question et attend sa réponse (`Agent.attendReponse`). */
  attendReponse?: boolean;
  /** Les décisions ouvertes qui alertent sur cette carte (`alertesParCarte`). */
  decisions?: number;
  /** La demande attend un compte qui a du quota (`cartesEnAttenteDeQuota`). */
  enAttenteDeQuota?: boolean;
}

export function etatDeLAgentEnListe(carte: CarteEnListe, signaux: SignauxDeLAgent = {}): EtatDAgentEnListe {
  const mere = (carte.cartesFilles?.length ?? 0) > 0 ? activiteDeLaMere(carte.suiviDesFilles) : null;
  /* UNE MÈRE EST RANGÉE DANS « ARCHIVÉ » SANS DATE (MEM-0597) : elle vit par
     ses filles. Tant qu'une fille travaille ou attend, la mère le dit. */
  if (mere && carte.column === 'archived') {
    if (mere.enQuestion > 0) return 'a-vous';
    if (mere.enTravail > 0) return 'travail';
    if (mere.enAttente > 0) return 'lance';
  }
  if (carte.column === 'archived') {
    return estDeployee({ id: carte.id, column: carte.column, deployedAt: carte.deployedAt, updatedAt: 0 }) ? 'en-ligne' : 'archive';
  }
  if (signaux.attendReponse || (signaux.decisions ?? 0) > 0 || (mere?.enQuestion ?? 0) > 0) return 'a-vous';
  if (signaux.auTravail || (mere?.enTravail ?? 0) > 0) return 'travail';
  if (carteEnPause(carte.scheduling)) return 'en-pause';
  if (carte.column === 'to_deploy') return 'a-deployer';
  if (carte.column === 'running') return 'lance';
  const s = carte.scheduling;
  const departDemande = (s?.departPrevu !== undefined && !s.creneauAutomatique) || !!s?.asap;
  if (departDemande || signaux.enAttenteDeQuota) return 'lance';
  return 'brouillon';
}

/* ------------------------------------------------------------------ */
/* Tri, recherche, filtre                                               */
/* ------------------------------------------------------------------ */

/** Une ligne de la liste : la carte, son état, et l'instant de sa dernière activité. */
export interface LigneDAgent<C extends { id: string } = { id: string }> {
  carte: C;
  etat: EtatDAgentEnListe;
  /** La dernière activité connue (`updatedAt`, ou plus récent si un agent a parlé depuis). */
  activite: number;
  nonLue: boolean;
}

/** Le plus récent en haut ; à égalité, l'identifiant tranche — l'ordre ne saute jamais. */
export function trierParActivite<L extends LigneDAgent>(lignes: readonly L[]): L[] {
  return [...lignes].sort((a, b) => b.activite - a.activite || (a.carte.id < b.carte.id ? -1 : a.carte.id > b.carte.id ? 1 : 0));
}

/** Le texte cherché, plié : minuscules, sans accents, espaces resserrés. */
export function plierPourRecherche(texte: string): string {
  return sansAccents(texte).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * LA RECHERCHE TROUVE UN AGENT PAR SON NOM OU SA BRANCHE. Chaque mot saisi doit
 * se retrouver quelque part — « menu bas » trouve « Le menu du bas du
 * téléphone » —, sans tenir compte des accents ni des majuscules.
 */
export function agentCorrespond(
  carte: { id: string; title: string; brancheChoisie?: string; github?: Card['github'] },
  recherche: string,
): boolean {
  const mots = plierPourRecherche(recherche).split(' ').filter(Boolean);
  if (!mots.length) return true;
  const botte = plierPourRecherche(`${carte.title} ${brancheDeLaCarte(carte)}`);
  return mots.every((mot) => botte.includes(mot));
}

/** Le filtre de la liste : des états cochés (aucun = tous), les non lus seuls, des projets. */
export interface FiltreDesAgents {
  etats?: readonly EtatDAgentEnListe[];
  nonLusSeulement?: boolean;
  projets?: readonly string[];
}

export function filtreDesAgentsActif(filtre: FiltreDesAgents): boolean {
  return !!(filtre.etats?.length || filtre.nonLusSeulement || filtre.projets?.length);
}

export function passeLeFiltre(
  ligne: LigneDAgent<{ id: string; projectId?: string }>,
  filtre: FiltreDesAgents,
): boolean {
  if (filtre.etats?.length && !filtre.etats.includes(ligne.etat)) return false;
  if (filtre.nonLusSeulement && !ligne.nonLue) return false;
  if (filtre.projets?.length && !(ligne.carte.projectId && filtre.projets.includes(ligne.carte.projectId))) return false;
  return true;
}

/**
 * LES FAMILLES : une demande en plusieurs parties (une mère et ses filles,
 * `carteMereId`) se range d'un bloc, la mère en tête et ses étapes en retrait
 * dessous. Le bloc prend la place de son membre le plus récent. Une fille dont
 * la mère n'est pas dans la liste (autre projet, filtrée) reste seule.
 */
export interface FamilleDAgents<L> {
  tete: L;
  etapes: L[];
}

export function grouperEnFamilles<L extends LigneDAgent<{ id: string; carteMereId?: string; rangDansLaSuite?: number }>>(
  lignes: readonly L[],
): FamilleDAgents<L>[] {
  const presentes = new Set(lignes.map((l) => l.carte.id));
  const filles = new Map<string, L[]>();
  for (const ligne of lignes) {
    const mere = ligne.carte.carteMereId;
    if (mere && presentes.has(mere) && mere !== ligne.carte.id) {
      const liste = filles.get(mere) ?? [];
      liste.push(ligne);
      filles.set(mere, liste);
    }
  }
  const familles: (FamilleDAgents<L> & { activite: number })[] = [];
  for (const ligne of lignes) {
    const mere = ligne.carte.carteMereId;
    if (mere && presentes.has(mere) && mere !== ligne.carte.id) continue;
    /* Les étapes d'une SUITE se lisent dans leur ordre (1, 2, 3…) ; les autres filles, la plus récente d'abord. */
    const etapes = trierParActivite(filles.get(ligne.carte.id) ?? []).sort(
      (a, b) => (a.carte.rangDansLaSuite ?? 0) - (b.carte.rangDansLaSuite ?? 0),
    );
    const activite = Math.max(ligne.activite, ...etapes.map((e) => e.activite));
    familles.push({ tete: ligne, etapes, activite });
  }
  familles.sort(
    (a, b) => b.activite - a.activite || (a.tete.carte.id < b.tete.carte.id ? -1 : a.tete.carte.id > b.tete.carte.id ? 1 : 0),
  );
  return familles.map(({ tete, etapes }) => ({ tete, etapes }));
}

/**
 * LA CÉLÉBRATION : une carte dont le rendu (`renduA`) AVANCE sous nos yeux
 * vient de finir — l'agent a rendu son rapport. `avant` vaut `undefined` tant
 * que la carte n'a jamais été vue : un état lu au chargement n'a pas d'« avant »,
 * et aucune célébration ne se rejoue en rechargeant la page ni pour une
 * ancienne carte qui arrive avec son paquet.
 */
export function vientDeRendre(avant: number | undefined, apres: number | undefined): boolean {
  return avant !== undefined && (apres ?? 0) > avant;
}
