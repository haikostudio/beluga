import * as React from 'react';
import { PastilleProjet } from '@/components/pastille-projet';
import type { ColonneDuTableauCommun } from '@/components/ui/tableau';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';

/**
 * LA COLONNE « PROJET » COMMUNE AUX DIX SERVICES (carte « Services homogènes et centrés », 14/11/2026 : « dans le tableau
 * on doit avoir le nom du projet concerné »). Une seule forme partout : la pastille du projet, puis son nom. Un service
 * donne ce qu'il connaît du projet de la ligne — son identifiant, ou à défaut son nom — et la cellule retrouve le
 * projet dans la liste de l'application pour sa pastille.
 */
export interface ProjetDeLigne {
  id?: string | null;
  nom?: string | null;
}

export function CelluleProjet({ id, nom }: ProjetDeLigne) {
  const projets = useApp().projects;
  const projet = (id ? projets.find((p) => p.id === id) : null) ?? (nom ? projets.find((p) => p.name === nom) : null) ?? null;
  const libelle = projet?.name ?? nom ?? null;
  if (!libelle) return <span className="text-faint">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px]" data-cellule-projet={projet?.id ?? libelle}>
      {projet ? <PastilleProjet project={projet} /> : null}
      <span className="min-w-0 truncate text-muted">{libelle}</span>
    </span>
  );
}

/** La colonne « Projet » d'un tableau : triable sur le nom, la pastille devant. */
export function colonneProjet<L>(lire: (ligne: L) => ProjetDeLigne, options: { largeur?: number; secondaire?: boolean } = {}): ColonneDuTableauCommun<L> {
  return {
    cle: 'projet',
    libelle: t('Projet'),
    largeur: options.largeur ?? 180,
    ...(options.secondaire ? { secondaire: true } : {}),
    valeur: (ligne) => lire(ligne).nom ?? '',
    rendu: (ligne) => {
      const p = lire(ligne);
      return <CelluleProjet id={p.id ?? null} nom={p.nom ?? null} />;
    },
  };
}
