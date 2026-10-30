/*
 * LA PAGE D'UN PROJET, SANS TABLEAU (demande du 30/10/2026 : « supprime le
 * kanban, ouvre le projet sur le dernier agent »).
 *
 * Sur ordinateur, la liste des agents vit dans la colonne de gauche et le
 * projet s'ouvre sur son DERNIER agent (`app.tsx`, reprise par projet) : cette
 * page ne se voit donc que lorsqu'aucun agent n'est ouvert — un accueil qui
 * invite à en lancer un, sans jamais créer de carte d'office. Sur téléphone, la
 * page EST la liste, en plein écran : un toucher ouvre la conversation, la
 * flèche de la barre d'en-tête y ramène.
 *
 * Les deux gestes de mise en ligne — « Déployer » et « Mise en production » —
 * vivaient sur le tableau. Ce sont les MÊMES composants, montés ici : dans la
 * barre d'en-tête sur ordinateur, dans le menu à trois points sur téléphone.
 */
import * as React from 'react';
import { Bot, Loader2, Plus } from 'lucide-react';
import { carteMarketingCachee, type Card } from '@beluga/shared';
import { GestesDePage } from '@/components/entete-de-zone';
import { GestesDePublicationDeCarte } from '@/components/geste-publication-carte';
import { ListeDesAgents } from '@/components/liste-des-agents';
import { BoutonNouvelleTache, useNouvelleTache } from '@/components/nouvelle-tache';
import { Button } from '@/components/ui';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';
import { t } from '@/lib/langue';
import { useApp, useCanal } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';

export function PageDuProjet({ projectId, onOuvrir }: { projectId: string; onOuvrir: (card: Card) => void }) {
  const telephone = useTelephone();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-page-du-projet={projectId}>
      {telephone ? (
        <GestesDePublicationDeCarte projectId={projectId} enMenu />
      ) : (
        <GestesDePage>
          <GestesDePublicationDeCarte projectId={projectId} />
        </GestesDePage>
      )}
      {telephone ? (
        <ListeDesAgents projectId={projectId} pleinePage onOuvrir={onOuvrir} />
      ) : (
        <AccueilDuProjet projectId={projectId} />
      )}
    </div>
  );
}

/** Aucun agent ouvert : une invitation, et le geste qui en lance un. */
function AccueilDuProjet({ projectId }: { projectId: string }) {
  const state = useApp();
  const canal = useCanal();
  const { busy, ouvrir } = useNouvelleTache(projectId);
  const peutLancer = aLeNiveauSurLeProjet(state, projectId, 'travailler');
  const aDesAgents = React.useMemo(
    () => Object.values(state.cards).some((card) => card.projectId === projectId && !carteMarketingCachee(card)),
    [state.cards, projectId],
  );
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6" data-accueil-du-projet={aDesAgents ? 'agents' : 'vide'}>
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-muted">
          <Bot className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-[17px] font-semibold tracking-tight text-text">
          {aDesAgents ? t('Choisissez un agent') : t('Lancez votre premier agent')}
        </h2>
        <p className="text-[14px] leading-relaxed text-muted">
          {aDesAgents
            ? t('Ouvrez un agent dans la liste de gauche pour reprendre la conversation, ou lancez-en un nouveau.')
            : t('Décrivez ce que vous voulez : l’agent en discute avec vous, puis s’y met.')}
        </p>
        {peutLancer ? (
          <Button
            variant="creation"
            size="lg"
            className="mt-1 gap-2"
            data-accueil-lancer-un-agent
            disabled={busy || canal.gele}
            title={canal.gele ? canal.raison : undefined}
            onClick={() => void ouvrir()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('Lancer un agent')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** La colonne de gauche d'un projet, sur ordinateur : « Lancer un agent », puis la liste. */
export function ColonneDesAgents({
  projectId,
  carteOuverte,
  onOuvrir,
}: {
  projectId: string;
  carteOuverte: string | null;
  onOuvrir: (card: Card) => void;
}) {
  return (
    <ListeDesAgents
      projectId={projectId}
      carteOuverte={carteOuverte}
      onOuvrir={onOuvrir}
      entete={<BoutonNouvelleTache projectId={projectId} />}
    />
  );
}
