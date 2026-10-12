import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { LIBELLE_ETAPE_DE_SUIVI, tonDuSegmentDeSuivi, type EtapeDeSuivi, type SegmentDeSuivi } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA BARRE D'ÉTAPES : UNE RANGÉE DE RONDS, LEUR NOM À CÔTÉ, ET UN RACCOURCI.
 *
 * LES CINQ DE LA FRISE DE « TABLEAUX DE BORD » — Demande, Compréhension,
 * Travail, À déployer, Archivée (`barreDeSuivi`, `shared`) : une carte se lit
 * de la même façon ouverte ou dans la liste.
 *
 * LE DESSIN EST CELUI DE LA MAQUETTE, EN NOIR ET BLANC — plus aucune couleur :
 *  - une étape FAITE : un rond plein, sa coche dedans, son nom en texte plein ;
 *  - l'étape OÙ L'ON EST : un rond cerclé avec un point au centre (une roue
 *    tant que l'agent y travaille, un point d'exclamation quand elle est
 *    tombée), son nom en texte plein ;
 *  - une étape À VENIR : un rond vide et pâle, son nom en gris.
 * Un trait relie deux étapes : plein jusqu'où l'on est arrivé, pâle au-delà.
 *
 * C'est un MOYEN DE NAVIGATION : toucher une étape fait défiler la discussion
 * jusqu'au passage correspondant. L'étape mise en avant suit le passage visible
 * pendant le défilement (`active`) ; elle se dit à voix haute (`aria-current`).
 *
 * SUR TÉLÉPHONE, seul le nom de l'étape mise en avant s'écrit : cinq noms ne
 * tiennent pas sur 390 px. Les ronds, eux, restent tous là. Chaque étape y
 * prend LA PLACE DE SON CONTENU, et les traits se partagent le reste : à
 * largeurs égales, le nom écrit (« Compréhension ») débordait de sa case et
 * recouvrait le rond suivant. Il est aussi un cran plus petit, et se coupe en
 * dernier recours plutôt que de chevaucher.
 */
export function BarreDEtapes({
  segments,
  active,
  courante,
  onAller,
}: {
  segments: SegmentDeSuivi[];
  /** L'étape mise en avant : le point visible, ou l'étape courante. */
  active: EtapeDeSuivi;
  /** L'étape où se trouve la carte (`segmentActifDeSuivi`). */
  courante: EtapeDeSuivi;
  onAller: (etape: EtapeDeSuivi) => void;
}) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Étapes du parcours" data-barre-etapes={active}>
      {segments.map((segment, i) => {
        const estActive = segment.etape === active;
        const ton = tonDuSegmentDeSuivi(segment, courante);
        const dernier = i === segments.length - 1;
        const faite = segment.etat === 'fait' && segment.etape !== courante;
        const ici = segment.etape === courante || segment.etat === 'encours' || segment.etat === 'question' || segment.etat === 'erreur';
        const atteinte = segment.etat !== 'avenir';
        return (
          <li
            key={segment.etape}
            className={cn('flex min-w-0 items-center gap-2 sm:gap-3', dernier ? 'shrink-0' : 'flex-auto sm:flex-1')}
          >
            <button
              type="button"
              data-segment={segment.etape}
              data-segment-etat={segment.etat}
              data-segment-ton={ton}
              /* UNE ÉTAPE NON ATTEINTE LE DIT, au lieu de compter sur le seul
                 gris : son infobulle l'écrit, et le repère suit. La discussion,
                 elle, ne montre plus ce qui n'est pas encore arrivé. */
              data-point-avenir={atteinte ? undefined : ''}
              aria-current={estActive ? 'step' : undefined}
              onClick={() => onAller(segment.etape)}
              title={
                atteinte
                  ? t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])
                  : `${t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])} · ${t('à venir')}`
              }
              className="group flex min-w-0 items-center gap-2 py-1 sm:shrink-0"
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors',
                  faite
                    ? 'bg-text text-bg'
                    : ici && atteinte
                      ? 'border-[1.5px] border-text text-text'
                      : 'border-[1.5px] border-faint/50 text-faint',
                )}
              >
                {faite ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : segment.etat === 'encours' ? (
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
                ) : segment.etat === 'erreur' ? (
                  <span className="text-[11px] font-bold leading-none text-danger">!</span>
                ) : ici && atteinte ? (
                  <span className="h-2 w-2 rounded-full bg-text" />
                ) : null}
              </span>
              <span
                className={cn(
                  'min-w-0 truncate text-[12px] leading-normal transition-colors group-hover:text-text sm:overflow-visible sm:text-[13px] sm:leading-none',
                  atteinte ? 'font-medium text-text' : 'text-faint',
                  !estActive && 'max-sm:hidden',
                )}
              >
                {t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])}
              </span>
            </button>
            {/* Un trait qui porte une information : plein jusqu'où l'on est
                arrivé (`--text`), pâle au-delà. */}
            {dernier ? null : (
              <span aria-hidden className={cn('h-px min-w-2 flex-1', faite ? 'bg-text/60' : 'bg-border')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
