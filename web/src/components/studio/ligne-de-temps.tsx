import * as React from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Blend,
  Captions,
  Droplets,
  Film,
  Image as IconeImage,
  Maximize2,
  Music,
  PenTool,
  Plus,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type Composition,
  type GenrePiste,
  type OperationStudio,
  type Piste,
  type RecetteAnimation,
  type Segment,
  DUREE_SEGMENT_MIN,
  RECETTES_ANIMATION,
  debutMediaDe,
  dureeDeLaComposition,
  libelleGenre,
  vitesseDe,
} from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ListeDeroulante,
  ZoneDefilement,
} from '@/components/ui';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { libelleRecette } from './libelles';
import { FormeDOnde, useOnde } from './onde';

/**
 * LA LIGNE DE TEMPS DU STUDIO — une rangée par piste, un bloc par segment.
 *
 * TOUS LES GLISSERS PASSENT PAR `usePointerDrag` (contrat de l'interface) :
 * déplacer un segment (dans sa piste ou vers une piste du même genre), rogner
 * son début ou sa fin par ses poignées, tirer la TÊTE DE LECTURE sur la règle,
 * tirer le MARQUEUR BLEU de la durée voulue. Au doigt, le geste ne démarre
 * qu'après un appui maintenu : glisser sans attendre fait DÉFILER la ligne.
 * Les positions s'aimantent au dixième de seconde, au curseur et aux bords voisins.
 *
 * ELLE N'A PAS DE FIN : sa largeur suit le contenu, le marqueur ET le bord droit
 * de ce qu'on regarde, plus un écran — elle grandit à mesure qu'on défile. Les
 * graduations ne sont calculées que sur la part visible.
 *
 * Gestes d'édition posés SUR la ligne (la barre « Ajouter » a disparu) : une
 * croix sur chaque bloc le retire ; au survol d'une rangée, un « + » suit la
 * souris et propose ce que CETTE piste accepte ; « + Piste » ajoute une piste
 * par sujet (visuel, voix, musique, sous-titres) ; au survol d'un bloc visuel,
 * un bouton bleu à chaque bord montre et change ses transitions d'entrée et de
 * sortie. UN CLIC sur un bloc le choisit ET pose la tête de lecture à l'instant
 * cliqué (un glisser, lui, ne la bouge pas) ; un DOUBLE-CLIC ouvre la fenêtre
 * d'édition de l'élément.
 *
 * AU TÉLÉPHONE, LA TÊTE DE LECTURE EST FIXE AU CENTRE et la ligne glisse dessous :
 * un glisser horizontal (le défilement natif) promène l'instant lu, la lecture fait
 * défiler la ligne, un appui sur la règle y amène la ligne. La ligne a une
 * demi-largeur de vide de chaque côté, pour que le début et la fin viennent sous
 * le trait. Un appui court sur un bloc le choisit SANS bouger la tête ; l'appui
 * long le déplace toujours.
 */

const HAUTEUR_PISTE = 44;
const HAUTEUR_REGLE = 24;
const PAS = 0.1;

/** Ce que le « + » d'une rangée peut poser. */
export type QuoiAjouter = 'dessin' | 'texte' | 'media-visuel' | 'voix' | 'son' | 'sous-titres';

function iconeDuGenre(s: Segment) {
  const classe = 'h-3 w-3 shrink-0';
  switch (s.genre) {
    case 'dessin':
      return <PenTool className={classe} />;
    case 'texte':
      return <Type className={classe} />;
    case 'image':
      return <IconeImage className={classe} />;
    case 'video':
      return <Film className={classe} />;
    case 'audio':
      return <Music className={classe} />;
    case 'voix':
      return <AudioLines className={classe} />;
    default:
      return <Captions className={classe} />;
  }
}

export function iconeDeRecette(r: RecetteAnimation, classe = 'h-2.5 w-2.5') {
  switch (r) {
    case 'fondu':
      return <Blend className={classe} />;
    case 'glisse-haut':
      return <ArrowUp className={classe} />;
    case 'glisse-bas':
      return <ArrowDown className={classe} />;
    case 'glisse-gauche':
      return <ArrowLeft className={classe} />;
    case 'glisse-droite':
      return <ArrowRight className={classe} />;
    case 'zoom':
      return <Maximize2 className={classe} />;
    case 'flou':
      return <Droplets className={classe} />;
    default:
      return <Plus className={classe} />;
  }
}

function nomDuSegment(s: Segment): string {
  if (s.nom) return s.nom;
  if (s.genre === 'texte' || s.genre === 'voix') return s.texte.slice(0, 40) || t(libelleGenre(s.genre));
  return t(libelleGenre(s.genre));
}

