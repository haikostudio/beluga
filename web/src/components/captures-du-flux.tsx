import * as React from 'react';
import { Camera, ChevronDown, Eye, FileText, Play } from 'lucide-react';
import {
  captureDuChemin,
  capturesArriveesDepuis,
  capturesDuFlux,
  capturesPasEncoreVues,
  clesAMarquerVues,
  heureExacte,
  type Attachment,
  type CaptureDuFlux,
  etiquetteDePiece,
  lettreDeLExemple,
  repereDuChemin,
  repereDuNomSurDisque,
  pieceDuChemin,
  type RunStep,
} from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { LecteurSon } from '@/components/lecteur-son';
import { VignetteVideo } from '@/components/lecteur-video';
import { EtiquetteDeVignette, LARGEUR_DE_VIGNETTE } from '@/components/pastille-de-fichier';
import { ZoneDefilement } from '@/components/ui';
import { EnTeteDePanneau, Panneau } from '@/components/panneau';
import { CommandesDesVues, RienDeNouveau } from '@/components/commandes-des-vues';
import { GlissableVersUnPlan } from '@/components/glisser-vers-un-plan';
import { client } from '@/lib/client';
import { useImagesVues } from '@/lib/use-images-vues';
import { useApp } from '@/lib/use-app';
import { usePref } from '@/lib/prefs';
import { t } from '@/lib/langue';
import { useMinute } from '@/lib/horloge';
import { cn, ilYA } from '@/lib/utils';

/**
 * CE QUE L'AGENT A VU, EN PIED DE FLUX.
 *
 * Toutes les images de l'agent — ce qu'il a regardé pendant ses étapes, les
 * captures rangées par le démon, les illustrations qu'il a fabriquées ; jamais
 * celles que l'utilisateur a jointes — sur UNE SEULE LIGNE de vignettes de même
 * taille au bas de sa réponse (`capturesDuFlux`, `shared/src/captures-du-flux.ts`) :
 * la plus récente tout à gauche, le reste défile sur le côté. La bande grandit
 * en direct, à chaque image : on suit ce que l'agent regarde sans déplier son
 * déroulé. Un clic ouvre l'aperçu en grand, qui se feuillette dans l'ordre de
 * la bande. Une capture que le serveur ne sait plus servir (fichier temporaire
 * effacé) se retire d'elle-même plutôt que de laisser un cadre cassé.
 *
 * CHAQUE VIGNETTE DIT QUAND ET SI ON L'A DÉJÀ OUVERTE : en bas à droite, le
 * temps écoulé depuis que l'agent a regardé l'image, comme le fil d'une carte
 * (« il y a 12 min », puis la date et l'heure au-delà de sept jours — `ilYA`,
 * demande du 27/10/2026 ; l'heure exacte en infobulle), et un œil au coin haut
 * droit une fois l'image affichée en grand. « Vue »
 * veut dire OUVERTE ou FEUILLETÉE dans la visionneuse, jamais « passée à
 * l'écran » ; c'est retenu par compte, au serveur, donc d'un appareil à l'autre.
 *
 * SUR UNE CARTE À CENTAINES D'IMAGES, DEUX COMMANDES à droite du titre : le
 * filtre « pas encore vues » (il n'agit que sur les vignettes — la visionneuse
 * garde toute la série) et « tout marquer comme vu » (`CommandesDesVues`). Le
 * mécanisme de l'œil est celui de `useImagesVues`, partagé avec l'onglet des
 * pièces jointes et les notes.
 *
 * LES VIDÉOS ET LES SONS DE L'AGENT Y SONT AUSSI : une vidéo est une vignette
 * à son image d'aperçu, bouton lecture au centre, qui s'ouvre en grand ; un son
 * est un lecteur à onde qui se joue sur place (`LecteurSon`), avec « agrandir ».
 *
 * SUR LA PAGE D'UNE CARTE, LA BANDE EST COLLÉE EN BAS, hors de la zone qui
 * défile (`chat.tsx`), et un CHEVRON à droite de son titre la replie sur cette
 * seule ligne ; le repli est un réglage du compte (`captures.repliee`).
 */

/** Une vignette de la bande : toujours la même boîte, l'image entière dedans. */
const VIGNETTE = 'h-20 w-28 shrink-0';
/** En deçà, la bande est « au début » : une capture neuve y est ramenée à la vue. */
const MARGE_DU_DEBUT_PX = 240;

