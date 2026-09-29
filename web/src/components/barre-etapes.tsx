import * as React from 'react';
import { LIBELLE_ETAPE_DE_SUIVI, tonDuSegmentDeSuivi, type EtapeDeSuivi, type SegmentDeSuivi, type TonDeSuivi } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ANNEAU_DU_TON, ICONE_DE_L_ETAPE, ICONE_DU_TON, degradeDuTrait } from '@/lib/ton-de-suivi';

/**
 * LA BARRE D'ÉTAPES : CINQ ICÔNES RELIÉES, LEUR NOM DESSOUS, ET UN RACCOURCI.
 *
 * LES CINQ DE LA FRISE DE « TABLEAUX DE BORD » — Demande, Compréhension,
 * Travail, À déployer, Archivée (`barreDeSuivi`, `shared`) : une carte se lit
 * de la même façon ouverte ou dans la liste, et avec le MÊME DESSIN que
 * `FriseDeSuivi` — une icône par étape (`ICONE_DE_L_ETAPE`), reliées par un
 * trait fin en dégradé, bleu jusqu'où l'on a validé, pâle au-delà. Seule différence : ici le nom de chaque étape
 * s'écrit SOUS son rond, puisque le tiroir a la place de le dire.
 *
 * Chaque icône prend le ton de son point, le même que la frise
 * (`tonDuSegmentDeSuivi`) : jaune qui scintille en cours, bleu qui clignote
 * quand un geste est attendu, bleu fixe pour l'étape où se trouve la carte une
 * fois finie, bleu aussi pour ce qui est validé, rouge erreur, pâle à venir ;
 * l'étape mise en avant est une icône plus grosse cerclée. C'est un MOYEN DE NAVIGATION : toucher une
 * étape (rond OU nom — le bouton couvre toute la colonne) fait défiler le
 * flux jusqu'au point correspondant et l'ouvre. L'étape active suit le point
 * visible pendant le défilement.
 *
 * LA BARRE OCCUPE TOUTE LA LARGEUR : le premier rond est posé sur le bord
 * gauche, le dernier sur le bord droit — alignés sur les onglets du dessus —,
 * et les trois autres à 25, 50 et 75 %. Pour cela les colonnes pèsent
 * 1 / 2 / 2 / 2 / 1 : la première et la dernière n'ont qu'une moitié de
 * trait. « Demande » s'aligne à gauche sous son rond, « Archivée » à droite,
 * les noms du milieu restent centrés sous le leur. Le trait entre deux ronds
 * est fait de deux moitiés (droite de l'un, gauche du suivant) qui portent
 * UN SEUL dégradé, de la couleur de gauche vers celle de droite, comme dans
 * la frise : chaque moitié peint le dégradé entier à deux fois sa largeur et
 * n'en montre que sa part (`bg-left` / `bg-right`), si bien que la couleur est
 * la même des deux côtés de la jonction.
 *
 * Sur écran large elle vit en tête de la conversation ; sur téléphone elle
 * est collée sous le titre, seule avec lui.
 */
/** Un trait qui porte une information : `--faint`, jamais `--border`. */
function moitieDeTrait(gauche: TonDeSuivi, droite: TonDeSuivi, cote: 'gauche' | 'droite'): string {
  return cn(degradeDuTrait(gauche, droite), 'bg-[length:200%_100%]', cote === 'gauche' ? 'bg-left' : 'bg-right');
}

export function BarreDEtapes({
  segments,
  active,
  courante,
  onAller,
}: {
  segments: SegmentDeSuivi[];
  /** L'étape mise en avant : le point visible, ou l'étape courante. */
  active: EtapeDeSuivi;
  /** L'étape où se trouve la carte (`segmentActifDeSuivi`) : finie, elle reste bleue. */
  courante: EtapeDeSuivi;
  onAller: (etape: EtapeDeSuivi) => void;
}) {
  return (
    <ol className="flex items-stretch" aria-label="Étapes du parcours" data-barre-etapes={active}>
      {segments.map((segment, i) => {
        const estActive = segment.etape === active;
        const ton = tonDuSegmentDeSuivi(segment, courante);
        const premier = i === 0;
        const dernier = i === segments.length - 1;
        const Icone = ICONE_DE_L_ETAPE[segment.etape];
        const traitAvant = premier ? null : moitieDeTrait(tonDuSegmentDeSuivi(segments[i - 1], courante), ton, 'droite');
        const traitApres = dernier ? null : moitieDeTrait(ton, tonDuSegmentDeSuivi(segments[i + 1], courante), 'gauche');
        return (
          <li
            key={segment.etape}
            // Les extrémités pèsent une demi-colonne : leurs ronds tombent sur
            // les bords, les autres à 25, 50 et 75 %. Leur nom, lui, déborde
            // vers l'intérieur au lieu d'être tronqué.
            className={cn('min-w-0', premier || dernier ? 'relative z-10 flex-1' : 'flex-[2]')}
          >
            <button
              type="button"
              data-segment={segment.etape}
              data-segment-etat={segment.etat}
              data-segment-ton={ton}
              aria-current={estActive ? 'step' : undefined}
              onClick={() => onAller(segment.etape)}
              title={t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])}
              className={cn('group flex w-full flex-col gap-1.5 py-1', premier ? 'items-start' : dernier ? 'items-end' : 'items-stretch')}
            >
              <span className="flex h-3.5 w-full items-center" aria-hidden>
                {premier ? null : <span className={cn('mr-1 h-px min-w-0 flex-1', traitAvant)} />}
                <span
                  className={cn(
                    'flex shrink-0 items-center justify-center rounded-full transition-colors',
                    estActive
                      ? cn('h-3.5 w-3.5 ring-2', ton === 'avenir' ? 'text-text' : ICONE_DU_TON[ton], ANNEAU_DU_TON[ton])
                      : cn('h-3 w-3', ICONE_DU_TON[ton]),
                  )}
                >
                  <Icone className={estActive ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2.25} />
                </span>
                {dernier ? null : <span className={cn('ml-1 h-px min-w-0 flex-1', traitApres)} />}
              </span>
              <span
                className={cn(
                  'block text-[11px] leading-none transition-colors group-hover:text-text',
                  premier
                    ? 'whitespace-nowrap text-left'
                    : dernier
                      ? 'whitespace-nowrap text-right'
                      : cn(
                          'truncate px-1 text-center',
                          // Sur téléphone, « Demande » et « Archivée » débordent de
                          // leur demi-colonne : leurs voisins leur laissent la place
                          // (à 360 px, « Demande » mordait de 8 px sur « Compréhension »).
                          i === 1 && 'max-sm:pl-4',
                          i === segments.length - 2 && 'max-sm:pr-4',
                        ),
                  estActive ? 'font-semibold text-text' : segment.etat === 'avenir' ? 'text-faint' : 'text-muted',
                )}
              >
                {t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
