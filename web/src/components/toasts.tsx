/**
 * LES MESSAGES D'INFORMATION DE L'ADMINISTRATION : le MAGASIN, rien d'autre.
 *
 * Le dessin de la pile — la place en HAUT AU CENTRE, l'empilement, la barre de
 * temps, le balayage vers la gauche, le message persistant qui ne se ferme
 * pas — vit désormais dans `messages-passagers.tsx`, SANS magasin. C'est ce
 * qui permet à l'espace client, qui ne monte rien d'ici, d'afficher exactement
 * la même pile au même endroit au lieu d'en écrire une seconde dans son coin.
 *
 * Ce fichier ne fait donc plus que brancher le magasin sur ce dessin.
 */
import * as React from 'react';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { PileDeMessages } from './messages-passagers';

export function Toasts() {
  const state = useApp();

  const fermer = React.useCallback((id: string) => client.dismissToast(id), []);
  const pause = React.useCallback(() => client.pauseToasts(), []);
  const reprendre = React.useCallback(() => client.resumeToasts(), []);
  const reconnecter = React.useCallback(() => client.reconnecterMaintenant(), []);

  return (
    <PileDeMessages
      messages={state.toasts}
      onFermer={fermer}
      onPause={pause}
      onReprendre={reprendre}
      onReconnecter={reconnecter}
    />
  );
}
