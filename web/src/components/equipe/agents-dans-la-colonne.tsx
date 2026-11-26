/*
 * LES AGENTS SOUS UN PROJET DE LA COLONNE (carte « Beluga piloté par des agents », 26/11/2026, maquette #1ff2) : sous un
 * projet ou un groupe déplié, ses AGENTS — visage, prénom, métier court, état en formes (point « vous attend », anneau
 * « au travail ») —, ceux qui agissent d'abord, puis « n autres » avec la pile de leurs visages. Un clic ouvre la page
 * de l'agent. Les TÂCHES ne sont plus listées ici : elles vivent dans l'onglet « Tâches » du projet, et ce qui tourne
 * reste en tête de la colonne (« Au travail »). Les lignes des travaux sans carte (chefs de communication, agents de
 * configuration, travaux de fond des services, mises en ligne qui tournent) restent au-dessus : elles disent ce qui
 * tourne VRAIMENT.
 */
import * as React from 'react';
import { miseEnLigneAfficheeActive, sansEchecsRemplaces } from '@beluga/shared';
import { BranchesDArbre } from '@/components/branches-d-arbre';
import { LignesDesAgentsSansCarte, LignesDesChefsAuTravail } from '@/components/chefs-au-travail';
import { LignesDesTravauxDeService, useLignesDesServices } from '@/components/travaux-des-services';
import { LigneDeMiseEnLigne, useMisesEnLigneParDate } from '@/components/mises-en-ligne';
import { EtatEnForme, PileDePortraits, PortraitDAgent } from '@/components/equipe/portrait-d-agent';
import { membresRanges, useEquipesDeLaColonne, type MembreEnLeger } from '@/components/equipe/use-equipe';
import { naviguerVers } from '@/components/ui/lien-interne';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Combien d'agents se montrent avant « n autres » : tous ceux qui agissent, et au moins quatre. */
const AU_MOINS = 4;

function roleCourt(m: MembreEnLeger): string {
  switch (m.role) {
    case 'dev':
      return t('Dév');
    case 'com':
      return t('Com');
    case 'marketing':
      return t('Marketing');
    case 'deploiement':
      return t('Déploiement');
    case 'production':
      return t('Production');
    default:
      return t('Agent');
  }
}

/** L'agent ouvert, lu dans l'adresse (`#projet/<id>/agents/<agent>`). */
function useAgentOuvert(): string | null {
  const lire = () => /\/agents\/([^/?#]+)/.exec(window.location.hash)?.[1] ?? null;
  const [id, setId] = React.useState<string | null>(lire);
  React.useEffect(() => {
    const suivre = () => setId(lire());
    window.addEventListener('hashchange', suivre);
    window.addEventListener('popstate', suivre);
    return () => {
      window.removeEventListener('hashchange', suivre);
      window.removeEventListener('popstate', suivre);
    };
  }, []);
  return id ? decodeURIComponent(id) : null;
}

function iconeDeLaLigneDuDessus(conteneur: HTMLElement): Element | null {
  return conteneur.previousElementSibling?.querySelector('[data-icone-de-branche]') ?? null;
}

export function AgentsDuProjetDansLaColonne({ projectId, onChoisi }: { projectId: string; onChoisi?: () => void }) {
  const tous = useEquipesDeLaColonne();
  const ouvert = useAgentOuvert();
  const services = useLignesDesServices(projectId);
  const { runs } = useMisesEnLigneParDate(projectId);
  const enLigne = React.useMemo(() => sansEchecsRemplaces(runs).filter((run) => miseEnLigneAfficheeActive(run)), [runs]);
  const [tout, setTout] = React.useState(false);
  const membres = React.useMemo(() => membresRanges((tous ?? []).filter((m) => m.projectId === projectId)), [tous, projectId]);
  const agissent = membres.filter((m) => m.etat !== 'repos').length;
  const montres = tout ? membres : membres.slice(0, Math.max(AU_MOINS, agissent));
  const autres = membres.slice(montres.length);
  const ouvrir = (m: MembreEnLeger) => {
    naviguerVers(`projet/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(m.id)}`);
    onChoisi?.();
  };
  return (
    <div role="list" className="relative mb-1.5 ml-3 flex flex-col gap-0.5 pl-4" data-agents-du-projet-colonne={projectId} data-taches-du-projet={projectId}>
      <BranchesDArbre trouverLeParent={iconeDeLaLigneDuDessus} />
      <LignesDesChefsAuTravail projectId={projectId} compacte />
      <LignesDesAgentsSansCarte projectId={projectId} />
      <LignesDesTravauxDeService lignes={services} />
      {enLigne.map((run) => (
        <LigneDeMiseEnLigne key={run.id} run={run} compacte />
      ))}
      {tous === null ? (
        <span className="flex h-8 items-center px-2 text-[12.5px] text-faint" data-agents-en-chargement="">
          …
        </span>
      ) : null}
      {montres.map((m) => (
        <button
          key={m.id}
          type="button"
          role="listitem"
          onClick={() => ouvrir(m)}
          className={cn(
            'relative flex min-h-[38px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-raised sm:min-h-8',
            ouvert === m.id && 'ligne-ouverte-de-colonne',
          )}
          aria-current={ouvert === m.id ? 'page' : undefined}
          data-agent-de-la-colonne={m.id}
          data-role-agent={m.role}
          data-etat-du-membre={m.etat}
        >
          <span data-icone-de-branche="" className="flex shrink-0">
            <PortraitDAgent portrait={m.portrait} couleur={m.couleur} nom={m.nom} taille={22} fond="hsl(var(--fond-zone))" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px]">
            <span className={cn(ouvert === m.id ? 'text-important' : 'text-text')}>{m.nom}</span>
            <span className="text-[12px] text-faint"> · {roleCourt(m)}</span>
          </span>
          <EtatEnForme etat={m.etat} className="mr-1" />
        </button>
      ))}
      {autres.length ? (
        <button
          type="button"
          onClick={() => setTout(true)}
          className="flex min-h-[38px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-faint transition-colors hover:bg-raised hover:text-text sm:min-h-8"
          data-autres-agents={autres.length}
        >
          <PileDePortraits membres={autres} taille={20} max={4} fond="hsl(var(--fond-zone))" />
          <span className="min-w-0 truncate">{autres.length === 1 ? t('1 autre') : t('{v0} autres', { v0: autres.length })}</span>
        </button>
      ) : null}
    </div>
  );
}
