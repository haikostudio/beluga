/**
 * LE PAQUET D'IMAGES DU FIL (carte « Images groupées dans le fil », 19/11/2026, capture #347e).
 *
 * Des images que l'agent joint (ou regarde) à la suite se posent EN JEU DE CARTES : la première devant, deux autres
 * qui dépassent derrière, et une pastille qui dit combien il y en a. Au survol de la SOURIS (ou au clavier), elles
 * S'ÉTALENT côte à côte À LEUR TAILLE PLEINE, et chacune porte alors son menu « … » (DEC-426). Une rangée plus large
 * que le fil DÉFILE à l'horizontale (carte « Images du fil en grand format », capture #6cf3c) : molette, pavé tactile
 * ou pouce de la barre fine, avec un fondu au bord tant qu'il reste des images derrière. Un clic ouvre la
 * visionneuse sur CE paquet seulement (« 1 / 5 »), jamais sur toutes les images de la carte.
 *
 * AU DOIGT (carte « Paquet d'images déplié sur mobile », 20/11/2026) : le PREMIER toucher étale la pile en ligne, qui
 * défile nativement au doigt ; un toucher sur une image de la ligne ouvre alors l'aperçu, borné au paquet. La ligne se
 * replie quand on touche AILLEURS (décision utilisateur) : un toucher dans le conteneur la laisse ouverte, un
 * défilement du fil ne la replie pas (il n'émet aucun `click`), et fermer l'aperçu ou le menu « … » non plus.
 *
 * Les positions viennent d'une règle pure (`placesDuPaquet`, shared/src/paquet-d-images.ts) et se posent en
 * `transform` ; la hauteur reste la même dans les deux états, le fil ne saute pas.
 */
import * as React from 'react';
import {
  CARTE_DU_PAQUET,
  ECART_ETALE,
  hauteurDuPaquet,
  largeurEtalee,
  placesDuPaquet,
  recitDeLEntree,
  type EntreeJournal,
} from '@beluga/shared';
import type { Attachment } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import { Images } from '@/components/ui/icones';
import { OuvrirDansUnPaquet, PieceDUneCapture, RepereDUneCapture } from '@/components/captures-du-flux';
import { noterLaLegende, useRangementDeLaCapture } from '@/components/cadre-de-media';
import { ContexteCarteDuFil, MenuDuMediaDuFil } from '@/components/menu-du-media';
import { AttachmentPreview } from '@/components/attachment-preview';

/** Une image du paquet : son chemin sur le disque et sa légende (le libellé donné par l'agent, sinon le nom du fichier). */
interface ImageDuPaquet {
  cle: string;
  chemin: string;
  legende: string;
}

function legendeDe(entree: EntreeJournal, chemin: string): string {
  try {
    const params = JSON.parse(entree.params ?? '{}') as { label?: unknown };
    if (typeof params.label === 'string' && params.label.trim()) return params.label.trim();
  } catch {
    /* des paramètres illisibles : le nom du fichier suffit */
  }
  return chemin.split('/').pop() ?? chemin;
}

/** La source d'une capture de l'agent, la même que sous une phrase seule. */
const sourceDe = (projectId: string, chemin: string) =>
  `/api/capture?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(chemin)}`;

/** L'étalement ne suit que la souris, et le clavier : un doigt n'a pas de survol. */
const AVEC_SURVOL = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/** Un toucher parti d'une fenêtre ou d'un menu posé PAR-DESSUS le fil (aperçu, menu « … », leur voile) n'est pas « ailleurs ». */
const CALQUES = '[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper],[data-voile-de-fenetre]';

