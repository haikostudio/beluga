import * as React from 'react';
import { mentionBrancheParDefaut } from '@beluga/shared';
import { BoutonInitierProcedure } from '@/components/boutons-procedure';
import { ExplicationDeConfiguration } from '@/components/tiroir-procedure-production';
import { BulleInfo, Input, Label } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { ChoixDeBranche, TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LA MISE EN PRODUCTION : envoyer le résultat là où le public le voit.
 *
 * Refonte du 24/09/2026 : la procédure ne s'écrit plus ICI. Elle s'écrit et se
 * reprend avec l'agent de configuration, dans le tiroir du bandeau du bas
 * (onglet « Conversation ») ; cette rubrique n'en garde que l'explication, la
 * branche de production, et le bouton qui mène à ce tiroir.
 */
export function RubriqueProduction({ ctx }: { ctx: ContexteConfig }) {
  return (
    <div data-rubrique-contenu="production" data-mise-en-production className="space-y-4">
      <TeteDeRubrique
        titre={t('Mise en production')}
        resume={t('Envoyer le résultat là où le public le voit, souvent ailleurs.')}
        aide={t('Au clic sur « Mise en production », la branche de travail rejoint la branche de production, elle est envoyée sur le dépôt, puis le processus ci-dessous est joué étape par étape, sans agent. La première étape qui échoue arrête tout, et dit pourquoi.')}
      />


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

      <div className="space-y-3" data-zone-procedure="production">
        <ExplicationDeConfiguration processus={ctx.project.miseEnProduction?.processus} />
        <BoutonInitierProcedure
          cible="production"
          onOuvrir={() => client.demanderProduction({ projectId: ctx.project.id, onglet: 'conversation' })}
        />
      </div>
    </div>
  );
}
