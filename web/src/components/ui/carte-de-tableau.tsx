import * as React from 'react';
import { CelluleProjet, type ProjetDeLigne } from '@/components/ui/colonne-projet';
import { cn } from '@/lib/utils';

/**
 * LA CARTE D'UNE LIGNE DE TABLEAU, LA MÊME POUR LES DIX SERVICES (carte « Services homogènes et centrés », 14/11/2026 :
 * « des tableaux qui se transforment en cartes, partout » ; les cartes d'une grille ont TOUTES la même structure, donc
 * la même taille). Elle se pose dans la prop `grille` du tableau commun, qui garde recherche, tri, filtres et pages.
 *
 * Toujours dans le même ordre, et chaque rubrique garde sa place même vide : l'image (facultative pour tout un
 * service, jamais pour une seule carte), le projet et l'état sur une ligne, le titre en entier (il passe à la ligne, jamais coupé — 16/11/2026), la description sur
 * DEUX lignes réservées, puis trois chiffres au plus, collés en bas.
 */
export function CarteDeTableau({
  image,
  projet,
  etat,
  titre,
  texte,
  chiffres,
  bas,
  ...attributs
}: {
  /** L'image en tête (affiche, vignette, courbe) ; `null` garde sa place vide, `undefined` : ce service n'en a pas. */
  image?: React.ReactNode;
  projet?: ProjetDeLigne | null;
  etat?: React.ReactNode;
  titre: React.ReactNode;
  texte?: React.ReactNode;
  chiffres?: { libelle: string; valeur: React.ReactNode }[];
  /** Une rangée sous les chiffres (un geste de la ligne). */
  bas?: React.ReactNode;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <div className="flex h-full min-w-0 flex-col" data-carte-de-tableau {...attributs}>
      {image !== undefined ? (
        <div className="relative flex aspect-[16/9] shrink-0 items-center justify-center overflow-hidden bg-raised" data-carte-image>
          {image}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        <div className="flex h-5 min-w-0 items-center justify-between gap-2 text-[12px]" data-carte-tete>
          <span className="min-w-0 flex-1">{projet ? <CelluleProjet id={projet.id ?? null} nom={projet.nom ?? null} /> : null}</span>
          {etat ? <span className="flex shrink-0 items-center">{etat}</span> : null}
        </div>
        <p className="text-[14px] font-semibold leading-5 text-text [overflow-wrap:anywhere]" data-carte-titre>
          {titre}
        </p>
        <p className="line-clamp-2 h-[2.5rem] text-[12.5px] leading-5 text-muted" data-carte-texte>
          {texte ?? ''}
        </p>
        {chiffres?.length ? (
          <dl className={cn('mt-auto grid gap-2 pt-2', chiffres.length >= 3 ? 'grid-cols-3' : chiffres.length === 2 ? 'grid-cols-2' : 'grid-cols-1')} data-carte-chiffres>
            {chiffres.slice(0, 3).map((c) => (
              <div key={c.libelle} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-[11.5px] leading-4 text-faint [overflow-wrap:anywhere]">{c.libelle}</dt>
                <dd className="text-[13px] font-medium leading-5 tabular-nums text-text [overflow-wrap:anywhere]">{c.valeur}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {bas ? <div className="flex min-w-0 items-center gap-2 pt-2" data-carte-bas>{bas}</div> : null}
      </div>
    </div>
  );
}
