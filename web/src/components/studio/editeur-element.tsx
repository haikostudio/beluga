import * as React from 'react';
import { Headphones, Pause, Play, Scissors, X } from 'lucide-react';
import {
  type Composition,
  type FormatStudio,
  type OperationStudio,
  type Segment,
  type SegmentAudio,
  type SegmentVideo,
  type SegmentVoix,
  debutMediaDe,
  piecesDuDessin,
  trouverSegment,
  vitesseDe,
} from '@beluga/shared';
import { BulleInfo, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { usePointerDrag } from '@/lib/dnd';
import { useTelephone } from '@/lib/telephone';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { Apercu, ApercuEnDirect, type ApercuDirect, type BoiteDuCadre, type MessageDuCadre, type PoigneeApercu } from './apercu';
import { Calques, Inspecteur } from './inspecteur';
import { libelleDuGenre } from './libelles';
import { FormeDOnde, useOnde } from './onde';
import { cn } from '@/lib/utils';
import type { DonneesCreation } from './types';

/**
 * LA FENÊTRE D'ÉDITION D'UN ÉLÉMENT — ouverte par un double-clic sur un bloc
 * de la ligne de temps (ou sur un calque), ou par « Ouvrir l'éditeur » de la
 * barre posée sur l'aperçu.
 *
 * Au centre, l'élément EN GRAND : pour un son, une voix ou une vidéo, sa BANDE
 * DU TEMPS (forme d'onde ou bande d'images du fichier entier) avec le passage
 * joué aux bords tirables, la sélection d'un passage à retirer, l'écoute ; pour
 * un visuel, l'aperçu agrandi avec les mêmes poignées et une tête de lecture
 * propre au segment. Pour un DESSIN, ses CALQUES ont leur colonne à GAUCHE
 * (comme dans l'éditeur principal), et ses RÉGLAGES la colonne de DROITE :
 * l'inspecteur lui-même, dont les couleurs se voient dans l'aperçu agrandi
 * pendant le choix. Chaque geste est une opération, donc une version, annulable.
 *
 * Sur téléphone : un tiroir plein, l'élément au-dessus de ses réglages (les
 * calques restent dans l'inspecteur).
 */

type SegmentSonore = SegmentAudio | SegmentVideo | SegmentVoix;

function estSonore(s: Segment): s is SegmentSonore {
  return s.genre === 'audio' || s.genre === 'video' || s.genre === 'voix';
}

export function EditeurElement({
  donnees,
  composition,
  segmentId,
  elementId,
  format,
  temps,
  onOperation,
  onVoixEssai,
  onMessageApercu,
  onChoisirPiece,
  onChangerImage,
  onAller,
  onClose,
}: {
  donnees: DonneesCreation;
  composition: Composition;
  segmentId: string;
  elementId: string | null;
  format: FormatStudio;
  temps: number;
  onOperation: (op: OperationStudio) => Promise<unknown>;
  onVoixEssai: (segmentId: string) => Promise<unknown>;
  /** Les gestes faits sur l'aperçu agrandi (retouche, texte, remise à l'origine) : traités comme ceux de l'aperçu principal. */
  onMessageApercu: (m: MessageDuCadre) => void;
  onChoisirPiece: (elementId: string | null) => void;
  onChangerImage: (boite: BoiteDuCadre, valeur: string) => void;
  onAller: (t: number) => void;
  onClose: () => void;
}) {
  const telephone = useTelephone();
  /** La pièce telle que l'aperçu agrandi la voit (nature, vraies couleurs) : l'inspecteur à droite s'y règle. */
  const [boite, setBoite] = React.useState<BoiteDuCadre | null>(null);
  /** L'aperçu agrandi : l'inspecteur y montre une couleur pendant qu'on la choisit. */
  const apercuVisuel = React.useRef<PoigneeApercu | null>(null);
  const direct = React.useCallback((m: ApercuDirect) => apercuVisuel.current?.direct(m), []);
  const trouve = trouverSegment(composition, segmentId);
  // L'élément a disparu (supprimé, annulé) : la fenêtre n'a plus rien à montrer.
  React.useEffect(() => {
    if (!trouve) onClose();
  }, [!!trouve]);
  if (!trouve) return null;
  const s = trouve.segment;

  /* UN TEXTE DE VOIX CHANGÉ ICI relance aussitôt la voix d'essai (gratuite) : on entend le nouveau texte. */
  const operer = async (op: OperationStudio) => {
    await onOperation(op);
    if (s.genre === 'voix' && op.op === 'proprietes' && typeof op.valeurs?.texte === 'string' && op.valeurs.texte.trim()) await onVoixEssai(s.id);
  };

  const titre = `${libelleDuGenre(s.genre)}${s.nom ? ` — ${s.nom}` : ''}`;
  // À quoi sert la fenêtre : derrière la pastille « i », jamais en paragraphe grisé (MEM-3449).
  const aide = (
    <BulleInfo cote="start">
      {estSonore(s)
        ? t('Lisez et parcourez le fichier, tirez les bords du passage joué, coupez un passage aux ciseaux, réglez la vitesse et le volume. Chaque geste s’annule.')
        : t('Retouchez la pièce sur l’image, réglez sa place dans le temps. Chaque geste s’annule.')}
    </BulleInfo>
  );
  // LES CALQUES À GAUCHE (ordinateur, dessin) : la droite ne garde que les réglages.
  const calquesAGauche = !telephone && s.genre === 'dessin' && piecesDuDessin(s.gabarit.html).length > 0;
  const corps = (
    <div
      className={cn('grid gap-3', calquesAGauche ? 'sm:grid-cols-[220px_minmax(0,1fr)_340px]' : 'sm:grid-cols-[minmax(0,1fr)_340px]')}
      data-studio-editeur-element={s.id}
      data-genre={s.genre}
    >
      {calquesAGauche && s.genre === 'dessin' ? (
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md bg-bloc sm:max-h-[calc(52vh+48px)]" data-studio-editeur-calques>
          <ZoneDefilement fond="hsl(var(--bloc))" className="pb-2">
            <Calques segment={s} elementId={elementId} format={format} formatDeBase={composition.format} onOperation={operer} onChoisirPiece={onChoisirPiece} />
          </ZoneDefilement>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        {estSonore(s) ? (
          <EditeurSonore donnees={donnees} segment={s} temps={temps} onOperation={operer} onAller={onAller} />
        ) : (
          <EditeurVisuel
            donnees={donnees}
            composition={composition}
            segment={s}
            elementId={elementId}
            format={format}
            temps={temps}
            onMessageApercu={onMessageApercu}
            onChoisirPiece={onChoisirPiece}
            onChangerImage={onChangerImage}
            onEchap={onClose}
            onBoite={setBoite}
            apercuRef={apercuVisuel}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2" data-studio-editeur-reglages>
        <Inspecteur
          composition={composition}
          segmentId={s.id}
          elementId={elementId}
          format={format}
          temps={temps}
          medias={donnees.medias}
          voixEssai={donnees.voixEssai}
          onOperation={operer}
          onVoixEssai={onVoixEssai}
          onChoisirPiece={onChoisirPiece}
          calquesAilleurs={calquesAGauche}
          piece={boite}
        />
      </div>
    </div>
  );
  const contenu = <ApercuEnDirect.Provider value={direct}>{corps}</ApercuEnDirect.Provider>;

  if (telephone) {
    return (
      <Drawer open onClose={onClose} empile plein>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
          <DialogTitle className="min-w-0 truncate">{titre}</DialogTitle>
          {aide}
          <span className="min-w-0 flex-1" aria-hidden />
          <Button size="icon" variant="ghost" aria-label="Fermer l’éditeur" title={t('Fermer')} onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4">
          {contenu}
        </ZoneDefilement>
      </Drawer>
    );
  }
  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      {/* Le focus reste où il était : posé d'office dans l'aperçu (un cadre isolé), il y garderait Échap pour lui. */}
      <DialogContent className={cn('sm:max-h-[92dvh]', calquesAGauche ? 'sm:w-[min(1280px,100%)]' : 'sm:w-[min(1040px,100%)]')} aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()} data-studio-fenetre-edition>
        <DialogHeader className="flex items-center gap-1">
          <DialogTitle>{titre}</DialogTitle>
          {aide}
        </DialogHeader>
        {contenu}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Un visuel : l'aperçu agrandi et sa tête de lecture                   */
/* ------------------------------------------------------------------ */

function EditeurVisuel({
  donnees,
  composition,
  segment,
  elementId,
  format,
  temps,
  onMessageApercu,
  onChoisirPiece,
  onChangerImage,
  onEchap,
  onBoite,
  apercuRef,
}: {
  donnees: DonneesCreation;
  composition: Composition;
  segment: Segment;
  onEchap: () => void;
  /** La poignée de l'aperçu agrandi, partagée avec la fenêtre (couleurs montrées en direct). */
  apercuRef: React.MutableRefObject<PoigneeApercu | null>;
  onBoite: (b: BoiteDuCadre | null) => void;
  elementId: string | null;
  format: FormatStudio;
  temps: number;
  onMessageApercu: (m: MessageDuCadre) => void;
  onChoisirPiece: (elementId: string | null) => void;
  onChangerImage: (boite: BoiteDuCadre, valeur: string) => void;
}) {
  const apercu = apercuRef;
  const fin = segment.debut + segment.duree;
  const borne = (x: number) => Math.max(segment.debut, Math.min(fin - 0.01, x));
  // La tête de lecture de la fenêtre : dans le segment, là où était celle de l'éditeur si elle y tombait.
  const [local, setLocal] = React.useState(() => borne(temps));
  const [lecture, setLecture] = React.useState(false);
  const elementRef = React.useRef(elementId);
  elementRef.current = elementId;
  // Une pièce choisie dans les CALQUES de la fenêtre : l'aperçu agrandi la choisit aussi.
  React.useEffect(() => {
    apercu.current?.selectionner(segment.id, elementId);
  }, [segment.id, elementId]);

  const surMessage = (m: MessageDuCadre) => {
    if (m.type === 'pret') apercu.current?.selectionner(segment.id, elementRef.current);
    else if (m.type === 'temps' && typeof m.t === 'number') {
      if (m.t >= fin) {
        apercu.current?.pause();
        setLecture(false);
        setLocal(borne(m.t));
      } else setLocal(m.t);
    } else if (m.type === 'fin') setLecture(false);
    else if (m.type === 'selection') onChoisirPiece(m.segmentId === segment.id ? (m.elementId ?? null) : null);
    else if (m.type === 'retouche' || m.type === 'texte' || m.type === 'effacer') onMessageApercu(m);
  };
  const images = donnees.medias.filter((m) => m.genre === 'image').map((m) => ({ valeur: m.id, libelle: m.nom }));
  const aller = (x: number) => {
    setLecture(false);
    setLocal(x);
    apercu.current?.aller(x);
  };
  return (
    <>
      <div className="h-[52vh] min-h-[260px] rounded-md bg-bg p-2 max-sm:h-[40vh]">
        <Apercu
          ref={apercu}
          composition={composition}
          format={format}
          kit={donnees.espace.kit}
          adressesMedias={donnees.adressesMedias}
          temps={local}
          lecture={lecture}
          onMessage={surMessage}
          images={images}
          onChangerImage={onChangerImage}
          onEchap={onEchap}
          onBoite={onBoite}
        />
      </div>
      {/* LA TÊTE DE LECTURE DU SEGMENT : de son début à sa fin, rien d'autre. */}
      <div className="flex items-center gap-2" data-studio-editeur-tete>
        <Button
          size="icon"
          variant="ghost"
          aria-label={lecture ? 'Pause' : 'Lire le segment'}
          title={lecture ? t('Pause') : t('Lire le segment')}
          onClick={() => {
            if (lecture) {
              apercu.current?.pause();
              setLecture(false);
            } else {
              apercu.current?.lire(local >= fin - 0.05 ? segment.debut : local);
              setLecture(true);
            }
          }}
        >
          {lecture ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <input
          type="range"
          min={segment.debut}
          max={fin}
          step={1 / 30}
          value={local}
          onChange={(e) => aller(Number(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 accent-[hsl(var(--accent))]"
          aria-label="Instant dans le segment"
        />
        <span className="w-24 shrink-0 text-right text-[12px] tabular-nums text-muted">
          {t('{t} s / {d} s', { t: local.toFixed(2), d: fin.toFixed(1) })}
        </span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Un son, une voix, une vidéo : la bande du temps                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Un son, une voix, une vidéo : la bande du temps                      */
/* ------------------------------------------------------------------ */

interface Bande {
  image: string;
  images: number;
  /** Taille d'UNE vignette dans la planche. */
  largeur: number;
  hauteur: number;
  duree: number;
}

const BANDES = new Map<string, Promise<Bande>>();

function chargerBande(creationId: string, mediaId: string): Promise<Bande> {
  const cle = `${creationId}:${mediaId}`;
  const deja = BANDES.get(cle);
  if (deja) return deja;
  const travail = client.call<Bande>({ type: 'studio.media.bande', creationId, mediaId });
  BANDES.set(cle, travail);
  travail.catch(() => BANDES.delete(cle));
  return travail;
}

/**
 * LA BANDE D'IMAGES : des tuiles à la VRAIE proportion de la vidéo (jamais une
 * planche étirée sur la largeur), et chaque tuile montre la vignette la plus
 * proche de l'instant qu'elle couvre — l'image sous la souris est celle du temps
 * sous la souris.
 */
function TuilesDImages({ bande, largeur, hauteur, dureeFichier }: { bande: Bande; largeur: number; hauteur: number; dureeFichier: number }) {
  const tuile = Math.max(8, (hauteur * bande.largeur) / Math.max(1, bande.hauteur));
  const nombre = Math.max(1, Math.ceil(largeur / tuile));
  const tuiles: { x: number; k: number }[] = [];
  for (let i = 0; i < nombre; i++) {
    const x = i * tuile;
    const instant = (Math.min(largeur, x + tuile / 2) / largeur) * dureeFichier;
    const k = Math.max(0, Math.min(bande.images - 1, Math.round((instant / Math.max(0.001, bande.duree)) * bande.images)));
    tuiles.push({ x, k });
  }
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black" data-studio-tuiles={`${bande.largeur}x${bande.hauteur}`}>
      {tuiles.map(({ x, k }) => (
        <div
          key={x}
          className="absolute top-0 border-r border-black/40"
          style={{
            left: x,
            width: tuile,
            height: hauteur,
            backgroundImage: `url(${bande.image})`,
            backgroundSize: `${bande.images * tuile}px ${hauteur}px`,
            backgroundPosition: `-${k * tuile}px 0`,
          }}
          data-studio-vignette={k}
        />
      ))}
    </div>
  );
}

interface OrigineGeste {
  x: number;
  /** Le bord gauche de la bande au moment de l'appui. */
  gauche: number;
  debutMedia: number;
  finMedia: number;
  /** Pour une sélection : l'instant du fichier où elle commence. */
  depart?: number;
}

type GesteBande = 'bord-debut' | 'bord-fin' | 'passage' | 'selection' | 'defiler';

const HAUTEUR_IMAGES = 64;

function EditeurSonore({
  donnees,
  segment: s,
  temps,
  onOperation,
  onAller,
}: {
  donnees: DonneesCreation;
  segment: SegmentSonore;
  temps: number;
  onOperation: (op: OperationStudio) => Promise<unknown>;
  onAller: (t: number) => void;
}) {
  const media = s.mediaId ? donnees.medias.find((m) => m.id === s.mediaId) : undefined;
  const url = s.mediaId ? donnees.adressesMedias[s.mediaId]?.url : undefined;
  const video = s.genre === 'video';
  const { onde, panne: panneOnde } = useOnde(url);
  const [bande, setBande] = React.useState<Bande | null>(null);
  const [panneBande, setPanneBande] = React.useState<string | null>(null);
  const [largeur, setLargeur] = React.useState(600);
  const [selection, setSelection] = React.useState<{ de: number; a: number } | null>(null);
  /** LES CISEAUX : glisser sur la bande choisit alors un passage à retirer, au lieu de défiler. */
  const [ciseaux, setCiseaux] = React.useState(false);
  const [joue, setJoue] = React.useState(false);
  const zone = React.useRef<HTMLDivElement | null>(null);
  const lecteur = React.useRef<HTMLMediaElement | null>(null);
  const origine = React.useRef<OrigineGeste | null>(null);
  const dernier = React.useRef<{ x: number } | null>(null);
  const appui = React.useRef<{ x: number } | null>(null);
  const finLecture = React.useRef<number>(Infinity);

  React.useEffect(() => {
    if (!url || !video) return;
    let vivant = true;
    setPanneBande(null);
    chargerBande(donnees.creation.id, s.mediaId!)
      .then((b) => vivant && setBande(b))
      .catch((err: any) => vivant && setPanneBande(err?.message ?? t('Bande d’images indisponible')));
    return () => {
      vivant = false;
    };
  }, [url, video]);

  React.useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setLargeur(el.clientWidth || 600));
    obs.observe(el);
    setLargeur(el.clientWidth || 600);
    return () => obs.disconnect();
  }, [!!url]);

  const vitesse = vitesseDe(s);
  const debutMedia = debutMediaDe(s);
  const finMedia = debutMedia + s.duree * vitesse;
  const dureeFichier = Math.max(
    finMedia,
    0.5,
    (s.genre === 'voix' ? s.dureeAudio : undefined) ?? media?.duree ?? onde?.duree ?? bande?.duree ?? finMedia,
  );
  const px = (sec: number) => (sec / dureeFichier) * largeur;
  const sec = (x: number) => Math.max(0, Math.min(dureeFichier, (x / largeur) * dureeFichier));
  /** Un instant du fichier → l'instant de la composition (dans le segment). */
  const versComposition = (m: number) => s.debut + (m - debutMedia) / vitesse;
  const dansLePassage = (m: number) => m >= debutMedia - 0.001 && m <= finMedia + 0.001;

  /* LA TÊTE DE LA FENÊTRE (en temps du fichier) : celle de l'éditeur quand elle tombe dans ce segment, sinon le début du passage. */
  const teteFichier = temps >= s.debut && temps <= s.debut + s.duree ? debutMedia + (temps - s.debut) * vitesse : null;
  const [curseur, setCurseur] = React.useState<number>(() => teteFichier ?? debutMedia);
  React.useEffect(() => {
    if (teteFichier !== null && !joue && !origine.current) setCurseur(teteFichier);
  }, [teteFichier]);

  const placerLecteur = (m: number, rapide = false) => {
    const el = lecteur.current;
    if (!el) return;
    try {
      if (rapide && 'fastSeek' in el && typeof (el as any).fastSeek === 'function') (el as any).fastSeek(m);
      else el.currentTime = m;
    } catch {
      /* fichier pas encore prêt */
    }
  };

  /* LA LECTURE : le passage joué, à sa vitesse et à son volume, depuis la tête (ou son début). */
  const jouer = (de: number, a: number) => {
    const el = lecteur.current;
    if (!el) return;
    finLecture.current = a;
    el.currentTime = de;
    el.playbackRate = vitesse;
    el.volume = Math.max(0, Math.min(1, s.volume));
    setCurseur(de);
    void el.play().catch(() => setJoue(false));
    setJoue(true);
  };
  const arreter = (poserTete: boolean) => {
    const el = lecteur.current;
    el?.pause();
    setJoue(false);
    if (poserTete && el && dansLePassage(el.currentTime)) onAller(Math.round(versComposition(el.currentTime) * 100) / 100);
  };
  const basculer = () => {
    if (joue) arreter(true);
    else jouer(curseur >= debutMedia && curseur < finMedia - 0.05 ? curseur : debutMedia, finMedia);
  };
  const basculerRef = React.useRef(basculer);
  basculerRef.current = basculer;
  React.useEffect(() => {
    if (!joue) return;
    let image = 0;
    const suivre = () => {
      const el = lecteur.current;
      if (!el || el.paused) return setJoue(false);
      if (el.currentTime >= finLecture.current) {
        el.pause();
        setCurseur(finLecture.current);
        return setJoue(false);
      }
      setCurseur(el.currentTime);
      image = requestAnimationFrame(suivre);
    };
    image = requestAnimationFrame(suivre);
    return () => cancelAnimationFrame(image);
  }, [joue]);
  React.useEffect(() => () => lecteur.current?.pause(), []);
  /* ESPACE : lecture / pause de la fenêtre (le raccourci du Studio se tait tant qu'elle est ouverte). */
  React.useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(cible.tagName))) return;
      e.preventDefault();
      basculerRef.current();
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, []);

  /* LES GESTES DE LA BANDE — un seul glisser, `usePointerDrag` : défiler (par défaut), les deux bords du passage, le passage entier, une sélection (ciseaux). */
  const resoudre = React.useCallback(() => null, []);
  const lacher = React.useCallback(
    (item: { kind: string }) => {
      const o = origine.current;
      const f = dernier.current;
      origine.current = null;
      if (!o || !f) return;
      const d = ((f.x - o.x) / largeur) * dureeFichier;
      const arrondi = (x: number) => Math.round(x * 100) / 100;
      if (item.kind === 'defiler') {
        const m = sec(f.x - o.gauche);
        setCurseur(m);
        placerLecteur(m);
        if (dansLePassage(m)) onAller(arrondi(versComposition(m)));
      } else if (item.kind === 'bord-debut') {
        const nouveau = arrondi(Math.max(0, Math.min(o.finMedia - 0.1, o.debutMedia + d)));
        void onOperation({
          op: 'lot',
          operations: [
            { op: 'rogner', segmentId: s.id, duree: arrondi((o.finMedia - nouveau) / vitesse) },
            { op: 'proprietes', segmentId: s.id, valeurs: { debutMedia: nouveau } },
          ],
        }).catch(() => undefined);
      } else if (item.kind === 'bord-fin') {
        const nouvelle = Math.max(o.debutMedia + 0.1, Math.min(dureeFichier, o.finMedia + d));
        void onOperation({ op: 'rogner', segmentId: s.id, duree: arrondi((nouvelle - o.debutMedia) / vitesse) }).catch(() => undefined);
      } else if (item.kind === 'passage') {
        const nouveau = arrondi(Math.max(0, Math.min(dureeFichier - (o.finMedia - o.debutMedia), o.debutMedia + d)));
        if (Math.abs(nouveau - o.debutMedia) > 0.01) void onOperation({ op: 'proprietes', segmentId: s.id, valeurs: { debutMedia: nouveau } }).catch(() => undefined);
      } else if (item.kind === 'selection' && o.depart !== undefined) {
        const bout = o.depart + d;
        const de = Math.max(debutMedia, Math.min(o.depart, bout));
        const a = Math.min(finMedia, Math.max(o.depart, bout));
        setSelection(a - de >= 0.1 ? { de: arrondi(de), a: arrondi(a) } : null);
      }
    },
    [largeur, dureeFichier, vitesse, s.id, debutMedia, finMedia, s.debut],
  );
  const { dragging, pointer, start } = usePointerDrag({ resolve: resoudre, onDrop: lacher });
  if (pointer) dernier.current = pointer;

  // DÉFILER : la tête et l'image suivent la main, en direct.
  React.useEffect(() => {
    const o = origine.current;
    if (dragging?.kind !== 'defiler' || !pointer || !o) return;
    const m = sec(pointer.x - o.gauche);
    setCurseur(m);
    placerLecteur(m, true);
  }, [pointer?.x, dragging?.kind]);

  const saisir = (e: React.PointerEvent, kind: GesteBande) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (joue) arreter(false);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* rien */
    }
    const gauche = zone.current?.getBoundingClientRect().left ?? 0;
    appui.current = { x: e.clientX };
    origine.current = { x: e.clientX, gauche, debutMedia, finMedia, ...(kind === 'selection' ? { depart: sec(e.clientX - gauche) } : {}) };
    dernier.current = { x: e.clientX };
    start(e, { id: s.id, kind, label: t('Passage joué') });
  };

  // Ce qu'on montre pendant un geste : les bords suivent la main.
  let vueDebut = debutMedia;
  let vueFin = finMedia;
  let vueSelection = selection;
  if (dragging && pointer && origine.current) {
    const d = ((pointer.x - origine.current.x) / largeur) * dureeFichier;
    if (dragging.kind === 'bord-debut') vueDebut = Math.max(0, Math.min(origine.current.finMedia - 0.1, origine.current.debutMedia + d));
    else if (dragging.kind === 'bord-fin') vueFin = Math.max(origine.current.debutMedia + 0.1, Math.min(dureeFichier, origine.current.finMedia + d));
    else if (dragging.kind === 'passage') {
      const l = origine.current.finMedia - origine.current.debutMedia;
      vueDebut = Math.max(0, Math.min(dureeFichier - l, origine.current.debutMedia + d));
      vueFin = vueDebut + l;
    } else if (dragging.kind === 'selection' && origine.current.depart !== undefined) {
      const bout = origine.current.depart + d;
      vueSelection = { de: Math.max(debutMedia, Math.min(origine.current.depart, bout)), a: Math.min(finMedia, Math.max(origine.current.depart, bout)) };
    }
  }

  const nombre = (x: number) => x.toLocaleString(formatRegional(), { maximumFractionDigits: 2 });
  const graduation = dureeFichier > 120 ? 30 : dureeFichier > 40 ? 10 : dureeFichier > 12 ? 2 : 1;
  const graduations: number[] = [];
  for (let g = 0; g <= dureeFichier; g += graduation) graduations.push(g);
  const selectionPossible = s.genre !== 'voix';
  const oublier = () => {
    setSelection(null);
    setCiseaux(false);
  };

  if (!url) return <p className="text-[12.5px] text-faint">{t('Cet élément n’a pas encore de son : fabriquez sa voix d’essai.')}</p>;

  const ondeDessin = (classe: string) =>
    onde ? (
      <FormeDOnde onde={onde} de={0} a={dureeFichier} colonnes={largeur / 2} className={classe} />
    ) : (
      <span className="absolute inset-0 flex items-center justify-center text-[11px] text-faint" data-studio-onde-absente={panneOnde ?? 'lecture'}>
        {panneOnde === 'sans-son' ? t('Pas de son dans ce fichier') : panneOnde ? t('La forme d’onde n’a pas pu être lue.') : t('Lecture du fichier…')}
      </span>
    );

  return (
    <div className="flex flex-col gap-2" data-studio-bande={s.genre}>
      {video ? (
        <video ref={(el) => void (lecteur.current = el)} src={url} preload="auto" playsInline className="max-h-[34vh] w-full rounded-md bg-black object-contain" data-studio-editeur-video />
      ) : (
        <audio ref={(el) => void (lecteur.current = el)} src={url} preload="auto" />
      )}
      {/* LE LECTEUR : lecture / pause du passage joué, l'instant de la tête, les ciseaux. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <Button size="sm" variant="outline" aria-label={joue ? 'Pause' : 'Lire'} title={joue ? t('Pause (Espace)') : t('Lire le passage (Espace)')} onClick={basculer} data-studio-lecture={joue ? 'joue' : 'arret'}>
          {joue ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {joue ? t('Pause') : t('Lire')}
        </Button>
        <span className="tabular-nums text-muted" data-studio-instant-fichier>
          {t('{t} s du fichier', { t: curseur.toFixed(2) })}
        </span>
        <span className="min-w-0 flex-1" aria-hidden />
        {selectionPossible ? (
          <Button
            size="sm"
            variant={ciseaux ? 'default' : 'ghost'}
            aria-pressed={ciseaux}
            aria-label="Choisir un passage à retirer"
            title={ciseaux ? t('Glisser choisit un passage à retirer ; cliquez pour revenir au défilement') : t('Choisir un passage à retirer')}
            onClick={() => (ciseaux ? oublier() : setCiseaux(true))}
            data-studio-mode-selection={ciseaux ? 'actif' : 'inactif'}
          >
            <Scissors className="h-3.5 w-3.5" />
            {t('Couper un passage')}
          </Button>
        ) : null}
      </div>
      <div
        ref={zone}
        className={cn('relative h-28 select-none overflow-hidden rounded-md bg-bloc', ciseaux ? 'cursor-crosshair' : 'cursor-col-resize')}
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => saisir(e, ciseaux && selectionPossible ? 'selection' : 'defiler')}
        onClick={(e) => {
          /* UN CLIC SANS GLISSER pose la tête à cet instant (et celle de l'éditeur, s'il tombe dans le passage joué). */
          const a = appui.current;
          appui.current = null;
          if (!a || Math.abs(e.clientX - a.x) >= 5 || !zone.current || ciseaux) return;
          const m = sec(e.clientX - zone.current.getBoundingClientRect().left);
          setCurseur(m);
          placerLecteur(m);
          if (dansLePassage(m)) onAller(Math.round(versComposition(m) * 100) / 100);
        }}
        data-studio-bande-zone
      >
        {video ? (
          <>
            <div className="absolute inset-x-0 top-0" style={{ height: HAUTEUR_IMAGES }}>
              {bande ? (
                <TuilesDImages bande={bande} largeur={largeur} hauteur={HAUTEUR_IMAGES} dureeFichier={dureeFichier} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[12px] text-faint">{panneBande ?? t('Lecture du fichier…')}</span>
              )}
            </div>
            {/* LE SON DE LA VIDÉO, sous ses images, à la même échelle. */}
            <div className="absolute inset-x-0 bottom-0 border-t border-faint/30" style={{ top: HAUTEUR_IMAGES }} data-studio-onde-video>
              {ondeDessin('pointer-events-none absolute inset-0 h-full w-full text-info')}
            </div>
          </>
        ) : (
          ondeDessin('pointer-events-none absolute inset-0 h-full w-full text-info')
        )}
        {/* Hors du passage joué : voilé. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/70" style={{ width: px(vueDebut) }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-bg/70" style={{ left: px(vueFin) }} />
        {/* LES MOTS D'UNE VOIX, à leur place dans le son. */}
        {s.genre === 'voix'
          ? (s.mots ?? []).map((m, i) => (
              <span key={i} className="pointer-events-none absolute bottom-1 truncate text-[10px] text-text" style={{ left: px(m.debut), maxWidth: Math.max(12, px(m.fin) - px(m.debut)) }} data-studio-mot>
                {m.texte}
              </span>
            ))
          : null}
        {/* LE PASSAGE JOUÉ : ses bords se tirent ; tiré par sa barre du haut, il glisse dans le fichier. */}
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-accent"
          style={{ left: px(vueDebut), width: Math.max(4, px(vueFin) - px(vueDebut)) }}
          data-studio-passage={`${vueDebut.toFixed(2)}-${vueFin.toFixed(2)}`}
        >
          <span
            role="presentation"
            title={t('Faire glisser le passage dans le fichier')}
            className="pointer-events-auto absolute inset-x-3 top-0 h-3.5 cursor-grab bg-accent/70 max-sm:inset-x-5 max-sm:h-5"
            onPointerDown={(e) => saisir(e, 'passage')}
            data-studio-glisser-passage
          />
          <span
            role="presentation"
            className="pointer-events-auto absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l bg-accent max-sm:w-5"
            onPointerDown={(e) => saisir(e, 'bord-debut')}
            data-studio-bord="debut"
          />
          <span
            role="presentation"
            className="pointer-events-auto absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r bg-accent max-sm:w-5"
            onPointerDown={(e) => saisir(e, 'bord-fin')}
            data-studio-bord="fin"
          />
        </div>
        {vueSelection ? (
          <div className="pointer-events-none absolute inset-y-0 bg-danger/30 ring-1 ring-inset ring-danger" style={{ left: px(vueSelection.de), width: Math.max(2, px(vueSelection.a) - px(vueSelection.de)) }} data-studio-selection-passage />
        ) : null}
        {/* LA TÊTE : elle suit la lecture et la main qui fait défiler. */}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-danger shadow-[0_0_0_1px_rgba(255,255,255,0.6)]" style={{ left: px(curseur) }} data-studio-bande-tete={curseur.toFixed(2)} />
      </div>
      <div className="relative h-4 text-[10px] tabular-nums text-faint" aria-hidden>
        {graduations.map((g) => (
          <span key={g} className="absolute -translate-x-1/2" style={{ left: Math.min(largeur - 8, Math.max(8, px(g))) }}>
            {g}s
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="min-w-0 text-muted" data-studio-passage-lu>
          {t('Passage joué : {de} s → {a} s du fichier ({n} s)', { de: nombre(debutMedia), a: nombre(finMedia), n: nombre(dureeFichier) })}
        </span>
        <BulleInfo cote="start">
          {s.genre === 'voix'
            ? t('Glissez sur la bande pour la parcourir. Pour retirer un passage d’une voix, retirez ses mots dans le texte : la voix d’essai se refait aussitôt.')
            : t('Glissez sur la bande pour la parcourir. Pour retirer un passage, prenez les ciseaux puis glissez sur ce passage.')}
        </BulleInfo>
      </div>
      {selectionPossible && selection ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-raised px-2 py-1.5 text-[12.5px]" data-studio-passage-choisi>
          <span className="min-w-0 flex-1">{t('Passage choisi : {de} s → {a} s', { de: nombre(selection.de), a: nombre(selection.a) })}</span>
          <Button size="sm" variant="ghost" onClick={() => (joue ? arreter(false) : jouer(selection.de, selection.a))}>
            {joue ? <Pause className="h-3.5 w-3.5" /> : <Headphones className="h-3.5 w-3.5" />}
            {joue ? t('Arrêter') : t('Écouter')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const de = Math.round(versComposition(selection.de) * 1000) / 1000;
              const a = Math.round(versComposition(selection.a) * 1000) / 1000;
              oublier();
              void onOperation({ op: 'retirer-passage', segmentId: s.id, de, a }).catch(() => undefined);
            }}
            data-studio-retirer-passage
          >
            <Scissors className="h-3.5 w-3.5" />
            {t('Retirer ce passage')}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Oublier la sélection" title={t('Oublier la sélection')} onClick={oublier}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
