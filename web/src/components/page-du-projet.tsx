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
import { Archive, ArchiveRestore, BarChart3, Bot, Loader2, Plus } from '@/components/ui/icones';
import { CLASSE_BOUTON_PLEINE_LARGEUR } from '@/components/menu-du-bas';
import { creerCarteAgent } from '@/components/tiroir-nouvel-agent';
import { ouvrirLArchivage } from '@/lib/archivage-projet';
import { TableauDesTaches } from '@/components/tableau-des-taches';
import { PageDeLEquipe } from '@/components/equipe/page-de-l-equipe';
import { AgentsDuProjet } from '@/components/agents-du-projet';
import { ZoneDefilement } from '@/components/ui';
import { PageDeLAgent } from '@/components/page-de-l-agent';
import { PageDuSousAgent } from '@/components/sous-agents';
import { CLASSE_COLONNE_DE_SERVICE } from '@/components/fenetre-de-service';
import { CranDuFil, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { naviguerVers } from '@/components/ui/lien-interne';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/* Le résumé ne se télécharge qu'à l'ouverture de l'accueil (un écran qu'on n'a pas ouvert ne se télécharge pas). */
const Dashboard = React.lazy(() => import('@/components/dashboard').then((m) => ({ default: m.Dashboard })));

/** CE QUE MONTRE L'ACCUEIL : l'onglet « Agents » (`null` : les tâches), et l'agent personnalisé ouvert. */
export type AccueilDesAgents = { agentPersoId?: string; agentId?: string } | null;

export function PageDuProjet({
  projectId,
  onOuvrir,
  agents = null,
  onAgents,
  onCree,
}: {
  projectId: string;
  onOuvrir: (card: Card) => void;
  /** Une carte vient de naître par le pied « Nouvel artefact » (l'appelant la suit, comme après le « + » de la colonne). */
  onCree?: (cardId: string) => void;
  /** L'ONGLET « AGENTS » (carte « Agents personnalisés dans les projets », 24/11/2026), lu et écrit dans l'adresse. */
  agents?: AccueilDesAgents;
  onAgents?: (agents: AccueilDesAgents) => void;
}) {
  const telephone = useTelephone();
  const state = useApp();
  /* « Chiffres et coûts » et « Tableau des agents » : l'ancien accueil du projet et l'ancien onglet « Agents » (point
     du matin, tableau, chefs de communication et leur interrupteur), ouverts depuis le menu à trois points. */
  const [vueAnnexe, setVueAnnexe] = React.useState<'chiffres' | 'tableau' | null>(null);
  const chiffres = vueAnnexe === 'chiffres';
  const setChiffres = (oui: boolean) => setVueAnnexe(oui ? 'chiffres' : null);
  React.useEffect(() => setVueAnnexe(null), [projectId]);
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
  /* LA CONVERSATION D'UN AGENT SANS FICHE — un chef de Communication, un sous-agent (24/11/2026) : sa page, avec la
     rangée d'onglets de sa famille sous le fil d'Ariane. */
  if (agents?.agentId && onAgents) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
        <PageDuSousAgent projectId={projectId} agentId={agents.agentId} onRetour={() => onAgents(null)} />
      </div>
    );
  }
  /* LA PAGE D'UN AGENT DE L'ÉQUIPE (26/11/2026) : sa discussion à gauche, ses outils à droite. */
  if (agents?.agentPersoId && onAgents) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
        <PageDeLAgent projectId={projectId} agentPersoId={agents.agentPersoId} onRetour={() => onAgents(null)} onOuvrirCarte={onOuvrir} onCree={onCree} />
      </div>
    );
  }
  /*
   * L'ÉQUIPE DU PROJET (carte « Beluga piloté par des agents », 26/11/2026) : la page d'un projet est désormais la
   * discussion de son équipe et le volet « Équipe | Tâches ». L'ancien accueil — chiffres, activité, coûts — reste à
   * portée par le menu à trois points (« Chiffres et coûts ») : rien de ce qu'il montrait ne se perd.
   */
  if (vueAnnexe === 'tableau' && onAgents) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId} data-accueil-du-projet="tableau-des-agents">
        <SuiteDuFil onRacine={() => setVueAnnexe(null)} retour={{ action: () => setVueAnnexe(null), reperes: { 'data-tableau-des-agents-retour': '' } }}>
          <CranDuFil data-cran-tableau-des-agents="">{t('Tableau des agents')}</CranDuFil>
        </SuiteDuFil>
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-4 pb-10 pt-2 sm:px-0" data-fil="agents-du-projet">
          <div className={CLASSE_COLONNE_DE_SERVICE}>
            <AgentsDuProjet projectId={projectId} onOuvrir={(id) => onAgents({ agentPersoId: id })} onOuvrirUnChef={(id) => onAgents({ agentId: id })} />
          </div>
        </ZoneDefilement>
      </div>
    );
  }
  if (!chiffres) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId} data-accueil-du-projet="equipe">
        {telephone ? <GestesDePublicationDeCarte projectId={projectId} enMenu /> : null}
        <OptionsDePage enMenu>
          <OptionDePage icone={<BarChart3 className="h-4 w-4" />} onClick={() => setChiffres(true)} data-option-chiffres-du-projet="">
            {t('Chiffres et coûts')}
          </OptionDePage>
          {onAgents ? (
            <OptionDePage icone={<Bot className="h-4 w-4" />} onClick={() => setVueAnnexe('tableau')} data-option-tableau-des-agents="">
              {t('Tableau des agents')}
            </OptionDePage>
          ) : null}
        </OptionsDePage>
        {projet ? <BandeauDuProjetArchive projet={projet} /> : null}
        <PageDeLEquipe
          projectId={projectId}
          onOuvrirCarte={onOuvrir}
          onOuvrirAgent={(id, projetDeLAgent) => {
            if (projetDeLAgent === projectId) onAgents?.({ agentPersoId: id });
            else naviguerVers(`projet/${encodeURIComponent(projetDeLAgent)}/agents/${encodeURIComponent(id)}`);
          }}
          onCree={onCree}
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
      {/* SUR ORDINATEUR, « PUBLIER » VIT DANS LA BARRE DU PROJET (`menu-publier.tsx`, refonte du 13/11/2026) ; sur
          téléphone, les deux gestes restent dans le menu à trois points. */}
      {telephone ? <GestesDePublicationDeCarte projectId={projectId} enMenu /> : null}
      {projet ? <BandeauDuProjetArchive projet={projet} /> : null}
      <SuiteDuFil onRacine={() => setChiffres(false)} retour={{ action: () => setChiffres(false), reperes: { 'data-chiffres-retour': '' } }}>
        <CranDuFil data-cran-chiffres="">{t('Chiffres et coûts')}</CranDuFil>
      </SuiteDuFil>
      <div className="flex min-h-0 flex-1 flex-col" data-accueil-du-projet="page">
        <FournirLeProjetDuService value={projetDuResume}>
          <React.Suspense fallback={<div className={cn('mx-auto w-full pt-6', CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE)}><SilhouetteRubrique /></div>}>
            {/* LE NOM DU PROJET EN GRAND TITRE, comme une page de service (16/11/2026, capture #8891) : la recherche et le
                filtre des tâches montent sur sa ligne, à droite, avec la période — plus de petit titre « Tâches ». */}
            <Dashboard
              titre={projet?.name}
              avant={telephoneSansTableau ? null : <TableauDesTaches projectId={projectId} onOuvrir={onOuvrir} titre={null} />}
              apres={facturation ? <div className="pt-6" data-facturation-de-l-accueil>{facturation}</div> : null}
            />
          </React.Suspense>
        </FournirLeProjetDuService>
      </div>
      {projet && !telephone ? <PiedNouvelArtefact projet={projet} onCree={onCree} /> : null}
    </div>
  );
}

