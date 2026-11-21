import * as React from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Blend,
  Captions,
  ChevronDown,
  ChevronUp,
  Droplets,
  Eye,
  EyeOff,
  Film,
  Image as IconeImage,
  Clapperboard as IconeVideo,
  Maximize2,
  Music,
  Pencil,
  PenTool,
  Plus,
  StickyNote,
  Check,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from '@/components/ui/icones';
import {
  type Composition,
  type NoteDuStudio,
  type GenrePiste,
  pisteAccepte,
  type OperationStudio,
  type Piste,
  type RecetteAnimation,
  type Segment,
  DUREE_SEGMENT_MIN,
  RECETTES_ANIMATION,
  debutMediaDe,
  dureeDeLaCreation,
  libelleGenre,
  pisteSonore,
  vitesseDe,
} from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ListeDeroulante,
  ZoneDefilement,
} from '@/components/ui';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';
import { nomDeLaPiste, useContexteDePose, useEtatDuGlisserVersUnePiste } from '@/components/pose-sur-piste';
import { client } from '@/lib/client';
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
 * cliqué (un glisser, lui, ne la bouge pas) ; un DOUBLE-CLIC, ou un APPUI LONG au
 * doigt, ouvre son menu d'options, dont « Tout régler » mène à la grande fenêtre.
 *
 * LE HAUT RESTE VISIBLE AU DÉFILEMENT : la barre et la règle sont collées en haut de la zone qui défile en hauteur.
 * Une règle collée ne vit pas dans une zone qui défile en largeur (elle n'y collerait à rien) : elle a donc sa
 * propre rangée, dont le défilement en largeur suit celui des pistes, dans les deux sens.
 *
 * L'ŒIL : dans la liste, il vise toute la piste (le haut-parleur, pour un son) ; sur un bloc, ce bloc seul.
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
/** Tête fixe (téléphone) : la place du trait de lecture, en pixels après la colonne des noms de pistes. Sa poignée ronde (12 px) y tient entière. */
const RETRAIT_TETE_FIXE = 14;

/** Ce que le « + » d'une rangée peut poser. */
export type QuoiAjouter = 'dessin' | 'texte' | 'image-importee' | 'video-importee' | 'voix' | 'son' | 'sous-titres';

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

export function nomDuSegment(s: Segment): string {
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
  switch (genre) {
    case 'voix':
      return [
        { quoi: 'voix', libelle: t('Voix'), Icone: AudioLines },
        { quoi: 'son', libelle: t('Voix importée…'), Icone: Music },
      ];
    case 'son':
      return [{ quoi: 'son', libelle: t('Musique ou son importé…'), Icone: Music }];
    case 'sous-titres':
      return [{ quoi: 'sous-titres', libelle: t('Sous-titres automatiques'), Icone: Captions }];
    case 'image':
      return [{ quoi: 'image-importee', libelle: t('Image importée…'), Icone: IconeImage }];
    case 'video':
      return [{ quoi: 'video-importee', libelle: t('Vidéo importée…'), Icone: IconeVideo }];
    default:
      return [
        { quoi: 'dessin', libelle: t('Dessin'), Icone: PenTool },
        { quoi: 'texte', libelle: t('Texte'), Icone: Type },
      ];
  }
}

/** Les six types d'une nouvelle piste. */
function sujetsDePiste(): { genre: GenrePiste; nom: string; Icone: typeof Plus }[] {
  return [
    { genre: 'image', nom: t('Images'), Icone: IconeImage },
    { genre: 'video', nom: t('Vidéos'), Icone: IconeVideo },
    { genre: 'vecteur', nom: t('Vecteurs'), Icone: PenTool },
    { genre: 'sous-titres', nom: t('Sous-titres'), Icone: Captions },
    { genre: 'voix', nom: t('Voix'), Icone: AudioLines },
    { genre: 'son', nom: t('Son'), Icone: Music },
  ];
}

/** Ce qui défile pendant un glisser : la ligne de temps en largeur, la zone qui la porte en hauteur. */
function zonesQuiDefilent(ligne: HTMLElement | null): (HTMLElement | null)[] {
  let porteuse = ligne?.parentElement ?? null;
  while (porteuse && !(porteuse.scrollHeight > porteuse.clientHeight && /auto|scroll/.test(getComputedStyle(porteuse).overflowY))) porteuse = porteuse.parentElement;
  /* Le haut collé de la frise couvre le début de la zone : le défilement au bord commence sous lui. */
  const haut = ligne?.closest('[data-studio-ligne-de-temps]')?.querySelector<HTMLElement>('[data-studio-haut-de-frise]');
  if (porteuse && haut) porteuse.dataset.margeDeBord = String(haut.offsetHeight);
  return [ligne, porteuse];
}

interface Origine {
  x: number;
  /** Le défilement au départ du geste : la ligne peut défiler pendant qu'on tient l'élément. */
  gauche: number;
  segment?: Segment;
  piste?: Piste;
  t?: number;
}

interface NoteOuverte {
  id?: string;
  instant: number;
  texte: string;
  traitee?: boolean;
}

const signalerNote = (err: any) => client.pushToast('error', err?.message ?? t('geste impossible'));

/**
 * LA FICHE D'UNE NOTE, sous la barre de la ligne de temps (refonte du 31/10/2026 : plus d'onglet « Notes », plus de
 * clic sur l'image). Une nouvelle note vise l'instant de la tête de lecture, sans endroit sur l'image
 * (`noteSansEndroit`) ; une note existante se lit, se modifie (elle est reposée au même instant), se coche ou se
 * retire. L'agent lit les notes ouvertes à son tour suivant.
 */
function FicheDeNote({ note, creationId, onFini }: { note: NoteOuverte; creationId: string; onFini: () => void }) {
  const [texte, setTexte] = React.useState(note.texte);
  React.useEffect(() => setTexte(note.texte), [note.id, note.texte]);
  const propre = texte.trim();
  const enregistrer = async () => {
    if (!propre) return;
    try {
      await client.call({ type: 'studio.note.ajouter', creationId, instant: note.instant, x: 0, y: 0, texte: propre });
      if (note.id) await client.call({ type: 'studio.note.supprimer', creationId, id: note.id });
      onFini();
    } catch (err) {
      signalerNote(err);
    }
  };
  return (
    <form
      className="mx-2 mb-1.5 flex shrink-0 items-center gap-1.5 rounded-lg bg-raised px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void enregistrer();
      }}
      data-studio-fiche-note={note.id ?? 'nouvelle'}
    >
      <span className="shrink-0 text-[12px] tabular-nums text-faint">{t('{t} s', { t: note.instant.toFixed(1) })}</span>
      <Input
        autoFocus
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onFini();
        }}
        placeholder={t('Ce titre est trop bas…')}
        maxLength={1000}
        className="h-8 min-w-0 flex-1"
        data-studio-note-texte
      />
      <Button size="sm" type="submit" disabled={!propre || propre === note.texte} data-studio-note-poser>
        {note.id ? t('Enregistrer') : t('Poser la note')}
      </Button>
      {note.id ? (
        <>
          <Button
            size="icon"
            variant="ghost"
            type="button"
            aria-label={note.traitee ? 'Rouvrir la note' : 'Marquer la note traitée'}
            title={note.traitee ? t('Rouvrir la note') : t('Marquer la note traitée')}
            onClick={() => void client.call({ type: 'studio.note.marquer', creationId, id: note.id!, traitee: !note.traitee }).then(onFini).catch(signalerNote)}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            type="button"
            aria-label="Retirer la note"
            title={t('Retirer la note')}
            onClick={() => void client.call({ type: 'studio.note.supprimer', creationId, id: note.id! }).then(onFini).catch(signalerNote)}
            data-studio-note-retirer
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : null}
      <Button size="icon" variant="ghost" type="button" aria-label="Fermer la note" title={t('Fermer')} onClick={onFini}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}