export interface GalerieDesCaptures {
  captures: CaptureDuFlux[];
  source: (c: CaptureDuFlux) => string;
  perdre: (c: CaptureDuFlux) => void;
  /** Les pièces de l'aperçu, dans l'ordre de la bande. */
  galerie: Attachment[];
  sourceDePiece: (p: Attachment) => string;
  /** La pièce ouverte en grand, ou null. */
  apercu: Attachment | null;
  /** L'heure d'une pièce de la galerie : celle de sa vignette. */
  quandDePiece: (p: Attachment) => number | undefined;
  /** Cette image a-t-elle déjà été ouverte en grand par ce compte ? */
  dejaVue: (c: CaptureDuFlux) => boolean;
  /** Les clés déjà vues par ce compte, pour les règles pures (`capturesPasEncoreVues`). */
  vues: ReadonlySet<string>;
  /** « Tout marquer comme vu » : toutes les images de la bande, d'un seul geste. */
  toutMarquer: () => void;
  /** Pareil, pour la pièce montrée dans la visionneuse : son état d'AVANT cet affichage. */
  pieceDejaVue: (p: Attachment) => boolean;
  ouvrir: (c: CaptureDuFlux) => void;
  /** Ouvre en grand l'image d'un chemin vu dans le fil ; faux si la bande ne la connaît pas. */
  ouvrirLeChemin: (chemin: string) => boolean;
  /** Le repère court (« #1a0c ») d'une capture qui est une pièce jointe, sinon null. */
  repere: (c: CaptureDuFlux) => string | null;
  /** Le même, pour la pièce montrée dans la visionneuse. */
  repereDePiece: (p: Attachment) => string | null;
  /** Le même, pour une image vue dans le fil par son seul chemin. */
  repereDuChemin: (chemin: string) => string | null;
  /** L'identifiant de la pièce jointe qu'un chemin désigne, sinon null (son menu « … »). */
  pieceDuChemin: (chemin: string) => string | null;
  fermer: () => void;
  naviguer: (p: Attachment) => void;
}

/**
 * LA LISTE DES IMAGES ET LA FENÊTRE QUI LES FEUILLETTE, en un seul endroit :
 * la bande ET les vignettes du fil (`OuvrirUneCapture`) ouvrent le même aperçu
 * sur la même liste, donc on passe de n'importe quelle image à ses voisines.
 */
export function useGalerieDesCaptures(steps: RunStep[], idsJointes: string[], projectId?: string): GalerieDesCaptures {
  const state = useApp();
  const connues = projectId ? state.attachments[projectId] : undefined;
  // La liste du projet peut ne pas être encore chargée : on la demande — aussi
  // pour une image d'étape, dont le chemin peut désigner une pièce (son repère).
  const manquante = (idsJointes.length > 0 || steps.length > 0) && !!projectId && !connues;
  React.useEffect(() => {
    if (manquante && projectId) client.send({ type: 'attachments.list', projectId });
  }, [manquante, projectId]);
  const jointes = React.useMemo(
    () => idsJointes.map((id) => connues?.find((piece) => piece.id === id)).filter(Boolean) as Attachment[],
    [idsJointes, connues],
  );
  const [perdues, setPerdues] = React.useState<Set<string>>(new Set());
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const captures = React.useMemo(
    () => capturesDuFlux(steps, jointes).filter((c) => !perdues.has(c.cle)),
    [steps, jointes, perdues],
  );

  const source = React.useCallback(
    (c: CaptureDuFlux) =>
      c.genre === 'etape'
        ? `/api/capture?project=${encodeURIComponent(projectId ?? '')}&path=${encodeURIComponent(c.chemin)}`
        : `/api/attachment?id=${encodeURIComponent(c.id)}`,
    [projectId],
  );

  /*
   * L'APERÇU NE CONNAÎT QUE DES PIÈCES : une capture d'étape non rangée en pièce
   * jointe en reçoit une de circonstance, dont l'identifiant est sa clé. Son
   * image se lit par `source`, jamais par la route des pièces jointes.
   */
  const piece = React.useCallback(
    (c: CaptureDuFlux): Attachment | undefined =>
      c.genre === 'jointe'
        ? jointes.find((j) => j.id === c.id)
        : { id: c.cle, projectId: projectId ?? '', name: c.libelle, mime: 'image/png', size: 0, sha: '', createdAt: c.quand },
    [jointes, projectId],
  );
  const galerie = React.useMemo(() => captures.map(piece).filter(Boolean) as Attachment[], [captures, piece]);
  const captureDePiece = React.useCallback(
    (p: Attachment) => captures.find((c) => c.cle === p.id || (c.genre === 'jointe' && c.id === p.id)),
    [captures],
  );
  const sourceDePiece = React.useCallback(
    (p: Attachment) => {
      const trouvee = captureDePiece(p);
      return trouvee ? source(trouvee) : `/api/attachment?id=${encodeURIComponent(p.id)}`;
    },
    [captureDePiece, source],
  );
  // L'heure de la VIGNETTE, pas la date de rangement de la pièce : la même des deux côtés.
  const quandDePiece = React.useCallback((p: Attachment) => captureDePiece(p)?.quand || undefined, [captureDePiece]);

  /*
   * AFFICHER EN GRAND, C'EST AVOIR VU. Les trois chemins vers la visionneuse
   * (clic sur une vignette, image citée dans le fil, feuilletage) passent par
   * `montrer`, qui lit l'état d'AVANT puis marque (`useImagesVues`).
   */
  const images = useImagesVues(captures);
  const { dejaVue, dejaVueAvantOuverture, ouvrirEnMarquant, marquer } = images;
  const montrer = React.useCallback(
    (c: CaptureDuFlux | undefined, ouverte: Attachment) => {
      ouvrirEnMarquant(c);
      setApercu(ouverte);
    },
    [ouvrirEnMarquant],
  );
  const pieceDejaVue = React.useCallback(
    (p: Attachment) => {
      const c = captureDePiece(p);
      return c ? dejaVueAvantOuverture(c) : false;
    },
    [captureDePiece, dejaVueAvantOuverture],
  );
  // Toutes les images de la bande, pas seulement celles que le filtre laisse voir.
  const toutMarquer = React.useCallback(
    () => marquer(clesAMarquerVues(captures, images.vues)),
    [marquer, captures, images.vues],
  );

  const ouvrir = React.useCallback(
    (c: CaptureDuFlux) => {
      const ouverte = piece(c);
      if (ouverte) montrer(c, ouverte);
    },
    [piece, montrer],
  );
  const ouvrirLeChemin = React.useCallback(
    (chemin: string) => {
      const c = captureDuChemin(captures, chemin);
      const ouverte = c ? piece(c) : undefined;
      if (!ouverte) return false;
      montrer(c, ouverte);
      return true;
    },
    [captures, piece, montrer],
  );
  const naviguer = React.useCallback((p: Attachment) => montrer(captureDePiece(p), p), [captureDePiece, montrer]);
  const perdre = React.useCallback((c: CaptureDuFlux) => setPerdues((courant) => new Set(courant).add(c.cle)), []);
  const fermer = React.useCallback(() => setApercu(null), []);
  /* LE REPÈRE COURT, LE MÊME QUE SOUS LA BARRE D'ÉCRITURE (#ce5d). */
  const repereParChemin = React.useCallback((chemin: string) => repereDuChemin(chemin, connues), [connues]);
  const pieceParChemin = React.useCallback((chemin: string) => pieceDuChemin(chemin, connues)?.id ?? null, [connues]);
  const repere = React.useCallback(
    (c: CaptureDuFlux) => {
      if (c.genre === 'jointe') {
        const piece = connues?.find((p) => p.id === c.id);
        /* UN EXEMPLE DE CHOIX PORTE SA LETTRE devant sa référence (« B · #9d60 »), comme dans la question. */
        const lettre = lettreDeLExemple(piece?.name);
        if (piece?.alias) return lettre ? `${lettre} · ${etiquetteDePiece(piece)}` : etiquetteDePiece(piece);
      }
      // Une pièce que l'écran ne connaît pas garde le repère écrit dans son nom sur disque.
      return c.chemin ? repereParChemin(c.chemin) ?? repereDuNomSurDisque(c.chemin) : null;
    },
    [connues, repereParChemin],
  );
  /* LE REPÈRE DE LA PIÈCE MONTRÉE EN GRAND : la visionneuse l'écrit sous son titre. */
  const repereDePiece = React.useCallback(
    (p: Attachment) => {
      const c = captureDePiece(p);
      return c ? repere(c) : p.alias ? etiquetteDePiece(p) : null;
    },
    [captureDePiece, repere],
  );
  return {
    repere,
    repereDePiece,
    repereDuChemin: repereParChemin,
    pieceDuChemin: pieceParChemin,
    captures,
    source,
    perdre,
    galerie,
    sourceDePiece,
    apercu,
    quandDePiece,
    dejaVue,
    vues: images.vues,
    toutMarquer,
    pieceDejaVue,
    ouvrir,
    ouvrirLeChemin,
    fermer,
    naviguer,
  };
}

