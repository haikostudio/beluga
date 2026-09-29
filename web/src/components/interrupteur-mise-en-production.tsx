import * as React from 'react';
import { Switch, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * L'INTERRUPTEUR QUI PERMET OU NON LA MISE EN PRODUCTION DU PROJET
 * (`miseEnProductionActive`), sur le modèle de celui du déploiement
 * automatique : l'affichage suit l'état voulu pendant l'aller-retour, puis
 * reprend le projet revenu du serveur — diffusé à tous les appareils.
 */
export function InterrupteurMiseEnProduction({ projectId, actif }: { projectId: string; actif: boolean }) {
  const [enVol, setEnVol] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setEnVol((vise) => (vise === null || vise === actif ? null : vise));
  }, [actif]);

  const basculer = (valeur: boolean) => {
    setEnVol(valeur);
    client
      .call({ type: 'project.update', id: projectId, patch: { miseEnProductionActive: valeur } })
      .catch(() => setEnVol(null));
  };

  const affiche = enVol ?? actif;
  return (
    <Tooltip
      label={
        affiche
          ? t('Mise en production activée pour ce projet. Éteindre pour l’empêcher.')
          : t('Mise en production désactivée pour ce projet. Allumer pour la permettre.')
      }
    >
      <span className="mr-1 inline-flex shrink-0 items-center">
        <Switch
          checked={affiche}
          attente={enVol !== null}
          onCheckedChange={basculer}
          aria-label="Mise en production activée"
          data-interrupteur-mise-en-production={affiche ? 'oui' : 'non'}
        />
      </span>
    </Tooltip>
  );
}
