/*
 * LE PROJET D'UN OUTIL OUVERT EN ONGLET (refonte du 13/11/2026).
 *
 * Dans un projet, chaque outil (Backup, Surveillance, Studio…) s'ouvre dans un onglet et ne montre QUE ce projet :
 * l'application pose ici le projet de l'onglet, chaque outil le lit (`useProjetDuService`) pour filtrer ce qu'il
 * affiche. Hors d'un projet (téléphone, tableaux de bord), le contexte est vide et l'outil montre tout, comme avant.
 *
 * Un outil vide pour ce projet le DIT et propose de commencer (`EtatVideDuProjet`, maquettes #828a, #4e4f, #6748) :
 * une icône, « Aucune sauvegarde pour ProjetB », une phrase, et le bouton qui crée.
 */
import * as React from 'react';
import { Loader2, Plus } from '@/components/ui/icones';
import type { Project } from '@beluga/shared';
import { cn } from '@/lib/utils';

export type ProjetDuService = Pick<Project, 'id' | 'name' | 'path'>;
const Contexte = React.createContext<ProjetDuService | null>(null);
export const FournirLeProjetDuService = Contexte.Provider;
export const useProjetDuService = () => React.useContext(Contexte);
/**
 * LE PROJET VIENT DU FILTRE « TOUS LES PROJETS » D'UNE PAGE DE SERVICE (carte « Services homogènes et centrés ») :
 * le service FILTRE sa liste sur place — il ne s'enferme pas dans le projet comme quand on l'ouvre depuis un projet.
 */
const FiltreCentral = React.createContext(false);
export const FournirLeFiltreCentral = FiltreCentral.Provider;
export const useFiltreCentral = () => React.useContext(FiltreCentral);

export function EtatVideDuProjet({
  icone,
  titre,
  texte,
  action,
  onAction,
  actionSecondaire,
  onActionSecondaire,
  enCours = false,
  note,
  className,
  ...reperes
}: {
  icone: React.ReactNode;
  titre: string;
  texte: string;
  /** Le libellé du bouton qui crée (« Créer une sauvegarde »). */
  action?: string;
  onAction?: () => void;
  /** Un second geste, plus discret, à côté du bouton qui crée (« Voir tous les projets »). */
  actionSecondaire?: string;
  onActionSecondaire?: () => void;
  enCours?: boolean;
  /** Une ligne discrète sous le bouton (« 8 tâches récurrentes terminées »). */
  note?: React.ReactNode;
  className?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div className={cn('flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 py-10 text-center', className)} data-etat-vide-du-projet {...reperes}>
      <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-surface text-muted [&_svg]:h-6 [&_svg]:w-6">{icone}</div>
      <h2 className="mb-2 text-[17px] font-semibold text-text">{titre}</h2>
      <p className="mb-5 max-w-[420px] text-[14px] leading-relaxed text-muted">{texte}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
      {action && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={enCours}
          aria-busy={enCours || undefined}
          className="flex h-[38px] items-center gap-2 rounded-[10px] bg-accent px-4 text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
          data-creer-depuis-l-etat-vide
        >
          {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {action}
        </button>
      ) : null}
      {actionSecondaire && onActionSecondaire ? (
        <button
          type="button"
          onClick={onActionSecondaire}
          className="flex h-[38px] items-center rounded-[10px] bg-surface px-4 text-[14px] font-medium text-text transition-colors hover:bg-raised"
          data-geste-secondaire-de-l-etat-vide
        >
          {actionSecondaire}
        </button>
      ) : null}
      </div>
      {note ? <div className="mt-3 text-[13px] text-faint">{note}</div> : null}
    </div>
  );
}