/**
 * « NOUVEL ARTEFACT » EN PIED DE LA PAGE D'UN PROJET (décision de l'utilisateur du 26/11/2026, capture #0b58 : « en bas
 * des tableaux de bord des projets, je veux le bouton Nouvel artefact »). ORDINATEUR SEULEMENT : le téléphone a déjà le
 * « + » du menu du bas et le pied de la feuille des tâches (`feuille-des-taches.tsx`, même bouton). Hors de la zone qui
 * défile, centré sur la colonne de la page, pleine largeur, gris (`bg-controle-doux`) ; le clic fait naître une carte
 * de cadrage dans CE projet et l'ouvre (`creerCarteAgent`), une seule à la fois. Absent d'un projet archivé ou en
 * cours de transfert : rien ne s'y lance.
 */
function PiedNouvelArtefact({ projet, onCree }: { projet: Project; onCree?: (cardId: string) => void }) {
  const transfert = useApp().archivages[projet.id];
  const [creation, setCreation] = React.useState(false);
  if (projet.archived || (transfert && !transfert.fini)) return null;
  const creer = async () => {
    if (creation) return;
    setCreation(true);
    try {
      await creerCarteAgent(projet.id, (id) => onCree?.(id));
    } finally {
      setCreation(false);
    }
  };
  return (
    <div className="shrink-0 pb-4 pt-2" data-pied-de-page-projet={projet.id}>
      <div className={CLASSE_COLONNE_DE_SERVICE}>
        <button
          type="button"
          onClick={() => void creer()}
          disabled={creation}
          aria-busy={creation || undefined}
          className={cn(CLASSE_BOUTON_PLEINE_LARGEUR, 'bg-controle-doux text-text hover:bg-controle-doux-survol')}
          data-nouvel-artefact-pied-projet={projet.id}
        >
          {creation ? <Loader2 className="animate-spin" /> : <Plus />}
          <span className="min-w-0 truncate">{t('Nouvelle tâche')}</span>
        </button>
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
