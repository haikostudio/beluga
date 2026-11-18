import { ChampDeRecherche } from '@/components/ui/champ-de-recherche';
import { useBasDeLaZoneQuiDefile } from '@/components/ui/bas-de-zone';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Filter, Search, X } from '@/components/ui/icones';
import {
  TAILLES_DE_PAGE,
  TAILLE_DE_PAGE_PAR_DEFAUT,
  basculerUnChoix,
  ecrireUnTexte,
  filtrerLesLignes,
  filtreActif,
  nombreDeFiltresActifs,
  pageDuTableau,
  signatureDesFiltres,
  trierLesLignes,
  triSuivantDuTableau,
  valeursDuChoix,
  type FiltresDuTableau,
  type SensDuTri,
  type TriDuTableau,
  type ValeurFiltrable,
  type ValeurTriable,
} from '@beluga/shared';
import { formatRegional, t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { BoutonGroupe, CLASSE_SEGMENT_DE_GROUPE, HAUTEUR_DE_CONTROLE, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, ZoneDefilement } from '@/components/ui';
import { CaseACocher } from '@/components/ui/elements-maison';
import { FlecheDePage } from '@/components/ui/pagination-fleches';
import { BasculeDePage, useDansUnePageDeService, useEmplacementDesOutils } from '@/components/fenetre-de-service';

/**
 * LE TABLEAU COMMUN DE L'APPLICATION (décision de l'utilisateur du 03/11/2026 : « toutes les listes deviennent des
 * tableaux », médias compris). Un seul modèle, pour toutes les listes de CONTENU — jamais pour la navigation
 * (colonne de gauche, menus, tableau des cartes, fil des conversations, frise du Studio).
 *
 * - L'EN-TÊTE a un fond contrasté (`bg-tableau-entete`, déclaré dans les deux palettes). Un clic trie en TROIS
 *   temps (sens naturel, l'autre sens, l'ordre reçu — `triSuivantDuTableau`), `aria-sort` le dit.
 * - LE FILTRE : l'entonnoir d'une colonne filtrable (posé en absolu dans la marge droite du titre, largeur nulle)
 *   ouvre la rangée des filtres sous l'en-tête — recherche sans accents (`texte`) ou cases des valeurs présentes
 *   (`choix`). Plus, si demandé, une recherche d'ensemble au-dessus. Règles pures : `shared/src/filtres-du-tableau.ts`.
 * - LES COLONNES ont une largeur déclarée (`largeur`, en pixels) : table fixe, en-tête et cellules alignés. Les
 *   colonnes `secondaire` se retirent quand le cadre est étroit ; `masqueSurTelephone` les cache sur téléphone.
 *   `disposition="auto"` garde la largeur au contenu, le tableau glissant de côté dans son cadre.
 * - SUR TÉLÉPHONE, un `pile` empile chaque ligne ; sinon le tableau défile de côté DANS son cadre, jamais la page.
 * - LE PIED pagine (10 · 20 · 50) et dit « N sur M » quand un filtre retient des lignes, avec « Effacer les
 *   filtres ». Un tri, un filtre, une taille ou d'autres lignes (par leur SIGNATURE) ramènent en page 1.
 * - LA LIGNE : cliquable en entier (`onLigne`, Entrée aussi), sauf sur un bouton, un lien ou un champ qu'elle
 *   contient ; la ligne choisie (`ligneChoisie`) porte le violet ; elle peut se déplier (`detail`).
 *
 * Repères : `data-tableau` (son nom), `data-tableau-lignes`, `data-tableau-visibles`, `data-tableau-tri`,
 * `data-tri-colonne`, `data-filtre-colonne`, `data-tableau-filtres`, `data-tableau-recherche`,
 * `data-tableau-pied`, `data-page`, `data-taille-page`, `data-effacer-filtres`, `data-ligne-choisie`.
 */
export interface ColonneDuTableauCommun<L> {
  cle: string;
  libelle: React.ReactNode;
  /** La valeur de tri ; sans elle, la colonne ne se trie pas. */
  valeur?: (ligne: L) => ValeurTriable;
  /** Ce que montre la cellule ; par défaut la valeur de tri, ou « — ». */
  rendu?: (ligne: L) => React.ReactNode;
  /** Le genre de filtre de la colonne. */
  filtre?: 'texte' | 'choix';
  /** Ce que le filtre lit ; par défaut la valeur de tri. */
  lireFiltre?: (ligne: L) => ValeurFiltrable;
  /** Le libellé lisible d'une valeur d'un filtre « choix » (« video » → « Vidéo »). */
  libelleDuChoix?: (valeur: string) => string;
  /** Les chiffres se calent à droite, et se trient d'abord du plus grand au plus petit. */
  droite?: boolean;
  sensNaturel?: SensDuTri;
  /** La largeur en pixels (disposition fixe), ou des classes de largeur (« w-24 », disposition auto). */
  largeur?: number | string;
  /** Se retire quand le cadre est étroit. */
  secondaire?: boolean;
  /** Se cache sur téléphone. */
  masqueSurTelephone?: boolean;
  /** Une cellule qui ne coupe pas son contenu (une rangée de boutons). */
  libre?: boolean;
}

/**
 * La largeur au-delà de laquelle un texte de cellule passe à la ligne : un texte court tient sur une ligne entière,
 * une description ne fait pas un tableau de trois écrans de large. Le texte garde sa largeur (`whitespace-nowrap`)
 * tant qu'il tient dessous : jamais « Be… ».
 */
const LARGEUR_MAX_DE_TEXTE = 'max-w-[26rem] whitespace-normal [overflow-wrap:anywhere] [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal';

/** En dessous de cette largeur de cadre, les colonnes secondaires se retirent. */
const LARGEUR_MIN_SECONDAIRES = 760;

const INTERACTIFS = 'a,button,input,select,textarea,label,[role=menu],[role=dialog],[role=button],[data-pas-de-clic-de-ligne]';

/** La place des boutons flottants du bas à droite (terminal, bulle vocale : MEM-7630), sur ordinateur. */
const PLACE_DES_BOUTONS_FLOTTANTS = 132;

/**
 * UN PIED COLLÉ AU BAS DE L'ÉCRAN NE PASSE PLUS SOUS LES BOUTONS FLOTTANTS (carte « Audits SEO et GEO dans le
 * Marketing », 18/11/2026). Depuis que le pied touche le vrai bas de la zone (`useBasDeLaZoneQuiDefile`), la flèche
 * « Page suivante » tombait sous le terminal et la bulle vocale, posés à 16 px du coin bas droit. Quand le pied est au
 * bas de la fenêtre (collé, ou en bout de liste), il réserve à droite ce qu'il faut pour sortir de leur coin — rien
 * ailleurs, ni s'il en est assez loin. Relu au défilement (un nombre : aucun rendu s'il ne bouge pas).
 */
function useReserveDesBoutonsFlottants(pied: HTMLElement | null, actif: boolean): number {
  const [reserve, setReserve] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!pied || !actif) {
      setReserve(0);
      return;
    }
    let zone: HTMLElement | null = pied.parentElement;
    while (zone && zone !== document.body && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
    const laZone = zone && zone !== document.body ? zone : null;
    const mesurer = () => {
      const cadre = pied.getBoundingClientRect();
      const auBas = cadre.bottom >= window.innerHeight - 72;
      setReserve(auBas ? Math.max(0, Math.round(cadre.right - (window.innerWidth - PLACE_DES_BOUTONS_FLOTTANTS))) : 0);
    };
    mesurer();
    const observateur = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mesurer) : null;
    observateur?.observe(pied);
    window.addEventListener('resize', mesurer);
    laZone?.addEventListener('scroll', mesurer, { passive: true });
    return () => {
      observateur?.disconnect();
      window.removeEventListener('resize', mesurer);
      laZone?.removeEventListener('scroll', mesurer);
    };
  }, [pied, actif]);
  return reserve;
}

