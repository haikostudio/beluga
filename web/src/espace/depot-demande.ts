/**
 * OÙ TOMBE UNE VIGNETTE — ET RIEN D'AUTRE.
 *
 * LE GESTE N'EST PLUS ÉCRIT ICI. Il vient de `usePointerDrag` (`@/lib/dnd`),
 * exactement celui du tableau des cartes : appui maintenu au doigt, prise
 * immédiate à la souris, seuil de quelques pixels avant qu'un clic ne devienne
 * un glissement, et défilement du navigateur retenu par un écouteur `touchmove`
 * NON PASSIF tant qu'on porte. Trois cents lignes de geste en double ont
 * disparu : une seule mécanique à corriger le jour où elle bougera.
 *
 * NE RESTE QUE LA LECTURE DE LA CIBLE, propre à l'espace client : le tableau
 * des cartes ne dépose que DANS une colonne, ici on dépose aussi ENTRE deux
 * vignettes. Le rang reste le nombre flottant calculé au SERVEUR (`rangEntre`)
 * à partir des deux voisines — aucune renumérotation à l'écran.
 */
import type { ColonneDemande } from '@beluga/shared';

/** Où la vignette tombera si on la lâche maintenant. */
export interface CibleDeDepot {
  colonne: ColonneDemande;
  /** Les deux voisines d'arrivée : c'est ce que le serveur attend. */
  avantId?: string;
  apresId?: string;
}

/**
 * LE TEMPS D'APPUI QUI ARME LE GLISSER, au doigt. Assez long pour qu'un
 * défilement du rail parte sans être confisqué, assez court pour qu'on ne se
 * demande pas si le téléphone a compris. À la souris, aucun délai.
 */
export const DELAI_APPUI_LONG = 400;

/**
 * LA CIBLE SOUS LE POINTEUR. On cherche la colonne d'abord (elle porte
 * `data-colonne-kanban`), puis la place dans cette colonne en comparant le
 * pointeur au MILIEU de chaque vignette : au-dessus du milieu on se glisse
 * avant, en dessous après. Viser la tête de colonne pose donc la vignette en
 * PREMIER, viser le vide sous la dernière la pose en DERNIER.
 */
export function cibleDeDepot(element: Element, y: number, idTenu: string | null): CibleDeDepot | null {
  const colonneEl = element.closest('[data-colonne-kanban]') as HTMLElement | null;
  if (!colonneEl) return null;
  const colonne = colonneEl.dataset.colonneKanban as ColonneDemande;

  const vignettes = [...colonneEl.querySelectorAll('[data-demande]')].filter(
    (el) => (el as HTMLElement).dataset.demande !== idTenu,
  ) as HTMLElement[];

  let avantId: string | undefined;
  let apresId: string | undefined;
  for (const vignette of vignettes) {
    const boite = vignette.getBoundingClientRect();
    if (y < boite.top + boite.height / 2) {
      apresId = vignette.dataset.demande;
      break;
    }
    avantId = vignette.dataset.demande;
  }
  return { colonne, avantId, apresId };
}
