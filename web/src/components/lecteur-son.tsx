import * as React from 'react';
import { Maximize2, Pause, Play } from 'lucide-react';
import { POIDS_MAX_POUR_L_ONDE, instantDuPointeur, ondeDeRepli, picsDOnde } from '@beluga/shared';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { tempsDeLecture } from '@/components/lecteur-video';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE LECTEUR SON DU FIL — UN SEUL POUR TOUTE L'APPLICATION (fil, bande « Ce que
 * l'agent a vu », visionneuse, médias livrés).
 *
 * Décision de l'utilisateur : un bouton lecture / pause À GAUCHE, puis l'ONDE du
 * son sur toute la largeur ; la part déjà jouée se fonce, un clic ou un glisser
 * sur l'onde y emmène la lecture. La part jouée prend le violet (`teinte`),
 * la seule couleur de l'interface. Le lecteur du navigateur (`<audio controls>`)
 * n'est plus montré : il est là, caché, et ne précharge que l'entête.
 *
 * L'onde vient du VRAI fichier : il est décodé une fois par page (cache par
 * pièce), seulement s'il pèse moins de `POIDS_MAX_POUR_L_ONDE`. Au-delà, ou si
 * le décodage échoue, une onde inventée mais stable (`ondeDeRepli`) garde la
 * silhouette du lecteur. Un seul son joue à la fois dans la page.
 */

/** La résolution gardée en cache : chaque lecteur la ramène à son nombre de bâtons. */
const RESOLUTION = 400;
const ondes = new Map<string, Promise<number[] | null>>();

function ondeDuFichier(id: string): Promise<number[] | null> {
  const connue = ondes.get(id);
  if (connue) return connue;
  const promesse = (async () => {
    const reponse = await fetch(adresseDePiece(id), { credentials: 'same-origin' });
    if (!reponse.ok) return null;
    const donnees = await reponse.arrayBuffer();
    const Contexte: typeof OfflineAudioContext | undefined =
      (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Contexte) return null;
    // Décoder n'exige aucun geste : le contexte hors ligne ne joue rien.
    const contexte = new Contexte(1, 1, 44100);
    const son = await contexte.decodeAudioData(donnees);
    return picsDOnde(son.getChannelData(0), RESOLUTION);
  })().catch(() => null);
  ondes.set(id, promesse);
  return promesse;
}

/** Le son qui joue en ce moment : en lancer un autre le met en pause. */
let enLecture: HTMLAudioElement | null = null;

