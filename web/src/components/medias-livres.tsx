import * as React from 'react';
import { Clapperboard, Image as ImageIcon, Music, Play, type LucideIcon } from 'lucide-react';
import { etiquetteDePiece, heureExacte, phraseDuMediaLivre, type Attachment, type MediaLivre } from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { LecteurSon } from '@/components/lecteur-son';
import { VignetteVideo } from '@/components/lecteur-video';
import { adresseDePiece, EtiquetteDeVignette, estUnPdf } from '@/components/pastille-de-fichier';
import { MenuDuMediaDuFil } from '@/components/menu-du-media';
import { useSourceDuGlisser } from '@/components/glisser-vers-un-plan';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { HeureDuFil } from '@/components/heure-du-fil';
import { cn, heureEtDuree } from '@/lib/utils';

/**
 * LES MÉDIAS LIVRÉS, DANS LE FIL (décision du 20/10/2026, revue le 26/10/2026,
 * capture #e9bd : « il faut que les images soient rendues les unes sous les
 * autres… avec un petit texte qui m'explique ce qui a été rendu »).
 *
 * CHAQUE MÉDIA EST UNE LIGNE DU FIL, À SON HEURE, comme une capture de
 * l'agent : sa phrase (`phraseDuMediaLivre` — celle de l'agent, sinon d'après
 * le sujet et la version), le média dessous au gabarit des captures
 * (`max-h-40`, repère court « #cf0d »), puis l'heure en dernier. Le fil d'une carte et celui
 * d'un agent sans carte la posent après ce qui l'a précédée dans le temps
 * (`placerLesMediasDansLeFil`). Plus aucune rangée de vignettes ; le bloc
 * « Médias fabriqués » (en-tête, panneau, « Tout télécharger ») reste refusé
 * (capture #3bb3). Un clic ouvre la visionneuse, qui feuillette TOUS les
 * médias de la discussion (`GalerieDesMediasLivres`) ; le menu « … » garde
 * « Valider » et les gestes qui refabriquent.
 *
 * La liste vient de la base (`medias.livres.*`) : elle survit au message
 * suivant et au redémarrage. Elle se relit quand une fabrication de la
 * discussion se termine.
 */

const cache = new Map<string, MediaLivre[]>();

