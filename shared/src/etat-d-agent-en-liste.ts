/*
 * L'ÉTAT D'UN AGENT DANS LA LISTE DE GAUCHE (demande du 30/10/2026 : « plus de
 * kanban, je veux penser en agents »).
 *
 * Le tableau à colonnes a quitté les projets et la page « Tableaux de bord » :
 * chaque carte y est désormais un AGENT, une ligne d'une liste unique triée par
 * date de dernière modification. Ce que la colonne disait se lit sur la ligne, par une
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
 * règle tranche. La recherche et le filtre de la liste vivent ici
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
  'cadrage',
  'en-pause',
  'a-vous',
  'a-deployer',
  'en-ligne',
  'archive',
  /* UNE MISE EN LIGNE TOMBÉE (17/11/2026) : un point rouge plein dans le rond d'état du logo du projet. */
  'echec',
] as const;
export type EtatDAgentEnListe = (typeof ETATS_D_AGENT_EN_LISTE)[number];

/** Le libellé du badge — une clé du dictionnaire (`traductions.ts`), traduite à l'affichage. */
export const LIBELLE_ETAT_D_AGENT: Record<EtatDAgentEnListe, string> = {
  brouillon: 'Brouillon',
  lance: 'Lancé',
  travail: 'Au travail',
  /* UN CADRAGE EN COURS (16/11/2026) : le crayon qui écrit, à côté du marteau du travail. */
  cadrage: 'Compréhension',
  'en-pause': 'En pause',
  'a-vous': 'À vous',
  'a-deployer': 'À déployer',
  'en-ligne': 'En ligne',
  archive: 'Archivé',
  echec: 'Échec',
};

/**
 * LA FAMILLE DE COULEUR D'UN AGENT (demande du 01/11/2026, capture #ca0c : « un indicateur visuel qui permette de
 * distinguer le statut, pas qu'avec l'icône ») — quatre familles, et le VERT est la seule teinte ajoutée à la charte,
 * réservée aux badges et aux ronds de statut :
 *
 *   - « agit » (violet, le jeton du travail) : l'agent travaille, ou son départ est demandé ;
 *   - « a-vous » (jaune, le jeton de la compréhension) : une question ou une décision attend, ou la carte se discute ;
 *   - « pret » (vert) : le travail est rendu — à déployer, ou terminé et pas encore ouvert ;
 *   - « repos » (gris) : en pause, en ligne déjà vue, archivée.
 *
 * Le travail et la question passent avant le vert : un rendu non lu ne cache pas un agent qui tourne encore.
 */
export const FAMILLES_DE_COULEUR = ['agit', 'a-vous', 'pret', 'repos'] as const;
export type FamilleDeCouleur = (typeof FAMILLES_DE_COULEUR)[number];

export function familleDeCouleur(etat: EtatDAgentEnListe, termineeNonOuverte = false): FamilleDeCouleur {
  if (etat === 'travail' || etat === 'cadrage') return 'agit';
  if (etat === 'a-vous' || etat === 'echec') return 'a-vous';
  if (etat === 'a-deployer' || termineeNonOuverte) return 'pret';
  if (etat === 'lance') return 'agit';
  if (etat === 'brouillon') return 'a-vous';
  return 'repos';
}

/** Au-delà, un rendu jamais ouvert ne remonte plus : les vieilles cartes oubliées restent rangées (01/11/2026). */
export const DUREE_D_UN_RENDU_A_OUVRIR_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * UNE CARTE TERMINÉE QUE PERSONNE N'A ENCORE OUVERTE : son compte rendu est plus récent que sa dernière lecture, et
 * date de moins de trente jours — QUELLE QUE SOIT sa colonne, rangées comprises. Ce n'est PAS `carteNonLue`
 * (`travail-rendu.ts`), qui écarte les cartes rangées pour le badge bleu du projet : les deux règles vivent côte à côte.
 */
export function termineeNonOuverte(carte: Pick<Card, 'renduA' | 'lastReadAt'>, maintenant = Date.now()): boolean {
  const rendu = carte.renduA;
  if (rendu === undefined) return false;
  return rendu > (carte.lastReadAt ?? 0) && rendu >= maintenant - DUREE_D_UN_RENDU_A_OUVRIR_MS;
}

/** Les états d'un agent en vie : la carte n'est pas rangée, ou un agent la fait encore vivre. */
const ETATS_ACTIFS: ReadonlySet<EtatDAgentEnListe> = new Set(['brouillon', 'lance', 'travail', 'cadrage', 'en-pause', 'a-vous', 'a-deployer']);

/**
 * UNE LIGNE ACTIVE monte AU-DESSUS DU TRAIT des listes d'agents (demande du 01/11/2026) : un agent en vie, ou une
 * carte terminée pas encore ouverte. L'ouvrir la fait passer sous le trait, avec les rangées.
 */
export function ligneActive(
  ligne: { etat: EtatDAgentEnListe; carte: Pick<Card, 'renduA' | 'lastReadAt'> },
  maintenant = Date.now(),
): boolean {
  return ETATS_ACTIFS.has(ligne.etat) || termineeNonOuverte(ligne.carte, maintenant);
}

/**
 * LES ACTIVES D'ABORD, PUIS LES RANGÉES : chaque groupe garde l'ordre reçu (par date). Rend l'indice de la première
 * rangée — là où le trait se pose —, ou `null` quand l'un des deux groupes est vide (pas de trait à poser).
 */
