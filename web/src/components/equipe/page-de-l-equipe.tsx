/*
 * LA PAGE D'UN PROJET (et d'un groupe de projets) EN ÉQUIPE — carte « Beluga piloté par des agents », 26/11/2026,
 * maquettes #1ff2 (Équipe) et #1863 (Tâches). La DISCUSSION de l'équipe à gauche ; à droite le volet, sa barre
 * d'onglets standard « Équipe | Tâches » (choix retenu par projet), et en pied « Nouvel agent » ou « Nouvelle tâche »
 * sur toute la largeur. Pas de grand titre : le nom du projet est dans le fil d'Ariane.
 *
 * Un GROUPE (regroupement) a la même page avec SES agents ; un projet membre d'un groupe montre aussi, à la table, les
 * agents du groupe qui agissent pour lui (leur discussion est commune).
 */
import * as React from 'react';
import type { Card } from '@beluga/shared';
import { GabaritDiscussionEtVolet, CLASSE_BOUTON_DU_PIED } from '@/components/equipe/gabarit-discussion-volet';
import { DiscussionDeLEquipe } from '@/components/equipe/discussion-de-l-equipe';
import { TableDeLEquipe } from '@/components/equipe/table-de-l-equipe';
import { TachesDeLEquipe } from '@/components/equipe/taches-de-l-equipe';
import { useEquipe, type MembreLu } from '@/components/equipe/use-equipe';
import { creerCarteAgent } from '@/components/tiroir-nouvel-agent';
import { SilhouetteConversation, SilhouetteRubrique } from '@/components/silhouettes';
import { Loader2, Plus } from '@/components/ui/icones';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

type OngletDuProjet = 'equipe' | 'taches';

export function PageDeLEquipe({
  projectId,
  onOuvrirCarte,
  onOuvrirAgent,
  onCree,
}: {
  projectId: string;
  onOuvrirCarte: (card: Card) => void;
  onOuvrirAgent: (agentPersoId: string, projectId: string) => void;
  onCree?: (cardId: string) => void;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId) ?? null;
  const { equipe, erreur } = useEquipe(projectId);
  const [onglet, setOnglet] = usePref<OngletDuProjet>(`equipe.onglet.${projectId}`, 'equipe');
  const [creation, setCreation] = React.useState(false);
  const fige = !!projet?.archived;
  const membres: MembreLu[] = React.useMemo(() => [...(equipe?.agents ?? []), ...(equipe?.groupe?.agents ?? [])], [equipe]);

  const nouvelAgent = async (relieA?: MembreLu) => {
    if (creation && !relieA) return;
    if (!relieA) setCreation(true);
    try {
      const r = await client.call<{ agent: { id: string } }>({ type: 'equipe.nouveau', projectId: relieA?.projectId ?? projectId, relieA: relieA?.id ?? null }, 30000);
      onOuvrirAgent(r.agent.id, relieA?.projectId ?? projectId);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu être créé'));
    } finally {
      if (!relieA) setCreation(false);
    }
  };
  const nouvelleTache = async () => {
    if (creation) return;
    setCreation(true);
    try {
      await creerCarteAgent(projectId, (id) => onCree?.(id));
    } finally {
      setCreation(false);
    }
  };
  const ouvrirTache = (cardId: string) => {
    const carte = state.cards[cardId];
    if (carte) onOuvrirCarte(carte);
    else client.openCard(cardId);
  };

  const discussion = equipe ? (
    <DiscussionDeLEquipe projectId={projectId} membres={membres} echanges={equipe.echanges} onOuvrirTache={ouvrirTache} />
  ) : (
    <div className="px-7 pt-6">{erreur ? <p className="text-[13px] text-danger">{erreur}</p> : <SilhouetteConversation bulles={3} />}</div>
  );
  const contenu =
    onglet === 'taches' ? (
      <TachesDeLEquipe projectId={projectId} membres={membres} onOuvrir={onOuvrirCarte} />
    ) : equipe ? (
      <TableDeLEquipe membres={membres} echanges={equipe.echanges} onOuvrir={(m) => onOuvrirAgent(m.id, m.projectId)} onNouveauRelie={(m) => nouvelAgent(m)} />
    ) : (
      <div className="px-5">
        <SilhouetteRubrique />
      </div>
    );
  const pied = fige ? null : onglet === 'taches' ? (
    <button type="button" onClick={() => void nouvelleTache()} disabled={creation} aria-busy={creation || undefined} className={CLASSE_BOUTON_DU_PIED} data-nouvelle-tache-de-l-equipe={projectId}>
      {creation ? <Loader2 className="animate-spin" /> : <Plus />}
      <span className="min-w-0 truncate">{t('Nouvelle tâche')}</span>
    </button>
  ) : (
    <button type="button" onClick={() => void nouvelAgent()} disabled={creation} aria-busy={creation || undefined} className={CLASSE_BOUTON_DU_PIED} data-nouvel-agent-de-l-equipe={projectId}>
      {creation ? <Loader2 className="animate-spin" /> : <Plus />}
      <span className="min-w-0 truncate">{t('Nouvel agent')}</span>
    </button>
  );
  return (
    <GabaritDiscussionEtVolet<OngletDuProjet>
      repere="projet"
      libelleDuVolet={projet?.name ?? 'Projet'}
      discussion={discussion}
      onglets={[
        { cle: 'equipe', libelle: t('Équipe') },
        { cle: 'taches', libelle: t('Tâches') },
      ]}
      valeur={onglet}
      onChange={setOnglet}
      contenu={contenu}
      defile={onglet === 'taches'}
      pied={pied}
    />
  );
}
