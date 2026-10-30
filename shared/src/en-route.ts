/**
 * « EN ROUTE » — TOUT CE QUI EST ENTRE LA DEMANDE ET LE DÉPLOIEMENT, TOUS
 * PROJETS CONFONDUS.
 *
 * La page d'accueil de l'application quand aucun projet n'est ouvert, et la
 * destination du bouton des agents, posé sous la navigation de la colonne de
 * gauche. Elle répond à une seule question : « où en est-on ? ». TROIS
 * colonnes (08/10/2026) : « Actifs » (Demande, Travail), « Terminer » (tout ce
 * qui est fini — À déployer, mis en ligne, archivé dans son projet — tant que
 * l'utilisateur ne l'a pas rangé) et « Archiver » (ce qu'il a rangé à la main,
 * `rangeeTableauDeBordAt`) — la DERNIÈRE ACTION EN HAUT. Ranger ici ne touche
 * jamais le tableau du projet.
 *
 * LA DERNIÈRE ACTION, C'EST `updatedAt`, dans les TROIS colonnes (demande de
 * l'utilisateur, 24.09.2026 : « trier par date/heure de la dernière action sur
 * la carte »). Il bouge quand la carte CHANGE — message envoyé, lancement,
 * tour rendu, changement d'étape, modification, mise en ligne — et JAMAIS sur
 * une simple lecture (`saveCard` garde l'ancien `updatedAt` quand seul le
 * repère de lecture change). L'ancienneté affichée en bas de la carte lit la
 * même date : la liste se lit du plus récent au plus ancien.
 *
 * LE MÊME ORDRE DES DEUX CÔTÉS : le démon trie en SQL sur la clé
 * `updated_at DESC, id DESC`, l'écran re-trie ce qu'il a reçu avec
 * `comparerDerniereAction` après chaque événement. Une carte qui bouge remonte donc en
 * tête sans rien redemander au démon.
 *
 * Règle pure : ni base, ni disque, ni navigateur — elle se teste seule.
 */

import type { ColumnKey } from './columns.js';
import { extraitDeNote } from './editeur-riche.js';
import { agentSystemeActif, agentSystemeTermine } from './cartes-systeme.js';

/**
 * Les colonnes du tableau que « Actifs » montre : Demande et Travail. « À
 * déployer » a sa propre colonne, « Terminer » (`estATerminer`), et « Archivé »
 * la sienne, « Archiver » (`estRangee`).
 */
export const COLONNES_EN_ROUTE: readonly ColumnKey[] = ['planned', 'running'];

/** Le paquet que la page reçoit à chaque demande — celui du tableau. */
export const CARTES_EN_ROUTE_PAR_PAQUET = 20;

/** Ce que la règle lit d'une carte. */
export interface CarteEnRoute {
  id: string;
  column: string;
  updatedAt: number;
}

/** La carte est-elle encore en route (Demande, Travail) ? */
export function estEnRoute(carte: { column: string }): boolean {
  return (COLONNES_EN_ROUTE as readonly string[]).includes(carte.column);
}

/** Ce que les règles « Terminer » / « Archiver » lisent d'une carte. */
export interface CarteFinie {
  column: string;
  rangeeTableauDeBordAt?: number | null;
}

/** La carte est-elle finie dans son projet (« À déployer » ou « Archivé ») ? */
export function estFinie(carte: { column: string }): boolean {
  return carte.column === 'to_deploy' || carte.column === 'archived';
}

/**
 * LA CARTE EST-ELLE DANS « TERMINER » ? Finie — en attente de publication,
 * mise en ligne ou archivée dans son projet — et PAS ENCORE rangée par
 * l'utilisateur sur cette page (demande de l'utilisateur, 08/10/2026 : « c'est
 * toutes les tâches terminées, qu'elles soient juste terminées, déployées ou
 * autre »). Rien n'en sort tout seul : seul le geste « Tout archiver » ou un
 * glisser vers « Archiver » pose `rangeeTableauDeBordAt` — et seulement pour
 * une carte déjà archivée dans son projet (`peutEtreRangee`).
 */
export function estATerminer(carte: CarteFinie): boolean {
  return estFinie(carte) && !carte.rangeeTableauDeBordAt;
}

