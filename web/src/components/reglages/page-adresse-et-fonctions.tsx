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
  SectionMemoire,
  useEtatDeLInstallation,
} from '@/components/installation/sections';
import { SectionPartage, useEtatDuRelais } from '@/components/installation/relais';
import { useApp } from '@/lib/use-app';
import { useNouveautes } from '@/lib/travail-installation';
import { t } from '@/lib/langue';

/**
 * CE QUE L'ASSISTANT DE PREMIER DÉMARRAGE DEMANDAIT, RANGÉ DANS LA RUBRIQUE « SERVEUR » (refonte des réglages,
 * 21/11/2026). L'ancienne page fourre-tout « Installation » (douze sections) est éclatée :
 *  - « Adresse et courriels » : le nom de domaine et les courriels — l'adresse `#reglages/installation` y mène ;
 *  - « Fonctions » : la copie du logiciel, la mémoire, l'espace client, les compétences, les fonctions facultatives,
 *    et ce que l'équipe Beluga reçoit (seulement sur une installation qui la joint).
 * Ses doublons sont retirés : GitHub (page « GitHub » de Connexions), « Votre assistant » (page « Assistant et
 * voix »), « Votre ordinateur » (rubrique Ordinateurs) ; la visite guidée est passée dans « Mon compte ».
 * Ce sont les MÊMES composants que dans l'assistant (`installation/sections.tsx`) : mêmes champs, mêmes gestes.
 */
function Remises() {
  const state = useApp();
  const remises = etapesRemisesAPlusTard(state.settings?.assistant as EtatDeLAssistant | undefined, state.offreHebergee);
  if (!remises.length) return null;
  return (
    <p className="px-1 text-[13.5px] leading-relaxed text-muted" data-installation-remises={remises.join(' ')}>
      {t('{n} page(s) de la mise en route ont été remises à plus tard : elles se règlent ci-dessous.', { n: String(remises.length) })}
    </p>
  );
}

export function PageAdresseEtCourriels() {
  const { etat, relire } = useEtatDeLInstallation();
  return (
    <div className="flex flex-col gap-7" data-page-reglages-adresse>
      <Remises />
      <Groupe titre={t('Le nom de domaine')}>
        <SectionDomaine etat={etat} relire={relire} />
      </Groupe>
      <Groupe titre={t('Les courriels')}>
        <SectionCourriels etat={etat} relire={relire} />
      </Groupe>
    </div>
  );
}

export function PageFonctions() {
  const state = useApp();
  const { etat, relire } = useEtatDeLInstallation();
  const relais = useEtatDuRelais();
  const nouveautes = useNouveautes();
  return (
    <div className="flex flex-col gap-7" data-page-reglages-fonctions>
      {/* « Votre propre Beluga » n'existe plus sur une installation gratuite (fin de la version gratuite, 21/11/2026). */}
      {state.offreHebergee || nouveautes?.suivi ? null : (
        <Groupe titre={t('Votre propre Beluga')}>
          <SectionCopie etat={etat} relire={relire} />
        </Groupe>
      )}
      <Groupe titre={t('La mémoire')}>
        <SectionMemoire etat={etat} relire={relire} />
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
      {relais?.joint ? (
        <Groupe titre={t('Ce que l’équipe Beluga reçoit')}>
          <SectionPartage />
        </Groupe>
      ) : null}
    </div>
  );
}
