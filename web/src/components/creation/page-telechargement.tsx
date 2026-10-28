import * as React from 'react';
import { Download, FolderDown, Loader2, Music, Play } from 'lucide-react';
import { LIBELLES_SECTIONS_DU_TELECHARGEMENT, SECTIONS_DU_TELECHARGEMENT, type FichierDuTelechargement, type SectionDuTelechargement } from '@beluga/shared';
import { Button, ZoneDefilement } from '@/components/ui';
import { AttachmentPreview } from '@/components/attachment-preview';
import { VignetteVideo } from '@/components/lecteur-video';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { CroixDuVolet } from '@/components/feuille-du-volet';
import { client } from '@/lib/client';
import { fermerLeDocument } from '@/lib/document-de-carte';
import { t } from '@/lib/langue';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { useTelechargement } from '@/lib/telechargement';

type FichierLu = FichierDuTelechargement & { mime: string; taille: number | null };
type Sections = Record<SectionDuTelechargement, FichierLu[]>;

/**
 * LA PAGE TÉLÉCHARGEMENT D'UNE CRÉATION DE MÉDIA (décision de l'utilisateur du
 * 26/10/2026) : tout ce qui a été généré, rangé de haut en bas — les MÉDIAS
 * FINAUX (rendus des studios, exports du montage), puis les VALIDÉS, puis
 * TOUTES LES ESQUISSES. Chaque fichier se télécharge seul ; « Tout
 * télécharger » donne UNE archive avec trois dossiers nommés d'après les étapes
 * (`/api/creation/telechargement`), en flux, sans rien coûter. « Terminer »,
 * au bout du parcours, reste le bouton du bas.
 */
export default function PageTelechargement({ cardId }: { cardId: string }) {
  /* La langue de la page, lue sur le document (la racine seule la pose) : les dossiers de l'archive la suivent. */
  const langue = (typeof document !== 'undefined' ? document.documentElement.lang : '').slice(0, 2) || 'fr';
  const production = useProduction(cardId);
  const [sections, setSections] = React.useState<Sections | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const carte = useApp().cards[cardId];
  /* Relue à chaque changement de la production (un export qui finit, un média validé). */
  React.useEffect(() => {
    let vivant = true;
    client
      .call<Sections>({ type: 'realisation.telechargement.lire', cardId })
      .then((r) => vivant && setSections(r))
      .catch((err: any) => vivant && setErreur(err?.message ?? t('La page n’a pas pu être lue')));
    return () => {
      vivant = false;
    };
  }, [cardId, production, carte?.realisation?.finaux?.length]);

  const tous = sections ? SECTIONS_DU_TELECHARGEMENT.flatMap((s) => sections[s]) : [];
  const galerie = React.useMemo(
    () => tous.filter((f, i) => tous.findIndex((x) => x.piece === f.piece) === i).map((f) => ({ id: f.piece, projectId: carte?.projectId ?? '', name: f.nom, mime: f.mime, size: f.taille ?? 0, sha: f.piece, createdAt: 0 })),
    [sections],
  );
  const piece = ouverte ? galerie.find((p) => p.id === ouverte) ?? null : null;
  const archive = `/api/creation/telechargement?cardId=${encodeURIComponent(cardId)}&langue=${encodeURIComponent(langue)}`;
  /* L'ARCHIVE PASSE PAR LE GESTE DE L'APPLICATION (feuille de partage sur téléphone) : jamais une page qui remplace l'application. */
  const tout = useTelechargement([{ adresse: archive, nom: `${carte?.title?.trim() || 'creation'}.zip` }]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-page-telechargement={cardId}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2 pt-3">
        <span className="mr-auto min-w-0 truncate text-[14.5px] font-medium text-text">{t('Téléchargement')}</span>
        <Button type="button" className="gap-1.5 bg-accent text-accent-fg hover:opacity-90" disabled={!tous.length || tout.etat === 'reception'} aria-busy={tout.etat === 'reception'} onClick={tout.lancer} data-tout-telecharger={archive}>
          {tout.etat === 'reception' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderDown className="h-3.5 w-3.5" />}
          {tout.etat === 'reception' ? t('Préparation de l’archive… {n} %', { n: tout.pourcent }) : t('Tout télécharger')}
        </Button>
        <CroixDuVolet genre="telechargement" onFermer={fermerLeDocument} className="-my-1 -mr-2" />
      </div>
      {erreur ? <p className="px-4 text-[13px] text-danger">{erreur}</p> : null}
      {!sections && !erreur ? (
        <p className="flex items-center gap-2 px-4 py-2 text-[13px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Chargement…')}
        </p>
      ) : null}
      {sections ? (
        <ZoneDefilement className="min-h-0 flex-1 px-4 pb-6">
          <div className="flex flex-col gap-5">
            {SECTIONS_DU_TELECHARGEMENT.map((s) => (
              <section key={s} className="flex flex-col gap-2" data-section-telechargement={s} data-nombre={sections[s].length}>
                <h3 className="flex items-baseline gap-1.5 text-[12px] font-medium uppercase tracking-wide text-faint">
                  {t(LIBELLES_SECTIONS_DU_TELECHARGEMENT[s])}
                  <span className="tabular-nums">· {sections[s].length}</span>
                </h3>
                {sections[s].length ? (
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {sections[s].map((f) => (
                      <FichierDeLaPage key={`${s}-${f.piece}`} fichier={f} onOuvrir={() => setOuverte(f.piece)} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-faint">
                    {s === 'finaux'
                      ? t('Aucun média final pour l’instant : exportez depuis le montage.')
                      : s === 'valides'
                        ? t('Aucun élément validé.')
                        : t('Aucune esquisse.')}
                  </p>
                )}
              </section>
            ))}
          </div>
        </ZoneDefilement>
      ) : null}
      <AttachmentPreview item={piece} galerie={galerie} onNaviguer={(p) => setOuverte(p.id)} onClose={() => setOuverte(null)} />
    </div>
  );
}

function FichierDeLaPage({ fichier, onOuvrir }: { fichier: FichierLu; onOuvrir: () => void }) {
  const extension = fichier.mime.split('/')[1]?.replace('mpeg', 'mp3').replace('quicktime', 'mov') ?? '';
  const { etat, lancer } = useTelechargement([{ adresse: adresseDePiece(fichier.piece, true), nom: `${fichier.nom}${extension ? `.${extension}` : ''}` }]);
  return (
    <li className="flex min-w-0 flex-col gap-1" data-fichier-telechargement={fichier.piece}>
      <button type="button" onClick={onOuvrir} title={t('Ouvrir en grand')} className="relative block aspect-video w-full overflow-hidden rounded-lg bg-raised/60">
        {fichier.genre === 'image' ? (
          <ImageDePiece id={fichier.piece} alt={fichier.nom} className="h-full w-full object-cover" />
        ) : fichier.genre === 'video' ? (
          <>
            <VignetteVideo id={fichier.piece} nom={fichier.nom} className="pointer-events-none h-full w-full object-cover" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/85 text-text">
                <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden />
              </span>
            </span>
          </>
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted">
            <Music className="h-5 w-5" />
          </span>
        )}
      </button>
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted" title={fichier.nom}>
          {fichier.nom}
        </span>
        <button
          type="button"
          onClick={lancer}
          title={t('Télécharger')}
          aria-label="Télécharger"
          aria-busy={etat === 'reception'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text"
          data-telecharger-fichier={fichier.piece}
        >
          {etat === 'reception' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </button>
      </div>
    </li>
  );
}