/**
 * LE REPLI DE LA BANDE EST UN RÉGLAGE DU COMPTE, tenu en base comme les autres
 * (`usePref`) : dépliée au départ, le chevron la réduit à sa seule ligne de
 * titre, et le choix se retrouve d'un appareil à l'autre. Il vaut pour toutes
 * les cartes, pas pour une seule.
 */
const CLE_BANDE_REPLIEE = 'captures.repliee';
/**
 * LE MOMENT DU REPLI (ms), réglage du compte lui aussi : posé dans le clic qui
 * replie, remis à 0 dans celui qui déplie. Le badge de la ligne repliée compte
 * les images arrivées depuis (`capturesArriveesDepuis`).
 */
const CLE_BANDE_REPLIEE_DEPUIS = 'captures.replieeDepuis';

/** Ouvre en grand, dans la galerie de la carte, l'image d'un chemin vu dans le fil. Absent hors d'un flux de carte. */
export const OuvrirUneCapture = React.createContext<((chemin: string) => boolean) | null>(null);
/** Le repère court (« #1a0c ») de l'image d'un chemin vu dans le fil, quand c'est une pièce jointe (#ce5d). */
export const RepereDUneCapture = React.createContext<((chemin: string) => string | null) | null>(null);
/** La pièce jointe de l'image d'un chemin vu dans le fil, quand elle en est une : son menu « … » la retravaille. */
export const PieceDUneCapture = React.createContext<((chemin: string) => string | null) | null>(null);

/** L'aperçu en grand d'une galerie, feuilletable. */
export function ApercuDesCaptures({ galerie: g }: { galerie: GalerieDesCaptures }) {
  return (
    <AttachmentPreview
      item={g.apercu}
      onClose={g.fermer}
      galerie={g.galerie}
      onNaviguer={g.naviguer}
      sourceDe={g.sourceDePiece}
      quandDe={g.quandDePiece}
      dejaVue={g.pieceDejaVue}
      repereDe={g.repereDePiece}
    />
  );
}

/**
 * UNE VIGNETTE QUI NE DISPARAÎT PAS AU PREMIER RATÉ. Une image encore en
 * écriture, un réseau qui hoquette ou un démon qui redémarre faisaient tomber le
 * chargement une fois — et la vignette sortait de la bande pour toute la vie de
 * l'écran : on croyait que l'agent n'avait rien vu. Elle se redemande donc
 * deux fois, de plus en plus tard et sans le cache, avant d'être dite perdue.
 */
