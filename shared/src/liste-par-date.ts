/*
 * LA LISTE DES AGENTS PAR DATE (demande du 30/10/2026 : « toutes les tâches les
 * unes sous les autres, par date de dernière modification, archives comprises »).
 *
 * Une seule clé d'ordre, la même des deux côtés : `updatedAt` puis `id`, du plus
 * récent au plus ancien. Le démon lit par curseur (`cartesParDate`, `store.ts`) ;
 * l'écran garde ce qu'il a lu (`LectureParDate`) et y range les cartes qui bougent
 * (`lectureApresCarte`). Trier l'écran sur une autre clé ferait sauter des lignes
 * ou en ferait manquer entre deux paquets.
 */
import { termineeNonOuverte } from './etat-d-agent-en-liste.js';
import { activiteDeLaMere } from './regroupements.js';
import { agentAuTravailALEcran } from './travail-en-cours.js';
import type { ColumnKey } from './columns.js';
import type { Card } from './models.js';

/** Ce qu'un aller-retour avec le démon fait venir pour la liste. */
export const CARTES_PAR_DATE_PAR_PAQUET = 40;
/** Une recherche ou un filtre parcourt plus vite : ses résultats sont rares. */
export const CARTES_PAR_DATE_EN_RECHERCHE = 200;
/** Le flux des tâches sous un projet de la colonne de gauche, et ce qu'ajoute « Voir plus ». */
export const TACHES_DE_LA_COLONNE_PAR_PAQUET = 5;
/** Le plafond de la recherche de la colonne de gauche, tous projets confondus. */
export const CARTES_DE_LA_RECHERCHE_DE_COLONNE = 50;

export interface CurseurParDate {
  updatedAt: number;
  id: string;
}

type CleDeDate = Pick<Card, 'updatedAt' | 'id'>;

/** La plus récente d'abord ; à date égale, le même ordre que le démon (`id DESC`). */
export function comparerParDate(a: CleDeDate, b: CleDeDate): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function trierParDate<C extends CleDeDate>(cartes: readonly C[]): C[] {
  return [...cartes].sort(comparerParDate);
}

/** Ce que la lecture regarde : un projet ou tous, une colonne ou toutes. */
export interface PorteeDeLecture {
  projectId?: string;
  colonne?: ColumnKey;
}

export function cleDeLecture(portee: PorteeDeLecture): string {
  return `${portee.projectId ?? 'tous'}/${portee.colonne ?? 'toutes'}`;
}

export function carteDansLaPortee(card: Pick<Card, 'projectId' | 'column'>, portee: PorteeDeLecture): boolean {
  if (portee.projectId && card.projectId !== portee.projectId) return false;
  if (portee.colonne && card.column !== portee.colonne) return false;
  return true;
}

/** Ce que l'écran a déjà lu d'une portée. */
export interface LectureParDate {
  portee: PorteeDeLecture;
  cartes: Record<string, Card>;
  /** La clé de la dernière carte reçue du démon : la suite se demande sous elle. */
  curseur?: CurseurParDate;
  /** Reste-t-il des cartes sous le curseur ? */
  reste: boolean;
  /** Le premier paquet est arrivé. */
  charge: boolean;
  erreur?: string;
}

/**
 * UNE CARTE A BOUGÉ : elle prend sa place, sans doublon (les cartes sont rangées
 * par identifiant). Une carte sortie de la portée s'en va. Une carte inconnue
 * plus ancienne que le curseur ne s'ajoute pas : elle arrivera avec son paquet, et
 * l'ajouter maintenant laisserait un trou au-dessus d'elle.
 */
export function lectureApresCarte(lecture: LectureParDate, card: Card): LectureParDate {
  const connue = !!lecture.cartes[card.id];
  if (!carteDansLaPortee(card, lecture.portee)) {
    if (!connue) return lecture;
    const cartes = { ...lecture.cartes };
    delete cartes[card.id];
    return { ...lecture, cartes };
  }
  if (!connue && lecture.reste && lecture.curseur && comparerParDate(card, lecture.curseur) > 0) return lecture;
  return { ...lecture, cartes: { ...lecture.cartes, [card.id]: card } };
}

