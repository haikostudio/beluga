import { etatDeLIndicateur } from '@beluga/shared';
import { cn } from '@/lib/utils';

/**
 * « QUELQUE CHOSE TRAVAILLE ICI », EN UN POINT.
 *
 * Il remplace le personnage illustré qui s'animait en tête de colonne et dans
 * la conversation d'une carte. UN SEUL composant pour les deux endroits : deux
 * petits mouvements écrits séparément finissent toujours par diverger.
 *
 * Il est DESSINÉ EN CODE, jamais servi en image : remplacer treize fichiers
 * par un quatorzième n'aurait rien allégé.
 *
 * DEUX RÈGLES QU'IL NE FAUT PAS ENFREINDRE :
 *  - `pointer-events-none` : le dépôt d'une carte se résout par ce qui se
 *    trouve SOUS LE DOIGT (`closest('[data-column]')`). L'image qu'il remplace
 *    en était volontairement écartée ; sans cela, un dépôt près du haut d'une
 *    colonne échouerait ;
 *  - `aria-hidden` : purement décoratif. Le travail en cours se lit déjà en
 *    toutes lettres ailleurs — un lecteur d'écran n'a pas à entendre un point.
 *
 * « Je préfère moins d'animations » n'éteint PAS le point : la feuille de
 * style coupe seulement son battement (`prefers-reduced-motion`). Perdre le
 * signal serait perdre l'information.
 */
export function IndicateurActivite({
  cartesAuTravail,
  className,
}: {
  /** Combien de cartes de cette colonne (ou de ce fil) sont tenues par un agent. */
  cartesAuTravail: number;
  className?: string;
}) {
  const etat = etatDeLIndicateur(cartesAuTravail);
  if (etat === 'eteint') return null;
  return (
    <span
      aria-hidden
      data-indicateur-activite={etat}
      className={cn('pointer-events-none relative flex h-2 w-2 shrink-0', className)}
    >
      {/* Le halo qui s'écarte : c'est LUI que « moins d'animations » arrête. */}
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
      {/* Le point, toujours posé : le repère ne disparaît jamais. */}
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}
