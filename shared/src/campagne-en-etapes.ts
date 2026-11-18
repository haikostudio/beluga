/**
 * OÙ EN EST UNE CAMPAGNE ? Un fil d'étapes, comme la démarche d'une marque (décision de l'utilisateur, 03/11/2026 :
 * « on ne sait ni où elle en est ni pourquoi les chiffres sont vides »). Cinq étapes, dans l'ordre :
 *
 *   préparée → contenus prêts → lancée → en diffusion (jour X sur Y) → bilan
 *
 * L'étape du moment est la PREMIÈRE qui n'est pas faite : c'est elle qui porte le seul bouton d'action. Les chiffres
 * ne se montrent qu'une fois la campagne lancée (`chiffresVisibles`) — avant, ils ne peuvent être que vides.
 */

export const ETAPES_DE_CAMPAGNE = ['preparee', 'contenus', 'lancee', 'diffusion', 'bilan'] as const;
export type EtapeDeCampagne = (typeof ETAPES_DE_CAMPAGNE)[number];
export type EtatDEtapeDeCampagne = 'fait' | 'en_cours' | 'a_faire';

export interface SituationDeCampagne {
  /** `preparation`, `en_cours` ou `terminee` (colonne `statut` de la campagne). */
  statut: string;
  /** Les publications préparées pour elle, toutes étapes confondues. */
  publications: number;
  /** Celles qui attendent encore l'accord de l'utilisateur. */
  aAccepter: number;
  /** Le jour écoulé depuis le début, et la durée prévue (0 = sans date de fin). */
  jourEcoule: number;
  duree: number;
}

export interface EtapeDuFilDeCampagne {
  id: EtapeDeCampagne;
  etat: EtatDEtapeDeCampagne;
}

export interface FilDeCampagne {
  etapes: EtapeDuFilDeCampagne[];
  /** L'étape du moment, `null` quand tout est fait. */
  enCours: EtapeDeCampagne | null;
  /** Les chiffres (vues, clics, courbe) n'ont de sens qu'une fois la campagne lancée. */
  chiffresVisibles: boolean;
}

export function filDeCampagne(s: SituationDeCampagne): FilDeCampagne {
  const lancee = s.statut === 'en_cours' || s.statut === 'terminee';
  const terminee = s.statut === 'terminee';
  const faites: Record<EtapeDeCampagne, boolean> = {
    preparee: true,
    contenus: s.publications > 0 && s.aAccepter === 0,
    lancee,
    diffusion: terminee || (lancee && s.duree > 0 && s.jourEcoule >= s.duree),
    bilan: terminee,
  };
  let enCours: EtapeDeCampagne | null = null;
  const etapes = ETAPES_DE_CAMPAGNE.map((id) => {
    if (faites[id]) return { id, etat: 'fait' as const };
    if (!enCours) {
      enCours = id;
      return { id, etat: 'en_cours' as const };
    }
    return { id, etat: 'a_faire' as const };
  });
  return { etapes, enCours, chiffresVisibles: lancee };
}
