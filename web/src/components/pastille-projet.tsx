import * as React from 'react';
import { estUnRegroupement, membresActifsDuRegroupement, type Project } from '@beluga/shared';

/**
 * L'icône de repos d'une ligne de projet : le favicon que le SERVEUR a su
 * récupérer (`project.favicon`, `server/src/favicon.ts` — sur l'adresse
 * publique du projet, ou dans son DÉPÔT à défaut ; le navigateur, lui, est
 * trop souvent bloqué : mélange http/https, en-têtes qui refusent l'inclusion
 * croisée), sinon un rond avec ses initiales — jamais le dossier générique,
 * qui ne disait rien du projet. Partagée par la colonne de gauche et par les
 * cartes des tableaux de bord (`en-route.tsx`), pour qu'un projet ait le même
 * visage partout.
 */
export function PastilleProjet({ project }: { project: Pick<Project, 'name' | 'favicon'> }) {
  // Une image qui ne se charge pas (fichier retiré, session expirée) laisse
  // sinon un carré vide : on revient aux initiales, jamais une image cassée.
  const [cassee, setCassee] = React.useState(false);
  React.useEffect(() => setCassee(false), [project.favicon]);

  if (project.favicon && !cassee) {
    return (
      <img
        src={project.favicon}
        alt=""
        aria-hidden
        data-favicon-projet
        onError={() => setCassee(true)}
        className="h-[15px] w-[15px] shrink-0 rounded-sm object-contain"
      />
    );
  }

  const initiales =
    project.name
      .trim()
      .split(/\s+/)
      .map((mot) => mot[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  return (
    <span
      aria-hidden
      data-initiales-projet
      className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-raised text-[9px] font-medium leading-none text-faint"
    >
      {initiales}
    </span>
  );
}

/** Pas de la pile : chaque icône suivante se décale de 4 px vers la droite. */
const DECALAGE_PILE = 4;
/** Au plus trois icônes : au-delà, la pile ne se lit plus à 15 px. */
const PILE_MAX = 3;

/**
 * L'icône d'un PROJET RÉUNI : les favicons de ses premiers membres (dans
 * l'ordre de la liste), superposés en léger décalé, le premier devant. Chaque
 * icône porte un fond et un liseré de la couleur de sa zone (`--fond-zone`,
 * `styles.css`) pour que deux favicons identiques ne se fondent pas en une
 * seule tache. Hauteur 15 px, comme `PastilleProjet` : la ligne garde sa
 * hauteur fixe dans les deux modes de la colonne. Sans membre, l'appelant
 * garde `PastilleProjet`.
 */
/** La largeur, en px, de la pile des favicons de `nombre` membres. */
export function largeurPile(nombre: number): number {
  return 15 + DECALAGE_PILE * (Math.min(Math.max(nombre, 1), PILE_MAX) - 1);
}

export function PastillesEmpilees({
  projects,
  fond = 'hsl(var(--fond-zone, var(--bg)))',
}: {
  projects: Project[];
  /** La couleur du support de la pile : celle de la zone par défaut, `--raised` sur une carte. */
  fond?: string;
}) {
  const pile = projects.slice(0, PILE_MAX);
  return (
    <span
      aria-hidden
      data-pile-favicons={pile.length}
      className="relative inline-block h-[15px] shrink-0"
      style={{ width: largeurPile(pile.length) }}
    >
      {pile.map((membre, i) => (
        <span
          key={membre.id}
          className="absolute top-0 flex rounded-sm"
          style={{
            left: i * DECALAGE_PILE,
            zIndex: pile.length - i,
            // Fond PLEIN en plus du liseré : un favicon transparent laisserait
            // sinon voir celui de derrière à travers lui.
            backgroundColor: fond,
            boxShadow: `0 0 0 1px ${fond}`,
          }}
        >
          <PastilleProjet project={membre} />
        </span>
      ))}
    </span>
  );
}

/**
 * L'ICÔNE D'UNE LIGNE DE PROJET DANS UNE LISTE DE CHOIX : la pile des favicons
 * de ses membres actifs pour un projet réuni, sinon sa pastille. `projets` est
 * la liste entière de l'application — pas la liste affichée : une recherche qui
 * écarte un membre ne retire pas son icône de la pile.
 */
export function IconeDeProjet({
  projet,
  projets,
  fond,
}: {
  projet: Project;
  projets: readonly Project[];
  fond?: string;
}) {
  const membres = estUnRegroupement(projet) ? membresActifsDuRegroupement(projets, projet.id) : [];
  return membres.length ? <PastillesEmpilees projects={membres} fond={fond} /> : <PastilleProjet project={projet} />;
}

/** La largeur, en px, de l'icône que `IconeDeProjet` pose pour ce projet. */
export function largeurIconeDeProjet(projet: Project | undefined, projets: readonly Project[]): number {
  return largeurPile(projet && estUnRegroupement(projet) ? membresActifsDuRegroupement(projets, projet.id).length : 1);
}

/**
 * OÙ TOMBENT LES ICÔNES DANS UNE LISTE DE CHOIX, en px : la hauteur d'une ligne,
 * l'écart entre deux lignes, le bord gauche de l'icône d'une ligne ordinaire et
 * celui de l'icône d'un membre (son retrait). La branche se cale dessus.
 */
export interface GeometrieDeListe {
  hauteur: number;
  ecart: number;
  icone: number;
  iconeMembre: number;
}

/** Les deux tiroirs (« Dans quel projet ? », « Changer de projet ») : lignes `h-10 px-2`, `gap-0.5`. */
export const LISTE_DE_TIROIR: GeometrieDeListe = { hauteur: 40, ecart: 2, icone: 8, iconeMembre: 28 };
/** La classe du retrait d'un membre dans un tiroir : elle pose son icône à `iconeMembre`. */
export const RETRAIT_MEMBRE_DE_TIROIR = 'pl-7';
/** Le sous-menu « Déplacer vers un autre projet » : entrées `h-8 px-2`, collées. */
export const LISTE_DE_MENU: GeometrieDeListe = { hauteur: 32, ecart: 0, icone: 8, iconeMembre: 28 };
export const RETRAIT_MEMBRE_DE_MENU = 'pl-7';

/**
 * LA BRANCHE D'ARBORESCENCE D'UN MEMBRE DANS UNE LISTE DE CHOIX — le pendant,
 * pour une liste à lignes fixes, de `BrancheMembre` (`sidebar.tsx`), dont la
 * géométrie reste calée sur la colonne de gauche. Un trait vertical descend du
 * milieu bas de l'icône du projet réuni, un trait horizontal s'arrête à 2 px de
 * l'icône du membre ; chez le dernier, le vertical tourne en coude arrondi.
 *
 * À poser dans la ligne du membre, elle-même `relative`. Absolue et sans
 * pointeur : elle ne change ni la hauteur de la ligne ni ce qu'on y clique.
 */
export function BrancheDeListe({
  premier,
  dernier,
  largeurParent,
  geometrie,
}: {
  premier: boolean;
  dernier: boolean;
  /** La largeur de l'icône du projet réuni (`largeurIconeDeProjet`) : elle déplace l'axe. */
  largeurParent: number;
  geometrie: GeometrieDeListe;
}) {
  const { hauteur, ecart, icone, iconeMembre } = geometrie;
  const axe = icone + largeurParent / 2;
  const milieu = hauteur / 2;
  // Le premier remonte jusque sous l'icône du parent (1,5 px d'air) ; les
  // suivants couvrent seulement l'écart qui les sépare de la ligne du dessus.
  const haut = premier ? -(ecart + milieu - 7.5) + 1.5 : -ecart;
  const largeur = iconeMembre - 2 - axe;
  // Un trait qui porte une information suit `--faint`, atténué pour rester discret.
  const trait = 'pointer-events-none absolute border-faint opacity-50';
  return (
    /* Elle-même hors du flux : posée dans une ligne en `flex`, elle ne doit ni
       prendre de place ni ajouter l'écart d'un enfant de plus. */
    <span
      aria-hidden
      data-branche-de-liste={dernier ? 'dernier' : 'milieu'}
      className="pointer-events-none absolute inset-0"
    >
      {dernier ? (
        <span
          className={`${trait} rounded-bl-[5px] border-b border-l`}
          style={{ left: axe, top: haut, height: milieu - haut, width: largeur }}
        />
      ) : (
        <>
          <span className={`${trait} bottom-0 border-l`} style={{ left: axe, top: haut }} />
          <span className={`${trait} border-t`} style={{ left: axe, top: milieu - 1, width: largeur }} />
        </>
      )}
    </span>
  );
}