export function useMediasLivres(ou: { cardId?: string | null; agentId?: string | null }): MediaLivre[] {
  const cle = ou.cardId ? `carte:${ou.cardId}` : ou.agentId ? `agent:${ou.agentId}` : '';
  const [medias, setMedias] = React.useState<MediaLivre[]>(() => cache.get(cle) ?? []);
  /* Une fabrication finie de CETTE discussion relance la lecture. */
  const finis = useApp().mediasEnFabrication ?? [];
  const signature = finis
    .filter((m) => m.etat === 'fini' && (ou.cardId ? m.cardId === ou.cardId : !m.cardId && m.agentId === ou.agentId))
    .map((m) => m.attachmentId ?? m.id)
    .join(',');
  React.useEffect(() => {
    if (!cle) return;
    let vivant = true;
    const commande = ou.cardId ? ({ type: 'medias.livres.carte', cardId: ou.cardId } as const) : ({ type: 'medias.livres.agent', agentId: ou.agentId! } as const);
    client
      .call<{ medias: MediaLivre[] }>(commande)
      .then((r) => {
        cache.set(cle, r.medias ?? []);
        if (vivant) setMedias(r.medias ?? []);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [cle, signature]);
  return cle ? medias : [];
}

/** L'icône de la ligne d'un média, dans la colonne de gauche. */
export function iconeDuMediaLivre(m: Pick<MediaLivre, 'genre'>): LucideIcon {
  return m.genre === 'video' ? Clapperboard : m.genre === 'son' ? Music : ImageIcon;
}

/** La pièce jointe d'un média, ou un remplaçant tant que la liste des pièces n'est pas arrivée. */
function pieceDuMedia(m: MediaLivre, pieces: readonly Attachment[] | undefined): Attachment {
  return (
    pieces?.find((p) => p.id === m.attachmentId) ?? {
      id: m.attachmentId,
      projectId: m.projectId,
      name: m.sujet || 'media',
      mime: '',
      size: 0,
      sha: m.attachmentId,
      createdAt: m.livreLe ?? 0,
    }
  );
}

const OuvrirUnMediaLivre = React.createContext<((attachmentId: string) => void) | null>(null);

/**
 * LA VISIONNEUSE DES MÉDIAS D'UNE DISCUSSION : posée une fois autour du fil,
 * elle feuillette tous ses médias livrés, dans l'ordre où ils ont été rendus.
 */
export function GalerieDesMediasLivres({ medias, children }: { medias: readonly MediaLivre[]; children: React.ReactNode }) {
  const state = useApp();
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const projectId = medias[0]?.projectId ?? '';
  const pieces = state.attachments[projectId];
  const manquantes = !!projectId && !pieces;
  React.useEffect(() => {
    if (manquantes) client.send({ type: 'attachments.list', projectId });
  }, [manquantes, projectId]);
  const galerie = React.useMemo(
    () => [...medias].sort((a, b) => a.livreLe - b.livreLe).map((m) => pieceDuMedia(m, pieces)),
    [medias, pieces],
  );
  return (
    <OuvrirUnMediaLivre.Provider value={setOuverte}>
      {children}
      {medias.length ? (
        <AttachmentPreview
          item={ouverte ? galerie.find((p) => p.id === ouverte) ?? null : null}
          galerie={galerie}
          onNaviguer={(p) => setOuverte(p.id)}
          onClose={() => setOuverte(null)}
        />
      ) : null}
    </OuvrirUnMediaLivre.Provider>
  );
}

/**
 * UNE LIGNE DE MÉDIA, COMME UNE LIGNE DE CAPTURE : la phrase qui dit ce qui a
 * été rendu, le média dessous, borné comme une capture, puis son heure en
 * dernier (« il y a 26 min »). Le menu « … » (Valider, retouches, réglages…)
 * se pose en haut à droite du média, quel que soit l'outil qui l'a rendu. Sans
 * `GalerieDesMediasLivres` autour, le clic ouvre une visionneuse à lui.
 */
export function LigneDeMediaLivre({ media }: { media: MediaLivre }) {
  const state = useApp();
  const ouvrirDansLaGalerie = React.useContext(OuvrirUnMediaLivre);
  const [seule, setSeule] = React.useState(false);
  const piece = pieceDuMedia(media, state.attachments[media.projectId]);
  const phrase = phraseDuMediaLivre(media);
  const texte = phrase.texte ?? t(phrase.motif!, phrase.valeurs);
  const quand = media.livreLe || piece.createdAt || undefined;
  const heure = media.cardId ? null : heureEtDuree(quand);
  const repere = piece.alias ? etiquetteDePiece(piece) : null;
  const libelle = `${media.sujet || t('Média')}${media.version > 1 ? ` · v${media.version}` : ''}`;
  const infobulle = [libelle, t('Ouvrir en grand'), quand ? heureExacte(quand) : ''].filter(Boolean).join(' · ');
  const ouvrir = () => (ouvrirDansLaGalerie ? ouvrirDansLaGalerie(media.attachmentId) : setSeule(true));
  const genre = media.genre === 'video' ? 'video' : media.genre === 'son' ? 'son' : estUnPdf(piece.mime) ? 'pdf' : 'image';
  /* À LA SOURIS, LE MÉDIA SE GLISSE VERS UNE CASE DU SUIVI (28/10/2026) ; inconnu de la production, il y est inscrit au dépôt. */
  const sourceDuGlisser = useSourceDuGlisser(genre === 'image' || genre === 'video' ? { attachmentId: media.attachmentId, genre, nom: libelle } : null);
  return (
    <div className="min-w-0" data-media-livre={media.attachmentId} data-media-livre-genre={media.genre} data-media-livre-version={media.version}>
      <p className="min-w-0 break-words text-[14.5px] leading-relaxed text-text texte-copiable" data-media-livre-phrase={phrase.texte ? 'agent' : 'construite'}>
        {texte}
      </p>
      {/* Un son garde son menu À DROITE du lecteur : posé dessus, il couvrait le bouton « agrandir ». */}
      <div className={cn('relative mt-1 w-fit max-w-full', genre === 'son' && 'flex items-center gap-1')}>
        {genre === 'son' ? (
          <div className="w-72 max-w-full rounded-md bg-raised p-1" title={infobulle}>
            <LecteurSon id={media.attachmentId} nom={libelle} compact className="bg-surface" onAgrandir={ouvrir} />
          </div>
        ) : (
          <button
            type="button"
            onClick={ouvrir}
            title={infobulle}
            {...sourceDuGlisser}
            data-media-livre-ouvrir={media.attachmentId}
            className="relative block overflow-hidden rounded-md border border-transparent bg-raised p-1 sm:p-0.5"
          >
            {genre === 'video' ? (
              <>
                <VignetteVideo
                  id={media.attachmentId}
                  nom={libelle}
                  seconde={piece.apercuSeconde}
                  className="pointer-events-none max-h-40 max-w-[min(320px,100%)] rounded object-contain"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/85 text-text">
                    <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" />
                  </span>
                </span>
              </>
            ) : (
              <img
                src={adresseDePiece(media.attachmentId, false, 640)}
                alt={texte}
                loading="lazy"
                className="max-h-40 max-w-[min(320px,100%)] rounded object-contain object-left-top"
              />
            )}
            {repere ? <EtiquetteDeVignette texte={repere} /> : null}
          </button>
        )}
        {/* LE MENU « … » SE POSE SUR CHAQUE MÉDIA LIVRÉ, même rendu par un autre outil que la production (#dca9) : inscrit au premier geste. */}
        <MenuDuMediaDuFil cardId={media.cardId} attachmentId={media.attachmentId} genre={media.genre} nom={media.sujet} className={genre === 'son' ? 'static' : undefined} />
      </div>
      {/* L'HEURE SOUS LE MÉDIA, JAMAIS ENTRE LA PHRASE ET LUI (captures #ae52 et #3c8a). */}
      {media.cardId ? (
        <HeureDuFil at={quand} data-media-livre-heure={quand} />
      ) : heure ? (
        /* Hors carte, la conversation d'un agent garde son heure d'avant. */
        <span title={heure.infobulle} className="mt-1 block text-[12.5px] leading-snug text-faint tabular-nums" data-media-livre-heure={quand}>
          {heure.libelle}
        </span>
      ) : null}
      {seule ? <AttachmentPreview item={piece} onClose={() => setSeule(false)} /> : null}
    </div>
  );
}

