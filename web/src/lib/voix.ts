import * as React from 'react';

/**
 * LA VOIX PARTAGÉE — un seul son à la fois, d'où qu'il vienne.
 *
 * L'assistant parle tout seul aux moments clés (module de voix), et l'on peut
 * demander à écouter n'importe quel message de la conversation. Ces deux paroles
 * ne doivent JAMAIS se chevaucher : elles passent donc par le MÊME lecteur, ici.
 * Une nouvelle lecture arrête la précédente, quelle qu'en soit l'origine —
 * « une parole chasse l'autre ».
 *
 * On réutilise Piper par une adresse audio ordinaire (`/api/speak`) ; si le
 * serveur n'a pas de voix, on retombe sur celle du navigateur. Aucun réglage de
 * son propre ici : le Muet se décide chez l'appelant (l'annonce automatique le
 * respecte, la lecture manuelle passe outre) — quand on arrive jusqu'ici, c'est
 * qu'on veut parler.
 */

/** L'état visible de la voix : parle-t-elle, et pour quel élément ? */
export interface EtatVoix {
  /** Vrai tant qu'un son est en cours. */
  parle: boolean;
  /**
   * Ce qui est lu à l'instant : l'identifiant passé à `direVoix`, ou `null` pour
   * une annonce automatique sans clé. Sert au bouton d'un message à savoir si
   * c'est LUI qui parle (donc à basculer entre écouter et arrêter).
   */
  cle: string | null;
}

let audio: HTMLAudioElement | null = null;
let etat: EtatVoix = { parle: false, cle: null };
const ecouteurs = new Set<() => void>();

function publier(suivant: EtatVoix): void {
  etat = suivant;
  for (const prevenir of ecouteurs) prevenir();
}

/** Coupe net ce qui parle, sans rien relancer. */
export function taireVoix(): void {
  try {
    audio?.pause();
  } catch {
    /* l'audio était déjà arrêté */
  }
  audio = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (etat.parle || etat.cle !== null) publier({ parle: false, cle: null });
}

/**
 * Prononce un texte. Arrête d'abord toute parole en cours. `cle` identifie la
 * source (un message de la conversation, par exemple) ; laissée à `null` pour
 * une annonce automatique. En cas de panne du serveur audio, on tente la voix
 * du navigateur.
 */
export function direVoix(texte: string, cle: string | null = null): void {
  if (!texte) return;
  taireVoix();
  const element = new Audio(`/api/speak?text=${encodeURIComponent(texte)}`);
  audio = element;
  publier({ parle: true, cle });

  const fin = () => {
    if (audio === element) {
      audio = null;
      publier({ parle: false, cle: null });
    }
  };
  element.addEventListener('ended', fin);
  element.addEventListener('error', () => {
    fin();
    // Repli : la voix du navigateur, si le serveur n'a pas de moteur Piper.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const parole = new SpeechSynthesisUtterance(texte);
      parole.lang = 'fr-FR';
      window.speechSynthesis.speak(parole);
    }
  });
  void element.play().catch(fin);
}

/** L'état de la voix, réactif : le composant se redessine à chaque changement. */
export function useVoix(): EtatVoix {
  return React.useSyncExternalStore(
    (prevenir) => {
      ecouteurs.add(prevenir);
      return () => ecouteurs.delete(prevenir);
    },
    () => etat,
    () => etat,
  );
}
