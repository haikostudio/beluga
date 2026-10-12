import * as React from 'react';
import { LIBELLE_ETAPE_DE_SUIVI, tonDeLEtapeDeSuivi, type FriseDeSuivi as Frise } from '@beluga/shared';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA FRISE DES ÉTAPES D'UNE CARTE — Demande, Compréhension, Travail,
 * À déployer, Archivée —, posée dans le corps des cartes de « Tableaux de
 * bord » (jamais au tableau d'un projet, où la colonne dit déjà l'étape).
 *
 * DES POINTS RELIÉS, EN NOIR ET BLANC, comme sur la maquette des cartes :
 *  - une étape FAITE : un point plein ;
 *  - l'étape OÙ L'ON EST : un point cerclé, plus marqué — il bat doucement
 *    tant qu'un agent y travaille, et vire au rouge si elle est tombée ;
 *  - une étape À VENIR : un point vide et pâle.
 * Le trait entre deux points est plein jusqu'où l'on est arrivé, pâle au-delà.
 * Le nom de chaque étape se lit au survol et à la lecture d'écran. La règle est
 * partagée (`shared/src/frise-de-suivi.ts`) ; ici, seulement le dessin.
 */
export function FriseDeSuivi({ frise, cardId }: { frise: Frise; cardId: string }) {
  const courante = t(LIBELLE_ETAPE_DE_SUIVI[frise.courante]);
  return (
    <div
      className="mt-3 flex h-3.5 shrink-0 items-center"
      role="img"
      aria-label={`Etape : ${frise.courante}`}
      title={t('Étape : {v0}', { v0: courante })}
      data-frise-suivi={cardId}
      data-frise-courante={frise.courante}
      data-frise-allure={frise.allure}
    >
      {frise.etapes.map(({ etape, etat }, i) => {
        const libelle = t(LIBELLE_ETAPE_DE_SUIVI[etape]);
        const ton = tonDeLEtapeDeSuivi(frise, etape);
        const faite = etat === 'fait';
        const ici = etat === 'courant';
        return (
          <React.Fragment key={etape}>
            {i > 0 ? (
              /* Un trait qui porte une information : `--faint`, jamais `--border`. */
              <span aria-hidden className={cn('mx-1 h-px min-w-0 flex-1', faite || ici ? 'bg-text/45' : 'bg-faint/30')} />
            ) : null}
            <Tooltip label={libelle}>
              <span
                data-etape-suivi={etape}
                data-etat-suivi={etat}
                data-ton-suivi={ton}
                className={cn(
                  'block h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px]',
                  faite
                    ? 'border-text bg-text'
                    : ici
                      ? cn(
                          ton === 'erreur' ? 'border-danger' : 'border-text',
                          (ton === 'travail' || ton === 'a_voir') && 'animate-pulse-soft motion-reduce:animate-none',
                        )
                      : 'border-faint/50',
                )}
              />
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}
