import * as React from 'react';
import { Download, FileText, FolderOpen, Eye, Paperclip } from '@/components/ui/icones';
import { Attachment, capturesDuFlux, capturesPasEncoreVues, clesAMarquerVues, etiquetteDePiece } from '@beluga/shared';
import { DialogTitle, Drawer, EmptyState, ZoneDefilement } from '@/components/ui';
import { AttachmentPreview } from '@/components/attachment-preview';
import { CommandesDesVues, RienDeNouveau } from '@/components/commandes-des-vues';
import { client } from '@/lib/client';
import { useImagesVues } from '@/lib/use-images-vues';
import { useApp } from '@/lib/use-app';
import { bytes, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';
import { FichiersDuProjet } from '@/components/fichiers/explorateur-de-fichiers';

/** Ce que montre le tiroir : l'arborescence du projet, ou ses pièces jointes. */
export type VueFichiers = 'fichiers' | 'pieces';

/**
 * LES FICHIERS ET LES PIÈCES JOINTES S'OUVRENT EN TIROIR, depuis le menu des
 * trois points (et, sur téléphone, depuis le bouton « Fichiers » du menu du
 * bas). L'ancien volet de droite et ses deux onglets ont disparu : c'est
 * l'entrée choisie qui dit quelle liste montrer, il n'y a donc plus d'onglet à
 * basculer dans le tiroir lui-même.
 */
export function TiroirFichiers({
  projectId,
  vue,
  onClose,
}: {
  projectId: string;
  vue: VueFichiers | null;
  onClose: () => void;
}) {
  return (
    <Drawer open={vue !== null} onClose={onClose} hauteurFixe>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        {vue === 'pieces' ? (
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-accent" />
        ) : (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
        )}
        <DialogTitle className="min-w-0 flex-1 truncate">
          {vue === 'pieces' ? t('Pièces jointes') : t('Fichiers')}
        </DialogTitle>
      </header>
      <div data-tiroir-fichiers={vue ?? undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {vue === 'pieces' ? <AttachmentsTab projectId={projectId} /> : null}
        {/* LE DOSSIER DU PROJET dans l'arborescence rangée (carte « Fichiers rangés et captures pleine page ») : la même
            source que la fenêtre « Fichiers », ouverte sur ce projet ; son code se lit dans « Code ». */}
        {vue === 'fichiers' ? <FichiersDuProjet projectId={projectId} /> : null}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Pièces jointes                                               */
/* ------------------------------------------------------------------ */

function AttachmentsTab({ projectId }: { projectId: string }) {
  const state = useApp();
  const items = state.attachments[projectId] ?? [];
  const [zoom, setZoom] = React.useState<Attachment | null>(null);
  const [filtre, setFiltre] = React.useState(false);

  React.useEffect(() => {
    client.send({ type: 'attachments.list', projectId });
  }, [projectId]);

  /*
   * L'ŒIL « DÉJÀ VUE » — le même qu'en pied de flux (`useImagesVues`). Chaque
   * image du projet porte son œil une fois ouverte en grand ; mais le filtre
   * et le bouton « tout marquer comme vu » ne comptent QUE les images de
   * l'agent (`deLAgent`) : ce que l'utilisateur a lui-même déposé n'est pas à
   * « voir ». L'ouverture, ou le feuilletage, marque comme dans la bande.
   */
  const images = React.useMemo(() => items.filter((p) => p.mime.startsWith('image/')), [items]);
  const captures = React.useMemo(() => capturesDuFlux([], images), [images]);
  const captureDe = React.useMemo(
    () => new Map(captures.flatMap((c) => (c.genre === 'jointe' ? [[c.id, c] as const] : []))),
    [captures],
  );
  const vues = useImagesVues(captures);
  const deLAgent = React.useMemo(() => {
    const idsDeLAgent = new Set(images.filter((p) => p.deLAgent).map((p) => p.id));
    return captures.filter((c) => c.genre === 'jointe' && idsDeLAgent.has(c.id));
  }, [captures, images]);
  const nonVues = React.useMemo(() => capturesPasEncoreVues(deLAgent, vues.vues), [deLAgent, vues.vues]);
  const ouvrir = React.useCallback(
    (piece: Attachment) => {
      vues.ouvrirEnMarquant(captureDe.get(piece.id));
      setZoom(piece);
    },
    [vues.ouvrirEnMarquant, captureDe],
  );
  const pieceDejaVue = React.useCallback(
    (piece: Attachment) => {
      const c = captureDe.get(piece.id);
      return c ? vues.dejaVueAvantOuverture(c) : false;
    },
    [captureDe, vues.dejaVueAvantOuverture],
  );

  if (!items.length) {
    return (
      <EmptyState
        icon={<Paperclip className="h-5 w-5" />}
        title={t('Aucune pièce jointe')}
        hint={t('Tout ce qui transite par les conversations du projet apparaît ici.')}
      />
    );
  }

  // Le filtre ne laisse que les images de l'agent pas encore ouvertes.
  const idsNonVues = new Set(nonVues.map((c) => (c.genre === 'jointe' ? c.id : '')));
  const affichees = filtre ? items.filter((p) => idsNonVues.has(p.id)) : items;

  return (
    <ZoneDefilement classeEnveloppe="h-full" className="p-2">
      {/* Les commandes de l'œil ne servent qu'à partir de deux images de l'agent. */}
      {deLAgent.length > 1 ? (
        <div className="mb-1.5 flex items-center" data-commandes-pieces>
          <CommandesDesVues
            nonVues={nonVues.length}
            filtre={filtre}
            onFiltre={setFiltre}
            onToutMarquer={() => vues.marquer(clesAMarquerVues(deLAgent, vues.vues))}
          />
        </div>
      ) : null}
      {filtre && !affichees.length ? <RienDeNouveau className="px-1 py-2" /> : null}
      <div className="grid grid-cols-2 gap-1.5">
        {affichees.map((item) => {
          const isImage = item.mime.startsWith('image/');
          const capture = captureDe.get(item.id);
          const vue = !!capture && vues.dejaVue(capture);
          return (
            <div key={item.id} className="overflow-hidden rounded-md border border-border bg-surface">
              <button
                onClick={() => ouvrir(item)}
                title={vue ? t('Déjà vue') : undefined}
                data-piece-ouvrir={item.id}
                className="relative block w-full"
              >
                {vue ? (
                  <span className="pointer-events-none absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-sm bg-surface/85 text-muted">
                    <Eye className="h-3 w-3" aria-hidden data-capture-vue />
                  </span>
                ) : null}
                {isImage ? (
                  <img
                    src={`/api/attachment?id=${item.id}`}
                    alt={etiquetteDePiece(item)}
                    className="h-20 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-20 items-center justify-center text-faint">
                    <FileText className="h-5 w-5" />
                  </div>
                )}
              </button>
              <div className="px-1.5 py-1">
                <p className="truncate text-[12.5px] text-muted">{etiquetteDePiece(item)}</p>
                <div className="flex items-center gap-1 text-[11.5px] text-faint">
                  <span>{bytes(item.size)}</span>
                  <span>·</span>
                  <span>{relativeTime(item.createdAt)}</span>
                  <a
                    href={`/api/attachment?id=${item.id}&download=1`}
                    className="ml-auto hover:text-text"
                    title={t('Télécharger')}
                  >
                    <Download className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* La galerie garde TOUTES les images, filtre allumé ou non : l'image ouverte devient vue
          et quitte la liste filtrée, sans disparaître de la visionneuse. */}
      <AttachmentPreview
        item={zoom}
        onClose={() => setZoom(null)}
        galerie={images}
        onNaviguer={ouvrir}
        dejaVue={pieceDejaVue}
      />
    </ZoneDefilement>
  );
}
