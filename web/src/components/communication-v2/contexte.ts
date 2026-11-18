import * as React from 'react';
import { cheminCommunicationV2, construireFragment, type CoulissesEnCours, type EntreeDesEtapesV2, type GenreDeCoulisses, type PageCommunicationV2 } from '@beluga/shared';
import type { LigneDeMarque } from '@/components/communication-v2/socle/contexte';

/**
 * CE QUE LES PAGES DE COMMUNICATION 2 DEMANDENT À L'ESPACE : la marque ouverte, aller d'une page à l'autre, et
 * écrire au chef de la marque EN COULISSES (aucune conversation à l'écran). Un seul fournisseur : `communication-v2.tsx`.
 */
export type MarqueV2 = LigneDeMarque & { v2: EntreeDesEtapesV2 };

export interface DernierMot {
  genre: GenreDeCoulisses;
  campagneId?: string;
  contenuId?: string;
  messageId?: string;
  texte: string;
  ok: boolean;
  at: number;
}

export interface EtatDesCoulisses {
  enCours: CoulissesEnCours | null;
  dernier: DernierMot | null;
  chefAuTravail: boolean;
  /** Le chef de la marque : ses étapes s'écrivent au-dessus du champ pendant qu'il travaille. */
  agentId?: string;
}

export interface OutilsV2 {
  marque: MarqueV2;
  /** La page ouverte (l'étape, ou « Réponses »). */
  page: PageCommunicationV2;
  /** LE NOM DE LA CAMPAGNE OUVERTE, déclaré par sa page pour le fil d'Ariane (`null` en la quittant). */
  declarerLaCampagne: (titre: string | null) => void;
  /** Va à une page de la marque (et à un élément) ; sans page, l'étape à faire. */
  aller: (page?: PageCommunicationV2, ...element: string[]) => void;
  coulisses: EtatDesCoulisses | null;
  /** Envoie une demande au chef, en coulisses ; rend vrai si elle est partie. */
  demander: (genre: GenreDeCoulisses, texte?: string, cibles?: Cibles) => Promise<boolean>;
  ouvrirCarte?: (cardId: string, projectId: string) => void;
}

/** Ce qu'une demande au chef vise : une campagne, une publication, un message. */
export interface Cibles {
  campagneId?: string;
  contenuId?: string;
  messageId?: string;
}

export const ContexteV2 = React.createContext<OutilsV2 | null>(null);

export function useV2(): OutilsV2 {
  const outils = React.useContext(ContexteV2);
  if (!outils) throw new Error('Communication 2 : contexte absent');
  return outils;
}

/** L'adresse complète d'une page, pour un vrai lien. */
export const adresseV2 = (marqueId: string | null, page?: PageCommunicationV2, ...element: string[]) =>
  construireFragment(marqueId ? { vue: 'communication2', chemin: cheminCommunicationV2({ marqueId, ...(page ? { page } : {}), element }) } : { vue: 'communication2' });

/** Une demande en coulisses est-elle en cours pour ce genre (et cette campagne, cette publication) ? */
export function enPreparation(c: EtatDesCoulisses | null, genres: readonly GenreDeCoulisses[], cibles?: Cibles): boolean {
  const e = c?.enCours;
  if (!e || !genres.includes(e.genre)) return false;
  if (cibles?.campagneId && e.campagneId !== cibles.campagneId) return false;
  if (cibles?.contenuId && e.contenuId !== cibles.contenuId) return false;
  if (cibles?.messageId && e.messageId !== cibles.messageId) return false;
  return true;
}

/** La page d'une campagne déclare son titre au fil d'Ariane, le temps qu'elle est montée. */
export function useDeclarerLaCampagne(titre: string | null | undefined) {
  const { declarerLaCampagne } = useV2();
  React.useEffect(() => {
    declarerLaCampagne(titre ?? null);
  }, [titre, declarerLaCampagne]);
  React.useEffect(() => () => declarerLaCampagne(null), [declarerLaCampagne]);
}
