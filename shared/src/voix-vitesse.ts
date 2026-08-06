/**
 * LA VITESSE DE LA VOIX (mémoire n°38 pour le prénom, même onglet Système).
 *
 * On ne montre pas un nombre nu à l'oreille : la vitesse se choisit par crans
 * clairs en français. Chaque cran porte une ÉCHELLE DE LONGUEUR de phonème pour
 * Piper (`--length_scale`) — plus l'échelle est grande, plus la voix est LENTE.
 * L'échelle « normale » vaut 1, l'exact réglage d'origine : ne rien choisir,
 * c'est la voix d'avant.
 */

export type VitesseVoix = 'lente' | 'normale' | 'rapide';

export interface CranDeVitesse {
  id: VitesseVoix;
  label: string;
  description: string;
  /** L'échelle de longueur passée à Piper : > 1 ralentit, < 1 accélère. */
  echelle: number;
}

export const VITESSE_PAR_DEFAUT: VitesseVoix = 'normale';

/** Les crans proposés, du plus lent au plus rapide. */
export const CRANS_DE_VITESSE: CranDeVitesse[] = [
  { id: 'lente', label: 'Lente', description: 'Posée, chaque mot détaché.', echelle: 1.3 },
  { id: 'normale', label: 'Normale', description: 'Le débit d’origine.', echelle: 1 },
  { id: 'rapide', label: 'Rapide', description: 'Enlevée, pour aller vite.', echelle: 0.8 },
];

/**
 * L'échelle de longueur d'un cran. Un identifiant inconnu retombe sur la
 * vitesse normale : jamais de son muet ni d'échelle absurde.
 */
export function echelleDeVitesse(id?: string): number {
  const cran = CRANS_DE_VITESSE.find((c) => c.id === id);
  return (cran ?? CRANS_DE_VITESSE.find((c) => c.id === VITESSE_PAR_DEFAUT)!).echelle;
}