const ESSAIS_D_UNE_VIGNETTE = 3;
function VignetteQuiReessaie({ src, alt, onPerdue }: { src: string; alt: string; onPerdue: () => void }) {
  const [essai, setEssai] = React.useState(0);
  const minuteur = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(minuteur.current), []);
  return (
    <img
      src={essai ? `${src}&essai=${essai}` : src}
      alt={alt}
      loading="lazy"
      draggable={false}
      data-vignette-essai={essai}
      onError={() => {
        if (essai + 1 >= ESSAIS_D_UNE_VIGNETTE) return onPerdue();
        minuteur.current = window.setTimeout(() => setEssai((n) => n + 1), 1500 * (essai + 1));
      }}
      className="max-h-full max-w-full rounded object-contain"
    />
  );
}

/**
 * UN PDF DANS LA BANDE : l'image de sa première page (miniature rendue par le
 * démon), marquée « PDF » au coin. Si la miniature manque (PDF illisible,
 * outil absent), la vignette garde sa place avec l'icône du document : un PDF
 * produit par l'agent ne disparaît jamais de la bande.
 */
function VignetteDePdf({ src, nom }: { src: string; nom: string }) {
  const [ratee, setRatee] = React.useState(false);
  return (
    <>
      {ratee ? (
        <span className="pointer-events-none flex flex-col items-center gap-1 px-1 text-muted">
          <FileText className="h-6 w-6" aria-hidden />
          <span className="max-w-full truncate text-[10.5px] leading-4">{nom}</span>
        </span>
      ) : (
        <VignetteQuiReessaie src={src} alt={nom} onPerdue={() => setRatee(true)} />
      )}
      <span
        className="pointer-events-none absolute left-0.5 top-0.5 rounded-sm bg-surface/85 px-1 text-[10px] font-medium leading-4 text-text"
        data-capture-pdf
      >
        PDF
      </span>
    </>
  );
}

/**
 * LA VIGNETTE D'APERÇU D'UNE PIÈCE — LE MÊME RENDU PARTOUT (« Ce que l'agent a
 * vu », le Brief du suivi de production…) : l'image dans sa boîte de taille
 * fixe, son REPÈRE codé (« #cf0d ») en bas à gauche, le TEMPS ÉCOULÉ (« il y a
 * 12 min », la date au-delà de sept jours) en bas à droite et l'œil « déjà
 * vue » au coin haut droit, sur leur propre fond de thème — pour un son, l'œil
 * et le temps vont ensemble en haut à droite, sur la ligne de son nom ; une vidéo montre son
 * image d'aperçu et le bouton lecture, un PDF sa première page, un son se joue
 * sur place (lecteur à onde). Un clic l'ouvre en grand.
 */