/** Le fond d'un segment selon son genre, en jetons de thème uniquement. */
function fondDuSegment(s: Segment, choisi: boolean): string {
  if (choisi) return 'bg-accent text-accent-fg';
  if (s.genre === 'voix') return s.etat === 'finale' ? 'bg-termine/25 text-text' : 'bg-en-cours/25 text-text';
  if (s.genre === 'audio') return 'bg-info/25 text-text';
  if (s.genre === 'sous-titres') return 'bg-publie/25 text-text';
  return 'bg-raised text-text';
}

const AVEC_TRANSITIONS = new Set(['dessin', 'texte', 'image', 'video']);

/** Ce qu'une piste accepte, dans le menu de son « + ». */
function choixDeLaPiste(genre: GenrePiste): { quoi: QuoiAjouter; libelle: string; Icone: typeof Plus }[] {
  if (genre === 'son')
    return [
      { quoi: 'voix', libelle: t('Voix'), Icone: AudioLines },
      { quoi: 'son', libelle: t('Musique ou son importé…'), Icone: Music },
    ];
  if (genre === 'sous-titres') return [{ quoi: 'sous-titres', libelle: t('Sous-titres automatiques'), Icone: Captions }];
  return [
    { quoi: 'dessin', libelle: t('Dessin'), Icone: PenTool },
    { quoi: 'texte', libelle: t('Texte'), Icone: Type },
    { quoi: 'media-visuel', libelle: t('Image ou vidéo importée…'), Icone: IconeImage },
  ];
}

/** Les sujets d'une nouvelle piste. */
function sujetsDePiste(): { cle: string; genre: GenrePiste; nom: string; Icone: typeof Plus }[] {
  return [
    { cle: 'visuel', genre: 'visuel', nom: t('Visuels'), Icone: PenTool },
    { cle: 'voix', genre: 'son', nom: t('Voix'), Icone: AudioLines },
    { cle: 'musique', genre: 'son', nom: t('Musique'), Icone: Music },
    { cle: 'sous-titres', genre: 'sous-titres', nom: t('Sous-titres'), Icone: Captions },
  ];
}

