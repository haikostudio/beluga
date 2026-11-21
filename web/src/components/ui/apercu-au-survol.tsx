import * as React from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, List } from '@/components/ui/icones';
import { t } from '@/lib/langue';
import { usePref } from '@/lib/prefs';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { cn } from '@/lib/utils';

/**
 * L'APERÇU AU SURVOL D'UNE LIGNE DE TABLEAU (carte « Onglets, services et listes repensés », 14/11/2026, maquette 5 ;
 * étendu à tous les services le même jour). Sous une vraie souris (`pointer: fine`), après 300 ms sur une ligne du
 * `Tableau` commun (repère `data-ligne-de-tableau=<clé>`), une carte flottante de 320 px montre ce que `rendu` dit de
 * la ligne. Posée dans un portail, `pointer-events-none` : elle n'intercepte jamais un clic. Rien au doigt (pas de
 * survol), rien quand `actif` est faux (vue « cartes »). Bornée à la fenêtre.
 *
 * Repère : `data-apercu-au-survol=<clé de la ligne>`.
 */
export function ApercuAuSurvol<L>({
  lire,
  rendu,
  actif = true,
  children,
}: {
  /** La ligne d'une clé, prise dans ce que l'écran a déjà chargé (aucune lecture serveur de plus). */
  lire: (cle: string) => L | null | undefined;
  rendu: (ligne: L) => React.ReactNode;
  actif?: boolean;
  children: React.ReactNode;
}) {
  const [survol, setSurvol] = React.useState<{ cle: string; x: number; y: number } | null>(null);
  const minuterie = React.useRef<number | null>(null);
  const enAttente = React.useRef<string | null>(null);
  const finePointe = React.useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches, []);
  const annuler = () => {
    if (minuterie.current) window.clearTimeout(minuterie.current);
    minuterie.current = null;
    enAttente.current = null;
  };
  React.useEffect(() => annuler, []);
  React.useEffect(() => {
    if (!actif) {
      annuler();
      setSurvol(null);
    }
  }, [actif]);
  const ligne = survol ? lire(survol.cle) ?? null : null;
  return (
    <div
      className="min-w-0"
      onMouseMove={(event) => {
        if (!actif || !finePointe) return;
        /* PAS D'APERÇU PAR-DESSUS UN MENU (21/11/2026) : sur les trois points d'une ligne, ou tant qu'un menu est
           ouvert, l'aperçu se tait — il passait sous le menu de la ligne. */
        if ((event.target as HTMLElement).closest('[data-trois-points]') || document.querySelector('[role="menu"]')) {
          annuler();
          if (survol) setSurvol(null);
          return;
        }
        const cible = (event.target as HTMLElement).closest<HTMLElement>('[data-ligne-de-tableau]');
        const cle = cible?.getAttribute('data-ligne-de-tableau') || null;
        if (!cle || !cible) {
          annuler();
          if (survol) setSurvol(null);
          return;
        }
        if (survol?.cle === cle || enAttente.current === cle) return;
        annuler();
        if (survol) setSurvol(null);
        const boite = cible.getBoundingClientRect();
        const x = event.clientX;
        enAttente.current = cle;
        minuterie.current = window.setTimeout(() => {
          minuterie.current = null;
          enAttente.current = null;
          setSurvol({ cle, x: Math.max(8, Math.min(x + 16, window.innerWidth - 340)), y: Math.max(8, Math.min(boite.bottom + 6, window.innerHeight - 420)) });
        }, 300);
      }}
      onMouseLeave={() => {
        annuler();
        setSurvol(null);
      }}
      onContextMenu={() => {
        annuler();
        setSurvol(null);
      }}
    >
      {children}
      {ligne && survol
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] w-[320px] overflow-hidden rounded-2xl bg-bg shadow-2xl ring-1 ring-faint/20"
              style={{ left: survol.x, top: survol.y }}
              data-apercu-au-survol={survol.cle}
            >
              {rendu(ligne)}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Le corps type d'un aperçu : une image facultative en tête, puis un titre, une phrase et des chiffres. */
export function CorpsDApercu({
  image,
  titre,
  sous,
  texte,
  chiffres,
  children,
}: {
  image?: React.ReactNode;
  titre: React.ReactNode;
  sous?: React.ReactNode;
  texte?: React.ReactNode;
  chiffres?: ReadonlyArray<{ libelle: React.ReactNode; valeur: React.ReactNode }>;
  children?: React.ReactNode;
}) {
  return (
    <>
      {image ? <div className="aspect-[16/9] w-full overflow-hidden bg-raised">{image}</div> : null}
      <div className="flex flex-col gap-1.5 p-4">
        {sous ? <span className="truncate text-[12px] text-muted">{sous}</span> : null}
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-text">{titre}</p>
        {texte ? <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted">{texte}</p> : null}
        {chiffres?.length ? (
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2" data-chiffres-de-l-apercu>
            {chiffres.map((c, i) => (
              <div key={i} className="flex min-w-0 flex-col rounded-lg bg-surface px-2.5 py-1.5">
                <dt className="truncate text-[11.5px] text-faint">{c.libelle}</dt>
                <dd className="truncate text-[13.5px] font-medium tabular-nums text-text">{c.valeur}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
      </div>
    </>
  );
}

/**
 * UNE COURBE D'APERÇU, monochrome (le violet est réservé à l'élément choisi) : une valeur par jour, de la plus
 * ancienne à la plus récente. Un trait plat pointillé quand rien n'a bougé.
 */
export function CourbeDApercu({ valeurs, legende }: { valeurs: readonly number[]; legende?: React.ReactNode }) {
  const n = valeurs.length;
  const max = Math.max(1, ...valeurs);
  const points = n >= 2 ? valeurs.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(38 - (v / max) * 34).toFixed(2)}`).join(' ') : '';
  return (
    <div className="flex flex-col gap-1 pt-2" data-courbe-d-apercu={n}>
      {points && valeurs.some((v) => v > 0) ? (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-14 w-full overflow-visible text-muted" aria-hidden>
          <polyline points={`0,40 ${points} 100,40`} fill="currentColor" fillOpacity={0.08} stroke="none" />
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : (
        <span aria-hidden className="block h-14 w-full border-b border-dashed border-faint/40" />
      )}
      {legende ? <span className="text-[11.5px] text-faint">{legende}</span> : null}
    </div>
  );
}

export type VueDeLaListe = 'tableau' | 'cartes';

/**
 * TABLEAU OU CARTES, DANS LES DIX SERVICES (carte « Services homogènes et centrés », 14/11/2026 : « des tableaux qui se
 * transforment en cartes, partout ») — la règle du même jour qui la réservait à Communication, Studio et Charte est
 * remplacée. Le choix est retenu par service (`<service>.vueDeLaListe`), partagé entre appareils. Les cartes passent
 * par la prop `grille` du tableau commun et la carte commune (`CarteDeTableau`).
 */
export function useVueDeLaListe(cle: string): [VueDeLaListe, (v: VueDeLaListe) => void] {
  return usePref<VueDeLaListe>(cle, 'tableau');
}

export function BasculeTableauCartes({ repere, valeur, onChange, className }: { repere: string; valeur: VueDeLaListe; onChange: (v: VueDeLaListe) => void; className?: string }) {
  return (
    <span className={cn('inline-flex', className)} data-bascule-tableau-cartes={repere}>
      <BarreDOnglets
        repere={repere}
        libelle={t('Affichage de la liste')}
        onglets={[
          { cle: 'tableau' as const, libelle: t('Tableau'), icone: <List className="h-4 w-4" />, iconeSeule: true },
          { cle: 'cartes' as const, libelle: t('Cartes'), icone: <LayoutGrid className="h-4 w-4" />, iconeSeule: true },
        ]}
        valeur={valeur}
        onChange={onChange}
      />
    </span>
  );
}
