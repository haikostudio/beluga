/**
 * LES CARTES « SYSTÈME » — CE QUI TRAVAILLE SANS CARTE, ET CE QUI RESTE À LIRE.
 *
 * Une carte Système (cadre violet) montre ce qu'aucune carte du tableau ne
 * porte : un agent sans carte, le dépannage d'une publication, l'agent qui
 * configure une étape, et — depuis le 05/10/2026 — une MISE EN PRODUCTION.
 * Deux mises en production tournaient ensemble sans qu'aucune carte ne le
 * dise : seul le bandeau du bas du tableau de CHAQUE projet les montrait.
 *
 * ELLES ATTENDENT D'ÊTRE LUES (décision de l'utilisateur, même jour). Une carte
 * Système terminée s'effaçait seule au bout d'une minute, sans point bleu :
 * elle reste désormais affichée, point bleu allumé, jusqu'à ce qu'on l'ouvre
 * ou qu'on clique sur le point — exactement comme une carte ordinaire
 * (`carteNonLue`, `travail-rendu.ts`). Et elle COMPTE dans le chiffre bleu du
 * projet, la cloche et l'icône de l'application.
 *
 * Règles pures : ni base, ni horloge, ni navigateur — elles se testent seules.
 */

/** Ce que la lecture regarde : l'instant de la fin, et celui de la dernière consultation. */
export interface LectureSysteme {
  finiA?: number;
  luA?: number;
}

/** Terminé APRÈS la dernière consultation : il reste quelque chose à lire. */
export function systemeNonLu(entree: LectureSysteme): boolean {
  const fin = entree.finiA ?? 0;
  if (!fin) return false;
  return fin > (entree.luA ?? 0);
}

/** Ce que la règle lit d'un agent. */
export interface AgentSysteme {
  cardId?: string;
  role?: string;
  status?: string;
  tourVivantDepuis?: number;
  attendReponse?: boolean;
  endedAt?: number;
  luA?: number;
}

/**
 * UN AGENT SANS CARTE A-T-IL FINI SANS QU'ON L'AIT LU ?
 *
 * Jamais un agent posé sur une carte (sa carte porte sa propre pastille), ni
 * un agent encore au travail ou arrêté sur sa question (il n'a rien rendu), ni
 * l'analyse de nuit : elle finit sans que personne l'attende, et ce qu'elle
 * trouve arrive déjà sous forme de cartes proposées.
 */
export function agentSystemeNonLu(agent: AgentSysteme): boolean {
  if (agent.cardId) return false;
  if (agent.role === 'analysis') return false;
  if (agent.status === 'running' || agent.status === 'starting') return false;
  if (agent.tourVivantDepuis !== undefined || agent.attendReponse === true) return false;
  return systemeNonLu({ finiA: agent.endedAt, luA: agent.luA });
}

/** Ce que la règle lit d'une publication. */
export interface PublicationSysteme {
  id: string;
  projectId: string;
  state: string;
  cible?: 'dev' | 'production';
  startedAt: number;
  endedAt?: number;
  luA?: number;
}

/** Une mise en production TERMINÉE (réussie, tombée ou arrêtée) que personne n'a consultée. */
export function miseEnProductionNonLue(run: PublicationSysteme): boolean {
  if (run.cible !== 'production' || run.state === 'running') return false;
  return systemeNonLu({ finiA: run.endedAt, luA: run.luA });
}

/**
 * CETTE PUBLICATION A-T-ELLE SA CARTE VIOLETTE ? Seulement une mise en
 * PRODUCTION — un déploiement sur ce serveur a déjà sa barre en tête de
 * « À déployer » —, tant qu'elle tourne, puis tant qu'elle n'a pas été lue.
 */
export function miseEnProductionAffichee(run: PublicationSysteme): boolean {
  if (run.cible !== 'production') return false;
  return run.state === 'running' || miseEnProductionNonLue(run);
}

/**
 * LES CARTES À POSER : UNE PAR PROJET, la mise en production la plus récente.
 * Une nouvelle remplace donc l'ancienne restée non lue — le serveur n'en laisse
 * tourner qu'une à la fois par projet. La plus récente d'abord.
 */
export function misesEnProductionAAfficher<T extends PublicationSysteme>(runs: readonly T[]): T[] {
  const parProjet = new Map<string, T>();
  for (const run of runs) {
    if (run.cible !== 'production') continue;
    const retenue = parProjet.get(run.projectId);
    if (!retenue || run.startedAt > retenue.startedAt) parProjet.set(run.projectId, run);
  }
  return [...parProjet.values()].filter(miseEnProductionAffichee).sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * LA TABLE DES MISES EN PRODUCTION DE L'ÉCRAN, après qu'une publication a
 * bougé : elle y entre tant qu'elle a sa carte, elle en sort dès qu'elle est
 * lue. Une publication plus ANCIENNE que celle retenue pour son projet ne la
 * remplace jamais (un événement en retard).
 */
export function productionsApres<T extends PublicationSysteme>(
  table: Readonly<Record<string, T>>,
  run: T,
): Record<string, T> {
  if (run.cible !== 'production') return table as Record<string, T>;
  const retenue = table[run.projectId];
  if (retenue && retenue.id !== run.id && retenue.startedAt > run.startedAt) return table as Record<string, T>;
  const suite = { ...table };
  if (miseEnProductionAffichee(run)) suite[run.projectId] = run;
  else delete suite[run.projectId];
  return suite;
}

/** Une carte Système non lue, telle que les compteurs la lisent. */
export interface SystemeNonLu {
  projectId: string;
  genre: 'agent' | 'production';
  /** L'identifiant de l'agent, ou celui du projet de la mise en production. */
  id: string;
  finiA: number;
}

/** Combien de cartes Système non lues par projet. */
export function systemeNonLuParProjet(entrees: readonly SystemeNonLu[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const entree of entrees) compte[entree.projectId] = (compte[entree.projectId] ?? 0) + 1;
  return compte;
}

/** Le chiffre bleu d'un projet : ses cartes non lues PLUS ses cartes Système non lues. */
export function additionnerLesRendus(
  cartes: Readonly<Record<string, number>>,
  systeme: Readonly<Record<string, number>>,
): Record<string, number> {
  const total: Record<string, number> = { ...cartes };
  for (const [projet, n] of Object.entries(systeme)) total[projet] = (total[projet] ?? 0) + n;
  return total;
}

/**
 * CE QUE LE CHIFFRE BLEU D'UN PROJET OUVRE : le rendu le plus RÉCENT, carte
 * ordinaire ou carte Système. À instant égal la carte ordinaire l'emporte.
 */
export function renduLePlusRecent(
  carte: { cardId: string; renduA: number } | null,
  systeme: readonly SystemeNonLu[],
): { cardId: string } | { agentId: string } | { production: string } | null {
  let meilleur: SystemeNonLu | null = null;
  for (const entree of systeme) if (!meilleur || entree.finiA > meilleur.finiA) meilleur = entree;
  if (carte && (!meilleur || carte.renduA >= meilleur.finiA)) return { cardId: carte.cardId };
  if (!meilleur) return null;
  return meilleur.genre === 'agent' ? { agentId: meilleur.id } : { production: meilleur.id };
}
