import * as React from 'react';
import { pageCachee, surLaVisibilite } from './veille';

/**
 * L'heure qui avance, pour TOUT l'écran — à la minute (`useMinute`) ou à la
 * seconde (`useSeconde`).
 *
 * Certains repères ne dépendent pas d'un changement d'état mais du simple temps
 * qui passe : « tour terminé sans suite depuis 3 h » doit apparaître même si
 * rien n'arrive du serveur. Sans horloge, la mention n'aurait été calculée
 * qu'au prochain rendu — c'est-à-dire au prochain événement, peut-être jamais.
 *
 * Un SEUL intervalle par rythme pour toute la page, partagé par abonnement :
 * vingt cartes à l'écran ne font pas vingt minuteries. Il ne tourne que tant
 * qu'au moins un composant écoute, et s'arrête tout seul ensuite.
 *
 * ET IL NE TOURNE QUE SOUS LES YEUX. Page cachée (onglet en arrière-plan,
 * téléphone verrouillé), l'intervalle est retiré : un chronomètre que personne
 * ne lit ne réveille pas le processeur chaque seconde. Au retour, un battement
 * part tout de suite — l'heure affichée est juste dès le premier regard.
 */

interface Horloge {
  pas: number;
  minuterie: number | null;
  abonnes: Set<(at: number) => void>;
}

const creer = (pas: number): Horloge => ({ pas, minuterie: null, abonnes: new Set() });
const MINUTE = creer(60_000);
const SECONDE = creer(1_000);

function battre(horloge: Horloge): void {
  const at = Date.now();
  for (const abonne of horloge.abonnes) abonne(at);
}

/** L'intervalle existe si quelqu'un écoute ET que la page est à l'écran. */
function regler(horloge: Horloge): void {
  const doitTourner = horloge.abonnes.size > 0 && !pageCachee();
  if (doitTourner && horloge.minuterie === null) {
    horloge.minuterie = window.setInterval(() => battre(horloge), horloge.pas);
  } else if (!doitTourner && horloge.minuterie !== null) {
    window.clearInterval(horloge.minuterie);
    horloge.minuterie = null;
  }
}

function abonner(horloge: Horloge, abonne: (at: number) => void): () => void {
  horloge.abonnes.add(abonne);
  regler(horloge);
  return () => {
    horloge.abonnes.delete(abonne);
    regler(horloge);
  };
}

if (typeof window !== 'undefined') {
  surLaVisibilite(() => {
    for (const horloge of [MINUTE, SECONDE]) {
      // Le retour à l'écran remet l'heure à jour avant de relancer le rythme.
      if (!pageCachee() && horloge.abonnes.size > 0) battre(horloge);
      regler(horloge);
    }
  });
}

function useHorloge(horloge: Horloge, actif: boolean): number {
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => (actif ? abonner(horloge, setMaintenant) : undefined), [horloge, actif]);
  return maintenant;
}

/** L'heure courante, rafraîchie chaque minute. */
export function useMinute(): number {
  return useHorloge(MINUTE, true);
}

/**
 * L'heure courante, rafraîchie chaque seconde — pour un chronomètre affiché.
 * `actif` à faux n'abonne pas : un compteur figé (tour fini) ne coûte rien.
 */
export function useSeconde(actif = true): number {
  return useHorloge(SECONDE, actif);
}