export function VignetteDeCapture({
  cle,
  id,
  media,
  src,
  libelle,
  repere,
  quand,
  vue,
  infobulle,
  apercuSeconde,
  onOuvrir,
  onPerdue,
  className,
}: {
  cle: string;
  id: string;
  media: 'image' | 'video' | 'pdf' | 'son';
  /** L'adresse de l'image (sans largeur) : image ou première page d'un PDF. */
  src: string;
  libelle: string;
  repere?: string | null;
  quand?: number | null;
  vue?: boolean;
  infobulle: string;
  apercuSeconde?: number;
  onOuvrir: () => void;
  onPerdue?: () => void;
  /** Le fond de la boîte (`bg-raised` par défaut) : il doit se détacher de ce qui la porte. */
  className?: string;
}) {
  /* L'ÉTIQUETTE DU COIN : le temps écoulé, précédé de l'œil si l'image a
     déjà été ouverte. Sur son propre fond de thème, donc lisible sur une
     image claire comme sombre ; elle ne capte pas le clic. Toutes les
     vignettes suivent la MÊME horloge à la minute (`useMinute`) : aucune
     minuterie par vignette. Sur une vignette d'image (112 px), « il y a
     12 min » et le repère « #cf0d » remplissent déjà le bas : l'œil y monte
     seul au coin haut droit (`oeilEnHaut`) plutôt que de rogner le temps. */
  const maintenant = useMinute();
  const oeilEnHaut = media !== 'son';
  const oeil = vue ? <Eye className="h-3 w-3 shrink-0" aria-hidden data-capture-vue /> : null;
  const etiquette =
    quand || (vue && !oeilEnHaut) ? (
      <span
        className={cn(
          'pointer-events-none flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-surface/85 px-1 text-[10.5px] leading-4 tabular-nums text-muted',
          oeilEnHaut && 'min-w-0 shrink',
        )}
        data-capture-etiquette
      >
        {oeilEnHaut ? null : oeil}
        {quand ? <span className="truncate" data-capture-heure={quand}>{ilYA(quand, maintenant)}</span> : null}
      </span>
    ) : null;
  /*
   * UN SON SE JOUE DANS LA BANDE (décision de l'utilisateur) : le lecteur
   * à onde, lecture / pause à gauche, plus large qu'une vignette ; son
   * bouton « agrandir » ouvre la visionneuse. Ce n'est pas un bouton
   * (un bouton ne contient pas d'autres boutons).
   */
  if (media === 'son') {
    return (
      <div
        data-capture-du-flux={cle}
        data-capture-media="son"
        title={infobulle}
        className={cn('relative flex h-20 w-64 shrink-0 flex-col justify-between overflow-hidden rounded p-1', className ?? 'bg-raised')}
      >
        {/* LA LIGNE DU NOM PORTE L'ÉTIQUETTE, À DROITE ET DANS LE CADRE : posée
            jadis dans une enveloppe sans taille, elle sortait par le haut et
            la carte la rognait (capture #b3aa). */}
        <div className="flex min-w-0 items-center gap-1 px-1">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted">{repere ? `${repere} · ${libelle}` : libelle}</span>
          {etiquette}
        </div>
        <LecteurSon id={id} nom={libelle} compact className="bg-surface" onAgrandir={onOuvrir} />
      </div>
    );
  }
  return (
    <button
      type="button"
      data-capture-du-flux={cle}
      data-capture-media={media}
      onClick={onOuvrir}
      title={infobulle}
      className={cn(`${VIGNETTE} relative flex items-center justify-center overflow-hidden rounded p-1.5 sm:p-1`, className ?? 'bg-raised')}
    >
      {media === 'video' ? (
        /* UNE VIDÉO : son image d'aperçu (la même règle que le lecteur)
           et le bouton lecture AU CENTRE ; le clic l'ouvre en grand, où
           elle démarre. */
        <>
          <VignetteVideo id={id} nom={libelle} seconde={apercuSeconde} className="pointer-events-none max-h-full max-w-full rounded object-contain" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center" data-capture-lecture>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/85 text-text">
              <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden />
            </span>
          </span>
        </>
      ) : media === 'pdf' ? (
        <VignetteDePdf src={`${src}&w=${LARGEUR_DE_VIGNETTE}`} nom={libelle} />
      ) : (
        <VignetteQuiReessaie src={`${src}&w=${LARGEUR_DE_VIGNETTE}`} alt={libelle} onPerdue={onPerdue ?? (() => {})} />
      )}
      {/* LE REPÈRE ET LE TEMPS ÉCOULÉ SE PARTAGENT LE BAS : une seule rangée,
          le repère « #cf0d » à gauche, jamais rogné en deçà de sa moitié de
          largeur, et l'étiquette à droite, qui s'abrège la première quand
          « il y a 12 min » et l'œil manquent de place. */}
      {oeil ? (
        <span className="pointer-events-none absolute right-0.5 top-0.5 rounded-sm bg-surface/85 p-0.5 text-muted" data-capture-oeil>
          {oeil}
        </span>
      ) : null}
      {repere || etiquette ? (
        <span className="pointer-events-none absolute inset-x-0.5 bottom-0.5 flex items-end justify-between gap-1">
          {repere ? (
            <EtiquetteDeVignette texte={repere} className="static max-w-[50%] shrink-0 rounded-sm px-1 text-left text-[10.5px]" />
          ) : (
            <span />
          )}
          {etiquette}
        </span>
      ) : null}
    </button>
  );
}

