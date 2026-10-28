import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

/**
 * LES ÉLÉMENTS DE FORMULAIRE MAISON — PLUS AUCUN ÉLÉMENT NATIF (demande du
 * 25/10/2026 : « tous les éléments natifs doivent devenir des éléments maison,
 * dans toute l'application »). Case à cocher, choix unique, étiquettes, date,
 * heure, curseur et couleur : chacun se dessine dans les douze palettes, se
 * touche au doigt (44 px de cible au moins) et se pilote au clavier. Aucune
 * fenêtre du navigateur ou du système ne s'ouvre plus.
 *
 * Les repères `data-*` passés par l'appelant tombent sur l'élément qu'on
 * clique : les contrôles qui visaient l'ancien élément natif le retrouvent.
 */

type Reperes = Record<`data-${string}`, string | number | boolean | undefined>;

/** Le panneau flottant commun (calendrier, heure, couleur) : au-dessus des tiroirs, en feuille du bas sur téléphone. */
const CLASSE_PANNEAU =
  'z-[80] rounded-md border border-border bg-surface p-2 shadow-xl data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out';

/** Le champ déclencheur commun : la même tenue qu'un `Input`. */
const CLASSE_CHAMP =
  'flex h-10 sm:h-9 w-full min-w-0 items-center gap-2 rounded-lg bg-raised px-3 text-left text-[14px] text-text transition-colors hover:bg-fond-survol focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:cursor-default disabled:opacity-50';

/* ------------------------------------------------------------------ */
/* Case à cocher                                                        */
/* ------------------------------------------------------------------ */

/**
 * UNE CASE À COCHER. Cochée, un carré VIOLET plein (`teinte-plein`, l'élément
 * choisi) et sa coche ; décochée, un carré gris franc. La cible fait 44 px au
 * doigt sans changer la place occupée (calque invisible centré).
 */
export const CaseACocher = React.forwardRef<
  HTMLButtonElement,
  {
    checked: boolean;
    onCheckedChange: (coche: boolean) => void;
    disabled?: boolean;
    className?: string;
    id?: string;
    'aria-label'?: string;
    title?: string;
  } & Reperes
