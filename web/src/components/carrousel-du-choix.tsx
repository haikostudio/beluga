/**
 * LE CARROUSEL D'UN CHOIX À PLUSIEURS IMAGES (carte « Images groupées dans le fil », 19/11/2026).
 *
 * Quand un choix d'une question est composé de plusieurs images (une fiche en cinq visuels, une série), sa tuile les
 * feuillette sur place : flèches au survol (toujours visibles au doigt), points en bas, compteur « 2 / 5 », glissé du
 * doigt. FEUILLETER NE CHOISIT JAMAIS : les flèches et les points arrêtent leur geste (`stopPropagation`), seule la
 * coche du coin choisit. Un clic sur l'image (sans glisser) l'ouvre en grand, sur les images de CE choix.
 *
 * Règles reprises de la compétence « zoom et carrousel » : rang voisin en boucle (`rangVoisin`), seuil de glissement
 * commun (`glissementFranchi`), décalage par `transform`, jamais par `left`, couleurs par jetons du thème. La tuile
 * défile avec la question : `touch-action: pan-y`, le glissé vertical reste au fil.
 */
import * as React from 'react';
import { SEUIL_DE_CLIC_PX, glissementFranchi, rangVoisin } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ChevronLeft, ChevronRight } from '@/components/ui/icones';
import { ImageDePiece } from '@/components/pastille-de-fichier';

const arreter = (event: React.SyntheticEvent) => event.stopPropagation();

export function CarrouselDuChoix({
  images,
  alt,
  actif,
  onOuvrir,
  children,
}: {
  /** Les identifiants des pièces jointes d'image du choix, dans l'ordre (deux au moins). */
  images: readonly string[];
  alt: string;
  /** Le choix est retenu : son liseré violet. */
  actif: boolean;
  /** Ouvre l'image de ce rang en grand. */
  onOuvrir: (rang: number) => void;
  /** Ce qui se pose par-dessus (la lettre du choix). */
  children?: React.ReactNode;
}) {
  const total = images.length;
  const [rang, setRang] = React.useState(0);
  const [decalage, setDecalage] = React.useState(0);
  const [glisse, setGlisse] = React.useState(false);
  const depart = React.useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const scene = React.useRef<HTMLDivElement>(null);
  const aller = (d: number) => setRang((r) => rangVoisin(r, d, total));

  const finir = (event: React.PointerEvent<HTMLDivElement>, annule = false) => {
    const d = depart.current;
    depart.current = null;
    setGlisse(false);
    setDecalage(0);
    if (!d || d.id !== event.pointerId || annule) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    const largeur = scene.current?.clientWidth ?? 1;
    const sens = glissementFranchi(dx, dy, event.timeStamp - d.t, largeur);
    if (sens) aller(sens);
    else if (Math.hypot(dx, dy) < SEUIL_DE_CLIC_PX) onOuvrir(rang);
  };

  return (
    <div
      ref={scene}
      className={cn(
        'group/carrousel relative block aspect-square w-full touch-pan-y select-none overflow-hidden bg-raised',
        actif && 'ring-2 ring-inset ring-teinte',
      )}
      data-carrousel-du-choix={total}
      data-carrousel-rang={rang}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        depart.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
      }}
      onPointerMove={(event) => {
        const d = depart.current;
        if (!d || d.id !== event.pointerId) return;
        const dx = event.clientX - d.x;
        if (!glisse && Math.abs(dx) > SEUIL_DE_CLIC_PX && Math.abs(dx) > Math.abs(event.clientY - d.y)) {
          setGlisse(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        if (glisse || Math.abs(dx) > SEUIL_DE_CLIC_PX) setDecalage(dx);
      }}
      onPointerUp={(event) => finir(event)}
      onPointerCancel={(event) => finir(event, true)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          aller(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          aller(1);
        }
      }}
    >
      {/* LA PISTE : toutes les images côte à côte, déplacée d'un bloc par `transform`. */}
      <div
        className={cn('flex h-full w-full', !glisse && 'transition-transform duration-300 ease-out motion-reduce:transition-none')}
        style={{ transform: `translateX(calc(${-rang * 100}% + ${decalage}px))` }}
      >
        {images.map((id, i) => (
          <div key={`${id}-${i}`} className="h-full w-full shrink-0" data-carrousel-image={i} aria-hidden={i !== rang}>
            <ImageDePiece id={id} alt={`${alt} — ${i + 1} / ${total}`} className="pointer-events-none h-full w-full object-cover" />
          </div>
        ))}
      </div>
      {/* L'IMAGE MONTRÉE S'OUVRE EN GRAND, au clavier aussi (le clic de la souris passe par la scène). */}
      <button
        type="button"
        className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teinte"
        title={t('Ouvrir en grand')}
        aria-label={`${t('Ouvrir en grand')} — ${alt} ${rang + 1} / ${total}`}
        data-option-apercu-carrousel
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          /* Le clic de la souris est déjà lu au relâché de la scène ; seul le clavier passe ici. */
          if (event.detail === 0) onOuvrir(rang);
        }}
      />
      {children}
      {(['precedente', 'suivante'] as const).map((sens) => (
        <button
          key={sens}
          type="button"
          aria-label={sens === 'precedente' ? t('Image précédente') : t('Image suivante')}
          title={sens === 'precedente' ? t('Image précédente') : t('Image suivante')}
          data-carrousel-fleche={sens}
          onPointerDown={arreter}
          onPointerUp={arreter}
          onClick={(event) => {
            event.stopPropagation();
            aller(sens === 'precedente' ? -1 : 1);
          }}
          className={cn(
            'absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-surface/80 text-text transition-opacity',
            sens === 'precedente' ? 'left-1.5' : 'right-1.5',
            /* Au survol de la souris seulement ; au doigt (pas de survol), toujours là. */
            '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/carrousel:opacity-100 focus-visible:opacity-100',
          )}
        >
          {sens === 'precedente' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ))}
      {/* LES POINTS ET LE COMPTEUR, en bas : où l'on en est dans la série. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-1" data-carrousel-points>
        {images.map((id, i) => (
          <button
            key={`${id}-point-${i}`}
            type="button"
            aria-label={`${i + 1} / ${total}`}
            aria-current={i === rang ? 'true' : undefined}
            onPointerDown={arreter}
            onPointerUp={arreter}
            onClick={(event) => {
              event.stopPropagation();
              setRang(i);
            }}
            className="pointer-events-auto flex h-4 w-3 items-center justify-center"
          >
            <span className={cn('block h-1.5 rounded-full transition-all', i === rang ? 'w-3 bg-text' : 'w-1.5 bg-text/40')} />
          </button>
        ))}
      </div>
      <span
        className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-surface/80 px-1 text-[11px] tabular-nums text-text"
        data-carrousel-compteur
      >
        {rang + 1} / {total}
      </span>
    </div>
  );
}
