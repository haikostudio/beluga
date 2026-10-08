import * as React from 'react';
import { couleurIntensite, FUSEAU, periodePartielle, type ResumeDeRubrique, type RubriqueDuResume } from '@beluga/shared';
import { BulleInfo } from '@/components/ui';
import { SilhouetteRubrique } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES PIÈCES COMMUNES DES RUBRIQUES DU RÉSUMÉ : la demande au démon, les
 * tuiles de tête, la courbe par jour, l'avis de période partielle et les
 * formats. Chargées avec la première rubrique ouverte, jamais avant.
 */

/** Ce que reçoit chaque rubrique : la période, déjà remise d'aplomb par la page. */
export interface ProprietesDeRubrique {
  debut: number;
  fin: number;
}

/**
 * LA DEMANDE D'UNE RUBRIQUE AU DÉMON, refaite à chaque période. Pendant
 * l'attente, `donnees` repasse à `null` : la rubrique montre sa silhouette, et
 * jamais les chiffres de l'ancienne période sous le nouveau titre.
 */
export function useResume<R extends ResumeDeRubrique>(
  rubrique: RubriqueDuResume,
  debut: number,
  fin: number,
): { donnees: R | null; erreur: boolean } {
  const [etat, setEtat] = React.useState<{ donnees: R | null; erreur: boolean }>({ donnees: null, erreur: false });
  React.useEffect(() => {
    let vivant = true;
    setEtat({ donnees: null, erreur: false });
    client
      .call({ type: 'stats.resume', rubrique, debut, fin }, 120000)
      .then((data) => vivant && setEtat({ donnees: data as R, erreur: false }))
      .catch(() => vivant && setEtat({ donnees: null, erreur: true }));
    return () => {
      vivant = false;
    };
  }, [rubrique, debut, fin]);
  return etat;
}

/** La taille de page des tableaux du Résumé, retenue d'un appareil à l'autre. */
export function useTailleDePage(): [number, (n: number) => void] {
  return usePref<number>('resume.lignes', 20);
}

/** L'enveloppe d'une rubrique : la silhouette pendant l'attente, la phrase d'erreur en cas d'échec. */
export function EtatDeRubrique<R extends ResumeDeRubrique>({
  etat,
  children,
}: {
  etat: { donnees: R | null; erreur: boolean };
  children: (donnees: R) => React.ReactNode;
}) {
  if (etat.erreur) {
    return <p className="text-[13px] text-faint">{t("Les statistiques n'ont pas pu être chargées. Réessayez dans un instant.")}</p>;
  }
  if (!etat.donnees) return <SilhouetteRubrique />;
  return (
    <div className="space-y-4" data-rubrique-chargee>
      <AvisDePeriode donnees={etat.donnees} />
      {children(etat.donnees)}
    </div>
  );
}

/**
 * UNE PÉRIODE PLUS LONGUE QUE CE QUE LE DÉMON GARDE se dit en une ligne : les
 * jours d'avant ne sont pas « à zéro », ils ne sont pas connus.
 */