/** La bande seule ; l'aperçu se pose à part (`ApercuDesCaptures`), une fois pour toute la carte. */
export function BandeDesCaptures({
  galerie: g,
  className = 'mt-3',
  replieeDOffice = false,
  onDeplie,
  onFermer,
}: {
  galerie: GalerieDesCaptures;
  /**
   * REPLIÉE PAR LE PIED COMPACT DU TÉLÉPHONE (`chat.tsx`, `usePiedCompact`) :
   * la bande se réduit à sa ligne de titre sans toucher au choix retenu ; un
   * tap la rouvre pour cette fois.
   */
  replieeDOffice?: boolean;
  /** Un tap vient de déplier la bande : elle devient le dernier bloc ouvert du pied. */
  onDeplie?: () => void;
  /**
   * LA BANDE DANS LE VOLET DU BOUTON PHOTO (téléphone, `BoutonDesCaptures`) :
   * toujours dépliée, sans badge, et son chevron referme le volet au lieu de
   * replier la bande — le réglage de repli de l'ordinateur n'est jamais touché.
   */
  onFermer?: () => void;
  /** La marge de la bande : dans un message elle se pose sous le texte, collée en bas de la carte elle n'en a pas. */
  className?: string;
}) {
  const { captures } = g;
  const pieceVideo = (id: string) => g.galerie.find((p) => p.id === id);
  const [replieeRetenue, setRepliee] = usePref<boolean>(CLE_BANDE_REPLIEE, false);
  const [replieeDepuis, setReplieeDepuis] = usePref<number>(CLE_BANDE_REPLIEE_DEPUIS, 0);
  /* Le repli d'office se lève d'un tap, pour cette question seulement. */
  const [deplieeMalgre, setDeplieeMalgre] = React.useState(false);
  React.useEffect(() => setDeplieeMalgre(false), [replieeDOffice]);
  const repliee = !onFermer && (replieeRetenue || (replieeDOffice && !deplieeMalgre));
  /* Le moment s'écrit DANS LE GESTE, avec le repli lui-même. */
  const basculer = (replier: boolean) => {
    if (onFermer) {
      if (replier) onFermer();
      return;
    }
    if (!replier) onDeplie?.();
    if (replieeDOffice && !replieeRetenue) {
      setDeplieeMalgre(!replier);
      return;
    }
    setRepliee(replier);
    setReplieeDepuis(replier ? Date.now() : 0);
  };
  /*
   * UNE BANDE DÉJÀ REPLIÉE SANS MOMENT CONNU (repliée avant le badge, ou par un
   * écran plus ancien) : le moment se pose UNE fois, au premier affichage —
   * le badge part de zéro au lieu de compter toute la carte.
   */
  const momentPose = React.useRef(false);
  React.useEffect(() => {
    if (!replieeRetenue || replieeDepuis > 0 || momentPose.current) return;
    momentPose.current = true;
    setReplieeDepuis(Date.now());
  }, [replieeRetenue, replieeDepuis, setReplieeDepuis]);

  /*
   * UNE CAPTURE NEUVE SE MONTRE, SANS ARRACHER CELUI QUI FEUILLETTE. La plus
   * récente se pose à gauche : si la bande est au début (ou presque), elle y
   * revient ; si on a défilé loin vers la droite, on n'y touche pas.
   */
  const bande = React.useRef<HTMLDivElement | null>(null);
  const nombre = captures.length;
  const dernierNombre = React.useRef(nombre);
  React.useEffect(() => {
    const zone = bande.current;
    if (zone && nombre > dernierNombre.current && zone.scrollLeft < MARGE_DU_DEBUT_PX) zone.scrollTo({ left: 0, behavior: 'smooth' });
    dernierNombre.current = nombre;
  }, [nombre]);

  /*
   * LE FILTRE « PAS ENCORE VUES » N'AGIT QUE SUR LES VIGNETTES. La galerie de
   * l'aperçu garde la série entière : l'image qu'on ouvre devient vue, quitte la
   * liste filtrée, et ne doit ni disparaître de la visionneuse ni faire sauter
   * le feuilletage. Les commandes n'ont de sens qu'à partir de deux images.
   */
  const [filtre, setFiltre] = React.useState(false);
  const nonVues = React.useMemo(() => capturesPasEncoreVues(captures, g.vues), [captures, g.vues]);
  const affichees = filtre ? nonVues : captures;
  const nouvelles = React.useMemo(
    () => (replieeRetenue && !onFermer ? capturesArriveesDepuis(captures, replieeDepuis) : 0),
    [replieeRetenue, onFermer, captures, replieeDepuis],
  );

  if (!captures.length) return null;

  return (
    <div className={cn('min-w-0', className)} data-captures-du-flux={captures.length} data-captures-repli={repliee ? 'ferme' : 'ouvert'}>
      {/* UN BLOC À DEUX ÉTAGES (demande du 20/10/2026) : la rangée du titre et
          des commandes est un EN-TÊTE sur fond contrasté, les vignettes vivent
          dans le PANNEAU dessous. Aucun trait : ce sont les fonds qui séparent
          le bloc du fil. Replié, l'en-tête reste seul, arrondi partout. */}
      <EnTeteDePanneau
        className={cn('flex items-center gap-x-1.5 font-normal', repliee && 'rounded-b-md')}
        data-captures-en-tete=""
      >
        {/* LE TITRE EST LE BOUTON DU REPLI : le chevron se lit juste à sa
            droite. Aucun texte replié (`line-clamp`) dans ce bouton. UNE SEULE
            RANGÉE, à toute largeur : titre à gauche, commandes à droite, qui
            s'abrègent d'elles-mêmes quand la place manque
            (`CommandesDesVues`) au lieu de tomber sous le titre. */}
        <button
          type="button"
          onClick={() => basculer(!repliee)}
          aria-expanded={!repliee}
          title={onFermer ? t('Fermer') : repliee ? t('Déplier les images de l’agent') : t('Replier les images de l’agent')}
          className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted hover:text-text"
          data-captures-bascule
        >
          <Camera className="h-3 w-3 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">{t('Ce que l’agent a vu')}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', repliee && 'rotate-180')} aria-hidden />
        </button>
        {/* LE NOMBRE RESTE À DROITE MÊME REPLIÉ : la ligne seule dit combien
            d'images l'agent a vues, sans avoir à déplier la galerie. */}
        {captures.length > 1 ? (
          <CommandesDesVues
            nonVues={nonVues.length}
            filtre={filtre}
            onFiltre={setFiltre}
            onToutMarquer={g.toutMarquer}
          />
        ) : null}
        {/* LE BADGE DES NOUVELLES : seulement repliée, tout au bout de la ligne
            (`ml-auto` : avec une seule image, aucune commande ne le pousse). Il
            compte les images arrivées depuis le repli ; un tap déplie, et
            l'efface. Violet : ce sont des images du travail de l'agent. */}
        {nouvelles > 0 ? (
          <button
            type="button"
            onClick={() => basculer(false)}
            title={nouvelles === 1 ? t('Une nouvelle image depuis le repli') : t('{n} nouvelles images depuis le repli', { n: nouvelles })}
            className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-medium leading-none tabular-nums text-accent-fg"
            data-captures-nouvelles={nouvelles}
          >
            <span aria-hidden>{nouvelles > 99 ? '99+' : nouvelles}</span>
            <span className="sr-only">
              {nouvelles === 1 ? t('Une nouvelle image depuis le repli') : t('{n} nouvelles images depuis le repli', { n: nouvelles })}
            </span>
          </button>
        ) : null}
      </EnTeteDePanneau>
      <Panneau className={cn('px-2 py-1.5', repliee && 'hidden')} data-captures-panneau="">
      {filtre && !affichees.length ? <RienDeNouveau className="py-2" /> : null}
      <ZoneDefilement
        ref={bande}
        axe="horizontal"
        voile
        className={`flex flex-nowrap gap-1.5 pb-1${filtre && !affichees.length ? ' hidden' : ''}`}
        data-captures-bande
      >
        {affichees.map((c) => {
          const vue = g.dejaVue(c);
          const repere = g.repere(c);
          // L'étiquette du coin ne reçoit pas le pointeur : son détail se lit ici.
          const ouvrirEnGrand = c.genre === 'jointe' && c.media ? t('Ouvrir en grand') : t('Voir la capture en grand');
          const infobulle = [ouvrirEnGrand, c.quand ? heureExacte(c.quand) : '', vue ? t('Déjà vue') : '']
            .filter(Boolean)
            .join(' · ');
          const media = c.genre === 'jointe' ? (c.media === 'son' || c.media === 'video' || c.media === 'pdf' ? c.media : 'image') : 'image';
          return (
            /* UNE PIÈCE JOINTE VUE PAR L'AGENT SE GLISSE, À LA SOURIS, VERS UNE CASE DU SUIVI (28/10/2026). */
            <GlissableVersUnPlan key={c.cle} attachmentId={c.genre === 'jointe' ? c.id : null} genre={media} nom={c.libelle}>
            <VignetteDeCapture
              cle={c.cle}
              id={c.genre === 'jointe' ? c.id : c.cle}
              media={media}
              src={media === 'image' || media === 'pdf' ? g.source(c) : ''}
              libelle={c.libelle}
              repere={repere}
              quand={c.quand}
              vue={vue}
              infobulle={infobulle}
              apercuSeconde={c.genre === 'jointe' ? pieceVideo(c.id)?.apercuSeconde : undefined}
              onOuvrir={() => g.ouvrir(c)}
              onPerdue={() => g.perdre(c)}
            />
            </GlissableVersUnPlan>
          );
        })}
      </ZoneDefilement>
      </Panneau>
    </div>
  );
}

