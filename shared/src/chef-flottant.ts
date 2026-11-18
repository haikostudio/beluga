import { BAS_ROBOT, HAUT_ENTETE, ROND_ROBOT } from './assistant-global.js';
import { MARGE_CHAT } from './chat-flottant.js';

/**
 * LE CHEF DE COMMUNICATION EN FENÊTRE FLOTTANTE (carte « Refonte de l'espace Médias », 05/11/2026, capture #52ae) :
 * sur ordinateur, la colonne du chef quitte la gauche de l'espace ; un rond violet en bas à droite ouvre sa
 * conversation dans une fenêtre posée AU-DESSUS DE TOUT (tiroirs et aperçus compris), qu'on agrandit par son coin.
 * Cette règle pure dit sa taille : celle retenue, bornée par l'écran, jamais sous un minimum lisible.
 */
export const CHEF_FLOTTANT = {
  /** Distance du rond et de la fenêtre au bord droit. */
  droite: 20,
  /** Écart entre le haut du rond et le bas de la fenêtre. */
  ecart: 12,
  largeur: 420,
  hauteur: 640,
  largeurMin: 340,
  hauteurMin: 360,
} as const;

/** La distance du bas de la fenêtre au bas de l'écran : au-dessus du rond. */
export const BAS_DU_CHEF_FLOTTANT = BAS_ROBOT + ROND_ROBOT + CHEF_FLOTTANT.ecart;
