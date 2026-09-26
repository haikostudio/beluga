import { cn } from '@/lib/utils';

/**
 * LA BARRE FINE D'AVANCEMENT, une seule pièce pour les cartes en travail et le
 * bandeau de mise en production.
 *
 * Un RAIL sur toute la largeur, tracé en `--faint` (un trait qui porte une
 * information ne suit jamais `--border`, invisible sur les thèmes plats), et un
 * REMPLISSAGE à la couleur du thème. Quelques pixels de haut : elle se pose au
 * bord d'un élément existant sans en changer la hauteur.
 *
 * Sans chiffre connu (`indeterminee`), un tiers de barre traverse le rail en
 * continu — une animation CSS pure, aucune minuterie par carte. Avec « moins
 * d'animations », le segment s'immobilise et le rail se remplit à moitié
 * opacité : on voit qu'il se passe quelque chose, sans mouvement.
 *
 * `erreur` passe le remplissage en couleur d'échec, là où il s'est arrêté.
 * `teinte` choisit la couleur du remplissage hors échec : l'accent par défaut
 * (les cartes), l'orangé « en cours » ou le bleu de réussite pour le bandeau de
 * production, qui reprend ainsi la couleur du chiffre de son déroulé.
 */
const REMPLISSAGE = { accent: 'bg-accent', 'en-cours': 'bg-en-cours', success: 'bg-success' } as const;

export function BarreProgression({
  pourcent,
  indeterminee = false,
  erreur = false,
  teinte = 'accent',
  className,
  ...attributs
}: {
  pourcent?: number | null;
  indeterminee?: boolean;
  erreur?: boolean;
  teinte?: keyof typeof REMPLISSAGE;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const borne = Math.min(Math.max(Math.round(pourcent ?? 0), 0), 100);
  const sansChiffre = indeterminee || pourcent === null || pourcent === undefined;
  const remplissage = erreur ? 'bg-danger' : REMPLISSAGE[teinte];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={sansChiffre ? undefined : borne}
      data-barre-progression=""
      data-pourcent={sansChiffre ? undefined : borne}
      data-indeterminee={sansChiffre ? 'oui' : undefined}
      data-erreur={erreur ? 'oui' : undefined}
      data-teinte={erreur ? 'danger' : teinte}
      className={cn('relative h-[3px] w-full overflow-hidden bg-faint/25', className)}
      {...attributs}
    >
      {sansChiffre ? (
        <span
          className={cn(
            'absolute inset-y-0 left-0 w-1/3 animate-cadrage-glisse',
            'motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50',
            remplissage,
          )}
        />
      ) : (
        <span
          className={cn(
            'block h-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
            remplissage,
          )}
          style={{ width: `${borne}%` }}
        />
      )}
    </div>
  );
}