export function separerActives<E>(entrees: readonly E[], active: (entree: E) => boolean): { entrees: E[]; trait: number | null } {
  const hautes: E[] = [];
  const basses: E[] = [];
  for (const entree of entrees) (active(entree) ? hautes : basses).push(entree);
  return { entrees: [...hautes, ...basses], trait: hautes.length && basses.length ? hautes.length : null };
}

/**
 * LES TÂCHES ARCHIVÉES SE CACHENT DANS LA COLONNE (décision de l'utilisateur du 14/11/2026, carte « Onglets, services
 * et listes repensés » : « dans la sidebar il faut masquer les tâches archivées et quand l'utilisateur clique sur Voir
 * plus tu les affiches »). Tant que les archives ne sont pas montrées, seules restent les entrées GARDÉES : actives
 * (au travail, en attente d'une réponse, brouillon, à déployer, rendu non ouvert) et la tâche ouverte. `cachees` dit
 * combien d'archives attendent derrière « Voir plus ».
 */
export function entreesDeLaColonne<E>(
  entrees: readonly E[],
  archivesMontrees: boolean,
  gardee: (entree: E) => boolean,
): { visibles: E[]; cachees: number } {
  if (archivesMontrees) return { visibles: [...entrees], cachees: 0 };
  const visibles = entrees.filter(gardee);
  return { visibles, cachees: entrees.length - visibles.length };
}

/** Les états rangés sous « Voir les archives » : la carte est dans `archived`. */
export function etatArchive(etat: EtatDAgentEnListe): boolean {
  return etat === 'archive' || etat === 'en-ligne';
}

/*
 * UNE LIGNE ACTIVE NE RESTE JAMAIS SOUS « VOIR PLUS » (`ligneActive`, plus haut) : un agent travaille, attend
 * l'utilisateur, part, se discute, attend sa publication, ou son rendu n'est pas ouvert. Elle monte au-dessus du
 * trait, et la cacher sous « Voir plus » laisserait le haut de la liste mentir (01/11/2026, l'ancien `ligneAGarder`
 * ne gardait que le travail, la question et le départ en « En cours »).
 */

/** Ce que la règle lit d'une carte. */
export type CarteEnListe = Pick<
  Card,
  'id' | 'column' | 'renduA' | 'lastReadAt' | 'deployedAt' | 'scheduling' | 'suiviDesFilles' | 'cartesFilles'
>;

/** Les signaux de l'écran, rassemblés pour UNE carte. */
export interface SignauxDeLAgent {
  /** Un agent de la carte tient son tour à l'écran (`agentAuTravailALEcran`). */
  auTravail?: boolean;
  /** L'agent qui tient son tour est celui du CADRAGE (rôle `cadrage`) : la ligne dit « Compréhension ». */
  auCadrage?: boolean;
  /** Un agent de la carte a posé une question et attend sa réponse (`Agent.attendReponse`). */
  attendReponse?: boolean;
  /** Les décisions ouvertes qui alertent sur cette carte (`alertesParCarte`) : elles ne colorent plus la ligne. */
  decisions?: number;
  /** Les QUESTIONS qui attendent une réponse sur cette carte (`questionsParCarte`) : elles seules allument le jaune. */
  questions?: number;
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
  /* UNE CARTE RANGÉE OÙ UN AGENT TOURNE ENCORE LE DIT (31/10/2026) : ses listes la gardent, sinon on chercherait l'agent. */
  if (carte.column === 'archived' && signaux.attendReponse) return 'a-vous';
  if (carte.column === 'archived' && signaux.auTravail) return signaux.auCadrage ? 'cadrage' : 'travail';
  if (carte.column === 'archived') {
    return estDeployee({ id: carte.id, column: carte.column, deployedAt: carte.deployedAt, updatedAt: 0 }) ? 'en-ligne' : 'archive';
  }
  /* LE JAUNE NE DIT QUE LA VÉRITÉ (13/11/2026) : un agent ARRÊTÉ sur sa question est « à vous », même si son tour
     vit (DEC-449) ; mais une décision posée en chemin (carte proposée, plan, question écrite en texte) n'allume le
     jaune qu'une fois le travail fini — tant que l'agent travaille, la ligne reste « au travail ». */
  if (signaux.attendReponse || (mere?.enQuestion ?? 0) > 0) return 'a-vous';
  if (signaux.auTravail && signaux.auCadrage && !(mere?.enTravail ?? 0)) return 'cadrage';
  if (signaux.auTravail || (mere?.enTravail ?? 0) > 0) return 'travail';
  /* LE JAUNE EST RÉSERVÉ AUX QUESTIONS (16/11/2026, #2a77) : une compréhension, un plan ou une carte proposée qui
     attend un geste ne fait plus « à vous » — la ligne passe seulement en gras (rendu non lu), et le triangle du
     projet et la cloche la signalent toujours. */
  if ((signaux.questions ?? 0) > 0) return 'a-vous';
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
  /** La dernière modification (`updatedAt`) : la clé de la liste (`liste-par-date.ts`). */
  activite: number;
  nonLue: boolean;
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
 * LA CÉLÉBRATION : une carte dont le rendu (`renduA`) AVANCE sous nos yeux
 * vient de finir — l'agent a rendu son rapport. `avant` vaut `undefined` tant
 * que la carte n'a jamais été vue : un état lu au chargement n'a pas d'« avant »,
 * et aucune célébration ne se rejoue en rechargeant la page ni pour une
 * ancienne carte qui arrive avec son paquet.
 */
export function vientDeRendre(avant: number | undefined, apres: number | undefined): boolean {
  return avant !== undefined && (apres ?? 0) > avant;
}
