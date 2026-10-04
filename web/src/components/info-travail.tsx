import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lancerIntervalleVisible } from '@/lib/veille';

/**
 * LES TROIS DONNÉES DU TRAVAIL EN COURS, ÉCRITES UNE SEULE FOIS.
 *
 * Avant, l'avancement (n/N) et le temps écoulé vivaient dans deux éléments
 * séparés à côté du texte de statut — et le même texte (l'étape en cours,
 * son compte, son temps) se répétait entre la bande « Liste des tâches » et
 * la barre au-dessus du composeur. Regroupés ici en UN chip, dans l'ordre
 * demandé — le STATUT d'abord (le témoin animé + ce que l'agent fait), puis
 * l'INDICATION des todo (le compte et le temps, ensemble) — ce composant sert
 * aussi bien la barre du tiroir (avec son bouton d'arrêt, posé par l'appelant)
 * que la bande sous une carte du tableau (sans bouton du tout).
 */
/*
 * Le rythme de la rotation, en millisecondes : assez lent pour se lire, assez
 * rapide pour ne pas donner l'impression d'un chiffre figé.
 */
const RYTHME_ALTERNANCE_MS = 2500;

export function InfoTravail({
  quoi,
  avancement,
  temps,
  className,
  icone,
  alterner = false,
}: {
  quoi: string;
  avancement?: { done: number; total: number } | null;
  temps?: string | null;
  className?: string;
  /*
   * L'ICÔNE DE GAUCHE. Par défaut la roue qui tourne — l'agent travaille. Une
   * fois le tour refermé, le même repère reste à sa place mais ne tourne plus :
   * l'appelant pose alors une coche (tout est fait) ou un point (il reste
   * quelque chose), comme le faisait l'ancienne barre pleine largeur.
   */
  icone?: React.ReactNode;
  /*
   * Sur la carte du tableau, la pastille est trop étroite pour porter le
   * compte des étapes ET le chronomètre à la fois — contrairement à la barre
   * au-dessus du composeur, plus large. `alterner` fait alors tourner
   * l'affichage entre les deux, à un rythme régulier, plutôt que de les
   * concaténer.
   */
  alterner?: boolean;
}) {
  const [afficherAvancement, setAfficherAvancement] = React.useState(true);
  const rotationActive = alterner && !!avancement && !!temps;
  React.useEffect(() => {
    if (!rotationActive) return;
    return lancerIntervalleVisible(() => setAfficherAvancement((v) => !v), RYTHME_ALTERNANCE_MS);
  }, [rotationActive]);

  return (
    <>
      {icone ?? <Loader2 className={cn('h-3 w-3 shrink-0 animate-spin text-en-cours', className)} />}
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{quoi}</span>
      {avancement || temps ? (
        <span
          data-avancement-travail
          className="shrink-0 rounded border border-border px-1 text-[11px] tabular-nums text-faint"
        >
          {rotationActive ? (
            afficherAvancement ? (
              `${avancement.done}/${avancement.total}`
            ) : (
              temps
            )
          ) : (
            <>
              {avancement ? `${avancement.done}/${avancement.total}` : null}
              {avancement && temps ? ' · ' : null}
              {temps ?? null}
            </>
          )}
        </span>
      ) : null}
    </>
  );
}