export function PaquetDImages({
  entrees,
  projectId,
  phrase,
  pied,
}: {
  entrees: readonly EntreeJournal[];
  projectId?: string;
  /** La phrase du paquet, déjà traduite (« Je joins 5 fichiers à ma réponse. »). */
  phrase: string;
  /** L'heure du paquet, posée sous lui. */
  pied?: React.ReactNode;
}) {
  const images = React.useMemo<ImageDuPaquet[]>(
    () =>
      entrees
        .map((entree) => {
          const chemin = recitDeLEntree(entree).vignette;
          return chemin ? { cle: entree.id, chemin, legende: legendeDe(entree, chemin) } : null;
        })
        .filter((i): i is ImageDuPaquet => !!i),
    [entrees],
  );
  const chemins = React.useMemo(() => images.map((i) => i.chemin), [images]);
  const ouvrirDansLePaquet = React.useContext(OuvrirDansUnPaquet);
  const [etale, setEtale] = React.useState(false);
  /** Étalé AU DOIGT : il ne se replie qu'au toucher ailleurs (pas de survol à quitter). */
  const [auDoigt, setAuDoigt] = React.useState(false);
  /** Le genre du dernier pointeur posé sur le cadre : un appareil hybride (écran tactile + souris) décide par geste. */
  const dernierPointeur = React.useRef<string>('');
  const racine = React.useRef<HTMLDivElement>(null);
  /* LA PISTE RESTE LARGE LE TEMPS DU REPLI : rétrécie d'un coup, elle ramènerait le défilement à 0 en un saut, et les
     cartes repartiraient d'une position décalée. Elle se resserre une fois l'éventail refermé. */
  const [pisteLarge, setPisteLarge] = React.useState(false);
  const [perdues, setPerdues] = React.useState<ReadonlySet<string>>(new Set());
  /* SANS GALERIE DE CARTE (fil d'un agent sans carte), le paquet ouvre sa propre visionneuse, bornée à lui. */
  const [ouverte, setOuverte] = React.useState<Attachment | null>(null);
  /** La zone qui défile à l'horizontale (celle de `ZoneDefilement`). */
  const rangee = React.useRef<HTMLDivElement>(null);
  const nombre = images.length - perdues.size;

  React.useEffect(() => {
    if (etale) {
      setPisteLarge(true);
      return;
    }
    const minuterie = window.setTimeout(() => setPisteLarge(false), 320 + nombre * 18);
    return () => window.clearTimeout(minuterie);
  }, [etale, nombre]);

  /* LA MOLETTE VERTICALE FAIT DÉFILER LA RANGÉE, tant qu'il reste des images de ce côté ; en butée, elle rend la main
     au fil, qui défile comme avant. Écouteur NON passif posé à la main : `onWheel` de React ne peut pas l'arrêter. Le
     pavé tactile et Maj + molette (geste horizontal) passent tels quels, nativement. */
  React.useEffect(() => {
    const zone = rangee.current;
    if (!zone || !etale) return;
    const auDefilement = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const reste = zone.scrollWidth - zone.clientWidth;
      if (reste <= 1) return;
      const pas = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * zone.clientWidth : event.deltaY;
      if ((pas < 0 && zone.scrollLeft <= 0) || (pas > 0 && zone.scrollLeft >= reste - 1)) return;
      event.preventDefault();
      zone.scrollLeft += pas;
    };
    zone.addEventListener('wheel', auDefilement, { passive: false });
    return () => zone.removeEventListener('wheel', auDefilement);
  }, [etale]);

  /* LE REPLI AU TOUCHER AILLEURS, seulement pour une ligne étalée au doigt. Sur `click` et non sur `pointerdown` :
     faire défiler le fil n'émet aucun clic, il ne replie donc rien. Un clic dont l'appui est parti d'un calque
     (aperçu, menu « … », leur voile) est ignoré : on retrouve la ligne étalée en refermant l'aperçu. */
  React.useEffect(() => {
    if (!etale || !auDoigt) return;
    let departDedans = false;
    const dedans = (cible: EventTarget | null) => {
      const noeud = cible instanceof Element ? cible : null;
      if (!noeud || !racine.current) return false;
      if (racine.current.contains(noeud)) return true;
      /* Un calque PAR-DESSUS le fil, pas celui qui le porte : sur téléphone, la page de la carte est elle-même une
         fenêtre (`role="dialog"`), et un toucher dedans hors du paquet est bien « ailleurs ». */
      const calque = noeud.closest(CALQUES);
      return !!calque && !calque.contains(racine.current);
    };
    const alAppui = (event: PointerEvent) => {
      departDedans = dedans(event.target);
    };
    const auClic = (event: MouseEvent) => {
      if (departDedans || dedans(event.target)) return;
      rangee.current?.scrollTo({ left: 0, behavior: 'smooth' });
      setEtale(false);
      setAuDoigt(false);
    };
    document.addEventListener('pointerdown', alAppui, true);
    document.addEventListener('click', auClic, true);
    return () => {
      document.removeEventListener('pointerdown', alAppui, true);
      document.removeEventListener('click', auClic, true);
    };
  }, [etale, auDoigt]);

  if (!projectId || images.length === 0) return null;
  const visibles = images.filter((i) => !perdues.has(i.cle));
  const places = placesDuPaquet(visibles.length, etale);
  const largeurDeLaPiste = etale || pisteLarge ? largeurEtalee(visibles.length) : CARTE_DU_PAQUET.largeur + 2 * ECART_ETALE + 12;
  for (const image of images) noterLaLegende(image.chemin, image.legende);

  const piecesDeSecours: Attachment[] = visibles.map((image) => ({
    id: image.chemin,
    projectId,
    name: image.legende,
    mime: 'image/png',
    size: 0,
    sha: '',
    createdAt: 0,
  }));
  /** Le toucher (ou le clic) sur une carte : au doigt, une pile fermée S'ÉTALE d'abord ; sinon l'aperçu s'ouvre. */
  const toucherUneCarte = (rang: number, event: React.MouseEvent) => {
    const doigt = event.detail > 0 && (dernierPointeur.current === 'touch' || dernierPointeur.current === 'pen');
    if (!etale && doigt) {
      setEtale(true);
      setAuDoigt(true);
      return;
    }
    ouvrir(etale ? rang : 0);
  };
  const ouvrir = (rang: number) => {
    const image = visibles[rang];
    if (!image) return;
    if (ouvrirDansLePaquet?.(image.chemin, visibles.map((i) => i.chemin))) return;
    setOuverte(piecesDeSecours[rang] ?? null);
  };

  return (
    <div ref={racine} className="min-w-0" data-paquet-images={visibles.length} data-paquet-etale={etale ? '1' : '0'}>
      <p className="flex min-w-0 items-center gap-1.5 break-words text-[14.5px] leading-relaxed text-muted texte-copiable" data-paquet-phrase>
        <span className="min-w-0">{phrase}</span>
      </p>
      <div
        className="relative mt-1 flex w-full"
        style={{ height: hauteurDuPaquet() }}
        data-paquet-cadre
        onPointerDownCapture={(event) => {
          dernierPointeur.current = event.pointerType;
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse' && AVEC_SURVOL()) setEtale(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse') return;
          /* Retour au début AVANT de replier : la pile se reforme toujours à gauche. Le pouce de la barre est dans le
             cadre, et il capture son pointeur : le saisir ne replie rien. */
          rangee.current?.scrollTo({ left: 0, behavior: 'smooth' });
          setEtale(false);
          setAuDoigt(false);
        }}
        onFocus={(event) => {
          /* Le CLAVIER étale le paquet ; un toucher qui donne le focus, non (au doigt, pas d'étalement). */
          if ((event.target as HTMLElement).matches?.(':focus-visible')) setEtale(true);
        }}
        onBlur={(event) => {
          /* Étalé au doigt, le focus qui part (vers l'aperçu, vers rien) ne replie pas : seul un toucher ailleurs le fait. */
          if (!auDoigt && !event.currentTarget.contains(event.relatedTarget as Node | null)) setEtale(false);
        }}
      >
        {/* LA RANGÉE QUI DÉFILE, par la zone commune : barre fine dessinée PAR-DESSUS (aucune hauteur prise, le fil ne
            saute pas) et fondu aux bords seulement quand il reste des images derrière. En pile, rien ne déborde. */}
        <ZoneDefilement
          ref={rangee}
          axe="horizontal"
          voile
          hauteur={36}
          jusquAuBord={false}
          classeEnveloppe="h-full min-w-0"
          className="h-full"
          data-paquet-rangee=""
        >
          {/* `isolate` : les plans des cartes (jusqu'au nombre d'images) restent DANS la piste, sous le fondu des bords. */}
          <div className="relative isolate h-full" style={{ width: largeurDeLaPiste }} data-paquet-piste>
            {visibles.map((image, rang) => (
              <CarteDuPaquet
                key={image.cle}
                image={image}
                projectId={projectId}
                rang={rang}
                total={visibles.length}
                place={places[rang]!}
                etale={etale}
                onOuvrir={(event) => toucherUneCarte(rang, event)}
                onPerdue={() => setPerdues((courant) => new Set(courant).add(image.cle))}
              />
            ))}
            {/* LA PASTILLE DU NOMBRE, sur la carte de devant, tant que le paquet est fermé. */}
            <span
              aria-hidden
              data-paquet-nombre={visibles.length}
              className={cn(
                'pointer-events-none absolute flex h-6 items-center gap-1 rounded-full bg-surface/90 px-2 text-[12px] font-medium tabular-nums text-text transition-opacity duration-200 motion-reduce:transition-none',
                etale ? 'opacity-0' : 'opacity-100',
              )}
              style={{ left: CARTE_DU_PAQUET.largeur - 8, top: 6, transform: 'translateX(-100%)', zIndex: visibles.length + 1 }}
            >
              <Images className="h-3.5 w-3.5" />
              {visibles.length}
            </span>
          </div>
        </ZoneDefilement>
      </div>
      {pied}
      {/* LA VISIONNEUSE DU PAQUET LUI-MÊME, quand la galerie de la carte ne le connaît pas en entier (images jointes
          pas encore rangées, fil sans carte) : bornée à lui, avec la légende de chaque image. */}
      <AttachmentPreview
        item={ouverte}
        onClose={() => setOuverte(null)}
        onNaviguer={setOuverte}
        galerie={piecesDeSecours}
        sourceDe={(piece) => sourceDe(projectId, piece.id)}
        legendeDe={(piece) => ({ reference: null, titre: piece.name })}
      />
    </div>
  );
}

