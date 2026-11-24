/**
 * LES SOUS-AGENTS, CÔTÉ DÉMON (carte « Chefs invisibles et fausse carte », 24/11/2026).
 *
 * L'écran range un sous-agent sous son parent (`shared/src/sous-agents.ts`) ; il lui faut donc la FAMILLE ENTIÈRE,
 * même les membres au repos, que le premier envoi ne porte pas (seuls les agents au travail ou récents y partent).
 * Deux lectures : la famille d'un agent (sa racine et tous ses descendants), et les agents de service d'un projet
 * (les chefs de Communication qu'il porte), pour l'onglet « Agents ». Chaque chef appartient à UN compte : il ne part
 * qu'à ce compte-là.
 */
import { SERVICE_DU_DIRECTEUR, agentPourLEcran, cleDuRoleDuChef, lireRoleDuChef, type Agent, type CompteUtilisateur } from '@beluga/shared';
import { getDb, getMeta } from './db.js';
import { chefCoupe, compteDuDirecteur } from './directeur-marketing.js';
import * as store from './store.js';

/** Plafond d'une famille : de quoi tenir une rangée d'onglets, jamais une lecture sans fin. */
const PLAFOND_DE_LA_FAMILLE = 200;

/** Cet agent peut-il partir à ce compte ? Un chef ne part qu'à son compte ; tout autre agent suit les droits ordinaires. */
function visiblePour(agent: Agent, compte: Pick<CompteUtilisateur, 'id' | 'role'>): boolean {
  if (agent.service?.id === SERVICE_DU_DIRECTEUR) {
    const proprietaire = compteDuDirecteur(agent.id);
    return !proprietaire || proprietaire === compte.id;
  }
  return compte.role === 'admin';
}

function enfantsDe(ids: readonly string[]): Agent[] {
  if (!ids.length) return [];
  const rows = getDb()
    .prepare(`SELECT data FROM agents WHERE json_extract(data, '$.parentAgentId') IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { data: string }[];
  return rows.map((r) => store.getAgent(JSON.parse(r.data).id)).filter((a): a is Agent => !!a);
}

/** LA FAMILLE D'UN AGENT : sa racine (en remontant les parents), puis tous les descendants de celle-ci. */
export function familleDeLAgent(agentId: string, compte: Pick<CompteUtilisateur, 'id' | 'role'>): Agent[] {
  let racine = store.getAgent(agentId);
  if (!racine) return [];
  const vus = new Set<string>([racine.id]);
  while (racine.parentAgentId && !vus.has(racine.parentAgentId)) {
    const parent = store.getAgent(racine.parentAgentId);
    if (!parent) break;
    vus.add(parent.id);
    racine = parent;
  }
  const famille: Agent[] = [racine];
  const connus = new Set([racine.id]);
  let niveau = [racine.id];
  while (niveau.length && famille.length < PLAFOND_DE_LA_FAMILLE) {
    const enfants = enfantsDe(niveau).filter((a) => !connus.has(a.id));
    for (const enfant of enfants) connus.add(enfant.id);
    famille.push(...enfants);
    niveau = enfants.map((a) => a.id);
  }
  return famille
    .slice(0, PLAFOND_DE_LA_FAMILLE)
    .filter((a) => visiblePour(a, compte))
    .map(agentPourLEcran);
}

/**
 * LES AGENTS DE SERVICE D'UN PROJET : les chefs de Communication (général, marque, projet) qu'il porte — jamais un
 * agent de campagne, qui vit dans Communication. Pour l'onglet « Agents » du projet, à côté des agents personnalisés.
 */
export function chefsDuProjet(projectId: string, compte: Pick<CompteUtilisateur, 'id' | 'role'>): { agents: Agent[]; coupes: string[] } {
  const rows = getDb()
    .prepare(`SELECT id FROM agents WHERE project_id = ? AND json_extract(data, '$.service.id') = ? ORDER BY created_at ASC`)
    .all(projectId, SERVICE_DU_DIRECTEUR) as { id: string }[];
  const agents: Agent[] = [];
  for (const { id } of rows) {
    if (lireRoleDuChef(getMeta(cleDuRoleDuChef(id)))?.niveau === 'campagne') continue;
    const agent = store.getAgent(id);
    if (agent && visiblePour(agent, compte)) agents.push(agentPourLEcran(agent));
  }
  return { agents, coupes: agents.filter((a) => chefCoupe(a.id)).map((a) => a.id) };
}