export function Tableau<L>({
  repere,
  lignes,
  colonnes,
  cle,
  onLigne,
  ligneChoisie,
  pile,
  detail,
  vide,
  sansEntete,
  recherche: avecRecherche,
  triInitial = null,
  pied = 'si-besoin',
  taille: tailleImposee,
  onTaille,
  disposition = 'fixe',
  attributsLigne,
  attributsRacine,
  classeLigne,
  attributsCellule,
  ordreAffiche,
  aere = false,
  rechercheExterne,
  cibleDesOutils,
  grille,
  sansMenuDeTri = false,
  apresLesLignes,
}: {
  /**
   * CE QUI SUIT LES LIGNES, AVANT LE PIED (16/11/2026, « Tableaux de bord », capture #39779) : un bouton « charger la
   * suite », une erreur. Posé SOUS le tableau, il gardait le pied collé à distance du bas de l'écran en bout de liste ;
   * ici, le pied reste le dernier élément et touche le bas de la zone qui défile.
   */
  apresLesLignes?: React.ReactNode;
  /** En cartes, pas de menu de tri (une page qui pose plusieurs tableaux en groupes n'en veut pas un par groupe). */
  sansMenuDeTri?: boolean;
  /**
   * LES LIGNES EN CARTES (carte « Communication et Studio : série de retouches », 12/11/2026, capture #aacc : une
   * liste de campagnes en rangées serrées était illisible). Le CONCEPT de tableau reste — recherche, filtres, TRI par
   * un menu, pagination — mais chaque ligne devient une carte d'une grille (1 colonne sur téléphone). Le rendu de la
   * carte est celui de la page ; le tableau pose le cadre cliquable (fond, sans bordure).
   */
  grille?: (ligne: L) => React.ReactNode;
  /** Où poser le bouton « filtre » du tableau (l'en-tête de la page, à côté de sa loupe) au lieu d'au-dessus de lui. */
  cibleDesOutils?: HTMLElement | null;
  /**
   * DES LIGNES MOINS SERRÉES (carte « Refonte de l'espace Médias », 05/11/2026 : « des colonnes moins compactes pour
   * une meilleure lecture ») : plus de hauteur et de marge par cellule, le texte courant à 13 px. Les colonnes ne
   * changent pas.
   */
  aere?: boolean;
  /**
   * LA RECHERCHE D'ENSEMBLE PILOTÉE DU DEHORS : la page pose sa loupe dans son en-tête (en haut à droite, comme
   * partout) et en donne le texte ici ; le tableau ne pose plus son propre champ au-dessus de lui. Son bouton
   * « filtre » reste avec la loupe, par `outils` (rendu par la page à côté d'elle).
   */
  rechercheExterne?: string;
  /**
   * L'ORDRE AFFICHÉ (filtres, recherche et tri appliqués), écrit à chaque rendu dans cette référence : une fiche
   * ouverte par-dessus passe à la ligne précédente ou suivante DE CE QUE L'ON VOIT (Médias, 03/11/2026).
   */
  ordreAffiche?: React.MutableRefObject<readonly L[] | null>;
  repere: string;
  lignes: readonly L[];
  colonnes: readonly ColonneDuTableauCommun<L>[];
  cle: (ligne: L) => string;
  onLigne?: (ligne: L) => void;
  ligneChoisie?: string | null;
  /** Sur téléphone, le rendu empilé d'une ligne. */
  pile?: (ligne: L) => React.ReactNode;
  /** Le détail d'une ligne dépliée. */
  detail?: (ligne: L) => React.ReactNode;
  /** La phrase d'un tableau sans ligne. */
  vide?: string;
  sansEntete?: boolean;
  /** Une recherche d'ensemble au-dessus du tableau : `true`, ou son texte d'invite. */
  recherche?: boolean | string;
  triInitial?: TriDuTableau | null;
  /** Le pied : toujours (dès qu'il y a des lignes), seulement s'il sert (plus d'une page, un filtre), jamais. */
  pied?: 'toujours' | 'si-besoin' | 'jamais';
  taille?: number;
  onTaille?: (taille: number) => void;
  disposition?: 'fixe' | 'auto';
  attributsLigne?: (ligne: L) => Record<string, string | number | undefined>;
  attributsRacine?: Record<string, string | number | undefined>;
  classeLigne?: (ligne: L) => string | undefined;
  /** Des repères posés sur chaque cellule (`data-colonne`…). */
  attributsCellule?: (colonne: ColonneDuTableauCommun<L>) => Record<string, string | undefined>;
}) {
  const telephone = useTelephone();
  const dansUnePage = useDansUnePageDeService();
  /* DANS UNE PAGE DE SERVICE, LES OUTILS DU TABLEAU (filtre, recherche s'il la porte) MONTENT DANS LA RANGÉE DU TITRE
     (carte « Services homogènes et centrés ») : plus de barre « Filtrer… » au-dessus des lignes. */
  const emplacementDesOutils = useEmplacementDesOutils();
  const outilsEnRangee = !cibleDesOutils && emplacementDesOutils !== undefined;
  const cibleOutils: HTMLElement | null = cibleDesOutils ?? emplacementDesOutils ?? null;
  const [tri, setTri] = React.useState<TriDuTableau | null>(triInitial);
  const [page, setPage] = React.useState(0);
  const [tailleLocale, setTailleLocale] = React.useState<number>(TAILLE_DE_PAGE_PAR_DEFAUT);
  const [ouvertes, setOuvertes] = React.useState<ReadonlySet<string>>(() => new Set());
  const [filtres, setFiltres] = React.useState<FiltresDuTableau>({});
  const [rechercheInterne, setRecherche] = React.useState('');
  const recherche = rechercheExterne ?? rechercheInterne;
  const [rangeeDesFiltres, setRangeeDesFiltres] = React.useState(false);
  const [focusFiltre, setFocusFiltre] = React.useState<string | null>(null);
  const taille = tailleImposee ?? tailleLocale;

  /* LA PLACE SE MESURE : un cadre étroit (une colonne de côté, un petit écran) retire les colonnes secondaires. */
  const racine = React.useRef<HTMLDivElement | null>(null);
  const [largeur, setLargeur] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = racine.current;
    if (!el) return;
    setLargeur(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observateur = new ResizeObserver(([entree]) => setLargeur(entree?.contentRect.width ?? null));
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [telephone, !!pile]);
  const visibles = largeur !== null && largeur < LARGEUR_MIN_SECONDAIRES ? colonnes.filter((c) => !c.secondaire) : colonnes;

  const lecteurs = React.useMemo(() => {
    const sortie: Record<string, (ligne: L) => ValeurFiltrable> = {};
    for (const c of colonnes) {
      const lire = c.lireFiltre ?? c.valeur;
      if (c.filtre && lire) sortie[c.cle] = lire as (ligne: L) => ValeurFiltrable;
    }
    return sortie;
  }, [colonnes]);
  const filtrables = colonnes.filter((c) => c.filtre && lecteurs[c.cle]);
  const nbFiltres = nombreDeFiltresActifs(filtres) + (recherche.trim() ? 1 : 0);

  /* D'autres lignes, un autre filtre : on repart de la première page. La SIGNATURE, et non l'identité du tableau
     reçu : l'écran parent se redessine à chaque événement du démon, et une page ne doit pas sauter pour autant. */
  const signature = `${lignes.length ? `${lignes.length}:${cle(lignes[0]!)}:${cle(lignes[lignes.length - 1]!)}` : '0'}|${signatureDesFiltres(filtres, recherche)}`;
  React.useEffect(() => setPage(0), [signature]);

  /* LA RECHERCHE LIT TOUTES LES COLONNES qui ont une valeur (tri) ou un filtre — pas seulement les filtrables. */
  const lecteursDeRecherche = React.useMemo(() => {
    const sortie: Record<string, (ligne: L) => ValeurFiltrable> = {};
    for (const c of colonnes) {
      const lire = c.lireFiltre ?? c.valeur;
      if (lire) sortie[c.cle] = lire as (ligne: L) => ValeurFiltrable;
    }
    return sortie;
  }, [colonnes]);
  const filtrees = React.useMemo(() => filtrerLesLignes(lignes, filtres, lecteursDeRecherche, recherche), [lignes, filtres, lecteursDeRecherche, recherche]);
  const colonneTriee = tri ? colonnes.find((c) => c.cle === tri.colonne && c.valeur) : undefined;
  const triees = colonneTriee && tri ? trierLesLignes(filtrees, colonneTriee.valeur!, tri.sens) : filtrees;
  if (ordreAffiche) ordreAffiche.current = triees;
  const pagine = pied !== 'jamais';
  const morceau = pagine ? pageDuTableau(triees, page, taille) : { lignes: triees, page: 0, pages: 1, premier: triees.length ? 1 : 0, dernier: triees.length, total: triees.length };
  const nbColonnes = visibles.length;
  const format = formatRegional();

  const trier = (colonne: ColonneDuTableauCommun<L>) => {
    setTri((actuel) => triSuivantDuTableau(actuel, colonne.cle, colonne.sensNaturel ?? (colonne.droite ? 'desc' : 'asc')));
    setPage(0);
  };
  const changerTaille = (n: number) => {
    if (onTaille) onTaille(n);
    else setTailleLocale(n);
    setPage(0);
  };
  const basculer = (id: string) =>
    setOuvertes((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });
  const effacer = () => {
    setFiltres({});
    setRecherche('');
  };
  const ouvrirLeFiltre = (colonne: string) => {
    setRangeeDesFiltres(true);
    setFocusFiltre(colonne);
  };

  const [noeudDuPied, setPied] = React.useState<HTMLDivElement | null>(null);
  const basDuPied = useBasDeLaZoneQuiDefile(noeudDuPied);
  const reserveDroite = useReserveDesBoutonsFlottants(noeudDuPied, !telephone);
  const montrerLePied = lignes.length > 0 && (pied === 'toujours' || (pied === 'si-besoin' && (triees.length > TAILLES_DE_PAGE[0] || nbFiltres > 0)));

  const ouvrirLaLigne = onLigne
    ? (ligne: L) => (event: React.MouseEvent | React.KeyboardEvent) => {
        const cible = event.target as HTMLElement;
        /* LA LIGNE ELLE-MÊME N'EST PAS UN GESTE INTÉRIEUR (03/11/2026) : la rangée empilée du téléphone porte
           `role="button"`, que `INTERACTIFS` compte. `closest` remontait donc jusqu'à elle et chaque appui sur son
           texte était jeté — toutes les lignes de toutes les listes étaient mortes au doigt. Seul un geste posé
           DANS la ligne (bouton, lien, champ, menu) garde son appui pour lui. */
        const interactif = cible.closest(INTERACTIFS);
        if (interactif && interactif !== event.currentTarget && event.currentTarget.contains(interactif)) return;
        if ('key' in event) {
          if (event.key !== 'Enter' || cible !== event.currentTarget) return;
          event.preventDefault();
        }
        onLigne(ligne);
      }
    : null;

  /*
   * LA RECHERCHE ET LE FILTRE, UNE SEULE PILULE (bouton groupé, 03/11/2026) : la recherche à gauche, le bouton filtre
   * à droite, qui ouvre la liste des choix de chaque colonne filtrable (sur téléphone, la feuille du bas commune).
   * Les pastilles de filtre et les sous-onglets des pages y entrent : une page n'a plus qu'une barre d'onglets.
   * La recherche se pose d'elle-même dès qu'un tableau a de quoi chercher (plus de dix lignes) ou un filtre.
   */
  const choixFiltrables = filtrables.filter((c) => c.filtre === 'choix');
  const cocheesDe = (c: ColonneDuTableauCommun<L>) => (filtres[c.cle]?.genre === 'choix' ? (filtres[c.cle] as { valeurs: readonly string[] }).valeurs : []);
  const nbChoixActifs = choixFiltrables.reduce((n, c) => n + cocheesDe(c).length, 0);
  const montrerLaRecherche = avecRecherche ?? (lignes.length > 10 || choixFiltrables.length > 0);
  const boutonFiltre = choixFiltrables.length ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(CLASSE_SEGMENT_DE_GROUPE, 'relative rounded-lg', nbChoixActifs ? 'text-teinte' : 'text-muted')}
          title={t('Filtrer')}
          aria-label="Filtrer"
          data-tableau-bouton-filtre={repere}
          data-filtres-actifs={nbChoixActifs || undefined}
        >
          <Filter className="h-3.5 w-3.5" />
          {nbChoixActifs ? <span className="tabular-nums text-[11.5px]">{nbChoixActifs}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="sm:min-w-[220px]" data-tableau-menu-filtre={repere}>
        {choixFiltrables.map((c) => {
          const lire = lecteurs[c.cle]!;
          const cochees = cocheesDe(c);
          const nom = (v: string) => (c.libelleDuChoix ? c.libelleDuChoix(v) : v);
          return (
            <React.Fragment key={c.cle}>
              <DropdownMenuLabel>{c.libelle}</DropdownMenuLabel>
              {valeursDuChoix(lignes, lire, cochees, format).map((v) => {
                const coche = cochees.includes(v.valeur);
                return (
                  <DropdownMenuItem
                    key={v.valeur}
                    onSelect={(e) => {
                      e.preventDefault();
                      setFiltres((f) => basculerUnChoix(f, c.cle, v.valeur));
                    }}
                    data-tableau-choix-filtre={`${c.cle}:${v.valeur}`}
                    aria-checked={coche}
                  >
                    <CaseACocher checked={coche} onCheckedChange={() => undefined} className="pointer-events-none" aria-label={nom(v.valeur)} />
                    <span className={cn('min-w-0 flex-1 truncate', coche && 'text-teinte')}>{nom(v.valeur)}</span>
                    <span className="tabular-nums text-faint">{v.nombre}</span>
                  </DropdownMenuItem>
                );
              })}
            </React.Fragment>
          );
        })}
        {nbChoixActifs ? (
          <DropdownMenuItem onSelect={() => setFiltres({})} className="mt-1 text-muted" data-effacer-filtres>
            {t('Effacer les filtres')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  const rechercheDansLeTableau = montrerLaRecherche && rechercheExterne === undefined;
  const champDeRecherche =
    rechercheDansLeTableau || boutonFiltre ? (
      /* LE FILTRE DÉCOLLÉ DE LA RECHERCHE (14/11/2026, capture #8de90) : deux contrôles séparés de 8 px, à la même
         hauteur, plus un groupe soudé. */
      <div className={cn('flex min-w-0 items-stretch gap-2 w-full sm:w-auto', !rechercheDansLeTableau && 'ml-auto w-auto')} data-tableau-barre={repere}>
        {rechercheDansLeTableau ? (
          <ChampDeRecherche
            valeur={recherche}
            onChange={setRecherche}
            placeholder={typeof avecRecherche === 'string' ? avecRecherche : t('Filtrer…')}
            className="flex-1 sm:w-72 sm:flex-none"
            data-tableau-recherche={repere}
          />
        ) : null}
        {boutonFiltre}
      </div>
    ) : null;

  /* LE PIED TOUCHE LE BAS DE LA ZONE QUI DÉFILE (capture #7e81, 18/11/2026) : le retrait bas de la zone est rendu en
     décalage négatif (`useBasDeLaZoneQuiDefile`), sinon le pied flottait au-dessus du bord et les lignes passaient dessous. */
  const piedDuTableau = montrerLePied ? (
    /* SUR TÉLÉPHONE, LE PIED A LA TAILLE DES AUTRES COMMANDES (03/11/2026, capture #b6622 : « 10 20 50 » et les flèches
       à 24 px, en caractères de machine à écrire) : 38 px de haut, le texte de l'interface. */
    /* LE PIED RESTE COLLÉ AU BAS DE LA ZONE QUI DÉFILE (carte « Refonte de l'espace Médias », capture #1006) : on lit le
       compte et on change de page sans redescendre au bout de la liste. Son fond est celui qui le porte
       (`--fond-pied-tableau`, posé par un bloc ; sinon le fond de la zone qui défile) — jamais une bande d'une autre
       teinte dans une feuille. Une page dont le pied touche le bas de l'écran réserve à droite la place du bouton vocal
       flottant (`--retrait-droit-pied-tableau`), sinon il recouvre la flèche « Page suivante ». */
    <div
      className="sticky bottom-0 z-[1] flex flex-wrap items-center justify-between gap-2 pb-1.5 pl-1 pr-[max(var(--retrait-droit-pied-tableau,0.25rem),var(--retrait-auto-pied-tableau,0px))] pt-2 text-[13px] text-faint [background:var(--fond-pied-tableau,var(--fond-zone-defilement,hsl(var(--bg))))] sm:text-[12px]"
      data-tableau-pied
      data-pied-colle=""
      ref={setPied}
      style={{ ...(basDuPied ? { bottom: basDuPied } : {}), ...(reserveDroite ? ({ '--retrait-auto-pied-tableau': `${reserveDroite}px` } as React.CSSProperties) : {}) }}
    >
      <span className="flex items-center gap-2 tabular-nums">
        {nbFiltres > 0 ? (
          <>
            <span data-tableau-filtrees={triees.length}>{t('{n} sur {total} lignes', { n: triees.length.toLocaleString(format), total: lignes.length.toLocaleString(format) })}</span>
            <button type="button" onClick={effacer} className="rounded px-1.5 py-0.5 text-muted hover:bg-raised hover:text-text" data-effacer-filtres>
              {t('Effacer les filtres')}
            </button>
          </>
        ) : morceau.pages <= 1 ? (
          /* Une seule page : le compte, pas « 1–1 sur 1 ». */
          t('{n} ligne(s)', { n: morceau.total.toLocaleString(format) })
        ) : (
          t('{v0}–{v1} sur {v2}', { v0: morceau.premier.toLocaleString(format), v1: morceau.dernier.toLocaleString(format), v2: morceau.total.toLocaleString(format) })
        )}
      </span>
      {/* UNE SEULE PAGE, AUCUNE PAGINATION (carte « Audits absents et Sécurité sur mobile », 16/11/2026, capture #ae71 :
          « 1–1 sur 1 », « Lignes 10 20 50 » et deux flèches éteintes pour une ligne) : le choix de taille et les flèches ne
          paraissent que si les lignes dépassent la plus petite page. `pied="toujours"` garde le compte. */}
      {pagine && triees.length > TAILLES_DE_PAGE[0] ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span>{t('Lignes')}</span>
            <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-onglets-barre p-0.5', HAUTEUR_DE_CONTROLE)} role="group">
              {TAILLES_DE_PAGE.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => changerTaille(n)}
                  aria-pressed={taille === n}
                  className={cn('h-[34px] min-w-[38px] rounded-md px-2 text-[13px] tabular-nums transition-colors sm:h-7 sm:min-w-[32px] sm:text-[12px]', taille === n ? 'bg-onglets-actif text-teinte shadow-sm' : 'text-muted hover:text-text')}
                  data-taille-page={n}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {morceau.pages > 1 ? (
            <div className="flex items-center gap-0.5" data-page={`${morceau.page + 1}/${morceau.pages}`}>
              <span data-page-precedente>
                <FlecheDePage sens="precedent" actif={morceau.page > 0} onClick={() => setPage(morceau.page - 1)} libelle={t('Page précédente')} />
              </span>
              <span className="tabular-nums">
                {morceau.page + 1} / {morceau.pages}
              </span>
              <span data-page-suivante>
                <FlecheDePage sens="suivant" actif={morceau.page < morceau.pages - 1} onClick={() => setPage(morceau.page + 1)} libelle={t('Page suivante')} />
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const reperes = {
    'data-tableau': repere,
    'data-tableau-lignes': lignes.length,
    'data-tableau-visibles': triees.length,
    'data-tableau-tri': tri ? `${tri.colonne}:${tri.sens}` : '',
    'data-tableau-aere': aere ? '' : undefined,
    ...(attributsRacine ?? {}),
  };

  if (grille) {
    const triables = colonnes.filter((c) => c.valeur && typeof c.libelle === 'string' && c.libelle);
    const menuDeTri = triables.length && !sansMenuDeTri ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(CLASSE_SEGMENT_DE_GROUPE, 'rounded-lg', tri ? 'text-teinte' : 'text-muted')}
            title={t('Trier')}
            aria-label="Trier"
            data-tableau-bouton-tri={repere}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {colonneTriee ? <span className="text-[12px]">{colonneTriee.libelle}</span> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="sm:min-w-[200px]" data-tableau-menu-tri={repere}>
          {triables.map((c) => {
            const actif = tri?.colonne === c.cle;
            return (
              <DropdownMenuItem key={c.cle} onSelect={() => trier(c)} data-tri-colonne={c.cle} aria-checked={actif}>
                <span className={cn('min-w-0 flex-1 truncate', actif && 'text-teinte')}>{c.libelle}</span>
                {actif ? tri!.sens === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-teinte" /> : <ArrowDown className="h-3.5 w-3.5 text-teinte" /> : null}
              </DropdownMenuItem>
            );
          })}
          {tri ? (
            <DropdownMenuItem onSelect={() => setTri(null)} className="mt-1 text-muted" data-tableau-sans-tri>
              {t('Ordre d’origine')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;
    return (
      <div ref={racine} className="flex min-w-0 flex-col gap-3" data-tableau-grille="" {...reperes}>
        {/* DANS UNE PAGE DE SERVICE, LE TRI DES CARTES MONTE DANS LA RANGÉE DU TITRE, à côté de la bascule (carte
            « Services homogènes et centrés ») : plus aucune ligne de contrôles au-dessus des cartes. Ailleurs, il reste
            au-dessus d'elles, à droite. */}
        {champDeRecherche && !cibleOutils && !outilsEnRangee ? <div className="flex min-w-0 items-center gap-2">{champDeRecherche}</div> : null}
        {champDeRecherche && cibleOutils ? createPortal(champDeRecherche, cibleOutils) : null}
        {menuDeTri ? (
          dansUnePage ? (
            <BasculeDePage>
              <BoutonGroupe className="w-auto">{menuDeTri}</BoutonGroupe>
            </BasculeDePage>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <BoutonGroupe className="ml-auto w-auto">{menuDeTri}</BoutonGroupe>
            </div>
          )
        ) : null}
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-tableau-cartes>
          {morceau.lignes.map((ligne) => {
            const id = cle(ligne);
            const ouvrir = ouvrirLaLigne?.(ligne);
            return (
              <div
                key={id}
                role={onLigne ? 'button' : undefined}
                tabIndex={onLigne ? 0 : undefined}
                onClick={ouvrir ?? undefined}
                onKeyDown={ouvrir ?? undefined}
                className={cn(
                  'flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface text-[13px] text-text transition-colors',
                  onLigne && 'cursor-pointer hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teinte/40',
                  ligneChoisie === id && 'bg-teinte/10',
                  classeLigne?.(ligne),
                )}
                data-ligne-choisie={ligneChoisie === id ? '' : undefined}
                data-ligne-de-tableau={id}
                {...(attributsLigne?.(ligne) ?? {})}
              >
                {grille(ligne)}
              </div>
            );
          })}
        </div>
        {!morceau.lignes.length ? <p className="px-2 py-3 text-[12.5px] text-faint">{nbFiltres ? t('Aucune ligne ne correspond aux filtres.') : (vide ?? t('Rien pour l’instant.'))}</p> : null}
        {apresLesLignes}
        {piedDuTableau}
      </div>
    );
  }

  /*
   * SUR TÉLÉPHONE, LE TABLEAU GARDE SA FORME DE TABLEAU (décision de l'utilisateur du 03/11/2026 : « tout ce qui est
   * des listes doit être sous forme de tableau custom ») : UNE bande d'en-tête contrastée (le nom de la colonne
   * principale, le compte à droite), puis des RANGÉES séparées par un filet — plus jamais une carte par ligne.
   * `pile` ne dit que ce qu'une rangée montre ; la taille du texte est celle du texte courant (13 px), et le titre
   * d'une ligne n'en dépasse jamais la taille (`verif-interface-maison.mjs`).
   */
  if (telephone && pile) {
    const principale = colonnes.find((c) => typeof c.libelle === 'string' && c.libelle && c.cle !== 'apercu') ?? colonnes[0];
    return (
      <div className="flex min-w-0 flex-col" data-empile="oui" data-tableau-telephone {...reperes}>
        {champDeRecherche && cibleOutils ? createPortal(champDeRecherche, cibleOutils) : champDeRecherche && !outilsEnRangee ? <div className="flex pb-2">{champDeRecherche}</div> : null}
        {sansEntete ? null : (
          <div className="flex min-h-[38px] items-center justify-between gap-2 rounded-md bg-tableau-entete px-3 py-1.5 text-[12.5px] font-medium text-muted" data-tableau-entete-telephone>
            <span className="truncate">{principale?.libelle}</span>
            <span className="tabular-nums text-faint">{triees.length.toLocaleString(format)}</span>
          </div>
        )}
        {morceau.lignes.map((ligne) => {
          const id = cle(ligne);
          const ouvrir = ouvrirLaLigne?.(ligne);
          return (
            <div
              key={id}
              role={onLigne ? 'button' : 'row'}
              tabIndex={onLigne ? 0 : undefined}
              onClick={ouvrir ?? undefined}
              onKeyDown={ouvrir ?? undefined}
              className={cn(
                /* Une rangée empilée ne coupe pas non plus son texte : il passe à la ligne (adresse longue d'un site). */
                'flex min-w-0 items-center gap-2.5 border-b border-faint/10 px-2 py-2 text-[13px] leading-snug text-text [overflow-wrap:anywhere] [&>.flex-1:empty]:hidden [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal',
                onLigne && 'cursor-pointer active:bg-raised/60',
                ligneChoisie === id && 'bg-teinte/10',
                classeLigne?.(ligne),
              )}
              data-ligne-choisie={ligneChoisie === id ? '' : undefined}
              data-ligne-de-tableau={id}
              {...(attributsLigne?.(ligne) ?? {})}
            >
              {pile(ligne)}
            </div>
          );
        })}
        {!morceau.lignes.length ? <p className="px-2 py-3 text-[12.5px] text-faint">{nbFiltres ? t('Aucune ligne ne correspond aux filtres.') : (vide ?? t('Rien pour l’instant.'))}</p> : null}
        {apresLesLignes}
        {piedDuTableau}
      </div>
    );
  }

  /*
   * CHAQUE COLONNE A AU MOINS LA LARGEUR DE SON CONTENU (carte « Audits absents et Sécurité sur mobile », 16/11/2026,
   * capture #ae71 : sur téléphone, le nom du projet coupé en « Be… » et « À traiter » tronqué — « toutes les listes
   * doivent avoir des colonnes assez larges pour y lire leur contenu »). Plus de table à largeurs figées : la table
   * prend la largeur de son contenu (`w-max`, au moins celle du cadre), une largeur déclarée devient un MINIMUM, et
   * un texte court ne se coupe plus. Un texte LONG (description, adresse) passe à la ligne au-delà de
   * `LARGEUR_MAX_DE_TEXTE`. Ce qui dépasse le cadre GLISSE DE CÔTÉ, avec un fondu au bord tant qu'il reste à lire.
   * `disposition` n'est plus lue que pour compatibilité.
   */
  void disposition;
  const largeurDe = (c: ColonneDuTableauCommun<L>) => (typeof c.largeur === 'number' ? c.largeur : undefined);

  const table = (
    <table className="w-max min-w-full border-separate border-spacing-0 text-left text-[12.5px]" data-tableau-au-contenu="">
      {sansEntete ? null : (
        <thead>
          <tr className="text-[12.5px] text-faint">
            {visibles.map((colonne, rang) => {
              const actif = tri?.colonne === colonne.cle;
              const filtrable = !!(colonne.filtre && lecteurs[colonne.cle]);
              const filtre = filtrable && filtreActif(filtres[colonne.cle]);
              const classes = cn(
                /* Sur téléphone, l'en-tête a la hauteur des commandes (`TELEPHONE_HAUTEUR_DE_COMMANDE`). */
                /* DES TABLEAUX AÉRÉS PARTOUT (14/11/2026, « aère tous les tableaux qui sont trop compactés, l'entête
                   aussi ») : un en-tête de 44 px au texte gris, sur un fond à peine marqué. */
                'relative h-11 whitespace-nowrap bg-tableau-entete px-3 py-2 font-medium',
                colonne.droite ? 'text-right' : 'text-left',
                rang === 0 && 'rounded-l-md pl-3',
                rang === nbColonnes - 1 && 'rounded-r-md pr-3',
                filtrable && 'pr-6',
                typeof colonne.largeur === 'string' && colonne.largeur,
                colonne.masqueSurTelephone && 'hidden sm:table-cell',
              );
              const minimum = largeurDe(colonne) ? { minWidth: largeurDe(colonne) } : undefined;
              const entonnoir = filtrable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (rangeeDesFiltres && focusFiltre === colonne.cle) setRangeeDesFiltres(false);
                    else ouvrirLeFiltre(colonne.cle);
                  }}
                  aria-label="Filtrer cette colonne"
                  title={t('Filtrer')}
                  aria-pressed={filtre}
                  className={cn('absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-fond-survol hover:text-text', filtre ? 'text-teinte' : 'text-faint')}
                  data-filtre-colonne={colonne.cle}
                  data-filtre-actif={filtre ? '' : undefined}
                >
                  <Filter className="h-3 w-3" />
                </button>
              ) : null;
              if (!colonne.valeur) {
                return (
                  <th key={colonne.cle} scope="col" className={classes} style={minimum} data-colonne={colonne.cle}>
                    <span className="block">{colonne.libelle}</span>
                    {entonnoir}
                  </th>
                );
              }
              return (
                <th key={colonne.cle} scope="col" className={classes} style={minimum} aria-sort={actif ? (tri!.sens === 'asc' ? 'ascending' : 'descending') : 'none'} data-colonne={colonne.cle}>
                  <button
                    type="button"
                    onClick={() => trier(colonne)}
                    /* L'ICÔNE DE TRI SUIT TOUJOURS LE LIBELLÉ SUR TÉLÉPHONE (capture #b6622 : posée avant « Tâches », elle
                       décalait l'en-tête) ; sur ordinateur, une colonne calée à droite la garde à gauche. */
                    className={cn('inline-flex max-w-full items-center gap-1 hover:text-text', colonne.droite && 'sm:flex-row-reverse', actif && 'text-text')}
                    data-tri-colonne={colonne.cle}
                  >
                    <span>{colonne.libelle}</span>
                    {actif ? (
                      tri!.sens === 'asc' ? (
                        <ArrowUp className="h-3 w-3 shrink-0 text-teinte" />
                      ) : (
                        <ArrowDown className="h-3 w-3 shrink-0 text-teinte" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                    )}
                  </button>
                  {entonnoir}
                </th>
              );
            })}
          </tr>
          {rangeeDesFiltres && filtrables.length ? (
            <tr data-tableau-filtres={repere}>
              {visibles.map((colonne, rang) => (
                <th key={colonne.cle} scope="col" className={cn('px-1 pb-1 pt-1 font-normal', rang === 0 && 'pl-2', colonne.masqueSurTelephone && 'hidden sm:table-cell')}>
                  {colonne.filtre && lecteurs[colonne.cle] ? (
                    colonne.filtre === 'texte' ? (
                      <ChampDeFiltre
                        valeur={filtres[colonne.cle]?.genre === 'texte' ? (filtres[colonne.cle] as { texte: string }).texte : ''}
                        onChange={(texte) => setFiltres((f) => ecrireUnTexte(f, colonne.cle, texte))}
                        focus={focusFiltre === colonne.cle}
                        repere={colonne.cle}
                      />
                    ) : (
                      <ChoixDeFiltre
                        valeurs={valeursDuChoix(lignes, lecteurs[colonne.cle]!, filtres[colonne.cle]?.genre === 'choix' ? (filtres[colonne.cle] as { valeurs: readonly string[] }).valeurs : [], format)}
                        cochees={filtres[colonne.cle]?.genre === 'choix' ? (filtres[colonne.cle] as { valeurs: readonly string[] }).valeurs : []}
                        libelle={colonne.libelleDuChoix}
                        onBasculer={(v) => setFiltres((f) => basculerUnChoix(f, colonne.cle, v))}
                        ouvert={focusFiltre === colonne.cle}
                        onOuvrir={(o) => setFocusFiltre(o ? colonne.cle : null)}
                        repere={colonne.cle}
                      />
                    )
                  ) : null}
                </th>
              ))}
            </tr>
          ) : null}
        </thead>
      )}
      <tbody>
        {morceau.lignes.length ? (
          morceau.lignes.map((ligne) => {
            const id = cle(ligne);
            const ouverte = ouvertes.has(id);
            const choisie = ligneChoisie === id;
            const ouvrir = ouvrirLaLigne?.(ligne);
            return (
              <React.Fragment key={id}>
                <tr
                  onClick={ouvrir ?? undefined}
                  onKeyDown={ouvrir ?? undefined}
                  tabIndex={onLigne ? 0 : undefined}
                  className={cn(
                    'group/ligne text-text',
                    onLigne && 'cursor-pointer outline-none focus-visible:bg-raised/60',
                    onLigne && !choisie && 'hover:bg-raised/60',
                    choisie && 'bg-teinte/10',
                    classeLigne?.(ligne),
                  )}
                  data-ligne-choisie={choisie ? '' : undefined}
                  data-ligne-de-tableau={id}
                  {...(attributsLigne?.(ligne) ?? {})}
                >
                  {visibles.map((colonne, rang) => {
                    const brut = colonne.valeur?.(ligne);
                    const contenu = colonne.rendu
                      ? colonne.rendu(ligne)
                      : brut === null || brut === undefined
                        ? '—'
                        : typeof brut === 'number'
                          ? brut.toLocaleString(format)
                          : brut;
                    return (
                      <td
                        key={colonne.cle}
                        className={cn(
                          /* Des lignes hautes, séparées d'un trait fin (14/11/2026). */
                          'border-b border-border align-middle',
                          aere ? 'px-3 py-3.5 text-[13.5px]' : 'px-3 py-3 text-[13px]',
                          colonne.droite ? 'whitespace-nowrap text-right tabular-nums' : colonne.libre ? 'whitespace-nowrap' : '',
                          rang === 0 && 'pl-3',
                          rang === 0 && choisie && 'shadow-[inset_2px_0_0_hsl(var(--teinte))]',
                          rang === nbColonnes - 1 && 'pr-3',
                          colonne.masqueSurTelephone && 'hidden sm:table-cell',
                        )}
                        data-colonne={colonne.cle}
                        {...(attributsCellule?.(colonne) ?? {})}
                      >
                        {rang === 0 && detail ? (
                          <span className={cn('flex items-center gap-1', LARGEUR_MAX_DE_TEXTE)}>
                            <button
                              type="button"
                              onClick={() => basculer(id)}
                              aria-expanded={ouverte}
                              aria-label={ouverte ? 'Replier le detail' : 'Deplier le detail'}
                              title={ouverte ? t('Replier le détail') : t('Déplier le détail')}
                              className="-ml-1 shrink-0 rounded p-1 text-faint hover:bg-raised hover:text-text sm:p-0.5"
                              data-deplier-ligne
                            >
                              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', ouverte && 'rotate-90')} />
                            </button>
                            <span className="min-w-0">{contenu}</span>
                          </span>
                        ) : colonne.droite || colonne.libre ? (
                          contenu
                        ) : (
                          <div className={LARGEUR_MAX_DE_TEXTE} data-cellule-texte="">
                            {contenu}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {detail && ouverte ? (
                  <tr>
                    <td colSpan={nbColonnes} className="border-b border-faint/10 bg-raised/30 px-3 py-2">
                      {detail(ligne)}
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })
        ) : (
          <tr>
            <td colSpan={nbColonnes} className="px-3 py-3 text-[12.5px] text-faint" data-tableau-vide>
              {nbFiltres ? (
                <span className="flex flex-wrap items-center gap-2">
                  {t('Aucune ligne ne correspond aux filtres.')}
                  <button type="button" onClick={effacer} className="rounded px-1.5 py-0.5 text-muted hover:bg-raised hover:text-text" data-effacer-filtres>
                    {t('Effacer les filtres')}
                  </button>
                </span>
              ) : (
                (vide ?? t('Rien pour l’instant.'))
              )}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  const outilsAuDessus = champDeRecherche && cibleOutils ? createPortal(champDeRecherche, cibleOutils) : champDeRecherche && !outilsEnRangee ? <div className="flex pb-2">{champDeRecherche}</div> : null;
  return (
    <div ref={racine} className="min-w-0" {...reperes}>
      {outilsAuDessus}
      <ZoneDefilement axe="horizontal" barre={false} voile hauteur={28} jusquAuBord={false} classeEnveloppe="min-w-0" data-tableau-glisse="">
        {table}
      </ZoneDefilement>
      {apresLesLignes}
      {piedDuTableau}
    </div>
  );
}

function ChampDeFiltre({ valeur, onChange, focus, repere }: { valeur: string; onChange: (v: string) => void; focus: boolean; repere: string }) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <input
      ref={ref}
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('Filtrer…')}
      className="h-7 w-full min-w-0 rounded-md bg-raised px-2 text-[12px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-teinte/50"
      data-champ-filtre={repere}
    />
  );
}

/** LES CASES D'UN FILTRE « CHOIX » : les valeurs présentes, comptées ; une bulle sous le titre, fermée d'un clic dehors. */
function ChoixDeFiltre({
  valeurs,
  cochees,
  libelle,
  onBasculer,
  ouvert,
  onOuvrir,
  repere,
}: {
  valeurs: { valeur: string; nombre: number }[];
  cochees: readonly string[];
  libelle?: (v: string) => string;
  onBasculer: (v: string) => void;
  ouvert: boolean;
  onOuvrir: (ouvert: boolean) => void;
  repere: string;
}) {
  const cadre = React.useRef<HTMLDivElement | null>(null);
  const bulle = React.useRef<HTMLDivElement | null>(null);
  /* LA BULLE VIT DANS UN PORTAIL, en position fixe sous le bouton : le cadre du tableau défile de côté et
     rognerait une bulle posée dedans. */
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!ouvert || !cadre.current) return setPlace(null);
    const r = cadre.current.getBoundingClientRect();
    setPlace({ left: Math.max(8, Math.min(r.left, window.innerWidth - 200)), top: r.bottom + 4 });
  }, [ouvert]);
  React.useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (cadre.current?.contains(cible) || bulle.current?.contains(cible)) return;
      onOuvrir(false);
    };
    const auDefilement = () => onOuvrir(false);
    document.addEventListener('pointerdown', fermer);
    window.addEventListener('resize', auDefilement);
    return () => {
      document.removeEventListener('pointerdown', fermer);
      window.removeEventListener('resize', auDefilement);
    };
  }, [ouvert, onOuvrir]);
  const nom = (v: string) => (libelle ? libelle(v) : v);
  return (
    <div ref={cadre} className="relative min-w-0">
      <button
        type="button"
        onClick={() => onOuvrir(!ouvert)}
        aria-expanded={ouvert}
        className={cn('flex h-7 w-full min-w-0 items-center rounded-md bg-raised px-2 text-left text-[12px]', cochees.length ? 'text-teinte' : 'text-faint')}
        data-choix-filtre={repere}
      >
        <span className="truncate">{cochees.length === 0 ? t('Tout') : cochees.length === 1 ? nom(cochees[0]!) : t('{n} choisis', { n: cochees.length })}</span>
      </button>
      {ouvert && place ? createPortal(
        <div ref={bulle} style={{ left: place.left, top: place.top }} className="fixed z-[80] flex max-h-64 min-w-[180px] flex-col overflow-y-auto rounded-lg bg-raised p-1 shadow-lg" role="listbox" aria-multiselectable data-choix-filtre-bulle={repere}>
          {valeurs.length ? (
            valeurs.map((v) => {
              const coche = cochees.includes(v.valeur);
              return (
                <div key={v.valeur} role="presentation" onClick={() => onBasculer(v.valeur)} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] text-text hover:bg-fond-survol" data-choix-valeur={v.valeur}>
                  <CaseACocher checked={coche} onCheckedChange={() => onBasculer(v.valeur)} aria-label={nom(v.valeur)} />
                  <span className={cn('min-w-0 flex-1 truncate', coche && 'text-teinte')}>{nom(v.valeur)}</span>
                  <span className="tabular-nums text-faint">{v.nombre}</span>
                </div>
              );
            })
          ) : (
            <span className="px-2 py-1 text-[12px] text-faint">{t('Aucune valeur')}</span>
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
