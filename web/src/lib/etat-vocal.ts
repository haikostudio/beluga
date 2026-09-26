import * as React from 'react';

/**
 * L'ÉCOUTE PERMANENTE et LE MODE CONVERSATION VOCALE, PARTAGÉS entre
 * `VoixAssistant` (qui les fait vraiment tourner) et la section « Voix » de
 * Réglages (qui les affiche depuis que le rond du menu du bas a cédé sa
 * place au bouton Robo). Volontairement NON persistés — ni en préférence
 * serveur, ni en stockage du navigateur — pour garder la règle d'origine :
 * le micro ne s'ouvre jamais sans un geste fait DANS la page, à l'instant
 * même. Même patron que `lib/voix.ts` : un module top-level, un ensemble
 * d'écouteurs, `useSyncExternalStore`.
 */

interface EtatVocal {
  ecouteAllumee: boolean;
  conversationAllumee: boolean;
}

let etat: EtatVocal = { ecouteAllumee: false, conversationAllumee: false };
const ecouteurs = new Set<() => void>();

function publier(): void {
  for (const prevenir of ecouteurs) prevenir();
}

export function setEcouteAllumeeGlobale(valeur: boolean): void {
  if (etat.ecouteAllumee === valeur) return;
  etat = { ...etat, ecouteAllumee: valeur };
  publier();
}

export function setConversationAllumeeGlobale(valeur: boolean): void {
  if (etat.conversationAllumee === valeur) return;
  etat = { ...etat, conversationAllumee: valeur };
  publier();
}

function abonner(prevenir: () => void): () => void {
  ecouteurs.add(prevenir);
  return () => ecouteurs.delete(prevenir);
}

function lireEtat(): EtatVocal {
  return etat;
}

export function useEtatVocalGlobal(): EtatVocal {
  return React.useSyncExternalStore(abonner, lireEtat, lireEtat);
}
