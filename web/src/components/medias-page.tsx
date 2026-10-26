import * as React from 'react';
import { Download, Film, Image as IconeImage, Loader2, Music } from 'lucide-react';
import { type Card, ROUTE_ARCHIVE_DES_IMAGES, type CorpsDArchive, type LotDArchive } from '@beluga/shared';
import { Button, Drawer, TitreDePage, ZoneDefilement } from '@/components/ui';
import { SeparateurDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { PastilleProjet } from '@/components/pastille-projet';
import { SilhouetteMedias } from '@/components/silhouettes';
import { adresseDePiece, LARGEUR_DE_VIGNETTE } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { bytes, cn } from '@/lib/utils';
import { formatRegional, t } from '@/lib/langue';

/**
 * LA PAGE « MÉDIAS » (mode Réalisation, 18/10/2026) — tout ce que les agents ont
 * fabriqué dans un projet, rangé PAR CARTE, la plus récente en haut.
 *
 * La colonne de gauche liste les projets qui ont des médias (avec leur nombre) ;
 * sur téléphone, où elle n'existe pas, la page montre cette liste tant
 * qu'aucun projet n'est choisi, et la flèche de la barre d'en-tête y ramène
 * (`data-medias-retour`). Chaque média se regarde ou s'écoute sur place et se
 * télécharge un par un ; « Tout télécharger » rend l'archive d'une carte.
 *
 * Aucun onglet « Médias » dans la carte (décision de l'utilisateur) : les
 * médias y paraissent dans le fil, au fil de la fabrication.
 */

type Genre = 'image' | 'video' | 'son';

interface MediaAffiche {
  id: string;
  plan: string;
  version: number;
  genre: Genre;
  modele: string;
  service: string;
  prix: number | null;
  attachmentId: string | null;
  nom: string | null;
  taille: number | null;
  creeLe: number;
}

interface GroupeAffiche {
  cardId: string;
  titre: string;
  colonne: string | null;
  depense: number;
  dernier: number;
  medias: MediaAffiche[];
}

interface PageDeMedias {
  groupes: GroupeAffiche[];
  suite: number | null;
  totaux: Record<Genre, number>;
}

const FILTRES: { cle: Genre | null; libelle: () => string }[] = [
  { cle: null, libelle: () => t('Tout') },
  { cle: 'image', libelle: () => t('Images') },
  { cle: 'video', libelle: () => t('Vidéos') },
  { cle: 'son', libelle: () => t('Sons') },
];

function prixLisible(prix: number | null): string {
  if (prix === null) return t('prix non publié');
  return `${prix < 1 ? prix.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : prix.toFixed(2)} $`;
}

export function MediasPage({
  open,
  enPage,
  onClose,
  vise,
  onVise,
  onOuvrirCarte,
}: {
  open: boolean;
  enPage?: boolean;
  onClose: () => void;
  vise: string | null;
  onVise: (projectId: string | null) => void;
  onOuvrirCarte?: (card: Card) => void;
}) {
  const state = useApp();
  const dansLaColonne = useColonneDeService();
  const [projets, setProjets] = React.useState<{ projectId: string; nombre: number }[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ projets: { projectId: string; nombre: number }[] }>({ type: 'medias.projets' })
      .then((r) => vivant && setProjets(r.projets ?? []))
      .catch(() => vivant && setProjets((p) => p ?? []));
    return () => {
      vivant = false;
    };
  }, [open]);

  /* SUR ORDINATEUR, UN PROJET EST TOUJOURS OUVERT : celui du tableau s'il a des
     médias, sinon le premier de la liste. */
  React.useEffect(() => {
    if (vise || !dansLaColonne || !projets?.length) return;
    const actif = projets.find((p) => p.projectId === state.activeProjectId);
    onVise((actif ?? projets[0]!).projectId);
  }, [vise, dansLaColonne, projets, state.activeProjectId, onVise]);

  const nomDuProjet = (id: string) => state.projects.find((p) => p.id === id)?.name ?? id;
  const listeDesProjets = (projets ?? []).map((p) => ({ ...p, projet: state.projects.find((x) => x.id === p.projectId) }));

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      {dansLaColonne ? (
        <ColonneDeService>
          <nav aria-label="Projets avec des médias" data-colonne-medias className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            {listeDesProjets.map(({ projectId, nombre, projet }) => (
              <RubriqueDeColonne
                key={projectId}
                icone={projet ? <PastilleProjet project={projet} /> : <Film />}
                libelle={projet?.name ?? projectId}
                compte={nombre}
                actif={vise === projectId}
                onClick={() => onVise(projectId)}
                data-medias-projet={projectId}
              />
            ))}
          </nav>
        </ColonneDeService>
      ) : null}

      {vise ? (
        <>
          <SuiteDuFil onRacine={() => onVise(null)} retour={{ action: () => onVise(null), reperes: { 'data-medias-retour': '' } }}>
            <SeparateurDuFil />
            <span className="min-w-0 truncate font-medium text-text" data-medias-fil-projet>
              {nomDuProjet(vise)}
            </span>
          </SuiteDuFil>
          <MediasDuProjet key={vise} projectId={vise} onOuvrirCarte={onOuvrirCarte} />
        </>
      ) : (
        <>
          <TitreDePage>{t('Médias')}</TitreDePage>
          <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
            {projets === null ? (
              <SilhouetteMedias />
            ) : !projets.length ? (
              <p className="text-[14px] text-muted" data-medias-vide>
                {t('Aucun média fabriqué pour l’instant. Allumez la caméra sur une carte pour faire réaliser une image ou une vidéo.')}
              </p>
            ) : (
              /* SUR TÉLÉPHONE, LA LISTE DES PROJETS EST DANS LA PAGE. */
              <div className="flex flex-col gap-0.5" data-medias-liste-projets>
                {listeDesProjets.map(({ projectId, nombre, projet }) => (
                  <RubriqueDeColonne
                    key={projectId}
                    icone={projet ? <PastilleProjet project={projet} /> : <Film />}
                    libelle={projet?.name ?? projectId}
                    compte={nombre}
                    onClick={() => onVise(projectId)}
                    data-medias-projet={projectId}
                  />
                ))}
              </div>
            )}
          </ZoneDefilement>
        </>
      )}
    </Drawer>
  );
}

