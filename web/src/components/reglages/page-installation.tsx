import * as React from 'react';
import { etapesRemisesAPlusTard, type EtatDeLAssistant } from '@beluga/shared';
import { Groupe } from '@/components/reglages/communs';
import {
  SectionCompetences,
  SectionCopie,
  SectionCourriels,
  SectionDomaine,
  SectionEspaceClient,
  SectionFacultatif,
  SectionGitHub,
  SectionMemoire,
  useEtatDeLInstallation,
} from '@/components/installation/sections';
import { SectionPartage, useEtatDuRelais } from '@/components/installation/relais';
import { useApp } from '@/lib/use-app';
import { useNouveautes } from '@/lib/travail-installation';
import { t } from '@/lib/langue';
import { SectionVotreAssistant } from '@/components/installation/votre-assistant';
import { Button } from '@/components/ui';
import { relancerLaVisite } from '@/components/visite-guidee';

/**
 * LES RÉGLAGES DE L'INSTALLATION — tout ce que l'assistant de premier démarrage
 * demandait, réuni sur une page. Ce qui a été passé « plus tard » se règle ici,
 * et ce qui a été réglé s'y corrige : ce sont les mêmes composants que dans
 * l'assistant (`installation/sections.tsx`), donc les mêmes champs et les mêmes
 * gestes.
 */
export function PageInstallation() {
  const state = useApp();
  const { etat, relire } = useEtatDeLInstallation();
  const relais = useEtatDuRelais();
  const nouveautes = useNouveautes();
  const remises = etapesRemisesAPlusTard(state.settings?.assistant as EtatDeLAssistant | undefined, state.offreHebergee);

  return (
    <div className="space-y-7" data-page-installation="reglages">
      {remises.length ? (
        <p className="text-[13.5px] leading-relaxed text-muted" data-installation-remises={remises.join(' ')}>
          {t('{n} page(s) de la mise en route ont été remises à plus tard : elles se règlent ci-dessous.', { n: String(remises.length) })}
        </p>
      ) : null}
      <Groupe titre={t('La visite guidée')}>
        <div className="flex flex-wrap items-center gap-3" data-relancer-visite>
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-muted">
            {t('Des bulles montrent où cliquer pour créer un projet, confier une demande, suivre le travail et publier. Elles ne remplissent rien à votre place.')}
          </p>
          <Button variant="subtle" size="sm" onClick={relancerLaVisite}>
            {t('Revoir la visite guidée')}
          </Button>
        </div>
      </Groupe>
      <Groupe titre={t('Le nom de domaine')}>
        <SectionDomaine etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('GitHub')}>
        <SectionGitHub etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('Votre assistant')}>
        <SectionVotreAssistant />
      </Groupe>
      {/* « Votre ordinateur » (20/11/2026) : l'étape de la mise en route se retrouve ici ; le parcours vit dans la page
          « Extension », qui montre aussi les ordinateurs déjà équipés. */}
      <Groupe titre={t('Votre ordinateur')}>
        <div className="flex flex-wrap items-center gap-3" data-installation-ordinateur>
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-muted">
            {t('Équipez l’ordinateur où les agents travaillent : son navigateur, et sur un Mac l’application Beluga Connect qui fait tout le reste.')}
          </p>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'extension' } }))}
            data-installation-ouvrir-extension
          >
            {t('Installer un ordinateur')}
          </Button>
        </div>
      </Groupe>
      {/* Les mises à jour ont leur page à elles (« Mise à jour », `page-mise-a-jour.tsx`). « Votre propre Beluga » (une
          copie du logiciel sur son GitHub) n'existe plus sur une installation gratuite : Beluga n'est plus distribué
          (fin de la version gratuite, 21/11/2026), la page « Mise à jour » y propose l'offre hébergée. */}
      {state.offreHebergee || nouveautes?.suivi ? null : (
        <Groupe titre={t('Votre propre Beluga')}>
          <SectionCopie etat={etat} relire={relire} />
        </Groupe>
      )}
      <Groupe titre={t('La mémoire')}>
        <SectionMemoire etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('Les courriels')}>
        <SectionCourriels etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('L’espace client')}>
        <SectionEspaceClient etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('Les compétences')}>
        <SectionCompetences etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('Les fonctions en plus')}>
        <SectionFacultatif etat={etat} relire={relire} />
      </Groupe>
      {/* L'ÉQUIPE BELUGA : seulement sur une installation qui la joint. Plus aucun
          ticket ne part d'une installation (fin de la version gratuite, 21/11/2026) :
          le support passe par l'espace client de l'offre hébergée. */}
      {relais?.joint ? (
        <Groupe titre={t('Ce que l’équipe Beluga reçoit')}>
          <SectionPartage />
        </Groupe>
      ) : null}
    </div>
  );
}
