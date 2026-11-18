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
 * alors place au menu du service, sous une tête qui porte son nom et un bouton
 * menu : il montre les agents et les projets par-dessus (demande du 31/10/2026).
 * Descendre d'un cran (un classeur, puis ses sujets) change ce même contenu ;
 * on remonte par le fil d'Ariane (`SuiteDuFil`).
 *
 * L'application fournit l'endroit où écrire ; un service y écrit avec
 * `ColonneDeService`, sans rien savoir de la colonne.
 */
export interface NiveauDeColonne {
  /** Le nom affiché en tête de la colonne. */
  titre: string;
}

interface CibleDeColonne {
  /** Le corps de la colonne de gauche, quand elle est prête à recevoir un menu. */
  corps: HTMLElement | null;
  /** Un service descendu d'un cran dit son titre ; `null` rend celui du service. */
  definirNiveau: (niveau: NiveauDeColonne | null) => void;
  /**
   * AUCUN MENU PROPRE ICI (décision du 13/11/2026 : « je ne veux plus de ce menu en haut des services ») : dans la
   * zone centrale et dans la fenêtre des outils de création, le service ne pose plus son menu nulle part et garde SA
   * navigation dans la page — celle qu'il a déjà sur téléphone (`useColonneDeService` rend faux).
   */
  absente?: boolean;
}

const Contexte = React.createContext<CibleDeColonne>({ corps: null, definirNiveau: () => undefined });
export const FournirLaColonneDeService = Contexte.Provider;

/**
 * LE MENU D'UN SERVICE, posé dans la colonne de gauche à la place des projets.
 *
 * Sur téléphone la colonne vit dans un panneau fermé : le composant ne rend
 * rien, et le service garde sa propre navigation dans la page (`ailleurs`).
 */
export function ColonneDeService({
  niveau,
  children,
}: {
  /** Un sous-niveau (un classeur ouvert) : son titre. */
  niveau?: NiveauDeColonne | null;
  children: React.ReactNode;
}) {
  const cible = React.useContext(Contexte);
  const { definirNiveau } = cible;
  const { corps } = cible;
  const telephone = useTelephone();
  const titre = niveau?.titre ?? null;
  React.useEffect(() => {
    if (telephone || titre === null) return;
    definirNiveau({ titre });
    return () => definirNiveau(null);
  }, [telephone, titre, definirNiveau]);

  if (telephone || !corps || cible.absente) return null;
  return createPortal(children, corps);
}

/**
 * Le service s'affiche-t-il avec son menu à part ? Jamais sur téléphone, ni là où il n'y a plus de menu propre
 * (`absente` : zone centrale, fenêtre des outils de création) — seulement dans la fenêtre de la Mémoire ou du Coffre.
 */
export function useColonneDeService(): boolean {
  const telephone = useTelephone();
  return !telephone && !React.useContext(Contexte).absente;
}

/** Une ligne du menu d'un service : la même forme que celles de la colonne des projets. */
export const CLASSE_LIGNE_DE_SERVICE =
  'relative flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] text-text transition-colors';
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