/**
 * La carte est-elle dans « Archiver » ? Finie ET rangée par l'utilisateur sur
 * cette page. Ce rangement ne change PAS la colonne de son projet : une carte
 * « À déployer » rangée ici reste dans le lot de la prochaine publication.
 * `estDeployee` ne dit que le badge.
 */
export function estRangee(carte: CarteFinie): boolean {
  return estFinie(carte) && !!carte.rangeeTableauDeBordAt;
}

/**
 * LA CLÉ DE TRI des trois colonnes, identique à celle du démon : la dernière
 * action, puis l'identifiant pour départager deux cartes touchées au même
 * instant.
 */
export function cleEnRoute(carte: { id: string; updatedAt: number }): [number, string] {
  return [carte.updatedAt, carte.id];
}

/** Dernière action d'abord ; à instant égal, le plus grand identifiant, comme en SQL. */
function comparerDerniereAction(a: { id: string; updatedAt: number }, b: { id: string; updatedAt: number }): number {
  const [ua, ia] = cleEnRoute(a);
  const [ub, ib] = cleEnRoute(b);
  if (ua !== ub) return ub - ua;
  return ia < ib ? 1 : ia > ib ? -1 : 0;
}

/** Le curseur de la page suivante : la clé de la dernière carte reçue. */
export interface CurseurEnRoute {
  updatedAt: number;
  id: string;
}

export function curseurApres(carte: CarteEnRoute): CurseurEnRoute {
  const [updatedAt, id] = cleEnRoute(carte);
  return { updatedAt, id };
}

/** Ce que la règle lit d'un agent. */
export interface AgentPourLaBande {
  id: string;
  cardId?: string;
  role?: string;
  status?: string;
  endedAt?: number;
  startedAt?: number;
  tourVivantDepuis?: number;
  attendReponse?: boolean;
  depannagePublication?: unknown;
  /** La réparation silencieuse d'une étape de publication : jamais de vignette, elle se lit dans le fil de l'étape. */
  reparationPublication?: unknown;
  /** L'Assistant Beluga : stocké avec le rôle « deploy », il n'est PAS une mise en ligne. */
  assistantGlobal?: boolean;
}

/**
 * Combien de temps le BANDEAU de mise en production garde la mention
 * « terminé » d'un agent de configuration (`etatDeLInitialisation`). Les cartes
 * Système, elles, ne se règlent pas sur ce délai : finies, elles passent
 * 24 heures dans « Archiver » (`DUREE_SYSTEME_TERMINE_MS`).
 */
export const BANDE_GARDE_UN_FINI_MS = 60_000;

/**
 * LA BANDE DES AGENTS QU'AUCUNE CARTE NE PORTE, EN TÊTE D'« ACTIFS » : la mise
 * en ligne, l'analyse de nuit, le chef — tant qu'ils travaillent ou attendent
 * une réponse (`agentSystemeActif`). Finis, ils passent dans « Archiver »
 * (`agentsTerminesDeLaBande`, 06/10/2026).
 *
 * UN AGENT POSÉ SUR UNE CARTE N'Y ENTRE JAMAIS, que sa carte soit affichée ou
 * non (demande de l'utilisateur, 24.09.2026) : comparer aux seules cartes de
 * l'onglet ouvert faisait paraître dans « Terminé » l'agent d'une carte qui
 * travaille dans « Actif ». Son travail se lit sur sa carte.
 */
