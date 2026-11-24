/*
 * LES SOUS-AGENTS À L'ÉCRAN (carte « Chefs invisibles et fausse carte », décisions de l'utilisateur du 24/11/2026,
 * maquette #d4f0a). Un agent qui en lance d'autres — d'abord les chefs de Communication : chef général → chefs de
 * marque → chefs de projet — se voit :
 * - dans « En cours » de la colonne de gauche, en ARBRE à branches en tirets (`BranchesDArbre`, MEM-8171), REPLIÉ par
 *   défaut et DÉPLIÉ quand on est dans l'agent ou l'un de ses sous-agents (`ArbreDesSousAgents`) ;
 * - dans sa conversation, page de l'onglet « Agents » de son projet (« #projet/<id>/agents/fil/<agent> »), avec une
 *   rangée d'ONGLETS FAÇON NAVIGATEUR sous le fil d'Ariane, pleine largeur : le parent d'abord, puis chaque sous-agent
 *   (`PageDuSousAgent`, `OngletsDeNavigateur`).
 * Les règles (racine, ordre, dépliage) sont pures, dans `shared/src/sous-agents.ts` ; la famille entière, membres au
 * repos compris, se lit une fois au démon (`agents.famille`) puis suit le canal.
 */
import * as React from 'react';
import {
  adresseDuFilDeLAgent,
  agentAuTravailALEcran,
  brancheDepliee,
  familleAPlat,
  racineDeLaFamille,
  type Agent,
  type MembreDeFamille,
} from '@beluga/shared';
import { Chat } from '@/components/chat';
import { BranchesDArbre, ATTRIBUT_ICONE_DE_BRANCHE } from '@/components/branches-d-arbre';
import { CranDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { SilhouetteConversation } from '@/components/silhouettes';
import { OngletsDeNavigateur } from '@/components/ui/barre-d-onglets';
import { Bot, ChevronRight, Loader2, MessageCircleQuestion } from '@/components/ui/icones';
import { LienInterne } from '@/components/ui/lien-interne';
import { rendreLesBlocsDuChef } from '@/components/bloc-du-chef';
import { client } from '@/lib/client';
import { ContexteBlocsDeCode } from '@/lib/markdown';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* La famille, lue une fois au démon                                    */
/* ------------------------------------------------------------------ */

/** Quand chaque famille a été lue (par agent demandé) : une relecture au plus par minute, à l'ouverture. */
const famillesLues = new Map<string, number>();

function chargerLaFamille(agentId: string): void {
  const lue = famillesLues.get(agentId);
  if (lue && Date.now() - lue < 60_000) return;
  famillesLues.set(agentId, Date.now());
  void client
    .call<{ agents?: Agent[] }>({ type: 'agents.famille', agentId })
    .then((r) => client.recevoirDesAgents(r?.agents ?? []))
    .catch(() => famillesLues.delete(agentId));
}

/** Les agents chargés, en liste : la source des règles de famille (une seule lecture du magasin). */
function useAgentsCharges(): Agent[] {
  const agents = useApp().agents;
  return React.useMemo(() => Object.values(agents), [agents]);
}

/** LA FAMILLE D'UN AGENT, À PLAT : la racine, puis chaque sous-agent suivi des siens. Vide tant qu'elle n'est pas lue. */
export function useFamilleDeLAgent(agentId: string | null | undefined, lire = true): { racineId: string | null; membres: MembreDeFamille<Agent>[] } {
  const agents = useAgentsCharges();
  React.useEffect(() => {
    if (agentId && lire) chargerLaFamille(agentId);
  }, [agentId, lire]);
  return React.useMemo(() => {
    if (!agentId) return { racineId: null, membres: [] };
    const racineId = racineDeLaFamille(agentId, agents);
    return { racineId, membres: familleAPlat(racineId, agents) };
  }, [agentId, agents]);
}

/* ------------------------------------------------------------------ */
/* L'état d'un membre                                                   */
/* ------------------------------------------------------------------ */

type EtatDuMembre = 'travail' | 'a-vous' | 'repos';

export function etatDuMembre(agent: Agent): EtatDuMembre {
  if (agent.attendReponse) return 'a-vous';
  return agentAuTravailALEcran(agent) ? 'travail' : 'repos';
}

/** Le pictogramme d'état : l'anneau qui tourne au travail, la bulle « à vous » quand il attend, un robot au repos. */
export function IconeDuMembre({ agent, className }: { agent: Agent; className?: string }) {
  const etat = etatDuMembre(agent);
  const classe = cn('h-4 w-4 shrink-0', className);
  if (etat === 'a-vous')
    return <MessageCircleQuestion strokeWidth={1.5} className={cn(classe, 'animate-pulse-soft text-[hsl(var(--cadre-question))] motion-reduce:animate-none')} aria-label="Attend votre réponse" />;
  if (etat === 'travail') return <Loader2 strokeWidth={1.5} className={cn(classe, 'animate-spin text-teinte [animation-duration:1.6s] motion-reduce:animate-none')} aria-label="Au travail" />;
  return <Bot strokeWidth={1.5} className={cn(classe, 'text-faint')} aria-label="Au repos" />;
}

/* ------------------------------------------------------------------ */
/* La page de la conversation                                           */
/* ------------------------------------------------------------------ */

export function PageDuSousAgent({ projectId, agentId, onRetour }: { projectId: string; agentId: string; onRetour: () => void }) {
  const state = useApp();
  const agent = state.agents[agentId] ?? null;
  const [absent, setAbsent] = React.useState(false);
  React.useEffect(() => {
    setAbsent(false);
    void client.chargerAgent(agentId).then((a) => setAbsent(!a));
  }, [agentId]);
  const { membres } = useFamilleDeLAgent(agentId);
  const ancetres = React.useMemo(() => {
    const parId = new Map(Object.values(state.agents).map((a) => [a.id, a]));
    const chaine: Agent[] = [];
    const vus = new Set<string>([agentId]);
    let parent = agent?.parentAgentId ? parId.get(agent.parentAgentId) : undefined;
    while (parent && !vus.has(parent.id)) {
      chaine.unshift(parent);
      vus.add(parent.id);
      parent = parent.parentAgentId ? parId.get(parent.parentAgentId) : undefined;
    }
    return chaine;
  }, [agent?.parentAgentId, agentId, state.agents]);
  const rendreBlocs = React.useMemo(() => rendreLesBlocsDuChef(agentId), [agentId]);
  const onglets = membres.length > 1 ? membres : [];

  return (
    <>
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-sous-agent-retour': '' } }}>
        <CranDuFil onClick={onRetour} dernier={false} data-cran-agents="">
          {t('Agents')}
        </CranDuFil>
        {ancetres.map((a) => (
          <CranDuFil key={a.id} adresse={adresseDuFilDeLAgent(a)} dernier={false} data-cran-parent={a.id}>
            {a.title || t('Agent')}
          </CranDuFil>
        ))}
        <CranDuFil data-cran-sous-agent={agentId}>{agent?.title || t('Agent')}</CranDuFil>
      </SuiteDuFil>
      <div className="flex min-h-0 flex-1 flex-col" data-page-sous-agent={agentId}>
        {onglets.length ? (
          <OngletsDeNavigateur
            repere="sous-agents"
            libelle={t('L’agent et ses sous-agents')}
            valeur={agentId}
            onglets={onglets.map((m) => ({
              cle: m.agent.id,
              libelle: m.agent.title || t('Agent'),
              adresse: adresseDuFilDeLAgent(m.agent),
              icone: <IconeDuMembre agent={m.agent} />,
              attributs: { 'data-etat': etatDuMembre(m.agent), 'data-profondeur': String(m.profondeur) },
            }))}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-sous-agent-conversation={agent?.id ?? 'chargement'}>
          {agent ? (
            <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col [--fond-du-pied:transparent] [--retrait-du-fil:1rem]">
              <ContexteBlocsDeCode.Provider value={rendreBlocs}>
                <Chat agent={agent} projectId={agent.projectId || projectId} sansBarreDEtapes libelleDuChamp={t('Écrire à {v0}…', { v0: agent.title || t('l’agent') })} />
              </ContexteBlocsDeCode.Provider>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[820px] px-4 pt-3">
              {absent ? <p className="text-[13px] text-muted">{t('Cet agent n’existe plus.')}</p> : <SilhouetteConversation bulles={2} />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* L'arbre de « En cours »                                              */
/* ------------------------------------------------------------------ */

/** L'agent ouvert, lu dans l'adresse (« #projet/<id>/agents/fil/<agent> ») : la branche qui le contient se déplie. */
function useAgentOuvertDansLAdresse(): string | null {
  const lire = () => {
    const m = /^#?projet\/[^/]+\/agents\/fil\/([^/?]+)/.exec(window.location.hash);
    return m ? decodeURIComponent(m[1]!) : null;
  };
  const [ouvert, setOuvert] = React.useState<string | null>(lire);
  React.useEffect(() => {
    const relire = () => setOuvert(lire());
    window.addEventListener('hashchange', relire);
    window.addEventListener('popstate', relire);
    return () => {
      window.removeEventListener('hashchange', relire);
      window.removeEventListener('popstate', relire);
    };
  }, []);
  return ouvert;
}

const CLASSE_LIGNE = 'flex h-[34px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-text transition-colors hover:bg-raised sm:h-7';

/**
 * UNE FAMILLE D'AGENTS DANS « EN COURS » : la ligne de la racine, avec son chevron, puis — dépliée — chaque
 * sous-agent dessous, relié par les branches en tirets de la colonne. Un clic sur une ligne ouvre sa conversation ;
 * le chevron seul plie ou déplie. Les sous-agents d'un sous-agent se rangent sous lui, un cran plus loin.
 */
export function ArbreDesSousAgents({ racineId }: { racineId: string }) {
  const { membres } = useFamilleDeLAgent(racineId);
  const agents = useAgentsCharges();
  const ouvert = useAgentOuvertDansLAdresse();
  const racine = membres[0]?.agent ?? null;
  if (!racine) return null;
  return <NoeudDeLArbre agent={racine} membres={membres} agents={agents} ouvert={ouvert} profondeur={0} />;
}

function NoeudDeLArbre({
  agent,
  membres,
  agents,
  ouvert,
  profondeur,
}: {
  agent: Agent;
  membres: MembreDeFamille<Agent>[];
  agents: Agent[];
  ouvert: string | null;
  profondeur: number;
}) {
  const enfants = React.useMemo(() => membres.filter((m) => m.agent.parentAgentId === agent.id).map((m) => m.agent), [membres, agent.id]);
  /* Le geste sur le chevron l'emporte ; il s'oublie quand on change d'agent ouvert (la règle reprend la main). */
  const [choix, setChoix] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => setChoix(undefined), [ouvert]);
  const deplie = enfants.length > 0 && brancheDepliee(agent.id, ouvert, agents, choix);
  const choisi = ouvert === agent.id;
  const etat = etatDuMembre(agent);
  /* LE CHEVRON : à gauche de la racine, comme toute ligne qui se déplie dans la colonne ; à DROITE d'un sous-agent, pour
     que les icônes des frères restent alignées sur leurs branches en tirets. */
  const chevron = enfants.length ? (
    <button
      type="button"
      onClick={() => setChoix(!deplie)}
      aria-expanded={deplie}
      aria-label={deplie ? 'Replier les sous-agents' : 'Déplier les sous-agents'}
      className="flex h-[34px] w-5 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:text-text sm:h-7"
      data-chevron-sous-agents={deplie ? 'deplie' : 'replie'}
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', deplie && 'rotate-90')} />
    </button>
  ) : null;
  const ligne = (
    <div className={cn('relative flex min-w-0 items-center rounded-lg', choisi && 'bg-raised', etat === 'a-vous' && 'contour-de-question')} data-ligne-sous-agent={agent.id} data-etat={etat} data-profondeur={profondeur}>
      {profondeur === 0 ? (chevron ?? <span aria-hidden className="w-5 shrink-0" />) : null}
      <LienInterne
        adresse={adresseDuFilDeLAgent(agent)}
        role="listitem"
        title={etat === 'a-vous' ? t('Attend votre réponse') : etat === 'travail' ? t('Au travail') : t('Au repos')}
        className={cn(CLASSE_LIGNE, 'flex-1 pl-1')}
        data-chef-au-travail={agent.id}
        data-sous-agent={agent.id}
      >
        <span className="flex shrink-0" {...{ [ATTRIBUT_ICONE_DE_BRANCHE]: '' }}>
          <IconeDuMembre agent={agent} />
        </span>
        <span className="min-w-0 flex-1 truncate">{agent.title || t('Agent')}</span>
      </LienInterne>
      {profondeur > 0 ? chevron : null}
    </div>
  );
  if (!deplie) return ligne;
  return (
    <div className="flex min-w-0 flex-col" data-famille-d-agents={agent.id}>
      {ligne}
      {/* LES SOUS-AGENTS, RELIÉS PAR LES BRANCHES EN TIRETS DE LA COLONNE (décision du 24/11/2026). Le conteneur est
          `relative` : le tracé s'y pose et remonte jusqu'à l'icône du parent. */}
      <div role="list" className="relative flex flex-col gap-0.5 pl-6" data-sous-agents-de={agent.id}>
        <BranchesDArbre trouverLeParent={(conteneur) => conteneur.previousElementSibling?.querySelector(`[${ATTRIBUT_ICONE_DE_BRANCHE}]`)} />
        {enfants.map((enfant) => (
          <NoeudDeLArbre key={enfant.id} agent={enfant} membres={membres} agents={agents} ouvert={ouvert} profondeur={profondeur + 1} />
        ))}
      </div>
    </div>
  );
}
