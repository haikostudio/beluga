import * as React from 'react';
import { Clapperboard, Image as ImageIcon, Music, TriangleAlert } from 'lucide-react';
import {
  mediasDeLaConversation,
  piecesMontreesParLesBlocs,
  prixDuMedia,
  ratioDuMedia,
  tempsDeFabrication,
  type MediaEnFabrication,
} from '@beluga/shared';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { InformationsDeLaPiece, MenuDeLaPiece } from '@/components/menu-du-media';
import { useApp } from '@/lib/use-app';
import { useSeconde } from '@/lib/horloge';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES MÉDIAS EN FABRICATION, AU BAS DU FIL (`shared/src/media-en-fabrication.ts`).
 *
 * Dès qu'une image, une vidéo ou un son part en fabrication — mode réalisation,
 * Studio, ou tout agent qui l'annonce —, un BLOC à la forme du média attendu
 * paraît ici : une lumière douce y passe lentement de haut en bas, comme celle
 * d'un scanner (pas d'effet de verre), avec le sujet, le temps écoulé, l'outil
 * et le prix. L'aperçu remplace le scintillement dès que le média est prêt, et
 * s'ouvre en grand d'un clic ; un échec se dit dans le bloc.
 *
 * Monté dans les DEUX fils de `chat.tsx` — le parcours d'une carte (volet de
 * réalisation compris) et la conversation d'un agent (Studio compris). Le
 * scintillement s'arrête en veille (`html.en-veille`) et quand l'appareil
 * demande moins d'animations (`styles.css`).
 */
/**
 * LES PIÈCES DÉJÀ MONTRÉES PAR UN BLOC : la bande « Ce que l'agent a vu » d'un
 * message (`message-view.tsx`) ne les redit pas — un même média deux fois dans
 * le fil, c'est un de trop.
 */
export const ContextePiecesDesBlocs = React.createContext<ReadonlySet<string>>(new Set());

/** Les blocs d'une conversation, et les pièces qu'ils montrent déjà. */
export function useBlocsDeLaConversation(ou: { cardId?: string | null; agentId?: string | null }, depuis = 0) {
  const tous = useApp().mediasEnFabrication;
  const blocs = React.useMemo(() => mediasDeLaConversation(tous ?? [], ou, depuis), [tous, ou.cardId, ou.agentId, depuis]);
  const pieces = React.useMemo(() => piecesMontreesParLesBlocs(blocs), [blocs]);
  return { blocs, pieces };
}

export function MediasEnFabrication({
  cardId,
  agentId,
  depuis,
  exclure,
  className,
}: {
  cardId?: string | null;
  agentId?: string | null;
  /** La dernière demande : les blocs terminés d'avant sont déjà des pièces jointes du fil. */
  depuis?: number;
  /** Les pièces déjà rendues sous une réponse finale (`medias-livres.tsx`) : un seul aperçu par média. */
  exclure?: ReadonlySet<string>;
  className?: string;
}) {
  const { blocs: tous } = useBlocsDeLaConversation({ cardId, agentId }, depuis ?? 0);
  const blocs = exclure?.size ? tous.filter((m) => !(m.etat === 'fini' && m.attachmentId && exclure.has(m.attachmentId))) : tous;
  if (!blocs.length) return null;
  return (
    <div data-medias-en-fabrication={blocs.length} className={cn('flex flex-wrap items-start gap-3', className)}>
      {blocs.map((m) => (
        <BlocDeMedia key={m.id} media={m} />
      ))}
    </div>
  );
}

function BlocDeMedia({ media }: { media: MediaEnFabrication }) {
  const state = useApp();
  const enCours = media.etat === 'en-cours';
  const maintenant = useSeconde(enCours);
  const piece = media.attachmentId ? (state.attachments[media.projectId] ?? []).find((p) => p.id === media.attachmentId) : undefined;
  const [ouverte, setOuverte] = React.useState(false);
  const ratio = ratioDuMedia(media);
  /* Un bloc couché ne dépasse pas la largeur du fil ; un bloc debout ne monte pas trop haut. */
  const largeur = media.genre === 'son' ? 360 : ratio >= 1 ? 320 : Math.round(300 * ratio);
  /* Les deux prix en mots passent par le dictionnaire ; un montant s'affiche tel quel. */
  const prixAffiche = media.prix === null ? t('prix non publié') : media.prix === 0 ? t('gratuit') : prixDuMedia(media.prix);
  const Icone = media.genre === 'video' ? Clapperboard : media.genre === 'son' ? Music : ImageIcon;
  const fini = media.etat === 'fini' && piece;

  return (
    <figure
      data-media-en-fabrication={media.id}
      data-media-etat={media.etat}
      className="relative min-w-0 max-w-full"
      style={{ width: largeur }}
    >
      {fini ? <MenuDeLaPiece cardId={media.cardId} attachmentId={media.attachmentId} /> : null}
      {fini && piece.mime.startsWith('image/') ? (
        <button
          type="button"
          onClick={() => setOuverte(true)}
          title={t('Ouvrir en grand')}
          className="block w-full overflow-hidden rounded-lg bg-raised"
          style={{ aspectRatio: String(ratio) }}
        >
          <img src={adresseDePiece(piece.id, false, 640)} alt={media.sujet} className="h-full w-full object-cover" loading="lazy" />
        </button>
      ) : fini ? (
        <AttachmentThumb item={piece} onOpen={() => setOuverte(true)} className="w-full" />
      ) : (
        <div
          data-media-scintille={enCours ? '' : undefined}
          className={cn(
            'relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-raised',
            enCours && 'media-en-fabrication',
          )}
          style={{ aspectRatio: String(ratio) }}
        >
          {media.etat === 'echec' ? (
            <span className="flex max-w-[85%] items-start gap-1.5 text-[12.5px] text-danger">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{media.echec ?? t('Échec de la fabrication')}</span>
            </span>
          ) : (
            <Icone className={cn('h-5 w-5', enCours ? 'text-teinte' : 'text-faint')} />
          )}
        </div>
      )}
      <figcaption className="mt-1.5 min-w-0 space-y-0.5 text-[12px] leading-snug">
        <p className="truncate text-[13px] text-text" title={media.sujet}>
          {media.sujet}
        </p>
        <p className="flex min-w-0 flex-wrap gap-x-1.5 text-faint">
          <span data-media-temps className={cn('tabular-nums', enCours && 'text-teinte')}>
            {enCours ? t('En fabrication · {v0}', { v0: tempsDeFabrication(media.debut, maintenant) }) : tempsDeFabrication(media.debut, media.fin ?? media.debut)}
          </span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate" title={media.outil}>
            {media.outil}
          </span>
          {prixAffiche ? (
            <>
              <span aria-hidden>·</span>
              <span data-media-prix>{prixAffiche}</span>
            </>
          ) : null}
        </p>
        {fini ? <InformationsDeLaPiece cardId={media.cardId} attachmentId={media.attachmentId} /> : null}
      </figcaption>
      {piece ? <AttachmentPreview item={ouverte ? piece : null} onClose={() => setOuverte(false)} /> : null}
    </figure>
  );
}
