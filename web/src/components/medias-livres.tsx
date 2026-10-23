import * as React from 'react';
import { Download, Loader2, Music } from 'lucide-react';
import { ROUTE_ARCHIVE_DES_IMAGES, type CorpsDArchive, type LotDArchive, type MediaLivre } from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { LecteurSon } from '@/components/lecteur-son';
import { EnTeteDePanneau, Panneau } from '@/components/panneau';
import { adresseDePiece, LARGEUR_DE_VIGNETTE } from '@/components/pastille-de-fichier';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { useTelechargement } from '@/lib/telechargement';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES MÉDIAS LIVRÉS, SOUS LA RÉPONSE FINALE (décision du 20/10/2026).
 *
 * À la fin de toute discussion qui a fabriqué des images, des vidéos ou des
 * sons, la réponse finale les montre TOUS — versions comprises, pour que
 * l'utilisateur choisisse — dans un bloc à deux étages (en-tête + panneau, le
 * même cadre que « Ce que l'agent a vu »). Chaque média a son bouton
 * « Télécharger » ; l'en-tête porte « Tout télécharger » (une archive .zip,
 * préparée par le serveur comme celle de la visionneuse).
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

export function MediasLivres({ medias, className }: { medias: readonly MediaLivre[]; className?: string }) {
  if (!medias.length) return null;
  return (
    <section className={cn('min-w-0', className)} data-medias-livres={medias.length}>
      <EnTeteDePanneau className="flex items-center gap-2 font-normal" data-medias-livres-en-tete="">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {t('Médias fabriqués ({n})', { n: medias.length })}
        </span>
        {medias.length > 1 ? <ToutTelecharger medias={medias} /> : null}
      </EnTeteDePanneau>
      <Panneau className="px-2 py-2">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {medias.map((m) => (
            <MediaDuBloc key={m.id} media={m} />
          ))}
        </ul>
      </Panneau>
    </section>
  );
}

function MediaDuBloc({ media }: { media: MediaLivre }) {
  const state = useApp();
  const piece = (state.attachments[media.projectId] ?? []).find((p) => p.id === media.attachmentId);
  const [ouverte, setOuverte] = React.useState(false);
  const nom = piece?.name ?? media.sujet ?? 'media';
  const { etat, lancer } = useTelechargement([{ adresse: adresseDePiece(media.attachmentId, true), nom }]);
  const legende = `${media.sujet || t('Média')}${media.version > 1 ? ` · v${media.version}` : ''}`;
  return (
    <li className="flex min-w-0 flex-col gap-1" data-media-livre={media.attachmentId} data-media-livre-genre={media.genre}>
      <div className="relative overflow-hidden rounded-lg bg-raised">
        {media.genre === 'image' ? (
          <button type="button" className="block aspect-video w-full" onClick={() => setOuverte(true)} title={t('Ouvrir en grand')}>
            <img src={adresseDePiece(media.attachmentId, false, LARGEUR_DE_VIGNETTE)} alt={legende} className="h-full w-full object-contain" loading="lazy" />
          </button>
        ) : media.genre === 'video' ? (
          <video src={adresseDePiece(media.attachmentId)} controls preload="metadata" className="block aspect-video w-full bg-raised" data-media-livre-video />
        ) : (
          <div className="flex aspect-video flex-col justify-center gap-2 p-2" data-media-livre-son>
            <Music className="h-4 w-4 text-faint" aria-hidden />
            <LecteurSon id={media.attachmentId} nom={legende} poids={piece?.size} compact className="bg-surface" onAgrandir={piece ? () => setOuverte(true) : undefined} />
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted" title={legende}>
          {legende}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Télécharger ce média"
          onClick={lancer}
          disabled={etat === 'reception'}
          data-media-livre-telecharger
        >
          {etat === 'reception' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {piece ? <AttachmentPreview item={ouverte ? piece : null} onClose={() => setOuverte(false)} /> : null}
    </li>
  );
}

/** « Tout télécharger » : une archive .zip, préparée par le serveur (la liste part dans le corps, jamais dans l'adresse). */
function ToutTelecharger({ medias }: { medias: readonly MediaLivre[] }) {
  const ids = medias.map((m) => m.attachmentId);
  const archive = React.useMemo(
    () => ({
      adresse: `${ROUTE_ARCHIVE_DES_IMAGES}#medias-livres:${ids.join(',')}`,
      nom: 'medias.zip',
      preparer: async (signal: AbortSignal) => {
        const corps: CorpsDArchive = { ids, chemins: [], nom: 'medias' };
        const reponse = await fetch(ROUTE_ARCHIVE_DES_IMAGES, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corps),
          signal,
        });
        const rendu = (await reponse.json().catch(() => ({}))) as Partial<LotDArchive> & { error?: string };
        if (!reponse.ok || !rendu.adresse) throw new Error(rendu.error ?? String(reponse.status));
        return rendu.adresse;
      },
    }),
    [ids.join(',')],
  );
  const { etat, lancer } = useTelechargement([archive]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 gap-1.5 px-2 text-[12.5px]"
      onClick={lancer}
      disabled={etat === 'reception'}
      title={t('Télécharger tous les médias en une archive (.zip)')}
      data-medias-livres-tout-telecharger
    >
      {etat === 'reception' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {t('Tout télécharger ({n})', { n: medias.length })}
    </Button>
  );
}
