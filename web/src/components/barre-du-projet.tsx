/*
 * LA BARRE D'UN PROJET (refonte du 14/11/2026, carte « Onglets, services et listes repensés ») : plus de rangée
 * d'onglets, seulement le fil d'Ariane « icône du projet · nom / titre de la page » (`FilDuProjet`). À droite, dans cet
 * ordre : les trois points (options de la page), l'aperçu du site (une planète), puis « Publier ».
 *
 * La barre se dessine dans `EnteteDeZone` (ordinateur), qui la lit dans ce contexte : la page d'un projet ET la
 * page d'une tâche ouverte la montrent pareil. Les onglets restent tenus en coulisse (`shared/src/onglets-du-projet.ts`)
 * pour garder montés les écrans déjà vus.
 */
import * as React from 'react';
import { ordonnerParDerniereActivite, type OngletDuProjet, type Project } from '@beluga/shared';
import { PastilleProjet } from '@/components/pastille-projet';
import { CLES_DES_SERVICES } from '@/components/services';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useApp } from '@/lib/use-app';
import { naviguerVers } from '@/components/ui/lien-interne';
import { ChevronDesVoisins } from '@/components/voisins-du-fil';

/** Ce que la barre d'un projet pose dans l'en-tête : les onglets à gauche, les gestes communs à droite. */
export interface BarreDuProjet {
  onglets: React.ReactNode;
  /** Le bouton des outils puis « Publier », posés APRÈS les trois points de la page. */
  droite: React.ReactNode;
  /** Le nom du projet : sur téléphone, il est centré en haut et ouvre le menu principal. */
  nom: string;
}
const Contexte = React.createContext<BarreDuProjet | null>(null);
export const FournirLaBarreDuProjet = Contexte.Provider;
export const useBarreDuProjet = () => React.useContext(Contexte);

/**
 * SUR TÉLÉPHONE, LE ⋮ D'UNE TÂCHE VIT DANS LE HAUT COMMUN (13/11/2026) : la page de la tâche ne pose plus d'en-tête
 * à elle ; elle porte ses trois points (`MenuCarte`) dans cet emplacement du haut de l'application, à la place de
 * ceux de l'accueil du projet. Repère `data-menu-de-tache-ici`.
 */
const CibleDuMenuDeTache = React.createContext<HTMLElement | null>(null);
export const FournirLaCibleDuMenuDeTache = CibleDuMenuDeTache.Provider;
export const useCibleDuMenuDeTache = () => React.useContext(CibleDuMenuDeTache);

/**
 * LES OUTILS DU PROJET, SUR TÉLÉPHONE : la feuille « Outils » (`FeuilleDesServices duProjet`, montée par
 * l'application) s'ouvre depuis les trois points du haut — le bas ne porte plus que « Publier » (13/11/2026).
 */
export const EVENEMENT_OUVRIR_LES_OUTILS = 'beluga:ouvrir-outils-du-projet';
export const ouvrirLesOutilsDuProjet = () => window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_LES_OUTILS));

/** Les services que l'on range DANS un projet : tous, sauf les deux communs (Coffre-fort, Mémoire). */
export const SERVICES_COMMUNS: readonly string[] = ['coffre', 'memoire'];
export const estUnServiceDuProjet = (vue: string) =>
  vue !== 'projet' && vue !== 'en-route' && !SERVICES_COMMUNS.includes(vue) && CLES_DES_SERVICES.some((s) => s.cle === vue);


function definitionDuService(cle?: string) {
  return CLES_DES_SERVICES.find((s) => s.cle === cle);
}

export function titreDOnglet(onglet: OngletDuProjet): string {
  if (onglet.genre === 'service') {
    const def = definitionDuService(onglet.service);
    return def ? t(def.cleLibelle) : (onglet.titre ?? '');
  }
  return onglet.titre || (onglet.genre === 'tache' ? t('Tâche') : t(definitionDuService(onglet.service)?.cleLibelle ?? ''));
}

/**
 * LE FIL D'UN PROJET (décision de l'utilisateur du 14/11/2026, carte « Onglets, services et listes repensés ») : la
 * rangée d'onglets « ne sert à rien d'autre qu'à induire en erreur » — elle disparaît, tâches comprises. En haut, il ne
 * reste que le fil « icône du projet · nom / titre de la page ». Un clic sur l'icône ou le nom ramène à l'accueil du
 * projet (`client.demanderTableau`, MEM-4836). Sur l'accueil, le nom seul. Les onglets restent tenus EN COULISSE
 * (`shared/src/onglets-du-projet.ts`) : ils gardent montés les écrans déjà vus, pour un retour instantané.
 * Repères : `data-fil-du-projet`, `data-icone-du-cran`, `data-cran-du-projet`, `data-titre-du-fil`.
 */
