import * as React from 'react';
import type { PointPrecedent } from '@beluga/shared';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Au-delà, les sujets d'avant se replient sur les derniers, avec « Voir les n autres ». */
const SUJETS_VISIBLES = 8;
const DUREE_DE_L_ECLAIRAGE_MS = 1200;

/**
 * LES SUJETS DU CADRAGE, posés AU-DESSUS de la réponse de chaque itération
 * (décision du 20/10/2026, refaite le 21/10/2026 : « je veux du texte avec un
 * titre qui illustre le sujet et en dessous le résumé de ce que ça va faire »).
 *
 * Du TEXTE, pas des boutons : tous les sujets dans l'ordre chronologique,
 * chacun son titre puis son résumé en gris ; le sujet du tour ferme la liste,
 * titre en GRAS, et la réponse qui suit lui sert de résumé. Le titre d'un sujet
 * d'avant reste un lien discret (souligné au survol) qui remonte à sa réponse
 * et l'éclaire un instant ; son résumé n'est jamais dans ce lien. Ce n'est pas
 * le cahier des charges, qui ne s'affiche que sous le plan.
 */
export function PointsDuCadrage({ points, className }: { points: readonly PointPrecedent[]; className?: string }) {
  const [tout, setTout] = React.useState(false);
  if (!points.length) return null;
  const avant = points.filter((p) => !p.courant);
  const courant = points.find((p) => p.courant);
  const caches = tout ? 0 : Math.max(0, avant.length - SUJETS_VISIBLES);
  const visibles = avant.slice(caches);

  const aller = (cle: string) => {
    const cible = document.querySelector<HTMLElement>(`[data-bloc-reponse="${cle}"], [data-bloc-comprehension="${cle}"]`);
    if (!cible) return;
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    cible.scrollIntoView({ block: 'start', behavior: reduit ? 'auto' : 'smooth' });
    if (reduit) return;
    cible.setAttribute('data-reponse-eclairee', '');
    window.setTimeout(() => cible.removeAttribute('data-reponse-eclairee'), DUREE_DE_L_ECLAIRAGE_MS);
  };

  const lien =
    'cursor-pointer rounded-sm text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint';

  return (
    /* `-mb-1.5` : le titre en gras se lit avec la réponse qui le suit. */
    <nav className={cn('-mb-1.5 flex flex-col gap-3', className)} aria-label={t('Sujets de cette carte')} data-points-du-cadrage={points.length}>
      {caches ? (
        <button type="button" className={cn(lien, 'self-start text-[13px] text-faint')} onClick={() => setTout(true)} data-points-du-cadrage-tout>
          {t('Voir les {n} autres', { n: caches })}
        </button>
      ) : null}
      {visibles.map((point) => (
        <section key={point.cle} className="min-w-0" data-point-du-cadrage={point.rang}>
          <h4 className="text-[14.5px] font-normal leading-relaxed text-text">
            <button
              type="button"
              className={lien}
              onClick={() => aller(point.cle)}
              title={t('Remonter à la réponse de ce sujet')}
              data-point-du-cadrage-cible={point.cle}
            >
              {point.titre}
            </button>
          </h4>
          {point.resume ? (
            <p className="whitespace-pre-line break-words text-[14.5px] leading-relaxed text-muted" data-point-du-cadrage-resume>
              {point.resume}
            </p>
          ) : null}
        </section>
      ))}
      {courant ? (
        <h4
          className="min-w-0 break-words text-[14.5px] font-semibold leading-relaxed text-text"
          data-point-du-cadrage={courant.rang}
          data-point-du-cadrage-courant
        >
          {courant.titre}
        </h4>
      ) : null}
    </nav>
  );
}
