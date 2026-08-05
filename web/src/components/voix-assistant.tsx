import * as React from 'react';
import {
  phraseDecisionAttendue,
  phraseVocaleDeNotification,
} from '@haikodev/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';

/** La clé de préférence du bouton « Muet » (partagée avec la barre du haut). */
export const CLE_VOIX_MUETTE = 'voix.muet';

/**
 * LA VOIX D'ASSISTANT PROACTIVE (PLAN §22, mémoire n°35).
 *
 * L'application parle d'elle-même aux moments qui comptent : une tâche qui se
 * termine (motif de notification « tache-terminee ») et une décision qui se met
 * à attendre (le compte d'« attention » qui monte). On réutilise Piper par une
 * adresse audio ordinaire (`/api/speak`) ; si le serveur n'a pas de voix, on
 * retombe sur celle du navigateur. Pendant qu'elle parle, une onde sonore
 * s'affiche en bas au centre, puis s'efface au silence.
 *
 * Le bouton « Muet » de la barre du haut coupe TOUTE cette parole (jamais les
 * notifications visuelles ni le badge) ; son état est retenu en préférence.
 */
export function VoixAssistant() {
  const state = useApp();
  const [muet] = usePref<boolean>(CLE_VOIX_MUETTE, false);
  const [parle, setParle] = React.useState(false);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  // La valeur lue au fil de l'eau par les écouteurs, sans les réabonner.
  const muetRef = React.useRef(muet);

  const taire = React.useCallback(() => {
    try {
      audioRef.current?.pause();
    } catch {
      /* l'audio était déjà arrêté */
    }
    audioRef.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setParle(false);
  }, []);

  /** Prononce une phrase, sauf si le son est coupé. Une parole chasse l'autre. */
  const dire = React.useCallback((texte: string) => {
    if (muetRef.current || !texte) return;
    taire();
    const audio = new Audio(`/api/speak?text=${encodeURIComponent(texte)}`);
    audioRef.current = audio;
    setParle(true);

    const fin = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setParle(false);
      }
    };
    audio.addEventListener('ended', fin);
    audio.addEventListener('error', () => {
      fin();
      // Repli : la voix du navigateur, si le serveur n'a pas de moteur Piper.
      if (!muetRef.current && 'speechSynthesis' in window) {
        const parole = new SpeechSynthesisUtterance(texte);
        parole.lang = 'fr-FR';
        window.speechSynthesis.speak(parole);
      }
    });
    void audio.play().catch(fin);
  }, [taire]);

  // Le son coupé fait taire ce qui parle à l'instant même.
  React.useEffect(() => {
    muetRef.current = muet;
    if (muet) taire();
  }, [muet, taire]);

  // Fin de tâche : la notification déjà émise porte le titre réel de la carte.
  React.useEffect(
    () =>
      client.onNotify((event) => {
        const texte = phraseVocaleDeNotification(event.motif, event.title);
        if (texte) dire(texte);
      }),
    [dire],
  );

  /*
   * Décision attendue : on suit le TOTAL des décisions en attente, tous projets
   * confondus. On ne parle qu'à la HAUSSE — une décision de plus — jamais sur
   * le déjà-là du chargement ni quand une décision est traitée. La décision
   * passe par ce compte et non par la notification, sinon on l'entendrait deux
   * fois.
   */
  const totalDecisions = Object.values(state.attention).reduce((somme, n) => somme + n, 0);
  const precedent = React.useRef<number | null>(null);
  React.useEffect(() => {
    const avant = precedent.current;
    precedent.current = totalDecisions;
    if (avant === null) return;
    if (totalDecisions > avant) dire(phraseDecisionAttendue(totalDecisions - avant));
  }, [totalDecisions, dire]);

  // À la fermeture, on ne laisse pas un son continuer dans le vide.
  React.useEffect(() => taire, [taire]);

  if (!parle) return null;

  return (
    <div
      data-onde-vocale
      aria-label="L’assistant parle"
      className="pointer-events-none fixed bottom-20 left-1/2 z-30 -translate-x-1/2 animate-fade-in sm:bottom-6"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-end gap-1 rounded-full border border-border bg-surface/90 px-3 py-2 shadow-lg backdrop-blur">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-4 w-1 origin-bottom rounded-full bg-accent animate-onde"
            // Chaque barre décalée : l'onde ondule au lieu de battre d'un bloc.
            style={{ animationDelay: `${i * 110}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
