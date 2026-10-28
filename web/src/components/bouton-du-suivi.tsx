import * as React from 'react';
import { Clapperboard } from 'lucide-react';
import { CLASSE_BLOC_DU_PIED } from '@/components/ui';
import { useDocumentDeCarte } from '@/lib/document-de-carte';
import { fermerLeSuivi, ouvrirLeSuivi } from '@/lib/suivi-de-carte';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE BOUTON « SUIVI », EN BAS À DROITE DE LA CONVERSATION (28/10/2026 : « en
 * bas à droite, au-dessus de ce que l'agent a vu, un bouton qui permet de le
 * rouvrir et de le fermer »). Sur ordinateur seulement — sur téléphone, le
 * chemin du tournage garde son propre bouton, qui ouvre la feuille du bas.
 * Allumé (violet, `aria-pressed`) tant que le suivi est ouvert ; chaque geste
 * est gardé pour CETTE carte (`suivi-de-carte.ts`), rechargement compris.
 */
export function BoutonDuSuivi({ cardId }: { cardId: string }) {
  const document = useDocumentDeCarte(cardId);
  const ouvert = document?.genre === 'suivi';
  return (
    <div className={cn(CLASSE_BLOC_DU_PIED, 'flex justify-end')} data-bloc-du-pied="suivi">
      <button
        type="button"
        onClick={() => (ouvert ? fermerLeSuivi(cardId) : ouvrirLeSuivi(cardId))}
        aria-pressed={ouvert}
        title={ouvert ? t('Fermer le suivi de la production') : t('Ouvrir le suivi de la production')}
        data-basculer-le-suivi={ouvert ? 'ouvert' : 'ferme'}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors',
          ouvert ? 'bg-raised text-teinte' : 'text-muted hover:bg-raised hover:text-text',
        )}
      >
        <Clapperboard className="h-3.5 w-3.5" />
        {t('Suivi')}
      </button>
    </div>
  );
}
