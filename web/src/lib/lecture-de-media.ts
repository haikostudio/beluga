import * as React from 'react';
import { adresseDePiece } from '@/components/pastille-de-fichier';

/**
 * UN SEUL SON À LA FOIS, SUR TOUTE LA PAGE (bouton lecture des choix d'une
 * question). Lancer un son coupe le précédent : deux voix à comparer jouées
 * en même temps ne se comparent plus. L'élément audio est unique et partagé ;
 * chaque bouton lit l'état (`useLectureDeSon`) pour savoir s'il joue, charge
 * ou se tait. Le chargement se voit : les pièces vivent sur le disque de
 * stockage monté, et un premier son peut mettre une seconde à venir.
 */
export type EtatDeSon = 'arret' | 'chargement' | 'lecture';

let audio: HTMLAudioElement | null = null;
let courant: string | null = null;
let etat: EtatDeSon = 'arret';
const abonnes = new Set<() => void>();

function changer(id: string | null, suivant: EtatDeSon) {
  courant = id;
  etat = suivant;
  abonnes.forEach((f) => f());
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('playing', () => changer(courant, 'lecture'));
  audio.addEventListener('waiting', () => changer(courant, 'chargement'));
  audio.addEventListener('pause', () => changer(courant, 'arret'));
  audio.addEventListener('ended', () => changer(null, 'arret'));
  audio.addEventListener('error', () => changer(null, 'arret'));
  return audio;
}

/** Lecture ou pause de ce son ; un autre son en cours s'arrête. */
export function basculerSon(id: string) {
  const a = element();
  if (courant === id && etat !== 'arret') {
    a.pause();
    return;
  }
  if (courant !== id) {
    a.pause();
    a.src = adresseDePiece(id);
  }
  changer(id, 'chargement');
  a.play().catch(() => changer(null, 'arret'));
}

/** Arrête le son en cours, quel qu'il soit (vidéo ouverte en grand). */
export function arreterLeSon() {
  audio?.pause();
}

export function useLectureDeSon(id: string): EtatDeSon {
  return React.useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => (courant === id ? etat : 'arret'),
    () => 'arret',
  );
}
