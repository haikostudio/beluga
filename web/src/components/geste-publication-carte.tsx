import * as React from 'react';
import {
  agentCompteCommeTravail,
  agentTientSonTour,
  carteMarketingCachee,
  colonneAffichee,
  estEtapeDeSuite,
  estUnRegroupement,
  etapeDeLaColonne,
  membresActifsDuRegroupement,
  type Card,
  type ColumnKey,
} from '@beluga/shared';
import { BoutonInfosPublication, DeployPanel, type InfosPublication } from '@/components/deploy-panel';
import { BandeauProductionGroupe } from '@/components/bandeau-production-groupe';
import { DeploiementDeGroupe } from '@/components/deploiement-de-groupe';
import { ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
import { useApp } from '@/lib/use-app';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';

/*
 * LES DEUX GESTES DE PUBLICATION DANS L'EN-TÊTE DE LA PAGE D'UNE CARTE — LES
 * MÊMES QUE SUR LE TABLEAU (demande du 24/10/2026, captures #507c7 et #da13).
 *
 * L'en-tête d'une tâche portait une COPIE : un bouton « Déploiement » qui
 * n'ouvrait que le déroulé du dernier déploiement, et une fusée sans pastille.
 * Il monte désormais les composants du tableau eux-mêmes (`DeployPanel` en
 * tenue `compact` puis `bandeau`, `enTete`) : « Déployer (n) » lance la
 * fenêtre de sélection, son chevron ouvre le déroulé, la mise en production
 * porte la pastille des versions en attente — mêmes contrôles, mêmes pages.
 *
 * Les cartes du lot se lisent dans le magasin, rangées par la MÊME règle que
 * les colonnes du tableau (`colonneAffichee`). Le tableau reste monté sous la
 * page : seul le composant du dessus répond aux demandes venues d'ailleurs
 * (`useDernierMonte`, dans `DeployPanel`). Sur téléphone rien ne se dessine
 * ici : le menu à trois points porte déjà les deux gestes.
 *
 * LE TABLEAU N'EST PLUS MONTÉ (30/10/2026, « projets sans kanban ») : la page
 * d'un projet monte ces MÊMES gestes elle-même (`page-du-projet.tsx`) — dans la
 * barre d'en-tête sur ordinateur, dans le menu à trois points sur téléphone
 * (`enMenu`).
 */
export function GestesDePublicationDeCarte({ projectId, enMenu = false }: { projectId: string; enMenu?: boolean }) {
  const state = useApp();
  const [infos, setInfos] = React.useState<InfosPublication | null>(null);

  const parColonne = React.useMemo(() => {
    const travail = new Set<string>();
    for (const agent of Object.values(state.agents)) {
      if (agent.cardId && agentCompteCommeTravail(agent.role) && agentTientSonTour(agent)) travail.add(agent.cardId);
    }
    const index: Partial<Record<ColumnKey, Card[]>> = { to_deploy: [], archived: [] };
    for (const card of Object.values(state.cards)) {
      if (card.projectId !== projectId || carteMarketingCachee(card) || estEtapeDeSuite(card)) continue;
      const cle = colonneAffichee({ column: card.column, agentAuTravail: travail.has(card.id) });
      index[cle]?.push(card);
    }
    for (const liste of Object.values(index)) liste?.sort((a, b) => b.position - a.position);
    return index;
  }, [state.cards, state.agents, projectId]);

  // Sans le droit « Déployer » sur ce projet (accès tiers), aucun geste de mise en ligne.
  if (!aLeNiveauSurLeProjet(state, projectId, 'deployer')) return null;
  const projet = state.projects.find((p) => p.id === projectId);
  const membres = estUnRegroupement(projet) ? membresActifsDuRegroupement(state.projects, projectId) : [];
  return (
    <>
      {membres.length && projet ? (
        /* Un regroupement liste ses projets à cocher (`deploiement-de-groupe.tsx`). */
        <DeploiementDeGroupe groupe={projet} membres={membres} enTete={!enMenu} enMenu={enMenu} />
      ) : (
        <DeployPanel
          projectId={projectId}
          cards={parColonne.to_deploy ?? []}
          colonne="to_deploy"
          presentation="compact"
          enTete={!enMenu}
          enMenu={enMenu}
          onInitier={() => {
            const etape = etapeDeLaColonne('to_deploy');
            if (etape) ouvrirRubriqueDeLEtape(projectId, etape.cible);
          }}
        />
      )}
      {membres.length && projet ? (
        <BandeauProductionGroupe groupe={projet} membres={membres} enTete={!enMenu} enMenu={enMenu} />
      ) : (
        <DeployPanel
          projectId={projectId}
          cards={parColonne.archived ?? []}
          colonne="archived"
          presentation="bandeau"
          enTete={!enMenu}
          enMenu={enMenu}
          onInfos={setInfos}
          actions={<BoutonInfosPublication colonne="archived" infos={infos} />}
        />
      )}
    </>
  );
}
