import * as React from 'react';
import { Camera } from 'lucide-react';
import { captureDuChemin, capturesDuFlux, type Attachment, type CaptureDuFlux, type RunStep } from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

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
        : { id: c.cle, projectId: projectId ?? '', name: c.libelle, mime: 'image/png', size: 0, sha: '', createdAt: 0 },
    [jointes, projectId],
  );
  const galerie = React.useMemo(() => captures.map(piece).filter(Boolean) as Attachment[], [captures, piece]);
  const sourceDePiece = React.useCallback(
    (p: Attachment) => {
      const trouvee = captures.find((c) => c.cle === p.id || (c.genre === 'jointe' && c.id === p.id));
      return trouvee ? source(trouvee) : `/api/attachment?id=${encodeURIComponent(p.id)}`;
    },
    [captures, source],
  );
  const ouvrir = React.useCallback(
    (c: CaptureDuFlux) => {
      const ouverte = piece(c);
      if (ouverte) setApercu(ouverte);
    },
    [piece],
  );
  const ouvrirLeChemin = React.useCallback(
    (chemin: string) => {
      const c = captureDuChemin(captures, chemin);
      const ouverte = c ? piece(c) : undefined;
      if (!ouverte) return false;
      setApercu(ouverte);
      return true;
    },
    [captures, piece],
  );
  const perdre = React.useCallback((c: CaptureDuFlux) => setPerdues((courant) => new Set(courant).add(c.cle)), []);
  const fermer = React.useCallback(() => setApercu(null), []);
  return { captures, source, perdre, galerie, sourceDePiece, apercu, ouvrir, ouvrirLeChemin, fermer, naviguer: setApercu };
}

/** Ouvre en grand, dans la galerie de la carte, l'image d'un chemin vu dans le fil. Absent hors d'un flux de carte. */
export const OuvrirUneCapture = React.createContext<((chemin: string) => boolean) | null>(null);

/** L'aperçu en grand d'une galerie, feuilletable. */
export function ApercuDesCaptures({ galerie: g }: { galerie: GalerieDesCaptures }) {
  return <AttachmentPreview item={g.apercu} onClose={g.fermer} galerie={g.galerie} onNaviguer={g.naviguer} sourceDe={g.sourceDePiece} />;
}

/** La bande seule ; l'aperçu se pose à part (`ApercuDesCaptures`), une fois pour toute la carte. */
export function BandeDesCaptures({ galerie: g }: { galerie: GalerieDesCaptures }) {
  const { captures } = g;

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

  if (!captures.length) return null;

  return (
    <div className="mt-3 min-w-0" data-captures-du-flux={captures.length}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-faint">
        <Camera className="h-3 w-3" />
        {t('Ce que l’agent a vu')}
      </p>
      <ZoneDefilement ref={bande} axe="horizontal" voile className="flex flex-nowrap gap-1.5 pb-1" data-captures-bande>
        {captures.map((c) => (
          <button
            key={c.cle}
            type="button"
            data-capture-du-flux={c.cle}
            onClick={() => g.ouvrir(c)}
            title={t('Voir la capture en grand')}
            className={`${VIGNETTE} flex items-center justify-center overflow-hidden rounded bg-raised p-1`}
          >
            <img
              src={g.source(c)}
              alt={c.libelle}
              loading="lazy"
              draggable={false}
              onError={() => g.perdre(c)}
              className="max-h-full max-w-full rounded object-contain"
            />
          </button>
        ))}
      </ZoneDefilement>
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
