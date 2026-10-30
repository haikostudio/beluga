import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTelephone } from '@/lib/telephone';

/**
 * UNE SEULE COLONNE À GAUCHE (demande du 11/10/2026 : « pas des sidebars sur
 * sidebar les unes à côté des autres »).
 *
 * Un service qui a son propre menu — les rubriques du résumé, les classeurs de
 * la mémoire, la liste des notes — ne pose plus une seconde colonne à côté de
 * celle des projets : il REMPLACE son contenu. La colonne de gauche laisse
 * alors place au menu du service, sous une tête qui porte son nom et une
 * flèche de retour. Descendre d'un cran (un classeur, puis ses sujets) change
 * ce même contenu ; la flèche remonte d'un cran, puis rend la liste des
 * projets.
 *
 * L'application fournit l'endroit où écrire et le retour aux projets ; un
 * service y écrit avec `ColonneDeService`, sans rien savoir de la colonne.
 */
export interface NiveauDeColonne {
  /** Le nom affiché en tête de la colonne. */
  titre: string;
  /** Ce que fait la flèche de retour à ce niveau. */
  onRetour: () => void;
}

interface CibleDeColonne {
  /** Le corps de la colonne de gauche, quand elle est prête à recevoir un menu. */
  corps: HTMLElement | null;
  /**
   * LE CORPS RÉSERVÉ À LA PAGE OUVERTE PAR-DESSUS (une tâche) : ses options
   * prennent la colonne le temps qu'elle est ouverte, sans démonter le menu du
   * lieu d'où l'on vient — qu'on retrouve tel quel en la refermant.
   */
  corpsDePage: HTMLElement | null;
  /** Un service descendu d'un cran dit son titre et son retour ; `null` rend ceux du service. */
  definirNiveau: (niveau: NiveauDeColonne | null) => void;
}

const Contexte = React.createContext<CibleDeColonne>({ corps: null, corpsDePage: null, definirNiveau: () => undefined });
export const FournirLaColonneDeService = Contexte.Provider;

/**
 * LE MENU D'UN SERVICE, posé dans la colonne de gauche à la place des projets.
 *
 * Sur téléphone la colonne vit dans un panneau fermé : le composant ne rend
 * rien, et le service garde sa propre navigation dans la page (`ailleurs`).
 */
export function ColonneDeService({
  niveau,
  plan = 'service',
  children,
}: {
  /** Un sous-niveau (un classeur ouvert) : son titre, et le retour au niveau d'avant. */
  niveau?: NiveauDeColonne | null;
  /**
   * `page` : le menu d'une PAGE ouverte par-dessus la zone (les options d'une
   * tâche). Son titre et son retour sont ceux de la page : l'application les
   * pose elle-même, `niveau` n'a pas à les redire.
   */
  plan?: 'service' | 'page';
  children: React.ReactNode;
}) {
  const cible = React.useContext(Contexte);
  const { definirNiveau } = cible;
  const corps = plan === 'page' ? cible.corpsDePage : cible.corps;
  const telephone = useTelephone();
  /* Le retour change à chaque rendu : on ne garde que son dernier état, pour
     ne redire le niveau à la colonne que lorsque son TITRE change. */
  const retour = React.useRef(niveau?.onRetour);
  retour.current = niveau?.onRetour;
  const titre = niveau?.titre ?? null;
  React.useEffect(() => {
    if (telephone || titre === null) return;
    definirNiveau({ titre, onRetour: () => retour.current?.() });
    return () => definirNiveau(null);
  }, [telephone, titre, definirNiveau]);

  if (telephone || !corps) return null;
  return createPortal(children, corps);
}

/** Le service s'affiche-t-il avec son menu dans la colonne de gauche ? (Jamais sur téléphone.) */
export function useColonneDeService(): boolean {
  return !useTelephone();
}

/** Une ligne du menu d'un service : la même forme que celles de la colonne des projets. */
export const CLASSE_LIGNE_DE_SERVICE =
  'flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] text-text transition-colors';
/**
 * COLONNE RÉDUITE À SA BANDE D'ICÔNES : un menu qui s'y montre (les options du
 * projet, celles d'une tâche) ne garde que ses icônes, centrées. La colonne
 * pose `data-bande` sur le corps (`group/colonne`) ; la ligne et son libellé
 * prennent ces deux classes en plus.
 */
export const CLASSE_LIGNE_EN_BANDE = 'group-data-[bande]/colonne:justify-center group-data-[bande]/colonne:px-0';
export const CLASSE_LIBELLE_EN_BANDE = 'group-data-[bande]/colonne:sr-only';
/** L'intitulé d'un groupe de lignes dans le menu d'un service. */
export const CLASSE_SECTION_DE_SERVICE = 'px-2.5 pb-1.5 pt-4 text-[12.5px] text-faint first:pt-1';
