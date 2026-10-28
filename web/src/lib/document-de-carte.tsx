import * as React from 'react';

/**
 * LE DOCUMENT OUVERT À CÔTÉ DE LA CONVERSATION D'UNE CARTE (carte du
 * 23/10/2026 : « comme Claude Desktop »). Le plan ne se déroule plus en entier
 * dans le fil : le fil porte un ENCART (« Plan v2 prêt — rien n'est lancé »),
 * et un clic ouvre le plan dans un PANNEAU À DROITE sur ordinateur, en PAGE
 * sur téléphone — retour par la flèche de la barre d'en-tête, comme l'aperçu.
 *
 * Un seul document ouvert à la fois, toutes cartes confondues : ouvrir une
 * autre carte ne le montre pas, puisqu'il est rangé avec l'identifiant de la
 * sienne.
 *
 * LE CONTENU EST RENDU PAR LE FIL LUI-MÊME, par un portail vers
 * l'EMPLACEMENT que la page de la carte pose à droite
 * (`ContexteEmplacementDuDocument`) : le plan garde ainsi tout ce que son
 * passage lui donne (version, agent, tour en cours) sans le recopier ici.
 */
export type DocumentDeCarte =
  | {
      cardId: string;
      genre: 'plan';
      /** Le numéro de la version du plan ouverte. */
      numero: number;
    }
  /**
   * LE VOLET DE SUIVI d'une production du studio créatif (mode caméra,
   * `volet-de-suivi.tsx`).
   */
  | { cardId: string; genre: 'suivi'; numero: number }
  /* Le montage vidéo d'une création de média : l'éditeur du Studio a été retiré, aucun volet ne l'affiche pour l'instant. */
  | { cardId: string; genre: 'montage' }
  /**
   * LES STUDIOS ET LA PAGE DE FIN D'UNE CRÉATION DE MÉDIA (26/10/2026) : le
   * studio photo (cadrage, couleurs), le studio son (pistes, coupes, fondus) et
   * la page Téléchargement (finaux, validés, esquisses). Rendus par la page de
   * la carte, dans le même volet que le montage.
   */
  | { cardId: string; genre: 'studio-photo'; source?: string }
  | { cardId: string; genre: 'studio-son' }
  | { cardId: string; genre: 'telechargement' };

let ouvert: DocumentDeCarte | null = null;
const abonnes = new Set<() => void>();

function prevenir() {
  for (const abonne of abonnes) abonne();
}

export function ouvrirLeDocument(document: DocumentDeCarte): void {
  ouvert = document;
  prevenir();
}

/**
 * LE SUIVI D'UNE PRODUCTION S'OUVRE DE LUI-MÊME SUR ORDINATEUR, SAUF SUR UNE
 * CARTE OÙ ON L'A FERMÉ (décision du 28/10/2026, qui remplace « toujours
 * ouvert, sans croix » du 25/10/2026) : dès que le chemin du tournage paraît,
 * rechargement compris, tant que sa croix ou le bouton « Suivi » ne l'a pas
 * fermé pour cette carte (`suivi-de-carte.ts`). Il ne chasse jamais un document
 * déjà ouvert pour la carte (le plan) et revient dès que celui-ci se referme
 * (`card-panel.tsx`).
 */
export function ouvrirLeSuiviSiRienNestOuvert(cardId: string): void {
  if (ouvert?.cardId === cardId) return;
  ouvrirLeDocument({ cardId, genre: 'suivi', numero: 0 });
}

export function fermerLeDocument(): void {
  if (!ouvert) return;
  ouvert = null;
  prevenir();
}

function abonner(abonne: () => void) {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

/** Le document ouvert pour CETTE carte, ou rien. */
export function useDocumentDeCarte(cardId: string | undefined): DocumentDeCarte | null {
  const courant = React.useSyncExternalStore(
    abonner,
    () => ouvert,
    () => null,
  );
  return courant && cardId && courant.cardId === cardId ? courant : null;
}

/** L'emplacement, à droite de la conversation, où le fil rend le document ouvert. */
export const ContexteEmplacementDuDocument = React.createContext<HTMLElement | null>(null);
