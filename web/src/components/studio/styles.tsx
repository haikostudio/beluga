import * as React from 'react';
import { ExternalLink, Plus, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { peutPasserLaVerification, styleDansLesCategories, type CategorieDeStyle, type EtatSourceDeStyles } from '@beluga/shared';
import { BulleInfo, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@/components/ui';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { VoletVerification } from './verification';

/**
 * LES STYLES DU STUDIO — une galerie de directions de mise en scène éprouvées,
 * tirées de SOURCES (sites d'exemples) ; auteur crédité. Ce ne sont pas des
 * animations toutes faites : un style est une CONSIGNE que l'agent de la
 * création adapte (kit de marque, durée, règles du Studio).
 *
 *  - LES CARTES ONT TOUTES LA MÊME HAUTEUR : l'aperçu tient dans une boîte 16:9
 *    fixe, centré sans être rogné (`object-contain`) — un aperçu vertical ne
 *    tire plus sa ligne vers le bas — et chaque ligne de texte a sa hauteur
 *    réservée, le bouton toujours en bas. La silhouette de chargement a les
 *    mêmes cotes.
 *  - L'aperçu s'anime au SURVOL de la souris (une VIDÉO n'existe que pendant
 *    le survol : jamais deux cents vidéos préchargées). Un CLIC l'ouvre en
 *    grand, avec le début de la consigne et les liens, demandés à l'ouverture.
 *  - LES CATÉGORIES se cochent à plusieurs : un style passe s'il en porte AU
 *    MOINS UNE (`styleDansLesCategories`), et la recherche s'y ajoute.
 *  - Le catalogue se relit quand la bibliothèque change (une source validée,
 *    des nouveautés de la nuit) : l'évènement « studio / bibliotheque ».
 *
 * « Appliquer » envoie la demande à l'agent de la création, avec l'identifiant
 * du style ; l'agent cite aussi des styles dans ses pistes de mise en scène
 * (« [style:<id>] »), montrés en vignettes au bout de sa conversation.
 */

export interface StyleDeLaGalerie {
  id: string;
  titre: string;
  phrase: string;
  motsCles: string[];
  genre: 'motion' | 'explication';
  categories: string[];
  auteur: string;
  /** L'aperçu bouge (image animée ou vidéo). */
  apercuAnime: boolean;
  /** …et c'est une vidéo, lue au survol. */
  video?: boolean;
  source: string;
  /** Arrivé d'une source il y a moins de sept jours. */
  nouveau?: boolean;
}

interface Bibliotheque {
  styles: StyleDeLaGalerie[];
  categories: CategorieDeStyle[];
}

let catalogue: { version: number; promesse: Promise<Bibliotheque> } | null = null;

const lireVersion = () => client.lireEtat().studioVersions.bibliotheque ?? 0;
/** Le numéro de la bibliothèque, SEUL : la galerie ne se redessine pas à chaque mouvement de l'application. */
function useVersionBibliotheque(): number {
  return React.useSyncExternalStore(client.subscribe, lireVersion, lireVersion);
}

/** Le catalogue, demandé une fois, puis de nouveau seulement quand la bibliothèque a changé. */
export function useBibliotheque(): Bibliotheque | null {
  const version = useVersionBibliotheque();
  const [biblio, setBiblio] = React.useState<Bibliotheque | null>(null);
  React.useEffect(() => {
    let vivant = true;
    if (!catalogue || catalogue.version !== version)
      catalogue = { version, promesse: client.call<Bibliotheque>({ type: 'studio.styles.lister' }).then((r) => ({ styles: r.styles, categories: r.categories ?? [] })) };
    catalogue.promesse
      .then((b) => vivant && setBiblio(b))
      .catch(() => {
        catalogue = null;
        if (vivant) setBiblio({ styles: [], categories: [] });
      });
    return () => {
      vivant = false;
    };
  }, [version]);
  return biblio;
}

const vignette = (id: string, anime: boolean) => `/api/studio/style-vignette?id=${encodeURIComponent(id)}${anime ? '&anime=1' : ''}`;

/** La demande envoyée à l'agent : l'identifiant entre crochets, qu'il lit avec son action « styles ». */
export function demandeDAppliquer(style: Pick<StyleDeLaGalerie, 'id' | 'titre'>): string {
  return `Applique le style [style:${style.id}] « ${style.titre} » à cette création.`;
}

/* Les cotes d'une carte, partagées avec sa silhouette : la grille ne saute pas à l'arrivée des données. */
const CARTE = 'flex h-full min-w-0 flex-col overflow-hidden rounded-md bg-bloc';
const BOITE_APERCU = 'relative aspect-video w-full shrink-0 overflow-hidden bg-raised';
const LIGNE_TITRE = 'h-[18px] text-[12.5px] leading-[18px]';
const LIGNE_PHRASE = 'h-[48px] text-[11.5px] leading-[16px]';
const LIGNE_AUTEUR = 'h-[16px] text-[11px] leading-[16px]';

function CarteStyle({
  style,
  onAppliquer,
  onOuvrir,
  compacte,
}: {
  style: StyleDeLaGalerie;
  onAppliquer: (s: StyleDeLaGalerie) => void;
  onOuvrir: (s: StyleDeLaGalerie) => void;
  compacte?: boolean;
}) {
  const [anime, setAnime] = React.useState(false);
  return (
    <div
      className={CARTE}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setAnime(style.apercuAnime)}
      onPointerLeave={() => setAnime(false)}
      data-studio-style={style.id}
      data-anime={anime ? 'oui' : 'non'}
      data-apercu={style.video ? 'video' : 'image'}
    >
      <div className={BOITE_APERCU} data-studio-style-apercu>
        <button
          type="button"
          aria-label={`Agrandir l’aperçu de « ${style.titre} »`}
          title={t('Voir en grand')}
          onClick={() => onOuvrir(style)}
          className="absolute inset-0 flex items-center justify-center"
          data-studio-style-agrandir={style.id}
        >
          <img src={vignette(style.id, anime && !style.video)} alt="" loading="lazy" className="h-full w-full object-contain" draggable={false} />
          {/* L'image fixe reste dessous pendant que la vidéo arrive ; muette et « playsInline », sinon l'iPhone refuse de la lancer. */}
          {style.video && anime ? (
            <video src={vignette(style.id, true)} muted loop playsInline autoPlay preload="none" disablePictureInPicture className="absolute inset-0 h-full w-full object-contain" aria-hidden />
          ) : null}
        </button>
        {style.apercuAnime && !anime ? <Sparkles className="pointer-events-none absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-hidden /> : null}
        {style.nouveau ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-fg" data-studio-style-nouveau>
            {t('Nouveau')}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-1.5">
        <span className={cn('truncate font-medium text-text', LIGNE_TITRE)} title={style.titre}>
          {style.titre}
        </span>
        {compacte ? null : <span className={cn('line-clamp-3 text-muted', LIGNE_PHRASE)}>{style.phrase}</span>}
        <span className={cn('truncate text-faint', LIGNE_AUTEUR)}>{t('Consigne de {auteur}', { auteur: style.auteur })}</span>
        <Button size="sm" variant="outline" className="mt-auto" onClick={() => onAppliquer(style)} data-studio-appliquer-style={style.id}>
          {t('Appliquer')}
        </Button>
      </div>
    </div>
  );
}

/** La silhouette d'une carte : mêmes cotes, aucune donnée. */
function SilhouetteCarte() {
  return (
    <div className={cn(CARTE, 'animate-pulse')} data-studio-style-silhouette>
      <div className={BOITE_APERCU} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-1.5">
        <span className={cn('w-3/4 rounded bg-raised', LIGNE_TITRE)} />
        <span className={cn('rounded bg-raised', LIGNE_PHRASE)} />
        <span className={cn('w-1/2 rounded bg-raised', LIGNE_AUTEUR)} />
        <Button size="sm" variant="outline" className="invisible mt-auto" tabIndex={-1} aria-hidden>
          {t('Appliquer')}
        </Button>
      </div>
    </div>
  );
}

interface DetailDuStyle {
  consigne: string;
  auteurUrl?: string;
  lien?: string;
  fiche?: string;
  credit: string;
  sourceNom: string;
}

/** L'APERÇU AGRANDI : la vidéo ou l'image animée en grand, puis ce que la carte n'a pas la place de dire. */
function FenetreStyle({
  style,
  categories,
  onFermer,
  onAppliquer,
}: {
  style: StyleDeLaGalerie;
  categories: CategorieDeStyle[];
  onFermer: () => void;
  onAppliquer: (s: StyleDeLaGalerie) => void;
}) {
  const [detail, setDetail] = React.useState<DetailDuStyle | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ detail: DetailDuStyle }>({ type: 'studio.styles.lire', id: style.id })
      .then((r) => vivant && setDetail(r.detail))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [style.id]);
  const libelles = new Map(categories.map((c) => [c.id, c.libelle]));
  const lienDOrigine = detail?.lien ?? detail?.fiche;
  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="sm:w-[min(880px,100%)]" data-studio-fenetre-style={style.id}>
        <DialogHeader>
          <DialogTitle className="pr-6">{style.titre}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pb-1">
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black" data-studio-fenetre-apercu>
            {style.video ? (
              <video src={vignette(style.id, true)} poster={vignette(style.id, false)} muted loop playsInline autoPlay disablePictureInPicture className="h-full w-full object-contain" />
            ) : (
              <img src={vignette(style.id, style.apercuAnime)} alt="" className="h-full w-full object-contain" draggable={false} />
            )}
          </div>
          <p className="text-[13px] leading-snug text-text">{style.phrase}</p>
          {style.categories.length ? (
            <div className="flex flex-wrap gap-1">
              {style.categories.map((c) => (
                <span key={c} className="rounded bg-raised px-1.5 py-0.5 text-[11.5px] text-muted">
                  {t(libelles.get(c) ?? c)}
                </span>
              ))}
            </div>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
            {detail?.auteurUrl ? (
              <a href={detail.auteurUrl} target="_blank" rel="noreferrer" className="hover:text-text hover:underline">
                {t('Consigne de {auteur}', { auteur: style.auteur })}
              </a>
            ) : (
              <span>{t('Consigne de {auteur}', { auteur: style.auteur })}</span>
            )}
            {detail ? <span>· {detail.sourceNom}</span> : null}
            {lienDOrigine ? (
              <a href={lienDOrigine} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-text hover:underline" data-studio-fenetre-lien>
                <ExternalLink className="h-3 w-3" />
                {t('Voir l’original')}
              </a>
            ) : null}
          </p>
          {detail ? (
            <details className="rounded-md bg-bloc px-3 py-2 text-[12px]">
              <summary className="cursor-pointer select-none text-muted">{t('Consigne d’origine')}</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-faint">{detail.consigne}</p>
            </details>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onAppliquer(style);
              onFermer();
            }}
            data-studio-fenetre-appliquer
          >
            {t('Appliquer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const normaliser = (texte: string) =>
  texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const GRILLE = 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

export function PanneauStyles({ onAppliquer }: { onAppliquer: (s: StyleDeLaGalerie) => void }) {
  const biblio = useBibliotheque();
  const styles = biblio?.styles ?? null;
  const [choisies, setChoisies] = React.useState<string[]>([]);
  const [cherche, setCherche] = React.useState('');
  const [ouvert, setOuvert] = React.useState<StyleDeLaGalerie | null>(null);
  // Les catégories montrées : celles qui ont au moins un style, dans l'ordre de la liste, avec leur compte.
  const categories = React.useMemo(
    () => (biblio?.categories ?? []).map((c) => ({ ...c, n: (styles ?? []).filter((s) => s.categories.includes(c.id)).length })).filter((c) => c.n > 0),
    [biblio, styles],
  );
  const visibles = React.useMemo(() => {
    const mots = normaliser(cherche).split(/\s+/).filter(Boolean);
    const libelles = new Map((biblio?.categories ?? []).map((c) => [c.id, c.libelle]));
    return (styles ?? []).filter((s) => {
      if (!styleDansLesCategories(s.categories, choisies)) return false;
      const texte = normaliser(`${s.titre} ${s.phrase} ${s.motsCles.join(' ')} ${s.categories.map((c) => t(libelles.get(c) ?? c)).join(' ')}`);
      return mots.every((m) => texte.includes(m));
    });
  }, [styles, biblio, choisies, cherche]);
  const basculer = (id: string) => setChoisies((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="flex flex-col gap-2 pt-1" data-studio-panneau="styles">
      <div className="flex items-center gap-1">
        {/* À quoi sert la galerie, et d'où viennent les styles : derrière la pastille « i » (MEM-3449). */}
        <BulleInfo cote="start">
          {t('Des directions de mise en scène éprouvées. « Appliquer » demande à l’agent d’adapter la création à ce style.')}{' '}
          {t('Les styles viennent des sources de la bibliothèque : chaque vidéo et chaque consigne restent à leur auteur.')}
        </BulleInfo>
        <span className="relative flex flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input value={cherche} onChange={(e) => setCherche(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t('Chercher un style (néon, typographie, 3D…)')} className="h-8 pl-7 text-[13px]" />
        </span>
      </div>
      {/* LES CATÉGORIES, à cocher à plusieurs : un style passe s'il en porte au moins une. */}
      <div className="flex flex-wrap gap-1" data-studio-styles-categories>
        <button
          type="button"
          onClick={() => setChoisies([])}
          aria-pressed={!choisies.length}
          className={cn('rounded-full px-2.5 py-1 text-[12px]', !choisies.length ? 'bg-accent text-accent-fg' : 'bg-bloc text-muted hover:text-text')}
          data-studio-styles-categorie="toutes"
        >
          {t('Tous')}
        </button>
        {categories.map((c) => {
          const actif = choisies.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => basculer(c.id)}
              aria-pressed={actif}
              className={cn('rounded-full px-2.5 py-1 text-[12px]', actif ? 'bg-accent text-accent-fg' : 'bg-bloc text-muted hover:text-text')}
              data-studio-styles-categorie={c.id}
            >
              {t(c.libelle)} <span className={actif ? 'text-accent-fg/80' : 'text-faint'}>{c.n}</span>
            </button>
          );
        })}
      </div>
      {styles === null ? (
        <div className={GRILLE}>
          {Array.from({ length: 10 }, (_, i) => (
            <SilhouetteCarte key={i} />
          ))}
        </div>
      ) : visibles.length ? (
        <div className={GRILLE} data-studio-styles-grille>
          {visibles.map((s) => (
            <CarteStyle key={s.id} style={s} onAppliquer={onAppliquer} onOuvrir={setOuvert} />
          ))}
        </div>
      ) : (
        <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun style ne correspond.')}</p>
      )}
      {ouvert ? <FenetreStyle style={ouvert} categories={biblio?.categories ?? []} onFermer={() => setOuvert(null)} onAppliquer={onAppliquer} /> : null}
    </div>
  );
}

/** LES STYLES CITÉS PAR L'AGENT dans son dernier message (« [style:<id>] ») : des vignettes cliquables au bout du fil. */
export function StylesCites({ texte, onAppliquer }: { texte: string; onAppliquer: (s: StyleDeLaGalerie) => void }) {
  const biblio = useBibliotheque();
  const [ouvert, setOuvert] = React.useState<StyleDeLaGalerie | null>(null);
  const ids = React.useMemo(() => [...new Set([...texte.matchAll(/\[style:([a-z0-9][a-z0-9-]{0,79})\]/g)].map((m) => m[1]!))].slice(0, 4), [texte]);
  const cites = ids.map((id) => biblio?.styles.find((s) => s.id === id)).filter((s): s is StyleDeLaGalerie => !!s);
  if (!cites.length) return null;
  return (
    <section className={cn('mx-3 my-2 flex flex-col gap-1.5')} data-studio-styles-cites>
      <h4 className="text-[12px] font-semibold text-muted">{t('Les styles proposés par l’agent')}</h4>
      <div className="grid grid-cols-2 gap-2">
        {cites.map((s) => (
          <CarteStyle key={s.id} style={s} onAppliquer={onAppliquer} onOuvrir={setOuvert} compacte />
        ))}
      </div>
      {ouvert ? <FenetreStyle style={ouvert} categories={biblio?.categories ?? []} onFermer={() => setOuvert(null)} onAppliquer={onAppliquer} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Les sources                                                         */
/* ------------------------------------------------------------------ */

interface SourceDuVolet {
  id: string;
  adresse: string;
  nom: string;
  licence: string;
  etat: EtatSourceDeStyles;
  resume?: string;
  nbTrouves?: number;
  derniereAnalyse?: number;
  dernierPassage?: number;
  nbNouveaux: number;
  erreur?: string;
  nbElements: number;
  nbARediger: number;
  trouveeDans?: string;
  parNavigateur?: boolean;
}

const LIBELLE_ETAT: Record<EtatSourceDeStyles, () => string> = {
  analyse: () => t('Analyse en cours'),
  a_valider: () => t('À valider'),
  recuperation: () => t('Récupération en cours'),
  active: () => t('Contrôlée chaque nuit'),
  erreur: () => t('En erreur'),
  retiree: () => t('Retirée'),
  annuaire: () => t('Annuaire exploré'),
  verification: () => t('Vérification à refaire'),
};
/* Orange pour ce qui est en cours, bleu pour ce qui tourne, rouge pour la panne. */
const TEINTE_ETAT: Record<EtatSourceDeStyles, string> = {
  analyse: 'bg-en-cours/15 text-en-cours',
  a_valider: 'bg-accent/15 text-accent',
  recuperation: 'bg-en-cours/15 text-en-cours',
  active: 'bg-termine/15 text-termine',
  erreur: 'bg-danger/15 text-danger',
  retiree: 'bg-raised text-faint',
  annuaire: 'bg-info/15 text-info',
  verification: 'bg-warning/15 text-warning',
};

const quand = (ms?: number) => (ms ? new Date(ms).toLocaleString(formatRegional(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

function LigneSource({ source, onGeste, onVerifier }: { source: SourceDuVolet; onGeste: (type: string, id: string) => Promise<void>; onVerifier: (s: SourceDuVolet) => void }) {
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState(source.etat === 'a_valider');
  const geste = async (type: string) => {
    setEnCours(type);
    try {
      await onGeste(type, source.id);
    } finally {
      setEnCours(null);
    }
  };
  const travaille = source.etat === 'analyse' || source.etat === 'recuperation';
  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-studio-source={source.id} data-etat={source.etat}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={source.adresse}>
          {source.nom}
        </span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', TEINTE_ETAT[source.etat])} data-studio-source-etat>
          {LIBELLE_ETAT[source.etat]()}
        </span>
      </div>
      <a href={source.adresse} target="_blank" rel="noreferrer" className="truncate text-[11.5px] text-faint hover:text-text hover:underline">
        {source.adresse}
      </a>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] sm:grid-cols-4">
        <div>
          <dt className="text-faint">{t('Éléments récupérés')}</dt>
          <dd className="text-text" data-studio-source-nombre>
            {source.nbElements}
            {source.nbARediger ? <span className="text-faint"> {t('(+{n} en rédaction)', { n: source.nbARediger })}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-faint">{t('Dernière analyse')}</dt>
          <dd className="text-text">{quand(source.derniereAnalyse)}</dd>
        </div>
        <div>
          <dt className="text-faint">{t('Dernier contrôle')}</dt>
          <dd className="text-text">{quand(source.dernierPassage)}</dd>
        </div>
        <div>
          <dt className="text-faint">{t('Nouveautés au dernier contrôle')}</dt>
          <dd className="text-text">{source.dernierPassage ? source.nbNouveaux : '—'}</dd>
        </div>
      </dl>
      {source.erreur ? (
        <p className={cn('text-[12px]', source.etat === 'verification' ? 'text-warning' : 'text-danger')} data-studio-source-erreur>
          {source.erreur}
        </p>
      ) : null}
      {details && (source.resume || source.licence) ? (
        <div className="flex flex-col gap-1 rounded bg-surface px-2.5 py-2 text-[12px]">
          {source.resume ? <p className="whitespace-pre-wrap text-text">{source.resume}</p> : null}
          {source.licence ? <p className="text-faint">{t('Conditions : {licence}', { licence: source.licence })}</p> : null}
          {source.etat === 'a_valider' && source.nbTrouves ? <p className="text-faint">{t('{n} exemples trouvés lors de l’analyse.', { n: source.nbTrouves })}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {source.etat === 'a_valider' ? (
          <Button size="sm" onClick={() => geste('studio.sources.valider')} disabled={!!enCours} data-studio-source-valider>
            {enCours === 'studio.sources.valider' ? t('Validation…') : t('Valider et récupérer')}
          </Button>
        ) : null}
        {peutPasserLaVerification(source) ? (
          <Button size="sm" onClick={() => onVerifier(source)} disabled={!!enCours} data-studio-source-verifier>
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('Passer la vérification')}
          </Button>
        ) : null}
        {source.etat === 'active' || source.etat === 'erreur' || source.etat === 'verification' ? (
          <Button size="sm" variant="outline" onClick={() => geste('studio.sources.controler')} disabled={!!enCours} data-studio-source-controler>
            {enCours === 'studio.sources.controler' ? t('Contrôle…') : t('Contrôler maintenant')}
          </Button>
        ) : null}
        {!travaille ? (
          <Button size="sm" variant="ghost" onClick={() => geste('studio.sources.analyser')} disabled={!!enCours} data-studio-source-analyser>
            {enCours === 'studio.sources.analyser' ? t('Lancement…') : t('Analyser de nouveau')}
          </Button>
        ) : null}
        {source.etat !== 'retiree' && !travaille ? (
          <Button size="sm" variant="ghost" onClick={() => geste('studio.sources.retirer')} disabled={!!enCours} data-studio-source-retirer>
            {enCours === 'studio.sources.retirer' ? t('Retrait…') : t('Retirer')}
          </Button>
        ) : null}
        {source.resume || source.licence ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
            {details ? t('Masquer l’analyse') : t('Voir l’analyse')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * LE VOLET « SOURCES » : d'où viennent les styles. Une adresse ajoutée part chez
 * l'agent d'analyse ; validée, elle est récupérée, puis contrôlée chaque nuit.
 * La liste se relit à chaque changement de la bibliothèque (aucune
 * interrogation répétée).
 */
export function PanneauSources() {
  const version = useVersionBibliotheque();
  const [sources, setSources] = React.useState<SourceDuVolet[] | null>(null);
  const [adresse, setAdresse] = React.useState('');
  const [ajout, setAjout] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  /** La source dont le volet « Passer la vérification » est ouvert. */
  const [verification, setVerification] = React.useState<SourceDuVolet | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ sources: SourceDuVolet[] }>({ type: 'studio.sources.lister' })
      .then((r) => vivant && setSources(r.sources))
      .catch(() => vivant && setSources((s) => s ?? []));
    return () => {
      vivant = false;
    };
  }, [version]);
  const geste = async (type: string, id: string) => {
    setErreur(null);
    try {
      const r = await client.call<{ sources: SourceDuVolet[] }>({ type, id } as any);
      setSources(r.sources);
    } catch (err: any) {
      setErreur(err?.message ?? String(err));
    }
  };
  const ajouter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adresse.trim() || ajout) return;
    setAjout(true);
    setErreur(null);
    try {
      const r = await client.call<{ sources: SourceDuVolet[] }>({ type: 'studio.sources.ajouter', adresse: adresse.trim() });
      setSources(r.sources);
      setAdresse('');
    } catch (err: any) {
      setErreur(err?.message ?? String(err));
    } finally {
      setAjout(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 pt-1" data-studio-panneau="sources">
      <form onSubmit={ajouter} className="flex items-center gap-1.5">
        <BulleInfo cote="start">
          {t('Ajoutez l’adresse d’un site d’exemples de vidéos animées : un agent l’analyse, puis vous validez avant que ses styles soient récupérés. Chaque source validée est contrôlée chaque nuit, et ses nouveautés arrivent avec la marque « Nouveau ».')}
        </BulleInfo>
        <Input value={adresse} onChange={(e) => setAdresse(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t('Adresse d’un site (https://…)')} className="h-8 flex-1 text-[13px]" data-studio-source-adresse />
        <Button size="sm" type="submit" disabled={!adresse.trim() || ajout} data-studio-source-ajouter>
          <Plus className="h-3.5 w-3.5" />
          {ajout ? t('Ajout…') : t('Ajouter')}
        </Button>
      </form>
      {erreur ? (
        <p className="text-[12px] text-danger" role="alert">
          {erreur}
        </p>
      ) : null}
      {sources === null ? (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, i) => (
            <li key={i} className="h-[104px] animate-pulse rounded-md bg-bloc" />
          ))}
        </ul>
      ) : sources.length ? (
        <ul className="flex flex-col gap-2" data-studio-sources>
          {sources.map((s) => (
            <LigneSource key={s.id} source={s} onGeste={geste} onVerifier={setVerification} />
          ))}
        </ul>
      ) : (
        <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucune source pour l’instant.')}</p>
      )}
      {verification ? <VoletVerification sourceId={verification.id} nom={verification.nom} onClose={() => setVerification(null)} /> : null}
    </div>
  );
}
