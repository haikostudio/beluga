import * as React from 'react';
import { Loader2, Megaphone, MessageCircleQuestion, UploadCloud } from '@/components/ui/icones';
import { SERVICE_DU_DIRECTEUR, adresseDeLAgentDeService, agentAuTravailALEcran, agentsDeLaBande, estChefDeLArbre, familleDeCouleur, type Agent } from '@beluga/shared';
import { PastilleProjet } from '@/components/pastille-projet';
import { ouvrirUnAgent } from '@/lib/ouvrir-un-agent';
import { BadgeDEtatDAgent, DateDeLAgent, IconeDeLAgent } from '@/components/liste-des-agents';
import { LienInterne } from '@/components/ui/lien-interne';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Un chef de Communication qui travaille, ou qui attend une réponse : il paraît dans les listes d'agents actifs. */
export function chefAuTravail(agent: Agent, projectId?: string): boolean {
  if (agent.cardId || agent.service?.id !== SERVICE_DU_DIRECTEUR) return false;
  if (projectId && agent.projectId !== projectId) return false;
  return agent.attendReponse === true || agentAuTravailALEcran(agent);
}

/** Les chefs de Communication au travail, d'un projet ou de tous, le plus récent d'abord. */
export function useChefsAuTravail(projectId?: string): Agent[] {
  const agents = useApp().agents;
  return React.useMemo(
    () => Object.values(agents).filter((a) => chefAuTravail(a, projectId)).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
    [agents, projectId],
  );
}

/**
 * LES CHEFS DE COMMUNICATION PARMI LES AGENTS ACTIFS (demande de l'utilisateur, 03/11/2026 : « je dois voir les agents
 * actifs de l'outil communication dans le tableau de bord, à gauche dans le projet et en haut dans les agents actifs »).
 * Un chef n'a pas de carte : il ne pouvait donc paraître dans aucune liste, toutes bâties sur les cartes. Ces lignes se
 * posent EN TÊTE des actives, tant qu'il travaille ou attend une réponse — au repos, il disparaît (DEC-452). Un appui
 * ouvre sa conversation dans Communication. Il ne compte ni dans l'avancement ni dans l'arrêt du projet (MEM-5822).
 */
export function LignesDesChefsAuTravail({
  projectId,
  compacte = false,
  horsArbre = false,
}: {
  projectId?: string;
  compacte?: boolean;
  /** « En cours » range les chefs de l'arbre sous leur racine (`ArbreDesSousAgents`) : ici, seuls les agents de campagne. */
  horsArbre?: boolean;
}) {
  const tous = useChefsAuTravail(projectId);
  const chefs = React.useMemo(() => (horsArbre ? tous.filter((a) => !estChefDeLArbre(a)) : tous), [tous, horsArbre]);
  const projets = useApp().projects;
  if (!chefs.length) return null;
  return (
    <>
      {chefs.map((agent) => {
        const attend = agent.attendReponse === true;
        /* SA CONVERSATION (24/11/2026) : « communication/<marque> » ne mène plus à aucun chef depuis le 11/11. */
        const adresse = adresseDeLAgentDeService(agent) ?? 'communication';
        if (compacte)
          return (
            <LienInterne
              key={agent.id}
              adresse={adresse}
              role="listitem"
              title={attend ? t('Attend votre réponse') : t('Au travail')}
              className="flex h-[34px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-text transition-colors hover:bg-raised sm:h-7"
              data-chef-au-travail={agent.id}
              data-etat={attend ? 'a-vous' : 'travail'}
            >
              {attend ? (
                <MessageCircleQuestion strokeWidth={1.5} className="h-4 w-4 shrink-0 animate-pulse-soft motion-reduce:animate-none" aria-hidden />
              ) : (
                <Loader2 strokeWidth={1.5} className="h-4 w-4 shrink-0 animate-spin text-teinte [animation-duration:1.6s] motion-reduce:animate-none" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{agent.title || t('Chef de communication')}</span>
            </LienInterne>
          );
        /* LA LIGNE D'UN CHEF A LA FORME DE TOUTE LIGNE D'AGENT (capture #273b du 03/11/2026) : l'icône de son projet
           (la marque) avec le rond d'état, le titre, le service dessous, l'état et l'heure à droite. */
        const etat = attend ? 'a-vous' : 'travail';
        const projet = agent.projectId ? projets.find((p) => p.id === agent.projectId) : undefined;
        return (
          <div key={agent.id} role="listitem" className={cn('relative flex items-center rounded-lg', attend && 'contour-de-question')}>
            <LienInterne
              adresse={adresse}
              title={attend ? t('Attend votre réponse') : t('Au travail')}
              className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised"
              data-chef-au-travail={agent.id}
              data-etat={etat}
            >
              <IconeDeLAgent etat={etat} projet={projet} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] text-text" data-titre-agent>
                  {agent.title || t('Chef de communication')}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11.5px] text-faint" data-service-du-chef>
                  <Megaphone className="h-3 w-3 shrink-0" aria-hidden />
                  {t('Communication')}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1" data-etat-et-date>
                <BadgeDEtatDAgent etat={etat} famille={familleDeCouleur(etat)} />
                {agent.startedAt ? <DateDeLAgent at={agent.startedAt} /> : null}
              </span>
            </LienInterne>
          </div>
        );
      })}
    </>
  );
}

