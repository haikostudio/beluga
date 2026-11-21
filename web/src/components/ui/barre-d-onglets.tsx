import { LienInterne } from '@/components/ui/lien-interne';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { TITRE_DE_PAGE, TITRE_DE_SECTION } from '@/lib/echelle-de-texte';
import { HAUTEUR_DE_CONTROLE } from '@/components/ui';

/**
 * LA BARRE D'ONGLETS COMMUNE (décision de l'utilisateur du 03/11/2026, revue le même jour : « une barre avec un
 * fond contrasté et UN bouton actif ») : UNE barre au fond contrasté (`bg-onglets-barre`), les onglets au repos
 * TRANSPARENTS (le jeton `bg-onglets-repos` ne sert plus qu'au survol), et SEUL l'onglet choisi s'éclaire
 * (`bg-onglets-actif`), son texte en violet. CHAQUE onglet dit combien il compte d'éléments (`nombre`, zéro
 * compris), en pastille discrète après son libellé. La barre principale d'une page se pose À DROITE de son titre
 * (`TitreEtOnglets`), les filtres dessous.
 *
 * Les mêmes classes habillent les onglets Radix (`TabsList` / `TabsTrigger` de `ui/index.tsx`) : une seule
 * tenue dans toute l'application. Trop d'onglets pour la largeur ? La barre glisse de côté, sans barre de
 * défilement visible.
 *
 * Repères : `data-barre-onglets` (son nom) sur la barre, `data-onglet` (la clé) et `aria-selected` sur
 * chaque onglet, `data-compteur-onglet` (le nombre) sur le compteur.
 *
 * UNE SEULE HAUTEUR, CELLE DES BOUTONS (décision de l'utilisateur, carte « Lecteur de charte : commentaires et
 * barre ») : la barre prend `HAUTEUR_DE_CONTROLE` (38 px sur téléphone, 32 px sur ordinateur), ses onglets la
 * remplissent moins la marge de 2 px. Plus de « petite » taille : une barre d'onglets n'est jamais plus basse qu'un
 * bouton voisin.
 */
export const CLASSES_BARRE_D_ONGLETS = cn('inline-flex max-w-full items-center gap-0.5 rounded-lg bg-onglets-barre p-0.5', HAUTEUR_DE_CONTROLE);

/** L'onglet : au repos transparent (fond au survol seulement) ; choisi, le plus clair et le texte violet. */
export function classesDOnglet(choisi: boolean): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors',
    'h-[34px] px-3 text-[13px] sm:h-7 sm:px-2.5',
    choisi ? 'bg-onglets-actif font-medium text-teinte shadow-sm' : 'bg-transparent text-muted hover:bg-onglets-repos hover:text-text',
  );
}

/** Le compteur d'un onglet : le nombre d'éléments qu'il montre. */
export function CompteurDOnglet({ nombre, choisi }: { nombre?: number | null; choisi?: boolean }) {
  if (nombre === undefined || nombre === null) return null;
  return (
    <span
      className={cn('min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-normal leading-[16px] tabular-nums', choisi ? 'bg-teinte/15 text-teinte' : 'bg-onglets-barre/70 text-faint')}
      data-compteur-onglet={nombre}
    >
      {nombre.toLocaleString(undefined)}
    </span>
  );
}

/** Un onglet en icône seule : carré, à la hauteur de la barre. */
const CLASSES_ONGLET_ICONE = 'w-[34px] px-0 sm:w-7 sm:px-0';

/** L'infobulle d'un onglet : son `titre`, ou son libellé quand il n'est montré qu'en icône. */
function titreDOnglet(o: { titre?: string; iconeSeule?: boolean; libelle: React.ReactNode }): string | undefined {
  if (o.titre) return o.titre;
  return o.iconeSeule && typeof o.libelle === 'string' ? o.libelle : undefined;
}