function MediasDuProjet({ projectId, onOuvrirCarte }: { projectId: string; onOuvrirCarte?: (card: Card) => void }) {
  const state = useApp();
  const [genre, setGenre] = React.useState<Genre | null>(null);
  const [page, setPage] = React.useState<PageDeMedias | null>(null);
  const [suiteEnVol, setSuiteEnVol] = React.useState(false);
  /* Une pièce jointe neuve du projet (un média tout juste rangé) relit la page. */
  const nombreDePieces = (state.attachments?.[projectId] ?? []).length;

  React.useEffect(() => {
    let vivant = true;
    client
      .call<PageDeMedias>({ type: 'medias.lister', projectId, ...(genre ? { genre } : {}) })
      .then((r) => vivant && setPage(r))
      .catch(() => vivant && setPage((p) => p ?? { groupes: [], suite: null, totaux: { image: 0, video: 0, son: 0 } }));
    return () => {
      vivant = false;
    };
  }, [projectId, genre, nombreDePieces]);

  const chargerLaSuite = () => {
    if (!page?.suite || suiteEnVol) return;
    setSuiteEnVol(true);
    void client
      .call<PageDeMedias>({ type: 'medias.lister', projectId, avant: page.suite, ...(genre ? { genre } : {}) })
      .then((r) => setPage((p) => (p ? { ...r, groupes: [...p.groupes, ...r.groupes] } : r)))
      .catch(() => undefined)
      .finally(() => setSuiteEnVol(false));
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-4" role="tablist" aria-label="Genre de média" data-medias-filtres>
        {FILTRES.map((f) => {
          const actif = genre === f.cle;
          const compte = f.cle && page ? page.totaux[f.cle] : null;
          return (
            <button
              key={f.cle ?? 'tout'}
              type="button"
              role="tab"
              aria-selected={actif}
              onClick={() => setGenre(f.cle)}
              data-medias-filtre={f.cle ?? 'tout'}
              className={cn(
                'h-[38px] sm:h-8 rounded-full px-3.5 text-[13.5px] transition-colors',
                actif ? 'bg-raised font-medium text-text' : 'text-muted hover:text-text',
              )}
            >
              {f.libelle()}
              {compte ? <span className="ml-1.5 text-faint">{compte}</span> : null}
            </button>
          );
        })}
      </div>
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
        {page === null ? (
          <SilhouetteMedias />
        ) : !page.groupes.length ? (
          <p className="text-[14px] text-muted" data-medias-vide>
            {t('Aucun média de ce genre dans ce projet.')}
          </p>
        ) : (
          <div className="flex flex-col gap-8" data-medias-groupes>
            {page.groupes.map((g) => (
              <GroupeDeLaCarte key={g.cardId} groupe={g} carte={state.cards[g.cardId]} onOuvrirCarte={onOuvrirCarte} />
            ))}
            {page.suite ? (
              <Button variant="ghost" className="self-center" onClick={chargerLaSuite} disabled={suiteEnVol} data-medias-suite>
                {suiteEnVol ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('Cartes plus anciennes')}
              </Button>
            ) : null}
          </div>
        )}
      </ZoneDefilement>
    </>
  );
}

