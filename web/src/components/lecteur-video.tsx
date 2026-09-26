/**
 * LE LECTEUR VIDÉO DE L'APPLICATION — UN SEUL, POUR LES DEUX ESPACES.
 *
 * Une vidéo jointe s'affichait avec le lecteur BRUT du navigateur
 * (`<video controls>`) : différent d'un appareil à l'autre, sans agrandissement
 * ni plein écran, et impossible à viser dans un contrôle. Il est remplacé par
 * ces commandes-ci, les mêmes partout : dans le fil d'une demande, dans la
 * discussion flottante, dans la conversation d'une carte et dans l'aperçu
 * d'une pièce jointe.
 *
 * RIEN N'EST TÉLÉCHARGÉ TANT QU'ON NE REGARDE PAS. `preload="metadata"` ne
 * demande que l'entête du fichier : une vidéo de 2 Go montre donc sa vignette
 * sans coûter 2 Go. La lecture et les sauts dans le temps demandent ensuite des
 * morceaux au démon (lecture partielle).
 *
 * LA VIGNETTE N'EST PLUS LA PREMIÈRE IMAGE. Elle l'était (`#t=0.1`), et c'était
 * une image noire une fois sur deux. Le lecteur SONDE maintenant quelques
 * instants répartis dans le fichier, garde le premier qui montre vraiment
 * quelque chose (`imageEstParlante`, `shared/src/apercu-video.ts`) et s'arrête
 * là. La recherche a un BUDGET : passé une seconde et demie, elle abandonne et
 * on retombe sur le tout début — le comportement d'avant, jamais une attente.
 *
 * UN INSTANT PEUT AUSSI ÊTRE DÉSIGNÉ À LA MAIN, pendant la lecture, et il vaut
 * alors pour tout le monde : il est écrit sur la pièce jointe
 * (`attachment.apercu`) et relu partout. Le bouton n'existe que si le parent
 * donne `onChoisirApercu` — l'espace client ne le donne pas, donc le client voit
 * l'aperçu mais ne le change pas.
 *
 * TROIS TAILLES, UN SEUL LECTEUR : posé dans la bulle, agrandi dans une fenêtre
 * à quatre cinquièmes de l'écran (`data-video-agrandir`), ou en vrai plein
 * écran (`data-video-pleinecran`, `requestFullscreen`).
 *
 * LES REPÈRES DES CONTRÔLES sont des ÉTATS, pas des pixels : `data-video-lit`
 * dit si ça joue, `data-video-position` où l'on en est, `data-video-apercu`
 * l'instant retenu comme vignette et `data-video-apercu-manuel` s'il a été
 * désigné. Un contrôle n'a donc jamais à mesurer une largeur de barre ni à
 * comparer des pixels.
 */
