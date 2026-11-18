/**
 * LA HAUTEUR DU CLAVIER, MÊME QUAND L'IPHONE NE LA DONNE PAS (carte « Clavier
 * mobile et choix des dates », captures #2da6 / #866f, 05/11/2026).
 *
 * La seule mesure du clavier (MEM-5918) compare la fenêtre (`innerHeight`) à
 * la zone visible (`visualViewport`). Dans l'application installée, iOS 26
 * laisse parfois la zone visible BLOQUÉE à pleine hauteur, clavier ouvert :
 * l'écart reste nul, `--clavier` reste à 0 et la feuille de question garde son
 * champ sous le clavier — jusqu'à ce qu'une rotation remette les valeurs à
 * plat. Cette règle décide alors de reprendre la DERNIÈRE hauteur mesurée avec
 * succès dans la même orientation.
 *
 * Le secours est étroit, pour ne jamais soulever l'écran à tort :
 *  - un champ qui fait VRAIMENT monter un clavier a le curseur (texte, pas une
 *    case, pas `readonly`, pas `inputmode="none"`) ;
 *  - le pointeur est grossier (un doigt) : un clavier physique ne passe pas
 *    pour un clavier à l'écran sur ordinateur ;
 *  - le suivi image par image de l'entrée dans le champ est FINI (le clavier a
 *    eu le temps de monter), sauf si un clavier était déjà ouvert à l'instant
 *    d'avant (passage d'un champ à l'autre : pas de chute à 0 entre les deux) ;
 *  - AUCUN clavier n'a été mesuré depuis l'entrée dans le champ : une zone
 *    visible qui a su dire « clavier ouvert » n'est pas bloquée, et si elle
 *    revient ensuite à pleine hauteur, c'est que le clavier s'est VRAIMENT
 *    refermé (champ gardé au curseur, sélecteur de photos…) ;
 *  - la fenêtre n'a PAS rétréci par rapport à sa hauteur de repos : si
 *    `innerHeight` a perdu plus de cent points, le système a déjà rétréci la
 *    page, les éléments fixés suivent, et lever en plus doublerait le clavier.
 *
 * Règle pure, testable sans navigateur.
 */

/** Un écart sous ce seuil n'est pas un clavier (barre d'adresse, barre d'outils). */
export const SEUIL_DU_CLAVIER_PX = 100;

export type SourceDuClavier = 'mesuree' | 'secours' | 'aucune';

export interface MesureDuClavier {
  /** `innerHeight − visualViewport.height − visualViewport.offsetTop`. */
  ecart: number;
  /** Un champ a le curseur (n'importe lequel : INPUT, TEXTAREA, contenteditable). */
  saisieActive: boolean;
  /** Ce champ fait monter un clavier à l'écran (voir `champQuiFaitMonterLeClavier`). */
  champTexte: boolean;
  /** `(pointer: coarse)` : on touche au doigt. */
  pointeurGrossier: boolean;
  /** Le suivi image par image après l'entrée dans le champ est terminé. */
  suiviFini: boolean;
  /** Un clavier a été mesuré (source « mesuree ») depuis le dernier `focusin`. */
  mesureDepuisLEntree: boolean;
  /** Le clavier posé à la mesure précédente (`--clavier`, en pixels). */
  clavierPrecedent: number;
  /** La dernière hauteur de clavier mesurée avec succès dans cette orientation. */
  hauteurRetenue: number | null;
  /** `window.innerHeight` maintenant. */
  fenetreHauteur: number;
  /** `window.innerHeight` relevé hors saisie, dans cette orientation. */
  hauteurDeRepos: number | null;
}

export interface DecisionDuClavier {
  clavier: number;
  source: SourceDuClavier;
  /** Une hauteur mesurée qui mérite d'être retenue pour un prochain secours. */
  aRetenir: number | null;
}

export function decisionDuClavier(m: MesureDuClavier): DecisionDuClavier {
  if (!m.saisieActive) return { clavier: 0, source: 'aucune', aRetenir: null };
  if (m.ecart > SEUIL_DU_CLAVIER_PX) {
    const clavier = Math.round(m.ecart);
    /* Une mesure plus haute que les quatre cinquièmes de la fenêtre n'est pas
       un clavier plausible : on la pose, mais on ne la retient pas. */
    const plausible = m.champTexte && m.pointeurGrossier && clavier < m.fenetreHauteur * 0.8;
    return { clavier, source: 'mesuree', aRetenir: plausible ? clavier : null };
  }
  const retenue = m.hauteurRetenue ?? 0;
  const fenetreRetrecie =
    m.hauteurDeRepos != null && m.hauteurDeRepos - m.fenetreHauteur > SEUIL_DU_CLAVIER_PX;
  const secours =
    m.champTexte &&
    m.pointeurGrossier &&
    retenue > SEUIL_DU_CLAVIER_PX &&
    !fenetreRetrecie &&
    !m.mesureDepuisLEntree &&
    (m.suiviFini || m.clavierPrecedent > 0);
  if (secours) return { clavier: Math.round(retenue), source: 'secours', aRetenir: null };
  return { clavier: 0, source: 'aucune', aRetenir: null };
}

/** Les types de champ qui font monter le clavier texte. */
const TYPES_TEXTE = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

export interface ChampVu {
  tag: string;
  type?: string | null;
  lectureSeule?: boolean;
  inputMode?: string | null;
  editable?: boolean;
}

/** Ce champ fait-il monter un clavier à l'écran ? */
export function champQuiFaitMonterLeClavier(c: ChampVu): boolean {
  if ((c.inputMode ?? '').toLowerCase() === 'none') return false;
  if (c.lectureSeule) return false;
  const tag = c.tag.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TYPES_TEXTE.has((c.type ?? '').toLowerCase());
  return !!c.editable;
}

/** La clé de la hauteur retenue : une par orientation, le clavier n'y a pas la même taille. */
export function cleDeLaHauteurRetenue(paysage: boolean): string {
  return paysage ? 'beluga:clavier-retenu:paysage' : 'beluga:clavier-retenu:portrait';
}
