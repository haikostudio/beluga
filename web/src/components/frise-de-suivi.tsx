import * as React from 'react';
import { LIBELLE_ETAPE_DE_SUIVI, tonDeLEtapeDeSuivi, type FriseDeSuivi as Frise } from '@beluga/shared';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ANNEAU_DU_TON, ROND_DU_TON, TRAIT_DU_TON } from '@/lib/ton-de-suivi';

/**
 * LA FRISE DES CINQ ÉTAPES D'UNE CARTE — Demande, Compréhension, Travail,
 * À déployer, Archivée —, posée dans le corps des cartes de « Tableaux de
 * bord » (jamais au tableau d'un projet, où la rangée dit déjà l'étape).
 *
 * Cinq ronds reliés, sans texte : BLEU pour ce qui est validé (le rond et le
 * trait qui y mène), la courante mise en avant — JAUNE qui scintille quand un
 * agent y travaille ou que la mise en ligne l'emporte, BLEU qui clignote quand
 * c'est fini et qu'elle attend votre geste, bleu fixe quand c'est fini sans
 * rien attendre, rouge quand sa mise en ligne est tombée —, pâle pour ce qui
 * vient (`tonDeLEtapeDeSuivi`, dessin dans `ton-de-suivi.ts`). Le nom de chaque
 * étape se lit au survol et à la lecture d'écran. La règle est partagée
 * (`shared/src/frise-de-suivi.ts`) ; ici, seulement le dessin.
 */
export function FriseDeSuivi({ frise, cardId }: { frise: Frise; cardId: string }) {
  const courante = t(LIBELLE_ETAPE_DE_SUIVI[frise.courante]);
  return (
    <div
      className="mt-3 flex h-3.5 shrink-0 items-center"
      role="img"
      aria-label={t('Étape : {v0}', { v0: courante })}
      data-frise-suivi={cardId}
      data-frise-courante={frise.courante}
      data-frise-allure={frise.allure}
    >
      {frise.etapes.map(({ etape, etat }, i) => {
        const libelle = t(LIBELLE_ETAPE_DE_SUIVI[etape]);
        const ton = tonDeLEtapeDeSuivi(frise, etape);
        return (
          <React.Fragment key={etape}>
            {i > 0 ? (
              /* Un trait qui porte une information : `--faint`, jamais `--border`. */
              <span aria-hidden className={cn('mx-1 h-px min-w-0 flex-1', TRAIT_DU_TON[ton])} />
            ) : null}
            <Tooltip label={libelle}>
              <span
                data-etape-suivi={etape}
                data-etat-suivi={etat}
                data-ton-suivi={ton}
                className={cn(
                  'shrink-0 rounded-full',
                  ROND_DU_TON[ton],
                  etat === 'courant' ? cn('h-2.5 w-2.5 ring-2 ring-offset-0', ANNEAU_DU_TON[ton]) : 'h-1.5 w-1.5',
                )}
              />
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}
