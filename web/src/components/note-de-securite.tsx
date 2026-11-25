import * as React from 'react';
import { noteEnAlerte } from '@beluga/shared';
import { cn } from '@/lib/utils';

/**
 * LES ÉLÉMENTS VISUELS DE LA NOTE DE SÉCURITÉ (carte « Sécurité : bilan, écran et historique », 25/11/2026,
 * maquettes #2312 et #c972) : l'anneau de la note, la barre d'une gravité, la courbe d'évolution. Sur le modèle de la
 * note du référencement dans le Marketing, mais à part : ces fichiers-là sont privés, celui-ci part avec le service.
 *
 * MONOCHROME : l'arc suit `--text`, et ne prend la teinte importante qu'en ALERTE (note sous 40).
 */

/** L'anneau de la note (0 à 100). `children` se pose au centre. */
export function AnneauDeNote({
  note,
  taille = 92,
  epaisseur = 6,
  children,
  className,
}: {
  note: number | null;
  taille?: number;
  epaisseur?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const r = (taille - epaisseur) / 2;
  const tour = 2 * Math.PI * r;
  const plein = Math.max(0, Math.min(100, note ?? 0));
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: taille, height: taille }} data-anneau-note={note ?? ''}>
      <svg width={taille} height={taille} viewBox={`0 0 ${taille} ${taille}`} className="-rotate-90" aria-hidden>
        <circle cx={taille / 2} cy={taille / 2} r={r} fill="none" stroke="currentColor" strokeWidth={epaisseur} className="text-faint/35" />
        {note !== null && plein > 0 ? (
          <circle
            cx={taille / 2}
            cy={taille / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={epaisseur}
            strokeLinecap="round"
            strokeDasharray={`${(tour * plein) / 100} ${tour}`}
            className={cn('transition-[stroke-dasharray] duration-500', noteEnAlerte(note) ? 'text-important' : 'text-text')}
          />
        ) : null}
      </svg>
      {children ? <span className="absolute inset-0 flex flex-col items-center justify-center">{children}</span> : null}
    </span>
  );
}

/** La note en petit, pour une ligne de tableau : un anneau de 22 px et le chiffre en gras. */
export function NoteEnLigne({ note }: { note: number | null | undefined }) {
  if (note === null || note === undefined) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2 font-semibold tabular-nums text-text" data-securite-note={note}>
      <AnneauDeNote note={note} taille={22} epaisseur={3} />
      {note}
    </span>
  );
}

/** La barre d'une gravité : son nom, la part qu'elle occupe, son nombre. */
export function BarreDeGravite({ libelle, valeur, maximum, teinte }: { libelle: string; valeur: number; maximum: number; teinte: 'important' | 'text' | 'muted' }) {
  const part = maximum > 0 ? (100 * valeur) / maximum : 0;
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12.5px]" data-securite-barre={libelle}>
      <span className="w-[66px] shrink-0 truncate text-muted">{libelle}</span>
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-faint/30" aria-hidden>
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full', teinte === 'important' ? 'bg-important' : teinte === 'text' ? 'bg-text' : 'bg-muted')}
          style={{ width: `${valeur ? Math.max(part, 3) : 0}%` }}
        />
      </span>
      <span className="w-5 shrink-0 text-right tabular-nums text-text">{valeur}</span>
    </div>
  );
}

/** La courbe de la note d'un audit à l'autre (trait `--text`, points aux extrémités). */
export function CourbeDeNote({ points }: { points: { lance: number; note: number }[] }) {
  if (points.length < 2) return null;
  const L = 300;
  const H = 48;
  const t0 = points[0]!.lance;
  const t1 = Math.max(t0 + 1, points[points.length - 1]!.lance);
  const x = (at: number) => ((at - t0) / (t1 - t0)) * L;
  const y = (n: number) => H - 4 - (n / 100) * (H - 8);
  const trace = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.lance).toFixed(1)},${y(p.note).toFixed(1)}`).join(' ');
  const dernier = points[points.length - 1]!;
  return (
    <div className="relative h-12 w-full" aria-hidden data-securite-courbe={points.length}>
      <svg viewBox={`0 0 ${L} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
        <path d={trace} fill="none" stroke="hsl(var(--text))" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text"
        style={{ left: `${(100 * x(dernier.lance)) / L}%`, top: `${(100 * y(dernier.note)) / H}%` }}
      />
    </div>
  );
}
