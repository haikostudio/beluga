import * as React from 'react';
import { SilhouetteMarketing } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { OngletCanaux, type EspaceComplet } from './canaux-avances';
import { useV2 } from './contexte';
import { PageV2 } from './page-v2';
import { useLecture } from './socle/pieces';
import type { Canaux } from './page-canaux';

/**
 * LES RÉGLAGES AVANCÉS DES RÉSEAUX (carte « Campagne, studio et mode du champ », 11/11/2026) : l'ancien espace
 * Communication est retiré, ses réglages fins des canaux (identifiants d'application, parcours de reliure, fiche
 * d'un canal) vivent ici, à « #communication2/<marque>/canaux/reglages[/<canal>] ». Mêmes commandes qu'avant
 * (`marketing.espace`) : aucune donnée ne change de place.
 */
export function PageReglagesDesCanaux({ canal }: { canal: string | null }) {
  const { marque, aller, demander, ouvrirCarte } = useV2();
  const { donnees: canaux } = useLecture<Canaux>({ type: 'communication.canaux', marqueId: marque.id }, [marque.id]);
  const projectId = canaux?.principal ?? null;
  const state = useApp();
  const version = projectId ? (state.marketingVersions[projectId] ?? 0) : 0;
  const [donnees, setDonnees] = React.useState<EspaceComplet | null>(null);
  React.useEffect(() => {
    if (!projectId) return;
    let vivant = true;
    void client
      .call<EspaceComplet>({ type: 'marketing.espace', projectId, jours: 7 })
      .then((r) => {
        if (vivant) setDonnees(r);
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? String(err)));
    return () => {
      vivant = false;
    };
  }, [projectId, version]);
  return (
    <PageV2 titre={t('Réglages avancés')} barre={false} data-v2-reglages-avances={canal ?? ''}>
      {canaux && !projectId ? (
        <p className="text-[13px] text-muted">{t('Cette marque n’a pas encore de projet : ses réseaux se règlent une fois la marque reliée à un projet.')}</p>
      ) : !donnees || !projectId ? (
        <SilhouetteMarketing />
      ) : (
        <OngletCanaux
          projectId={projectId}
          donnees={donnees}
          ouvert={canal}
          onOuvrir={(c: string | null) => (c ? aller('canaux', 'reglages', c) : aller('canaux', 'reglages'))}
          onAgent={() => void demander('canaux', t('Aide-moi à régler mes canaux pour {marque}.', { marque: marque.nom }))}
          onOuvrirCarte={(carte) => ouvrirCarte?.(carte.id, carte.projectId)}
        />
      )}
    </PageV2>
  );
}
