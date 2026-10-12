import { CheckCheck, Eye } from 'lucide-react';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES DEUX COMMANDES DE L'ŒIL « DÉJÀ VUE », pour une liste de beaucoup d'images :
 * le filtre « pas encore vues » et le bouton « tout marquer comme vu ». Posées
 * à droite du titre de la bande « Ce que l'agent a vu » et en tête de l'onglet
 * des pièces jointes — une seule présentation, jamais deux.
 *
 * Elles ne parlent QUE des images que le compte n'a pas encore ouvertes (`nonVues`,
 * `capturesPasEncoreVues`) : le filtre n'agit que sur l'affichage des vignettes,
 * jamais sur la série que la visionneuse feuillette. Texte discret, sans
 * bordure ; le violet ne sert qu'à dire « le filtre est choisi ».
 *
 * UNE SEULE RANGÉE, JAMAIS DE RETOUR À LA LIGNE : le bloc prend la place qui
 * reste à droite de son voisin (`flex-1`) et s'y cale à droite. Selon la
 * LARGEUR DE CETTE PLACE (requête de conteneur, `styles.css`), il dit les mots
 * en entier ou se réduit à l'œil et son nombre, et à la double coche — le
 * texte complet reste lu par les lecteurs d'écran (il n'est que masqué à l'œil)
 * et dans l'infobulle. Il sert dans la
 * bande des captures ET dans l'onglet des pièces jointes : la place, pas
 * l'écran, décide.
 */
export function CommandesDesVues({
  nonVues,
  filtre,
  onFiltre,
  onToutMarquer,
  className,
}: {
  /** Combien d'images ce compte n'a pas encore ouvertes en grand. */
  nonVues: number;
  filtre: boolean;
  onFiltre: (actif: boolean) => void;
  onToutMarquer: () => void;
  className?: string;
}) {
  const tout = nonVues === 0;
  const base = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] transition-colors';
  return (
    <span className={cn('commandes-des-vues flex min-w-0 flex-1 items-center justify-end gap-x-0.5', className)} data-commandes-des-vues>
      <button
        type="button"
        data-filtre-pas-vues
        aria-pressed={filtre}
        onClick={() => onFiltre(!filtre)}
        title={filtre ? t('Montrer toutes les images') : t('Ne montrer que les images pas encore vues')}
        className={cn(base, 'shrink-0', filtre ? 'text-accent' : 'text-faint hover:text-text')}
      >
        <Eye className="h-3 w-3" aria-hidden />
        <span className="commandes-court tabular-nums" aria-hidden>
          {nonVues}
        </span>
        <span className="commandes-long whitespace-nowrap tabular-nums">{t('Pas encore vues ({n})', { n: nonVues })}</span>
      </button>
      <button
        type="button"
        data-tout-marquer-vu
        disabled={tout}
        onClick={onToutMarquer}
        title={tout ? t('Toutes les images ont déjà été vues') : t('Tout marquer comme vu')}
        className={cn(base, 'shrink-0', tout ? 'cursor-default text-faint/50' : 'text-faint hover:text-text')}
      >
        <CheckCheck className="h-3 w-3" aria-hidden />
        <span className="commandes-long whitespace-nowrap">{t('Tout marquer comme vu')}</span>
      </button>
    </span>
  );
}

/** Le filtre est actif et plus rien n'est à voir : la liste le dit au lieu de rester vide. */
export function RienDeNouveau({ className }: { className?: string }) {
  return (
    <p className={cn('text-[12.5px] text-faint', className)} data-aucune-pas-vue>
      {t('Toutes les images ont déjà été vues')}
    </p>
  );
}
