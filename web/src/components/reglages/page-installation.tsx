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
import { SectionContacterLEquipe, SectionPartage, useEtatDuRelais } from '@/components/installation/relais';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
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
      {/* Les mises à jour ont leur page à elles (« Mise à jour », `page-mise-a-jour.tsx`). */}
      {state.offreHebergee ? null : (
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
      {/* L'ÉQUIPE BELUGA : seulement sur une installation qui la joint. L'offre
          hébergée garde le signe de vie, mais ses utilisateurs écrivent par leur
          espace client, pas par un ticket open source. */}
      {relais?.joint ? (
        <>
          <Groupe titre={t('Ce que l’équipe Beluga reçoit')}>
            <SectionPartage />
          </Groupe>
          {relais.hebergee ? null : (
            <Groupe titre={t('Contacter l’équipe Beluga')}>
              <SectionContacterLEquipe />
            </Groupe>
          )}
        </>
      ) : null}
    </div>
  );
}
