import * as React from 'react';
import { mentionBrancheParDefaut, mentionEcartAuSchema } from '@beluga/shared';
import { InterrupteurMiseEnProduction } from '@/components/interrupteur-mise-en-production';
import { Input, Label, LigneFormulaire } from '@/components/ui';
import { t } from '@/lib/langue';
import { CLASSE_TITRE_DE_TEMPS, OuJEnSuis, ProcessusEnPlace } from './processus-en-place';
import { ChoixDeBranche, EcartAuSchema, Repli, TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LA MISE EN PRODUCTION : envoyer le résultat là où le public le voit.
 *
 * Refonte du 29/09/2026 : tout ce qui touche la mise en production se règle
 * ICI. Depuis le 11/10/2026, la rubrique a la MÊME forme que le déploiement,
 * en trois temps : où j'en suis (`OuJEnSuis`), ce qui se passera au clic
 * (`ProcessusEnPlace`), puis les réglages.
 *
 * L'interrupteur qui la permet ou non (`miseEnProductionActive`, enregistré au
 * clic, comme dans l'entête du tiroir) vit en tête du premier temps. Éteint :
 * la phrase d'état le dit, le bouton de l'agent s'éteint en disant pourquoi au
 * survol, et les deux autres temps se masquent. Allumé : seule l'adresse
 * publique reste à vue, la branche se range derrière « Réglages avancés ».
 */
export function RubriqueProduction({ ctx }: { ctx: ContexteConfig }) {
  const actif = ctx.project.miseEnProductionActive === true;
  const [avances, setAvances] = React.useState(false);
  const brancheHorsSchema = !!mentionEcartAuSchema('production', ctx.brancheProduction);

  return (
    <div data-rubrique-contenu="production" data-mise-en-production className="space-y-5">
      <TeteDeRubrique
        titre={t('Mise en production')}
        resume={t('Envoyer le résultat là où le public le voit, souvent ailleurs.')}
        aide={t('Au clic sur « Mise en production », la branche de travail rejoint la branche de production, elle est envoyée sur le dépôt, puis le processus ci-dessous est joué étape par étape, sans agent. La première étape qui échoue arrête tout, et dit pourquoi.')}
      />

      <OuJEnSuis
        projet={ctx.project}
        cible="production"
        entete={
          <div className="flex items-center gap-3" data-activation-production={actif ? 'oui' : 'non'}>
            <Label className="min-w-0 flex-1">{t('Mise en production autorisée')}</Label>
            <InterrupteurMiseEnProduction projectId={ctx.project.id} actif={actif} />
          </div>
        }
        eteinte={
          actif
            ? null
            : {
                phrase: t('Désactivée : rien ne peut partir en production. Allumer pour la permettre et configurer son processus.'),
                voile: t('La mise en production est désactivée pour ce projet : allumez l’interrupteur ci-dessus pour parler à l’agent de configuration.'),
              }
        }
      />

      {actif ? (
        <>
          <ProcessusEnPlace projet={ctx.project} cible="production" branche={ctx.project.branchesDePublication?.production} />

          <section className="space-y-3" data-reglages-de-l-etape="production">
            <h3 className={CLASSE_TITRE_DE_TEMPS}>{t('Réglages')}</h3>

            <LigneFormulaire
              libelle={t('Adresse publique du site')}
              aide={t('L’adresse où le public voit la version en production. Remplie, elle ouvre d’office le suivi anonyme des visites du site : Beluga autorise cette adresse et fait poser le bon code de suivi par une carte, que vous lancez. Laissée vide, aucun suivi n’est posé.')}
              data-adresse-production
            >
              <Input
                value={ctx.adresseProduction}
                onChange={(event) => ctx.setAdresseProduction(event.target.value)}
                data-champ-adresse-production
                placeholder="https://mon-site.ch"
              />
            </LigneFormulaire>

            <Repli
              titre={t('Réglages avancés')}
              repere="reglages-avances"
              ouvert={avances}
              onBascule={() => setAvances((avant) => !avant)}
              avertissements={brancheHorsSchema ? <EcartAuSchema cible="production" valeur={ctx.brancheProduction} /> : null}
            >
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
            </Repli>
          </section>
        </>
      ) : null}
    </div>
  );
}