/**
 * LES AGENTS SANS CARTE AU TRAVAIL DANS LA COLONNE DE GAUCHE (demande du 04/11/2026, captures #ecda et #c14d : « je ne
 * vois pas l'agent de déploiement ou de production une fois ouvert »). L'agent de configuration d'une étape de
 * publication — et tout agent système sans carte (`agentsDeLaBande`) — n'a pas de carte : les listes, bâties sur les
 * cartes, ne pouvaient pas le montrer. Il paraît dans « En cours » et sous son projet tant qu'il travaille ou attend une
 * réponse ; un appui ouvre son tiroir. Les chefs de Communication ont leurs propres lignes (`LignesDesChefsAuTravail`).
 */
export function useAgentsSansCarteAuTravail(projectId?: string): Agent[] {
  const agents = useApp().agents;
  return React.useMemo(
    /* Les agents de SERVICE ont leurs lignes, avec leur travail de fond (`LignesDesTravauxDeService`, 25/11/2026). */
    () => agentsDeLaBande(Object.values(agents)).filter((a) => !a.service && (!projectId || a.projectId === projectId)),
    [agents, projectId],
  );
}

export function LignesDesAgentsSansCarte({ projectId, avecProjet = false }: { projectId?: string; avecProjet?: boolean }) {
  const agents = useAgentsSansCarteAuTravail(projectId);
  const projets = useApp().projects;
  if (!agents.length) return null;
  return (
    <>
      {agents.map((agent) => {
        const attend = agent.attendReponse === true;
        const projet = avecProjet && agent.projectId ? projets.find((p) => p.id === agent.projectId) : undefined;
        return (
          <button
            key={agent.id}
            type="button"
            role="listitem"
            onClick={() => ouvrirUnAgent(agent.id)}
            title={attend ? t('Attend votre réponse') : t('Au travail')}
            className={cn('flex h-[38px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13.5px] text-text transition-colors hover:bg-raised sm:h-8', attend && 'contour-de-question')}
            data-agent-sans-carte={agent.id}
            data-role-agent={agent.role}
            data-etat={attend ? 'a-vous' : 'travail'}
          >
            {attend ? (
              <MessageCircleQuestion strokeWidth={1.5} className="h-4 w-4 shrink-0 animate-pulse-soft motion-reduce:animate-none" aria-hidden />
            ) : agent.role === 'deploy' ? (
              <UploadCloud strokeWidth={1.5} className="h-4 w-4 shrink-0 animate-pulse-soft text-teinte motion-reduce:animate-none" aria-hidden />
            ) : (
              <Loader2 strokeWidth={1.5} className="h-4 w-4 shrink-0 animate-spin text-teinte [animation-duration:1.6s] motion-reduce:animate-none" aria-hidden />
            )}
            {projet ? (
              <span className="flex shrink-0" data-pastille-projet-ligne>
                <PastilleProjet project={projet} taille={14} />
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{agent.title || t('Agent')}</span>
          </button>
        );
      })}
    </>
  );
}
