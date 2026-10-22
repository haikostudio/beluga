/**
 * LES MESURES COMMUNES DES FENÊTRES DE CHAT — celles que l'assistant global
 * (`shared/src/assistant-global.ts`) borne à l'écran. Le chat flottant propre
 * à l'écran Marketing a disparu (20/10/2026 : un seul robot dans
 * l'application) ; seules restent ici les bornes et le partage
 * téléphone / ordinateur.
 */

/** Ce qu'on garde du bord de l'écran, en pixels, pour rester attrapable. */
export const MARGE_CHAT = 8;
export const LARGEUR_CHAT_MIN = 300;
export const LARGEUR_CHAT_MAX = 760;
export const HAUTEUR_CHAT_MIN = 320;
/** En dessous de cette largeur d'écran, le chat occupe presque tout l'écran. */
export const LARGEUR_TELEPHONE = 640;

export interface ChatFlottant {
  ouvert: boolean;
  /** Distance du bord droit de la fenêtre, en pixels. */
  droite: number;
  /** Distance du bord bas de la fenêtre, en pixels. */
  bas: number;
  largeur: number;
  hauteur: number;
}

export interface FenetreChat {
  width: number;
  height: number;
}

export function estTelephoneChat(fenetre: FenetreChat): boolean {
  return fenetre.width < LARGEUR_TELEPHONE;
}