export function LigneDeTemps({
  composition,
  temps,
  selection,
  onAller,
  onChoisir,
  onOperation,
  onAjouter,
  onReglages,
  onDeplacement,
  adressesMedias,
  ouverte = true,
  onBasculer,
  rythme,
  onCalerSurLeRythme,
  notes,
  creationId,
}: {
  composition: Composition;
  /** Les adresses des fichiers : les blocs son et voix y lisent leur forme d'onde. */
  adressesMedias?: Record<string, { url: string; genre: string }>;
  temps: number;
  selection: string[];
  onAller: (t: number) => void;
  onChoisir: (segmentId: string | null, ajouter: boolean) => void;
  /** LE DOUBLE-CLIC sur un bloc, ou l'appui long au doigt : son menu d'options (`bulle-de-reglages.tsx`). */
  onReglages?: (segmentId: string) => void;
  /** Un déplacement démarre vraiment : le menu d'options se referme. */
  onDeplacement?: () => void;
  onOperation: (op: OperationStudio) => void;
  /** Le « + » d'une rangée : poser `quoi` sur cette piste, à cet instant. */
  onAjouter: (piste: Piste, quoi: QuoiAjouter, debut: number) => void;
  /** Ordinateur : la ligne de temps est dépliée (défaut) ou repliée sur sa seule barre. */
  ouverte?: boolean;
  /** Présent = le chevron de la barre est posé ; absent (téléphone) = pas de chevron. */
  onBasculer?: () => void;
  /** LE RYTHME DE LA MUSIQUE : ses temps se voient sur la règle et aimantent les gestes. */
  rythme?: { bpm: number; temps: number[] };
  onCalerSurLeRythme?: () => void;
  /** LES NOTES DE LA CRÉATION : des repères sur la règle, et l'icône qui en pose une à la tête de lecture. */
  notes?: NoteDuStudio[];
  creationId?: string;
}) {
  const telephone = useTelephone();
  const [zoom, setZoom] = React.useState(telephone ? 60 : 90);
  /** La note ouverte sous la barre : une nouvelle (sans `id`, à la tête de lecture) ou une existante. */
  const [note, setNote] = React.useState<NoteOuverte | null>(null);
  const contenu = dureeDeLaCreation(composition);
  const marqueurPose = composition.dureeVoulue !== undefined;
  const voulue = composition.dureeVoulue ?? contenu;
  const zone = React.useRef<HTMLDivElement | null>(null);
  const defil = React.useRef<HTMLDivElement | null>(null);
  /** La rangée de la règle : elle défile en largeur avec les pistes. */
  const defilRegle = React.useRef<HTMLDivElement | null>(null);
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
  /** Le nom d'une piste en train d'être changé, dans la liste. */
  const [renommage, setRenommage] = React.useState<{ pisteId: string; valeur: string } | null>(null);
  /** Au téléphone, le menu d'une piste, ouvert par un appui long sur son nom. */
  const [menuPiste, setMenuPiste] = React.useState<string | null>(null);
  const validerLeNom = () => {
    if (!renommage) return;
    const piste = composition.pistes.find((p) => p.id === renommage.pisteId);
    const voulu = renommage.valeur.trim();
    setRenommage(null);
    if (piste && voulu !== (piste.nomChoisi ?? nomDeLaPiste(composition.pistes, piste)) ) onOperation({ op: 'piste-proprietes', pisteId: piste.id, nom: voulu });
  };

  /* LA TÊTE FIXE (téléphone) : le trait de lecture ne bouge pas, c'est la ligne qui défile dessous. Il se tient JUSTE
     APRÈS LES NOMS DE PISTES (`RETRAIT_TETE_FIXE`), plus au centre : centré, il laissait une demi-largeur d'écran vide
     à gauche du début de la vidéo. La ligne ne garde donc que ce petit retrait avant l'instant zéro. */
  const teteFixe = telephone;
  const retrait = teteFixe ? RETRAIT_TETE_FIXE : 0;
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
    const regle = defilRegle.current;
    const suivreLaRegle = () => {
      if (regle && Math.abs(el.scrollLeft - regle.scrollLeft) > 0.5) el.scrollLeft = regle.scrollLeft;
    };
    const defiler = () => {
      if (regle && Math.abs(regle.scrollLeft - el.scrollLeft) > 0.5) regle.scrollLeft = el.scrollLeft;
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
    regle?.addEventListener('scroll', suivreLaRegle, { passive: true });
    for (const n of declencheurs) regle?.addEventListener(n, toucher, { passive: true });
    const obs = new ResizeObserver(lire);
    obs.observe(el);
    return () => {
      cancelAnimationFrame(image);
      cancelAnimationFrame(aller);
      el.removeEventListener('scroll', defiler);
      for (const n of declencheurs) el.removeEventListener(n, toucher);
      regle?.removeEventListener('scroll', suivreLaRegle);
      for (const n of declencheurs) regle?.removeEventListener(n, toucher);
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
    if (defilRegle.current) defilRegle.current.scrollLeft = voulu;
  }, [teteFixe, temps, zoom, retrait]);

  // SANS FIN : le contenu, le marqueur, et un écran de plus que ce qu'on regarde.
  const secondesVues = vue.largeur / zoom;
  /** Le bord gauche regardé, compté depuis le début de la ligne (le retrait de la tête fixe retiré). */
  const gaucheVue = Math.max(0, vue.gauche - retrait);
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
      /* Les temps de la musique aimantent aussi : un changement de plan tombe juste. */
      if (sauf !== 'curseur') for (const t0 of rythme?.temps ?? []) if (Math.abs(t0 - x) < ecart) [meilleur, ecart] = [t0, Math.abs(t0 - x)];
      return Math.max(0, Math.round(meilleur * 1000) / 1000);
    },
    [composition, temps, zoom, rythme],
  );

  /** L'instant sous un point de l'écran. */
  const instantSous = React.useCallback(
    (clientX: number) => {
      const r = zone.current?.getBoundingClientRect();
      return r ? Math.max(0, (clientX - r.left) / zoom) : 0;
    },
    [zoom],
  );

  /* LE GLISSER VENU DE LA CONVERSATION OU DE LA RUBRIQUE MÉDIAS lit ici l'instant sous le pointeur. */
  const contexteDePose = useContexteDePose();
  const glisser = useEtatDuGlisserVersUnePiste();
  React.useEffect(() => {
    if (!contexteDePose) return;
    contexteDePose.ligne.current = { instantSous, aimanter: (x) => aimanter(x, ''), zones: () => zonesQuiDefilent(defil.current) };
    return () => {
      contexteDePose.ligne.current = null;
    };
  }, [contexteDePose, instantSous, aimanter]);

  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const ligne = element.closest<HTMLElement>('[data-piste-id]');
    if (!ligne) return null;
    /* Un élément ne change de piste que pour une piste de son type : les autres ne s'éclairent pas. */
    const s = origine.current?.segment;
    if (s && !pisteAccepte(ligne.dataset.pisteGenre as GenrePiste, s.genre)) return null;
    return { id: ligne.dataset.pisteId!, kind: 'piste', position: 'inside' };
  }, []);

  const abandonner = React.useCallback(() => {
    origine.current = null;
  }, []);

  /** L'écart parcouru depuis le départ du geste, le défilement de la ligne compris. */
  const ecartDepuis = (o: Origine, x: number) => (x - o.x + ((defil.current?.scrollLeft ?? 0) - o.gauche)) / zoomRef.current;

  const onDrop = React.useCallback(
    (item: { id: string; kind: string }, cible: DropTarget | null) => {
      const o = origine.current;
      const fin = dernier.current;
      origine.current = null;
      if (!o || !fin) return;
      const dt = ecartDepuis(o, fin.x);
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

  const zonesDeBord = React.useCallback(() => zonesQuiDefilent(defil.current), []);
  /* L'APPUI LONG, AU DOIGT SEULEMENT : sur un bloc son menu d'options, sur un nom de piste le menu de la piste. Bouger avant l'échéance reste un déplacement. */
  const appuiLong = React.useCallback(
    (item: { id: string; kind: string }) => {
      origine.current = null;
      if (item.kind === 'deplacer') {
        onChoisir(item.id, false);
        onReglages?.(item.id);
      } else if (item.kind === 'nom-piste') setMenuPiste(item.id.slice('nom:'.length));
    },
    [onChoisir, onReglages],
  );
  const appuiLongPermis = React.useCallback((item: { kind: string }, type: string) => type !== 'mouse' && (item.kind === 'deplacer' || item.kind === 'nom-piste'), []);
  const { dragging, pointer, target, start } = usePointerDrag({ resolve, onDrop, holdMs: 280, onLongPress: appuiLong, appuiLongPermis, onAbandon: abandonner, defilementAuBord: zonesDeBord });
  if (pointer) dernier.current = pointer;

  /* UN DÉPLACEMENT QUI DÉMARRE referme le menu d'options : il ne reste jamais ouvert sous la main. */
  const deplace = !!dragging;
  const surDeplacement = React.useRef(onDeplacement);
  surDeplacement.current = onDeplacement;
  React.useEffect(() => {
    if (deplace) surDeplacement.current?.();
  }, [deplace]);

  /* LA TÊTE DE LECTURE SUIT LA MAIN pendant qu'on la tire sur la règle. */
  React.useEffect(() => {
    const o = origine.current;
    if (dragging?.kind !== 'curseur' || !pointer || !o) return;
    onAller(aimanter((o.t ?? 0) + ecartDepuis(o, pointer.x), 'curseur'));
  }, [pointer?.x, dragging?.kind]);

  const commencer = (e: React.PointerEvent, segment: Segment, piste: Piste, kind: 'deplacer' | 'debut' | 'fin') => {
    e.stopPropagation();
    origine.current = { x: e.clientX, gauche: defil.current?.scrollLeft ?? 0, segment, piste };
    dernier.current = { x: e.clientX, y: e.clientY };
    start(e, { id: segment.id, kind, label: nomDuSegment(segment) });
  };

  /** La règle : un appui y pose la tête de lecture, un glisser la promène. */
  const saisirLaRegle = (e: React.PointerEvent) => {
    // Tête fixe : un doigt posé sur la règle commence souvent un glisser ; c'est l'APPUI (onClick) qui amène la ligne.
    if (e.button !== 0 || teteFixe) return;
    const x = aimanter(instantSous(e.clientX), 'curseur');
    onAller(x);
    origine.current = { x: e.clientX, gauche: defil.current?.scrollLeft ?? 0, t: x };
    dernier.current = { x: e.clientX, y: e.clientY };
    start(e, { id: 'curseur', kind: 'curseur', label: t('Tête de lecture') });
  };

  const saisirLeMarqueur = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    origine.current = { x: e.clientX, gauche: defil.current?.scrollLeft ?? 0, t: voulue };
    dernier.current = { x: e.clientX, y: e.clientY };
    start(e, { id: 'marqueur', kind: 'marqueur', label: t('Durée voulue') });
  };

  /** La place affichée d'un segment, glissement en cours compris. */
  const place = (s: Segment): { debut: number; duree: number } => {
    const o = origine.current;
    if (!dragging || !o || o.segment?.id !== s.id || !pointer) return { debut: s.debut, duree: s.duree };
    const dt = ecartDepuis(o, pointer.x);
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
      ? Math.max(0.5, aimanter((origine.current.t ?? voulue) + ecartDepuis(origine.current, pointer.x), 'marqueur'))
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
    if (e.pointerType !== 'mouse' || dragging || glisser || menu) return;
    if (e.target !== e.currentTarget && !(e.target as Element).closest('[data-studio-plus]')) {
      if (survol) setSurvol(null);
      return;
    }
    setSurvol({ pisteId: p.id, t: aimanter(instantSous(e.clientX), '') });
  };

  const largeurDesNoms = 'w-[84px] shrink-0 sm:w-[104px]';
  return (
    <div className="flex min-h-0 flex-col" data-studio-ligne-de-temps>
      {/* LE HAUT DE LA FRISE RESTE VISIBLE : fond opaque, celui de la page, pour que les pistes passent dessous sans se lire au travers. */}
      <div className="sticky top-0 z-40 shrink-0" style={{ background: 'var(--fond-zone-defilement, hsl(var(--bg)))' }} data-studio-haut-de-frise>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-muted" data-studio-temps>
          {t('{t} s / {d} s', { t: temps.toFixed(2), d: voulue.toFixed(1) })}
          {marqueurPose && contenu > voulue + 0.05 ? (
            <span className="text-faint"> · {t('{n} s au-delà du marqueur, hors de la vidéo', { n: (contenu - voulue).toFixed(1) })}</span>
          ) : null}
        </span>
        {creationId ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Ajouter une note"
            title={t('Poser une note à {t} s', { t: temps.toFixed(1) })}
            aria-pressed={!!note && !note.id}
            onClick={() => setNote(note && !note.id ? null : { instant: temps, texte: '' })}
            data-studio-nouvelle-note
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" aria-label="Dézoomer" title={t('Dézoomer')} onClick={() => setZoom((z) => Math.max(20, z / 1.4))}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Zoomer" title={t('Zoomer')} onClick={() => setZoom((z) => Math.min(400, z * 1.4))}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        {rythme?.bpm && onCalerSurLeRythme ? (
          <Button size="sm" variant="ghost" onClick={onCalerSurLeRythme} title={t('Caler les changements de plan sur les temps de la musique')} data-studio-caler-rythme={rythme.bpm}>
            {t('Caler sur le rythme · {n} BPM', { n: rythme.bpm })}
          </Button>
        ) : null}
        {onBasculer ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={ouverte ? 'Replier la timeline' : 'Déplier la timeline'}
            title={ouverte ? t('Replier la timeline') : t('Déplier la timeline')}
            aria-expanded={ouverte}
            onClick={onBasculer}
            data-studio-timeline-bascule
          >
            {ouverte ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        ) : null}
      </div>
      {note && creationId ? <FicheDeNote note={note} creationId={creationId} onFini={() => setNote(null)} /> : null}
      {/* LA RANGÉE DE LA RÈGLE. Repliée, elle reste montée avec le reste. */}
      <div className={cn('flex', !ouverte && 'hidden')} data-studio-rangee-regle>
        <div className={largeurDesNoms} />
        <div className="relative min-w-0 flex-1">
          <ZoneDefilement ref={defilRegle} axe="horizontal" barre={false} classeEnveloppe="min-w-0 w-full" className="sans-barre-native">
            <div style={{ width: largeur + retrait }}>
            <div className="relative select-none" style={{ width: largeur, marginLeft: retrait }}>
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
              {/* LES TEMPS DE LA MUSIQUE : de petits repères sur la règle, et l'aimant des gestes. */}
              {rythme?.bpm
                ? rythme.temps.map((temps) => (
                    <span key={temps} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-text/60" style={{ left: temps * zoom }} data-studio-temps-musique={temps} />
                  ))
                : null}
              {/* LES NOTES : un repère à leur instant ; un clic y mène et ouvre la note (lire, modifier, retirer). */}
              {(notes ?? []).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAller(n.instant);
                    setNote({ id: n.id, instant: n.instant, texte: n.texte, traitee: !!n.traiteeLe });
                  }}
                  title={n.texte}
                  aria-label={`Note à ${n.instant.toFixed(1)} s`}
                  className={cn('absolute top-0.5 z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-accent', n.traiteeLe && 'opacity-40')}
                  style={{ left: n.instant * zoom }}
                  data-studio-note={n.id}
                />
              ))}
              {/* LA POIGNÉE DE LA TÊTE DE LECTURE (au téléphone, elle est fixe, posée par-dessus la rangée). */}
              {!teteFixe ? (
                <div className="pointer-events-none absolute top-0 z-20 h-full w-0.5 -translate-x-1/2 bg-danger" style={{ left: temps * zoom }} data-studio-poignee-tete aria-hidden>
                  <span className="absolute -left-[5px] top-0 h-3 w-3 rounded-b-full bg-danger" />
                </div>
              ) : null}
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
            </div>
            </div>
          </ZoneDefilement>
          {teteFixe ? (
            <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 -translate-x-1/2 bg-danger" style={{ left: retrait }} data-studio-poignee-tete aria-hidden>
              <span className="absolute -left-[5px] top-0 h-3 w-3 rounded-b-full bg-danger" />
            </div>
          ) : null}
        </div>
      </div>
      </div>
      {/* REPLIÉE, elle reste montée (zoom, tête de lecture, mesures gardés) mais ne prend plus aucune place. */}
      <div className={cn('flex min-h-0', !ouverte && 'hidden')} data-studio-corps-ligne-de-temps>
        {/* Les noms des pistes restent fixes : seule la durée défile. */}
        <div className={largeurDesNoms}>
          {composition.pistes.map((p, rang) => (
            <div
              key={p.id}
              className="group relative flex items-center gap-0.5 pl-2 pr-1 text-[11.5px] text-muted"
              style={{ height: HAUTEUR_PISTE }}
              /* À LA SOURIS, LE CLIC DROIT SUR LA TÊTE D'UNE PISTE OUVRE LE MÊME MENU que l'appui long au doigt (MEM-7808). */
              onContextMenu={(e) => {
                if (renommage?.pisteId === p.id) return;
                e.preventDefault();
                const avaler = (relache: PointerEvent) => {
                  if (relache.button === 2) relache.stopPropagation();
                };
                document.addEventListener('pointerup', avaler, { capture: true, once: true });
                setMenuPiste(p.id);
              }}
              data-studio-nom-piste={p.id}
              data-studio-type-piste={p.genre}
            >
              {renommage?.pisteId === p.id ? (
                <Input
                  autoFocus
                  value={renommage.valeur}
                  maxLength={60}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRenommage({ pisteId: p.id, valeur: e.target.value })}
                  onBlur={validerLeNom}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') setRenommage(null);
                  }}
                  aria-label="Nom de la piste"
                  className="h-7 min-w-0 flex-1 rounded-md px-1.5 text-[11.5px]"
                  data-studio-renommer-piste={p.id}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 cursor-default select-none truncate"
                  title={nomDeLaPiste(composition.pistes, p)}
                  style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
                  onDoubleClick={() => setRenommage({ pisteId: p.id, valeur: p.nomChoisi ?? nomDeLaPiste(composition.pistes, p) })}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse') return;
                    origine.current = null;
                    start(e, { id: `nom:${p.id}`, kind: 'nom-piste', label: nomDeLaPiste(composition.pistes, p) });
                  }}
                  data-studio-nom-de-piste={p.id}
                >
                  {nomDeLaPiste(composition.pistes, p)}
                </span>
              )}
              {/* AU TÉLÉPHONE, LA PLACE MANQUE : l'œil seul reste, le reste s'ouvre par un appui long sur le nom. */}
              {menuPiste === p.id ? (
                <DropdownMenu open onOpenChange={(ouvert) => !ouvert && setMenuPiste(null)}>
                  <DropdownMenuTrigger asChild>
                    <span className="pointer-events-none absolute inset-0" aria-hidden />
                  </DropdownMenuTrigger>
                  {/* RENOMMER, PUIS L'ORDRE, PUIS RETIRER — seul en dernier, en rouge (MEM-7808). Une piste déjà en tête
                      (ou en queue) ne propose pas d'aller plus loin. */}
                  <DropdownMenuContent align="start" data-studio-menu-piste={p.id}>
                    <DropdownMenuItem onSelect={() => setRenommage({ pisteId: p.id, valeur: p.nomChoisi ?? nomDeLaPiste(composition.pistes, p) })} data-studio-menu-piste-renommer>
                      <Pencil />
                      {t('Renommer')}
                    </DropdownMenuItem>
                    {composition.pistes.length > 1 ? <DropdownMenuSeparator /> : null}
                    {rang > 0 ? (
                      <DropdownMenuItem onSelect={() => onOperation({ op: 'piste-proprietes', pisteId: p.id, position: rang - 1 })}>
                        <ChevronUp />
                        {t('Faire passer devant')}
                      </DropdownMenuItem>
                    ) : null}
                    {rang < composition.pistes.length - 1 ? (
                      <DropdownMenuItem onSelect={() => onOperation({ op: 'piste-proprietes', pisteId: p.id, position: rang + 1 })}>
                        <ChevronDown />
                        {t('Faire passer derrière')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => onOperation({ op: 'piste-supprimer', pisteId: p.id })} data-studio-menu-piste-supprimer>
                      <Trash2 />
                      {t('Retirer la piste')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {/* L'ORDRE DES PISTES RESTE LIBRE : il décide ce qui passe devant. */}
              <span className="hidden shrink-0 flex-col focus-within:flex sm:group-hover:flex">
                <button
                  type="button"
                  aria-label="Faire passer cette piste devant"
                  title={t('Faire passer devant')}
                  disabled={rang === 0}
                  onClick={() => onOperation({ op: 'piste-proprietes', pisteId: p.id, position: rang - 1 })}
                  className="flex h-3 w-4 items-center justify-center rounded text-faint hover:bg-raised hover:text-text disabled:opacity-30"
                  data-studio-piste-monter={p.id}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Faire passer cette piste derrière"
                  title={t('Faire passer derrière')}
                  disabled={rang === composition.pistes.length - 1}
                  onClick={() => onOperation({ op: 'piste-proprietes', pisteId: p.id, position: rang + 1 })}
                  className="flex h-3 w-4 items-center justify-center rounded text-faint hover:bg-raised hover:text-text disabled:opacity-30"
                  data-studio-piste-descendre={p.id}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </span>
              <button
                type="button"
                aria-label={`Retirer la piste « ${nomDeLaPiste(composition.pistes, p)} »`}
                title={t('Retirer la piste « {nom} »', { nom: nomDeLaPiste(composition.pistes, p) })}
                onClick={() => onOperation({ op: 'piste-supprimer', pisteId: p.id })}
                className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-raised hover:text-danger focus-visible:flex sm:group-hover:flex"
                data-studio-piste-supprimer={p.id}
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <OeilDeLaPiste piste={p} onOperation={onOperation} />
            </div>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mx-1 mt-1 flex h-[34px] sm:h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted transition-colors hover:bg-raised hover:text-text"
                data-studio-piste-ajouter
              >
                <Plus className="h-3 w-3" />
                {t('Piste')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {sujetsDePiste().map((sujet) => (
                <DropdownMenuItem
                  key={sujet.genre}
                  data-studio-nouvelle-piste={sujet.genre}
                  onSelect={() => onOperation({ op: 'piste-ajouter', genre: sujet.genre })}
                >
                  <sujet.Icone className="h-3.5 w-3.5" />
                  {sujet.nom}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative min-w-0 flex-1" data-studio-tete-fixe={teteFixe ? 'oui' : undefined} data-studio-retrait-tete={teteFixe ? retrait : undefined}>
        <ZoneDefilement ref={defil} axe="horizontal" classeEnveloppe="min-w-0 w-full" fond="hsl(var(--surface))">
          <div style={{ width: largeur + retrait }}>
          <div ref={zone} className="relative select-none" style={{ width: largeur, marginLeft: retrait }}>
            {composition.pistes.map((p) => (
              <div
                key={p.id}
                data-piste-id={p.id}
                data-piste-genre={p.genre}
                data-studio-piste-etat={glisser ? (!pisteAccepte(p.genre, glisser.genre) || p.masquee ? 'refuse' : glisser.cible === p.id ? 'survolee' : 'accepte') : undefined}
                className={cn(
                  'relative',
                  target?.id === p.id && dragging && 'bg-accent/10',
                  p.masquee && 'opacity-50',
                  /* PENDANT UN GLISSER : les pistes du bon type en violet, les autres estompées. */
                  glisser && (!pisteAccepte(p.genre, glisser.genre) || p.masquee ? 'opacity-30' : glisser.cible === p.id ? 'bg-teinte-plein/30' : 'bg-teinte-plein/10'),
                )}
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
                {glisser?.cible === p.id && glisser.instant !== null ? (
                  <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 -translate-x-1/2 bg-teinte-plein" style={{ left: glisser.instant * zoom }} data-studio-instant-du-glisser={glisser.instant} aria-hidden />
                ) : null}
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
                      data-studio-segment-masque={s.masque ? '' : undefined}
                      className={cn(
                        // PAS D'`overflow-hidden` ICI : les boutons de transition débordent du bloc ; c'est le nom qui se rogne.
                        'group/bloc absolute top-1 flex items-center gap-1 rounded-md px-2.5 text-[11.5px]',
                        fondDuSegment(s, choisi),
                        s.masque && 'opacity-50',
                        dragging?.id === s.id && 'opacity-80 shadow-lg',
                      )}
                      style={{ left: debut * zoom, width: largeurBloc, height: HAUTEUR_PISTE - 8, touchAction: 'pan-x', WebkitTouchCallout: 'none' }}
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
                        if (!a || e.shiftKey || e.metaKey || e.ctrlKey || Math.max(Math.abs(e.clientX - a.x), Math.abs(e.clientY - a.y)) >= 5) return;
                        // Tête fixe (téléphone) : un appui court CHOISIT le bloc, la ligne ne saute pas sous le doigt.
                        if (!teteFixe) onAller(Math.round(instantSous(e.clientX) * 100) / 100);
                      }}
                      /* LE MENU D'OPTIONS S'OUVRE AU DOUBLE-CLIC (au doigt : appui long). Un simple clic ne fait que choisir et situer. */
                      onDoubleClick={(e) => {
                        if ((e.target as Element).closest('button, [data-poignee]')) return;
                        onReglages?.(s.id);
                      }}
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
                        {/* LE LOSANGE : ce bloc fait un trajet (« Régler l'arrivée » dans son menu d'options). */}
                        {s.trajet ? (
                          <span className="shrink-0 text-[10px] leading-none" title={t('Ce bloc fait un trajet')} data-studio-losange-trajet={s.id}>
                            ◆
                          </span>
                        ) : null}
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
                      {/* L'ŒIL : montrer ou cacher CE bloc seul. Masqué, il reste visible, sans quoi rien ne dirait comment revenir. */}
                      {transitions ? (
                        <button
                          type="button"
                          aria-pressed={!!s.masque}
                          aria-label={s.masque ? `Afficher « ${nomDuSegment(s)} »` : `Masquer « ${nomDuSegment(s)} »`}
                          title={s.masque ? t('Afficher cet élément') : t('Masquer cet élément')}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOperation({ op: 'proprietes', segmentId: s.id, valeurs: { masque: !s.masque } });
                          }}
                          className={cn(
                            'absolute right-[38px] top-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-bg/70 text-text transition-opacity hover:bg-bg',
                            choisi || s.masque ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover/bloc:opacity-100',
                          )}
                          data-studio-oeil-segment={s.id}
                        >
                          {s.masque ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
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
                {(survol?.pisteId === p.id && !dragging && !glisser) || menu?.pisteId === p.id ? (
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
                        aria-label={`Ajouter sur la piste « ${nomDeLaPiste(composition.pistes, p)} »`}
                        title={t('Ajouter sur la piste « {v0} »', { v0: nomDeLaPiste(composition.pistes, p) })}
                        className="absolute top-1/2 z-10 flex h-[29px] sm:h-6 w-[29px] sm:w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-fg shadow"
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
                  top: 0,
                  // Des hachures fines, au jeton « faint » : lisibles en clair comme en sombre.
                  backgroundImage: 'repeating-linear-gradient(135deg, hsl(var(--faint) / 0.18) 0 2px, transparent 2px 9px)',
                }}
                data-studio-hors-video
                aria-hidden
              />
            ) : null}
            <div className="pointer-events-none absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-termine" style={{ left: marqueurAffiche * zoom, opacity: marqueurPose ? 1 : 0.45 }} aria-hidden />
            {/* LA TÊTE DE LECTURE : son trait (sa poignée vit sur la règle, dans la rangée collée). */}
            {!teteFixe ? <div className="pointer-events-none absolute top-0 z-20 h-full w-0.5 -translate-x-1/2 bg-danger" style={{ left: temps * zoom }} data-studio-curseur /> : null}
          </div>
          </div>
        </ZoneDefilement>
        {teteFixe ? <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 -translate-x-1/2 bg-danger" style={{ left: retrait }} data-studio-curseur aria-hidden /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * L'ŒIL D'UNE LIGNE DE LA LISTE : montrer ou cacher toute la piste ; pour une piste de son, le haut-parleur la coupe.
 * Toujours visible : il dit l'état de la piste, pas seulement un geste possible.
 */
function OeilDeLaPiste({ piste: p, onOperation }: { piste: Piste; onOperation: (op: OperationStudio) => void }) {
  const sonore = pisteSonore(p.genre);
  const eteinte = sonore ? !!p.muette : !!p.masquee;
  const titre = sonore ? (eteinte ? t('Remettre le son de la piste') : t('Couper le son de la piste')) : eteinte ? t('Afficher la piste') : t('Masquer la piste');
  const Icone = sonore ? (eteinte ? VolumeX : Volume2) : eteinte ? EyeOff : Eye;
  return (
    <button
      type="button"
      aria-pressed={eteinte}
      aria-label={`${sonore ? 'Son' : 'Affichage'} de la piste « ${p.id} » : ${eteinte ? 'éteint' : 'allumé'}`}
      title={titre}
      onClick={() => onOperation({ op: 'piste-proprietes', pisteId: p.id, ...(sonore ? { muette: !eteinte } : { masquee: !eteinte }) })}
      className={cn('flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded hover:bg-raised hover:text-text sm:h-6 sm:w-6', eteinte ? 'text-text' : 'text-faint')}
      data-studio-oeil-piste={p.id}
      data-studio-oeil-etat={eteinte ? 'eteint' : 'allume'}
    >
      <Icone className="h-3 w-3" />
    </button>
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
            'absolute top-1/2 z-10 flex h-6 sm:h-5 w-6 sm:w-5 -translate-y-1/2 items-center justify-center rounded-full bg-termine text-white shadow ring-2 ring-surface transition-opacity',
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
