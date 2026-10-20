import { cn } from '@/lib/utils';

/**
 * LA BANDE SOUS L'HEURE : CE QUI ÉTEINT LE FLOU D'iOS 26/27 (19/10/2026).
 *
 * Installée en `black-translucent`, l'application passe sous l'heure et iOS y
 * pose son « scroll edge effect », un flou qui masquait le haut du tableau de
 * bord. La page Notifications, elle, n'en avait PAS : c'était une page ouverte
 * par-dessus (`FeuilleDeTiroir`), FIXE et OPAQUE jusqu'au bord du haut. WebKit
 * échantillonne un tel élément fixe collé au bord (« fixed container edges ») :
 * il teinte la bande de l'heure de sa couleur et renonce au flou. Le tableau,
 * lui, est en flux normal (la racine ne s'ancre jamais aux quatre bords) :
 * rien de fixe en haut, donc le flou.
 *
 * Cette bande donne à chaque zone ce que la page Notifications avait : un
 * élément fixe, opaque, de la hauteur de la zone sûre du haut, peint du fond
 * EXACT de sa zone (`--fond-zone`, hérité du repère `data-zone` qui l'entoure)
 * — invisible, donc, jamais un bandeau d'une autre couleur. Hors iPhone
 * installé, la zone sûre vaut 0 et la bande n'a aucune hauteur.
 *
 * RANG 30 : au-dessus du contenu des zones, sous tout ce qui s'ouvre par-dessus
 * (pages en `z-40`/`z-50`, voiles, panneau des projets en `z-[55]`), qui
 * portent déjà leur propre fond jusqu'en haut.
 *
 * À CONFIRMER SUR L'IPHONE : l'émulation ne montre pas le flou. Si la bande ne
 * suffit pas, faire porter ce fond à la barre d'en-tête, rendue fixe jusqu'au bord.
 */
export function BandeSousLHeure({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-bande-sous-l-heure
      className={cn('fond-de-zone pointer-events-none fixed top-0 z-30', className)}
      style={{ height: 'var(--zone-sure-haut, 0px)' }}
    />
  );
}
