import * as React from 'react';
import type { Project } from '@beluga/shared';

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
export function PastilleProjet({ project }: { project: Project }) {
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

export function PastillesEmpilees({ projects }: { projects: Project[] }) {
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
            backgroundColor: 'hsl(var(--fond-zone, var(--bg)))',
            boxShadow: '0 0 0 1px hsl(var(--fond-zone, var(--bg)))',
          }}
        >
          <PastilleProjet project={membre} />
        </span>
      ))}
    </span>
  );
}
