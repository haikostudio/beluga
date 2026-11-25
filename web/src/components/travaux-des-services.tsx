/*
 * LES TRAVAUX DES SERVICES DANS LA COLONNE DE GAUCHE (carte « Agents des services dans la colonne », 25/11/2026,
 * maquette #cdea). Dans « En cours » et sous chaque projet : une ligne par agent de service au travail et par travail
 * de fond qui tourne — étude marketing, export du Studio, audit SEO + GEO, sauvegarde. L'icône du projet (avec son
 * rond d'état, comme une tâche), la nature du travail et son avancement ; un clic mène au service (vrai lien).
 * FINI : la ligne reste EN GRAS, coche au rond, jusqu'à l'ouverture de l'écran du service (`useTravauxVusALOuverture`).
 * Un agent qui répond et le travail du même écran ne font qu'UNE ligne (`lignesDesServices`).
 */
import * as React from 'react';
import {
  SERVICE_DU_DIRECTEUR,
  agentsDeLaBande,
  avancementDuTravail,
  lignesDesServices,
  travauxVusALEcran,
  type AgentDuService,
  type LigneDeService,
  type NatureDuTravail,
  type Project,
} from '@beluga/shared';
import { IconeDeLAgent } from '@/components/liste-des-agents';
import { LienInterne } from '@/components/ui/lien-interne';
import { adresseDEcranDeLAgentDeService } from '@/lib/ouvrir-un-agent';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** La nature d'un travail, en mots courants. */
function natureLisible(nature: NatureDuTravail): string {
  switch (nature) {
    case 'etude':
      return t('Étude marketing');
    case 'pre-diagnostic':
      return t('Pré-diagnostic marketing');
    case 'video':
      return t('Vidéo du Studio');
    case 'image':
      return t('Image du Studio');
    case 'audit':
      return t('Audit SEO + GEO');
    case 'sauvegarde':
      return t('Sauvegarde');
  }
}

/** Les agents de service sans carte qui travaillent ou attendent une réponse (hors chefs de Communication). */
function agentsDeService(agents: ReturnType<typeof useApp>['agents'], projectId?: string): AgentDuService[] {
  return agentsDeLaBande(Object.values(agents))
    .filter((a) => !!a.service && a.service.id !== SERVICE_DU_DIRECTEUR && (!projectId || a.projectId === projectId))
    .map((a) => ({ id: a.id, projectId: a.projectId, title: a.title, attendReponse: a.attendReponse, startedAt: a.startedAt, service: { id: a.service!.id, adresse: a.service!.adresse } }));
}

/** Les lignes des services, d'un projet ou de tous. Lit la liste une fois, puis la suit en direct (`travaux.services`). */
export function useLignesDesServices(projectId?: string): LigneDeService[] {
  const state = useApp();
  const charge = state.travauxDesServices !== null;
  React.useEffect(() => {
    if (state.pret && !charge) void client.chargerLesTravauxDesServices();
  }, [state.pret, charge]);
  return React.useMemo(() => {
    const visibles = new Set(state.projects.filter((p) => !p.archived).map((p) => p.id));
    const travaux = (state.travauxDesServices ?? []).filter((tr) => visibles.has(tr.projectId) && (!projectId || tr.projectId === projectId));
    const agents = agentsDeService(state.agents, projectId).filter((a) => visibles.has(a.projectId));
    return lignesDesServices(agents, travaux, adresseDEcranDeLAgentDeService);
  }, [state.travauxDesServices, state.agents, state.projects, projectId]);
}

function LigneDUnService({ ligne, projet }: { ligne: LigneDeService; projet?: Project }) {
  const agent = ligne.agent;
  const travail = ligne.genre === 'travail' ? ligne.travail : null;
  const fini = travail?.etat === 'termine';
  const attend = !fini && agent?.attendReponse === true;
  const adresse = travail ? travail.adresse : ligne.genre === 'agent' ? ligne.adresse : '';
  const avancement = travail ? avancementDuTravail(travail) : null;
  const libelle = travail ? (travail.objet ? `${natureLisible(travail.nature)} · ${travail.objet}` : natureLisible(travail.nature)) : agent?.title || t('Agent');
  const etat = fini ? 'a-deployer' : attend ? 'a-vous' : 'travail';
  const titre = fini ? t('Terminé — ouvrez le service pour le voir') : attend ? t('Attend votre réponse') : t('Au travail');
  return (
    <div role="listitem" className={cn('relative flex items-center rounded-lg', attend && 'contour-de-question')}>
      <LienInterne
        adresse={adresse}
        title={titre}
        className="flex min-h-[38px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-raised sm:min-h-8"
        data-travail-de-service={ligne.id}
        data-service={travail?.service ?? agent?.service.id}
        data-etat={fini ? 'termine-non-vu' : attend ? 'a-vous' : 'travail'}
      >
        {projet ? <IconeDeLAgent etat={etat} projet={projet} petite /> : null}
        <span className={cn('min-w-0 flex-1 truncate text-[13.5px] text-text', fini && 'font-semibold')} data-libelle-du-travail>
          {libelle}
        </span>
        {avancement ? (
          <span className="shrink-0 text-[12px] tabular-nums text-faint" data-avancement-du-travail>
            {'pourcent' in avancement ? t('{n} %', { n: avancement.pourcent }) : t('{faits} sur {total}', { faits: avancement.faits, total: avancement.total })}
          </span>
        ) : null}
      </LienInterne>
    </div>
  );
}

/** Les lignes des services : dans « En cours » (tous projets) et sous un projet. */
export function LignesDesTravauxDeService({ lignes }: { lignes: readonly LigneDeService[] }) {
  const projets = useApp().projects;
  if (!lignes.length) return null;
  return (
    <>
      {lignes.map((ligne) => {
        const projectId = ligne.genre === 'travail' ? ligne.travail.projectId : ligne.agent.projectId;
        return <LigneDUnService key={ligne.id} ligne={ligne} projet={projets.find((p) => p.id === projectId)} />;
      })}
    </>
  );
}

/**
 * OUVRIR L'ÉCRAN DU SERVICE MARQUE SES TRAVAUX FINIS « VUS » : la ligne quitte la colonne, sur tous les appareils du
 * compte (le « vu » est gardé au démon). Posé une fois, au niveau de l'application ; suit l'adresse.
 */
export function useTravauxVusALOuverture(): void {
  const travaux = useApp().travauxDesServices;
  const [fragment, setFragment] = React.useState(() => window.location.hash);
  React.useEffect(() => {
    const suivre = () => setFragment(window.location.hash);
    window.addEventListener('popstate', suivre);
    window.addEventListener('hashchange', suivre);
    return () => {
      window.removeEventListener('popstate', suivre);
      window.removeEventListener('hashchange', suivre);
    };
  }, []);
  React.useEffect(() => {
    if (!travaux?.length) return;
    const vus = travauxVusALEcran(travaux, fragment);
    if (vus.length) client.marquerLesTravauxVus(vus);
  }, [travaux, fragment]);
}
