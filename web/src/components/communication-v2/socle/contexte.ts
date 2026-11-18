import * as React from 'react';
import { cheminCommunication, type Attachment, type EtapeDeDemarcheId, type LieuDeMarque } from '@beluga/shared';
import { t } from '@/lib/langue';

/**
 * CE QUE LES LIEUX DEMANDENT À L'ESPACE : ouvrir un autre lieu, dire à la conversation de quoi on parle,
 * écrire au directeur. Un seul fournisseur : `communication.tsx`.
 */
export interface LigneDeMarque {
  id: string;
  nom: string;
  origine: string;
  projets: { id: string; nom: string; favicon: string | null }[];
  /** L'étape de la démarche en cours ; `null` quand tout est fait. */
  etape: EtapeDeDemarcheId | null;
  avancement: number;
  accords: number;
  messages: number;
  favicon: string | null;
}

/** Le nom de chaque étape de la démarche, dans l'ordre où le directeur la mène. */
export const nomDeLEtape = (etape: EtapeDeDemarcheId): string =>
  ({ compte: t('Relier un compte'), analyse: t('Analyser la marque'), objectifs: t('Poser les objectifs'), campagnes: t('Mener les campagnes') })[etape];

/** La ligne courte sous le nom d'une marque : l'étape en cours, ou la démarche faite. */
export function etapeEnCours(m: Pick<LigneDeMarque, 'etape'>): string {
  if (!m.etape) return t('Démarche en place');
  const rang = ['compte', 'analyse', 'objectifs', 'campagnes'].indexOf(m.etape) + 1;
  return t('Étape {n} · {nom}', { n: rang, nom: nomDeLEtape(m.etape) });
}

export interface OutilsDeLEspace {
  marques: LigneDeMarque[] | null;
  /** Va à un lieu de l'espace : `null` pour la vue d'ensemble. */
  aller: (chemin: string | null) => void;
  /** Le texte de « Vous parlez de … » pour cette page. */
  parlerDe: (contexte: string | null) => void;
  /** Écrit au directeur, comme si on l'avait tapé : c'est un clic de l'utilisateur. */
  dire: (texte: string) => void;
  /**
   * « FAIRE DES MODIFICATIONS » (carte du 04/11/2026) : AJOUTE une phrase de départ au brouillon du chef, sans rien
   * envoyer — la personne la complète puis l'envoie elle-même. `piece` rejoint ses pièces jointes (la phrase porte
   * déjà son tag). Sur téléphone, la conversation du chef s'ouvre par-dessus la page.
   */
  /** Une pièce, ou plusieurs (« Toutes les versions » d'un post décliné). */
  preparer: (phrase: string, pieces?: Attachment | readonly Attachment[]) => void;
  ouvrirCarte?: (cardId: string, projectId: string) => void;
}

export const ContexteDeLEspace = React.createContext<OutilsDeLEspace>({ marques: null, aller: () => undefined, parlerDe: () => undefined, dire: () => undefined, preparer: () => undefined });

export function useEspace(): OutilsDeLEspace {
  return React.useContext(ContexteDeLEspace);
}

/**
 * « VOUS PARLEZ DE … » EST UNE PILE (carte « Médias : aperçu en modale, fiche en tiroir », 05/11/2026) : une fiche ou une
 * campagne ouverte EN TIROIR par-dessus une page pose son sujet tant qu'elle est ouverte ; refermée, la page dessous
 * reprend la parole — sans se remonter. Le dernier posé l'emporte ; un sujet vide ne masque pas celui de dessous.
 */
let pileDesSujets: { id: symbol; contexte: string | null }[] = [];

/** Le sujet le plus haut posé ; un `null` ne masque pas celui de dessous (le calendrier d'une campagne garde le sien). */
const sujetDuHaut = (): string | null => [...pileDesSujets].reverse().find((x) => x.contexte !== null)?.contexte ?? null;

/** Pose le texte de « Vous parlez de … » tant que la page (ou le tiroir) est là. */
export function useParlerDe(contexte: string | null): void {
  const { parlerDe } = useEspace();
  const id = React.useRef(Symbol('sujet')).current;
  React.useEffect(() => {
    const entree = pileDesSujets.find((x) => x.id === id);
    if (entree) entree.contexte = contexte;
    else pileDesSujets = [...pileDesSujets, { id, contexte }];
    parlerDe(sujetDuHaut());
  }, [contexte, parlerDe, id]);
  React.useEffect(
    () => () => {
      pileDesSujets = pileDesSujets.filter((x) => x.id !== id);
      if (pileDesSujets.length) parlerDe(sujetDuHaut());
    },
    [parlerDe, id],
  );
}

export function chemin(marqueId: string, lieu: LieuDeMarque, ...element: string[]): string {
  return cheminCommunication({ marqueId, lieu, element });
}
