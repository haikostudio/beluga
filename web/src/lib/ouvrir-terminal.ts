import * as React from 'react';

/**
 * LE TERMINAL DU SERVEUR S'OUVRE DEPUIS PLUSIEURS ENDROITS, MAIS IL VIT À LA RACINE.
 *
 * Ses entrées : le ROND posé à gauche de l'assistant (ordinateur), le bouton du
 * pied du menu principal (téléphone) et la page « Serveur » des réglages. Le
 * terminal, lui, est un volet ancré en bas de l'application : ouvert depuis la
 * fenêtre des réglages, il resterait derrière elle. La racine (`app.tsx`) le
 * porte donc, referme les réglages et l'ouvre — l'entrée ne fait que le
 * demander.
 */
export const EVENEMENT_OUVRIR_TERMINAL = 'beluga:ouvrir-terminal';

export function ouvrirLeTerminal(): void {
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_TERMINAL));
}

/** Fermé, ouvert, ou réduit : dans ce dernier cas il reste attaché. */
export type EtatDuTerminal = 'ferme' | 'ouvert' | 'reduit';

export interface EtatPublieDuTerminal {
  etat: EtatDuTerminal;
  /** Réduit, quelque chose travaille dedans (de la sortie arrive). */
  actif: boolean;
}

/*
 * L'ÉTAT DU TERMINAL, LU HORS DE LA RACINE : le bouton du pied du menu (sur
 * téléphone) montre l'activité comme le rond. La racine le publie à chaque
 * changement — deux valeurs, jamais par octet reçu.
 */
let publie: EtatPublieDuTerminal = { etat: 'ferme', actif: false };
const abonnes = new Set<() => void>();

export function publierEtatDuTerminal(suivant: EtatPublieDuTerminal): void {
  if (suivant.etat === publie.etat && suivant.actif === publie.actif) return;
  publie = suivant;
  for (const abonne of abonnes) abonne();
}

function sAbonner(abonne: () => void): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

export function useEtatDuTerminal(): EtatPublieDuTerminal {
  return React.useSyncExternalStore(sAbonner, () => publie, () => publie);
}
