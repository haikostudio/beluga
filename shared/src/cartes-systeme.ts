/**
 * LES CARTES « SYSTÈME » — CE QUI TRAVAILLE SANS CARTE, PUIS CE QUI VIENT DE FINIR.
 *
 * Une carte Système (cadre violet) montre ce qu'aucune carte du tableau ne
 * porte : un agent sans carte, le dépannage d'une publication, l'agent qui
 * configure une étape, et une MISE EN PRODUCTION.
 *
 * AU TRAVAIL, PUIS 24 HEURES DANS « TERMINÉS » (décision de l'utilisateur du
 * 06/10/2026, qui remplace la lecture du 05/10). Au travail — ou arrêtée sur
 * sa question —, elle est dans « Actifs ». Finie (réussie, tombée ou
 * arrêtée), elle passe dans « Archiver » des Tableaux de bord pendant
 * `DUREE_SYSTEME_TERMINE_MS`, puis disparaît. Plus de point bleu, et elle ne
 * compte plus nulle part : ni chiffre bleu du projet, ni cloche, ni icône de
 * l'application. Les repères de lecture `luA` (migration 103) ne sont plus lus.
 *
 * Règles pures : ni base, ni horloge, ni navigateur — l'instant est un
 * paramètre, elles se testent seules.
 */

/** Combien de temps une carte Système finie reste dans « Archiver ». */
export const DUREE_SYSTEME_TERMINE_MS = 24 * 60 * 60 * 1000;

/** Fini depuis moins de `DUREE_SYSTEME_TERMINE_MS` (une fin dans le futur, horloges décalées, compte aussi). */
export function systemeFiniRecemment(finiA: number | undefined, maintenant: number): boolean {
  if (!finiA) return false;
  return maintenant - finiA < DUREE_SYSTEME_TERMINE_MS;
}

/** Ce que la règle lit d'un agent. */
export interface AgentSysteme {
  cardId?: string;
  role?: string;
  status?: string;
  tourVivantDepuis?: number;
  attendReponse?: boolean;
  endedAt?: number;
}

/**
 * UN AGENT ENCORE ACTIF : au travail, au démarrage, dans un tour vivant, ou
 * arrêté sur sa question — il n'a rien rendu, il reste dans « Actifs ».
 */
export function agentSystemeActif(agent: AgentSysteme): boolean {
  if (agent.status === 'running' || agent.status === 'starting') return true;
  if (agent.tourVivantDepuis !== undefined) return true;
  return agent.attendReponse === true;
}

/**
 * UN AGENT SANS CARTE A-T-IL FINI DEPUIS MOINS DE 24 HEURES ? Sa carte va dans
 * « Archiver ».
 *
 * Jamais un agent posé sur une carte (sa carte porte sa propre pastille), ni
 * un agent encore actif (`agentSystemeActif`), ni l'analyse de nuit : elle
 * finit sans que personne l'attende, et ce qu'elle trouve arrive déjà sous
 * forme de cartes proposées.
 */
export function agentSystemeTermine(agent: AgentSysteme, maintenant: number): boolean {
  if (agent.cardId) return false;
  if (agent.role === 'analysis') return false;
  if (agentSystemeActif(agent)) return false;
  return systemeFiniRecemment(agent.endedAt, maintenant);
}

/** Ce que la règle lit d'une publication. */
export interface PublicationSysteme {
  id: string;
  projectId: string;
  state: string;
  cible?: 'dev' | 'production';
  startedAt: number;
  endedAt?: number;
}

/** Une mise en production FINIE (réussie, tombée ou arrêtée) depuis moins de 24 heures. */
export function miseEnProductionTerminee(run: PublicationSysteme, maintenant: number): boolean {
  if (run.cible !== 'production' || run.state === 'running') return false;
  return systemeFiniRecemment(run.endedAt, maintenant);
}

/**
 * CETTE PUBLICATION A-T-ELLE SA CARTE VIOLETTE ? Seulement une mise en
 * PRODUCTION — un déploiement sur ce serveur a déjà sa barre en tête de
 * « À déployer » —, tant qu'elle tourne, puis 24 heures après sa fin.
 */
export function miseEnProductionAffichee(run: PublicationSysteme, maintenant: number): boolean {
  if (run.cible !== 'production') return false;
  return run.state === 'running' || miseEnProductionTerminee(run, maintenant);
}

/**
 * LES CARTES À POSER : UNE PAR PROJET, la mise en production la plus récente.
 * Une nouvelle remplace donc l'ancienne, même finie depuis moins de 24 heures
 * — le serveur n'en laisse tourner qu'une à la fois par projet. La plus
 * récente d'abord.
 */
export function misesEnProductionAAfficher<T extends PublicationSysteme>(runs: readonly T[], maintenant: number): T[] {
  const parProjet = new Map<string, T>();
  for (const run of runs) {
    if (run.cible !== 'production') continue;
    const retenue = parProjet.get(run.projectId);
    if (!retenue || run.startedAt > retenue.startedAt) parProjet.set(run.projectId, run);
  }
  return [...parProjet.values()]
    .filter((run) => miseEnProductionAffichee(run, maintenant))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * LA TABLE DES MISES EN PRODUCTION DE L'ÉCRAN, après qu'une publication a
 * bougé : elle y entre tant qu'elle a sa carte. Une publication plus ANCIENNE
 * que celle retenue pour son projet ne la remplace jamais (un événement en
 * retard). La sortie au bout de 24 heures se fait à l'AFFICHAGE
 * (`misesEnProductionAAfficher`, relu avec l'heure) : la table peut garder
 * une ligne périmée, elle ne se montre plus.
 */
export function productionsApres<T extends PublicationSysteme>(
  table: Readonly<Record<string, T>>,
  run: T,
  maintenant: number,
): Record<string, T> {
  if (run.cible !== 'production') return table as Record<string, T>;
  const retenue = table[run.projectId];
  if (retenue && retenue.id !== run.id && retenue.startedAt > run.startedAt) return table as Record<string, T>;
  const suite = { ...table };
  if (miseEnProductionAffichee(run, maintenant)) suite[run.projectId] = run;
  else delete suite[run.projectId];
  return suite;
}

/** Une carte Système posée dans « Archiver », avec l'instant qui la range. */
export interface SystemeTermine<T> {
  finiA: number;
  element: T;
}

/**
 * « TERMINÉS » MÊLE LES CARTES ET LES CARTES SYSTÈME, PAR DATE DE FIN, la plus
 * récente en haut. Les entrées de la liste gardent leur ordre (celui du
 * serveur) ; chaque carte Système se glisse avant la première entrée plus
 * ancienne qu'elle. Celles plus anciennes que la dernière entrée CHARGÉE (les
 * paquets de vingt) se posent à la fin : elles restent visibles sans attendre
 * le paquet suivant.
 */
export function entrelacerParDate<E, S>(
  entrees: readonly E[],
  dateDe: (entree: E) => number,
  systeme: readonly SystemeTermine<S>[],
): ({ genre: 'entree'; entree: E } | { genre: 'systeme'; element: S })[] {
  const restants = [...systeme].sort((a, b) => b.finiA - a.finiA);
  const suite: ({ genre: 'entree'; entree: E } | { genre: 'systeme'; element: S })[] = [];
  let i = 0;
  for (const entree of entrees) {
    const date = dateDe(entree);
    while (i < restants.length && restants[i].finiA >= date) suite.push({ genre: 'systeme', element: restants[i++].element });
    suite.push({ genre: 'entree', entree });
  }
  while (i < restants.length) suite.push({ genre: 'systeme', element: restants[i++].element });
  return suite;
}