/** Un nom libre parmi ceux des pistes : « Visuels », puis « Visuels 2 »… */
function nomLibre(composition: Composition, base: string): string {
  const pris = new Set(composition.pistes.map((p) => p.nom));
  if (!pris.has(base)) return base;
  for (let n = 2; ; n++) if (!pris.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * OÙ POSER UNE NOUVELLE PISTE : la première piste est au PREMIER PLAN. Des
 * sous-titres vont devant tout ; un visuel juste devant les visuels existants
 * (jamais devant les sous-titres, qu'il cacherait) ; un son à la fin.
 */
function positionDeNouvellePiste(composition: Composition, genre: GenrePiste): number {
  if (genre === 'sous-titres') return 0;
  if (genre === 'son') return composition.pistes.length;
  const premierVisuel = composition.pistes.findIndex((p) => p.genre === 'visuel');
  if (premierVisuel >= 0) return premierVisuel;
  const premierSon = composition.pistes.findIndex((p) => p.genre === 'son');
  return premierSon >= 0 ? premierSon : composition.pistes.length;
}

interface Origine {
  x: number;
  segment?: Segment;
  piste?: Piste;
  t?: number;
}

export function LigneDeTemps({
  composition,
  temps,
  selection,
  onAller,
  onChoisir,
  onOperation,
  onAjouter,
  onOuvrirEditeur,
  adressesMedias,
}: {
  composition: Composition;
  /** Les adresses des fichiers : les blocs son et voix y lisent leur forme d'onde. */
  adressesMedias?: Record<string, { url: string; genre: string }>;
  temps: number;
  selection: string[];
  onAller: (t: number) => void;
  onChoisir: (segmentId: string | null, ajouter: boolean) => void;
  /** Le DOUBLE-CLIC sur un bloc : sa fenêtre d'édition s'ouvre (réglages et bande du temps). */
  onOuvrirEditeur?: (segmentId: string) => void;
  onOperation: (op: OperationStudio) => void;
  /** Le « + » d'une rangée : poser `quoi` sur cette piste, à cet instant. */
  onAjouter: (piste: Piste, quoi: QuoiAjouter, debut: number) => void;
}) {
  const telephone = useTelephone();
  const [zoom, setZoom] = React.useState(telephone ? 60 : 90);
  const contenu = dureeDeLaComposition(composition);
  const marqueurPose = composition.dureeVoulue !== undefined;
  const voulue = composition.dureeVoulue ?? contenu;
  const zone = React.useRef<HTMLDivElement | null>(null);
  const defil = React.useRef<HTMLDivElement | null>(null);
  const origine = React.useRef<Origine | null>(null);
  const dernier = React.useRef<{ x: number; y: number } | null>(null);
  /** Où le pointeur s'est posé sur un bloc : un clic sans déplacement y pose la tête de lecture. */
  const appui = React.useRef<{ x: number; y: number } | null>(null);
  /** La part regardée : bord gauche et largeur, en pixels. */
  const [vue, setVue] = React.useState({ gauche: 0, largeur: 800 });
  /** Le « + » d'une rangée : où il est, et si son menu est ouvert. */
  const [survol, setSurvol] = React.useState<{ pisteId: string; t: number } | null>(null);
  const [menu, setMenu] = React.useState<{ pisteId: string; t: number } | null>(null);
  /** Le genre du dernier appui sur le vide d'une rangée : au doigt, le « + » s'ouvre au toucher, pas au début d'un glisser. */
  const typeAppui = React.useRef('');

  /* LA TÊTE FIXE (téléphone) : la ligne a une demi-largeur de vide de chaque côté, et le centre de la vue est l'instant lu. */
  const teteFixe = telephone;
  const demi = teteFixe ? Math.round(vue.largeur / 2) : 0;
  /** Le dernier défilement fait AU DOIGT : tant qu'il est frais, c'est lui qui mène, pas le temps. */
  const doigt = React.useRef(0);
  /** Le dernier défilement posé par l'écran lui-même (la lecture qui avance) : son événement n'est pas un geste. */
  const pose = React.useRef<number | null>(null);
  const surAller = React.useRef(onAller);
  surAller.current = onAller;
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  /* LA PART REGARDÉE, relue au défilement (une fois par image) et au redimensionnement. */
  React.useEffect(() => {
    const el = defil.current;
    if (!el) return;
    let image = 0;
    let aller = 0;
    const lire = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => setVue({ gauche: el.scrollLeft, largeur: el.clientWidth || 800 }));
    };
    /* TÊTE FIXE : un défilement fait au doigt (ou à la molette) promène l'instant lu, une fois par image. Celui que
       l'écran pose pendant la lecture ne compte pas : seul compte un défilement venu moins de 1,5 s après un toucher,
       une molette ou un appui (l'élan d'après le lâcher compris), et qui n'est pas celui que l'écran vient de poser. */
    let geste = 0;
    const toucher = () => {
      geste = performance.now();
    };
    const defiler = () => {
      lire();
      if (!teteFixe || performance.now() - geste > 1500) return;
      if (pose.current !== null && Math.abs(el.scrollLeft - pose.current) < 2) return;
      pose.current = null;
      doigt.current = performance.now();
      cancelAnimationFrame(aller);
      aller = requestAnimationFrame(() => surAller.current(Math.max(0, Math.round((el.scrollLeft / zoomRef.current) * 100) / 100)));
    };
    lire();
    el.addEventListener('scroll', defiler, { passive: true });
    const declencheurs = ['touchstart', 'touchmove', 'wheel', 'pointerdown'] as const;
    for (const n of declencheurs) el.addEventListener(n, toucher, { passive: true });
    const obs = new ResizeObserver(lire);
    obs.observe(el);
    return () => {
      cancelAnimationFrame(image);
      cancelAnimationFrame(aller);
      el.removeEventListener('scroll', defiler);
      for (const n of declencheurs) el.removeEventListener(n, toucher);
      obs.disconnect();
    };
  }, [teteFixe]);

  /* TÊTE FIXE : la ligne suit l'instant lu (lecture, appui sur la règle, zoom) — sauf pendant qu'un doigt la mène. */
  React.useLayoutEffect(() => {
    const el = defil.current;
    if (!teteFixe || !el || performance.now() - doigt.current < 250) return;
    const voulu = Math.round(temps * zoom);
    if (Math.abs(el.scrollLeft - voulu) < 1) return;
    pose.current = voulu;
    el.scrollLeft = voulu;
  }, [teteFixe, temps, zoom, demi]);

  // SANS FIN : le contenu, le marqueur, et un écran de plus que ce qu'on regarde.
  const secondesVues = vue.largeur / zoom;
  /** Le bord gauche regardé, compté depuis le début de la ligne (le vide de la tête fixe retiré). */
  const gaucheVue = Math.max(0, vue.gauche - demi);
  const etendue = Math.max(contenu + 4, voulue + 4, (gaucheVue + vue.largeur) / zoom + secondesVues, 12);
  const largeur = etendue * zoom;

  /** Arrondi au dixième, puis aimanté à un bord voisin s'il est à moins de 8 pixels. */
  const aimanter = React.useCallback(
    (x: number, sauf: string) => {
      let meilleur = Math.round(x / PAS) * PAS;
      let ecart = 8 / zoom;
      for (const p of composition.pistes)
        for (const s of p.segments) {
          if (s.id === sauf) continue;
          for (const bord of [s.debut, s.debut + s.duree]) if (Math.abs(bord - x) < ecart) [meilleur, ecart] = [bord, Math.abs(bord - x)];
        }
      if (sauf !== 'curseur' && Math.abs(temps - x) < ecart) meilleur = temps;
      return Math.max(0, Math.round(meilleur * 1000) / 1000);
    },
    [composition, temps, zoom],
  );

  /** L'instant sous un point de l'écran. */
  const instantSous = React.useCallback(
    (clientX: number) => {
      const r = zone.current?.getBoundingClientRect();
      return r ? Math.max(0, (clientX - r.left) / zoom) : 0;
    },
    [zoom],
  );

  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const ligne = element.closest('[data-piste-id]');
    return ligne ? { id: ligne.getAttribute('data-piste-id')!, kind: 'piste', position: 'inside' } : null;
  }, []);

  const onDrop = React.useCallback(
    (item: { id: string; kind: string }, cible: DropTarget | null) => {
      const o = origine.current;
      const fin = dernier.current;
      origine.current = null;
      if (!o || !fin) return;
      const dt = (fin.x - o.x) / zoom;
      if (item.kind === 'curseur') {
        onAller(aimanter((o.t ?? 0) + dt, 'curseur'));
        return;
      }
      if (item.kind === 'marqueur') {
        const nouvelle = Math.max(0.5, aimanter((o.t ?? voulue) + dt, 'marqueur'));
        if (Math.abs(nouvelle - (composition.dureeVoulue ?? -1)) > 0.001) onOperation({ op: 'composition', dureeVoulue: nouvelle });
        return;
      }
      const s = o.segment;
      if (!s || !o.piste) return;
      if (item.kind === 'deplacer') {
        const debut = aimanter(s.debut + dt, s.id);
        const pisteId = cible && cible.id !== o.piste.id ? cible.id : undefined;
        if (Math.abs(debut - s.debut) < 0.001 && !pisteId) return;
        onOperation({ op: 'deplacer', segmentId: s.id, debut, ...(pisteId ? { pisteId } : {}) });
      } else if (item.kind === 'debut') {
        const debut = Math.min(aimanter(s.debut + dt, s.id), s.debut + s.duree - DUREE_SEGMENT_MIN);
        onOperation({ op: 'rogner', segmentId: s.id, debut });
      } else if (item.kind === 'fin') {
        const finS = Math.max(aimanter(s.debut + s.duree + dt, s.id), s.debut + DUREE_SEGMENT_MIN);
        onOperation({ op: 'rogner', segmentId: s.id, duree: Math.round((finS - s.debut) * 1000) / 1000 });
      }
    },
    [aimanter, onOperation, onAller, zoom, voulue, composition.dureeVoulue],
  );

  const { dragging, pointer, target, start } = usePointerDrag({ resolve, onDrop, holdMs: 280 });
  if (pointer) dernier.current = pointer;

  /* LA TÊTE DE LECTURE SUIT LA MAIN pendant qu'on la tire sur la règle. */
  React.useEffect(() => {
    const o = origine.current;
    if (dragging?.kind !== 'curseur' || !pointer || !o) return;
    onAller(aimanter((o.t ?? 0) + (pointer.x - o.x) / zoom, 'curseur'));
  }, [pointer?.x, dragging?.kind]);

  const commencer = (e: React.PointerEvent, segment: Segment, piste: Piste, kind: 'deplacer' | 'debut' | 'fin') => {
    e.stopPropagation();
    origine.current = { x: e.clientX, segment, piste };
    dernier.current = { x: e.clientX, y: e.clientY };
    start(e, { id: segment.id, kind, label: nomDuSegment(segment) });
  };

  /** La règle : un appui y pose la tête de lecture, un glisser la promène. */
  const saisirLaRegle = (e: React.PointerEvent) => {
    // Tête fixe : un doigt posé sur la règle commence souvent un glisser ; c'est l'APPUI (onClick) qui amène la ligne.
    if (e.button !== 0 || teteFixe) return;
    const x = aimanter(instantSous(e.clientX), 'curseur');
    onAller(x);
    origine.current = { x: e.clientX, t: x };
    dernier.current = { x: e.clientX, y: e.clientY };
    start(e, { id: 'curseur', kind: 'curseur', label: t('Tête de lecture') });
  };

  const saisirLeMarqueur = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    origine.current = { x: e.clientX, t: voulue };
    dernier.current = { x: e.clientX, y: e.clientY };
    start(e, { id: 'marqueur', kind: 'marqueur', label: t('Durée voulue') });
  };

  /** La place affichée d'un segment, glissement en cours compris. */
  const place = (s: Segment): { debut: number; duree: number } => {
    const o = origine.current;
    if (!dragging || !o || o.segment?.id !== s.id || !pointer) return { debut: s.debut, duree: s.duree };
    const dt = (pointer.x - o.x) / zoom;
    if (dragging.kind === 'deplacer') return { debut: aimanter(s.debut + dt, s.id), duree: s.duree };
    if (dragging.kind === 'debut') {
      const debut = Math.min(aimanter(s.debut + dt, s.id), s.debut + s.duree - DUREE_SEGMENT_MIN);
      return { debut, duree: s.debut + s.duree - debut };
    }
    const fin = Math.max(aimanter(s.debut + s.duree + dt, s.id), s.debut + DUREE_SEGMENT_MIN);
    return { debut: s.debut, duree: fin - s.debut };
  };

  const marqueurAffiche =
    dragging?.kind === 'marqueur' && pointer && origine.current
      ? Math.max(0.5, aimanter((origine.current.t ?? voulue) + (pointer.x - origine.current.x) / zoom, 'marqueur'))
      : voulue;

  // Zoom à la molette avec Ctrl (ordinateur).
  React.useEffect(() => {
    const el = defil.current;
    if (!el) return;
    const molette = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(20, Math.min(400, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener('wheel', molette, { passive: false });
    return () => el.removeEventListener('wheel', molette);
  }, []);

  /* LES GRADUATIONS DE LA SEULE PART VISIBLE : une ligne sans fin n'en calcule pas des milliers. */
  const graduations = React.useMemo(() => {
    const pas = zoom >= 120 ? 0.5 : zoom >= 50 ? 1 : zoom >= 25 ? 2 : 5;
    const depuis = Math.max(0, Math.floor(gaucheVue / zoom / pas) * pas);
    const jusqua = (gaucheVue + vue.largeur) / zoom + pas;
    const sortie: number[] = [];
    for (let x = depuis; x <= jusqua; x += pas) sortie.push(Math.round(x * 10) / 10);
    return sortie;
  }, [zoom, vue, gaucheVue]);

  /* LE « + » D'UNE RANGÉE suit la souris sur le vide de la piste. */
  const survolerRangee = (e: React.PointerEvent, p: Piste) => {
    if (e.pointerType !== 'mouse' || dragging || menu) return;
    if (e.target !== e.currentTarget && !(e.target as Element).closest('[data-studio-plus]')) {
      if (survol) setSurvol(null);
      return;
    }
    setSurvol({ pisteId: p.id, t: aimanter(instantSous(e.clientX), '') });
  };

  return (
    <div className="flex min-h-0 flex-col" data-studio-ligne-de-temps>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-muted" data-studio-temps>
          {t('{t} s / {d} s', { t: temps.toFixed(2), d: voulue.toFixed(1) })}
          {marqueurPose && contenu > voulue + 0.05 ? (
            <span className="text-faint"> · {t('{n} s au-delà du marqueur, hors de la vidéo', { n: (contenu - voulue).toFixed(1) })}</span>
          ) : null}
        </span>
        <Button size="icon" variant="ghost" aria-label="Dézoomer" title={t('Dézoomer')} onClick={() => setZoom((z) => Math.max(20, z / 1.4))}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Zoomer" title={t('Zoomer')} onClick={() => setZoom((z) => Math.min(400, z * 1.4))}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0">
        {/* Les noms des pistes restent fixes : seule la durée défile. */}
        <div className="w-[84px] shrink-0 sm:w-[104px]">
          <div style={{ height: HAUTEUR_REGLE }} />
          {composition.pistes.map((p) => (
            <div key={p.id} className="group flex items-center gap-0.5 pl-2 pr-1 text-[11.5px] text-muted" style={{ height: HAUTEUR_PISTE }} data-studio-nom-piste={p.id}>
              <span className="min-w-0 flex-1 truncate" title={p.nom}>
                {p.nom}
              </span>
              <button
                type="button"
                aria-label={`Retirer la piste « ${p.nom} »`}
                title={t('Retirer la piste « {nom} »', { nom: p.nom })}
                onClick={() => onOperation({ op: 'piste-supprimer', pisteId: p.id })}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-raised hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-60"
                data-studio-piste-supprimer={p.id}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mx-1 mt-1 flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted transition-colors hover:bg-raised hover:text-text"
                data-studio-piste-ajouter
              >
                <Plus className="h-3 w-3" />
                {t('Piste')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {sujetsDePiste().map((sujet) => (
                <DropdownMenuItem
                  key={sujet.cle}
                  data-studio-nouvelle-piste={sujet.cle}
                  onSelect={() =>
                    onOperation({
                      op: 'piste-ajouter',
                      genre: sujet.genre,
                      nom: nomLibre(composition, sujet.nom),
                      position: positionDeNouvellePiste(composition, sujet.genre),
                    })
                  }
                >
                  <sujet.Icone className="h-3.5 w-3.5" />
                  {sujet.nom}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative min-w-0 flex-1" data-studio-tete-fixe={teteFixe ? 'oui' : undefined}>
        <ZoneDefilement ref={defil} axe="horizontal" classeEnveloppe="min-w-0 w-full" fond="hsl(var(--surface))">
          <div style={{ width: largeur + 2 * demi }}>
          <div ref={zone} className="relative select-none" style={{ width: largeur, marginLeft: demi }}>
            {/* LA RÈGLE : un appui y pose la tête de lecture, un glisser la promène (au téléphone : un appui y amène la ligne). */}
            <div
              className="relative cursor-pointer"
              style={{ height: HAUTEUR_REGLE, touchAction: 'pan-x' }}
              onPointerDown={saisirLaRegle}
              onClick={(e) => {
                if (teteFixe && !(e.target as Element).closest('[data-studio-marqueur]')) surAller.current(aimanter(instantSous(e.clientX), 'curseur'));
              }}
              data-studio-regle
            >
              {graduations.map((g) => (
                <span key={g} className="absolute top-0 h-full border-l border-faint/40 pl-0.5 text-[10px] tabular-nums text-faint" style={{ left: g * zoom }}>
                  {Number.isInteger(g) ? `${g}s` : ''}
                </span>
              ))}
              {/* LE MARQUEUR BLEU : la durée voulue de la vidéo, qu'on tire pour la changer. */}
              <button
                type="button"
                onPointerDown={saisirLeMarqueur}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const pas = e.shiftKey ? 1 : 0.1;
                  onOperation({ op: 'composition', dureeVoulue: Math.max(0.5, Math.round((voulue + (e.key === 'ArrowLeft' ? -pas : pas)) * 10) / 10) });
                }}
                aria-label={`Durée voulue : ${marqueurAffiche.toFixed(1)} s. Glisser pour la changer.`}
                title={t('Durée voulue : {n} s. Glisser pour la changer.', { n: marqueurAffiche.toFixed(1) })}
                className={cn(
                  'absolute top-0 z-20 flex h-full -translate-x-1/2 cursor-ew-resize items-center rounded-sm px-1 text-[10px] font-semibold tabular-nums text-termine-fg shadow',
                  marqueurPose || dragging?.kind === 'marqueur' ? 'bg-termine' : 'bg-termine/50',
                )}
                style={{ left: marqueurAffiche * zoom, touchAction: 'none' }}
                data-studio-marqueur={marqueurAffiche.toFixed(1)}
                data-studio-marqueur-pose={marqueurPose ? 'oui' : 'non'}
              >
                {marqueurAffiche.toFixed(1)}s
              </button>
            </div>
            {composition.pistes.map((p) => (
              <div
                key={p.id}
                data-piste-id={p.id}
                data-piste-genre={p.genre}
                className={cn('relative border-t border-faint/20', target?.id === p.id && dragging && 'bg-accent/10', p.masquee && 'opacity-50')}
                style={{ height: HAUTEUR_PISTE }}
                onPointerMove={(e) => survolerRangee(e, p)}
                onPointerLeave={() => !menu && setSurvol(null)}
                onPointerDown={(e) => {
                  typeAppui.current = e.pointerType;
                  if (e.target !== e.currentTarget) return;
                  onChoisir(null, false);
                }}
                onClick={(e) => {
                  // Le vide d'une rangée : au doigt (pas de survol), l'APPUI ouvre le « + » — un glisser, lui, fait défiler.
                  if (e.target !== e.currentTarget || typeAppui.current === 'mouse') return;
                  setMenu({ pisteId: p.id, t: aimanter(instantSous(e.clientX), '') });
                }}
              >
                {p.segments.map((s) => {
                  const { debut, duree: d } = place(s);
                  const choisi = selection.includes(s.id);
                  const largeurBloc = Math.max(6, d * zoom);
                  const transitions = AVEC_TRANSITIONS.has(s.genre) && largeurBloc >= 52;
                  return (
                    <div
                      key={s.id}
                      data-studio-segment={s.id}
                      data-genre={s.genre}
                      className={cn(
                        // PAS D'`overflow-hidden` ICI : les boutons de transition débordent du bloc ; c'est le nom qui se rogne.
                        'group/bloc absolute top-1 flex items-center gap-1 rounded-md px-2.5 text-[11.5px]',
                        fondDuSegment(s, choisi),
                        dragging?.id === s.id && 'opacity-80 shadow-lg',
                      )}
                      style={{ left: debut * zoom, width: largeurBloc, height: HAUTEUR_PISTE - 8, touchAction: 'pan-x' }}
                      onPointerDown={(e) => {
                        appui.current = { x: e.clientX, y: e.clientY };
                        onChoisir(s.id, e.shiftKey || e.metaKey || e.ctrlKey);
                        commencer(e, s, p, 'deplacer');
                      }}
                      onClick={(e) => {
                        /* UN CLIC (sans glisser) POSE LA TÊTE DE LECTURE À L'INSTANT CLIQUÉ, sans aimant :
                           c'est l'endroit précis qu'on montre. Un glisser de plus de 5 px reste un déplacement. */
                        const a = appui.current;
                        appui.current = null;
                        // Tête fixe (téléphone) : un appui court CHOISIT le bloc, la ligne ne saute pas sous le doigt.
                        if (!a || teteFixe || e.shiftKey || e.metaKey || e.ctrlKey || Math.max(Math.abs(e.clientX - a.x), Math.abs(e.clientY - a.y)) >= 5) return;
                        onAller(Math.round(instantSous(e.clientX) * 100) / 100);
                      }}
                      onDoubleClick={() => onOuvrirEditeur?.(s.id)}
                      title={nomDuSegment(s)}
                    >
                      {(s.genre === 'audio' || s.genre === 'voix') && s.mediaId && adressesMedias?.[s.mediaId] ? (
                        <OndeDuBloc
                          url={adressesMedias[s.mediaId]!.url}
                          // Rogner le début avance aussi le départ dans le fichier (MEM-4384) : l'onde suit la main.
                          de={debutMediaDe(s) + (debut !== s.debut && Math.abs(debut + d - s.debut - s.duree) < 1e-6 ? (debut - s.debut) * vitesseDe(s) : 0)}
                          duree={d * vitesseDe(s)}
                          largeur={largeurBloc}
                        />
                      ) : null}
                      <span className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                        {iconeDuGenre(s)}
                        <span className="min-w-0 flex-1 truncate">{nomDuSegment(s)}</span>
                      </span>
                      {/* LA PETITE CROIX : retirer ce bloc, sans passer par l'inspecteur. */}
                      {largeurBloc >= 28 ? (
                        <button
                          type="button"
                          aria-label={`Retirer « ${nomDuSegment(s)} »`}
                          title={t('Retirer « {nom} »', { nom: nomDuSegment(s) })}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOperation({ op: 'supprimer', segmentId: s.id });
                          }}
                          className={cn(
                            'absolute right-5 top-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-bg/70 text-text transition-opacity hover:bg-bg hover:text-danger',
                            choisi ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover/bloc:opacity-100',
                          )}
                          data-studio-supprimer-segment={s.id}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      ) : null}
                      {transitions ? (
                        <>
                          <PastilleTransition segment={s} cote="entree" onOperation={onOperation} auBord={debut * zoom < 8} />
                          <PastilleTransition segment={s} cote="sortie" onOperation={onOperation} />
                        </>
                      ) : null}
                      <span
                        aria-label="Rogner le début"
                        data-poignee="debut"
                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
                        onPointerDown={(e) => commencer(e, s, p, 'debut')}
                      />
                      <span
                        aria-label="Rogner la fin"
                        data-poignee="fin"
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                        onPointerDown={(e) => commencer(e, s, p, 'fin')}
                      />
                    </div>
                  );
                })}
                {/* LE « + » DE LA RANGÉE : il suit la souris et propose ce que cette piste accepte. */}
                {(survol?.pisteId === p.id && !dragging) || menu?.pisteId === p.id ? (
                  <DropdownMenu
                    open={menu?.pisteId === p.id}
                    onOpenChange={(ouvert) => {
                      if (ouvert && survol) setMenu(survol);
                      else if (!ouvert) {
                        setMenu(null);
                        setSurvol(null);
                      }
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Ajouter sur la piste « ${p.nom} »`}
                        className="absolute top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-fg shadow"
                        style={{ left: (menu?.pisteId === p.id ? menu.t : (survol?.t ?? 0)) * zoom }}
                        data-studio-plus={p.id}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {choixDeLaPiste(p.genre).map((choix) => (
                        <DropdownMenuItem
                          key={choix.quoi}
                          data-studio-ajouter-ici={choix.quoi}
                          onSelect={() => onAjouter(p, choix.quoi, Math.round((menu?.t ?? survol?.t ?? temps) * 10) / 10)}
                        >
                          <choix.Icone className="h-3.5 w-3.5" />
                          {choix.libelle}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ))}
            {/* AU-DELÀ DU MARQUEUR : hors de la vidéo, grisé (le contenu reste là, il n'est pas exporté). */}
            {marqueurPose ? (
              <div
                className="pointer-events-none absolute bottom-0 right-0 bg-bg/50"
                style={{
                  left: marqueurAffiche * zoom,
                  top: HAUTEUR_REGLE,
                  // Des hachures fines, au jeton « faint » : lisibles en clair comme en sombre.
                  backgroundImage: 'repeating-linear-gradient(135deg, hsl(var(--faint) / 0.18) 0 2px, transparent 2px 9px)',
                }}
                data-studio-hors-video
                aria-hidden
              />
            ) : null}
            <div className="pointer-events-none absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-termine" style={{ left: marqueurAffiche * zoom, opacity: marqueurPose ? 1 : 0.45 }} aria-hidden />
            {/* LA TÊTE DE LECTURE : son trait, et sa poignée sur la règle (au téléphone, elle est fixe, posée par-dessus). */}
            {!teteFixe ? (
              <div className="pointer-events-none absolute top-0 z-20 h-full w-0.5 -translate-x-1/2 bg-danger" style={{ left: temps * zoom }} data-studio-curseur>
                <span className="absolute -left-[5px] top-0 h-3 w-3 rounded-b-full bg-danger" />
              </div>
            ) : null}
          </div>
          </div>
        </ZoneDefilement>
        {teteFixe ? (
          <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-30 w-0.5 -translate-x-1/2 bg-danger" data-studio-curseur aria-hidden>
            <span className="absolute -left-[5px] top-0 h-3 w-3 rounded-b-full bg-danger" />
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * LE BOUTON DE TRANSITION, au bord d'un bloc visuel : son entrée (gauche) ou sa
 * sortie (droite). Un rond BLEU à icône blanche, centré sur la hauteur et qui
 * déborde un peu du bloc ; il n'apparaît qu'AU SURVOL du bloc — transition
 * posée ou non, bloc choisi ou non. Caché, il ne capte rien : les poignées de
 * rognage et le glisser restent libres.
 */
function PastilleTransition({
  segment,
  cote,
  onOperation,
  auBord = false,
}: {
  segment: Segment;
  cote: 'entree' | 'sortie';
  onOperation: (op: OperationStudio) => void;
  /** Le bloc touche le début de la ligne de temps : le bouton rentre dedans au lieu d'être rogné. */
  auBord?: boolean;
}) {
  const recette: RecetteAnimation = (cote === 'entree' ? segment.entree : segment.sortie) ?? 'aucune';
  const titre = cote === 'entree' ? t('Transition d’entrée') : t('Transition de sortie');
  return (
    <ListeDeroulante
      valeur={recette}
      titre={titre}
      repere={`transition-${cote}`}
      onChoisir={(v) => onOperation({ op: 'proprietes', segmentId: segment.id, valeurs: { [cote]: v } })}
      options={RECETTES_ANIMATION.map((r) => ({ valeur: r, libelle: libelleRecette(r), icone: iconeDeRecette(r, 'h-3.5 w-3.5') }))}
      declencheur={(ouvrir) => (
        <button
          type="button"
          aria-label={`${titre} : ${libelleRecette(recette)}`}
          title={`${titre} : ${libelleRecette(recette)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ouvrir(e);
          }}
          className={cn(
            'absolute top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-termine text-white shadow ring-2 ring-surface transition-opacity',
            cote === 'entree' ? (auBord ? 'left-0.5' : '-left-1.5') : '-right-1.5',
            'pointer-events-none opacity-0 group-hover/bloc:pointer-events-auto group-hover/bloc:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
          data-studio-transition={cote}
          data-studio-recette={recette}
        >
          {iconeDeRecette(recette, 'h-3 w-3')}
        </button>
      )}
    />
  );
}

/**
 * LA FORME D'ONDE D'UN BLOC SON OU VOIX : le passage RÉELLEMENT joué de son
 * fichier, `[debutMedia, debutMedia + duree × vitesse]` (MEM-4384), en fond du
 * bloc, derrière le nom. Rognée dans son propre calque : le bloc, lui, n'a pas
 * d'`overflow-hidden` (ses boutons de transition débordent).
 */
function OndeDuBloc({ url, de, duree, largeur }: { url: string; de: number; duree: number; largeur: number }) {
  const { onde } = useOnde(url);
  if (!onde) return null;
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md opacity-45" aria-hidden data-studio-onde-bloc>
      <FormeDOnde onde={onde} de={de} a={de + duree} colonnes={largeur / 3} className="absolute inset-x-0 inset-y-1 h-[calc(100%-8px)] w-full text-text" />
    </span>
  );
}
