import * as React from 'react';
import { mentionBrancheParDefaut } from '@beluga/shared';
import { InterrupteurMiseEnProduction } from '@/components/interrupteur-mise-en-production';
import { BulleInfo, Input, Label } from '@/components/ui';
import { t } from '@/lib/langue';
import { AgentDeConfiguration } from './agent-de-configuration';
import { ProcessusEnPlace } from './processus-en-place';
import { ChoixDeBranche, TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LA MISE EN PRODUCTION : envoyer le résultat là où le public le voit.
 *
 * Refonte du 29/09/2026 : tout ce qui touche la mise en production se règle
 * ICI. En tête, l'interrupteur qui la permet ou non (`miseEnProductionActive`,
 * enregistré au clic, comme dans l'entête du tiroir). Allumé : la branche,
 * l'adresse publique, le PROCESSUS EN PLACE lisible d'un coup d'œil, puis le
 * bouton qui ouvre la conversation avec l'agent qui l'écrit. Éteint : le contenu
 * se masque et le bouton de l'agent s'éteint en disant pourquoi.
 */
export function RubriqueProduction({ ctx }: { ctx: ContexteConfig }) {
  const actif = ctx.project.miseEnProductionActive === true;
  return (
    <div data-rubrique-contenu="production" data-mise-en-production className="space-y-4">
      <TeteDeRubrique
        titre={t('Mise en production')}
        resume={t('Envoyer le résultat là où le public le voit, souvent ailleurs.')}
        aide={t('Au clic sur « Mise en production », la branche de travail rejoint la branche de production, elle est envoyée sur le dépôt, puis le processus ci-dessous est joué étape par étape, sans agent. La première étape qui échoue arrête tout, et dit pourquoi.')}
      />

      <div className="flex items-center gap-3 rounded-lg bg-raised/35 px-3 py-2.5" data-activation-production={actif ? 'oui' : 'non'}>
        <div className="min-w-0 flex-1">
          <Label>{t('Mise en production autorisée')}</Label>
          <p className="mt-0.5 text-[12px] leading-snug text-faint">
            {actif
              ? t('Le bouton « Mise en production » peut partir. Éteindre pour l’empêcher.')
              : t('Désactivée : rien ne peut partir en production. Allumer pour la permettre et configurer son processus.')}
          </p>
        </div>
        <InterrupteurMiseEnProduction projectId={ctx.project.id} actif={actif} />
      </div>

      {actif ? (
        <>
          <ChoixDeBranche
            repere="data-branche-production"
            titre={t('Branche de la mise en production')}
            cible="production"
            valeur={ctx.brancheProduction}
            onChange={ctx.setBrancheProduction}
            branches={ctx.branches}
            enCours={ctx.branchesEnCours}
            raison={ctx.branchesRaison}
            mention={mentionBrancheParDefaut('production', ctx.branches)}
          />

          <div data-adresse-production>
            <div className="flex items-center gap-1">
              <Label>{t('Adresse publique du site')}</Label>
              <BulleInfo cote="start">{t('L’adresse où le public voit la version en production. Remplie, elle ouvre d’office le suivi anonyme des visites du site : Beluga autorise cette adresse et fait poser le bon code de suivi par une carte, que vous lancez. Laissée vide, aucun suivi n’est posé.')}</BulleInfo>
            </div>
            <Input
              value={ctx.adresseProduction}
              onChange={(event) => ctx.setAdresseProduction(event.target.value)}
              className="mt-1"
              data-champ-adresse-production
              placeholder="https://mon-site.ch"
            />
          </div>

          <ProcessusEnPlace projet={ctx.project} cible="production" branche={ctx.project.branchesDePublication?.production} />
        </>
      ) : null}

      <div className="space-y-1.5" data-zone-procedure="production">
        <AgentDeConfiguration
          projectId={ctx.project.id}
          cible="production"
          voile={actif ? null : t('La mise en production est désactivée pour ce projet : allumez l’interrupteur ci-dessus pour parler à l’agent de configuration.')}
        />
      </div>
    </div>
  );
}