import * as React from 'react';
import { Download, Expand, ImageDown, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import {
  BUDGET_DE_RECHERCHE_MS,
  HAUTEUR_SONDE,
  LARGEUR_SONDE,
  SECONDE_DE_REPLI,
  imageEstParlante,
  instantDApercu,
  instantsACandidater,
} from '@beluga/shared';
import { Dialog, DialogContentLibre, DialogHeader, DialogTitle } from '@/components/ui';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Les vitesses proposées, dans l'ordre où le bouton les fait tourner. */
const VITESSES = [1, 1.25, 1.5, 2, 0.5] as const;

/** Un temps de lecture en clair : « 1:07 », jamais un nombre de secondes nu. */
export function tempsDeLecture(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes < 0) return '0:00';
  const entier = Math.floor(secondes);
  const h = Math.floor(entier / 3600);
  const m = Math.floor((entier % 3600) / 60);
  const s = entier % 60;
  const deux = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${deux(m)}:${deux(s)}` : `${m}:${deux(s)}`;
}

/**
 * LES INSTANTS DÉJÀ TROUVÉS, LE TEMPS DE LA PAGE. Une même vidéo s'affiche
 * souvent à plusieurs endroits (le fil, la fenêtre agrandie, la galerie) : sans
 * ce cache, chacun relancerait la même recherche sur le même fichier.
 */
const apercusTrouves = new Map<string, number>();

/** Emmener la vidéo à cet instant, et attendre que l'image y soit VRAIMENT. */
function allerA(video: HTMLVideoElement, instant: number, budgetMs: number): Promise<boolean> {
  return new Promise((resoudre) => {
    if (budgetMs <= 0) return resoudre(false);
    let fini = false;
    const ranger = (reponse: boolean) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      video.removeEventListener('seeked', surSaut);
      video.removeEventListener('error', surPanne);
      resoudre(reponse);
    };
    const surSaut = () => ranger(true);
    const surPanne = () => ranger(false);
    const minuteur = setTimeout(() => ranger(false), budgetMs);
    video.addEventListener('seeked', surSaut);
    video.addEventListener('error', surPanne);
    try {
      video.currentTime = instant;
    } catch {
      ranger(false);
    }
  });
}

/**
 * LA DURÉE, MÊME QUAND LE FICHIER NE LA DIT PAS.
 *
 * Un fichier produit en FLUX — un `.webm` enregistré depuis un navigateur, une
 * capture d'écran — n'écrit aucune durée dans son entête : le navigateur répond
 * `Infinity` tant qu'on n'a pas essayé d'aller à la fin. Sans ce détour, la
 * recherche d'une image parlante n'aurait aucun instant à sonder sur ces
 * fichiers-là, et ils garderaient tous leur première image.
 */
async function dureeSure(video: HTMLVideoElement, budgetMs: number): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise<void>((fini) => {
    let range = false;
    const ranger = () => {
      if (range) return;
      range = true;
      clearTimeout(minuteur);
      video.removeEventListener('durationchange', surDuree);
      fini();
    };
    const surDuree = () => {
      if (Number.isFinite(video.duration)) ranger();
    };
    const minuteur = setTimeout(ranger, budgetMs);
    video.addEventListener('durationchange', surDuree);
    try {
      // Aller « à la fin » : le navigateur découvre alors la vraie durée.
      video.currentTime = 1e6;
    } catch {
      ranger();
    }
  });
  try {
    video.currentTime = 0;
  } catch {
    /* Le repli suffit : la recherche s'arrêtera d'elle-même. */
  }
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
}

/**
 * LA RECHERCHE D'UNE IMAGE PARLANTE, sur la vidéo elle-même.
 *
 * Elle sonde les instants candidats l'un après l'autre, dessine chacun sur un
 * canvas minuscule et garde le premier qui a du relief. Elle ne télécharge PAS
 * le fichier : chaque saut ne demande au démon que le morceau nécessaire
 * (`accept-ranges`). Elle s'arrête au premier « non » : budget dépassé, écran
 * démonté, lecture lancée par l'utilisateur, ou navigateur qui refuse de
 * décoder hors écran — et l'appelant retombe alors sur le tout début.
 */
async function chercherLApercu(video: HTMLVideoElement, vivant: () => boolean): Promise<number | null> {
  const debut = Date.now();
  const restant = () => BUDGET_DE_RECHERCHE_MS - (Date.now() - debut);
  const duree = await dureeSure(video, restant());
  if (!vivant()) return null;
  const candidats = instantsACandidater(duree);
  if (!candidats.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR_SONDE;
  canvas.height = HAUTEUR_SONDE;
  const pinceau = canvas.getContext('2d', { willReadFrequently: true });
  if (!pinceau) return null;
  for (const instant of candidats) {
    if (!vivant() || restant() <= 0) return null;
    const atteint = await allerA(video, instant, restant());
    if (!atteint || !vivant()) return null;
    try {
      pinceau.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Même origine (`/api/attachment`) : le canvas n'est jamais souillé.
      if (imageEstParlante(pinceau.getImageData(0, 0, canvas.width, canvas.height).data)) return instant;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * L'INSTANT QUI S'AFFICHE, ET COMMENT ON Y ARRIVE — la règle est ici, une seule
 * fois, pour les quatre endroits où une vidéo se montre.
 *
 * Un instant DÉJÀ CONNU (choisi à la main, ou trouvé lors d'une visite
 * précédente et gardé sur la pièce) évite toute recherche : on saute, c'est
 * tout. Sinon la recherche part une fois, et son résultat remonte à l'appelant
 * (`onTrouve`) pour être gardé — la fois suivante, plus personne ne cherche.
 */
function useApercuVideo(options: {
  id: string;
  video: React.RefObject<HTMLVideoElement | null>;
  /** L'instant gardé sur la pièce jointe, s'il y en a un. */
  secondeConnue?: number;
  /** Ce qu'il faut faire de l'instant trouvé par la recherche automatique. */
  onTrouve?: (seconde: number) => void;
}): number {
  const { id, video, secondeConnue, onTrouve } = options;
  const [trouve, setTrouve] = React.useState<number | null>(() => apercusTrouves.get(id) ?? null);
  const rappel = React.useRef(onTrouve);
  rappel.current = onTrouve;

  React.useEffect(() => {
    const element = video.current;
    if (!element) return;
    let vivant = true;
    const connue = typeof secondeConnue === 'number' ? secondeConnue : apercusTrouves.get(id);

    const poser = async () => {
      if (!vivant) return;
      // La recherche ne dérange jamais une lecture en cours : elle n'a lieu
      // qu'avant le premier clic sur « Lire ».
      if (!element.paused || element.currentTime > 0.5) return;
      if (typeof connue === 'number') {
        const duree = await dureeSure(element, BUDGET_DE_RECHERCHE_MS);
        if (!vivant || !duree) return;
        await allerA(element, Math.min(connue, Math.max(0, duree - 0.05)), BUDGET_DE_RECHERCHE_MS);
        return;
      }
      const seconde = await chercherLApercu(element, () => vivant && element.paused);
      if (!vivant) return;
      if (seconde === null) {
        await allerA(element, SECONDE_DE_REPLI, BUDGET_DE_RECHERCHE_MS);
        return;
      }
      apercusTrouves.set(id, seconde);
      setTrouve(seconde);
      rappel.current?.(seconde);
    };

    if (element.readyState >= 1) void poser();
    const surEntete = () => void poser();
    element.addEventListener('loadedmetadata', surEntete);
    return () => {
      vivant = false;
      element.removeEventListener('loadedmetadata', surEntete);
    };
  }, [id, secondeConnue, video]);

  return instantDApercu({ choisi: secondeConnue, trouve });
}

export interface ApercuDeVideo {
  /** L'instant gardé sur la pièce jointe — choisi à la main ou trouvé une fois. */
  seconde?: number;
  /** Cet instant a-t-il été DÉSIGNÉ ? Alors on propose de revenir à l'automatique. */
  manuel?: boolean;
  /**
   * LE GESTE : « c'est cette image-là ». Absent, le bouton n'existe pas — c'est
   * ainsi que l'espace client voit l'aperçu sans pouvoir le changer.
   * `null` remet la recherche automatique aux commandes.
   */
  onChoisir?: (seconde: number | null) => void;
  /** Ce qu'on fait de l'instant trouvé par la recherche : le garder, ou rien. */
  onTrouve?: (seconde: number) => void;
}

export function LecteurVideo({
  id,
  nom,
  className,
  /** Dans une fenêtre déjà agrandie : plus de bouton « agrandir ». */
  sansAgrandir,
  /** La lecture démarre d'elle-même — la fenêtre agrandie le fait. */
  demarrer,
  apercu,
}: {
  id: string;
  nom: string;
  className?: string;
  sansAgrandir?: boolean;
  demarrer?: boolean;
  apercu?: ApercuDeVideo;
}) {
  const video = React.useRef<HTMLVideoElement | null>(null);
  const cadre = React.useRef<HTMLDivElement | null>(null);
  const [lit, setLit] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [duree, setDuree] = React.useState(0);
  const [muet, setMuet] = React.useState(false);
  const [vitesse, setVitesse] = React.useState(1);
  const [agrandie, setAgrandie] = React.useState(false);
  /* La vignette est posée sur l'instant d'aperçu : la lecture, elle, part du
     début. Sans ce repère, cliquer « Lire » reprendrait au milieu du fichier. */
  const jamaisLue = React.useRef(true);

  const instant = useApercuVideo({ id, video, secondeConnue: apercu?.seconde, onTrouve: apercu?.onTrouve });
  const source = adresseDePiece(id);

  const basculerLecture = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      if (jamaisLue.current) {
        jamaisLue.current = false;
        try {
          element.currentTime = 0;
        } catch {
          /* Un fichier qui refuse le saut se lit là où il en est. */
        }
      }
      void element.play().catch(() => undefined);
    } else element.pause();
  };

  /** « C'est cette image-là. » L'instant AFFICHÉ devient l'aperçu de la vidéo. */
  const choisirLImage = () => {
    const element = video.current;
    if (!element || !apercu?.onChoisir) return;
    apercu.onChoisir(Math.max(0, Math.round(element.currentTime * 100) / 100));
  };

  const changerLaVitesse = () => {
    const suivante = VITESSES[(VITESSES.indexOf(vitesse as (typeof VITESSES)[number]) + 1) % VITESSES.length]!;
    setVitesse(suivante);
    if (video.current) video.current.playbackRate = suivante;
  };

  const pleinEcran = () => {
    const element = cadre.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void element.requestFullscreen?.().catch(() => undefined);
  };

  const viser = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = video.current;
    const barre = event.currentTarget.getBoundingClientRect();
    if (!element || !barre.width || !Number.isFinite(element.duration)) return;
    const part = Math.min(1, Math.max(0, (event.clientX - barre.left) / barre.width));
    element.currentTime = part * element.duration;
    setPosition(element.currentTime);
  };

  React.useEffect(() => {
    if (!demarrer || !video.current) return;
    // Une fenêtre qui s'ouvre sur la lecture part du DÉBUT, pas de l'aperçu.
    jamaisLue.current = false;
    void video.current.play().catch(() => undefined);
  }, [demarrer]);

  const part = duree ? Math.min(1, position / duree) : 0;

  return (
    <>
      <div
        ref={cadre}
        className={cn(
          'relative w-full overflow-hidden rounded-lg bg-voile',
          sansAgrandir ? null : 'max-w-[480px]',
          className,
        )}
        data-lecteur-video={id}
        data-video-lit={lit ? '' : undefined}
        data-video-position={Math.round(part * 100)}
        data-video-apercu={instant}
        data-video-apercu-manuel={apercu?.manuel ? '' : undefined}
      >
        <video
          ref={video}
          src={source}
          playsInline
          preload="metadata"
          muted={muet}
          className={cn('block w-full bg-voile', sansAgrandir ? 'max-h-[70dvh]' : 'max-h-[360px]')}
          onClick={basculerLecture}
          onPlay={() => {
            jamaisLue.current = false;
            setLit(true);
          }}
          onPause={() => setLit(false)}
          onEnded={() => setLit(false)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuree(event.currentTarget.duration || 0)}
        />

        {/* LA GRANDE FLÈCHE DE DÉPART, tant que rien n'a été lancé. Elle dit
            que la vignette est une vidéo, sans lire un octet de plus. */}
        {lit ? null : (
          <button
            type="button"
            onClick={basculerLecture}
            className="absolute inset-0 flex items-center justify-center bg-voile/25 transition-colors hover:bg-voile/40"
            aria-label="Lire la video"
            title={t('Lire la vidéo')}
            data-video-lancer={id}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sur-etat/90 text-voile">
              <Play className="ml-0.5 h-6 w-6" aria-hidden />
            </span>
          </button>
        )}

        {/* LA RANGÉE DE COMMANDES, posée SUR la vidéo et toujours lisible :
            un dégradé sombre la porte, quelle que soit l'image dessous. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-voile/75 to-transparent px-2 pb-1.5 pt-6">
          <div
            className="h-1.5 w-full cursor-pointer rounded-full bg-sur-etat/25"
            onPointerDown={viser}
            data-video-barre={id}
            role="presentation"
          >
            <div className="h-full rounded-full bg-sur-etat" style={{ width: `${Math.max(1, part * 100)}%` }} />
          </div>
          <div className="flex items-center gap-1 text-[11px] text-sur-etat">
            <button
              type="button"
              onClick={basculerLecture}
              className="rounded p-1 hover:bg-sur-etat/20"
              aria-label={lit ? 'Pause' : 'Lire la video'}
              title={lit ? t('Mettre en pause') : t('Lire la vidéo')}
              data-video-lecture={lit ? 'lecture' : 'pause'}
            >
              {lit ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <span className="tabular-nums" data-video-temps>
              {tempsDeLecture(position)} / {tempsDeLecture(duree)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={changerLaVitesse}
              className="rounded px-1.5 py-1 tabular-nums hover:bg-sur-etat/20"
              aria-label="Vitesse de lecture"
              title={t('Vitesse de lecture')}
              data-video-vitesse={vitesse}
            >
              {vitesse}×
            </button>
            <button
              type="button"
              onClick={() => setMuet((avant) => !avant)}
              className="rounded p-1 hover:bg-sur-etat/20"
              aria-label={muet ? 'Retablir le son' : 'Couper le son'}
              title={muet ? t('Rétablir le son') : t('Couper le son')}
              data-video-muet={muet ? '' : undefined}
            >
              {muet ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            {/* DÉSIGNER L'IMAGE D'APERÇU — réservé à l'équipe : l'espace client
                ne passe aucun `onChoisir`, le bouton n'y existe donc pas. */}
            {apercu?.onChoisir ? (
              <button
                type="button"
                onClick={choisirLImage}
                className="rounded p-1 hover:bg-sur-etat/20"
                aria-label="Definir comme apercu"
                title={t('Définir cette image comme aperçu')}
                data-video-definir-apercu={id}
              >
                <ImageDown className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {apercu?.onChoisir && apercu.manuel ? (
              <button
                type="button"
                onClick={() => apercu.onChoisir?.(null)}
                className="rounded p-1 hover:bg-sur-etat/20"
                aria-label="Revenir a l apercu automatique"
                title={t('Revenir à l’aperçu automatique')}
                data-video-apercu-auto={id}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {sansAgrandir ? null : (
              <button
                type="button"
                onClick={() => setAgrandie(true)}
                className="rounded p-1 hover:bg-sur-etat/20"
                aria-label="Agrandir"
                title={t('Agrandir')}
                data-video-agrandir={id}
              >
                <Expand className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={pleinEcran}
              className="rounded p-1 hover:bg-sur-etat/20"
              aria-label="Plein ecran"
              title={t('Plein écran')}
              data-video-pleinecran={id}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <a
              href={adresseDePiece(id, true)}
              download={nom}
              className="rounded p-1 hover:bg-sur-etat/20"
              aria-label="Telecharger"
              title={t('Télécharger')}
              data-video-telecharger={id}
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* LA FENÊTRE AGRANDIE : QUATRE CINQUIÈMES DE LA LARGEUR DE L'ÉCRAN, et
          le MÊME lecteur dedans — il n'y a pas deux jeux de commandes à tenir
          d'accord. Le plein écran s'y prend d'un second bouton. */}
      {agrandie ? (
        <Dialog open onOpenChange={(ouvert) => !ouvert && setAgrandie(false)}>
          <DialogContentLibre className="sm:w-[80vw] sm:max-w-none" data-video-fenetre={id}>
            <DialogHeader className="flex items-center gap-2 pb-2">
              <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">{nom}</DialogTitle>
            </DialogHeader>
            <div className="px-4 pb-4">
              <LecteurVideo id={id} nom={nom} sansAgrandir demarrer apercu={apercu} className="mx-auto max-w-none" />
            </div>
          </DialogContentLibre>
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * LA PETITE VIGNETTE CARRÉE D'UNE VIDÉO — la galerie de l'espace client, et
 * partout où l'on montre une vidéo sans ses commandes.
 *
 * Elle affichait une balise `<video>` nue, donc la PREMIÈRE image du fichier :
 * c'est là que le noir se voyait le plus, puisque la vignette ne montre que ça.
 * Elle passe désormais par la MÊME règle que le lecteur — instant gardé sur la
 * pièce s'il y en a un, recherche automatique sinon.
 */
export function VignetteVideo({
  id,
  nom,
  seconde,
  className,
  onTrouve,
}: {
  id: string;
  nom?: string;
  /** L'instant gardé sur la pièce jointe, s'il y en a un. */
  seconde?: number;
  className?: string;
  onTrouve?: (seconde: number) => void;
}) {
  const video = React.useRef<HTMLVideoElement | null>(null);
  const instant = useApercuVideo({ id, video, secondeConnue: seconde, onTrouve });
  return (
    <video
      ref={video}
      src={adresseDePiece(id)}
      className={className}
      title={nom}
      muted
      playsInline
      preload="metadata"
      data-vignette-video={id}
      data-video-apercu={instant}
    />
  );
}
