import * as React from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Compass,
  Download,
  FileCode2,
  FileText,
  GitFork,
  History,
  Info,
  Library,
  Lightbulb,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pencil,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  Workflow,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFINITION_TYPE,
  EXPLICATION_CHANGELOG_MAX,
  LIBELLE_TYPE,
  POIDS_CHANGELOG,
  TITRE_CHANGELOG_MAX,
  detailSansSectionsVides,
  fichesDeLaPortee,
  motsDeRecherche,
  poidsDeLEntree,
  sansAccents,
  sectionsDuDetail,
  titreDeLEntree,
  type EntreeDuChangelog,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Textarea,
  ZoneDefilement,
} from '@/components/ui';
import { SilhouetteCoffre } from '@/components/silhouettes';
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
 * se RÉGÉNÈRE par un modèle (le rapport s'affiche quand le lot est importé) et
 * s'exporte en un seul Markdown. Les règles vivent dans
 * `shared/src/connaissances.ts`.
 */

interface Portee {
  id: string;
  nom: string;
  unites: number;
  depreciees: number;
  changelog: number;
  aRelire: number;
}

interface FicheResumee {
  id: string;
  titre: string;
  unites: number;
  depreciees: number;
}

interface Rapport {
  creees: number;
  fusionnees: number;
  dejaLa: number;
  refusees: { titre: string; raisons: string[] }[];
  at: number;
}

interface EtatDesFiches {
  /** La portée dont ces fiches sont la liste : une réponse d'avant ne s'affiche jamais sous une autre portée. */
  portee: string;
  fiches: FicheResumee[];
  changelog: number | null;
  rapport: Rapport | null;
  generation: { depuis: number; journal: string[] } | null;
}

interface Version {
  version: number;
  auteur: string;
  motif: string;
  at: number;
}

const ZONE = 'flex min-h-0 min-w-0 flex-col';
const CHANGELOG = 'CHANGELOG';

/** Ce que l'adresse désigne dans la mémoire : un classeur, une fiche, une unité. */
type CibleMemoire = { porteeId?: string | null; ficheId?: string | null; uniteId?: string | null };

/** Les trois pages du téléphone, une par zone de l'ordinateur. */
type PageTelephone = 'portees' | 'fiches' | 'fiche';

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
  const [portees, setPortees] = React.useState<Portee[]>([]);
  const [porteeId, setPorteeId] = React.useState('global');
  const [etat, setEtat] = React.useState<EtatDesFiches | null>(null);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const [depreciees, setDepreciees] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [partout, setPartout] = React.useState(false);
  const [trouvees, setTrouvees] = React.useState<{ unite: Unite; score: number }[] | null>(null);
  const [vise, setVise] = React.useState<string | null>(null);
  /*
   * SUR TÉLÉPHONE : TROIS PAGES SUCCESSIVES, une par zone de l'ordinateur —
   * les portées, puis les sujets de la portée choisie, puis le sujet ouvert.
   * L'écran s'ouvre sur les portées, sauf quand l'adresse désigne une unité :
   * on arrive alors directement sur son sujet. La recherche se déplie sur la ligne.
   */
  const telephone = useTelephone();
  const [pageTel, setPageTel] = React.useState<PageTelephone>(() => (cible?.uniteId ? 'fiche' : 'portees'));
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
    if (!open) return;
    setEtat(null);
    void relireFiches();
  }, [open, relireFiches]);

  // Pendant une génération, le rapport se relit toutes les cinq secondes.
  React.useEffect(() => {
    if (!open || !etat?.generation) return;
    const minuteur = window.setInterval(() => {
      void relireFiches();
      void relirePortees();
    }, 5000);
    return () => window.clearInterval(minuteur);
  }, [open, etat?.generation, relireFiches, relirePortees]);

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

  const regenerer = () => {
    client
      .call<{ lance: boolean }>({ type: 'memoire.regenerer', portee: porteeId })
      .then((data) => {
        client.pushToast(data.lance ? 'success' : 'info', data.lance ? t('Génération lancée : le rapport s’affichera ici.') : t('Une génération tourne déjà pour cette portée.'));
        void relireFiches();
      })
      .catch(erreur);
  };

  const importer = () => {
    client
      .call<{ rapports: Rapport[] }>({ type: 'memoire.importer', portee: porteeId })
      .then((data) => {
        client.pushToast('success', t('Lots importés : {n}', { n: data.rapports?.length ?? 0 }));
        void relireFiches();
        void relirePortees();
      })
      .catch(erreur);
  };

  /*
   * L'ADRESSE DE LA MÉMOIRE SUIT TROIS CRANS : le classeur, la fiche, l'unité.
   * Les trois remontent ensemble — changer de classeur change la fiche
   * affichée, les écrire séparément ferait passer l'adresse par un état qui
   * n'a jamais existé à l'écran.
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
      ((cible?.porteeId && cible.porteeId !== porteeId) ||
        (cible?.ficheId && cible.ficheId !== ouverte) ||
        (cible?.uniteId && cible.uniteId !== vise));
    if (attend) return;
    derniereRemontee.current = `${porteeId}|${ouverte ?? ''}|${vise ?? ''}`;
    remonter.current?.({ porteeId, ficheId: ouverte, uniteId: vise });
  }, [porteeId, ouverte, vise, cible?.porteeId, cible?.ficheId, cible?.uniteId]);

  /*
   * EN SENS INVERSE : ce qu'un lien désigne se repose ici. Le classeur d'abord
   * — il commande la liste des fiches —, la fiche ensuite, une fois cette
   * liste arrivée. L'unité, elle, ne se vérifie pas : elle vit DANS la fiche,
   * qui la mettra en avant si elle s'y trouve encore.
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
    if (cible.porteeId && cible.porteeId !== porteeId) {
      setPorteeId(cible.porteeId);
      return;
    }
    if (!etat || etat.portee !== porteeId) return;
    poursuite.current = null;
    if (cible.uniteId && cible.uniteId !== vise) setVise(cible.uniteId);
    if (!cible.ficheId || cible.ficheId === ouverte) return;
    const connue = cible.ficheId === CHANGELOG || etat.fiches.some((f) => f.id === cible.ficheId);
    if (!connue) {
      abandonnee.current = signature;
      client.pushToast('warning', t('Cette fiche de mémoire n’existe plus dans ce classeur.'));
      return;
    }
    setOuverte(cible.ficheId);
  }, [open, cible?.porteeId, cible?.ficheId, cible?.uniteId, porteeId, etat, ouverte, vise]);

  const ouvrirTrouvee = (u: Unite, fiche: string) => {
    if (u.portee !== porteeId) setPorteeId(u.portee);
    setDepreciees(u.statut === 'deprecated');
    setOuverte(fiche);
    setVise(u.id);
    setRecherche('');
    setPageTel('fiche');
  };

  const portee = portees.find((p) => p.id === porteeId);
  // Tant que les fiches de la portée choisie ne sont pas arrivées, rien de la portée d'avant ne s'affiche.
  const etatCourant = etat?.portee === porteeId ? etat : null;
  const rapport = etatCourant?.rapport;

  const phraseDuRapport = rapport
    ? t('Dernière génération : {c} créées, {f} fusionnées, {d} déjà là, {r} refusées.', {
        c: rapport.creees,
        f: rapport.fusionnees,
        d: rapport.dejaLa,
        r: rapport.refusees.length,
      })
    : null;
  const nomDePortee = portee ? (portee.id === 'global' ? t('Global') : portee.nom) : '';
  const ficheCourante = etatCourant?.fiches.find((f) => f.id === ouverte);
  const nomDuSujet =
    ouverte === CHANGELOG ? t('Changelog') : ficheCourante ? `${ficheCourante.id.slice(0, 2)} ${t(ficheCourante.titre)}` : '';
  const compteDuSujet = ouverte === CHANGELOG ? etatCourant?.changelog : ficheCourante?.unites;

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
            apresChoix?.();
          }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-raised',
            telephone && 'py-2.5 text-[14.5px]',
            p.id === porteeId && 'bg-raised text-text',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{p.id === 'global' ? t('Global') : p.nom}</span>
          {p.aRelire ? <span className="shrink-0 text-[11px] text-warning">{p.aRelire}</span> : null}
          <span className="shrink-0 text-[11.5px] text-faint">{p.unites}</span>
        </button>
      ))}
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
              setOuverte(f.id);
              apresChoix?.();
            }}
            data-memoire-fiche={f.id}
            title={definitionsDeLaFiche(porteeId, f.id)
              .map((d) => t(d.texte))
              .join(' ')}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised',
              telephone && 'py-2.5',
              f.id === ouverte && 'bg-raised',
            )}
          >
            <span className="shrink-0 font-mono text-[11.5px] text-faint">{f.id.slice(0, 2)}</span>
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', f.unites ? 'text-text' : 'text-faint')}>{t(f.titre)}</span>
            <span className="shrink-0 text-[11.5px] text-faint">{f.unites}</span>
          </button>
        ))}
        {etatCourant.changelog != null ? (
          <button
            type="button"
            onClick={() => {
              setOuverte(CHANGELOG);
              apresChoix?.();
            }}
            data-memoire-fiche={CHANGELOG}
            className={cn(
              'mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised',
              telephone && 'py-2.5',
              ouverte === CHANGELOG && 'bg-raised',
            )}
          >
            <History className="h-3 w-3 shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{t('Changelog')}</span>
            <span className="shrink-0 text-[11.5px] text-faint">{etatCourant.changelog}</span>
          </button>
        ) : null}
        {/* Sur téléphone, « Dépréciées » vit dans le menu ⋮ : la liste des sujets ne porte que des sujets. */}
        {telephone ? null : (
          <label className="mt-2 flex items-center gap-1.5 px-2 text-[12px] text-muted">
            <input type="checkbox" checked={depreciees} onChange={(e) => setDepreciees(e.target.checked)} data-memoire-depreciees />
            {t('Dépréciées')}
            {portee?.depreciees ? <span className="text-faint">({portee.depreciees})</span> : null}
          </label>
        )}
      </div>
    );

  const detail =
    ouverte == null || !etatCourant ? (
      <p className="px-3 py-3 text-[12.5px] text-faint">{t('Choisissez une fiche.')}</p>
    ) : ouverte === CHANGELOG ? (
      <ChangelogDuProjet key={porteeId} projectId={porteeId} />
    ) : (
      <FicheOuverte
        key={`${porteeId}-${ouverte}-${depreciees}`}
        portee={porteeId}
        ficheId={ouverte}
        depreciees={depreciees}
        vise={vise}
        onChange={() => {
          void relireFiches();
          void relirePortees();
        }}
      />
    );

  const champDeRecherche = (
    <div className="relative min-w-0 flex-1 sm:min-w-[180px]">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
      <Input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder={partout ? t('Chercher partout…') : t('Chercher dans cette portée…')}
        className="h-8 pl-7 text-[13px]"
        autoComplete="off"
        autoFocus={telephone}
        data-memoire-recherche
      />
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      {telephone ? (
        /*
         * L'ENTÊTE DU TÉLÉPHONE TIENT SUR UNE LIGNE ET SERT DE BARRE DE RETOUR :
         * hors de la première page, la flèche porte le nom de la page d'avant et
         * y ramène d'un cran ; le titre dit la page affichée. La loupe déplie le
         * champ sur la ligne (sa croix referme la recherche), et le menu ⋮ range
         * tout le reste.
         */
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2" data-memoire-entete="telephone">
          {rechercheOuverte || pageTel === 'portees' ? (
            <Library className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <button
              type="button"
              onClick={() => setPageTel(pageTel === 'fiche' ? 'fiches' : 'portees')}
              aria-label="Revenir en arrière"
              title={t('Revenir à {page}', { page: pageTel === 'fiche' ? nomDePortee : t('Mémoire') })}
              className="-ml-1 flex min-w-0 max-w-[42%] shrink-0 items-center gap-0.5 rounded p-1 text-muted hover:bg-raised hover:text-text"
              data-memoire-retour={pageTel === 'fiche' ? 'fiches' : 'portees'}
            >
              <ChevronLeft className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate text-[13px]">{pageTel === 'fiche' ? nomDePortee || '…' : t('Mémoire')}</span>
            </button>
          )}
          {rechercheOuverte ? (
            <>
              <DialogTitle className="sr-only">{t('Mémoire')}</DialogTitle>
              {champDeRecherche}
              <Button
                variant="ghost"
                size="sm"
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
            </>
          ) : (
            <>
              <DialogTitle className="min-w-0 flex-1 truncate" data-memoire-titre>
                {pageTel === 'portees' ? t('Mémoire') : (pageTel === 'fiches' ? nomDePortee : nomDuSujet) || '…'}
              </DialogTitle>
              <Button variant="ghost" size="sm" aria-label="Chercher" title={t('Chercher')} data-memoire-ouvrir-recherche onClick={() => setRechercheOuverte(true)}>
                <Search className="h-4 w-4" />
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Plus d’options" title={t('Plus d’options')} data-memoire-menu>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[min(20rem,calc(100vw-1.5rem))]">
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
              <DropdownMenuItem onSelect={importer} data-memoire-importer>
                <Upload className="h-3.5 w-3.5" />
                {t('Importer les lots')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={regenerer} disabled={Boolean(etatCourant?.generation)} data-memoire-regenerer>
                {etatCourant?.generation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {etatCourant?.generation ? t('Génération en cours…') : t('Régénérer')}
              </DropdownMenuItem>
              {phraseDuRapport ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="whitespace-normal text-[12px] font-normal text-faint" data-memoire-rapport>
                    {phraseDuRapport}
                  </DropdownMenuLabel>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
      ) : (
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2" data-memoire-entete="ordinateur">
          <Library className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="shrink-0">{t('Mémoire')}</DialogTitle>
          {champDeRecherche}
          <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted">
            <input type="checkbox" checked={partout} onChange={(e) => setPartout(e.target.checked)} data-memoire-partout />
            {t('Partout')}
          </label>
          <Button variant="ghost" size="sm" onClick={exporter} data-memoire-exporter>
            <Download className="h-3 w-3" />
            {t('Exporter')}
          </Button>
          <Button variant="ghost" size="sm" onClick={importer} data-memoire-importer>
            <Upload className="h-3 w-3" />
            {t('Importer les lots')}
          </Button>
          <Button variant="ghost" size="sm" onClick={regenerer} disabled={Boolean(etatCourant?.generation)} data-memoire-regenerer>
            {etatCourant?.generation ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {etatCourant?.generation ? t('Génération en cours…') : t('Régénérer')}
          </Button>
        </header>
      )}
      {etatCourant?.generation ? (
        <p className="shrink-0 truncate px-3 pb-2 text-[12px] text-faint" data-memoire-generation>
          {etatCourant.generation.journal.at(-1) ?? t('Génération en cours…')}
        </p>
      ) : phraseDuRapport && !telephone ? (
        <p className="shrink-0 px-3 pb-2 text-[12px] text-faint" data-memoire-rapport>
          {phraseDuRapport}
        </p>
      ) : null}

      {telephone ? (
        /*
         * LE TÉLÉPHONE EN TROIS PAGES : une seule zone à la fois, en plein
         * écran — les portées, les sujets de la portée, puis le sujet ouvert.
         * Toucher une ligne avance d'une page ; la flèche de l'entête recule.
         * Les résultats d'une recherche prennent la page, et en toucher un
         * ouvre directement son sujet.
         */
        <div className="flex min-h-0 flex-1 flex-col" data-memoire-zones data-memoire-disposition="telephone">
          {trouvees ? (
            <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="fiches" data-memoire-page="trouvees">
              <ZoneDefilement fond="hsl(var(--bg))" className="px-1.5 py-1.5">
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
              <ZoneDefilement fond="hsl(var(--bg))" className="px-1.5 py-1.5">
                {listeDesPortees(() => setPageTel('fiches'))}
              </ZoneDefilement>
            </section>
          ) : pageTel === 'fiches' ? (
            <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="fiches" data-memoire-page="fiches">
              <ZoneDefilement fond="hsl(var(--bg))" className="px-1.5 py-1.5">
                {listeDesFiches(() => setPageTel('fiche'))}
              </ZoneDefilement>
            </section>
          ) : (
            <section className={cn(ZONE, 'flex-1 bg-bg')} data-memoire-zone="fiche" data-memoire-page="fiche">
              {detail}
            </section>
          )}
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 grid-cols-[minmax(170px,220px)_minmax(220px,280px)_minmax(0,1fr)] grid-rows-1"
          data-memoire-zones
          data-memoire-disposition="ordinateur"
        >
          <section className={cn(ZONE, 'bg-bloc')} data-memoire-zone="portees">
            <ZoneDefilement fond="hsl(var(--bloc))" className="px-1.5 py-1.5">
              {listeDesPortees()}
            </ZoneDefilement>
          </section>

          <section className={cn(ZONE, 'bg-surface')} data-memoire-zone="fiches">
            <ZoneDefilement fond="hsl(var(--surface))" className="px-1.5 py-1.5">
              {trouvees ? (
                <ListeDesTrouvees trouvees={trouvees} demande={recherche} partout={partout} portees={portees} onOuvrir={ouvrirTrouvee} />
              ) : (
                listeDesFiches()
              )}
            </ZoneDefilement>
          </section>

          <section className={cn(ZONE, 'bg-bg')} data-memoire-zone="fiche">
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
  return (fiche?.types ?? []).map((type) => ({ type, texte: DEFINITION_TYPE[type] }));
}

function ficheDuTypeCote(unite: Unite): string {
  const projet = ['00_project', '01_requirements', '02_architecture', '03_domain', '04_conventions', '05_decisions', '06_components', '07_integrations', '08_constraints', '09_environment', '10_operations', '11_issues', '12_lessons'];
  const global = ['00_principles', '01_conventions', '02_architecture', '03_decisions', '04_integrations', '05_operations', '06_lessons'];
  const typesProjet: Record<string, number> = { project: 0, requirement: 1, architecture: 2, domain: 3, convention: 4, decision: 5, component: 6, integration: 7, constraint: 8, security: 8, environment: 9, operation: 10, issue: 11, lesson: 12 };
  const typesGlobal: Record<string, number> = { project: 0, requirement: 0, constraint: 0, convention: 1, architecture: 2, component: 2, domain: 2, decision: 3, integration: 4, environment: 5, operation: 5, security: 5, lesson: 6, issue: 6 };
  return unite.portee === 'global' ? global[typesGlobal[unite.type]] : projet[typesProjet[unite.type]];
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
          onClick={() => onOuvrir(u, ficheDuTypeCote(u))}
          data-memoire-trouvee={u.id}
          className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
            <span className="font-mono">{u.id}</span>
            <span>{u.importance}</span>
            {partout ? <Badge tone="neutral">{u.portee === 'global' ? t('Global') : portees.find((p) => p.id === u.portee)?.nom ?? u.portee}</Badge> : null}
          </span>
          <span className="w-full text-[13px] leading-snug text-text">
            <Surligne texte={u.titre} demande={demande} />
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

const IMPORTANCES: readonly Unite['importance'][] = ['P0', 'P1', 'P2', 'P3'];

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

function FicheOuverte({
  portee,
  ficheId,
  depreciees,
  vise,
  onChange,
}: {
  portee: string;
  ficheId: string;
  depreciees: boolean;
  vise: string | null;
  onChange: () => void;
}) {
  const [donnees, setDonnees] = React.useState<{ fiche: { id: string; titre: string }; unites: Unite[]; jamaisSupposer?: Unite[] } | null>(null);
  const relire = React.useCallback(
    () =>
      client
        .call<{ fiche: { id: string; titre: string }; unites: Unite[]; jamaisSupposer?: Unite[] }>({ type: 'memoire.fiche', portee, ficheId, depreciees })
        .then(setDonnees)
        .catch((err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible'))),
    [portee, ficheId, depreciees],
  );
  React.useEffect(() => {
    void relire();
  }, [relire]);

  if (!donnees) {
    return (
      <div className="px-3 py-3">
        <SilhouetteCoffre lignes={6} />
      </div>
    );
  }
  const tete = ficheId.startsWith('00_');
  const jamais = donnees.jamaisSupposer ?? [];
  const definitions = definitionsDeLaFiche(portee, ficheId);
  // LES PLUS VITALES D'ABORD, regroupées sous leur importance dite en mots.
  const groupes = IMPORTANCES.map((importance) => ({ importance, unites: donnees.unites.filter((u) => u.importance === importance).sort((a, b) => a.id.localeCompare(b.id)) })).filter(
    (g) => g.unites.length,
  );
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1 px-3 py-2.5" data-memoire-fiche-ouverte={ficheId}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-faint">{ficheId.slice(0, 2)}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">{t(donnees.fiche.titre)}</span>
          <span className="text-[11.5px] text-faint">{donnees.unites.length}</span>
        </div>
        {definitions.length ? (
          <div className="flex flex-col gap-0.5 text-[12.5px] leading-snug text-muted" data-memoire-definition>
            {definitions.map((d) => (
              <p key={d.type}>
                {definitions.length > 1 ? <span className="font-medium text-text">{t(LIBELLE_TYPE[d.type])} — </span> : null}
                {t(d.texte)}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <ZoneDefilement fond="hsl(var(--bg))" className="px-3 pb-4">
        <div className="flex flex-col gap-4" data-memoire-unites>
          {!donnees.unites.length ? <p className="py-3 text-[12.5px] text-faint">{t('Aucune unité ici pour l’instant.')}</p> : null}
          {groupes.map((g) => {
            const lisible = importanceLisible(g.importance);
            return (
              <section key={g.importance} className="flex flex-col gap-2" data-memoire-importance={g.importance}>
                <h3 className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-semibold', lisible.ton)}>{lisible.libelle}</span>
                  <span className="text-[11.5px] text-faint">{g.unites.length}</span>
                </h3>
                {g.unites.map((u) => (
                  <CarteDUnite
                    key={u.id}
                    unite={u}
                    vise={vise === u.id}
                    onChange={() => {
                      void relire();
                      onChange();
                    }}
                  />
                ))}
              </section>
            );
          })}
          {/* « À NE JAMAIS SUPPOSER » PASSE EN DESSOUS : c'est un rappel pour les agents, secondaire pour qui lit. */}
          {tete && jamais.length && !depreciees ? (
            <section className="mt-2 flex flex-col gap-1.5 rounded-lg bg-bloc px-3 py-2.5" data-memoire-jamais>
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
                    <span className="min-w-0 break-words">{u.titre}</span>
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

/**
 * UNE FICHE SE LIT D'ABORD REPLIÉE : son titre, sa phrase et son importance.
 * Dépliée, son détail devient de petits blocs illustrés (rôle, comportement,
 * contrôles… ; contexte, décision, conséquences), le raisonnement un encart
 * « Pourquoi c'est important », et tout le technique (fichiers, identifiant,
 * confiance, source, version) un volet discret. Le détail replié reste dans la
 * page : la recherche du navigateur et les contrôles le lisent. L'attribut
 * `hidden` seul ne suffit pas — une classe `flex` le rend visible —, d'où la
 * classe `hidden` posée avec lui.
 */
function CarteDUnite({ unite: u, vise, onChange }: { unite: Unite; vise: boolean; onChange: () => void }) {
  const [ouverte, setOuverte] = React.useState(vise);
  const [technique, setTechnique] = React.useState(false);
  const [versions, setVersions] = React.useState<Version[] | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!vise) return;
    setOuverte(true);
    ref.current?.scrollIntoView({ block: 'center' });
  }, [vise]);
  const erreur = (err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible'));
  const aRelire = u.statut === 'active' && !u.relue && u.confiance < 0.6;

  const sections = sectionsDuDetail(detailSansSectionsVides(u.detail ?? ''));
  const intro = sections
    .filter((s) => s.titre === null)
    .map((s) => s.texte)
    .join('\n\n');
  const blocs = sections.filter((s): s is { titre: string; texte: string } => s.titre !== null && Boolean(s.texte)).map((s) => ({ ...s, style: styleDeSection(s.titre) }));
  const visibles = blocs.filter((b) => !b.style.technique);
  const techniques = blocs.filter((b) => b.style.technique);

  const geste = (type: 'memoire.confirmer' | 'memoire.deprecier', message: string) => {
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
    setOuverte(true);
    client
      .call<{ versions: Version[] }>({ type: 'memoire.unite', id: u.id })
      .then((data) => setVersions(data.versions ?? []))
      .catch(erreur);
  };

  return (
    <article
      ref={ref}
      className={cn('flex flex-col rounded-lg bg-surface text-[13.5px]', vise && 'bg-accent/10')}
      data-memoire-unite={u.id}
      data-ouverte={ouverte ? 'oui' : 'non'}
    >
      <div className="flex items-start gap-1.5 px-3 pt-2.5">
        <button
          type="button"
          onClick={() => setOuverte((v) => !v)}
          aria-expanded={ouverte}
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
          data-memoire-deplier
        >
          <ChevronRight className={cn('mt-[3px] h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouverte && 'rotate-90')} />
          <span className="min-w-0 break-words text-[14px] font-semibold leading-snug text-text">{u.titre}</span>
        </button>
        {/* L'importance est dite par le groupe où la fiche est rangée : la carte ne la redit pas. */}
        {aRelire ? (
          <Button size="sm" variant="ghost" className="h-6" onClick={() => geste('memoire.confirmer', t('Unité confirmée'))} disabled={enCours} data-memoire-confirmer>
            <CheckCircle2 className="h-3 w-3" />
            {t('Confirmer')}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0" aria-label="Plus d’options" title={t('Plus d’options')} data-memoire-unite-menu>
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={basculerHistorique} data-memoire-historique-bouton>
              <History className="h-3.5 w-3.5" />
              {t('Historique')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setOuverte(true);
                setTechnique((v) => !v);
              }}
              data-memoire-technique-menu
            >
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
      <div className="flex flex-col gap-1 px-3 pb-2.5 pl-8">
        <p className="leading-relaxed text-muted">{u.resume}</p>
        {aRelire || u.statut === 'deprecated' || u.supersededBy ? (
          <p className="flex flex-wrap gap-x-2 text-[11.5px]">
            {aRelire ? <span className="text-warning">{t('À relire')}</span> : null}
            {u.statut === 'deprecated' ? <span className="text-faint">{t('dépréciée')}</span> : null}
            {u.supersededBy ? <span className="text-faint">{t('Remplacée par {id}', { id: u.supersededBy })}</span> : null}
          </p>
        ) : null}
      </div>
      <div hidden={!ouverte} className={cn('flex flex-col gap-2.5 px-3 pb-3 sm:pl-8', !ouverte && 'hidden')} data-memoire-unite-detail>
        {intro ? <Markdown content={intro.replace(/^### /gm, '#### ')} /> : null}
        {visibles.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-memoire-blocs>
            {visibles.map((b) => {
              const { Icone } = b.style;
              return (
                <section key={b.titre} className={cn('flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2', b.style.fond, visibles.length % 2 === 1 && b === visibles.at(-1) && 'sm:col-span-2')} data-memoire-bloc={b.titre}>
                  <span className={cn('flex items-center gap-1.5 text-[12px] font-semibold', b.style.icone)}>
                    <Icone className="h-3.5 w-3.5 shrink-0" />
                    {b.style.libelle}
                  </span>
                  {/* Le Markdown pose ses paragraphes en 14 px : dans un petit bloc, ils reprennent la taille de la fiche. */}
                  <div className="min-w-0 text-[13px] text-text [&_div]:text-[13px] [&_span]:text-[13px]">
                    <Markdown content={b.texte.replace(/^### /gm, '#### ')} />
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
        {u.raisonnement ? (
          <aside className="flex gap-2 rounded-lg bg-warning/10 px-3 py-2" data-memoire-pourquoi>
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-col gap-0.5 text-[13px] [&_div]:text-[13px] [&_span]:text-[13px]">
              <span className="text-[12px] font-semibold text-warning">{t('Pourquoi c’est important')}</span>
              <Markdown content={u.raisonnement} />
            </div>
          </aside>
        ) : null}
        <button
          type="button"
          onClick={() => setTechnique((v) => !v)}
          aria-expanded={technique}
          className="flex items-center gap-1 self-start text-[11.5px] text-faint transition-colors hover:text-muted"
          data-memoire-technique-bascule
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', technique && 'rotate-90')} />
          {t('Détails techniques')}
        </button>
        <div hidden={!technique} className={cn('flex flex-col gap-1.5 rounded-md bg-bloc px-2.5 py-2 text-[11.5px] text-faint', !technique && 'hidden')} data-memoire-technique>
          {techniques.map((b) => (
            <div key={b.titre} className="flex min-w-0 flex-col gap-0.5 text-[12px]">
              <span className="font-medium text-muted">{b.style.libelle}</span>
              <Markdown content={b.texte} />
            </div>
          ))}
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
          <div className="flex flex-col gap-0.5 rounded bg-bloc px-2 py-1 text-[12px] text-faint" data-memoire-historique>
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
            'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
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
        className={cn('flex w-full min-w-0 items-start gap-2.5 text-left transition-colors hover:bg-raised', menue ? 'rounded px-2 py-1' : 'px-3 py-2')}
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
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-[12px]" onClick={() => client.openCard(carte.id)} title={carte.titre} data-memoire-changelog-carte={carte.id}>
          <MessageSquare className="h-3.5 w-3.5" />
          {t('Ouvrir la carte')}
        </Button>
      ) : null}
      {e.id != null ? (
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-[12px]" onClick={onCorriger} data-memoire-changelog-corriger>
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
            className={cn('rounded px-2 py-1 text-[11.5px] font-medium transition-colors', poids === p ? TON_DU_POIDS[p] : 'text-faint hover:bg-raised hover:text-muted')}
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