/**
 * LE MOMENT OÙ LE VOLET DU BOUTON PHOTO S'EST REFERMÉ (ms) — clé À PART de
 * celle de l'ordinateur (`CLE_BANDE_REPLIEE_DEPUIS`) : le téléphone ne doit
 * jamais replier la bande de l'ordinateur. Le badge compte les images arrivées
 * depuis (`capturesArriveesDepuis`).
 */
const CLE_VOLET_FERME_DEPUIS = 'captures.telephone.fermeDepuis';
/** La taille du bouton photo : celle d'une cible tactile, comme les boutons du pied. */
const COTE_DU_BOUTON_PX = 43;
/** La durée du morphing, ouverture comme fermeture. */
const DUREE_DU_MORPHING_MS = 300;

const moinsDeMouvement = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * CE QUE L'AGENT A VU, REPLIÉ DANS UN BOUTON PHOTO (téléphone, demande du
 * 27/10/2026).
 *
 * Sur téléphone, la bande ne prend plus de hauteur au pied de la carte : un
 * ROND à l'appareil photo se pose en bas à droite du fil, collé au bord,
 * juste au-dessus des boutons d'action (l'ancienne place de l'icône des
 * messages en attente, devenue une barre jaune au-dessus du champ). Un BADGE
 * violet y compte les images arrivées depuis la dernière fermeture.
 *
 * Un appui fait GRANDIR le rond jusqu'au volet (la même bande, `onFermer`),
 * qui flotte PAR-DESSUS le fil sans rien déplacer : le volet est posé en
 * entier dès le départ et sa découpe (`clip-path`) s'ouvre depuis le cercle du
 * coin bas droit — aucun recalcul de mise en page à chaque image. La fermeture
 * suit le chemin inverse et le rond reparaît à la fin. Avec « moins
 * d'animations », la bascule est immédiate. Le volet se ferme par le chevron
 * de son en-tête, par Échap, ou par un appui hors de lui (jamais quand la
 * visionneuse est ouverte par-dessus).
 */
