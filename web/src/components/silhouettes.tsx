/*
 * LES SILHOUETTES DE CONTENU (skeletons) — ce qu'on montre PENDANT que les
 * données arrivent, à la place d'un écran vide.
 *
 * Au démarrage, l'application connaît sa mise en page bien avant de connaître
 * ses données : la colonne de gauche, les colonnes du tableau et la
 * conversation existent déjà, seuls leurs contenus manquent. Sans rien
 * afficher, l'écran disait « Aucun projet inscrit » puis « Aucun projet
 * sélectionné » — deux phrases FAUSSES, qui annoncent un vide alors que le
 * chargement est en cours, et qui font paraître l'attente beaucoup plus longue.
 *
 * Règle tenue ici : une silhouette dessine la FORME du contenu attendu (une
 * ligne de projet, une carte, une bulle de message), au bon endroit et à la
 * bonne taille, et ne dit JAMAIS un état vide. Un état vide ne s'affiche
 * qu'une fois les données réellement reçues.
 */
import * as React from 'react';
import { COLUMN_KEYS, COLUMN_LABELS } from '@haikodev/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * La brique de base : un bloc gris qui respire. Elle emprunte la couleur des
 * bordures du thème — donc elle suit le mode sombre comme le mode clair sans
 * qu'aucune teinte ne soit écrite en dur.
 */
export function Silhouette({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-silhouette rounded bg-border', className)} />;
}

/**
 * Le conteneur d'un bloc de silhouettes. Il porte le rôle d'attente pour les
 * lecteurs d'écran (`aria-busy`) et un repère d'essai commun, `data-silhouette`,
 * que les scripts de vérification interrogent.
 */
function Bloc({
  zone,
  className,
  children,
}: {
  zone: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-silhouette={zone} role="status" aria-busy="true" aria-label="Chargement en cours" className={className}>
      <span className="sr-only">{t('Chargement en cours…')}</span>
      {children}
    </div>
  );
}

/** Des largeurs qui varient : des barres toutes égales ne ressemblent à rien. */
const LARGEURS = ['w-[72%]', 'w-[54%]', 'w-[83%]', 'w-[61%]', 'w-[76%]', 'w-[48%]'];

/* ------------------------------------------------------------------ */
/* La colonne de gauche : des lignes de projet                        */
/* ------------------------------------------------------------------ */

export function SilhouetteProjets({ lignes = 5 }: { lignes?: number }) {
  return (
    <Bloc zone="projets" className="px-1 py-1">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5">
          <Silhouette className="h-3.5 w-3.5 shrink-0 rounded-sm" />
          <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
        </div>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Le tableau : sept colonnes, quelques cartes dans chacune            */
/* ------------------------------------------------------------------ */

/** Une carte en silhouette : un titre sur deux lignes et deux étiquettes. */
function SilhouetteCarte({ variante }: { variante: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-raised/60 p-2">
      <Silhouette className={cn('h-3', LARGEURS[variante % LARGEURS.length])} />
      {variante % 3 !== 2 ? <Silhouette className="mt-1.5 h-3 w-[42%]" /> : null}
      <div className="mt-2 flex gap-1.5">
        <Silhouette className="h-2.5 w-10 rounded-full" />
        <Silhouette className="h-2.5 w-14 rounded-full" />
      </div>
    </div>
  );
}

/**
 * Combien de cartes montrer par colonne. Les colonnes de travail en portent
 * quelques-unes, celles de fin une seule : on ne promet pas un tableau plein
 * là où il est presque toujours vide.
 */
const CARTES_PAR_COLONNE: Record<string, number> = {
  notes: 2,
  planned: 3,
  running: 2,
  done: 3,
  to_deploy: 1,
  in_production: 1,
  archived: 1,
};

export function SilhouetteTableau() {
  return (
    <Bloc zone="tableau" className="flex min-h-0 flex-1 gap-2.5 overflow-hidden px-3 py-3">
      {COLUMN_KEYS.map((column, rang) => (
        <div
          key={column}
          className="flex h-full min-h-0 w-[268px] shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-surface/70"
        >
          {/* La tête de colonne garde son VRAI libellé : la mise en page est
              connue d'avance, seul son contenu manque. */}
          <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-faint">{t(COLUMN_LABELS[column])}</h2>
            <Silhouette className="h-2.5 w-3 rounded-sm" />
          </div>
          <div className="flex flex-col gap-1.5 px-1.5 pb-2">
            {Array.from({ length: CARTES_PAR_COLONNE[column] ?? 2 }, (_, index) => (
              <SilhouetteCarte key={index} variante={rang + index} />
            ))}
          </div>
        </div>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* La conversation : quelques bulles alternées                         */
/* ------------------------------------------------------------------ */

export function SilhouetteConversation({ bulles = 4 }: { bulles?: number }) {
  return (
    <Bloc zone="conversation" className="flex flex-col gap-3 p-3">
      {Array.from({ length: bulles }, (_, index) => {
        const aDroite = index % 2 === 1;
        return (
          <div key={index} className={cn('flex', aDroite ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'flex w-[78%] flex-col gap-1.5 rounded-lg p-2.5',
                aDroite ? 'items-end bg-surface' : 'bg-transparent',
              )}
            >
              <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
              <Silhouette className="h-3 w-[90%]" />
              {aDroite ? null : <Silhouette className="h-3 w-[65%]" />}
            </div>
          </div>
        );
      })}
    </Bloc>
  );
}
