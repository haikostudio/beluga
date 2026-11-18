import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from '@/components/ui/icones';
import { Drawer, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EnteteDeFeuille, LIGNE_DE_FEUILLE, MARGE_DE_FEUILLE, ZoneDefilement } from '@/components/ui';
import { OptionDePage, OptionsDePage } from '@/components/entete-de-zone';
import { formatRegional, t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { CLASSES_BARRE_D_ONGLETS, classesDOnglet } from '@/components/ui/barre-d-onglets';

/**
 * LA BARRE DE PÉRIODE, UNE SEULE POUR TOUTE L'APPLICATION (demande du
 * 28/09/2026) : un groupe segmenté compact « 7j · 30j · 90j », puis un bouton
 * « Plage » qui ouvre un MENU À DEUX CALENDRIERS — le mois du début à gauche,
 * celui de la fin à droite, les jours entre les deux surlignés. Elle sert au
 * service Statistiques et à l'accueil de l'espace client ; toute nouvelle barre
 * de dates la reprend au lieu d'aligner ses propres boutons.
 *
 * Choisir une plage : un premier clic pose le début, un second la fin (avant
 * le début, les deux s'inversent) ; le survol prévisualise la plage, et le
 * second clic l'applique puis referme le menu. Aucun jour futur, aucun jour
 * antérieur à `min` (la conservation des données).
 *
 * Sur téléphone, le menu se pose en tiroir au bas de l'écran, comme tous les
 * menus de l'application (`styles.css`), les deux mois toujours côte à côte.
 *
 * Les jours sont calés sur l'heure LOCALE : le début part à 00:00, la fin
 * s'arrête à 23:59:59 — comme le faisaient les anciens champs de date.
 *
 * Elle ne retient rien : l'écran qui l'emploie garde l'échelle (ou les deux
 * bornes) là où il veut — réglages, état local — et le serveur remet de toute
 * façon la période d'aplomb (bornes à l'envers, trop profondes).
 *
 * `compact` — LA TENUE DU TÉLÉPHONE, là où la barre doit tenir sur la rangée
 * des onglets ou dans la barre d'en-tête (demande du 11/10/2026) : UN SEUL
 * bouton, qui dit la période retenue (« 30j », « 21 → 28 sept. ») et ouvre la
 * liste des échelles, « Plage » en dernier. Mêmes repères, portés par les
 * lignes du menu ; le bouton porte `data-periode-compacte`.
 *
 * SUR TÉLÉPHONE, LA PÉRIODE N'EST PLUS DANS LA PAGE (décision de l'utilisateur du 03/11/2026, captures #2900, #68c3,
 * #b496, #dbc5 : une barre de petits segments, un bouton « 30 j » seul sur sa ligne, des pastilles qui prenaient une
 * ligne). C'est une ligne des trois points du haut, « Période : 30 jours », qui ouvre UNE feuille du bas : les durées
 * toutes prêtes, puis — quand l'écran accepte deux dates (`onLibre`) — un calendrier de PLAGE, un mois à la fois, à la
 * taille du doigt. `PeriodeAuTelephone` ; `compact` n'y change rien. Sur ordinateur, rien ne change.
 *
 * Repères de contrôle : `data-selecteur-periode`, `data-echelle-periode`,
 * `data-periode-libre` (sur le bouton « Plage » : `ouverte` | `fermee`),
 * `data-periode-menu`, `data-periode-calendrier="debut|fin"`,
 * `data-periode-jour="AAAA-MM-JJ"` (avec `data-borne` et `data-dans-plage`).
 */
export function SelecteurPeriode({
  echelles = [7, 30, 90],
  echelle,
  debut,
  fin,
  onEchelle,
  onLibre,
  min,
  compact = false,
}: {
  /** Les échelles toutes prêtes, en JOURS. */
  echelles?: readonly number[];
  /** L'échelle retenue, en jours ; `null` quand deux dates ont été posées. */
  echelle: number | null;
  debut: number;
  fin: number;
  onEchelle: (jours: number) => void;
  /** Deux dates choisies ; absent, l'écran n'accepte que les échelles (pas de « Plage »). */
  onLibre?: (debut: number, fin: number) => void;
  /** Le plus ancien jour qu'on peut choisir (la conservation des données). */
  min?: number;
  /** Un seul bouton, qui ouvre la liste des périodes (téléphone). */
  compact?: boolean;
}) {
  const telephone = useTelephone();
  const [ouvert, setOuvert] = React.useState(false);
  const libre = echelle === null;
  if (telephone) {
    return <PeriodeAuTelephone echelles={echelles} echelle={echelle} debut={debut} fin={fin} onEchelle={onEchelle} onLibre={onLibre} min={min} />;
  }
  /* UNE SEULE HAUTEUR, UNE SEULE TENUE (carte « Services homogènes et centrés », 14/11/2026, capture #e839 : la période
     à 28 px en caractères de machine à écrire, à côté d'un filtre à 32 et d'un chevron à 36) : la barre prend
     `CLASSES_BARRE_D_ONGLETS` et chaque segment la tenue d'un onglet (`classesDOnglet`), le texte de l'interface. */
  const segment = 'tabular-nums';
  const libelleDEchelle = (jours: number) => (jours === 365 ? t('1 an') : t('{n}j', { n: jours }));
  /* « Plage » a été choisie dans le menu : les calendriers s'ouvrent une fois
     le menu REFERMÉ (`onCloseAutoFocus`) — ouverts plus tôt, le retour du focus
     vers le bouton les refermerait aussitôt. */
  const versLaPlage = React.useRef(false);

  if (compact) {
    return (
      <div className="flex shrink-0 items-center" data-selecteur-periode={echelle ?? 'libre'}>
        <PopoverPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
          <DropdownMenu>
            <PopoverPrimitive.Anchor asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-[38px] sm:h-8 max-w-[11rem] items-center gap-1.5 rounded-lg bg-raised px-2.5 text-[13px] text-text transition-colors hover:bg-fond-survol"
                  aria-label="Période"
                  title={t('Période')}
                  data-periode-compacte
                >
                  <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 truncate tabular-nums">{libre ? libelleDePlage(debut, fin) : libelleDEchelle(echelle)}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                </button>
              </DropdownMenuTrigger>
            </PopoverPrimitive.Anchor>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                if (!versLaPlage.current) return;
                versLaPlage.current = false;
                e.preventDefault();
                setOuvert(true);
              }}
            >
              {echelles.map((jours) => {
                const actif = echelle === jours;
                return (
                  <DropdownMenuItem
                    key={jours}
                    className={cn(actif && 'text-teinte')}
                    aria-current={actif ? 'true' : undefined}
                    data-echelle-periode={jours}
                    onSelect={() => onEchelle(jours)}
                  >
                    <span className="min-w-0 flex-1 tabular-nums">{libelleDEchelle(jours)}</span>
                    {actif ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem
                className={cn(libre && 'text-teinte')}
                aria-current={libre ? 'true' : undefined}
                data-periode-libre="fermee"
                onSelect={() => {
                  versLaPlage.current = true;
                }}
              >
                <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{libre ? libelleDePlage(debut, fin) : t('Plage')}</span>
                {libre ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={8}
              className={CLASSE_DU_MENU_DES_CALENDRIERS}
              data-periode-menu
            >
              <DeuxCalendriers
                debut={debut}
                fin={fin}
                min={min}
                onChoisi={(d, f) => {
                  onLibre?.(d, f);
                  setOuvert(false);
                }}
              />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-selecteur-periode={echelle ?? 'libre'}>
      <div className={CLASSES_BARRE_D_ONGLETS} role="group">
        {echelles.map((jours) => {
          const actif = echelle === jours;
          return (
            <button
              key={jours}
              type="button"
              className={cn(segment, classesDOnglet(actif))}
              aria-pressed={actif}
              data-echelle-periode={jours}
              onClick={() => onEchelle(jours)}
            >
              {libelleDEchelle(jours)}
            </button>
          );
        })}
        {onLibre ? (
        <PopoverPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              className={cn(segment, classesDOnglet(libre), ouvert && !libre && 'text-text')}
              aria-pressed={libre}
              data-periode-libre={ouvert ? 'ouverte' : 'fermee'}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {libre ? libelleDePlage(debut, fin) : t('Plage')}
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={8}
              className={CLASSE_DU_MENU_DES_CALENDRIERS}
              data-periode-menu
            >
              <DeuxCalendriers
                debut={debut}
                fin={fin}
                min={min}
                onChoisi={(d, f) => {
                  onLibre?.(d, f);
                  setOuvert(false);
                }}
              />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        ) : null}
      </div>
    </div>
  );
}

/** « 30 jours », « 1 an » : l'échelle en toutes lettres, pour la ligne des trois points et la feuille. */
function echelleEnLettres(jours: number): string {
  return jours === 365 ? t('1 an') : t('{n} jours', { n: jours });
}

/**
 * LA PÉRIODE DU TÉLÉPHONE : une ligne des trois points du haut (`OptionsDePage`), et la feuille commune qu'elle ouvre.
 * Choisir une durée referme la feuille ; une plage se referme au second jour touché.
 */
function PeriodeAuTelephone({
  echelles,
  echelle,
  debut,
  fin,
  onEchelle,
  onLibre,
  min,
}: {
  echelles: readonly number[];
  echelle: number | null;
  debut: number;
  fin: number;
  onEchelle: (jours: number) => void;
  onLibre?: (debut: number, fin: number) => void;
  min?: number;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const libre = echelle === null;
  const retenue = libre ? libelleDePlage(debut, fin) : echelleEnLettres(echelle);
  return (
    <>
      {/* Le repère reste dans la page : les contrôles y lisent l'échelle retenue, même menu fermé. */}
      <span hidden data-selecteur-periode={echelle ?? 'libre'} />
      <OptionsDePage>
        <OptionDePage icone={<CalendarRange />} onClick={() => setOuvert(true)} aria-haspopup="dialog" data-periode-compacte data-periode-ligne>
          {t('Période : {periode}', { periode: retenue })}
        </OptionDePage>
      </OptionsDePage>
      <Drawer feuille open={ouvert} onClose={() => setOuvert(false)} adresse="periode">
        <EnteteDeFeuille titre={t('Période')} data-periode-menu />
        <ZoneDefilement className={cn('min-h-0', MARGE_DE_FEUILLE, 'pb-4')}>
          <div role="listbox" aria-label="Période" className="flex flex-col gap-0.5">
            {echelles.map((jours) => {
              const actif = echelle === jours;
              return (
                <div
                  key={jours}
                  role="option"
                  aria-selected={actif}
                  tabIndex={0}
                  onClick={() => {
                    onEchelle(jours);
                    setOuvert(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    onEchelle(jours);
                    setOuvert(false);
                  }}
                  className={cn(
                    'flex cursor-pointer select-none items-center gap-2.5 py-1.5 text-[14px] outline-none transition-colors hover:bg-raised focus-visible:bg-raised',
                    LIGNE_DE_FEUILLE,
                    actif ? 'text-teinte' : 'text-text',
                  )}
                  data-echelle-periode={jours}
                  aria-current={actif ? 'true' : undefined}
                >
                  <span className="min-w-0 flex-1 tabular-nums">{echelleEnLettres(jours)}</span>
                  <Check className={cn('h-4 w-4 shrink-0 text-teinte', !actif && 'invisible')} aria-hidden />
                </div>
              );
            })}
          </div>
          {onLibre ? (
            <section className="mt-3 flex flex-col gap-2" data-periode-libre={libre ? 'choisie' : 'ouverte'}>
              <p className={cn('px-2 text-[12.5px] font-medium', libre ? 'text-teinte' : 'text-muted')}>
                {libre ? t('Plage de dates : {plage}', { plage: retenue }) : t('Plage de dates')}
              </p>
              <DeuxCalendriers
                unMois
                debut={debut}
                fin={fin}
                min={min}
                onChoisi={(d, f) => {
                  onLibre(d, f);
                  setOuvert(false);
                }}
              />
            </section>
          ) : null}
        </ZoneDefilement>
      </Drawer>
    </>
  );
}

/** Le menu des deux calendriers : flottant sur ordinateur, panneau du bas sur toute la largeur du téléphone. */
const CLASSE_DU_MENU_DES_CALENDRIERS =
  'z-50 w-[420px] rounded-lg border border-border bg-raised p-2.5 shadow-xl animate-fade-in max-sm:!w-full max-sm:!max-w-none max-sm:rounded-b-none max-sm:px-4 max-sm:pb-6 max-sm:pt-3';

/** Les deux mois côte à côte, et la plage en cours de choix — repris tel quel par la remontée dans le temps de la mémoire. */
export function DeuxCalendriers({
  debut,
  fin,
  min,
  onChoisi,
  unMois = false,
  avenir = false,
}: {
  debut: number;
  fin: number;
  min?: number;
  onChoisi: (debut: number, fin: number) => void;
  /**
   * LES JOURS À VENIR SONT PERMIS (campagne de Communication, 05/11/2026) : on prévoit une période, on ne relit pas
   * un passé. Par défaut, rien ne change — Statistiques, accueil client, tableau de bord et mémoire refusent
   * toujours les jours futurs.
   */
  avenir?: boolean;
  /**
   * UN SEUL MOIS, À LA TAILLE DU DOIGT (téléphone, 03/11/2026 : les deux petits mois côte à côte de #2900) : les
   * flèches passent d'un mois à l'autre, et la plage peut commencer dans un mois et finir dans un autre.
   */
  unMois?: boolean;
}) {
  const aujourdhui = pourChampDate(Date.now());
  const plancher = min ? pourChampDate(min) : null;
  const [choix, setChoix] = React.useState<{ debut: string; fin: string | null }>(() => ({ debut: pourChampDate(debut), fin: pourChampDate(fin) }));
  const [survol, setSurvol] = React.useState<string | null>(null);
  const moisMax = avenir ? null : moisDe(aujourdhui);
  const [droite, setDroite] = React.useState(() => moisDe(pourChampDate(fin)));
  const [gauche, setGauche] = React.useState(() => {
    const m = moisDe(pourChampDate(debut));
    return m < moisDe(pourChampDate(fin)) ? m : decalerMois(moisDe(pourChampDate(fin)), -1);
  });

  // La plage montrée : celle retenue, ou celle que le survol prévisualise.
  const bout = choix.fin ?? survol ?? choix.debut;
  const [a, b] = choix.debut <= bout ? [choix.debut, bout] : [bout, choix.debut];

  const cliquer = (jour: string) => {
    if (choix.fin !== null) {
      setChoix({ debut: jour, fin: null });
      return;
    }
    const [d, f] = jour < choix.debut ? [jour, choix.debut] : [choix.debut, jour];
    setChoix({ debut: d, fin: f });
    onChoisi(new Date(`${d}T00:00:00`).getTime(), new Date(`${f}T23:59:59`).getTime());
  };

  const commun = { a, b, plancher, aujourdhui, avenir, onClic: cliquer, onSurvol: setSurvol };
  if (unMois) {
    return (
      <div className="flex flex-col gap-2">
        <Mois
          {...commun}
          grand
          quel="plage"
          mois={droite}
          precedent={plancher === null || droite > moisDe(plancher) ? () => setDroite(decalerMois(droite, -1)) : undefined}
          suivant={moisMax === null || droite < moisMax ? () => setDroite(decalerMois(droite, 1)) : undefined}
        />
        <p className="px-2 text-[12.5px] text-faint" data-periode-consigne={choix.fin === null ? 'fin' : 'debut'}>
          {choix.fin === null ? t('Choisissez le dernier jour.') : t('Choisissez le premier jour, puis le dernier.')}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3" onPointerLeave={() => setSurvol(null)}>
        <Mois
          {...commun}
          quel="debut"
          mois={gauche}
          precedent={plancher === null || gauche > moisDe(plancher) ? () => setGauche(decalerMois(gauche, -1)) : undefined}
          suivant={decalerMois(gauche, 1) < droite ? () => setGauche(decalerMois(gauche, 1)) : undefined}
        />
        <Mois
          {...commun}
          quel="fin"
          mois={droite}
          precedent={decalerMois(droite, -1) > gauche ? () => setDroite(decalerMois(droite, -1)) : undefined}
          suivant={moisMax === null || droite < moisMax ? () => setDroite(decalerMois(droite, 1)) : undefined}
        />
      </div>
      <p className="px-0.5 text-[11.5px] text-faint" data-periode-consigne={choix.fin === null ? 'fin' : 'debut'}>
        {choix.fin === null ? t('Choisissez le dernier jour.') : t('Choisissez le premier jour, puis le dernier.')}
      </p>
    </div>
  );
}

/** Un mois : son titre, ses deux flèches, sa grille lundi → dimanche. */
function Mois({
  quel,
  grand = false,
  mois,
  a,
  b,
  plancher,
  aujourdhui,
  avenir = false,
  precedent,
  suivant,
  onClic,
  onSurvol,
}: {
  quel: 'debut' | 'fin' | 'plage';
  /** Le mois seul du téléphone : des cases à la taille du doigt. */
  grand?: boolean;
  /** « AAAA-MM ». */
  mois: string;
  a: string;
  b: string;
  plancher: string | null;
  aujourdhui: string;
  /** Les jours futurs se touchent (voir `DeuxCalendriers`). */
  avenir?: boolean;
  precedent?: () => void;
  suivant?: () => void;
  onClic: (jour: string) => void;
  onSurvol: (jour: string | null) => void;
}) {
  const [annee, m] = mois.split('-').map(Number);
  const premier = new Date(annee, m - 1, 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi en tête
  const nbJours = new Date(annee, m, 0).getDate();
  const cases: (string | null)[] = [
    ...Array.from({ length: decalage }, () => null),
    ...Array.from({ length: nbJours }, (_, i) => `${mois}-${String(i + 1).padStart(2, '0')}`),
  ];
  const format = formatRegional();
  const titre = premier.toLocaleDateString(format, { month: 'long', year: 'numeric' });
  // Un lundi connu (5 janvier 2026), pour nommer les jours dans la langue en vigueur.
  const jours = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 5 + i).toLocaleDateString(format, { weekday: 'narrow' }));
  const fleche = cn(
    'flex shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-bloc hover:text-text disabled:pointer-events-none disabled:opacity-30',
    grand ? 'h-[38px] w-[38px]' : 'h-6 w-6',
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1" data-periode-calendrier={quel} data-periode-mois={mois}>
      <div className="flex items-center gap-1">
        <button type="button" className={fleche} disabled={!precedent} onClick={precedent} aria-label="Mois precedent" title={t('Mois précédent')} data-periode-mois-precedent>
          <ChevronLeft className={grand ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        </button>
        <span className={cn('min-w-0 flex-1 truncate text-center font-medium capitalize text-text', grand ? 'text-[15px]' : 'text-[12px]')}>{titre}</span>
        <button type="button" className={fleche} disabled={!suivant} onClick={suivant} aria-label="Mois suivant" title={t('Mois suivant')} data-periode-mois-suivant>
          <ChevronRight className={grand ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        </button>
      </div>
      <div className="grid grid-cols-7">
        {jours.map((j, i) => (
          <span key={i} className={cn('flex items-center justify-center uppercase text-faint', grand ? 'h-8 text-[12px]' : 'h-6 text-[10.5px]')}>
            {j}
          </span>
        ))}
        {cases.map((jour, i) => {
          if (!jour) return <span key={i} />;
          const hors = (!avenir && jour > aujourdhui) || (plancher !== null && jour < plancher);
          const borne = jour === a || jour === b;
          const dedans = jour > a && jour < b;
          return (
            <span
              key={jour}
              className={cn(
                'flex items-center justify-center',
                grand ? 'h-11' : 'h-7',
                (dedans || (borne && a !== b)) && 'bg-accent/15',
                jour === a && a !== b && 'rounded-l-md',
                jour === b && a !== b && 'rounded-r-md',
              )}
            >
              <button
                type="button"
                disabled={hors}
                onClick={() => onClic(jour)}
                onPointerEnter={() => onSurvol(jour)}
                className={cn(
                  'flex aspect-square h-full items-center justify-center rounded-md tabular-nums transition-colors disabled:pointer-events-none disabled:text-faint/50',
                  grand ? 'max-h-11 text-[15px]' : 'max-h-7 font-mono text-[11.5px]',
                  borne ? 'bg-accent text-accent-fg' : dedans ? 'text-text' : 'text-muted hover:bg-bloc hover:text-text',
                  jour === aujourdhui && !borne && 'font-semibold text-text',
                )}
                data-periode-jour={jour}
                data-borne={borne ? '' : undefined}
                data-dans-plage={dedans ? '' : undefined}
              >
                {Number(jour.slice(8))}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** « 21 → 28 sept. », ou « 30 août → 5 sept. », dans la langue en vigueur. */
export function libelleDePlage(debut: number, fin: number): string {
  const format = formatRegional();
  const d = new Date(debut);
  const f = new Date(fin);
  const memeMois = d.getMonth() === f.getMonth() && d.getFullYear() === f.getFullYear();
  const gauche = memeMois ? String(d.getDate()) : d.toLocaleDateString(format, { day: 'numeric', month: 'short' });
  return `${gauche} → ${f.toLocaleDateString(format, { day: 'numeric', month: 'short' })}`;
}

/** « AAAA-MM » d'un jour « AAAA-MM-JJ ». */
function moisDe(jour: string): string {
  return jour.slice(0, 7);
}

/** Le mois « AAAA-MM » décalé de `n` mois. */
function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Le jour « 2026-09-18 » tel qu'un champ de date le veut, dans l'heure locale. */
export function pourChampDate(at: number): string {
  const d = new Date(at);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}
