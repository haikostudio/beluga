import * as React from 'react';
import { MessageSquare, Route, TriangleAlert } from 'lucide-react';
import { type IconeDAttention } from '@beluga/shared';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE MÊME triangle orange, partout où une décision attend.
 *
 * La ligne du projet annonçait « 4 décisions attendues de votre part » et
 * c'était tout : ni la carte, ni la conversation ne portaient quoi que ce soit.
 * Un chiffre sans destination. Ce composant est le repère unique — pas un
 * nouveau genre d'alerte, exactement celui de la colonne de gauche — qu'on pose
 * désormais sur CHAQUE endroit où la décision se prend.
 *
 * Il dit toujours ce qu'il veut dire, en français simple : infobulle à la
 * souris, `aria-label` pour la lecture d'écran.
 *
 * DEPUIS QUE LES GESTES ATTENDUS COMPTENT AUSSI, le dessin suit la NATURE de
 * ce qui attend — message pour une question, chemin pour un plan à générer ou
 * à valider, triangle pour ce qui bloque. La table qui choisit est partagée
 * (`shared/src/nature-attention.ts`), et c'est la même que lisent la ligne du
 * projet et la cloche : les trois ne peuvent pas diverger.
 *
 * Deux endroits avaient BESOIN d'un rendu légèrement différent — cliquable
 * pour emmener vers la décision, ou en pastille pour s'incruster sur un
 * favicon — au lieu de le redessiner à la main : `onClick` et `badge` sont
 * pour eux, la couleur et le choix du dessin restent écrits une seule fois.
 */
export function libelleAttention(compte: number): string {
  return compte > 1 ? t('{compte} décisions attendues de votre part', { compte }) : t('Une décision attendue de votre part');
}

export function RepereAttention({
  compte,
  icone,
  libelle: libelleForce,
  className,
  onClick,
  badge,
  vif,
  ...rest
}: {
  compte: number;
  /** La nature de ce qui attend. Absente : le triangle, comme avant. */
  icone?: IconeDAttention | null;
  /** Ce que l'infobulle dit, quand on sait mieux que « une décision attendue ». */
  libelle?: string;
  className?: string;
  /**
   * Rend un bouton cliquable qui emmène vers la décision, au lieu d'un
   * simple repère. Coupe la propagation du geste (glissement de la ligne
   * porteuse) avant d'agir.
   */
  onClick?: () => void;
  /**
   * La pastille du bandeau « agent au travail » : une incrustation sur le
   * favicon du projet, pas le triangle interactif — elle ne porte donc pas
   * `data-signal-attention` (les contrôles compteraient deux repères pour la
   * même décision). `mini` bascule vers la pastille pleine du coin, posée en
   * colonne réduite.
   */
  badge?: { mini: boolean };
  /**
   * L'ATTENTE EST ACTUELLE : un agent est arrêté, là, maintenant, sur cette
   * question. Le repère prend alors le ton d'une décision attendue au lieu du
   * gris du texte, pour qu'on le voie du premier coup d'œil.
   */
  vif?: boolean;
} & React.HTMLAttributes<HTMLSpanElement>) {
  if (compte <= 0) return null;
  const libelle = libelleForce ?? libelleAttention(compte);
  const Dessin = icone === 'message' ? MessageSquare : icone === 'plan' ? Route : TriangleAlert;
  const couleur = icone && icone !== 'triangle' && !vif ? 'text-text' : 'text-warning';

  if (badge) {
    const { mini } = badge;
    return (
      <Tooltip label={libelle}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && 'absolute -right-[7px] -top-[6px] flex h-3 w-3 items-center justify-center rounded-full bg-warning shadow-sm',
          )}
          data-repere-robot
          data-signal-nature={icone ?? 'triangle'}
          aria-label={libelle}
        >
          <Dessin className={cn('shrink-0', mini ? 'h-2 w-2 text-sur-etat' : cn('h-[15px] w-[15px]', couleur))} />
        </span>
      </Tooltip>
    );
  }

  if (onClick) {
    return (
      <Tooltip label={libelle}>
        <button
          // Le glissement part de la poignée ; on coupe ici, sinon un appui
          // sur le repère embarquerait la ligne.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          aria-label={libelle}
          data-signal-attention
          data-signal-nature={icone ?? 'triangle'}
          /* L'ancien repère de plan gardait ce marqueur : il change de source,
             pas d'apparence. */
          data-repere-plan={icone === 'plan' || undefined}
          className={cn('shrink-0', couleur, className)}
        >
          <Dessin className="h-3 w-3" />
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={libelle}>
      <span
        data-signal-attention
        data-signal-nature={icone ?? 'triangle'}
        /* L'ancien repère de plan gardait ce marqueur : il change de source,
           pas d'apparence. */
        data-repere-plan={icone === 'plan' || undefined}
        aria-label={libelle}
        className={cn('inline-flex shrink-0 items-center', couleur, className)}
        {...rest}
      >
        <Dessin className="h-3 w-3" />
      </span>
    </Tooltip>
  );
}