>(function CaseACocher({ checked, onCheckedChange, disabled, className, ...reste }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      data-case-a-cocher={checked ? 'cochee' : 'vide'}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
      {...reste}
      className={cn(
        'relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-faint disabled:cursor-default disabled:opacity-50',
        "after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:h-8 sm:after:w-8",
        checked ? 'bg-teinte-plein text-sur-couleur' : 'bg-faint/35 hover:bg-faint/50',
        className,
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Choix unique (boutons radio)                                         */
/* ------------------------------------------------------------------ */

export interface OptionRadio {
  valeur: string;
  libelle: React.ReactNode;
  detail?: React.ReactNode;
  desactivee?: boolean;
  reperes?: Reperes;
}

/**
 * UN CHOIX UNIQUE : une ligne par option, un rond qui se remplit de violet. Le
 * groupe se parcourt aux flèches, comme un vrai groupe de boutons radio.
 */
export function BoutonsRadio({
  valeur,
  options,
  onChoisir,
  libelle,
  className,
  classeOption,
  ...reste
}: {
  valeur: string;
  options: OptionRadio[];
  onChoisir: (valeur: string) => void;
  libelle: string;
  className?: string;
  classeOption?: string;
} & Reperes) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const bouger = (depuis: number, pas: number) => {
    const n = options.length;
    for (let i = 1; i <= n; i += 1) {
      const j = (depuis + pas * i + n * n) % n;
      if (!options[j].desactivee) {
        onChoisir(options[j].valeur);
        refs.current[j]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={libelle} className={cn('flex flex-col gap-1', className)} {...reste}>
      {options.map((option, i) => {
        const choisi = option.valeur === valeur;
        return (
          <button
            key={option.valeur}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={choisi}
            tabIndex={choisi || (!options.some((o) => o.valeur === valeur) && i === 0) ? 0 : -1}
            disabled={option.desactivee}
            onClick={() => onChoisir(option.valeur)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                bouger(i, 1);
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                bouger(i, -1);
              }
            }}
            {...option.reperes}
            className={cn(
              'flex min-h-11 sm:min-h-9 w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:cursor-default disabled:opacity-50',
              classeOption,
            )}
          >
            <PastilleRadio choisie={choisi} />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-text">{option.libelle}</span>
              {option.detail ? <span className="mt-0.5 block text-[12.5px] text-faint">{option.detail}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Le rond d'un choix unique, seul : pour une ligne dessinée par l'appelant. */
export function PastilleRadio({ choisie, className }: { choisie: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      data-pastille-radio={choisie ? 'choisie' : 'vide'}
      className={cn(
        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors',
        choisie ? 'bg-teinte-plein' : 'bg-faint/35',
        className,
      )}
    >
      {choisie ? <span className="h-[7px] w-[7px] rounded-full bg-sur-couleur" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Étiquettes                                                           */
/* ------------------------------------------------------------------ */

/**
 * UNE LISTE DE MOTS EN ÉTIQUETTES. On tape un mot : la VIRGULE ou ENTRÉE en
 * fait une étiquette ; Retour arrière sur un champ vide retire la dernière ; la
 * croix retire celle qu'elle porte. Un texte collé avec des virgules donne une
 * étiquette par morceau. Ce qui reste tapé est ajouté quand on quitte le champ.
 *
 * L'ancien champ réécrivait la liste à chaque frappe en filtrant les vides : la
 * virgule tapée disparaissait aussitôt, et on ne pouvait rien ajouter.
 */
export function ChampDEtiquettes({
  valeurs,
  onChange,
  placeholder,
  minuscules = false,
  className,
  'aria-label': ariaLabel,
  ...reste
}: {
  valeurs: string[];
  onChange: (valeurs: string[]) => void;
  placeholder?: string;
  /** Les mots se rangent en minuscules (mots-clés comparés sans casse). */
  minuscules?: boolean;
  className?: string;
  'aria-label'?: string;
} & Reperes) {
  const [saisie, setSaisie] = React.useState('');
  const champ = React.useRef<HTMLInputElement>(null);
  const ajouter = (texte: string) => {
    const morceaux = texte
      .split(/[,\n]/)
      .map((m) => (minuscules ? m.trim().toLowerCase() : m.trim()))
      .filter(Boolean);
    if (!morceaux.length) return;
    const suite = [...valeurs];
    for (const m of morceaux) if (!suite.includes(m)) suite.push(m);
    onChange(suite);
  };
  return (
    <div
      className={cn('flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg bg-raised px-2 py-1.5 focus-within:ring-1 focus-within:ring-faint/60', className)}
      onClick={() => champ.current?.focus()}
      data-champ-etiquettes=""
    >
      {valeurs.map((mot) => (
        <span key={mot} className="inline-flex max-w-full items-center gap-1 rounded-md bg-text/[0.09] py-0.5 pl-2 pr-0.5 text-[13px] text-text" data-etiquette={mot}>
          <span className="min-w-0 truncate">{mot}</span>
          <button
            type="button"
            aria-label={`Retirer « ${mot} »`}
            title={t('Retirer')}
            data-retirer-etiquette={mot}
            onClick={(e) => {
              e.stopPropagation();
              onChange(valeurs.filter((v) => v !== mot));
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-text/10 hover:text-text"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={champ}
        value={saisie}
        aria-label={ariaLabel}
        placeholder={valeurs.length ? undefined : placeholder}
        {...reste}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,\n]/.test(v)) {
            ajouter(v);
            setSaisie('');
          } else setSaisie(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            ajouter(saisie);
            setSaisie('');
          } else if (e.key === 'Backspace' && !saisie && valeurs.length) {
            e.preventDefault();
            onChange(valeurs.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (saisie.trim()) {
            ajouter(saisie);
            setSaisie('');
          }
        }}
        className="h-7 min-w-[8ch] flex-1 bg-transparent px-1 text-[14px] text-text outline-none placeholder:text-faint"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date, heure                                                          */
/* ------------------------------------------------------------------ */

const deuxChiffres = (n: number) => String(n).padStart(2, '0');
/** « AAAA-MM-JJ » d'une date locale. */
export const dateEnTexte = (d: Date) => `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;
function texteEnDate(texte: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Une date TAPÉE : « 2026-10-25 », « 25.10.2026 » ou « 25/10/2026 ». */
function saisieEnDate(texte: string): Date | null {
  const iso = texteEnDate(texte.trim());
  if (iso) return iso;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(texte.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[1]) ? null : d;
}

/** Les noms des jours et des mois dans la langue de l'interface (`formatRegional`). */
const useLocale = () => formatRegional();

/**
 * UN CHOIX DE DATE : un champ qui montre la date en toutes lettres, et un
 * CALENDRIER maison au clic (mois précédent / suivant, aujourd'hui, effacer).
 * La valeur reste au format « AAAA-MM-JJ » de l'ancien champ natif.
 */
export function ChoixDeDate({
  valeur,
  onChange,
  disabled,
  min,
  max,
  effacable = false,
  placeholder,
  className,
  'aria-label': ariaLabel,
  ...reste
}: {
  valeur: string;
  onChange: (valeur: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  effacable?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
} & Reperes) {
  const locale = useLocale();
  const [ouvert, setOuvert] = React.useState(false);
  const choisie = texteEnDate(valeur);
  const [mois, setMois] = React.useState(() => {
    const d = choisie ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  React.useEffect(() => {
    if (!ouvert) return;
    const d = texteEnDate(valeur) ?? new Date();
    setMois(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [ouvert, valeur]);
  const libelle = choisie
    ? choisie.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : placeholder ?? t('Choisir une date');
  const borneMin = texteEnDate(min);
  const borneMax = texteEnDate(max);
  const horsBornes = (d: Date) => (borneMin && d < borneMin) || (borneMax && d > borneMax);

  /* La grille : six semaines, lundi en tête. */
  const premierJour = (mois.getDay() + 6) % 7;
  const jours: Date[] = Array.from({ length: 42 }, (_, i) => new Date(mois.getFullYear(), mois.getMonth(), i - premierJour + 1));
  const nomsDesJours = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' }));
  const aujourdHui = dateEnTexte(new Date());
  const choisir = (d: Date) => {
    onChange(dateEnTexte(d));
    setOuvert(false);
  };
  const [saisie, setSaisie] = React.useState('');
  React.useEffect(() => {
    if (ouvert) setSaisie(choisie ? choisie.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);
  return (
    <PopoverPrimitive.Root open={ouvert} onOpenChange={(o) => !disabled && setOuvert(o)}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel} data-choix-de-date={valeur || ''} {...reste} className={cn(CLASSE_CHAMP, className)}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className={cn('min-w-0 flex-1 truncate', !choisie && 'text-faint')}>{libelle}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align="start" sideOffset={4} collisionPadding={8} className={cn(CLASSE_PANNEAU, 'w-[288px]')} data-calendrier="">
          {/* La date se TAPE aussi (« 25.10.2026 ») : Entrée la retient. */}
          <input
            value={saisie}
            onChange={(e) => {
              setSaisie(e.target.value);
              const d = saisieEnDate(e.target.value);
              if (d) setMois(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const d = saisieEnDate(saisie);
              if (d && !horsBornes(d)) choisir(d);
            }}
            placeholder={t('JJ.MM.AAAA')}
            aria-label="Taper la date"
            inputMode="numeric"
            data-calendrier-saisie=""
            className="mb-1.5 h-9 w-full rounded-md bg-raised px-2.5 text-[13.5px] tabular-nums text-text outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-faint"
          />
          <div className="flex items-center gap-1 pb-1.5">
            <button
              type="button"
              aria-label="Mois précédent"
              data-calendrier-precedent=""
              onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() - 1, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-text"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex-1 text-center text-[13.5px] font-medium capitalize text-text" data-calendrier-mois="">
              {mois.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              aria-label="Mois suivant"
              data-calendrier-suivant=""
              onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() + 1, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-text"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center" role="grid">
            {nomsDesJours.map((n, i) => (
              <span key={i} className="pb-1 text-[11.5px] uppercase text-faint">
                {n}
              </span>
            ))}
            {jours.map((d) => {
              const texte = dateEnTexte(d);
              const duMois = d.getMonth() === mois.getMonth();
              const estChoisie = texte === valeur;
              const interdit = !!horsBornes(d);
              return (
                <button
                  key={texte}
                  type="button"
                  role="gridcell"
                  aria-selected={estChoisie}
                  disabled={interdit}
                  data-calendrier-jour={texte}
                  onClick={() => choisir(d)}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-md text-[13px] tabular-nums transition-colors disabled:cursor-default disabled:opacity-30',
                    estChoisie ? 'bg-teinte-plein font-semibold text-sur-couleur' : 'hover:bg-raised',
                    !estChoisie && (duMois ? 'text-text' : 'text-faint'),
                    !estChoisie && texte === aujourdHui && 'font-semibold underline decoration-faint underline-offset-4',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between pt-1.5">
            <button type="button" onClick={() => choisir(new Date())} className="rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-text" data-calendrier-aujourdhui="">
              {t('Aujourd’hui')}
            </button>
            {effacable && valeur ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOuvert(false);
                }}
                className="rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-text"
                data-calendrier-effacer=""
              >
                {t('Effacer')}
              </button>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * UN CHOIX D'HEURE (« HH:MM ») : deux colonnes qui défilent, les heures et les
 * minutes. La valeur choisie est centrée à l'ouverture.
 */
export function ChoixDHeure({
  valeur,
  onChange,
  disabled,
  pasMinutes = 5,
  effacable = false,
  className,
  'aria-label': ariaLabel,
  ...reste
}: {
  valeur: string;
  onChange: (valeur: string) => void;
  disabled?: boolean;
  pasMinutes?: number;
  /** L'heure est facultative : un geste la retire. */
  effacable?: boolean;
  className?: string;
  'aria-label'?: string;
} & Reperes) {
  const [ouvert, setOuvert] = React.useState(false);
  const m = /^(\d{1,2}):(\d{2})/.exec(valeur ?? '');
  const heure = m ? Number(m[1]) : null;
  const minute = m ? Number(m[2]) : null;
  const minutes = Array.from({ length: Math.ceil(60 / pasMinutes) }, (_, i) => i * pasMinutes);
  if (minute !== null && !minutes.includes(minute)) minutes.push(minute), minutes.sort((a, b) => a - b);
  const poser = (h: number | null, mn: number | null) => onChange(`${deuxChiffres(h ?? 9)}:${deuxChiffres(mn ?? 0)}`);
  const [saisie, setSaisie] = React.useState('');
  React.useEffect(() => {
    if (ouvert) setSaisie(m ? `${deuxChiffres(heure!)}:${deuxChiffres(minute!)}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);
  const colonne = (valeurs: number[], courante: number | null, choisir: (n: number) => void, repere: string) => (
    <div className="flex h-[216px] w-16 flex-col gap-0.5 overflow-y-auto overscroll-contain" data-colonne-heure={repere}>
      {valeurs.map((n) => (
        <button
          key={n}
          type="button"
          ref={(el) => {
            if (el && ouvert && n === courante) el.scrollIntoView({ block: 'center' });
          }}
          onClick={() => choisir(n)}
          data-choix-heure-valeur={`${repere}:${deuxChiffres(n)}`}
          className={cn(
            'flex h-9 shrink-0 items-center justify-center rounded-md text-[13.5px] tabular-nums transition-colors',
            n === courante ? 'bg-teinte-plein font-semibold text-sur-couleur' : 'text-text hover:bg-raised',
          )}
        >
          {deuxChiffres(n)}
        </button>
      ))}
    </div>
  );
  return (
    <PopoverPrimitive.Root open={ouvert} onOpenChange={(o) => !disabled && setOuvert(o)}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel} data-choix-d-heure={valeur || ''} {...reste} className={cn(CLASSE_CHAMP, className)}>
          <Clock className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className={cn('min-w-0 flex-1 truncate tabular-nums', !m && 'text-faint')}>{m ? `${deuxChiffres(heure!)}:${deuxChiffres(minute!)}` : '--:--'}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align="start" sideOffset={4} collisionPadding={8} className={cn(CLASSE_PANNEAU, 'w-[148px]')} data-panneau-heure="">
          {/* L'heure se TAPE aussi (« 14:30 ») : Entrée la retient. */}
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const lue = /^(\d{1,2})[:h.]?(\d{2})$/.exec(saisie.trim());
              if (lue && Number(lue[1]) < 24 && Number(lue[2]) < 60) {
                onChange(`${deuxChiffres(Number(lue[1]))}:${lue[2]}`);
                setOuvert(false);
              }
            }}
            placeholder="HH:MM"
            aria-label="Taper l’heure"
            inputMode="numeric"
            data-heure-saisie=""
            className="mb-1.5 h-9 w-full rounded-md bg-raised px-2.5 text-[13.5px] tabular-nums text-text outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-faint"
          />
          <div className="flex gap-1">
            {colonne(Array.from({ length: 24 }, (_, i) => i), heure, (h) => poser(h, minute), 'h')}
            {colonne(minutes, minute, (mn) => {
              poser(heure, mn);
              setOuvert(false);
            }, 'm')}
          </div>
          {effacable && valeur ? (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOuvert(false);
              }}
              className="mt-1.5 w-full rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-text"
              data-heure-effacer=""
            >
              {t('Sans heure')}
            </button>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** UNE DATE ET UNE HEURE (« AAAA-MM-JJTHH:MM », l'ancien `datetime-local`) : le calendrier et l'heure côte à côte. */
export function ChoixDateEtHeure({
  valeur,
  onChange,
  disabled,
  min,
  className,
  classeChamp,
  ...reste
}: { valeur: string; onChange: (valeur: string) => void; disabled?: boolean; min?: string; className?: string; /** La tenue des deux champs (une ligne compacte). */ classeChamp?: string } & Reperes) {
  const [jour, heure] = (valeur ?? '').split('T');
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} data-choix-date-et-heure={valeur || ''} {...reste}>
      <ChoixDeDate valeur={jour ?? ''} min={min?.slice(0, 10)} disabled={disabled} onChange={(j) => onChange(j ? `${j}T${(heure || '09:00').slice(0, 5)}` : '')} className={cn('flex-1', classeChamp)} />
      <ChoixDHeure valeur={(heure ?? '').slice(0, 5)} disabled={disabled} onChange={(h) => onChange(`${jour || dateEnTexte(new Date())}T${h}`)} className={cn('w-[7.5rem] shrink-0', classeChamp)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Curseur                                                              */
/* ------------------------------------------------------------------ */

/**
 * UN CURSEUR : une piste grise, sa part remplie en encre, une poignée ronde.
 * La valeur suit le doigt (`onChange`), et `onValider` ne part qu'au relâché ou
 * après une touche du clavier — une seule opération par geste.
 */
export function Curseur({
  valeur,
  min,
  max,
  pas = 1,
  onChange,
  onValider,
  disabled,
  className,
  'aria-label': ariaLabel,
  ...reste
}: {
  valeur: number;
  min: number;
  max: number;
  pas?: number;
  onChange?: (valeur: number) => void;
  onValider?: (valeur: number) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
} & Reperes) {
  const piste = React.useRef<HTMLDivElement>(null);
  const tenu = React.useRef(false);
  const derniere = React.useRef(valeur);
  derniere.current = valeur;
  const arrondir = (v: number) => {
    const n = Math.round((v - min) / pas) * pas + min;
    return Math.min(max, Math.max(min, Number(n.toFixed(6))));
  };
  const depuisPointeur = (clientX: number) => {
    const boite = piste.current?.getBoundingClientRect();
    if (!boite || boite.width <= 0) return valeur;
    return arrondir(min + ((clientX - boite.left) / boite.width) * (max - min));
  };
  const part = max > min ? ((valeur - min) / (max - min)) * 100 : 0;
  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={valeur}
      aria-disabled={disabled || undefined}
      data-curseur={valeur}
      {...reste}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        tenu.current = true;
        const v = depuisPointeur(e.clientX);
        derniere.current = v;
        onChange?.(v);
      }}
      onPointerMove={(e) => {
        if (!tenu.current) return;
        const v = depuisPointeur(e.clientX);
        if (v !== derniere.current) {
          derniere.current = v;
          onChange?.(v);
        }
      }}
      onPointerUp={() => {
        if (!tenu.current) return;
        tenu.current = false;
        onValider?.(derniere.current);
      }}
      onPointerCancel={() => {
        tenu.current = false;
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        const grand = (max - min) / 10;
        const suivant =
          e.key === 'ArrowRight' || e.key === 'ArrowUp'
            ? valeur + pas
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
              ? valeur - pas
              : e.key === 'PageUp'
                ? valeur + grand
                : e.key === 'PageDown'
                  ? valeur - grand
                  : e.key === 'Home'
                    ? min
                    : e.key === 'End'
                      ? max
                      : null;
        e.stopPropagation();
        if (suivant === null) return;
        e.preventDefault();
        const v = arrondir(suivant);
        onChange?.(v);
        onValider?.(v);
      }}
      className={cn(
        'group relative flex h-8 min-w-0 flex-1 cursor-pointer touch-none select-none items-center focus-visible:outline-none',
        disabled && 'cursor-default opacity-50',
        className,
      )}
    >
      <div ref={piste} className="relative h-1.5 w-full rounded-full bg-faint/35">
        <div className="absolute inset-y-0 left-0 rounded-full bg-text/70" style={{ width: `${part}%` }} />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface shadow ring-1 ring-text/30 transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-text/60"
          style={{ left: `${part}%` }}
        />
      </div>
    </div>
  );
}
