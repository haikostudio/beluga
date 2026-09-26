/**
 * « EN ROUTE » — TOUT CE QUI EST ENTRE LA DEMANDE ET LE DÉPLOIEMENT, TOUS
 * PROJETS CONFONDUS.
 *
 * La page d'accueil de l'application quand aucun projet n'est ouvert, et la
 * destination du bouton des agents, posé sous la navigation de la colonne de
 * gauche. Elle répond à une seule question : « où en est-on ? ». Elle liste les
 * cartes des trois colonnes qui ne sont pas encore rangées — « Demande »,
 * « Travail », « À déployer » — la DERNIÈRE ACTION EN HAUT.
 *
 * LA DERNIÈRE ACTION, C'EST `updatedAt`, dans les DEUX onglets (demande de
 * l'utilisateur, 24.09.2026 : « trier par date/heure de la dernière action sur
 * la carte »). Il bouge quand la carte CHANGE — message envoyé, lancement,
 * tour rendu, changement d'étape, modification, mise en ligne — et JAMAIS sur
 * une simple lecture (`saveCard` garde l'ancien `updatedAt` quand seul le
 * repère de lecture change). L'ancienneté affichée en bas de la carte lit la
 * même date : la liste se lit du plus récent au plus ancien.
 *
 * LE MÊME ORDRE DES DEUX CÔTÉS : le démon trie en SQL sur la clé
 * `updated_at DESC, id DESC`, l'écran re-trie ce qu'il a reçu avec
 * `comparerEnRoute` après chaque événement. Une carte qui bouge remonte donc en
 * tête sans rien redemander au démon.
 *
 * Règle pure : ni base, ni disque, ni navigateur — elle se teste seule.
 */

import type { ColumnKey } from './columns.js';
import { extraitDeNote } from './editeur-riche.js';
import { agentTientSonTour } from './travail-en-cours.js';

/** Les colonnes que la page montre : tout sauf « Archivé ». */
export const COLONNES_EN_ROUTE: readonly ColumnKey[] = ['planned', 'running', 'to_deploy'];

/** Le paquet que la page reçoit à chaque demande — celui du tableau. */
export const CARTES_EN_ROUTE_PAR_PAQUET = 20;

/** Ce que la règle lit d'une carte. */
export interface CarteEnRoute {
  id: string;
  column: string;
  updatedAt: number;
}

/** La carte est-elle encore en route ? */
export function estEnRoute(carte: { column: string }): boolean {
  return (COLONNES_EN_ROUTE as readonly string[]).includes(carte.column);
}

/**
 * LA CLÉ DE TRI des deux onglets, identique à celle du démon : la dernière
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

/** L'ordre de l'onglet « Actif ». */
export function comparerEnRoute(a: CarteEnRoute, b: CarteEnRoute): number {
  return comparerDerniereAction(a, b);
}

/** Les cartes en route, dans l'ordre de la page. Les autres sont écartées. */
export function trierEnRoute<T extends CarteEnRoute>(cartes: readonly T[]): T[] {
  return cartes.filter(estEnRoute).sort(comparerEnRoute);
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
  depannagePublication?: unknown;
}

/** Combien de temps un agent qui vient de finir reste dans la bande. */
export const BANDE_GARDE_UN_FINI_MS = 60_000;

/**
 * LA BANDE DES AGENTS QU'AUCUNE CARTE NE PORTE : la mise en ligne, l'analyse
 * de nuit, le chef. C'est ce que montrait la pile flottante du pied de
 * colonne, qui a disparu : ce qui travaille, ou vient de finir il y a moins
 * d'une minute (l'analyse de nuit exceptée, qui finit sans que personne
 * l'attende).
 *
 * UN AGENT POSÉ SUR UNE CARTE N'Y ENTRE JAMAIS, que sa carte soit affichée ou
 * non (demande de l'utilisateur, 24.09.2026) : comparer aux seules cartes de
 * l'onglet ouvert faisait paraître dans « Terminé » l'agent d'une carte qui
 * travaille dans « Actif ». Son travail se lit sur sa carte.
 */
