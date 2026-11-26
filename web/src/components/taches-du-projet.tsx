/*
 * LES TÂCHES SOUS UN PROJET, DANS LA COLONNE DE GAUCHE : un flux unique, de la plus
 * récemment modifiée à la plus ancienne. Les ARCHIVES sont cachées (14/11/2026) : le premier
 * « Voir plus » les montre, puis cinq de plus à chaque « Voir plus », par le même curseur que la liste unique
 * (`shared/src/liste-par-date.ts`). La tâche ouverte et celles qui attendent une
 * réponse restent visibles à leur rang de date (`fluxDeLaColonne`) ; les actives
 * viennent d'une lecture dédiée (`tachesDeLaColonne`), `cards` ne portant que les
 * projets visités. AUCUNE SILHOUETTE ICI : un indicateur à côté du chevron dit que
 * la lecture du projet n'est pas encore arrivée (`FlecheDesTaches`).
 */
import * as React from 'react';
import { BranchesDArbre } from '@/components/branches-d-arbre';
import { LignesDesAgentsSansCarte, LignesDesChefsAuTravail } from '@/components/chefs-au-travail';
import { LignesDesTravauxDeService, useLignesDesServices } from '@/components/travaux-des-services';
import { ChevronRight, Loader2 } from '@/components/ui/icones';
import {
  TACHES_DE_LA_COLONNE_PAR_PAQUET,
  carteCacheeDesListes,
  cleDeLecture,
  entreesDeLaColonne,
  estTacheDeLaColonne,
  etatArchive,
  fluxMele,
  sansLesFillesRangees,
  separerActives,
  trierParDate,
  type Card,
} from '@beluga/shared';
import {
  LigneEtFilles,
  entreeActive,
  useCartesAvecAgentActif,
  useLignesDAgents,
  type Ligne,
} from '@/components/liste-des-agents';
import { LigneDeMiseEnLigne, useMisesEnLigneParDate } from '@/components/mises-en-ligne';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** Les lignes de la colonne, rangées par projet. `null` tant que la première lecture n'est pas arrivée. */
export function useTachesParProjet(): Map<string, Ligne[]> | null {
  const state = useApp();
  const pret = state.pret;
  const chargees = !!state.tachesDeLaColonne;
  const actives = useCartesAvecAgentActif();
  React.useEffect(() => {
    if (pret && !chargees) void client.chargerLesTachesDeLaColonne();
  }, [pret, chargees]);
  const cartes = React.useMemo(
    () =>
      trierParDate(
        Object.values(state.tachesDeLaColonne ?? {})
          .map((card) => {
            const connue = state.cards[card.id];
            return connue && connue.updatedAt >= card.updatedAt ? connue : card;
          })
          .filter((card) => estTacheDeLaColonne(card, actives.has(card.id)) && !carteCacheeDesListes(card, actives.has(card.id))),
      ),
    [state.tachesDeLaColonne, state.cards, actives],
  );
  const lignes = useLignesDAgents(cartes);
  return React.useMemo(() => {
    if (!chargees) return null;
    const parProjet = new Map<string, Ligne[]>();
    for (const ligne of lignes) {
      // Une carte rangée terminée et pas encore ouverte est ACTIVE (`ligneActive`) : elle reste sous son projet.
      if (etatArchive(ligne.etat) && !ligne.active) continue;
      const liste = parProjet.get(ligne.carte.projectId);
      if (liste) liste.push(ligne);
      else parProjet.set(ligne.carte.projectId, [ligne]);
    }
    return parProjet;
  }, [lignes, chargees]);
}

/** La flèche à droite d'une ligne de projet, comme celle d'un dossier. */
export function FlecheDesTaches({ projectId, ouvert, basculer }: { projectId: string; ouvert: boolean; basculer: () => void }) {
  const state = useApp();
  const enLecture = ouvert && !state.lecturesParDate[cleDeLecture({ projectId })]?.charge;
  return (
    <>
    {enLecture ? <Loader2 data-chargement-taches={projectId} aria-hidden className="h-3 w-3 shrink-0 animate-spin text-faint motion-reduce:animate-none" /> : null}
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={basculer}
      aria-expanded={ouvert}
      data-deplier-taches={projectId}
      className="flex h-[34px] w-[29px] shrink-0 items-center justify-center rounded-md text-faint hover:text-text sm:h-7 sm:w-6"
      title={ouvert ? t('Replier les tâches') : t('Déplier les tâches')}
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', ouvert && 'rotate-90')} />
    </button>
    </>
  );
}

function LignesDeTaches({
  lignes,
  carteOuverte,
  onOuvrir,
}: {
  lignes: Ligne[];
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
}) {
  const [menuPour, setMenuPour] = React.useState<string | null>(null);
  return (
    <>
      {lignes.map((ligne) => (
        <LigneEtFilles
          key={ligne.carte.id}
          carteOuverte={carteOuverte}
          onOuvrirFille={onOuvrir}
          ligne={ligne}
          compacte
          ouverte={carteOuverte === ligne.carte.id}
          menuOuvert={menuPour === ligne.carte.id}
          onMenu={(ouvert) => setMenuPour(ouvert ? ligne.carte.id : null)}
          onOuvrir={() => onOuvrir(ligne.carte)}
        />
      ))}
    </>
  );
}

/** Les tâches qu'une recherche a trouvées sous un projet, et elles seules. */
export function TachesTrouvees({
  projectId,
  cartes,
  carteOuverte,
  onOuvrir,
}: {
  projectId: string;
  cartes: Card[];
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
}) {
  const lignes = useLignesDAgents(cartes);
  return (
    <div role="list" className="mb-1.5 ml-3 flex flex-col gap-1 pl-1" data-taches-du-projet={projectId} data-taches-trouvees={projectId}>
      <LignesDeTaches lignes={lignes} carteOuverte={carteOuverte} onOuvrir={onOuvrir} />
    </div>
  );
}

/*
 * LES TÂCHES SOUS UN PROJET ONT QUITTÉ LA COLONNE (carte « Beluga piloté par des agents », 26/11/2026) : un projet
 * déplié montre ses AGENTS (`equipe/agents-dans-la-colonne.tsx`) ; ses tâches vivent dans l'onglet « Tâches » de sa
 * page. La recherche de la colonne garde ses résultats par projet (`TachesTrouvees`).
 */