function AvisDePeriode({ donnees }: { donnees: ResumeDeRubrique }) {
  if (!periodePartielle(donnees.debut, donnees.depuis)) return null;
  return (
    <p className="rounded-md bg-bloc px-3 py-2 text-[12.5px] text-muted" data-periode-partielle>
      {t("Données disponibles depuis le {v0} : les jours d'avant ne sont pas connus, ils ne valent pas zéro.", {
        v0: dateCourte(donnees.depuis!),
      })}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Tuiles et sections                                                  */
/* ------------------------------------------------------------------ */

export function Tuiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{children}</div>;
}

export function Tuile({
  icone,
  titre,
  valeur,
  dessous,
  repere,
}: {
  icone?: React.ReactNode;
  titre: string;
  valeur: string;
  dessous?: string;
  repere?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-3 py-3" data-tuile-resume={repere}>
      <p className="flex items-center gap-1.5 truncate text-[11.5px] uppercase tracking-wide text-faint">
        {icone} {titre}
      </p>
      <p className="mt-1 truncate text-[22px] font-semibold leading-tight text-text">{valeur}</p>
      {dessous ? <p className="mt-0.5 truncate text-[12px] text-faint">{dessous}</p> : null}
    </div>
  );
}

export function Section({
  titre,
  icone,
  aide,
  children,
  className,
  ...attributs
}: {
  titre: string;
  icone?: React.ReactNode;
  aide?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <section className={cn('min-w-0 rounded-lg bg-surface px-3 py-3', className)} {...attributs}>
      <h2 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        {icone}
        {titre}
        {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* La courbe par jour                                                  */
/* ------------------------------------------------------------------ */

export interface SerieDuJour {
  libelle: string;
  valeurs: number[];
  format?: (n: number) => string;
}

/**
 * UNE BARRE PAR JOUR DE LA PÉRIODE, et en option une LIGNE posée par-dessus
 * pour une seconde grandeur (sa propre échelle : les mêler ferait disparaître
 * la plus petite). La couleur de la barre dit l'intensité du jour. Au toucher
 * (téléphone, sans survol), un appui montre le détail du jour sous la courbe.
 * Pur SVG et boîtes : aucune bibliothèque de graphiques dans le projet.
 */
export function CourbeDuResume({ jours, barres, ligne, vide }: { jours: number[]; barres: SerieDuJour; ligne?: SerieDuJour; vide: string }) {
  const [actif, setActif] = React.useState<number | null>(null);
  const total = barres.valeurs.reduce((a, b) => a + b, 0) + (ligne?.valeurs.reduce((a, b) => a + b, 0) ?? 0);
  if (!jours.length || total === 0) return <p className="text-[13px] text-faint">{vide}</p>;
  const hauteur = 120;
  const max = Math.max(1, ...barres.valeurs);
  const maxLigne = Math.max(1, ...(ligne?.valeurs ?? [0]));
  const pas = 100 / jours.length;
  const trace = ligne
    ? ligne.valeurs
        .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(pas * i + pas / 2).toFixed(2)} ${(hauteur - (v / maxLigne) * (hauteur - 12) - 6).toFixed(2)}`)
        .join(' ')
    : '';
  const format = (serie: SerieDuJour, n: number) => (serie.format ? serie.format(n) : n.toLocaleString(formatRegional()));
  const rangActif = actif !== null && actif < jours.length ? actif : null;

  return (
    <div data-courbe-resume={jours.length}>
      <div className="relative" style={{ height: hauteur }}>
        <div className="absolute inset-0 flex items-end gap-px sm:gap-0.5">
          {jours.map((jour, i) => {
            const v = barres.valeurs[i] ?? 0;
            const libelle = `${dateCourte(jour)} · ${format(barres, v)}${ligne ? ` · ${format(ligne, ligne.valeurs[i] ?? 0)}` : ''}`;
            return (
              <button
                type="button"
                key={jour}
                onClick={() => setActif((avant) => (avant === i ? null : i))}
                className="flex min-w-0 flex-1 items-end self-stretch"
                aria-pressed={rangActif === i}
                aria-label={libelle}
                title={libelle}
              >
                <div
                  className={cn('w-full rounded-t', rangActif === i && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
                  style={{ height: Math.max(2, Math.round((v / max) * (hauteur - 12))), backgroundColor: couleurIntensite(v, max) }}
                  data-barre-jour={jour}
                />
              </button>
            );
          })}
        </div>
        {ligne ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 100 ${hauteur}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* `--accent` ne porte que des composantes : sans `hsl(…)`, le trait est invalide et rien ne se dessine. */}
            <path d={trace} fill="none" stroke="hsl(var(--accent))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </div>
      <AxeDesJours etiquettes={jours.map((jour) => quantieme(jour))} actif={rangActif} />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: couleurIntensite(1, 1) }} />
          {barres.libelle}
        </span>
        {ligne ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-[2px] w-3 rounded-full bg-accent" />
            {ligne.libelle}
          </span>
        ) : null}
      </div>
      <p className="mt-1 min-h-[18px] text-[12px] text-faint" aria-live="polite" data-detail-jour-resume>
        {rangActif !== null ? (
          <>
            <span className="font-semibold text-text">{dateCourte(jours[rangActif]!)}</span>
            {` · ${barres.libelle} : ${format(barres, barres.valeurs[rangActif] ?? 0)}`}
            {ligne ? ` · ${ligne.libelle} : ${format(ligne, ligne.valeurs[rangActif] ?? 0)}` : ''}
          </>
        ) : (
          t('Touchez une barre pour voir le détail du jour.')
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formats                                                             */
/* ------------------------------------------------------------------ */

export const nombre = (n: number) => n.toLocaleString(formatRegional());

/** Secondes machine → « 3 h 20 » ou « 12 min ». */
export function dureeEnClair(secondes: number): string {
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return t('{n} min', { n: minutes });
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste ? t('{h} h {m} min', { h: heures, m: reste }) : t('{n} h', { n: heures });
}

/** Millisecondes → « 152 ms » ou « 1,4 s ». */
export function msEnClair(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toLocaleString(formatRegional(), { maximumFractionDigits: 1 })} s`;
}

/** Un grand nombre de jetons → « 1,2 M » ou « 340 k ». */
export function jetonsEnClair(jetons: number): string {
  const f = formatRegional();
  if (jetons >= 1_000_000_000) return `${(jetons / 1_000_000_000).toLocaleString(f, { maximumFractionDigits: 1 })} G`;
  if (jetons >= 1_000_000) return `${(jetons / 1_000_000).toLocaleString(f, { maximumFractionDigits: 1 })} M`;
  if (jetons >= 1_000) return `${Math.round(jetons / 1_000).toLocaleString(f)} k`;
  return jetons.toLocaleString(f);
}

/** Des octets → « 71,2 Go ». */
export function octetsEnClair(octets: number): string {
  const f = formatRegional();
  let v = octets;
  let i = 0;
  while (v >= 1024 && i < 4) {
    v /= 1024;
    i += 1;
  }
  const n = v.toLocaleString(f, { maximumFractionDigits: i >= 3 ? 1 : 0 });
  return i === 0
    ? t('{n} o', { n })
    : i === 1
      ? t('{n} ko', { n })
      : i === 2
        ? t('{n} Mo', { n })
        : i === 3
          ? t('{n} Go', { n })
          : t('{n} To', { n });
}

/** Une part (0 à 1) → « 62 % » ; `null` → « — ». */
export function partEnClair(part: number | null | undefined): string {
  if (part === null || part === undefined || !Number.isFinite(part)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, part)) * 100)} %`;
}

/** Un instant → « 4 oct. », dans le fuseau de référence (celui des séries par jour). */
export function dateCourte(at: number): string {
  return new Date(at).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short', timeZone: FUSEAU });
}

/** Un instant → « 4 oct., 15:27 ». */
export function dateHeure(at: number | null | undefined): string {
  if (!at) return '—';
  return new Date(at).toLocaleString(formatRegional(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
}

/* Le quantième seul (« 8 »), sans le point que certaines langues y ajoutent. */
const formatQuantieme = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: FUSEAU });
function quantieme(at: number): string {
  return formatQuantieme.format(new Date(at));
}

/**
 * L'AXE DES JOURS SOUS UNE COURBE : un quantième tous les N jours, posé au
 * CENTRE de sa barre et jamais rogné — au-delà d'un mois, une barre fait
 * quelques pixels et un « 18 » coupé en « 1 » mentait sur la date. Le jour
 * choisi garde toujours le sien, en gras.
 */
export function AxeDesJours({ etiquettes, actif }: { etiquettes: string[]; actif: number | null }) {
  const pas = 100 / Math.max(1, etiquettes.length);
  const espacement = Math.max(1, Math.ceil(etiquettes.length / 15));
  return (
    <div className="relative mt-1 h-3" aria-hidden="true">
      {etiquettes.map((etiquette, i) =>
        i % espacement === 0 || i === actif ? (
          <span
            key={i}
            className={cn(
              'absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] leading-3',
              i === actif ? 'z-10 rounded-sm bg-surface px-0.5 font-semibold text-text' : 'text-faint',
            )}
            style={{ left: `${pas * i + pas / 2}%` }}
          >
            {etiquette}
          </span>
        ) : null,
      )}
    </div>
  );
}

/** La somme d'une série. */
export const somme = (valeurs: readonly number[]) => valeurs.reduce((a, b) => a + b, 0);

/** Un texte court, ou « — ». */
export function ouTiret(texte: string | null | undefined): string {
  return texte && texte.trim() ? texte : '—';
}

/** Une barre de part, pour une colonne « Part » de tableau (même couleur que les courbes). */
export function BarreDePart({ valeur, max, repere }: { valeur: number; max: number; repere?: string }) {
  return (
    <span className="flex items-center justify-end gap-1.5">
      <span className="tabular-nums">{partEnClair(max ? valeur / max : 0)}</span>
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-raised sm:inline-block">
        <span
          className="block h-full rounded-full"
          data-barre-projet={repere}
          style={{ width: `${Math.round((max ? valeur / max : 0) * 100)}%`, backgroundColor: couleurIntensite(valeur, max) }}
        />
      </span>
    </span>
  );
}
