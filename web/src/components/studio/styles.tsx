import * as React from 'react';
import { ExternalLink, Plus, Search, ShieldCheck, Sparkles } from '@/components/ui/icones';
import { minusculesSansAccents } from '@beluga/shared';
import { BulleInfo, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@/components/ui';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES STYLES DU STUDIO — une galerie de directions de mise en scène éprouvées,
 * le catalogue gelé partagé avec le directeur artistique ; auteur crédité. Ce ne sont pas des
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
 *
 * « Appliquer » ÉCRIT la demande dans le champ de l'agent de la création (avec
 * l'identifiant du style), sans l'envoyer : l'utilisateur la complète puis
 * l'envoie lui-même.
 */

interface CategorieDeStyle {
  id: string;
  libelle: string;
}

/** Un style passe s'il porte AU MOINS UNE des catégories cochées. */
function styleDansLesCategories(categories: readonly string[], choisies: readonly string[]): boolean {
  return !choisies.length || choisies.some((c) => categories.includes(c));
}

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
      <DialogContent adresse="style-bibliotheque" className="sm:w-[min(880px,100%)]" data-studio-fenetre-style={style.id}>
        <DialogHeader>
          <DialogTitle>{style.titre}</DialogTitle>
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
        <DialogFooter pleineLargeur>
          <Button
            size="lg"
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

const GRILLE = 'grid grid-cols-2 gap-2';

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
    const mots = minusculesSansAccents(cherche).split(/\s+/).filter(Boolean);
    const libelles = new Map((biblio?.categories ?? []).map((c) => [c.id, c.libelle]));
    return (styles ?? []).filter((s) => {
      if (!styleDansLesCategories(s.categories, choisies)) return false;
      const texte = minusculesSansAccents(`${s.titre} ${s.phrase} ${s.motsCles.join(' ')} ${s.categories.map((c) => t(libelles.get(c) ?? c)).join(' ')}`);
      return mots.every((m) => texte.includes(m));
    });
  }, [styles, biblio, choisies, cherche]);
  const basculer = (id: string) => setChoisies((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="flex flex-col gap-2 pt-1" data-studio-panneau="styles">
      <div className="flex items-center gap-1">
        {/* À quoi sert la galerie, et d'où viennent les styles : derrière la pastille « i » (MEM-3449). */}
        <BulleInfo cote="start">
          {t('Des directions de mise en scène éprouvées. « Appliquer » écrit la demande dans le champ de l’agent : vous pouvez la compléter avant de l’envoyer.')}{' '}
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
          className={cn('rounded-full px-3 sm:px-2.5 py-1.5 sm:py-1 text-[12px]', !choisies.length ? 'bg-accent text-accent-fg' : 'bg-bloc text-muted hover:text-text')}
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
              className={cn('rounded-full px-3 sm:px-2.5 py-1.5 sm:py-1 text-[12px]', actif ? 'bg-accent text-accent-fg' : 'bg-bloc text-muted hover:text-text')}
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

