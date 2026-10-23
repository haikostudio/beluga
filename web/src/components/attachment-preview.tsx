import * as React from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, FileArchive, Image as ImageIcon, Images, Loader2, X } from 'lucide-react';
import {
  Attachment,
  CADRAGE_INITIAL,
  MAX_IMAGES_PAR_ARCHIVE,
  ROUTE_ARCHIVE_DES_IMAGES,
  SEUIL_DE_CLIC_PX,
  basculerZoom,
  bornerCadrage,
  corpsDArchive,
  etiquetteDePiece,
  facteurDeMolette,
  genreDuFichier,
  glissementFranchi,
  heureExacte,
  nomDArchiveDImages,
  rangVoisin,
  tailleContenue,
  zoomerAutour,
  type Cadrage,
  type CorpsDArchive,
  type LotDArchive,
  type Point,
} from '@beluga/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FenetreDeVisionneuse,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { BasculeApercu, ContenuTexte, useFormatApercu } from '@/components/apercu-markdown';
import { PastilleDeFichier, VignetteDImage, adresseDePiece } from '@/components/pastille-de-fichier';
import { LecteurVideo, type ApercuDeVideo } from '@/components/lecteur-video';
import { LecteurSon } from '@/components/lecteur-son';
import { client } from '@/lib/client';
import { useTelechargement } from '@/lib/telechargement';
import { bytes, cn, dateHeure } from '@/lib/utils';
import { t } from '@/lib/langue';


/**
 * L'APERÇU D'UNE VIDÉO, VU DE L'ESPACE DE TRAVAIL.
 *
 * Ce qui est gardé sur la pièce est relu tel quel ; ce que la recherche
 * automatique trouve est ÉCRIT sur la pièce, pour que personne n'ait à chercher
 * une seconde fois — et le geste « c'est cette image-là » passe par la même
 * porte, marqué comme un choix de la main. L'espace client, lui, n'appelle rien
 * de tout cela : il lit l'instant et s'arrête là.
 */
function useApercuDePiece(item: Attachment | null): ApercuDeVideo | undefined {
  const id = item?.id;
  const seconde = item?.apercuSeconde;
  const manuel = item?.apercuManuel;
  return React.useMemo(
    () =>
      id
        ? {
            seconde,
            manuel,
            onChoisir: (choix: number | null) =>
              client.send({ type: 'attachment.apercu', id, seconde: choix, manuel: true }),
            onTrouve: (trouve: number) => client.send({ type: 'attachment.apercu', id, seconde: trouve, manuel: false }),
          }
        : undefined,
    [id, seconde, manuel],
  );
}

const sourceDUnePiece = (piece: Attachment) => `/api/attachment?id=${piece.id}`;

/** L'adresse d'enregistrement d'une image : celle qui la sert, avec `download=1`. */
const pourEnregistrer = (adresse: string) => `${adresse}${adresse.includes('?') ? '&' : '?'}download=1`;

const estUneImage = (piece: Attachment | null | undefined) => !!piece && piece.mime.startsWith('image/');

/** La durée d'un passage d'image à l'autre, en glissant. */
const DUREE_DE_PASSAGE_MS = 240;
/** Deux touchers à moins de ce délai font un double toucher. */
const DOUBLE_TOUCHER_MS = 300;

/** Ce que la scène expose à la fenêtre : passer à l'image voisine, en glissant. */
interface PiloteDeScene {
  partir: (decalage: number) => void;
}

type Geste =
  | { genre: 'glisse' | 'deplace'; x: number; y: number; t: number; depart: Cadrage; bouge: boolean }
  | { genre: 'pince'; distance: number; milieu: Point; depart: Cadrage };

/**
 * LA SCÈNE D'IMAGES : un CARROUSEL de trois vues (précédente, courante,
 * suivante) qui suit le doigt ou la souris, et le ZOOM de l'image courante.
 *
 * Ce n'est PAS le glisser-déposer de cartes (`usePointerDrag`) : aucun objet ne
 * change de place, l'image se regarde. La scène déclare `touch-action: none` —
 * sans quoi le navigateur zoome la PAGE entière au pincement — et lit donc
 * elle-même tous les gestes, par les événements de pointeur :
 * - un clic (souris) ou un DOUBLE toucher bascule image entière ↔ 2,5× autour
 *   du point visé ; la molette (et le pincement du pavé, ctrl + molette) zoome
 *   autour du curseur ; deux doigts pincent ;
 * - glisser DÉPLACE l'image agrandie, bornée à ses bords ; à l'échelle 1, glisser
 *   fait défiler le carrousel, qui BOUCLE (après la dernière, la première).
 * Un geste qui a bougé de plus de quelques pixels n'est jamais un clic.
 * Les règles de calcul vivent dans `shared/src/visionneuse.ts`, testées seules.
 */