export function LecteurSon({
  id,
  nom,
  poids,
  compact,
  batons = compact ? 36 : 72,
  onAgrandir,
  demarrer,
  className,
}: {
  id: string;
  nom: string;
  /** Le poids du fichier : au-delà du plafond, l'onde n'est pas décodée. */
  poids?: number;
  /** Dans la bande : plus bas, la durée seule à droite. */
  compact?: boolean;
  batons?: number;
  /** Un bouton « agrandir » au bout de la ligne : ouvre la visionneuse. */
  onAgrandir?: () => void;
  /** La lecture démarre d'elle-même (la visionneuse). */
  demarrer?: boolean;
  className?: string;
}) {
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [lit, setLit] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [duree, setDuree] = React.useState(0);
  const [pics, setPics] = React.useState<number[] | null>(null);
  const [repli, setRepli] = React.useState(false);
  /* L'ONDE NE SE TÉLÉCHARGE QU'À L'ÉCRAN : un long fil plein de sons n'en
     décode aucun tant qu'on ne les voit pas. */
  const cadre = React.useRef<HTMLDivElement | null>(null);
  const [vu, setVu] = React.useState(false);
  React.useEffect(() => {
    const element = cadre.current;
    if (vu || !element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVu(true);
      return;
    }
    const observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) setVu(true);
    }, { rootMargin: '200px' });
    observateur.observe(element);
    return () => observateur.disconnect();
  }, [vu]);

  React.useEffect(() => {
    if (!vu) return;
    let vivant = true;
    setPics(null);
    setRepli(false);
    if (poids && poids > POIDS_MAX_POUR_L_ONDE) {
      setRepli(true);
      return;
    }
    void ondeDuFichier(id).then((onde) => {
      if (!vivant) return;
      if (onde) setPics(onde);
      else setRepli(true);
    });
    return () => {
      vivant = false;
    };
  }, [id, poids, vu]);

  const hauteurs = React.useMemo(
    () => (pics ? picsDOnde(pics, batons) : ondeDeRepli(id, batons)),
    [pics, batons, id],
  );

  React.useEffect(() => {
    if (!demarrer) return;
    const element = audio.current;
    if (element) void element.play().catch(() => undefined);
  }, [demarrer]);

  React.useEffect(
    () => () => {
      if (enLecture === audio.current) enLecture = null;
    },
    [],
  );

  const basculer = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  };

  /* Viser sur l'onde : au clic, et en glissant (pointeur capturé). */
  const glisse = React.useRef(false);
  const viser = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = audio.current;
    const zone = event.currentTarget.getBoundingClientRect();
    const total = element && Number.isFinite(element.duration) ? element.duration : duree;
    if (!element || !total) return;
    const instant = instantDuPointeur(event.clientX - zone.left, zone.width, total);
    element.currentTime = instant;
    setPosition(instant);
  };
  const auClavier = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const element = audio.current;
    if (!element || !duree) return;
    const pas = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0;
    if (!pas) return;
    event.preventDefault();
    element.currentTime = Math.min(duree, Math.max(0, element.currentTime + pas));
  };

  const part = duree > 0 ? Math.min(1, position / duree) : 0;
  const etatDeLOnde = pics ? 'decodee' : repli ? 'repli' : 'attente';

  return (
    <div
      ref={cadre}
      className={cn('flex min-w-0 items-center gap-2 rounded-lg bg-raised', compact ? 'h-10 px-1.5' : 'h-14 px-2', className)}
      data-lecteur-son={id}
      data-son-etat={lit ? 'lecture' : 'pause'}
      data-son-onde={etatDeLOnde}
      // Un geste sur le lecteur ne remonte pas à ce qui le porte (une vignette qui ouvrirait la visionneuse).
      onClick={(e) => e.stopPropagation()}
    >
      <audio
        ref={audio}
        src={adresseDePiece(id)}
        preload="metadata"
        className="hidden"
        onPlay={(e) => {
          if (enLecture && enLecture !== e.currentTarget) enLecture.pause();
          enLecture = e.currentTarget;
          setLit(true);
        }}
        onPause={() => setLit(false)}
        onEnded={() => setLit(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuree(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onDurationChange={(e) => setDuree(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
      />
      <button
        type="button"
        onClick={basculer}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-text text-surface transition-opacity hover:opacity-85',
          compact ? 'h-[34px] sm:h-7 w-[34px] sm:w-7' : 'h-[43px] sm:h-9 w-[43px] sm:w-9',
        )}
        aria-label={lit ? t('Mettre en pause') : t('Écouter')}
        title={lit ? t('Mettre en pause') : t('Écouter')}
        data-son-bascule
      >
        {lit ? <Pause className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} fill="currentColor" /> : <Play className={cn('translate-x-[1px]', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} fill="currentColor" />}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={nom}
        aria-valuemin={0}
        aria-valuemax={Math.round(duree)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${tempsDeLecture(position)} / ${tempsDeLecture(duree)}`}
        className={cn('flex min-w-0 flex-1 cursor-pointer touch-none items-center gap-[2px] self-stretch', compact ? 'py-2' : 'py-2.5')}
        onPointerDown={(e) => {
          glisse.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          viser(e);
        }}
        onPointerMove={(e) => glisse.current && viser(e)}
        onPointerUp={() => (glisse.current = false)}
        onPointerCancel={() => (glisse.current = false)}
        onKeyDown={auClavier}
        data-son-onde-zone
      >
        {hauteurs.map((h, i) => (
          <span
            key={i}
            className={cn('min-w-0 flex-1 rounded-full', (i + 0.5) / hauteurs.length <= part ? 'bg-teinte' : 'bg-faint/40')}
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </div>
      <span className={cn('shrink-0 text-right tabular-nums text-faint', compact ? 'text-[11px]' : 'min-w-[4.5em] text-[12px]')} data-son-temps>
        {compact ? tempsDeLecture(lit || position ? position : duree) : `${tempsDeLecture(position)} / ${tempsDeLecture(duree)}`}
      </span>
      {onAgrandir ? (
        <button
          type="button"
          onClick={onAgrandir}
          className="flex h-[34px] sm:h-7 w-[34px] sm:w-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-surface hover:text-text"
          aria-label={t('Ouvrir en grand')}
          title={t('Ouvrir en grand')}
          data-son-agrandir
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
