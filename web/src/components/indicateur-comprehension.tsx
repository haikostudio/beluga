import * as React from 'react';
import { type Card, indicateurDeComprehension } from '@beluga/shared';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * L'INDICATEUR DE COMPRÉHENSION — TROIS BARRES, ET PAS UN MOT À L'ÉCRAN.
 *
 * Le relecteur automatique écrivait quatre messages : un avertissement sur la
 * description au-dessus du lancement, un effort proposé, un avis sur le plan,
 * un avis sur le compte rendu. Les jugements réellement rendus les ont
 * condamnés — l'avertissement portait neuf fois sur dix sur un CHAMP vide, pas
 * sur une demande mince. Tout cela est remplacé par CE SEUL SIGNAL, muet :
 * une jauge de réseau posée EN TÊTE DU GROUPE DE BOUTONS DE DROITE de la barre
 * d'écriture — avant le carré d'arrêt —, qui note ce que l'agent a COMPRIS —
 * le dossier réel que recevra celui qui exécutera. Cette place est fixe : les
 * boutons qui la suivent vont et viennent selon le tour, elle non.
 *
 * UNE barre rouge, DEUX jaune, TROIS vert, et une phrase courte AU SURVOL qui
 * dit ce qui manque. Les couleurs passent par les jetons du thème
 * (`--danger`, `--warning`, `--success`, `--faint`) : elles suivent donc les
 * douze palettes sans en coder aucune en dur.
 *
 * IL EST TOUJOURS LÀ TANT QUE LA CARTE SE DISCUTE : trois barres éteintes
 * tant qu'aucune note n'est rendue (`data-indicateur-comprehension="0"`), puis
 * la note de Laya, redonnée à chaque échange — la jauge se remplit à
 * mesure que la discussion avance. Il ne s'efface qu'une fois le travail parti.
 *
 * IL NE BLOQUE JAMAIS LE LANCEMENT (`DEC-239`) : il n'éteint aucun bouton,
 * n'efface aucun texte et ne retient aucune carte.
 */

/** Les trois hauteurs de la jauge, de la plus courte à la plus haute. */
const HAUTEURS = ['h-1.5', 'h-2.5', 'h-3.5'] as const;

/** La couleur des barres allumées, par nombre de barres. */
const TEINTES: Record<0 | 1 | 2 | 3, string> = {
  0: 'bg-faint/35',
  1: 'bg-danger',
  2: 'bg-warning',
  3: 'bg-success',
};

/**
 * LA PHRASE DE TÊTE DU SURVOL. Écrite en appels `t(…)` LITTÉRAUX, et non
 * rangée dans une table : c'est ce que la chasse au français en dur sait lire
 * (`scripts/passer-les-textes-en-traduction.mjs`), et ce qui garantit les cinq
 * langues.
 */
function titreDuNiveau(barres: 0 | 1 | 2 | 3): string {
  if (barres === 0) return t('Qualité de la discussion');
  if (barres === 1) return t('Compréhension insuffisante');
  if (barres === 2) return t('Compréhension partielle');
  return t('Compréhension suffisante');
}

export function IndicateurComprehension({ carte }: { carte?: Card | null }) {
  const lu = carte ? indicateurDeComprehension(carte) : undefined;
  if (!lu) return null;
  return (
    <Tooltip label={`${titreDuNiveau(lu.barres)} — ${t(lu.phrase)}`}>
      {/*
       * L'ÉTAT SE LIT SUR L'ATTRIBUT, jamais sur une hauteur en pixels : un
       * contrôle navigateur qui mesurerait les barres casserait à la première
       * retouche d'affichage (compétence `verifs-navigateur-etat-plutot-que-hauteur`).
       */}
      <span
        data-indicateur-comprehension={String(lu.barres)}
        role="img"
        className="flex h-7 w-6 shrink-0 items-end justify-center gap-[2px] px-0.5 pb-1.5"
      >
        {HAUTEURS.map((hauteur, rang) => (
          <span
            key={hauteur}
            className={cn(
              'w-[3px] rounded-[1px]',
              hauteur,
              rang < lu.barres ? TEINTES[lu.barres] : 'bg-faint/35',
            )}
          />
        ))}
      </span>
    </Tooltip>
  );
}