export function agentsDeLaBande<T extends AgentPourLaBande>(agents: readonly T[]): T[] {
  return agents
    .filter((agent) => {
      if (agent.cardId) return false;
      // L'assistant n'a pas de carte et n'est jamais une carte Système.
      if (agent.assistantGlobal) return false;
      // Le dépannage d'une publication a SA vignette (`depannagesDeLaBande`).
      if (agent.depannagePublication) return false;
      if (agent.reparationPublication) return false;
      return agentSystemeActif(agent);
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * LES AGENTS SANS CARTE FINIS DEPUIS MOINS DE 24 HEURES : leur carte Système
 * dans « Archiver » (`agentSystemeTermine` — l'analyse de nuit exceptée), la
 * plus récente fin d'abord.
 */
export function agentsTerminesDeLaBande<T extends AgentPourLaBande>(agents: readonly T[], maintenant: number): T[] {
  return agents
    .filter(
      (agent) => !agent.assistantGlobal && !agent.depannagePublication && !agent.reparationPublication && agentSystemeTermine(agent, maintenant),
    )
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
}

/* ------------------------------------------------------------------------ */

/**
 * LES TROIS COLONNES DE LA PAGE (demande de l'utilisateur, 08/10/2026, qui
 * remplace « Actifs » / « Terminés ») :
 *   - `actif` — « Actifs » : Demande et Travail (`estEnRoute`) ;
 *   - `terminer` — « Terminer » : tout ce qui est fini (À déployer, mis en
 *     ligne, archivé dans son projet) et pas encore rangé ici (`estATerminer`) ;
 *   - `archive` — « Archiver » : ce que l'utilisateur a rangé ici, en bloc ou
 *     au glisser (`estRangee`). Rien n'y entre tout seul.
 * Les trois suivent le MÊME ordre : la dernière action en haut.
 *
 * Ces mots ne recréent AUCUNE colonne du tableau (DEC-046) : ils lisent les
 * colonnes du modèle, dont les clés ne changent pas. `OngletEnRoute` est la
 * clé de chaque liste — sa réserve, son curseur, sa commande —, dans l'ordre
 * des colonnes.
 */
export type OngletEnRoute = 'actif' | 'terminer' | 'archive';
export const ONGLETS_EN_ROUTE: readonly OngletEnRoute[] = ['actif', 'terminer', 'archive'];

/** Ce que la règle lit d'une carte d'une colonne de la page. */
export interface CarteDeployee {
  id: string;
  column: string;
  deployedAt?: number;
  updatedAt: number;
  rangeeTableauDeBordAt?: number | null;
}

/**
 * UNE CARTE EST-ELLE EN LIGNE ? Archivée dans son projet ET mise en ligne :
 * c'est ce qui pose le badge « en ligne » dans « Terminer » et « Archiver ». `deployedAt` dit seul
 * qu'une carte est publiée, jamais sa colonne (PLAN §4). « À déployer » ne peut
 * pas en être : y entrer efface la date (DEC-149).
 */
export function estDeployee(carte: CarteDeployee): carte is CarteDeployee & { deployedAt: number } {
  return carte.column === 'archived' && typeof carte.deployedAt === 'number' && carte.deployedAt > 0;
}

/**
 * UNE CARTE PEUT-ELLE ÊTRE RANGÉE SUR LA PAGE ? Seulement si elle est déjà
 * « Archivée » dans son projet (demande de l'utilisateur : l'archivage ne se
 * fait que sur des cartes déployées, pas sur les autres). On teste la colonne,
 * pas `estDeployee` : les cartes d'agents sans code (démon, attitrés, mères,
 * ajouts de moteur) sont archivées SANS date de mise en ligne et resteraient
 * coincées dans « Terminer ». Une carte « À déployer » n'est pas rangeable.
 */
export function peutEtreRangee(carte: { column: string }): boolean {
  return carte.column === 'archived';
}

/**
 * LE RANGEMENT D'UNE CARTE QUE L'ON DÉPLACE. Le seul endroit qui dit ce que
 * devient `rangeeTableauDeBordAt` quand une carte change de colonne :
 *
 *  - archivée À LA MAIN (`rangeeA` donné : l'instant du geste), elle va tout
 *    de suite dans « Archiver » de la page — un geste explicite, le menu de la
 *    carte, la fiche, le glisser ou les actions de masse. Une carte déjà
 *    rangée garde sa date ;
 *  - archivée par un chemin AUTOMATIQUE (mise en ligne, agent sans code :
 *    `rangeeA` absent), elle reste dans « Terminer » comme avant ;
 *  - une carte qui QUITTE « Archivé » perd son rangement : remise « À
 *    déployer », elle est finie sans être rangeable (`peutEtreRangee`), donc
 *    elle doit repasser par « Terminer ».
 *
 * Rend la valeur à écrire ; `undefined` veut dire « la clé disparaît ».
 */
export function rangementApresDeplacement(
  carte: { column: string; rangeeTableauDeBordAt?: number | null },
  cible: string,
  rangeeA?: number,
): number | undefined {
  if (carte.column === 'archived' && cible !== 'archived') return undefined;
  const actuel = carte.rangeeTableauDeBordAt || undefined;
  if (cible === 'archived' && rangeeA !== undefined) return actuel ?? rangeeA;
  return actuel;
}

/*
 * LE DÉBUT DE LA DEMANDE, SOUS LE TITRE DE CHAQUE CARTE (demande de
 * l'utilisateur, 24.09.2026 : « je veux le début du texte de la demande »).
 *
 * La description d'une carte n'est écrite que par un cadrage qui CADRE : un
 * tour qui se contente de RÉPONDRE la laisse vide, et la carte n'affichait
 * rien sous son titre. Le texte montré est donc le PREMIER message écrit par
 * l'utilisateur dans la conversation de la carte — le premier, jamais le
 * dernier : une reprise après panne recopie la demande sous un séparateur
 * (DEC-036), et une relance « tu peux lancer le travail » ne dit rien de la
 * carte. Sans message (surveillance, service extérieur), la description reste.
 */

/** Les signes gardés : deux lignes pleines de la carte, et un peu de marge. */
export const LONGUEUR_DEBUT_DE_DEMANDE = 280;

/** Le texte d'un message, sans ses pastilles « [fichier: …] », aplati et coupé. */
export function debutDeLaDemande(contenu: string | null | undefined, longueur = LONGUEUR_DEBUT_DE_DEMANDE): string {
  return extraitDeNote((contenu ?? '').replace(/\[fichier:[^\]]*\]/g, ' '), longueur);
}

/** Un premier message utilisateur trouvé pour une carte (un par agent de la carte). */
export interface PremierMessageDeCarte {
  carte: string;
  creeA: number;
  contenu: string | null;
}

/**
 * PAR CARTE, LE PLUS ANCIEN des premiers messages de ses agents (le cadrage,
 * puis la tâche qui le prolonge, ou la conversation rattachée). Un message
 * vide une fois nettoyé — une image seule — ne compte pas : le suivant prend
 * sa place, sinon la carte garde sa description.
 */
export function debutsDesDemandes(messages: readonly PremierMessageDeCarte[]): Record<string, string> {
  const retenus = new Map<string, { creeA: number; texte: string }>();
  for (const message of messages) {
    const texte = debutDeLaDemande(message.contenu);
    if (!texte) continue;
    const deja = retenus.get(message.carte);
    if (!deja || message.creeA < deja.creeA) retenus.set(message.carte, { creeA: message.creeA, texte });
  }
  return Object.fromEntries([...retenus].map(([carte, { texte }]) => [carte, texte]));
}

/* ------------------------------------------------------------------------ */

/*
 * LES CARTES D'UNE DEMANDE COMMUNE S'EMPILENT (demande de l'utilisateur,
 * 25.09.2026 : « quand il y a une tâche d'un groupe de sous-projets, il faut
 * empiler les cartes […] ça doit éviter d'avoir des sous-cartes dans Terminé
 * alors que la tâche principale n'est pas terminée »).
 *
 * Une FAMILLE, c'est la carte mère d'un projet réuni et ses filles, une par
 * projet touché (DEC-258) ; une carte seule est sa propre famille. La page
 * « Tableaux de bord » montre chaque famille en UNE entrée — une PILE, la mère
 * au-dessus —, et c'est la famille ENTIÈRE qui choisit sa colonne, la plus à
 * gauche que ses cartes réclament :
 *   - « Actifs » tant qu'une de ses cartes est en Demande ou Travail ;
 *   - sinon « Terminer » tant qu'une est finie sans être rangée ici ;
 *   - sinon « Archiver » (toutes rangées ici par l'utilisateur).
 * La mère se range en « Archivé » SANS date de mise en ligne (DEC-258) : elle
 * suit toujours sa pile, elle n'est jamais jugée seule. Toutes les cartes de
 * la famille s'affichent dans sa pile, une fille abandonnée comprise.
 *
 * Le démon applique la MÊME règle en SQL (`famillesParDerniereAction`) : une
 * famille compte pour UNE dans les nombres et dans les paquets, et sa clé de
 * tri est la dernière action de la plus récente de ses cartes affichées.
 */

/** Ce que la règle lit d'une carte pour la ranger dans sa famille. */
export interface CarteDeFamille extends CarteDeployee {
  carteMereId?: string;
}

/** La clé d'une famille : l'identifiant de la mère (une carte seule est sa propre mère). */
export function cleDeFamille(carte: { id: string; carteMereId?: string }): string {
  return carte.carteMereId ?? carte.id;
}

/** La carte s'affiche-t-elle dans sa pile ? Dans une des trois colonnes, ou la tête de famille. */
export function membreAffiche(carte: CarteDeFamille): boolean {
  return estEnRoute(carte) || estATerminer(carte) || estRangee(carte) || carte.id === cleDeFamille(carte);
}

/** La colonne d'une famille, jugée sur TOUTES ses cartes ; `null` : elle n'a rien à faire sur la page. */
export function placeDeLaFamille(membres: readonly CarteDeFamille[]): OngletEnRoute | null {
  if (membres.some(estEnRoute)) return 'actif';
  if (membres.some(estATerminer)) return 'terminer';
  if (membres.some(estRangee)) return 'archive';
  return null;
}

/** Une entrée de colonne : une pile, ou une carte seule (pile d'une carte). */
export interface PileEnRoute<T> {
  cle: string;
  /** La mère d'abord, puis la dernière action d'abord. */
  cartes: T[];
  /** La dernière action de la plus récente : la clé de tri de la pile. */
  updatedAt: number;
}

/**
 * LES PILES D'UNE COLONNE, dans l'ordre de la page. Une famille dont la place
 * n'est pas cette colonne est écartée en entier — jamais une fille rangée
 * dans « Archiver » tant qu'une sœur est encore en route ou à publier.
 */
export function pilesEnRoute<T extends CarteDeFamille>(cartes: readonly T[], onglet: OngletEnRoute): PileEnRoute<T>[] {
  const familles = new Map<string, T[]>();
  for (const carte of cartes) {
    const cle = cleDeFamille(carte);
    const liste = familles.get(cle);
    if (liste) liste.push(carte);
    else familles.set(cle, [carte]);
  }
  const piles: PileEnRoute<T>[] = [];
  for (const [cle, membres] of familles) {
    if (placeDeLaFamille(membres) !== onglet) continue;
    const affiches = membres
      .filter(membreAffiche)
      .sort((a, b) => (a.id === cle ? -1 : b.id === cle ? 1 : comparerDerniereAction(a, b)));
    if (!affiches.length) continue;
    piles.push({ cle, cartes: affiches, updatedAt: Math.max(...affiches.map((c) => c.updatedAt)) });
  }
  return piles.sort((a, b) => comparerDerniereAction({ id: a.cle, updatedAt: a.updatedAt }, { id: b.cle, updatedAt: b.updatedAt }));
}

/** Le curseur de la page suivante, en familles : la clé de la dernière pile reçue. */
export function curseurApresPile(pile: { cle: string; updatedAt: number }): CurseurEnRoute {
  return { updatedAt: pile.updatedAt, id: pile.cle };
}

/** Les réserves des trois colonnes ; `null` : une colonne jamais chargée. */
export type ReservesEnRoute<T> = Record<OngletEnRoute, Record<string, T> | null>;

/**
 * UNE CARTE A BOUGÉ : toute sa famille connue change de colonne avec elle.
 * Rend les trois réserves de la page, la carte comprise, sans jamais laisser
 * une même famille dans deux colonnes. Une réserve `null` (colonne jamais
 * chargée) reste `null`.
 */
export function repartirLaFamille<T extends CarteDeFamille>(reserves: ReservesEnRoute<T>, carte: T): ReservesEnRoute<T> {
  const cle = cleDeFamille(carte);
  const connues = new Map<string, T>();
  for (const onglet of ONGLETS_EN_ROUTE) {
    for (const autre of Object.values(reserves[onglet] ?? {})) if (cleDeFamille(autre) === cle) connues.set(autre.id, autre);
  }
  connues.delete(carte.id);
  connues.set(carte.id, carte);
  const membres = [...connues.values()];
  const place = placeDeLaFamille(membres);
  const ranger = (reserve: Record<string, T> | null, ici: boolean) => {
    if (!reserve) return reserve;
    const suite = { ...reserve };
    for (const id of connues.keys()) delete suite[id];
    if (ici) for (const membre of membres) if (membreAffiche(membre)) suite[membre.id] = membre;
    return suite;
  };
  return {
    actif: ranger(reserves.actif, place === 'actif'),
    terminer: ranger(reserves.terminer, place === 'terminer'),
    archive: ranger(reserves.archive, place === 'archive'),
  };
}
