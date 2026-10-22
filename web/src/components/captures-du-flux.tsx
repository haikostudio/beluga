import * as React from 'react';
import { Camera, ChevronDown, Eye } from 'lucide-react';
import {
  captureDuChemin,
  capturesArriveesDepuis,
  capturesDuFlux,
  capturesPasEncoreVues,
  clesAMarquerVues,
  heureExacte,
  type Attachment,
  type CaptureDuFlux,
  type RunStep,
} from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { LARGEUR_DE_VIGNETTE } from '@/components/pastille-de-fichier';
import { ZoneDefilement } from '@/components/ui';
import { EnTeteDePanneau, Panneau } from '@/components/panneau';
import { CommandesDesVues, RienDeNouveau } from '@/components/commandes-des-vues';
import { client } from '@/lib/client';
import { useImagesVues } from '@/lib/use-images-vues';
import { useApp } from '@/lib/use-app';
import { usePref } from '@/lib/prefs';
import { t } from '@/lib/langue';
import { cn, heureOuDate } from '@/lib/utils';

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
 * CHAQUE VIGNETTE DIT QUAND ET SI ON L'A DÉJÀ OUVERTE : en bas à droite, l'heure
 * où l'agent a regardé l'image (l'heure seule le jour même, la date courte devant
 * elle sinon — `heureOuDate`), précédée d'un œil une fois l'image affichée en grand. « Vue »
 * veut dire OUVERTE ou FEUILLETÉE dans la visionneuse, jamais « passée à
 * l'écran » ; c'est retenu par compte, au serveur, donc d'un appareil à l'autre.
 *
 * SUR UNE CARTE À CENTAINES D'IMAGES, DEUX COMMANDES à droite du titre : le
 * filtre « pas encore vues » (il n'agit que sur les vignettes — la visionneuse
 * garde toute la série) et « tout marquer comme vu » (`CommandesDesVues`). Le
 * mécanisme de l'œil est celui de `useImagesVues`, partagé avec l'onglet des
 * pièces jointes et les notes.
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
  // La liste du projet peut ne pas être encore chargée : on la demande.
  const manquante = idsJointes.length > 0 && !!projectId && !connues;
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
  return {
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

/** La bande seule ; l'aperçu se pose à part (`ApercuDesCaptures`), une fois pour toute la carte. */
export function BandeDesCaptures({
  galerie: g,
  className = 'mt-3',
}: {
  galerie: GalerieDesCaptures;
  /** La marge de la bande : dans un message elle se pose sous le texte, collée en bas de la carte elle n'en a pas. */
  className?: string;
}) {
  const { captures } = g;
  const [repliee, setRepliee] = usePref<boolean>(CLE_BANDE_REPLIEE, false);
  const [replieeDepuis, setReplieeDepuis] = usePref<number>(CLE_BANDE_REPLIEE_DEPUIS, 0);
  /* Le moment s'écrit DANS LE GESTE, avec le repli lui-même. */
  const basculer = (replier: boolean) => {
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
    if (!repliee || replieeDepuis > 0 || momentPose.current) return;
    momentPose.current = true;
    setReplieeDepuis(Date.now());
  }, [repliee, replieeDepuis, setReplieeDepuis]);

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
  const nouvelles = React.useMemo(() => (repliee ? capturesArriveesDepuis(captures, replieeDepuis) : 0), [repliee, captures, replieeDepuis]);

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
          title={repliee ? t('Déplier les images de l’agent') : t('Replier les images de l’agent')}
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
          // L'étiquette du coin ne reçoit pas le pointeur : son détail se lit ici.
          const infobulle = [t('Voir la capture en grand'), c.quand ? heureExacte(c.quand) : '', vue ? t('Déjà vue') : '']
            .filter(Boolean)
            .join(' · ');
          return (
            <button
              key={c.cle}
              type="button"
              data-capture-du-flux={c.cle}
              onClick={() => g.ouvrir(c)}
              title={infobulle}
              className={`${VIGNETTE} relative flex items-center justify-center overflow-hidden rounded bg-raised p-1`}
            >
              <VignetteQuiReessaie
                src={`${g.source(c)}&w=${LARGEUR_DE_VIGNETTE}`}
                alt={c.libelle}
                onPerdue={() => g.perdre(c)}
              />
              {/* L'ÉTIQUETTE DU COIN : l'œil si l'image a déjà été ouverte, puis
                  son heure. Sur son propre fond de thème, donc lisible sur une
                  image claire comme sombre ; elle ne capte pas le clic. */}
              {c.quand || vue ? (
                <span
                  className="pointer-events-none absolute bottom-0.5 right-0.5 flex items-center gap-1 rounded-sm bg-surface/85 px-1 text-[10.5px] leading-4 tabular-nums text-muted"
                  data-capture-etiquette
                >
                  {vue ? <Eye className="h-3 w-3 shrink-0" aria-hidden data-capture-vue /> : null}
                  {c.quand ? <span data-capture-heure={c.quand}>{heureOuDate(c.quand)}</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </ZoneDefilement>
      </Panneau>
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