export function BoutonDesCaptures({ galerie: g }: { galerie: GalerieDesCaptures }) {
  const { captures } = g;
  const [fermeDepuis, setFermeDepuis] = usePref<number>(CLE_VOLET_FERME_DEPUIS, 0);
  /* `monte` : le volet est dans la page ; `ouvert` : sa découpe est grande ouverte. */
  const [monte, setMonte] = React.useState(false);
  const [ouvert, setOuvert] = React.useState(false);
  const zone = React.useRef<HTMLDivElement | null>(null);
  const minuteur = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(minuteur.current), []);

  /* JAMAIS FERMÉ DEPUIS UN MOMENT CONNU : le moment se pose une fois, au
     premier affichage — le badge part de zéro au lieu de compter toute la carte. */
  const momentPose = React.useRef(false);
  React.useEffect(() => {
    if (fermeDepuis > 0 || momentPose.current) return;
    momentPose.current = true;
    setFermeDepuis(Date.now());
  }, [fermeDepuis, setFermeDepuis]);

  const nouvelles = React.useMemo(() => (fermeDepuis > 0 ? capturesArriveesDepuis(captures, fermeDepuis) : 0), [captures, fermeDepuis]);

  const ouvrir = () => {
    window.clearTimeout(minuteur.current);
    setMonte(true);
    /* Deux images : le volet se pose d'abord fermé (le cercle), PUIS s'ouvre. */
    requestAnimationFrame(() => requestAnimationFrame(() => setOuvert(true)));
  };
  const fermer = React.useCallback(() => {
    setOuvert(false);
    /* Le moment s'écrit DANS LE GESTE : le badge repart de zéro. */
    setFermeDepuis(Date.now());
    window.clearTimeout(minuteur.current);
    /* Un battement de plus que le morphing : la découpe finit SUR le cercle avant que le rond ne revienne. */
    minuteur.current = window.setTimeout(() => setMonte(false), moinsDeMouvement() ? 0 : DUREE_DU_MORPHING_MS + 60);
  }, [setFermeDepuis]);

  /* UN APPUI HORS DU VOLET LE REFERME — sauf par-dessus la visionneuse, ou
     dans une fenêtre posée au-dessus (menu « … » d'une pièce). */
  const visionneuseOuverte = !!g.apercu;
  React.useEffect(() => {
    if (!ouvert) return;
    const auPointeur = (event: PointerEvent) => {
      const cible = event.target;
      if (!(cible instanceof Element) || visionneuseOuverte) return;
      if (zone.current?.contains(cible)) return;
      /* Une fenêtre posée PAR-DESSUS le volet (menu, feuille) ; pas celle qui
         le porte — la page de la carte, sur téléphone, en est une. */
      const fenetre = cible.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]');
      if (fenetre && !fenetre.contains(zone.current)) return;
      fermer();
    };
    const auClavier = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !visionneuseOuverte) fermer();
    };
    document.addEventListener('pointerdown', auPointeur, true);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auPointeur, true);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert, visionneuseOuverte, fermer]);

  if (!captures.length) return null;
  const cercle = `inset(calc(100% - ${COTE_DU_BOUTON_PX}px) 0 0 calc(100% - ${COTE_DU_BOUTON_PX}px) round ${COTE_DU_BOUTON_PX / 2}px)`;
  const titreDuBadge = nouvelles === 1 ? t('Une nouvelle image depuis le repli') : t('{n} nouvelles images depuis le repli', { n: nouvelles });

  return (
    <div ref={zone} data-captures-flottantes={ouvert ? 'ouvert' : 'ferme'}>
      {monte ? (
        /* L'ombre se pose sur l'enveloppe (`drop-shadow`) : une découpe
           rognerait une ombre portée par le volet lui-même. */
        <div className="pointer-events-none absolute inset-x-4 bottom-full z-20 mb-2 drop-shadow-md" data-captures-volet>
          <div
            className="pointer-events-auto overflow-hidden rounded-md bg-raised transition-[clip-path] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{ clipPath: ouvert ? 'inset(0 0 0 0 round 6px)' : cercle, transitionDuration: `${DUREE_DU_MORPHING_MS}ms` }}
          >
            <div className={cn('transition-opacity duration-200 motion-reduce:transition-none', ouvert ? 'opacity-100 delay-100' : 'opacity-0')}>
              <BandeDesCaptures galerie={g} className="" onFermer={fermer} />
            </div>
          </div>
        </div>
      ) : null}
      {/* LE ROND, collé au bord droit : il s'efface pendant que le volet
          s'ouvre, et reparaît quand la découpe est revenue au cercle. Sans
          bordure, comme tout bouton. */}
      <button
        type="button"
        onClick={ouvrir}
        aria-expanded={ouvert}
        aria-label={t('Ce que l’agent a vu')}
        title={t('Ce que l’agent a vu')}
        tabIndex={monte ? -1 : 0}
        className={cn(
          'absolute bottom-full right-4 z-30 mb-2 flex items-center justify-center rounded-full bg-raised text-text shadow-md transition-opacity motion-reduce:transition-none',
          monte ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        style={{ width: COTE_DU_BOUTON_PX, height: COTE_DU_BOUTON_PX, transitionDuration: monte ? '120ms' : '150ms' }}
        data-captures-bouton={captures.length}
      >
        <Camera className="h-5 w-5" aria-hidden />
        {/* LE BADGE DES NOUVELLES, en coin : violet, ce sont des images du
            travail de l'agent. Il s'efface quand le volet s'ouvre. */}
        {nouvelles > 0 && !monte ? (
          <span
            className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-medium leading-none tabular-nums text-accent-fg"
            title={titreDuBadge}
            data-captures-nouvelles={nouvelles}
          >
            <span aria-hidden>{nouvelles > 99 ? '99+' : nouvelles}</span>
            <span className="sr-only">{titreDuBadge}</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}

export function CapturesDuFlux({
  steps,
  idsJointes,
  projectId,
}: {
  steps: RunStep[];
  /** Les pièces jointes du message de l'agent : ses images entrent dans la bande. */
  idsJointes: string[];
  projectId?: string;
}) {
  const galerie = useGalerieDesCaptures(steps, idsJointes, projectId);
  if (!projectId || !galerie.captures.length) return null;
  return (
    <>
      <BandeDesCaptures galerie={galerie} />
      <ApercuDesCaptures galerie={galerie} />
    </>
  );
}
