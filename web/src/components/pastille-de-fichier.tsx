/**
 * LA PASTILLE D'UN FICHIER — UNE SEULE PIÈCE POUR TOUTE L'APPLICATION.
 *
 * Il y avait trois rendus parallèles pour la même chose : la vignette du fil
 * d'une carte (`AttachmentThumb`), le lien souligné « Pièce jointe » de la
 * discussion de l'espace client, et un repli sans lien du tout quand le magasin
 * n'avait pas encore chargé la liste des pièces. Trois rendus, dont deux ne
 * disaient ni le nom du fichier ni son poids, et un qui ne se cliquait même pas.
 *
 * Il n'y en a plus qu'UN. La pastille porte l'icône de son GENRE, son NOM réel
 * et son POIDS, et elle se télécharge d'un CLIC sous son vrai nom — jamais sous
 * l'identifiant interne, grâce à l'attribut `download` et au
 * `content-disposition` de `/api/attachment?id=…&download=1`.
 *
 * Les images ne passent pas par là : elles s'AFFICHENT en vignette, et le clic
 * les AGRANDIT (le geste par défaut sur une image est voir, pas télécharger —
 * voir la visionneuse de l'espace client). Leur téléchargement reste à un clic,
 * par le petit bouton posé dans le coin de la vignette.
 *
 * Les repères techniques `data-lien-piece` et `data-apercu-image` voyagent avec
 * la pastille : un contrôle navigateur les lit sans rien savoir du rendu.
 */
