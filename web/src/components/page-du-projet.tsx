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
import type { Card } from '@beluga/shared';
import { GestesDePublicationDeCarte } from '@/components/geste-publication-carte';
import { SilhouetteRubrique } from '@/components/silhouettes';
import { FournirLeProjetDuService } from '@/components/projet-du-service';
import { CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE } from '@/components/ui';
import { TableauDesTaches } from '@/components/tableau-des-taches';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/* Le résumé ne se télécharge qu'à l'ouverture de l'accueil (un écran qu'on n'a pas ouvert ne se télécharge pas). */
const Dashboard = React.lazy(() => import('@/components/dashboard').then((m) => ({ default: m.Dashboard })));

export function PageDuProjet({ projectId, onOuvrir }: { projectId: string; onOuvrir: (card: Card) => void }) {
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
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
      {/* SUR ORDINATEUR, « PUBLIER » VIT DANS LA BARRE DU PROJET (`menu-publier.tsx`, refonte du 13/11/2026) ; sur
          téléphone, les deux gestes restent dans le menu à trois points. */}
      {telephone ? <GestesDePublicationDeCarte projectId={projectId} enMenu /> : null}
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
    </div>
  );
}
