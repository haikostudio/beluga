import * as React from 'react';
import { cheminLisse, type EtatAfficheDuSuivi, type FluxDeComportement, type FluxDUnParcours, type NoeudDeFlux, type ParcoursDeSuivi } from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';

/**
 * LES GRAPHIQUES DES VISITES — partagés par le service Statistiques
 * (`statistiques.tsx`) et le tableau de bord de l'atelier Marketing, qui en
 * garde la courbe globale et les petites tendances. Sortis de
 * `marketing.tsx` quand l'onglet Statistiques du Marketing est devenu un
 * service à part (27/09/2026). Les repères `data-marketing-*` restent : ce
 * sont eux que visent les contrôles.
 */

export async function copier(texte: string, quoi: string) {
  try {
    await navigator.clipboard.writeText(texte);
    client.pushToast('success', t('{quoi} copié', { quoi }));
  } catch {
    client.pushToast('error', t('Copie impossible'));
  }
}

export function dateCourte(jour: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Date(`${jour}T12:00:00`).toLocaleDateString(formatRegional(), options);
}

export function montant(centimes: number | null | undefined): string {
  if (typeof centimes !== 'number') return '—';
  return (centimes / 100).toLocaleString(formatRegional(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** L'état du suivi, dit pareil partout : liste, détail, bandeau, assistant (`etatAfficheDuSuivi`). */
export function libelleSuivi(etat: EtatAfficheDuSuivi): string {
  const libelles: Record<EtatAfficheDuSuivi, string> = {
    absent: t('Mesure non installée'),
    installation: t('Installation en cours'),
    attente: t('Code posé, aucune visite reçue'),
    probleme: t('Code de suivi à corriger'),
    verifie: t('Mesure en place'),
  };
  return libelles[etat] ?? etat;
}

/** La couleur de l'état : bleu quand c'est fait, orange quand ça avance, rouge à corriger. */
export function couleurDuSuivi(etat: EtatAfficheDuSuivi): string {
  return etat === 'verifie' ? 'text-termine' : etat === 'installation' || etat === 'attente' ? 'text-en-cours' : etat === 'probleme' ? 'text-danger' : 'text-faint';
}

export function valeurIndicateur(cle: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (cle === 'duree') return v < 60_000 ? `${Math.round(v / 1000)} s` : `${Math.round(v / 60_000)} min`;
  if (cle === 'rebond' || cle === 'fidelite' || cle === 'conversion') return `${v} %`;
  if (cle === 'chiffreAffaires' || cle === 'panierMoyen') return montant(v);
  return v.toLocaleString(formatRegional());
}

/** Une graduation lisible au-dessus du maximum : 1, 2, 5, 10, 20, 50… */
export function plafondRond(max: number): number {
  // Jamais une demi-visite sur l'échelle : deux au moins, pour que le milieu soit un entier.
  if (max <= 2) return 2;
  const puissance = 10 ** Math.floor(Math.log10(max));
  for (const pas of [1, 2, 5, 10]) if (pas * puissance >= max) return pas * puissance;
  return 10 * puissance;
}

/**
 * LA BULLE DE SURVOL, À LA SOURIS SEULEMENT (demande du 28/09/2026) : la date
 * et les valeurs du jour visé, posées à côté du trait vertical. Passé le
 * milieu du graphique, elle bascule à GAUCHE du trait, pour ne jamais sortir
 * du cadre. Au doigt, rien : l'en-tête dit déjà la valeur, et une bulle
 * cacherait la courbe sous le pouce. `aria-hidden` : ce qu'elle dit se lit
 * aussi dans l'en-tête ou la légende.
 */
function BulleDeSurvol({ gauche, titre, lignes }: { gauche: number; titre: string; lignes: { couleur: string; libelle?: string; valeur: string }[] }) {
  const aDroite = gauche <= 55;
  return (
    <div
      aria-hidden
      data-graphique-bulle
      className="pointer-events-none absolute top-1 z-10 flex min-w-[6rem] flex-col gap-0.5 whitespace-nowrap rounded-md border border-border bg-raised px-2 py-1.5 text-[12px] text-text shadow-xl"
      style={aDroite ? { left: `calc(${gauche}% + 10px)` } : { right: `calc(${100 - gauche}% + 10px)` }}
    >
      <span className="text-faint">{titre}</span>
      {lignes.map((ligne, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ligne.couleur }} />
          {ligne.libelle ? <span className="text-muted">{ligne.libelle}</span> : null}
          <span className="ml-auto pl-2 font-medium tabular-nums">{ligne.valeur}</span>
        </span>
      ))}
    </div>
  );
}

/** Le dernier pointeur vient-il d'une souris ? Seule elle fait paraître la bulle. */
function useSouris() {
  const [souris, setSouris] = React.useState(false);
  const noter = React.useCallback((event: React.PointerEvent) => setSouris(event.pointerType === 'mouse'), []);
  return [souris, noter] as const;
}

/* LES TEINTES DES GRAPHIQUES — AUCUNE COULEUR NEUVE : on reprend les trois
   jetons de série déjà déclarés dans les douze palettes (violet, vert d'eau,
   rose). Une famille de graphique a la sienne — les courbes en 1, les barres
   en 2 — et le podium d'un classement les parcourt. Ni l'orange du travail en
   cours ni le bleu du terminé : une mesure n'est pas un état. Le jeton ne
   porte que la teinte, l'opacité se dit à l'appel. */
const JETONS_DE_SERIE = ['--serie-1', '--serie-2', '--serie-3'] as const;
const teinteDeSerie = (rang: number, opacite = 1) => `hsl(var(${JETONS_DE_SERIE[rang % JETONS_DE_SERIE.length]})${opacite === 1 ? '' : ` / ${opacite}`})`;
/** Le podium d'un classement : trois teintes franches, puis la première atténuée. */
const teinteDuRang = (rang: number) => (rang < 3 ? teinteDeSerie(rang) : teinteDeSerie(0, Math.max(0.25, 0.5 - (rang - 3) * 0.08)));

/**
 * UNE COURBE PAR JOUR : une série, un voile dégradé sous un trait de 2 px, une
 * graduation discrète, et au survol (ou au doigt) un repère vertical avec la
 * valeur du jour. La courbe porte la première teinte de série, les barres la
 * seconde ; une `teinte` de passage habille un bloc qui veut la sienne.
 */
export function CourbeParJour({
  titre,
  points,
  format = (v: number) => v.toLocaleString(formatRegional()),
  barres,
  cle,
  serie,
}: {
  titre: string;
  points: { jour: string; valeur: number }[];
  format?: (v: number) => string;
  /** Des barres plutôt qu'une courbe : pour des comptes rares (ventes, objectifs). */
  barres?: boolean;
  cle: string;
  /** Le rang de la teinte de série : la première pour une courbe, la seconde pour des barres. */
  serie?: number;
}) {
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [souris, noterPointeur] = useSouris();
  const zone = React.useRef<HTMLDivElement>(null);
  const n = points.length;
  const max = plafondRond(Math.max(0, ...points.map((p) => p.valeur)));
  const total = points.reduce((s, p) => s + p.valeur, 0);
  const L = 100;
  const H = 40;
  const x = (i: number) => (n <= 1 ? L / 2 : (i / (n - 1)) * L);
  const y = (v: number) => H - (v / max) * H;
  // Arrondie, sans jamais dépasser les vraies valeurs (`cheminLisse`).
  const trace = cheminLisse(points.map((p, i) => ({ x: x(i), y: y(p.valeur) })));
  const aire = n ? `${trace} L${x(n - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z` : '';

  const suivre = (clientX: number) => {
    const r = zone.current?.getBoundingClientRect();
    if (!r || !n) return;
    const part = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setSurvol(barres ? Math.min(n - 1, Math.floor(part * n)) : Math.round(part * (n - 1)));
  };
  const point = survol !== null ? points[survol] : null;
  const gauche = survol === null ? 0 : barres ? ((survol + 0.5) / n) * 100 : (x(survol) / L) * 100;
  // La teinte de la famille : première de série pour une courbe, seconde pour des barres.
  const rangDeSerie = serie ?? (barres ? 1 : 0);
  const couleur = teinteDeSerie(rangDeSerie);

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-marketing-graphique={cle} data-total={total}>
      <div className="flex items-baseline gap-2" data-stats-titre>
        <span className="flex-1 text-[12.5px] text-text">{titre}</span>
        <span className="text-[12px] text-faint">{point ? `${dateCourte(point.jour)} · ${format(point.valeur)}` : t('Total : {v0}', { v0: format(total) })}</span>
      </div>
      <div className="flex gap-1.5">
        <div className="flex h-28 shrink-0 flex-col justify-between text-right text-[10.5px] leading-none text-faint">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>0</span>
        </div>
        <div
          ref={zone}
          className="relative h-28 min-w-0 flex-1 touch-pan-y"
          onPointerMove={(e) => {
            noterPointeur(e);
            suivre(e.clientX);
          }}
          onPointerDown={(e) => {
            noterPointeur(e);
            suivre(e.clientX);
          }}
          onPointerLeave={() => setSurvol(null)}
          role="img"
          aria-label={titre}
        >
          <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-faint/25" />
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-faint/25" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-faint/40" />
          {barres ? (
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {points.map((p, i) => (
                <div
                  key={p.jour}
                  className="min-w-0 flex-1 rounded-t-[3px]"
                  style={{ height: `${(p.valeur / max) * 100}%`, minHeight: p.valeur ? 2 : 0, background: teinteDeSerie(rangDeSerie, survol === i ? 1 : 0.7) }}
                />
              ))}
            </div>
          ) : (
            <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <linearGradient id={`aire-${cle}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={couleur} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={couleur} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={aire} fill={`url(#aire-${cle})`} />
              <path d={trace} fill="none" stroke={couleur} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}
          {point ? (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-faint/60" style={{ left: `${gauche}%` }} />
              {!barres ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[hsl(var(--bloc))]"
                  style={{ left: `${gauche}%`, top: `${(y(point.valeur) / H) * 100}%`, background: couleur }}
                />
              ) : null}
              {souris ? (
                <BulleDeSurvol gauche={gauche} titre={dateCourte(point.jour)} lignes={[{ couleur, valeur: format(point.valeur) }]} />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {n ? (
        <div className="flex justify-between pl-8 text-[10.5px] text-faint">
          <span>{dateCourte(points[0].jour, { day: 'numeric', month: 'short' })}</span>
          <span>{dateCourte(points[n - 1].jour, { day: 'numeric', month: 'short' })}</span>
        </div>
      ) : null}
    </div>
  );
}

/** UNE RÉPARTITION : une barre horizontale par ligne, sa valeur et sa part du total.
    Le podium porte les trois teintes de série, les lignes suivantes la première atténuée. */
export function Repartition({ titre, lignes, cle, pied }: { titre: string; lignes: [string, number][]; cle: string; pied?: React.ReactNode }) {
  const total = lignes.reduce((s, [, n]) => s + n, 0);
  const max = Math.max(1, ...lignes.map(([, n]) => n));
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-marketing-repartition={cle}>
      <span className="text-[12.5px] text-text" data-stats-titre>{titre}</span>
      {lignes.length ? (
        <ul className="flex flex-col gap-1.5">
          {lignes.map(([nom, n], rang) => (
            <li key={nom} className="flex flex-col gap-0.5">
              <span className="flex gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-muted">{nom}</span>
                <span className="shrink-0 text-text">{n.toLocaleString(formatRegional())}</span>
                <span className="w-11 shrink-0 whitespace-nowrap text-right text-faint">{total ? Math.round((n / total) * 100) : 0} %</span>
              </span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-faint/15">
                <span className="block h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: teinteDuRang(rang) }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[12px] text-faint">{t('Aucune donnée sur cette période.')}</span>
      )}
      {pied}
    </div>
  );
}

/** UNE PETITE COURBE DE TENDANCE, sans axe : la forme des quatre dernières semaines. */
export function MiniCourbe({ valeurs }: { valeurs: number[] }) {
  const n = valeurs.length;
  const max = Math.max(1, ...valeurs);
  if (n < 2 || !valeurs.some((v) => v > 0)) return <span aria-hidden className="block h-5 w-16 shrink-0 border-b border-dashed border-faint/40" />;
  const trace = cheminLisse(valeurs.map((v, i) => ({ x: (i / (n - 1)) * 64, y: 18 - (v / max) * 16 })), 1);
  return (
    <svg viewBox="0 0 64 20" className="h-5 w-16 shrink-0 overflow-visible" aria-hidden data-marketing-tendance>
      <path d={trace} fill="none" stroke={teinteDeSerie(0)} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Statistiques complètes (28/09/2026)                                  */
/* ------------------------------------------------------------------ */

/** Le nom d'un pays dans la langue de l'écran ; « ?? » : pays inconnu. */
export function nomDuPays(code: string): string {
  if (code === '??') return t('Inconnu');
  try {
    return new Intl.DisplayNames([formatRegional()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Le drapeau d'un pays, en caractères régionaux ; rien pour un pays inconnu. */
export function drapeau(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/* Trois teintes à elles (`--serie-1/2/3`, déclarées dans les douze palettes) :
   l'accent, le bleu du terminé et l'orange du travail en cours se
   confondaient deux à deux selon l'ambiance, et une courbe n'est pas un état. */
const SERIES_ACTIFS = [
  { cle: 'j1', libelle: () => t('Sur 1 jour'), couleur: 'hsl(var(--serie-1))' },
  { cle: 'j7', libelle: () => t('Sur 7 jours'), couleur: 'hsl(var(--serie-2))' },
  { cle: 'j28', libelle: () => t('Sur 28 jours'), couleur: 'hsl(var(--serie-3))' },
] as const;

/**
 * LES UTILISATEURS ACTIFS : trois courbes, sur 1, 7 et 28 jours glissants,
 * comme Google Analytics. Au survol, la valeur des trois pour le jour visé —
 * dans la légende, et à la souris dans une bulle, avec un point sur chaque
 * ligne.
 */
export function CourbesActifs({ points }: { points: { jour: string; j1: number; j7: number; j28: number }[] }) {
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [souris, noterPointeur] = useSouris();
  const zone = React.useRef<HTMLDivElement>(null);
  const n = points.length;
  const max = plafondRond(Math.max(0, ...points.map((p) => p.j28)));
  const L = 100;
  const H = 40;
  const x = (i: number) => (n <= 1 ? L / 2 : (i / (n - 1)) * L);
  const y = (v: number) => H - (v / max) * H;
  const point = survol !== null ? points[survol] : points[n - 1];
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-stats-graphique="actifs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-stats-titre>
        <span className="flex-1 text-[12.5px] text-text">{t('Utilisateurs actifs')}</span>
        {point ? <span className="text-[12px] text-faint">{dateCourte(point.jour)}</span> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
        {SERIES_ACTIFS.map((s) => (
          <span key={s.cle} className="flex items-center gap-1 text-muted">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: s.couleur }} />
            {s.libelle()}
            <span className="text-text">{point ? point[s.cle].toLocaleString(formatRegional()) : '—'}</span>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <div className="flex h-28 shrink-0 flex-col justify-between text-right text-[10.5px] leading-none text-faint">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div
          ref={zone}
          className="relative h-28 min-w-0 flex-1 touch-pan-y"
          onPointerMove={(e) => {
            noterPointeur(e);
            const r = zone.current?.getBoundingClientRect();
            if (r && n) setSurvol(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1)));
          }}
          onPointerLeave={() => setSurvol(null)}
          role="img"
          aria-label="Utilisateurs actifs"
        >
          <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-faint/25" />
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-faint/25" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-faint/40" />
          <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {SERIES_ACTIFS.map((s) => (
              <path
                key={s.cle}
                d={cheminLisse(points.map((p, i) => ({ x: x(i), y: y(p[s.cle]) })))}
                fill="none"
                stroke={s.couleur}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
          {survol !== null && point ? (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-faint/60" style={{ left: `${(x(survol) / L) * 100}%` }} />
              {SERIES_ACTIFS.map((s) => (
                <div
                  key={s.cle}
                  aria-hidden
                  data-graphique-point={s.cle}
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[hsl(var(--bloc))]"
                  style={{ left: `${(x(survol) / L) * 100}%`, top: `${(y(point[s.cle]) / H) * 100}%`, background: s.couleur }}
                />
              ))}
              {souris ? (
                <BulleDeSurvol
                  gauche={(x(survol) / L) * 100}
                  titre={dateCourte(point.jour)}
                  lignes={SERIES_ACTIFS.map((s) => ({ couleur: s.couleur, libelle: s.libelle(), valeur: point[s.cle].toLocaleString(formatRegional()) }))}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * DES BARRES PAR CRÉNEAU : les 24 heures du fuseau du serveur, ou les sept
 * jours de la semaine. Au survol, la valeur du créneau.
 */
export function BarresParCreneau({ titre, valeurs, etiquettes, graduations, note, cle }: { titre: string; valeurs: number[]; etiquettes: string[]; graduations?: number[]; note?: string; cle: string }) {
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [souris, noterPointeur] = useSouris();
  const max = plafondRond(Math.max(0, ...valeurs));
  const total = valeurs.reduce((s, v) => s + v, 0);
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-stats-graphique={cle} data-total={total}>
      <div className="flex items-baseline gap-2" data-stats-titre>
        <span className="flex-1 text-[12.5px] text-text">{titre}</span>
        <span className="text-[12px] text-faint">
          {survol !== null ? `${etiquettes[survol]} · ${valeurs[survol].toLocaleString(formatRegional())}` : t('Total : {v0}', { v0: total.toLocaleString(formatRegional()) })}
        </span>
      </div>
      <div className="relative flex h-24 items-end gap-[2px] border-b border-faint/40 touch-pan-y" onPointerLeave={() => setSurvol(null)}>
        {valeurs.map((v, i) => (
          <div
            key={i}
            className="flex h-full min-w-0 flex-1 items-end"
            onPointerEnter={(e) => {
              noterPointeur(e);
              setSurvol(i);
            }}
            onPointerDown={(e) => {
              noterPointeur(e);
              setSurvol(i);
            }}
          >
            <div className="w-full rounded-t-[3px]" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0, background: teinteDeSerie(1, survol === i ? 1 : 0.7) }} />
          </div>
        ))}
        {survol !== null && souris ? (
          <BulleDeSurvol
            gauche={((survol + 0.5) / valeurs.length) * 100}
            titre={etiquettes[survol] ?? ''}
            lignes={[{ couleur: teinteDeSerie(1), valeur: valeurs[survol].toLocaleString(formatRegional()) }]}
          />
        ) : null}
      </div>
      <div className="flex text-[10.5px] text-faint">
        {etiquettes.map((e, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center">
            {!graduations || graduations.includes(i) ? e : ''}
          </span>
        ))}
      </div>
      {note ? <span className="text-[11px] text-faint">{note}</span> : null}
    </div>
  );
}

/** La largeur disponible d'un conteneur, suivie à chaque redimensionnement : un flux se répartit sur toute la place. */
function useLargeur<E extends HTMLElement>(): [React.RefObject<E>, number] {
  const ref = React.useRef<E>(null);
  const [largeur, setLargeur] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => setLargeur(el.clientWidth);
    mesurer();
    const suivi = new ResizeObserver(mesurer);
    suivi.observe(el);
    return () => suivi.disconnect();
  }, []);
  return [ref, largeur];
}

/** Une bande courbe entre deux segments verticaux : [x1, y1a → y1b] vers [x2, y2a → y2b]. */
function bande(x1: number, y1a: number, y1b: number, x2: number, y2a: number, y2b: number): string {
  const m = (x1 + x2) / 2;
  return `M${x1},${y1a} C${m},${y1a} ${m},${y2a} ${x2},${y2a} L${x2},${y2b} C${m},${y2b} ${m},${y1b} ${x1},${y1b} Z`;
}

/** Un texte ramené à ce qui tient dans `px` pixels (≈ 0,58 em par signe). */
function tenir(texte: string, px: number, taille: number): string {
  const max = Math.max(4, Math.floor(px / (taille * 0.58)));
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

const nombre = (n: number) => n.toLocaleString(formatRegional());
const pourcent = (n: number) => `${n.toLocaleString(formatRegional(), { maximumFractionDigits: 1 })} %`;

/**
 * LE FLUX D'UN PARCOURS, à la Google Analytics (demande du 29/09/2026) : une
 * colonne pour l'entrée, puis une par étape jusqu'à l'objectif. Chaque étape
 * est une BOÎTE dont la hauteur suit ses sessions, son libellé écrit dedans ;
 * une bande courbe mène à l'étape suivante (ceux qui continuent), une bande
 * ROUGE plonge vers le bas (ceux qui s'arrêtent), avec leur nombre, leur part
 * et les pages d'où ils quittent le site. La plus grosse perte est soulignée.
 * Les colonnes se partagent toute la largeur ; sur un écran étroit, le flux
 * défile à l'horizontale.
 */
export function FluxDeParcoursSvg({ parcours, flux, nomDeLaPage }: { parcours: ParcoursDeSuivi; flux: FluxDUnParcours; nomDeLaPage: (chemin: string | null) => string }) {
  const [ref, dispo] = useLargeur<HTMLDivElement>();
  const [survol, setSurvol] = React.useState<number | null>(null);
  const marches = flux.marches;
  const colonnes = marches.length;
  const pas = Math.max(190, Math.min(360, (dispo || 900) / Math.max(1, colonnes)));
  const largeurBoite = Math.round(Math.max(128, pas * 0.64));
  const largeur = Math.max(pas * (colonnes - 1) + largeurBoite, 0);
  const HAUT = 200;
  const MIN = 50;
  const depart = marches[0]?.sessions ?? 0;
  const echelle = HAUT / Math.max(1, depart);
  const hauteurs = marches.map((m) => Math.max(MIN, m.sessions * echelle));
  const bas = Math.max(...hauteurs) + 34;
  const TETE = 30;
  const hauteurTotale = TETE + bas + 84;
  const x = (i: number) => i * pas;
  const titres = marches.map((_, i) => (i === 0 ? t('Entrée') : i === colonnes - 1 ? t('Objectif') : t('Étape {n}', { n: i })));
  return (
    <div ref={ref} className="min-w-0">
      <ZoneDefilement axe="horizontal" className="pb-1" data-stats-flux-parcours={colonnes}>
        <svg
          viewBox={`-2 ${-TETE} ${largeur + 4} ${hauteurTotale}`}
          className="block h-auto"
          style={{ width: largeur + 4, minWidth: largeur + 4 }}
          role="img"
          aria-label="Flux de conversion"
        >
          {titres.map((titre, i) => (
            <text key={i} x={x(i)} y={-12} fontSize={11} fill="hsl(var(--faint))">
              {titre}
            </text>
          ))}
          {marches.slice(1).map((m, k) => {
            const i = k + 1;
            const avant = marches[i - 1];
            const hA = hauteurs[i - 1];
            const passe = avant.sessions ? (m.sessions / avant.sessions) * hA : 0;
            const x1 = x(i - 1) + largeurBoite;
            const pire = flux.plusGrosDecrochage === i;
            const perte = avant.sessions ? Math.round((m.abandons / avant.sessions) * 1000) / 10 : 0;
            const allume = survol === null || survol === i || survol === i - 1;
            const xChute = x1 + 16;
            const largeurChute = Math.max(3, Math.min(26, (hA - passe) * 0.5));
            return (
              <g key={`lien-${i}`} data-stats-abandons={m.abandons}>
                {passe > 0 ? (
                  <path d={bande(x1, 0, passe, x(i), 0, hauteurs[i])} fill={teinteDeSerie(0, allume ? 0.26 : 0.1)}>
                    <title>{`${nombre(m.sessions)} ${t('sessions')} → ${parcours.etapes[i - 1]?.libelle ?? ''}`}</title>
                  </path>
                ) : null}
                {m.abandons > 0 ? (
                  <path
                    d={`M${x1},${passe} C${xChute},${passe} ${xChute},${passe} ${xChute},${Math.max(passe + 10, (passe + hA) / 2)} L${xChute},${bas - 10} L${xChute - largeurChute / 2 - 3},${bas - 10} L${xChute + largeurChute / 2},${bas - 2} L${xChute + largeurChute + 3},${bas - 10} L${xChute + largeurChute},${bas - 10} L${xChute + largeurChute},${Math.max(passe + 10, (passe + hA) / 2)} C${xChute + largeurChute},${hA} ${x1 + 8},${hA} ${x1},${hA} Z`}
                    fill="hsl(var(--danger))"
                    fillOpacity={allume ? (pire ? 0.75 : 0.45) : 0.15}
                  />
                ) : null}
                {m.abandons > 0 ? (
                  <text x={xChute - 4} y={bas + 12} fontSize={11.5} fontWeight={pire ? 600 : 500} fill="hsl(var(--danger))">
                    {tenir(t('{n} abandons · {part}', { n: nombre(m.abandons), part: pourcent(perte) }), pas - 14, 11.5)}
                  </text>
                ) : null}
                {pire ? (
                  <text x={xChute - 4} y={bas + 26} fontSize={10.5} fill="hsl(var(--danger))" data-stats-plus-grosse-perte={i}>
                    {t('La plus grosse perte')}
                  </text>
                ) : null}
                {m.departs.map((d, j) => (
                  <text key={j} x={xChute - 4} y={bas + (pire ? 40 : 26) + j * 13} fontSize={10.5} fill="hsl(var(--faint))">
                    {tenir(t('depuis {page} · {n}', { page: nomDeLaPage(d.chemin), n: nombre(d.sessions) }), pas - 14, 10.5)}
                  </text>
                ))}
              </g>
            );
          })}
          {marches.map((m, i) => {
            const h = hauteurs[i];
            const libelle = i === 0 ? t('Toutes les sessions') : parcours.etapes[i - 1]?.libelle ?? m.nom;
            const derniere = i === colonnes - 1 && i > 0;
            return (
              <g key={`boite-${i}`} onPointerEnter={() => setSurvol(i)} onPointerLeave={() => setSurvol(null)} data-stats-marche={i} data-stats-taux={m.tauxEtape}>
                <rect x={x(i)} y={0} width={largeurBoite} height={h} rx={6} fill={teinteDeSerie(derniere ? 1 : 0, 0.16)} />
                <rect x={x(i)} y={0} width={4} height={h} rx={2} fill={teinteDeSerie(derniere ? 1 : 0)} />
                <text x={x(i) + 12} y={17} fontSize={12} fontWeight={600} fill="hsl(var(--text))">
                  {tenir(libelle, largeurBoite - 18, 12)}
                </text>
                <text x={x(i) + 12} y={33} fontSize={11} fill="hsl(var(--muted))">
                  {t('{n} sessions', { n: nombre(m.sessions) })}
                  {i > 0 ? <tspan fill="hsl(var(--faint))">{` · ${pourcent(m.tauxGlobal)}`}</tspan> : null}
                </text>
                <title>{`${libelle} — ${nombre(m.sessions)} ${t('sessions')}${i > 0 ? ` · ${t('{taux} de l’étape précédente', { taux: pourcent(m.tauxEtape) })}` : ''}`}</title>
              </g>
            );
          })}
        </svg>
      </ZoneDefilement>
    </div>
  );
}

/** La teinte d'un nœud du flux : les sources, puis pages et clics chacun la sienne ; « autres » reste neutre. */
function teinteDuNoeud(n: NoeudDeFlux, colonne: number, opacite = 1): string {
  if (n.genre === 'autres') return `hsl(var(--faint)${opacite === 1 ? '' : ` / ${opacite}`})`;
  return teinteDeSerie(colonne === 0 ? 2 : n.genre === 'page' ? 0 : 1, opacite);
}

/**
 * LE FLUX DE COMPORTEMENT, à la Google Analytics : source → page d'arrivée →
 * trois interactions. Chaque nœud est une BOÎTE dont la hauteur suit ses
 * sessions, son nom et son nombre écrits dedans ; des bandes courbes et
 * légères relient deux colonnes voisines, et la languette rouge au bord droit
 * d'un nœud dit la part de ceux qui s'arrêtent là. Défile à l'horizontale sur
 * un écran étroit.
 */
export function FluxDeComportementSvg({ flux, libelle }: { flux: FluxDeComportement; libelle: (n: NoeudDeFlux) => string }) {
  const [ref, dispo] = useLargeur<HTMLDivElement>();
  const [survol, setSurvol] = React.useState<string | null>(null);
  const colonnes = flux.colonnes;
  if (!colonnes.length) return <span className="text-[12px] text-faint">{t('Aucune donnée sur cette période.')}</span>;
  const pas = Math.max(170, Math.min(300, (dispo || 900) / colonnes.length));
  const largeurBoite = Math.round(Math.max(112, pas * 0.58));
  const HAUT = 260;
  const ECART = 10;
  const MIN = 32;
  const plusGrande = Math.max(1, ...colonnes.map((c) => c.reduce((s, n) => s + n.sessions, 0)));
  const plusLongue = Math.max(...colonnes.map((c) => c.length));
  const echelle = (HAUT - ECART * (plusLongue - 1)) / plusGrande;
  const places = new Map<string, { x: number; y: number; h: number; sessions: number; sortie: number; entree: number }>();
  let hauteur = 0;
  colonnes.forEach((c, ci) => {
    let y = 0;
    for (const n of c) {
      const h = Math.max(MIN, n.sessions * echelle);
      places.set(`${ci}|${n.cle}`, { x: ci * pas, y, h, sessions: n.sessions, sortie: y, entree: y });
      y += h + ECART;
    }
    hauteur = Math.max(hauteur, y - ECART);
  });
  const largeur = (colonnes.length - 1) * pas + largeurBoite;
  const titres = [t('Source'), t('Page d’arrivée'), t('1re interaction'), t('2e interaction'), t('3e interaction')];
  const TETE = 26;
  return (
    <div ref={ref} className="min-w-0">
      <ZoneDefilement axe="horizontal" className="pb-1" data-stats-flux={colonnes.length}>
        <svg viewBox={`-2 ${-TETE} ${largeur + 4} ${hauteur + TETE + 8}`} className="block h-auto" style={{ width: largeur + 4, minWidth: largeur + 4 }} role="img" aria-label="Flux de comportement">
          {titres.slice(0, colonnes.length).map((titre, i) => (
            <text key={titre} x={i * pas} y={-10} fontSize={11} fill="hsl(var(--faint))">
              {titre}
            </text>
          ))}
          {flux.liens.map((l, i) => {
            const a = places.get(`${l.colonne}|${l.de}`);
            const b = places.get(`${l.colonne + 1}|${l.vers}`);
            if (!a || !b) return null;
            const hA = a.sessions ? (l.sessions / a.sessions) * a.h : 0;
            const hB = b.sessions ? (l.sessions / b.sessions) * b.h : 0;
            // Un demi-pixel de marge de part et d'autre : deux liens voisins se lisent séparés, pas en un seul pavé.
            const marge = (h: number) => (h > 3 ? 0.75 : 0);
            const d = bande(a.x + largeurBoite, a.sortie + marge(hA), a.sortie + hA - marge(hA), b.x, b.entree + marge(hB), b.entree + hB - marge(hB));
            a.sortie += hA;
            b.entree += hB;
            const allume = survol === null || survol === `${l.colonne}|${l.de}` || survol === `${l.colonne + 1}|${l.vers}`;
            return (
              <path key={i} d={d} fill="hsl(var(--faint))" fillOpacity={allume ? 0.2 : 0.05}>
                <title>{`${nombre(l.sessions)} ${t('sessions')}`}</title>
              </path>
            );
          })}
          {colonnes.map((c, ci) =>
            c.map((n) => {
              const p = places.get(`${ci}|${n.cle}`)!;
              const hAbandon = n.sessions ? (n.abandons / n.sessions) * p.h : 0;
              const nom = libelle(n);
              const teinte = teinteDuNoeud(n, ci);
              return (
                <g key={`${ci}|${n.cle}`} onPointerEnter={() => setSurvol(`${ci}|${n.cle}`)} onPointerLeave={() => setSurvol(null)} data-stats-noeud={n.cle}>
                  <rect x={p.x} y={p.y} width={largeurBoite} height={p.h} rx={5} fill={teinteDuNoeud(n, ci, n.genre === 'autres' ? 0.14 : 0.16)} />
                  <rect x={p.x} y={p.y} width={3} height={p.h} rx={1.5} fill={teinte} />
                  {hAbandon ? <rect x={p.x + largeurBoite - 5} y={p.y + p.h - hAbandon} width={5} height={hAbandon} rx={1.5} fill="hsl(var(--danger))" data-stats-abandon-noeud={n.abandons} /> : null}
                  <text x={p.x + 10} y={p.y + 14} fontSize={11.5} fontWeight={500} fill="hsl(var(--text))">
                    {tenir(nom, largeurBoite - 20, 11.5)}
                  </text>
                  <text x={p.x + 10} y={p.y + 27} fontSize={10.5} fill="hsl(var(--muted))">
                    {nombre(n.sessions)}
                    {n.abandons ? <tspan fill="hsl(var(--danger))">{` · ↓ ${nombre(n.abandons)}`}</tspan> : null}
                  </text>
                  <title>{`${nom} — ${nombre(n.sessions)} ${t('sessions')}${n.abandons ? `, ${t('{n} abandons', { n: n.abandons })}` : ''}`}</title>
                </g>
              );
            }),
          )}
        </svg>
      </ZoneDefilement>
    </div>
  );
}
