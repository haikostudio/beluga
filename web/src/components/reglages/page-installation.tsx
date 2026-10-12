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
  SectionNouveautes,
  useEtatDeLInstallation,
} from '@/components/installation/sections';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

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
  const remises = etapesRemisesAPlusTard(state.settings?.assistant as EtatDeLAssistant | undefined);

  return (
    <div className="space-y-7" data-page-installation="reglages">
      {remises.length ? (
        <p className="text-[13.5px] leading-relaxed text-muted" data-installation-remises={remises.join(' ')}>
          {t('{n} page(s) de la mise en route ont été remises à plus tard : elles se règlent ci-dessous.', { n: String(remises.length) })}
        </p>
      ) : null}
      <Groupe titre={t('Le nom de domaine')}>
        <SectionDomaine etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('GitHub')}>
        <SectionGitHub etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('Votre propre Beluga')}>
        <SectionCopie etat={etat} relire={relire} />
        <SectionNouveautes />
      </Groupe>
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
    </div>
  );
}