export function FilDuProjet({
  project,
  titre,
  onAccueil,
  sansIcone = false,
  service,
  suite,
}: {
  project: Pick<Project, 'id' | 'name' | 'favicon'>;
  /** Le titre de la page ouverte (une tâche, un outil, un objet) ; absent sur l'accueil du projet. */
  titre?: string | null;
  onAccueil: () => void;
  sansIcone?: boolean;
  /**
   * L'OBJET D'UN SERVICE OUVERT DANS LE PROJET (un dossier Marketing, une création du Studio, 15/11/2026 — capture
   * #22ca, « Fishflow / / ») : le fil devient « projet / service / ce que le service écrit » (`SuiteDuFil`). Le cran
   * du service ramène à sa liste pour ce projet ; `suite` est la cible où le service pose ses crans.
   */
  /**
   * LE SERVICE OUVERT DANS LE PROJET (décision du 20/11/2026, « le service, ensuite le projet, puis la fiche ») : le fil
   * devient « Service / Projet / fiche ». Le SERVICE mène à son accueil sur tous les projets (`onTous`), son chevron
   * aux autres services de ce projet (`services`, `onAutreService`) ; le PROJET mène à la liste du service pour ce
   * projet — un VRAI lien (`adresse`, `onOuvrir`) —, son chevron au même service dans un autre projet (`onAutreProjet`).
   */
  service?: {
    cle: string;
    libelle: string;
    adresse: string;
    onOuvrir: () => void;
    /** L'adresse du service sur tous les projets (sans « # »). */
    adresseTous: string;
    onTous: () => void;
    services: { valeur: string; libelle: string; groupe?: string }[];
    onAutreService: (cle: string) => void;
    onAutreProjet: (projectId: string) => void;
  };
  suite?: React.ReactNode;
}) {
  const allerALAccueil = (event: React.MouseEvent) => {
    if (lienPourUnAutreOnglet(event)) return;
    event.preventDefault();
    onAccueil();
  };
  /* LES AUTRES PROJETS, SOUS LE NOM QUAND IL EST UN CRAN DU MILIEU (14/11/2026, « Fishflow » au-dessus d'une charte) :
     un chevron au survol ouvre la liste ; un autre projet s'ouvre sur son accueil. */
  const tous = useApp().projects;
  const voisins = React.useMemo(
    () =>
      ordonnerParDerniereActivite(tous.filter((p) => !p.archived && !p.marqueSansDepot))
        .map((p) => ({ valeur: p.id, libelle: p.name, icone: <PastilleProjet project={p} taille={16} /> })),
    [tous],
  );
  if (service) {
    /* « SERVICE / PROJET / FICHE » : noms seuls, sans icône ; le chevron des voisins ne paraît qu'au survol. */
    return (
      <nav aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px]" data-fil-du-projet={project.id} data-fil-du-service-du-projet={service.cle}>
        <span className="group/cran flex min-w-0 shrink-0 items-center">
          <a
            href={'#' + service.adresseTous.replace(/^#/, '')}
            className="shrink-0 rounded-md px-1 py-0.5 text-muted transition-colors hover:text-text"
            data-cran-du-service-du-projet
            onClick={(event) => {
              if (lienPourUnAutreOnglet(event)) return;
              event.preventDefault();
              service.onTous();
            }}
          >
            {service.libelle}
          </a>
          <ChevronDesVoisins
            voisins={{ nom: service.libelle, valeur: service.cle, options: service.services, titre: t('Services'), repere: 'service-du-projet', onChoisir: service.onAutreService }}
            onOuvrir={service.onTous}
          />
        </span>
        <span className="shrink-0 text-faint" aria-hidden>
          /
        </span>
        <span className="group/cran flex min-w-0 max-w-[40%] shrink-0 items-center">
          {/* UN VRAI LIEN (MEM-6859) : la liste du service, limitée au projet ; un clic du milieu l'ouvre ailleurs. */}
          <a
            href={'#' + service.adresse.replace(/^#/, '')}
            className="min-w-0 truncate rounded-md px-1 py-0.5 text-muted transition-colors hover:text-text"
            data-cran-du-projet
            onClick={(event) => {
              if (lienPourUnAutreOnglet(event)) return;
              event.preventDefault();
              service.onOuvrir();
            }}
          >
            {project.name}
          </a>
          <ChevronDesVoisins
            voisins={{ nom: project.name, valeur: project.id, options: voisins, titre: t('Projets'), repere: 'projet', onChoisir: service.onAutreProjet }}
            onOuvrir={service.onOuvrir}
          />
        </span>
        {suite}
      </nav>
    );
  }
  return (
    <nav aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px]" data-fil-du-projet={project.id}>
      {sansIcone ? null : (
        <a
          href={`#projet/${encodeURIComponent(project.id)}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-raised"
          aria-label={project.name}
          data-icone-du-cran
          onClick={allerALAccueil}
        >
          <PastilleProjet project={project} taille={18} />
        </a>
      )}
      <span className={cn('group/cran flex min-w-0 items-center', titre ? 'max-w-[40%] shrink-0' : 'shrink-0')}>
        <a
          href={`#projet/${encodeURIComponent(project.id)}`}
          className={cn('min-w-0 truncate rounded-md px-1 py-0.5 transition-colors hover:text-text', titre ? 'text-muted' : 'font-medium text-text')}
          data-cran-du-projet
          aria-current={titre ? undefined : 'page'}
          onClick={allerALAccueil}
        >
          {project.name}
        </a>
        {titre && !sansIcone ? (
          <ChevronDesVoisins
            voisins={{
              nom: project.name,
              valeur: project.id,
              options: voisins,
              titre: t('Projets'),
              repere: 'projet',
              onChoisir: (id) => naviguerVers(`projet/${encodeURIComponent(id)}`),
            }}
            onOuvrir={onAccueil}
          />
        ) : null}
      </span>
      {titre ? (
        <>
          <span className="shrink-0 text-faint" aria-hidden>
            /
          </span>
          <span className="min-w-0 truncate font-medium text-text" aria-current="page" data-titre-du-fil title={titre}>
            {titre}
          </span>
        </>
      ) : null}
    </nav>
  );
}

/** Un clic qui veut un AUTRE onglet du navigateur (milieu, Cmd/Ctrl, Maj) : on laisse faire le lien. */
function lienPourUnAutreOnglet(event: React.MouseEvent) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/*
 * LE BOUTON AUX QUATRE CARRÉS N'EXISTE PLUS (décision du 14/11/2026) : les services s'ouvrent par « Services », dans la
 * colonne de gauche (`menus-de-la-colonne.tsx`) ; Fichiers et Pièces jointes, par le menu ⋮ de la colonne.
 */
