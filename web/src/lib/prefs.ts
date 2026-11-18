import * as React from 'react';
import { listeAvecOuSans, listeBasculee, peutEcrireLaColonne } from '@beluga/shared';
import { client } from './client';
import { useApp } from './use-app';

/**
 * Les réglages d'affichage vivent EN BASE, jamais dans le navigateur : on
 * retrouve la même mise en page sur l'ordinateur et sur le téléphone, et rien
 * ne se perd en vidant un cache.
 */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const state = useApp();
  const stored = state.prefs[key];
  const value = (stored === undefined ? fallback : stored) as T;

  const set = React.useCallback(
    (next: T) => {
      // L'écran suit immédiatement, le serveur confirme ensuite.
      client.setPrefLocally(key, next);
      client.send({ type: 'prefs.set', key, value: next });
    },
    [key],
  );

  return [value, set];
}

/** Lecture ponctuelle, hors composant. */
export function readPref<T>(key: string, fallback: T): T {
  const stored = client.lireEtat().prefs[key];
  return (stored === undefined ? fallback : stored) as T;
}

export function writePref(key: string, value: unknown): void {
  client.setPrefLocally(key, value);
  client.send({ type: 'prefs.set', key, value });
}

/**
 * UNE LISTE DE LA COLONNE DE GAUCHE (groupes repliés, projets dépliés…) se modifie
 * depuis la DERNIÈRE valeur connue, jamais depuis celle capturée au rendu, et jamais
 * avant que les réglages du serveur soient arrivés (`shared/src/liste-de-la-colonne.ts`).
 * `present` absent : bascule. Rend vrai si quelque chose a été écrit.
 */
export function modifierLaListe(key: string, id: string, present?: boolean): boolean {
  const etat = client.lireEtat();
  if (!peutEcrireLaColonne(etat)) return false;
  const actuelle = etat.prefs[key];
  const suivante = present === undefined ? listeBasculee(actuelle, id) : listeAvecOuSans(actuelle, id, present);
  if (!suivante) return false;
  writePref(key, suivante);
  return true;
}
