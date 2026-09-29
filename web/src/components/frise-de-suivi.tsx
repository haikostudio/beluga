import * as React from 'react';
import { LIBELLE_ETAPE_DE_SUIVI, tonDeLEtapeDeSuivi, type FriseDeSuivi as Frise } from '@beluga/shared';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ANNEAU_DU_TON, ICONE_DE_L_ETAPE, ICONE_DU_TON, degradeDuTrait } from '@/lib/ton-de-suivi';

/**
 * LA FRISE DES CINQ ÉTAPES D'UNE CARTE — Demande, Compréhension, Travail,
 * À déployer, Archivée —, posée dans le corps des cartes de « Tableaux de
 * bord » (jamais au tableau d'un projet, où la rangée dit déjà l'étape).
 *
 * Cinq icônes reliées, sans texte — une par étape (`ICONE_DE_L_ETAPE`) :
 * BLEU pour ce qui est validé, la courante mise en avant (plus grande, cerclée) — JAUNE qui scintille quand un
 * agent y travaille ou que la mise en ligne l'emporte, BLEU qui clignote quand
 * c'est fini et qu'elle attend votre geste, bleu fixe quand c'est fini sans
 * rien attendre, rouge quand sa mise en ligne est tombée —, pâle pour ce qui
 * vient (`tonDeLEtapeDeSuivi`, dessin dans `ton-de-suivi.ts`). Le trait entre
 * deux étapes est un DÉGRADÉ de la couleur de gauche vers celle de droite. Le nom de chaque
 * étape se lit au survol et à la lecture d'écran. La règle est partagée
 * (`shared/src/frise-de-suivi.ts`) ; ici, seulement le dessin.
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
        const Icone = ICONE_DE_L_ETAPE[etape];
        return (
          <React.Fragment key={etape}>
            {i > 0 ? (
              /* Un trait qui porte une information : `--faint`, jamais `--border`. */
              <span
                aria-hidden
                className={cn(
                  'mx-1 h-px min-w-0 flex-1',
                  degradeDuTrait(tonDeLEtapeDeSuivi(frise, frise.etapes[i - 1].etape), ton),
                )}
              />
            ) : null}
            <Tooltip label={libelle}>
              <span
                data-etape-suivi={etape}
                data-etat-suivi={etat}
                data-ton-suivi={ton}
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full',
                  ICONE_DU_TON[ton],
                  etat === 'courant' ? cn('h-3.5 w-3.5 ring-2 ring-offset-0', ANNEAU_DU_TON[ton]) : 'h-3 w-3',
                )}
              >
                <Icone aria-hidden className={etat === 'courant' ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2.25} />
              </span>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}
