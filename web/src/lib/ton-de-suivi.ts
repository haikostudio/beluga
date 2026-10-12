import { Archive, CircleCheck, ClipboardList, FolderPlus, Hammer, LayoutList, Lightbulb, MessageSquare, Rocket, ScanSearch, type LucideIcon } from 'lucide-react';
import type { EtapeDeSuivi, TonDeSuivi } from '@beluga/shared';

/**
 * LE DESSIN DE CHAQUE TON DE LA FRISE ET DE LA BARRE D'ÉTAPES (`TonDeSuivi`,
 * `shared/src/frise-de-suivi.ts`) — une seule table pour les deux, qui ne
 * peuvent donc plus diverger. Jaune qui SCINTILLE pendant le travail, bleu qui
 * CLIGNOTE quand c'est fini et qu'un geste est attendu, bleu fixe sinon — y
 * compris ce qui est validé (plus de vert : retour au bleu « terminé »).
 *
 * Chaque étape se dessine par SON ICÔNE (`ICONE_DE_L_ETAPE`), teintée par
 * `ICONE_DU_TON`. Les classes sont écrites en toutes lettres : Tailwind ne voit pas une
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
  /* Les trois étapes propres à la carte du cahier des charges. */
  creation: FolderPlus,
  cahier: ClipboardList,
  termine: CircleCheck,
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