function GroupeDeLaCarte({ groupe, carte, onOuvrirCarte }: { groupe: GroupeAffiche; carte?: Card; onOuvrirCarte?: (card: Card) => void }) {
  const [archive, setArchive] = React.useState<'repos' | 'prepare' | 'erreur'>('repos');
  const pieces = groupe.medias.filter((m) => m.attachmentId);

  const toutTelecharger = async () => {
    setArchive('prepare');
    try {
      const corps: CorpsDArchive = { ids: pieces.map((m) => m.attachmentId!), chemins: [], nom: groupe.titre };
      const reponse = await fetch(ROUTE_ARCHIVE_DES_IMAGES, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      });
      const rendu = (await reponse.json().catch(() => ({}))) as Partial<LotDArchive> & { error?: string };
      if (!reponse.ok || !rendu.adresse) throw new Error(rendu.error ?? String(reponse.status));
      const lien = document.createElement('a');
      lien.href = rendu.adresse;
      lien.download = '';
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setArchive('repos');
    } catch (err: any) {
      setArchive('erreur');
      client.pushToast('error', err?.message ?? t('Téléchargement impossible'));
    }
  };

  return (
    <section data-medias-carte={groupe.cardId} className="flex flex-col gap-2.5">
      <header className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          {carte && onOuvrirCarte ? (
            <button type="button" className="min-w-0 truncate text-left text-[15px] font-semibold text-text hover:underline" onClick={() => onOuvrirCarte(carte)} data-medias-ouvrir-carte>
              {groupe.titre}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[15px] font-semibold text-text">{groupe.titre}</span>
          )}
          <span className="text-[12.5px] text-faint">
            {new Date(groupe.dernier).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'long', year: 'numeric' })} · {t('{n} média(s)', { n: groupe.medias.length })} · {t('dépensé : {v0}', { v0: prixLisible(groupe.depense) })}
          </span>
        </div>
        {pieces.length > 1 ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void toutTelecharger()} disabled={archive === 'prepare'} data-medias-tout-telecharger>
            {archive === 'prepare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {t('Tout télécharger')}
          </Button>
        ) : null}
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groupe.medias.map((m) => (
          <VignetteDeMedia key={m.id} media={m} />
        ))}
      </div>
    </section>
  );
}

function VignetteDeMedia({ media }: { media: MediaAffiche }) {
  const Icone = media.genre === 'image' ? IconeImage : media.genre === 'video' ? Film : Music;
  return (
    <figure className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface p-2" data-media={media.id} data-media-genre={media.genre}>
      {media.attachmentId ? (
        media.genre === 'image' ? (
          <a href={adresseDePiece(media.attachmentId)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-raised">
            <img src={adresseDePiece(media.attachmentId, false, LARGEUR_DE_VIGNETTE)} alt={media.plan} loading="lazy" className="aspect-square w-full object-cover" />
          </a>
        ) : media.genre === 'video' ? (
          <video controls preload="metadata" src={adresseDePiece(media.attachmentId)} className="aspect-video w-full rounded-xl bg-raised" />
        ) : (
          <div className="flex aspect-[3/1] items-center rounded-xl bg-raised px-3">
            <audio controls preload="metadata" src={adresseDePiece(media.attachmentId)} className="w-full" />
          </div>
        )
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-xl bg-raised text-faint">
          <Icone className="h-6 w-6" />
        </div>
      )}
      <figcaption className="flex min-w-0 items-center gap-2 px-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate text-[13.5px] text-text" title={media.plan}>
            {media.plan} <span className="text-faint">v{media.version}</span>
          </span>
          <span className="min-w-0 truncate text-[12px] text-faint">
            {media.modele} · {prixLisible(media.prix)}
            {media.taille ? ` · ${bytes(media.taille)}` : ''}
          </span>
        </div>
        {media.attachmentId ? (
          <a
            href={adresseDePiece(media.attachmentId, true)}
            download={media.nom ?? undefined}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-text"
            aria-label="Télécharger"
            title={t('Télécharger')}
            data-media-telecharger
          >
            <Download className="h-4 w-4" />
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}