export function agentsDeLaBande<T extends AgentPourLaBande>(agents: readonly T[], maintenant: number): T[] {
  return agents
    .filter((agent) => {
      if (agent.cardId) return false;
      // Le dépannage d'une publication a SA vignette (`depannagesDeLaBande`).
      if (agent.depannagePublication) return false;
      if (agent.status === 'running' || agent.status === 'starting') return true;
      if (agent.tourVivantDepuis !== undefined) return true;
      return (
        !!agent.endedAt && maintenant - agent.endedAt < BANDE_GARDE_UN_FINI_MS && agent.role !== 'analysis'
      );
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/** Ce que le compteur « en cours » lit d'un agent. */
export interface AgentPourLeCompteur {
  cardId?: string;
  projectId?: string;
  status?: string;
  tourVivantDepuis?: number;
}

/**
 * COMBIEN DE CARTES « ACTIF » SONT AU TRAVAIL EN CE MOMENT — le premier nombre
 * de « 3/19 » dans l'onglet (demande de l'utilisateur, 24.09.2026).
 *
 * Le MÊME prédicat que le témoin orange des cartes (`agentTientSonTour`) :
 * « Au travail » et « Cadrage en cours » comptent tous deux, et le compteur ne
 * peut pas contredire les cartes affichées. Il part des AGENTS, pas des cartes
 * reçues : la liste arrive par paquets de vingt, une carte au travail peut ne
 * pas être encore chargée. Une carte portée par deux agents compte une fois ;
 * un agent sans carte (publication, analyse, chef) ne compte pas.
 *
 * `horsDeLaListe` écarte une carte qu'on SAIT hors de l'onglet (déjà en ligne,
 * rangée) : un cadrage relancé sur une carte archivée ne gonfle pas le compte.
 */
export function nombreEnCoursEnRoute(
  agents: readonly AgentPourLeCompteur[],
  projetsEnService: ReadonlySet<string>,
  horsDeLaListe: (cardId: string) => boolean = () => false,
): number {
  const cartes = new Set<string>();
  for (const agent of agents) {
    if (!agent.cardId || cartes.has(agent.cardId)) continue;
    if (!agent.projectId || !projetsEnService.has(agent.projectId)) continue;
    if (!agentTientSonTour(agent) || horsDeLaListe(agent.cardId)) continue;
    cartes.add(agent.cardId);
  }
  return cartes.size;
}

/* ------------------------------------------------------------------------ */

/**
 * LES DEUX ONGLETS DE LA PAGE. « Actif » est la liste ci-dessus (Demande,
 * Travail, À déployer) ; « Terminé » montre ce qui est DÉJÀ EN LIGNE — c'est
 * là qu'on voit ce que le déploiement automatique a publié sans qu'on y
 * assiste. Les deux suivent le MÊME ordre : la dernière action en haut (la
 * mise en ligne en est une, mais un geste fait après elle compte aussi).
 *
 * Le mot « Terminé » ne recrée AUCUNE colonne du tableau (DEC-046) : il lit
 * les cartes d'« Archivé » qui portent une date de mise en ligne.
 *
 * Depuis le 25.09.2026, la page ne les montre plus en onglets mais en DEUX
 * COLONNES côte à côte (« Actifs », « Terminés ») : `OngletEnRoute` reste la
 * clé de chaque liste — sa réserve, son curseur, sa commande —, dans l'ordre
 * des colonnes.
 */
export type OngletEnRoute = 'actif' | 'termine';
export const ONGLETS_EN_ROUTE: readonly OngletEnRoute[] = ['actif', 'termine'];

/** Ce que la règle lit d'une carte de l'onglet « Terminé ». */
export interface CarteDeployee {
  id: string;
  column: string;
  deployedAt?: number;
  updatedAt: number;
}

/**
 * UNE CARTE EST-ELLE « TERMINÉE » ? Rangée en « Archivé » ET mise en ligne.
 * `deployedAt` dit seul qu'une carte est publiée, jamais sa colonne (PLAN §4) :
 * une carte archivée sans cette date est ABANDONNÉE, elle n'a rien à faire ici.
 * « À déployer » ne peut pas en être : y entrer efface la date (DEC-149), ce
 * qui rend les deux onglets disjoints.
 */
export function estDeployee(carte: CarteDeployee): carte is CarteDeployee & { deployedAt: number } {
  return carte.column === 'archived' && typeof carte.deployedAt === 'number' && carte.deployedAt > 0;
}

/** L'ordre de l'onglet « Terminé » : la dernière action d'abord, comme « Actif ». */
export function comparerDeployees(a: CarteDeployee, b: CarteDeployee): number {
  return comparerDerniereAction(a, b);
}

/** Les cartes terminées, dans l'ordre de l'onglet. Les autres sont écartées. */
export function trierDeployees<T extends CarteDeployee>(cartes: readonly T[]): T[] {
  return cartes.filter(estDeployee).sort(comparerDeployees);
}

/** Le curseur de la page suivante de l'onglet « Terminé ». */
export type CurseurDeployees = CurseurEnRoute;

export function curseurApresDeployee(carte: CarteDeployee): CurseurDeployees {
  const [updatedAt, id] = cleEnRoute(carte);
  return { updatedAt, id };
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
 * au-dessus —, et c'est la famille ENTIÈRE qui choisit sa colonne :
 *   - « Actifs » tant qu'une de ses cartes est en Demande, Travail ou À déployer ;
 *   - « Terminés » quand plus aucune ne l'est et qu'au moins une est en ligne.
 * La mère se range en « Archivé » SANS date de mise en ligne (DEC-258) : elle
 * suit toujours sa pile, elle n'est jamais jugée seule. Une fille abandonnée
 * (archivée sans mise en ligne) ne s'affiche pas.
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

/** La carte s'affiche-t-elle dans sa pile ? En route, en ligne, ou la tête de famille. */
export function membreAffiche(carte: CarteDeFamille): boolean {
  return estEnRoute(carte) || estDeployee(carte) || carte.id === cleDeFamille(carte);
}

/** La colonne d'une famille, jugée sur TOUTES ses cartes ; `null` : elle n'a rien à faire sur la page. */
export function placeDeLaFamille(membres: readonly CarteDeFamille[]): OngletEnRoute | null {
  if (membres.some(estEnRoute)) return 'actif';
  if (membres.some(estDeployee)) return 'termine';
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
 * n'est pas cette colonne est écartée en entier — jamais une fille en ligne
 * dans « Terminés » tant qu'une sœur est encore en route.
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

/**
 * UNE CARTE A BOUGÉ : toute sa famille connue change de colonne avec elle.
 * Rend les deux réserves de la page, la carte comprise, sans jamais laisser une
 * même famille des deux côtés. Une réserve `null` (colonne jamais chargée)
 * reste `null`.
 */
export function repartirLaFamille<T extends CarteDeFamille>(
  actif: Record<string, T> | null,
  termine: Record<string, T> | null,
  carte: T,
): { actif: Record<string, T> | null; termine: Record<string, T> | null } {
  const cle = cleDeFamille(carte);
  const connues = new Map<string, T>();
  for (const reserve of [actif, termine]) {
    for (const autre of Object.values(reserve ?? {})) if (cleDeFamille(autre) === cle) connues.set(autre.id, autre);
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
  return { actif: ranger(actif, place === 'actif'), termine: ranger(termine, place === 'termine') };
}
