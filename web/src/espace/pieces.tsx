/**
 * LES PIÈCES JOINTES DE L'ESPACE CLIENT : envoi, progression, galerie.
 *
 * L'envoi affiche une VRAIE barre de progression, nourrie par les octets
 * réellement partis (`envoyerLeFichier`) et non par une animation qui tourne en
 * attendant. Un fichier trop lourd est refusé AVANT de partir, en le disant.
 */
import * as React from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { AttachmentPreview } from '@/components/attachment-preview';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { genreDuFichier, refusDeTaille, type Attachment, type GenrePiece } from '@beluga/shared';
import { IconeDeGenre, PastilleDeFichier } from '@/components/pastille-de-fichier';
import { GrilleDImages } from '@/components/grille-images';
import { LecteurVideo, VignetteVideo } from '@/components/lecteur-video';
import { envoyerLeFichier } from './canal-espace';

/* L'ICÔNE DE GENRE N'A QU'UNE DÉFINITION, et elle vit avec la pastille de
   fichier : les deux espaces s'en servent, il n'y a pas deux rendus à garder
   d'accord. Le réexport évite de réécrire les imports de l'espace client. */
export { IconeDeGenre } from '@/components/pastille-de-fichier';

export interface PieceEnvoyee {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** Un envoi en cours : son nom, sa part faite, et son échec s'il y en a un. */
export interface EnvoiEnCours {
  cle: string;
  nom: string;
  part: number;
  erreur?: string;
  fichier: File;
}

/** Un poids de fichier en clair : « 2,4 Mo », jamais un nombre d'octets nu. */
export function poidsEnClair(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * LE CROCHET D'ENVOI. Il tient la liste des pièces déjà déposées et celle des
 * envois en cours ; la reprise après échec rejoue le MÊME fichier, gardé de
 * côté pour cela.
 */
export function useEnvois(projectId: string) {
  const [pieces, setPieces] = React.useState<PieceEnvoyee[]>([]);
  const [envois, setEnvois] = React.useState<EnvoiEnCours[]>([]);

  const lancer = React.useCallback(
    async (fichier: File, cleExistante?: string) => {
      const refus = refusDeTaille(fichier.size);
      const cle = cleExistante ?? `${fichier.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (refus) {
        setEnvois((liste) => [...liste.filter((e) => e.cle !== cle), { cle, nom: fichier.name, part: 0, erreur: refus, fichier }]);
        return;
      }
      setEnvois((liste) => [...liste.filter((e) => e.cle !== cle), { cle, nom: fichier.name, part: 0, fichier }]);
      try {
        const piece = await envoyerLeFichier(fichier, projectId, (part) => {
          setEnvois((liste) => liste.map((e) => (e.cle === cle ? { ...e, part } : e)));
        });
        setPieces((liste) => [...liste, piece]);
        setEnvois((liste) => liste.filter((e) => e.cle !== cle));
      } catch (err: any) {
        setEnvois((liste) =>
          liste.map((e) => (e.cle === cle ? { ...e, erreur: err?.message ?? t("L'envoi a échoué.") } : e)),
        );
      }
    },
    [projectId],
  );

  const ajouter = React.useCallback(
    (fichiers: FileList | File[] | null) => {
      if (!fichiers) return;
      for (const fichier of Array.from(fichiers)) void lancer(fichier);
    },
    [lancer],
  );

  const reprendre = React.useCallback(
    (cle: string) => {
      const envoi = envois.find((e) => e.cle === cle);
      if (envoi) void lancer(envoi.fichier, cle);
    },
    [envois, lancer],
  );

  const oublier = React.useCallback((cle: string) => setEnvois((liste) => liste.filter((e) => e.cle !== cle)), []);
  const retirerPiece = React.useCallback((id: string) => setPieces((liste) => liste.filter((p) => p.id !== id)), []);
  const vider = React.useCallback(() => {
    setPieces([]);
    setEnvois([]);
  }, []);

  return { pieces, envois, ajouter, reprendre, oublier, retirerPiece, vider, occupe: envois.some((e) => !e.erreur) };
}

/** Le bouton qui ouvre le sélecteur de fichiers — image, vidéo ou document. */
export function BoutonJoindre({ onFichiers, compact }: { onFichiers: (f: FileList | null) => void; compact?: boolean }) {
  const champ = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={champ}
        type="file"
        multiple
        className="hidden"
        data-espace-fichier
        onChange={(e) => {
          onFichiers(e.target.files);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size={compact ? 'icon' : 'sm'}
        onClick={() => champ.current?.click()}
        title={t('Joindre un fichier')}
      >
        <Paperclip className="h-4 w-4" />
        {compact ? null : <span className="ml-1.5">{t('Joindre')}</span>}
      </Button>
    </>
  );
}

/**
 * LA LISTE DES ENVOIS EN COURS, chacun avec sa barre. L'attribut
 * `data-progression` porte la part réellement faite : un contrôle vérifie
 * ainsi un ÉTAT, jamais une largeur en pixels.
 */
export function EnvoisEnCours({
  envois,
  onReprendre,
  onOublier,
}: {
  envois: EnvoiEnCours[];
  onReprendre: (cle: string) => void;
  onOublier: (cle: string) => void;
}) {
  if (!envois.length) return null;
  return (
    <div className="flex flex-col gap-2" data-envois-en-cours={envois.length}>
      {envois.map((envoi) => (
        <div
          key={envoi.cle}
          className="rounded-lg bg-surface px-3 py-2"
          data-envoi={envoi.nom}
          data-progression={Math.round(envoi.part * 100)}
          data-envoi-echec={envoi.erreur ? '1' : undefined}
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-text">{envoi.nom}</span>
            <span className="shrink-0 text-muted">
              {envoi.erreur ? t('Échec') : `${Math.round(envoi.part * 100)} %`}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-faint/40">
            <div
              className={cn('h-full rounded-full transition-[width]', envoi.erreur ? 'bg-danger' : 'bg-warning')}
              style={{ width: `${Math.max(2, Math.round(envoi.part * 100))}%` }}
            />
          </div>
          {envoi.erreur ? (
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-danger">{envoi.erreur}</span>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => onReprendre(envoi.cle)}>
                  {t('Réessayer')}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => onOublier(envoi.cle)} title={t('Retirer')}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Les pièces déjà déposées, prêtes à partir avec le message. */
export function PiecesDeposees({ pieces, onRetirer }: { pieces: PieceEnvoyee[]; onRetirer?: (id: string) => void }) {
  if (!pieces.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-pieces-deposees={pieces.length}>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1 text-xs text-muted"
        >
          <IconeDeGenre genre={genreDuFichier(piece.mime)} className="h-3.5 w-3.5" />
          <span className="max-w-[160px] truncate">{piece.name}</span>
          {onRetirer ? (
            <button type="button" onClick={() => onRetirer(piece.id)} className="text-faint hover:text-text">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/**
 * LA VISIONNEUSE DE L'ESPACE CLIENT EST CELLE DE L'APPLICATION
 * (`AttachmentPreview`) : fenêtre centrée de hauteur fixe, zoom au clic, à la
 * molette et au pincement, carrousel qui boucle, et menu « Cette image / Tout en
 * une archive / Toutes séparément ». Ce composant n'est qu'un ADAPTATEUR : le
 * client manipule des pièces `{ id, nom }` et un rang, la visionneuse des
 * pièces jointes et une pièce ouverte. L'archive passe par la même route, qui
 * refuse au client toute pièce qui n'est pas à lui.
 */
export function Visionneuse({
  images,
  index,
  onIndex,
  onFermer,
}: {
  images: { id: string; nom: string; mime?: string; taille?: number }[];
  /** L'image montrée ; `null` : la visionneuse est fermée. */
  index: number | null;
  onIndex: (index: number) => void;
  onFermer: () => void;
}) {
  const galerie = React.useMemo(
    () =>
      images.map(
        (piece) =>
          ({
            id: piece.id,
            projectId: '',
            name: piece.nom,
            mime: piece.mime || 'image/png',
            size: piece.taille ?? 0,
            sha: '',
            createdAt: 0,
          }) as Attachment,
      ),
    [images],
  );
  return (
    <AttachmentPreview
      item={index !== null ? (galerie[index] ?? null) : null}
      onClose={onFermer}
      galerie={galerie}
      onNaviguer={(piece) => onIndex(galerie.findIndex((p) => p.id === piece.id))}
      adresse="piece"
    />
  );
}

/**
 * LA GALERIE, EN TÊTE DE LA FICHE : TOUTES les pièces de la demande et de ses
 * commentaires. Une image s'ouvre dans la VISIONNEUSE, avec ses flèches ;
 * lecteur pour les vidéos, icône et lien de téléchargement pour le reste.
 */
export function Galerie({
  pieces,
  sansTitre,
}: {
  pieces: { id: string; nom: string; mime: string; taille: number; genre: GenrePiece; apercuSeconde?: number }[];
  /** Posée dans un bloc qui porte DÉJÀ son titre : elle ne le redit pas. */
  sansTitre?: boolean;
}) {
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const [vue, setVue] = React.useState<number | null>(null);
  const images = pieces.filter((piece) => piece.genre === 'image');
  if (!pieces.length) return null;
  return (
    <div data-galerie={pieces.length}>
      {sansTitre ? null : (
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          {t('Pièces jointes')} · {pieces.length}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {pieces.map((piece) => (
          <button
            key={piece.id}
            type="button"
            onClick={() =>
              piece.genre === 'image'
                ? setVue(images.findIndex((image) => image.id === piece.id))
                : setOuverte(ouverte === piece.id ? null : piece.id)
            }
            className="group relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-surface text-left"
            data-piece={piece.nom}
            data-genre={piece.genre}
          >
            {piece.genre === 'image' ? (
              <img src={`/api/attachment?id=${piece.id}`} alt={piece.nom} className="h-full w-full object-cover" />
            ) : piece.genre === 'video' ? (
              /* LA MÊME RÈGLE D'APERÇU QUE LE LECTEUR : cette vignette montrait
                 la première image du fichier, donc un carré noir une fois sur
                 deux — et elle ne montre QUE ça. */
              <VignetteVideo
                id={piece.id}
                nom={piece.nom}
                seconde={piece.apercuSeconde}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center">
                <IconeDeGenre genre={piece.genre} className="h-5 w-5 text-muted" />
                <span className="w-full truncate text-[11px] text-muted">{piece.nom}</span>
              </div>
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-bg/70 px-1.5 py-0.5 text-[10px] text-muted">
              {poidsEnClair(piece.taille)}
            </span>
          </button>
        ))}
      </div>
      {ouverte ? (
        <div className="mt-3 overflow-hidden rounded-lg bg-surface p-2" data-piece-ouverte={ouverte}>
          {(() => {
            const piece = pieces.find((p) => p.id === ouverte)!;
            if (piece.genre === 'image') {
              return <img src={`/api/attachment?id=${piece.id}`} alt={piece.nom} className="max-h-[50vh] w-auto" />;
            }
            if (piece.genre === 'video') {
              return <LecteurVideo id={piece.id} nom={piece.nom} apercu={{ seconde: piece.apercuSeconde }} />;
            }
            return (
              <a
                href={`/api/attachment?id=${piece.id}&download=1`}
                className="inline-flex items-center gap-2 text-sm text-text underline"
              >
                <IconeDeGenre genre={piece.genre} className="h-4 w-4" />
                {t('Télécharger')} — {piece.nom}
              </a>
            );
          })()}
        </div>
      ) : null}
      <Visionneuse images={images} index={vue} onIndex={setVue} onFermer={() => setVue(null)} />
    </div>
  );
}


/**
 * LES PIÈCES D'UN MESSAGE, RENDUES D'UNE SEULE FAÇON DANS LES DEUX FILS.
 *
 * Le fil d'une demande et la discussion flottante posaient chacun leur propre
 * suite de vignettes : l'un montrait les images en grand, l'autre en petit, et
 * aucun des deux ne lisait une vidéo autrement qu'avec le lecteur brut du
 * navigateur. Ce composant est désormais le seul rendu — grille d'images à
 * compteur, lecteur vidéo maison, pastille pour tout le reste.
 *
 * `onOuvrirImage` reçoit le rang de l'image DANS LA LISTE COMPLÈTE du fil, pas
 * dans celle du message : c'est cette liste que la visionneuse parcourt aux
 * flèches, et sauter d'un message à l'autre doit y fonctionner.
 */
export function PiecesDuMessage({
  fichiers,
  pieces,
  images,
  onOuvrirImage,
  repere,
}: {
  fichiers: readonly string[];
  /** Le catalogue du fil : nom, poids et genre de chaque pièce. */
  pieces: { id: string; nom: string; mime: string; taille: number; genre: GenrePiece; apercuSeconde?: number }[];
  /** Toutes les images du fil, dans l'ordre où la visionneuse les parcourt. */
  images: { id: string }[];
  onOuvrirImage: (rang: number) => void;
  repere: string;
}) {
  if (!fichiers.length) return null;
  const connues = fichiers.map((id) => pieces.find((piece) => piece.id === id) ?? { id, nom: id, mime: '', taille: 0, genre: 'fichier' as GenrePiece });
  const imagesDuMessage = connues.filter((piece) => piece.genre === 'image');
  const videos = connues.filter((piece) => piece.genre === 'video');
  const autres = connues.filter((piece) => piece.genre !== 'image' && piece.genre !== 'video');

  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-pieces-message={repere}>
      <GrilleDImages
        images={imagesDuMessage}
        onOuvrir={(rang) => {
          const visee = imagesDuMessage[rang];
          if (!visee) return;
          onOuvrirImage(images.findIndex((image) => image.id === visee.id));
        }}
      />
      {videos.map((piece) => (
        <LecteurVideo key={piece.id} id={piece.id} nom={piece.nom} apercu={{ seconde: piece.apercuSeconde }} />
      ))}
      {autres.length ? (
        <div className="flex flex-wrap gap-1.5">
          {autres.map((piece) => (
            <PastilleDeFichier key={piece.id} id={piece.id} nom={piece.nom} mime={piece.mime} poids={piece.taille} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
