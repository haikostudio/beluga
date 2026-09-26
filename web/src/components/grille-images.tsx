/**
 * PLUSIEURS IMAGES ENVOYÉES ENSEMBLE : UNE GRILLE, FAÇON MESSAGERIE.
 *
 * Six captures collées dans un message s'affichaient l'une après l'autre, en
 * vignettes qui poussaient le fil sur trois écrans. Elles se rangent désormais
 * en GRILLE COMPACTE — une, deux, trois ou quatre tuiles selon le nombre — et,
 * au-delà de quatre, la dernière tuile porte en son centre le nombre d'images
 * qui restent. Un clic ouvre la visionneuse à l'image visée.
 *
 * CE COMPOSANT N'OUVRE RIEN LUI-MÊME : il rend le RANG de l'image cliquée, et
 * celui qui l'emploie décide de la visionneuse à ouvrir. C'est ce qui lui
 * permet de servir les deux espaces sans en embarquer une seconde.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { ImageDePiece } from '@/components/pastille-de-fichier';

/** Au-delà de ce nombre, la dernière tuile porte le compte de ce qui reste. */
const TUILES_MAX = 4;

export function GrilleDImages({
  images,
  onOuvrir,
  className,
}: {
  images: { id: string; nom: string }[];
  /** Le rang de l'image cliquée, dans la liste donnée. */
  onOuvrir: (rang: number) => void;
  className?: string;
}) {
  if (!images.length) return null;
  const montrees = images.slice(0, TUILES_MAX);
  const restantes = images.length - montrees.length;

  /*
   * LA FORME SUIT LE NOMBRE. Une image seule garde sa taille et son cadrage ;
   * deux se posent côte à côte ; trois et quatre remplissent une grille de
   * deux colonnes, la troisième prenant toute la largeur quand elles sont
   * trois — c'est ce qui évite le trou à côté d'une tuile orpheline.
   */
  const seule = images.length === 1;

  return (
    <div
      className={cn('grid w-full max-w-[320px] gap-0.5 overflow-hidden rounded-lg', seule ? null : 'grid-cols-2', className)}
      data-grille-images={images.length}
    >
      {montrees.map((image, rang) => {
        const derniere = rang === montrees.length - 1;
        const pleineLargeur = images.length === 3 && derniere;
        return (
          <button
            key={image.id}
            type="button"
            onClick={() => onOuvrir(rang)}
            className={cn(
              'relative block overflow-hidden bg-raised',
              seule ? 'max-h-[260px]' : 'aspect-square',
              pleineLargeur && 'col-span-2 aspect-[2/1]',
            )}
            data-image-tuile={image.id}
            aria-label={image.nom}
          >
            <ImageDePiece
              id={image.id}
              alt={image.nom}
              className={cn('h-full w-full', seule ? 'max-h-[260px] object-contain' : 'object-cover')}
            />
            {/* LE COMPTE DE CE QUI DÉBORDE, AU CENTRE DE LA DERNIÈRE TUILE. */}
            {derniere && restantes > 0 ? (
              <span
                className="absolute inset-0 flex items-center justify-center bg-voile/55 text-[18px] font-semibold text-sur-etat"
                data-images-restantes={restantes}
              >
                +{restantes}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
