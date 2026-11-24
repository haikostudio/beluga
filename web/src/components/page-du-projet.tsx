/*
 * LA PAGE D'ACCUEIL D'UN PROJET (11/11/2026 : « quand je sélectionne le nom du
 * projet en haut, ça doit pointer sur cette page »).
 *
 * Depuis le 14/11/2026, le nom d'un projet — dans la colonne de gauche comme dans le fil — mène TOUJOURS ici (plus
 * de reprise automatique du dernier agent) : le tableau de ses tâches, ses chiffres, puis — pour l'administrateur
 * seul — ses coûts (ce qu'aurait facturé une agence, et les jetons au tarif plein). Sur téléphone, les tâches
 * s'ouvrent par le bouton « Tâches » du haut (`feuille-des-taches.tsx`).
 *
 * Les deux gestes de mise en ligne — « Déployer » et « Mise en production » —
 * vivaient sur le tableau. Ce sont les MÊMES composants, montés ici : dans la
 * barre d'en-tête sur ordinateur, dans le menu à trois points sur téléphone.
 */
import * as React from 'react';
import type { Card, Project } from '@beluga/shared';
import { GestesDePublicationDeCarte } from '@/components/geste-publication-carte';
import { SilhouetteRubrique } from '@/components/silhouettes';
import { FournirLeProjetDuService } from '@/components/projet-du-service';
import { Button, CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE } from '@/components/ui';
import { Archive, ArchiveRestore } from '@/components/ui/icones';
import { ouvrirLArchivage } from '@/lib/archivage-projet';
import { TableauDesTaches } from '@/components/tableau-des-taches';
import { AgentsDuProjet } from '@/components/agents-du-projet';
import { PageDeLAgent } from '@/components/page-de-l-agent';
import { CLASSE_COLONNE_DE_SERVICE, PageAGrandTitre, RubriquesDePage } from '@/components/fenetre-de-service';
import { CranDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/* Le résumé ne se télécharge qu'à l'ouverture de l'accueil (un écran qu'on n'a pas ouvert ne se télécharge pas). */
const Dashboard = React.lazy(() => import('@/components/dashboard').then((m) => ({ default: m.Dashboard })));

/** CE QUE MONTRE L'ACCUEIL : l'onglet « Agents » (`null` : les tâches), et l'agent personnalisé ouvert. */
export type AccueilDesAgents = { agentPersoId?: string } | null;

export function PageDuProjet({
  projectId,
  onOuvrir,
  agents = null,
  onAgents,
}: {
  projectId: string;
  onOuvrir: (card: Card) => void;
  /** L'ONGLET « AGENTS » (carte « Agents personnalisés dans les projets », 24/11/2026), lu et écrit dans l'adresse. */
  agents?: AccueilDesAgents;
  onAgents?: (agents: AccueilDesAgents) => void;
}) {
  const telephone = useTelephone();
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId) ?? null;
  const projetDuResume = React.useMemo(() => (projet ? { id: projet.id, name: projet.name, path: projet.path } : null), [projet?.id, projet?.name, projet?.path]);
  const ouvrirParId = React.useCallback(
    (cardId: string) => {
      const card = state.cards[cardId];
      if (card) onOuvrir(card);
    },
    [state.cards, onOuvrir],
  );
  /*
   * L'ACCUEIL D'UN PROJET EN UNE SEULE PAGE QUI DÉFILE, SANS ONGLETS (décision de l'utilisateur du 14/11/2026, remplace
   * les onglets « Résumé / Facturation » du 13/11/2026) : en haut, le TABLEAU DES TÂCHES du projet seul — les quinze
   * dernières, puis la pagination ; dessous, les chiffres et l'activité au fil des jours ; tout en bas, la facturation,
   * pour l'administrateur seul. La période vit au coin haut droit (dans les trois points sur téléphone).
   */
  const telephoneSansTableau = telephone;
  let facturation: React.ReactNode = null;
  /*
   * « TÂCHES | AGENTS » (24/11/2026, maquette #1df7) : un sélecteur dans la rangée du grand titre — JAMAIS un onglet
   * d'en-tête (la barre d'onglets du projet n'a plus d'onglet « Tâches » depuis le 13/11/2026). Le choix est retenu par
   * projet ; l'agent ouvert est une page à lui (conversation à gauche, configuration à droite).
   */
  const selecteur = onAgents ? (
    <BarreDOnglets
      repere="accueil-taches-agents"
      pleineLargeur={telephone}
      valeur={agents ? 'agents' : 'taches'}
      onChange={(v) => onAgents(v === 'agents' ? {} : null)}
      onglets={[
        { cle: 'taches', libelle: t('Tâches') },
        { cle: 'agents', libelle: t('Agents') },
      ]}
    />
  ) : null;
  if (agents && onAgents) {
    if (agents.agentPersoId) {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
          <PageDeLAgent projectId={projectId} agentPersoId={agents.agentPersoId} onRetour={() => onAgents({})} />
        </div>
      );
    }
    const liste = <AgentsDuProjet projectId={projectId} onOuvrir={(id) => onAgents({ agentPersoId: id })} />;
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
        {projet ? <BandeauDuProjetArchive projet={projet} /> : null}
        <SuiteDuFil onRacine={() => onAgents(null)}>
          <CranDuFil data-cran-agents="">{t('Agents')}</CranDuFil>
        </SuiteDuFil>
        <div className="flex min-h-0 flex-1 flex-col" data-accueil-du-projet="agents">
          {telephone ? (
            <ZoneDefilement className="px-4 pb-6 pt-2" data-fil="agents-du-projet">
              <div className="flex flex-col gap-4">
                {selecteur}
                {liste}
              </div>
            </ZoneDefilement>
          ) : (
            <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="sm:pb-20" data-fil="agents-du-projet">
              <div className={CLASSE_COLONNE_DE_SERVICE} data-colonne-de-l-accueil>
                <PageAGrandTitre titre={projet?.name ?? ''} repere="accueil-du-projet">
                  <RubriquesDePage>{selecteur}</RubriquesDePage>
                  {liste}
                </PageAGrandTitre>
              </div>
            </ZoneDefilement>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
      {/* SUR ORDINATEUR, « PUBLIER » VIT DANS LA BARRE DU PROJET (`menu-publier.tsx`, refonte du 13/11/2026) ; sur
          téléphone, les deux gestes restent dans le menu à trois points. */}
      {telephone ? <GestesDePublicationDeCarte projectId={projectId} enMenu /> : null}
      {projet ? <BandeauDuProjetArchive projet={projet} /> : null}
      <div className="flex min-h-0 flex-1 flex-col" data-accueil-du-projet="page">
        <FournirLeProjetDuService value={projetDuResume}>
          <React.Suspense fallback={<div className={cn('mx-auto w-full pt-6', CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE)}><SilhouetteRubrique /></div>}>
            {/* LE NOM DU PROJET EN GRAND TITRE, comme une page de service (16/11/2026, capture #8891) : la recherche et le
                filtre des tâches montent sur sa ligne, à droite, avec la période — plus de petit titre « Tâches ». */}
            <Dashboard
              titre={projet?.name}
              avant={
                telephoneSansTableau ? (
                  selecteur
                ) : (
                  <>
                    {selecteur ? <RubriquesDePage>{selecteur}</RubriquesDePage> : null}
                    <TableauDesTaches projectId={projectId} onOuvrir={onOuvrir} titre={null} />
                  </>
                )
              }
              apres={facturation ? <div className="pt-6" data-facturation-de-l-accueil>{facturation}</div> : null}
            />
          </React.Suspense>
        </FournirLeProjetDuService>
      </div>
    </div>
  );
}

/**
 * UN PROJET ARCHIVÉ S'OUVRE EN LECTURE (carte du 20/11/2026) : tout se lit, rien ne se lance. Ce bandeau le dit en tête
 * de la page et offre le geste qui rend le projet — « Désarchiver » ; pendant un transfert, il suit l'avancement.
 */
function BandeauDuProjetArchive({ projet }: { projet: Project }) {
  const transfert = useApp().archivages[projet.id];
  const enCours = !!transfert && !transfert.fini;
  if (!projet.archived && !enCours) return null;
  return (
    <div className={cn('mx-auto w-full pt-4', CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-raised px-3 py-2.5" data-bandeau-projet-archive={projet.id}>
        <Archive className="h-4 w-4 shrink-0 text-muted" />
        <p className="min-w-0 flex-1 text-[13.5px] text-text">
          {enCours
            ? transfert.sens === 'archiver'
              ? t('Archivage en cours…')
              : t('Désarchivage en cours…')
            : t('Ce projet est archivé : ses fichiers sont sur le disque externe. Tout se lit, rien ne se lance.')}
        </p>
        <Button
          size="sm"
          variant="default"
          className="shrink-0"
          data-bandeau-desarchiver={projet.id}
          onClick={() => ouvrirLArchivage(projet.id, enCours ? transfert.sens : 'desarchiver')}
        >
          {enCours ? null : <ArchiveRestore className="h-3.5 w-3.5" />}
          {enCours ? t('Voir l’avancement') : t('Désarchiver')}
        </Button>
      </div>
    </div>
  );
}
