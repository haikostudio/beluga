/**
 * LES SOUS-AGENTS (carte « Chefs invisibles et fausse carte », décisions de l'utilisateur du 24/11/2026).
 *
 * Un agent qui en lance d'autres les voit rangés SOUS LUI : dans « En cours » de la colonne de gauche, en arbre à
 * branches en tirets, replié par défaut et déplié quand on est dans l'agent ou l'un de ses sous-agents ; dans sa
 * conversation, en rangée d'onglets façon navigateur sous le fil d'Ariane (le parent d'abord, puis chaque
 * sous-agent). Le lien est le champ générique `parentAgentId` de l'agent : tout agent qui en réveille un autre le
 * pose (les chefs de Communication le reçoivent à leur naissance — chef général → chefs de marque → chefs de projet).
 *
 * Règles pures, sans base : elles lisent les agents déjà chargés par l'écran, sans nouvelle lecture par ligne.
 */
import { SERVICE_DU_DIRECTEUR } from './communication.js';

export interface AgentDeFamille {
  id: string;
  parentAgentId?: string;
  title?: string;
  createdAt?: number;
}

/** Les sous-agents directs de chaque agent, rangés par date de naissance puis par titre (un ordre stable). */
export function enfantsParParent<A extends AgentDeFamille>(agents: readonly A[]): Map<string, A[]> {
  const connus = new Set(agents.map((a) => a.id));
  const parParent = new Map<string, A[]>();
  for (const agent of agents) {
    const parent = agent.parentAgentId;
    if (!parent || parent === agent.id || !connus.has(parent)) continue;
    const liste = parParent.get(parent) ?? [];
    liste.push(agent);
    parParent.set(parent, liste);
  }
  for (const liste of parParent.values())
    liste.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.title ?? '').localeCompare(b.title ?? '') || a.id.localeCompare(b.id));
  return parParent;
}

/**
 * LA RACINE DE LA FAMILLE d'un agent : on remonte les parents CONNUS. Une boucle (donnée abîmée) s'arrête au premier
 * agent déjà vu ; un parent absent des agents chargés laisse l'agent racine de ce qu'on sait.
 */
export function racineDeLaFamille<A extends AgentDeFamille>(agentId: string, agents: readonly A[]): string {
  const parId = new Map(agents.map((a) => [a.id, a]));
  const vus = new Set<string>();
  let ici = agentId;
  while (!vus.has(ici)) {
    vus.add(ici);
    const parent = parId.get(ici)?.parentAgentId;
    if (!parent || !parId.has(parent)) break;
    ici = parent;
  }
  return ici;
}

export interface MembreDeFamille<A> {
  agent: A;
  /** 0 pour la racine, 1 pour ses sous-agents, 2 pour les leurs… */
  profondeur: number;
}

/**
 * LA FAMILLE À PLAT, DANS L'ORDRE DES ONGLETS : la racine d'abord, puis chaque sous-agent suivi de ses propres
 * sous-agents (parcours en profondeur). Vide si la racine n'est pas chargée.
 */
export function familleAPlat<A extends AgentDeFamille>(racineId: string, agents: readonly A[]): MembreDeFamille<A>[] {
  const parId = new Map(agents.map((a) => [a.id, a]));
  const racine = parId.get(racineId);
  if (!racine) return [];
  const enfants = enfantsParParent(agents);
  const sortie: MembreDeFamille<A>[] = [];
  const vus = new Set<string>();
  const visiter = (agent: A, profondeur: number) => {
    if (vus.has(agent.id)) return;
    vus.add(agent.id);
    sortie.push({ agent, profondeur });
    for (const enfant of enfants.get(agent.id) ?? []) visiter(enfant, profondeur + 1);
  };
  visiter(racine, 0);
  return sortie;
}

/** Cet agent a-t-il au moins un sous-agent parmi les agents chargés ? */
export function aDesSousAgents(agentId: string, agents: readonly AgentDeFamille[]): boolean {
  return agents.some((a) => a.parentAgentId === agentId && a.id !== agentId);
}

/**
 * LA BRANCHE EST-ELLE DÉPLIÉE ? Repliée par défaut ; dépliée d'office quand l'agent ouvert est cet agent ou l'un de
 * ses descendants (décision de l'utilisateur, 24/11/2026). `choix` : le geste explicite sur le chevron, qui l'emporte.
 */
export function brancheDepliee(agentId: string, agentOuvert: string | null | undefined, agents: readonly AgentDeFamille[], choix?: boolean): boolean {
  if (choix !== undefined) return choix;
  if (!agentOuvert) return false;
  if (agentOuvert === agentId) return aDesSousAgents(agentId, agents);
  const parId = new Map(agents.map((a) => [a.id, a]));
  const vus = new Set<string>();
  let ici = parId.get(agentOuvert)?.parentAgentId;
  while (ici && !vus.has(ici)) {
    if (ici === agentId) return true;
    vus.add(ici);
    ici = parId.get(ici)?.parentAgentId;
  }
  return false;
}

/**
 * LES RACINES À MONTRER DANS « EN COURS » : pour chaque agent au travail (ou qui attend une réponse), la racine de sa
 * famille, une seule fois, dans l'ordre où leurs agents actifs arrivent. Un sous-agent ne paraît donc JAMAIS en ligne
 * autonome au premier niveau : il est rangé sous sa racine (la « fausse carte » de la capture #34197).
 */
export function racinesEnCours<A extends AgentDeFamille>(actifs: readonly A[], agents: readonly A[]): string[] {
  const racines: string[] = [];
  for (const agent of actifs) {
    const racine = racineDeLaFamille(agent.id, agents);
    if (!racines.includes(racine)) racines.push(racine);
  }
  return racines;
}

/**
 * L'ADRESSE DE LA CONVERSATION D'UN AGENT SANS FICHE (un chef, un sous-agent), dans l'onglet « Agents » de son projet :
 * « projet/<id>/agents/fil/<agent> », sans « # ». La ligne de « En cours », les onglets et la notification y mènent.
 */
export function adresseDuFilDeLAgent(agent: { id: string; projectId: string }): string {
  return `projet/${encodeURIComponent(agent.projectId)}/agents/fil/${encodeURIComponent(agent.id)}`;
}

/**
 * OÙ MÈNE UN AGENT DE SERVICE SANS CARTE : un chef de Communication (général, marque, projet) mène à SA CONVERSATION
 * — l'écran « communication/<marque> » qui le montrait a disparu le 11/11/2026 — ; un agent de campagne et tout autre
 * agent de service gardent l'écran de leur service. `null` pour un agent sans service.
 */
export function adresseDeLAgentDeService(agent: { id: string; projectId: string; service?: { id: string; adresse: string } | null }): string | null {
  if (!agent.service) return null;
  if (agent.service.id === SERVICE_DU_DIRECTEUR && !/\/campagnes\//.test(agent.service.adresse)) return adresseDuFilDeLAgent(agent);
  return agent.service.adresse;
}

/** Un chef de Communication qui vit dans l'arbre des sous-agents (jamais un agent de campagne). */
export function estChefDeLArbre(agent: { service?: { id: string; adresse: string } | null }): boolean {
  return agent.service?.id === SERVICE_DU_DIRECTEUR && !/\/campagnes\//.test(agent.service.adresse);
}