function CarteDuPaquet({
  image,
  projectId,
  rang,
  total,
  place,
  etale,
  onOuvrir,
  onPerdue,
}: {
  image: ImageDuPaquet;
  projectId: string;
  rang: number;
  total: number;
  place: ReturnType<typeof placesDuPaquet>[number];
  etale: boolean;
  onOuvrir: (event: React.MouseEvent) => void;
  onPerdue: () => void;
}) {
  const [chargee, setChargee] = React.useState(false);
  const repereDuChemin = React.useContext(RepereDUneCapture);
  const pieceDuChemin = React.useContext(PieceDUneCapture);
  const carteDuFil = React.useContext(ContexteCarteDuFil);
  const reference = repereDuChemin?.(image.chemin) ?? null;
  const piece = pieceDuChemin?.(image.chemin) ?? null;
  /* TOUTE IMAGE DU FIL A SA RÉFÉRENCE : une capture qui n'en a pas encore est rangée en pièce, comme sous une phrase. */
  useRangementDeLaCapture(projectId, image.chemin, !!reference, chargee && !!repereDuChemin);
  const largeur = CARTE_DU_PAQUET.largeur * place.echelle;
  const hauteur = CARTE_DU_PAQUET.hauteur * place.echelle;
  return (
    <>
      <button
        type="button"
        onClick={onOuvrir}
        title={image.legende}
        aria-label={`${t('Ouvrir en grand')} — ${image.legende}`}
        tabIndex={etale || rang === 0 ? 0 : -1}
        data-paquet-carte={rang}
        data-paquet-chemin={image.chemin}
        data-reference-du-media={reference ?? undefined}
        className={cn(
          'absolute left-0 top-0 block overflow-hidden rounded-md bg-raised p-0.5 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
          /* Anneau INTÉRIEUR : la rangée qui défile rogne ce qui sort de ses bords. */
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teinte',
          place.visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{
          width: CARTE_DU_PAQUET.largeur,
          height: CARTE_DU_PAQUET.hauteur,
          zIndex: place.plan,
          transformOrigin: '0 0',
          transform: `translate(${place.x}px, ${place.y}px) rotate(${place.angle}deg) scale(${place.echelle})`,
          /* L'éventail s'ouvre carte après carte, d'un souffle. */
          transitionDelay: `${(etale ? rang : total - 1 - rang) * 18}ms`,
        }}
      >
        {!chargee ? <span aria-hidden data-silhouette-image className="absolute inset-0 animate-silhouette rounded bg-faint/25" /> : null}
        <img
          src={sourceDe(projectId, image.chemin)}
          alt={image.legende}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setChargee(true)}
          ref={(el) => {
            if (el?.complete && el.naturalWidth && !chargee) setChargee(true);
          }}
          onError={onPerdue}
          className={cn('block h-full w-full rounded object-cover transition-opacity duration-200', chargee ? 'opacity-100' : 'opacity-0')}
        />
      </button>
      {/* LE MENU « … » DE CHAQUE IMAGE (DEC-426), hors de la carte mise à l'échelle : il garde sa taille, au coin de la
          vignette étalée. Paquet fermé, il se retire — la pile n'en montrerait qu'un seul. */}
      {etale && chargee && carteDuFil && piece ? (
        <div
          className="pointer-events-none absolute left-0 top-0 [&>*]:pointer-events-auto"
          style={{ width: largeur, height: hauteur, transform: `translate(${place.x}px, ${place.y}px)`, zIndex: total + 2 }}
          data-paquet-menu={rang}
        >
          <MenuDuMediaDuFil cardId={carteDuFil} attachmentId={piece} />
        </div>
      ) : null}
    </>
  );
}
