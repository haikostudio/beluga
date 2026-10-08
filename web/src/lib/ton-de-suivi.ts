import { Archive, Hammer, LayoutList, Lightbulb, MessageSquare, Rocket, ScanSearch, type LucideIcon } from 'lucide-react';
import type { EtapeDeSuivi, TonDeSuivi } from '@beluga/shared';

/**
 * LE DESSIN DE CHAQUE TON DE LA FRISE ET DE LA BARRE D'ÉTAPES (`TonDeSuivi`,
 * `shared/src/frise-de-suivi.ts`) — une seule table pour les deux, qui ne
 * peuvent donc plus diverger. Jaune qui SCINTILLE pendant le travail, bleu qui
 * CLIGNOTE quand c'est fini et qu'un geste est attendu, bleu fixe sinon — y
 * compris ce qui est validé (plus de vert : retour au bleu « terminé »).
 *
 * Chaque étape se dessine par SON ICÔNE (`ICONE_DE_L_ETAPE`), teintée par
 * `ICONE_DU_TON` ; le trait entre deux étapes est un DÉGRADÉ de la couleur de
 * gauche vers celle de droite (`DEGRADE_DEPUIS_TON` → `DEGRADE_VERS_TON`).
 * Les classes sont écrites en toutes lettres : Tailwind ne voit pas une
 * classe calculée.
 */

/** L'icône qui dit l'étape d'un coup d'œil. */
export const ICONE_DE_L_ETAPE: Record<EtapeDeSuivi, LucideIcon> = {
  demande: MessageSquare,
  comprehension: Lightbulb,
  travail: Hammer,
  a_deployer: Rocket,
  archivee: Archive,
  /* Les deux étapes propres à la carte du rendez-vous de nuit. */
  examen: ScanSearch,
  propositions: LayoutList,
};

/**
 * La teinte ET le mouvement d'une icône d'étape : bleu, jaune qui scintille,
 * bleu qui clignote, rouge, pâle — portés par la couleur du trait de l'icône. Le mouvement se pose sur le
 * conteneur arrondi de l'icône (le halo du scintillement suit son rond).
 */
export const ICONE_DU_TON: Record<TonDeSuivi, string> = {
  valide: 'text-termine',
  fini: 'text-termine',
  a_voir: 'text-termine animate-clignote',
  travail: 'text-travail animate-scintille',
  erreur: 'text-danger',
  neutre: 'text-text',
  // Un trait d'icône est plus fin qu'un rond plein : un peu plus d'opacité.
  avenir: 'text-faint/60',
};

/** Le départ du dégradé d'un trait (couleur de l'étape de GAUCHE). Un trait qui porte une information : `--faint`, jamais `--border`. */
export const DEGRADE_DEPUIS_TON: Record<TonDeSuivi, string> = {
  valide: 'from-termine/70',
  fini: 'from-termine/70',
  a_voir: 'from-termine/70',
  travail: 'from-travail/70',
  erreur: 'from-danger/70',
  neutre: 'from-faint/35',
  avenir: 'from-faint/35',
};

/** L'arrivée du dégradé d'un trait (couleur de l'étape de DROITE). */
export const DEGRADE_VERS_TON: Record<TonDeSuivi, string> = {
  valide: 'to-termine/70',
  fini: 'to-termine/70',
  a_voir: 'to-termine/70',
  travail: 'to-travail/70',
  erreur: 'to-danger/70',
  neutre: 'to-faint/35',
  avenir: 'to-faint/35',
};

/** Le trait entre deux étapes : un dégradé de `gauche` vers `droite`, sans le mouvement. */
export function degradeDuTrait(gauche: TonDeSuivi, droite: TonDeSuivi): string {
  return `bg-gradient-to-r ${DEGRADE_DEPUIS_TON[gauche]} ${DEGRADE_VERS_TON[droite]}`;
}

/** Le halo autour de l'étape mise en avant. */
export const ANNEAU_DU_TON: Record<TonDeSuivi, string> = {
  valide: 'ring-termine/25',
  fini: 'ring-termine/25',
  a_voir: 'ring-termine/25',
  travail: 'ring-travail/25',
  erreur: 'ring-danger/25',
  neutre: 'ring-faint/25',
  avenir: 'ring-faint/25',
};
