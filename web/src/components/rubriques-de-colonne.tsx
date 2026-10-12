import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { CLASSE_BOUTON_DE_CREATION } from '@/components/ui';
import { CLASSE_LIBELLE_EN_BANDE, CLASSE_LIGNE_DE_SERVICE, CLASSE_LIGNE_EN_BANDE } from '@/components/colonne-de-service';
import { cn } from '@/lib/utils';

/**
 * LES DEUX PIÈCES DE LA COLONNE PROPRE D'UN SERVICE (demande du 12/10/2026 :
 * « chaque sidebar de chaque service doit être spécifique au service »).
 *
 *  - LE GESTE QUI CRÉE, en tête, noir et DÉTACHÉ des rubriques qui le suivent :
 *    « Nouvelle tâche » dans un projet, « Nouvel accès » dans le coffre-fort,
 *    « Nouvelle surveillance »… Un seul dessin pour tous, pour qu'ils restent
 *    frères ;
 *  - UNE RUBRIQUE, sur la ligne de la colonne : la rubrique ouverte est
 *    retenue en violet (`aria-current`), un chiffre gris à droite quand elle
 *    compte quelque chose.
 *
 * Un service les pose dans `ColonneDeService`. Sur téléphone la colonne n'existe
 * pas : il garde ses gestes dans sa page (`useColonneDeService`).
 */

/** Noir, écriture blanche, détaché (`mb-3`) : posé APRÈS la ligne de service, dont il remplace le texte gris. */
export const CLASSE_GESTE_DE_CREATION_DE_COLONNE = cn(
  CLASSE_LIGNE_DE_SERVICE,
  CLASSE_LIGNE_EN_BANDE,
  'mb-3 font-medium',
  CLASSE_BOUTON_DE_CREATION,
  'disabled:opacity-50',
);

type PropsDeBouton = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** Le geste qui crée, en tête de la colonne. Il porte un `ref` : il peut être le déclencheur d'un menu. */
export const GesteDeCreationDeColonne = React.forwardRef<
  HTMLButtonElement,
  PropsDeBouton & { libelle: string; enCours?: boolean }
>(function GesteDeCreationDeColonne({ libelle, enCours, className, ...reste }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-busy={enCours || undefined}
      className={cn(CLASSE_GESTE_DE_CREATION_DE_COLONNE, className)}
      {...reste}
    >
      <span className="shrink-0">{enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</span>
      <span className={cn('min-w-0 flex-1 truncate', CLASSE_LIBELLE_EN_BANDE)}>{libelle}</span>
    </button>
  );
});

/** Une rubrique du menu d'un service. `actif` : celle qu'on regarde. */
export const RubriqueDeColonne = React.forwardRef<
  HTMLButtonElement,
  PropsDeBouton & {
    icone: React.ReactNode;
    libelle: string;
    actif?: boolean;
    /** Un chiffre gris à droite : ce que la rubrique contient. */
    compte?: number;
    /** Une seconde ligne, petite et grise, sous le libellé (le projet d'un client). */
    detail?: string;
    /** Un nœud posé à droite à la place du chiffre gris (les pastilles d'un client). */
    fin?: React.ReactNode;
    /** Une roue à la place de l'icône : le geste de la ligne tourne. */
    enCours?: boolean;
  }
>(function RubriqueDeColonne({ icone, libelle, actif, compte, detail, fin, enCours, className, ...reste }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-current={actif ? 'page' : undefined}
      aria-busy={enCours || undefined}
      className={cn(
        CLASSE_LIGNE_DE_SERVICE,
        actif ? 'bg-ligne-active text-teinte' : 'hover:bg-raised',
        'disabled:opacity-50',
        className,
      )}
      {...reste}
    >
      <span className="shrink-0 text-muted [&_svg]:h-4 [&_svg]:w-4">
        {enCours ? <Loader2 className="animate-spin" /> : icone}
      </span>
      {detail ? (
        <span className="min-w-0 flex-1 text-left leading-tight">
          <span className="block truncate">{libelle}</span>
          <span className="block truncate text-[11.5px] text-faint" data-rubrique-detail>
            {detail}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{libelle}</span>
      )}
      {fin ? <span className="flex shrink-0 items-center gap-1">{fin}</span> : null}
      {!fin && compte ? <span className="shrink-0 text-[12.5px] tabular-nums text-faint">{compte}</span> : null}
    </button>
  );
});