const SceneDImages = React.forwardRef<
  PiloteDeScene,
  {
    vues: [Attachment | null, Attachment, Attachment | null];
    sourceDe: (piece: Attachment) => string;
    /** Change vraiment d'image (après l'animation). */
    aller: (decalage: number) => void;
    feuilletable: boolean;
    repere?: string;
  }
>(function SceneDImages({ vues, sourceDe, aller, feuilletable, repere }, ref) {
  const courante = vues[1];
  const scene = React.useRef<HTMLDivElement>(null);
  const [cadrage, setCadrage] = React.useState<Cadrage>(CADRAGE_INITIAL);
  const [fluide, setFluide] = React.useState(false);
  const [glisse, setGlisse] = React.useState(0);
  const [anime, setAnime] = React.useState(false);
  const [enMain, setEnMain] = React.useState(false);
  const taille = React.useRef({ l: 1, h: 1 });
  const naturelle = React.useRef<{ l: number; h: number } | null>(null);
  const pointeurs = React.useRef(new Map<number, Point>());
  const geste = React.useRef<Geste | null>(null);
  const dernierToucher = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const enRoute = React.useRef(false);

  /* Une autre image : le zoom repart de l'image entière. */
  React.useEffect(() => {
    setCadrage(CADRAGE_INITIAL);
    naturelle.current = null;
  }, [courante.id]);

  React.useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const mesurer = () => {
      taille.current = { l: el.clientWidth || 1, h: el.clientHeight || 1 };
    };
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const borner = React.useCallback(
    (c: Cadrage) => bornerCadrage(c, tailleContenue(naturelle.current, taille.current), taille.current),
    [],
  );

  /** Le point d'un événement, relatif au CENTRE de la scène. */
  const pointDe = (clientX: number, clientY: number): Point => {
    const r = scene.current!.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  };

  const partir = React.useCallback(
    (decalage: number) => {
      if (!feuilletable || enRoute.current) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        aller(decalage);
        return;
      }
      enRoute.current = true;
      setAnime(true);
      setGlisse(decalage > 0 ? -taille.current.l : taille.current.l);
      window.setTimeout(() => {
        // Tout part dans le même rendu : la vue voisine devient la courante, sans saut.
        setAnime(false);
        setGlisse(0);
        enRoute.current = false;
        aller(decalage);
      }, DUREE_DE_PASSAGE_MS);
    },
    [feuilletable, aller],
  );
  React.useImperativeHandle(ref, () => ({ partir }), [partir]);

  /* LA MOLETTE ZOOME autour du curseur. Écoute non passive : la page, derrière, ne défile pas. */
  React.useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const surMolette = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const p = pointDe(e.clientX, e.clientY);
      setFluide(false);
      setCadrage((c) => borner(zoomerAutour(c, c.echelle * facteurDeMolette(e.deltaY, e.ctrlKey), p)));
    };
    el.addEventListener('wheel', surMolette, { passive: false });
    return () => el.removeEventListener('wheel', surMolette);
  }, [borner]);

  const revenir = () => {
    setAnime(true);
    setGlisse(0);
  };

  const surAppui = (e: React.PointerEvent) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || enRoute.current) return;
    try {
      scene.current?.setPointerCapture(e.pointerId);
    } catch {
      /* un pointeur fabriqué par un contrôle : les écouteurs suffisent */
    }
    pointeurs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setFluide(false);
    if (pointeurs.current.size === 1) {
      geste.current = {
        genre: cadrage.echelle > 1 ? 'deplace' : 'glisse',
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        depart: cadrage,
        bouge: false,
      };
      setEnMain(true);
    } else if (pointeurs.current.size === 2) {
      const [a, b] = [...pointeurs.current.values()] as [Point, Point];
      geste.current = {
        genre: 'pince',
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        milieu: pointDe((a.x + b.x) / 2, (a.y + b.y) / 2),
        depart: cadrage,
      };
      if (glisse) revenir();
    }
  };

  const surMouvement = (e: React.PointerEvent) => {
    if (!pointeurs.current.has(e.pointerId)) return;
    pointeurs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = geste.current;
    if (!g) return;
    if (g.genre === 'pince') {
      if (pointeurs.current.size < 2) return;
      const [a, b] = [...pointeurs.current.values()] as [Point, Point];
      const milieu = pointDe((a.x + b.x) / 2, (a.y + b.y) / 2);
      const zoome = zoomerAutour(g.depart, g.depart.echelle * (Math.hypot(a.x - b.x, a.y - b.y) / g.distance), g.milieu);
      setCadrage(borner({ ...zoome, x: zoome.x + milieu.x - g.milieu.x, y: zoome.y + milieu.y - g.milieu.y }));
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.bouge && Math.hypot(dx, dy) > SEUIL_DE_CLIC_PX) g.bouge = true;
    if (!g.bouge) return;
    if (g.genre === 'deplace') setCadrage(borner({ ...g.depart, x: g.depart.x + dx, y: g.depart.y + dy }));
    else if (feuilletable) {
      setAnime(false);
      setGlisse(dx);
    }
  };

  const surLacher = (e: React.PointerEvent) => {
    if (!pointeurs.current.delete(e.pointerId)) return;
    const g = geste.current;
    if (!g) return;
    if (g.genre === 'pince') {
      // Un doigt reste posé : il continue de déplacer l'image, sans jamais compter pour un toucher.
      const reste = [...pointeurs.current.values()][0];
      geste.current = reste ? { genre: 'deplace', x: reste.x, y: reste.y, t: performance.now(), depart: cadrage, bouge: true } : null;
      if (!reste) setEnMain(false);
      return;
    }
    if (pointeurs.current.size) return;
    geste.current = null;
    setEnMain(false);
    if (!g.bouge) {
      const p = pointDe(e.clientX, e.clientY);
      if (e.pointerType === 'mouse') {
        setFluide(true);
        setCadrage((c) => borner(basculerZoom(c, p)));
        return;
      }
      const avant = dernierToucher.current;
      const maintenant = performance.now();
      if (avant && maintenant - avant.t < DOUBLE_TOUCHER_MS && Math.hypot(e.clientX - avant.x, e.clientY - avant.y) < 40) {
        dernierToucher.current = null;
        setFluide(true);
        setCadrage((c) => borner(basculerZoom(c, p)));
      } else dernierToucher.current = { t: maintenant, x: e.clientX, y: e.clientY };
      return;
    }
    if (g.genre === 'glisse' && feuilletable) {
      const sens = glissementFranchi(e.clientX - g.x, e.clientY - g.y, performance.now() - g.t, taille.current.l);
      if (sens) partir(sens);
      else revenir();
    }
  };

  const surAbandon = (e: React.PointerEvent) => {
    pointeurs.current.delete(e.pointerId);
    if (pointeurs.current.size) return;
    geste.current = null;
    setEnMain(false);
    if (glisse) revenir();
  };

  const zoome = cadrage.echelle > 1.001;
  return (
    <div
      ref={scene}
      className={cn(
        'relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-bg',
        zoome ? (enMain ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
      )}
      style={{ touchAction: 'none' }}
      onPointerDown={surAppui}
      onPointerMove={surMouvement}
      onPointerUp={surLacher}
      onPointerCancel={surAbandon}
      data-scene-image
      data-zoom={cadrage.echelle.toFixed(2)}
      data-feuilletage={repere}
      data-visionneuse
      data-image-montree={courante.id}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: glisse ? `translate3d(${glisse}px, 0, 0)` : undefined,
          transition: anime ? `transform ${DUREE_DE_PASSAGE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : undefined,
        }}
        data-piste-carrousel
      >
        {vues.map((vue, place) => {
          if (!vue || (place !== 1 && !feuilletable)) return null;
          // Deux images : la précédente et la suivante sont la même — chaque place garde sa clé.
          const doublon = place !== 1 && vues[0]?.id === vues[2]?.id;
          return (
            <div
              key={doublon ? `${vue.id}@${place}` : vue.id}
              className="absolute inset-0 flex items-center justify-center"
              style={place === 1 ? undefined : { transform: `translate3d(${(place - 1) * 100}%, 0, 0)` }}
              aria-hidden={place !== 1}
            >
              {estUneImage(vue) ? (
                <img
                  src={sourceDe(vue)}
                  alt={etiquetteDePiece(vue)}
                  draggable={false}
                  onLoad={
                    place === 1
                      ? (ev) => {
                          const img = ev.currentTarget;
                          naturelle.current = { l: img.naturalWidth, h: img.naturalHeight };
                        }
                      : undefined
                  }
                  className="pointer-events-none h-full w-full select-none object-contain"
                  style={
                    place === 1
                      ? {
                          transform: zoome ? `translate3d(${cadrage.x}px, ${cadrage.y}px, 0) scale(${cadrage.echelle})` : undefined,
                          transition: fluide ? 'transform 200ms ease-out' : undefined,
                          willChange: 'transform',
                        }
                      : undefined
                  }
                  {...(place === 1 ? { 'data-image-visionneuse': vue.id } : {})}
                />
              ) : (
                <p className="px-6 text-center text-[13.5px] text-faint">{etiquetteDePiece(vue)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * LES GRANDES FLÈCHES SUR LES BORDS. Elles ne s'éteignent jamais : le carrousel
 * BOUCLE (après la dernière image vient la première). Elles n'arrêtent ni le
 * glissement ni le pincement : le geste naît sur l'image, pas sur elles.
 */
function FlecheDeFeuilletage({ sens, onClick }: { sens: 'precedente' | 'suivante'; onClick: () => void }) {
  const libelle = sens === 'precedente' ? t('Image précédente') : t('Image suivante');
  const Icone = sens === 'precedente' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={libelle}
      title={libelle}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      {...{ [sens === 'precedente' ? 'data-feuilletage-precedente' : 'data-feuilletage-suivante']: '' }}
      {...{ [sens === 'precedente' ? 'data-image-precedente' : 'data-image-suivante']: '' }}
      className={cn(
        'absolute top-1/2 z-10 flex h-12 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-surface/75 text-text shadow-md backdrop-blur-sm transition-opacity sm:h-14 sm:w-11',
        'opacity-90 hover:bg-surface hover:opacity-100 focus-visible:opacity-100',
        sens === 'precedente' ? 'left-2 sm:left-4' : 'right-2 sm:right-4',
      )}
    >
      <Icone className="h-7 w-7" aria-hidden />
    </button>
  );
}

/**
 * PRÉPARER L'ARCHIVE : la liste part dans le CORPS (jamais dans l'adresse, qui
 * dépassait la taille permise dès ~300 images), le serveur la vérifie et rend
 * une adresse courte à télécharger. Un refus lève la raison du serveur.
 */
async function preparerLArchive(corps: CorpsDArchive, signal: AbortSignal): Promise<string> {
  const reponse = await fetch(ROUTE_ARCHIVE_DES_IMAGES, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
    signal,
  });
  const rendu = (await reponse.json().catch(() => ({}))) as Partial<LotDArchive> & { error?: string };
  if (!reponse.ok || !rendu.adresse) throw new Error(rendu.error ?? String(reponse.status));
  return rendu.adresse;
}

/**
 * TÉLÉCHARGER DEPUIS LA VISIONNEUSE — par le chemin commun (`useTelechargement` :
 * feuille de partage sur téléphone, téléchargement ordinaire sur ordinateur).
 * Une seule image : un bouton. Plusieurs : un petit menu, « Cette image »,
 * « Tout en une archive (.zip) » (`/api/attachments/archive`, même contrôle
 * d'accès que chaque pièce) ou « Toutes séparément ». Les noms enregistrés sont
 * les VRAIS (`name`), jamais l'étiquette « #alias ».
 */
function TelechargementDeLaVisionneuse({
  piece,
  images,
  sourceDe,
  nomDuLot,
}: {
  piece: Attachment;
  images: Attachment[];
  sourceDe: (piece: Attachment) => string;
  nomDuLot: string;
}) {
  const source = sourceDe(piece);
  const cette = useTelechargement(
    React.useMemo(() => [{ adresse: pourEnregistrer(source), nom: piece.name }], [source, piece.name]),
  );
  const toutes = React.useMemo(() => images.map((p) => ({ adresse: pourEnregistrer(sourceDe(p)), nom: p.name })), [images, sourceDe]);
  const separees = useTelechargement(toutes);
  const corpsDuLot = React.useMemo(() => corpsDArchive(images.map(sourceDe), nomDuLot), [images, sourceDe, nomDuLot]);
  const tropPourUneArchive = images.length > MAX_IMAGES_PAR_ARCHIVE;
  const archive = useTelechargement(
    React.useMemo(
      () =>
        corpsDuLot && !tropPourUneArchive
          ? [
              {
                // Une clé, pas une adresse suivie : la vraie vient de la préparation.
                adresse: `${ROUTE_ARCHIVE_DES_IMAGES}#${[...corpsDuLot.ids, ...corpsDuLot.chemins].join(',')}`,
                nom: nomDArchiveDImages(nomDuLot),
                preparer: (signal: AbortSignal) => preparerLArchive(corpsDuLot, signal),
              },
            ]
          : [],
      [corpsDuLot, tropPourUneArchive, nomDuLot],
    ),
  );
  const enCours = [cette, separees, archive].find((d) => d.etat === 'reception');
  const pret = [cette, separees, archive].find((d) => d.etat === 'pret');
  const pastille = enCours ? (
    <>
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span className="text-[11.5px] tabular-nums">{enCours.pourcent} %</span>
    </>
  ) : (
    <Download className="h-3.5 w-3.5" />
  );

  /* LE SYSTÈME RÉCLAME UN NOUVEAU TOUCHER : le bouton le dit, et ce toucher enregistre. */
  if (pret) {
    return (
      <Button variant="ghost" size="sm" onClick={pret.lancer} className="h-8 shrink-0 bg-sur-etat/20 px-2" data-telecharger-image={piece.id} data-etat="pret">
        <Download className="h-3.5 w-3.5" />
        <span className="text-[12px]">{t('Enregistrer')}</span>
      </Button>
    );
  }
  if (images.length < 2 || !estUneImage(piece)) {
    return (
      <Tooltip label={t('Télécharger')}>
        <Button
          variant="ghost"
          size={enCours ? 'sm' : 'icon-sm'}
          onClick={cette.lancer}
          className="shrink-0"
          aria-label="Telecharger"
          data-telecharger-image={piece.id}
          data-etat={enCours ? 'reception' : 'repos'}
        >
          {pastille}
        </Button>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={enCours ? 'sm' : 'icon-sm'}
          className="shrink-0"
          title={t('Télécharger')}
          aria-label="Telecharger"
          data-telecharger-image={piece.id}
          data-menu-telechargement
          data-etat={enCours ? 'reception' : 'repos'}
        >
          {pastille}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        <DropdownMenuItem onSelect={cette.lancer} data-telecharger="cette">
          <ImageIcon className="h-4 w-4" />
          {t('Cette image')}
        </DropdownMenuItem>
        {corpsDuLot ? (
          <DropdownMenuItem
            onSelect={archive.lancer}
            disabled={tropPourUneArchive}
            data-telecharger="archive"
            data-trop-d-images={tropPourUneArchive ? '' : undefined}
            className="data-[disabled]:cursor-default data-[disabled]:opacity-60"
          >
            <FileArchive className="h-4 w-4 shrink-0 self-start mt-0.5" />
            <span className="flex flex-col">
              {t('Tout en une archive (.zip) · {n}', { n: images.length })}
              {tropPourUneArchive ? (
                <span className="text-[12px] text-faint">
                  {t('Plus de {max} images : téléchargez-les séparément', { max: MAX_IMAGES_PAR_ARCHIVE.toLocaleString() })}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={separees.lancer} data-telecharger="separees">
          <Images className="h-4 w-4" />
          {t('Toutes séparément · {n}', { n: images.length })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LA VISIONNEUSE — UNE SEULE POUR TOUTE L'APPLICATION, espace client compris
 * (`Visionneuse` de `web/src/espace/pieces.tsx` n'en est qu'un adaptateur).
 *
 * Une fenêtre CENTRÉE de hauteur FIXE (`FenetreDeVisionneuse`) : l'image occupe
 * toute la hauteur de la scène, quel que soit son format. Avec une GALERIE (les
 * images d'un même lieu), on passe de l'une à l'autre en glissant, aux flèches
 * du clavier ou aux grandes flèches, en BOUCLE ; un repère « n / total » dit où
 * l'on est. Vidéo, PDF et Markdown sont servis dans le même corps.
 *
 * Sans `onNaviguer`, la visionneuse tient elle-même l'image montrée : un
 * appelant n'a qu'à donner `galerie`.
 *
 * SOUS LE NOM, LA DATE ET L'HEURE de la pièce montrée — partout où la
 * visionneuse s'ouvre, dès que cette date est connue ; rien quand elle ne l'est
 * pas, plutôt qu'une date fausse. Un appelant qui en sait plus que la pièce
 * (`quandDe` : l'heure où l'agent a regardé l'image, que sa vignette affiche
 * déjà) la donne, pour que les deux endroits disent la même heure. `dejaVue`
 * pose un œil devant : l'image avait déjà été ouverte par ce compte.
 */
export function AttachmentPreview({
  item,
  onClose,
  galerie,
  onNaviguer,
  sourceDe = sourceDUnePiece,
  adresse = 'apercu-piece',
  nomDuLot,
  quandDe,
  dejaVue,
}: {
  item: Attachment | null;
  onClose: () => void;
  /** Les pièces entre lesquelles on feuillette, dans l'ordre. */
  galerie?: Attachment[];
  /** Appelée avec la pièce voisine : l'appelant la pose comme pièce ouverte. */
  onNaviguer?: (piece: Attachment) => void;
  /** D'où se lit l'image d'une pièce : par défaut, la route des pièces jointes. */
  sourceDe?: (piece: Attachment) => string;
  /** Le nom de la fenêtre dans l'adresse du navigateur. */
  adresse?: string;
  /** Le nom de l'archive « tout télécharger ». */
  nomDuLot?: string;
  /** L'heure à montrer pour une pièce, quand l'appelant en connaît une plus juste que sa date. */
  quandDe?: (piece: Attachment) => number | undefined;
  /** Cette pièce avait-elle déjà été ouverte en grand ? Sans réponse, aucun œil. */
  dejaVue?: (piece: Attachment) => boolean;
}) {
  /* L'image montrée : celle de l'appelant, ou celle où l'on a navigué depuis. */
  const [choisie, setChoisie] = React.useState<string | null>(null);
  const [pour, setPour] = React.useState(item?.id);
  if (pour !== item?.id) {
    setPour(item?.id);
    setChoisie(null);
  }
  const courante = (choisie && galerie?.find((p) => p.id === choisie)) || item;
  const rang = courante && galerie ? galerie.findIndex((p) => p.id === courante.id) : -1;
  const total = galerie?.length ?? 0;
  const feuilletable = rang >= 0 && total > 1;
  const voisine = (d: number) => (feuilletable ? galerie![rangVoisin(rang, d, total)]! : null);

  const aller = React.useCallback(
    (decalage: number) => {
      if (!feuilletable || !galerie) return;
      const cible = galerie[rangVoisin(rang, decalage, total)]!;
      if (onNaviguer) onNaviguer(cible);
      else setChoisie(cible.id);
    },
    [feuilletable, galerie, rang, total, onNaviguer],
  );
  const pilote = React.useRef<PiloteDeScene>(null);
  const partir = React.useCallback((d: number) => (pilote.current ? pilote.current.partir(d) : aller(d)), [aller]);

  /* Le clavier : ← → bouclent, comme les flèches. */
  React.useEffect(() => {
    if (!feuilletable) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cible = e.target as HTMLElement | null;
      if (cible?.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return;
      e.preventDefault();
      partir(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [feuilletable, partir]);

  /* Les deux voisines se chargent d'avance, en bouclant : le passage est immédiat. */
  const avant = voisine(-1);
  const apres = voisine(1);
  React.useEffect(() => {
    for (const v of [avant, apres]) if (estUneImage(v)) new Image().src = sourceDe(v!);
  }, [avant, apres, sourceDe]);

  // Les crochets se posent AVANT la sortie anticipée.
  const { markdown, format, setFormat } = useFormatApercu(courante?.name, courante?.mime);
  const apercuDeLaPiece = useApercuDePiece(courante);
  const [texte, setTexte] = React.useState<string | null>(null);
  const images = React.useMemo(
    () => (galerie?.length ? galerie.filter(estUneImage) : courante ? [courante] : []),
    [galerie, courante],
  );

  /* Une pièce jointe Markdown n'est pas déjà en mémoire, contrairement à un
     fichier du projet : on va la chercher, une seule fois, à l'ouverture. */
  React.useEffect(() => {
    setTexte(null);
    if (!courante || !markdown) return;
    let vivant = true;
    fetch(`/api/attachment?id=${courante.id}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((contenu) => vivant && setTexte(contenu))
      .catch(() => vivant && setTexte('_Lecture impossible._'));
    return () => {
      vivant = false;
    };
  }, [courante?.id, markdown]);

  if (!item || !courante) return null;
  const source = sourceDe(courante);
  const repere = feuilletable ? `${rang + 1}/${total}` : undefined;
  const quand = quandDe?.(courante) || courante.createdAt || 0;
  const vue = !!dejaVue?.(courante);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <FenetreDeVisionneuse adresse={adresse} data-visionneuse-total={total || 1} aria-describedby={undefined}>
        {/* LE MÊME EN-TÊTE QUE TOUTE FENÊTRE : le rang à gauche, le nom au
            milieu, les gestes puis la croix à droite. */}
        <DialogHeader
          sansCroix
          className="px-2 pb-2 pt-2"
          gauche={
            feuilletable ? (
              <span className="min-w-[3.2em] shrink-0 pl-2 text-[12.5px] tabular-nums text-faint" data-feuilletage-repere>
                {rang + 1} / {total}
              </span>
            ) : null
          }
          droite={
            <>
              {markdown ? <BasculeApercu format={format} onChange={setFormat} /> : null}
              <TelechargementDeLaVisionneuse
                piece={courante}
                images={images}
                sourceDe={sourceDe}
                nomDuLot={nomDuLot ?? t('Images')}
              />
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Fermer" title={t('Fermer')} data-fermer-visionneuse>
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </>
          }
        >
          {/* LE NOM, ET SOUS LUI LA DATE : le nom garde sa place dans la rangée
              (32 px, comme le rang et les boutons), la date se glisse dessous. */}
          <div className="flex min-w-0 flex-col items-center">
            <div className="flex h-8 max-w-full items-center">
              <DialogTitle className="min-w-0 truncate text-[14.5px]">{etiquetteDePiece(courante)}</DialogTitle>
            </div>
            {quand || vue ? (
              <p className="-mt-1.5 flex items-center gap-1 text-[12px] leading-4 tabular-nums text-faint" data-visionneuse-sous-titre>
                {vue ? (
                  <span className="flex" title={t('Déjà vue')} data-visionneuse-vue>
                    <Eye className="h-3 w-3" aria-hidden />
                  </span>
                ) : null}
                {quand ? (
                  <span title={heureExacte(quand)} data-visionneuse-date={quand}>
                    {dateHeure(quand)}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        </DialogHeader>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {estUneImage(courante) && !markdown ? (
            <SceneDImages
              ref={pilote}
              vues={[avant, courante, apres]}
              sourceDe={sourceDe}
              aller={aller}
              feuilletable={feuilletable}
              repere={repere}
            />
          ) : (
            <ZoneDefilement
              fond="hsl(var(--raised))"
              classeEnveloppe="mx-3 mb-3 flex-1 rounded-md bg-raised"
              data-fenetre-corps
              data-feuilletage={repere}
              className="h-full overflow-x-auto p-2"
            >
              {markdown ? (
                texte === null ? (
                  <p className="p-4 text-[13.5px] text-faint">{t('Lecture…')}</p>
                ) : (
                  <ContenuTexte contenu={texte} format={format} />
                )
              ) : genreDuFichier(courante.mime) === 'video' ? (
                /* LE MÊME LECTEUR QUE DANS LE FIL — il n'y a pas deux jeux de
                   commandes à tenir d'accord. Déjà agrandi ici, il ne propose plus
                   que le plein écran. */
                <LecteurVideo
                  id={courante.id}
                  nom={etiquetteDePiece(courante)}
                  sansAgrandir
                  demarrer
                  apercu={apercuDeLaPiece}
                  className="mx-auto"
                />
              ) : courante.mime.startsWith('audio/') ? (
                /* LE MÊME LECTEUR SON QUE DANS LE FIL, en grand : plus de bâtons,
                   et la lecture part d'elle-même, comme la vidéo agrandie. */
                <div className="flex h-full min-h-[40dvh] items-center justify-center px-2 sm:px-6" data-visionneuse-son={courante.id}>
                  <LecteurSon
                    key={courante.id}
                    id={courante.id}
                    nom={etiquetteDePiece(courante)}
                    poids={courante.size}
                    batons={120}
                    demarrer
                    className="w-full max-w-[720px] bg-surface"
                  />
                </div>
              ) : courante.mime === 'application/pdf' ? (
                <iframe title={etiquetteDePiece(courante)} src={source} className="h-full min-h-[60dvh] w-full rounded" />
              ) : (
                <div className="p-6 text-center">
                  <p className="mb-3 text-[13.5px] text-faint">
                    {t('Ce type de fichier ne s\'affiche pas ici ({v0}).', { v0: bytes(courante.size) })}</p>
                  <Button variant="outline" size="sm" asChild>
                    <a href={pourEnregistrer(source)} download={courante.name} data-enregistrer-direct>
                      <Download className="h-3 w-3" />  {t('Télécharger')}
                    </a>
                  </Button>
                </div>
              )}
            </ZoneDefilement>
          )}
          {feuilletable ? (
            <>
              <FlecheDeFeuilletage sens="precedente" onClick={() => partir(-1)} />
              <FlecheDeFeuilletage sens="suivante" onClick={() => partir(1)} />
            </>
          ) : null}
        </div>
      </FenetreDeVisionneuse>
    </Dialog>
  );
}

/**
 * La vignette d'une pièce jointe dans un message. UNE IMAGE s'affiche et
 * s'agrandit au clic ; TOUT AUTRE FICHIER se télécharge au clic, sous son vrai
 * nom. Le rendu est celui de `PastilleDeFichier` — la même pièce que l'espace
 * client, pour ne pas tenir deux affichages d'accord à la main.
 *
 * Le nom MONTRÉ reste l'étiquette courte de la pièce (« #1a0c ») : c'est le
 * repère que l'agent et l'utilisateur se donnent dans le fil. Le nom
 * ENREGISTRÉ, lui, est le vrai (`item.name`).
 */
export function AttachmentThumb({
  item,
  onOpen,
  className,
  compact,
  vue,
}: {
  item: Attachment;
  onOpen: () => void;
  /** Cette image a déjà été ouverte en grand par ce compte : un œil dans le coin (images seulement). */
  vue?: boolean;
  className?: string;
  /** Dans la barre d'écriture, la vignette est plus petite : elle ne doit pas
      manger la hauteur du champ de texte sur téléphone. */
  compact?: boolean;
}) {
  const apercu = useApercuDePiece(item);
  if (item.mime.startsWith('image/')) {
    return (
      <VignetteDImage
        id={item.id}
        nom={etiquetteDePiece(item)}
        nomDuFichier={item.name}
        onApercu={onOpen}
        compact={compact}
        vue={vue}
        className={className}
      />
    );
  }

  /*
   * UNE VIDÉO SE REGARDE DANS LE FIL. Le lecteur ne charge que l'entête du
   * fichier (`preload="metadata"`) ; la lecture et les sauts dans le temps
   * demandent ensuite des morceaux (lecture partielle côté démon) — une vidéo
   * de 2 Go démarre donc sans être téléchargée en entier. Dans la barre
   * d'écriture (`compact`), elle reste une pastille.
   */
  if (!compact && genreDuFichier(item.mime) === 'video') {
    return (
      <figure className={cn('w-full max-w-[480px]', className)} data-video-fil={item.id}>
        <LecteurVideo id={item.id} nom={item.name} apercu={apercu} />
        <figcaption className="mt-1 min-w-0 truncate text-[12px] text-faint" title={item.name}>
          {etiquetteDePiece(item)} · {bytes(item.size)}
        </figcaption>
      </figure>
    );
  }

  /*
   * UN SON SE LIT DANS LE FIL AUSSI (mode « Réalisation » : voix off,
   * bruitages, musique), par le lecteur à onde (`LecteurSon`) : lecture / pause
   * à gauche, l'onde sur la largeur, et « agrandir » vers la visionneuse. Dans
   * la barre d'écriture, il reste une pastille.
   */
  if (!compact && item.mime.startsWith('audio/')) {
    return (
      <figure className={cn('w-full max-w-[480px]', className)} data-audio-fil={item.id}>
        <LecteurSon id={item.id} nom={etiquetteDePiece(item)} poids={item.size} onAgrandir={onOpen} />
        <figcaption className="mt-1 min-w-0 truncate text-[12px] text-faint" title={item.name}>
          {etiquetteDePiece(item)} · {bytes(item.size)}
        </figcaption>
      </figure>
    );
  }

  return (
    <PastilleDeFichier
      id={item.id}
      nom={etiquetteDePiece(item)}
      nomDuFichier={item.name}
      mime={item.mime}
      poids={item.size}
      compact={compact}
      className={className}
    />
  );
}