export interface OngletDeBarre<C extends string | number> {
  cle: C;
  libelle: React.ReactNode;
  /** Le nombre d'éléments de l'onglet ; absent, pas de compteur (un onglet sans liste). */
  nombre?: number | null;
  icone?: React.ReactNode;
  titre?: string;
  desactive?: boolean;
  /**
   * L'ICÔNE SEULE (décision de l'utilisateur, carte « Retouches de la charte graphique ») : le libellé ne se lit plus
   * qu'en infobulle (`titre`, à défaut le libellé s'il est un texte) et pour les lecteurs d'écran.
   */
  iconeSeule?: boolean;
}

export function BarreDOnglets<C extends string | number>({
  onglets,
  valeur,
  onChange,
  repere,
  pleineLargeur,
  className,
  libelle,
  attributsOnglet,
  attributs,
  adresseDe,
}: {
  /**
   * L'ADRESSE OÙ MÈNE CHAQUE ONGLET (sans « # ») quand l'onglet change l'adresse : il devient un vrai lien
   * (`LienInterne`), ouvrable dans un nouvel onglet ; le clic simple garde `onChange`.
   */
  adresseDe?: (cle: C) => string;
  onglets: readonly OngletDeBarre<C>[];
  valeur: C;
  onChange: (cle: C) => void;
  repere: string;
  /** Les onglets se partagent toute la largeur. */
  pleineLargeur?: boolean;
  className?: string;
  /** Le nom de la barre pour les lecteurs d'écran. */
  libelle?: string;
  /** Des repères posés sur chaque onglet (contrôles existants). */
  attributsOnglet?: (cle: C) => Record<string, string | undefined>;
  /** Des repères posés sur la barre. */
  attributs?: Record<string, string | undefined>;
}) {
  const references = React.useRef(new Map<C, HTMLElement | null>());
  const barre = React.useRef<HTMLDivElement | null>(null);
  /*
   * L'ONGLET CHOISI RESTE DANS LA PARTIE VISIBLE (carte « Extension, rapport SEO-GEO et menus », 21/11/2026, #a678) :
   * la barre garde la largeur de son conteneur et défile de côté à l'intérieur ; un onglet choisi à moitié caché y est
   * ramené — SEULEMENT s'il dépasse, au bord le plus proche (le dernier calé à droite). Jamais `scrollIntoView` : il
   * ferait aussi défiler la page ou le volet qui porte la barre.
   */
  React.useEffect(() => {
    const b = barre.current;
    const el = references.current.get(valeur);
    if (!b || !el || b.scrollWidth <= b.clientWidth) return;
    const gauche = el.getBoundingClientRect().left - b.getBoundingClientRect().left + b.scrollLeft;
    const droite = gauche + el.getBoundingClientRect().width;
    const marge = 4;
    if (gauche < b.scrollLeft) b.scrollTo({ left: Math.max(0, gauche - marge), behavior: 'smooth' });
    else if (droite > b.scrollLeft + b.clientWidth) b.scrollTo({ left: droite - b.clientWidth + marge, behavior: 'smooth' });
  }, [valeur]);
  /* LE CLAVIER, comme une vraie rangée d'onglets : flèches gauche/droite, Début, Fin. */
  const auClavier = (event: React.KeyboardEvent, rang: number) => {
    const actifs = onglets.filter((o) => !o.desactive);
    const ici = actifs.findIndex((o) => o.cle === onglets[rang]!.cle);
    let suivant: number | null = null;
    if (event.key === 'ArrowRight') suivant = (ici + 1) % actifs.length;
    else if (event.key === 'ArrowLeft') suivant = (ici - 1 + actifs.length) % actifs.length;
    else if (event.key === 'Home') suivant = 0;
    else if (event.key === 'End') suivant = actifs.length - 1;
    if (suivant === null) return;
    event.preventDefault();
    const cle = actifs[suivant]!.cle;
    onChange(cle);
    references.current.get(cle)?.focus();
  };
  return (
    <div
      ref={barre}
      role="tablist"
      aria-label={libelle}
      className={cn(
        CLASSES_BARRE_D_ONGLETS,
        'overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        pleineLargeur && 'flex w-full [&>*]:flex-1',
        className,
      )}
      data-barre-onglets={repere}
      {...(attributs ?? {})}
    >
      {onglets.map((o, rang) => {
        const choisi = o.cle === valeur;
        if (adresseDe && !o.desactive)
          return (
            <LienInterne
              key={String(o.cle)}
              ref={(el) => {
                references.current.set(o.cle, el);
              }}
              adresse={adresseDe(o.cle)}
              role="tab"
              aria-selected={choisi}
              tabIndex={choisi ? 0 : -1}
              title={titreDOnglet(o)}
              onClick={() => onChange(o.cle)}
              onKeyDown={(e) => auClavier(e, rang)}
              className={cn(classesDOnglet(choisi), o.iconeSeule && CLASSES_ONGLET_ICONE)}
              data-onglet={String(o.cle)}
              {...(attributsOnglet?.(o.cle) ?? {})}
            >
              {o.icone}
              <span className={o.iconeSeule ? 'sr-only' : 'truncate'}>{o.libelle}</span>
              <CompteurDOnglet nombre={o.nombre} choisi={choisi} />
            </LienInterne>
          );
        return (
          <button
            key={String(o.cle)}
            ref={(el) => {
              references.current.set(o.cle, el);
            }}
            type="button"
            role="tab"
            aria-selected={choisi}
            tabIndex={choisi ? 0 : -1}
            disabled={o.desactive}
            title={titreDOnglet(o)}
            onClick={() => onChange(o.cle)}
            onKeyDown={(e) => auClavier(e, rang)}
            className={cn(classesDOnglet(choisi), o.iconeSeule && CLASSES_ONGLET_ICONE, o.desactive && 'opacity-50')}
            data-onglet={String(o.cle)}
            {...(attributsOnglet?.(o.cle) ?? {})}
          >
            {o.icone}
            <span className={o.iconeSeule ? 'sr-only' : 'truncate'}>{o.libelle}</span>
            <CompteurDOnglet nombre={o.nombre} choisi={choisi} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * LE TITRE ET SES ONGLETS SUR UNE LIGNE (décision de l'utilisateur du 03/11/2026) : le titre de la page à gauche,
 * la barre d'onglets principale À DROITE, puis les gestes (`children`). Ce qui ne tient pas passe à la ligne
 * suivante — la barre y prend toute la largeur et glisse de côté. Les filtres se posent DESSOUS, jamais ici.
 * Le titre suit l'échelle unique (`TITRE_DE_PAGE`, 18 px).
 *
 * Repères : `data-titre-et-onglets` sur la ligne, `data-titre-de-page` sur le titre.
 */
export function TitreEtOnglets({
  titre,
  onglets,
  children,
  niveau = 'page',
  className,
}: {
  titre: React.ReactNode;
  onglets?: React.ReactNode;
  children?: React.ReactNode;
  /** « section » : le titre d'un bloc (14 px) au lieu de celui d'une page. */
  niveau?: 'page' | 'section';
  className?: string;
}) {
  const Balise = niveau === 'page' ? 'h1' : 'h2';
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', className)} data-titre-et-onglets>
      {/* LE TITRE ET SES ONGLETS RESTENT SUR LA MÊME LIGNE : le titre garde sa place, la barre glisse de côté si
          elle déborde (elle porte son propre défilement), jamais renvoyée sous le titre. */}
      <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
        <Balise
          className={cn('min-w-0 shrink-0 truncate text-text', niveau === 'page' ? TITRE_DE_PAGE : TITRE_DE_SECTION)}
          data-titre-de-page={niveau === 'page' ? '' : undefined}
        >
          {titre}
        </Balise>
        {onglets ? (
          <div className="ml-auto flex min-w-0 justify-end" data-titre-et-onglets-droite>
            {onglets}
          </div>
        ) : null}
      </div>
      {/* LES GESTES : sur téléphone une rangée à eux, sous le titre, qui se partagent la largeur ; sur ordinateur, au
          bout de la ligne. Jamais empilés l'un sous l'autre. */}
      {children ? (
        <div className="flex min-w-0 basis-full flex-wrap items-center justify-end gap-2 max-sm:[&>*]:flex-1 sm:ml-auto sm:basis-auto" data-titre-et-gestes>
          {children}
        </div>
      ) : null}
    </div>
  );
}