import * as React from 'react';
import { Download, File as FileIcon, Film, ImageIcon } from 'lucide-react';
import { genreDuFichier, type GenrePiece } from '@beluga/shared';
import { bytes, cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** L'icône d'un genre de pièce — image, vidéo, ou fichier quelconque. */
export function IconeDeGenre({ genre, className }: { genre: GenrePiece; className?: string }) {
  if (genre === 'image') return <ImageIcon className={className} />;
  if (genre === 'video') return <Film className={className} />;
  return <FileIcon className={className} />;
}

/** L'adresse d'une pièce jointe : à lire sur place, ou à télécharger. */
export function adresseDePiece(id: string, telechargement?: boolean): string {
  return `/api/attachment?id=${encodeURIComponent(id)}${telechargement ? '&download=1' : ''}`;
}

/**
 * L'IMAGE D'UNE PIÈCE JOINTE, AVEC SA SILHOUETTE D'ATTENTE — UN SEUL RENDU.
 *
 * Les fichiers lourds de tous les projets vivent désormais sur le grand
 * disque, atteint par le réseau : une vignette met un instant à venir, là où
 * elle était instantanée depuis le disque du serveur. Sans rien, le cadre
 * reste vide puis l'image apparaît d'un coup.
 *
 * DEUX PRÉCAUTIONS, ET PAS UNE DE PLUS :
 *
 *  - la silhouette est posée EN ABSOLU dans le cadre de l'appelant, qui porte
 *    déjà sa taille définitive. Aucune dimension n'est recopiée ici, donc
 *    aucun saut n'est possible à l'arrivée de l'image : c'est le même cadre
 *    avant et après. L'appelant doit seulement être `relative`.
 *  - sa couleur ne suit PAS le jeton de bordure comme les autres silhouettes
 *    de l'application. Ces vignettes sont posées sur des surfaces surélevées
 *    (`bg-surface`, `bg-raised`), et en thème sombre `--surface` (8 %) et
 *    `--border` (9 %) ne diffèrent que d'un point de clarté : la silhouette y
 *    serait invisible. Un voile de `--faint` contraste dans les douze
 *    palettes, claires comme sombres.
 *
 * `loading="lazy"` ne demande la vignette qu'une fois approchée de l'écran —
 * décisif sur une grille d'images servie par le réseau — et
 * `decoding="async"` laisse la page répondre pendant le décodage.
 */
export function ImageDePiece({
  id,
  alt,
  className,
}: {
  id: string;
  alt: string;
  /** Les classes de l'image elle-même (ajustement, taille maximale…). */
  className?: string;
}) {
  const [chargee, setChargee] = React.useState(false);
  return (
    <>
      {!chargee && (
        <span aria-hidden data-silhouette-image={id} className="absolute inset-0 animate-silhouette bg-faint/25" />
      )}
      <img
        src={adresseDePiece(id)}
        alt={alt}
        loading="lazy"
        decoding="async"
        data-image-piece={id}
        data-chargee={chargee ? '1' : '0'}
        onLoad={() => setChargee(true)}
        /* Une image en erreur ne laisse pas la silhouette respirer pour
           toujours : on rend la main au cadre, vignette vide. */
        onError={() => setChargee(true)}
        className={cn('relative transition-opacity duration-200', chargee ? 'opacity-100' : 'opacity-0', className)}
      />
    </>
  );
}

export interface PastilleDeFichierProps {
  /** L'identifiant de la pièce jointe, côté serveur. */
  id: string;
  /** Le nom AFFICHÉ. Dans le fil d'une carte c'est l'étiquette « #1a0c ». */
  nom?: string;
  /**
   * LE VRAI NOM DU FICHIER, celui sous lequel il se télécharge. Il diffère du
   * nom affiché dans le fil d'une carte, où l'étiquette courte (`#1a0c`) sert
   * de repère à l'agent : le fichier enregistré doit garder « rapport.pdf ».
   */
  nomDuFichier?: string;
  /** Le type déclaré, qui choisit l'icône. */
  mime?: string;
  /** Le poids en octets, affiché en clair quand il est connu. */
  poids?: number;
  /** Dans la barre d'écriture, la pastille est plus basse. */
  compact?: boolean;
  className?: string;
}

/**
 * UN FICHIER QUELCONQUE : son icône, son nom, son poids, et le téléchargement
 * au clic. Le composant rend un VRAI lien — on peut donc l'ouvrir dans un autre
 * onglet, le copier, ou s'en servir au clavier, sans une ligne de code de plus.
 */
export function PastilleDeFichier({ id, nom, nomDuFichier, mime, poids, compact, className }: PastilleDeFichierProps) {
  const nomAffiche = nom?.trim() || t('Fichier joint');
  const aEnregistrer = nomDuFichier?.trim() || nom?.trim();
  return (
    <a
      href={adresseDePiece(id, true)}
      download={aEnregistrer || undefined}
      title={`${nomAffiche}${poids ? ` — ${bytes(poids)}` : ''}`}
      data-lien-piece={id}
      className={cn(
        'inline-flex max-w-[230px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-[13px] text-muted transition-colors hover:border-faint hover:text-text',
        compact && 'h-12 py-0 text-[12.5px]',
        className,
      )}
    >
      <IconeDeGenre genre={genreDuFichier(mime ?? '')} className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{nomAffiche}</span>
      {poids ? <span className="shrink-0 text-[11.5px] text-faint">{bytes(poids)}</span> : null}
      <Download className="h-3 w-3 shrink-0 text-faint" aria-hidden />
    </a>
  );
}

/**
 * UNE IMAGE : la vignette, qu'on AGRANDIT au clic. Le téléchargement reste à un
 * seul clic, par le bouton du coin — posé au-dessus du bouton d'agrandissement,
 * et donc atteignable au clavier comme à la souris.
 */
export function VignetteDImage({
  id,
  nom,
  nomDuFichier,
  onApercu,
  compact,
  grande,
  className,
}: {
  id: string;
  nom?: string;
  /** Le vrai nom du fichier, sous lequel l'image se télécharge. */
  nomDuFichier?: string;
  onApercu: () => void;
  compact?: boolean;
  /** La vignette large de la discussion client (h-24 w-32), au lieu du carré. */
  grande?: boolean;
  className?: string;
}) {
  const libelle = nom?.trim() || t('Fichier joint');
  return (
    <span className={cn('relative inline-block shrink-0', className)}>
      <button
        type="button"
        onClick={onApercu}
        title={libelle}
        data-apercu-image={id}
        className={cn(
          'relative block overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-faint',
          grande ? 'h-24 w-32' : compact ? 'h-12 w-12' : 'h-20 w-20',
        )}
      >
        <ImageDePiece id={id} alt={libelle} className="h-full w-full object-cover" />
      </button>
      {/* LE TÉLÉCHARGEMENT D'UNE IMAGE TIENT EN UN CLIC, LUI AUSSI. Le bouton
          reste discret — il ne se remplit qu'au survol — mais il existe toujours
          au clavier et sur un écran tactile, où il n'y a pas de survol. */}
      <a
        href={adresseDePiece(id, true)}
        download={nomDuFichier?.trim() || nom || undefined}
        onClick={(event) => event.stopPropagation()}
        title={t('Télécharger')}
        aria-label="Telecharger"
        data-lien-piece={id}
        className="absolute bottom-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-lg bg-surface/85 text-faint transition-colors hover:bg-surface hover:text-text"
      >
        <Download className="h-3 w-3" />
      </a>
    </span>
  );
}
