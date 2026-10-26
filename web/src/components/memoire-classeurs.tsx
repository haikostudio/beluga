import * as React from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Compass,
  Download,
  FileCode2,
  FileText,
  GitFork,
  History,
  Info,
  Lightbulb,
  List,
  Loader2,
  MessageSquare,
  MoreVertical,
  Network,
  Pencil,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFINITION_COMPETENCES,
  DEFINITION_TYPE,
  EXPLICATION_CHANGELOG_MAX,
  LIBELLE_TYPE,
  POIDS_CHANGELOG,
  TITRE_CHANGELOG_MAX,
  detailSansSectionsVides,
  ficheDeLUnite,
  fichesDeLaPortee,
  grouperLesUnitesParTheme,
  motsDeRecherche,
  poidsDeLEntree,
  sansAccents,
  sectionsDuDetail,
  titreAffiche,
  titreDeLEntree,
  trierParDateDeCreation,
  uniteCorrespond,
  uniteReprise,
  type EntreeDuChangelog,
  type ThemeDeCategorie,
  type PoidsChangelog,
  type Unite,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Textarea,
  ZoneDefilement,
  CaseACocher,
} from '@/components/ui';
import { SilhouetteCoffre } from '@/components/silhouettes';
import { CranDuFil, GestesDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { ColonneDeService } from '@/components/colonne-de-service';
import { PageDuGraphe, dateDeLElement, type CibleDeLaListe } from '@/components/memoire-graphe';
import { useTelephone } from '@/lib/telephone';
import { Markdown } from '@/lib/markdown';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LA MÉMOIRE — la base de connaissances : le Global, puis un espace par projet.
 *
 * TROIS ZONES COLLÉES, SANS VIDE ENTRE ELLES : à gauche Global puis les projets,
 * au milieu les fiches numérotées de la portée choisie (00_project …
 * 12_lessons) et son changelog, à droite la fiche ouverte : ses unités, chacune
 * avec son type, son importance, son statut, sa source et ses liens. La
 * recherche remplace la liste du milieu par des unités, dans cette portée ou
 * partout.
 *
 * Une unité se CONFIRME (elle quitte « à relire ») ou se DÉPRÉCIE d'un clic, par
 * la même porte d'écriture que les agents ; son historique se déplie. La portée
 * s'exporte en un seul Markdown. Les règles vivent dans
 * `shared/src/connaissances.ts`.
 */

interface Portee {
  id: string;
  nom: string;
  unites: number;
  depreciees: number;
  changelog: number;
}

interface FicheResumee {
  id: string;
  titre: string;
  unites: number;
  depreciees: number;
}

interface EtatDesFiches {
  /** La portée dont ces fiches sont la liste : une réponse d'avant ne s'affiche jamais sous une autre portée. */
  portee: string;
  fiches: FicheResumee[];
  changelog: number | null;
}

interface Version {
  version: number;
  auteur: string;
  motif: string;
  at: number;
}

const ZONE = 'flex min-h-0 min-w-0 flex-col';
/**
 * SUR TÉLÉPHONE, LE TEXTE D'UNE LISTE TOMBE SUR LA MARGE DE LA PAGE (16 px),
 * comme le reste de l'écran : ses lignes ont un retrait intérieur de 10 px pour
 * leur fond de survol, que la zone rattrape en débordant d'autant. Les deux
 * s'additionnaient (22 puis 32 px du bord).
 */
const MARGE_DES_LISTES_AU_TELEPHONE = '-mx-2.5 py-1.5';
const CHANGELOG = 'CHANGELOG';

/** Ce que l'adresse désigne dans la mémoire : un classeur, une fiche, une unité. */
type CibleMemoire = { porteeId?: string | null; ficheId?: string | null; uniteId?: string | null };

/** Les trois pages du téléphone, une par zone de l'ordinateur. */
type PageTelephone = 'portees' | 'fiches' | 'fiche';

/**
 * DEUX VUES (décision de l'utilisateur, 2026-10-20) : le GRAPHE à l'ouverture,
 * sur ordinateur comme sur téléphone, et la LISTE derrière un bouton. Une
 * adresse qui désigne une fiche ou une unité (un lien venu du fil d'un agent)
 * ouvre la liste, sur cette unité.
 */
type VueDeLaMemoire = 'graphe' | 'liste';

/** Les titres de la page ouverte dans une catégorie, pour le fil d'Ariane : le thème, puis l'élément. */
interface LibellesDeLaPage {
  theme?: string;
  unite?: string;
}

export function MemoireClasseurs({
  open,
  onClose,
  enPage,
  vise: cible,
  onVise,
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  /** L'endroit désigné par l'adresse : « #memoire/portee/<id>/fiche/<id>/unite/<id> ». */
  vise?: CibleMemoire;
  /** …et, en sens inverse, ce qui est réellement affiché. */
  onVise?: (cible: CibleMemoire) => void;
}) {
  const [vue, setVue] = React.useState<VueDeLaMemoire>(() => (cible?.ficheId || cible?.uniteId ? 'liste' : 'graphe'));
  /* LE FOCUS DU GRAPHE : la portée mise en avant (« global », un projet), ou la vue d'ensemble. */
  const [focus, setFocus] = React.useState<string | null>(() => (!cible?.ficheId && !cible?.uniteId ? cible?.porteeId ?? null : null));
  const [portees, setPortees] = React.useState<Portee[]>([]);
  const [porteeId, setPorteeId] = React.useState('global');
  const [etat, setEtat] = React.useState<EtatDesFiches | null>(null);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  /* DANS UNE CATÉGORIE, DEUX CRANS DE PLUS : le thème ouvert, puis l'élément lu en page (`vise`). */
  const [themeOuvert, setThemeOuvert] = React.useState<string | null>(null);
  const [libelles, setLibelles] = React.useState<LibellesDeLaPage>({});
  const [depreciees, setDepreciees] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [partout, setPartout] = React.useState(false);
  const [trouvees, setTrouvees] = React.useState<{ unite: Unite; score: number }[] | null>(null);
  const [vise, setVise] = React.useState<string | null>(null);
  /*
   * SUR TÉLÉPHONE : TROIS PAGES SUCCESSIVES, une par zone de l'ordinateur —
   * les portées, puis les sujets de la portée choisie, puis le sujet ouvert.
   * La liste s'ouvre sur les portées, sauf quand l'adresse désigne une unité :
   * on arrive alors directement sur son sujet. La recherche se déplie sur la ligne.
   */
  const telephone = useTelephone();
  const [pageTel, setPageTel] = React.useState<PageTelephone>(() => (cible?.uniteId || cible?.ficheId ? 'fiche' : 'portees'));
  const [rechercheOuverte, setRechercheOuverte] = React.useState(false);
  const erreur =(err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible'));

  const relirePortees = React.useCallback(
    () =>
      client
        .call<{ portees: Portee[] }>({ type: 'memoire.portees' })
        .then((data) => setPortees(data.portees ?? []))
        .catch(erreur),
    [],
  );

  React.useEffect(() => {
    if (open) void relirePortees();
  }, [open, relirePortees]);

  const relireFiches = React.useCallback(() => {
    return client
      .call<Omit<EtatDesFiches, 'portee'>>({ type: 'memoire.fiches', portee: porteeId })
      .then((data) => {
        setEtat({ ...data, portee: porteeId });
        setOuverte((courante) => (courante && (courante === CHANGELOG || data.fiches.some((f) => f.id === courante)) ? courante : data.fiches[0]?.id ?? null));
      })
      .catch(erreur);
  }, [porteeId]);

  React.useEffect(() => {
    if (!open || vue !== 'liste') return;
    setEtat(null);
    void relireFiches();
  }, [open, vue, relireFiches]);

  // La recherche part après une courte pause de frappe : une requête par mot, pas par lettre.
  React.useEffect(() => {
    if (!open) return;
    const demande = recherche.trim();
    if (!demande) {
      setTrouvees(null);
      return;
    }
    const minuteur = window.setTimeout(() => {
      client
        .call<{ trouvees: { unite: Unite; score: number }[] }>({ type: 'memoire.chercher', recherche: demande, portee: partout ? undefined : porteeId })
        .then((data) => setTrouvees(data.trouvees ?? []))
        .catch(erreur);
    }, 250);
    return () => window.clearTimeout(minuteur);
  }, [open, recherche, partout, porteeId]);

  const exporter = () => {
    client
      .call<{ nom: string; markdown: string }>({ type: 'memoire.exporter', portee: porteeId })
      .then(({ nom, markdown }) => {
        const lien = document.createElement('a');
        lien.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
        lien.download = `connaissances-${sansAccents(nom).replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}.md`;
        lien.click();
        window.setTimeout(() => URL.revokeObjectURL(lien.href), 2000);
      })
      .catch(erreur);
  };

  /* Ce que l'écran affiche réellement, en termes d'adresse : le focus du graphe, ou le classeur, la fiche et l'unité de la liste. */
  const affiche: { porteeId: string; ficheId: string | null; uniteId: string | null } =
    vue === 'graphe' ? { porteeId: focus ?? 'global', ficheId: null, uniteId: null } : { porteeId, ficheId: ouverte, uniteId: vise };

  /*
   * L'ADRESSE DE LA MÉMOIRE SUIT TROIS CRANS : le classeur, la fiche, l'unité.
   * Les trois remontent ensemble — changer de classeur change la fiche
   * affichée, les écrire séparément ferait passer l'adresse par un état qui
   * n'a jamais existé à l'écran. Dans le graphe, seul le focus remonte.
   */
  const remonter = React.useRef(onVise);
  remonter.current = onVise;
  /* La cible que l'adresse désigne et qu'on n'a pas encore atteinte : tant
     qu'elle attend, l'écran se tait, sinon il l'effacerait au premier
     affichage — l'endroit visé par un lien serait perdu avant d'être ouvert. */
  const abandonnee = React.useRef<string | null>(null);
  /* Ce que l'écran a remonté en dernier : quand l'adresse le lui renvoie, ce
     n'est que son propre écho, jamais une destination à rejoindre — sinon le
     premier choix d'une autre portée serait aussitôt ramené à l'ancienne. */
  const derniereRemontee = React.useRef<string | null>(null);
  React.useEffect(() => {
    const signature = `${cible?.porteeId ?? ''}|${cible?.ficheId ?? ''}|${cible?.uniteId ?? ''}`;
    const attend =
      abandonnee.current !== signature &&
      derniereRemontee.current !== signature &&
      ((cible?.porteeId && cible.porteeId !== affiche.porteeId) ||
        (cible?.ficheId && cible.ficheId !== affiche.ficheId) ||
        (cible?.uniteId && cible.uniteId !== affiche.uniteId));
    if (attend) return;
    derniereRemontee.current = `${affiche.porteeId}|${affiche.ficheId ?? ''}|${affiche.uniteId ?? ''}`;
    remonter.current?.(affiche);
  }, [affiche.porteeId, affiche.ficheId, affiche.uniteId, cible?.porteeId, cible?.ficheId, cible?.uniteId]);

  /*
   * EN SENS INVERSE : ce qu'un lien désigne se repose ici. Une fiche ou une
   * unité ouvre la LISTE ; une portée seule, dans le graphe, devient son focus.
   * Dans la liste, le classeur d'abord — il commande la liste des fiches —, la
   * fiche ensuite, une fois cette liste arrivée ; l'unité s'ouvre en page.
   *
   * Seule une adresse qui CHANGE, et qui n'est pas l'écho de ce que l'écran
   * vient de remonter, ouvre une poursuite ; la poursuite se referme dès que
   * la destination est atteinte. Hors poursuite, c'est l'utilisateur qui mène.
   */
  const cibleVue = React.useRef<string | null>(null);
  const poursuite = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || !cible) return;
    const signature = `${cible.porteeId ?? ''}|${cible.ficheId ?? ''}|${cible.uniteId ?? ''}`;
    if (cibleVue.current !== signature) {
      cibleVue.current = signature;
      const designe = Boolean(cible.porteeId || cible.ficheId || cible.uniteId);
      poursuite.current = designe && signature !== derniereRemontee.current ? signature : null;
    }
    if (poursuite.current !== signature) return;
    /* Une unité désignée SANS sa fiche (« #memoire/unite/DEC-024 ») : le démon dit où elle vit. */
    if (cible.uniteId && !cible.ficheId) {
      poursuite.current = null;
      client
        .call<{ unite: Unite; fiche: string }>({ type: 'memoire.unite', id: cible.uniteId })
        .then(({ unite, fiche }) => {
          setPorteeId(unite.portee);
          setDepreciees(unite.statut === 'deprecated');
          setOuverte(fiche);
          setThemeOuvert(null);
          setVise(unite.id);
          setPageTel('fiche');
          setVue('liste');
        })
        .catch(() => {
          abandonnee.current = signature;
          client.pushToast('warning', t('Cet élément de mémoire est introuvable.'));
        });
      return;
    }
    if (!cible.ficheId && !cible.uniteId && vue === 'graphe') {
      poursuite.current = null;
      setFocus(cible.porteeId ?? null);
      return;
    }
    if (vue !== 'liste') {
      setVue('liste');
      return;
    }
    if (cible.porteeId && cible.porteeId !== porteeId) {
      setPorteeId(cible.porteeId);
      return;
    }
    if (!etat || etat.portee !== porteeId) return;
    poursuite.current = null;
    if (cible.uniteId && cible.uniteId !== vise) {
      setThemeOuvert(null);
      setVise(cible.uniteId);
    }
    if (!cible.ficheId || cible.ficheId === ouverte) return;
    const connue = cible.ficheId === CHANGELOG || etat.fiches.some((f) => f.id === cible.ficheId);
    if (!connue) {
      abandonnee.current = signature;
      client.pushToast('warning', t('Cette fiche de mémoire n’existe plus dans ce classeur.'));
      return;
    }
    setOuverte(cible.ficheId);
    /* Sur ordinateur, la colonne de gauche descend avec l'adresse : elle montre les sujets du classeur visé. */
    setPageTel('fiche');
  }, [open, cible?.porteeId, cible?.ficheId, cible?.uniteId, porteeId, etat, ouverte, vise, vue]);

  /** Ouvrir une fiche (une catégorie) : on repart de sa liste de thèmes. */
  const ouvrirFiche = (ficheId: string) => {
    setOuverte(ficheId);
    setThemeOuvert(null);
    setVise(null);
  };

  const ouvrirTrouvee = (u: Unite, fiche: string) => {
    if (u.portee !== porteeId) setPorteeId(u.portee);
    setDepreciees(u.statut === 'deprecated');
    setOuverte(fiche);
    setThemeOuvert(null);
    setVise(u.id);
    setRecherche('');
    setPageTel('fiche');
  };

  /** « Ouvrir dans la liste », depuis la fiche flottante du graphe. */
  const ouvrirDepuisLeGraphe = (c: CibleDeLaListe) => {
    setRecherche('');
    setDepreciees(false);
    setPorteeId(c.porteeId);
    setOuverte(c.ficheId ?? null);
    setThemeOuvert(c.theme ?? null);
    setVise(c.uniteId ?? null);
    setPageTel(c.ficheId ? 'fiche' : 'fiches');
    setVue('liste');
  };

  /** Revenir au graphe : la portée lue dans la liste en devient le focus. */
  const versLeGraphe = () => {
    if (pageTel !== 'portees') setFocus(porteeId);
    setRecherche('');
    setRechercheOuverte(false);
    setVue('graphe');
  };

  /** Le cran d'en dessous, dans la page d'une catégorie : l'élément ramène au thème (ou à la catégorie), le thème à la catégorie. */
  const remonterDansLaFiche = (): boolean => {
    if (vise) {
      setVise(null);
      return true;
    }
    if (themeOuvert) {
      setThemeOuvert(null);
      return true;
    }
    return false;
  };

  const portee = portees.find((p) => p.id === porteeId);
  // Tant que les fiches de la portée choisie ne sont pas arrivées, rien de la portée d'avant ne s'affiche.
  const etatCourant = etat?.portee === porteeId ? etat : null;
  const nomDePortee = portee ? (portee.id === 'global' ? t('Global') : portee.nom) : '';
  const ficheCourante = etatCourant?.fiches.find((f) => f.id === ouverte);
  const nomDuSujet = ouverte === CHANGELOG ? t('Changelog') : ficheCourante ? t(ficheCourante.titre) : '';
  const nomDuFocus = focus == null ? '' : focus === 'global' ? t('Global') : portees.find((p) => p.id === focus)?.nom ?? '';

  /* Les listes sont les MÊMES sur ordinateur et dans les pages du téléphone : seul leur cadre change. */
  const listeDesPortees = (apresChoix?: () => void) => (
    <div className="flex flex-col gap-0.5" data-memoire-portees>
      {portees.map((p) => (
        <button
          key={p.id}
          type="button"
          data-memoire-portee={p.id}
          onClick={() => {
            setPorteeId(p.id);
            setOuverte(null);
            setThemeOuvert(null);
            setVise(null);
            apresChoix?.();
          }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-text transition-colors hover:bg-raised',
            telephone && 'py-2.5 text-[14.5px]',
            p.id === porteeId && cn('text-teinte', telephone ? 'bg-raised' : 'bg-ligne-active'),
          )}
        >
          <span className="min-w-0 flex-1 truncate">{p.id === 'global' ? t('Global') : p.nom}</span>
          {/* Les comptes restent lus et mesurés ; dans la colonne ils ne s'affichent plus. */}
          <span className={cn('shrink-0 text-[11.5px] text-faint', !telephone && 'sr-only')}>{p.unites}</span>
        </button>
      ))}
    </div>
  );

  /* DANS LE GRAPHE, LA COLONNE CHOISIT LE FOCUS : la vue d'ensemble, puis le Global et chaque projet. */
  const listeDesFocus = (
    <div className="flex flex-col gap-0.5" data-memoire-portees data-memoire-focus-liste>
      {[{ id: '', nom: t('Vue d’ensemble') }, ...portees.map((p) => ({ id: p.id, nom: p.id === 'global' ? t('Global') : p.nom }))].map((p) => {
        const choisi = (focus ?? '') === p.id;
        return (
          <button
            key={p.id || 'ensemble'}
            type="button"
            data-memoire-focus={p.id}
            {...(p.id ? { 'data-memoire-portee': p.id } : { 'data-memoire-vue-ensemble': '' })}
            aria-current={choisi ? 'true' : undefined}
            onClick={() => setFocus(p.id || null)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-text transition-colors hover:bg-raised',
              !p.id && 'mb-1.5',
              choisi && 'bg-ligne-active text-teinte',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{p.nom}</span>
          </button>
        );
      })}
    </div>
  );

  const listeDesFiches = (apresChoix?: () => void) =>
    !etatCourant ? (
      <SilhouetteCoffre lignes={6} />
    ) : (
      <div className="flex flex-col gap-0.5" data-memoire-fiches={porteeId}>
        {etatCourant.fiches.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              ouvrirFiche(f.id);
              apresChoix?.();
            }}
            data-memoire-fiche={f.id}
            title={definitionsDeLaFiche(porteeId, f.id)
              .map((d) => t(d.texte))
              .join(' ')}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised',
              telephone && 'py-2.5',
              f.id === ouverte && (telephone ? 'bg-raised' : 'bg-ligne-active'),
            )}
          >
            <span className={cn('min-w-0 flex-1 truncate text-[14px]', f.id === ouverte ? 'text-teinte' : f.unites ? 'text-text' : 'text-faint')}>{t(f.titre)}</span>
            <span className="shrink-0 text-[11.5px] text-faint">{f.unites}</span>
          </button>
        ))}
        {etatCourant.changelog != null ? (
          <button
            type="button"
            onClick={() => {
              ouvrirFiche(CHANGELOG);
              apresChoix?.();
            }}
            data-memoire-fiche={CHANGELOG}
            className={cn(
              'mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised',
              telephone && 'py-2.5',
              ouverte === CHANGELOG && cn('text-teinte', telephone ? 'bg-raised' : 'bg-ligne-active'),
            )}
          >
            <History className="h-3.5 w-3.5 shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate text-[14px] text-text">{t('Changelog')}</span>
            <span className="shrink-0 text-[11.5px] text-faint">{etatCourant.changelog}</span>
          </button>
        ) : null}
        {/* Sur téléphone, « Dépréciées » vit dans le menu ⋮ : la liste des sujets ne porte que des sujets. */}
        {telephone ? null : (
          <label className="mt-3 flex items-center gap-2 px-2.5 text-[13px] text-muted">
            <CaseACocher checked={depreciees} onCheckedChange={setDepreciees} data-memoire-depreciees />
            {t('Dépréciées')}
            {portee?.depreciees ? <span className="text-faint">({portee.depreciees})</span> : null}
          </label>
        )}
      </div>
    );

  const detail =
    ouverte == null || !etatCourant ? (
      <div className="px-3 py-3">
        <SilhouetteCoffre lignes={6} />
      </div>
    ) : ouverte === CHANGELOG ? (
      <ChangelogDuProjet key={porteeId} projectId={porteeId} />
    ) : (
      <FicheOuverte
        key={`${porteeId}-${ouverte}-${depreciees}`}
        portee={porteeId}
        ficheId={ouverte}
        depreciees={depreciees}
        theme={themeOuvert}
        uniteId={vise}
        onTheme={(theme) => {
          setThemeOuvert(theme);
          setVise(null);
        }}
        onUnite={setVise}
        onThemeDeLUnite={setThemeOuvert}
        onLibelles={setLibelles}
        onChange={() => {
          void relireFiches();
          void relirePortees();
        }}
      />
    );

  const champDeRecherche = (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <Input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder={partout ? t('Chercher partout…') : t('Chercher dans cette portée…')}
        className="h-9 rounded-lg pl-9 text-[14px]"
        autoComplete="off"
        autoFocus={telephone}
        data-memoire-recherche
      />
    </div>
  );

  const dansLaFiche = pageTel === 'fiche' && ouverte && ouverte !== CHANGELOG;
  /** Où mène la flèche de retour du téléphone : un cran au-dessus. */
  const cranAuDessus: string = vise ? (themeOuvert ? 'theme' : 'categorie') : themeOuvert && dansLaFiche ? 'categorie' : pageTel === 'fiche' ? 'fiches' : 'portees';

  /* ------------------------------------------------------------ */
  /* LE GRAPHE                                                     */
  /* ------------------------------------------------------------ */
  if (vue === 'graphe') {
    return (
      /* LE GRAPHE PREND TOUTE LA ZONE : pas la colonne de lecture centrée d'une page. */
      <Drawer open={open} onClose={onClose} enPage={enPage} className="max-w-none px-0 pt-0 sm:px-0 sm:pt-0">
        <DialogTitle className="sr-only">{t('Mémoire')}</DialogTitle>
        {nomDuFocus && !telephone ? (
          <SuiteDuFil onRacine={() => setFocus(null)}>
            <CranDuFil data-memoire-titre="" data-focus-du-fil="">
              {nomDuFocus}
            </CranDuFil>
          </SuiteDuFil>
        ) : null}
        <GestesDePage>
          {telephone ? (
            <Button variant="ghost" size="icon" className="h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted" aria-label="Liste" title={t('Liste')} onClick={() => setVue('liste')} data-memoire-vers-liste>
              <List className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setVue('liste')} data-memoire-vers-liste>
              <List className="h-3.5 w-3.5" />
              {t('Liste')}
            </Button>
          )}
        </GestesDePage>
        {telephone ? null : (
          <ColonneDeService>
            <ZoneDefilement hauteur={16} className="pb-4 pt-1" data-memoire-zone="portees">
              {listeDesFocus}
            </ZoneDefilement>
          </ColonneDeService>
        )}
        <div className="flex min-h-0 flex-1 flex-col" data-memoire-zones data-memoire-vue="graphe" data-memoire-disposition={telephone ? 'telephone' : 'ordinateur'}>
          <PageDuGraphe focus={focus} onFocus={setFocus} telephone={telephone} onOuvrirDansLaListe={ouvrirDepuisLeGraphe} />
        </div>
      </Drawer>
    );
  }

  /* ------------------------------------------------------------ */
  /* LA LISTE                                                      */
  /* ------------------------------------------------------------ */
  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      <DialogTitle className="sr-only">{t('Mémoire')}</DialogTitle>
      {/* LE FIL D'ARIANE DIT LE CLASSEUR, LA CATÉGORIE, LE THÈME PUIS L'ÉLÉMENT —
          « Mémoire › Beluga › Décisions › Publication » ; chaque cran y ramène.
          SUR TÉLÉPHONE, LA PAGE N'A PLUS DE BARRE À ELLE (demande du 11/10/2026 :
          « éviter les doubles header avec le titre à double ») : le nom de la
          page affichée est le dernier cran de la barre d'en-tête, la flèche de
          retour d'UN cran y prend la place du bouton des projets (`retour`), et
          la recherche dépliée y prend la place du titre. */}
      {telephone && rechercheOuverte ? (
        <SuiteDuFil
          onRacine={() => {
            setRecherche('');
            setRechercheOuverte(false);
          }}
        >
          {champDeRecherche}
        </SuiteDuFil>
      ) : pageTel !== 'portees' && nomDePortee ? (
        <SuiteDuFil
          onRacine={() => setPageTel('portees')}
          retour={{
            action: () => {
              if (dansLaFiche && remonterDansLaFiche()) return;
              setPageTel(pageTel === 'fiche' ? 'fiches' : 'portees');
            },
            reperes: { 'data-memoire-retour': cranAuDessus },
          }}
        >
          <CranDuFil
            dernier={pageTel !== 'fiche' || !nomDuSujet}
            onClick={() => {
              setThemeOuvert(null);
              setVise(null);
              setPageTel('fiches');
            }}
            data-portee-du-fil=""
            {...(pageTel !== 'fiche' || !nomDuSujet ? { 'data-memoire-titre': '' } : {})}
          >
            {nomDePortee}
          </CranDuFil>
          {pageTel === 'fiche' && nomDuSujet ? (
            <CranDuFil
              dernier={!(dansLaFiche && (themeOuvert || vise))}
              onClick={dansLaFiche && (themeOuvert || vise) ? () => ouvrirFiche(ouverte!) : undefined}
              data-sujet-du-fil=""
              {...(!(dansLaFiche && (themeOuvert || vise)) ? { 'data-memoire-titre': '' } : {})}
            >
              {nomDuSujet}
            </CranDuFil>
          ) : null}
          {dansLaFiche && themeOuvert && libelles.theme ? (
            <CranDuFil dernier={!vise} onClick={vise ? () => setVise(null) : undefined} data-theme-du-fil="" {...(!vise ? { 'data-memoire-titre': '' } : {})}>
              {libelles.theme}
            </CranDuFil>
          ) : null}
          {dansLaFiche && vise && libelles.unite ? (
            <CranDuFil data-unite-du-fil="" data-memoire-titre="">
              {libelles.unite}
            </CranDuFil>
          ) : null}
        </SuiteDuFil>
      ) : null}
      {telephone ? (
        /* DEUX ICÔNES DANS LA BARRE, pas une de plus : la loupe (ou la croix qui
           referme la recherche), puis le menu à trois points, qui range tout le
           reste — le retour au graphe compris. */
        <GestesDePage>
          {rechercheOuverte ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted"
              aria-label="Fermer la recherche"
              title={t('Fermer la recherche')}
              data-memoire-fermer-recherche
              onClick={() => {
                setRecherche('');
                setRechercheOuverte(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted"
              aria-label="Chercher"
              title={t('Chercher')}
              data-memoire-ouvrir-recherche
              onClick={() => setRechercheOuverte(true)}
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted" aria-label="Plus d’options" title={t('Plus d’options')} data-memoire-menu>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={versLeGraphe} data-memoire-vers-graphe>
                <Network className="h-3.5 w-3.5" />
                {t('Graphe')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Les deux bascules gardent le menu ouvert : on voit la coche changer. */}
              <DropdownMenuItem
                data-memoire-partout
                data-coche={partout ? 'oui' : 'non'}
                onSelect={(e) => {
                  e.preventDefault();
                  setPartout((v) => !v);
                }}
              >
                <Check className={cn('h-3.5 w-3.5', partout ? 'text-accent' : 'invisible')} />
                {t('Partout')}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-memoire-depreciees
                data-coche={depreciees ? 'oui' : 'non'}
                onSelect={(e) => {
                  e.preventDefault();
                  setDepreciees((v) => !v);
                }}
              >
                <Check className={cn('h-3.5 w-3.5', depreciees ? 'text-accent' : 'invisible')} />
                {t('Dépréciées')}
                {portee?.depreciees ? <span className="text-faint">({portee.depreciees})</span> : null}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exporter} data-memoire-exporter>
                <Download className="h-3.5 w-3.5" />
                {t('Exporter')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </GestesDePage>
      ) : (
        <>
          <GestesDePage>
            <Button variant="ghost" size="sm" onClick={versLeGraphe} data-memoire-vers-graphe>
              <Network className="h-3.5 w-3.5" />
              {t('Graphe')}
            </Button>
            <Button variant="ghost" size="sm" onClick={exporter} data-memoire-exporter>
              <Download className="h-3.5 w-3.5" />
              {t('Exporter')}
            </Button>
          </GestesDePage>
          {/*
           * LES CLASSEURS VIVENT DANS LA COLONNE DE GAUCHE, à la place des
           * projets : d'abord les portées (Global, puis chaque projet) ; en
           * choisir une descend d'un cran, vers ses sujets, et la flèche de la
           * tête remonte. La recherche est en tête de cette colonne ; ses
           * résultats en prennent la place.
           */}
          <ColonneDeService
            niveau={pageTel === 'portees' ? null : { titre: nomDePortee || '…', onRetour: () => setPageTel('portees') }}
          >
            <div className="shrink-0 pb-2 pt-1" data-memoire-entete="ordinateur">
              {champDeRecherche}
              <label className="mt-2 flex items-center gap-2 px-2.5 text-[13px] text-muted">
                <CaseACocher checked={partout} onCheckedChange={setPartout} data-memoire-partout />
                {t('Partout')}
              </label>
            </div>
            <ZoneDefilement hauteur={16} className="pb-4" data-memoire-zone={pageTel === 'portees' && !trouvees ? 'portees' : 'fiches'}>
              {trouvees ? (
                <ListeDesTrouvees trouvees={trouvees} demande={recherche} partout={partout} portees={portees} onOuvrir={ouvrirTrouvee} />
              ) : pageTel === 'portees' ? (
                listeDesPortees(() => setPageTel('fiches'))
              ) : (
                listeDesFiches(() => setPageTel('fiche'))
              )}
            </ZoneDefilement>
          </ColonneDeService>
        </>
      )}
      {telephone ? (
        /*
         * LE TÉLÉPHONE EN TROIS PAGES : une seule zone à la fois, en plein
         * écran — les portées, les sujets de la portée, puis le sujet ouvert
         * (ses thèmes, un thème, un élément). Toucher une ligne avance d'une
         * page ; la flèche de l'entête recule d'un cran. Les résultats d'une
         * recherche prennent la page, et en toucher un ouvre son élément.
         */
        <div className="flex min-h-0 flex-1 flex-col" data-memoire-zones data-memoire-vue="liste" data-memoire-disposition="telephone">
          {trouvees ? (
            <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="fiches" data-memoire-page="trouvees">
              <ZoneDefilement fond="hsl(var(--bg))" className={MARGE_DES_LISTES_AU_TELEPHONE}>
                <ListeDesTrouvees
                  trouvees={trouvees}
                  demande={recherche}
                  partout={partout}
                  portees={portees}
                  onOuvrir={(u, fiche) => {
                    ouvrirTrouvee(u, fiche);
                    setRechercheOuverte(false);
                  }}
                />
              </ZoneDefilement>
            </section>
          ) : pageTel === 'portees' ? (
            <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="portees" data-memoire-page="portees">
              <ZoneDefilement fond="hsl(var(--bg))" className={MARGE_DES_LISTES_AU_TELEPHONE}>
                {listeDesPortees(() => setPageTel('fiches'))}
              </ZoneDefilement>
            </section>
          ) : pageTel === 'fiches' ? (
            <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="fiches" data-memoire-page="fiches">
              <ZoneDefilement fond="hsl(var(--bg))" className={MARGE_DES_LISTES_AU_TELEPHONE}>
                {listeDesFiches(() => setPageTel('fiche'))}
              </ZoneDefilement>
            </section>
          ) : (
            /* Le sujet ouvert garde ses retraits d'ordinateur (`px-3`) : la
               zone les rattrape, pour que son texte tombe sur la marge de la page. */
            <section className={cn(ZONE, '-mx-3 flex-1 bg-bg')} data-memoire-zone="fiche" data-memoire-page="fiche">
              {detail}
            </section>
          )}
        </div>
      ) : (
        /* SUR ORDINATEUR, la zone principale ne montre que le sujet ouvert. */
        <div className="flex min-h-0 flex-1 flex-col" data-memoire-zones data-memoire-vue="liste" data-memoire-disposition="ordinateur">
          <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="fiche">
            {detail}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/** Ce qui entre dans une fiche : la définition de chacun de ses types (une fiche peut en réunir plusieurs). */
function definitionsDeLaFiche(portee: string, ficheId: string): { type: Unite['type']; texte: string }[] {
  const fiche = fichesDeLaPortee(portee).find((f) => f.id === ficheId);
  if (fiche?.competences) return [{ type: 'operation', texte: DEFINITION_COMPETENCES }];
  return (fiche?.types ?? []).map((type) => ({ type, texte: DEFINITION_TYPE[type] }));
}

function ListeDesTrouvees({
  trouvees,
  demande,
  partout,
  portees,
  onOuvrir,
}: {
  trouvees: { unite: Unite; score: number }[];
  demande: string;
  partout: boolean;
  portees: Portee[];
  onOuvrir: (u: Unite, fiche: string) => void;
}) {
  if (!trouvees.length) return <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucune unité ne correspond.')}</p>;
  return (
    <div className="flex flex-col gap-1" data-memoire-trouvees>
      {trouvees.map(({ unite: u }) => (
        <button
          key={u.id}
          type="button"
          onClick={() => onOuvrir(u, ficheDeLUnite(u).id)}
          data-memoire-trouvee={u.id}
          className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 sm:px-2 py-2 sm:py-1.5 text-left transition-colors hover:bg-raised"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
            <span className="font-mono">{u.id}</span>
            <span>{u.importance}</span>
            {partout ? <Badge tone="neutral">{u.portee === 'global' ? t('Global') : portees.find((p) => p.id === u.portee)?.nom ?? u.portee}</Badge> : null}
          </span>
          <span className="w-full text-[13px] leading-snug text-text">
            <Surligne texte={titreAffiche(u)} demande={demande} />
          </span>
        </button>
      ))}
    </div>
  );
}

function Surligne({ texte, demande }: { texte: string; demande: string }) {
  const mots = motsDeRecherche(demande).filter((m) => m.length >= 3);
  if (!mots.length) return <>{texte}</>;
  const bas = sansAccents(texte).toLowerCase();
  const morceaux: React.ReactNode[] = [];
  let i = 0;
  while (i < texte.length) {
    let trouve = -1;
    let longueur = 0;
    for (const mot of mots) {
      const racine = mot.slice(0, Math.max(3, mot.length - 2));
      const j = bas.indexOf(racine, i);
      if (j >= 0 && (trouve < 0 || j < trouve)) {
        trouve = j;
        longueur = racine.length;
      }
    }
    if (trouve < 0) {
      morceaux.push(texte.slice(i));
      break;
    }
    if (trouve > i) morceaux.push(texte.slice(i, trouve));
    morceaux.push(
      <mark key={trouve} className="rounded-sm bg-accent/25 text-text">
        {texte.slice(trouve, trouve + longueur)}
      </mark>,
    );
    i = trouve + longueur;
  }
  return <>{morceaux}</>;
}

/**
 * L'IMPORTANCE DITE EN MOTS. « P0 » ne parle qu'aux agents : l'écran dit
 * « Vital », « Important », « Utile », « À savoir », et garde le code en infobulle.
 */
function importanceLisible(importance: Unite['importance']): { libelle: string; ton: string } {
  switch (importance) {
    case 'P0':
      return { libelle: t('Vital'), ton: 'bg-danger/15 text-danger' };
    case 'P1':
      return { libelle: t('Important'), ton: 'bg-warning/15 text-warning' };
    case 'P2':
      return { libelle: t('Utile'), ton: 'bg-accent/15 text-accent' };
    default:
      return { libelle: t('À savoir'), ton: 'bg-raised text-muted' };
  }
}

/** Combien d'unités un thème déplié monte d'un coup : une catégorie de 600 unités ne fige pas l'écran. */
const PAQUET_DUN_THEME = 30;

interface StyleDeSection {
  libelle: string;
  Icone: LucideIcon;
  fond: string;
  icone: string;
  /** Une section purement technique (les fichiers) quitte la vue principale pour le volet « Détails techniques ». */
  technique?: boolean;
}

/** Chaque section d'un gabarit a son petit bloc : une icône, une couleur douce, un nom traduit. */
function styleDeSection(titre: string): StyleDeSection {
  const doux = (Icone: LucideIcon, ton: 'accent' | 'success' | 'warning' | 'neutre', libelle: string, technique = false): StyleDeSection => ({
    libelle,
    Icone,
    technique,
    fond: ton === 'accent' ? 'bg-accent/10' : ton === 'success' ? 'bg-success/10' : ton === 'warning' ? 'bg-warning/10' : 'bg-bloc',
    icone: ton === 'accent' ? 'text-accent' : ton === 'success' ? 'text-success' : ton === 'warning' ? 'text-warning' : 'text-muted',
  });
  switch (sansAccents(titre).toLowerCase().trim()) {
    case 'role':
      return doux(Target, 'accent', t('Rôle'));
    case 'comportement':
      return doux(Workflow, 'success', t('Comportement'));
    case 'controles':
      return doux(ShieldCheck, 'warning', t('Contrôles'));
    case 'fichiers':
      return doux(FileCode2, 'neutre', t('Fichiers'), true);
    case 'contexte':
      return doux(Compass, 'accent', t('Contexte'));
    case 'decision':
      return doux(Scale, 'success', t('Décision'));
    case 'consequences':
      return doux(GitFork, 'warning', t('Conséquences'));
    case 'entites':
      return doux(Boxes, 'accent', t('Entités'));
    case 'etats':
      return doux(CircleDot, 'success', t('États'));
    case 'transitions':
      return doux(ArrowRightLeft, 'warning', t('Transitions'));
    case 'glossaire':
      return doux(BookOpen, 'neutre', t('Glossaire'));
    default:
      return doux(FileText, 'neutre', titre);
  }
}

/** Combien d'éléments les dernières nouveautés d'une catégorie montrent, en tête de sa page. */
const DERNIERS_AJOUTS = 4;

type DonneesDeLaFiche = { fiche: { id: string; titre: string }; unites: Unite[]; jamaisSupposer?: Unite[] };

/**
 * UNE CATÉGORIE, EN TROIS PAGES (refonte demandée le 2026-10-20 : « aérée, le
 * titre parlant et le code entre parenthèses, triée par date de création ») :
 *
 *  - la CATÉGORIE : ce qui y entre, ses derniers ajouts, puis ses thèmes — les
 *    plus récemment nourris d'abord, chacun avec son nombre et la date de son
 *    dernier ajout ; la recherche en tête aplatit tout en une liste filtrée ;
 *  - le THÈME : ses éléments, les plus récents d'abord ;
 *  - l'ÉLÉMENT : sa page de lecture, avec ses gestes (confirmer, déprécier).
 *
 * Chaque ligne dit « titre clair (MEM-1234) », une phrase et la date. Aucun
 * cadre ni trait : la hiérarchie passe par les fonds et l'air.
 */
function FicheOuverte({
  portee,
  ficheId,
  depreciees,
  theme,
  uniteId,
  onTheme,
  onUnite,
  onThemeDeLUnite,
  onLibelles,
  onChange,
}: {
  portee: string;
  ficheId: string;
  depreciees: boolean;
  /** Le thème ouvert en page, ou `null` : la page de la catégorie. */
  theme: string | null;
  /** L'élément lu en page, ou `null`. */
  uniteId: string | null;
  onTheme: (theme: string) => void;
  onUnite: (id: string) => void;
  /** Un élément ouvert sans son thème (un lien, une recherche) : la page dit à quel thème il appartient. */
  onThemeDeLUnite: (theme: string) => void;
  onLibelles: (libelles: LibellesDeLaPage) => void;
  onChange: () => void;
}) {
  const [donnees, setDonnees] = React.useState<DonneesDeLaFiche | null>(null);
  /*
   * LA RECHERCHE EN TÊTE DE LA CATÉGORIE (demande de l'utilisateur, carte
   * 79083bc5) : dès qu'elle porte du texte, les thèmes laissent place aux seuls
   * éléments qui correspondent, les plus récents d'abord.
   */
  const [filtre, setFiltre] = React.useState('');
  const relire = React.useCallback(
    () =>
      client
        .call<DonneesDeLaFiche>({ type: 'memoire.fiche', portee, ficheId, depreciees })
        .then(setDonnees)
        .catch((err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible'))),
    [portee, ficheId, depreciees],
  );
  React.useEffect(() => {
    void relire();
  }, [relire]);
  // LES THÈMES, LES PLUS RÉCEMMENT NOURRIS D'ABORD : le premier sujet de chaque unité, sujets en double fusionnés.
  const themes = React.useMemo(() => (donnees ? grouperLesUnitesParTheme(donnees.unites, { tri: 'date' }) : []), [donnees]);
  const themeOuvert = theme ? themes.find((th) => th.theme === theme) ?? null : null;
  const unite = uniteId ? donnees?.unites.find((u) => u.id === uniteId) ?? null : null;
  // Un élément ouvert sans son thème : on le retrouve, pour le fil d'Ariane et le retour.
  React.useEffect(() => {
    if (!unite || theme) return;
    const sien = themes.find((th) => th.unites.some((u) => u.id === unite.id));
    if (sien) onThemeDeLUnite(sien.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unite, theme, themes]);
  const libelleDuTheme = themeOuvert ? t(themeOuvert.libelle) : undefined;
  const titreDeLUnite = unite ? titreAffiche(unite) : undefined;
  React.useEffect(() => {
    onLibelles({ theme: libelleDuTheme, unite: titreDeLUnite });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libelleDuTheme, titreDeLUnite]);

  if (!donnees) {
    return (
      <div className="px-3 py-3">
        <SilhouetteCoffre lignes={6} />
      </div>
    );
  }
  const apresUnGeste = () => {
    void relire();
    onChange();
  };

  /* ---- L'ÉLÉMENT, EN PAGE DE LECTURE ---- */
  if (unite) {
    return (
      <ZoneDefilement fond="hsl(var(--bg))" className="px-3 pb-8 sm:px-6" key={unite.id}>
        <LectureDUnite unite={unite} chemin={[t(donnees.fiche.titre), libelleDuTheme].filter(Boolean).join(' · ')} onChange={apresUnGeste} />
      </ZoneDefilement>
    );
  }

  /* ---- UN THÈME : ses éléments, les plus récents d'abord ---- */
  if (themeOuvert) {
    return (
      <>
        <EnteteDePageDeMemoire titre={t(themeOuvert.libelle)} compte={themeOuvert.unites.length} reperes={{ 'data-memoire-theme-ouvert': themeOuvert.theme }}>
          <p className="text-[13px] text-muted">{t('Les plus récents d’abord.')}</p>
        </EnteteDePageDeMemoire>
        <ZoneDefilement fond="hsl(var(--bg))" className="px-1.5 pb-6 sm:px-3.5">
          <ListeDUnites unites={themeOuvert.unites} onUnite={onUnite} reperes={{ 'data-memoire-unites': '', 'data-memoire-recherche-active': 'non' }} />
        </ZoneDefilement>
      </>
    );
  }

  /* ---- LA CATÉGORIE : ses derniers ajouts, puis ses thèmes ---- */
  const tete = ficheId.startsWith('00_');
  const jamais = donnees.jamaisSupposer ?? [];
  const definitions = definitionsDeLaFiche(portee, ficheId);
  const cherche = filtre.trim().length > 0;
  const trouvees = cherche ? trierParDateDeCreation(donnees.unites.filter((u) => uniteCorrespond(u, filtre))) : [];
  const recents = themes.length > 1 && donnees.unites.length > DERNIERS_AJOUTS * 2 ? trierParDateDeCreation(donnees.unites).slice(0, DERNIERS_AJOUTS) : [];
  return (
    <>
      <EnteteDePageDeMemoire titre={t(donnees.fiche.titre)} compte={donnees.unites.length} reperes={{ 'data-memoire-fiche-ouverte': ficheId }}>
        {definitions.length ? (
          <div className="flex flex-col gap-0.5 text-[13px] leading-relaxed text-muted" data-memoire-definition>
            {definitions.map((d) => (
              <p key={d.type}>
                {definitions.length > 1 ? <span className="font-medium text-text">{t(LIBELLE_TYPE[d.type])} — </span> : null}
                {t(d.texte)}
              </p>
            ))}
          </div>
        ) : null}
        {donnees.unites.length ? (
          <div className="relative mt-2 min-w-0 max-w-[520px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              placeholder={t('Chercher dans cette catégorie…')}
              className="h-9 rounded-lg pl-9 pr-9 text-[14px]"
              autoComplete="off"
              data-memoire-filtre
            />
            {filtre ? (
              <button
                type="button"
                onClick={() => setFiltre('')}
                aria-label="Effacer la recherche"
                title={t('Effacer la recherche')}
                className="absolute right-2 top-1/2 flex h-[29px] sm:h-6 w-[29px] sm:w-6 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-muted"
                data-memoire-filtre-effacer
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
        {cherche ? (
          <p className="px-0.5 text-[12.5px] text-faint" data-memoire-filtre-compte={trouvees.length}>
            {trouvees.length ? t('{n} élément(s) trouvé(s)', { n: trouvees.length }) : t('Aucun élément ne correspond.')}
          </p>
        ) : null}
      </EnteteDePageDeMemoire>
      <ZoneDefilement fond="hsl(var(--bg))" className="px-1.5 pb-6 sm:px-3.5">
        <div className="flex flex-col gap-6" data-memoire-unites data-memoire-recherche-active={cherche ? 'oui' : 'non'}>
          {!donnees.unites.length ? <p className="px-1.5 py-3 text-[13px] text-faint">{t('Aucune unité ici pour l’instant.')}</p> : null}
          {cherche ? (
            <ListeDUnites unites={trouvees} onUnite={onUnite} demande={filtre} />
          ) : (
            <>
              {recents.length ? (
                <section className="flex flex-col gap-1" data-memoire-derniers-ajouts>
                  <h3 className="px-3 text-[12.5px] font-medium text-faint">{t('Derniers ajouts')}</h3>
                  <ListeDUnites unites={recents} onUnite={onUnite} />
                </section>
              ) : null}
              {themes.length ? (
                <section className="flex flex-col gap-1" data-memoire-themes>
                  {recents.length ? <h3 className="px-3 text-[12.5px] font-medium text-faint">{t('Thèmes')}</h3> : null}
                  {themes.map((th) => (
                    <LigneDeTheme key={th.theme} theme={th} onOuvrir={() => onTheme(th.theme)} />
                  ))}
                </section>
              ) : null}
            </>
          )}
          {/* « À NE JAMAIS SUPPOSER » PASSE EN DESSOUS : c'est un rappel pour les agents, secondaire pour qui lit. */}
          {tete && jamais.length && !depreciees && !cherche ? (
            <section className="mx-1.5 flex flex-col gap-1.5 rounded-xl bg-bloc px-4 py-3" data-memoire-jamais>
              <h3 className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                {t('À ne jamais supposer')}
                <span className="font-normal text-faint">{jamais.length}</span>
                <BulleInfo cote="start">{t('Les pièges qu’un nouvel agent risquerait de croire : un rappel pour les agents, secondaire pour la lecture.')}</BulleInfo>
              </h3>
              <ul className="flex flex-col gap-1">
                {jamais.map((u) => (
                  <li key={u.id} className="flex min-w-0 gap-2 text-[12.5px] leading-snug text-muted">
                    <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-faint" />
                    <span className="min-w-0 break-words">{titreAffiche(u)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </ZoneDefilement>
    </>
  );
}

/** La tête d'une page de la liste : son titre, son nombre, et ce qui la précise. */
function EnteteDePageDeMemoire({
  titre,
  compte,
  reperes,
  children,
}: {
  titre: string;
  compte: number;
  reperes: Record<`data-${string}`, string>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-3 pb-3 pt-4 sm:px-5" {...reperes}>
      <div className="flex items-baseline gap-2.5">
        <h2 className="min-w-0 break-words text-[18px] font-semibold leading-tight text-text">{titre}</h2>
        <span className="shrink-0 text-[13px] text-faint tabular-nums">{compte}</span>
      </div>
      {children}
    </div>
  );
}

/** La date d'une unité, courte, pour une ligne : « 14 oct. 2026 ». */
function dateCourte(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Un thème d'une catégorie : son nom, son nombre, la date de son dernier ajout. */
function LigneDeTheme({ theme, onOuvrir }: { theme: ThemeDeCategorie<Unite>; onOuvrir: () => void }) {
  const vital = importanceLisible('P0');
  return (
    <button
      type="button"
      onClick={onOuvrir}
      className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-raised"
      data-memoire-theme={theme.theme}
      data-memoire-theme-ouvrir
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-[14.5px] font-medium text-text">{t(theme.libelle)}</span>
        {theme.dernierAjout ? (
          <span className="text-[12.5px] text-faint" data-memoire-theme-date={theme.dernierAjout}>
            {t('Dernier ajout le {date}', { date: dateCourte(theme.dernierAjout) })}
          </span>
        ) : null}
      </span>
      {theme.vitales ? (
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', vital.ton)} title={t('Éléments vitaux')}>
          {theme.vitales}
        </span>
      ) : null}
      <span className="shrink-0 text-[13px] text-muted tabular-nums" data-memoire-theme-compte={theme.unites.length}>
        {theme.unites.length}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  );
}

/** Une liste d'unités en lignes aérées, montées par paquets : un thème de 600 unités ne fige pas l'écran. */
function ListeDUnites({
  unites,
  onUnite,
  demande,
  reperes,
}: {
  unites: readonly Unite[];
  onUnite: (id: string) => void;
  demande?: string;
  reperes?: Record<`data-${string}`, string>;
}) {
  const [montees, setMontees] = React.useState(PAQUET_DUN_THEME);
  const reste = unites.length - montees;
  return (
    <div className="flex flex-col gap-0.5" {...reperes}>
      {unites.slice(0, montees).map((u) => (
        <LigneDUnite key={u.id} unite={u} onOuvrir={() => onUnite(u.id)} demande={demande} />
      ))}
      {reste > 0 ? (
        <Button variant="ghost" size="sm" className="ml-1.5 self-start" onClick={() => setMontees((n) => n + PAQUET_DUN_THEME)} data-memoire-theme-plus>
          {t('Afficher {n} de plus', { n: Math.min(reste, PAQUET_DUN_THEME) })}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * UNE LIGNE D'UNITÉ : « titre clair (MEM-1234) », une phrase, la date. Le
 * résumé replié sur deux lignes interdit le `button` (un texte replié ne s'y
 * pose jamais) : la ligne est une zone cliquable au clavier comme à la souris.
 */
function LigneDUnite({ unite: u, onOuvrir, demande }: { unite: Unite; onOuvrir: () => void; demande?: string }) {
  const vitale = u.importance === 'P0';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOuvrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOuvrir();
        }
      }}
      className="flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-xl px-3 py-3 text-left outline-none transition-colors hover:bg-raised focus-visible:bg-raised"
      data-memoire-unite={u.id}
      data-memoire-ligne={u.id}
      data-memoire-cree-le={u.creeLe}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="min-w-0 flex-1 break-words text-[14.5px] font-medium leading-snug text-text" data-memoire-titre-clair={u.titreHumain ? 'oui' : 'non'}>
          {demande ? <Surligne texte={titreAffiche(u)} demande={demande} /> : titreAffiche(u)}{' '}
          <span className="whitespace-nowrap font-mono text-[12px] font-normal text-faint" data-memoire-code>
            ({u.id})
          </span>
        </span>
        <span className="shrink-0 text-[12px] text-faint" title={uniteReprise(u) ? t('Reprise d’un ancien rangement : sa date est celle de la reprise.') : undefined}>
          {dateCourte(u.creeLe)}
        </span>
      </div>
      <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{u.resume}</p>
      {vitale || u.statut === 'deprecated' ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[11.5px]">
          {vitale ? <span className={cn('rounded-full px-2 py-0.5 font-semibold', importanceLisible('P0').ton)}>{t('Vital')}</span> : null}
          {u.statut === 'deprecated' ? <span className="text-faint">{t('dépréciée')}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * UN ÉLÉMENT, LU EN PAGE : son chemin (catégorie · thème), son titre clair
 * suivi de son code, sa date, sa phrase ; puis son détail en petits blocs
 * illustrés (rôle, comportement, contrôles… ; contexte, décision,
 * conséquences), le raisonnement en encart « Pourquoi c'est important », et
 * tout le technique (fichiers, titre des agents, confiance, source, version)
 * dans un volet discret. Confirmer et déprécier passent par la même porte
 * d'écriture que les agents. L'attribut `hidden` seul ne suffit pas — une
 * classe `flex` le rend visible —, d'où la classe `hidden` posée avec lui.
 */
function LectureDUnite({ unite: u, chemin, onChange }: { unite: Unite; chemin: string; onChange: () => void }) {
  const [technique, setTechnique] = React.useState(false);
  const [versions, setVersions] = React.useState<Version[] | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const erreur = (err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible'));

  const sections = sectionsDuDetail(detailSansSectionsVides(u.detail ?? ''));
  const intro = sections
    .filter((s) => s.titre === null)
    .map((s) => s.texte)
    .join('\n\n');
  const blocs = sections.filter((s): s is { titre: string; texte: string } => s.titre !== null && Boolean(s.texte)).map((s) => ({ ...s, style: styleDeSection(s.titre) }));
  const visibles = blocs.filter((b) => !b.style.technique);
  const techniques = blocs.filter((b) => b.style.technique);
  const importance = importanceLisible(u.importance);

  const geste = (type: 'memoire.deprecier', message: string) => {
    setEnCours(true);
    client
      .call({ type, id: u.id })
      .then(() => {
        client.pushToast('success', message);
        onChange();
      })
      .catch(erreur)
      .finally(() => setEnCours(false));
  };

  const basculerHistorique = () => {
    if (versions) return setVersions(null);
    client
      .call<{ versions: Version[] }>({ type: 'memoire.unite', id: u.id })
      .then((data) => setVersions(data.versions ?? []))
      .catch(erreur);
  };

  return (
    <article className="mx-auto flex w-full max-w-[780px] flex-col gap-4 pt-4 text-[14px]" data-memoire-unite={u.id} data-memoire-lecture={u.id} data-ouverte="oui">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate pt-1 text-[12.5px] text-faint">{chemin}</p>
          {/* AUCUN « CONFIRMER » (décision du 20/10/2026) : l'écran ne demande
              jamais de valider ce qu'un agent a écrit. Les unités peu sûres sont
              relues par le système lui-même (`relecture-memoire.ts`). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-[34px] sm:h-7 w-[34px] sm:w-7 shrink-0 p-0" aria-label="Plus d’options" title={t('Plus d’options')} data-memoire-unite-menu>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={basculerHistorique} data-memoire-historique-bouton>
                <History className="h-3.5 w-3.5" />
                {t('Historique')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTechnique((v) => !v)} data-memoire-technique-menu>
                <Info className="h-3.5 w-3.5" />
                {t('Détails techniques')}
              </DropdownMenuItem>
              {u.statut === 'active' ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => geste('memoire.deprecier', t('Unité dépréciée'))} disabled={enCours} data-memoire-deprecier>
                    <XCircle className="h-3.5 w-3.5" />
                    {t('Déprécier')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* LE TITRE CLAIR D'ABORD (écrit pour la personne), son code entre parenthèses ; le titre des agents passe dans les détails techniques. */}
        <h2 className="break-words text-[21px] font-semibold leading-snug text-text" data-memoire-titre-clair={u.titreHumain ? 'oui' : 'non'} data-memoire-deplier>
          {titreAffiche(u)} <span className="whitespace-nowrap font-mono text-[14px] font-normal text-faint">({u.id})</span>
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-faint">
          {/* L'importance, dite en mots. */}
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', importance.ton)} title={u.importance} data-memoire-importance={u.importance}>
            {importance.libelle}
          </span>
          <span data-memoire-date>{dateDeLElement(u.creeLe, uniteReprise(u))}</span>
          {u.statut === 'deprecated' ? <span>{t('dépréciée')}</span> : null}
          {u.supersededBy ? <span>{t('Remplacée par {id}', { id: u.supersededBy })}</span> : null}
        </p>
        <p className="text-[15px] leading-relaxed text-muted" data-memoire-resume>
          {u.resume}
        </p>
      </div>
      <div className="flex flex-col gap-3" data-memoire-unite-detail>
        {intro ? <Markdown content={intro.replace(/^### /gm, '#### ')} /> : null}
        {visibles.length ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-memoire-blocs>
            {visibles.map((b) => {
              const { Icone } = b.style;
              return (
                <section key={b.titre} className={cn('flex min-w-0 flex-col gap-1.5 rounded-xl px-4 py-3', b.style.fond, visibles.length % 2 === 1 && b === visibles.at(-1) && 'sm:col-span-2')} data-memoire-bloc={b.titre}>
                  <span className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', b.style.icone)}>
                    <Icone className="h-3.5 w-3.5 shrink-0" />
                    {b.style.libelle}
                  </span>
                  {/* Le Markdown pose ses paragraphes en 14 px : dans un petit bloc, ils reprennent une taille de lecture. */}
                  <div className="min-w-0 text-[13.5px] text-text [&_div]:text-[13.5px] [&_span]:text-[13.5px]">
                    <Markdown content={b.texte.replace(/^### /gm, '#### ')} />
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
        {u.raisonnement ? (
          <aside className="flex gap-2.5 rounded-xl bg-warning/10 px-4 py-3" data-memoire-pourquoi>
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-col gap-1 text-[13.5px] [&_div]:text-[13.5px] [&_span]:text-[13.5px]">
              <span className="text-[12.5px] font-semibold text-warning">{t('Pourquoi c’est important')}</span>
              <Markdown content={u.raisonnement} />
            </div>
          </aside>
        ) : null}
        <button
          type="button"
          onClick={() => setTechnique((v) => !v)}
          aria-expanded={technique}
          className="flex items-center gap-1 self-start text-[12px] text-faint transition-colors hover:text-muted"
          data-memoire-technique-bascule
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', technique && 'rotate-90')} />
          {t('Détails techniques')}
        </button>
        <div hidden={!technique} className={cn('flex flex-col gap-1.5 rounded-lg bg-bloc px-3 py-2.5 text-[12px] text-faint', !technique && 'hidden')} data-memoire-technique>
          {techniques.map((b) => (
            <div key={b.titre} className="flex min-w-0 flex-col gap-0.5 text-[12px]">
              <span className="font-medium text-muted">{b.style.libelle}</span>
              <Markdown content={b.texte} />
            </div>
          ))}
          {u.titreHumain ? (
            <p className="break-words" data-memoire-titre-agents>
              {t('Titre pour les agents : {titre}', { titre: u.titre })}
            </p>
          ) : null}
          <p className="break-words">
            {[
              u.id,
              t(LIBELLE_TYPE[u.type]),
              t('confiance {c}', { c: String(u.confiance).replace('.', ',') }),
              t('source : {s}', { s: `${u.source.genre}${u.source.ref ? ` ${u.source.ref}` : ''}` }),
              u.sujets.length ? u.sujets.join(', ') : '',
              u.supersedes ? t('Remplace {id}', { id: u.supersedes }) : '',
              u.liens.length ? t('Liens : {l}', { l: u.liens.join(', ') }) : '',
              t('version {v}', { v: u.version }),
              new Date(u.modifieLe).toLocaleDateString(),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {versions ? (
          <div className="flex flex-col gap-0.5 rounded-lg bg-bloc px-3 py-2 text-[12px] text-faint" data-memoire-historique>
            {!versions.length ? (
              <span>{t('Aucune version précédente.')}</span>
            ) : (
              versions.map((v) => (
                <span key={`${v.version}-${v.at}`} className="break-words">
                  {t('version {v}', { v: v.version })} · {new Date(v.at).toLocaleString()} · {v.auteur || '—'} · {v.motif}
                </span>
              ))
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Le poids d'une entrée, dit en mots de l'interface. */
function libelleDuPoids(poids: PoidsChangelog): string {
  switch (poids) {
    case 'grande-nouveaute':
      return t('Grande nouveauté');
    case 'amelioration':
      return t('Amélioration');
    case 'correction':
      return t('Correction');
    case 'retrait':
      return t('Retrait');
    default:
      return t('Détail');
  }
}

/** Une couleur par poids, en jetons du thème. */
const TON_DU_POIDS: Record<PoidsChangelog, string> = {
  'grande-nouveaute': 'bg-accent/15 text-accent',
  amelioration: 'bg-success/15 text-success',
  correction: 'bg-warning/15 text-warning',
  retrait: 'bg-danger/15 text-danger',
  detail: 'bg-raised text-muted',
};

const ORDRE_DU_POIDS: Record<PoidsChangelog, number> = { 'grande-nouveaute': 0, amelioration: 1, correction: 2, retrait: 3, detail: 4 };

/**
 * LE JOURNAL DES CHANGEMENTS RACONTE. Chaque journée montre d'abord ses grandes
 * nouveautés en cartes mises en valeur, puis les améliorations, corrections et
 * retraits en lignes qui se déplient sur leur explication, et replie les détails
 * en bas. Aucun nom de branche dans la vue. Un filtre ne garde que les grandes
 * nouveautés ; chaque entrée ouvre sa carte d'origine et se corrige à la main.
 */
function ChangelogDuProjet({ projectId }: { projectId: string }) {
  const [donnees, setDonnees] = React.useState<{ entrees: EntreeDuChangelog[]; total: number } | null>(null);
  const [seulesGrandes, setSeulesGrandes] = React.useState(false);
  React.useEffect(() => {
    client
      .call<{ entrees: EntreeDuChangelog[]; total: number }>({ type: 'memoire.changelog', projectId })
      .then(setDonnees)
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible')));
  }, [projectId]);
  const onCorrigee = React.useCallback((entree: EntreeDuChangelog) => {
    setDonnees((d) => (d ? { ...d, entrees: d.entrees.map((x) => (x.id === entree.id ? entree : x)) } : d));
  }, []);
  const grandes = React.useMemo(() => (donnees?.entrees ?? []).filter((e) => poidsDeLEntree(e) === 'grande-nouveaute').length, [donnees]);
  const parJour = React.useMemo(() => {
    const carte = new Map<string, EntreeDuChangelog[]>();
    for (const e of donnees?.entrees ?? []) {
      if (seulesGrandes && poidsDeLEntree(e) !== 'grande-nouveaute') continue;
      carte.set(e.jour, [...(carte.get(e.jour) ?? []), e]);
    }
    return [...carte];
  }, [donnees, seulesGrandes]);
  if (!donnees) {
    return (
      <div className="px-3 py-3">
        <SilhouetteCoffre lignes={6} />
      </div>
    );
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5" data-memoire-fiche-ouverte={CHANGELOG}>
        <History className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">{t('Changelog')}</span>
        <span className="hidden text-[11.5px] text-faint sm:inline">{t('{n} entrées', { n: donnees.total })}</span>
        <button
          type="button"
          onClick={() => setSeulesGrandes((v) => !v)}
          aria-pressed={seulesGrandes}
          title={t('Grandes nouveautés seulement')}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-3 sm:px-2.5 py-1.5 sm:py-1 text-[12px] font-medium transition-colors',
            seulesGrandes ? 'bg-accent/15 text-accent' : 'bg-raised text-muted hover:text-text',
          )}
          data-memoire-changelog-filtre
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('Grandes nouveautés seulement')}</span>
          <span className={cn('tabular-nums', seulesGrandes ? 'text-accent' : 'text-faint')}>{grandes}</span>
        </button>
      </div>
      <ZoneDefilement fond="hsl(var(--bg))" className="px-3 pb-4">
        {!parJour.length ? (
          <p className="py-3 text-[12.5px] text-faint" data-memoire-changelog-vide>
            {seulesGrandes ? t('Aucune grande nouveauté pour l’instant.') : t('Changelog vide pour l’instant.')}
          </p>
        ) : (
          <div className="flex flex-col gap-6 text-[13px]" data-memoire-changelog>
            {parJour.map(([jour, entrees]) => (
              <JourneeDuChangelog key={jour} projectId={projectId} jour={jour} entrees={entrees} onCorrigee={onCorrigee} />
            ))}
          </div>
        )}
      </ZoneDefilement>
    </>
  );
}

interface PorteeDEntree {
  projectId: string;
  onCorrigee: (entree: EntreeDuChangelog) => void;
}

function JourneeDuChangelog({ jour, entrees, projectId, onCorrigee }: { jour: string; entrees: EntreeDuChangelog[] } & PorteeDEntree) {
  const [details, setDetails] = React.useState(false);
  const pesees = entrees.map((e) => ({ e, poids: poidsDeLEntree(e) })).sort((a, b) => ORDRE_DU_POIDS[a.poids] - ORDRE_DU_POIDS[b.poids]);
  const grandes = pesees.filter((x) => x.poids === 'grande-nouveaute');
  const courantes = pesees.filter((x) => x.poids !== 'grande-nouveaute' && x.poids !== 'detail');
  const menues = pesees.filter((x) => x.poids === 'detail');
  const date = new Date(`${jour}T12:00:00`);
  const dateLisible = Number.isNaN(date.getTime()) ? jour : date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <section className="flex flex-col gap-2" data-memoire-changelog-jour={jour}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 truncate first-letter:uppercase" title={jour}>
          {dateLisible}
        </span>
        <span className="min-w-0 flex-1" />
        {entrees.some((e) => e.publication) ? (
          <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success" data-memoire-changelog-publiee>
            {t('publiée')}
          </span>
        ) : null}
      </h3>
      {grandes.map(({ e }) => (
        <GrandeNouveaute key={e.id ?? `${e.jour}-${e.texte}`} entree={e} projectId={projectId} onCorrigee={onCorrigee} />
      ))}
      {courantes.length ? (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg">
          {courantes.map(({ e, poids }) => (
            <EntreeDepliable key={e.id ?? `${e.jour}-${e.texte}`} entree={e} poids={poids} projectId={projectId} onCorrigee={onCorrigee} />
          ))}
        </ul>
      ) : null}
      {menues.length ? (
        <div className="flex flex-col gap-1" data-memoire-changelog-details>
          <button
            type="button"
            onClick={() => setDetails((v) => !v)}
            aria-expanded={details}
            className="flex items-center gap-1 self-start text-[12px] text-faint transition-colors hover:text-muted"
            data-memoire-changelog-details-bascule
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', details && 'rotate-90')} />
            {menues.length > 1 ? t('{n} détails', { n: menues.length }) : t('1 détail')}
          </button>
          <ul hidden={!details} className={cn('flex flex-col gap-px overflow-hidden rounded-lg', !details && 'hidden')}>
            {menues.map(({ e, poids }) => (
              <EntreeDepliable key={e.id ?? `${e.jour}-${e.texte}`} entree={e} poids={poids} projectId={projectId} onCorrigee={onCorrigee} menue />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function GrandeNouveaute({ entree: e, projectId, onCorrigee }: { entree: EntreeDuChangelog } & PorteeDEntree) {
  const [enCorrection, setEnCorrection] = React.useState(false);
  return (
    <article className="flex flex-col gap-1 rounded-xl bg-accent/10 px-3.5 py-3" data-memoire-changelog-entree={e.id ?? ''}data-memoire-changelog-poids="grande-nouveaute">
      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        {t('Grande nouveauté')}
      </span>
      {enCorrection ? (
        <EditeurDEntree
          entree={e}
          projectId={projectId}
          onFini={(corrigee) => {
            setEnCorrection(false);
            if (corrigee) onCorrigee(corrigee);
          }}
        />
      ) : (
        <>
          <h4 className="break-words text-[15px] font-semibold leading-snug text-text">{titreDeLEntree(e)}</h4>
          {e.explication ? <p className="break-words leading-relaxed text-text">{e.explication}</p> : null}
          <ActionsDEntree entree={e} onCorriger={() => setEnCorrection(true)} />
        </>
      )}
    </article>
  );
}

function EntreeDepliable({ entree: e, poids, projectId, onCorrigee, menue }: { entree: EntreeDuChangelog; poids: PoidsChangelog; menue?: boolean } & PorteeDEntree) {
  const [ouverte, setOuverte] = React.useState(false);
  const [enCorrection, setEnCorrection] = React.useState(false);
  return (
    <li className={cn('flex flex-col', menue ? 'bg-transparent' : 'bg-surface')} data-memoire-changelog-entree={e.id ?? ''}data-memoire-changelog-poids={poids}>
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        className={cn('flex w-full min-w-0 items-start gap-2.5 text-left transition-colors hover:bg-raised', menue ? 'rounded px-2.5 sm:px-2 py-1.5 sm:py-1' : 'px-3.5 sm:px-3 py-2')}
      >
        {menue ? null : <span className={cn('mt-px w-[6.5rem] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-medium', TON_DU_POIDS[poids])}>{libelleDuPoids(poids)}</span>}
        <span className={cn('min-w-0 flex-1 break-words', menue ? 'text-[12.5px] leading-snug text-muted' : 'leading-relaxed text-text')}>{titreDeLEntree(e)}</span>
        <ChevronDown className={cn('mt-1 h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouverte && 'rotate-180')} />
      </button>
      <div hidden={!ouverte} className={cn('flex flex-col gap-1.5 pb-2.5', menue ? 'px-2' : 'px-3 sm:pl-[9.25rem]', !ouverte && 'hidden')}>
        {enCorrection ? (
          <EditeurDEntree
            entree={e}
            projectId={projectId}
            onFini={(corrigee) => {
              setEnCorrection(false);
              if (corrigee) onCorrigee(corrigee);
            }}
          />
        ) : (
          <>
            {e.explication ? (
              <p className="break-words leading-relaxed text-muted" data-memoire-changelog-explication>
                {e.explication}
              </p>
            ) : null}
            <ActionsDEntree entree={e} onCorriger={() => setEnCorrection(true)} />
          </>
        )}
      </div>
    </li>
  );
}

/** Ouvrir la conversation de la carte d'origine, et corriger l'entrée à la main. */
function ActionsDEntree({ entree: e, onCorriger }: { entree: EntreeDuChangelog; onCorriger: () => void }) {
  const carte = e.carte;
  return (
    <div className="-ml-2 flex flex-wrap items-center gap-1" data-memoire-changelog-actions>
      {carte ? (
        <Button size="sm" variant="ghost" className="h-[34px] sm:h-7 gap-1.5 px-2 text-[12px]" onClick={() => client.openCard(carte.id)} title={carte.titre} data-memoire-changelog-carte={carte.id}>
          <MessageSquare className="h-3.5 w-3.5" />
          {t('Ouvrir la carte')}
        </Button>
      ) : null}
      {e.id != null ? (
        <Button size="sm" variant="ghost" className="h-[34px] sm:h-7 gap-1.5 px-2 text-[12px]" onClick={onCorriger} data-memoire-changelog-corriger>
          <Pencil className="h-3.5 w-3.5" />
          {t('Corriger')}
        </Button>
      ) : null}
      {e.corrigee ? <span className="px-1 text-[11px] text-faint" data-memoire-changelog-corrigee>{t('corrigée à la main')}</span> : null}
    </div>
  );
}

/** Le titre, l'explication et le poids d'une entrée, réécrits à la main : la correction fait foi. */
function EditeurDEntree({ entree: e, projectId, onFini }: { entree: EntreeDuChangelog; projectId: string; onFini: (corrigee?: EntreeDuChangelog) => void }) {
  const [titre, setTitre] = React.useState(titreDeLEntree(e));
  const [explication, setExplication] = React.useState(e.explication ?? '');
  const [poids, setPoids] = React.useState<PoidsChangelog>(poidsDeLEntree(e));
  const [enCours, setEnCours] = React.useState(false);
  const enregistrer = () => {
    if (e.id == null || !titre.trim()) return;
    setEnCours(true);
    client
      .call<{ entree: EntreeDuChangelog }>({ type: 'memoire.changelog.corriger', projectId, id: e.id, titre, explication, poids })
      .then(({ entree }) => {
        client.pushToast('success', t('Entrée corrigée'));
        onFini(entree);
      })
      .catch((err: any) => {
        client.pushToast('error', err?.message ?? t('Mémoire illisible'));
        setEnCours(false);
      });
  };
  return (
    <form
      className="flex flex-col gap-2 py-1"
      onSubmit={(ev) => {
        ev.preventDefault();
        enregistrer();
      }}
      data-memoire-changelog-editeur
    >
      <Input value={titre} onChange={(ev) => setTitre(ev.target.value)} maxLength={TITRE_CHANGELOG_MAX} placeholder={t('Titre')} className="bg-surface" autoFocus data-memoire-changelog-editeur-titre />
      <Textarea
        value={explication}
        onChange={(ev) => setExplication(ev.target.value)}
        maxLength={EXPLICATION_CHANGELOG_MAX}
        rows={3}
        placeholder={t('Explication')}
        className="bg-surface text-[13px]"
        data-memoire-changelog-editeur-explication
      />
      <div className="flex flex-wrap gap-1" role="radiogroup" title={t('Importance')}>
        {POIDS_CHANGELOG.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={poids === p}
            onClick={() => setPoids(p)}
            className={cn('rounded px-2.5 sm:px-2 py-1.5 sm:py-1 text-[11.5px] font-medium transition-colors', poids === p ? TON_DU_POIDS[p] : 'text-faint hover:bg-raised hover:text-muted')}
            data-memoire-changelog-editeur-poids={p}
          >
            {libelleDuPoids(p)}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onFini()} disabled={enCours}>
          {t('Annuler')}
        </Button>
        <Button type="submit" size="sm" disabled={enCours || !titre.trim()} data-memoire-changelog-editeur-enregistrer>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('Enregistrer')}
        </Button>
      </div>
    </form>
  );
}
