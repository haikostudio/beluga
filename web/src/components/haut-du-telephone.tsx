import * as React from 'react';
import { projetsParActivite, type VueCentrale } from '@beluga/shared';
import { type OptionSelecteur } from '@/components/ui';
import { BoutonDuNomQuiOuvreLesTaches } from '@/components/entete-de-zone';
import { PastilleProjet } from '@/components/pastille-projet';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';

/**
 * LE HAUT DE L'ÉCRAN DU TÉLÉPHONE, SUR UN SEUL RANG (décision de l'utilisateur du 03/11/2026, maquette « 0 · Le haut
 * de l'écran ») — le haut à deux étages (service en petit, projet en grand) est rejeté.
 *
 * UN NOM, CENTRÉ SUR L'AXE DE L'ÉCRAN quel que soit le nombre de boutons de chaque côté (la barre le pose en calque,
 * `EnteteDeZone`), et TOUJOURS SUIVI D'UN CHEVRON : depuis le 13/11/2026, un appui ouvre LE MENU PRINCIPAL (la
 * colonne des projets, en feuille), sur tous les écrans — le ☰ a disparu, et la grille des services avec lui.
 * La page qui est descendue d'un niveau DÉCLARE son nom (`useDeclarerLeProjetDuHaut`) ; sinon le projet actif pour
 * les vues qui le suivent, sinon le service.
 *
 * Une page peut aussi poser son propre CONTENU à la place du nom (la Mémoire : son champ de recherche, sur toute la
 * largeur) : `contenu`.
 *
 * Repères : `data-haut-telephone` (l'enveloppe), `data-haut-titre` et `data-menu-principal` (le bouton du nom),
 * `data-haut-liste="menu"`.
 */
export type GenreDeListeDuHaut = 'projets' | 'marques' | 'creations';

export interface EtageDuProjet {
  /** Le nom affiché, centré. */
  libelle: string;
  icone?: React.ReactNode;
  /** La valeur retenue dans la liste. */
  valeur: string;
  options: OptionSelecteur[];
  onChoisir: (valeur: string) => void;
  /** Le titre de la liste (« Projets », « Marques »). */
  titre: string;
  /** Ce que la liste contient : le repère `data-haut-liste`. */
  genre?: GenreDeListeDuHaut;
  /**
   * À LA PLACE DU NOM, LE CONTENU DE LA PAGE, sur toute la largeur entre les boutons (la Mémoire : son champ de
   * recherche). Les autres champs sont alors ignorés.
   */
  contenu?: React.ReactNode;
}

const DeclarerLeProjet = React.createContext<((etage: EtageDuProjet | null) => void) | null>(null);
export const FournirLaDeclarationDuProjet = DeclarerLeProjet.Provider;

/** Une page pose son nom et sa liste tant qu'elle est montée (Communication : la marque ouverte). */
export function useDeclarerLeProjetDuHaut(etage: EtageDuProjet | null) {
  const declarer = React.useContext(DeclarerLeProjet);
  React.useEffect(() => {
    if (!declarer) return;
    declarer(etage);
    return () => declarer(null);
  }, [declarer, etage]);
}

/** Les vues qui suivent le projet actif : le nom du haut y est celui du projet. */
const VUES_DU_PROJET_ACTIF: readonly VueCentrale[] = ['projet'];

/** Les options « tous les projets », triées par activité, chacune avec sa pastille. */
export function useOptionsDesProjets(): OptionSelecteur[] {
  const projets = useApp().projects;
  return React.useMemo(
    () => projetsParActivite(projets).map((p) => ({ valeur: p.id, libelle: p.name, icone: <PastilleProjet project={p} /> })),
    [projets],
  );
}

/** Le nom du haut que l'application fournit d'elle-même, pour les vues qui suivent le projet actif. */
export function useEtageDuProjetActif(vue: VueCentrale, apres?: () => void): EtageDuProjet | null {
  const state = useApp();
  const actif = state.activeProjectId ? state.projects.find((p) => p.id === state.activeProjectId) ?? null : null;
  const options = useOptionsDesProjets();
  return React.useMemo(() => {
    if (!VUES_DU_PROJET_ACTIF.includes(vue) || !actif) return null;
    return {
      libelle: actif.name,
      valeur: actif.id,
      titre: t('Projets'),
      genre: 'projets',
      options,
      onChoisir: (id) => {
        if (id !== actif.id) client.setActiveProject(id);
        apres?.();
      },
    };
  }, [vue, actif, options, apres]);
}

export function EtagesDuTelephone({
  libelleDuService,
  projet,
  onTaches,
  tachesOuvertes = false,
}: {
  vue?: VueCentrale;
  libelleDuService: string;
  onOuvrirVue?: (vue: VueCentrale) => void;
  projet: EtageDuProjet | null;
  /**
   * DANS UN PROJET, LE NOM OUVRE SES TÂCHES (carte « Services homogènes et centrés », 14/11/2026) — le menu principal
   * est revenu au coin gauche. Absent (hors d'un projet) : le nom n'est qu'un titre, sans chevron ni geste.
   */
  onTaches?: (() => void) | null;
  tachesOuvertes?: boolean;
}) {
  if (projet?.contenu) {
    return (
      <div className="flex min-w-0 flex-1 items-center" data-haut-telephone data-haut-contenu>
        {projet.contenu}
      </div>
    );
  }
  const libelle = projet?.libelle ?? libelleDuService;
  return (
    <div className="flex min-w-0 max-w-full justify-center" data-haut-telephone>
      {onTaches ? (
        <BoutonDuNomQuiOuvreLesTaches libelle={libelle} icone={projet?.icone} ouvrir={onTaches} actif={tachesOuvertes} />
      ) : (
        <span className="flex h-[38px] min-w-0 max-w-full items-center justify-center gap-1 px-2 text-[17px] font-semibold text-text" data-titre-bandeau data-haut-titre>
          {projet?.icone ? <span className="flex shrink-0 items-center">{projet.icone}</span> : null}
          <span className="min-w-0 truncate">{libelle}</span>
        </span>
      )}
    </div>
  );
}
