import type { CompteSocial, ContenuMarketing, RubriqueDeStrategie, StrategieDeCampagne } from '@beluga/shared';
import { useLecture } from '@/components/communication-v2/socle/pieces';
import { useV2 } from './contexte';

/**
 * LES LECTURES DE COMMUNICATION 2 — les mêmes que l'espace actuel (`server/src/communication.ts`), relues à chaque
 * diffusion : rien n'est copié, rien n'est recalculé ici.
 */
export interface CampagneV2 {
  id: string;
  titre: string;
  objectif: string | null;
  objectifChiffre: number | null;
  mesure: string;
  reseaux: string[];
  debut: string | null;
  fin: string | null;
  statut: string;
  image: string | null;
  objectifId: string | null;
  typesMedias: string[];
  quantiteMedias: number | null;
  rythme: string | null;
  cible: string | null;
  message: string | null;
  ton: string | null;
  appelAction: string | null;
  /** La stratégie bâtie avec l'agent de la campagne, par rubrique (10/11/2026). */
  strategie?: StrategieDeCampagne;
}

export type LigneDeCampagneV2 = CampagneV2 & {
  atteint: number;
  publications: number;
  publiees?: number;
  medias?: number;
  aAccepter: number;
  /** Les publications prévues qu'une suppression annulerait. */
  aAnnuler?: number;
  /** L'agent de la campagne travaille : elle ne se supprime pas. */
  agentAuTravail?: boolean;
  apercu: string | null;
  manquants?: string[];
  /** Les visuels attendus (une publication datée chacun) et ceux déjà faits : « Prête » quand tous le sont (12/11/2026). */
  visuels?: { prevus: number; faits: number };
};

/** Une campagne à la corbeille : 30 jours pour la restaurer. */
export interface CampagneALaCorbeille {
  id: string;
  titre: string;
  debut: string | null;
  fin: string | null;
  reseaux: string[];
  supprimeLe: number;
  effaceLe: number;
}

export type PublicationV2 = ContenuMarketing & {
  apercu: { attachmentId: string; genre: string } | null;
  chiffres: { vues: number | null; reactions: number | null; clics: number; visites: number; publieLe: number | null } | null;
  /** La publication d'origine de ses déclinaisons par réseau (DEC-487), ou elle-même. */
  famille: string;
};

export interface DetailDeCampagneV2 {
  campagne: CampagneV2;
  fiche: { manquants: string[]; verrouillee: boolean };
  /** Les rubriques de la stratégie encore à trancher avec l'agent. */
  strategieManquante?: RubriqueDeStrategie[];
  /** L'agent de la campagne (sa page EST sa conversation) ; absent tant qu'il n'est pas né. */
  agentId?: string | null;
  agentAuTravail?: boolean;
  atteint: number;
  jourEcoule: number;
  duree: number;
  courbe: number[];
  publications: PublicationV2[];
  parReseau: { reseau: string; valeur: number }[];
}

export type ContenuDuCalendrier = ContenuMarketing & {
  apercu: { attachmentId: string; genre: string } | null;
  /** Un post qui passe par Chrome : il attend Chrome, ou il est parti en retard (rattrapage). */
  envoiChrome?: 'attente-chrome' | 'en-retard' | null;
};

export interface MediaDeLaMarque {
  cle: string;
  campagneId: string | null;
  utilise: { contenuId: string; canal: string }[];
}

export function useCampagnes() {
  const { marque } = useV2();
  return useLecture<{ campagnes: LigneDeCampagneV2[]; corbeille?: CampagneALaCorbeille[] }>({ type: 'communication.campagnes', marqueId: marque.id }, [marque.id]);
}

export function useCampagne(id: string) {
  const { marque } = useV2();
  return useLecture<DetailDeCampagneV2>({ type: 'communication.campagne', marqueId: marque.id, id }, [marque.id, id]);
}

export function useMediasDeLaMarque() {
  const { marque } = useV2();
  return useLecture<{ medias: MediaDeLaMarque[] }>({ type: 'communication.medias', marqueId: marque.id }, [marque.id]);
}

/** La clé du média qui porte une publication : « Valider » valide la publication ET son média. */
export function cleDuMedia(contenuId: string, medias: readonly MediaDeLaMarque[] | undefined): string | null {
  return medias?.find((m) => m.utilise.some((u) => u.contenuId === contenuId))?.cle ?? null;
}

/** Les publications d'une campagne regroupées par post : une famille = la publication d'origine et ses déclinaisons. */
export function postsDeLaCampagne(publications: readonly PublicationV2[]): { tete: PublicationV2; membres: PublicationV2[] }[] {
  const visibles = publications.filter((p) => p.etape !== 'abandonne');
  const familles = new Map<string, PublicationV2[]>();
  for (const p of visibles) familles.set(p.famille, [...(familles.get(p.famille) ?? []), p]);
  return [...familles.values()]
    .map((membres) => {
      const tete = membres.find((m) => m.id === m.famille) ?? membres[0]!;
      return { tete, membres: [tete, ...membres.filter((m) => m !== tete)] };
    })
    .sort((a, b) => (a.tete.datePrevue ?? '9999').localeCompare(b.tete.datePrevue ?? '9999') || (a.tete.heurePrevue ?? '').localeCompare(b.tete.heurePrevue ?? '') || a.tete.creeLe - b.tete.creeLe);
}