export function lectureSansCarte(lecture: LectureParDate, id: string): LectureParDate {
  if (!lecture.cartes[id]) return lecture;
  const cartes = { ...lecture.cartes };
  delete cartes[id];
  return { ...lecture, cartes };
}

/**
 * LES TÂCHES QUE LA COLONNE DE GAUCHE MONTRE SOUS UN PROJET : tout ce qui n'est ni
 * en ligne ni archivé, plus une carte mère rangée que ses filles font encore vivre
 * (MEM-0597, `etatDeLAgentEnListe` lui donne un état actif), plus une carte rangée
 * terminée depuis moins de trente jours que personne n'a ouverte (`termineeNonOuverte`,
 * 01/11/2026) : elle monte au-dessus du trait des listes, même ancienne. Le démon applique
 * la même règle en SQL (`tachesDeLaColonne`, `store.ts`).
 */
export function estTacheDeLaColonne(
  card: Pick<Card, 'column' | 'cartesFilles' | 'suiviDesFilles'> & Partial<Pick<Card, 'renduA' | 'lastReadAt'>>,
  agentActif = false,
  maintenant = Date.now(),
): boolean {
  if (card.column !== 'archived' || agentActif) return true;
  if (termineeNonOuverte(card, maintenant)) return true;
  if (!card.cartesFilles?.length) return false;
  const mere = activiteDeLaMere(card.suiviDesFilles);
  return mere.enQuestion + mere.enTravail + mere.enAttente > 0;
}

/**
 * LES CARTES OÙ UN AGENT TRAVAILLE OU ATTEND UNE RÉPONSE : aucune liste d'agents ne les perd de vue, même rangées,
 * même d'un atelier, même au-delà du paquet déjà lu (`carteCacheeDesListes`, `tachesDeLaColonne` côté démon).
 */
export function cartesAvecAgentActif(
  agents: Iterable<{ cardId?: string; attendReponse?: boolean } & Parameters<typeof agentAuTravailALEcran>[0]>,
): Set<string> {
  const cartes = new Set<string>();
  for (const agent of agents) {
    if (agent.cardId && (agent.attendReponse || agentAuTravailALEcran(agent))) cartes.add(agent.cardId);
  }
  return cartes;
}

/**
 * LE FLUX SOUS UN PROJET : les `nombre` dernières tâches lues, plus celles qu'on ne
 * doit jamais perdre de vue (`gardee` : la tâche ouverte, celles qui attendent une
 * réponse), chacune à son rang de date. Les tâches gardées s'ajoutent sans repousser
 * les autres : le compte des cinq ne s'en trouve pas réduit.
 */
export function fluxDeLaColonne<L extends { carte: CleDeDate }>(
  lignes: readonly L[],
  lues: ReadonlySet<string>,
  nombre: number,
  gardee: (ligne: L) => boolean,
): L[] {
  const parDate = [...lignes].sort((a, b) => comparerParDate(a.carte, b.carte));
  let restantes = nombre;
  return parDate.filter((ligne) => {
    const dansLeCompte = restantes > 0 && lues.has(ligne.carte.id);
    if (dansLeCompte) restantes -= 1;
    return dansLeCompte || gardee(ligne);
  });
}

/**
 * LA CARTE MÈRE D'UN PROJET RÉUNI SE DÉPLIE SUR SES FILLES (demande du 31/10/2026, « le même concept qu'avant » :
 * l'ancien tableau, `board.tsx`). Dans une liste, une fille dont la mère est AUSSI listée ne s'affiche plus à plat :
 * elle se range sous sa mère (une par projet du groupe). Une fille seule — sa mère hors de la liste, ou la liste d'un
 * projet membre — reste à sa place de date. Aucune carte n'est relue : seules les cartes déjà là sont rangées.
 */
export function sansLesFillesRangees<C extends { id: string; carteMereId?: string }>(cartes: readonly C[]): C[] {
  const presentes = new Set(cartes.map((c) => c.id));
  return cartes.filter((c) => !c.carteMereId || !presentes.has(c.carteMereId));
}

/** Les identifiants des filles d'une mère, dans l'ordre de ses projets ; vide pour une carte ordinaire. */
export function fillesDeLaMere(carte: { cartesFilles?: readonly { projectId: string; cardId: string }[] }): string[] {
  return [...new Set((carte.cartesFilles ?? []).map((f) => f.cardId).filter(Boolean))];
}
