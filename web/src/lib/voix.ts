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
 * On réutilise la voix du serveur par une adresse audio ordinaire
 * (`/api/speak`) — le moteur employé se décide là-bas, d'après la voix
 * choisie ; si le serveur n'a pas de voix, on retombe sur celle du navigateur.
 * Aucun réglage de
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
  /**
   * Où en est la lecture : une fraction de 0 à 1 quand la durée est connue (voix
   * Piper), « indetermine » quand elle ne l'est pas (voix de secours du
   * navigateur, qui ne dit pas où elle en est), `null` quand rien ne se lit ou
   * qu'on attend encore la durée. Sert à la barre de lecture du module de voix.
   */
  avancement: number | 'indetermine' | null;
}

let audio: HTMLAudioElement | null = null;
let etat: EtatVoix = { parle: false, cle: null, avancement: null };
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
  if (etat.parle || etat.cle !== null || etat.avancement !== null) {
    publier({ parle: false, cle: null, avancement: null });
  }
}

/**
 * Prononce un texte. Arrête d'abord toute parole en cours. `cle` identifie la
 * source (un message de la conversation, par exemple) ; laissée à `null` pour
 * une annonce automatique. En cas de panne du serveur audio, on tente la voix
 * du navigateur. L'avancement de la lecture est publié au fil du son, pour la
 * barre de lecture du module de voix.
 */
export function direVoix(texte: string, cle: string | null = null): void {
  if (!texte) return;
  taireVoix();
  const element = new Audio(`/api/speak?text=${encodeURIComponent(texte)}`);
  audio = element;
  // Le message est marqué « en lecture » tout de suite ; on n'affiche un
  // avancement chiffré qu'une fois la vraie durée connue.
  publier({ parle: true, cle, avancement: null });

  // Un écouteur ne touche à l'état que s'il sert TOUJOURS la lecture en cours :
  // une parole finie ne doit pas clôturer celle qui l'a remplacée.
  const estCourant = () => audio === element;
  const dureeConnue = () => Number.isFinite(element.duration) && element.duration > 0;
  const fin = () => {
    if (estCourant()) {
      audio = null;
      publier({ parle: false, cle: null, avancement: null });
    }
  };
  element.addEventListener('loadedmetadata', () => {
    if (estCourant() && dureeConnue()) publier({ parle: true, cle, avancement: 0 });
  });
  element.addEventListener('timeupdate', () => {
    if (estCourant() && dureeConnue()) {
      publier({ parle: true, cle, avancement: Math.min(1, element.currentTime / element.duration) });
    }
  });
  element.addEventListener('ended', fin);

  // Le repli sur la voix du navigateur, une seule fois : l'erreur de l'élément
  // audio ET le rejet de `play()` peuvent survenir tous deux. Son avancement est
  // inconnu : on garde le message marqué « en lecture » sans mentir sur une
  // position (la barre pulsera au lieu d'avancer).
  let repliLance = false;
  const repli = () => {
    if (!estCourant() || repliLance) return;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      repliLance = true;
      publier({ parle: true, cle, avancement: 'indetermine' });
      const parole = new SpeechSynthesisUtterance(texte);
      parole.lang = 'fr-FR';
      parole.onend = fin;
      parole.onerror = fin;
      window.speechSynthesis.speak(parole);
    } else {
      fin();
    }
  };
  element.addEventListener('error', repli);
  void element.play().catch(repli);
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
